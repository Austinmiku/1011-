const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const html = fs.readFileSync(path.join(__dirname, '歷史文物守護行動完整版.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].split('document.querySelector("#largeBtn").onclick=')[0];
assert.match(html, /<script src="cloud-config\.js"><\/script>\s*<script src="cloud-sync\.js"><\/script>/, 'cloud scripts load before the game script');
const config = fs.readFileSync(path.join(__dirname, 'cloud-config.js'), 'utf8');
assert.match(config, /url: "",\s*publishableKey: ""/, 'the committed config must stay empty');

// 一個寬鬆的假 DOM：沒登記的選擇器都回傳不做事的元素
function element(extra = {}) {
  const classes = new Set();
  return Object.assign({
    textContent: '', innerHTML: '', value: '', disabled: false, dataset: {}, style: { setProperty() {} },
    classList: { add: (...n) => n.forEach(x => classes.add(x)), remove: (...n) => n.forEach(x => classes.delete(x)), toggle() {}, contains: n => classes.has(n) },
    setAttribute() {}, focus() {}, append() {}, appendChild() {}, remove() {}, animate() { return { finished: Promise.resolve(), cancel() {} }; },
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
  run('state.playerName="小安";state.cloudClass={code:"K7QX2M",name:"五年甲班",seat:3};state.level=1;state.entry=2;state.selectedItems=["lens"]');
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
  run('useItem("lens")');
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
  assert.deepEqual(p_session.items, ['lens']); assert.equal(p_session.questions_answered, 1); assert.equal(p_session.hearts_left, run('state.hp'));
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
  assert.deepEqual(byKind.item_use.detail, { item: 'lens' });
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

  console.log('Cloud logging: session flow, event fields, retries and key checks passed');
})().catch(error => { console.error(error); process.exit(1); });
