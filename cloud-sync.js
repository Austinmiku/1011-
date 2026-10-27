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

  // 資料庫還沒更新到新版 schema 時，新函式不存在，PostgREST 回 404
  const missingFunction = err => err && err.status === 404;
  const cleanLevels = list => [...new Set((Array.isArray(list) ? list : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 20))].sort((a, b) => a - b);
  const cleanQuestionCount = value => { const count = Number(value); return Number.isInteger(count) && count >= 1 && count <= 15 ? count : 15; };
  /* 舊版資料庫沒有 question_count 欄位，但 open_levels 可保存 1–20。
     以不會用到的 9–12 與 20 當作題數標記，讓舊版也能在不同裝置保存 1–15 題；
     對遊戲與教師頁顯示時一律解碼，只留下真正的第 1–8 關。 */
  const QUESTION_COUNT_MARKER = 20, QUESTION_COUNT_BITS = [9, 10, 11, 12];
  const encodeClassLevels = (levels, questionCount) => {
    const bits = cleanQuestionCount(questionCount) - 1;
    return [...cleanLevels(levels).filter(n => n <= 8), ...QUESTION_COUNT_BITS.filter((_, i) => bits & (1 << i)), QUESTION_COUNT_MARKER].sort((a, b) => a - b);
  };
  const decodeClassSettings = (levels, explicitQuestionCount) => {
    const stored = cleanLevels(levels), explicit = Number(explicitQuestionCount);
    const encoded = stored.includes(QUESTION_COUNT_MARKER)
      ? 1 + QUESTION_COUNT_BITS.reduce((total, value, i) => total + (stored.includes(value) ? (1 << i) : 0), 0)
      : 15;
    return {
      openLevels: stored.filter(n => n <= 8),
      questionCount: Number.isInteger(explicit) && explicit >= 1 && explicit <= 15 ? explicit : cleanQuestionCount(encoded),
    };
  };
  async function classInfo(code) {
    try {
      const info = await rpc("class_info", { p_code: code });
      if (!info) return null;
      const settings = decodeClassSettings(info.open_levels, info.question_count);
      return { name: info.name, ...settings };
    } catch (err) {
      if (!missingFunction(err)) throw err;
      const name = await rpc("check_class", { p_code: code });
      return name ? { name, openLevels: [], questionCount: 15 } : null;
    }
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
    setTimeout(() => refreshClass(), 1500);
  }
  /* 老師可能改了開放的關卡：開遊戲時重新讀一次，地圖正開著就重畫 */
  async function refreshClass() {
    const m = member();
    if (!enabled || !m) return;
    try {
      const info = await classInfo(m.code);
      if (!info) return;
      const changed = info.name !== m.name || String(info.openLevels) !== String(m.openLevels || []) || info.questionCount !== cleanQuestionCount(m.questionCount);
      state.cloudClass = { ...m, name: info.name, openLevels: info.openLevels, questionCount: info.questionCount };
      save();
      if (changed && document.querySelector(".adventure-map")) showMap();
    } catch { /* 離線時沿用上次的設定 */ }
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
        const info = await classInfo(code);
        if (!info) { error.textContent = "找不到這個班級代碼，請再跟老師確認。"; return; }
        state.cloudClass = { code, name: info.name, seat, openLevels: info.openLevels, questionCount: info.questionCount }; save();
        toast(info.openLevels.length ? `已加入 ${info.name}・${seat} 號，每關作答 ${info.questionCount} 題` : `已加入 ${info.name}・${seat} 號`);
        back();
      } catch { error.textContent = "目前連不上雲端，請檢查網路後再試一次。"; }
      finally { if (go.isConnected) { go.disabled = false; go.textContent = "加入班級"; } }
    };
    codeInput.focus();
  }

  /* ===== 教師：開放關卡的勾選元件 ===== */
  function levelPicker(id, selected) {
    const chosen = new Set(selected || []);
    return `<div class="level-picker-tools"><button class="link-button" type="button" data-pick-all="${id}">全選</button><button class="link-button" type="button" data-pick-none="${id}">全部取消</button></div>
      <div class="level-picker" id="${id}">${["五上", "五下"].map(term => `<fieldset><legend>${term}</legend>${levels.map((l, i) => ({ l, n: i + 1, unit: curriculum.units[i] })).filter(x => x.unit && x.unit.term === term).map(x => `<label><input type="checkbox" data-class-level value="${x.n}"${chosen.has(x.n) ? " checked" : ""}>第 ${x.n} 關・${esc(x.l.title)}</label>`).join("")}</fieldset>`).join("")}</div>`;
  }
  const pickedLevels = id => [...document.querySelectorAll(`#${id} [data-class-level]:checked`)].map(x => Number(x.value));
  function bindPicker(id) {
    const all = document.querySelector(`[data-pick-all="${id}"]`), none = document.querySelector(`[data-pick-none="${id}"]`);
    const set = on => document.querySelectorAll(`#${id} [data-class-level]`).forEach(x => { x.checked = on; });
    if (all) all.onclick = () => set(true);
    if (none) none.onclick = () => set(false);
  }
  const levelList = list => list.length ? list.map(n => `第 ${n} 關`).join("、") : "沒有（學生照一般模式一關一關解鎖）";

  /* ===== 教師：建立班級與查閱作答 ===== */
  let teacherAuth = null; // { code, password }：只放在記憶體，重新整理頁面後要重新輸入
  function showTeacher() {
    if (!enabled) {
      render(`<section class="screen cloud-screen"><div class="eyebrow">教師模式・雲端班級</div><h2>還沒有設定雲端資料庫</h2><p>要記錄學生作答，請先依 README「雲端作答紀錄」建立 Supabase 專案，並在 <code>cloud-config.js</code> 填入網址與 publishable key。</p><button class="secondary" id="cloudBack">返回教師模式</button></section>`);
      document.querySelector("#cloudBack").onclick = showTeacherMode;
      return;
    }
    render(`<section class="screen cloud-screen teacher-screen create-class"><div class="eyebrow">教師模式・雲端班級</div><h2>建立班級，查看學生作答</h2>
      <p class="create-intro">建立班級後會得到 6 碼班級代碼。學生在遊戲首頁或任務地圖按「加入班級」，輸入代碼和座號，作答就會記錄到這個班級。</p>
      <form class="create-class-form" id="createForm" novalidate>
        <section class="teacher-step create-step"><h3><span class="num">1</span><label for="newName">班級名稱</label></h3>
          <input class="name-input" id="newName" maxlength="40" placeholder="例如 範例國小 101班"></section>
        <section class="teacher-step create-step levels-step"><h3><span class="num">2</span>開放給學生的關卡<small>可複選</small></h3>
          <p class="learn-note">勾選這陣子上課會用到的關卡，學生不用先破前面的關卡就能直接玩。之後也可以在全班分析頁的「班級設定」修改。</p>
          ${levelPicker("newLevels", [])}
          <p class="picked-summary" id="pickedSummary" role="status" aria-live="polite"></p></section>
        <section class="teacher-step create-step"><h3><span class="num">3</span><label for="newQuestionCount">每關題數</label></h3>
          <p class="learn-note">可從每個單元的 15 題題庫中隨機抽取 1～15 題，不會重複。敵人血量與守護心會等於題數；道具強度會依題數分成 1、2、3 階。</p>
          <input class="name-input" id="newQuestionCount" type="number" inputmode="numeric" min="1" max="15" value="15" aria-describedby="questionCountSummary">
          <p class="picked-summary" id="questionCountSummary" role="status" aria-live="polite"></p></section>
        <section class="teacher-step create-step"><h3><span class="num">4</span>管理密碼</h3>
          <p class="learn-note">查看全班作答、修改開放關卡時要輸入。請自行保存，遺失後無法查回。</p>
          <div class="password-pair"><label for="newPass">管理密碼（至少 6 個字）<input class="name-input" id="newPass" type="password" autocomplete="new-password"></label><label for="newPass2">再輸入一次<input class="name-input" id="newPass2" type="password" autocomplete="new-password"></label></div></section>
        <p class="name-error" id="createError" role="alert" aria-live="polite"></p>
        <button class="primary create-go" type="submit" id="createGo">建立班級</button>
      </form>
      <div id="createResult"></div>
      <p class="learn-note">已經有班級了嗎？回到教師課堂模式，在「全班作答分析」輸入班級代碼與管理密碼，就能查看學生作答。資料只有座號與作答內容，不含學生姓名。</p>
      <button class="secondary" id="cloudBack">返回教師課堂模式</button></section>`);
    document.querySelector("#cloudBack").onclick = showTeacherMode;
    bindPicker("newLevels");
    const form = document.querySelector("#createForm"), summary = document.querySelector("#pickedSummary"), countInput = document.querySelector("#newQuestionCount"), countSummary = document.querySelector("#questionCountSummary");
    const showPicked = () => { const list = pickedLevels("newLevels"); summary.textContent = list.length ? `已選 ${list.length} 關：${levelList(list)}` : "還沒有勾選：學生照一般模式一關一關解鎖。"; };
    const showCount = () => { const count = Number(countInput.value), valid = Number.isInteger(count) && count >= 1 && count <= 15, scale = valid ? Math.ceil(count / 5) : 0; countSummary.textContent = valid ? `每關隨機 ${count} 題・敵人與守護心 ${count} 點・道具強度第 ${scale} 階` : "請輸入 1～15 的整數。"; };
    form.addEventListener("change", e => { if (e.target.matches("[data-class-level]")) showPicked(); });
    form.addEventListener("click", e => { if (e.target.matches("[data-pick-all],[data-pick-none]")) setTimeout(showPicked); });
    showPicked();
    countInput.addEventListener("input", showCount); showCount();
    form.onsubmit = async e => {
      e.preventDefault();
      const name = document.querySelector("#newName").value.trim(), questionCount = Number(countInput.value), pass = document.querySelector("#newPass").value, pass2 = document.querySelector("#newPass2").value, error = document.querySelector("#createError"), go = document.querySelector("#createGo");
      if (!name) { error.textContent = "請輸入班級名稱。"; document.querySelector("#newName").focus(); return; }
      if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 15) { error.textContent = "每關題數請輸入 1 到 15 的整數。"; countInput.focus(); return; }
      if (pass.length < 6) { error.textContent = "管理密碼至少要 6 個字。"; document.querySelector("#newPass").focus(); return; }
      if (pass !== pass2) { error.textContent = "兩次輸入的管理密碼不一樣。"; document.querySelector("#newPass2").focus(); return; }
      go.disabled = true; go.textContent = "建立中…"; error.textContent = "";
      try {
        const open = pickedLevels("newLevels"), storedLevels = encodeClassLevels(open, questionCount);
        let rows, schemaVersion = 4;
        try { rows = await rpc("create_class", { p_name: name, p_password: pass, p_open_levels: storedLevels, p_question_count: questionCount }); }
        catch (err) {
          if (!missingFunction(err)) throw err;
          schemaVersion = 3;
          try { rows = await rpc("create_class", { p_name: name, p_password: pass, p_open_levels: storedLevels }); }
          catch (legacyErr) { if (!missingFunction(legacyErr)) throw legacyErr; schemaVersion = 2; rows = await rpc("create_class", { p_name: name, p_password: pass }); }
        }
        const made = Array.isArray(rows) ? rows[0] : rows, settings = schemaVersion === 2 ? { openLevels: [], questionCount: 15 } : decodeClassSettings(made.open_levels || storedLevels, made.question_count), saved = settings.openLevels, savedQuestionCount = settings.questionCount;
        write(TEACHER_CODE_KEY, made.code);
        teacherAuth = { code: made.code, password: pass };
        form.hidden = true;
        const result = document.querySelector("#createResult");
        result.innerHTML = `<div class="cloud-code" role="status"><small>${esc(made.name)} 的班級代碼</small><b>${esc(made.code)}</b><span>請寫在黑板上，讓學生按「加入班級」輸入。</span><span>開放的關卡：${levelList(saved)}</span><span>每關題數：${savedQuestionCount} 題</span><div class="row"><button class="secondary" type="button" id="createAnother">再建立一個班級</button><button class="primary" type="button" id="openNew">查看這個班級的作答紀錄</button></div></div>`;
        result.scrollIntoView?.({ block: "center" });
        document.querySelector("#openNew").onclick = () => showReport();
        document.querySelector("#createAnother").onclick = showTeacher;
      } catch (err) { error.textContent = `建立失敗：${err.message === "password_too_short" ? "管理密碼太短。" : "目前連不上雲端，請稍後再試。"}`; }
      finally { go.disabled = false; go.textContent = "建立班級"; }
    };
  }

  /* 教師模式首頁的「查看全班分析」直接呼叫這裡；錯誤訊息由呼叫端顯示 */
  async function openReport(code, password) {
    code = String(code || "").trim().toUpperCase();
    if (!enabled) throw new Error("cloud_disabled");
    if (!CODE_PATTERN.test(code) || !password) throw new Error("invalid_input");
    const report = await rpc("class_report", { p_code: code, p_password: password, p_level: null });
    teacherAuth = { code, password };
    write(TEACHER_CODE_KEY, code);
    renderReport(report, null);
  }
  const lastTeacherCode = () => read(TEACHER_CODE_KEY, "") || "";

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
    ["guide_read_rate", "導讀閱讀率", pct], ["exits", "學習單", v => v], ["last_active", "最後作答", when],
  ];

  /* 報表最上方的分析重點：全班表現、需要關心的學生、最需要補強的目標、最多人選錯的選項 */
  function insights(students, objectives, wrongs) {
    const judged = students.reduce((sum, s) => sum + (s.judged || 0), 0);
    const classRate = judged ? Math.round(students.reduce((sum, s) => sum + (Number(s.judge_first_rate) || 0) * (s.judged || 0), 0) / judged) : null;
    const attention = students.map(s => {
      const reasons = [];
      if (s.judged >= 3 && Number(s.judge_first_rate) < 60) reasons.push(`首答正確率 ${s.judge_first_rate}%`);
      if (s.quick_wrong >= 3) reasons.push(`快速答錯 ${s.quick_wrong} 題`);
      if (s.unfinished >= 2) reasons.push(`未完成 ${s.unfinished} 場`);
      if (s.defeats >= 2) reasons.push(`失敗 ${s.defeats} 場`);
      return { seat: s.seat, reasons };
    }).filter(x => x.reasons.length);
    const weakest = objectives.find(o => o.first_rate !== null && Number(o.first_rate) < 80);
    const topWrong = wrongs[0];
    return `<section class="cloud-section cloud-insights"><h3>分析重點</h3><div class="insight-grid">
      <article><small>全班首答正確率</small><b${low(classRate)}>${pct(classRate)}</b><span>共 ${students.length} 位學生、${judged} 題作答・完成 ${students.reduce((sum, s) => sum + (s.levels_cleared || 0), 0)} 個關卡</span></article>
      <article><small>需要關心的學生</small>${attention.length ? `<ul>${attention.slice(0, 8).map(a => `<li><b>${a.seat} 號</b>：${esc(a.reasons.join("、"))}</li>`).join("")}</ul>${attention.length > 8 ? `<span>另有 ${attention.length - 8} 位，請看下方學生總覽</span>` : ""}` : "<span>目前沒有特別需要關心的學生。</span>"}</article>
      <article><small>最需要補強</small>${weakest ? `<b>${esc(objectiveName(weakest.objective_id))}</b><span>首答正確率 ${pct(weakest.first_rate)}（${weakest.students} 人作答）</span>` : "<span>各單元首答正確率都在 80% 以上。</span>"}</article>
      <article><small>最多人選錯</small>${topWrong ? `<b>「${esc(topWrong.choice)}」</b><span>${esc(questionText(topWrong.question_id))}<br>${topWrong.students} 人選過、共 ${topWrong.times} 次</span>` : "<span>還沒有答錯紀錄。</span>"}</article>
    </div><p class="learn-note">「需要關心」的條件：作答 3 題以上且首答正確率低於 60%、快速答錯 3 題以上、未完成或失敗 2 場以上。</p></section>`;
  }

  function renderReport(report, level) {
    const students = report.students || [], objectives = report.objectives || [], wrongs = report.wrong_choices || [], exits = report.exits || [];
    const cls = report.class || { name: "", code: teacherAuth.code };
    const classSettings = decodeClassSettings(cls.open_levels, cls.question_count);
    render(`<section class="screen cloud-screen cloud-report"><div class="eyebrow">教師模式・雲端作答紀錄</div><h2>${esc(cls.name)}<small>班級代碼 ${esc(cls.code)}</small></h2>
      <details class="class-settings no-print"${classSettings.openLevels.length ? "" : " open"}><summary><b>班級設定</b>　每關 ${classSettings.questionCount} 題・開放：${esc(levelList(classSettings.openLevels))}</summary>
        <p class="learn-note">勾選的關卡，加入這個班級的學生可以直接遊玩，不用先破前面的關卡。學生下次打開遊戲就會更新。</p>
        ${levelPicker("classLevels", classSettings.openLevels)}
        <div class="row"><button class="primary" type="button" id="saveLevels">儲存開放的關卡</button><span class="status-inline" id="levelsStatus" role="status" aria-live="polite"></span></div></details>
      <div class="cloud-toolbar no-print"><label for="levelFilter">查看範圍</label><select id="levelFilter"><option value="">全部關卡</option>${levels.map((l, i) => `<option value="${i + 1}"${level === i + 1 ? " selected" : ""}>${esc(levelName(i + 1))}</option>`).join("")}</select>
        <button class="secondary" id="reportRefresh">重新整理</button><button class="secondary" id="exportStudents">匯出學生總覽 CSV</button><button class="secondary" id="exportRaw">匯出原始紀錄 CSV</button><button class="secondary" id="reportPrint">列印</button></div>
      ${students.length ? "" : `<p class="summary-empty">這個範圍還沒有作答紀錄。學生要先按「加入班級」並完成任務，紀錄才會出現。</p>`}
      ${students.length ? insights(students, objectives, wrongs) : ""}
      ${students.length ? `<section class="cloud-section"><h3>學生總覽（${students.length} 人）</h3><div class="table-scroll"><table class="cloud-table"><thead><tr>${STUDENT_COLUMNS.map(c => `<th>${c[1]}</th>`).join("")}</tr></thead><tbody>${students.map(s => `<tr>${STUDENT_COLUMNS.map(([k, , f]) => `<td${/rate/.test(k) ? low(s[k]) : ""}>${esc(f(s[k]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
        <details class="cloud-legend"><summary>指標說明</summary><dl>
          <dt>首答正確率</dt><dd>證據對決中第一次就判斷正確的比例，最能反映真正的理解。</dd>
          <dt>平均作答秒數</dt><dd>從題目出現到判斷正確所花的時間。</dd>
          <dt>快速答錯</dt><dd>4 秒內就作答且答錯的題數，可能是沒讀題就猜。</dd>
          <dt>探索平均錯次</dt><dd>每個調查點答對前平均選錯幾次，反映讀資料、找線索的能力。</dd>
          <dt>提示道具</dt><dd>使用航海羅盤排除錯誤選項的次數。</dd>
          <dt>導讀閱讀率</dt><dd>單元導讀實際翻過的頁數比例。</dd>
          <dt>未完成</dt><dd>出發後沒有打到過關或失敗就離開的場次。</dd>
        </dl><p>低於 60% 的比例會以紅色標示。</p></details></section>` : ""}
      ${objectives.length ? `<section class="cloud-section"><h3>學習目標掌握度</h3><p>依首答正確率由低到高排列，排在前面的目標適合優先補強。（目前題庫每個單元只有一個學習目標代碼，所以這裡是以單元為單位；題庫補上更細的目標後會自動分開。）</p><div class="table-scroll"><table class="cloud-table"><thead><tr><th>學習目標</th><th>作答題數</th><th>作答人數</th><th>首答正確率</th></tr></thead><tbody>${objectives.map(o => `<tr><td>${esc(objectiveName(o.objective_id))}</td><td>${o.answered}</td><td>${o.students}</td><td${low(o.first_rate)}>${pct(o.first_rate)}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      ${wrongs.length ? `<section class="cloud-section"><h3>常選錯的選項</h3><div class="table-scroll"><table class="cloud-table"><thead><tr><th>題目</th><th>選錯的選項</th><th>次數</th><th>人數</th></tr></thead><tbody>${wrongs.map(w => `<tr><td><small>${esc(levelName(w.level))}</small><br>${esc(questionText(w.question_id))}</td><td>${esc(w.choice)}</td><td>${w.times}</td><td>${w.students}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      ${exits.length ? `<section class="cloud-section"><h3>區域學習單（${exits.length} 份）</h3><div class="summary-list">${exits.map(x => `<article class="summary-entry"><div class="meta"><span>${x.seat} 號</span><span>${esc(levelName(x.level))}</span><span>課前：${esc(x.prediction || "未作答")}</span><span>確定程度：${esc(x.confidence || "—")}</span><span>${when(x.created_at)}</span></div>${esc(x.response || "")}</article>`).join("")}</div></section>` : ""}
      <div class="row no-print" style="margin-top:18px"><button class="secondary" id="cloudBack">返回教師課堂模式</button><button class="secondary" id="cloudManage">建立新班級</button></div></section>`);
    document.querySelector("#cloudBack").onclick = showTeacherMode;
    document.querySelector("#cloudManage").onclick = showTeacher;
    document.querySelector("#reportRefresh").onclick = () => showReport(level);
    bindPicker("classLevels");
    document.querySelector("#saveLevels").onclick = async e => {
      const b = e.currentTarget, status = document.querySelector("#levelsStatus");
      b.disabled = true; status.textContent = "儲存中…";
      try {
        const stored = await rpc("set_class_levels", { p_code: teacherAuth.code, p_password: teacherAuth.password, p_levels: encodeClassLevels(pickedLevels("classLevels"), classSettings.questionCount) });
        const saved = decodeClassSettings(stored, cls.question_count).openLevels;
        status.textContent = `已儲存：${levelList(saved)}`;
        const summary = document.querySelector(".class-settings summary");
        if (summary) summary.innerHTML = `<b>班級設定</b>　每關 ${classSettings.questionCount} 題・開放：${esc(levelList(saved))}`;
      } catch (err) { status.textContent = missingFunction(err) ? "資料庫還是舊版，請在 Supabase 重新執行 supabase/schema.sql。" : "儲存失敗，請稍後再試。"; }
      finally { b.disabled = false; }
    };
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

  window.GUARDIAN_CLOUD = { enabled, startSession, log, endSession, flush, pending, classLabel, showJoin, showTeacher, openReport, lastTeacherCode, refreshClass, _rpc: rpc, _encodeClassLevels: encodeClassLevels, _decodeClassSettings: decodeClassSettings };
})();
