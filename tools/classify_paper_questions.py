import json
import re
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
INPUT = ROOT / "work" / "paper-questions.json"
OUTPUT = ROOT / "work" / "classified-paper-questions.json"
REPORT = ROOT / "work" / "paper-question-inventory.txt"


# Mixed-unit papers are short enough to audit item by item.  These assignments
# follow the textbook unit boundaries, rather than guessing from paper order.
MIXED_UNIT_ORDER = {
    "A02_5上": [2, 3, 2, 3, 2, 3, 3, 2, 3],
    "A02_5下": [2, 2, 3, 2, 2, 3, 3, 3],
    "A04_5上": [2, 1, 2, 1, 2, 1, 1, 2],
    "A04_5下": [2, 2, 2, 1, 2, 1, 1, 1],
    "A05_5上": [3, 4, 4, 3, 4, 3, 3, 4, 3],
    "A05_5下": [3, 4, 3, 4, 3, 4, 4, 3],
    "B02_5上": [2, 3, 2, 3, 2, 2, 2, 2, 3, 3],
    "B02_5下": [2, 3, 2, 3, 2, 2, 2, 3],
    "B04_5上": [2, 2, 1, 2, 2, 2, 2, 1, 1, 1, 1],
    "B04_5下": [1, 1, 2, 1, 1, 2, 1, 2],
    "B05_5上": [4, 3, 4, 4, 4, 4, 3, 3, 3, 4, 4, 4, 4],
    "B05_5下": [4, 3, 4, 4, 4, 3, 3, 4],
}


def paper_type(filename):
    return "隨堂卷" if "隨堂卷" in filename else "月考卷A" if filename.startswith("A") else "月考卷B"


def direct_unit(filename):
    match = re.search(r"第([一二三四五])單元", filename)
    if not match or "~" in filename:
        return None
    return "一二三四五".index(match.group(1)) + 1


def classify():
    papers = json.loads(INPUT.read_text(encoding="utf-8"))
    rows = []
    for paper in papers:
        filename = paper["file"]
        term = "5上" if "5上" in filename else "5下"
        fixed = direct_unit(filename)
        mixed_key = next((key for key in MIXED_UNIT_ORDER if filename.startswith(key)), None)
        mixed_units = MIXED_UNIT_ORDER.get(mixed_key, [])
        if fixed is None and len(mixed_units) != len(paper["questions"]):
            raise ValueError(f"{filename} 的人工分類數量不符")
        for index, question in enumerate(paper["questions"]):
            unit = fixed or mixed_units[index]
            rows.append({
                "unitKey": f"{'5A' if term == '5上' else '5B'}-U{unit}",
                "term": term,
                "unit": unit,
                "paperType": paper_type(filename),
                "sourceFile": filename,
                "sourceQuestionNumber": question["number"],
                "sourceSequence": index + 1,
                **question,
            })

    # Exact repeats are retained in the audit report, but the playable bank uses
    # one copy so a student never receives the same item twice.
    seen = {}
    unique = []
    duplicate_rows = []
    for row in rows:
        key = (row["prompt"], tuple(row["options"]))
        if key in seen:
            duplicate_rows.append((row, seen[key]))
            continue
        seen[key] = row
        unique.append(row)

    OUTPUT.write_text(json.dumps({"questions": unique, "duplicates": [item[0] for item in duplicate_rows]}, ensure_ascii=False, indent=2), encoding="utf-8")
    source_counts = Counter(row["unitKey"] for row in rows)
    unique_counts = Counter(row["unitKey"] for row in unique)
    lines = [
        f"來源選擇題總數：{len(rows)}",
        f"去除完全重複後：{len(unique)}",
        f"完全重複題：{len(duplicate_rows)}",
        "",
        "單元別題數（來源 / 去重後）：",
    ]
    for term in ("5A", "5B"):
        for unit in range(1, 6):
            key = f"{term}-U{unit}"
            lines.append(f"{key}: {source_counts[key]} / {unique_counts[key]}")
    if duplicate_rows:
        lines.extend(["", "完全重複題："])
        for duplicate, original in duplicate_rows:
            lines.append(f"- {duplicate['sourceFile']} #{duplicate['sourceQuestionNumber']} = {original['sourceFile']} #{original['sourceQuestionNumber']}｜{duplicate['prompt']}")
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    classify()
