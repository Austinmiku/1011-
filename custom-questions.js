"use strict";
/* Teacher files are parsed locally. Only reviewed, valid questions are published. */
(function (root) {
  const MAX_QUESTIONS = 2000, MAX_BYTES = 20 * 1024 * 1024;
  const TRUE_FALSE = "是非題", CHOICE = "單選題", UNSUPPORTED = "不支援題型";
  const truthOptions = ["是", "否"];
  const truthType = /^(?:是非題?|判斷題?|對錯題?|true.?false|boolean)$/i;
  const yesMarks = "正確|TRUE|[○◯〇⭕O√✓✔VT是對圈]", noMarks = "錯誤|FALSE|[×✕✖✗✘╳XFㄨ否錯叉]";
  const trueMark = new RegExp(`^(?:${yesMarks})$`, "u"), falseMark = new RegExp(`^(?:${noMarks})$`, "u");
  const truthMarks = yesMarks + "|" + noMarks;
  // The same circled digits can be exported as Wingdings or dingbat glyphs.
  const normalizeMarks = value => String(value ?? "")
    .replace(/[\uF081-\uF089]/g, c => String.fromCodePoint(c.charCodeAt(0) - 0xF081 + 9312))
    .replace(/[\u2780-\u2788]/g, c => String.fromCodePoint(c.charCodeAt(0) - 0x2780 + 9312))
    .replace(/\uF0A1/g, "○").replace(/\uF0CF/g, "×")
    .replace(/\uF0B0/g, "°");
  const text = value => normalizeMarks(value).normalize("NFKC").trim();
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function truthAnswerIndex(value) {
    const mark = text(value).toUpperCase().replace(/^(?:正確答案|標準答案|答案|解答|正解)\s*[:：]?\s*/, "")
      .replace(/^\(\s*|\s*[).、]+$/g, "").replace(/[\uFE0E\uFE0F]/g, "").trim();
    if (trueMark.test(mark)) return 0;
    if (falseMark.test(mark)) return 1;
    return -1;
  }
  function isTruthPair(options) {
    if (options.length !== 2) return false;
    const marks = options.map(truthAnswerIndex);
    return marks.includes(0) && marks.includes(1);
  }
  const answerIndex = value => {
    const match = text(value).toUpperCase().match(/^(?:(?:正確答案|標準答案|答案|解答|正解|選項)\s*[:：]?\s*)?[（(]?([A-D1-4])[)）.、]?$/);
    if (!match) return -1;
    const char = match[1];
    return /[A-D]/.test(char) ? char.charCodeAt(0) - 65 : Number(char) - 1;
  };
  function optionAnswerIndex(value, options, implicitTruth = false) {
    if (implicitTruth) return truthAnswerIndex(value);
    const mark = truthAnswerIndex(value);
    if (mark >= 0 && isTruthPair(options)) return options.findIndex(option => truthAnswerIndex(option) === mark);
    const position = answerIndex(value);
    return position >= 0 ? position : options.indexOf(text(value));
  }
  function validate(raw) {
    if (!raw || typeof raw !== "object") return { reason: "題目格式不符" };
    const prompt = text(raw.prompt), given = Array.isArray(raw.options) ? raw.options.map(text) : [], type = text(raw.type);
    const taggedTruth = truthType.test(type), binary = taggedTruth || isTruthPair(given);
    const implicitTruth = binary && given.length === 0, options = implicitTruth ? truthOptions : given;
    if (type && !taggedTruth && !/^(?:單選題?|選擇題?|四選一|single|choice)$/i.test(type)) return { reason: "題型須為是非題或四選一題" };
    if (raw.answerConflict) return { reason: "同一題的答案標示不一致" };
    if (raw.requiresImage === true) return { reason: "題目需要圖片或圖表，目前僅匯入純文字題" };
    if (!prompt || prompt.length > 4000) return { reason: "題幹空白或過長" };
    if (binary && !isTruthPair(options)) return { reason: "是非題的選項須各有一個是和否" };
    if (!binary && (options.length !== 4 || options.some(v => !v || v.length > 1000) || new Set(options).size !== 4)) return { reason: "選項須恰好四個，且不可空白或重複" };
    const index = Number.isInteger(raw.answerIndex) ? raw.answerIndex : optionAnswerIndex(raw.answer, options, implicitTruth);
    if (index < 0 || index >= options.length) return { reason: binary ? "請標示是非題的正確答案（是／否或○／×）" : "缺少單一正確答案（A～D 或 1～4）" };
    const explanation = text(raw.explanation).slice(0, 4000);
    const provided = Array.isArray(raw.optionFeedback) ? raw.optionFeedback : [];
    const order = binary && truthAnswerIndex(options[0]) === 1 ? [1, 0] : options.map((_, i) => i);
    const labels = binary ? truthOptions : options;
    return { question: { prompt, options: [...labels], answerIndex: order.indexOf(index), explanation,
      optionFeedback: order.map((original, i) => text(text(provided[original]).slice(0, 1000) || (original === index ? (explanation || `答案是「${labels[i]}」。`) : `「${labels[i]}」不是本題答案。${explanation || "請重新閱讀題目，再試一次。"}`))) } };
  }
  function collect(candidates) {
    const questions = [], skipped = [], seen = new Set();
    for (const candidate of candidates) {
      const result = validate(candidate), key = result.question && result.question.prompt.replace(/\s+/g, " ");
      if (result.reason) skipped.push({ source: candidate.source || "", reason: result.reason });
      else if (seen.has(key)) skipped.push({ source: candidate.source || "", reason: "重複題目" });
      else { seen.add(key); questions.push(result.question); }
    }
    if (questions.length > MAX_QUESTIONS) throw new Error(`一次最多匯入 ${MAX_QUESTIONS} 題，請拆成不同題庫。`);
    return { questions, skipped };
  }
  // Preserve circled choices before NFKC turns ① into an unmarked 1.
  const documentText = value => normalizeMarks(value).replace(/[○◯][ \t\u3000]*([1-9１-９])/g, (_, n) => String.fromCodePoint(9311 + Number(n.normalize("NFKC")))).replace(/[①②③④⑤⑥⑦⑧⑨]/g, c => `\uE000${c.codePointAt(0) - 9311}\uE001`).normalize("NFKC")
    .replace(/\uE000([1-9])\uE001/g, (_, n) => String.fromCodePoint(9311 + Number(n))).replace(/\r/g, "").trim();
  const tidy = value => documentText(value).replace(/([\u3400-\u9FFF])\s+(?=[\u3400-\u9FFF])/g, "$1").replace(/\s+([，。！？；：,.!?;:])/g,"$1").replace(/([，。！？；：,.!?;:])\s*\n\s*(?=[\u3400-\u9FFF])/g,"$1").trim();
  function majorHeading(value) {
    const line = documentText(value);
    if (line.includes("\n")) return null;
    const compact = line.replace(/[ \t]/g, "").replace(/^[◎◆●\u203B]/, ""), numbered = compact.match(/^[一二三四五六七八九十]+[、.](.+)$/);
    const title = numbered ? numbered[1] : compact.replace(/^\d+[、.]/, "");
    const choiceTitle = /^(?:選擇題|單選題|四選一|單題)(?:[(:：、,]|$)/.test(title);
    const truth = /^(?:是非題|判斷題|對錯題)(?:[(:：、,]|$)/.test(title);
    if (!numbered && !choiceTitle && !truth && !/^(?:問答題|簡答題|填充題|配合題|勾選題|複選題|多選題|閱讀題組|閱讀測驗|題組題?)(?:[(:：、,]|$)/.test(title)) return null;
    return { title, type: truth ? TRUE_FALSE : choiceTitle && !/複選|多選|勾選/.test(title) ? CHOICE : UNSUPPORTED };
  }
  const playable = type => type === TRUE_FALSE || type === CHOICE;
  const questionNeedsImage = prompt => /[上下左右][圖表]|附圖|如圖|圖片中|圖中|[圖表]\([一二三四五六七八九十\d]+\)|圖表(?:中|後|的解讀)|看圖|依(?:據|照)?圖表|哪(?:一)?個符號表示/.test(text(prompt).replace(/\s/g, ""));
  function answerKeys(value, type = CHOICE) {
    const keys = new Map(), lines = text(value).split("\n");
    const parse = type === TRUE_FALSE ? truthAnswerIndex : answerIndex;
    const add = (number, answer) => {
      const key = Number(number), mark = parse(answer);
      keys.set(key, keys.has(key) && keys.get(key) !== mark ? -1 : mark);
    };
    const mark = type === TRUE_FALSE ? truthMarks : "[A-D1-4]";
    const afterSpace = type === TRUE_FALSE ? truthMarks : "[A-D]";
    const pair = new RegExp(String.raw`(\d{1,4})(?:[ \t]*[.、:)\-][ \t]*|[ \t]+(?=\(?(?:${afterSpace})))\(?(${mark})\)?(?:[ \t,;]+|$)`, "gi");
    lines.forEach((line, i) => {
      const numbers = line.trim().match(/^(?:題號|題次|編號)[ \t]+(.+)$/)?.[1]?.split(/\s+/);
      const answers = lines[i + 1]?.trim().match(/^(?:答案|解答)[ \t]+(.+)$/)?.[1]?.split(/\s+/);
      if (numbers && answers && numbers.length === answers.length && numbers.every(n => /^\d+$/.test(n)) && answers.every(a => parse(a) >= 0)) {
        numbers.forEach((n, j) => add(n, answers[j]));
      }
      if (!line.trim().replace(pair, "").trim()) {
        for (const match of line.trim().matchAll(pair)) add(match[1], match[2]);
      }
    });
    return keys;
  }
  function splitChoices(value, explicitAnswer = "", type = CHOICE) {
    const block = documentText(value);
    const end = block.search(/(?:正確答案|標準答案|答案|解答|正解|解析|說明|answer|explanation)\s*[:：]/i);
    let body = end < 0 ? block : block.slice(0, end);
    let labels = [...body.matchAll(/(?:[（(]\s*([A-E1-5])\s*[)）]|\b([A-E])[.、:：]|([①②③④⑤]))\s*/g)];
    const inline = block.match(/(?:正確答案|標準答案|答案|解答|正解|answer)\s*[:：]\s*([^\n。;；]+)/i)?.[1]?.split(/(?:解析|說明|explanation)\s*[:：]/i)[0].trim() || "";
    const explanation = block.match(/(?:解析|說明|explanation)\s*[:：]\s*([\s\S]*)/i)?.[1] || "";
    const outer = /[（(]\s*$/.test(body.slice(0, labels[0]?.index ?? 0));
    if (outer) {
      const open = body.slice(0,labels[0].index).search(/[（(]\s*$/);let depth=1,close=-1;
      for(let i=open+1;i<body.length;i++){if(/[（(]/.test(body[i]))depth++;else if(/[)）]/.test(body[i])&&!--depth){close=i;break}}
      if(close<0)return {prompt:tidy(body),options:[],answer:"",explanation:""};
      body=body.slice(0,close);labels=labels.filter(label=>label.index<close);
    }
    if (labels.length === 4) {
      const last = labels[3];
      const nextPage = body.indexOf("\f", last.index + last[0].length);
      if (nextPage >= 0 && /[。！？!?]\s*$/.test(body.slice(last.index, nextPage))) {
        const tail = body.slice(nextPage + 1).trim();
        // A chart may appear before its question in the PDF text order.
        if (/^\d{1,3}$/.test(tail) || /^(?:\d{1,3}[ \t]*\n)?(?:雨量|氣溫|溫度|月均溫|月雨量)\s*\(/.test(tail)) {
          body = body.slice(0, nextPage);
        }
      }
    }
    const order = labels.map(m => m[3] ? m[3].codePointAt(0) - 9312 : /[A-E]/.test(m[1] || m[2]) ? (m[1] || m[2]).charCodeAt(0) - 65 : Number(m[1]) - 1);
    const found = labels.map((label, n) => tidy(body.slice(label.index + label[0].length, labels[n + 1]?.index ?? body.length)).replace(/。$/,""));
    const positions = order.join();
    const implicitTruth = type === TRUE_FALSE && labels.length < 2;
    const options = positions === "0,1,2,3" || positions === "0,1" || (type === TRUE_FALSE && !implicitTruth) ? found : [];
    const answer = explicitAnswer || inline;
    const answerConflict = Boolean(explicitAnswer && inline &&
      optionAnswerIndex(explicitAnswer, options, implicitTruth) !== optionAnswerIndex(inline, options, implicitTruth));
    return {prompt:tidy(implicitTruth ? body : body.slice(0, labels[0]?.index ?? body.length)).replace(outer ? /[（(]\s*$/ : /$^/, ""), options, answer, answerConflict, explanation:tidy(explanation)};
  }
  function documentCandidates(value, source = "PDF") {
    const content = normalizeMarks(value).replace(/\r/g, "");
    const section = content.search(/(?:^|\n)[ \t\u3000]*(?:參考答案|參考解答|選擇題答案|是非題答案|答案表|解答表|answer key|答案|解答)[ \t\u3000]*[:：]?[ \t\u3000]*(?=\n|$)/i);
    const body = documentText(section < 0 ? content : content.slice(0, section)).split("\n").map(line => {
      const heading = majorHeading(line);
      return heading ? `一、${heading.title}` : line;
    }).join("\n");
    const mark = String.raw`\([ \t]*([A-D1-4①②③④0]|${truthMarks})?[ \t]*\)`;
    const numberPattern = String.raw`(?:([0-9](?:[ \t]*[0-9]){0,3})[ \t]*[.、)]|第[ \t]*([0-9](?:[ \t]*[0-9]){0,3})[ \t]*題)`;
    const pattern = new RegExp(String.raw`(?:^|\n)[ \t]*(?:([一二三四五六七八九十]+[ \t]*[、.][^\n]*)|(?:${mark}[ \t]*)?${numberPattern}[ \t]*(?:${mark}[ \t]*)?)`, "gi");
    const tokens = [...body.matchAll(pattern)], candidates = [];
    let type = tokens.some(token => token[1]) ? UNSUPPORTED : CHOICE;
    tokens.forEach((token, i) => {
      if (token[1]) {
        type = majorHeading(token[1]).type;
        return;
      }
      const number = (token[3] || token[4]).replace(/[ \t]/g, "");
      const question = splitChoices(body.slice(token.index + token[0].length, tokens[i + 1]?.index ?? body.length), token[2] || token[5] || "", type);
      const kind = type === CHOICE && isTruthPair(question.options) ? TRUE_FALSE : type;
      if (token[2] && token[5]) {
        const implicit = kind === TRUE_FALSE && !question.options.length;
        question.answerConflict ||= optionAnswerIndex(token[2], question.options, implicit) !== optionAnswerIndex(token[5], question.options, implicit);
      }
      const requiresImage = questionNeedsImage(question.prompt);
      candidates.push({...question,number:Number(number),requiresImage,type:kind,source:`${source} 第 ${number} 題`});
    });
    if (section >= 0) applyAnswerKeys(candidates, detachedKeys(content.slice(section)));
    return candidates;
  }
  const signature = q => JSON.stringify([q.prompt, ...q.options].map(s => text(s).replace(/\s+/g, "")));
  function detachedKeys(value) {
    const lines = normalizeMarks(value).replace(/\r/g, "").split("\n");
    const byType = { [CHOICE]: [], [TRUE_FALSE]: [] };
    let type = "";
    for (const line of lines) {
      const heading = majorHeading(line);
      const keyTitle = (heading?.title || line.replace(/\s/g, "")).match(/^(是非題|選擇題)(?:答案|解答)[:：]?$/)?.[1];
      if (heading || keyTitle) type = keyTitle ? (keyTitle === TRUE_FALSE ? TRUE_FALSE : CHOICE) : heading.type;
      else {
        if (!type || type === CHOICE) byType[CHOICE].push(line);
        if (!type || type === TRUE_FALSE) byType[TRUE_FALSE].push(line);
      }
    }
    // Multiple unlabelled letters on a row can belong to different subjects.
    const ambiguous = byType[CHOICE].some(line => /^\s*\d{1,4}[ \t]+(?:[A-D][ \t]+)+[A-D][ \t]*$/i.test(line));
    return {
      [CHOICE]: ambiguous ? new Map() : answerKeys(byType[CHOICE].join("\n")),
      [TRUE_FALSE]: answerKeys(byType[TRUE_FALSE].join("\n"), TRUE_FALSE)
    };
  }
  function applyAnswerKeys(candidates, keys, filled = new Map()) {
    const numbers = new Map(), questionKey = candidate => `${candidate.type}:${candidate.number}`;
    for (const candidate of candidates) {
      const key = questionKey(candidate);
      if (playable(candidate.type)) numbers.set(key, (numbers.get(key) || 0) + 1);
    }
    let matched = 0;
    for (const candidate of candidates) {
      const { question } = validate({...candidate, answerIndex:0});
      if (!question) continue;
      const fromTable = numbers.get(questionKey(candidate)) === 1 ? keys?.[candidate.type]?.get(candidate.number) : undefined;
      const index = filled.get(signature(question)) ?? fromTable;
      if (index === undefined) continue;
      if (index === -1) { candidate.answerConflict = true; continue; }
      matched++;
      const existing = validate(candidate).question?.answerIndex;
      if (existing !== undefined && existing !== index) candidate.answerConflict = true;
      else candidate.answerIndex = question.options.length === 2 && candidate.options.length
        ? candidate.options.findIndex(option => truthAnswerIndex(option) === index) : index;
    }
    return matched;
  }
  function applyAnswerSheet(candidates, answerText) {
    const filled = new Map();
    for (const candidate of documentCandidates(answerText, "答案卷")) {
      const { question } = validate(candidate);
      if (!question) continue;
      const key = signature(question), index = question.answerIndex;
      filled.set(key, filled.has(key) && filled.get(key) !== index ? -1 : index);
    }
    return applyAnswerKeys(candidates, filled.size ? null : detachedKeys(answerText), filled);
  }
  function fromPdfText(value, answerText = "", source = "PDF") {
    const candidates = documentCandidates(value, source);
    const matched = answerText ? applyAnswerSheet(candidates, answerText) : 0;
    const result = collect(candidates);
    result.formats = ["文字試卷自動分題"];
    if (matched) result.formats.push("搭配答案卷核對");
    else if (answerText && !result.skipped.some(q => q.reason.includes("不一致"))) {
      result.skipped.unshift({ source: "答案卷", reason: "未配對到答案。請使用同一份試卷的已填答案版，或單科題號答案表。" });
    }
    if (documentText(value).split("\n").some(line=>majorHeading(line)?.type === CHOICE)) result.formats.unshift("優先擷取選擇題大題");
    if (!result.questions.length && !result.skipped.length) result.skipped.push({source,reason:"無法辨識題號與選項，請核對試卷文字"});
    return result;
  }
  const paperReminder = /^(?:第\d{1,3}頁|翻面繼續作答|繼續寫第[一二三四五六七八九十\d]+頁|請(?:再)?仔細檢查(?:答案)?[!！。]?|背面還有題目[喔哦]?[!！。]?|還有一張加油[!！。]?)$/;
  const stripVerticalReminder = value => value.replace(/(?:^|\n)[ \t]*請\s*(?:再\s*)?仔\s*細\s*檢\s*查(?:\s*答\s*案)?\s*[!！。]?[ \t]*(?=\n|$)/g,"\n");
  function fromExamSections(chosen, sections, answerText = "") {
    const choiceSections = chosen.filter(({ type }) => type === "選擇題" || type === TRUE_FALSE || type === "待分類");
    if (!choiceSections.length) return null;
    const paper = choiceSections.map(({ type, body }) => {
      const lines = stripVerticalReminder(body).split("\n").filter(line => !paperReminder.test(tidy(line).replace(/\s/g, "")));
      return [type === "待分類" ? "" : type, ...lines].join("\n");
    }).join("\n");
    const key = sections.filter(({ type }) => type === "答案").map(({ title, body }) => [title, body].join("\n")).join("\n").trim();
    return fromPdfText(key ? paper + "\n答案表\n" + key : paper, answerText, "試卷");
  }
  function fromRows(sheets) {
    const candidates = [], skipped = [], formats = new Set(), keys = new Map();
    const key = value => text(value).toLowerCase().replace(/\([^)]*\)/g, "").replace(/[\s_:：]/g, "");
    const aliases = {prompt:["題目","題幹","問題","試題","試題內容","題目內容","題目及選項","題目與選項","prompt","question","questiontext"],answer:["答案","正確答案","標準答案","正解","解答","答案代號","answer","correct","correctanswer"],number:["題號","題次","編號","序號","no","id","questionid"],explanation:["解析","詳解","解釋","題目解析","explanation"],type:["題型","類型","type"]};
    const tables = sheets.map(sheet => {
      const header = sheet.rows.findIndex(row => row.some(v => aliases.prompt.includes(key(v))) || (row.some(v => aliases.answer.includes(key(v))) && row.some(v => aliases.number.includes(key(v)))));
      const headers = header < 0 ? [] : sheet.rows[header].map(key), find = names => headers.findIndex(h => names.includes(h));
      const named = majorHeading(sheet.name), rowHeadings = sheet.rows.map(row=>{const cells=row.filter(v=>text(v));return cells.length<=3 ? majorHeading(cells.join(" ")) : null});
      let active = named?.type || "";
      const sections = rowHeadings.map(heading => {
        if (heading) { active = heading.type; return null; }
        return active;
      });
      const columns = Object.fromEntries(Object.entries(aliases).map(([name, list]) => [name,find(list)]));
      const hasPlayable = playable(named?.type) || rowHeadings.some(h=>playable(h?.type)) || (header < 0 && sheet.rows.some(row=>row.filter(v=>text(v)).length===1 && row.some(v=>documentText(v).split("\n").some(line=>playable(majorHeading(line)?.type)))));
      const hasTaggedTruth = columns.type >= 0 && sheet.rows.slice(header + 1).some(row => truthType.test(text(row[columns.type])));
      return {sheet,header,headers,find,named,sections,hasPlayable,hasTaggedTruth,columns};
    });
    const hasTypedSection = tables.some(t=>t.hasPlayable);
    const accepts = (table, index) => {
      const type = table.sections[index];
      if (playable(type)) return true;
      return type === "" && (!hasTypedSection || truthType.test(text(table.sheet.rows[index][table.columns.type])));
    };
    if (hasTypedSection) formats.add("優先擷取選擇題及是非題大題");
    tables.filter(t => t.columns.prompt < 0 && t.columns.answer >= 0 && t.columns.number >= 0).forEach(t => {
      t.sheet.rows.slice(t.header + 1).forEach(row => { const n = text(row[t.columns.number]), answer = text(row[t.columns.answer]); if (!n || !answer) return; keys.set(n, keys.has(n) && keys.get(n) !== answer ? "" : answer); });
    });
    const numbers = new Map();
    tables.filter(t => t.columns.prompt >= 0).forEach(t => t.sheet.rows.slice(t.header + 1).forEach((row,i) => { const n = text(row[t.columns.number]); if (accepts(t,t.header+i+1) && n && text(row[t.columns.prompt])) numbers.set(n, (numbers.get(n) || 0) + 1); }));
    for (const t of tables) {
      const {sheet,header,headers,find,columns} = t;
      if (columns.prompt < 0 && columns.answer >= 0 && columns.number >= 0) { formats.add("獨立答案表配對"); continue; }
      if (hasTypedSection && !t.hasPlayable && !t.hasTaggedTruth) {skipped.push({source:sheet.name,reason:"此工作表未標示可用的選擇題或是非題"});continue;}
      if (header < 0) {
        const rows = sheet.rows.flatMap((row, i) => {
          if (!accepts(t,i) || !row.some(v => text(v))) return [];
          const cells = [...row];
          while (cells.length && !text(cells.at(-1))) cells.pop();
          return [{ cells, type: t.sections[i], source: `${sheet.name} 第 ${i + 1} 列` }];
        });
        const positional = rows.map(({cells, type, source}) => {
          const binary = type === TRUE_FALSE;
          const offset = cells.length === (binary ? 3 : 7) && /^\d+$/.test(text(cells[0])) ? 1 : 0;
          const expected = binary ? 2 : 6;
          return cells.length - offset === expected
            ? {prompt:cells[offset],options:binary ? [] : cells.slice(offset+1,offset+5),answer:cells.at(-1),source,type}
            : null;
        });
        if (positional.length && positional.every(Boolean)) {
          candidates.push(...positional);
          formats.add("無表頭題庫");
        } else {
          const copy = [t.named?.title || "", ...sheet.rows.map(row => row.filter(v => text(v)).join("\n"))].join("\n");
          const found = documentCandidates(copy,sheet.name);
          if (found.length) {candidates.push(...found);formats.add("試卷文字自動分題");} else skipped.push({source:sheet.name,reason:"無法辨識題目與選項欄位；可改用範本或附題號的試卷格式"});
        }
        continue;
      }
      formats.add("自動辨識 Excel 欄位");
      const optColumns = [0,1,2,3].map(n => find([String.fromCharCode(97 + n),`選項${String.fromCharCode(97 + n)}`,`選項${n + 1}`,`選項${"一二三四"[n]}`,`選項${"甲乙丙丁"[n]}`,`答案${String.fromCharCode(97 + n)}`,`option${String.fromCharCode(97 + n)}`,`option${n + 1}`]));
      const merged = find(["選項","所有選項","答案選項","options","choices"]);
      const extra = headers.map((h,i) => /^(?:選項|option|答案)?(?:[e-z]|[5-9]|\d{2,}|五|戊)$/.test(h) ? i : -1).filter(i => i >= 0);
      sheet.rows.slice(header + 1).forEach((row,i) => {
        if (!accepts(t,header+i+1) || row.every(v => !text(v))) return;
        const n = text(row[columns.number]), answer = text(row[columns.answer]) || (numbers.get(n) === 1 ? keys.get(n) : "") || "";
        const type = row[columns.type] || t.sections[header+i+1];
        let options = optColumns.map(c => c < 0 ? "" : row[c]);
        if (truthType.test(text(type)) && !options.some(value => text(value))) options = [];
        else if (!options.slice(2).some(value => text(value)) && isTruthPair(options.slice(0,2))) options = options.slice(0,2);
        let question = {prompt:row[columns.prompt],options,answer};
        if (optColumns.every(c => c < 0) && (merged >= 0 || !truthType.test(text(type)))) {
          question = splitChoices(`${documentText(row[columns.prompt])}\n${merged < 0 ? "" : documentText(row[merged])}`,answer,truthType.test(text(type)) ? TRUE_FALSE : CHOICE);
          formats.add("合併題目與選項拆分");
        }
        if (extra.some(c => text(row[c]))) question.options.push("額外選項");
        const feedback = [0,1,2,3].map(n => {const c=find([`解析${String.fromCharCode(97+n)}`,`選項${String.fromCharCode(97+n)}解析`,`feedback${String.fromCharCode(97+n)}`]);return c<0?"":row[c]});
        candidates.push({...question,explanation:row[columns.explanation] || question.explanation,type,optionFeedback:feedback,source:`${sheet.name} 第 ${header + i + 2} 列`});
      });
    }
    const result=collect(candidates.map(q=>({...q,requiresImage:q.requiresImage || questionNeedsImage(q.prompt)})));result.skipped.unshift(...skipped);result.formats=[...formats];return result;
  }
  const loading = new Map();
  const toolBase = document.currentScript?.src || document.baseURI;
  const toolReady = {
    "vendor/xlsx.full.min.js": () => typeof root.XLSX?.read === "function",
    "vendor/pdf.worker.js": () => !!root.pdfjsWorker?.WorkerMessageHandler,
    "vendor/pdf.js": () => typeof root.pdfjsLib?.getDocument === "function",
    "vendor/pdf-scan-codecs.js": () => !!root.GUARDIAN_PDF_SCAN_CODECS,
    "vendor/ocr/tesseract.min.js": () => typeof root.Tesseract?.createWorker === "function",
    "vendor/ocr/ocr-assets.js": () => typeof root.GUARDIAN_OCR_WORKER === "string",
  };
  function script(src) {
    if (toolReady[src]?.()) return Promise.resolve();
    if (!loading.has(src)) loading.set(src, new Promise((resolve, reject) => {
      const node = document.createElement("script"); node.src = new URL(src, toolBase).href;
      const failed = () => { loading.delete(src); node.remove(); reject(new Error(`讀取匯入工具失敗（${src}），請用 Chrome 或 Edge 開啟遊戲，並確認 vendor 資料夾完整。`)); };
      node.onload = () => toolReady[src]?.() ? resolve() : failed(); node.onerror = failed; document.head.append(node);
    }));
    return loading.get(src);
  }
  class PdfScanResources {
    async fetch({ kind, filename }) {
      if (kind !== "wasmUrl") throw new Error("未提供 PDF 字型資料。");
      await script("vendor/pdf-scan-codecs.js");
      const codecs = root.GUARDIAN_PDF_SCAN_CODECS;
      if (!Object.hasOwn(codecs, filename)) throw new Error("未提供此 PDF 圖片解碼工具。");
      return Uint8Array.from(atob(codecs[filename]), char => char.charCodeAt(0));
    }
  }
  async function readPdfText(file, label = "PDF", scanPage = null) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await script("vendor/pdf.worker.js"); await script("vendor/pdf.js");
    const task = root.pdfjsLib.getDocument({
      data: bytes, isEvalSupported: false, useSystemFonts: true, stopAtErrors: true,
      ...(scanPage && { BinaryDataFactory: PdfScanResources })
    });
    let pdf;
    try {
      pdf = await task.promise;
      if (pdf.numPages > 200) throw new Error("PDF 超過 200 頁，請拆開後匯入。");
      const pages = [], firstPageHeading = new Set();
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n), data = await page.getTextContent();
        let line = "", lastY = null, height = 12, lines = [];
        const flushLine = () => {if(line.trim())lines.push({text:line,y:lastY,height});line="";lastY=null;};
        for (const item of data.items) {
          if (typeof item.str !== "string") continue;
          const y = item.transform[5];
          if (lastY !== null && Math.abs(y - lastY) > 3 && line.trim()) flushLine();
          line += item.str + " "; lastY = y; height = item.height || 12;
          if (item.hasEOL) flushLine();
        }
        flushLine();
        const starts = lines.filter(row=>majorHeading(row.text) || /^\s*(?:\([A-D1-4①②③④○✕✓✗×OX\s]*\)\s*)?(?:\d(?:[ \t]*\d){0,3}[ \t]*[.、)]|第[ \t]*\d(?:[ \t]*\d){0,3}[ \t]*題)/.test(documentText(row.text)));
        const top = starts.length ? Math.max(...starts.map(row=>row.y+row.height)) : Infinity;
        if (scanPage) {
          const [, bottom, , ceiling] = page.view || [];
          const heading = [], body = [];
          for (const row of lines) {
            const compact = tidy(row.text).replace(/\s/g, "");
            const edgeNumber = /^\d{1,3}$/.test(compact) && (row.y < bottom + 32 || row.y > ceiling - 32);
            if (edgeNumber || paperReminder.test(compact)) continue;
            if (row.y > top) {
              if (n === 1) firstPageHeading.add(compact);
              else if (firstPageHeading.has(compact)) continue;
              // Some PDFs emit the heading after the last question.
              heading.push(row.text.trimEnd());
            } else body.push(row.text.trimEnd());
          }
          const printed = normalizeMarks(stripVerticalReminder([...heading, ...body].join("\n")));
          try {
            const hasText = (printed.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 25 ||
              (label === "答案卷" && (answerKeys(printed).size > 0 || answerKeys(printed, TRUE_FALSE).size > 0));
            pages.push(hasText ? printed : (await scanPage(page, n, pdf.numPages)) || printed);
          } finally {
            page.cleanup();
          }
          continue;
        }
        const pageText = lines.filter(row => {
          const compact = tidy(row.text).replace(/\s/g, "");
          return row.y <= top && !/^\d{1,3}$/.test(compact) && !paperReminder.test(compact);
        }).map(row => row.text).join("\n");
        // Vertical page reminders can be extracted as one character per line.
        const compact = pageText.replace(/\s/g, "");
        const cover = n === 1 && pdf.numPages > 1 && /方格內填寫/.test(compact) && /翻頁作答/.test(compact);
        if (!cover) pages.push(stripVerticalReminder(pageText));
        page.cleanup();
      }
      const all = pages.join(scanPage ? "\n\f\n" : "\n");
      if (scanPage) return all;
      if (all.replace(/\s/g, "").length < 15) throw new Error(`這份 ${label} 沒有可讀取文字，可能是掃描圖片。請改用文字 PDF 或 Excel 範本。`);
      return all;
    } finally { await task.destroy(); }
  }
  async function readFile(file, answerFile = null) {
    if (!file || file.size > MAX_BYTES) throw new Error("請選擇 20 MB 以內的 PDF 或 Excel 檔案。");
    if (answerFile && (!/\.pdf$/i.test(file.name) || !/\.pdf$/i.test(answerFile.name) || answerFile.size > MAX_BYTES)) {
      throw new Error("獨立答案卷請搭配 PDF 題目卷使用，每個檔案最多 20 MB。");
    }
    if (/\.pdf$/i.test(file.name)) {
      const paper = await readPdfText(file);
      const answers = answerFile ? await readPdfText(answerFile, "答案卷") : "";
      return fromPdfText(paper, answers);
    }
    if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("目前支援 .xlsx、.xls 與文字型 .pdf。");
    const bytes = new Uint8Array(await file.arrayBuffer());
    await script("vendor/xlsx.full.min.js");
    const workbook = root.XLSX.read(bytes, { type: "array", sheetRows: MAX_QUESTIONS + 100, cellHTML: false, cellFormula: false });
    if (workbook.SheetNames.some(name => workbook.Sheets[name]["!fullref"])) throw new Error("工作表列數過多，請整理成 2,000 題以內的檔案後再匯入。");
    return fromRows(workbook.SheetNames.map(name => ({ name, rows: root.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", raw: false }) })));
  }
  async function convertFile(file, answerFile = null) {
    const result = await readFile(file, answerFile);
    return {...result,fileName:file.name,answerFileName:answerFile?.name};
  }
  function standardRows(questions) {
    return [["題目","選項A","選項B","選項C","選項D","答案","解析","題型","解析A","解析B","解析C","解析D"],
      ...questions.map(q => [q.prompt, ...Array.from({length:4}, (_, i) => q.options[i] || ""),
        String.fromCharCode(65 + q.answerIndex), q.explanation, q.options.length === 2 ? TRUE_FALSE : CHOICE,
        ...Array.from({length:4}, (_, i) => q.optionFeedback[i] || "")])];
  }
  async function downloadStandard(questions) {
    await script("vendor/xlsx.full.min.js");
    const workbook = root.XLSX.utils.book_new(), sheet = root.XLSX.utils.aoa_to_sheet(standardRows(questions));
    sheet["!cols"] = [48,24,24,24,24,8,55,12,40,40,40,40].map(wch => ({wch}));
    root.XLSX.utils.book_append_sheet(workbook,sheet,"題庫");
    const bytes = root.XLSX.write(workbook,{bookType:"xlsx",type:"array"});
    const url = URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const a = document.createElement("a");a.href=url;a.download="轉換後題庫.xlsx";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function bankFrom(questions, count, enabled = true, version) {
    const id = version || (root.crypto?.randomUUID?.() || `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`).replace(/-/g, "");
    return { version: id, enabled: !!enabled, count, questions: questions.map((q, i) => ({ ...q, id: `C-${id.slice(0, 24)}-${i + 1}` })) };
  }
  function cleanBank(value) {
    if (!value || !Array.isArray(value.questions) || !value.questions.length || value.questions.length > MAX_QUESTIONS || !/^[a-f0-9]{12,40}$/i.test(value.version || "")) return null;
    const questions = value.questions.map(q => validate(q).question);
    if (questions.some(q => !q) || !Number.isInteger(value.count) || value.count < 1 || value.count > questions.length) return null;
    return bankFrom(questions, value.count, value.enabled === true, value.version);
  }
  function editorMarkup() {
    return `<div class="custom-import"><div data-digital-paper>${root.GUARDIAN_EXAM?.editorMarkup() || ""}</div><div data-import-preview></div><p role="status" aria-live="polite" data-bank-status hidden></p></div>`;
  }
  function bindEditor(host, initial = null) {
    let bank = cleanBank(initial);
    const find = selector => host.querySelector(selector);
    const status = find("[data-bank-status]"), preview = find("[data-import-preview]");
    const questionPreview = questions => `<div class="custom-preview">${questions.map((q, i) => `<article><b>${i + 1}. ${esc(q.prompt)}</b><ol type="A">${q.options.map((option, n) => `<li${n === q.answerIndex ? ' class="custom-correct"' : ""}>${esc(option)}${n === q.answerIndex ? " ✓" : ""}</li>`).join("")}</ol>${q.explanation ? `<p>${esc(q.explanation)}</p>` : ""}</article>`).join("")}</div>`;
    const message = value => { status.hidden = false; status.textContent = value; };
    function show() {
      if (!bank) { preview.innerHTML = ""; return; }
      preview.innerHTML = `<div class="custom-bank-settings"><label><input type="checkbox" data-custom-enabled${bank.enabled ? " checked" : ""}>開放「未知地點」隱藏關卡</label><label>本場題數（1～${bank.questions.length}）<input class="name-input" data-custom-count type="number" min="1" max="${bank.questions.length}" value="${bank.count}"></label><p>已採用 ${bank.questions.length} 題。每場隨機抽題且不重複，敵我血量最多 10，道具最高第 3 階。</p><details><summary>核對已採用的題目與答案</summary>${questionPreview(bank.questions)}</details><button class="link-button" type="button" data-custom-clear>移除本次題庫</button></div>`;
      find("[data-custom-clear]").onclick = () => { bank = null; show(); message("題庫已移除，儲存後生效。"); };
    }
    const exam = root.GUARDIAN_EXAM?.bindEditor(find("[data-digital-paper]"), {
      readPdfText, loadScript: script, maxBytes: MAX_BYTES, esc, readWorkbook: readFile,
      fromExamSections, questionPreview, downloadStandard,
      adopt(questions) {
        bank = bankFrom(questions, questions.length);
        show();
        message("請確認本場題數，再建立班級或儲存未知地點。");
        find("[data-custom-count]").focus();
      }
    });
    show();
    return { getBank() {
      exam?.checkReady();
      if (!bank) return null;
      const count = Number(find("[data-custom-count]").value);
      if (!Number.isInteger(count) || count < 1 || count > bank.questions.length) throw new Error(`自訂題數請輸入 1～${bank.questions.length} 的整數。`);
      return { ...bank, count, enabled: find("[data-custom-enabled]").checked };
    } };
  }
  root.GUARDIAN_CUSTOM = { validate, collect, fromRows, fromPdfText, fromExamSections, readFile, convertFile, standardRows, downloadStandard, bankFrom, cleanBank, editorMarkup, bindEditor };
})(typeof window !== "undefined" ? window : globalThis);
