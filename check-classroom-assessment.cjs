const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '歷史文物守護行動完整版.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].split('document.querySelector("#largeBtn").onclick=')[0];
const status = { hidden: true, textContent: '' };
const buttons = Array.from({ length: 4 }, (_, index) => ({
  dataset: { a: String(index) }, disabled: false, style: { setProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  querySelector() { return { textContent: '' }; },
}));
const app = { focus() {} }, progress = { setAttribute() {} };
const document = {
  querySelector(selector) { return { '#app': app, '#progress': progress, '#status': status }[selector] || null; },
  querySelectorAll(selector) { return selector === '.answer' ? buttons : []; },
};
const context = vm.createContext({
  document, window: {}, location: { search: '?seed=115' },
  localStorage: { getItem() { return '{}'; }, setItem() {} },
  URLSearchParams, console, Math, Date, JSON, Promise, Set, Map, setTimeout,
});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'question-bank.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'curriculum-data.js'), 'utf8'), context);
vm.runInContext(script, context);

assert.equal(vm.runInContext('state.cloudClass=null;questionsForLevel()', context), 10);
assert.deepEqual(JSON.parse(vm.runInContext('state.cloudClass={code:"K7QX2M",seat:3,openLevels:[1]};JSON.stringify(battleRulesForLevel(1))', context)), {
  name: '完整評量', enemy: 15, attack: 1, hearts: 15,
});
assert.equal(vm.runInContext('questionsForLevel()', context), 15);
assert.equal(vm.runInContext('state.level=1;state.entry=1;makeDeck().length', context), 15);
assert.equal(vm.runInContext('new Set(makeDeck().map(q=>q.id)).size', context), 15);
assert.equal(vm.runInContext('kitHeal()', context), 3);
assert.equal(vm.runInContext('itemUseLimit("compass")', context), 3);
assert.equal(vm.runInContext('itemUseLimit("kit")', context), 1);
assert.match(vm.runInContext('itemEffect("sand")', context), /抵擋 3 次/);
assert.match(vm.runInContext('itemEffect("stamp")', context), /3 次答對/);

vm.runInContext('renderBattle=()=>{};state.pendingEvent=null;state.selectedItems=[];startBattle()', context);
assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify([state.deck.length,state.enemy,state.enemyMax,state.hp,state.hpMax])', context)), [15, 15, 15, 15, 15]);

const perfect = vm.runInContext('state.deck=Array(15).fill({});state.hp=15;state.hpMax=15;state.battleStats={correct:15,firstCorrect:15,wrong:0,firstMs:Array(15).fill(9000),supports:0};learningScore().score', context);
const supported = vm.runInContext('state.battleStats.supports=3;learningScore().score', context);
const developing = vm.runInContext('state.hp=8;state.battleStats={correct:15,firstCorrect:9,wrong:8,firstMs:Array(15).fill(22000),supports:2};learningScore().score', context);
assert.equal(perfect, 100);
assert.equal(supported, perfect, 'learning support is reported but never subtracts earned points');
assert.ok(developing > 0 && developing < perfect);
assert.match(html, /答錯與學習支援只提供學習參考，不會扣除已獲得的分數/);

vm.runInContext(`
  lockBattleItems=()=>{};makeAnswerShards=()=>{};animFoeAttack=async()=>{};renderBattle=()=>{};
  state.deck=[{id:"Q1",choices:[{text:"錯",feedback:"再想想",misconception:"迷思",correct:false},{text:"對",feedback:"答對",misconception:"",correct:true}],correct:1}];
  state.qi=0;state.qTrack={qi:0,start:Date.now(),firstMs:null,wrong:[]};state.busy=false;state.hp=1;state.hpMax=15;state.enemyAttack=1;state.shield=0;state.revive=0;state.damageReduction=0;state.battleStats={correct:0,firstCorrect:0,wrong:0,firstMs:[],supports:0};
  answer(0);
`, context);
setImmediate(() => {
  assert.equal(vm.runInContext('state.hp', context), 5);
  assert.equal(vm.runInContext('state.battleStats.wrong', context), 1);
  assert.equal(vm.runInContext('state.battleStats.supports', context), 1);
  console.log('Classroom 15-question assessment, scaled items, learning support and additive score passed');
});
