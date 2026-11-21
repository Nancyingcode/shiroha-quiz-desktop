// 统一直接 API 与桌面 Harness 的配置、可用性和连接诊断。
(() => {
  'use strict';
  const i18n = globalThis.ShirohaI18n;
  const AI_PROVIDER_PRESETS_V99 = { ollama: { label: 'Ollama', endpoint: 'http://127.0.0.1:11434/v1/chat/completions' }, lmstudio: { label: 'LM Studio', endpoint: 'http://127.0.0.1:1234/v1/chat/completions' }, custom: { label: '自定义接口', endpoint: '' } };

  // 将平台及界面依赖绑定到当前页面，诊断和连接状态随页面释放。
  function create({
    presets: AI_PROVIDER_PRESETS_V99 = AI_PROVIDER_PRESETS_V99_DEFAULT,
    platform: ShirohaPlatform,
    config: ensureAiImportStateV99,
    readKey: readStoredAiKeyV99,
    view,
  }) {
    const {
      select: $,
      escape: esc,
      copy: copyTextV23,
      toast,
    } = view;
    // 连接展示与诊断仅属于当前页面；清除配置时一并重置。
    let aiConnectionStateV99 = 'idle';
    let aiDiagnosticsVisibleV375 = false;
    let aiLastDiagnosticV375 = null;
    function defaultAiConfigV99() {
      return { provider: 'ollama', endpoint: AI_PROVIDER_PRESETS_V99.ollama.endpoint, model: '', timeoutSeconds: 120, rememberKey: false };
    }

    // 将用户设置归一化为可请求的 API 结构，并限制超时范围。
    function normalizeAiConfigV99(value) {
      const raw = value && typeof value === 'object' ? value : {};

      const provider = AI_PROVIDER_PRESETS_V99[raw.provider] ? raw.provider : 'ollama';

      const timeout = Math.min(600, Math.max(10, Number(raw.timeoutSeconds || 120) || 120));

      return { provider, endpoint: String(raw.endpoint || AI_PROVIDER_PRESETS_V99[provider].endpoint || '').trim(), model: String(raw.model || '').trim(), timeoutSeconds: timeout, rememberKey: !!raw.rememberKey };
    }

    function aiProviderLabelV99(provider) {
      return provider === 'custom' ? i18n.text('ai.customLabel') : AI_PROVIDER_PRESETS_V99[provider]?.label || i18n.text('ai.customLabel');
    }

    // 维护适配器在设置页和练习页共用的展示名称。
    function aiHarnessLabelV99(adapter) {
      switch (adapter) {
        case 'codex'
          :return 'Codex';
        case 'codebuddy'
          :return 'CodeBuddy';
        case 'deepseek'
          :return 'DeepSeek';
        default:return i18n.text('ai.unknownHarness');
      }
    }

    function isAiHarnessExecutionV99(execution) {
      return execution?.mode === 'harness';
    }

    // 先按适配器检查任务能力，避免把不受支持的任务交给服务。
    function aiHarnessTaskReasonV99(config, task) {
      if (!isAiHarnessExecutionV99(config.execution)) {
        return '';
      }

      if (config.execution.adapter === 'codex') {
        return '';
      }

      if (config.execution.adapter === 'codebuddy') {
        return ['connection_test', 'question_analysis', 'question_followup'].includes(task) ? '' : i18n.text('ai.codebuddyTasks');
      }

      return i18n.text('ai.harnessUnavailable', { provider: aiHarnessLabelV99(config.execution.adapter) });
    }

    function aiUnavailableReasonV99(config, task) {
      if (isAiHarnessExecutionV99(config.execution)) {
        return aiHarnessTaskReasonV99(config, task) || config.execution.reason || i18n.text('ai.harnessNotReady');
      }

      return i18n.text('ai.configureFirst');
    }

    // 发送前明确题目数据去向和账户用量，服务未就绪时对应说明无发送。
    function aiHarnessPrivacyV99(config, subject) {
      if (config.execution?.adapter === 'codex') {
        return i18n.text('ai.codexSend', { subject });
      }

      if (config.execution?.adapter === 'codebuddy') {
        return aiConfiguredV99(config, 'question_analysis') ? i18n.text('ai.codebuddySend', { subject }) : i18n.text('ai.codebuddyNotReady');
      }

      return i18n.text('ai.harnessUnavailable', { provider: aiHarnessLabelV99(config.execution?.adapter) });
    }

    // 把当前 Harness 快照或浏览器 API 设置组合为一次任务的执行配置。
    function aiExecutionConfigV99() {
      const execution = ShirohaPlatform.harness?.snapshot();

      if (isAiHarnessExecutionV99(execution)) {
        if (execution.adapter === 'codebuddy') {
          return { provider: 'codebuddy', model: execution.model, timeoutSeconds: 120, execution };
        }

        return { provider: execution.adapter, model: execution.adapter === 'codex' ? (execution.model || '适配器默认模型') : '', timeoutSeconds: execution.timeoutSeconds, execution };
      }

      return { ...ensureAiImportStateV99(), execution };
    }

    // 检查任务是否可执行，CodeBuddy 还须具备已读到账户修订。
    function aiConfiguredV99(config, task = 'connection_test') {
      if (!isAiHarnessExecutionV99(config.execution)) {
        return !!(config.endpoint && config.model);
      }

      if (aiHarnessTaskReasonV99(config, task) || !config.execution.ready) {
        return false;
      }

      return config.execution.adapter === 'codex' || (Number.isSafeInteger(config.execution.accountRevision) && config.execution.accountRevision >= 0);
    }

    // 区分后台检查、检查失败和未配置，便于页面提供合适的操作。
    function aiAvailabilityV99(config, task = 'connection_test') {
      const unsupported = aiHarnessTaskReasonV99(config, task);
      if (unsupported) { return { state: 'unsupported', reason: unsupported }; }

      if (isAiHarnessExecutionV99(config.execution)) {
        const { readiness } = config.execution;
        if (readiness === 'checking' || readiness === 'error' || readiness === 'blocked') {
          return { state: readiness, reason: config.execution.reason || 'AI 状态尚未确认。', retryable: readiness !== 'checking' && config.execution.readinessRetryable !== false };
        }

        if (!aiConfiguredV99(config, task)) { return { state: 'action_required', reason: aiUnavailableReasonV99(config, task) }; }
      } else if (!aiConfiguredV99(config, task)) {
        return { state: 'unconfigured', reason: aiUnavailableReasonV99(config, task) };
      }

      return { state: 'ready', reason: '' };
    }

    // 按执行方式选择任务面板显示的服务名称。
    function aiExecutionLabelV99(config) {
      if (!isAiHarnessExecutionV99(config.execution)) {
        return aiProviderLabelV99(config.provider);
      }

      const label = aiHarnessLabelV99(config.execution.adapter);
      return label === i18n.text('ai.unknownHarness') ? label : `${label} Harness`;
    }

    function aiRequestConfigV99(config) {
      return isAiHarnessExecutionV99(config.execution) ? config : { ...config, apiKey: readStoredAiKeyV99(config) };
    }

    // 校验用户填写的地址并补全兼容的 Chat Completions 路径。
    function normalizeAiEndpointV99(value, provider) {
      let text = String(value || '').trim();

      if (!text) {
        text = AI_PROVIDER_PRESETS_V99[provider]?.endpoint || '';
      }

      if (!text) {
        return '';
      }

      let url;

      try {
        url = new URL(text);
      } catch (error) {
        throw new Error(i18n.text('ai.invalidUrl'), { cause: error });
      }

      // 仅接受 HTTP 或 HTTPS URL 协议，排除浏览器支持但无法用于接口的其他协议。
      if (!/^https?:$/.test(url.protocol)) {
        throw new Error(i18n.text('ai.invalidScheme'));
      }

      // 去掉路径尾部重复的斜杠，便于判断是否需要补全 API 路径。
      const path = url.pathname.replace(/\/+$/, '');

      if (!path || path === '/') {
        url.pathname = '/v1/chat/completions';
      } else if (
        // 只补全以版本段 v1 结尾的路径，保留用户提供的完整端点。
        /\/v1$/i.test(path)
      ) {
        url.pathname = `${path}/chat/completions`;
      }

      url.hash = '';

      // 去掉序列化结果末尾的斜杠，保持保存地址和凭据绑定一致。
      return url.toString().replace(/\/$/, '');
    }

    // 只把环回地址识别为本地服务，以免给远程主机建议更改本地工具配置。
    function isLocalAiEndpointV99(endpoint) {
      try {
        const host = new URL(endpoint).hostname.toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
      } catch {
        return false;
      }
    }

    // 读取并校验当前 API 表单，只有服务地址未变时才能复用原凭据。
    function readAiFormV99() {
      const provider = $('#ai-provider-v99')?.value || 'ollama';

      const endpoint = normalizeAiEndpointV99($('#ai-endpoint-v99')?.value || '', provider);

      const model = String($('#ai-model-v99')?.value || '').trim();

      const timeoutSeconds = Math.min(600, Math.max(10, Number($('#ai-timeout-v99')?.value || 120) || 120));

      const rememberKey = !!$('#ai-remember-key-v99')?.checked;

      const typedKey = String($('#ai-api-key-v99')?.value || '').trim();

      const previous = ensureAiImportStateV99();

      const apiKey = typedKey || (endpoint === previous.endpoint ? readStoredAiKeyV99(previous) : '');

      if (!endpoint) {
        throw new Error(i18n.text('ai.enterEndpoint'));
      }

      if (!model) {
        throw new Error(i18n.text('ai.enterModel'));
      }

      return { provider, endpoint, model, timeoutSeconds, rememberKey, apiKey };
    }

    // 用文本通知连接和保存结果，避免把外部提示当成 HTML。
    function setAiSettingsStatusV99(message, type = '') {
      const el = $('#ai-settings-status-v99');
      if (!el) {
        return;
      }

      el.textContent = message;
      el.className = `notice${type ? ` ${type}` : ''}`;
    }

    function isConnectionTestingV99() {
      return $('#ai-test-connection-v99')?.getAttribute?.('aria-busy') === 'true';
    }

    // 完成测试时按当前表单的执行方式恢复按钮，保留用户等待期间修改的表单草稿。
    function setConnectionTestingV99(testing) {
      const button = $('#ai-test-connection-v99');
      if (!button) {
        return;
      }

      if (testing) {
        button.setAttribute?.('aria-busy', 'true');
      } else {
        button.removeAttribute?.('aria-busy');
      }

      const { harness } = ShirohaPlatform;
      const awaitingHarness = harness?.formMode() === 'harness' && !harness.snapshot().ready;
      button.disabled = testing || awaitingHarness;
      button.textContent = testing ? i18n.text('ai.testing') : i18n.text('connection.test');
    }

    // 普通页面使用 Origin，本地文件诊断保留有用的地址信息。
    function aiCurrentOriginV375() {
      try {
        return location.origin && location.origin !== 'null' ? location.origin : location.href.split('#')[0];
      } catch {
        return i18n.text('ai.diagCurrentPage');
      }
    }

    // 只提取诊断可用的主机部分，无效地址留空。
    function aiEndpointHostV375(endpoint) {
      try {
        return new URL(endpoint).host;
      } catch {
        return '';
      }
    }

    // 裁剪并脱敏服务响应，方便用户查看或复制诊断。
    function sanitizeAiDiagnosticDetailV375(text, config) {
      // 把服务错误中的连续空白压成空格，使诊断摘要适合单行展示。
      let detail = String(text || '').replace(/\s+/g, ' ').trim();

      if (config) {
        detail = ShirohaPlatform.credentials.redact(config, detail);
      }

      return detail.slice(0, 520);
    }

    // 仅为浏览器连接本地 Ollama 的诊断生成跨域配置说明。
    function aiOllamaCorsCommandV375(diag) {
      if (ShirohaPlatform.credentials.native || !diag || diag.provider !== 'ollama') {
        return '';
      }

      // 只将 HTTP 或 HTTPS 页面的来源加入命令，本地文件地址无需写入。
      const origin = /^https?:\/\//i.test(diag.origin || '') ? diag.origin : '';

      const origins = [origin, 'http://localhost', 'http://127.0.0.1', 'http://localhost:*', 'http://127.0.0.1:*'].filter(Boolean).join(',');

      return `setx OLLAMA_ORIGINS "${origins}"\n\n${i18n.text('ai.diagCorsRestart')}`;
    }

    // 依据 HTTP 状态提供检查建议，403 在桌面、本地浏览器和远程浏览器中含义不同。
    function describeAiHttpResponse(status, native, local) {
      let summary;
      let statusMessage;
      let steps;
      if (status === 401) {
        summary = i18n.text('ai.diagAuthentication');
        statusMessage = i18n.text('ai.diagCredentials');
        steps = [i18n.text('ai.diagCheckKey'), i18n.text('ai.diagOllamaKey'), i18n.text('ai.diagRemoteKey')];
      } else if (status === 403) {
        if (native) {
          summary = i18n.text('ai.diagForbidden');
          statusMessage = i18n.text('ai.diagNativeForbidden');
          steps = [i18n.text('ai.diagModelPermission'), i18n.text('ai.diagNativeAllowlist')];
        } else {
          summary = local ? i18n.text('ai.diagLocalForbidden') : i18n.text('ai.diagForbidden');
          statusMessage = local ? i18n.text('ai.diagLocalCors') : i18n.text('ai.diagWebForbidden');
          steps = local ? [i18n.text('ai.diagOllamaOrigins'), i18n.text('ai.diagLmStudioCors'), i18n.text('ai.diagRestartLocal')] : [i18n.text('ai.diagWebAllowlist'), i18n.text('ai.diagModelAccess')];
        }
      } else if (status === 404) {
        summary = i18n.text('ai.diagMissingEndpoint');
        statusMessage = i18n.text('ai.diagCheckEndpoint');
        steps = [i18n.text('ai.diagStandardPath'), i18n.text('ai.diagV1'), i18n.text('ai.diagApiVersion')];
      } else if (status === 405) {
        summary = i18n.text('ai.diagMethod');
        statusMessage = i18n.text('ai.diagCheckMethod');
        steps = [i18n.text('ai.diagUseApiUrl'), i18n.text('ai.diagPost')];
      } else if (status === 400 || status === 422) {
        summary = i18n.text('ai.diagRequest');
        statusMessage = i18n.text('ai.diagRequestHint');
        steps = [i18n.text('ai.diagExactModel'), i18n.text('ai.diagPlainJson')];
      } else if (status === 429) {
        summary = i18n.text('ai.diagRate');
        statusMessage = i18n.text('ai.diagRateHint');
        steps = [i18n.text('dav.retry'), i18n.text('ai.diagCheckQuota')];
      } else if (status >= 500) {
        summary = i18n.text('ai.diagServer');
        statusMessage = i18n.text('ai.diagServerHint');
        steps = [i18n.text('ai.diagLoadModel'), i18n.text('ai.diagCheckLog'), i18n.text('ai.diagSmallerModel')];
      } else {
        return null;
      }

      return { summary, level: 'warn', statusMessage, steps };
    }

    // 优先识别取消、超时和原生诊断码，再根据连接环境和 HTTP 响应给出建议。
    function summarizeAiDiagnostic({
      error,
      mode,
      native,
      nativeError,
      code,
      status,
      network,
      local,
    }) {
      // 兼容只返回“超过 N 秒”的旧超时提示；已有 HTTP 状态时保留 HTTP 诊断。
      const timeoutMessage = /超过\s*\d+\s*秒/;
      let summary = i18n.text('ai.connectionUnknown');
      let statusMessage = i18n.text('ai.diagUntested');
      let level = '';
      let steps;
      if (mode === 'ok') {
        summary = i18n.text('ai.diagSuccess');
        level = 'ok';
        statusMessage = i18n.text('ai.diagSuccessHint');

        steps = [i18n.text('ai.diagResponseOk'), native ? i18n.text('ai.diagRetestNative') : i18n.text('ai.diagRetestBrowser')];
      } else if (code === 'timeout' || (!status && timeoutMessage.test(error?.message || ''))) {
        summary = i18n.text('dav.timeout');
        level = 'warn';
        statusMessage = error.message || i18n.text('ai.diagTimeoutHint');
        steps = [i18n.text('ai.diagConfirmLoaded'), i18n.text('ai.diagIncreaseTimeout'), i18n.text('ai.diagLocalDelay')];
      } else if (code === 'cancelled' || error?.name === 'AbortError') {
        summary = i18n.text('ai.diagCancelled');
        level = 'warn';
        statusMessage = error.message || i18n.text('ai.diagCancelledHint');
        steps = [i18n.text('ai.diagRetryTest')];
      } else if (nativeError) {
        summary = nativeError[0];
        level = 'warn';
        statusMessage = error.message || summary;
        steps = [nativeError[1]];
      } else if (native && (code === 'network_unavailable' || network)) {
        summary = local ? i18n.text('ai.diagNativeLocal') : i18n.text('ai.diagNativeRemote');
        level = 'warn';
        statusMessage = error.message || i18n.text('ai.diagNativeRemoteHint');

        steps = [local ? i18n.text('ai.diagNativeLocalHint') : i18n.text('ai.diagNativeCheckHost'), i18n.text('ai.diagNativeServerLog')];
      } else if (network) {
        summary = local ? i18n.text('ai.diagPossibleCors') : i18n.text('ai.diagBrowserNetwork');
        level = 'warn';

        statusMessage = local ? i18n.text('ai.diagLocalNetwork') : i18n.text('ai.diagRemoteNetwork');

        steps = local ? [i18n.text('ai.diagRunLocal'), i18n.text('ai.diagCheckPort'), i18n.text('ai.diagPagesCors'), i18n.text('ai.diagRetestCors')] : [i18n.text('ai.diagCheckBrowserUrl'), i18n.text('ai.diagAllowOrigin'), i18n.text('ai.diagRemoteProxy')];
      } else {
        const diagnostic = describeAiHttpResponse(status, native, local);
        if (diagnostic) {
          return diagnostic;
        }

        if (error) {
          summary = i18n.text('ai.diagTestFailed');
          level = 'warn';
          statusMessage = error.message || i18n.text('ai.diagTestFailedHint');
          steps = [i18n.text('ai.diagCheckProvider'), native ? i18n.text('ai.diagCheckDesktop') : i18n.text('ai.diagConsoleCors')];
        } else {
          steps = [i18n.text('ai.diagEnterForm'), native ? i18n.text('ai.diagDesktopHint') : i18n.text('ai.diagPagesHint')];
        }
      }

      return { summary, level, statusMessage, steps };
    }

    // 收集执行环境、已脱敏的错误和对应处置说明供界面展示。
    function buildAiDiagnosticV375(error, config, mode = 'error') {
      const cfg = config || {};
      const endpoint = String(cfg.endpoint || '').trim();
      const provider = String(cfg.provider || 'custom');
      const local = endpoint ? isLocalAiEndpointV99(endpoint) : false;

      const status = Number(error?.status || 0);
      const origin = aiCurrentOriginV375();
      const providerLabel = aiProviderLabelV99(provider);

      const native = !!ShirohaPlatform.credentials.native;
      const code = String(error?.code || '');

      const rawDetail = sanitizeAiDiagnosticDetailV375(error?.detail || error?.cause?.message || error?.message || '', cfg);

      // 识别不同浏览器报告的连接失败文案，用于区分网络问题和 HTTP 响应。
      const network = !!error?.network || /Failed to fetch|Load failed|NetworkError|ERR_FAILED/i.test(rawDetail || error?.message || '');

      const nativeErrors = {
        binding_required: [i18n.text('ai.diagNativeBinding'), i18n.text('ai.diagNativeReenter')],
        credential_pending: [i18n.text('ai.diagNativePending'), i18n.text('ai.diagNativeWait')],
        credential_unavailable: [i18n.text('ai.diagNativeCredential'), i18n.text('ai.diagCredentialManager')],
        configuration_not_committed: [i18n.text('ai.diagNativeUnsaved'), i18n.text('ai.diagNativeSaveFirst')],
        invalid_service_config: [i18n.text('ai.diagNativeBadUrl'), i18n.text('ai.diagNativeUrlHint')],
        invalid_input: [i18n.text('ai.diagNativeBadRequest'), i18n.text('ai.diagNativeRequestHint')],
        redirect_denied: [i18n.text('ai.diagDeniedRedirect'), i18n.text('ai.diagFinalEndpoint')],
        network_scope_denied: [i18n.text('ai.diagScopeRedirect'), i18n.text('ai.diagScopeRedirectHint')],
        network_denied: [i18n.text('ai.diagNetworkDenied'), i18n.text('ai.diagNetworkDeniedHint')],
        payload_too_large: [i18n.text('ai.diagLargeRequest'), i18n.text('ai.diagLargeRequestHint')],
        response_too_large: [i18n.text('ai.diagLargeResponse'), i18n.text('ai.diagLargeResponseHint')],
        invalid_response: [i18n.text('ai.diagInvalidResponse'), i18n.text('ai.diagInvalidResponseHint')],
      };

      const nativeError = native ? nativeErrors[code] : null;

      const {
        summary,
        statusMessage,
        level,
        steps,
      } = summarizeAiDiagnostic({ error, mode, native, nativeError, code, status, network, local });

      return { time: i18n.date(new Date()), mode, provider, providerLabel, endpoint, host: aiEndpointHostV375(endpoint), origin, local, status: status || '', statusLabel: status ? `HTTP ${status}` : i18n.text('ai.diagNoHttp'), summary, statusMessage, level, detail: rawDetail || i18n.text('ai.diagNoDetail'), steps };
    }

    // 将当前诊断放入设置页，并按诊断类别显示可执行操作。
    function renderAiDiagnosticV375() {
      const panel = $('#ai-diagnostics-v375');
      if (!panel) {
        return;
      }

      const diag = aiLastDiagnosticV375 || buildAiDiagnosticV375(null, ensureAiImportStateV99(), 'idle');

      panel.classList.toggle('ai-hidden-v99', !aiDiagnosticsVisibleV375);

      const title = $('#ai-diagnostics-title-v375');
      if (title) {
        title.textContent = diag.summary;
      }

      const sub = $('#ai-diagnostics-subtitle-v375');
      if (sub) {
        sub.textContent = `${diag.providerLabel} · ${diag.statusLabel} · ${diag.time}`;
      }

      const body = $('#ai-diagnostics-body-v375');

      if (body) {
        const rows = [[i18n.text('ai.diagEndpoint'), diag.endpoint || i18n.text('ai.diagNoEndpoint')], [i18n.text('ai.diagCurrentPage'), diag.origin], [i18n.text('ai.serviceType'), diag.providerLabel], [i18n.text('ai.diagHost'), diag.host || i18n.text('ai.diagHostUnknown')], [i18n.text('ai.diagHttp'), diag.statusLabel], [i18n.text('ai.diagResult'), diag.summary], [i18n.text('ai.diagDetail'), diag.detail]];

        body.innerHTML = `<div class="ai-diagnostics-grid-v375">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b title="${esc(v)}">${esc(v)}</b></div>`).join('')}</div><div class="notice ${diag.level === 'ok' ? 'ok' : 'warn'} ai-diagnostics-advice-v375"><b>${esc(diag.statusMessage)}</b><ol>${(diag.steps || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>`;
      }

      const toggle = $('#ai-toggle-diagnostics-v375');
      if (toggle) {
        toggle.textContent = aiDiagnosticsVisibleV375 ? i18n.text('ai.hideDiagnostic') : i18n.text('ai.showDiagnostic');
      }

      const copyCors = $('#ai-copy-ollama-cors-v375');
      if (copyCors) {
        copyCors.classList.toggle('ai-hidden-v99', !aiOllamaCorsCommandV375(diag));
      }
    }

    // 更新当前诊断，调用方明确要求时才改变显示开关。
    function setAiDiagnosticV375(diag, show) {
      aiLastDiagnosticV375 = diag;
      if (show != null) {
        aiDiagnosticsVisibleV375 = !!show;
      }

      renderAiDiagnosticV375();
    }

    function toggleAiDiagnosticV375() {
      aiDiagnosticsVisibleV375 = !aiDiagnosticsVisibleV375;
      renderAiDiagnosticV375();
    }

    function copyAiDiagnosticV375() {
      const diag = aiLastDiagnosticV375 || buildAiDiagnosticV375(null, ensureAiImportStateV99(), 'idle');

      const text = ['Shiroha Quiz AI 连接诊断', `时间：${diag.time}`, `服务类型：${diag.providerLabel}`, `接口地址：${diag.endpoint || i18n.text('ai.diagNoEndpoint')}`, `当前页面：${diag.origin}`, `HTTP 状态：${diag.statusLabel}`, `判断结果：${diag.summary}`, `错误摘要：${diag.detail}`, '建议：', ...(diag.steps || []).map((x, i) => `${i + 1}. ${x}`)].join('\n');

      copyTextV23(text, i18n.text('ai.diagCopied'));
    }

    // 仅复制对当前浏览器诊断适用的 Ollama 命令。
    function copyAiOllamaCorsCommandV375() {
      const diag = aiLastDiagnosticV375 || buildAiDiagnosticV375(null, ensureAiImportStateV99(), 'idle');

      const command = aiOllamaCorsCommandV375(diag);
      if (!command) {
        toast(i18n.text('ai.diagNoCorsCommand'), 'warn');
        return;
      }

      copyTextV23(command, i18n.text('ai.diagCorsCopied'));
    }

    // 用配置和后台就绪状态更新连接标记，优先提示尚未完成的检查。
    function updateAiConnectionPillV99(stateValue, configuredOverride) {
      if (stateValue) {
        aiConnectionStateV99 = stateValue;
      }

      const pill = $('#ai-connection-pill-v99');
      if (!pill) {
        return;
      }

      const config = aiExecutionConfigV99();

      const configured = configuredOverride == null ? aiConfiguredV99(config) : !!configuredOverride;

      const status = !configured ? 'empty' : aiConnectionStateV99;

      pill.className = 'pill ai-status-pill-v99';

      if (config.execution?.readiness === 'checking') {
        pill.textContent = i18n.text('ai.checking');
      } else if (config.execution?.readiness === 'error' || config.execution?.readiness === 'blocked') {
        pill.textContent = i18n.text('ai.checkIncomplete');
        pill.classList.add('is-error');
      } else if (status === 'ok') {
        pill.textContent = i18n.text('ai.connected');
        pill.classList.add('is-ok');
      } else if (status === 'error') {
        pill.textContent = i18n.text('ai.connectionFailed');
        pill.classList.add('is-error');
      } else if (configured) {
        pill.textContent = i18n.text('ai.configured');
        pill.classList.add('is-ready');
      } else {
        pill.textContent = i18n.text('ai.notConfigured');
      }
    }

    // 以持久配置回填表单，凭据在页面只以已保存占位提示呈现。
    function renderAiSettingsV99() {
      const config = ensureAiImportStateV99();

      const provider = $('#ai-provider-v99');
      const endpoint = $('#ai-endpoint-v99');
      const model = $('#ai-model-v99');
      const timeout = $('#ai-timeout-v99');
      const remember = $('#ai-remember-key-v99');
      const key = $('#ai-api-key-v99');

      if (provider) {
        provider.value = config.provider;
      }

      if (endpoint) {
        endpoint.value = config.endpoint;
        endpoint.dataset.lastPreset = AI_PROVIDER_PRESETS_V99[config.provider]?.endpoint || '';
      }

      if (model) {
        model.value = config.model;
      }

      if (timeout) {
        timeout.value = String(config.timeoutSeconds);
      }

      if (remember) {
        remember.checked = config.rememberKey;
      }

      if (key) {
        key.value = '';
        key.placeholder = readStoredAiKeyV99(config) ? i18n.text('ai.storedKey') : i18n.text('ai.optionalKey');
      }

      updateAiConnectionPillV99();

      renderAiDiagnosticV375();

      ShirohaPlatform.harness?.render();
    }

    // API 保存后只回填归一化的端点并重置诊断，保留表单其他输入。
    function renderSavedApiSettingsV99(config) {
      aiConnectionStateV99 = 'idle';
      aiLastDiagnosticV375 = buildAiDiagnosticV375(null, config, 'idle');
      const endpoint = $('#ai-endpoint-v99');
      if (endpoint) {
        endpoint.value = config.endpoint;
      }

      setAiSettingsStatusV99(i18n.text('ai.savedSeparately'), 'ok');
      updateAiConnectionPillV99();
      renderAiDiagnosticV375();
    }

    function reset() {
      aiConnectionStateV99 = 'idle';
      aiLastDiagnosticV375 = null;
      aiDiagnosticsVisibleV375 = false;
    }

    return {
      defaultAiConfigV99,
      normalizeAiConfigV99,
      aiProviderLabelV99,
      isAiHarnessExecutionV99,
      aiHarnessLabelV99,
      aiHarnessTaskReasonV99,
      aiUnavailableReasonV99,
      aiHarnessPrivacyV99,
      aiExecutionConfigV99,
      aiConfiguredV99,
      aiAvailabilityV99,
      aiExecutionLabelV99,
      aiRequestConfigV99,
      normalizeAiEndpointV99,
      isLocalAiEndpointV99,
      readAiFormV99,
      setAiSettingsStatusV99,
      isConnectionTestingV99,
      setConnectionTestingV99,
      sanitizeAiDiagnosticDetailV375,
      aiOllamaCorsCommandV375,
      buildAiDiagnosticV375,
      renderAiDiagnosticV375,
      setAiDiagnosticV375,
      toggleAiDiagnosticV375,
      copyAiDiagnosticV375,
      copyAiOllamaCorsCommandV375,
      updateAiConnectionPillV99,
      renderAiSettingsV99,
      renderSavedApiSettingsV99,
      reset,
    };
  }

  const AI_PROVIDER_PRESETS_V99_DEFAULT = AI_PROVIDER_PRESETS_V99;
  globalThis.ShirohaAiSettings = Object.freeze({ create, presets: AI_PROVIDER_PRESETS_V99 });
})();
