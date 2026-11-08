(() => {
  'use strict';

  const WEBDAV_BACKUP_FILE_RE_V378 = /^shiroha-web-backup-(\d{8})-(\d{6})-([a-f0-9]{8})\.json$/i;
  function create({ platform, storeWebdavConfigV378, clearWebdavStorageV378, loadNativeAll,
    getState, buildBackupPayloadV23, normalizeBackupPayloadV23, applyNormalizedBackupV378,
    isStringTooLargeErrorV376, isMutationBusy, APP_VERSION,
    now, fmt, esc, formatBytesV376, copyTextV23, toast, renderAll, setupEnhancedDataToolsV23 }) {
    const $ = (selector) => document.querySelector(selector);
    // 配置表单、请求状态与待恢复项归当前面板；清除配置或页面卸载时释放。
    let webdavRuntimeV378 = { busy: false, action: '', backups: [], latestFile: '', status: '', statusKind: '', diagnostic: null, pendingRestore: null, formLoaded: false };
    function defaultWebdavConfigV378() { return { endpoint: '', username: '', remoteDir: 'ShirohaQuiz/Web', rememberPassword: false, lastUploadAt: '', lastUploadFile: '', lastUploadSize: 0, lastUploadSha: '' }; }
    function readWebdavConfigV378() {
      try { const parsed = platform.credentials.readDav();return { ...defaultWebdavConfigV378(), ...(parsed && typeof parsed === 'object' ? parsed : {}) }; } catch { return defaultWebdavConfigV378(); }
    }
    function readWebdavPasswordV378(config = readWebdavConfigV378()) { return platform.credentials.status('webdav', config); }
    function normalizeWebdavEndpointV378(value) {
      const raw = String(value || '').trim();if (!raw) { throw new Error('请填写 WebDAV 地址。'); }
      let url;try { url = new URL(raw); } catch { throw new Error('WebDAV 地址格式无效。请填写完整的 http:// 或 https:// 地址。'); }
      if (!/^https?:$/.test(url.protocol)) { throw new Error('WebDAV 地址只支持 http:// 或 https://。'); }
      if (url.username || url.password) { throw new Error('请不要把用户名或密码写在 WebDAV 地址中。'); }
      if (url.search || url.hash) { throw new Error('WebDAV 地址不能包含查询参数或锚点。'); }
      url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
      return url.href.replace(/\/$/, '');
    }
    function normalizeWebdavRemoteDirV378(value) {
      const raw = String(value || 'ShirohaQuiz/Web').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const parts = raw.split('/').map((x) => x.trim()).filter(Boolean);
      if (!parts.length) { return 'ShirohaQuiz/Web'; }
      if (parts.some((x) => x === '.' || x === '..')) { throw new Error('远端目录不能包含 . 或 .. 路径。'); }
      const containsUnsupportedCharacter = parts.some((part) => /[?#]/.test(part)
        || Array.from(part).some((character) => character.charCodeAt(0) <= 0x1f));
      if (containsUnsupportedCharacter) { throw new Error('远端目录包含不支持的字符。'); }
      return parts.join('/');
    }
    function webdavConfigFromFormV378() {
      const old = readWebdavConfigV378();
      return { ...old, endpoint: normalizeWebdavEndpointV378($('#webdav-endpoint-v378')?.value), username: String($('#webdav-username-v378')?.value || '').trim(), remoteDir: normalizeWebdavRemoteDirV378($('#webdav-remote-dir-v378')?.value), rememberPassword: !!$('#webdav-remember-v378')?.checked };
    }
    function webdavPasswordFromFormV378() { const config = webdavConfigFromFormV378();return String($('#webdav-password-v378')?.value || '') || readWebdavPasswordV378(config); }
    function fillWebdavFormV378() {
      const config = readWebdavConfigV378();
      const values = [['#webdav-endpoint-v378', config.endpoint], ['#webdav-remote-dir-v378', config.remoteDir], ['#webdav-username-v378', config.username], ['#webdav-password-v378', '']];
      values.forEach(([id, value]) => { const el = $(id);if (el) { el.value = value || ''; } });const remember = $('#webdav-remember-v378');if (remember) { remember.checked = !!config.rememberPassword; }webdavRuntimeV378.formLoaded = true;
    }
    function webdavUrlV378(config, relativePath = '', trailingSlash = false) {
      const base = `${String(config.endpoint || '').replace(/\/+$/, '')}/`;
      const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
      if (parts.some((x) => x === '.' || x === '..')) { throw new Error('WebDAV 路径不安全。'); }
      const encoded = parts.map((x) => encodeURIComponent(x)).join('/');
      return new URL(encoded + (trailingSlash && encoded ? '/' : ''), base).href;
    }
    function webdavPublicUrlV378(url) { try { const parsed = new URL(url);return parsed.origin + parsed.pathname; } catch { return ''; } }
    function webdavErrorV378(message, meta = {}) { const error = new Error(message);Object.assign(error, meta);return error; }
    async function webdavRequestV378(config, password, relativePath, options = {}) {
      // Fetch failures do not distinguish mixed content from CORS or network errors.
      return platform.network.webdav(config, password, relativePath, options);
    }
    function classifyWebdavErrorV378(error) {
      const status = Number((error && error.status) || 0); const code = String((error && error.code) || '');
      if (code === 'mixed_content') { return { type: '可能的混合内容拦截 / 网络 / CORS', summary: 'HTTPS 页面请求 HTTP WebDAV 失败，可能被浏览器拦截，也可能是网络或跨域配置问题。', suggestion: '建议使用 HTTPS WebDAV；HTTP 会明文传输账号凭据和备份。若已在浏览器中允许不安全内容，请检查服务状态、CORS 配置及浏览器控制台中的具体错误。' }; }
      if (code === 'result_unknown') { return { type: '远端结果待核对', summary: '请求已中断，但备份可能已经到达远端。', suggestion: '先刷新远端列表，确认文件及校验值后再决定重试。' }; }
      if (code === 'timeout') { return { type: '请求超时', summary: '服务未在限定时间内响应。', suggestion: '检查网络、服务状态和反向代理超时设置。' }; }
      if (code === 'network') { return { type: '网络 / CORS / TLS', summary: '浏览器未取得 WebDAV 响应。', suggestion: '确认服务已启动、证书可信，并允许当前 Origin 以及 OPTIONS、PROPFIND、MKCOL、GET、PUT 和 Authorization、Content-Type、Depth 请求头。' }; }
      const map = { 401: ['鉴权失败', '用户名、密码或应用专用密码不正确。', '检查账号凭据；启用双重验证时通常需要应用专用密码。'], 403: ['权限 / CORS 拒绝', '服务器拒绝当前请求。', '检查目录读写权限、Origin 白名单和反向代理规则。'], 404: ['路径不存在', 'WebDAV 地址或远端目录不存在。', '核对 WebDAV 根地址；首次上传会自动创建所配置的远端目录。'], 405: ['方法不允许', '服务器未开放当前 WebDAV 方法。', '确认反向代理允许 PROPFIND、MKCOL、GET 和 PUT。'], 409: ['父目录不存在', '服务器要求先创建上级目录。', '核对 WebDAV 根地址和远端目录权限。'], 412: ['条件冲突', '服务器拒绝覆盖或条件请求。', '检查服务端文件锁定、版本或覆盖策略。'], 413: ['上传过大', '服务器拒绝当前备份大小。', '提高服务端上传限制，或减少题库中的大图片。'], 423: ['资源被锁定', '远端文件或目录正被锁定。', '稍后重试，或在 WebDAV 服务端解除锁定。'], 429: ['请求过多', '服务端暂时限流。', '稍后重试。'], 507: ['远端空间不足', 'WebDAV 存储空间不足。', '清理远端旧文件或扩充配额后重试。'] };
      if (map[status]) { return { type: map[status][0], summary: map[status][1], suggestion: map[status][2] }; }
      if (status >= 500) { return { type: '服务端错误', summary: `WebDAV 服务返回 HTTP ${status}。`, suggestion: '检查 WebDAV 服务和反向代理日志后重试。' }; }
      return { type: 'WebDAV 请求失败', summary: (error && error.message) || '未知错误。', suggestion: '核对地址、账号、目录权限及浏览器 CORS 配置。' };
    }
    function setWebdavDiagnosticV378(action, error, successMeta = null) {
      if (successMeta) { webdavRuntimeV378.diagnostic = { time: now(), action, method: successMeta.method || '', url: webdavPublicUrlV378(successMeta.url || ''), origin: typeof location !== 'undefined' ? location.origin : '', status: successMeta.status || '', type: '连接正常', summary: successMeta.summary || '请求成功。', suggestion: '可继续上传或读取远程备份。' };return; }
      const info = classifyWebdavErrorV378(error);webdavRuntimeV378.diagnostic = { time: now(), action, method: (error && error.method) || '', url: webdavPublicUrlV378((error && error.url) || ''), origin: typeof location !== 'undefined' ? location.origin : '', status: (error && error.status) || '', type: info.type, summary: info.summary, suggestion: info.suggestion };
    }
    function webdavDiagnosticTextV378() {
      const d = webdavRuntimeV378.diagnostic;if (!d) { return 'Shiroha Quiz WebDAV：尚无诊断信息。'; }
      return ['Shiroha Quiz WebDAV 诊断', `时间：${d.time}`, `操作：${d.action}`, `方法：${d.method || '—'}`, `地址：${d.url || '—'}`, `页面 Origin：${d.origin || '—'}`, `HTTP 状态：${d.status || '—'}`, `判断：${d.type}`, `摘要：${d.summary}`, `建议：${d.suggestion}`].join('\n');
    }
    function setWebdavStatusV378(message, kind = '') { webdavRuntimeV378.status = message;webdavRuntimeV378.statusKind = kind;renderWebdavPanelV378(); }
    function setWebdavBusyV378(action = '') { webdavRuntimeV378.busy = !!action;webdavRuntimeV378.action = action;const stop = $('#webdav-stop-native');if (stop) { stop.disabled = !action; }renderWebdavPanelV378(); }
    async function runWebdavActionV378(action, task) {
      if (webdavRuntimeV378.busy) { return; }setWebdavBusyV378(action);setWebdavStatusV378(`${action}处理中…`, '');
      try { return await task(); } catch (error) { setWebdavDiagnosticV378(action, error);const message = `${action}失败：${classifyWebdavErrorV378(error).summary}`;setWebdavStatusV378(message, 'danger');const details = $('#webdav-diagnostics-details-v378');if (details) { details.open = true; }toast(message, 'danger'); } finally { setWebdavBusyV378(''); }
    }
    function mount(container) {
      if ($('#webdav-panel-v378')) { return; }
      container.insertAdjacentHTML('beforeend', `<div id="webdav-panel-v378" class="data-tools-v23 webdav-card-v378">
        <div class="webdav-head-v378"><div><h2>WebDAV 云备份</h2><p class="muted">手动上传和恢复 Web 完整备份。不会自动同步，也不会自动删除远端文件。</p></div><span id="webdav-status-chip-v378" class="webdav-chip-v378">未配置</span></div>
        <div class="form-grid webdav-form-v378">
          <label>WebDAV 地址<input id="webdav-endpoint-v378" type="url" inputmode="url" autocomplete="url" placeholder="https://dav.example.com/remote.php/dav/files/用户名" /></label>
          <label>远端目录<input id="webdav-remote-dir-v378" autocomplete="off" placeholder="ShirohaQuiz/Web" /></label>
          <label>用户名<input id="webdav-username-v378" autocomplete="username" /></label>
          <label>密码 / 应用专用密码<input id="webdav-password-v378" type="password" autocomplete="current-password" /></label>
        </div>
        <label class="check-line-v23 webdav-remember-v378"><input id="webdav-remember-v378" type="checkbox" />${platform.credentials.native ? '使用 Windows 凭据管理器记住密码' : '在此浏览器记住密码'} <span class="muted">（${platform.credentials.native ? '默认仅保留到当前进程退出' : '默认仅保留到当前标签页会话'}）</span></label>
        <div class="actions wrap-v23 webdav-actions-v378">
          <button class="ghost" id="webdav-save-v378" type="button">保存配置</button>
          <button class="ghost" id="webdav-test-v378" type="button">测试连接</button>
          <button class="ghost danger" id="webdav-clear-v378" type="button">清除配置</button>
          <button class="primary" id="webdav-upload-v378" type="button">上传当前完整备份</button>
          <button class="ghost" id="webdav-refresh-v378" type="button">刷新远程备份</button>
        </div>
        <div id="webdav-status-v378" class="notice">填写地址后可测试连接。</div>
        <div id="webdav-last-summary-v378" class="webdav-summary-v378 muted"></div>
        <div class="webdav-list-head-v378"><h3>远程备份</h3><span class="muted">仅显示本应用生成的时间戳备份；V37.8 不提供远端删除。</span></div>
        <div id="webdav-list-v378" class="webdav-list-v378"><p class="muted">尚未读取远程目录。</p></div>
        <details id="webdav-diagnostics-details-v378" class="webdav-diagnostics-v378"><summary>连接诊断</summary><div id="webdav-diagnostics-v378" class="muted">尚无诊断信息。</div><button class="ghost mini-btn" id="webdav-copy-diagnostics-v378" type="button">复制诊断</button></details>
        <p class="muted webdav-security-v378">凭据与题库状态分开保存，不进入 Web 完整备份。建议使用 HTTPS 和服务端应用专用密码；浏览器无法绕过服务端 CORS。</p>
      </div>
      <div id="webdav-restore-modal-v378" class="webdav-modal-v378" hidden>
        <div class="webdav-modal-card-v378" role="dialog" aria-modal="true" aria-labelledby="webdav-restore-title-v378">
          <h2 id="webdav-restore-title-v378">确认恢复远程备份</h2>
          <div id="webdav-restore-meta-v378" class="notice"></div>
          <label>恢复方式<select id="webdav-restore-mode-v378"><option value="merge">合并导入：保留当前数据，追加备份题库</option><option value="overwrite">覆盖恢复：用备份替换当前本地数据</option></select></label>
          <p id="webdav-restore-warning-v378" class="muted">恢复前会校验文件哈希；写入失败会回滚到恢复前状态。</p>
          <div class="actions wrap-v23"><button class="ghost" id="webdav-restore-cancel-v378" type="button">取消</button><button class="primary" id="webdav-restore-confirm-v378" type="button">确认恢复</button></div>
        </div>
      </div>`);
      bindWebdavPanelV378();
      renderWebdavPanelV378(true);
    }
    function bindWebdavPanelV378() {
      const save = $('#webdav-save-v378');if (!save) { return; }
      save.onclick = async () => { try { const config = webdavConfigFromFormV378();await storeWebdavConfigV378(config, webdavPasswordFromFormV378());setWebdavStatusV378('配置已保存。密码按当前“记住密码”选项单独存放。', 'ok');toast('WebDAV 配置已保存。', 'ok'); } catch (error) { setWebdavStatusV378(error.message, 'danger'); } };
      // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
      $('#webdav-clear-v378').onclick = async () => { try { await clearWebdavStorageV378(); } catch (error) { setWebdavStatusV378('清除失败：' + error.message, 'warn');return; }webdavRuntimeV378 = { busy: false, action: '', backups: [], latestFile: '', status: '配置和密码已清除。', statusKind: 'ok', diagnostic: null, pendingRestore: null, formLoaded: false };fillWebdavFormV378();renderWebdavPanelV378();toast('WebDAV 配置已清除。', 'ok'); };
      $('#webdav-test-v378').onclick = () => runWebdavActionV378('测试连接', testWebdavConnectionV378);
      $('#webdav-upload-v378').onclick = () => runWebdavActionV378('上传备份', uploadWebdavBackupV378);
      $('#webdav-refresh-v378').onclick = () => runWebdavActionV378('刷新列表', refreshWebdavBackupsV378);
      if (platform.network.cancelAll && !$('#webdav-stop-native')) {
        const stop = document.createElement('button');stop.id = 'webdav-stop-native';stop.type = 'button';stop.className = 'ghost';stop.textContent = '取消网络任务';stop.disabled = !webdavRuntimeV378.busy;
        stop.onclick = async () => { stop.disabled = true;try { await platform.network.cancelAll();setWebdavStatusV378('已请求取消，正在确认结果；上传请核对远端列表。', 'warn'); } catch (error) { setWebdavStatusV378(error.message, 'danger'); } };
        $('#webdav-refresh-v378').after(stop);
      }

      $('#webdav-copy-diagnostics-v378').onclick = () => copyTextV23(webdavDiagnosticTextV378(), '已复制 WebDAV 诊断（不含密码）。');
      $('#webdav-list-v378').onclick = (e) => { const button = e.target.closest('[data-webdav-restore-v378]');if (button) { runWebdavActionV378('下载备份', () => prepareWebdavRestoreV378(button.dataset.webdavRestoreV378)); } };
      $('#webdav-restore-cancel-v378').onclick = closeWebdavRestoreModalV378;
      $('#webdav-restore-confirm-v378').onclick = () => runWebdavActionV378('恢复备份', confirmWebdavRestoreV378);
      $('#webdav-restore-mode-v378').onchange = syncWebdavRestoreWarningV378;
      $('#webdav-restore-modal-v378').onclick = (e) => { if (e.target.id === 'webdav-restore-modal-v378') { closeWebdavRestoreModalV378(); } };
    }
    function renderWebdavPanelV378(forceForm = false) {
      if (!$('#webdav-panel-v378')) { return; } if (forceForm || !webdavRuntimeV378.formLoaded) { fillWebdavFormV378(); }
      const config = readWebdavConfigV378(); const configured = !!config.endpoint;const chip = $('#webdav-status-chip-v378');
      if (chip) {
        chip.textContent = configured ? '已配置' : '未配置';
        if (webdavRuntimeV378.busy) { chip.textContent = `${webdavRuntimeV378.action}中`; }
        chip.className = `webdav-chip-v378 ${webdavRuntimeV378.statusKind || (configured ? 'ok' : '')}`;
      }
      const status = $('#webdav-status-v378');if (status) { status.textContent = webdavRuntimeV378.status || (configured ? '配置已载入，可测试连接或刷新列表。' : '填写地址后可测试连接。');status.className = `notice ${webdavRuntimeV378.statusKind || ''}`; }
      const summary = $('#webdav-last-summary-v378');if (summary) { summary.textContent = config.lastUploadAt ? `最近上传：${fmt(config.lastUploadAt)}｜${config.lastUploadFile || '—'}｜${formatBytesV376(config.lastUploadSize || 0)}｜SHA-256 ${String(config.lastUploadSha || '').slice(0, 12)}…` : '尚无成功上传记录。'; }
      ['#webdav-save-v378', '#webdav-test-v378', '#webdav-clear-v378', '#webdav-upload-v378', '#webdav-refresh-v378', '#webdav-restore-confirm-v378'].forEach((id) => { const el = $(id);if (el) { el.disabled = webdavRuntimeV378.busy; } });
      const list = $('#webdav-list-v378');
      if (list) {
        const rows = webdavRuntimeV378.backups || [];
        const hasReadList = webdavRuntimeV378.status && /刷新|读取/.test(webdavRuntimeV378.status);
        if (rows.length) {
          list.innerHTML = rows.map((item) => `<div class="webdav-row-v378"><div class="webdav-file-v378"><b>${esc(item.fileName)}${item.fileName === webdavRuntimeV378.latestFile ? '<span class="webdav-latest-v378">latest</span>' : ''}</b><span class="muted">${esc(item.dateText || '时间未知')}</span></div><span class="webdav-row-meta-v378 muted">${formatBytesV376(item.size || 0)}</span><span class="muted">${esc(item.etag || '')}</span><button class="ghost mini-btn" type="button" data-webdav-restore-v378="${esc(item.fileName)}" ${webdavRuntimeV378.busy ? 'disabled' : ''}>恢复</button></div>`).join('');
        } else {
          list.innerHTML = hasReadList ? '<p class="muted">远端目录中没有本应用生成的备份。</p>' : '<p class="muted">尚未读取远程目录。</p>';
        }
      }
      const diag = $('#webdav-diagnostics-v378');if (diag) { const d = webdavRuntimeV378.diagnostic;diag.innerHTML = d ? `<dl><dt>时间</dt><dd>${esc(fmt(d.time))}</dd><dt>操作</dt><dd>${esc(d.action)}</dd><dt>方法</dt><dd>${esc(d.method || '—')}</dd><dt>地址</dt><dd>${esc(d.url || '—')}</dd><dt>页面 Origin</dt><dd>${esc(d.origin || '—')}</dd><dt>HTTP 状态</dt><dd>${esc(d.status || '—')}</dd><dt>判断</dt><dd>${esc(d.type)}</dd><dt>摘要</dt><dd>${esc(d.summary)}</dd><dt>建议</dt><dd>${esc(d.suggestion)}</dd></dl>` : '尚无诊断信息。'; }
    }
    async function testWebdavConnectionV378() {
      const config = webdavConfigFromFormV378(); const password = webdavPasswordFromFormV378();const response = await webdavRequestV378(config, password, '', { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' }, body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>', acceptStatuses: [207] });
      setWebdavDiagnosticV378('测试连接', null, { method: 'PROPFIND', url: config.endpoint, status: response.status, summary: 'WebDAV 根地址可访问。' });setWebdavStatusV378(`连接成功（HTTP ${response.status}）。可上传备份或刷新远程列表。`, 'ok');toast('WebDAV 连接成功。', 'ok');
    }
    async function ensureWebdavDirectoryV378(config, password) {
      const parts = normalizeWebdavRemoteDirV378(config.remoteDir).split('/');let path = '';
      for (const part of parts) { path = path ? `${path}/${part}` : part;await webdavRequestV378(config, password, path, { method: 'MKCOL', acceptStatuses: [200, 201, 204, 405] }); }
    }
    async function sha256HexV378(bytes) {
      if (!globalThis.crypto || !globalThis.crypto.subtle) { throw webdavErrorV378('当前浏览器环境不支持 SHA-256 校验。请使用较新的浏览器并通过 HTTPS 或 localhost 打开。', { code: 'crypto_unavailable' }); }
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
    }
    function webdavTimestampV378(date = new Date()) { return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); }
    async function uploadWebdavBackupV378() {
      if (!await loadNativeAll()) { return; }
      const config = webdavConfigFromFormV378(); const password = webdavPasswordFromFormV378();
      let text;try { text = JSON.stringify(buildBackupPayloadV23(getState().banks || [], 'all_data', true)); } catch (error) { if (typeof isStringTooLargeErrorV376 === 'function' && isStringTooLargeErrorV376(error)) { throw webdavErrorV378('当前完整备份过大，浏览器无法生成上传文本。请先减少大图片或拆分题库。', { code: 'payload_too_large' }); } throw error; }
      const bytes = new TextEncoder().encode(text); const sha = await sha256HexV378(bytes); const fileName = `shiroha-web-backup-${webdavTimestampV378()}-${sha.slice(0, 8)}.json`; const remoteDir = normalizeWebdavRemoteDirV378(config.remoteDir);
      await ensureWebdavDirectoryV378(config, password);
      const fileResponse = await webdavRequestV378(config, password, `${remoteDir}/${fileName}`, { method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: bytes, timeoutMs: 120000, acceptStatuses: [200, 201, 204] });
      const questionCount = (getState().banks || []).reduce((n, b) => n + (b.questions || []).length, 0); const manifest = { kind: 'shiroha_quiz_webdav_latest', version: 1, app: 'Shiroha Quiz', appVersion: APP_VERSION, updatedAt: now(), fileName, sha256: sha, sizeBytes: bytes.byteLength, bankCount: (getState().banks || []).length, questionCount };
      let manifestWarning = '';try { await webdavRequestV378(config, password, `${remoteDir}/latest.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(manifest), acceptStatuses: [200, 201, 204] }); } catch (error) { manifestWarning = '；备份文件已上传，但 latest.json 更新失败';setWebdavDiagnosticV378('更新 latest.json', error); }
      const saved = { ...config, lastUploadAt: manifest.updatedAt, lastUploadFile: fileName, lastUploadSize: bytes.byteLength, lastUploadSha: sha };await storeWebdavConfigV378(saved, password, false);
      try { await loadWebdavBackupListV378(config, password); } catch (error) { manifestWarning += '；远程列表刷新失败';setWebdavDiagnosticV378('刷新列表', error); }
      if (!manifestWarning) { setWebdavDiagnosticV378('上传备份', null, { method: 'PUT', url: webdavUrlV378(config, `${remoteDir}/${fileName}`), status: fileResponse.status, summary: '完整备份及 latest.json 已上传。' }); }
      setWebdavStatusV378(`上传成功：${fileName}（${formatBytesV376(bytes.byteLength)}）${manifestWarning}`, manifestWarning ? 'warn' : 'ok');toast(manifestWarning ? '备份已上传，但索引或列表更新不完整。' : 'WebDAV 完整备份上传成功。', manifestWarning ? 'warn' : 'ok');
    }
    function xmlTextV378(node, name) { const el = node && node.getElementsByTagNameNS ? node.getElementsByTagNameNS('*', name)[0] : null;return el && el.textContent ? el.textContent.trim() : ''; }
    function webdavFileNameFromHrefV378(href) {
      const clean = String(href || '').split(/[?#]/)[0].replace(/\/+$/, '');const raw = clean.split('/').pop() || '';try { return decodeURIComponent(raw); } catch { return raw; }
    }
    function backupDateFromNameV378(fileName) {
      const m = String(fileName || '').match(WEBDAV_BACKUP_FILE_RE_V378);if (!m) { return ''; }
      const d = m[1]; const t = m[2]; const date = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)), Number(t.slice(0, 2)), Number(t.slice(2, 4)), Number(t.slice(4, 6))));return Number.isNaN(date.getTime()) ? '' : date.toISOString();
    }
    function parseWebdavBackupListV378(xmlText) {
      const rows = [];
      if (typeof globalThis.DOMParser !== 'undefined') {
        const doc = new globalThis.DOMParser().parseFromString(String(xmlText || ''), 'application/xml');if (doc.getElementsByTagName('parsererror').length) { throw webdavErrorV378('WebDAV 返回的目录 XML 无法解析。', { code: 'xml_invalid' }); }
        [...doc.getElementsByTagNameNS('*', 'response')].forEach((node) => { const href = xmlTextV378(node, 'href'); const fileName = webdavFileNameFromHrefV378(href);if (!WEBDAV_BACKUP_FILE_RE_V378.test(fileName)) { return; } const modified = xmlTextV378(node, 'getlastmodified'); const size = Number(xmlTextV378(node, 'getcontentlength') || 0); const etag = xmlTextV378(node, 'getetag').replace(/^W\//, '').replace(/^"|"$/g, '');rows.push({ fileName, size: Number.isFinite(size) ? size : 0, etag, date: modified || backupDateFromNameV378(fileName) }); });
      } else {
        const blocks = String(xmlText || '').match(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/gi) || [];
        const value = (block, name) => { const m = block.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, 'i'));return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : ''; };
        blocks.forEach((block) => { const fileName = webdavFileNameFromHrefV378(value(block, 'href'));if (!WEBDAV_BACKUP_FILE_RE_V378.test(fileName)) { return; }rows.push({ fileName, size: Number(value(block, 'getcontentlength') || 0), etag: value(block, 'getetag').replace(/^W\//, '').replace(/^"|"$/g, ''), date: value(block, 'getlastmodified') || backupDateFromNameV378(fileName) }); });
      }
      rows.forEach((item) => { const parsed = Date.parse(item.date || '');item.dateText = Number.isFinite(parsed) ? fmt(new Date(parsed).toISOString()) : '时间未知'; });return rows.sort((a, b) => b.fileName.localeCompare(a.fileName));
    }
    async function loadWebdavBackupListV378(config, password) {
      const remoteDir = normalizeWebdavRemoteDirV378(config.remoteDir); const response = await webdavRequestV378(config, password, remoteDir, { method: 'PROPFIND', trailingSlash: true, headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/><d:getetag/><d:resourcetype/></d:prop></d:propfind>', acceptStatuses: [207] });
      webdavRuntimeV378.backups = parseWebdavBackupListV378(await response.text());webdavRuntimeV378.latestFile = '';webdavRuntimeV378.latestManifest = null;
      try { const latest = await webdavRequestV378(config, password, `${remoteDir}/latest.json`, { method: 'GET', acceptStatuses: [200, 404] });if (latest.status === 200) { const manifest = JSON.parse(await latest.text());if (manifest && WEBDAV_BACKUP_FILE_RE_V378.test(String(manifest.fileName || ''))) { webdavRuntimeV378.latestFile = manifest.fileName;webdavRuntimeV378.latestManifest = manifest; } } } catch {
        // latest.json 是可选索引，失败时仍保留已经读取的历史列表。
      }
      renderWebdavPanelV378();return response;
    }
    async function refreshWebdavBackupsV378() {
      const config = webdavConfigFromFormV378(); const password = webdavPasswordFromFormV378(); const response = await loadWebdavBackupListV378(config, password);setWebdavDiagnosticV378('刷新列表', null, { method: 'PROPFIND', url: webdavUrlV378(config, config.remoteDir, true), status: response.status, summary: `读取到 ${webdavRuntimeV378.backups.length} 个应用备份。` });setWebdavStatusV378(`远程列表已刷新，共 ${webdavRuntimeV378.backups.length} 个备份。`, 'ok');
    }
    async function prepareWebdavRestoreV378(fileName) {
      if (!WEBDAV_BACKUP_FILE_RE_V378.test(String(fileName || ''))) { throw webdavErrorV378('远程文件名不符合 Shiroha Quiz 备份规则。', { code: 'invalid_file' }); }
      const config = webdavConfigFromFormV378(); const password = webdavPasswordFromFormV378(); const remoteDir = normalizeWebdavRemoteDirV378(config.remoteDir); const response = await webdavRequestV378(config, password, `${remoteDir}/${fileName}`, { method: 'GET', timeoutMs: 120000, acceptStatuses: [200] });
      const bytes = new Uint8Array(await response.arrayBuffer()); const sha = await sha256HexV378(bytes); const expected = String(fileName).match(WEBDAV_BACKUP_FILE_RE_V378)[3].toLowerCase();if (sha.slice(0, 8) !== expected) { throw webdavErrorV378('备份文件 SHA-256 与文件名不一致，已停止恢复。', { code: 'sha_mismatch', method: 'GET', url: webdavUrlV378(config, `${remoteDir}/${fileName}`) }); }
      const manifest = webdavRuntimeV378.latestManifest;if (manifest && manifest.fileName === fileName && manifest.sha256 && String(manifest.sha256).toLowerCase() !== sha) { throw webdavErrorV378('备份文件 SHA-256 与 latest.json 不一致，已停止恢复。', { code: 'sha_mismatch', method: 'GET', url: webdavUrlV378(config, `${remoteDir}/${fileName}`) }); }
      let data;try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw webdavErrorV378('远程备份不是有效的 UTF-8 JSON。', { code: 'json_invalid' }); }
      if (data.kind !== 'shiroha_quiz_web_full_backup' && data.exportType !== 'all_data') { throw webdavErrorV378('该文件不是 Web 完整备份，不能从云备份入口恢复。', { code: 'backup_kind' }); }
      const normalized = normalizeBackupPayloadV23(data, fileName);if (!normalized.banks.length) { throw webdavErrorV378('远程备份中没有可恢复的题库。', { code: 'backup_empty' }); }
      webdavRuntimeV378.pendingRestore = { fileName, bytes: bytes.byteLength, sha, data, normalized, exportedAt: data.exportedAt || '', questionCount: normalized.banks.reduce((n, b) => n + (b.questions || []).length, 0) };openWebdavRestoreModalV378();setWebdavDiagnosticV378('下载备份', null, { method: 'GET', url: webdavUrlV378(config, `${remoteDir}/${fileName}`), status: response.status, summary: '下载和 SHA-256 校验通过，等待用户确认恢复。' });setWebdavStatusV378('备份下载并校验完成，请在确认框选择恢复方式。', 'ok');
    }
    function openWebdavRestoreModalV378() {
      const pending = webdavRuntimeV378.pendingRestore; const modal = $('#webdav-restore-modal-v378'); const meta = $('#webdav-restore-meta-v378');if (!pending || !modal) { return; }
      if (meta) { meta.textContent = `文件：${pending.fileName}｜导出时间：${pending.exportedAt ? fmt(pending.exportedAt) : '未知'}｜${pending.normalized.banks.length} 个题库｜${pending.questionCount} 道题｜${formatBytesV376(pending.bytes)}｜SHA-256 ${pending.sha.slice(0, 12)}…`; }
      modal.returnFocus = document.activeElement;
      const mode = $('#webdav-restore-mode-v378');if (mode) { mode.value = 'merge'; }syncWebdavRestoreWarningV378();modal.hidden = false;
      mode?.focus();
      modal.onkeydown = (event) => {
        if (event.key === 'Escape' && !isMutationBusy()) { event.preventDefault();closeWebdavRestoreModalV378();return; }
        if (event.key !== 'Tab') { return; }
        const controls = Array.from(modal.querySelectorAll('button:not(:disabled),select:not(:disabled)'));
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault();last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault();first?.focus(); }
      };
    }
    function syncWebdavRestoreWarningV378() { const overwrite = $('#webdav-restore-mode-v378')?.value === 'overwrite'; const warning = $('#webdav-restore-warning-v378');if (warning) { warning.textContent = overwrite ? '覆盖恢复会替换当前全部题库、错题、收藏、记录和设置；写入失败会自动回滚。' : '合并恢复会保留当前数据，并追加备份题库；同名题库会自动改名。';warning.className = overwrite ? 'notice warn' : 'muted'; } }
    function closeWebdavRestoreModalV378() { const modal = $('#webdav-restore-modal-v378');if (modal) { modal.hidden = true;modal.returnFocus?.focus();modal.returnFocus = null; }webdavRuntimeV378.pendingRestore = null; }
    async function confirmWebdavRestoreV378() {
      const pending = webdavRuntimeV378.pendingRestore;if (!pending) { throw new Error('没有等待恢复的远程备份。'); } const mode = $('#webdav-restore-mode-v378')?.value === 'overwrite' ? 'overwrite' : 'merge';
      if (!await applyNormalizedBackupV378(pending.normalized, mode)) { return; } const bankCount = pending.normalized.banks.length; const { questionCount } = pending; const { fileName } = pending;closeWebdavRestoreModalV378();renderAll();setupEnhancedDataToolsV23();renderWebdavPanelV378();setWebdavStatusV378(`恢复完成：${fileName}，${bankCount} 个题库、${questionCount} 道题（${mode === 'overwrite' ? '覆盖' : '合并'}）。`, 'ok');toast('WebDAV 备份恢复完成。', 'ok');
    }

    return Object.freeze({ defaultWebdavConfigV378, mount, renderWebdavPanelV378,
      isBusy: () => webdavRuntimeV378.busy, webdavRequestV378, classifyWebdavErrorV378 });
  }
  globalThis.ShirohaWebdavPanel = Object.freeze({ create });
})();
