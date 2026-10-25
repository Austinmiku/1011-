-- 歷史文物守護行動：雲端作答紀錄（Supabase / PostgreSQL）
-- 使用方式：在 Supabase 專案的 SQL Editor 貼上整份檔案執行一次。
--
-- 安全設計：
--   * 三張資料表都開啟 Row Level Security 且不給任何政策，瀏覽器（anon）不能直接讀寫。
--   * 遊戲只能透過下面五個函式存取：
--       create_class   老師建立班級，取得班級代碼
--       check_class    學生加入班級前確認代碼存在
--       record_events  遊戲寫入作答紀錄（只能新增，不能讀）
--       class_report   老師用代碼＋管理密碼讀取統計
--       class_events   老師用代碼＋管理密碼匯出原始紀錄
--   * 管理密碼以 bcrypt 雜湊保存；資料庫裡沒有學生姓名，只有座號。

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ===== 資料表 =====

create table if not exists public.classes (
  code          text primary key,
  name          text not null check (char_length(name) between 1 and 40),
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- 一次「出發」到「過關／失敗」算一場
create table if not exists public.play_sessions (
  id                 uuid primary key,
  class_code         text not null references public.classes(code) on delete cascade,
  seat               smallint not null check (seat between 1 and 99),
  level              smallint not null check (level between 1 and 20),
  unit_key           text,
  teacher_mode       boolean not null default false,
  attempt_no         smallint not null default 1,
  items              text[] not null default '{}',
  started_at         timestamptz not null,
  ended_at           timestamptz,
  outcome            text check (outcome in ('cleared', 'defeated')),
  hearts_left        smallint,
  questions_answered smallint
);

-- 每一個作答動作一筆
--   prediction    課前預測
--   guide         單元導讀（看了幾頁、回頭幾次）
--   explore       探索驗證（每個調查點錯幾次才答對）
--   judge         證據對決的判斷（首答是否正確、選錯哪些選項、花幾秒）
--   evidence_step 證據對決的找證據（舊版遊戲使用，保留以相容舊資料）
--   item_use      使用道具
--   event_quiz    隨機事件的知識題
--   exit          區域學習單
create table if not exists public.answer_events (
  id            bigint generated always as identity primary key,
  client_id     uuid not null unique,
  session_id    uuid not null references public.play_sessions(id) on delete cascade,
  class_code    text not null references public.classes(code) on delete cascade,
  seat          smallint not null,
  level         smallint not null,
  kind          text not null check (kind in ('prediction', 'guide', 'explore', 'judge', 'evidence_step', 'item_use', 'event_quiz', 'exit')),
  question_id   text,
  objective_id  text,
  source        text,
  first_try     boolean,
  attempts      smallint,
  wrong_choices jsonb not null default '[]',
  duration_ms   integer,
  detail        jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

create index if not exists answer_events_class_seat_idx on public.answer_events (class_code, seat);
create index if not exists answer_events_session_idx on public.answer_events (session_id);
create index if not exists play_sessions_class_seat_idx on public.play_sessions (class_code, seat);

alter table public.classes enable row level security;
alter table public.play_sessions enable row level security;
alter table public.answer_events enable row level security;
revoke all on public.classes, public.play_sessions, public.answer_events from public, anon, authenticated;

-- ===== 函式 =====

-- 老師建立班級：回傳 6 碼班級代碼（不含容易看錯的 0、O、1、I）
create or replace function public.create_class(p_name text, p_password text)
returns table (code text, name text)
language plpgsql security definer set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  new_code text;
begin
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) not between 1 and 40 then raise exception 'invalid_name'; end if;
  if char_length(coalesce(p_password, '')) < 6 then raise exception 'password_too_short'; end if;
  loop
    select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '') into new_code from generate_series(1, 6);
    exit when not exists (select 1 from public.classes c where c.code = new_code);
  end loop;
  insert into public.classes (code, name, password_hash)
  values (new_code, p_name, extensions.crypt(p_password, extensions.gen_salt('bf')));
  return query select new_code, p_name;
end;
$$;

-- 學生加入班級前確認代碼：存在就回傳班級名稱，否則回傳 null
create or replace function public.check_class(p_code text)
returns text
language sql stable security definer set search_path = ''
as $$
  select c.name from public.classes c where c.code = upper(btrim(p_code));
$$;

