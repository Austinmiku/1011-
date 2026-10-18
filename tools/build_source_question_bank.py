import json
import re
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
INPUT = ROOT / "work" / "classified-paper-questions.json"
SELECTED = ROOT / "work" / "selected-paper-questions.json"
OUTPUT = ROOT / "question-bank.js"
UNIT_ORDER = ["5A-U1", "5A-U2", "5A-U3", "5A-U4", "5B-U1", "5B-U2", "5B-U3", "5B-U4"]
EXCLUDED_CONTEXT = re.compile(r"文中|圖中|下圖|上圖|依內容|根據內容|短文|行程|參訪|觀察.*圖|照片|如圖|題組")


FACT_RULES = {
    "5A-U1": [
        (r"板塊|地震|高度持續增加", "臺灣位在歐亞板塊與菲律賓海板塊交界附近，板塊推擠形成多山地形，也使地震頻繁。"),
        (r"八仙洞|舊石器", "八仙洞遺址可見舊石器時代的生活線索，當時人們主要採集、狩獵，尚未發展農耕定居。"),
        (r"卑南遺址", "卑南遺址位於臺東，以大型聚落、石板棺與玉器等考古發現聞名。"),
        (r"十三行", "十三行遺址位於新北市八里，出土煉鐵與交易相關遺物，反映金屬技術和對外交流。"),
        (r"漢本|玻璃", "漢本遺址出土外來玻璃飾品等物件，可作為史前人群透過海上交易取得物品的證據。"),
        (r"海岸|高雄港|潟湖|斷崖|沙岸|珊瑚礁|岬灣", "臺灣東部多陡峭斷崖、西部多平直沙岸、北部多岬灣，南部則可見珊瑚礁海岸；高雄港利用潟湖地形發展。"),
        (r"巴士海峽|菲律賓", "臺灣南方隔著巴士海峽與菲律賓相鄰，顯示臺灣位在東亞與東南亞之間。"),
        (r"赤道|南、北半球|南北半球", "赤道是把地球分成南、北半球的假想線；臺灣位在北半球。"),
        (r"東南方|綠島|蘭嶼|金門|馬祖|澎湖", "判斷臺灣附屬島嶼的位置，要以臺灣本島為基準比較方向；綠島與蘭嶼位於本島東南方海域。"),
    ],
    "5A-U2": [
        (r"法律|少年事件|處理法", "法律由國家制定並具有強制力，可維持秩序、保障權利；少年事件處理法重視未成年人的健全成長。"),
        (r"規範|倫理|道德|宗教信仰", "社會規範包括風俗、倫理道德、宗教信仰與法律，不同規範的形成方式和強制力並不相同。"),
        (r"母系|阿美族", "阿美族傳統社會具有母系特色，家族與財產傳承常以女性為重要核心。"),
        (r"魯凱族|階級", "魯凱族傳統社會具有階級制度，理解族群文化時應依該族的歷史與說法判斷。"),
        (r"庫巴|鄒族", "庫巴是鄒族重要的男子集會所，也是討論部落事務與傳承文化的場所。"),
        (r"平埔|漢化", "平埔族群多居住在西部平原，因較早且頻繁與漢人接觸，部分文化受到漢化政策與社會變遷影響。"),
        (r"祭師|神明|漢人宗教", "祭師是部分原住民族傳統信仰中的重要角色，不能直接當成漢人民間信仰的神明。"),
        (r"傳統領域|七彩湖|布農族", "傳統領域和族群的生活、祭儀與資源利用密切相關，不能只把它看成一般景點。"),
    ],
    "5A-U3": [
        (r"漁|捕撈|養殖|海流", "臺灣周邊海流交會，帶來多樣漁業資源；過度捕撈會使魚群減少，因此需要適當的取用與管理。"),
        (r"林業|森林|木材|竹|藤", "森林提供木材與多種資源，也有保水、保土與維持生態的功能；利用資源時必須兼顧復育。"),
        (r"大理石|煤|礦|九份|瑞芳", "臺灣礦業曾帶動地方發展，但多數礦產逐漸停採；花蓮仍有大理石礦，瑞芳、九份過去則以煤或金礦聞名。"),
        (r"畜牧|傳染病", "畜牧業能供應肉、蛋、乳品，也需處理傳染病、動物照養與環境污染等問題。"),
        (r"農產品|鳳梨|稻米|在來米|肥料", "農業會受到自然環境、技術與市場影響；在來米由早期漢人帶入，現代生產也要兼顧土壤與生態。"),
        (r"臺車|人力", "早期山區臺車常利用人力推行，用來運送木材、礦產等資源，反映當時的產業與交通條件。"),
        (r"生態旅遊|產業發展", "資源產業轉型時，可透過生態旅遊或文化保存創造新機會，但仍須評估對地方與環境的影響。"),
    ],
    "5A-U4": [
        (r"荷蘭|熱蘭遮|大員", "荷蘭人曾以臺灣南部為據點，經營貿易、傳教並課徵稅收；熱蘭遮堡是重要據點。"),
        (r"西班牙|三貂角", "西班牙人曾在臺灣北部建立據點；三貂角的名稱也和大航海時代的西班牙航行有關。"),
        (r"鄭成功|鄭經|陳永華|鄭芝龍", "鄭成功驅逐荷蘭人後建立鄭氏政權；鄭經與陳永華推動屯墾、教育等措施，鄭芝龍則較早經營海上勢力。"),
        (r"羅馬字母|傳教", "大航海時代的傳教士曾用羅馬字母拼寫原住民族語言，留下理解當時語言與社會的重要資料。"),
        (r"大航海|名稱|福爾摩沙|馬尼拉", "大航海時代的航海者為臺灣留下不同稱呼；馬尼拉是菲律賓城市，並不是臺灣的舊稱。"),
        (r"貿易|台江內海|牛車|康熙臺灣輿圖", "台江內海曾是船隻往來與貨物運輸的重要水域，地圖與圖像可用來重建當時的港市景觀。"),
    ],
    "5B-U1": [
        (r"黑水溝|渡海|移民|唐山", "早期漢人渡過臺灣海峽來臺，航程受到季風、海象與船隻條件影響；『黑水溝』常指澎湖與臺灣島間的危險水域。"),
        (r"水圳|瑠公圳|灌溉", "清代開墾需要穩定水源，因此各地興建水圳並建立分水、維修規則；瑠公圳位於北部。"),
        (r"漳州|泉州|械鬥|芝山岩", "清代移民有不同原鄉與群體，資源競爭有時引發分類械鬥；芝山岩隘門與漳、泉衝突有關。"),
        (r"林本源|園邸|板橋", "板橋林本源園邸展現清代漢人家族的經濟實力，也可用來理解當時的家族與社會生活。"),
        (r"朱一貴|民變|中興王", "朱一貴事件是清代臺灣的重要民變，反映當時治理與社會矛盾。"),
        (r"製鹽|乾季|日照", "臺灣南部乾季明顯、日照充足，沿海平坦，因此適合發展晒鹽等產業。"),
        (r"經濟作物|小麥", "清代臺灣常見外銷經濟作物包括蔗糖、稻米等；小麥不是當時臺灣主要經濟作物。"),
    ],
    "5B-U2": [
        (r"劉銘傳|巡撫|鐵路|滬尾", "劉銘傳是臺灣建省後的首任巡撫，推動鐵路、電報等建設；清法戰爭期間也加強淡水防務。"),
        (r"牡丹社|渡臺限制", "牡丹社事件後，清廷更重視臺灣防務與治理，逐步採取開山撫番並廢除渡臺限制等政策。"),
        (r"清法戰爭|安南|建省", "清法戰爭使清廷更注意臺灣的戰略地位，戰後於 1885 年宣布臺灣建省。"),
        (r"大稻埕|茶葉|經濟重心", "開港後茶葉等商品從北部輸出，帶動大稻埕與北部港市發展，也使經濟重心逐漸北移。"),
        (r"開港|通商|洋行|領事館|東興洋行", "1860 年代臺灣開港通商後，外商設立洋行，外國也設領事館處理外交事務，臺灣更深地進入國際貿易。"),
        (r"巴克禮|教會報|傳教士", "巴克禮在臺南從事傳教與教育，使用羅馬字推廣閱讀，並發行《臺灣府城教會報》。"),
        (r"東亞航道|地理位置", "臺灣位在東亞重要航道附近，又有可輸出的物產，因此成為外國通商與競逐的目標。"),
    ],
    "5B-U3": [
        (r"再生能源|火力發電", "火力發電依靠煤、石油或天然氣等燃料，不屬於再生能源；再生能源則可在自然循環中持續補充。"),
        (r"水力", "水力發電利用水流，但會受降雨與水量影響，興建設施也可能改變河川環境。"),
        (r"太陽能", "太陽能發電在日照充足時較有效率，陰雨或夜間供電會下降，因此需要搭配儲能或其他電源。"),
        (r"地熱|板塊", "臺灣位於板塊交界，地底熱能豐富，具有發展地熱發電的條件，但探勘與建置成本較高。"),
        (r"沼氣", "沼氣可由有機廢棄物產生並用來發電，但處理不當的氣味可能影響附近居民。"),
        (r"核能|核廢料|蘭嶼|福島", "核能可大量供電，但核廢料處置與事故風險需要長期管理；政策也必須和受影響居民充分溝通。"),
        (r"電燈|1895|水力與火力|發電設備", "日本統治時期增設水力與火力發電設備，電燈與電力逐漸進入城市及生活，但供電系統仍需維護。"),
    ],
    "5B-U4": [
        (r"消費者保護法|1950|瑕疵|產品", "遇到瑕疵商品可保留交易證明、向業者反映，並依消費者保護法或撥打 1950 尋求協助。"),
        (r"詐騙|165|假包裹|中獎", "可疑中獎、轉帳或假包裹訊息可能是詐騙；不要急著付款，應利用 165 等正式管道查證。"),
        (r"風險|投資|獲利|虧損", "投資報酬並不保證，風險是結果可能獲利也可能虧損；選擇前要評估自己能承受的損失。"),
        (r"流行|消費活動", "消費會受到需求、價格、品質、廣告與同儕流行等因素影響，仍應先判斷是否真正需要。"),
        (r"循環經濟|零汙染|零浪費|共享", "循環經濟重視減少廢棄、延長物品使用時間並回收再利用，目標是降低資源消耗與污染。"),
        (r"購買|消費者|考量", "負責任的消費不能只看價格，還要比較需求、品質、權益、風險與產品對環境的影響。"),
    ],
}

