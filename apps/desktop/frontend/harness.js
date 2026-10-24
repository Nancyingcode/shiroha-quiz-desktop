// @ts-check
(function () {
  'use strict';
  /** @typedef {import('../../web/platform/runtime').HarnessStatus} HarnessStatus */
  /** @typedef {import('../../web/platform/runtime').HarnessApi} HarnessApi */
  const scope = /** @type {typeof globalThis & import('../../web/platform/runtime').BrowserGlobals & {ShirohaDesktopHost?:{invoke<T>(command:string,args?:Record<string,unknown>):Promise<T>}}} */ (globalThis);
  if (!scope.ShirohaDesktopHost || !scope.ShirohaPlatform) return;
  // 配置和在途请求归当前窗口，修订与 generation 共同阻止取消或恢复后的迟到结果。
  /** @type {HarnessStatus} */
  let current = { mode:'api',adapter:'codex',model:'',timeoutSeconds:120,credentialStatus:'missing',runtimePath:'',runtimeVersion:'',runtimeSource:'managed',runtimeState:'unprepared',runtimeReceivedBytes:0,runtimeTotalBytes:0,ready:false,reason:'尚未准备',revision:0,busy:false };
  let generation = 0;
  // 查询序号处理同修订的 busy 变化；变更屏障使跨越配置操作的查询失效。
  let requestSequence = 0;
  let acceptedSequence = 0;
  let observationEpoch = 0;
  let pendingMutations = 0;
  // 退出失败后必须重试清理；普通查询不能用旧授权重新启用当前窗口。
  let authorizationBlock = '';
  // 准备与登录属于当前窗口的设置流程；取消、恢复和切换模式会废弃尚未继续的步骤。
  let setupGeneration = 0;
  let automaticPreparationAttempted = false;
  let loginInProgress = false;
  /** @type {Promise<void>|undefined} */ let preparation;
  /** @type {'prepare_runtime'|'use_managed_runtime'|undefined} */ let preparationKind;
  /** @type {((error?:Error)=>void)|undefined} */ let preparationCheck;
  // 轮询只观察已启动的准备或登录；退出、取消或终态会释放当前窗口的计时器。
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let authTimer;
  /** @type {Map<string,Promise<void>>} */ const active = new Map();
  let changed = () => {};
  let businessBusy = () => false;
  /** @param {string} id */
  const element = id => document.getElementById(id);
  /** @param {string} id */
  const input = id => /** @type {HTMLInputElement|null} */ (element(id));
  /** @param {unknown} error */
  function failure(error) {
    const source = error && typeof error === 'object' ? /** @type {{code?:string;message?:string}} */ (error) : {};
    const result = Object.assign(new Error(source.message || 'Harness 操作失败，请检查配置后重试。'), { code:source.code || 'harness_unavailable' });
    if (result.code === 'cancelled') result.name = 'AbortError';
    return result;
  }
  function cancelled() { return failure({code:'cancelled',message:'AI 请求已取消。'}); }
  /** @param {string} command @param {Record<string,unknown>} request @returns {Promise<unknown>} */
  async function invoke(command, request) {
    try { return await scope.ShirohaDesktopHost?.invoke(command, {request}); }
    catch (error) { throw failure(error); }
  }
  /** @param {Record<string,unknown>} request */
  async function control(request) {
    const epoch = generation;
    const sequence = ++requestSequence;
    const observation = observationEpoch;
    const query = request.kind === 'status';
    if (!query) { observationEpoch++; pendingMutations++; }
    /** @type {HarnessStatus} */ let next;
    try { next = /** @type {HarnessStatus} */ (await invoke('harness_control', request)); }
    finally { if (!query) { pendingMutations--; observationEpoch++; } }
    if (epoch !== generation) return current;
    if (query && (observation !== observationEpoch || pendingMutations)) return current;
    if (!next || !['api','harness'].includes(next.mode) || !Number.isSafeInteger(next.revision) || typeof next.ready !== 'boolean') throw new Error('Harness 状态格式无效，请重新打开应用后检测。');
    // 同一页面生命周期内，较早的查询也可能晚于登录或保存返回，不能让授权状态倒退。
    if (next.revision < current.revision || (next.revision === current.revision && sequence < acceptedSequence)) return current;
    if (request.kind === 'logout' || request.kind === 'clear') {
      if (next.credentialStatus !== 'missing') throw new Error('订阅授权清理尚未确认，请重试退出登录。');
      authorizationBlock = '';
    }
    acceptedSequence = Math.max(acceptedSequence, sequence);
    current = {...next};
    if (current.credentialStatus !== 'subscription') current.ready = false;
    protectAuthorization();
    preparationCheck?.();
    observeAuthorization();
    return current;
  }
  function protectAuthorization() {
    if (authorizationBlock) current = {...current,ready:false,credentialStatus:'missing',loginUrl:undefined,userCode:undefined,reason:authorizationBlock};
  }
  function invalidateSetup() {
    setupGeneration++;
    loginInProgress = false;
    preparationCheck?.(cancelled());
    preparationCheck = undefined;
    preparation = undefined;
    preparationKind = undefined;
  }
  /** @param {'prepare_runtime'|'use_managed_runtime'} [kind] @returns {Promise<void>} */
  function ensurePrepared(kind = 'prepare_runtime') {
    if (preparation) return preparation;
    if (kind === 'prepare_runtime' && current.runtimeState === 'ready' && !current.busy) return Promise.resolve();
    if (current.runtimeState !== 'preparing') assertIdle();
    const epoch = generation;
    const operation = (async()=>{
      if (current.runtimeState !== 'preparing' || kind === 'use_managed_runtime') await control({kind});
      if (epoch !== generation) throw cancelled();
      render(false); changed();
      await new Promise((resolve,reject)=>{
        preparationCheck = error => {
          if (error || epoch !== generation) { reject(error || cancelled()); return; }
          if (current.runtimeState === 'preparing' || (current.runtimeState === 'ready' && current.busy)) { observeAuthorization(); return; }
          if (current.runtimeState === 'ready') resolve(undefined);
          else reject(failure({code:current.runtimeState === 'cancelled' ? 'cancelled' : 'harness_unavailable',message:current.reason || 'Codex 组件尚未准备完成，请重试准备。'}));
        };
        preparationCheck();
      });
    })();
    const pending = operation.finally(()=>{
      if (preparation === pending) { preparation = undefined; preparationKind = undefined; preparationCheck = undefined; }
    });
    preparation = pending;
    preparationKind = kind;
    render(false); changed();
    return pending;
  }
  function activateRuntime() {
    const canActivate = ['unprepared','ready'].includes(current.runtimeState) && !current.busy && !preparation && !pendingMutations && !businessBusy();
    if (api.formMode() !== 'harness' || automaticPreparationAttempted || !canActivate) return;
    automaticPreparationAttempted = true;
    void uiAction(async()=>{
      if (current.runtimeState === 'unprepared') await ensurePrepared();
      else await control({kind:'inspect'});
    });
  }
  async function refreshStatus() {
    const epoch = generation;
    await control({kind:'status'});
    const canInspect = current.runtimeState === 'ready' && !current.busy && !pendingMutations && !active.size && !preparation && !businessBusy();
    if (epoch === generation && canInspect && !authorizationBlock && current.credentialStatus !== 'authenticating') await control({kind:'inspect'});
  }
  async function loginSubscription() {
    if (loginInProgress) return;
    if (authorizationBlock) throw new Error(authorizationBlock);
    const epoch = setupGeneration;
    loginInProgress = true;
    render(false);
    try {
      await ensurePrepared();
      if (epoch !== setupGeneration) throw cancelled();
      await api.saveMode('harness');
      if (epoch !== setupGeneration) throw cancelled();
      if (current.credentialStatus !== 'subscription') await control({kind:'login'});
    } finally { if (epoch === setupGeneration) loginInProgress = false; }
  }
  /** @param {number} epoch */
  async function refreshAfterExecution(epoch) {
    if (epoch !== generation) return;
    try { await control({kind:'status'}); }
    catch (error) {
      if (epoch !== generation) return;
      // 未确认进程终态时保持阻塞，并使此前所有查询失效，直到用户重新查询或停止。
      observationEpoch++;
      current = {...current,ready:false,busy:true,reason:'无法确认 Codex 任务状态，请刷新状态或重试停止。' + failure(error).message};
      protectAuthorization();
    }
  }
  /** @param {'logout'|'clear'} kind */
  async function endAuthorization(kind) {
    invalidateSetup();
    generation++;
    clearTimeout(authTimer); authTimer = undefined;
    authorizationBlock = '正在清理订阅授权，当前授权已停用。';
    protectAuthorization(); render(false); changed();
    try {
      if (kind === 'logout') await api.cancelAll();
      await control({kind});
      generation++;
    } catch (error) {
      authorizationBlock = '退出登录尚未完成，当前授权已停用，请重试退出登录。';
      try { await control({kind:'status'}); }
      catch { observationEpoch++; current = {...current,busy:true}; }
      protectAuthorization();
      throw error;
    } finally { render(false); changed(); }
  }
  function observeAuthorization() {
    const observing = current.credentialStatus === 'authenticating' || current.runtimeState === 'preparing' || !!(preparationCheck && current.busy);
    if (!observing) { clearTimeout(authTimer); authTimer = undefined; return; }
    if (authTimer !== undefined) return;
    const epoch = generation;
    authTimer = setTimeout(async()=>{
      authTimer = undefined;
      if (epoch !== generation) return;
      try { await control({kind:'status'}); render(false); changed(); }
      catch (error) { preparationCheck?.(failure(error)); notice(failure(error).message,true); }
    },1000);
  }
  /** @param {string} message @param {boolean} [error] */
  function notice(message, error = false) {
    const target = element('ai-harness-status');
    if (target) { target.textContent = message; target.className = 'notice' + (error ? ' warn' : ''); }
  }
  function assertIdle() {
    if (active.size || current.busy || pendingMutations || businessBusy()) throw failure({code:'busy',message:'AI 任务仍在执行或停止中，请等待结束后保存设置。'});
  }
  /** @param {boolean} [reset] */
  function render(reset = true) {
    const section = element('ai-execution-settings');
    if (!section) return;
    section.hidden = false;
    if (reset) {
      const selected = input('ai-execution-' + current.mode);
      if (selected) selected.checked = true;
      const model = input('ai-harness-model'); if (model) model.value = current.model || 'gpt-6.1-sol';
      const timeout = input('ai-harness-timeout'); if (timeout) timeout.value = String(current.timeoutSeconds);
    }
    const mode = api.formMode();
    const apiFields = element('ai-api-settings-fields'); if (apiFields) apiFields.hidden = mode === 'harness';
    const panel = element('ai-harness-settings'); if (panel) panel.hidden = mode !== 'harness';
    const diagnostic = element('ai-toggle-diagnostics-v375'); if (diagnostic) diagnostic.hidden = mode === 'harness';
    if (mode === 'harness') { const existing = element('ai-diagnostics-v375'); existing?.classList.add('ai-hidden-v99'); }
    const preparing = current.runtimeState === 'preparing' || !!preparation;
    const runtimeLabels = {unprepared:'尚未准备',preparing:'组件准备中',ready:'组件已就绪',failed:'组件准备失败',cancelled:'组件准备已取消'};
    const showingManaged = current.runtimeSource === 'managed' || preparationKind === 'use_managed_runtime';
    const runtimeStatus = element('ai-harness-runtime-status'); if (runtimeStatus) runtimeStatus.textContent = (showingManaged ? '自动管理 · ' : '自定义程序 · ') + runtimeLabels[preparing ? 'preparing' : current.runtimeState];
    const progress = element('ai-harness-runtime-progress');
    if (progress) {
      const received = Math.max(0,current.runtimeReceivedBytes || 0).toLocaleString('zh-CN');
      const total = Math.max(0,current.runtimeTotalBytes || 0).toLocaleString('zh-CN');
      progress.textContent = current.runtimeTotalBytes > 0 ? `${received} / ${total} 字节` : `已接收 ${received} 字节`;
      progress.hidden = !preparing || (!current.runtimeReceivedBytes && !current.runtimeTotalBytes);
    }
    for (const id of ['ai-harness-prepare','ai-harness-use-managed','ai-harness-choose','ai-harness-inspect']) { const button = input(id); if (button) button.disabled = preparing || current.busy || loginInProgress; }
    const prepareButton = input('ai-harness-prepare'); if (prepareButton) prepareButton.hidden = preparing || current.runtimeState === 'ready';
    const cancelPrepare = input('ai-harness-prepare-cancel'); if (cancelPrepare) cancelPrepare.hidden = !preparing;
    const loginButton = input('ai-harness-login'); if (loginButton) loginButton.disabled = loginInProgress || current.credentialStatus === 'authenticating';
    for (const id of ['ai-harness-model','ai-harness-timeout','ai-save-settings-v99']) { const field = input(id); if (field) field.disabled = loginInProgress || preparing; }
    const path = element('ai-harness-runtime'); if (path) path.textContent = current.runtimePath || '组件准备后由应用管理';
    const version = element('ai-harness-version'); if (version) version.textContent = current.runtimeVersion || '未检测';
    const authorization = element('ai-harness-auth-status');
    if (authorization) {
      let label = '尚未登录订阅';
      if (current.credentialStatus === 'subscription') label = '订阅已登录，请测试模型访问';
      else if (current.credentialStatus === 'authenticating') label = '等待完成订阅登录，状态自动刷新中';
      authorization.textContent = label;
    }
    const login = element('ai-harness-login-details'); if (login) login.hidden = !current.loginUrl;
    const url = element('ai-harness-login-url'); if (url) url.textContent = current.loginUrl || '';
    const code = element('ai-harness-login-code'); if (code) code.textContent = current.userCode || '此流程无需输入验证码';
    const description = element('ai-settings-status-v99');
    if (description) description.textContent = mode === 'harness' ? 'Codex 组件由应用准备。点击“登录订阅”会自动保存 Harness 设置，再启动官方授权；模型测试由你主动执行。' : '直接 API 设置与 Harness 分别保存，切换执行方式须点击“保存设置”。';
    notice((current.ready ? 'Codex 已就绪。' : current.reason || '完成组件准备后，点击“登录订阅”即可。') + (mode !== current.mode ? ' 执行方式尚未保存。' : ''));
  }
  /** @param {()=>Promise<void>} action */
  async function uiAction(action) {
    try { await action(); render(false); changed(); }
    catch (error) { render(false); changed(); notice(failure(error).message, true); }
  }
  /** @type {HarnessApi} */
  const api = {
    async initialize() {
      invalidateSetup();
      // 恢复后的重读只更新状态，不把仍可见的设置页当成用户再次进入。
      automaticPreparationAttempted = generation > 0;
      generation++;
      clearTimeout(authTimer); authTimer = undefined;
      try { await control({kind:'status'}); }
      catch (error) { current = {...current,mode:'harness',ready:false,reason:failure(error).message}; }
    },
    status() { return {...current,busy:current.busy || active.size > 0 || pendingMutations > 0 || !!preparation}; },
    snapshot() { return Object.freeze({...current}); },
    async execute(snapshot, task, messages, signal) {
      if (signal?.aborted) throw cancelled();
      if (active.size || current.busy || pendingMutations) throw failure({code:'busy',message:'Codex 正在执行或停止任务，请等待结束后重试。'});
      if (snapshot.revision !== current.revision) throw failure({code:'configuration_changed',message:'AI 执行配置已变化，请重新开始本次任务。'});
      if (snapshot.mode !== 'harness' || !snapshot.ready || !current.ready) throw failure({code:'harness_unavailable',message:current.reason || snapshot.reason || 'Codex 尚未就绪，请先检查 AI 设置。'});
      const id = scope.crypto.randomUUID();
      const epoch = generation;
      let stopped = false;
      /** @type {Promise<unknown>|undefined} */ let stopping;
      const abort = () => { stopped = true; stopping = control({kind:'cancel',id}).catch(() => undefined); };
      let finished = () => {};
      active.set(id,new Promise(resolve => { finished = resolve; }));
      signal?.addEventListener('abort',abort,{once:true});
      try {
        /** @type {{content:string}} */ let result;
        try {
          result = /** @type {{content:string}} */ (await invoke('harness_execute',{id,revision:snapshot.revision,task,messages}));
        } finally {
          const pendingStop = stopping;
          await pendingStop;
          await refreshAfterExecution(epoch);
          // 用户也能在终态查询期间取消；这次停止完成前的查询不能作为最终状态。
          if (stopping !== pendingStop) { await stopping; await refreshAfterExecution(epoch); }
        }
        if (stopped || signal?.aborted || epoch !== generation) throw cancelled();
        if (snapshot.revision !== current.revision) throw failure({code:'configuration_changed',message:'AI 配置已变化，旧结果已丢弃。'});
        if (!result || typeof result.content !== 'string' || !result.content.trim()) throw failure({code:'invalid_response',message:'Codex 没有返回有效内容。'});
        return {content:result.content};
      } catch (error) {
        await stopping;
        if (stopped || signal?.aborted || epoch !== generation) throw cancelled();
        throw error;
      } finally { signal?.removeEventListener('abort',abort); active.delete(id); finished(); render(false); changed(); }
    },
    async cancelAll() { invalidateSetup(); generation++; clearTimeout(authTimer); authTimer = undefined; const pending = [...active.values()]; await control({kind:'cancel_all'}); await Promise.all(pending); },
    formMode() { return input('ai-execution-harness')?.checked ? 'harness' : 'api'; },
    async saveMode(mode) {
      assertIdle();
      const model = mode === 'harness' ? input('ai-harness-model')?.value.trim() || current.model || 'gpt-6.1-sol' : current.model;
      const timeoutSeconds = mode === 'harness' ? Number(input('ai-harness-timeout')?.value || 120) : current.timeoutSeconds;
      if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 600) throw new Error('任务超时须为 10 至 600 秒的整数。');
      const epoch = generation;
      await control({kind:'save',mode,adapter:'codex',model,timeoutSeconds,revision:current.revision});
      if (epoch !== generation) throw cancelled();
      generation++;
      clearTimeout(authTimer); authTimer = undefined; observeAuthorization();
      render(); changed();
    },
    async clear() { if(active.size || current.busy)throw new Error('正在停止 Codex 任务，请等待结束后清除配置。'); await endAuthorization('clear'); render(); },
    async test() {
      if (api.formMode() !== current.mode) throw new Error('请先保存当前执行方式，再测试执行。');
      if ((input('ai-harness-model')?.value.trim() || '') !== current.model || Number(input('ai-harness-timeout')?.value || 120) !== current.timeoutSeconds) throw new Error('配置草稿尚未保存，请先保存后再测试。');
      notice('正在执行固定测试任务，将使用当前订阅额度……');
      try {
        const result = await api.execute(api.snapshot(),'connection_test',[{role:'system',content:'只回复一个 JSON 对象。'},{role:'user',content:'回复 {"ok":true}'}]);
        let value; try { value = JSON.parse(result.content); } catch { throw new Error('Codex 返回的测试结果不是有效 JSON。'); }
        if (!value || value.ok !== true) throw new Error('Codex 测试结果校验失败。');
        notice('测试执行成功，结果已通过校验。');
      } catch (error) {
        notice(failure(error).message,true);
        throw error;
      }
    },
    render() { render(); if (element('ai-settings')?.classList.contains('active')) activateRuntime(); },
    bind(onChanged,isBusy) {
      changed = onChanged; businessBusy = isBusy;
      for (const mode of ['api','harness']) {
        const radio = input('ai-execution-' + mode);
        if (radio) radio.onchange = () => {
          render(false);
          if (mode === 'harness') { automaticPreparationAttempted = false; activateRuntime(); }
          else if (preparation || loginInProgress || current.runtimeState === 'preparing' || current.credentialStatus === 'authenticating') void uiAction(()=>api.cancelAll());
        };
      }
      const prepare = element('ai-harness-prepare'); if (prepare) prepare.onclick = () => { void uiAction(()=>ensurePrepared()); };
      const cancelPrepare = element('ai-harness-prepare-cancel'); if (cancelPrepare) cancelPrepare.onclick = () => { void uiAction(()=>api.cancelAll()); };
      const managed = element('ai-harness-use-managed'); if (managed) managed.onclick = () => { void uiAction(()=>ensurePrepared('use_managed_runtime')); };
      const choose = element('ai-harness-choose'); if (choose) choose.onclick = () => { void uiAction(async()=>{assertIdle();await control({kind:'choose_runtime'});}); };
      const inspect = element('ai-harness-inspect'); if (inspect) inspect.onclick = () => { void uiAction(async()=>{assertIdle();await control({kind:'inspect'});}); };
      const login = element('ai-harness-login'); if (login) login.onclick = () => { void uiAction(loginSubscription); };
      const refresh = element('ai-harness-auth-refresh'); if (refresh) refresh.onclick = () => { void uiAction(refreshStatus); };
      const logout = element('ai-harness-logout'); if (logout) logout.onclick = () => { void uiAction(()=>endAuthorization('logout')); };
      for (const [id,field] of [['ai-harness-copy-url','loginUrl'],['ai-harness-copy-code','userCode']]) {
        const copy = element(id);
        if (copy) copy.onclick = () => { const value = field === 'loginUrl' ? current.loginUrl : current.userCode; if(value)void navigator.clipboard.writeText(value).then(()=>notice('已复制，请在浏览器中自行完成官方订阅登录。'),()=>notice('复制失败，请选择登录信息手动复制。',true)); };
      }
      const stop = element('ai-harness-stop'); if (stop) stop.onclick = () => { void uiAction(()=>api.cancelAll()); };
      render();
    },
  };
  scope.ShirohaPlatform.harness = api;
})();
