// @ts-check
// 管理浏览器来源的已记住和仅会话凭据，发送前核对服务地址与账号是否一致。
(function () {
  'use strict';
  const scope = /** @type {typeof globalThis & import('./runtime').BrowserGlobals} */ (globalThis);
  const AI_LOCAL = 'shiroha_ai_key_local_v99'; const AI_SESSION = 'shiroha_ai_key_session_v99';
  const DAV_LOCAL = 'shiroha_webdav_password_local_v378'; const DAV_SESSION = 'shiroha_webdav_password_session_v378';
  const DAV_CONFIG = 'shiroha_webdav_config_local_v378';
  const BINDINGS = 'shiroha_credential_bindings_v1';
  const MARKER = '[已保存的凭据]';
  /** @typedef {{endpoint:string,username?:string,rememberKey?:boolean,rememberPassword?:boolean}} Config */
  /** @param {Config} config */
  function binding(config) {
    // 同一服务地址末尾带不带斜杠应得到相同凭据绑定。
    return JSON.stringify([config.endpoint.replace(/\/+$/, ''), config.username || '']);
  }

  /** @returns {Record<string,string>} */
  function bindings() {
    return JSON.parse(localStorage.getItem(BINDINGS) || '{}');
  }

  /** 只从调用方选定的记住范围读取当前服务绑定的凭据。
   * @param {'ai'|'webdav'} service @param {Config} config
   */
  function read(service, config) {
    if (bindings()[service] !== binding(config)) { return ''; }

    const remember = service === 'ai' ? config.rememberKey : config.rememberPassword;
    const localKey = service === 'ai' ? AI_LOCAL : DAV_LOCAL;
    const sessionKey = service === 'ai' ? AI_SESSION : DAV_SESSION;
    const store = remember ? localStorage : sessionStorage;
    const key = remember ? localKey : sessionKey;
    return store.getItem(key) || '';
  }

  /** 浏览器首次读取旧版设置时，补录原配置对应的凭据绑定。
   * @param {Config} ai
   */
  function initialize(ai) {
    const current = bindings();
    const dav = JSON.parse(localStorage.getItem(DAV_CONFIG) || 'null');
    // 只在当前来源首次升级时绑定旧凭据；之后端点变化或备份恢复不能自动重新绑定。
    if (!Object.hasOwn(current, 'ai')) { current.ai = binding(ai); }

    if (!Object.hasOwn(current, 'webdav') && dav) { current.webdav = binding(dav); }

    const encoded = JSON.stringify(current);
    if (localStorage.getItem(BINDINGS) !== encoded) { localStorage.setItem(BINDINGS, encoded); }
  }

  /** 保存写入前的键值，失败时恢复缺失状态和原值。
   * @param {[Storage,string][]} entries
   */
  function checkpoint(entries) {
    const previous = entries.map(([store, key]) => ({ store, key, value: store.getItem(key) }));
    // 恢复原来缺失的键时要删除它，避免把空值写成已设置的配置。
    return () => {
      for (const { store, key, value } of previous) {
        if (value === null) { store.removeItem(key); } else { store.setItem(key, value); }
      }
    };
  }

  /** 保存凭据和绑定信息，并返回回滚操作供上层配置保存失败时使用。
   * @param {'ai'|'webdav'} service @param {Config} config @param {string} value @param {boolean} remember
   */
  function set(service, config, value, remember) {
    const localKey = service === 'ai' ? AI_LOCAL : DAV_LOCAL;
    const sessionKey = service === 'ai' ? AI_SESSION : DAV_SESSION;
    const undo = checkpoint([[localStorage, localKey], [sessionStorage, sessionKey], [localStorage, BINDINGS]]);
    let secret = value;
    if (value === MARKER) {
      const sameBinding = bindings()[service] === binding(config);
      secret = sameBinding ? (localStorage.getItem(localKey) || sessionStorage.getItem(sessionKey) || '') : '';
      if (!secret) {
        throw new Error('服务地址或账号已改变，请重新输入凭据。');
      }
    }

    try {
      const primary = remember ? localStorage : sessionStorage;
      const primaryKey = remember ? localKey : sessionKey;
      if (secret) { primary.setItem(primaryKey, secret); } else { primary.removeItem(primaryKey); }

      (remember ? sessionStorage : localStorage).removeItem(remember ? sessionKey : localKey);
      localStorage.setItem(BINDINGS, JSON.stringify({ ...bindings(), [service]: binding(config) }));
    } catch (error) { undo(); throw error; }

    return undo;
  }

  /** @param {'ai'|'webdav'} service @param {Config} config */
  function status(service, config) {
    return read(service, config) ? MARKER : '';
  }

  /** @param {Config} config @param {string} text */
  function redact(config, text) {
    const secret = read('ai', config); return secret ? text.split(secret).join('[API_KEY]') : text;
  }

  /** 在网络调用前解析 UI 占位符，让原始设置对象可以继续用于界面。
   * @param {Config & {apiKey?:string}} config @param {unknown} payload @param {AbortSignal} [signal]
   */
  function ai(config, payload, signal) {
    return scope.ShirohaBrowserNetwork.ai(
      { ...config, apiKey: config.apiKey === MARKER ? read('ai', config) : config.apiKey },
      payload,
      signal,
    );
  }

  /** 只在请求当前绑定的服务时将已保存密码交给网络适配器。
   * @param {Config} config @param {string} password @param {string} path
   * @param {Parameters<import('./runtime').BrowserNetwork['webdav']>[3]} options
   */
  function webdav(config, password, path, options) {
    return scope.ShirohaBrowserNetwork.webdav(
      config,
      password === MARKER ? read('webdav', config) : password,
      path,
      options,
    );
  }

  function readDav() {
    return JSON.parse(localStorage.getItem(DAV_CONFIG) || 'null');
  }

  /** 将服务设置和可选密码作为一次可回滚的配置更新。
   * @param {Config} config @param {string} password @param {boolean} storePassword
   */
  function saveDav(config, password, storePassword) {
    const undo = checkpoint([
      [localStorage, DAV_CONFIG], [localStorage, DAV_LOCAL], [sessionStorage, DAV_SESSION], [localStorage, BINDINGS],
    ]);
    try {
      if (storePassword) { set('webdav', config, password, !!config.rememberPassword); }

      localStorage.setItem(DAV_CONFIG, JSON.stringify(config));
    } catch (error) { undo(); throw error; }
  }

  // 清除 WebDAV 设置和两种密码存储；部分清理失败时恢复原值。
  function clearDav() {
    const undo = checkpoint([[localStorage, DAV_CONFIG], [localStorage, DAV_LOCAL], [sessionStorage, DAV_SESSION]]);
    try {
      localStorage.removeItem(DAV_CONFIG); localStorage.removeItem(DAV_LOCAL); sessionStorage.removeItem(DAV_SESSION);
    } catch (error) { undo(); throw error; }
  }

  // 重置当前来源的凭据和仍受支持的浏览器数据键，写入失败时恢复原状态。
  function reset() {
    /** @type {[Storage,string][]} */ const entries = [
      [localStorage, AI_LOCAL], [sessionStorage, AI_SESSION], [localStorage, DAV_CONFIG],
      [localStorage, DAV_LOCAL], [sessionStorage, DAV_SESSION], [localStorage, BINDINGS],
      [localStorage, 'shiroha_quiz_state'], [localStorage, 'uquiz_state_v8_c1'],
      [localStorage, 'shiroha_quiz_state_v28_4_c1'],
    ];
    const undo = checkpoint(entries);
    try { for (const [store, key] of entries) { store.removeItem(key); } } catch (error) { undo(); throw error; }
  }

  const api = { initialize, set, status, redact, ai, webdav, checkpoint, readDav, saveDav, clearDav, reset };
  /** @type {typeof globalThis & {ShirohaBrowserCredentials?:typeof api}} */
  (globalThis).ShirohaBrowserCredentials = api;
})();
