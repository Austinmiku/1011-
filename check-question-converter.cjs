const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const XLSX=require('./vendor/xlsx.full.min.js');
const ctx=vm.createContext({window:{XLSX},document:{currentScript:{src:'file:///C:/game/custom-questions.js'}},URL,console});
vm.runInContext(fs.readFileSync(path.join(__dirname,'custom-questions.js'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'exam-paper.js'),'utf8'),ctx);
const api=ctx.window.GUARDIAN_CUSTOM;
const columns=api.fromRows([{name:'試題',rows:[['題次','試題內容','選項一','選項二','選項三','選項四','正解'],[1,'位置在哪裡？','亞洲','歐洲','非洲','美洲','亞洲']]}]);
assert.equal(columns.questions.length,1);assert.equal(columns.questions[0].answerIndex,0);
const joined=api.fromRows([{name:'試題',rows:[['題號','題目與選項'],[8,'應查哪種資料？ A. 地圖 B. 日記 C. 帳本 D. 菜單'],[9,'臺灣是島嶼？ (A) 是 (B) 否']]},{name:'解答',rows:[['編號','標準答案'],[8,'B'],[9,'A']]}]);
assert.equal(joined.questions.length,2);assert.equal(joined.questions[0].answerIndex,1);
assert.deepEqual(Array.from(joined.questions[1].options),['是','否']);assert.equal(joined.questions[1].answerIndex,0);
const mergedOptions=api.fromRows([{name:'題庫',rows:[['問題','選項','答案','詳解'],['應查什麼？','①地圖②日記③帳本④菜單','①','地圖顯示位置。']]}]);
assert.equal(mergedOptions.questions.length,1);assert.equal(mergedOptions.questions[0].options[3],'菜單');
const raw=api.fromRows([{name:'題庫',rows:[['應查什麼？','地圖','日記','帳本','菜單','C'],[2,'哪個方向？','東','西','南','北','4']]}]);
assert.equal(raw.questions.length,2);assert.equal(raw.questions[1].answerIndex,3);
const teacher=api.fromPdfText('一、是非題\n(○) ⒈ 臺灣是島嶼。\n二、選擇題\n(③) ⒈ 應查哪種資料？（①日記②帳本③地圖④菜單）。\n(①) ⒉ 臺灣位於哪裡？\n（①亞洲②歐洲③非洲④美洲）。\n三、填充題\n1. 寫出方向。');
assert.equal(teacher.questions.length,3);
assert.deepEqual(Array.from(teacher.questions,q=>q.answerIndex),[0,2,0]);
assert.deepEqual(Array.from(teacher.questions[0].options),['是','否']);
assert.equal(teacher.questions[1].options[3],'菜單');assert.equal(teacher.questions[2].options[3],'美洲');
const matrix=api.fromPdfText('1. Where?\n(A) Asia (B) Europe (C) Africa (D) America\n2. Which?\n(A) Map (B) Menu (C) Book (D) Note\n答案表\n題號 1 2\n答案 B D');
assert.equal(matrix.questions.length,2);assert.equal(matrix.questions[1].answerIndex,3);
const missing=api.fromPdfText('1. Missing?\nA. Asia B. Europe C. Africa D. America\n2. Multiple?\nA. One B. Two C. Three D. Four\n答案：A C\n3. Five?\nA. One B. Two C. Three D. Four E. Five\n答案：A');
assert.equal(missing.questions.length,0);assert.equal(missing.skipped.length,3);
const prefix=api.fromPdfText([1,2,3,4].map(n=>`（${n}）${n}. 第${n}題？\n①甲②乙③丙④丁`).join('\n'));
assert.deepEqual(Array.from(prefix.questions,q=>q.answerIndex),[0,1,2,3]);
const inline=api.fromPdfText('1. 應查什麼？\nA. 地圖 B. 日記 C. 帳本 D. 菜單\n答案：A 解析：地圖可顯示位置。');
assert.equal(inline.questions.length,1);assert.equal(inline.questions[0].explanation,'地圖可顯示位置。');
const sections=api.fromPdfText('一、閱讀題組\n1. 閱讀題不匯入？\n①甲②乙③丙④丁\n答案：A\n二、 選擇題（每題2分）\n1. 選擇題要匯入？\n○ 1甲○ 2乙○ 3丙○ 4丁\n三、配合題\n1. 配合題不匯入？\n①甲②乙③丙④丁\n答案：A\n四 、 單選題\n(4) 2. 第二段選擇題？\n○1東○2西○3南○4北\n五、勾選題\n3. 勾選題不匯入？\n①甲②乙③丙④丁\n答案：A\n答案表\n1. B');
assert.equal(sections.questions.length,2);assert.deepEqual(Array.from(sections.questions,q=>q.answerIndex),[1,3]);
assert.deepEqual(Array.from(sections.questions[0].options),['甲','乙','丙','丁']);
assert.equal(sections.skipped.length,3);
const readingOnly=api.fromPdfText('一、閱讀題組\n(2)1. 這題屬於閱讀大題？\n①甲②乙③丙④丁');
assert.equal(readingOnly.questions.length,0);
const circleFive=api.fromPdfText('一、選擇題\n(2)1. 五個選項不匯入？\n○1甲○2乙○3丙○4丁○5戊');
assert.equal(circleFive.questions.length,0);
const spacedNumbers=api.fromPdfText('二、選擇題\n(2)12. 前一題？\n①甲②乙③丙④丁\n(1) 1 3 . 國道 6 號的題目？\n①東②西③南④北\n第 1 4 題 (3) 後一題？\n①春②夏③秋④冬');
assert.equal(spacedNumbers.questions.length,3,'spaced question numbers must not merge adjacent questions');
assert.deepEqual(Array.from(spacedNumbers.questions,q=>q.answerIndex),[1,0,2]);
assert.deepEqual(Array.from(spacedNumbers.questions[0].options),['甲','乙','丙','丁']);
assert.equal(spacedNumbers.questions[1].prompt,'國道 6 號的題目?');
const spacedKey=api.fromPdfText('二、選擇題\n1 3 . 題號與答案表配對？\n①甲②乙③丙④丁\n答案表\n13. D');
assert.equal(spacedKey.questions.length,1);assert.equal(spacedKey.questions[0].answerIndex,3);
const fontMarks=api.fromPdfText('二、選擇題\n1.(\uF083)電子地圖有什麼功能？\n○１定位○２查字○３導航○４計算\n2.(\uF084)選擇何種地圖？\n○ １路線圖○ ２行政圖○ ３影像圖○ ４導覽圖');
assert.equal(fontMarks.questions.length,2);assert.deepEqual(Array.from(fontMarks.questions,q=>q.answerIndex),[2,3]);
assert.deepEqual(Array.from(fontMarks.questions[0].options),['定位','查字','導航','計算']);
assert.equal(api.validate({prompt:'圈號答案',options:['甲','乙','丙','丁'],answer:'\uF082'}).question.answerIndex,1);
const imageQuestions=api.fromPdfText('二、選擇題\n(2)1. 學校會使用哪一個符號表示？\n①圖甲②圖乙③圖丙④圖丁\n(4)2. 下圖是氣溫雨量圖，從圖片中可以知道什麼？\n①甲②乙③丙④丁\n(1)3. 電子地圖可以提供哪種功能？\n①導航②種田③捕魚④發電');
assert.equal(imageQuestions.questions.length,1);assert.match(imageQuestions.questions[0].prompt,/電子地圖/);
assert.equal(imageQuestions.skipped.length,2);assert.ok(imageQuestions.skipped.every(q=>/圖片/.test(q.reason)));
const bareTitles=api.fromPdfText('閱讀題組\n(1)1. 閱讀題不匯入？\n①甲②乙③丙④丁\n選擇題\n(2)1. 只選這個區塊？\n①甲②乙③丙④丁\n配合題\n(3)1. 後面的大題不匯入？\n①甲②乙③丙④丁');
assert.equal(bareTitles.questions.length,1);assert.equal(bareTitles.questions[0].answerIndex,1);
const excelSections=[{name:'完整試卷',rows:[['題號','題目','A','B','C','D'],['一、閱讀題組'],[1,'閱讀區塊的四選一','甲','乙','丙','丁'],['二、選擇題'],[1,'應匯入的選擇題','春','夏','秋','冬'],['三、配合題'],[2,'配合區塊的四選一','東','西','南','北']]},{name:'其他工作表',rows:[['題目','A','B','C','D','答案'],['未標示區塊的題目','甲','乙','丙','丁','A']]},{name:'答案表',rows:[['題號','答案'],[1,'C'],[2,'B']]}];
const excelScope=api.fromRows(excelSections);
assert.equal(excelScope.questions.length,1);assert.equal(excelScope.questions[0].prompt,'應匯入的選擇題');assert.equal(excelScope.questions[0].answerIndex,2);
assert.ok(excelScope.formats.some(f=>/選擇題/.test(f)));
const choiceSheet=api.fromRows([{name:'選擇題',rows:[['原本的六欄格式','甲','乙','丙','丁','B']]},{name:'閱讀題組',rows:[['其他六欄格式','春','夏','秋','冬','C']]}]);
assert.equal(choiceSheet.questions.length,1);assert.equal(choiceSheet.questions[0].answerIndex,1);
const textSheet=api.fromRows([{name:'文字試卷',rows:[['一、閱讀題組\n(1)1. 閱讀題不匯入？\n①甲②乙③丙④丁\n二、選擇題\n(4)1. 文字格內的選擇題？\n①甲②乙③丙④丁\n三、配合題\n(2)1. 配合題不匯入？\n①甲②乙③丙④丁']]},{name:'其他',rows:[['其他題目','東','西','南','北','A']]}]);
assert.equal(textSheet.questions.length,1);assert.equal(textSheet.questions[0].answerIndex,3);
const namedText=api.fromRows([{name:'選擇題',rows:[['(2)1. 題目一？'],['①甲②乙③丙④丁'],['三、配合題'],['(1)2. 題目二？'],['①春②夏③秋④冬']]}]);
assert.equal(namedText.questions.length,1);assert.equal(namedText.questions[0].answerIndex,1);
const positionalTitles=api.fromRows([{name:'試卷',rows:[['一、閱讀題組'],['閱讀題不匯入','甲','乙','丙','丁','A'],['二、選擇題'],['這題保留','春','夏','秋','冬','C'],['三、配合題'],['配合題不匯入','東','西','南','北','B']]}]);
assert.equal(positionalTitles.questions.length,1);assert.equal(positionalTitles.questions[0].prompt,'這題保留');
const decorated = api.fromPdfText('◎選擇題：\n(➂) 1. 哪種資料能指路？\n➀書信➁照片➂地圖➃收據\n◎閱讀題組：\n(1) 2. 另有閱讀文章？\n➀甲➁乙➂丙➃丁');
assert.deepEqual(Array.from(decorated.questions,q=>q.answerIndex),[2]);
const bareExam = '一、單題：\n1. 地圖上方是什麼方向？\n(A)北方(B)南方(C)東方(D)西方\n二、題組：\n1. 依文章回答？\n(A)甲(B)乙(C)丙(D)丁';
assert.equal(api.fromPdfText(bareExam).questions.length,0);
const withKey = api.fromPdfText(bareExam, '參考答案\n題號 1\n答案 A');
assert.deepEqual(Array.from(withKey.questions,q=>q.answerIndex),[0]);
assert.ok(withKey.formats.includes('搭配答案卷核對'));
const filledCopy = '一、選擇題\n(1)1. 地圖上方是什麼方向？\n①北方②南方③東方④西方';
assert.equal(api.fromPdfText(bareExam, filledCopy).questions[0].answerIndex,0);
const conflict = api.fromPdfText(filledCopy, '1. B');
assert.equal(conflict.questions.length,0);
assert.match(conflict.skipped[0].reason,/答案標示不一致/);
const wrongCopy = filledCopy.replace('地圖上方','地圖下方');
assert.equal(api.fromPdfText(bareExam, wrongCopy).questions.length,0);
assert.equal(api.fromPdfText(bareExam, '參考答案\n1 A B C D').questions.length,0);
assert.equal(api.fromPdfText(bareExam, '題號 1 2 3 4\n答案').questions.length,0);
assert.equal(api.fromPdfText(bareExam, '參考答案\n1 D\n2 A B C D').questions.length,0);
assert.equal(api.fromPdfText('一、單題\n(D)\n1. 哪一項符合？\n(A)甲(B)乙(C)丙(D)丁').questions.length,0);
assert.equal(api.fromPdfText('一、選擇題\n(1)1. 看完圖表後如何判讀？\n①甲②乙③丙④丁').questions.length,0);
assert.equal(api.fromPdfText('選擇題（複選）\n(1)1. 哪些選項符合？\n①甲②乙③丙④丁').questions.length,0);
const inlineConflict = filledCopy + '\n答案：B';
assert.equal(api.fromPdfText(inlineConflict, '1. A').questions.length,0);
const paper = ctx.window.GUARDIAN_EXAM.sectionsOf([
  '一、是非題', '(1)1. 這一題只供預覽？', '①春②夏③秋④冬',
  '二、選擇題', '1. 課堂核對後的題目？', '①甲②乙③丙④丁', '第 2 頁',
  '(3)2. 根據下圖回答？', '①東②西③南④北',
  '三、閱讀題組', '河岸的短文。', '(1)1. 這一題需要短文？', '①春②夏③秋④冬',
  '答案表', '1. B'
].join('\n'));
const choiceModules = paper.filter(section=>section.type==='選擇題');
const approved = api.fromExamSections(choiceModules,paper);
assert.deepEqual(Array.from(approved.questions,question=>[question.prompt,question.options[3],question.answerIndex]),[['課堂核對後的題目?','丁',1]]);
assert.equal(approved.skipped.length,1);
assert.match(approved.skipped[0].reason,/圖片或圖表/);
assert.equal(api.fromExamSections(paper.filter(section=>section.type==='題組題'),paper),null,'undecided or non-combat types stay available for preview');
assert.equal(api.fromExamSections(choiceModules,paper,'1. D').questions.length,0,'a mismatching independent key cannot override the original answer');
const mixedExam = ctx.window.GUARDIAN_EXAM.sectionsOf([
  '一、是非題', '1. 海水可以直接喝。', '2. (○) 臺灣是島嶼。', '3. （　）缺少答案。',
  '4. (✗) 原卷標示互相矛盾。', '答案：是',
  '二、選擇題', '1. 哪個數字位於第二個選項？', '(A) 7 (B) 3 (C) 4 (D) 1',
  '答案表', '一、是非題', '1. × 2. ○', '二、選擇題', '1. B'
].join('\n'));
assert.deepEqual(Array.from(mixedExam,s=>s.type),['是非題','選擇題','答案']);
const mixed = api.fromExamSections(mixedExam,mixedExam);
assert.deepEqual(Array.from(mixed.questions,q=>q.answerIndex),[1,0,1]);
assert.deepEqual(Array.from(mixed.questions,q=>q.options.length),[2,2,4]);
assert.deepEqual(Array.from(mixed.questions[0].options),['是','否']);
assert.match(mixed.skipped[0].reason,/正確答案/);
assert.match(mixed.skipped[1].reason,/不一致/);
const justTruth = api.fromExamSections(mixedExam.filter(s=>s.type==='是非題'),mixedExam);
assert.equal(justTruth.questions.length,2);
assert.equal(api.fromPdfText('對錯題\n（Ｘ）1. 這句是錯的。', '是非題答案\n1. ○').questions.length,0);
const truthSheet = api.fromRows([{name:'是非題',rows:[['題號','題目','答案'],[1,'這是肯定敘述。','○'],[2,'這是否定敘述。','×']]}]);
assert.deepEqual(Array.from(truthSheet.questions,q=>q.answerIndex),[0,1]);
const swapped = api.validate({type:'是非題',prompt:'反向選項',options:['錯','對'],answer:'A',optionFeedback:['甲','乙']}).question;
assert.deepEqual(Array.from(swapped.options),['是','否']);
assert.deepEqual(Array.from(swapped.optionFeedback),['乙','甲']);
assert.equal(swapped.answerIndex,1);
assert.equal(api.validate({prompt:'一般二選一',options:['山區','港口'],answer:'A'}).question,undefined);
assert.equal(api.validate({type:'是非題',prompt:'超出選項',options:['是','否'],answer:'C'}).question,undefined);
const plainPaper = ctx.window.GUARDIAN_EXAM.sectionsOf('1. Which?\n(A) Map (B) Clock (C) Ruler (D) Scale\n答案表\n1. A');
assert.equal(plainPaper[0].type,'待分類');
assert.equal(api.fromExamSections(plainPaper,plainPaper).questions[0].answerIndex,0);
const pagedPaper = ctx.window.GUARDIAN_EXAM.sectionsOf(
  '選擇題\n(4)1. 第一題？\n①甲②乙③丙④丁。\n\f\n雨量（mm）\n' +
  '(4)2. 第二題？\n①東②西③南④北\n\f\n方。\n' +
  '(4)3. 第三題？\n①甲②乙③丙④先閱讀文章。\n\f\n接著整理資料。'
);
assert.deepEqual(Array.from(api.fromExamSections(pagedPaper,pagedPaper).questions,q=>q.options[3]),['丁','北方','先閱讀文章。接著整理資料'],
  'a page boundary drops captions after a complete choice and keeps a choice continued on the next page');
