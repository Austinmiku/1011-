import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader


SOURCE = Path(r"C:\Users\User\Desktop\畢專題目庫")
OUTPUT = Path(__file__).resolve().parent.parent / "work" / "paper-questions.json"
ANSWER_MARKS = "①②③④"
NUMBER_MARKS = "⒈⒉⒊⒋⒌⒍⒎⒏⒐⒑⒒⒓⒔⒕⒖⒗⒘⒙⒚⒛"


def compact(text):
    return re.sub(r"\s+", "", text).replace("臺 灣", "臺灣")


def extract_questions(text):
    pattern = re.compile(
        rf"[（(]\s*([{ANSWER_MARKS}])\s*[）)]\s*([{NUMBER_MARKS}])(.+?)(?=[（(]\s*[{ANSWER_MARKS}]\s*[）)]\s*[{NUMBER_MARKS}]|\Z)",
        re.S,
    )
    questions = []
    for answer_mark, number_mark, body in pattern.findall(text):
        body = compact(body)
        parts = re.split(r"([①②③④])", body)
        if len(parts) < 9:
            continue
        stem = parts[0].strip("。．.（）()：:")
        options = []
        trailing_text = ""
        for index in range(1, 8, 2):
            option = parts[index + 1]
            if index == 7:
                # The PDF reading order often places answer notes, the next section,
                # or a reading passage immediately after option 4.  Preserve that
                # tail for review, but never let it become part of the answer text.
                option_parts = re.split(r"[）)]", option, maxsplit=1)
                option = option_parts[0]
                if len(option_parts) > 1:
                    trailing_text = option_parts[1].strip()
            options.append(option.strip("。．.（）()：:"))
        if not stem or any(not option for option in options):
            continue
        questions.append(
            {
                "number": NUMBER_MARKS.index(number_mark) + 1,
                "prompt": stem,
                "options": options,
                "answerIndex": ANSWER_MARKS.index(answer_mark),
                "trailingText": trailing_text,
            }
        )
    return questions


def main():
    papers = sorted(
        path
        for path in SOURCE.glob("*.pdf")
        if "教用" in path.name and "課本" not in path.name
    )
    result = []
    for path in papers:
        reader = PdfReader(path)
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        questions = extract_questions(text)
        result.append(
            {
                "file": path.name,
                "pages": len(reader.pages),
                "questions": questions,
            }
        )
        print(f"{path.name}: {len(questions)}", file=sys.stderr)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(OUTPUT)


if __name__ == "__main__":
    main()
