const assert = require("node:assert/strict");
require("./exam-paper.js");
const { sectionsOf } = globalThis.GUARDIAN_EXAM;

const source = [
  "社會科練習",
  "一 、 是 非 題 （每題二分）",
  "1. 臺灣四面環海。",
  "二、選擇題",
  "1. 哪種工具可以看方向？",
  "①地圖　②時鐘　③尺　④秤",
  "三、選擇題（可複選）",
  "1. 哪些地方能看見船？",
  "四、請閱讀下列文章後回答問題",
  "小芸參觀港口。",
  "1. 看到了什麼？",
  "",
  "2. 提出一項觀察。",
  "【題組二】",
  "阿明看見漁市場。",
  "(1) 阿明在哪裡？",
  "(2) 市場裡有什麼？",
  "五、填充題",
  "1. 填入港口的名稱：＿＿＿。",
  "六、配合題",
  "1. 配對名稱和地圖。",
  "答案表",
  "1. A"
].join("\n");
const sections = sectionsOf(source);
assert.deepEqual(sections.map(s => s.type), [
  "卷首資料", "是非題", "選擇題", "複選題", "題組題", "題組題", "填充題", "配合題", "答案"
]);
assert.equal(sections[2].body, "1. 哪種工具可以看方向？\n①地圖　②時鐘　③尺　④秤");
assert.equal(sections[4].body, "小芸參觀港口。\n1. 看到了什麼？\n\n2. 提出一項觀察。");
assert.equal(sections[5].body, "阿明看見漁市場。\n(1) 阿明在哪裡？\n(2) 市場裡有什麼？");
assert.equal(sections.at(-1).body, "1. A");
assert.deepEqual(sectionsOf("  \n"), []);
assert.deepEqual(sectionsOf("自訂試卷\n1. 說明。"), [
  { type: "待分類", title: "", body: "自訂試卷\n1. 說明。" }
]);
assert.equal(sectionsOf("（一）簡答題\n1. 請說明。\n答案：原卷的答題示例。")[0].body, "1. 請說明。\n答案：原卷的答題示例。");
console.log("Digital exam sections preserve original text, grouped passages, choices and separate answers.");
