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
  // 账户卡片只报告失效边界；可执行状态仍由原生查询确认，不影响其他提供方的任务。
  /** @type {{revision:number,phase:string,blocked:boolean}|undefined} */ let codebuddyAccount;
  let accountEpoch = 0;
  // 准备与登录属于当前窗口的设置流程；取消、恢复和切换模式会废弃尚未继续的步骤。
  let setupGeneration = 0;
  const automaticPreparationAttempts = new Set();
  const statusTimeoutMs = 15000;
  let settingsLoading = true;
  let settingsFailure = '';
  // 账户读取属于当前窗口；切换使旧响应失效，重新初始化和主动刷新可重试。
  let codexReading = false;
  let codexAccountConfirmed = false;
  let codexReadFailure = '';
  let codexReadSequence = 0;
  let loginInProgress = false;
  // 提供方草稿属于当前窗口；保存失败仍阻断旧执行器，直到明确重试或保存另一选择。
  /** @type {string|undefined} */ let draftAdapter;
  let selectingAdapter = false;
  let selectionSequence = 0;
  let selectionFailure = '';
  let failedAdapter = '';
  // 模型草稿只属于 CodeBuddy；保存失败须保留到重试或重新初始化，不能用旧模型继续执行。
  /** @type {string|undefined} */ let draftModel;
  let selectingModel = false;
  let modelSelectionSequence = 0;
  let modelSelectionFailure = '';
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
  const adapters = ['codex','codebuddy','deepseek'];
  const codebuddyModels = ['deepseek-v4.1-flash','hy4-preview','hy3','default'];
  // 只有原生已定义的固定标识可进入文案，未知代码不能成为动态诊断输出。
  const codebuddyDiagnosticCodes = new Set([
    'codebuddy_account_stale','codebuddy_auth_cancelled','codebuddy_auth_challenge','codebuddy_auth_expired',
    'codebuddy_auth_network','codebuddy_auth_personal_required','codebuddy_auth_required','codebuddy_auth_response',
    'codebuddy_auth_session','codebuddy_auth_state','codebuddy_auth_timeout','codebuddy_auth_token_domain',
    'codebuddy_auth_token_expiry','codebuddy_auth_token_shape','codebuddy_auth_url','codebuddy_business_json',
    'codebuddy_business_limit','codebuddy_connection_result','codebuddy_analysis_result','codebuddy_followup_result',
    'codebuddy_candidate_rejected','codebuddy_cleanup_failed','codebuddy_cli_finished','codebuddy_config_invalid',
    'codebuddy_container_required','codebuddy_frame_invalid','codebuddy_isolation_failed','codebuddy_login_browser',
    'codebuddy_login_busy','codebuddy_login_not_pending','codebuddy_login_not_ready','codebuddy_login_stale',
    'codebuddy_login_unavailable','codebuddy_login_unsupported','codebuddy_login_url','codebuddy_model_already_requested',
    'codebuddy_output_invalid','codebuddy_pipe_closed','codebuddy_profile_cleanup_failed','codebuddy_relay_io_failed',
    'codebuddy_relay_peer_closed','codebuddy_relay_start_failed','codebuddy_request_budget','codebuddy_request_denied',
    'codebuddy_runtime_busy','codebuddy_runtime_download','codebuddy_runtime_integrity','codebuddy_runtime_proxy',
    'codebuddy_runtime_proxy_config','codebuddy_runtime_redirect','codebuddy_runtime_storage','codebuddy_runtime_unavailable',
    'codebuddy_upstream_content_filter','codebuddy_upstream_incomplete','codebuddy_upstream_length',
    'codebuddy_upstream_tool_call','codebuddy_upstream_unknown_field','codebuddy_upstream_unverified',
    'codebuddy_worker_environment','codebuddy_worker_failed','codebuddy_worker_path',
  ]);
  function operationBusy() { return current.operationBusy ?? current.busy; }
  function selectedAdapter() { return draftAdapter ?? current.adapter; }
  function codexSelected() { return current.adapter === 'codex' && selectedAdapter() === 'codex' && draftAdapter === undefined && !selectingAdapter; }
  function modelSelectionPending() { return current.adapter === 'codebuddy' && draftModel !== undefined; }
  function supportedSelection() { return ['codex','codebuddy'].includes(current.adapter) && selectedAdapter() === current.adapter && draftAdapter === undefined && !selectingAdapter && !modelSelectionPending(); }
  function providerLabel() { return current.adapter === 'codebuddy' ? 'CodeBuddy' : 'Codex'; }
  function selectionReason() { return selectionFailure || '正在保存 Harness 提供方选择，请等待完成。'; }
  function modelSelectionReason() { return modelSelectionFailure || '正在保存 CodeBuddy 模型选择，请等待完成。'; }
  /** @param {string} adapter */
  function unavailableReason(adapter) { return adapter === 'codebuddy' ? '请准备 CodeBuddy 组件并完成个人账户登录，再使用连接测试、单题解析和追问。' : 'DeepSeek 订阅尚未接入，模型执行尚未开放。'; }
  function assertSupported() {
    if (modelSelectionPending()) throw failure({code:'harness_unavailable',message:modelSelectionReason()});
    if (!supportedSelection()) throw failure({code:'harness_unavailable',message:draftAdapter !== undefined ? selectionReason() : unavailableReason(selectedAdapter())});
  }
  function assertCodex() {
    if (!codexSelected()) throw failure({code:'harness_unavailable',message:draftAdapter !== undefined ? selectionReason() : unavailableReason(selectedAdapter())});
  }
  /** @param {unknown} error */
  function failure(error) {
    const source = error && typeof error === 'object' ? /** @type {{code?:string;message?:string}} */ (error) : {};
    const code = typeof source.code === 'string' && source.code ? source.code : 'harness_unavailable';
    let message = typeof source.message === 'string' && source.message ? source.message : 'Harness 操作失败，请检查配置后重试。';
    if (codebuddyDiagnosticCodes.has(code)) {
      const diagnostic = `（诊断码：${code}）`;
      if (!message.endsWith(diagnostic)) message += diagnostic;
    }
    const result = Object.assign(new Error(message), { code });
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
    const codexOperation = ['use_managed_runtime','choose_runtime','inspect','login','logout','clear'].includes(String(request.kind));
    if (codexOperation) assertCodex();
    if (['prepare_runtime','cancel'].includes(String(request.kind))) assertSupported();
    const epoch = generation;
    const sequence = ++requestSequence;
    const observation = observationEpoch;
    const accountObservation = accountEpoch;
    const query = request.kind === 'status';
    const observing = query || request.kind === 'inspect';
    if (!observing) { observationEpoch++; pendingMutations++; }
    /** @type {HarnessStatus} */ let next;
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let timeout;
    try {
      const pending = invoke('harness_control', request);
      const response = observing ? await Promise.race([pending,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('状态读取超时，请重新读取。')),statusTimeoutMs);})]) : await pending;
      next = /** @type {HarnessStatus} */ (response);
    } finally { clearTimeout(timeout); if (!observing) { pendingMutations--; observationEpoch++; } }
    if (epoch !== generation) return current;
    if (query && (observation !== observationEpoch || pendingMutations)) return current;
    if (query && current.adapter === 'codebuddy' && accountObservation !== accountEpoch) return current;
    if (!next || !['api','harness'].includes(next.mode) || !adapters.includes(next.adapter) || !Number.isSafeInteger(next.revision) || typeof next.ready !== 'boolean') throw new Error('Harness 状态格式无效，请重新打开应用后检测。');
    // 同一页面生命周期内，较早的查询也可能晚于登录或保存返回，不能让授权状态倒退。
    if (next.revision < current.revision || (next.revision === current.revision && sequence < acceptedSequence)) return current;
    if (next.adapter === 'codebuddy' && current.adapter === 'codebuddy' && next.accountRevision !== undefined && current.accountRevision !== undefined && next.accountRevision < current.accountRevision) return current;
    if (request.kind === 'logout' || request.kind === 'clear') {
      if (next.credentialStatus !== 'missing') throw new Error('订阅授权清理尚未确认，请重试退出登录。');
      authorizationBlock = '';
    }
    acceptedSequence = Math.max(acceptedSequence, sequence);
    const accountChanged = next.adapter === 'codebuddy' && (next.accountRevision !== current.accountRevision || next.credentialStatus !== current.credentialStatus);
    current = {...next};
    if (current.adapter === 'codex' && ['inspect','login','logout','clear','save'].includes(String(request.kind))) codexAccountConfirmed = true;
    if (!['codex','codebuddy'].includes(current.adapter) || current.credentialStatus !== 'subscription') current.ready = false;
    protectAuthorization();
    preparationCheck?.();
    observeAuthorization();
    if (accountChanged) document.dispatchEvent?.(new Event('shiroha-codebuddy-account-refresh'));
    return current;
  }
  function protectAuthorization() {
    if (current.adapter === 'codex' && authorizationBlock) current = {...current,ready:false,credentialStatus:'missing',loginUrl:undefined,userCode:undefined,reason:authorizationBlock};
    if (current.adapter === 'codebuddy') {
      const invalidRevision = !Number.isSafeInteger(current.accountRevision) || Number(current.accountRevision) < 0;
      const blockedAccount = codebuddyAccount && (codebuddyAccount.blocked || codebuddyAccount.phase !== 'signed_in' || Number(current.accountRevision) < codebuddyAccount.revision);
      if ((invalidRevision || blockedAccount) && current.runtimeState === 'ready') current = {...current,ready:false,reason:'CodeBuddy 账户状态尚未确认，请完成登录或退出后刷新状态。'};
    }
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
    try { if (kind === 'use_managed_runtime') assertCodex(); else assertSupported(); } catch (error) { return Promise.reject(error); }
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
          else reject(failure({code:current.runtimeState === 'cancelled' ? 'cancelled' : 'harness_unavailable',message:current.reason || `${providerLabel()} 组件尚未准备完成，请重试准备。`}));
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
    const needsAccountRead = codexSelected() && current.runtimeState === 'ready' && !codexAccountConfirmed && !codexReading && !codexReadFailure;
    if (!supportedSelection() || api.formMode() !== 'harness' || (automaticPreparationAttempts.has(current.adapter) && !needsAccountRead) || !canActivate) return;
    automaticPreparationAttempts.add(current.adapter);
    void uiAction(async()=>{
      if (current.runtimeState === 'unprepared') await ensurePrepared();
      if (codexSelected() && !loginInProgress) await refreshStatus(true);
    });
  }
  /** @param {boolean} [skipQuery] */
  async function refreshStatus(skipQuery = false) {
    const epoch = generation;
    const sequence = ++codexReadSequence;
    codexReading = codexSelected(); codexReadFailure = ''; codexAccountConfirmed = false; render(false); changed();
    try {
      if (!skipQuery) await control({kind:'status'});
      const canInspect = current.runtimeState === 'ready' && !current.busy && !pendingMutations && !active.size && !preparation && !businessBusy();
      if (epoch === generation && codexSelected() && canInspect && !authorizationBlock && current.credentialStatus !== 'authenticating') await control({kind:'inspect'});
    } catch (error) {
      if (epoch === generation && sequence === codexReadSequence) { codexReadFailure = '暂时无法读取登录状态，请重新读取。'; current = {...current,ready:false}; }
      throw error;
    } finally {
      if (epoch === generation && sequence === codexReadSequence) { codexReading = false; render(false); changed(); }
    }
  }
  async function loginSubscription() {
    assertCodex();
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
      current = {...current,ready:false,busy:true,operationBusy:true,reason:`无法确认 ${providerLabel()} 任务状态，请刷新状态或重试停止。` + failure(error).message};
      protectAuthorization();
    }
  }
  /** @param {'logout'|'clear'} kind */
  async function endAuthorization(kind) {
    assertCodex();
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
      catch { observationEpoch++; current = {...current,busy:true,operationBusy:true}; }
      protectAuthorization();
      throw error;
    } finally { render(false); changed(); }
  }
  function observeAuthorization() {
    const observing = !!current.componentTasks?.length || current.busy && current.operationBusy === false || supportedSelection() && ((codexSelected() && current.credentialStatus === 'authenticating') || current.runtimeState === 'preparing' || !!(preparationCheck && current.busy));
    if (!observing) { clearTimeout(authTimer); authTimer = undefined; return; }
    if (authTimer !== undefined) return;
    const epoch = generation;
    authTimer = setTimeout(async()=>{
      authTimer = undefined;
      if (epoch !== generation) return;
      try { await control({kind:'status'}); render(false); changed(); if (element('ai-settings')?.classList.contains('active')) activateRuntime(); }
      catch (error) { preparationCheck?.(failure(error)); notice(failure(error).message,true); }
    },1000);
  }
  /** @param {string} message @param {boolean} [error] */
  function notice(message, error = false) {
    const target = element(current.adapter === 'codebuddy' ? 'ai-codebuddy-execution-status' : 'ai-harness-status');
    if (target) { target.textContent = message; target.className = 'notice' + (error ? ' warn' : ''); }
    const shownInCodebuddyCard = current.adapter === 'codebuddy' && selectedAdapter() === 'codebuddy';
    if (!codexSelected() && !shownInCodebuddyCard && api.formMode() === 'harness') { const common = element('ai-settings-status-v99'); if (common) common.textContent = message; }
  }
  function assertIdle() {
    if (active.size || current.busy || pendingMutations || businessBusy()) throw failure({code:'busy',message:'AI 任务仍在执行或停止中，请等待结束后保存设置。'});
  }
  /** @param {string} adapter */
  async function selectAdapter(adapter) {
    if (!adapters.includes(adapter)) throw new Error('请选择支持的 Harness 提供方。');
    if (active.size || operationBusy() || pendingMutations || businessBusy()) throw failure({code:'busy',message:'请等待当前任务结束后切换提供方。'});
    if (selectingAdapter || selectingModel || loginInProgress || current.credentialStatus === 'authenticating') throw failure({code:'busy',message:'请等待当前任务或订阅设置操作结束后切换提供方。'});
    const retrying = !!selectionFailure;
    const epoch = ++generation;
    const operation = ++selectionSequence;
    invalidateSetup();
    clearTimeout(authTimer); authTimer = undefined;
    codexReadSequence++; codexReading = false;
    draftAdapter = adapter; selectingAdapter = true; selectionFailure = ''; failedAdapter = '';
    const mode = input('ai-execution-harness'); if (mode) mode.checked = true;
    render(false); changed();
    /** @type {boolean|undefined} */ let saved;
    try {
      if (retrying) await control({kind:'status'});
      if (epoch !== generation) throw cancelled();
      try { await control({kind:'select_adapter',adapter,revision:current.revision}); }
      catch (error) {
        // 组件完成可能刚好推进修订；只重试这次明确选择，不重放未知结果的写入。
        if (failure(error).code !== 'harness_stale' || epoch !== generation) throw error;
        await control({kind:'status'});
        if (epoch !== generation) throw cancelled();
        await control({kind:'select_adapter',adapter,revision:current.revision});
      }
      if (epoch !== generation) throw cancelled();
      if (current.adapter !== adapter || current.mode !== 'harness') throw new Error('提供方选择尚未确认保存，请重试。');
      draftAdapter = undefined; selectionFailure = ''; saved = true;
    } catch (error) {
      if (operation === selectionSequence) { failedAdapter = adapter; draftAdapter = current.adapter; selectionFailure = '提供方选择尚未保存，请重新选择或点击“重试保存选择”。' + failure(error).message; }
      throw error;
    } finally {
      if (operation === selectionSequence) { selectingAdapter = false; observeAuthorization(); render(false); changed(); }
    }
    if (saved) { render(); observeAuthorization(); activateRuntime(); }
  }
  /** @param {string} model */
  async function selectModel(model) {
    if (!codebuddyModels.includes(model)) throw new Error('请选择支持的 CodeBuddy 模型。');
    if (current.adapter !== 'codebuddy' || selectedAdapter() !== 'codebuddy' || draftAdapter !== undefined || api.formMode() !== 'harness') throw new Error('请先选择 CodeBuddy Harness，再修改模型。');
    if (current.mode !== 'harness') throw new Error('请先保存“使用 Harness”执行方式，再选择 CodeBuddy 模型。');
    assertIdle();
    if (selectingAdapter || selectingModel || loginInProgress || preparation || current.credentialStatus === 'authenticating' || current.runtimeState === 'preparing') throw failure({code:'busy',message:'请等待当前任务或订阅设置操作结束后切换模型。'});
    const retrying = !!modelSelectionFailure;
    const epoch = ++generation;
    const operation = ++modelSelectionSequence;
    draftModel = model; selectingModel = true; modelSelectionFailure = '';
    render(false); changed();
    try {
      if (retrying) await control({kind:'status'});
      if (epoch !== generation) throw cancelled();
      const revision = current.revision;
      await control({kind:'select_model',model,revision});
      if (epoch !== generation) throw cancelled();
      if (current.adapter !== 'codebuddy' || current.model !== model || current.revision <= revision) throw new Error('模型选择尚未确认保存，请重试。');
      draftModel = undefined; modelSelectionFailure = '';
    } catch (error) {
      if (operation === modelSelectionSequence) modelSelectionFailure = 'CodeBuddy 模型选择尚未保存，请重新选择或点击“重试保存模型”。' + failure(error).message;
      throw error;
    } finally {
      if (operation === modelSelectionSequence) { selectingModel = false; render(false); changed(); }
    }
  }
  /** @param {import('../../web/platform/runtime').HarnessComponentTask} task */
  function componentPhaseLabel(task) {
    const labels = {checking:'正在检查本地组件…',queued:'等待下载…',downloading:'正在下载组件',verifying:'正在校验组件…',extracting:'正在解压组件…'};
    const percent = task.total > 0 ? ` · ${Math.min(100,Math.floor(task.received / task.total * 100))}%` : '';
    return labels[task.phase] + (task.phase === 'downloading' ? percent : '');
  }
  /** @param {import('../../web/platform/runtime').HarnessComponentTask|undefined} task */
  async function cancelComponent(task) {
    if (!task) return;
    invalidateSetup();
    await control({kind:'cancel_preparation',adapter:task.adapter,id:task.id});
  }
  /** @param {boolean} [reset] */
  function render(reset = true) {
    const section = element('ai-execution-settings');
    if (!section) return;
    section.hidden = false;
    const loading = element('ai-harness-loading');
    if (loading) { loading.hidden = !settingsLoading && !settingsFailure; loading.textContent = settingsFailure || '正在读取 AI 设置…'; }
    const retryLoading = element('ai-harness-load-retry'); if (retryLoading) retryLoading.hidden = !settingsFailure;
    const loadingSettings = settingsLoading || !!settingsFailure;
    const settingsStatus = element('ai-settings-status-v99'); if (settingsStatus) settingsStatus.hidden = !!loadingSettings;
    const choice = document.querySelector?.('.ai-execution-choice'); if (choice) /** @type {HTMLElement} */ (choice).hidden = !!loadingSettings;
    if (loadingSettings) {
      for (const id of ['ai-harness-settings','ai-api-settings-fields','ai-settings-actions']) { const target = element(id); if (target) target.hidden = true; }
      return;
    }
    if (reset) {
      const selected = input('ai-execution-' + (draftAdapter === undefined ? current.mode : 'harness'));
      if (selected) selected.checked = true;
      const model = input('ai-harness-model'); if (model && current.adapter === 'codex') model.value = current.model || 'gpt-6.1-sol';
      const timeout = input('ai-harness-timeout'); if (timeout && current.adapter === 'codex') timeout.value = String(current.timeoutSeconds);
    }
    const mode = api.formMode();
    const adapter = selectedAdapter();
    const provider = input('ai-harness-adapter');
    if (provider) { provider.value = adapter; provider.disabled = operationBusy() || active.size > 0 || pendingMutations > 0 || loginInProgress || selectingAdapter || selectingModel || businessBusy(); }
    const apiFields = element('ai-api-settings-fields'); if (apiFields) apiFields.hidden = mode === 'harness';
    const panel = element('ai-harness-settings'); if (panel) panel.hidden = mode !== 'harness';
    for (const name of adapters) { const providerPanel = element(`ai-${name}-settings`); if (providerPanel) providerPanel.hidden = mode !== 'harness' || adapter !== name; }
    const unavailableProvider = mode === 'harness' && adapter !== 'codex';
    const retrySelection = !!selectionFailure;
    const showSave = !unavailableProvider || retrySelection || mode !== current.mode;
    const actions = element('ai-settings-actions'); if (actions) actions.hidden = mode === 'harness' && adapter === 'deepseek' && !showSave;
    const save = input('ai-save-settings-v99');
    if (save) { save.hidden = !showSave; save.textContent = retrySelection ? '重试保存选择' : '保存设置'; }
    const test = input('ai-test-connection-v99'); if (test) { test.hidden = mode === 'harness' && adapter === 'deepseek'; test.disabled = test.getAttribute?.('aria-busy') === 'true' || mode === 'harness' && !api.snapshot().ready; }
    const clear = input('ai-clear-settings-v99'); if (clear) clear.hidden = unavailableProvider;
    const diagnostic = element('ai-toggle-diagnostics-v375'); if (diagnostic) diagnostic.hidden = mode === 'harness';
    if (mode === 'harness') { const existing = element('ai-diagnostics-v375'); existing?.classList.add('ai-hidden-v99'); }
    const componentTask = current.componentTasks?.find(task=>task.adapter===adapter);
    const preparing = current.runtimeState === 'preparing' || !!preparation;
    const backgroundTask = current.componentTasks?.find(task=>task.adapter!==adapter);
    const background = element('ai-harness-background'); if (background) background.hidden = !backgroundTask;
    const backgroundStatus = element('ai-harness-background-status'); if (backgroundStatus && backgroundTask) backgroundStatus.textContent = `${backgroundTask.adapter==='codex'?'Codex':'CodeBuddy'} · ${componentPhaseLabel(backgroundTask)}（后台继续）`;
    const runtimeLabels = {unprepared:'尚未准备',preparing:'组件准备中',ready:'组件已就绪 · 使用本地组件',failed:'组件准备失败',cancelled:'组件准备已取消'};
    const showingManaged = current.runtimeSource === 'managed' || preparationKind === 'use_managed_runtime';
    const runtimeStatus = element('ai-harness-runtime-status'); if (runtimeStatus) runtimeStatus.textContent = (showingManaged ? '自动管理 · ' : '自定义程序 · ') + (componentTask ? componentPhaseLabel(componentTask) : runtimeLabels[preparing ? 'preparing' : current.runtimeState]);
    const progress = element('ai-harness-runtime-progress');
    if (progress) {
      const received = Math.max(0,current.runtimeReceivedBytes || 0).toLocaleString('zh-CN');
      const total = Math.max(0,current.runtimeTotalBytes || 0).toLocaleString('zh-CN');
      progress.textContent = current.runtimeTotalBytes > 0 ? `${received} / ${total} 字节` : `已接收 ${received} 字节`;
      progress.hidden = !preparing || (componentTask ? componentTask.phase !== 'downloading' : !current.runtimeTotalBytes);
    }
    for (const id of ['ai-harness-prepare','ai-harness-use-managed','ai-harness-choose','ai-harness-inspect']) { const button = input(id); if (button) button.disabled = preparing || current.busy || loginInProgress; }
    const prepareButton = input('ai-harness-prepare'); if (prepareButton) prepareButton.hidden = preparing || current.runtimeState === 'ready';
    const cancelPrepare = input('ai-harness-prepare-cancel'); if (cancelPrepare) cancelPrepare.hidden = !preparing;
    const loginButton = input('ai-harness-login'); if (loginButton) loginButton.disabled = codexReading || !!codexReadFailure || loginInProgress || current.credentialStatus === 'authenticating';
    for (const id of ['ai-harness-model','ai-harness-timeout','ai-save-settings-v99']) { const field = input(id); if (field) field.disabled = loginInProgress || preparing || selectingAdapter || selectingModel; }
    const path = element('ai-harness-runtime'); if (path) path.textContent = current.runtimePath || '组件准备后由应用管理';
    const version = element('ai-harness-version'); if (version) version.textContent = current.runtimeVersion || '未检测';
    const authorization = element('ai-harness-auth-status');
    if (authorization) {
      let label = '尚未登录订阅';
      if (current.credentialStatus === 'subscription') label = '订阅已登录，请测试模型访问';
      else if (current.credentialStatus === 'authenticating') label = '等待完成订阅登录，状态自动刷新中';
      if (!codexAccountConfirmed && current.credentialStatus === 'missing') label = current.runtimeState === 'ready' || preparing ? '正在读取登录状态…' : '组件准备完成后读取登录状态';
      if (codexReadFailure) label = codexReadFailure;
      if (codexReading) label = '正在读取登录状态…';
      authorization.textContent = label; authorization.setAttribute?.('aria-busy',String(codexReading));
    }
    const refreshAuth = input('ai-harness-auth-refresh'); if (refreshAuth) { refreshAuth.disabled = codexReading; refreshAuth.textContent = codexReadFailure ? '重新读取' : '刷新状态'; }
    const logoutAuth = input('ai-harness-logout'); if (logoutAuth) logoutAuth.disabled = codexReading || !!codexReadFailure;
    const login = element('ai-harness-login-details'); if (login) login.hidden = !current.loginUrl;
    const url = element('ai-harness-login-url'); if (url) url.textContent = current.loginUrl || '';
    const code = element('ai-harness-login-code'); if (code) code.textContent = current.userCode || '此流程无需输入验证码';
    const description = element('ai-settings-status-v99');
    let descriptionText = '直接 API 设置与 Harness 分别保存，切换执行方式须点击“保存设置”。';
    if (mode === 'harness') descriptionText = adapter === 'codex' ? 'Codex 组件由应用准备。点击“登录订阅”会自动保存 Harness 设置，再启动官方授权；模型测试由你主动执行。' : unavailableReason(adapter);
    if (draftAdapter !== undefined) descriptionText = selectionReason();
    else if (modelSelectionPending()) descriptionText = modelSelectionReason();
    if (description) description.textContent = descriptionText;
    let reason = current.ready ? `${providerLabel()} 已就绪。` : current.reason || '完成组件准备后，请登录账户。';
    if (adapter === 'deepseek') reason = unavailableReason(adapter);
    if (draftAdapter !== undefined) reason = selectionReason();
    else if (modelSelectionPending()) reason = modelSelectionReason();
    if (adapter === 'codebuddy' && current.runtimeState === 'ready' && !current.ready && !current.busy && !selectionFailure && !modelSelectionFailure) reason = '组件与账户就绪后可测试连接。';
    notice(reason + (mode !== current.mode && draftAdapter === undefined ? ' 执行方式尚未保存。' : ''));
    if (adapter === 'codebuddy') {
      const modelModeUnsaved = current.mode !== 'harness';
      const modelBusy = modelModeUnsaved || current.busy || active.size > 0 || pendingMutations > 0 || preparing || loginInProgress || selectingAdapter || selectingModel || businessBusy();
      const model = input('ai-codebuddy-model');
      if (model) { model.value = draftModel ?? (current.adapter === 'codebuddy' ? current.model : codebuddyModels[0]); model.disabled = modelBusy; }
      const modelStatus = element('ai-codebuddy-model-status');
      if (modelStatus) {
        if (modelModeUnsaved) modelStatus.textContent = '请先保存“使用 Harness”执行方式，再选择 CodeBuddy 模型。';
        else modelStatus.textContent = modelSelectionPending() ? modelSelectionReason() : '模型选择已保存，后续请求将使用此模型。';
      }
      const retryModel = input('ai-codebuddy-model-retry'); if (retryModel) { retryModel.hidden = !modelSelectionFailure; retryModel.disabled = modelBusy; }
      const runtime = element('ai-codebuddy-runtime-status'); if (runtime) runtime.textContent = (componentTask ? componentPhaseLabel(componentTask) : runtimeLabels[preparing ? 'preparing' : current.runtimeState]);
      const bytes = element('ai-codebuddy-runtime-progress');
      if (bytes) { bytes.textContent = `${Math.max(0,current.runtimeReceivedBytes || 0).toLocaleString('zh-CN')} / ${Math.max(0,current.runtimeTotalBytes || 0).toLocaleString('zh-CN')} 字节`; bytes.hidden = !preparing || (componentTask ? componentTask.phase !== 'downloading' : !current.runtimeTotalBytes); }
      const prepare = input('ai-codebuddy-prepare'); if (prepare) { prepare.hidden = preparing || current.runtimeState === 'ready'; prepare.disabled = current.busy || selectingAdapter; }
      const cancel = input('ai-codebuddy-prepare-cancel'); if (cancel) cancel.hidden = !preparing;
      const stop = input('ai-codebuddy-stop'); if (stop) stop.hidden = !current.busy && !active.size;
    }
  }
  /** @param {()=>Promise<void>} action */
  async function uiAction(action) {
    const adapter = selectedAdapter();
    try { await action(); render(false); changed(); }
    catch (error) { render(false); changed(); if (adapter === selectedAdapter() && failure(error).code !== 'cancelled') notice(failure(error).message, true); }
  }
  /** @type {HarnessApi} */
  const api = {
    async initialize() {
      invalidateSetup();
      // 旧设置操作未收敛时查询会被屏障丢弃；重新读取必须先停用旧执行状态。
      current = {...current,mode:'harness',ready:false,reason:'正在重新读取 AI 设置；请等待当前操作结束后刷新状态。'};
      selectionSequence++; draftAdapter = undefined; selectingAdapter = false; selectionFailure = '';
      modelSelectionSequence++; draftModel = undefined; selectingModel = false; modelSelectionFailure = '';
      // 恢复后的重读只更新状态，不把仍可见的设置页当成用户再次进入。
      automaticPreparationAttempts.clear();
      if (generation > 0) automaticPreparationAttempts.add(current.adapter);
      settingsLoading = true; settingsFailure = ''; codexAccountConfirmed = false; codexReadFailure = ''; codexReading = false; render(false);
      const epoch = ++generation;
      clearTimeout(authTimer); authTimer = undefined;
      try { await control({kind:'status'}); }
      catch (error) { if (epoch === generation) { settingsFailure = '暂时无法读取 AI 设置，请重新读取。'; current = {...current,mode:'harness',ready:false,reason:failure(error).message}; } }
      finally { if (epoch === generation) { settingsLoading = false; render(false); } }
    },
    status() {
      const result = {...current,busy:operationBusy() || active.size > 0 || pendingMutations > 0 || selectingAdapter || selectingModel};
      if (settingsLoading || settingsFailure || current.adapter === 'codex' && (codexReading || codexReadFailure)) return {...result,ready:false};
      if (draftAdapter !== undefined) return {...result,mode:'harness',adapter:draftAdapter,ready:false,reason:selectionReason()};
      if (modelSelectionPending()) return {...result,model:draftModel ?? current.model,ready:false,reason:modelSelectionReason()};
      return result;
    },
    snapshot() { return Object.freeze(api.status()); },
    codebuddyAccountChanged(account) {
      if (!Number.isSafeInteger(account.revision) || account.revision < 0 || (codebuddyAccount && account.revision < codebuddyAccount.revision)) return;
      const sameObservation = codebuddyAccount && account.revision === codebuddyAccount.revision && account.phase === codebuddyAccount.phase && account.blocked === codebuddyAccount.blocked;
      const firstConfirmedAccount = !codebuddyAccount && account.revision === current.accountRevision && account.phase === 'signed_in' && !account.blocked && current.credentialStatus === 'subscription';
      const invalidatesExecution = !sameObservation && !firstConfirmedAccount;
      codebuddyAccount = {...account};
      if (invalidatesExecution) accountEpoch++;
      if (current.adapter !== 'codebuddy' || current.mode !== 'harness') return;
      if (invalidatesExecution) {
        current = {...current,ready:false,reason:'CodeBuddy 账户已变化，正在确认当前登录状态。'};
        observationEpoch++; protectAuthorization(); render(false); changed();
      }
      if (!account.blocked) void uiAction(async()=>{await control({kind:'status'});});
    },
    async execute(snapshot, task, messages, signal) {
      if (signal?.aborted) throw cancelled();
      const awaitingStatus = settingsLoading || !!settingsFailure || codexSelected() && (codexReading || !!codexReadFailure);
      if (awaitingStatus) throw failure({code:'harness_unavailable',message:codexReadFailure || '请等待组件与账户状态确认后再执行。'});
      assertSupported();
      if (snapshot.adapter !== current.adapter) throw failure({code:'configuration_changed',message:'AI 提供方已变化，请重新发起任务。'});
      const codebuddy = snapshot.adapter === 'codebuddy';
      if (codebuddy && !['connection_test','question_analysis','question_followup'].includes(task)) throw failure({code:'harness_task_unavailable',message:'CodeBuddy 当前支持连接测试、单题解析和追问；尚未开放批量与导入任务。'});
      if (codebuddy && (!Number.isSafeInteger(snapshot.accountRevision) || Number(snapshot.accountRevision) < 0 || snapshot.accountRevision !== current.accountRevision)) throw failure({code:'configuration_changed',message:'CodeBuddy 账户已变化，请重新发起任务。'});
      if (active.size || current.busy || pendingMutations) throw failure({code:'busy',message:`${providerLabel()} 正在执行或停止任务，请等待结束后重试。`});
      if (snapshot.revision !== current.revision) throw failure({code:'configuration_changed',message:'AI 执行配置已变化，请重新开始本次任务。'});
      if (snapshot.mode !== 'harness' || !snapshot.ready || !current.ready) throw failure({code:'harness_unavailable',message:current.reason || snapshot.reason || `${providerLabel()} 尚未就绪，请先检查 AI 设置。`});
      const id = scope.crypto.randomUUID();
      const epoch = generation;
      const account = accountEpoch;
      let stopped = false;
      /** @type {Promise<unknown>|undefined} */ let stopping;
      const abort = () => { stopped = true; stopping = control({kind:'cancel',id}).catch(() => undefined); };
      let finished = () => {};
      active.set(id,new Promise(resolve => { finished = resolve; }));
      signal?.addEventListener('abort',abort,{once:true});
      if (codebuddy) { render(false); changed(); }
      try {
        /** @type {{content:string}} */ let result;
        try {
          const request = {id,revision:snapshot.revision,task,messages,...(codebuddy ? {accountRevision:snapshot.accountRevision} : {})};
          result = /** @type {{content:string}} */ (await invoke('harness_execute',request));
        } finally {
          const pendingStop = stopping;
          await pendingStop;
          await refreshAfterExecution(epoch);
          // 用户也能在终态查询期间取消；这次停止完成前的查询不能作为最终状态。
          if (stopping !== pendingStop) { await stopping; await refreshAfterExecution(epoch); }
        }
        if (stopped || signal?.aborted || epoch !== generation) throw cancelled();
        if (snapshot.revision !== current.revision) throw failure({code:'configuration_changed',message:'AI 配置已变化，旧结果已丢弃。'});
        if (codebuddy && (account !== accountEpoch || snapshot.accountRevision !== current.accountRevision)) throw failure({code:'configuration_changed',message:'CodeBuddy 账户已变化，旧结果已丢弃。'});
        if (!result || typeof result.content !== 'string' || !result.content.trim()) throw failure({code:'invalid_response',message:`${providerLabel()} 没有返回有效内容。`});
        return {content:result.content};
      } catch (error) {
        await stopping;
        if (stopped || signal?.aborted || epoch !== generation) throw cancelled();
        throw error;
      } finally { signal?.removeEventListener('abort',abort); active.delete(id); finished(); render(false); changed(); }
    },
    async cancelAll() { invalidateSetup(); generation++; clearTimeout(authTimer); authTimer = undefined; if (!['codex','codebuddy'].includes(current.adapter)) return; const pending = [...active.values()]; await control({kind:'cancel_all'}); await Promise.all(pending); },
    formMode() { return input('ai-execution-harness')?.checked ? 'harness' : 'api'; },
    formAdapter() { return selectedAdapter(); },
    selectAdapter,
    selectModel,
    async saveMode(mode) {
      assertIdle();
      if (mode === 'harness' && draftAdapter !== undefined) { await selectAdapter(failedAdapter || draftAdapter); return; }
      if (mode === 'harness' && current.mode === 'harness' && modelSelectionPending()) { await selectModel(draftModel ?? current.model); return; }
      const editCodex = mode === 'harness' && current.adapter === 'codex';
      const model = editCodex ? input('ai-harness-model')?.value.trim() || current.model || 'gpt-6.1-sol' : current.model;
      const timeoutSeconds = editCodex ? Number(input('ai-harness-timeout')?.value || 120) : current.timeoutSeconds;
      if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 600) throw new Error('任务超时须为 10 至 600 秒的整数。');
      const epoch = generation;
      await control({kind:'save',mode,adapter:current.adapter,model,timeoutSeconds,revision:current.revision});
      if (epoch !== generation) throw cancelled();
      generation++;
      if (mode === 'api') { draftAdapter = undefined; selectionFailure = ''; }
      clearTimeout(authTimer); authTimer = undefined; observeAuthorization();
      render(); changed();
      if (mode === 'harness' && modelSelectionPending()) await selectModel(draftModel ?? current.model);
    },
    async clear() { assertCodex(); if(active.size || current.busy)throw new Error('正在停止 Codex 任务，请等待结束后清除配置。'); await endAuthorization('clear'); render(); },
    async test() {
      assertSupported();
      if (api.formMode() !== current.mode) throw new Error('请先保存当前执行方式，再测试执行。');
      if (codexSelected() && ((input('ai-harness-model')?.value.trim() || '') !== current.model || Number(input('ai-harness-timeout')?.value || 120) !== current.timeoutSeconds)) throw new Error('配置草稿尚未保存，请先保存后再测试。');
      notice('正在执行固定测试任务，将使用当前订阅额度……');
      try {
        const system = current.adapter === 'codebuddy' ? '只回复 {"ok":true} 这一个 JSON 对象，不要 Markdown 代码块，不要额外字段、解释或其他文字。' : '只回复一个 JSON 对象。';
        const result = await api.execute(api.snapshot(),'connection_test',[{role:'system',content:system},{role:'user',content:'回复 {"ok":true}'}]);
        let value; try { value = JSON.parse(result.content); } catch { throw new Error(`${providerLabel()} 返回的测试结果不是有效 JSON。`); }
        if (!value || value.ok !== true || (current.adapter === 'codebuddy' && (Array.isArray(value) || Object.keys(value).length !== 1))) throw new Error(`${providerLabel()} 测试结果校验失败。`);
        notice('测试执行成功，结果已通过校验。');
      } catch (error) {
        notice(failure(error).message,true);
        throw error;
      }
    },
    render() { render(); if (element('ai-settings')?.classList.contains('active')) activateRuntime(); },
    bind(onChanged,isBusy) {
      changed = onChanged; businessBusy = isBusy;
      const provider = input('ai-harness-adapter');
      if (provider) provider.onchange = () => { const adapter = provider.value; void uiAction(()=>selectAdapter(adapter)); };
      const codebuddyModel = input('ai-codebuddy-model');
      if (codebuddyModel) codebuddyModel.onchange = () => { const model = codebuddyModel.value; void uiAction(()=>selectModel(model)); };
      const retryModel = element('ai-codebuddy-model-retry');
      if (retryModel) retryModel.onclick = () => { if (draftModel !== undefined) { const model = draftModel; void uiAction(()=>selectModel(model)); } };
      for (const mode of ['api','harness']) {
        const radio = input('ai-execution-' + mode);
        if (radio) radio.onchange = () => {
          render(false);
          if (mode === 'harness') { if (!['failed','cancelled'].includes(current.runtimeState)) automaticPreparationAttempts.delete(current.adapter); activateRuntime(); }
          else if (preparation || loginInProgress || current.runtimeState === 'preparing' || current.credentialStatus === 'authenticating') void uiAction(()=>api.cancelAll());
        };
      }
      const prepare = element('ai-harness-prepare'); if (prepare) prepare.onclick = () => { void uiAction(()=>ensurePrepared()); };
      const codebuddyPrepare = element('ai-codebuddy-prepare'); if (codebuddyPrepare) codebuddyPrepare.onclick = () => { void uiAction(()=>ensurePrepared()); };
      for (const id of ['ai-codebuddy-stop']) { const button = element(id); if (button) button.onclick = () => { void uiAction(()=>api.cancelAll()); }; }
      const cancelPrepare = element('ai-harness-prepare-cancel'); if (cancelPrepare) cancelPrepare.onclick = () => { void uiAction(()=>cancelComponent(current.componentTasks?.find(task=>task.adapter==='codex'))); };
      const cancelBuddy = element('ai-codebuddy-prepare-cancel'); if (cancelBuddy) cancelBuddy.onclick = () => { void uiAction(()=>cancelComponent(current.componentTasks?.find(task=>task.adapter==='codebuddy'))); };
      const backgroundView = element('ai-harness-background-view'); if (backgroundView) backgroundView.onclick = () => { const task=current.componentTasks?.find(task=>task.adapter!==selectedAdapter()); if(task)void uiAction(()=>selectAdapter(task.adapter)); };
      const backgroundCancel = element('ai-harness-background-cancel'); if (backgroundCancel) backgroundCancel.onclick = () => { void uiAction(()=>cancelComponent(current.componentTasks?.find(task=>task.adapter!==selectedAdapter()))); };
      const retrySettings = element('ai-harness-load-retry'); if (retrySettings) retrySettings.onclick = () => { void api.initialize().then(()=>{render();activateRuntime();}); };
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
