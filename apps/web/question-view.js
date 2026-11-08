(() => {
  'use strict';
  function create({ select: $, selectAll: $$, escape: esc, warn: warnDev, platform: ShirohaPlatform,
    normalizeJsonMultilineTextV5910, trimMultilineBoundaryV5910, displayOptionTextV589,
    repairCircledCombinationQuestion, normalizeQuestionImagesForWebV83, questionImageDataUriRegexV83,
    questionTextContainsDataUriV83, practiceSourceMeta, label, scoreOf, hasAnswerValueV58914,
    isMultiBlankQuestionV58914, isTextType, normalizeWebQuestionType, normalizeBlankAnswersV58914 }) {
    function ensureRichQuestionContentStylesV55() {
      if (typeof document === 'undefined' || document.getElementById('shiroha-rich-question-style-v55')) {
        return;
      }
      const style = document.createElement('style');
      style.id = 'shiroha-rich-question-style-v55';
      style.textContent = `
    .q-table-wrap{width:100%;max-width:100%;overflow-x:auto;margin:12px 0;border:1px solid var(--line,rgba(79,124,255,.16));border-radius:16px;background:var(--card,#fff);box-shadow:0 8px 22px rgba(15,23,42,.05);}
    .q-table{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0;font-size:.94em;line-height:1.55;white-space:normal;}
    .q-table th,.q-table td{padding:9px 12px;border-right:1px solid var(--line,rgba(79,124,255,.14));border-bottom:1px solid var(--line,rgba(79,124,255,.14));vertical-align:top;min-width:72px;}
    .q-table th{font-weight:700;background:rgba(79,124,255,.08);}
    .q-table tr:last-child td{border-bottom:0;}
    .q-table th:last-child,.q-table td:last-child{border-right:0;}
    .q-table .question-media{margin:6px 0;}
    .question-rich-media{display:block;margin:12px 0;}
    .question-media img,.question-image{max-width:100%;height:auto;border-radius:14px;}
    .q-formula-inline,.q-formula-omml{display:inline-block;max-width:100%;overflow-x:auto;overflow-y:hidden;vertical-align:middle;padding:0 2px;}
    .q-formula-block{display:block;width:100%;max-width:100%;overflow-x:auto;overflow-y:hidden;margin:10px 0;padding:8px 0;}
    .q-formula-omml{border-radius:8px;background:rgba(79,124,255,.06);}
    .question-title,.option-text,.q-multiline-text{white-space:pre-wrap;tab-size:4;}
    .q-code-block{display:block;max-width:100%;overflow:auto;margin:10px 0;padding:12px 14px;border:1px solid var(--line,rgba(79,124,255,.16));border-radius:12px;background:rgba(15,23,42,.055);font:500 .9em/1.6 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;white-space:pre;tab-size:4;}
    .q-code-block code{font:inherit;white-space:inherit;}
    .edit-answer-multiline-v5910{min-height:180px;white-space:pre-wrap;tab-size:4;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;}
    mjx-container{max-width:100%;overflow-x:auto;overflow-y:hidden;}
    @media(max-width:640px){.q-table-wrap{margin:10px 0;border-radius:14px}.q-table th,.q-table td{padding:8px 10px;min-width:66px}.question-media img,.question-image{border-radius:12px}.q-formula-block{margin:8px 0;padding:6px 0}}
  `;
      document.head.appendChild(style);
    }
    function renderQuestionContent(s) {
      ensureRichQuestionContentStylesV55();
      const raw = String(s || '');
      const tableRe = /【DOCX表格开始】[\s\S]*?【DOCX表格结束】/g;
      let out = ''; let last = 0; let m;
      while ((m = tableRe.exec(raw))) {
        out += renderQuestionInlineRichTextV55(raw.slice(last, m.index));
        out += renderDocxTableBlockV55(m[0]);
        last = tableRe.lastIndex;
      }
      out += renderQuestionInlineRichTextV55(raw.slice(last));
      return out;
    }
    function renderQuestionInlineRichTextV55(raw) {
      const text = String(raw || '');
      const re = /!\[([^\]]{0,120})\]\((data:image\/(?:png|jpeg|jpg|gif|webp|bmp);base64,[^)]+)\)/g;
      let out = ''; let last = 0; let m;
      while ((m = re.exec(text))) {
        out += renderCodeAwareTextV5910(text.slice(last, m.index));
        const alt = m[1] || '题目图片';
        const src = m[2];
        out += `<figure class="question-media question-rich-media"><img class="question-image" src="${esc(ShirohaPlatform.media.display(src))}" alt="${esc(alt)}" loading="lazy"></figure>`;
        last = re.lastIndex;
      }
      out += renderCodeAwareTextV5910(text.slice(last));
      scheduleMathJaxTypesetV56();
      return out;
    }
    function renderCodeAwareTextV5910(raw) {
      const text = normalizeJsonMultilineTextV5910(raw);
      const re = /```([^\n\r`]*)[\r\n]?([\s\S]*?)```/g;
      let out = ''; let last = 0; let m;
      while ((m = re.exec(text))) {
        out += renderInlineMathTextV56(text.slice(last, m.index));
        const language = String(m[1] || '').trim();
        const code = normalizeJsonMultilineTextV5910(m[2] || '').replace(/^\n/, '').replace(/\n$/, '');
        out += `<pre class="q-code-block"${language ? ` data-language="${esc(language)}"` : ''}><code>${esc(code)}</code></pre>`;
        last = re.lastIndex;
      }
      out += renderInlineMathTextV56(text.slice(last));
      return out;
    }
    function renderInlineMathTextV56(raw) {
      const text = String(raw || '');
      if (!text) {
        return '';
      }
      const segments = extractFormulaSegmentsV56(text);
      if (!segments.length) {
        return esc(text).replace(/\n/g, '<br>');
      }
      let out = ''; let last = 0;
      segments.forEach((seg) => {
        if (seg.index < last) {
          return;
        }
        out += esc(text.slice(last, seg.index)).replace(/\n/g, '<br>');
        out += renderFormulaSegmentV56(seg);
        last = seg.index + seg.raw.length;
      });
      out += esc(text.slice(last)).replace(/\n/g, '<br>');
      return out;
    }
    function extractFormulaSegmentsV56(text) {
      const source = String(text || '');
      const candidates = [];
      const addMatches = (re, build) => {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(source))) {
          if (!m[0]) {
            re.lastIndex += 1;
            continue;
          }
          const seg = build(m);
          if (seg && seg.raw) {
            candidates.push({ ...seg, index: m.index });
          }
        }
      };
      addMatches(/【DOCX公式OMML：([\s\S]*?)】/g, (m) => ({ raw: m[0], tex: docxPlainFormulaToTexV56(m[1] || ''), source: 'omml' }));
      addMatches(/【DOCX公式OMML】/g, (m) => ({ raw: m[0], tex: '\\text{DOCX formula}', source: 'omml' }));
      addMatches(/\\\[[\s\S]{1,800}?\\\]|\\\([\s\S]{1,600}?\\\)|\$\$[\s\S]{1,800}?\$\$|\$[^\n$]{1,280}\$/g, (m) => ({ raw: m[0], explicit: true, source: 'latex' }));
      addMatches(/\\begin\{cases\}[\s\S]{1,800}?\\end\{cases\}/g, (m) => ({ raw: m[0], tex: m[0], display: true, source: 'latex' }));
      addMatches(/(?:[A-Za-z]\s*)?\\\{[^\n]{1,120}?\\\}\s*=\s*\\frac\s*\{[^{}]{1,120}\}\s*\{[^{}]{1,120}\}(?:\s*[A-Za-z0-9\\_^{}\-+*/=().,! ]{0,120})?/g, (m) => ({ raw: m[0], tex: m[0], source: 'latex' }));
      addMatches(/\\frac\s*\{[^{}]{1,120}\}\s*\{[^{}]{1,120}\}(?:\s*[A-Za-z0-9\\_^{}\-+*/=().,! ]{0,120})?/g, (m) => ({ raw: m[0], tex: m[0], source: 'latex' }));
      addMatches(/\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|theta|vartheta|lambda|mu|sigma|Sigma|pi|rho|bar|hat|sqrt|sum|leq|geq|neq|times|pm|cdot)\b(?:\s*(?:=|\+|-|\*|\/|<|>|\\leq|\\geq)\s*[A-Za-z0-9.\\_^{}\-+*/=()]+)?/g, (m) => ({ raw: m[0], tex: m[0], source: 'latex' }));
      if (!candidates.length) {
        return [];
      }
      candidates.sort((a, b) => a.index - b.index || b.raw.length - a.raw.length);
      const out = [];
      let end = -1;
      candidates.forEach((c) => {
        const cEnd = c.index + c.raw.length;
        if (c.index < end) {
          return;
        }
        out.push(c);
        end = cEnd;
      });
      return out;
    }
    function renderFormulaSegmentV56(seg) {
      if (!seg) {
        return '';
      }
      if (seg.explicit) {
        const block = /^(\\\[|\$\$)/.test(seg.raw);
        return `<span class="${block ? 'q-formula-block' : 'q-formula-inline'}" data-formula-source="latex">${esc(seg.raw)}</span>`;
      }
      let tex = String(seg.tex || '').trim();
      if (!tex) {
        return esc(seg.raw || '');
      }
      tex = sanitizeFormulaTexV56(tex);
      const block = !!seg.display || /\\begin\{cases\}/.test(tex) || tex.length > 90;
      const cls = (block ? 'q-formula-block' : 'q-formula-inline') + (seg.source === 'omml' ? ' q-formula-omml' : '');
      const wrapped = block ? `\\[${tex}\\]` : `\\(${tex}\\)`;
      return `<span class="${cls}" data-formula-source="${esc(seg.source || 'latex')}">${esc(wrapped)}</span>`;
    }
    function sanitizeFormulaTexV56(tex) {
      return String(tex || '')
        .replace(/\u00a0/g, ' ')
        .replace(/≤/g, '\\le ')
        .replace(/≥/g, '\\ge ')
        .replace(/≠/g, '\\ne ')
        .replace(/×/g, '\\times ')
        .replace(/±/g, '\\pm ')
        .replace(/∑/g, '\\sum ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
    function docxPlainFormulaToTexV56(text) {
      let s = String(text || '').trim();
      if (!s) {
        return '';
      }
      s = s.replace(/\(([^()]{1,120})\)\/\(([^()]{1,120})\)/g, (_, a, b) => `\\frac{${a.trim()}}{${b.trim()}}`);
      s = s.replace(/√\[([^\]]{1,80})\]\(([^()]{1,160})\)/g, (_, a, b) => `\\sqrt[${a.trim()}]{${b.trim()}}`);
      s = s.replace(/√\(([^()]{1,160})\)/g, (_, a) => `\\sqrt{${a.trim()}}`);
      return sanitizeFormulaTexV56(s);
    }
    function ensureMathJaxV56() {
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        return Promise.resolve(null);
      }
      if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
        return Promise.resolve(window.MathJax);
      }
      if (window.__shirohaMathJaxFailedV56) {
        return Promise.resolve(null);
      }
      if (window.__shirohaMathJaxLoadingV56) {
        return window.__shirohaMathJaxLoadingV56;
      }
      window.MathJax = window.MathJax || {};
      window.MathJax.startup = window.MathJax.startup || {};
      window.MathJax.loader = window.MathJax.loader || { load: ['[tex]/ams', '[tex]/noerrors', '[tex]/noundefined'] };
      // 保留 Object.assign 对 __proto__ 的赋值语义；确认不再兼容该配置后才能改用展开。
      const texDefaults = {
        inlineMath: [['\\(', '\\)'], ['$', '$']],
        displayMath: [['\\[', '\\]'], ['$$', '$$']],
        processEscapes: true,
        packages: { '[+]': ['ams', 'noerrors', 'noundefined'] },
      };
      window.MathJax.tex = Object.assign(texDefaults, window.MathJax.tex || {});
      const optionDefaults = { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] };
      window.MathJax.options = Object.assign(optionDefaults, window.MathJax.options || {});
      const sources = ['./libs/mathjax/tex-mml-chtml.js', 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js'];
      const loadAt = (i) => new Promise((resolve) => {
        if (i >= sources.length) {
          window.__shirohaMathJaxFailedV56 = true;
          resolve(null);
          return;
        }
        const script = document.createElement('script');
        script.src = sources[i];
        script.async = true;
        script.onload = () => resolve(window.MathJax || null);
        script.onerror = () => {
          script.remove();
          loadAt(i + 1).then(resolve);
        };
        document.head.appendChild(script);
      });
      window.__shirohaMathJaxLoadingV56 = loadAt(0);
      return window.__shirohaMathJaxLoadingV56;
    }
    function prewarmMathJaxV56() {
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        return;
      }
      if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
        return;
      }
      if (window.__shirohaMathJaxLoadingV56 || window.__shirohaMathJaxFailedV56) {
        return;
      }
      const run = () => ensureMathJaxV56().catch((err) => warnDev && warnDev('MathJax 预热失败', err));
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 800 });
      } else {
        setTimeout(run, 0);
      }
    }
    function mathJaxDefaultScopesV56() {
      if (typeof document === 'undefined') {
        return [];
      }
      if (document.body.classList.contains('practice-focus')) {
        const card = $('#practice-card');
        if (card) {
          return [card];
        }
      }
      if (document.body.classList.contains('exam-focus')) {
        const card = $('#exam-card');
        if (card) {
          return [card];
        }
      }
      const active = $('.view.active');
      if (active) {
        return [active];
      }
      return [document.body];
    }
    function scheduleMathJaxTypesetV56(scope) {
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        return;
      }
      window.__shirohaMathJaxPendingScopesV56 = window.__shirohaMathJaxPendingScopesV56 || new Set();
      if (scope) {
        window.__shirohaMathJaxPendingScopesV56.add(scope);
      } else {
        window.__shirohaMathJaxUseDefaultScopeV56 = true;
      }
      if (window.__shirohaMathJaxRafV56) {
        return;
      }
      const schedule = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : ((fn) => setTimeout(fn, 0));
      window.__shirohaMathJaxRafV56 = schedule(() => {
        window.__shirohaMathJaxRafV56 = 0;
        const pending = window.__shirohaMathJaxPendingScopesV56 || new Set();
        const scopes = window.__shirohaMathJaxUseDefaultScopeV56 ? mathJaxDefaultScopesV56() : [...pending].filter((el) => el && el.isConnected);
        window.__shirohaMathJaxPendingScopesV56 = new Set();
        window.__shirohaMathJaxUseDefaultScopeV56 = false;
        if (!scopes.length) {
          return;
        }
        ensureMathJaxV56().then((mj) => {
          if (mj && typeof mj.typesetPromise === 'function') {
            if (typeof mj.typesetClear === 'function') {
              mj.typesetClear(scopes);
            }
            mj.typesetPromise(scopes).catch((err) => warnDev && warnDev('MathJax 渲染失败', err));
          }
        });
      });
    }
    function renderDocxTableBlockV55(block) {
      const rows = parseDocxMarkdownTableBlockV55(block);
      if (!rows.length) {
        return renderQuestionInlineRichTextV55(block);
      }
      const head = rows[0];
      const body = rows.slice(1);
      const th = head.map((c) => `<th>${renderQuestionInlineRichTextV55(c)}</th>`).join('');
      const trs = (body.length ? body : []).map((r) => `<tr>${r.map((c) => `<td>${renderQuestionInlineRichTextV55(c)}</td>`).join('')}</tr>`).join('');
      return `<div class="q-table-wrap" role="region" aria-label="DOCX 表格"><table class="q-table"><thead><tr>${th}</tr></thead>${trs ? `<tbody>${trs}</tbody>` : ''}</table></div>`;
    }
    function parseDocxMarkdownTableBlockV55(block) {
      const lines = String(block || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      const tableLines = lines.filter((line) => line !== '【DOCX表格开始】' && line !== '【DOCX表格结束】' && /^\|.*\|$/.test(line));
      const rows = [];
      tableLines.forEach((line) => {
        const cells = splitDocxMarkdownTableRowV55(line);
        if (!cells.length) {
          return;
        }
        const isSeparator = cells.every((c) => /^:?-{3,}:?$/.test(String(c || '').trim()));
        if (isSeparator) {
          return;
        }
        rows.push(cells.map((c) => String(c || '').replace(/<br\s*\/?>(?![^<]*>)/gi, '\n').trim()));
      });
      if (!rows.length) {
        return [];
      }
      const maxCols = Math.max(...rows.map((r) => r.length));
      return rows.map((r) => Array.from({ length: maxCols }, (_, i) => r[i] || ''));
    }
    function splitDocxMarkdownTableRowV55(line) {
      let s = String(line || '').trim();
      if (s.startsWith('|')) {
        s = s.slice(1);
      }
      if (s.endsWith('|')) {
        s = s.slice(0, -1);
      }
      return s.split('|').map((c) => c.trim());
    }
    function renderStructuredQuestionImagesV83(question, images) {
      const imgs = normalizeQuestionImagesForWebV83(images).filter((img) => questionImageDataUriRegexV83().test(img.dataUrl || img.localPath || ''));
      const rendered = [];
      imgs.forEach((img, i) => {
        const src = img.dataUrl || img.localPath;
        if (questionTextContainsDataUriV83(question, src)) {
          return;
        }
        const alt = img.sourceName || (`题目图片${i + 1}`);
        rendered.push(`<figure class="question-media"><img class="question-image" src="${esc(src)}" alt="${esc(alt)}" loading="lazy"></figure>`);
      });
      return rendered.join('');
    }
    function renderQuestionBodyV83(q) {
      const question = repairCircledCombinationQuestion(q);
      return renderQuestionContent(question && question.question) + renderStructuredQuestionImagesV83(question && question.question, question && question.images);
    }
    function questionHtml(q, examMode, idx = 0, practiceItem = null) {
      const meta = `<div class="qmeta">${practiceItem ? practiceSourceMeta(practiceItem) : ''}<span class="pill">${label(q.type)}</span><span class="pill">${esc(q.category || '未分类')}</span>${examMode ? `<span class="pill">${scoreOf(q)}分</span>` : ''}</div><div class="question-title">${examMode ? `${idx}. ` : ''}${renderQuestionBodyV83(q)}</div>`;
      if (isMultiBlankQuestionV58914(q)) {
        const inputs = q.blankAnswers.map((_, index) => `<label class="multi-blank-answer-item-v58914"><span>第${index + 1}空</span><input class="text-answer multi-blank-answer-input-v58914" data-qid="${esc(q.id)}" data-blank-index-v58914="${index}" placeholder="请输入第${index + 1}空答案" /></label>`).join('');
        return `${meta}<div class="answer-input-wrap multi-blank-answer-list-v58914">${inputs}</div>`;
      }
      if (isTextType(q.type)) {
        const placeholder = q.type === 'short' ? '请输入你的简答内容；提交后可对照参考答案。' : '请输入答案。';
        const input = q.type === 'short' ? `<textarea class="text-answer" data-qid="${esc(q.id)}" placeholder="${placeholder}"></textarea>` : `<input class="text-answer" data-qid="${esc(q.id)}" placeholder="${placeholder}" />`;
        return `${meta}<div class="answer-input-wrap">${input}</div>`;
      }
      return `${meta}<div class="options">${q.options.map((o) => {
        const displayText = displayOptionTextV589(q, o);
        return `<label class="option${displayText ? '' : ' option-key-only-v59'}" data-key="${esc(o.key)}"><input type="${q.type === 'multiple' ? 'checkbox' : 'radio'}" name="q_${esc(q.id)}" value="${esc(o.key)}"><span class="option-key">${esc(o.key)}${displayText ? '.' : ''}</span>${displayText ? `<span class="option-text">${renderQuestionContent(displayText)}</span>` : ''}</label>`;
      }).join('')}</div>`;
    }
    function bindOptionSelect(root, q, canDeselect = () => false) {
      const syncSelection = () => $$(`${root} .option`).forEach((opt) => opt.classList.toggle('selected', opt.querySelector('input').checked));
      $$(`${root} .option`).forEach((opt) => {
        const input = opt.querySelector('input');
        input.addEventListener('input', syncSelection);
        if (q.type === 'multiple') {
          return;
        }
        input.addEventListener('click', () => {
          // 浏览器在 click 前已勾选单选框，使用同步高亮保留的上次状态识别重复选择。
          if (!canDeselect() || input.disabled || !opt.classList.contains('selected')) {
            return;
          }
          input.checked = false;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        input.addEventListener('keydown', (event) => {
          if (event.key !== ' ' || !canDeselect()) {
            return;
          }
          event.preventDefault();
          if (!event.repeat) {
            input.click();
          }
        });
      });
    }
    function bindAnswerOptionControls(root, q, number, canEdit, capture) {
      const box = $(root); const options = box?.querySelector('.options');
      if (!options || !options.querySelector('input')) {
        return;
      }
      options.insertAdjacentHTML('beforebegin', `<div class="answer-options-tools"><b>选项</b><button type="button" class="ghost mini-btn" data-clear-answer-options aria-label="清空第 ${number} 题选项" disabled>清空选项</button></div>`);
      options.insertAdjacentHTML('afterend', '<p class="answer-options-status" data-answer-options-status role="status" aria-live="polite"></p>');
      const button = box.querySelector('[data-clear-answer-options]'); const status = box.querySelector('[data-answer-options-status]');
      const refresh = () => {
        const editable = canEdit();
        button.disabled = !editable || !hasAnswerValueV58914(collectAnswer(root, q));
        options.querySelectorAll('input').forEach((input) => {
          input.disabled = !editable;
        });
      };
      const changed = () => {
        if (!canEdit()) {
          return;
        }
        capture();
        status.textContent = '';
        refresh();
      };
      bindOptionSelect(root, q, canEdit);
      options.querySelectorAll('input').forEach((input) => input.addEventListener('input', changed));
      button.addEventListener('refresh-answer-options', refresh);
      button.onclick = () => {
        if (!canEdit() || !hasAnswerValueV58914(collectAnswer(root, q))) {
          return;
        }
        applyAnswerStateV26(root, q, []);
        changed();
        status.textContent = '已清空本题选项';
        options.querySelector('input:not(:disabled)')?.focus({ preventScroll: true });
      };
      refresh();
    }
    function refreshAnswerOptionControls() {
      // 确认、保存和回滚可能不重绘题目，控件仍须跟随同一可编辑条件更新。
      $$('[data-clear-answer-options]').forEach((button) => button.dispatchEvent(new Event('refresh-answer-options')));
    }
    function selectedKeys(root) {
      return $$(`${root} input:checked`).map((x) => x.value).sort();
    }
    function textAnswer(root, q) {
      const el = $(`${root} .text-answer`);
      if (!el) {
        return [];
      }
      const value = normalizeWebQuestionType(q && q.type) === 'short' ? trimMultilineBoundaryV5910(el.value) : String(el.value || '').trim();
      return value.trim() ? [value] : [];
    }
    function multiBlankAnswerV58914(root) {
      return $$(`${root} .multi-blank-answer-input-v58914`).map((input) => String(input.value || '').trim());
    }
    function collectTextAnswerFromElementV58914(box, q) {
      if (!box) {
        return [];
      }
      if (isMultiBlankQuestionV58914(q)) {
        return [...box.querySelectorAll('.multi-blank-answer-input-v58914')].map((input) => String(input.value || '').trim());
      }
      const el = box.querySelector('.text-answer');
      if (!el) {
        return [];
      }
      const value = normalizeWebQuestionType(q && q.type) === 'short' ? trimMultilineBoundaryV5910(el.value) : String(el.value || '').trim();
      return value.trim() ? [value] : [];
    }
    function collectAnswer(root, q) {
      if (isMultiBlankQuestionV58914(q)) {
        return multiBlankAnswerV58914(root);
      }
      if (isTextType(q.type)) {
        return textAnswer(root, q);
      }
      return selectedKeys(root);
    }
    function answerDisplay(ans) {
      return (ans || []).join(isTextTypeValueList(ans) ? '；' : '');
    }
    function isTextTypeValueList(ans) {
      return (ans || []).some((x) => String(x).length > 1 && !/^[A-G1-9]$/.test(String(x)));
    }
    function blankAnswersFromDetailV58914(detail) {
      const direct = normalizeBlankAnswersV58914(detail && detail.blankAnswers);
      if (direct.length) {
        return direct;
      }
      return normalizeBlankAnswersV58914(detail && detail.nativeQuestion && detail.nativeQuestion.blankAnswers);
    }
    function blankUserAnswersFromDetailV58914(detail) {
      const direct = Array.isArray(detail && detail.userBlankAnswers) ? detail.userBlankAnswers.map((value) => String(value ?? '')) : null;
      if (direct && direct.length) {
        return direct;
      }
      if (Array.isArray(detail && detail.userAnswer) && blankAnswersFromDetailV58914(detail).length) {
        return detail.userAnswer.map((value) => String(value ?? ''));
      }
      if (direct) {
        return direct;
      }
      return Array.isArray(detail && detail.chosen) ? detail.chosen.map((value) => String(value ?? '')) : [];
    }
    function renderMultiBlankComparisonV58914(groups, userAnswers, showUser = true) {
      return `<div class="multi-blank-comparison-v58914">${normalizeBlankAnswersV58914(groups).map((accepted, index) => `<div class="multi-blank-comparison-row-v58914"><b>第${index + 1}空</b>${showUser ? `<span>你的答案：${esc(String((userAnswers || [])[index] || '未填写'))}</span>` : ''}<span>标准答案：${esc(accepted.join(' / ') || '未提供')}</span></div>`).join('')}</div>`;
    }
    function feedbackAnswerHtmlV58914(q, chosen) {
      if (isMultiBlankQuestionV58914(q)) {
        return renderMultiBlankComparisonV58914(q.blankAnswers, chosen, true);
      }
      if (normalizeWebQuestionType(q.type) === 'short') {
        const user = (chosen || []).join('；') || '未作答';
        const reference = (q.answer || []).join('；') || '未提供';
        return `<div class="q-multiline-text"><b>你的答案：</b>${renderQuestionContent(user)}<br><b>参考答案：</b>${renderQuestionContent(reference)}</div>`;
      }
      return `你的答案：${esc((chosen || []).join('；') || '未作答')}｜参考答案：${esc((q.answer || []).join('；'))}`;
    }
    function markOptions(root, q, chosen) {
      if (isTextType(q.type)) {
        return;
      }
      $$(`${root} .option`).forEach((o) => {
        const k = o.dataset.key;
        if (q.answer.includes(k)) {
          o.classList.add('correct');
        } else if (chosen.includes(k)) {
          o.classList.add('wrong');
        }
      });
    }
    function practiceReviewAnswerHtml(question, answers) {
      if (!hasAnswerValueV58914(answers)) {
        return '未作答';
      }
      if (isTextType(question.type)) {
        return renderQuestionContent(answers.join('；'));
      }
      return answers.map((key) => {
        const option = (question.options || []).find((value) => value.key === key);
        const text = option ? displayOptionTextV589(question, option) : '';
        return `<div>${esc(key)}${text ? `. ${renderQuestionContent(text)}` : ''}</div>`;
      }).join('');
    }
    function renderReviewAnswerSummary(q, chosen = [], missingChoice = '未记录') {
      if (isTextType(q.type)) {
        return '';
      }
      return `<div class="review-answer-summary"><div class="review-answer-correct"><b class="review-answer-value">${esc((q.answer || []).join('、') || '未提供')}</b><span>正确答案</span></div><div class="review-answer-wrong"><b class="review-answer-value">${esc(chosen.join('、') || missingChoice)}</b><span>当时错误答案</span></div></div>`;
    }
    function renderReviewOptions(q, chosen = []) {
      if (isTextType(q.type)) {
        return '';
      }
      return `<div class="options review-options" aria-label="全部选项">${(q.options || []).map((option) => {
        const correct = (q.answer || []).includes(option.key); const selected = chosen.includes(option.key);
        let status = chosen.length ? '未选择' : ''; let className = selected ? 'wrong' : '';
        if (selected) {
          status = '✕ 当时选择';
        }
        if (correct) {
          status = selected ? '✓ 正确答案 · 当时选择' : '✓ 正确答案';
          className = 'correct';
        }
        const text = displayOptionTextV589(q, option);
        return `<div class="option ${className}" data-key="${esc(option.key)}"><span class="option-key">${esc(option.key)}</span><span class="option-text">${renderQuestionContent(text)}</span><span class="review-option-status">${status}</span></div>`;
      }).join('')}</div>`;
    }
    function applyAnswerStateV26(root, q, chosen) {
      if (isMultiBlankQuestionV58914(q)) {
        $$(`${root} .multi-blank-answer-input-v58914`).forEach((input, index) => {
          input.value = String((chosen || [])[index] || '');
        });
        return;
      }
      if (isTextType(q.type)) {
        const el = $(`${root} .text-answer`);
        if (el) {
          el.value = (chosen || []).join('；');
        }
        return;
      }
      $$(`${root} input`).forEach((input) => {
        input.checked = (chosen || []).includes(input.value);
      });
      $$(`${root} .option`).forEach((o) => o.classList.toggle('selected', o.querySelector('input').checked));
    }
    return {
      renderQuestionContent, prewarmMathJaxV56, scheduleMathJaxTypesetV56, parseDocxMarkdownTableBlockV55,
      renderQuestionBodyV83, questionHtml, bindAnswerOptionControls, refreshAnswerOptionControls,
      collectTextAnswerFromElementV58914, collectAnswer, answerDisplay, blankAnswersFromDetailV58914,
      blankUserAnswersFromDetailV58914, renderMultiBlankComparisonV58914, feedbackAnswerHtmlV58914,
      markOptions, practiceReviewAnswerHtml, renderReviewAnswerSummary, renderReviewOptions, applyAnswerStateV26,
    };
  }
  globalThis.ShirohaQuestionView = { create };
})();
