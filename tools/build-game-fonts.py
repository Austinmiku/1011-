"""重新製作遊戲內嵌的精簡字型，收齊遊戲裡用到的每一個字。

遊戲為了讓 file:// 直接開啟也能顯示字型，把字型以 base64 內嵌在 HTML 裡；
為了控制檔案大小，只收錄遊戲實際用到的字。新增題目或文字後，請重新執行：

    python tools/build-game-fonts.py <原始字型資料夾>

原始字型資料夾需要放這三個檔案（都是 SIL OFL 1.1 授權，可從官方 GitHub 下載）：
    jf-openhuninn-*.ttf        jf open 粉圓（內文）  https://github.com/justfont/open-huninn-font/releases
    NotoSerifTC*.ttf            思源宋體可變字型（標題） https://github.com/google/fonts/tree/main/ofl/notoseriftc
    LXGWWenKaiTC-Regular.ttf    霞鶩文楷（劇情、筆記） https://github.com/lxgw/LxgwWenkaiTC/releases

需要安裝：pip install fonttools brotli
"""

import argparse
import base64
import io
import json
import re
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
GAME_HTML = ROOT / "歷史文物守護行動完整版.html"
# 遊戲畫面上的文字來源；新增其他會顯示文字的檔案時，記得加進來（check-fonts.cjs 也要同步）
TEXT_FILES = ["question-bank.js", "curriculum-data.js", "cloud-sync.js"]
FONT_DIR = ROOT / "assets" / "fonts"
MANIFEST = FONT_DIR / "game-fonts.json"
DATA_URI = re.compile(r'url\("data:font/woff2;base64,[^"]+"\)')
FONT_FACE = re.compile(r'@font-face\{font-family:"Game [^"]+";src:url\("data:font/woff2;base64,[^"]+"\)[^}]*\}')

# 就算現在沒用到，也先收進來的常用字元：英數、常用全形標點
EXTRA = "".join(chr(c) for c in range(0x20, 0x7F)) + "".join(chr(c) for c in range(0xFF01, 0xFF5F)) + \
    "　，。、；：？！「」『』（）《》〈〉【】…—–～・·“”‘’＋－×÷％／＝"

FONTS = [
    # (CSS 字型名稱, 原始檔樣式, 輸出檔名, CSS font-weight, 可變字型保留的粗細範圍)
    ("Game Huninn TC", "jf-openhuninn-*.ttf", "jfOpenHuninn-game.woff2", "400", None),
    ("Game Noto Serif TC", "NotoSerifTC*.ttf", "NotoSerifTC-game.woff2", "400 900", (400, 900)),
    ("Game WenKai TC", "LXGWWenKaiTC-Regular.ttf", "LXGWWenKaiTC-game.woff2", "400", None),
]


def read_html() -> str:
    # 保留原本的 CRLF 換行，避免整份 HTML 在 git 裡每一行都變成修改
    with open(GAME_HTML, encoding="utf-8", newline="") as handle:
        return handle.read()


def game_text() -> str:
    text = DATA_URI.sub("", read_html())
    for name in TEXT_FILES:
        text += (ROOT / name).read_text(encoding="utf-8")
    return text


def wanted_characters() -> set[str]:
    chars = {c for c in game_text() + EXTRA if ord(c) >= 0x20 and not 0xD800 <= ord(c) <= 0xDFFF}
    # emoji 與圖示交給系統的彩色 emoji 字型
    return {c for c in chars if ord(c) <= 0xFFFF and not 0x2190 <= ord(c) <= 0x2BFF and c not in "️﻿"}


def build_font(source: Path, chars: set[str], weights) -> tuple[bytes, list[str]]:
    font = TTFont(source, lazy=False, recalcTimestamp=False)
    cmap = font.getBestCmap()
    included = sorted(c for c in chars if ord(c) in cmap)
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.hinting = False
    subsetter = subset.Subsetter(options)
    subsetter.populate(text="".join(included))
    subsetter.subset(font)
    # 可變字型先精簡字集，再只保留遊戲用到的粗細範圍，檔案會小很多
    if weights and "fvar" in font:
        font = instancer.instantiateVariableFont(font, {"wght": weights})
    out = io.BytesIO()
    font.flavor = "woff2"
    font.recalcTimestamp = False
    font.save(out)
    return out.getvalue(), included


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path, help="放原始字型檔的資料夾")
    args = parser.parse_args()

    chars = wanted_characters()
    faces, manifest = [], {}
    for family, pattern, output, css_weight, weights in FONTS:
        matches = sorted(args.source.glob(pattern))
        if not matches:
            raise SystemExit(f"在 {args.source} 找不到 {pattern}")
        data, included = build_font(matches[-1], chars, weights)
        (FONT_DIR / output).write_bytes(data)
        manifest[family] = "".join(included)
        faces.append(f'@font-face{{font-family:"{family}";src:url("data:font/woff2;base64,{base64.b64encode(data).decode()}") '
                     f'format("woff2");font-style:normal;font-weight:{css_weight};font-display:swap}}')
        missing = sorted(c for c in chars if c not in included and ("㐀" <= c <= "鿿"))
        print(f"{family}: {matches[-1].name} → {output}，{len(included)} 字，{len(data) // 1024} KB"
              + (f"；原始字型缺這些中文字：{''.join(missing)}" if missing else ""))

    html = read_html()
    old = FONT_FACE.findall(html)
    if not old:
        raise SystemExit("HTML 裡找不到內嵌的 @font-face")
    first = html.index(old[0])
    html = html.replace(old[0], "\0", 1)
    for rule in old[1:]:
        # 連同前面的換行與縮排一起刪，重複執行也不會累積空白行
        html = re.sub(r"\r?\n[ \t]*" + re.escape(rule), "", html, count=1)
    newline = "\r\n" if "\r\n" in html else "\n"
    html = html.replace("\0", (newline + "    ").join(faces), 1)
    with open(GAME_HTML, "w", encoding="utf-8", newline="") as handle:
        handle.write(html)
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"已更新 {GAME_HTML.name} 的內嵌字型與 {MANIFEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
