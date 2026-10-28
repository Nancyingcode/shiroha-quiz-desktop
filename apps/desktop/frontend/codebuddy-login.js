// @ts-check
(function () {
  'use strict';
  /** @typedef {'signed_out'|'authenticating'|'restoring'|'signed_in'|'expired'|'failed'|'cancelled'} Phase */
  /** @typedef {'login'|'open_login'|'cancel'|'logout'|'set_remember'|'retry_restore'} Action */
  /** @typedef {'none'|'saving'|'saved'|'clearing'|'cleanup_required'|'error'} PersistenceState */
  /** @typedef {{phase:Phase,revision:number,loginUrl:string,message:string,browserOpened:boolean,busy:boolean,rememberLogin:boolean,persistenceState:PersistenceState,persistenceErrorCode:string|null}} AccountStatus */
  const scope = /** @type {typeof globalThis & Partial<import('../../web/platform/runtime').BrowserGlobals> & {ShirohaDesktopHost?:{invoke(command:string,args:Record<string,unknown>):Promise<unknown>}}} */ (globalThis);
  const host = scope.ShirohaDesktopHost;
  if (!host) return;
  const pollIntervalMs = 1000;
  const statusTimeoutMs = 15000;
  /** @type {Record<Phase,string>} */
  const labels = { signed_out:'尚未登录', authenticating:'等待完成登录', restoring:'正在恢复登录', signed_in:'个人账户已登录', expired:'登录已过期', failed:'登录未完成', cancelled:'登录已取消' };

  /** @param {unknown} value @returns {AccountStatus} */
  function readStatus(value) {
    const next = /** @type {Partial<AccountStatus>|null} */ (value);
    const knownPhase = next && typeof next.phase === 'string' && Object.hasOwn(labels, next.phase);
    const validRevision = next && Number.isSafeInteger(next.revision) && Number(next.revision) >= 0;
    const validText = next && typeof next.loginUrl === 'string' && next.loginUrl.length <= 4096
      && typeof next.message === 'string' && next.message.length <= 500;
    const validPersistence = next && typeof next.rememberLogin === 'boolean' && ['none','saving','saved','clearing','cleanup_required','error'].includes(String(next.persistenceState))
      && (next.persistenceErrorCode === null || ['codebuddy_store_unavailable','codebuddy_store_invalid','codebuddy_store_in_use'].includes(String(next.persistenceErrorCode)));
    if (!knownPhase || !validRevision || !validText || !validPersistence || typeof next?.browserOpened !== 'boolean' || typeof next?.busy !== 'boolean') {
      throw new Error('invalid_account_status');
    }
    return /** @type {AccountStatus} */ ({ ...next, loginUrl: next.phase === 'authenticating' ? next.loginUrl : '' });
  }

  function initialize() {
    const panel = document.getElementById('ai-codebuddy-settings');
    if (!panel || panel.dataset.initialized === 'true') return;
    panel.dataset.initialized = 'true';
    /** @param {string} name */
    const element = name => document.getElementById(`ai-codebuddy-${name}`);
    /** @param {string} name */
    const button = name => /** @type {HTMLButtonElement|null} */ (element(name));
    const urlField = /** @type {HTMLInputElement|null} */ (element('login-url'));
    const rememberField = /** @type {HTMLInputElement|null} */ (element('remember'));
    // 账户视图只属于当前窗口；销毁时释放轮询，取消或退出使所有旧请求失效。
    /** @type {AccountStatus} */
    let current = { phase:'signed_out', revision:-1, loginUrl:'', message:'正在读取 CodeBuddy 登录状态。', browserOpened:false, busy:false,rememberLogin:false,persistenceState:'none',persistenceErrorCode:null };
    let rememberChoice = false;
    let generation = 0;
    let sequence = 0;
    let acceptedSequence = 0;
    let disposed = false;
    let refreshing = false;
    let readFailed = false;
    /** @type {Action|undefined} */ let action;
    /** @type {'cancel'|'logout'|undefined} */ let cleanupPending;
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let readTimer;
    let notice = '';

    function stopPolling() { clearTimeout(timer); timer = undefined; }
    /** @param {boolean} [blocked] */
    function notifyAccount(blocked = false) {
      if (current.revision >= 0) scope.ShirohaPlatform?.harness?.codebuddyAccountChanged({revision:current.revision,phase:current.phase,blocked});
    }
    function pendingLogin() { return current.phase === 'authenticating' || current.phase === 'restoring' || action === 'login' || action === 'retry_restore'; }
    function pendingStorage() { return current.persistenceState === 'saving' || current.persistenceState === 'clearing'; }
    function storageBlocked() { return pendingStorage() || current.persistenceState === 'cleanup_required'; }
    function usableLink() { return !cleanupPending && current.phase === 'authenticating' && !!current.loginUrl; }
    function render() {
      if (!panel || disposed) return;
      const reading = refreshing && !pendingLogin();
      panel.dataset.phase = cleanupPending ? 'signed_out' : current.phase;
      panel.setAttribute('aria-busy', String(reading));
      const phase = element('phase');
      let phaseLabel = labels[current.phase];
      if (readFailed) phaseLabel = '读取失败';
      if (reading || current.revision < 0 && !readFailed) phaseLabel = '读取中';
      if (cleanupPending) phaseLabel = '正在确认登录已结束';
      if (current.persistenceState === 'cleanup_required') phaseLabel = '清理未完成';
      if (phase) phase.textContent = phaseLabel;
      const status = element('status');
      if (status) status.textContent = reading ? '正在读取 CodeBuddy 登录状态…' : notice || current.message;
      const awaitingLogin = pendingLogin();
      const signedIn = current.phase === 'signed_in' && !cleanupPending;
      const login = button('login');
      if (login) {
        login.hidden = awaitingLogin || signedIn;
        login.disabled = reading || readFailed || !!action || !!cleanupPending || current.busy || current.revision < 0 || current.persistenceState !== 'none';
      }
      const cancel = button('cancel');
      if (cancel) { cancel.hidden = !awaitingLogin && cleanupPending !== 'cancel'; cancel.disabled = action === 'cancel' || action === 'logout'; }
      const logout = button('logout');
      if (logout) { logout.hidden = !signedIn && current.phase !== 'restoring' && current.persistenceState === 'none' && cleanupPending !== 'logout'; logout.disabled = action === 'cancel' || action === 'logout'; }
      if (rememberField) { rememberField.checked = rememberChoice; rememberField.disabled = reading || readFailed || !!action || !!cleanupPending || current.busy || current.revision < 0 || (!signedIn && current.persistenceState !== 'none'); }
      const retryRestore = button('retry-restore');
      if (retryRestore) { retryRestore.hidden = !['failed','cancelled'].includes(current.phase) || current.persistenceState === 'cleanup_required'; retryRestore.disabled = reading || !!action || !!cleanupPending || current.busy; }
      const retrySave = button('retry-save');
      if (retrySave) { retrySave.hidden = !signedIn || current.persistenceState !== 'error'; retrySave.disabled = reading || !!action || current.busy; }
      const refresh = button('refresh');
      if (refresh) { refresh.disabled = !!action || refreshing || !!cleanupPending; refresh.textContent = readFailed ? '重新读取' : '刷新状态'; }
      const hasLink = usableLink();
      const details = element('details');
      if (details) details.hidden = !hasLink;
      if (urlField) urlField.value = hasLink ? current.loginUrl : '';
      const browser = element('browser-status');
      if (browser) browser.textContent = current.browserOpened ? '已在浏览器打开官方授权页，请完成个人账户登录。' : '尚未打开官方授权页，可以重新打开或复制登录链接。';
      for (const name of ['open-login', 'copy-link']) { const control = button(name); if (control) control.disabled = !hasLink || !!action; }
    }
    function observeLogin() {
      const shouldObserve = !disposed && (!cleanupPending || current.persistenceState === 'clearing') && !action && (pendingLogin() || pendingStorage());
      if (!shouldObserve) { stopPolling(); return; }
      if (timer !== undefined || refreshing) return;
      const epoch = generation;
      timer = setTimeout(() => {
        timer = undefined;
        if (epoch === generation && !disposed) void refreshStatus();
      }, pollIntervalMs);
    }
    /** @param {AccountStatus} next @param {number} requestSequence */
    function accept(next, requestSequence) {
      const stale = next.revision < current.revision || (next.revision === current.revision && requestSequence < acceptedSequence);
      if (stale) return false;
      acceptedSequence = Math.max(acceptedSequence, requestSequence);
      if (action || next.phase !== 'signed_out' || next.persistenceState !== 'none') rememberChoice = next.rememberLogin;
      current = next;
      const cleanupConfirmed = cleanupPending && !['signed_in','authenticating','restoring'].includes(next.phase) && next.persistenceState === 'none';
      if (cleanupConfirmed) cleanupPending = undefined;
      notice = '';
      return true;
    }
    async function refreshStatus() {
      if (disposed || action || refreshing || (cleanupPending && current.persistenceState !== 'clearing')) return;
      stopPolling();
      const epoch = generation;
      const requestSequence = ++sequence;
      refreshing = true; readFailed = false;
      if (!pendingLogin()) notifyAccount(true);
      render();
      try {
        const result = await Promise.race([host?.invoke('codebuddy_control', { request:{ kind:'status' } }), new Promise((_, reject) => { readTimer = setTimeout(() => reject(new Error('status_timeout')), statusTimeoutMs); })]);
        if (epoch !== generation || disposed) return;
        if (accept(readStatus(result), requestSequence)) notifyAccount(!!cleanupPending || storageBlocked());
      } catch {
        if (epoch === generation && !disposed) { readFailed = true; notice = '暂时无法读取 CodeBuddy 登录状态，请重新读取。'; notifyAccount(true); }
      } finally {
        if (epoch === generation) { clearTimeout(readTimer); readTimer = undefined; }
        if (epoch === generation && !disposed) { refreshing = false; render(); observeLogin(); }
      }
    }
    /** @param {Action} kind */
    function canPerform(kind) {
      if (disposed) return false;
      if ((refreshing || readFailed) && kind !== 'cancel' && kind !== 'logout') return false;
      if (kind === 'cancel') return (pendingLogin() || cleanupPending === 'cancel') && action !== 'cancel' && action !== 'logout';
      if (kind === 'logout') return (current.phase === 'signed_in' || current.phase === 'restoring' || current.persistenceState !== 'none' || cleanupPending === 'logout') && action !== 'cancel' && action !== 'logout';
      if (action || cleanupPending) return false;
      if (kind === 'open_login') return usableLink();
      if (kind === 'set_remember') return current.phase === 'signed_in' && !current.busy;
      if (kind === 'retry_restore') return ['failed','cancelled'].includes(current.phase) && !current.busy;
      return current.revision >= 0 && !current.busy && !pendingLogin() && current.phase !== 'signed_in' && current.persistenceState === 'none';
    }
    /** @param {Action} kind */
    async function perform(kind) {
      if (!canPerform(kind)) return;
      // 登录绑定用户此刻看到的状态，原生端可拒绝排在取消或退出之后才开始的旧请求。
      let request;
      if (kind === 'login' || kind === 'set_remember') request = { kind, revision:current.revision, remember:rememberChoice };
      else if (kind === 'retry_restore') request = { kind, revision:current.revision };
      else request = { kind };
      const epoch = ++generation;
      const requestSequence = ++sequence;
      stopPolling(); clearTimeout(readTimer); readTimer = undefined; refreshing = false; action = kind;
      const endingLogin = kind === 'cancel' || kind === 'logout';
      if (endingLogin) cleanupPending = kind;
      if (kind !== 'open_login') notifyAccount(true);
      const progress = { login:'正在启动 CodeBuddy 官方登录。', open_login:'正在打开官方授权页。', cancel:'正在取消 CodeBuddy 登录。', logout:'正在退出 CodeBuddy 登录。',set_remember:'正在更新登录保存设置。',retry_restore:'正在重新核验已保存的登录。' };
      notice = progress[kind]; render();
      try {
        const result = await host?.invoke('codebuddy_control', { request });
        if (epoch !== generation || disposed) return;
        const next = readStatus(result);
        const stillAuthorized = next.phase === 'signed_in' || next.phase === 'authenticating' || next.phase === 'restoring';
        if (endingLogin && (stillAuthorized || next.revision < current.revision)) throw new Error('cleanup_unconfirmed');
        if (accept(next, requestSequence)) {
          if (endingLogin && !['clearing','cleanup_required'].includes(next.persistenceState)) cleanupPending = undefined;
          notifyAccount(!!cleanupPending || storageBlocked());
        }
      } catch {
        if (epoch !== generation || disposed) return;
        // 清理失败时查询不能重新启用旧授权；必须明确重试取消或退出。
        if (kind === 'logout') notice = '退出登录尚未完成，请重试退出登录。';
        else if (kind === 'cancel') notice = '取消登录尚未完成，请重试取消登录。';
        else if (kind === 'open_login') notice = '无法打开授权页，请重试或复制登录链接。';
        else if (kind === 'set_remember') { rememberChoice = current.rememberLogin; notice = '无法更新登录保存设置，请重试。'; }
        else if (kind === 'retry_restore') notice = '无法恢复登录，请重试或退出清理。';
        else notice = '无法启动 CodeBuddy 登录，请刷新状态后重试。';
      } finally {
        if (epoch === generation && !disposed) { action = undefined; render(); observeLogin(); }
      }
    }
    async function copyLink() {
      if (!usableLink() || action || disposed) return;
      const epoch = generation;
      const link = current.loginUrl;
      try {
        await navigator.clipboard.writeText(link);
        if (epoch === generation && current.loginUrl === link && !disposed) notice = '登录链接已复制，请在浏览器中打开。';
      } catch {
        if (epoch === generation && !disposed) notice = '无法复制链接，请选中上方登录地址后手动复制。';
      }
      render();
    }
    /** @type {Array<[string,Action]>} */
    const actions = [['login','login'], ['open-login','open_login'], ['cancel','cancel'], ['logout','logout']];
    for (const [name, kind] of actions) button(name)?.addEventListener('click', () => { void perform(kind); });
    button('refresh')?.addEventListener('click', () => { void refreshStatus(); });
    button('copy-link')?.addEventListener('click', () => { void copyLink(); });
    rememberField?.addEventListener('change', () => { rememberChoice = rememberField.checked; if (current.phase === 'signed_in') void perform('set_remember'); });
    button('retry-restore')?.addEventListener('click', () => { void perform('retry_restore'); });
    button('retry-save')?.addEventListener('click', () => { rememberChoice = true; void perform('set_remember'); });
    document.addEventListener('shiroha-codebuddy-account-refresh', () => { void refreshStatus(); });
    scope.addEventListener('pagehide', () => { disposed = true; generation++; stopPolling(); clearTimeout(readTimer); readTimer = undefined; }, { once:true });
    render();
    void refreshStatus();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once:true });
  else initialize();
})();
