-- 修復 42725 / PGRST203：同名 create_class 多個版本造成建班衝突。
-- 在該專案的 Supabase SQL Editor 整份執行。可重複執行，保留既有資料。
-- 保留其他版本的 create_class；本遊戲改用名稱獨立的入口。
begin;

create or replace function public.create_guardian_class(p_name text, p_password text, p_open_levels int[] default '{}', p_question_count int default 15)
returns table (code text, name text, open_levels smallint[], question_count smallint)
language plpgsql security definer set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  new_code text;
begin
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) not between 1 and 40 then raise exception 'invalid_name'; end if;
  if char_length(coalesce(p_password, '')) < 6 then raise exception 'password_too_short'; end if;
  if p_question_count not between 1 and 15 then raise exception 'invalid_question_count'; end if;
  loop
    select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '') into new_code from generate_series(1, 6);
    exit when not exists (select 1 from public.classes c where c.code = new_code);
  end loop;
  insert into public.classes (code, name, password_hash, open_levels, question_count)
  values (new_code, p_name, extensions.crypt(p_password, extensions.gen_salt('bf')), public.clean_levels(p_open_levels), p_question_count);
  return query select c.code, c.name, c.open_levels, c.question_count from public.classes c where c.code = new_code;
end;
$$;

create or replace function public.create_custom_class(p_name text, p_password text, p_open_levels int[], p_question_count int, p_bank jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare made record;
begin
  select * into made from public.create_guardian_class(p_name, p_password, p_open_levels, p_question_count);
  perform public.set_custom_bank(made.code, p_password, p_bank);
  return to_jsonb(made);
end;
$$;

revoke all on function public.create_guardian_class(text, text, int[], int), public.create_custom_class(text, text, int[], int, jsonb) from public;
grant execute on function public.create_guardian_class(text, text, int[], int), public.create_custom_class(text, text, int[], int, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
