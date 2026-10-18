import fs from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "file:///C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const root = new URL("../", import.meta.url);
const bankSource = await fs.readFile(new URL("question-bank.js", root), "utf8");
const curriculumSource = await fs.readFile(new URL("curriculum-data.js", root), "utf8");
const context = vm.createContext({ window: {} });
vm.runInContext(bankSource, context);
vm.runInContext(curriculumSource, context);
const bank = context.window.GUARDIAN_QUESTION_BANK;
const curriculum = context.window.GUARDIAN_CURRICULUM;

const headers = [
  "單元代碼","學期","單元","單元名稱","學習目標代碼","題號","題型","題目",
  "選項 A","選項 B","選項 C","選項 D","正確選項","正確答案","提示","答案解析",
  "A 回饋","B 回饋","C 回饋","D 回饋","A 迷思","B 迷思","C 迷思","D 迷思",
  "證據 A","證據 B","證據 C","證據正解","證據 A 回饋","證據 B 回饋","證據 C 回饋",
  "遷移情境","來源卷別","來源檔案","來源題號"
];
const letters = "ABCD";
const rows = [];
for (const unit of curriculum.units) {
  const questions = bank[unit.key] || [];
  if (new Set(questions.map(question => question.prompt)).size !== questions.length) {
    throw new Error(`${unit.key} 含有重複題目`);
  }
  questions.forEach((question, index) => {
    if (question.options.length !== 4 || new Set(question.options).size !== 4 ||
        question.optionFeedback.length !== 4 || !question.sourceFile) {
      throw new Error(`${question.id} 的來源題目或回饋資料不完整`);
    }
    const evidenceTexts = question.evidenceOptions.map(option => option.text);
    if (question.evidenceOptions.length !== 3 || question.evidenceOptions.filter(option => option.correct).length !== 1 ||
        new Set(evidenceTexts).size !== 3 || evidenceTexts.some(text => question.options.includes(text)) ||
        evidenceTexts.some(text => /較多人同意|選項文字較長/.test(text))) {
      throw new Error(`${question.id} 的證據選項不完整或仍含制式干擾項`);
    }
    const evidenceAnswer = question.evidenceOptions.findIndex(item => item.correct);
    rows.push([
      unit.key, unit.term, unit.unit, unit.title, question.objectiveId, index + 1, question.questionType, question.prompt,
      ...question.options, letters[question.answerIndex], question.options[question.answerIndex], question.hint, question.explanation,
      ...question.optionFeedback, ...question.misconceptionByChoice,
      ...question.evidenceOptions.map(item => item.text), letters[evidenceAnswer], ...question.evidenceOptions.map(item => item.feedback),
      question.transferContext, question.questionType, question.sourceFile, question.sourceQuestionNumber
    ]);
  });
}
if (rows.length !== 120 || rows.some(row => row.length !== headers.length)) {
  throw new Error(`題庫列數或欄位數錯誤：${rows.length} rows / ${headers.length} columns`);
}

const workbook = Workbook.create();
const summary = workbook.worksheets.add("題庫總覽");
const detail = workbook.worksheets.add("完整題庫");
summary.showGridLines = false;
detail.showGridLines = false;

summary.getRange("A1:F1").merge();
summary.getRange("A1").values = [["歷史文物守護行動｜五年級社會完整題庫"]];
summary.getRange("A2:F2").merge();
summary.getRange("A2").values = [["8 個單元 × 每單元 15 題｜考卷原題、逐項回饋、課本解析與來源追溯"]];
summary.getRange("A4:F4").values = [["單元代碼","學期","單元","單元名稱","題數檢查","狀態"]];
const summaryRows = curriculum.units.map(unit => [unit.key, unit.term, unit.unit, unit.title, null, null]);
summary.getRange(`A5:F${4 + summaryRows.length}`).values = summaryRows;
for (let i = 0; i < summaryRows.length; i++) {
  const row = i + 5;
  summary.getRange(`E${row}`).formulas = [[`=COUNTIF('完整題庫'!$A$5:$A$124,A${row})`]];
  summary.getRange(`F${row}`).formulas = [[`=IF(E${row}=15,"通過","請檢查")`]];
}
summary.getRange("A14:F14").values = [["總題數","","","",null,null]];
summary.getRange("E14").formulas = [["=SUM(E5:E12)"]];
summary.getRange("F14").formulas = [["=IF(E14=120,\"通過\",\"請檢查\")"]];

detail.getRange("A1:AI1").merge();
detail.getRange("A1").values = [["歷史文物守護行動｜完整題庫（由遊戲題庫同步產生）"]];
detail.getRange("A2:AI2").merge();
detail.getRange("A2").values = [["題目與選項取自月考卷 A、月考卷 B、隨堂卷；欄位保留來源檔名與題號。遊戲會隨機排列答案位置。"]];
detail.getRange("A4:AI4").values = [headers];
detail.getRange(`A5:AI${4 + rows.length}`).values = rows;

