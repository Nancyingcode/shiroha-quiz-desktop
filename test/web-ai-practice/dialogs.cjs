'use strict';

// 旧回归由事件选择确认/取消；现在观察真实模态框并点击按钮，不替换业务 API 或跳过确认逻辑。
async function observeAppDialogs(page) {
  await page.exposeBinding('__testAppDialogOpened', async (_source, kind, message) => {
    const operations = [];
    const act = action => { const pending = action(); operations.push(pending); return pending; };
    page.emit('app-dialog', {
      type: () => kind,
      message: () => message,
      accept: value => act(async () => {
        if (kind === 'prompt' && value !== undefined) await page.locator('#app-dialog-input').fill(value);
        await page.locator('#app-dialog [data-dialog-accept]').click();
      }),
      dismiss: () => act(() => page.locator('#app-dialog [data-dialog-close]').click()),
    });
    await Promise.all(operations);
  });
  await page.addInitScript(() => {
    const seen = new WeakSet();
    const check = () => {
      const dialog = document.getElementById('app-dialog');
      if (!dialog?.open || seen.has(dialog)) return;
      seen.add(dialog);
      const kind = !dialog.querySelector('input').hidden ? 'prompt' : dialog.querySelector('[data-dialog-cancel]').hidden ? 'alert' : 'confirm';
      globalThis.__testAppDialogOpened(kind, dialog.querySelector('#app-dialog-message').textContent);
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
  });
}
module.exports = { observeAppDialogs };
