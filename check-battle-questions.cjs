const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '歷史文物守護行動完整版.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].split('document.querySelector("#largeBtn").onclick=')[0];
const app = { focus() {} };
const progress = { setAttribute() {} };
const document = {
  querySelector(selector) { return { '#app': app, '#progress': progress }[selector] || null; },
  querySelectorAll() { return []; },
};
const context = vm.createContext({
  document,
  window: {},
  location: { search: '?seed=115' },
  localStorage: { getItem() { return '{}'; }, setItem() {} },
  URLSearchParams,
  console,
  Math,
});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'question-bank.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'curriculum-data.js'), 'utf8'), context);
vm.runInContext(script, context);

function optionSimilarity(left, right) {
  const pairs = value => new Set([...value].slice(0, -1).map((char, index) => char + value[index + 1]));
  const a = pairs(left), b = pairs(right);
  const shared = [...a].filter(pair => b.has(pair)).length;
  return shared / (a.size + b.size - shared || 1);
}

assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(difficulties.map(d=>[d.enemy,d.attack,d.hearts]))', context)), Array(8).fill(null).map(() => [5, 1, 5]));
assert.equal(vm.runInContext('questionsForLevel(8)', context), 10);
assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(ITEM_EFFECTS)', context)), {
  compass: { removeWrong: 1 }, lens: { hint: true }, kit: { heal: 1 }, sand: { shield: 1 }, stamp: { healOnCorrect: 1 },
});
for (const id of ['compass', 'lens', 'kit', 'sand', 'stamp']) {
  assert.equal(vm.runInContext(`itemEffect("${id}",1)`, context), vm.runInContext(`itemEffect("${id}",8)`, context), `${id} must not scale with level`);
}
assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(loadoutItems.map(item=>item.id))', context)), ['compass', 'lens', 'kit', 'sand']);
assert.deepEqual(JSON.parse(vm.runInContext('state.teacherMode=true;state.unlocked=1;JSON.stringify(availableLoadoutItems().map(item=>item.id))', context)), ['compass', 'lens', 'kit', 'sand']);
assert.deepEqual(JSON.parse(vm.runInContext('state.teacherMode=false;state.unlocked=1;JSON.stringify(availableLoadoutItems().map(item=>item.id))', context)), ['compass', 'kit']);
assert.deepEqual(JSON.parse(vm.runInContext('state.teacherMode=false;state.unlocked=2;JSON.stringify(availableLoadoutItems().map(item=>item.id))', context)), ['compass', 'lens', 'kit']);
assert.deepEqual(JSON.parse(vm.runInContext('state.teacherMode=false;state.unlocked=5;JSON.stringify(availableLoadoutItems().map(item=>item.id))', context)), ['compass', 'lens', 'kit', 'sand']);
assert.equal(vm.runInContext('state.teacherMode=true;state.level=8;loadoutLimit()', context), 1);
assert.equal(vm.runInContext('state.teacherMode=false;state.level=8;loadoutLimit()', context), 1);
assert.doesNotMatch(html, /enemyDamage:|bonusDamage:/, 'events must not shorten the five-correct-answer threshold');
assert.match(html, /\.bt-msgrow\.reason-active\{display:grid/, 'evidence feedback must use a horizontal row above the panel');
assert.match(html, /row\.classList\.add\("reason-active"\)/, 'evidence step must activate the horizontal layout');
for (let level = 1; level <= 8; level++) {
  const observedCorrectPositions = new Set();
  for (let entry = 1; entry <= 20; entry++) {
    const deck = JSON.parse(vm.runInContext(`state.level=${level};state.entry=${entry};JSON.stringify(makeDeck())`, context));
    const expected = vm.runInContext(`questionsForLevel(${level})`, context);
    assert.equal(deck.length, expected, `level ${level} must prepare ten unique questions`);
    assert.equal(new Set(deck.map(question => question.text)).size, expected, `level ${level} battle contains duplicate questions`);
    deck.forEach(question => {
      observedCorrectPositions.add(question.correct);
      assert.equal(new Set(question.choices.map(choice => choice.text)).size, 4, `${question.id} options must be distinct`);
    });
  }
  assert.ok(observedCorrectPositions.size >= 3, `level ${level} should randomize correct answer positions`);
}

const bank = JSON.parse(vm.runInContext('JSON.stringify(questionBank)', context));
for (const [key, questions] of Object.entries(bank)) {
  assert.equal(questions.length, 15, `${key} must contain 15 questions`);
  assert.equal(new Set(questions.map(question => question.prompt)).size, 15, `${key} must not contain duplicate prompts`);
  questions.forEach(question => {
    assert.ok(question.sourceFile && question.sourceQuestionNumber, `${question.id} must retain its paper source`);
    assert.equal(new Set(question.options).size, 4, `${question.id} options must stay distinct`);
    assert.equal(question.evidenceOptions.length, 3, `${question.id} must contain three evidence choices`);
    assert.equal(question.evidenceOptions.filter(option => option.correct).length, 1, `${question.id} must contain one correct evidence choice`);
    assert.equal(new Set(question.evidenceOptions.map(option => option.text)).size, 3, `${question.id} evidence choices must be distinct`);
    assert.ok(question.evidenceOptions.every(option => [...option.text].length <= 30), `${question.id} evidence choices must stay concise`);
    assert.ok(question.evidenceOptions.every(option => !question.options.includes(option.text)), `${question.id} evidence choices must differ from answer choices`);
    assert.ok(question.evidenceOptions.every(option => !/較多人同意|選項文字較長/.test(option.text)), `${question.id} must not use generic evidence distractors`);
  });
}

console.log('8×15 source-paper bank, uniform 5-hit scale, ten-question draws and shuffled answers passed');
