// 作为经典脚本登记面板工厂，供在线、本地文件和桌面入口共同加载。
(() => {
  'use strict';

  // 按需创建查找替换面板，由调用方处理原文修改后的导入状态。
  function create({ select, escapeRegExp, onTextEdited }) {
    // 兼容用户粘贴的斜杠写法，从尾部识别模式与修饰符。
    function parseSlashRegexV51(raw) {
      const text = String(raw || '');
      if (text.length < 2 || text[0] !== '/') {
        return null;
      }

      let escaped = false;
      for (let i = text.length - 1; i > 0; i -= 1) {
        const ch = text[i];
        if (ch === '/' && !escaped) {
          return { pattern: text.slice(1, i), flags: text.slice(i + 1) };
        }

        escaped = ch === '\\' && !escaped;
        if (ch !== '\\') {
          escaped = false;
        }
      }

      return null;
    }

    // 按文本或正则查找模式构造匹配器，让全局匹配与大小写遵循面板选项。
    function buildFindRegExpV51(pattern, { useRegex = true, caseSensitive = true, global = true } = {}) {
      const searchPattern = String(pattern || '');
      if (!searchPattern) {
        throw new Error('请先输入查找内容');
      }

      let source = searchPattern;
      let flags = global ? 'g' : '';
      if (useRegex) {
        const parsed = parseSlashRegexV51(searchPattern.trim());
        if (parsed) {
          source = parsed.pattern;
          flags = parsed.flags.replace(/* 只允许当前查找面板支持的 JavaScript 正则修饰符。 */ /[^gimsuy]/g, '');
          if (global && !flags.includes('g')) {
            flags += 'g';
          }

          if (!caseSensitive && !flags.includes('i')) {
            flags += 'i';
          }

          if (caseSensitive) {
            flags = flags.replace(/* 启用区分大小写时移除不区分大小写的修饰符。 */ /i/g, '');
          }
        } else {
          if (!caseSensitive) {
            flags += 'i';
          }
        }
      } else {
        source = escapeRegExp(searchPattern);
        if (!caseSensitive) {
          flags += 'i';
        }
      }

      const re = /* 使用面板派生模式和去重的修饰符创建文本查找匹配器。 */ new RegExp(source, [...new Set(flags.split(''))].join(''));
      if (''.match(re)) {
        throw new Error('查找规则不能匹配空字符串');
      }

      return re;
    }

    // 按需建立导入查找替换面板并绑定原文操作，保留已有控件实例。
    function ensureImportFindReplacePanelV51() {
      let panel = select('#import-find-replace-panel-v51');
      if (panel) {
        return panel;
      }

      panel = document.createElement('div');
      panel.id = 'import-find-replace-panel-v51';
      panel.className = 'import-find-replace-panel-v51 hidden';
      panel.innerHTML = `
    <div class="import-find-replace-card-v51" role="dialog" aria-modal="false" aria-label="查找替换">
      <div class="import-find-replace-head-v51">
        <strong>查找替换</strong>
        <button type="button" class="ghost import-find-close-v51" aria-label="关闭">×</button>
      </div>
      <div class="import-find-replace-grid-v51">
        <label>查找内容<input id="import-find-pattern-v51" placeholder="支持正则，例如：答案[：:]\\s*([A-G])" /></label>
        <label>替换为<input id="import-replace-value-v51" placeholder="留空则删除匹配内容，可用 $1" /></label>
      </div>
      <div class="import-find-replace-options-v51">
        <label><input id="import-find-regex-v51" type="checkbox" checked /> 正则</label>
        <label><input id="import-find-case-v51" type="checkbox" checked /> 区分大小写</label>
      </div>
      <div class="import-find-replace-actions-v51">
        <button type="button" class="ghost" id="import-find-next-v51">查找下一个</button>
        <button type="button" class="ghost" id="import-replace-current-v51">替换当前</button>
        <button type="button" class="primary" id="import-replace-all-v51">全部替换</button>
      </div>
      <p class="muted import-find-replace-tip-v51">替换内容留空时等同于删除；正则替换支持 $1、$2 等分组引用。</p>
      <div class="notice import-find-status-v51" id="import-find-status-v51">请输入查找内容。</div>
    </div>`;
      document.body.appendChild(panel);
      panel.querySelector('.import-find-close-v51').onclick = closeImportFindReplaceV51;
      panel.addEventListener('click', (e) => {
        if (e.target === panel) {
          closeImportFindReplaceV51();
        }
      });

      select('#import-find-next-v51').onclick = findNextImportTextV51;
      select('#import-replace-current-v51').onclick = replaceCurrentImportTextV51;
      select('#import-replace-all-v51').onclick = replaceAllImportTextV51;
      const pattern = panel.querySelector('#import-find-pattern-v51');
      if (pattern) {
        pattern.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            findNextImportTextV51();
          }
        });
      }

      return panel;
    }

    // 打开查找替换面板并从原文选区准备查找内容和键盘焦点。
    function openImportFindReplaceV51() {
      const panel = ensureImportFindReplacePanelV51();
      panel.classList.remove('hidden');
      const text = select('#import-text');
      const pattern = select('#import-find-pattern-v51');
      if (text && text.selectionStart !== text.selectionEnd && !pattern.value) {
        pattern.value = text.value.slice(text.selectionStart, text.selectionEnd);
      }

      setTimeout(() => {
        (pattern || select('#import-replace-value-v51'))?.focus();
      }, 0);
    }

    function closeImportFindReplaceV51() {
      const panel = select('#import-find-replace-panel-v51');
      if (panel) {
        panel.classList.add('hidden');
      }
    }

    // 将查找结果或模式错误反馈到面板状态区域。
    function setFindStatusV51(msg, type = 'warn') {
      const el = select('#import-find-status-v51');
      if (!el) {
        return;
      }

      el.textContent = msg;
      el.className = `notice import-find-status-v51 ${['ok', 'danger'].includes(type) ? type : 'warn'}`;
    }

    // 在每次操作时读取面板当前的查找词、替换词及匹配选项。
    function getFindConfigV51() {
      return {
        pattern: select('#import-find-pattern-v51')?.value || '',
        replacement: select('#import-replace-value-v51')?.value || '',
        useRegex: !!select('#import-find-regex-v51')?.checked,
        caseSensitive: !!select('#import-find-case-v51')?.checked,
      };
    }

    // 从原文当前选区后查找，末尾无匹配时允许回到开头。
    function findNextImportTextV51() {
      const textEl = select('#import-text');
      if (!textEl) {
        setFindStatusV51('没有找到原始文本框。', 'danger');
        return false;
      }

      try {
        const cfg = getFindConfigV51();
        const re = buildFindRegExpV51(cfg.pattern, { useRegex: cfg.useRegex, caseSensitive: cfg.caseSensitive, global: true });
        const text = textEl.value || '';
        const start = textEl.selectionEnd || 0;
        re.lastIndex = start;
        let match = re.exec(text);
        let wrapped = false;
        if (!match && start > 0) {
          re.lastIndex = 0;
          match = re.exec(text);
          wrapped = true;
        }

        if (!match) {
          setFindStatusV51('没有找到匹配内容。', 'warn');
          return false;
        }

        textEl.focus();
        textEl.setSelectionRange(match.index, match.index + match[0].length);
        setFindStatusV51(`${wrapped ? '已从头查找，' : ''}找到 1 处：第 ${match.index + 1} 个字符。`, 'ok');
        return true;
      } catch (err) {
        setFindStatusV51(err.message || String(err), 'danger');
        return false;
      }
    }

    // 优先替换当前匹配选区，否则先定位下一处命中再写回原文。
    function replaceCurrentImportTextV51() {
      const textEl = select('#import-text');
      if (!textEl) {
        setFindStatusV51('没有找到原始文本框。', 'danger');
        return;
      }

      try {
        const cfg = getFindConfigV51();
        const re = buildFindRegExpV51(cfg.pattern, { useRegex: cfg.useRegex, caseSensitive: cfg.caseSensitive, global: false });
        let start = textEl.selectionStart || 0;
        let end = textEl.selectionEnd || 0;
        if (start === end || !re.test(textEl.value.slice(start, end))) {
          if (!findNextImportTextV51()) {
            return;
          }

          start = textEl.selectionStart || 0;
          end = textEl.selectionEnd || 0;
        }

        const selected = textEl.value.slice(start, end);
        re.lastIndex = 0;
        const next = selected.replace(re, cfg.replacement);
        textEl.setRangeText(next, start, end, 'select');
        onTextEdited(textEl);
        setFindStatusV51(next ? '已替换当前匹配。' : '已删除当前匹配。', 'ok');
      } catch (err) {
        setFindStatusV51(err.message || String(err), 'danger');
      }
    }

    // 全量替换前统计命中数，只在确有匹配时修改原文并更新草稿。
    function replaceAllImportTextV51() {
      const textEl = select('#import-text');
      if (!textEl) {
        setFindStatusV51('没有找到原始文本框。', 'danger');
        return;
      }

      try {
        const cfg = getFindConfigV51();
        const re = buildFindRegExpV51(cfg.pattern, { useRegex: cfg.useRegex, caseSensitive: cfg.caseSensitive, global: true });
        const text = textEl.value || '';
        let count = 0;
        text.replace(re, () => {
          count += 1;
          return '';
        });

        if (!count) {
          setFindStatusV51('没有找到匹配内容。', 'warn');
          return;
        }

        textEl.value = text.replace(re, cfg.replacement);
        onTextEdited(textEl);
        setFindStatusV51(cfg.replacement ? `已替换 ${count} 处。` : `已删除 ${count} 处。`, 'ok');
      } catch (err) {
        setFindStatusV51(err.message || String(err), 'danger');
      }
    }

    return { open: openImportFindReplaceV51, parseSlashRegexV51, buildFindRegExpV51 };
  }

  globalThis.ShirohaImportFindReplace = Object.freeze({ create });
})();
