const fs = require('node:fs');
const path = require('node:path');

const unpacked = process.argv[2];
if (!unpacked) throw new Error('Usage: node tools/vendor-exam-ocr.cjs <directory of unpacked npm packages>');
const output = path.resolve(__dirname, '../vendor/ocr');
const read = (pkg, file) => fs.readFileSync(path.join(unpacked, pkg, 'package', file), 'utf8');
const dist = file => read('tesseract.js', 'dist/' + file);
const withoutSourceMap = source => source.replace(/^\/\/# sourceMappingURL=.*$/gm, '');
const core = read('tesseract.js-core', 'tesseract-core-lstm.wasm.js');
const languages = Object.fromEntries(['chi_tra', 'eng'].map(code => [
  code,
  fs.readFileSync(path.join(unpacked, code, 'package', '4.0.0_best_int', code + '.traineddata.gz')).toString('base64')
]));

function serveLanguages(languages) {
  const fetchResource = self.fetch.bind(self);
  self.fetch = (request, options) => {
    const name = /^https:\/\/exam-ocr\.invalid\/([a-z_]+)\.traineddata\.gz$/.exec(request)?.[1];
    if (!name || !Object.hasOwn(languages, name)) return fetchResource(request, options);
    const bytes = Uint8Array.from(atob(languages[name]), char => char.charCodeAt(0));
    return Promise.resolve(new Response(bytes));
  };
}

fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'tesseract.min.js'), withoutSourceMap(dist('tesseract.min.js')));
// Classic scripts can load under file://, where worker fetches of local assets are blocked.
const worker = '(' + serveLanguages + ')(' + JSON.stringify(languages) + ');\n' +
  core + '\n' + withoutSourceMap(dist('worker.min.js'));
fs.writeFileSync(path.join(output, 'ocr-assets.js'), 'globalThis.GUARDIAN_OCR_WORKER = ' + JSON.stringify(worker) + ';\n');
fs.writeFileSync(path.join(output, 'LICENSE.txt'), read('tesseract.js', 'LICENSE.md'));
for (const file of ['tesseract.min.js.LICENSE.txt', 'worker.min.js.LICENSE.txt']) {
  fs.writeFileSync(path.join(output, file), dist(file));
}
