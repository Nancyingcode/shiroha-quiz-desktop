// @ts-check
// 在浏览器中装配共享平台；已注入平台的桌面入口继续负责自身初始化。
(function () {
  'use strict';

  /** 创建浏览器存储，并在其他标签页更新本应用数据时使缓存失效。
   * @param {import('./runtime').BrowserGlobals['ShirohaBrowser']} browser
   */
  function createBrowserStorage(browser) {
    const storageKey = 'shiroha_quiz_state_v28_4_c1';
    const storage = browser.createStorage({
      getItem: (key) => localStorage.getItem(key),

      setItem: (key, value) => localStorage.setItem(key, value),

      removeItem: (key) => localStorage.removeItem(key),
    }, storageKey);
    globalThis.addEventListener('storage', (event) => {
      if (event.key === null || event.key === storageKey) {
        storage.invalidate();
      }
    });

    return storage;
  }

  const scope = /** @type {typeof globalThis & import('./runtime').BrowserGlobals} */ (globalThis);
  // 原型仍使用浏览器数据来源。桌面原生入口未来在此脚本之前注入，业务层不探测宿主。
  if (scope.ShirohaPlatform) {
    return;
  }

  const storage = createBrowserStorage(scope.ShirohaBrowser);
  scope.ShirohaPlatform = {
    resourceJson: scope.ShirohaBrowser.resourceJson,
    media: scope.ShirohaBrowser.media,
    files: scope.ShirohaBrowser.files,
    preferences: scope.ShirohaBrowser.preferences,
    storage,
    saves: scope.ShirohaSaveQueue.create(storage),
    download: scope.ShirohaBrowser.download,
    network: scope.ShirohaBrowserCredentials,
    credentials: scope.ShirohaBrowserCredentials,
  };
})();
