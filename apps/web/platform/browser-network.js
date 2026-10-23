// @ts-check
(function () {
  'use strict';
  /** @typedef {{endpoint:string,username?:string}} DavConfig */
  /** @typedef {{method?:string,trailingSlash?:boolean,timeoutMs?:number,headers?:Record<string,string>,body?:BodyInit,acceptStatuses?:number[],signal?:AbortSignal}} DavOptions */
  /** @param {string} username @param {string} password */
  function basicAuth(username, password) {
    const bytes = new TextEncoder().encode(username + ':' + password);
    return 'Basic ' + globalThis.btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  }
  /** @param {DavConfig} config @param {string} relativePath @param {boolean} trailingSlash */
  function url(config, relativePath = '', trailingSlash = false) {
    const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.some(part => part === '.' || part === '..')) throw new Error('WebDAV 路径不安全。');
    const encoded = parts.map(encodeURIComponent).join('/');
    return new URL(encoded + (trailingSlash && encoded ? '/' : ''), config.endpoint.replace(/\/+$/, '') + '/').href;
  }
  /** @param {DavConfig} config @param {string} password @param {string} relativePath @param {DavOptions} options */
  async function webdav(config, password, relativePath, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const target = url(config, relativePath, !!options.trailingSlash);
    const controller = new AbortController();
    const timeoutMs = Number(options.timeoutMs || 30000);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    const headers = { ...options.headers };
    if (config.username || password) headers.Authorization = basicAuth(config.username || '', password);
    let response;
    try { response = await fetch(target, { method, headers, body: options.body, signal: controller.signal, credentials: 'omit', cache: 'no-store' }); }
    catch (cause) {
      if (cause && typeof cause === 'object' && 'name' in cause && cause.name === 'AbortError') throw Object.assign(new Error(options.signal?.aborted ? '请求已取消。' : `请求超时（${Math.round(timeoutMs / 1000)} 秒）。`), { code: options.signal?.aborted ? 'cancelled' : 'timeout', method, url: target, cause });
      // 浏览器不区分 CORS、TLS 与混合内容拒绝，诊断只能说明可能原因。
      const mixed = typeof location !== 'undefined' && location.protocol === 'https:' && new URL(target).protocol === 'http:';
      throw Object.assign(new Error('浏览器未能连接 WebDAV 服务。'), { code: mixed ? 'mixed_content' : 'network', method, url: target, cause });
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
    if (!(options.acceptStatuses || [200, 201, 204, 207]).includes(response.status)) throw Object.assign(new Error(`WebDAV 返回 HTTP ${response.status}。`), { code: 'http', status: response.status, method, url: target });
    return response;
  }
  /** @param {{endpoint:string,apiKey?:string}} config @param {unknown} payload @param {AbortSignal} [signal] */
  function ai(config, payload, signal) {
    /** @type {Record<string,string>} */ const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (config.apiKey) headers.Authorization = 'Bearer ' + config.apiKey;
    return fetch(config.endpoint, { method: 'POST', headers, body: JSON.stringify(payload), signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  }
  const api = { webdav, ai, url };
  /** @type {typeof globalThis & {ShirohaBrowserNetwork?:typeof api}} */ (globalThis).ShirohaBrowserNetwork = api;
})();
