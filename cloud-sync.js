"use strict";
/* ===== 雲端作答紀錄（Supabase） =====
   cloud-config.js 填好網址與 publishable key 才會啟用；沒填時所有函式都不做事，遊戲照常運作。
   只送班級代碼、座號與作答資料，不送玩家名字。資料庫結構與權限見 supabase/schema.sql。
   作答先存進本機佇列，再分批送出；離線或送失敗時會留在佇列，下次再送。
   這個檔案在遊戲主程式之前載入；state、render、esc 等主程式的名稱都在呼叫時才取用。 */
(function () {
  const config = window.GUARDIAN_CLOUD_CONFIG || {};
  const QUEUE_KEY = "relicGuardian-cloud-queue-v1", ATTEMPT_KEY = "relicGuardian-cloud-attempts-v1", TEACHER_CODE_KEY = "relicGuardian-cloud-teacher-code";
  const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
  const key = String(config.publishableKey || "").trim();
  const base = String(config.url || "").trim().replace(/\/+$/, "");
  const decodeJwtPart = part => { try { return atob(part.replace(/-/g, "+").replace(/_/g, "/")); } catch { return ""; } };
  // 秘密金鑰放進網頁等於公開給所有人，偵測到就停用
  const unsafeKey = /^sb_secret_/.test(key) || /service_role/.test(decodeJwtPart(key.split(".")[1] || ""));
  if (unsafeKey) console.error("cloud-config.js 填入的是秘密金鑰，雲端紀錄已停用。請改填 publishable key。");
  const enabled = !!(base && key) && !unsafeKey;

  const read = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 儲存空間滿或被封鎖時略過 */ } };
  const uuid = () => (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });

  async function rpc(fn, body, { keepalive = false } = {}) {
    const headers = { "Content-Type": "application/json", apikey: key };
    // 舊式 anon key 是 JWT，要放在 Authorization；新式 publishable key 只放 apikey
    if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(body), keepalive });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) { const err = new Error((data && data.message) || `HTTP ${res.status}`); err.status = res.status; throw err; }
    return data;
  }

  /* ===== 作答佇列 ===== */
  let queue = read(QUEUE_KEY, null);
  if (!queue || typeof queue !== "object" || !Array.isArray(queue.events) || typeof queue.sessions !== "object") queue = { sessions: {}, events: [] };
  let current = null, flushing = null;
  const persist = () => { if (queue.events.length > 3000) queue.events = queue.events.slice(-3000); write(QUEUE_KEY, queue); };
  const member = () => { const m = state.cloudClass; return m && CODE_PATTERN.test(m.code) && m.seat >= 1 && m.seat <= 99 ? m : null; };

  /* 按下「帶著道具出發」時開始一場；沒有加入班級就不記錄 */
  function startSession({ level, unitKey, teacherMode, items }) {
    current = null;
    const m = member();
    if (!enabled || !m) return;
    const attempts = read(ATTEMPT_KEY, {}), counter = `${m.code}:${m.seat}:${level}`;
    attempts[counter] = (attempts[counter] || 0) + 1;
    write(ATTEMPT_KEY, attempts);
    const id = uuid();
    queue.sessions[id] = { code: m.code, seat: m.seat, judged: 0, dirty: false, sent: false,
      row: { id, level, unit_key: unitKey || null, teacher_mode: !!teacherMode, attempt_no: attempts[counter], items: items || [], started_at: new Date().toISOString() } };
    current = id;
    persist();
  }
  function log(kind, fields = {}) {
    const s = current && queue.sessions[current];
    if (!enabled || !s) return;
    if (kind === "judge") s.judged++;
    queue.events.push({ session_id: current, client_id: uuid(), kind, created_at: new Date().toISOString(), ...fields });
    persist();
    if (queue.events.length >= 10) flush();
  }
  function endSession(outcome, extra = {}) {
    const s = current && queue.sessions[current];
    if (!enabled || !s) return;
    Object.assign(s.row, { ended_at: new Date().toISOString(), outcome, questions_answered: s.judged, ...extra });
    s.dirty = true;
    persist();
    flush();
  }
  function flush(options = {}) {
    if (!enabled) return Promise.resolve();
    if (flushing) return flushing;
    // 用 .finally 解鎖：佇列是空的時候 async 函式會立刻結束，若在函式內解鎖會早於上鎖，之後就再也送不出去
    flushing = (async () => {
      {
        for (const [id, s] of Object.entries(queue.sessions)) {
          const events = queue.events.filter(e => e.session_id === id).slice(0, 200);
          if (!events.length && !s.dirty) continue;
          const payload = events.map(({ session_id, ...e }) => e);
          try {
            await rpc("record_events", { p_code: s.code, p_seat: s.seat, p_session: s.row, p_events: payload }, options);
            const sent = new Set(payload.map(e => e.client_id));
            queue.events = queue.events.filter(e => !sent.has(e.client_id));
            s.sent = true; s.dirty = false;
            persist();
          } catch (err) {
            // 400 類錯誤代表這一批資料本身有問題（例如班級已被刪除），丟掉以免一直重送；其他錯誤保留下次再送
            if (err.status && err.status < 500 && err.status !== 408 && err.status !== 429) {
              console.warn("雲端紀錄被拒絕，已略過這一場：", err.message);
              queue.events = queue.events.filter(e => e.session_id !== id);
              delete queue.sessions[id];
              persist();
            } else break;
          }
        }
        for (const [id, s] of Object.entries(queue.sessions))
          if (id !== current && !s.dirty && !queue.events.some(e => e.session_id === id)) delete queue.sessions[id];
        persist();
      }
    })().finally(() => { flushing = null; });
    return flushing;
  }
  const pending = () => queue.events.length;
  if (enabled && typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush({ keepalive: true }); });
    setTimeout(() => flush(), 4000);
  }

  /* ===== 學生：加入班級 ===== */
  const classLabel = () => { const m = member(); return m ? `${m.name}・${m.seat} 號` : ""; };
  function showJoin(next) {
    const back = typeof next === "function" ? next : () => (state.playerName ? showMap() : showTitle());
    const m = member();
    render(`<section class="screen cloud-screen"><div class="eyebrow">加入班級・作答會記錄到雲端</div><h2>輸入老師給的班級代碼</h2>
      <p>加入後，你的作答情況會用「座號」記錄下來，讓老師了解大家的學習狀況。不會記錄你的名字。</p>
      ${m ? `<p class="cloud-joined">目前已加入：<b>${esc(m.name)}</b>・${m.seat} 號</p>` : ""}
      <form class="cloud-form" id="joinForm" novalidate>
        <label for="joinCode">班級代碼</label><input class="name-input" id="joinCode" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="例如 K7QX2M" value="${esc(m ? m.code : "")}">
        <label for="joinSeat">座號</label><input class="name-input" id="joinSeat" type="number" inputmode="numeric" min="1" max="99" placeholder="1～99" value="${m ? m.seat : ""}">
        <p class="name-error" id="joinError" role="alert" aria-live="polite"></p>
        <div class="row"><button class="secondary" type="button" id="joinBack">${m ? "返回" : "先不加入"}</button><div class="row">${m ? `<button class="secondary" type="button" id="joinLeave">離開班級</button>` : ""}<button class="primary" type="submit" id="joinGo">加入班級</button></div></div>
      </form></section>`);
    const error = document.querySelector("#joinError"), go = document.querySelector("#joinGo"), codeInput = document.querySelector("#joinCode");
    codeInput.oninput = () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); };
    document.querySelector("#joinBack").onclick = back;
    const leave = document.querySelector("#joinLeave");
    if (leave) leave.onclick = () => { state.cloudClass = null; save(); toast("已離開班級，之後的作答不會再記錄到雲端。"); back(); };
    document.querySelector("#joinForm").onsubmit = async e => {
      e.preventDefault();
      const code = codeInput.value.trim().toUpperCase(), seat = Number(document.querySelector("#joinSeat").value);
      if (!CODE_PATTERN.test(code)) { error.textContent = "班級代碼是 6 個英文字母或數字，請再看一次老師給的代碼。"; return; }
      if (!Number.isInteger(seat) || seat < 1 || seat > 99) { error.textContent = "請輸入 1 到 99 的座號。"; return; }
      if (!enabled) { error.textContent = "這個版本還沒有設定雲端資料庫，請告訴老師。"; return; }
      go.disabled = true; go.textContent = "確認中…"; error.textContent = "";
      try {
        const name = await rpc("check_class", { p_code: code });
        if (!name) { error.textContent = "找不到這個班級代碼，請再跟老師確認。"; return; }
        state.cloudClass = { code, name, seat }; save();
        toast(`已加入 ${name}・${seat} 號`);
        back();
      } catch { error.textContent = "目前連不上雲端，請檢查網路後再試一次。"; }
      finally { if (go.isConnected) { go.disabled = false; go.textContent = "加入班級"; } }
    };
    codeInput.focus();
  }

  /* ===== 教師：建立班級與查閱作答 ===== */
  let teacherAuth = null; // { code, password }：只放在記憶體，重新整理頁面後要重新輸入
  function showTeacher() {
    if (!enabled) {
      render(`<section class="screen cloud-screen"><div class="eyebrow">教師模式・雲端班級</div><h2>還沒有設定雲端資料庫</h2><p>要記錄學生作答，請先依 README「雲端作答紀錄」建立 Supabase 專案，並在 <code>cloud-config.js</code> 填入網址與 publishable key。</p><button class="secondary" id="cloudBack">返回教師模式</button></section>`);
      document.querySelector("#cloudBack").onclick = showTeacherMode;
      return;
    }
    const lastCode = read(TEACHER_CODE_KEY, "") || "";
    render(`<section class="screen cloud-screen teacher-screen"><div class="eyebrow">教師模式・雲端班級</div><h2>建立班級，查看學生作答</h2>
      <div class="cloud-grid">
        <section class="teacher-step"><h3><span class="num">1</span>建立新班級</h3><p>建立後會得到 6 碼班級代碼。請學生在遊戲首頁或任務地圖按「加入班級」，輸入代碼和座號。</p>
          <form class="cloud-form" id="createForm" novalidate>
            <label for="newName">班級名稱</label><input class="name-input" id="newName" maxlength="40" placeholder="例如 五年甲班">
            <label for="newPass">管理密碼（至少 6 個字）</label><input class="name-input" id="newPass" type="password" autocomplete="new-password">
            <label for="newPass2">再輸入一次管理密碼</label><input class="name-input" id="newPass2" type="password" autocomplete="new-password">
            <p class="name-error" id="createError" role="alert" aria-live="polite"></p>
            <button class="primary" type="submit" id="createGo">建立班級</button>
          </form><div id="createResult"></div></section>
        <section class="teacher-step"><h3><span class="num">2</span>查看作答紀錄</h3><p>輸入班級代碼與管理密碼，就能看到全班與每位學生的作答情況。</p>
          <form class="cloud-form" id="viewForm" novalidate>
            <label for="viewCode">班級代碼</label><input class="name-input" id="viewCode" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(lastCode)}">
            <label for="viewPass">管理密碼</label><input class="name-input" id="viewPass" type="password" autocomplete="current-password">
            <p class="name-error" id="viewError" role="alert" aria-live="polite"></p>
            <button class="primary" type="submit" id="viewGo">查看作答紀錄</button>
          </form></section>
      </div>
      <p class="learn-note">管理密碼請自行保存，遺失後無法查回。資料只有座號與作答內容，不含學生姓名；學生要自己按「加入班級」，作答才會被記錄。</p>
      <button class="secondary" id="cloudBack">返回教師模式</button></section>`);
    document.querySelector("#cloudBack").onclick = showTeacherMode;
    const upper = el => el.oninput = () => { el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); };
    upper(document.querySelector("#viewCode"));
    document.querySelector("#createForm").onsubmit = async e => {
      e.preventDefault();
      const name = document.querySelector("#newName").value.trim(), pass = document.querySelector("#newPass").value, pass2 = document.querySelector("#newPass2").value, error = document.querySelector("#createError"), go = document.querySelector("#createGo");
      if (!name) { error.textContent = "請輸入班級名稱。"; return; }
      if (pass.length < 6) { error.textContent = "管理密碼至少要 6 個字。"; return; }
      if (pass !== pass2) { error.textContent = "兩次輸入的管理密碼不一樣。"; return; }
      go.disabled = true; go.textContent = "建立中…"; error.textContent = "";
      try {
        const rows = await rpc("create_class", { p_name: name, p_password: pass }), made = Array.isArray(rows) ? rows[0] : rows;
        write(TEACHER_CODE_KEY, made.code);
        teacherAuth = { code: made.code, password: pass };
        document.querySelector("#createResult").innerHTML = `<div class="cloud-code" role="status"><small>${esc(made.name)} 的班級代碼</small><b>${esc(made.code)}</b><span>請寫在黑板上，讓學生按「加入班級」輸入。</span><button class="primary" type="button" id="openNew">查看這個班級的作答紀錄</button></div>`;
        document.querySelector("#createForm").reset();
        document.querySelector("#openNew").onclick = () => showReport();
      } catch (err) { error.textContent = `建立失敗：${err.message === "password_too_short" ? "管理密碼太短。" : "目前連不上雲端，請稍後再試。"}`; }
      finally { go.disabled = false; go.textContent = "建立班級"; }
    };
    document.querySelector("#viewForm").onsubmit = async e => {
      e.preventDefault();
      const code = document.querySelector("#viewCode").value.trim().toUpperCase(), password = document.querySelector("#viewPass").value, error = document.querySelector("#viewError"), go = document.querySelector("#viewGo");
      if (!CODE_PATTERN.test(code) || !password) { error.textContent = "請輸入 6 碼班級代碼與管理密碼。"; return; }
      go.disabled = true; go.textContent = "讀取中…"; error.textContent = "";
      try {
        const report = await rpc("class_report", { p_code: code, p_password: password, p_level: null });
        teacherAuth = { code, password };
        write(TEACHER_CODE_KEY, code);
        renderReport(report, null);
      } catch (err) {
        error.textContent = /invalid_class_or_password/.test(err.message) ? "班級代碼或管理密碼不正確。" : "目前連不上雲端，請稍後再試。";
        go.disabled = false; go.textContent = "查看作答紀錄";
      }
    };
  }

  async function showReport(level = null) {
    if (!teacherAuth) return showTeacher();
    render(`<section class="screen cloud-screen"><div class="eyebrow">教師模式・雲端作答紀錄</div><h2>讀取中…</h2></section>`);
    try { renderReport(await rpc("class_report", { p_code: teacherAuth.code, p_password: teacherAuth.password, p_level: level }), level); }
    catch { render(`<section class="screen cloud-screen"><div class="eyebrow">教師模式・雲端作答紀錄</div><h2>讀取失敗</h2><p>目前連不上雲端，請稍後再試。</p><button class="secondary" id="cloudBack">返回</button></section>`); document.querySelector("#cloudBack").onclick = showTeacher; }
  }

  const pct = v => v === null || v === undefined ? "—" : `${v}%`;
  const num = (v, unit = "") => v === null || v === undefined ? "—" : `${v}${unit}`;
  const low = v => v !== null && v !== undefined && Number(v) < 60 ? ' class="low"' : "";
  const levelName = n => { const l = levels[n - 1]; return l ? `第 ${n} 關・${l.title}` : `第 ${n} 關`; };
  const questionText = id => { for (const list of Object.values(questionBank)) { const q = list.find(x => x.id === id); if (q) return q.prompt; } return id; };
  const objectiveName = id => { const unit = curriculum.units.find(u => String(id).startsWith(u.key)); if (!unit) return id; const suffix = String(id).slice(unit.key.length + 1); return /^(PAPER)?$/.test(suffix) ? `${unit.term}・${unit.title}` : `${unit.term}・${unit.title}・${suffix}`; };
  const when = at => { const d = new Date(at); return isNaN(d) ? "—" : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const csvCell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const toCsv = rows => "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n");
  function download(name, text) { const a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const STUDENT_COLUMNS = [
    ["seat", "座號", v => v], ["levels_cleared", "完成關卡", v => v], ["defeats", "失敗", v => v], ["unfinished", "未完成", v => v],
    ["judge_first_rate", "首答正確率", pct], ["avg_judge_sec", "平均作答秒數", v => num(v, " 秒")],
    ["quick_wrong", "快速答錯", v => v], ["explore_avg_wrong", "探索平均錯次", v => num(v)], ["hints_used", "提示道具", v => v],
    ["guide_read_rate", "導讀閱讀率", pct], ["event_quiz_rate", "事件題正確率", pct], ["exits", "學習單", v => v], ["last_active", "最後作答", when],
  ];

  function renderReport(report, level) {
    const students = report.students || [], objectives = report.objectives || [], wrongs = report.wrong_choices || [], exits = report.exits || [];
    const cls = report.class || { name: "", code: teacherAuth.code };
    render(`<section class="screen cloud-screen cloud-report"><div class="eyebrow">教師模式・雲端作答紀錄</div><h2>${esc(cls.name)}<small>班級代碼 ${esc(cls.code)}</small></h2>
      <div class="cloud-toolbar no-print"><label for="levelFilter">查看範圍</label><select id="levelFilter"><option value="">全部關卡</option>${levels.map((l, i) => `<option value="${i + 1}"${level === i + 1 ? " selected" : ""}>${esc(levelName(i + 1))}</option>`).join("")}</select>
        <button class="secondary" id="reportRefresh">重新整理</button><button class="secondary" id="exportStudents">匯出學生總覽 CSV</button><button class="secondary" id="exportRaw">匯出原始紀錄 CSV</button><button class="secondary" id="reportPrint">列印</button></div>
      ${students.length ? "" : `<p class="summary-empty">這個範圍還沒有作答紀錄。學生要先按「加入班級」並完成任務，紀錄才會出現。</p>`}
      ${students.length ? `<section class="cloud-section"><h3>學生總覽（${students.length} 人）</h3><div class="table-scroll"><table class="cloud-table"><thead><tr>${STUDENT_COLUMNS.map(c => `<th>${c[1]}</th>`).join("")}</tr></thead><tbody>${students.map(s => `<tr>${STUDENT_COLUMNS.map(([k, , f]) => `<td${/rate/.test(k) ? low(s[k]) : ""}>${esc(f(s[k]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
        <details class="cloud-legend"><summary>指標說明</summary><dl>
          <dt>首答正確率</dt><dd>證據對決中第一次就判斷正確的比例，最能反映真正的理解。</dd>
          <dt>平均作答秒數</dt><dd>從題目出現到判斷正確所花的時間。</dd>
          <dt>快速答錯</dt><dd>4 秒內就作答且答錯的題數，可能是沒讀題就猜。</dd>
          <dt>探索平均錯次</dt><dd>每個調查點答對前平均選錯幾次，反映讀資料、找線索的能力。</dd>
          <dt>提示道具</dt><dd>使用線索放大鏡（看提示）或航海羅盤（刪選項）的次數。</dd>
          <dt>導讀閱讀率</dt><dd>單元導讀實際翻過的頁數比例。</dd>
          <dt>未完成</dt><dd>出發後沒有打到過關或失敗就離開的場次。</dd>
        </dl><p>低於 60% 的比例會以紅色標示。</p></details></section>` : ""}
      ${objectives.length ? `<section class="cloud-section"><h3>學習目標掌握度</h3><p>依首答正確率由低到高排列，排在前面的目標適合優先補強。（目前題庫每個單元只有一個學習目標代碼，所以這裡是以單元為單位；題庫補上更細的目標後會自動分開。）</p><div class="table-scroll"><table class="cloud-table"><thead><tr><th>學習目標</th><th>作答題數</th><th>作答人數</th><th>首答正確率</th></tr></thead><tbody>${objectives.map(o => `<tr><td>${esc(objectiveName(o.objective_id))}</td><td>${o.answered}</td><td>${o.students}</td><td${low(o.first_rate)}>${pct(o.first_rate)}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      ${wrongs.length ? `<section class="cloud-section"><h3>常選錯的選項</h3><div class="table-scroll"><table class="cloud-table"><thead><tr><th>題目</th><th>選錯的選項</th><th>次數</th><th>人數</th></tr></thead><tbody>${wrongs.map(w => `<tr><td><small>${esc(levelName(w.level))}</small><br>${esc(questionText(w.question_id))}</td><td>${esc(w.choice)}</td><td>${w.times}</td><td>${w.students}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      ${exits.length ? `<section class="cloud-section"><h3>區域學習單（${exits.length} 份）</h3><div class="summary-list">${exits.map(x => `<article class="summary-entry"><div class="meta"><span>${x.seat} 號</span><span>${esc(levelName(x.level))}</span><span>課前：${esc(x.prediction || "未作答")}</span><span>確定程度：${esc(x.confidence || "—")}</span><span>${when(x.created_at)}</span></div>${esc(x.response || "")}</article>`).join("")}</div></section>` : ""}
      <div class="row no-print" style="margin-top:18px"><button class="secondary" id="cloudBack">返回雲端班級</button></div></section>`);
    document.querySelector("#cloudBack").onclick = showTeacher;
    document.querySelector("#reportRefresh").onclick = () => showReport(level);
    document.querySelector("#reportPrint").onclick = () => window.print();
    document.querySelector("#levelFilter").onchange = e => showReport(e.target.value ? Number(e.target.value) : null);
    document.querySelector("#exportStudents").onclick = () => download(`${cls.name}-學生總覽.csv`, toCsv([STUDENT_COLUMNS.map(c => c[1]), ...students.map(s => STUDENT_COLUMNS.map(([k, , f]) => k === "last_active" ? s[k] || "" : f(s[k])))]));
    document.querySelector("#exportRaw").onclick = async e => {
      const b = e.currentTarget; b.disabled = true; b.textContent = "匯出中…";
      try {
        const rows = await rpc("class_events", { p_code: teacherAuth.code, p_password: teacherAuth.password });
        const head = ["座號", "關卡", "第幾次挑戰", "教師模式", "結果", "類型", "題號", "學習目標", "題目來源", "首答正確", "作答次數", "選錯的選項", "花費毫秒", "其他", "時間"];
        download(`${cls.name}-原始紀錄.csv`, toCsv([head, ...rows.map(r => [r.seat, r.level, r.attempt_no, r.teacher_mode ? "是" : "否", r.outcome || "未完成", r.kind, r.question_id, r.objective_id, r.source,
          r.first_try === null ? "" : r.first_try ? "是" : "否", r.attempts, (r.wrong_choices || []).map(w => w.text).join("；"), r.duration_ms, JSON.stringify(r.detail || {}), r.created_at])]));
      } catch { toast("匯出失敗，請稍後再試。"); }
      finally { b.disabled = false; b.textContent = "匯出原始紀錄 CSV"; }
    };
  }

  window.GUARDIAN_CLOUD = { enabled, startSession, log, endSession, flush, pending, classLabel, showJoin, showTeacher, _rpc: rpc };
})();
