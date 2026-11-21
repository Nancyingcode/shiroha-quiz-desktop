// 协调 WebDAV 配置、备份上传和经校验的手动恢复。
(() => {
  'use strict';
  const i18n = globalThis.ShirohaI18n;

  // 只接受本应用生成的带日期、时间及 SHA-256 前八位的 JSON 备份名。
  const WEBDAV_BACKUP_FILE_RE_V378 = /^shiroha-web-backup-(\d{8})-(\d{6})-([a-f0-9]{8})\.json$/i;
  // 将独立的表单、网络任务和待恢复备份绑定到当前面板。
  function create({
    platform,
    storeWebdavConfigV378,
    clearWebdavStorageV378,
    loadNativeAll,
    getState,
    buildBackupPayloadV23,
    normalizeBackupPayloadV23,
    applyNormalizedBackupV378,
    isStringTooLargeErrorV376,
    isMutationBusy,
    APP_VERSION,
    now,
    fmt,
    esc,
    formatBytesV376,
    copyTextV23,
    toast,
    renderAll,
    setupEnhancedDataToolsV23,
  }) {
    const $ = (selector) => document.querySelector(selector);

    // 配置表单、请求状态与待恢复项归当前面板；清除配置或页面卸载时释放。
    let webdavRuntimeV378 = { busy: false, action: '', backups: [], latestFile: '', status: '', statusKind: '', diagnostic: null, pendingRestore: null, formLoaded: false };
    // 列表缓存只属于当前面板节点，节点重挂载时重新绑定与渲染。
    let renderedListV378 = null; let renderedListContentV378 = null;
    function defaultWebdavConfigV378() {
      return { endpoint: '', username: '', remoteDir: 'ShirohaQuiz/Web', rememberPassword: false, lastUploadAt: '', lastUploadFile: '', lastUploadSize: 0, lastUploadSha: '' };
    }

    function readWebdavConfigV378() {
      try { const parsed = platform.credentials.readDav();return { ...defaultWebdavConfigV378(), ...(parsed && typeof parsed === 'object' ? parsed : {}) }; } catch { return defaultWebdavConfigV378(); }
    }

    function readWebdavPasswordV378(config = readWebdavConfigV378()) {
      return platform.credentials.status('webdav', config);
    }

    // 归一化服务根地址，同时禁止地址字段携带嵌入式凭据或查询。
    function normalizeWebdavEndpointV378(value) {
      const raw = String(value || '').trim();if (!raw) { throw new Error('请填写 WebDAV 地址。'); }

      let url;try { url = new URL(raw); } catch { throw new Error('WebDAV 地址格式无效。请填写完整的 http:// 或 https:// 地址。'); }

      // 仅允许 WebDAV 使用 HTTP 或 HTTPS 协议。
      if (!/^https?:$/.test(url.protocol)) { throw new Error('WebDAV 地址只支持 http:// 或 https://。'); }

      if (url.username || url.password) { throw new Error('请不要把用户名或密码写在 WebDAV 地址中。'); }

      if (url.search || url.hash) { throw new Error('WebDAV 地址不能包含查询参数或锚点。'); }

      // 合并配置路径中重复的正斜杠，保留各目录段内容。
      const path = url.pathname.replace(/\/{2,}/g, '/');
      // URL 拼接阶段会补尾斜杠，配置形态统一去掉多余尾斜杠。
      url.pathname = path.replace(/\/+$/, '');

      // URL 对服务根路径会自动补斜杠，保存时使用同一无尾斜杠形态。
      return url.href.replace(/\/$/, '');
    }

    // 将用户目录转成安全的远端相对路径，拒绝目录切换和 URL 控制字符。
    function normalizeWebdavRemoteDirV378(value) {
      // 接受 Windows 风格的目录分隔符，但远端请求统一使用正斜杠。
      const raw = String(value || 'ShirohaQuiz/Web').trim().replace(/\\/g, '/');
      // 清除首尾斜杠，使目录始终相对服务基址。
      const relative = raw.replace(/^\/+|\/+$/g, '');
      const parts = relative.split('/').map((x) => x.trim()).filter(Boolean);
      if (!parts.length) { return 'ShirohaQuiz/Web'; }

      if (parts.some((x) => x === '.' || x === '..')) { throw new Error('远端目录不能包含 . 或 .. 路径。'); }

      // 查询与锚点标记不能作为远端目录的一部分。
      const urlDelimiter = /[?#]/;
      const containsUnsupportedCharacter = parts.some((part) => urlDelimiter.test(part)
        || Array.from(part).some((character) => character.charCodeAt(0) <= 0x1f));
      if (containsUnsupportedCharacter) { throw new Error('远端目录包含不支持的字符。'); }

      return parts.join('/');
    }

    function webdavConfigFromFormV378() {
      const old = readWebdavConfigV378();
      return { ...old, endpoint: normalizeWebdavEndpointV378($('#webdav-endpoint-v378')?.value), username: String($('#webdav-username-v378')?.value || '').trim(), remoteDir: normalizeWebdavRemoteDirV378($('#webdav-remote-dir-v378')?.value), rememberPassword: !!$('#webdav-remember-v378')?.checked };
    }

    function webdavPasswordFromFormV378() {
      const config = webdavConfigFromFormV378();return String($('#webdav-password-v378')?.value || '') || readWebdavPasswordV378(config);
    }

    // 用已保存的配置回填表单，密码仍由独立凭据存储管理。
    function fillWebdavFormV378() {
      const config = readWebdavConfigV378();
      const values = [['#webdav-endpoint-v378', config.endpoint], ['#webdav-remote-dir-v378', config.remoteDir], ['#webdav-username-v378', config.username], ['#webdav-password-v378', '']];
      values.forEach(([id, value]) => {
        const el = $(id);if (el) { el.value = value || ''; }
      });

      const remember = $('#webdav-remember-v378');if (remember) { remember.checked = !!config.rememberPassword; }

      webdavRuntimeV378.formLoaded = true;
    }

    // 逐段编码远端路径，避免相对路径改变配置的服务根目录。
    function webdavUrlV378(config, relativePath = '', trailingSlash = false) {
      // 末尾统一保留一个目录分隔符，保证 URL 解析从配置目录继续拼接。
      const base = `${String(config.endpoint || '').replace(/\/+$/, '')}/`;
      // 统一 Windows 和浏览器输入中的分隔符，再按目录段单独编码。
      const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
      if (parts.some((x) => x === '.' || x === '..')) { throw new Error(i18n.text('dav.pathInvalid')); }

      const encoded = parts.map((x) => encodeURIComponent(x)).join('/');
      return new URL(encoded + (trailingSlash && encoded ? '/' : ''), base).href;
    }

    function webdavPublicUrlV378(url) {
      try { const parsed = new URL(url);return parsed.origin + parsed.pathname; } catch { return ''; }
    }

    function webdavErrorV378(message, meta = {}) {
      const error = new Error(message);Object.assign(error, meta);return error;
    }

    async function webdavRequestV378(config, password, relativePath, options = {}) {
      // Fetch failures do not distinguish mixed content from CORS or network errors.
      return platform.network.webdav(config, password, relativePath, options);
    }

    // 优先保留明确的网络和请求码，其次根据 HTTP 响应给出诊断。
    function classifyWebdavErrorV378(error) {
      const status = Number((error && error.status) || 0); const code = String((error && error.code) || '');
      if (code === 'mixed_content') { return { type: i18n.text('dav.mixedContent'), summary: i18n.text('dav.mixedContentSummary'), suggestion: i18n.text('dav.mixedContentAdvice') }; }

      if (code === 'result_unknown') { return { type: i18n.text('dav.unknownResult'), summary: i18n.text('dav.unknownResultSummary'), suggestion: i18n.text('dav.unknownResultAdvice') }; }

      if (code === 'timeout') { return { type: i18n.text('dav.timeout'), summary: i18n.text('dav.timeoutSummary'), suggestion: i18n.text('dav.timeoutAdvice') }; }

      if (code === 'network') { return { type: i18n.text('dav.network'), summary: i18n.text('dav.networkSummary'), suggestion: i18n.text('dav.networkAdvice') }; }

      const map = { 401: [i18n.text('dav.auth'), i18n.text('dav.authSummary'), i18n.text('dav.authAdvice')], 403: [i18n.text('dav.forbidden'), i18n.text('dav.forbiddenSummary'), i18n.text('dav.forbiddenAdvice')], 404: [i18n.text('dav.missing'), i18n.text('dav.missingSummary'), i18n.text('dav.missingAdvice')], 405: [i18n.text('dav.method'), i18n.text('dav.methodSummary'), i18n.text('dav.methodAdvice')], 409: [i18n.text('dav.parent'), i18n.text('dav.parentSummary'), i18n.text('dav.parentAdvice')], 412: [i18n.text('dav.condition'), i18n.text('dav.conditionSummary'), i18n.text('dav.conditionAdvice')], 413: [i18n.text('dav.uploadSize'), i18n.text('dav.uploadSizeSummary'), i18n.text('dav.uploadSizeAdvice')], 423: [i18n.text('dav.locked'), i18n.text('dav.lockedSummary'), i18n.text('dav.lockedAdvice')], 429: [i18n.text('dav.rate'), i18n.text('dav.rateSummary'), i18n.text('dav.retry')], 507: [i18n.text('dav.quota'), i18n.text('dav.quotaSummary'), i18n.text('dav.quotaAdvice')] };
      if (map[status]) { return { type: map[status][0], summary: map[status][1], suggestion: map[status][2] }; }

      if (status >= 500) { return { type: i18n.text('dav.server'), summary: i18n.text('dav.httpServer', { status }), suggestion: i18n.text('dav.serverAdvice') }; }

      return { type: i18n.text('dav.failed'), summary: (error && error.message) || i18n.text('dav.unknown'), suggestion: i18n.text('dav.failedAdvice') };
    }

    function setWebdavDiagnosticV378(action, error, successMeta = null) {
      if (successMeta) { webdavRuntimeV378.diagnostic = { time: now(), action, method: successMeta.method || '', url: webdavPublicUrlV378(successMeta.url || ''), origin: typeof location !== 'undefined' ? location.origin : '', status: successMeta.status || '', type: i18n.text('ai.connected'), summary: successMeta.summary || i18n.text('dav.requestOk'), suggestion: i18n.text('dav.requestNext') };return; }

      const info = classifyWebdavErrorV378(error);webdavRuntimeV378.diagnostic = { time: now(), action, method: (error && error.method) || '', url: webdavPublicUrlV378((error && error.url) || ''), origin: typeof location !== 'undefined' ? location.origin : '', status: (error && error.status) || '', type: info.type, summary: info.summary, suggestion: info.suggestion };
    }

    function webdavDiagnosticTextV378() {
      const d = webdavRuntimeV378.diagnostic;if (!d) { return 'Shiroha Quiz WebDAV：尚无诊断信息。'; }

      return ['Shiroha Quiz WebDAV 诊断', `时间：${d.time}`, `操作：${d.action}`, `方法：${d.method || '—'}`, `地址：${d.url || '—'}`, `页面 Origin：${d.origin || '—'}`, `HTTP 状态：${d.status || '—'}`, `判断：${d.type}`, `摘要：${d.summary}`, `建议：${d.suggestion}`].join('\n');
    }

    function setWebdavStatusV378(message, kind = '') {
      webdavRuntimeV378.status = message;webdavRuntimeV378.statusKind = kind;renderWebdavPanelV378();
    }

    function setWebdavBusyV378(action = '') {
      webdavRuntimeV378.busy = !!action;webdavRuntimeV378.action = action;const stop = $('#webdav-stop-native');if (stop) { stop.disabled = !action; }

      renderWebdavPanelV378();
    }

    // 让每次手动操作独占任务期间的控件，并统一显示失败诊断。
    async function runWebdavActionV378(action, task) {
      if (webdavRuntimeV378.busy) { return; }

      webdavRuntimeV378.status = i18n.text('dav.processing', { action });webdavRuntimeV378.statusKind = '';
      setWebdavBusyV378(action);
      try { return await task(); } catch (error) {
        setWebdavDiagnosticV378(action, error);const message = i18n.text('dav.actionFailed', { action, detail: webdavRuntimeV378.diagnostic.summary });setWebdavStatusV378(message, 'danger');const details = $('#webdav-diagnostics-details-v378');if (details) { details.open = true; }

        toast(message, 'danger');
      } finally {
        setWebdavBusyV378('');
        restoreWebdavFocus();
      }
    }

    // 共用上传、诊断和恢复面板结构，密码存放说明取当前平台。
    function webdavPanelMarkup() {
      return `<div id="webdav-panel-v378" class="data-tools-v23 webdav-card-v378">
        <div class="webdav-head-v378"><div><h2>${i18n.html('dav.title')}</h2><p class="muted">${i18n.html('dav.intro')}</p></div><span id="webdav-status-chip-v378" class="webdav-chip-v378">${i18n.html('ai.notConfigured')}</span></div>
        <div class="form-grid webdav-form-v378">
          <label>${i18n.html('dav.endpoint')}<input id="webdav-endpoint-v378" type="url" inputmode="url" autocomplete="url" ${i18n.attribute('placeholder', 'dav.exampleEndpoint')} /></label>
          <label>${i18n.html('dav.directory')}<input id="webdav-remote-dir-v378" autocomplete="off" placeholder="ShirohaQuiz/Web" /></label>
          <label>${i18n.html('dav.username')}<input id="webdav-username-v378" autocomplete="username" /></label>
          <label>${i18n.html('dav.password')}<input id="webdav-password-v378" type="password" autocomplete="current-password" /></label>
        </div>
        <label class="check-line-v23 webdav-remember-v378"><input id="webdav-remember-v378" type="checkbox" />${i18n.html(platform.credentials.native ? 'dav.desktopRemember' : 'dav.browserRemember')} <span class="muted">${i18n.html(platform.credentials.native ? 'dav.desktopRetention' : 'dav.browserRetention')}</span></label>
        <div class="actions wrap-v23 webdav-actions-v378">
          <button class="ghost" id="webdav-save-v378" type="button">${i18n.html('dav.save')}</button>
          <button class="ghost" id="webdav-test-v378" type="button">${i18n.html('connection.test')}</button>
          <button class="ghost danger" id="webdav-clear-v378" type="button">${i18n.html('connection.clear')}</button>
          <button class="primary" id="webdav-upload-v378" type="button">${i18n.html('dav.upload')}</button>
          <button class="ghost" id="webdav-refresh-v378" type="button">${i18n.html('dav.refresh')}</button>
        </div>
        <div id="webdav-status-v378" class="notice">${i18n.html('dav.initialStatus')}</div>
        <div id="webdav-last-summary-v378" class="webdav-summary-v378 muted"></div>
        <div class="webdav-list-head-v378"><h3>${i18n.html('dav.remoteBackups')}</h3><span class="muted">${i18n.html('dav.listHint')}</span></div>
        <div id="webdav-list-v378" class="webdav-list-v378"><p class="muted">${i18n.html('dav.unread')}</p></div>
        <details id="webdav-diagnostics-details-v378" class="webdav-diagnostics-v378"><summary>${i18n.html('dav.diagnostics')}</summary><div id="webdav-diagnostics-v378" class="muted">${i18n.html('dav.noDiagnostics')}</div><button class="ghost mini-btn" id="webdav-copy-diagnostics-v378" type="button">${i18n.html('connection.copyDiagnostics')}</button></details>
        <p class="muted webdav-security-v378">${i18n.html(platform.credentials.native ? 'dav.desktopSecurity' : 'dav.webSecurity')}</p>
      </div>
      <div id="webdav-restore-modal-v378" class="webdav-modal-v378" hidden>
        <div class="webdav-modal-card-v378" role="dialog" aria-modal="true" aria-labelledby="webdav-restore-title-v378">
          <h2 id="webdav-restore-title-v378">${i18n.html('dav.restoreTitle')}</h2>
          <div id="webdav-restore-meta-v378" class="notice"></div>
          <label>${i18n.html('backup.mode')}<select id="webdav-restore-mode-v378"><option value="merge" data-i18n="dav.merge">${i18n.text('dav.merge')}</option><option value="overwrite" data-i18n="backup.overwrite">${i18n.text('backup.overwrite')}</option></select></label>
          <p id="webdav-restore-warning-v378" class="muted">${i18n.html('dav.restoreIntegrity')}</p>
          <div class="actions wrap-v23"><button class="ghost" id="webdav-restore-cancel-v378" type="button">${i18n.html('dialog.cancel')}</button><button class="primary" id="webdav-restore-confirm-v378" type="button">${i18n.html('dav.confirmRestore')}</button></div>
        </div>
      </div>`;
    }

    // 初次显示时插入备份和确认界面，再把当前配置同步到控件。
    function mount(container) {
      if ($('#webdav-panel-v378')) { return; }

      container.insertAdjacentHTML('beforeend', webdavPanelMarkup());
      bindWebdavPanelV378();
      renderWebdavPanelV378(true);
    }

    function onWebdavListClickV378(e) {
      const button = e.target.closest('[data-webdav-restore-v378]');
      if (button) {
        runWebdavActionV378(i18n.text('dav.download'), () => prepareWebdavRestoreV378(button.dataset.webdavRestoreV378, button));
      }
    }

    // 配置写入成功后才提示用户，凭据按表单选择交给独立存储。
    async function saveWebdavForm() {
      try {
        const config = webdavConfigFromFormV378();
        const stored = await storeWebdavConfigV378(config, webdavPasswordFromFormV378());
        if (stored === false) {
          return;
        }

        setWebdavStatusV378(i18n.text('dav.saved'), 'ok');
        toast('WebDAV 配置已保存。', 'ok');
      } catch (error) {
        setWebdavStatusV378(error.message, 'danger');
      }
    }

    // 清除存储成功后释放本地面板状态，失败时保留已载入的值供重试。
    async function clearWebdavForm() {
      try {
        const cleared = await clearWebdavStorageV378();
        if (cleared === false) {
          return;
        }
      } catch (error) {
        // 清除失败应保留适配器返回的错误详情以便重试。
        setWebdavStatusV378(i18n.text('dav.clearFailed', { detail: String(error.message) }), 'warn');
        return;
      }

      webdavRuntimeV378 = { busy: false, action: '', backups: [], latestFile: '', status: i18n.text('dav.cleared'), statusKind: 'ok', diagnostic: null, pendingRestore: null, formLoaded: false };fillWebdavFormV378();renderWebdavPanelV378();toast(i18n.text('dav.clearedToast'), 'ok');
    }

    // 绑定配置、诊断和备份控件；列表使用委托以便在重绘后继续接收事件。
    function bindWebdavPanelV378() {
      const save = $('#webdav-save-v378');if (!save) { return; }

      save.onclick = saveWebdavForm;

      $('#webdav-clear-v378').onclick = clearWebdavForm;

      $('#webdav-test-v378').onclick = () => runWebdavActionV378(i18n.text('connection.test'), testWebdavConnectionV378);

      $('#webdav-upload-v378').onclick = () => runWebdavActionV378(i18n.text('dav.uploadAction'), uploadWebdavBackupV378);

      $('#webdav-refresh-v378').onclick = () => runWebdavActionV378(i18n.text('dav.refreshAction'), refreshWebdavBackupsV378);

      if (platform.network.cancelAll && !$('#webdav-stop-native')) {
        const stop = document.createElement('button');stop.id = 'webdav-stop-native';stop.type = 'button';stop.className = 'ghost';stop.textContent = i18n.text('dav.cancelTask');stop.disabled = !webdavRuntimeV378.busy;
        stop.onclick = async () => {
          stop.disabled = true;try { await platform.network.cancelAll();setWebdavStatusV378(i18n.text('dav.cancelPending'), 'warn'); } catch (error) { setWebdavStatusV378(error.message, 'danger'); }
        };

        $('#webdav-refresh-v378').after(stop);
      }

      $('#webdav-copy-diagnostics-v378').onclick = () => copyTextV23(webdavDiagnosticTextV378(), '已复制 WebDAV 诊断（不含密码）。');

      $('#webdav-list-v378').onclick = onWebdavListClickV378;
      $('#webdav-restore-cancel-v378').onclick = closeWebdavRestoreModalV378;
      $('#webdav-restore-confirm-v378').onclick = () => runWebdavActionV378(i18n.text('dav.restoreAction'), confirmWebdavRestoreV378);

      $('#webdav-restore-mode-v378').onchange = syncWebdavRestoreWarningV378;
      $('#webdav-restore-modal-v378').onclick = (e) => {
        if (e.target.id === 'webdav-restore-modal-v378') { closeWebdavRestoreModalV378(); }
      };
    }

    // 列表内容变动时才替换节点，避免刷新状态时丢失现有键盘焦点。
    function renderWebdavBackupList() {
      const list = $('#webdav-list-v378');
      if (list) {
        const rows = webdavRuntimeV378.backups || [];
        // 依据刷新或读取状态区别空目录和尚未读取。
        const hasReadList = webdavRuntimeV378.status && /刷新|读取/.test(webdavRuntimeV378.status);
        let content;
        if (rows.length) {
          content = rows.map((item) => `<div class="webdav-row-v378"><div class="webdav-file-v378"><b>${esc(item.fileName)}${item.fileName === webdavRuntimeV378.latestFile ? '<span class="webdav-latest-v378">latest</span>' : ''}</b><span class="muted">${esc(item.dateText || i18n.text('dav.unknownDate'))}</span></div><span class="webdav-row-meta-v378 muted">${formatBytesV376(item.size || 0)}</span><span class="muted">${esc(item.etag || '')}</span><button class="ghost mini-btn" type="button" data-webdav-restore-v378="${esc(item.fileName)}">${i18n.html('dav.restore')}</button></div>`).join('');
        } else {
          content = `<p class="muted">${i18n.html(hasReadList ? 'dav.noBackups' : 'dav.unread')}</p>`;
        }

        if (list !== renderedListV378 || content !== renderedListContentV378) {
          list.innerHTML = content;
          list.onclick = onWebdavListClickV378;
          renderedListV378 = list;renderedListContentV378 = content;
        }

        list.querySelectorAll('[data-webdav-restore-v378]').forEach((button) => {
          button.disabled = webdavRuntimeV378.busy;
        });
      }
    }

    // 按存储配置和请求状态刷新面板，保留用户尚未提交的表单编辑。
    function renderWebdavPanelV378(forceForm = false) {
      if (!$('#webdav-panel-v378')) { return; }

      if (forceForm || !webdavRuntimeV378.formLoaded) { fillWebdavFormV378(); }

      const config = readWebdavConfigV378(); const configured = !!config.endpoint;const chip = $('#webdav-status-chip-v378');
      if (chip) {
        chip.textContent = configured ? i18n.text('ai.configured') : i18n.text('ai.notConfigured');
        if (webdavRuntimeV378.busy) { chip.textContent = i18n.text('dav.busy', { action: webdavRuntimeV378.action }); }

        chip.className = `webdav-chip-v378 ${webdavRuntimeV378.statusKind || (configured ? 'ok' : '')}`;
      }

      const status = $('#webdav-status-v378');if (status) { status.textContent = webdavRuntimeV378.status || (configured ? i18n.text('dav.configuredHint') : i18n.text('dav.initialStatus'));status.className = `notice ${webdavRuntimeV378.statusKind || ''}`; }

      const summary = $('#webdav-last-summary-v378');if (summary) { summary.textContent = config.lastUploadAt ? i18n.text('dav.uploadSummary', { date: fmt(config.lastUploadAt), file: config.lastUploadFile || '—', size: formatBytesV376(config.lastUploadSize || 0), hash: String(config.lastUploadSha || '').slice(0, 12) }) : i18n.text('dav.noUploads'); }

      ['#webdav-save-v378', '#webdav-test-v378', '#webdav-clear-v378', '#webdav-upload-v378', '#webdav-refresh-v378', '#webdav-restore-confirm-v378'].forEach((id) => {
        const el = $(id);if (el) { el.disabled = webdavRuntimeV378.busy; }
      });

      renderWebdavBackupList();

      const diag = $('#webdav-diagnostics-v378');if (diag) { const d = webdavRuntimeV378.diagnostic;diag.innerHTML = d ? `<dl><dt>时间</dt><dd>${esc(fmt(d.time))}</dd><dt>操作</dt><dd>${esc(d.action)}</dd><dt>方法</dt><dd>${esc(d.method || '—')}</dd><dt>地址</dt><dd>${esc(d.url || '—')}</dd><dt>页面 Origin</dt><dd>${esc(d.origin || '—')}</dd><dt>HTTP 状态</dt><dd>${esc(d.status || '—')}</dd><dt>判断</dt><dd>${esc(d.type)}</dd><dt>摘要</dt><dd>${esc(d.summary)}</dd><dt>建议</dt><dd>${esc(d.suggestion)}</dd></dl>` : i18n.text('dav.noDiagnostics'); }
    }

    async function testWebdavConnectionV378() {
      const config = webdavConfigFromFormV378(); const password = webdavPasswordFromFormV378();const response = await webdavRequestV378(config, password, '', { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' }, body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>', acceptStatuses: [207] });
      setWebdavDiagnosticV378(i18n.text('connection.test'), null, { method: 'PROPFIND', url: config.endpoint, status: response.status, summary: i18n.text('dav.rootOk') });setWebdavStatusV378(i18n.text('dav.connected', { status: response.status }), 'ok');toast(i18n.text('dav.connectedToast'), 'ok');
    }

    async function ensureWebdavDirectoryV378(config, password) {
      const parts = normalizeWebdavRemoteDirV378(config.remoteDir).split('/');let path = '';
      for (const part of parts) { path = path ? `${path}/${part}` : part;await webdavRequestV378(config, password, path, { method: 'MKCOL', acceptStatuses: [200, 201, 204, 405] }); }
    }

    async function sha256HexV378(bytes) {
      if (!globalThis.crypto || !globalThis.crypto.subtle) { throw webdavErrorV378('当前浏览器环境不支持 SHA-256 校验。请使用较新的浏览器并通过 HTTPS 或 localhost 打开。', { code: 'crypto_unavailable' }); }

      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
    }

    function webdavTimestampV378(date = new Date()) {
      // 去掉 ISO 时间戳的日期和时间分隔符，生成可按文件名排序的备份时间。
      return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    }

    // 先上传完整备份，再尝试更新索引和刷新列表；索引失败仍保留已上传文件。
    async function uploadWebdavBackupV378() {
      if (!await loadNativeAll()) { return; }

      const config = webdavConfigFromFormV378(); const password = webdavPasswordFromFormV378();
      let text;try { text = JSON.stringify(buildBackupPayloadV23(getState().banks || [], 'all_data', true)); } catch (error) {
        if (typeof isStringTooLargeErrorV376 === 'function' && isStringTooLargeErrorV376(error)) { throw webdavErrorV378('当前完整备份过大，浏览器无法生成上传文本。请先减少大图片或拆分题库。', { code: 'payload_too_large' }); }

        throw error;
      }

      const bytes = new TextEncoder().encode(text); const sha = await sha256HexV378(bytes); const fileName = `shiroha-web-backup-${webdavTimestampV378()}-${sha.slice(0, 8)}.json`; const remoteDir = normalizeWebdavRemoteDirV378(config.remoteDir);
      await ensureWebdavDirectoryV378(config, password);
      const fileResponse = await webdavRequestV378(config, password, `${remoteDir}/${fileName}`, { method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: bytes, timeoutMs: 120000, acceptStatuses: [200, 201, 204] });
      const questionCount = (getState().banks || []).reduce((n, b) => n + (b.questions || []).length, 0); const manifest = { kind: 'shiroha_quiz_webdav_latest', version: 1, app: 'Shiroha Quiz', appVersion: APP_VERSION, updatedAt: now(), fileName, sha256: sha, sizeBytes: bytes.byteLength, bankCount: (getState().banks || []).length, questionCount };
      let manifestWarning = '';try { await webdavRequestV378(config, password, `${remoteDir}/latest.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(manifest), acceptStatuses: [200, 201, 204] }); } catch (error) { manifestWarning = i18n.text('dav.latestWarn');setWebdavDiagnosticV378(i18n.text('dav.updateLatest'), error); }

      const saved = { ...config, lastUploadAt: manifest.updatedAt, lastUploadFile: fileName, lastUploadSize: bytes.byteLength, lastUploadSha: sha };
      const stored = await storeWebdavConfigV378(saved, password, false);
      if (stored === false) {
        setWebdavStatusV378(i18n.text('dav.uploadSavedElsewhere', { file: fileName }), 'warn');
        return;
      }

      try { await loadWebdavBackupListV378(config, password); } catch (error) { manifestWarning += i18n.text('dav.refreshWarn');setWebdavDiagnosticV378(i18n.text('dav.refreshAction'), error); }

      if (!manifestWarning) { setWebdavDiagnosticV378(i18n.text('dav.uploadAction'), null, { method: 'PUT', url: webdavUrlV378(config, `${remoteDir}/${fileName}`), status: fileResponse.status, summary: i18n.text('dav.uploadFull') }); }

      setWebdavStatusV378(i18n.text('dav.uploaded', { file: fileName, size: formatBytesV376(bytes.byteLength), warning: manifestWarning }), manifestWarning ? 'warn' : 'ok');toast(manifestWarning ? i18n.text('dav.uploadPartial') : i18n.text('dav.uploadOk'), manifestWarning ? 'warn' : 'ok');
    }

    function xmlTextV378(node, name) {
      const el = node && node.getElementsByTagNameNS ? node.getElementsByTagNameNS('*', name)[0] : null;return el && el.textContent ? el.textContent.trim() : '';
    }

    // 提取目录条目的最后一段，兼容无法解码的历史 href 内容。
    function webdavFileNameFromHrefV378(href) {
      // 移除 WebDAV 链接附带的查询或锚点，只按路径判断文件名。
      const hrefPath = String(href || '').split(/[?#]/)[0];
      // 先去除目录尾斜杠，最后一个路径段才可能是备份名。
      const clean = hrefPath.replace(/\/+$/, '');
      const raw = clean.split('/').pop() || '';
      try { return decodeURIComponent(raw); } catch { return raw; }
    }

    function backupDateFromNameV378(fileName) {
      const m = String(fileName || '').match(WEBDAV_BACKUP_FILE_RE_V378);if (!m) { return ''; }

      const d = m[1]; const t = m[2]; const date = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)), Number(t.slice(0, 2)), Number(t.slice(2, 4)), Number(t.slice(4, 6))));return Number.isNaN(date.getTime()) ? '' : date.toISOString();
    }

    function normalizeWebdavEtag(etag) {
      // 去掉弱 ETag 前缀，列表只展示实际验证标签。
      const value = etag.replace(/^W\//, '');
      // HTTP ETag 可带双引号，展示时只移除两端的引号。
      return value.replace(/^"|"$/g, '');
    }

    // 浏览器优先按 XML 命名空间读取条目，解析失败时保留明确的错误码。
    function readWebdavDomRows(xmlText, rows) {
      const doc = new globalThis.DOMParser().parseFromString(String(xmlText || ''), 'application/xml');if (doc.getElementsByTagName('parsererror').length) { throw webdavErrorV378('WebDAV 返回的目录 XML 无法解析。', { code: 'xml_invalid' }); }

      [...doc.getElementsByTagNameNS('*', 'response')].forEach((node) => {
        const href = xmlTextV378(node, 'href'); const fileName = webdavFileNameFromHrefV378(href);if (!WEBDAV_BACKUP_FILE_RE_V378.test(fileName)) { return; }

        const modified = xmlTextV378(node, 'getlastmodified'); const size = Number(xmlTextV378(node, 'getcontentlength') || 0); const etag = normalizeWebdavEtag(xmlTextV378(node, 'getetag'));rows.push({ fileName, size: Number.isFinite(size) ? size : 0, etag, date: modified || backupDateFromNameV378(fileName) });
      });
    }

    // 旧运行环境没有 DOMParser 时，只在单条响应内匹配指定的 WebDAV 字段。
    function readWebdavXmlFallback(block, name) {
      // 字段可能带命名空间前缀，捕获开始和结束标签之间的文本。
      const pattern = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, 'i');
      const match = block.match(pattern);
      if (!match) { return ''; }

      // 依次还原实体，保持旧读取分支对字段值的解码顺序。
      const decodedAmpersands = match[1].replace(/&amp;/g, '&');
      // WebDAV 返回的文件路径可能包含转义的小于号。
      const decodedLessThan = decodedAmpersands.replace(/&lt;/g, '<');
      // 还原剩余大于号后再去除 XML 内容边缘的空白。
      return decodedLessThan.replace(/&gt;/g, '>').trim();
    }

    // 从没有 DOMParser 的环境提取 WebDAV 响应，沿用原字段回退规则。
    function readWebdavFallbackRows(xmlText, rows) {
      // 每个 response 节点描述一个目录条目，标签可以带 DAV 命名空间前缀。
      const blocks = String(xmlText || '').match(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/gi) || [];

      blocks.forEach((block) => {
        const fileName = webdavFileNameFromHrefV378(readWebdavXmlFallback(block, 'href'));if (!WEBDAV_BACKUP_FILE_RE_V378.test(fileName)) { return; }

        rows.push({ fileName, size: Number(readWebdavXmlFallback(block, 'getcontentlength') || 0), etag: normalizeWebdavEtag(readWebdavXmlFallback(block, 'getetag')), date: readWebdavXmlFallback(block, 'getlastmodified') || backupDateFromNameV378(fileName) });
      });
    }

    // 只显示符合备份命名规则的远端文件，保留时间、大小和验证标签。
    function parseWebdavBackupListV378(xmlText) {
      const rows = [];
      if (typeof globalThis.DOMParser !== 'undefined') {
        readWebdavDomRows(xmlText, rows);
      } else {
        readWebdavFallbackRows(xmlText, rows);
      }

      rows.forEach((item) => {
        const parsed = Date.parse(item.date || '');item.dateText = Number.isFinite(parsed) ? fmt(new Date(parsed).toISOString()) : i18n.text('dav.unknownDate');
      });

      return rows.sort((a, b) => b.fileName.localeCompare(a.fileName));
    }

    // 先读取历史备份列表，之后按可选索引标注最新文件。
    async function loadWebdavBackupListV378(config, password) {
      const remoteDir = normalizeWebdavRemoteDirV378(config.remoteDir); const response = await webdavRequestV378(config, password, remoteDir, { method: 'PROPFIND', trailingSlash: true, headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/><d:getetag/><d:resourcetype/></d:prop></d:propfind>', acceptStatuses: [207] });
      webdavRuntimeV378.backups = parseWebdavBackupListV378(await response.text());webdavRuntimeV378.latestFile = '';webdavRuntimeV378.latestManifest = null;
      try { const latest = await webdavRequestV378(config, password, `${remoteDir}/latest.json`, { method: 'GET', acceptStatuses: [200, 404] });if (latest.status === 200) { const manifest = JSON.parse(await latest.text());if (manifest && WEBDAV_BACKUP_FILE_RE_V378.test(String(manifest.fileName || ''))) { webdavRuntimeV378.latestFile = manifest.fileName;webdavRuntimeV378.latestManifest = manifest; } } } catch {
        // latest.json 是可选索引，失败时仍保留已经读取的历史列表。
      }

      renderWebdavPanelV378();return response;
    }

    async function refreshWebdavBackupsV378() {
      const config = webdavConfigFromFormV378(); const password = webdavPasswordFromFormV378(); const response = await loadWebdavBackupListV378(config, password);setWebdavDiagnosticV378(i18n.text('dav.refreshAction'), null, { method: 'PROPFIND', url: webdavUrlV378(config, config.remoteDir, true), status: response.status, summary: i18n.text('dav.listRead', { count: webdavRuntimeV378.backups.length }) });setWebdavStatusV378(i18n.text('dav.listRefreshed', { count: webdavRuntimeV378.backups.length }), 'ok');
    }

    // 下载后核对备份名和索引哈希，通过完整备份校验再等待用户确认。
    async function prepareWebdavRestoreV378(fileName, returnFocus) {
      if (!WEBDAV_BACKUP_FILE_RE_V378.test(String(fileName || ''))) { throw webdavErrorV378('远程文件名不符合 Shiroha Quiz 备份规则。', { code: 'invalid_file' }); }

      const config = webdavConfigFromFormV378(); const password = webdavPasswordFromFormV378(); const remoteDir = normalizeWebdavRemoteDirV378(config.remoteDir); const response = await webdavRequestV378(config, password, `${remoteDir}/${fileName}`, { method: 'GET', timeoutMs: 120000, acceptStatuses: [200] });
      const bytes = new Uint8Array(await response.arrayBuffer()); const sha = await sha256HexV378(bytes); const expected = String(fileName).match(WEBDAV_BACKUP_FILE_RE_V378)[3].toLowerCase();if (sha.slice(0, 8) !== expected) { throw webdavErrorV378('备份文件 SHA-256 与文件名不一致，已停止恢复。', { code: 'sha_mismatch', method: 'GET', url: webdavUrlV378(config, `${remoteDir}/${fileName}`) }); }

      const manifest = webdavRuntimeV378.latestManifest;if (manifest && manifest.fileName === fileName && manifest.sha256 && String(manifest.sha256).toLowerCase() !== sha) { throw webdavErrorV378('备份文件 SHA-256 与 latest.json 不一致，已停止恢复。', { code: 'sha_mismatch', method: 'GET', url: webdavUrlV378(config, `${remoteDir}/${fileName}`) }); }

      let data;try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw webdavErrorV378('远程备份不是有效的 UTF-8 JSON。', { code: 'json_invalid' }); }

      if (data.kind !== 'shiroha_quiz_web_full_backup' && data.exportType !== 'all_data') { throw webdavErrorV378('该文件不是 Web 完整备份，不能从云备份入口恢复。', { code: 'backup_kind' }); }

      const normalized = normalizeBackupPayloadV23(data, fileName);if (!normalized.banks.length) { throw webdavErrorV378('远程备份中没有可恢复的题库。', { code: 'backup_empty' }); }

      webdavRuntimeV378.pendingRestore = { fileName, bytes: bytes.byteLength, sha, data, normalized, exportedAt: data.exportedAt || '', questionCount: normalized.banks.reduce((n, b) => n + (b.questions || []).length, 0) };

      openWebdavRestoreModalV378(returnFocus);setWebdavDiagnosticV378(i18n.text('dav.download'), null, { method: 'GET', url: webdavUrlV378(config, `${remoteDir}/${fileName}`), status: response.status, summary: i18n.text('dav.downloadVerified') });setWebdavStatusV378(i18n.text('dav.chooseRestore'), 'ok');
    }

    // 恢复框只遍历自己的可用控件，禁止写入过程中用 Escape 关闭。
    function handleRestoreKeydown(event, modal) {
      if (event.key === 'Escape' && !isMutationBusy()) { event.preventDefault();closeWebdavRestoreModalV378();return; }

      if (event.key !== 'Tab') { return; }

      const controls = Array.from(modal.querySelectorAll('button:not(:disabled),select:not(:disabled)'));
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault();last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault();first?.focus(); }
    }

    // 展示待恢复备份摘要并把焦点移入确认框。
    function openWebdavRestoreModalV378(returnFocus) {
      const pending = webdavRuntimeV378.pendingRestore; const modal = $('#webdav-restore-modal-v378'); const meta = $('#webdav-restore-meta-v378');if (!pending || !modal) { return; }

      if (meta) { meta.textContent = `文件：${pending.fileName}｜导出时间：${pending.exportedAt ? fmt(pending.exportedAt) : '未知'}｜${pending.normalized.banks.length} 个题库｜${pending.questionCount} 道题｜${formatBytesV376(pending.bytes)}｜SHA-256 ${pending.sha.slice(0, 12)}…`; }

      modal.returnFocus = returnFocus;
      const mode = $('#webdav-restore-mode-v378');if (mode) { mode.value = 'merge'; }

      syncWebdavRestoreWarningV378();modal.hidden = false;
      mode?.focus();
      modal.onkeydown = (event) => handleRestoreKeydown(event, modal);
    }

    function syncWebdavRestoreWarningV378() {
      const overwrite = $('#webdav-restore-mode-v378')?.value === 'overwrite'; const warning = $('#webdav-restore-warning-v378');if (warning) { warning.textContent = overwrite ? i18n.text('dav.overwriteWarning') : i18n.text('dav.mergeWarning');warning.className = overwrite ? 'notice warn' : 'muted'; }
    }

    // 下载与恢复都会暂时禁用列表按钮，操作结束后才能把焦点还给原入口。
    function restoreWebdavFocus() {
      const modal = $('#webdav-restore-modal-v378');
      if (modal?.hidden && !webdavRuntimeV378.busy) {
        modal.returnFocus?.focus();
        modal.returnFocus = null;
      }
    }

    // 关闭时释放已确认的数据，避免已处理的备份被全局重试再次写入。
    function closeWebdavRestoreModalV378() {
      const modal = $('#webdav-restore-modal-v378');
      if (modal) {
        modal.hidden = true;
      }

      webdavRuntimeV378.pendingRestore = null;
      restoreWebdavFocus();
    }

    function restoreMode() {
      return $('#webdav-restore-mode-v378')?.value === 'overwrite' ? 'overwrite' : 'merge';
    }

    // 只对已下载校验的备份执行用户选择的恢复方式，成功后刷新所有数据入口。
    async function confirmWebdavRestoreV378() {
      const pending = webdavRuntimeV378.pendingRestore;if (!pending) { throw new Error('没有等待恢复的远程备份。'); }

      await restoreWebdavBackup(pending, restoreMode());
    }

    // 全局重试继续执行同一已确认备份，保存成功后仍由面板完成收尾。
    async function restoreWebdavBackup(pending, mode) {
      // 切页、取消或更改模式都要重新确认恢复。
      const retry = () => {
        const sameSelection = webdavRuntimeV378.pendingRestore === pending && restoreMode() === mode;
        if (!sameSelection || !$('#settings')?.classList.contains('active')) {
          toast(i18n.text('dav.selectionChanged'), 'warn');
          return false;
        }

        return runWebdavActionV378(i18n.text('dav.restoreAction'), () => restoreWebdavBackup(pending, mode));
      };

      if (!await applyNormalizedBackupV378(pending.normalized, mode, retry)) {
        return;
      }

      const bankCount = pending.normalized.banks.length; const { questionCount } = pending; const { fileName } = pending;closeWebdavRestoreModalV378();renderAll();setupEnhancedDataToolsV23();renderWebdavPanelV378();setWebdavStatusV378(i18n.text('dav.restoreSummary', { file: fileName, banks: bankCount, questions: questionCount, mode: i18n.text(mode === 'overwrite' ? 'dav.overwriteShort' : 'dav.mergeShort') }), 'ok');toast(i18n.text('dav.restoreOk'), 'ok');
    }

    return Object.freeze({
      defaultWebdavConfigV378,
      mount,
      renderWebdavPanelV378,
      isBusy: () => webdavRuntimeV378.busy,

      webdavRequestV378,
      classifyWebdavErrorV378,
    });
  }

  globalThis.ShirohaWebdavPanel = Object.freeze({ create });
})();
