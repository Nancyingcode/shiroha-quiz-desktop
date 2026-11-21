// @ts-check
// 封装浏览器的存储、资源加载和本地文件接口，供 Web 平台装配。
(function () {
  'use strict';
  const scope = /** @type {typeof globalThis & import('./runtime').BrowserGlobals} */ (globalThis);
  /** @typedef {import('./contracts').Snapshot} Snapshot */
  /** @param {import('./contracts').ErrorCode} code @param {string} message */
  function failure(code, message) {
    return Object.assign(new Error(message), { code });
  }

  /** 区分容量不足和其他存储拒绝，保留恢复入口使用的错误码。
   * @param {unknown} error
   */
  function storageError(error) {
    return failure(
      error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError'
        ? 'quota_exceeded' : 'storage_unavailable',
      '浏览器存储失败，请检查存储权限和剩余空间后重试。',
    );
  }

  /** 给页面建立独立快照和提交历史，写入前检查当前版本和外部修改。
   * @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'>} storage @param {string} key
   */
  function createStorage(storage, key) {
    // 每个页面实例持有已读原值与提交记录；刷新时重新读取，不声称跨标签原子比较交换。
    let ready = false;
    let raw = /** @type {string|null} */ (null);
    let revision = 0;
    let externallyChanged = false;
    const operations = new Map();
    /** @type {Snapshot|null} */ let snapshot = null;

    /** 写入前核对修订号和已读原值，避免覆盖其他标签的变更。
     * @param {Snapshot} next @param {string} operationId @param {number} expectedRevision
     */
    function assertWritableRevision(next, operationId, expectedRevision) {
      const checked = scope.ShirohaPlatformValidation.validateCommit(
        {
          contractVersion: 1,
          operationId,
          expectedRevision,
          changes: [{ kind: 'replace_snapshot', snapshot: next }],
        },
        { initialization: 'ready', currentRevision: revision, knownOperationIds: [] },
      );
      if (!checked.ok) { throw failure(checked.error.code, checked.error.message); }

      if (revision !== expectedRevision) { throw failure('revision_conflict', '保存版本已变化，请重新加载。'); }

      if (externallyChanged) { throw failure('revision_conflict', '其他页面已修改数据，请先导出当前内容，再重新加载。'); }

      let currentRaw;
      try {
        currentRaw = storage.getItem(key);
      } catch (error) {
        throw storageError(error);
      }

      if (currentRaw !== raw) { throw failure('revision_conflict', '其他页面已修改数据，请先导出当前内容，再重新加载。'); }
    }

    return {
      // 初始化失败时保留原文，只有确认可读的快照才解锁保存。
      async initialize() {
        ready = false;
        try {
          raw = storage.getItem(key);
        } catch (error) {
          return { state: 'recovery_required', error: storageError(error) };
        }

        let parsed;
        try {
          parsed = raw === null ? null : JSON.parse(raw);
        } catch {
          return { state: 'recovery_required', error: failure('corrupt_data', '本地数据损坏，原数据已保留。请重试或导出原始数据恢复。') };
        }

        if (raw !== null && (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.banks))) {
          return { state: 'recovery_required', error: failure('corrupt_data', '本地数据损坏，原数据已保留。请重试或导出原始数据恢复。') };
        }

        if (parsed && Number(parsed.schemaVersion || 0) > 1) {
          return { state: 'recovery_required', error: failure('unsupported_version', '数据版本较新，请使用支持此版本的应用打开。') };
        }

        snapshot = parsed; ready = true; externallyChanged = false;
        return { state: 'ready', revision, hasData: raw !== null };
      },

      async read() {
        if (!ready) { throw failure('not_ready', '数据尚未加载。'); }

        return structuredClone(snapshot);
      },

      /** 同一操作编号和载荷可安全重试；成功写入后才更新内存修订号。
       * @param {Snapshot} next @param {string} operationId @param {number} expectedRevision
       */
      async write(next, operationId, expectedRevision) {
        if (!ready) { throw failure('not_ready', '数据尚未加载。'); }

        const encoded = JSON.stringify(next);
        const previous = operations.get(operationId);
        if (previous) {
          if (previous.encoded !== encoded) { throw failure('duplicate_operation', '操作编号已被使用。'); }

          return previous.receipt;
        }

        assertWritableRevision(next, operationId, expectedRevision);
        try {
          storage.setItem(key, encoded);
        } catch (error) {
          throw storageError(error);
        }

        raw = encoded; snapshot = structuredClone(next); revision += 1;
        const receipt = { operationId, revision };
        operations.set(operationId, { encoded, receipt });
        return receipt;
      },

      /** @param {string} id */
      async getOperation(id) {
        return operations.get(id)?.receipt ?? null;
      },

      revision: () => revision,

      invalidate() {
        externallyChanged = true;
      },

      recoveryText() {
        return storage.getItem(key) || '';
      },
    };
  }

  /** 通过临时链接下载内容，点击后释放对象地址。
   * @param {string} name @param {Blob} blob
   */
  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a'); a.href = url; a.download = name;
      document.body.appendChild(a); try { a.click(); } finally { a.remove(); }
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  const files = {
    /** 用户主动选择的 File 仍由 DOM 输入授权，适配层不按字符串路径读取文件。 @param {Blob} file */
    async readBuffer(file) {
      return file.arrayBuffer();
    },

    /** 在旧环境使用 FileReader 读取用户选择的文本内容。
     * @param {Blob} file
     */
    async readText(file) {
      if (typeof file.text === 'function') { return file.text(); }

      return new Promise(
        // UTF-8 回退保留旧浏览器的文件导入能力，并把读取失败传给调用方。
        (resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));

          reader.onerror = () => reject(new Error('文本读取失败'));

          reader.readAsText(file, 'UTF-8');
        },
      );
    },
  };
  const preferences = {
    locale() {
      return localStorage.getItem('shiroha-ui-locale');
    },

    /** @param {string} value */
    setLocale(value) {
      localStorage.setItem('shiroha-ui-locale', value);
    },

    sidebar() {
      return localStorage.getItem('shiroha-sidebar-collapsed') === '1';
    },

    /** @param {boolean} collapsed */
    setSidebar(collapsed) {
      localStorage.setItem('shiroha-sidebar-collapsed', collapsed ? '1' : '0');
    },
  };
  const media = {
    /** Web 当前只显示随题库保存的内联位图；不扩大远程图片或可执行内容边界。 @param {string} resource */
    display(resource) {
      // 只接受识别得到的内联位图 MIME 和 base64 数据，限制媒体显示范围。
      return /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp);base64,[A-Za-z0-9+/=\r\n]+$/i.test(resource) ? resource : '';
    },
  };
  /** 从旧浏览器的本地文件加载 JSON，网络失败时保留原始请求错误。
   * @param {string} url @param {unknown} fetchError
   */
  function resourceJsonWithXhr(url, fetchError) {
    return new Promise(
      // 等待兼容请求完成，按原接口返回解析结果或读取错误。
      (resolve, reject) => {
        const xhr = new globalThis.XMLHttpRequest();
        xhr.open('GET', url, true); xhr.overrideMimeType('application/json;charset=utf-8');
        // 本地文件读取的状态码可为零；其余响应仍须满足成功范围。
        function resolveResponse() {
          try {
            if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
              resolve(JSON.parse(xhr.responseText));
            } else {
              reject(new Error(`XHR ${xhr.status}`));
            }
          } catch (error) {
            reject(error);
          }
        }

        xhr.onload = resolveResponse;
        xhr.onerror = () => reject(fetchError);

        xhr.send();
      },
    );
  }

  /** 先读取 fetch 响应，失败时交给本地文件兼容入口。
   * @param {string} url
   */
  async function resourceJson(url) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) { throw new Error(`HTTP ${response.status}`); }

      return await response.json();
    } catch (fetchError) {
      // file URL 的旧浏览器不支持 fetch；静态 ZIP 支持取消前保留 XHR 兼容入口。
      return resourceJsonWithXhr(url, fetchError);
    }
  }

  const api = { createStorage, download, storageError, files, preferences, media, resourceJson };
  /** @type {typeof globalThis & {ShirohaBrowser?: typeof api}} */ (globalThis).ShirohaBrowser = api;
})();