-- 遊戲寫入一場的資料與這批作答紀錄。重送同一批不會重複（client_id 唯一）
create or replace function public.record_events(p_code text, p_seat int, p_session jsonb, p_events jsonb)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_code text := upper(btrim(p_code));
  v_session uuid := (p_session ->> 'id')::uuid;
  v_level smallint := (p_session ->> 'level')::smallint;
  inserted int;
begin
  if not exists (select 1 from public.classes c where c.code = v_code) then raise exception 'unknown_class'; end if;
  if p_seat not between 1 and 99 then raise exception 'invalid_seat'; end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 200 then raise exception 'invalid_events'; end if;
  if octet_length(p_events::text) > 200000 then raise exception 'payload_too_large'; end if;

  insert into public.play_sessions as s (id, class_code, seat, level, unit_key, teacher_mode, attempt_no, items, started_at, ended_at, outcome, hearts_left, questions_answered)
  values (
    v_session, v_code, p_seat, v_level,
    left(p_session ->> 'unit_key', 40),
    coalesce((p_session ->> 'teacher_mode')::boolean, false),
    coalesce((p_session ->> 'attempt_no')::smallint, 1),
    coalesce(array(select left(x, 20) from jsonb_array_elements_text(coalesce(p_session -> 'items', '[]')) x limit 5), '{}'),
    coalesce((p_session ->> 'started_at')::timestamptz, now()),
    (p_session ->> 'ended_at')::timestamptz,
    p_session ->> 'outcome',
    (p_session ->> 'hearts_left')::smallint,
    (p_session ->> 'questions_answered')::smallint
  )
  on conflict (id) do update set
    ended_at           = coalesce(excluded.ended_at, s.ended_at),
    outcome            = coalesce(excluded.outcome, s.outcome),
    hearts_left        = coalesce(excluded.hearts_left, s.hearts_left),
    questions_answered = coalesce(excluded.questions_answered, s.questions_answered)
  where s.class_code = v_code and s.seat = p_seat;

  -- 同一個 id 已屬於別的班級或座號時不接受
  if not exists (select 1 from public.play_sessions s where s.id = v_session and s.class_code = v_code and s.seat = p_seat) then
    raise exception 'session_mismatch';
  end if;

  insert into public.answer_events (client_id, session_id, class_code, seat, level, kind, question_id, objective_id, source, first_try, attempts, wrong_choices, duration_ms, detail, created_at)
  select e.client_id, v_session, v_code, p_seat, v_level, e.kind,
         left(e.question_id, 40), left(e.objective_id, 40), left(e.source, 40),
         e.first_try, least(e.attempts, 99)::smallint,
         case when jsonb_typeof(e.wrong_choices) = 'array' then e.wrong_choices else '[]'::jsonb end,
         least(greatest(e.duration_ms, 0), 3600000),
         case when jsonb_typeof(e.detail) = 'object' then e.detail else '{}'::jsonb end,
         coalesce(e.created_at, now())
  from jsonb_to_recordset(p_events) as e(client_id uuid, kind text, question_id text, objective_id text, source text, first_try boolean, attempts int, wrong_choices jsonb, duration_ms int, detail jsonb, created_at timestamptz)
  on conflict (client_id) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- 確認管理密碼（內部使用）
