"use strict";
(function (root) {
  const types = [
    ["題組題", /^(?:(?:閱讀|圖表|資料|素養|綜合|混合)?題組題?|閱讀測驗|閱讀題)/u],
    ["是非題", /^(?:是非題|判斷題|對錯題)/u],
    ["複選題", /^(?:複選題?|多選題?|勾選題?|選擇題(?=[:(](?:可|為)?(?:複|多)選))/u],
    ["選擇題", /^(?:選擇題|單選題|四選一|單題)/u],
    ["填充題", /^(?:填充題|填空題|填填看)/u],
    ["配合題", /^(?:配合題|連連看|連線題|對應題|分類題)/u],
    ["問答題", /^(?:問答題|簡答題|申論題|作答題|回答問題)/u],
    ["計算題", /^(?:計算題|算算看|應用題)/u],
    ["答案", /^(?:參考答案|參考解答|(?:選擇題|是非題)答案|解答表|答案表|答案卷|答案|解答|answerkey)/iu]
  ];
  const imageFile = /\.(png|jpe?g)$/i;
  const pdfFile = /\.pdf$/i;
  const workbookFile = /\.(xlsx|xls)$/i;

  function sectionsOf(value) {
    const sections = [];
    let current = { type: "卷首資料", title: "", lines: [] };
    const flush = () => {
      const body = current.lines.join("\n").trim();
      if (current.title || body) sections.push({ type: current.type, title: current.title, body });
    };
    for (const line of String(value).split(/\r?\n/)) {
      if (current.type === "答案") {
        current.lines.push(line);
        continue;
      }
      const compact = line.normalize("NFKC").replace(/\s/g, "").replace(/^[◎◆●※]/u, "")
        .replace(/^[【〔\[]([^】〕\]]+)[】〕\]]/u, "$1");
      const heading = compact.match(/^(?:\([一二三四五六七八九十壹貳參肆伍陸柒捌玖拾\d]+\)|[一二三四五六七八九十壹貳參肆伍陸柒捌玖拾\d]+[、.:,])(.+)$/u);
      const title = heading?.[1] || compact;
      const type = types.find(([label, pattern]) => {
        const prefix = title.match(pattern)?.[0];
        const suffix = prefix ? title.slice(prefix.length) : "";
        return prefix && (label === "答案"
          ? /^(?:$|[:(]|及評分標準$)/.test(suffix) && !/^(?:答案|解答)[:(].+/u.test(title)
          : /^(?:$|[:(、,.—\-]|每(?:題|答)|共\d|\d+題)/u.test(suffix));
      })?.[0];
      const groupLabel = /^(?:(?:題組(?:[一二三四五六七八九十]+|\d+)|第[一二三四五六七八九十\d]+題組)(?:$|[:(、,.—\-])|(?:第)?\d+[-~〜—至到]\d+題為題組)/u;
      const reading = /^(?:請)?(?:仔細)?閱讀(?:下列|以下|下面|下文|短文|文章|資料|情境|對話|材料)/u;
      const group = groupLabel.test(title) || (reading.test(title) && (
        (heading && current.type !== "題組題") || (current.type === "題組題" && current.lines.some(line => line.trim()))
      ));
      const otherType = heading && /^[（(]?[一二三四五六七八九十壹貳參肆伍陸柒捌玖拾]/u.test(compact)
        ? title.match(/^([\p{Script=Han}]{1,8}題)(?=$|[:(、,.])/u)?.[1] : "";
      if (type || group || otherType) {
        flush();
        current = { type: group ? "題組題" : type || otherType, title: line.trim(), lines: [] };
      } else {
        current.lines.push(line);
      }
    }
    flush();
    if (sections[0]?.type === "卷首資料" && sections.slice(1).every(section => section.type === "答案")) {
      sections[0].type = "待分類";
    }
    return sections;
  }

  async function startOcr(loadScript) {
    await Promise.all([loadScript("vendor/ocr/tesseract.min.js"), loadScript("vendor/ocr/ocr-assets.js")]);
    const workerPath = URL.createObjectURL(new Blob([root.GUARDIAN_OCR_WORKER], { type: "text/javascript" }));
    try {
      return await new Promise((resolve, reject) => {
        root.Tesseract.createWorker("chi_tra+eng", root.Tesseract.OEM.LSTM_ONLY, {
          workerPath, workerBlobURL: false, cacheMethod: "none",
          langPath: "https://exam-ocr.invalid", errorHandler: reject
        }).then(resolve, reject);
      });
    } finally {
      URL.revokeObjectURL(workerPath);
    }
  }

  function scaledCanvas(width, height, preferredScale) {
    const scale = Math.min(preferredScale, Math.sqrt(5_000_000 / (width * height)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
    return { canvas, scale };
  }

  async function digitize(files, { readPdfText, loadScript, maxBytes }, update, label = "試卷") {
    if (files.reduce((sum, file) => sum + file.size, 0) > maxBytes) throw new Error("試卷單次最多 20 MB，請分批匯入。");
    const pdf = files.length === 1 && pdfFile.test(files[0].name);
    if (!pdf && !files.every(file => imageFile.test(file.name))) throw new Error("請選擇一份 PDF，或同一份試卷的 JPG／PNG 照片。");
    let worker;
    const recognize = async (canvas, page, total) => {
      try {
        if (!worker) {
          update("正在準備文字辨識工具…");
          worker = await startOcr(loadScript);
          await worker.setParameters({ tessedit_pageseg_mode: root.Tesseract.PSM.AUTO });
        }
        update(`正在辨識第 ${page}／${total} 頁…`);
        const { data } = await worker.recognize(canvas);
        return data.text.replace(/(\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, "$1").trim();
      } finally {
        canvas.width = canvas.height = 0;
      }
    };
    try {
      if (pdf) {
        return await readPdfText(files[0], label, async (page, number, total) => {
          const { width, height } = page.getViewport({ scale: 1 });
          const { canvas, scale } = scaledCanvas(width, height, 3.2);
          await page.render({ canvas, viewport: page.getViewport({ scale }), background: "#fff" }).promise;
          return recognize(canvas, number, total);
        });
      }
      const pages = [];
      for (const [i, file] of files.entries()) {
        const image = await createImageBitmap(file);
        const { canvas } = scaledCanvas(image.width, image.height, 2);
        try {
          const context = canvas.getContext("2d", { alpha: false });
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
        } finally {
          image.close();
        }
        pages.push(await recognize(canvas, i + 1, files.length));
      }
      return pages.join("\n\f\n");
    } finally {
      await worker?.terminate();
    }
  }

  function editorMarkup() {
    return `<section class="exam-import">
      <div class="row exam-actions"><button type="button" class="secondary" data-exam-upload>上傳紙本試卷或照片</button>
      <a class="link-button" href="templates/老師自訂題庫範本.xlsx" download>下載 Excel 範本</a></div>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls" multiple hidden data-exam-file>
      <p class="learn-note">可選一份掃描 PDF、Excel 或多張 JPG／PNG 照片。照片按檔名排序。勾選題型預覽原題，再採用題庫以開放「未知地點」。</p>
      <p role="status" aria-live="polite" data-exam-status hidden></p>
      <div data-exam-review></div>
    </section>`;
  }

  const questionType = question => question.options.length === 2 ? "是非題" : "選擇題";

  function bindEditor(host, tools) {
    const find = selector => host.querySelector(selector);
    const input = find("[data-exam-file]"), upload = find("[data-exam-upload]");
    const status = find("[data-exam-status]"), review = find("[data-exam-review]");
    const { esc } = tools;
    let importing = false, pending = false;
    function message(text) { status.hidden = false; status.textContent = text; }
    async function readInput(fileInput, read) {
      if (importing || !fileInput.files.length) return;
      const files = [...fileInput.files].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true }));
      fileInput.value = "";
      importing = upload.disabled = true;
      message("正在讀取檔案…");
      try {
        await read(files);
      } catch (err) {
        if (err?.name === "PasswordException") message("PDF 有密碼，請先解除保護再匯入。");
        else if (err instanceof Error && /\p{Script=Han}/u.test(err.message)) message(err.message);
        else message("試卷讀取失敗。請確認檔案能開啟，或重新掃描後再試。");
      } finally {
        importing = upload.disabled = false;
      }
    }
    function showReview(files, text, workbook = null) {
      pending = false;
      review.innerHTML = `<section class="custom-bank-settings exam-review">
        <h4>核對試卷</h4>
        <div class="row exam-source">
          <label>原始檔案<select data-exam-source>${files.map((file, i) => `<option value="${i}">${esc(file.name)}</option>`).join("")}</select></label>
          <button type="button" class="link-button" data-exam-original>${workbook ? "下載原檔" : "開啟原卷"}</button>
        </div>
        ${workbook ? "" : `<details>
          <summary>查看或修正辨識文字</summary>
          <p>請核對題號及文字，並讓題型標題各自成行。圖表請對照原卷。</p>
          <label>辨識文字<textarea rows="9" data-exam-text></textarea></label>
          <button type="button" class="secondary" data-exam-refresh disabled>更新題型模組</button>
        </details>`}
        <fieldset><legend>勾選題型</legend><div class="exam-modules" data-exam-modules></div></fieldset>
        <div class="row exam-actions">
          <button type="button" class="primary" data-exam-preview-button>預覽原題</button>
          ${workbook ? "" : `<button type="button" class="link-button" data-exam-answer>搭配答案卷</button>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple hidden data-exam-answer-file>
          <button type="button" class="link-button" data-exam-remove-answer hidden>移除答案卷</button>`}
        </div>
        <p data-exam-answer-status hidden></p>
        <section class="exam-preview" data-exam-preview hidden></section>
      </section>`;
      const editor = find("[data-exam-text]"), modules = find("[data-exam-modules]");
      const refresh = find("[data-exam-refresh]"), previewButton = find("[data-exam-preview-button]");
      const preview = find("[data-exam-preview]");
      let sections, applied = text, answerText = "", decision = "";
      const selected = new Map();
      const previewState = () => {
        previewButton.disabled = (!!editor && editor.value !== applied) || ![...selected.values()].some(Boolean);
      };
      function invalidate() {
        preview.hidden = true;
        pending = false;
        decision = "";
        previewState();
      }
      function regroup() {
        const prior = new Map(selected);
        applied = editor?.value ?? text;
        sections = workbook ? ["是非題", "選擇題"].flatMap(type => {
          const questions = workbook.questions.filter(question => questionType(question) === type);
          if (!questions.length) return [];
          const body = questions.map((question, i) => `${i + 1}. ${question.prompt}\n${question.options.map((option, n) => `${"ABCD"[n]}. ${option}`).join("\n")}`).join("\n\n");
          return [{ type, title: type, body }];
        }) : sectionsOf(applied);
        selected.clear();
        for (const { type } of sections) selected.set(type, prior.get(type) ?? type !== "答案");
        const empty = workbook ? workbook.skipped[0]?.reason || "請在 Excel 範本填寫題目、選項與答案。" : "請先補上原卷文字。";
        modules.innerHTML = [...selected].map(([type, enabled]) => `<label><input type="checkbox" value="${esc(type)}"${enabled ? " checked" : ""}>${esc(type)}</label>`).join("") || esc(empty);
        if (refresh) refresh.disabled = true;
        invalidate();
      }
      find("[data-exam-original]").onclick = () => {
        const source = files[Number(find("[data-exam-source]").value)];
        const url = URL.createObjectURL(source);
        const link = document.createElement("a");
        link.href = url;
        if (workbook) link.download = source.name;
        else { link.target = "_blank"; link.rel = "noopener"; }
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      };
      if (editor) {
        editor.value = text;
        refresh.onclick = regroup;
        editor.oninput = () => { refresh.disabled = editor.value === applied; invalidate(); };
      }
      modules.onchange = event => {
        selected.set(event.target.value, event.target.checked);
        invalidate();
      };
      function showPreview(focus = true) {
        if (previewButton.disabled) return;
        const chosen = sections.filter(({ type }) => selected.get(type));
        preview.innerHTML = `<h4 tabindex="-1">數位試卷預覽</h4><div class="exam-game" data-exam-game></div>` + chosen.map(({ type, title, body }) =>
          `<article>${type === "卷首資料" ? "" : `<h5>${esc(title || type)}</h5>`}<div class="exam-text">${esc(body.replace(/\f/g, ""))}</div></article>`
        ).join("");
        preview.hidden = false;
        if (focus) preview.querySelector("h4").focus();
        const game = find("[data-exam-game]");
        pending = false;
        let result;
        try {
          result = workbook ? { ...workbook, questions: workbook.questions.filter(question => selected.get(questionType(question))) } :
            tools.fromExamSections(chosen, sections, answerText);
        } catch (err) {
          game.textContent = err.message;
          return;
        }
        if (!result) {
          game.textContent = "勾選是非題或選擇題，即可核對「未知地點」的可用題目。";
          return;
        }
        const count = result.questions.length;
        pending = count > 0 && !decision;
        game.innerHTML = `<p><strong>未知地點</strong>・可用 ${count} 題</p>
          <p class="learn-note">關卡使用有答案的是非題與四選一文字題。</p>
          ${result.skipped.length ? `<details><summary>查看 ${result.skipped.length} 筆略過原因</summary><ul>${result.skipped.map(({ source, reason }) => `<li>${esc(source)}：${esc(reason)}</li>`).join("")}</ul></details>` : ""}
          ${count ? `<details><summary>核對題目與正確答案</summary>${tools.questionPreview(result.questions)}</details>
          <div class="row exam-actions">
            <button type="button" class="secondary" data-convert-apply${decision === "adopted" ? " disabled" : ""}>採用到未知地點</button>
            <button type="button" class="link-button" data-convert-download>下載標準題庫 Excel</button>
            <button type="button" class="link-button" data-convert-cancel${decision ? " hidden" : ""}>只預覽原卷</button>
          </div>` : ""}`;
        if (!count) return;
        const apply = find("[data-convert-apply]"), cancel = find("[data-convert-cancel]");
        apply.onclick = () => {
          tools.adopt(result.questions);
          decision = "adopted";
          pending = false;
          apply.disabled = cancel.hidden = true;
        };
        cancel.onclick = () => {
          decision = "preview";
          pending = false;
          cancel.hidden = true;
          preview.querySelector("h4").focus();
        };
        find("[data-convert-download]").onclick = async event => {
          const button = event.currentTarget;
          button.disabled = true;
          try { await tools.downloadStandard(result.questions); }
          catch (err) { message(err.message); }
          finally { button.disabled = false; }
        };
      }
      previewButton.onclick = () => showPreview();
      if (!workbook) {
        const answer = find("[data-exam-answer]"), answerInput = find("[data-exam-answer-file]");
        const answerStatus = find("[data-exam-answer-status]"), remove = find("[data-exam-remove-answer]");
        function updateAnswer(value, names = "") {
          const wasVisible = !preview.hidden;
          answerText = value;
          answerStatus.hidden = remove.hidden = !value;
          answerStatus.textContent = value ? `已搭配 ${names}` : "";
          invalidate();
          if (wasVisible) showPreview(false);
        }
        answer.onclick = () => { if (!importing) answerInput.click(); };
        answerInput.onchange = () => readInput(answerInput, async files => {
          const value = await digitize(files, tools, message, "答案卷");
          if (!value.trim()) throw new Error("請換一份字跡清楚的答案卷。");
          updateAnswer(value, files.map(file => file.name).join("、"));
          message("答案卷已讀取，可核對配對結果。");
        });
        remove.onclick = () => { if (!importing) { updateAnswer(""); message("已移除答案卷。"); } };
      }
      regroup();
    }
    upload.onclick = () => input.click();
    input.onchange = () => readInput(input, async files => {
      if (files.length === 1 && workbookFile.test(files[0].name)) {
        const result = await tools.readWorkbook(files[0]);
        showReview(files, "", result);
        message(result.questions.length ? "Excel 題庫已讀取，可以預覽原題。" : "請核對 Excel 的題目、選項和答案欄位。");
      } else {
        const content = await digitize(files, tools, message);
        showReview(files, content);
        message(content.trim() ? "試卷已轉成文字。請核對題型和內容後預覽。" : "未辨識到文字。可對照原卷補上文字，或重新掃描。");
      }
    });
    return { checkReady() {
      if (importing) throw new Error("題目仍在讀取，請稍候。");
      if (pending) throw new Error("請選擇「採用到未知地點」或「只預覽原卷」。");
    } };
  }

  root.GUARDIAN_EXAM = { sectionsOf, editorMarkup, bindEditor };
})(typeof window !== "undefined" ? window : globalThis);
