(() => {
  'use strict';

  function create({ pdf, readBuffer, toast, warnDev }) {
    const { loadLocalPdfJs, pdfDocumentOptions } = pdf;
    const $ = (selector) => document.querySelector(selector);
    // 本页面持有当前 OCR 文件及草稿；重选、清空时取消旧轮次并替换状态。
    let ocrImportState = { file: null, text: '', pages: [], running: false };
    function setOcrImportSource(file) {
      ocrImportState.cancel?.();
      const isPdf = /\.pdf$/i.test(file?.name || '');
      if (!isPdf) {resetOcrImportState();return;}
      ocrImportState = { file, text: '', pages: [], running: false };
      const panel = $('#ocr-panel');
      if (panel) {panel.classList.remove('hidden');}
      const result = $('#ocr-result');if (result) {result.value = '';}
      setOcrButtonsEnabled(false);
      setOcrStatus('已选择 PDF：' + (file.name || '未命名') + '。如果文字层提取失败，可点击“尝试 OCR 识别”。', 'warn');
    }
    function resetOcrImportState() {
      ocrImportState.cancel?.();
      ocrImportState = { file: null, text: '', pages: [], running: false };
      const panel = $('#ocr-panel');if (panel) {panel.classList.add('hidden');}
      const result = $('#ocr-result');if (result) {result.value = '';}
      setOcrButtonsEnabled(false);
    }
    function setOcrStatus(msg, type = 'warn') {
      const el = $('#ocr-status');
      if (!el) {return;}
      let statusClass = 'warn';
      if (type === 'ok') {statusClass = 'ok';}
      else if (type === 'danger') {statusClass = 'danger';}
      el.textContent = msg;
      el.className = 'notice ' + statusClass;
    }
    function setOcrButtonsEnabled(hasText) {
      const running = !!ocrImportState.running;
      const cannotUseText = running || !hasText;
      const cancel = $('#ocr-cancel-btn');if (cancel) {cancel.disabled = !running;cancel.onclick = ()=>{ocrImportState.cancel?.();setOcrStatus('OCR 已取消，已识别内容仍可核对。', 'warn');};}
      const start = $('#ocr-start-btn');if (start) {start.disabled = running || !ocrImportState.file;}
      const use = $('#ocr-use-text-btn');if (use) {use.disabled = cannotUseText;}
      const copy = $('#ocr-copy-btn');if (copy) {copy.disabled = cannotUseText;}
      const docx = $('#ocr-download-docx-btn');if (docx) {docx.disabled = cannotUseText;}
    }
    async function loadScriptOnce(src, key) {
      const marker = '__script_' + key;
      if (window[marker]) {return window[marker];}
      window[marker] = new Promise((resolve, reject)=>{
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = ()=>resolve(true);
        s.onerror = ()=>reject(new Error('脚本加载失败：' + src));
        document.head.appendChild(s);
      });
      return window[marker];
    }
    async function createOcrWorker(lang, logger) {
      const candidates = [
        { name: '本地 Tesseract.js', script: './libs/ocr/tesseract/tesseract.min.js', workerPath: './libs/ocr/tesseract/worker.min.js', corePath: './libs/ocr/core', langPath: './libs/ocr/lang' },
        { name: 'CDN Tesseract.js/jsDelivr', script: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js', workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js', corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1', langPath: 'https://tessdata.projectnaptha.com/4.0.0' },
      ];
      let lastErr = null;
      for (const c of candidates) {
        try {
          if (!window.Tesseract || c.name.startsWith('本地')) {await loadScriptOnce(c.script, c.name.replace(/\W+/g, '_'));}
          if (!window.Tesseract || typeof window.Tesseract.createWorker !== 'function') {throw new Error('Tesseract.js 未初始化');}
          const worker = await window.Tesseract.createWorker(lang, 1, { workerPath: c.workerPath, corePath: c.corePath, langPath: c.langPath, logger });
          return { worker, mode: c.name };
        } catch(err) {
          lastErr = err;
          warnDev('OCR 来源加载失败：' + c.name, err);
        }
      }
      throw lastErr || new Error('OCR 扩展加载失败');
    }
    async function startPdfOcrImport() {
      const file = ocrImportState.file;
      if (!file) {setOcrStatus('请先选择一个 PDF 文件。', 'warn');return;}
      if (ocrImportState.running) {return;}
      const run = ocrImportState;
      run.cancelled = false;
      ocrImportState.running = true;
      ocrImportState.text = '';
      ocrImportState.pages = [];
      setOcrButtonsEnabled(false);
      const resultEl = $('#ocr-result');if (resultEl) {resultEl.value = '';}
      let worker = null;let loadingTask = null;let canvas = null;
      // 每轮 OCR 归属于选择的文件；取消或换源后，迟到结果不能写入新的导入状态。
      const cancelled = ()=>run.cancelled || run !== ocrImportState;
      // Tesseract 5.1.1 终止 Worker 不会结束识别 Promise；独立信号保证取消后仍能收尾，升级后若库支持中止可移除。
      let signalCancellation;
      const cancellation = new Promise((resolve)=>{signalCancellation = resolve;});
      run.cancel = ()=>{
        run.cancelled = true;
        signalCancellation();
        if (worker) {const active = worker;worker = null;void active.terminate().catch((err)=>warnDev('OCR 取消失败', err));}
        if (loadingTask) {const active = loadingTask;loadingTask = null;void active.destroy().catch((err)=>warnDev('PDF 取消失败', err));}
      };
      try {
        const lang = $('#ocr-language')?.value || 'chi_sim+eng';
        const pageLimit = Math.max(1, Math.min(200, Number($('#ocr-page-limit')?.value || 20) || 20));
        setOcrStatus('正在加载 PDF 与 OCR 扩展资源……', 'warn');
        const loaded = await loadLocalPdfJs();
        if (cancelled()) {return;}
        if (!loaded?.lib?.getDocument) {throw new Error('PDF.js 不可用，无法把 PDF 页面渲染给 OCR');}
        const data = new Uint8Array(await readBuffer(file));
        if (cancelled()) {return;}
        loadingTask = loaded.lib.getDocument(pdfDocumentOptions(data, loaded));
        const pdf = await loadingTask.promise;
        const maxPages = Math.min(pdf.numPages, pageLimit);
        const created = await createOcrWorker(lang, (m)=>{
          if (!cancelled() && m && m.status) {setOcrStatus(`OCR ${m.status}${Number.isFinite(m.progress) ? ' ' + Math.round(m.progress * 100) + '%' : ''}`, 'warn');}
        });
        worker = created.worker;
        if (cancelled()) {return;}
        const pages = [];
        for (let pageNo = 1;pageNo <= maxPages;pageNo++) {
          setOcrStatus(`正在识别第 ${pageNo} / ${maxPages} 页（${created.mode}）……`, 'warn');
          canvas = await renderPdfPageToCanvas(pdf, pageNo, 2);
          if (cancelled()) {return;}
          const res = await Promise.race([worker.recognize(canvas), cancellation]);
          if (cancelled()) {return;}
          const text = String(res?.data?.text || '').replace(/\r/g, '').trim();
          const confidence = Number(res?.data?.confidence || 0);
          pages.push({ page: pageNo, text, confidence });
          canvas.width = 1;canvas.height = 1;
          ocrImportState.pages = pages;
          ocrImportState.text = formatOcrPages(pages);
          if (resultEl) {resultEl.value = ocrImportState.text;}
        }
        if (pdf.numPages > maxPages) {pages.push({ page: maxPages + 1, text: `已按页数限制停止。原 PDF 共 ${pdf.numPages} 页，如需继续请调高识别页数。`, confidence: 0, notice: true });}
        ocrImportState.pages = pages;
        ocrImportState.text = formatOcrPages(pages);
        if (resultEl) {resultEl.value = ocrImportState.text;}
        setOcrStatus(`OCR 完成：识别 ${maxPages} 页。请先核对文本，再填入导入文本或下载 DOCX。`, 'ok');
        toast('OCR 识别完成，可核对后继续导入或下载 DOCX。', 'ok', 'OCR 完成');
      } catch(err) {
        if (cancelled()) {return;}
        setOcrStatus('OCR 失败：' + err.message, 'danger');
        toast('OCR 失败：' + err.message, 'danger', 'OCR 失败');
      } finally {
        if (canvas) {canvas.width = 1;canvas.height = 1;}
        try {if (worker) {await worker.terminate();}} catch(e) {warnDev('OCR worker 关闭失败', e);}
        try {await loadingTask?.destroy();} catch(e) {warnDev('OCR PDF 资源释放失败', e);}
        run.running = false;run.cancel = null;
        if (run === ocrImportState) {setOcrButtonsEnabled(!!run.text);}
      }
    }
    async function renderPdfPageToCanvas(pdf, pageNo, scale = 2) {
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({ scale });
      // 单页 RGBA 像素预算为 64 MiB，防止异常页面尺寸在分配 Canvas 前耗尽内存。
      const maxPixels = 16 * 1024 * 1024;
      const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width * height > maxPixels) {page.cleanup();throw new Error('PDF 页面像素超限，请缩小扫描尺寸后重试。');}
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      try {await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;return canvas;}
      catch(error) {canvas.width = 1;canvas.height = 1;throw error;}
      finally {page.cleanup();}
    }
    function formatOcrPages(pages) {
      return (pages || []).map((p)=>`【OCR第${p.page}页${p.confidence ? `｜置信度 ${Math.round(p.confidence)}%` : ''}】\n${p.text || ''}`.trim()).join('\n\n').trim();
    }
    function currentOcrText() {
      const fromBox = $('#ocr-result')?.value || '';
      return String(fromBox || ocrImportState.text || '').trim();
    }

    return {
      setOcrImportSource, resetOcrImportState, setOcrStatus, startPdfOcrImport, currentOcrText,
      isRunning: () => ocrImportState.running,
      cancel: () => ocrImportState.cancel?.(),
      getFile: () => ocrImportState.file,
    };
  }

  globalThis.ShirohaOcrImport = Object.freeze({ create });
})();