const navy = "#17324D", gold = "#D29B36", cream = "#FFF8E8", pale = "#EAF3F7", green = "#DFF2E4";
summary.getRange("A1:F1").format = { fill: navy, font: { bold: true, color: "#FFFFFF", size: 18 }, horizontalAlignment: "center", verticalAlignment: "center" };
summary.getRange("A2:F2").format = { fill: cream, font: { color: navy, italic: true }, horizontalAlignment: "center", wrapText: true };
summary.getRange("A4:F4").format = { fill: gold, font: { bold: true, color: "#1D2530" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
summary.getRange("A5:F12").format = { fill: "#FFFFFF", font: { color: "#243746" }, verticalAlignment: "center", wrapText: true, borders: { preset: "all", color: "#D8C79E", style: "thin" } };
summary.getRange("A14:F14").format = { fill: green, font: { bold: true, color: navy }, verticalAlignment: "center" };
summary.getRange("A1:F14").format.rowHeight = 24;
summary.getRange("A1:F1").format.rowHeight = 36;
summary.getRange("A2:F2").format.rowHeight = 42;
summary.getRange("A:A").format.columnWidth = 15;
summary.getRange("B:C").format.columnWidth = 9;
summary.getRange("D:D").format.columnWidth = 28;
summary.getRange("E:F").format.columnWidth = 12;
summary.freezePanes.freezeRows(4);

detail.getRange("A1:AI1").format = { fill: navy, font: { bold: true, color: "#FFFFFF", size: 16 }, horizontalAlignment: "center", verticalAlignment: "center" };
detail.getRange("A2:AI2").format = { fill: cream, font: { color: navy, italic: true }, horizontalAlignment: "left", verticalAlignment: "center", wrapText: true };
detail.getRange("A4:AI4").format = { fill: gold, font: { bold: true, color: "#1D2530" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true, borders: { preset: "all", color: "#8D6A2C", style: "thin" } };
detail.getRange(`A5:AI${4 + rows.length}`).format = { fill: "#FFFFFF", font: { color: "#243746", size: 10 }, verticalAlignment: "top", wrapText: true, borders: { preset: "all", color: "#E0D5BC", style: "thin" } };
for (let i = 0; i < curriculum.units.length; i++) {
  const start = 5 + i * 15, end = start + 14;
  if (i % 2) detail.getRange(`A${start}:AI${end}`).format.fill = pale;
}
detail.getRange("A:A").format.columnWidth = 14;
detail.getRange("B:C").format.columnWidth = 7;
detail.getRange("D:G").format.columnWidth = 17;
detail.getRange("H:H").format.columnWidth = 42;
detail.getRange("I:L").format.columnWidth = 31;
detail.getRange("M:N").format.columnWidth = 12;
detail.getRange("O:P").format.columnWidth = 34;
detail.getRange("Q:X").format.columnWidth = 38;
detail.getRange("Y:AE").format.columnWidth = 42;
detail.getRange("AF:AF").format.columnWidth = 35;
detail.getRange("AG:AG").format.columnWidth = 15;
detail.getRange("AH:AH").format.columnWidth = 52;
detail.getRange("AI:AI").format.columnWidth = 12;
detail.getRange("A1:AI1").format.rowHeight = 34;
detail.getRange("A2:AI2").format.rowHeight = 42;
detail.getRange("A4:AI4").format.rowHeight = 46;
detail.getRange(`A5:AI${4 + rows.length}`).format.rowHeight = 76;
detail.freezePanes.freezeRows(4);
detail.freezePanes.freezeColumns(8);

const outputPath = new URL("exports/歷史文物守護行動_完整題庫.xlsx", root);
workbook.recalculate();
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(fileURLToPath(outputPath));
const preview = await workbook.render({ sheetName: "題庫總覽", range: "A1:F14", scale: 1.5, format: "png" });
await fs.writeFile(new URL("exports/歷史文物守護行動_題庫總覽.png", root), new Uint8Array(await preview.arrayBuffer()));
const detailPreview = await workbook.render({ sheetName: "完整題庫", range: "AG4:AI8", scale: 1.25, format: "png" });
await fs.writeFile(new URL("exports/歷史文物守護行動_題庫明細預覽.png", root), new Uint8Array(await detailPreview.arrayBuffer()));
const check = await workbook.inspect({ kind: "sheet", sheetId: detail.name, range: "A1:AI12", include: "values,formulas", maxChars: 12000, tableMaxRows: 12, tableMaxCols: 35 });
console.log(check.ndjson);
const formulaErrors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 50 }, summary: "final formula error scan" });
console.log(formulaErrors.ndjson);
console.log(`已輸出 ${rows.length} 題：${outputPath.pathname}`);
