# 題庫匯入元件

工具隨遊戲頁面預先載入，避免本機預覽限制選檔後的動態載入。匯入時先沿用已載入的工具，若需補載則依 custom-questions.js 所在位置解析路徑。PDF／Excel 都在瀏覽器內解析，原始檔案不會上傳，老師儲存後只將有效題庫與題數寫入班級。

- SheetJS CE 0.20.3：`xlsx.full.min.js`，官方來源 <https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js>，授權見 `SheetJS-LICENSE.txt`。
- Mozilla PDF.js 5.6.205：`pdf.js`、`pdf.worker.js`，來自官方 pdfjs-dist 套件，授權見 `PDFjs-LICENSE.txt`。
- 掃描 PDF 用的 JBIG2、CCITT、JPEG 2000 解碼器來自同版本 PDF.js。授權見 `PDFjs-scan-codecs-LICENSE.txt`。
- 試卷文字辨識使用 [Tesseract.js 7.0.0](https://github.com/naptha/tesseract.js) 與 tesseract.js-core 7.0.0，以及 npm 的 `@tesseract.js-data/chi_tra` 和 `@tesseract.js-data/eng` 1.0.0 的 `4.0.0_best_int` 模型。授權見 `ocr/` 中的授權檔。

PDF.js 透過 `tools/vendor-pdf-import.cjs <pdfjs-dist 目錄>` 轉成傳統 script：包住作用域、移除模組 export 及 Node 專用 import.meta，沿用上游的 globalThis.pdfjsLib／pdfjsWorker。預先載入 WorkerMessageHandler，使用 PDF.js 的本執行緒模式，以支援直接開啟 file:// 網頁。關閉 isEvalSupported，不使用外部辨識服務。

掃描時才載入解碼和文字辨識工具。`tools/vendor-exam-ocr.cjs <解壓後的 npm 套件目錄>` 可重建 OCR 檔，套件解壓路徑依 npm 短名使用 `tesseract.js/package/`、`tesseract.js-core/package/`、`chi_tra/package/`、`eng/package/`。

單檔上限 20 MB、PDF 200 頁、有效題庫 2,000 題。遊戲題數可在 1～有效題庫數量中設定，與原本 15 題限制分開。
