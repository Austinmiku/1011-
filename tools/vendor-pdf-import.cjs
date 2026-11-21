// Keep the upstream PDF.js build and license; expose its existing globals to classic file:// pages.
const fs = require('node:fs');
const path = require('node:path');
const source = process.argv[2];
if (!source) throw new Error('Pass the installed pdfjs-dist directory');
const target = path.join(__dirname, '..', 'vendor');
fs.mkdirSync(target, { recursive: true });
for (const [file, globalName] of [['pdf', 'pdfjsLib'], ['pdf.worker', 'pdfjsWorker']]) {
  const original = fs.readFileSync(path.join(source, 'build', file + '.mjs'), 'utf8');
  if (!original.includes('globalThis.' + globalName)) throw new Error('Unexpected PDF.js export format');
  const classic = original.replace(/^export \{[^}]+\};?\s*$/m, '').replaceAll('import.meta.url', '""').replace(/\/\/# sourceMappingURL=.*$/m, '');
  fs.writeFileSync(path.join(target, file + '.js'), '(function(){\n' + classic + '\n})();\n');
}
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'PDFjs-LICENSE.txt'));

// PDF.js reads these locally for scans compressed as JBIG2, CCITT or JPEG 2000.
const wasm = path.join(source, 'wasm');
const scanCodecs = Object.fromEntries(['jbig2.wasm', 'openjpeg.wasm'].map(file => [
  file, fs.readFileSync(path.join(wasm, file)).toString('base64')
]));
fs.writeFileSync(path.join(target, 'pdf-scan-codecs.js'), 'globalThis.GUARDIAN_PDF_SCAN_CODECS = ' + JSON.stringify(scanCodecs) + ';\n');
const licenses = ['LICENSE_JBIG2', 'LICENSE_OPENJPEG', 'LICENSE_PDFJS_JBIG2', 'LICENSE_PDFJS_OPENJPEG'];
fs.writeFileSync(path.join(target, 'PDFjs-scan-codecs-LICENSE.txt'), licenses.map(file =>
  file + '\n' + fs.readFileSync(path.join(wasm, file), 'utf8')
).join('\n\n'));