UNIT_DEFAULTS = {
    "5A-U1": "這題要用臺灣的位置、地形或考古證據判斷，不能只靠印象。",
    "5A-U2": "這題要分清族群文化、生活規範與法律的差異，並尊重資料所指的對象。",
    "5A-U3": "這題要把資源來源、生產方式與環境影響放在一起判斷。",
    "5A-U4": "這題要核對大航海時代的人物、地點與事件先後。",
    "5B-U1": "這題要從清代移民、開墾、族群互動與地方生活的背景判斷。",
    "5B-U2": "這題要連結開港、戰爭、政策與港市發展的因果。",
    "5B-U3": "這題要比較發電方式的條件、限制與對居民或環境的影響。",
    "5B-U4": "這題要從消費權益、詐騙風險、理財或循環利用的角度判斷。",
}

SEMANTIC_RULES = {
    "5A-U2": [(r"祭師.*漢人|漢人.*祭師", "祭師與漢人信仰")],
    "5A-U3": [(r"大理石礦.*產地|大理石礦.*地區", "大理石產地")],
    "5B-U1": [(r"新竹.*米粉|米粉.*新竹", "新竹米粉")],
    "5B-U2": [
        (r"第一任巡撫", "首任巡撫"),
        (r"牡丹社事件.*治理態度|牡丹社事件.*渡臺限制|治理態度.*牡丹社事件", "牡丹社後治理"),
        (r"大稻埕.*茶葉|茶葉.*大稻埕", "大稻埕茶葉"),
    ],
    "5B-U3": [(r"日本.*核災|福島核災", "日本核災原因")],
    "5B-U4": [
        (r"網路詐騙.*增加|詐騙件數.*攀升", "網路詐騙增加"),
        (r"1950|哪個專線.*商品", "消費申訴專線"),
        (r"消費者保護法", "消保法"),
        (r"風險.*定義|稱為什麼.*風險|無法確定.*獲利.*虧損", "投資風險定義"),
        (r"風險最高|風險相對較高", "高風險投資")
    ],
}


