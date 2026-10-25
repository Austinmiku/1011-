const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 遊戲內嵌的精簡字型必須收齊畫面上的每一個字，否則缺的字會改用系統字型顯示，看起來字體跑掉。
// 這裡的文字來源要和 tools/build-game-fonts.py 的 TEXT_FILES 一致。
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const html = read('歷史文物守護行動完整版.html');
const text = html.replace(/url\("data:font\/woff2;base64,[^"]+"\)/g, '') + ['question-bank.js', 'curriculum-data.js', 'cloud-sync.js'].map(read).join('');
const shown = [...new Set([...text])].filter(c => {
  const code = c.codePointAt(0);
  // emoji 與圖示交給系統的彩色 emoji 字型
  return code >= 0x20 && code <= 0xFFFF && !(code >= 0x2190 && code <= 0x2BFF) && !(code >= 0xD800 && code <= 0xDFFF) && c !== '️' && c !== '﻿';
});
const manifest = JSON.parse(read('assets/fonts/game-fonts.json'));
const families = ['Game Huninn TC', 'Game Noto Serif TC', 'Game WenKai TC'];

for (const family of families) {
  assert.ok(manifest[family], `${family} is missing from assets/fonts/game-fonts.json`);
  assert.match(html, new RegExp(`@font-face\\{font-family:"${family}";src:url\\("data:font/woff2;base64,`), `${family} must be embedded in the game HTML`);
  const included = new Set([...manifest[family]]);
  const missing = shown.filter(c => !included.has(c));
  assert.equal(missing.length, 0, `${family} 缺 ${missing.length} 個字：${missing.join('')}\n請執行 python tools/build-game-fonts.py <原始字型資料夾> 重新製作字型`);
}
const usedFamilies = new Set([...html.matchAll(/"(Game [^"]+)"/g)].map(m => m[1]));
for (const family of usedFamilies) assert.ok(families.includes(family), `CSS uses ${family}, which is not embedded`);

console.log(`Embedded fonts cover all ${shown.length} characters shown in the game`);
