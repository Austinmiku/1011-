const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '歷史文物守護行動完整版.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].split('document.querySelector("#largeBtn").onclick=')[0];
let stored = '{}';
const document = { querySelector(selector) { return selector === '#app' ? { focus() {} } : null; } };
const localStorage = {
  getItem() { return stored; },
  setItem(_key, value) { stored = value; },
};
const context = vm.createContext({ document, window: {}, location: { search: '' }, localStorage, URLSearchParams, console, Math });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'question-bank.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'curriculum-data.js'), 'utf8'), context);
vm.runInContext(script, context);
vm.runInContext('renderBattle=()=>{};makeDeck=()=>[];state.unlocked=3;state.level=3;state.hp=2;state.pendingEvent=null;startBattle()', context);
assert.equal(vm.runInContext('state.hp', context), 2);
assert.equal(vm.runInContext('state.hpMax', context), 5);
vm.runInContext('state.pendingEvent={level:3,effect:{heal:1}};startBattle()', context);
assert.equal(vm.runInContext('state.hp', context), 3);
assert.equal(vm.runInContext('state.pendingEvent', context), null);
vm.runInContext('startBattle()', context);
assert.equal(vm.runInContext('state.hp', context), 3);
assert.equal(JSON.parse(stored).hp, 3);
assert.deepEqual(Array.from(vm.runInContext('[kitHeal(1),kitHeal(4),kitHeal(7)]', context)), [1, 1, 1]);
assert.equal(vm.runInContext('itemEffect("kit",8)', context), '回復 1 顆守護心。');
vm.runInContext('state.teacherMode=true;state.hp=1;state.pendingEvent=null;startBattle()', context);
assert.equal(vm.runInContext('state.hp', context), 5);
assert.equal(vm.runInContext('state.hpMax', context), 5);
vm.runInContext('state.teacherMode=false', context);
console.log('Persistent guardian hearts passed');

vm.runInContext('let mapVisits=0,exits=0;showMap=()=>mapVisits++;showExitTicket=()=>exits++;state.enemy=1;state.hp=0;nextTurn()', context);
assert.equal(vm.runInContext('mapVisits', context), 1);
assert.equal(vm.runInContext('state.hp', context), 0);
vm.runInContext('state.hp=2;state.qi=0;state.deck=[];nextTurn()', context);
assert.equal(vm.runInContext('mapVisits', context), 2);
vm.runInContext('state.enemy=0;nextTurn()', context);
assert.equal(vm.runInContext('exits', context), 1);
console.log('Battle defeat returns directly to map; victory opens the exit ticket');
