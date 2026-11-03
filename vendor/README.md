# 題庫匯入元件

工具隨遊戲頁面預先載入，避免本機預覽限制選檔後的動態載入。匯入時先沿用已載入的工具，若需補載則依 custom-questions.js 所在位置解析路徑。PDF／Excel 都在瀏覽器內解析，原始檔案不會上傳，老師儲存後只將有效題庫與題數寫入班級。

- SheetJS CE 0.20.3：`xlsx.full.min.js`，官方來源 <https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js>，授權見 `SheetJS-LICENSE.txt`。
- Mozilla PDF.js 5.6.205：`pdf.js`、`pdf.worker.js`，來自官方 pdfjs-dist 套件，授權見 `PDFjs-LICENSE.txt`。

PDF.js 透過 `tools/vendor-pdf-import.cjs <pdfjs-dist 目錄>` 轉成傳統 script：包住作用域、移除模組 export 及 Node 專用 import.meta，沿用上游的 globalThis.pdfjsLib／pdfjsWorker。預先載入 WorkerMessageHandler，使用 PDF.js 的本執行緒模式，以支援直接開啟 file:// 網頁。關閉 isEvalSupported，不使用外部辨識服務。

單檔上限 20 MB、PDF 200 頁、有效題庫 2,000 題。遊戲題數可在 1～有效題庫數量中設定，與原本 15 題限制分開。
