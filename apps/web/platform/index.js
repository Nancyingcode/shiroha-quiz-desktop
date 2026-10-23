// @ts-check
(function () {
  'use strict';
  const scope = /** @type {typeof globalThis & import('./runtime').BrowserGlobals} */ (globalThis);
  // 原型仍使用浏览器数据来源。桌面原生入口未来在此脚本之前注入，业务层不探测宿主。
  if (scope.ShirohaPlatform) return;
  const storage = scope.ShirohaBrowser.createStorage({
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: key => localStorage.removeItem(key),
  }, 'shiroha_quiz_state_v28_4_c1');
  globalThis.addEventListener('storage', event => { if (event.key === null || event.key === 'shiroha_quiz_state_v28_4_c1') storage.invalidate(); });
  scope.ShirohaPlatform = { resourceJson: scope.ShirohaBrowser.resourceJson, media: scope.ShirohaBrowser.media, files: scope.ShirohaBrowser.files, preferences: scope.ShirohaBrowser.preferences, storage, saves: scope.ShirohaSaveQueue.create(storage), download: scope.ShirohaBrowser.download, network: scope.ShirohaBrowserCredentials, credentials: scope.ShirohaBrowserCredentials };
})();
