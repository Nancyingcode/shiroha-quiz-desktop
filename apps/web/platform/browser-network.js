// @ts-check
// Web 平台通过浏览器发起 AI 和 WebDAV 请求，统一保留超时、取消和连接失败语义。
(function () {
  'use strict';
  /** @typedef {{endpoint:string,username?:string}} DavConfig */
  /** @typedef {{method?:string,trailingSlash?:boolean,timeoutMs?:number,headers?:Record<string,string>,body?:BodyInit,acceptStatuses?:number[],signal?:AbortSignal}} DavOptions */
  /** @param {string} username @param {string} password */
  function basicAuth(username, password) {
    // eslint-disable-next-line prefer-template -- 凭据可能是对象，保留 + 的默认转换；入口约束凭据类型后移除此例外。
    const bytes = new TextEncoder().encode(username + ':' + password);
    return `Basic ${globalThis.btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}`;
  }

  /** 统一 WebDAV 路径分隔符，逐段编码相对路径，保留调用方请求的目录尾斜杠。
   * @param {DavConfig} config @param {string} relativePath @param {boolean} trailingSlash
   */
  function url(config, relativePath = '', trailingSlash = false) {
    // 将 Windows 风格的反斜杠统一为路径分隔符，再检查相对路径段。
    const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.some((part) => part === '.' || part === '..')) { throw new Error('WebDAV 路径不安全。'); }

    const encoded = parts.map(encodeURIComponent).join('/');
    // 去掉服务端基址末尾的斜杠，交由 URL 解析时统一补一个目录分隔符。
    const endpoint = config.endpoint.replace(/\/+$/, '');
    return new URL(encoded + (trailingSlash && encoded ? '/' : ''), `${endpoint}/`).href;
  }

  /** 让调用方区分主动取消和超时。普通连接失败保留浏览器能够确认的诊断范围。
   * @param {unknown} cause @param {string} method @param {string} target
   * @param {number} timeoutMs @param {DavOptions} options
   */
  function requestError(cause, method, target, timeoutMs, options) {
    if (cause && typeof cause === 'object' && 'name' in cause && cause.name === 'AbortError') {
      const message = options.signal?.aborted ? '请求已取消。' : `请求超时（${Math.round(timeoutMs / 1000)} 秒）。`;
      return Object.assign(new Error(message), { code: options.signal?.aborted ? 'cancelled' : 'timeout', method, url: target, cause });
    }

    // 浏览器不区分 CORS、TLS 与混合内容拒绝，诊断只能说明可能原因。
    const mixed = typeof location !== 'undefined' && location.protocol === 'https:' && new URL(target).protocol === 'http:';
    return Object.assign(new Error('浏览器未能连接 WebDAV 服务。'), { code: mixed ? 'mixed_content' : 'network', method, url: target, cause });
  }

  /** 发送 WebDAV 请求，在请求结束后清理超时和外部取消监听，并校验操作允许的响应码。
   * @param {DavConfig} config @param {string} password @param {string} relativePath @param {DavOptions} options
   */
  async function webdav(config, password, relativePath, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const target = url(config, relativePath, !!options.trailingSlash);
    const controller = new AbortController();
    const timeoutMs = Number(options.timeoutMs || 30000);
    const abort = () => controller.abort();

    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { abort(); }

    const timer = setTimeout(abort, timeoutMs);
    const headers = { ...options.headers };
    if (config.username || password) { headers.Authorization = basicAuth(config.username || '', password); }

    let response;
    try { response = await fetch(target, { method, headers, body: options.body, signal: controller.signal, credentials: 'omit', cache: 'no-store' }); } catch (cause) {
      throw requestError(cause, method, target, timeoutMs, options);
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }

    if (!(options.acceptStatuses || [200, 201, 204, 207]).includes(response.status)) { throw Object.assign(new Error(`WebDAV 返回 HTTP ${response.status}。`), { code: 'http', status: response.status, method, url: target }); }

    return response;
  }

  /** 使用配置提供的认证信息发送 JSON，允许调用方取消请求。
   * @param {{endpoint:string,apiKey?:string}} config @param {unknown} payload @param {AbortSignal} [signal]
   */
  function ai(config, payload, signal) {
    /** @type {Record<string,string>} */ const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    // eslint-disable-next-line prefer-template -- 凭据可能是对象，保留 + 的默认转换；入口约束凭据类型后移除此例外。
    if (config.apiKey) { headers.Authorization = 'Bearer ' + config.apiKey; }

    return fetch(config.endpoint, { method: 'POST', headers, body: JSON.stringify(payload), signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  }

  const api = { webdav, ai, url };
  /** @type {typeof globalThis & {ShirohaBrowserNetwork?:typeof api}} */ (globalThis).ShirohaBrowserNetwork = api;
})();