def semantic_key(question):
    text = question["prompt"] + "".join(question["options"])
    for pattern, key in SEMANTIC_RULES.get(question["unitKey"], []):
        if re.search(pattern, text):
            return key
    return question["prompt"]


def select_questions(rows):
    grouped = defaultdict(lambda: defaultdict(list))
    for row in rows:
        if row["unitKey"] not in UNIT_ORDER or EXCLUDED_CONTEXT.search(row["prompt"]):
            continue
        if any("以上" in option for option in row["options"]):
            continue
        grouped[row["unitKey"]][row["paperType"]].append(row)
    selected = {}
    type_order = ["隨堂卷", "月考卷A", "月考卷B"]
    for unit_key in UNIT_ORDER:
        pools = grouped[unit_key]
        items = []
        used_semantics = set()
        cursor = 0
        while len(items) < 15:
            progressed = False
            for paper_type in type_order:
                pool = pools[paper_type]
                if cursor < len(pool):
                    candidate = pool[cursor]
                    key = semantic_key(candidate)
                    if key not in used_semantics:
                        items.append(candidate)
                        used_semantics.add(key)
                    progressed = True
                    if len(items) == 15:
                        break
            if not progressed:
                break
            cursor += 1
        if len(items) != 15:
            raise ValueError(f"{unit_key} 只有 {len(items)} 題符合自足題目條件")
        selected[unit_key] = items
    return selected


