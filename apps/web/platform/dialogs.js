// @ts-check
(() => {
  'use strict';
  /** @typedef {{title?: string, acceptLabel?: string, cancelLabel?: string}} DialogOptions */
  /** @typedef {'alert' | 'confirm' | 'prompt'} DialogKind */
  // 队列属于当前页面；关闭后释放节点与回调，避免并发提示互相覆盖或重复提交。
  let pending = Promise.resolve();

  /** @param {DialogKind} kind @param {string} message @param {string} initial @param {DialogOptions} options */
  function open(kind, message, initial, options) {
    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const dialog = document.createElement('dialog');
      dialog.id = 'app-dialog';
      dialog.setAttribute('aria-labelledby', 'app-dialog-title');
      dialog.setAttribute('aria-describedby', 'app-dialog-message');
      dialog.innerHTML = `<form method="dialog" class="app-dialog-form">
        <button type="button" data-dialog-close aria-label="关闭">×</button>
        <div class="app-dialog-icon" aria-hidden="true">i</div>
        <h2 id="app-dialog-title"></h2>
        <p id="app-dialog-message"></p>
        <input id="app-dialog-input" type="text" autocomplete="off" aria-labelledby="app-dialog-message">
        <div class="app-dialog-actions">
          <button type="button" data-dialog-cancel></button>
          <button type="submit" data-dialog-accept></button>
        </div>
      </form>`;
      const form = /** @type {HTMLFormElement} */ (dialog.querySelector('form'));
      const input = /** @type {HTMLInputElement} */ (dialog.querySelector('input'));
      const cancel = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-dialog-cancel]'));
      const accept = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-dialog-accept]'));
      const close = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-dialog-close]'));
      const title = /** @type {HTMLElement} */ (dialog.querySelector('h2'));
      const description = /** @type {HTMLElement} */ (dialog.querySelector('p'));
      title.textContent = options.title || ({ alert: '提示', confirm: '请确认', prompt: '请输入' })[kind];
      description.textContent = message;
      input.hidden = kind !== 'prompt';
      input.value = initial;
      cancel.hidden = kind === 'alert';
      cancel.textContent = options.cancelLabel || '取消';
      accept.textContent = options.acceptLabel || (kind === 'alert' ? '知道了' : '确定');
      let settled = false;
      /** @param {boolean} accepted */
      const finish = accepted => {
        if (settled) return;
        settled = true;
        let value = null;
        if (kind === 'confirm') value = accepted;
        if (kind === 'prompt' && accepted) value = input.value;
        dialog.close();
        dialog.remove();
        if (previousFocus instanceof window.HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
        resolve(value);
      };
      form.addEventListener('submit', event => { event.preventDefault(); finish(true); });
      cancel.addEventListener('click', () => finish(false));
      close.addEventListener('click', () => finish(false));
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
      dialog.addEventListener('keydown', event => {
        // 模态框内的快捷键不应切题、作答或触发页面保存；Tab 循环不将焦点交给浏览器工具栏。
        event.stopPropagation();
        if (event.key !== 'Tab') return;
        const controls = [close, input, cancel, accept].filter(control => !control.hidden && !control.disabled);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
      document.body.appendChild(dialog);
      dialog.showModal();
      if (kind === 'prompt') { input.focus(); input.select(); }
      else if (kind === 'confirm') cancel.focus();
      else accept.focus();
    });
  }

  /** @param {DialogKind} kind @param {string} message @param {string} initial @param {DialogOptions} options */
  function enqueue(kind, message, initial, options) {
    const result = pending.then(() => open(kind, message, initial, options));
    pending = result.then(() => {}, () => {});
    return result;
  }
  const api = {
    /** @param {string} message @param {DialogOptions} [options] */
    async alert(message, options = {}) { await enqueue('alert', message, '', options); },
    /** @param {string} message @param {DialogOptions} [options] */
    async confirm(message, options = {}) { return (await enqueue('confirm', message, '', options)) === true; },
    /** @param {string} message @param {string} [initial] @param {DialogOptions} [options] */
    async prompt(message, initial = '', options = {}) {
      const value = await enqueue('prompt', message, initial, options);
      return typeof value === 'string' ? value : null;
    },
  };
  const scope = /** @type {typeof globalThis & {ShirohaDialogs?: typeof api}} */ (globalThis);
  scope.ShirohaDialogs = api;
})();
