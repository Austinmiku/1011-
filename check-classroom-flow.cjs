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

assert.equal(vm.runInContext('curriculum.units.length', context), 8);
assert.equal(vm.runInContext('curriculum.units.filter(u=>u.term==="五上").length', context), 4);
assert.equal(vm.runInContext('curriculum.units.filter(u=>u.term==="五下").length', context), 4);
assert.equal(vm.runInContext('levels.length', context), 8);
assert.equal(vm.runInContext('levels.every((l,i)=>l.title===curriculum.units[i].title&&l.meta.questionKey===curriculum.units[i].key)', context), true);
assert.equal(vm.runInContext('curriculum.units.every((u,i)=>u.themeLevel===i+1&&classroomLevelFor(u.key)===i+1)', context), true);
assert.equal(vm.runInContext('levels.every(l=>l.guide===unitGuidesByKey[l.meta.questionKey])', context), true);
assert.equal(vm.runInContext('levels.every((l,i)=>l.meta.prediction===curriculum.units[i].prediction)', context), true);
assert.equal(vm.runInContext('levels.every(l=>l.meta.goal&&l.meta.inquiry&&l.meta.tasks.length===2)', context), true);
assert.equal(vm.runInContext('migrateSaved({done:[1]}).version', context), 3);
assert.equal(vm.runInContext('migrateSaved({done:[1]}).learningRecords.length', context), 0);
assert.equal(vm.runInContext('migrateSaved({lessonDuration:99}).lessonDuration', context), 20);
const question = JSON.parse(vm.runInContext('state.level=1;state.entry=1;JSON.stringify(makeDeck()[0])', context));
for (const field of ['id', 'curriculum', 'type', 'objectiveId', 'claim', 'transfer']) assert.ok(question[field], `missing ${field}`);
assert.equal(question.choices.length, 4);
assert.ok(question.choices.every(choice => choice.feedback && choice.misconception));
assert.equal(question.evidenceOptions.length, 3);
assert.equal('reasoningOptions' in question, false);
assert.equal(vm.runInContext('Object.values(questionBank).every(qs=>qs.length===15)', context), true);
assert.equal(vm.runInContext('Object.keys(questionBank).length', context), 8);
assert.match(html, /function showPrediction\(/);
assert.match(html, /function showEvidenceTask\(/);
assert.match(html, /function showReasonStep\(/);
assert.doesNotMatch(html, /function showReasonChoice\(/);
assert.doesNotMatch(html, /選出最合理的答案。答錯會受到攻擊，選項會重新排列/);
assert.match(html, /function showExitTicket\(/);
assert.match(html, /區域學習單・把證據帶回生活/);
assert.match(html, /<h2>\$\{esc\(meta\.prediction\)\}<\/h2><p class="exit-subtitle">\$\{esc\(meta\.exitPrompt\)\}<\/p>/);
assert.doesNotMatch(html, /離場單/);
assert.match(html, /function showTeacherMode\(/);
assert.match(html, /data-teacher-unit/);

console.log('Classroom inquiry flow, curriculum metadata and legacy save migration passed');
