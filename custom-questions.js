"use strict";
/* Teacher files are parsed locally. Only reviewed, valid four-choice questions are published. */
(function (root) {
  const MAX_QUESTIONS = 2000, MAX_BYTES = 20 * 1024 * 1024;
  // Some teacher PDFs expose Wingdings circled digits as private-use characters.
  const normalizeMarks = value => String(value ?? "").replace(/[\uF081-\uF089]/g, c => String.fromCodePoint(c.charCodeAt(0) - 0xF081 + 9312)).replace(/\uF0B0/g, "°");
  const text = value => normalizeMarks(value).normalize("NFKC").trim();
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const answerIndex = value => {
    const match = text(value).toUpperCase().match(/^(?:(?:正確答案|標準答案|答案|解答|正解|選項)\s*[:：]?\s*)?[（(]?([A-D1-4])[)）.、]?$/);
    if (!match) return -1;
    const char = match[1];
    return /[A-D]/.test(char) ? char.charCodeAt(0) - 65 : Number(char) - 1;
  };
  function validate(raw) {
    if (!raw || typeof raw !== "object") return { reason: "題目格式不符" };
    const prompt = text(raw.prompt), options = Array.isArray(raw.options) ? raw.options.map(text) : [];
    if (raw.type && !/^(?:單選題?|選擇題?|四選一|single|choice)$/i.test(text(raw.type))) return { reason: "不是四選一單選題" };
    if (raw.requiresImage === true) return { reason: "題目需要圖片或圖表，目前僅匯入純文字題" };
    if (!prompt || prompt.length > 4000) return { reason: "題幹空白或過長" };
    if (options.length !== 4 || options.some(v => !v || v.length > 1000) || new Set(options).size !== 4) return { reason: "選項須恰好四個，且不可空白或重複" };
    let index = Number.isInteger(raw.answerIndex) ? raw.answerIndex : answerIndex(raw.answer);
    if (index < 0 && text(raw.answer)) index = options.indexOf(text(raw.answer));
    if (index < 0 || index > 3) return { reason: "缺少單一正確答案（A～D 或 1～4）" };
    const explanation = text(raw.explanation).slice(0, 4000);
    const provided = Array.isArray(raw.optionFeedback) ? raw.optionFeedback : [];
    return { question: { prompt, options, answerIndex: index, explanation,
      optionFeedback: options.map((option, i) => text(text(provided[i]).slice(0, 1000) || (i === index ? (explanation || `答案是「${option}」。`) : `「${option}」不是本題答案。${explanation || "請重新閱讀題目，再試一次。"}`))) } };
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
  const documentText = value => normalizeMarks(value).replace(/[○◯]\s*([1-9１-９])/g, (_, n) => String.fromCodePoint(9311 + Number(n.normalize("NFKC")))).replace(/[①②③④⑤⑥⑦⑧⑨]/g, c => `\uE000${c.codePointAt(0) - 9311}\uE001`).normalize("NFKC")
    .replace(/\uE000([1-9])\uE001/g, (_, n) => String.fromCodePoint(9311 + Number(n))).replace(/\r/g, "").trim();
  const tidy = value => documentText(value).replace(/([\u3400-\u9FFF])\s+(?=[\u3400-\u9FFF])/g, "$1").replace(/\s+([，。！？；：,.!?;:])/g,"$1").replace(/([，。！？；：,.!?;:])\s*\n\s*(?=[\u3400-\u9FFF])/g,"$1").trim();
  function majorHeading(value) {
    const line = documentText(value);
    if (line.includes("\n")) return null;
    const compact = line.replace(/[ \t]/g, ""), numbered = compact.match(/^[一二三四五六七八九十]+[、.](.+)$/);
    const title = numbered ? numbered[1] : compact.replace(/^\d+[、.]/, "");
    if (!numbered && !/^(?:選擇題|單選題|四選一|是非題|判斷題|問答題|簡答題|填充題|配合題|勾選題|複選題|多選題|閱讀題組|閱讀測驗|題組)(?:[(:：、,]|$)/.test(title)) return null;
    return {title,choice:/^(?:選擇題|單選題|四選一)(?:[(:：、,]|$)/.test(title) && !/複選|多選|勾選/.test(title)};
  }
  const questionNeedsImage = prompt => /下圖|上圖|附圖|如圖|圖片中|圖表中|圖中|哪(?:一)?個符號表示/.test(text(prompt).replace(/\s/g, ""));
  function answerKeys(value) {
    const keys = new Map(), add = (number, answer) => { const n = String(Number(number)), a = text(answer); keys.set(n, keys.has(n) && keys.get(n) !== a ? "" : a); };
    const normalized = text(value);
    const lines = normalized.split("\n"), matrixLines = new Set();
    lines.forEach((line, i) => {
      if (!/^\s*(?:題號|題次|編號)\s/.test(line) || !/^\s*(?:答案|解答)\s/.test(lines[i + 1] || "")) return;
      const numbers = line.replace(/^\s*\S+\s*/, "").trim().split(/\s+/), answers = lines[i + 1].replace(/^\s*\S+\s*/, "").trim().split(/\s+/);
      if (numbers.length === answers.length && numbers.every(n => /^\d+$/.test(n)) && answers.every(a => answerIndex(a) >= 0)) {numbers.forEach((n, j) => add(n, answers[j]));matrixLines.add(i);matrixLines.add(i+1);}
    });
    for (const m of lines.filter((_,i)=>!matrixLines.has(i)).join("\n").matchAll(/(?:^|[\s,，;；])([0-9]{1,4})\s*[.、:：)）\-]?\s*[（(]?([A-D1-4])[)）]?(?=\s|$|[,，;；])/gi)) add(m[1], m[2].toUpperCase());
    return keys;
  }
  function splitChoices(value, explicitAnswer = "") {
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
    const order = labels.map(m => m[3] ? m[3].codePointAt(0) - 9312 : /[A-E]/.test(m[1] || m[2]) ? (m[1] || m[2]).charCodeAt(0) - 65 : Number(m[1]) - 1);
    const options = labels.map((label, n) => tidy(body.slice(label.index + label[0].length, labels[n + 1]?.index ?? body.length)).replace(/。$/,""));
    let answer = explicitAnswer || inline;
    if (explicitAnswer && inline && answerIndex(explicitAnswer) !== answerIndex(inline)) answer = "";
    return {prompt:tidy(body.slice(0, labels[0]?.index ?? body.length)).replace(outer ? /[（(]\s*$/ : /$^/, ""), options:order.join() === "0,1,2,3" ? options : [], answer, explanation:tidy(explanation)};
  }
  function documentCandidates(value, source = "PDF") {
    const content = documentText(value).split("\n").map(line => {const heading=majorHeading(line);return heading ? `一、${heading.title}` : line}).join("\n");
    const section = content.search(/(?:^|\n)[ \t]*(?:參考答案|參考解答|選擇題答案|答案表|解答表|answer key|答案|解答)\s*[:：]?[ \t]*(?=\n|$)/i);
    const body = section < 0 ? content : content.slice(0, section), keys = answerKeys(section < 0 ? "" : content.slice(section));
    const pattern = /(?:^|\n)[ \t]*(?:([一二三四五六七八九十]+[ \t]*[、.][^\n]*)|(?:[（(]\s*([A-D1-4①②③④○✕✓✗×OX]?)\s*[)）]\s*)?(?:([0-9](?:[ \t]*[0-9]){0,3})\s*[.、)]|第\s*([0-9](?:[ \t]*[0-9]){0,3})\s*題)[ \t]*(?:[（(]\s*([A-D1-4①②③④])\s*[)）]\s*)?)/g;
    const tokens = [...body.matchAll(pattern)], candidates = [], counts = new Map();
    // A paper with major headings only imports the explicit single-choice section.
    let inChoices = !tokens.some(t => t[1]);
    const selected = tokens.map(token => {
      if (!token[1]) return inChoices;
      inChoices = majorHeading(token[1]).choice;
      return false;
    });
    tokens.forEach((t,i) => {if(selected[i]){const n = (t[3] || t[4]).replace(/[ \t]/g, "");counts.set(n, (counts.get(n) || 0) + 1)}});
    tokens.forEach((token, i) => {
      if (token[1]) return;
      const number = (token[3] || token[4]).replace(/[ \t]/g, ""), answer = token[2] || token[5] || (counts.get(number) === 1 ? keys.get(String(Number(number))) : "") || "";
      const question = splitChoices(body.slice(token.index + token[0].length, tokens[i + 1]?.index ?? body.length), answer);
      const requiresImage = questionNeedsImage(question.prompt);
      candidates.push({...question,requiresImage,type:selected[i] ? "" : "不支援題型",source:`${source} 第 ${number} 題`});
    });
    return candidates;
  }
  function fromPdfText(value) {
    const result = collect(documentCandidates(value)); result.formats = ["文字試卷自動分題"];
    if (documentText(value).split("\n").some(line=>majorHeading(line)?.choice)) result.formats.unshift("優先擷取選擇題大題");
    if (!result.questions.length && !result.skipped.length) result.skipped.push({source:"PDF",reason:"無法辨識題號與選項；請提供可選取文字的試卷或 Excel"});
    return result;
  }
  function fromRows(sheets) {
    const candidates = [], skipped = [], formats = new Set(), keys = new Map();
    const key = value => text(value).toLowerCase().replace(/\([^)]*\)/g, "").replace(/[\s_:：]/g, "");
    const aliases = {prompt:["題目","題幹","問題","試題","試題內容","題目內容","題目及選項","題目與選項","prompt","question","questiontext"],answer:["答案","正確答案","標準答案","正解","解答","答案代號","answer","correct","correctanswer"],number:["題號","題次","編號","序號","no","id","questionid"],explanation:["解析","詳解","解釋","題目解析","explanation"],type:["題型","類型","type"]};
    const tables = sheets.map(sheet => {
      const header = sheet.rows.findIndex(row => row.some(v => aliases.prompt.includes(key(v))) || (row.some(v => aliases.answer.includes(key(v))) && row.some(v => aliases.number.includes(key(v)))));
      const headers = header < 0 ? [] : sheet.rows[header].map(key), find = names => headers.findIndex(h => names.includes(h));
      const named = majorHeading(sheet.name), rowHeadings = sheet.rows.map(row=>{const cells=row.filter(v=>text(v));return cells.length<=3 ? majorHeading(cells.join(" ")) : null});
      let active = named?.choice === true;
      const inChoice = rowHeadings.map(heading=>{if(heading){active=heading.choice;return false}return active});
      const hasChoice = named?.choice === true || rowHeadings.some(h=>h?.choice) || (header < 0 && sheet.rows.some(row=>row.filter(v=>text(v)).length===1 && row.some(v=>documentText(v).split("\n").some(line=>majorHeading(line)?.choice))));
      return {sheet,header,headers,find,inChoice,hasChoice,columns:Object.fromEntries(Object.entries(aliases).map(([name, list]) => [name,find(list)]))};
    });
    const hasChoiceSection = tables.some(t=>t.hasChoice), accepts = (table,index)=>!hasChoiceSection || table.inChoice[index] === true;
    if (hasChoiceSection) formats.add("優先擷取選擇題大題");
    tables.filter(t => t.columns.prompt < 0 && t.columns.answer >= 0 && t.columns.number >= 0).forEach(t => {
      t.sheet.rows.slice(t.header + 1).forEach(row => { const n = text(row[t.columns.number]), answer = text(row[t.columns.answer]); if (!n || !answer) return; keys.set(n, keys.has(n) && keys.get(n) !== answer ? "" : answer); });
    });
    const numbers = new Map();
    tables.filter(t => t.columns.prompt >= 0).forEach(t => t.sheet.rows.slice(t.header + 1).forEach((row,i) => { const n = text(row[t.columns.number]); if (accepts(t,t.header+i+1) && n && text(row[t.columns.prompt])) numbers.set(n, (numbers.get(n) || 0) + 1); }));
    for (const t of tables) {
      const {sheet,header,headers,find,columns} = t;
      if (columns.prompt < 0 && columns.answer >= 0 && columns.number >= 0) { formats.add("獨立答案表配對"); continue; }
      if (hasChoiceSection && !t.hasChoice) {skipped.push({source:sheet.name,reason:"此工作表不在選擇題大題範圍內"});continue;}
      if (header < 0) {
        const scopedRows = hasChoiceSection && t.inChoice.some(Boolean) ? sheet.rows.filter((_,i)=>t.inChoice[i]) : sheet.rows;
        const positional = scopedRows.filter(row => row.some(v => text(v))).map(row => { const cells = [...row];while (cells.length && !text(cells.at(-1))) cells.pop();return cells; });
        if (positional.length && positional.every(row => row.length === 6 || (row.length === 7 && /^\d+$/.test(text(row[0]))))) {
          positional.forEach((row,i) => {const p = row.length === 7 ? 1 : 0;candidates.push({prompt:row[p],options:row.slice(p + 1,p + 5),answer:row[p + 5],source:`${sheet.name} 第 ${i + 1} 列`})});formats.add("無表頭六欄題庫");
        } else {
          const found = documentCandidates(scopedRows.map(row => row.filter(v => text(v)).join("\n")).join("\n"),sheet.name);
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
        let question = {prompt:row[columns.prompt],options:optColumns.map(c => c < 0 ? "" : row[c]),answer};
        if (optColumns.every(c => c < 0)) {question=splitChoices(`${documentText(row[columns.prompt])}\n${merged < 0 ? "" : documentText(row[merged])}`,answer);formats.add("合併題目與選項拆分");}
        if (extra.some(c => text(row[c]))) question.options.push("額外選項");
        const feedback = [0,1,2,3].map(n => {const c=find([`解析${String.fromCharCode(97+n)}`,`選項${String.fromCharCode(97+n)}解析`,`feedback${String.fromCharCode(97+n)}`]);return c<0?"":row[c]});
        candidates.push({...question,explanation:row[columns.explanation] || question.explanation,type:row[columns.type],optionFeedback:feedback,source:`${sheet.name} 第 ${header + i + 2} 列`});
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
  async function readFile(file) {
    if (!file || file.size > MAX_BYTES) throw new Error("請選擇 20 MB 以內的 PDF 或 Excel 檔案。");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.pdf$/i.test(file.name)) {
      await script("vendor/pdf.worker.js"); await script("vendor/pdf.js");
      const task = root.pdfjsLib.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true, stopAtErrors: true });
      let pdf;
      try {
        pdf = await task.promise;
        if (pdf.numPages > 200) throw new Error("PDF 超過 200 頁，請拆開後匯入。");
        const pages = [];
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
          const pageText = lines.filter(row=>row.y<=top&&!/^(?:\d{1,3}|第\d{1,3}頁|翻面繼續作答|繼續寫第[一二三四五六七八九十\d]+頁|請(?:再)?仔細檢查(?:答案)?[!！。]?|背面還有題目[喔哦]?[!！。]?|還有一張加油[!！。]?)$/.test(tidy(row.text).replace(/\s/g,""))).map(row=>row.text).join("\n");
          // Vertical page reminders can be extracted as one character per line.
          pages.push(pageText.replace(/(?:^|\n)[ \t]*請\s*(?:再\s*)?仔\s*細\s*檢\s*查(?:\s*答\s*案)?\s*[!！。]?[ \t]*(?=\n|$)/g,"\n")); page.cleanup();
        }
        const all = pages.join("\n");
        if (all.replace(/\s/g, "").length < 15) throw new Error("這份 PDF 沒有可讀取文字，可能是掃描圖片。請改用 Excel 範本。");
        return fromPdfText(all);
      } finally { await task.destroy(); }
    }
    if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("目前支援 .xlsx、.xls 與文字型 .pdf。");
    await script("vendor/xlsx.full.min.js");
    const workbook = root.XLSX.read(bytes, { type: "array", sheetRows: MAX_QUESTIONS + 100, cellHTML: false, cellFormula: false });
    if (workbook.SheetNames.some(name => workbook.Sheets[name]["!fullref"])) throw new Error("工作表列數過多，請整理成 2,000 題以內的檔案後再匯入。");
    return fromRows(workbook.SheetNames.map(name => ({ name, rows: root.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", raw: false }) })));
  }
  async function convertFile(file) {
    const result = await readFile(file);
    return {...result,fileName:file.name};
  }
  function standardRows(questions) {
    return [["題目","選項A","選項B","選項C","選項D","答案","解析","題型","解析A","解析B","解析C","解析D"],
      ...questions.map(q => [q.prompt,...q.options,String.fromCharCode(65 + q.answerIndex),q.explanation,"單選題",...q.optionFeedback])];
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
    return `<div class="custom-import"><div class="row"><button type="button" class="secondary" data-import>自動轉換 PDF／Excel 題目</button><a class="link-button" href="templates/老師自訂題庫範本.xlsx" download>下載 Excel 範本</a></div><input type="file" data-import-file accept=".pdf,.xlsx,.xls" hidden><p class="learn-note">每次匯入都會先尋找「選擇題」大標題；找到後只使用該區塊，遇到下一個大題即停止。PDF 與 Excel（含多工作表）皆適用。沒有大題標題的標準題庫可直接辨識欄位。只保留有答案的四選一純文字題，圖片題與其他題型自動略過。先核對預覽，再採用或下載標準 Excel；掃描 PDF 請改用文字 PDF 或 Excel。</p><div data-import-status role="status" aria-live="polite"></div><div data-convert-preview></div><div data-import-preview></div></div>`;
  }
  function bindEditor(host, initial = null) {
    let bank = cleanBank(initial), importing = false, converted = null;
    const find = s => host.querySelector(s), status = find("[data-import-status]"), preview = find("[data-import-preview]"), conversion = find("[data-convert-preview]"), file = find("[data-import-file]"), button = find("[data-import]");
    const questionPreview = questions => `<div class="custom-preview">${questions.map((q,i)=>`<article><b>${i+1}. ${esc(q.prompt)}</b><ol type="A">${q.options.map((o,n)=>`<li${n===q.answerIndex?' class="custom-correct"':""}>${esc(o)}${n===q.answerIndex?" ✓":""}</li>`).join("")}</ol><p>${esc(q.explanation||"原檔未提供解析；不會自動猜測理由。")}</p></article>`).join("")}</div>`;
    function show() {
      if (!bank) { preview.innerHTML = ""; return; }
      preview.innerHTML = `<div class="custom-bank-settings"><label><input type="checkbox" data-custom-enabled${bank.enabled ? " checked" : ""}>開放「未知地點」隱藏關卡</label><label>本場題數（1～${bank.questions.length}）<input class="name-input" data-custom-count type="number" min="1" max="${bank.questions.length}" value="${bank.count}"></label><p>已匯入 ${bank.questions.length} 題。題目會隨機抽出且不重複，敵我血量最多 10，道具最高第 3 階。</p><details><summary>預覽題目與答案（發布前請核對）</summary><div class="custom-preview">${bank.questions.map((q, i) => `<article><b>${i + 1}. ${esc(q.prompt)}</b><ol type="A">${q.options.map((o, n) => `<li${n === q.answerIndex ? ' class="custom-correct"' : ""}>${esc(o)}${n === q.answerIndex ? " ✓" : ""}</li>`).join("")}</ol><p>${esc(q.explanation || "未提供解析；學生作答後會顯示答案並提示再試。")}</p></article>`).join("")}</div></details><button class="link-button" type="button" data-custom-clear>移除本次題庫</button></div>`;
      find("[data-custom-clear]").onclick = () => { bank = null; status.textContent = "題庫已移除，儲存後生效。"; show(); };
    }
    button.onclick = () => file.click();
    file.onchange = async () => {
      if (!file.files?.[0]) return;
      importing = true; button.disabled = true; status.textContent = "正在辨識檔案並自動轉換題庫…";
      try {
        const result = await convertFile(file.files[0]);
        if (!result.questions.length) throw new Error(`沒有可轉換的四選一題目。${result.skipped[0]?.reason || "請確認原檔有題目、四個選項及答案。"}`);
        converted = result;
        status.innerHTML = `<p>自動轉換完成：可用 ${result.questions.length} 題，略過 ${result.skipped.length} 筆。尚未採用或發布。</p><p>辨識方式：${esc((result.formats || []).join("、"))}</p>${result.skipped.length ? `<details><summary>查看略過原因</summary><ul>${result.skipped.map(s => `<li>${esc(s.source)}：${esc(s.reason)}</li>`).join("")}</ul></details>` : ""}`;
        conversion.innerHTML = `<section class="custom-bank-settings"><h4>轉換結果預覽</h4><p>${esc(result.fileName)} → 標準四選一題庫。請核對題目、選項及綠色標示的正確答案。</p>${questionPreview(result.questions)}<div class="row"><button class="secondary" type="button" data-convert-download>下載標準題庫 Excel</button><button class="primary" type="button" data-convert-apply>採用轉換結果</button><button class="link-button" type="button" data-convert-cancel>取消這次轉換</button></div></section>`;
        find("[data-convert-download]").onclick = async e => {const b=e.currentTarget;b.disabled=true;try{await downloadStandard(result.questions)}catch(err){status.textContent=err.message}finally{b.disabled=false}};
        find("[data-convert-apply]").onclick = () => {bank=bankFrom(result.questions,result.questions.length);converted=null;conversion.innerHTML="";show();status.textContent=`已採用 ${bank.questions.length} 題。請設定本場題數，再建立班級或儲存發布。`};
        find("[data-convert-cancel]").onclick = () => {converted=null;conversion.innerHTML="";status.textContent="已取消這次轉換，原本題庫保留。"};
      } catch (err) { status.textContent = err.name === "PasswordException" ? "PDF 有密碼，請先解除保護再匯入。" : err.message; }
      finally { importing = false; button.disabled = false; file.value = ""; }
    };
    show();
    return { getBank() {
      if (importing) throw new Error("題目仍在讀取，請稍候。");
      if (converted) throw new Error("請先核對並採用轉換結果，或取消這次轉換。");
      if (!bank) return null;
      const count = Number(find("[data-custom-count]").value);
      if (!Number.isInteger(count) || count < 1 || count > bank.questions.length) throw new Error(`自訂題數請輸入 1～${bank.questions.length} 的整數。`);
      return { ...bank, count, enabled: find("[data-custom-enabled]").checked };
    } };
  }
  root.GUARDIAN_CUSTOM = { validate, collect, fromRows, fromPdfText, readFile, convertFile, standardRows, downloadStandard, bankFrom, cleanBank, editorMarkup, bindEditor };
})(typeof window !== "undefined" ? window : globalThis);