def fact_for(question):
    text = question["prompt"] + "".join(question["options"])
    for pattern, fact in FACT_RULES[question["unitKey"]]:
        if re.search(pattern, text):
            return fact
    return UNIT_DEFAULTS[question["unitKey"]]


def hint_for(prompt):
    if "錯誤" in prompt or "不正確" in prompt or "不是" in prompt or "不屬於" in prompt:
        return "先圈出題幹中的否定詞，再逐一檢查四個選項。"
    if re.search(r"哪一位|誰|人物", prompt):
        return "把人物和他參與的事件、政策或地點配對。"
    if re.search(r"哪一個地區|哪個地區|位於|位置|哪一座島", prompt):
        return "先找題幹的方向或地點線索，再和課本地圖對照。"
    if re.search(r"原因|因素|導致|影響", prompt):
        return "找出題幹中的原因與結果，檢查兩者是否能連起來。"
    if re.search(r"法律|規範|專線", prompt):
        return "想想這個情境要保護什麼權利，以及應使用哪個正式管道。"
    return "抓住題幹的關鍵詞，再比較每個選項和課本內容是否相符。"


def explanation_for(question, fact, index):
    answer = question["options"][question["answerIndex"]]
    styles = [
        f"關鍵答案是「{answer}」。{fact}",
        f"依課本內容，這題應選「{answer}」。{fact}",
        f"把題幹線索和課本資料對照，可找到「{answer}」。{fact}",
        f"「{answer}」最符合題目所問的時間、地點或概念。{fact}",
        f"判斷重點不在字數，而在內容是否符合課本；答案是「{answer}」。{fact}",
    ]
    return styles[index % len(styles)]


