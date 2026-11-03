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
