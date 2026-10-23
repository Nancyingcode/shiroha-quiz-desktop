(() => {
  /** @typedef {{minimize: () => Promise<void>, toggleMaximize: () => Promise<void>, isMaximized: () => Promise<boolean>, close: () => Promise<void>, startDragging: () => Promise<void>}} DesktopWindow */
  const host = /** @type {Window & {__TAURI__?: {window: {getCurrentWindow: () => DesktopWindow}}}} */ (window);
  const titlebar = document.getElementById('desktop-titlebar');
  const drag = document.getElementById('desktop-window-drag');
  const status = document.getElementById('desktop-window-status');
  const minimize = /** @type {HTMLButtonElement | null} */ (document.getElementById('desktop-window-minimize'));
  const maximize = /** @type {HTMLButtonElement | null} */ (document.getElementById('desktop-window-maximize'));
  const close = /** @type {HTMLButtonElement | null} */ (document.getElementById('desktop-window-close'));
  if (!titlebar || !drag || !status || !minimize || !maximize || !close) return;
  const buttons = [minimize, maximize, close];
  const appWindow = host.__TAURI__?.window.getCurrentWindow();
  if (!appWindow) {
    status.hidden = false;
    status.textContent = '窗口控制不可用，请在桌面程序中打开。';
    return;
  }

  // 状态仅属于本页面的主窗口；序号避免快速缩放时迟到的查询覆盖最新图标。
  let stateRequest = 0;
  let actionPending = false;
  let resizeTimer = 0;
  const syncMaximized = async () => {
    const request = ++stateRequest;
    const maximized = await appWindow.isMaximized();
    if (request !== stateRequest) return;
    titlebar.dataset.maximized = String(maximized);
    const label = maximized ? '还原' : '最大化';
    maximize.setAttribute('aria-label', label);
    maximize.title = label;
  };
  const showError = () => {
    status.hidden = false;
    status.textContent = '窗口操作未完成，请重试；可按 Alt+F4 关闭窗口。';
  };
  /** @param {() => Promise<void>} action */
  const run = async (action) => {
    if (actionPending) return;
    actionPending = true;
    buttons.forEach(button => { button.disabled = true; });
    status.hidden = true;
    try {
      await action();
      await syncMaximized();
    } catch { showError(); }
    finally {
      actionPending = false;
      buttons.forEach(button => { button.disabled = false; });
    }
  };
  minimize.addEventListener('click', () => { void run(() => appWindow.minimize()); });
  maximize.addEventListener('click', () => { void run(() => appWindow.toggleMaximize()); });
  close.addEventListener('click', () => { void run(() => appWindow.close()); });
  drag.addEventListener('mousedown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (event.detail === 2) void run(() => appWindow.toggleMaximize());
    else void appWindow.startDragging().catch(showError);
  });
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { void syncMaximized().catch(showError); }, 80);
  });
  buttons.forEach(button => { button.disabled = false; });
  void syncMaximized().catch(showError);
})();
