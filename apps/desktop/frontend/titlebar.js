(() => {
  /** @typedef {{minimize: () => Promise<void>, toggleMaximize: () => Promise<void>, isMaximized: () => Promise<boolean>, close: () => Promise<void>, startDragging: () => Promise<void>}} DesktopWindow */
  const host = /** @type {Window & {ShirohaDesktopHost?: {window: DesktopWindow}}} */ (window);
  /** @typedef {import('../../web/platform/runtime').LocaleGlobals} LocaleGlobals */
  const { ShirohaI18n: i18n } = /** @type {typeof globalThis & LocaleGlobals} */ (globalThis);
  const titlebar = document.getElementById('desktop-titlebar');
  const drag = document.getElementById('desktop-window-drag');
  const status = document.getElementById('desktop-window-status');
  const minimize = /** @type {HTMLButtonElement | null} */ (document.getElementById('desktop-window-minimize'));
  const maximize = /** @type {HTMLButtonElement | null} */ (document.getElementById('desktop-window-maximize'));
  const close = /** @type {HTMLButtonElement | null} */ (document.getElementById('desktop-window-close'));
  if (!titlebar || !drag || !status || !minimize || !maximize || !close) { return; }
  const captionName = drag.querySelector('span');
  if (captionName) {
    // 按钮保留在 body 下以沿用保存锁；本页面观察标题宽度，字体缩放后仍紧邻名称。
    const syncNavigationPosition = () => {
      document.body.style.setProperty(
        '--desktop-navigation-toggle-left',
        `${captionName.getBoundingClientRect().right + 8}px`,
      );
    };
    syncNavigationPosition();
    new window.ResizeObserver(syncNavigationPosition).observe(captionName);
  }
  const buttons = [minimize, maximize, close];
  const appWindow = host.ShirohaDesktopHost?.window;
  if (!appWindow) {
    status.hidden = false;
    i18n.bindText(status, 'window.unavailable');
    return;
  }

  // 状态仅属于本页面的主窗口；序号避免快速缩放时迟到的查询覆盖最新图标。
  let stateRequest = 0;
  let actionPending = false;
  let resizeTimer = 0;
  const syncMaximized = async () => {
    stateRequest += 1; const request = stateRequest;
    const maximized = await appWindow.isMaximized();
    if (request !== stateRequest) { return; }
    titlebar.dataset.maximized = String(maximized);
    const key = maximized ? 'window.restore' : 'window.maximize';
    i18n.bindAttribute(maximize, 'aria-label', key);
    i18n.bindAttribute(maximize, 'title', key);
  };
  const showError = () => {
    status.hidden = false;
    i18n.bindText(status, 'window.error');
  };
  /** @param {() => Promise<void>} action */
  const run = async (action) => {
    if (actionPending) { return; }
    actionPending = true;
    buttons.forEach((button) => {
      button.disabled = true;
    });
    status.hidden = true;
    try {
      await action();
      await syncMaximized();
    } catch { showError(); } finally {
      actionPending = false;
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
  };
  minimize.addEventListener('click', () => {
    window.dispatchEvent(new Event('shiroha:practice-hidden'));
    void run(() => appWindow.minimize());
  });
  maximize.addEventListener('click', () => {
    void run(() => appWindow.toggleMaximize());
  });
  close.addEventListener('click', () => {
    void run(() => appWindow.close());
  });
  drag.addEventListener('mousedown', (event) => {
    if (event.button !== 0) { return; }
    event.preventDefault();
    if (event.detail === 2) {
      void run(() => appWindow.toggleMaximize());
    } else {
      void appWindow.startDragging().catch(showError);
    }
  });
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      void syncMaximized().catch(showError);
    }, 80);
  });
  buttons.forEach((button) => {
    button.disabled = false;
  });
  void syncMaximized().catch(showError);
})();
