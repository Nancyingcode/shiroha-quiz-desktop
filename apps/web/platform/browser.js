// @ts-check
(function () {
  'use strict';
  const scope = /** @type {typeof globalThis & import('./runtime').BrowserGlobals} */ (globalThis);
  /** @typedef {import('./contracts').Snapshot} Snapshot */
  /** @param {import('./contracts').ErrorCode} code @param {string} message */
  function failure(code, message) { return Object.assign(new Error(message), { code }); }
  /** @param {unknown} error */
  function storageError(error) {
    return failure(error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError' ? 'quota_exceeded' : 'storage_unavailable', '浏览器存储失败，请检查存储权限和剩余空间后重试。');
  }
  /** @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'>} storage @param {string} key */
  function createStorage(storage, key) {
    // 每个页面实例持有已读原值与提交记录；刷新时重新读取，不声称跨标签原子比较交换。
    let ready = false;
    let raw = /** @type {string|null} */ (null);
    let revision = 0;
    let externallyChanged = false;
    const operations = new Map();
    /** @type {Snapshot|null} */ let snapshot = null;
    return {
      async initialize() {
        ready = false;
        try {
          raw = storage.getItem(key);
          const parsed = raw === null ? null : JSON.parse(raw);
          if (raw !== null && (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.banks))) throw failure('corrupt_data', '本地数据损坏，原数据已保留。请重试或导出原始数据恢复。');
          if (parsed && Number(parsed.schemaVersion || 0) > 1) throw failure('unsupported_version', '数据版本较新，请使用支持此版本的应用打开。');
          snapshot = parsed; ready = true; externallyChanged = false;
          return { state: 'ready', revision, hasData: raw !== null };
        } catch (error) {
          const known = error instanceof Error && 'code' in error ? error : storageError(error);
          return { state: 'recovery_required', error: known };
        }
      },
      async read() { if (!ready) throw failure('not_ready', '数据尚未加载。'); return structuredClone(snapshot); },
      /** @param {Snapshot} next @param {string} operationId @param {number} expectedRevision */
      async write(next, operationId, expectedRevision) {
        if (!ready) throw failure('not_ready', '数据尚未加载。');
        const encoded = JSON.stringify(next);
        const previous = operations.get(operationId);
        if (previous) {
          if (previous.encoded !== encoded) throw failure('duplicate_operation', '操作编号已被使用。');
          return previous.receipt;
        }
        const checked = scope.ShirohaPlatformValidation.validateCommit({ contractVersion: 1, operationId, expectedRevision, changes: [{ kind: 'replace_snapshot', snapshot: next }] }, { initialization: 'ready', currentRevision: revision, knownOperationIds: [] });
        if (!checked.ok) throw failure(checked.error.code, checked.error.message);
        if (revision !== expectedRevision) throw failure('revision_conflict', '保存版本已变化，请重新加载。');
        try {
          if (externallyChanged || storage.getItem(key) !== raw) throw failure('revision_conflict', '其他页面已修改数据，请先导出当前内容，再重新加载。');
          storage.setItem(key, encoded);
        } catch (error) {
          if (error instanceof Error && 'code' in error) throw error;
          throw storageError(error);
        }
        raw = encoded; snapshot = structuredClone(next); revision++;
        const receipt = { operationId, revision };
        operations.set(operationId, { encoded, receipt });
        return receipt;
      },
      /** @param {string} id */
      async getOperation(id) { return operations.get(id)?.receipt ?? null; },
      revision: () => revision,
      invalidate() { externallyChanged = true; },
      recoveryText() { return storage.getItem(key) || ''; },
    };
  }
  /** @param {string} name @param {Blob} blob */
  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a'); a.href = url; a.download = name;
      document.body.appendChild(a); try { a.click(); } finally { a.remove(); }
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  const files = {
    /** 用户主动选择的 File 仍由 DOM 输入授权，适配层不按字符串路径读取文件。 @param {Blob} file */
    async readBuffer(file) { return file.arrayBuffer(); },
    /** @param {Blob} file */
    async readText(file) {
      if (typeof file.text === 'function') return file.text();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('文本读取失败'));
        reader.readAsText(file, 'UTF-8');
      });
    },
  };
  const preferences = {
    sidebar() { return localStorage.getItem('shiroha-sidebar-collapsed') === '1'; },
    /** @param {boolean} collapsed */
    setSidebar(collapsed) { localStorage.setItem('shiroha-sidebar-collapsed', collapsed ? '1' : '0'); },
  };
  const media = {
    /** Web 当前只显示随题库保存的内联位图；不扩大远程图片或可执行内容边界。 @param {string} resource */
    display(resource) { return /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp);base64,[A-Za-z0-9+/=\r\n]+$/i.test(resource) ? resource : ''; },
  };
  /** @param {string} url */
  async function resourceJson(url) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } catch (fetchError) {
      // file URL 的旧浏览器不支持 fetch；静态 ZIP 支持取消前保留 XHR 兼容入口。
      return new Promise((resolve, reject) => {
        const xhr = new globalThis.XMLHttpRequest();
        xhr.open('GET', url, true); xhr.overrideMimeType('application/json;charset=utf-8');
        xhr.onload = () => {
          try { if (xhr.status === 0 || xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText)); else reject(new Error('XHR ' + xhr.status)); }
          catch (error) { reject(error); }
        };
        xhr.onerror = () => reject(fetchError); xhr.send();
      });
    }
  }
  const api = { createStorage, download, storageError, files, preferences, media, resourceJson };
  /** @type {typeof globalThis & {ShirohaBrowser?: typeof api}} */ (globalThis).ShirohaBrowser = api;
})();