def feedback_for(question, fact, index):
    answer = question["options"][question["answerIndex"]]
    correct_styles = [
        f"答對了，「{answer}」和題幹線索相符。{fact}",
        f"判斷正確！你找到了「{answer}」這個關鍵。{fact}",
        f"沒錯，課本中的相關資料支持「{answer}」。{fact}",
        f"這項選擇成立；「{answer}」符合題目要求。{fact}",
    ]
    wrong_styles = [
        "「{option}」沒有符合題幹限定的條件。正確方向是「{answer}」；{fact}",
        "先不要選「{option}」。把人物、地點或概念重新配對後，應是「{answer}」。{fact}",
        "「{option}」是干擾資料，和本題線索對不上；請改從「{answer}」思考。{fact}",
        "這題不是在找「{option}」。對照課本後，「{answer}」才符合題意。{fact}",
        "選項「{option}」混入了不同背景的資料。回看題幹，應選「{answer}」。{fact}",
    ]
    output = []
    for choice, option in enumerate(question["options"]):
        if choice == question["answerIndex"]:
            output.append(correct_styles[index % len(correct_styles)])
        else:
            output.append(wrong_styles[(index + choice) % len(wrong_styles)].format(option=option, answer=answer, fact=fact))
    return output


def build_bank(selected):
    bank = {}
    all_items = [(unit_key, item) for unit_key in UNIT_ORDER for item in selected[unit_key]]
    for unit_index, unit_key in enumerate(UNIT_ORDER):
        bank[unit_key] = []
        for index, source in enumerate(selected[unit_key]):
            fact = fact_for(source)
            answer = source["options"][source["answerIndex"]]
            other = [item for other_key, item in all_items if other_key != unit_key]
            evidence_wrong = []
            offset = (unit_index * 19 + index * 7) % len(other)
            for step in range(len(other)):
                candidate = fact_for(other[(offset + step) % len(other)])
                if candidate != fact and candidate not in evidence_wrong:
                    evidence_wrong.append(candidate)
                if len(evidence_wrong) == 2:
                    break
            evidence = [
                {"text": fact, "correct": True, "feedback": f"這項說明能直接支持「{answer}」，也補上題目背後的課本知識。"},
                {"text": evidence_wrong[0], "correct": False, "feedback": "這項知識本身可能正確，但屬於其他單元，不能用來證明本題答案。"},
                {"text": evidence_wrong[1], "correct": False, "feedback": "這段資料談的是另一個主題，和目前題幹缺少直接關係。"},
            ]
            bank[unit_key].append({
                "id": f"{unit_key}-Q{index + 1:02d}",
                "unitKey": unit_key,
                "objectiveId": f"{unit_key}-PAPER",
                "questionType": source["paperType"],
                "prompt": source["prompt"],
                "options": source["options"],
                "answerIndex": source["answerIndex"],
                "claim": answer,
                "hint": hint_for(source["prompt"]),
                "explanation": explanation_for(source, fact, index),
                "optionFeedback": feedback_for(source, fact, index),
                "misconceptionByChoice": ["判斷正確" if choice == source["answerIndex"] else "題幹條件配對錯誤" for choice in range(4)],
                "evidenceOptions": evidence,
                "transferContext": "回到課本地圖、時間線或表格，找出能再次驗證這個答案的資料。",
                "sourceFile": source["sourceFile"],
                "sourceQuestionNumber": source["sourceQuestionNumber"],
                "sourceSequence": source["sourceSequence"],
            })
    return bank


def main():
    data = json.loads(INPUT.read_text(encoding="utf-8"))
    selected = select_questions(data["questions"])
    bank = build_bank(selected)
    SELECTED.write_text(json.dumps(selected, ensure_ascii=False, indent=2), encoding="utf-8")
    source = "(function(){\n\"use strict\";\n/* 題目原文取自使用者提供的月考卷 A、月考卷 B 與隨堂卷；解析依課本單元內容整理。 */\nconst bank="
    source += json.dumps(bank, ensure_ascii=False, separators=(",", ":"))
    source += ";\nwindow.GUARDIAN_QUESTION_BANK=bank;\n})();\n"
    OUTPUT.write_text(source, encoding="utf-8")
    print("已建立 8 單元 × 15 題，共 120 題。")
    for unit_key in UNIT_ORDER:
        types = defaultdict(int)
        for item in selected[unit_key]:
            types[item["paperType"]] += 1
        print(unit_key, dict(types))


if __name__ == "__main__":
    main()
