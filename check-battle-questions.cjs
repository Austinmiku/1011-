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

assert.deepEqual(Array.from(vm.runInContext('difficulties.map(d=>d.enemy)', context)), [3, 4, 5, 6, 6, 7, 8, 9]);
assert.match(html, /\.bt-msgrow\.reason-active\{display:grid/, 'evidence feedback must use a horizontal row above the panel');
assert.match(html, /row\.classList\.add\("reason-active"\)/, 'evidence step must activate the horizontal layout');
for (let level = 1; level <= 8; level++) {
  const observedCorrectPositions = new Set();
  for (let entry = 1; entry <= 20; entry++) {
    const deck = JSON.parse(vm.runInContext(`state.level=${level};state.entry=${entry};JSON.stringify(makeDeck())`, context));
    const expected = vm.runInContext(`questionsForLevel(${level})`, context);
    assert.equal(deck.length, expected, `level ${level} question count must match enemy HP`);
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
    assert.ok(question.evidenceOptions.every(option => !question.options.includes(option.text)), `${question.id} evidence choices must differ from answer choices`);
    assert.ok(question.evidenceOptions.every(option => !/較多人同意|選項文字較長/.test(option.text)), `${question.id} must not use generic evidence distractors`);
  });
}

console.log('8×15 source-paper bank, HP-scaled draws, uniqueness and shuffled answer positions passed');
