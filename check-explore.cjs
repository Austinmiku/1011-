const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '歷史文物守護行動完整版.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].split('document.querySelector("#largeBtn").onclick=')[0];
let pins = [], taskAnswers = [], taskBack = {}, taskStatus = {};
const app = { focus() {} };
Object.defineProperty(app, 'innerHTML', { set(markup) {
  this.markup = markup;
  pins = [...markup.matchAll(/<button class="explore-pin[^>]+data-spot="(\d)"/g)].map((match) => ({ dataset: { spot: match[1] } }));
  taskAnswers = [...markup.matchAll(/data-task-answer="(\d)"/g)].map((match) => ({ dataset: { taskAnswer: match[1] } }));
  taskBack = {}; taskStatus = {};
} });
const progress = { setAttribute() {} };
const battle = {};
const paths = Object.fromEntries(['.ink-route', '.ink-head'].map((name) => [name, {
  setAttribute(key, value) { if (key === 'd') this.d = value; },
  getTotalLength() { return 100; },
  style: { setProperty() {} },
}]));
const drawing = { setAttribute() {}, classList: { add(name) { drawing.ready = name; } }, querySelector(selector) { return paths[selector]; } };
let drawnSpot;
const canvas = {
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 720 }; },
  querySelector(selector) {
    if (selector === '.discovery-drawing') return drawing;
    if (selector.includes('.explore-pin')) {
      drawnSpot = Number(selector.match(/data-spot="(\d)"/)[1]);
      return { getBoundingClientRect() { return { left: drawnSpot ? 500 : 100, top: 250, bottom: 330, width: 100, height: 80 }; } };
    }
    if (selector === '.clue.just-found') return { getBoundingClientRect() { return { top: 586 }; } };
    if (selector === '.clue.just-found .note-copy') return { getBoundingClientRect() {
      const left = drawnSpot ? 450 : 90;
      return { left, right: left + 250, top: 600, bottom: 680, width: 250, height: 80 };
    } };
    return null;
  },
};
const document = {
  querySelector(selector) { return { '#app': app, '#progress': progress, '#battle': battle, '#taskBack': taskBack, '#taskStatus': taskStatus, '.explore-canvas': canvas }[selector] || null; },
  querySelectorAll(selector) { return selector === '[data-spot]' ? pins : selector === '[data-task-answer]' ? taskAnswers : []; },
};
const context = vm.createContext({ document, window: {}, location: { search: '?seed=115' }, localStorage: { getItem() { return '{}'; }, setItem() {} }, URLSearchParams, console, Math });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'question-bank.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'curriculum-data.js'), 'utf8'), context);
vm.runInContext(script, context);
const curriculumTasks = JSON.parse(vm.runInContext('JSON.stringify([...curriculum.units,...curriculum.levels].flatMap(item=>item.tasks))', context));
curriculumTasks.forEach((task, index) => {
  assert.ok([...task.prompt].length <= 24, `exploration task ${index + 1} prompt should stay readable for grade five`);
  task.options.forEach(option => assert.ok([...option].length <= 16, `exploration task ${index + 1} option should stay concise`));
});
for (let level = 1; level <= 8; level++) {
  const n = vm.runInContext(`artNumber(${level})`, context);
  for (const file of [`explore-scene-${n}.webp`, `explore-spot-${n}-a.webp`, `explore-spot-${n}-b.webp`])
    assert.ok(fs.existsSync(path.join(__dirname, 'assets', file)), file);
  const correctPositions = new Set();
  for (let entry = 1; entry <= 15; entry++) {
    vm.runInContext(`state.level=${level};state.entry=${entry};showEvidenceTask(0)`, context);
    correctPositions.add(taskAnswers.findIndex(answer => answer.dataset.taskAnswer === '0'));
  }
  assert.equal(correctPositions.size, 3, `level ${level} exploration answers should appear in all positions`);
  vm.runInContext(`state.level=${level};state.spotOrder=[1,0];startExplore()`, context);
  assert.match(app.markup, new RegExp(`explore-scene-${n}\\.webp`));
  assert.match(app.markup, new RegExp(`explore-spot-${n}-a\\.webp`));
  assert.match(app.markup, new RegExp(`explore-spot-${n}-b\\.webp`));
  assert.equal(pins.length, 2);
  const firstClue = vm.runInContext(`levels[${level - 1}].spots[0].c`, context);
  assert.ok(!app.markup.includes(firstClue), 'empty notebook must not reveal clue text');
  assert.doesNotMatch(app.markup, /discovery-drawing|待調查/);
  assert.match(app.markup, /id="battle" disabled/);
  pins.find((pin) => pin.dataset.spot === '0').onclick();
  assert.equal(vm.runInContext('state.clues.size', context), 0);
  assert.match(app.markup, /探索驗證/);
  const firstCorrectIndex = taskAnswers.findIndex(answer => answer.dataset.taskAnswer === '0');
  assert.ok(firstCorrectIndex >= 0);
  taskAnswers[firstCorrectIndex].onclick();
  assert.equal(vm.runInContext('state.clues.size', context), 1);
  assert.match(app.markup, /已記錄 1 \/ 2 條關鍵線索/);
  assert.ok(app.markup.includes(firstClue));
  assert.match(app.markup, /discovery-drawing/);
  assert.doesNotMatch(app.markup, /ink-ring/);
  assert.match(paths['.ink-route'].d, /^M 150 330 C .* 215 574$/);
  assert.equal(drawing.ready, 'ready');
  assert.match(app.markup, /just-found/);
  assert.match(app.markup, /id="battle" disabled/);
  pins.find((pin) => pin.dataset.spot === '1').onclick();
  assert.equal(vm.runInContext('state.clues.size', context), 1);
  const secondCorrectIndex = taskAnswers.findIndex(answer => answer.dataset.taskAnswer === '0');
  assert.ok(secondCorrectIndex >= 0);
  taskAnswers[secondCorrectIndex].onclick();
  assert.match(paths['.ink-route'].d, /^M 550 330 C .* 575 574$/);
  assert.equal(vm.runInContext('state.clues.size', context), 2);
  assert.match(app.markup, /已記錄 2 \/ 2 條關鍵線索/);
  assert.doesNotMatch(app.markup, /id="battle" disabled/);
}
console.log('Eight exploration levels and two clue interactions per level passed');