create or replace function public.verify_class_password(p_code text, p_password text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_code text := upper(btrim(p_code));
begin
  if not exists (select 1 from public.classes c where c.code = v_code and c.password_hash = extensions.crypt(coalesce(p_password, ''), c.password_hash)) then
    raise exception 'invalid_class_or_password';
  end if;
  return v_code;
end;
$$;

-- 老師查閱：學生總覽、學習目標掌握度、常錯選項、區域學習單。p_level 為 null 時看全部關卡
create or replace function public.class_report(p_code text, p_password text, p_level int default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_code text := public.verify_class_password(p_code, p_password);
  result jsonb;
begin
  with
  s as (select * from public.play_sessions where class_code = v_code and (p_level is null or level = p_level)),
  e as (select * from public.answer_events where class_code = v_code and (p_level is null or level = p_level)),
  seats as (select seat from s union select seat from e),
  ss as (
    select seat,
           count(*) as sessions,
           count(distinct level) filter (where outcome = 'cleared') as levels_cleared,
           count(*) filter (where outcome = 'defeated') as defeats,
           count(*) filter (where outcome is null) as unfinished,
           round(avg(hearts_left) filter (where outcome = 'cleared'), 1) as avg_hearts_left
    from s group by seat
  ),
  es as (
    select seat,
           count(*) filter (where kind = 'judge') as judged,
           round(100.0 * avg(first_try::int) filter (where kind = 'judge')) as judge_first_rate,
           round(100.0 * avg(first_try::int) filter (where kind = 'evidence_step')) as evidence_first_rate,
           round(avg(duration_ms) filter (where kind = 'judge') / 1000.0, 1) as avg_judge_sec,
           count(*) filter (where kind = 'judge' and not first_try and (detail ->> 'first_answer_ms')::int < 4000) as quick_wrong,
           round(avg(attempts - 1) filter (where kind = 'explore'), 1) as explore_avg_wrong,
           count(*) filter (where kind = 'item_use') as items_used,
           count(*) filter (where kind = 'item_use' and detail ->> 'item' in ('lens', 'compass')) as hints_used,
           round(100.0 * avg(least(1.0, (detail ->> 'pages_viewed')::numeric / nullif((detail ->> 'total_pages')::numeric, 0))) filter (where kind = 'guide')) as guide_read_rate,
           round(100.0 * avg(first_try::int) filter (where kind = 'event_quiz')) as event_quiz_rate,
           count(*) filter (where kind = 'exit') as exits,
           max(created_at) as last_active
    from e group by seat
  )
  select jsonb_build_object(
    'class', (select jsonb_build_object('code', c.code, 'name', c.name) from public.classes c where c.code = v_code),
    'level', p_level,
    'students', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.seat) from (
        select seats.seat,
               coalesce(ss.sessions, 0) as sessions, coalesce(ss.levels_cleared, 0) as levels_cleared,
               coalesce(ss.defeats, 0) as defeats, coalesce(ss.unfinished, 0) as unfinished, ss.avg_hearts_left,
               coalesce(es.judged, 0) as judged, es.judge_first_rate, es.evidence_first_rate, es.avg_judge_sec,
               coalesce(es.quick_wrong, 0) as quick_wrong, es.explore_avg_wrong,
               coalesce(es.items_used, 0) as items_used, coalesce(es.hints_used, 0) as hints_used,
               es.guide_read_rate, es.event_quiz_rate, coalesce(es.exits, 0) as exits, es.last_active
        from seats left join ss on ss.seat = seats.seat left join es on es.seat = seats.seat
      ) t), '[]'::jsonb),
    'objectives', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.first_rate nulls last, t.objective_id) from (
        select objective_id, count(*) as answered, count(distinct seat) as students,
               round(100.0 * avg(first_try::int)) as first_rate
        from e where kind = 'judge' and objective_id is not null group by objective_id
      ) t), '[]'::jsonb),
    'wrong_choices', coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select e.question_id, e.level, w ->> 'text' as choice, w ->> 'misconception' as misconception,
               count(*) as times, count(distinct e.seat) as students
        from e, jsonb_array_elements(e.wrong_choices) w
        where e.kind = 'judge'
        group by 1, 2, 3, 4 order by times desc, students desc limit 30
      ) t), '[]'::jsonb),
    'exits', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at desc) from (
        select seat, level, detail ->> 'prediction' as prediction, detail ->> 'confidence' as confidence,
               detail ->> 'response' as response, created_at
        from e where kind = 'exit' order by created_at desc limit 500
      ) t), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- 老師匯出原始紀錄（最多 20000 筆，最新的在前）
create or replace function public.class_events(p_code text, p_password text)
returns table (seat smallint, level smallint, kind text, question_id text, objective_id text, source text, first_try boolean,
               attempts smallint, wrong_choices jsonb, duration_ms integer, detail jsonb, created_at timestamptz,
               session_id uuid, attempt_no smallint, teacher_mode boolean, outcome text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_code text := public.verify_class_password(p_code, p_password);
begin
  return query
    select e.seat, e.level, e.kind, e.question_id, e.objective_id, e.source, e.first_try, e.attempts, e.wrong_choices,
           e.duration_ms, e.detail, e.created_at, e.session_id, s.attempt_no, s.teacher_mode, s.outcome
    from public.answer_events e join public.play_sessions s on s.id = e.session_id
    where e.class_code = v_code
    order by e.created_at desc limit 20000;
end;
$$;

revoke all on function public.create_class(text, text), public.check_class(text), public.record_events(text, int, jsonb, jsonb),
  public.verify_class_password(text, text), public.class_report(text, text, int), public.class_events(text, text) from public;
grant execute on function public.create_class(text, text), public.check_class(text), public.record_events(text, int, jsonb, jsonb),
  public.class_report(text, text, int), public.class_events(text, text) to anon, authenticated;