const rows=api.standardRows(teacher.questions), roundtrip=api.fromRows([{name:'轉換後題庫',rows}]);
assert.equal(roundtrip.questions.length,3);assert.deepEqual(JSON.parse(JSON.stringify(roundtrip.questions)),JSON.parse(JSON.stringify(teacher.questions)));
// The downloaded workbook must remain readable by the same importer and preserve literal text.
const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'題庫');
const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'});
const excel={name:'轉換後題庫.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes};
(async()=>{
 const result=await api.convertFile(excel);
 assert.equal(result.questions.length,3);assert.equal(result.questions[1].answerIndex,2);assert.equal(result.fileName,'轉換後題庫.xlsx');
 const sectionBook=XLSX.utils.book_new();
 for(const sheet of excelSections)XLSX.utils.book_append_sheet(sectionBook,XLSX.utils.aoa_to_sheet(sheet.rows),sheet.name);
 const sectionBytes=XLSX.write(sectionBook,{type:'array',bookType:'xlsx'});
 const freshFile=await api.convertFile({name:'另一份試卷.xlsx',size:sectionBytes.byteLength,arrayBuffer:async()=>sectionBytes});
 assert.equal(freshFile.questions.length,1);assert.equal(freshFile.questions[0].answerIndex,2);
 // Verify the single upload, preview, and adoption with the existing class settings.
 const nodes=new Map();
 const host={querySelector(selector){
   if (selector==='[data-digital-paper]') return host;
   if (['[data-exam-text]','[data-exam-refresh]'].includes(selector)) return null;
   if (!nodes.has(selector)) nodes.set(selector,{innerHTML:'',textContent:'',value:'1',checked:true,click(){},focus(){},querySelector:()=>host.querySelector('heading')});
   return nodes.get(selector);
 }};
 const original=api.bankFrom(teacher.questions,1),editor=api.bindEditor(host,original),file=host.querySelector('[data-exam-file]');
 assert.equal((api.editorMarkup().match(/type="file"/g)||[]).length,1);
 file.files=[excel];
 const pending=file.onchange();assert.throws(()=>editor.getBank(),/仍在讀取/);await pending;
 host.querySelector('[data-exam-preview-button]').onclick();
 assert.throws(()=>editor.getBank(),/採用到未知地點/);
 assert.match(host.querySelector('[data-exam-preview]').innerHTML,/數位試卷預覽/);
 host.querySelector('[data-convert-cancel]').onclick();assert.equal(editor.getBank().version,original.version);
 host.querySelector('[data-convert-apply]').onclick();
 assert.match(host.querySelector('[data-import-preview]').innerHTML,/value="3"/);
 host.querySelector('[data-custom-count]').value='2';
 assert.notEqual(editor.getBank().version,original.version);assert.equal(editor.getBank().questions.length,3);
 host.querySelector('[data-custom-count]').value='4';assert.throws(()=>editor.getBank(),/1～3/);
 const downloads=[];let clicked=false,revoked=false;
 ctx.Blob=Blob;ctx.setTimeout=callback=>callback();
 ctx.URL=class extends URL{static createObjectURL(blob){downloads.push(blob);return 'blob:test'}static revokeObjectURL(url){assert.equal(url,'blob:test');revoked=true}};
 ctx.document.createElement=()=>({click(){clicked=this.download==='轉換後題庫.xlsx'}});
 await api.downloadStandard(teacher.questions);
 assert.ok(clicked&&revoked);assert.equal(downloads.length,1);
 const exported=XLSX.read(await downloads[0].arrayBuffer(),{type:'array'});
 const restored=api.fromRows(exported.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(exported.Sheets[name],{header:1,defval:''})})));
 assert.deepEqual(JSON.parse(JSON.stringify(restored.questions)),JSON.parse(JSON.stringify(teacher.questions)));
 console.log('Converter: column aliases, merged/circled options, answer-before-number, separate/matrix answers, invalid types, review/adopt/cancel and downloaded Excel roundtrip passed');
})().catch(err=>{console.error(err);process.exit(1)});
