const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const html = fs.readFileSync(path.join(__dirname, '歷史文物守護行動完整版.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].split('document.querySelector("#largeBtn").onclick=')[0];
assert.match(html, /<script src="cloud-config\.js"><\/script>\s*<script src="cloud-sync\.js"><\/script>/, 'cloud scripts load before the game script');
const config = fs.readFileSync(path.join(__dirname, 'cloud-config.js'), 'utf8');
assert.doesNotMatch(config, /publishableKey: "sb_secret_/, 'cloud-config.js must never contain a secret key');
assert.match(config, /publishableKey: "(sb_publishable_[\w-]*|eyJ[\w.-]*|)"/, 'cloud-config.js only takes a publishable (or legacy anon) key');
const cloudSource = fs.readFileSync(path.join(__dirname, 'cloud-sync.js'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, 'supabase', 'schema.sql'), 'utf8');
assert.match(cloudSource, /id="newQuestionCount"[^>]*min="1"[^>]*max="15"/, 'the create-class page lets teachers choose 1–15 questions');
assert.match(cloudSource, /p_question_count:\s*questionCount/, 'the chosen question count is sent when creating a class');
assert.doesNotMatch(cloudSource, /資料庫還是舊版，題數先使用 15 題/, 'the obsolete yellow database warning is removed');
assert.match(schema, /question_count smallint not null default 15 check \(question_count between 1 and 15\)/, 'the database stores a validated question count');
assert.match(schema, /add column if not exists paused boolean not null default false/, 'classes store the shared pause state');
assert.match(schema, /create or replace function public\.set_class_paused\(p_code text, p_password text, p_paused boolean\)/, 'teachers can update the shared pause state');
assert.match(schema, /'paused', c\.paused/, 'students receive the shared pause state');
assert.match(cloudSource, /setInterval\(\(\) => refreshClass\(\), 3000\)/, 'students poll their class state for teacher pause changes');
assert.match(cloudSource, /rpc\("set_class_paused"/, 'the teacher pause button updates the class state');
assert.match(html, /window\.setClassroomPaused=setClassroomPaused/, 'the game exposes its classroom pause overlay to cloud sync');
assert.match(html, /等待老師恢復後，畫面會自動繼續/, 'students cannot dismiss the pause overlay themselves');
assert.match(html, /if\(document\.querySelector\("\.teacher-pause"\)\)return/, 'answer keyboard shortcuts are disabled while paused');

// 一個寬鬆的假 DOM：沒登記的選擇器都回傳不做事的元素
function element(extra = {}) {
  const classes = new Set();
  return Object.assign({
    textContent: '', innerHTML: '', value: '', disabled: false, dataset: {}, style: { setProperty() {} },
    classList: { add: (...n) => n.forEach(x => classes.add(x)), remove: (...n) => n.forEach(x => classes.delete(x)), toggle() {}, contains: n => classes.has(n) },
    setAttribute() {}, focus() {}, addEventListener() {}, append() {}, appendChild() {}, remove() {}, animate() { return { finished: Promise.resolve(), cancel() {} }; },
    querySelector() { return element(); }, querySelectorAll() { return []; }, closest() { return element(); }, getAnimations() { return []; }, getTotalLength() { return 100; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
  }, extra);
}
let markup = '', answerButtons = [], taskButtons = [];
const registry = {};
const app = element();
Object.defineProperty(app, 'innerHTML', { set(value) {
  markup = value;
  taskButtons = [...value.matchAll(/data-task-answer="(\d)"/g)].map(m => element({ dataset: { taskAnswer: m[1] } }));
  answerButtons = [...value.matchAll(/class="answer" type="button" data-a="(\d)"/g)].map(m => element({ dataset: { a: m[1] } }));
}, get() { return markup; } });
Object.assign(registry, { '#app': app, '#guideBack': element(), '#guideNext': element(), '#taskBack': element(), '#taskStatus': element(), '#status': element() });
const document = {
  querySelector: sel => registry[sel] || element(),
  querySelectorAll: sel => sel === '.answer' ? answerButtons : sel === '[data-task-answer]' ? taskButtons : [],
  createElement: () => element(),
};

function load({ key = 'sb_publishable_test', responses = [] } = {}) {
  const store = new Map(), calls = [];
  const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    const status = responses.length ? responses.shift() : 200;
    return { ok: status < 300, status, text: async () => status < 300 ? '1' : JSON.stringify({ message: 'rejected' }) };
  };
  const context = vm.createContext({
    document, window: { GUARDIAN_CLOUD_CONFIG: { url: 'https://demo.supabase.co/', publishableKey: key } },
    location: { search: '?seed=115' }, localStorage, URLSearchParams, console, Math, Date, JSON, Promise, Set, Map,
    fetch, crypto: webcrypto, atob, setTimeout: fn => (fn(), 0), clearTimeout() {},
  });
  context.window.document = document;
  for (const file of ['question-bank.js', 'curriculum-data.js', 'cloud-sync.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
  vm.runInContext(script, context);
  return { run: code => vm.runInContext(code, context), calls, store };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  // 金鑰檢查：秘密金鑰一律停用
  assert.equal(load({ key: 'sb_secret_abc' }).run('cloud.enabled'), false);
  assert.equal(load({ key: '' }).run('cloud.enabled'), false);

  const setupPage = load();
  setupPage.run('cloud.showTeacher()');
  assert.match(markup, /每關題數[\s\S]*id="newQuestionCount"[\s\S]*min="1"[\s\S]*max="15"/, 'the teacher sees the question-count step on the create-class page');
  assert.match(markup, /敵人血量與守護心會等於題數[\s\S]*道具強度/, 'the create-class page explains synchronized health and item scaling');

  for (let count = 1; count <= 15; count++) {
    const encoded = JSON.parse(setupPage.run(`JSON.stringify(cloud._encodeClassLevels([2, 6], ${count}))`));
    const decoded = JSON.parse(setupPage.run(`JSON.stringify(cloud._decodeClassSettings(${JSON.stringify(encoded)}, null))`));
    assert.deepEqual(decoded, { openLevels: [2, 6], questionCount: count }, `legacy class settings round-trip ${count} questions`);
  }

  const game = load();
  const { run, calls } = game;
  assert.equal(run('cloud.enabled'), true);
  run('animHeroAttack=async()=>{};animFoeAttack=async()=>{};makeAnswerShards=()=>{};showExitTicket=()=>{};showLose=()=>{};');

  // 佇列是空的時候先 flush 一次，之後仍要能正常送出
  await run('cloud.flush()');

  // 沒加入班級時不記錄
  run('cloud.startSession({level:1,unitKey:"5A-U1",teacherMode:false,items:["compass"]});cloud.log("prediction",{detail:{answer:"同意"}})');
  assert.equal(run('cloud.pending()'), 0, 'nothing is queued before joining a class');

  // 加入班級後完整走一場
  run('state.playerName="小安";state.cloudClass={code:"K7QX2M",name:"五年甲班",seat:3};state.level=1;state.entry=2;state.selectedItems=["compass"]');
  assert.equal(run('cloud.classLabel()'), '五年甲班・3 號');
  run('cloud.startSession({level:1,unitKey:activeQuestionKey(),teacherMode:false,items:[...state.selectedItems]})');

  // 課前預測與單元導讀
  run('state.prediction="同意";cloud.log("prediction",{detail:{answer:state.prediction}});state.guideTrack=null;showUnitGuide(0)');
  registry['#guideNext'].onclick();               // 第 2 頁
  registry['#guideBack'].onclick();               // 回到第 1 頁
  const pages = run('levels[0].guide.length');
  for (let p = 0; p < pages; p++) registry['#guideNext'].onclick();

  // 探索驗證：第一個調查點先選錯一次
  run('state.exploreTrack={};showEvidenceTask(0)');
  const wrongTask = taskButtons.find(b => b.dataset.taskAnswer !== '0'), rightTask = taskButtons.find(b => b.dataset.taskAnswer === '0');
  wrongTask.onclick(); wrongTask.onclick();       // 同一個錯誤選項只記一次
  rightTask.onclick();

  // 證據對決：第 1 題先答錯一次，再答對
  run('state.hp=5;state.hpMax=5;state.pendingEvent=null;startBattle()');
  const correct = run('state.deck[0].correct'), wrongChoice = [0, 1, 2, 3].find(i => i !== correct), wrongText = run(`state.deck[0].choices[${wrongChoice}].text`);
  run(`answer(${wrongChoice})`); await tick(); await tick();
  run('useItem("compass")');
  run(`answer(state.deck[0].correct)`);
  await tick();

  // 打倒敵人 → 結束這一場並送出
  run('state.enemy=0;nextTurn()');
  await tick(); await tick();
  assert.equal(calls.length, 1, 'ending the session sends one batch');
  const call = calls[0];
  assert.equal(call.url, 'https://demo.supabase.co/rest/v1/rpc/record_events');
  assert.equal(call.options.headers.apikey, 'sb_publishable_test');
  assert.equal(call.options.headers.Authorization, undefined, 'publishable keys are not sent as a bearer token');
  const { p_code, p_seat, p_session, p_events } = call.body;
  assert.equal(p_code, 'K7QX2M'); assert.equal(p_seat, 3);
  assert.equal(p_session.level, 1); assert.equal(p_session.outcome, 'cleared'); assert.equal(p_session.attempt_no, 1);
  assert.deepEqual(p_session.items, ['compass']); assert.equal(p_session.questions_answered, 1); assert.equal(p_session.hearts_left, run('state.hp'));
  assert.ok(!JSON.stringify(calls).includes('小安'), 'player names are never sent');
  const kinds = p_events.map(e => e.kind);
  assert.deepEqual(kinds, ['prediction', 'guide', 'explore', 'item_use', 'judge']);
  const byKind = Object.fromEntries(p_events.map(e => [e.kind, e]));
  assert.deepEqual(byKind.guide.detail, { pages_viewed: pages, total_pages: pages, back_clicks: 1 });
  assert.equal(byKind.explore.attempts, 2); assert.equal(byKind.explore.first_try, false); assert.equal(byKind.explore.wrong_choices.length, 1);
  assert.equal(byKind.judge.question_id, run('state.deck[0].id'));
  assert.equal(byKind.judge.objective_id, run('state.deck[0].objectiveId'));
  assert.equal(byKind.judge.attempts, 2); assert.equal(byKind.judge.first_try, false);
  assert.deepEqual(byKind.judge.wrong_choices.map(w => w.text), [wrongText]);
  assert.equal(typeof byKind.judge.detail.first_answer_ms, 'number');
  assert.deepEqual(byKind.item_use.detail, { item: 'compass' });
  assert.ok(p_events.every(e => e.client_id && e.created_at && !('session_id' in e)));
  assert.equal(run('cloud.pending()'), 0);

  // 學習單在過關之後送出，仍掛在同一場
  run('cloud.log("exit",{detail:{prediction:"同意",confidence:"大致確定",response:"我認為……",length:5}});cloud.flush()');
  await tick(); await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.p_session.id, p_session.id);
  assert.deepEqual(calls[1].body.p_events.map(e => e.kind), ['exit']);

  // 同一關第二次挑戰，attempt_no 會加一
  run('cloud.startSession({level:1,unitKey:"5A-U1",teacherMode:true,items:[]});cloud.log("prediction",{detail:{answer:"不確定"}});cloud.endSession("defeated",{hearts_left:0})');
  await tick(); await tick();
  assert.equal(calls[2].body.p_session.attempt_no, 2);
  assert.equal(calls[2].body.p_session.teacher_mode, true);

  // 網路錯誤時留在佇列，下次再送；被資料庫拒絕（400）就丟掉
  const flaky = load({ responses: [503, 200] });
  flaky.run('state.cloudClass={code:"K7QX2M",name:"五甲",seat:8};cloud.startSession({level:2,unitKey:"5A-U2",teacherMode:false,items:[]});cloud.log("prediction",{detail:{answer:"同意"}});cloud.endSession("cleared",{hearts_left:5})');
  await tick(); await tick();
  assert.equal(flaky.run('cloud.pending()'), 1, 'a failed send stays queued');
  assert.ok(flaky.store.get('relicGuardian-cloud-queue-v1').includes('"prediction"'), 'the queue survives a reload');
  flaky.run('cloud.flush()'); await tick(); await tick();
  assert.equal(flaky.run('cloud.pending()'), 0);
  assert.equal(flaky.calls[1].body.p_events[0].client_id, flaky.calls[0].body.p_events[0].client_id, 'the retry reuses the same client_id so the database ignores duplicates');

  const rejected = load({ responses: [400] });
  rejected.run('state.cloudClass={code:"K7QX2M",name:"五甲",seat:9};cloud.startSession({level:3,unitKey:"5A-U3",teacherMode:false,items:[]});cloud.log("prediction",{detail:{answer:"同意"}});cloud.endSession("cleared",{})');
  await tick(); await tick();
  assert.equal(rejected.run('cloud.pending()'), 0, 'rejected batches are dropped instead of retried forever');

  // 加入班級後只能玩老師指定的關卡，故事模式原本解鎖的第一關也必須鎖住
  const mapNodes = () => Object.fromEntries([...markup.matchAll(/<button class="map-level pos-(\d) [^"]*" data-level="\d" (disabled)?[^>]*>[\s\S]*?<small>([^<]*)<\/small>/g)].map(m => [+m[1], { locked: !!m[2], status: m[3] }]));
  const classGame = load();
  classGame.run('state.playerName="小安";state.unlocked=1;state.done=new Set();state.cloudClass={code:"K7QX2M",name:"五年甲班",seat:3,openLevels:[5,7]};showMap()');
  let nodes = mapNodes();
  assert.equal(nodes[1].locked, true, 'the default first story level is locked unless the teacher opens it');
  assert.equal(nodes[2].locked, true, 'levels the teacher did not open stay locked in class mode');
  assert.deepEqual([nodes[5].locked, nodes[5].status], [false, '下一站'], 'the next-step marker moves to the first level the teacher opened');
  assert.match(markup, /map-next[\s\S]*?第 5 關/);
  assert.deepEqual([nodes[7].locked, nodes[7].status], [false, '老師開放']);
  assert.match(markup, /class-open-note[\s\S]*第 5 關[\s\S]*第 7 關[\s\S]*只有這些關卡可以進入/);
  // 跳關完成老師開放的關卡，不會順便解鎖中間的關卡，也不會提早出現結局
  classGame.run('state.level=5;showReward()');
  assert.equal(classGame.run('state.unlocked'), 1);
  assert.equal(classGame.run('state.done.has(5)'), true);
  assert.match(markup, /回到行動地圖/);
  classGame.run('state.level=1;showReward()');
  assert.equal(classGame.run('state.unlocked'), 2, 'finishing a level in story order still unlocks the next one');
  classGame.run('showMap()');
  nodes = mapNodes();
  assert.equal(nodes[2].locked, true, 'story progress never opens an unassigned class level');
  classGame.run('state.cloudClass.openLevels=[8];state.level=8;showReward()');
  assert.doesNotMatch(markup, /觀看守護行動結局/, 'the ending only appears after all eight artifacts are restored');
  classGame.run('state.cloudClass.openLevels=[];showMap()');
  nodes = mapNodes();
  assert.equal(Object.values(nodes).every(node => node.locked), true, 'an empty teacher assignment locks every level');
  assert.match(markup, /目前沒有開放關卡[\s\S]*等待老師開放/);
  classGame.run('state.level=8;prepare(1)');
  assert.equal(classGame.run('state.level'), 8, 'prepare cannot bypass the teacher assignment');
  // 沒加入班級時照一般模式
  classGame.run('state.cloudClass=null;state.unlocked=1;showMap()');
  nodes = mapNodes();
  assert.equal(nodes[5].locked, true);

  console.log('Cloud logging: session flow, event fields, retries, key checks and teacher-only class levels passed');
})().catch(error => { console.error(error); process.exit(1); });
