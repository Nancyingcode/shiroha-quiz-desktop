(() => {
  'use strict';
  const AI_PROVIDER_PRESETS_V99 = { ollama: { label: 'Ollama', endpoint: 'http://127.0.0.1:11434/v1/chat/completions' }, lmstudio: { label: 'LM Studio', endpoint: 'http://127.0.0.1:1234/v1/chat/completions' }, custom: { label: '自定义接口', endpoint: '' } };

  function create({ presets: AI_PROVIDER_PRESETS_V99 = AI_PROVIDER_PRESETS_V99_DEFAULT, platform: ShirohaPlatform, config: ensureAiImportStateV99, readKey: readStoredAiKeyV99, view }) {
    const { select: $, escape: esc, copy: copyTextV23, toast } = view;
    // 连接展示与诊断仅属于当前页面；清除配置时一并重置。
    let aiConnectionStateV99 = 'idle';
    let aiDiagnosticsVisibleV375 = false;
    let aiLastDiagnosticV375 = null;
    function defaultAiConfigV99() {
      return { provider: 'ollama', endpoint: AI_PROVIDER_PRESETS_V99.ollama.endpoint, model: '', timeoutSeconds: 120, rememberKey: false };
    }

    function normalizeAiConfigV99(value) {
      const raw = value && typeof value === 'object' ? value : {};

      const provider = AI_PROVIDER_PRESETS_V99[raw.provider] ? raw.provider : 'ollama';

      const timeout = Math.min(600, Math.max(10, Number(raw.timeoutSeconds || 120) || 120));

      return { provider, endpoint: String(raw.endpoint || AI_PROVIDER_PRESETS_V99[provider].endpoint || '').trim(), model: String(raw.model || '').trim(), timeoutSeconds: timeout, rememberKey: !!raw.rememberKey };
    }

    function aiProviderLabelV99(provider) {
      return AI_PROVIDER_PRESETS_V99[provider]?.label || '自定义接口';
    }

    function aiHarnessLabelV99(adapter) {
      switch (adapter) {
        case 'codex'
          :return 'Codex';
        case 'codebuddy'
          :return 'CodeBuddy';
        case 'deepseek'
          :return 'DeepSeek';
        default:return '未知 Harness';
      }
    }

    function isAiHarnessExecutionV99(execution) {
      return execution?.mode === 'harness';
    }

    function aiHarnessTaskReasonV99(config, task) {
      if (!isAiHarnessExecutionV99(config.execution)) {
        return '';
      }

      if (config.execution.adapter === 'codex') {
        return '';
      }

      if (config.execution.adapter === 'codebuddy') {
        return ['connection_test', 'question_analysis', 'question_followup'].includes(task) ? '' : 'CodeBuddy 当前支持连接测试、单题解析和追问；尚未开放批量与导入任务。';
      }

      return `${aiHarnessLabelV99(config.execution.adapter)} 当前尚未开放模型执行，本次不会发送题目内容。`;
    }

    function aiUnavailableReasonV99(config, task) {
      if (isAiHarnessExecutionV99(config.execution)) {
        return aiHarnessTaskReasonV99(config, task) || config.execution.reason || '所选 Harness 尚未就绪，请检查 AI 设置。';
      }
      return '尚未配置 AI 服务，请先前往“AI 设置”。';
    }

    function aiHarnessPrivacyV99(config, subject) {
      if (config.execution?.adapter === 'codex') {
        return `${subject}将经 Codex 发送到 OpenAI，使用已登录的订阅额度。`;
      }

      if (config.execution?.adapter === 'codebuddy') {
        return aiConfiguredV99(config, 'question_analysis') ? `${subject}将发送到 CodeBuddy，使用当前个人账户并消耗账户用量。` : 'CodeBuddy 组件或账户尚未就绪，本次不会发送题目内容。';
      }

      return `${aiHarnessLabelV99(config.execution?.adapter)} 当前尚未开放模型执行，本次不会发送题目内容。`;
    }

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

    function aiConfiguredV99(config, task = 'connection_test') {
      if (!isAiHarnessExecutionV99(config.execution)) {
        return !!(config.endpoint && config.model);
      }

      if (aiHarnessTaskReasonV99(config, task) || !config.execution.ready) {
        return false;
      }

      return config.execution.adapter === 'codex' || (Number.isSafeInteger(config.execution.accountRevision) && config.execution.accountRevision >= 0);
    }

    function aiAvailabilityV99(config, task = 'connection_test') {
      const unsupported = aiHarnessTaskReasonV99(config, task);
      if (unsupported) { return { state: 'unsupported', reason: unsupported }; }
      if (isAiHarnessExecutionV99(config.execution)) {
        const { readiness } = config.execution;
        if (readiness === 'checking' || readiness === 'error' || readiness === 'blocked') {
          return { state: readiness, reason: config.execution.reason || 'AI 状态尚未确认。', retryable: config.execution.readinessRetryable !== false };
        }
        if (!aiConfiguredV99(config, task)) { return { state: 'action_required', reason: aiUnavailableReasonV99(config, task) }; }
      } else if (!aiConfiguredV99(config, task)) {
        return { state: 'unconfigured', reason: aiUnavailableReasonV99(config, task) };
      }
      return { state: 'ready', reason: '' };
    }

    function aiExecutionLabelV99(config) {
      if (!isAiHarnessExecutionV99(config.execution)) {
        return aiProviderLabelV99(config.provider);
      }

      const label = aiHarnessLabelV99(config.execution.adapter);
      return label === '未知 Harness' ? label : `${label} Harness`;
    }

    function aiRequestConfigV99(config) {
      return isAiHarnessExecutionV99(config.execution) ? config : { ...config, apiKey: readStoredAiKeyV99(config) };
    }

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
        throw new Error('接口地址格式不正确，请填写完整的 http:// 或 https:// 地址。', { cause: error });
      }
      if (!/^https?:$/.test(url.protocol)) {
        throw new Error('接口地址只支持 http:// 或 https://。');
      }

      const path = url.pathname.replace(/\/+$/, '');

      if (!path || path === '/') {
        url.pathname = '/v1/chat/completions';
      } else if (/\/v1$/i.test(path)) {
        url.pathname = `${path}/chat/completions`;
      }

      url.hash = '';

      return url.toString().replace(/\/$/, '');
    }

    function isLocalAiEndpointV99(endpoint) {
      try {
        const host = new URL(endpoint).hostname.toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
      } catch {
        return false;
      }
    }

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
        throw new Error('请填写 AI 接口地址。');
      }

      if (!model) {
        throw new Error('请填写模型名称。');
      }

      return { provider, endpoint, model, timeoutSeconds, rememberKey, apiKey };
    }

    function setAiSettingsStatusV99(message, type = '') {
      const el = $('#ai-settings-status-v99');
      if (!el) {
        return;
      }

      el.textContent = message;
      el.className = `notice${type ? ` ${type}` : ''}`;
    }

    function aiCurrentOriginV375() {
      try {
        return location.origin && location.origin !== 'null' ? location.origin : location.href.split('#')[0];
      } catch {
        return '当前页面';
      }
    }

    function aiEndpointHostV375(endpoint) {
      try {
        return new URL(endpoint).host;
      } catch {
        return '';
      }
    }

    function sanitizeAiDiagnosticDetailV375(text, config) {
      let detail = String(text || '').replace(/\s+/g, ' ').trim();

      if (config) {
        detail = ShirohaPlatform.credentials.redact(config, detail);
      }

      return detail.slice(0, 520);
    }

    function aiOllamaCorsCommandV375(diag) {
      if (ShirohaPlatform.credentials.native || !diag || diag.provider !== 'ollama') {
        return '';
      }

      const origin = /^https?:\/\//i.test(diag.origin || '') ? diag.origin : '';

      const origins = [origin, 'http://localhost', 'http://127.0.0.1', 'http://localhost:*', 'http://127.0.0.1:*'].filter(Boolean).join(',');

      return `setx OLLAMA_ORIGINS "${origins}"\n\n然后完全退出并重新启动 Ollama，再回到 Shiroha Quiz 点击“测试连接”。`;
    }

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

      const network = !!error?.network || /Failed to fetch|Load failed|NetworkError|ERR_FAILED/i.test(rawDetail || error?.message || '');

      const nativeErrors = {
        binding_required: ['凭据绑定已变化', '重新输入当前服务的 API Key，再保存设置。'],
        credential_pending: ['凭据保存尚未完成', '等待保存完成；仍失败时请重新保存设置。'],
        credential_unavailable: ['系统凭据不可用', '检查 Windows 凭据管理器是否可用，再重新保存设置。'],
        configuration_not_committed: ['配置尚未保存', '先保存当前服务配置，再重新测试连接。'],
        invalid_service_config: ['服务配置不正确', '核对完整接口地址；地址不能包含账号、密码、查询参数或片段。'],
        invalid_input: ['请求参数不正确', '核对接口地址、模型名称和 API Key 后重试。'],
        redirect_denied: ['服务重定向被拒绝', '将接口地址改为服务实际使用的最终 Chat Completions 地址。'],
        network_scope_denied: ['服务重定向超出允许范围', '核对服务的最终接口地址，避免跨站重定向。'],
        network_denied: ['当前环境禁止访问该服务', '确认正在运行正常桌面版本；测试版本仅允许连接隔离测试服务。'],
        payload_too_large: ['请求内容过大', '减少本次发送的题目或文本后重试。'],
        response_too_large: ['接口响应过大', '减少请求规模，并检查接口是否返回异常的大量内容。'],
        invalid_response: ['接口响应无效', '确认接口返回 UTF-8 编码的 Chat Completions 响应。'],
      };

      const nativeError = native ? nativeErrors[code] : null;

      let summary = '连接状态待确认';
      let statusMessage = '尚未测试连接。';
      let level = '';
      let steps;
      if (mode === 'ok') {
        summary = '连接测试成功';
        level = 'ok';
        statusMessage = '连接测试成功。请点击“保存设置”，导入页才会使用当前配置。';

        steps = ['当前接口已能返回有效响应。', native ? '如更换模型、地址或 API Key 后，请重新测试。' : '如更换模型、地址或跨域配置后，请重新测试。'];
      } else if (code === 'timeout' || (!status && /超过\s*\d+\s*秒/.test(error?.message || ''))) {
        summary = '请求超时';
        level = 'warn';
        statusMessage = error.message || 'AI 请求超时，请检查服务连接。';
        steps = ['确认模型已经加载完成。', '适当增加请求超时时间。', '本地小显存模型首次响应可能较慢。'];
      } else if (code === 'cancelled' || error?.name === 'AbortError') {
        summary = '请求已取消';
        level = 'warn';
        statusMessage = error.message || 'AI 请求已取消。';
        steps = ['需要继续时，请重新测试连接。'];
      } else if (nativeError) {
        summary = nativeError[0];
        level = 'warn';
        statusMessage = error.message || summary;
        steps = [nativeError[1]];
      } else if (native && (code === 'network_unavailable' || network)) {
        summary = local ? '无法连接本地 AI 服务' : '无法连接 AI 服务';
        level = 'warn';
        statusMessage = error.message || '无法连接 AI 服务，请检查地址、证书和网络。';

        steps = [local ? '确认本地 AI 服务正在运行且监听对应地址和端口。' : '确认接口域名可解析、证书受信任且当前网络能够连接服务。', '核对接口地址及服务端日志后重新测试。'];
      } else if (network) {
        summary = local ? '疑似 CORS 拦截、本地服务未启动或地址不可达' : '浏览器无法访问该接口';
        level = 'warn';

        statusMessage = local ? '无法访问本地 AI 接口。请检查服务是否启动、地址是否正确，以及是否允许当前网页跨域访问。' : '无法访问 AI 接口。请检查网络、地址、HTTPS/HTTP 混用和接口跨域设置。';

        steps = local ? ['确认 Ollama / LM Studio 正在运行。', '确认接口地址和端口正确。', '如果当前页面来自 GitHub Pages，需要在本地 AI 服务里允许该页面 Origin 跨域访问。', '设置跨域后要完全重启本地 AI 服务，再重新测试。'] : ['确认接口地址能从当前浏览器访问。', '确认服务端允许当前网页跨域请求。', '如果是远程服务，优先使用自己的后端代理转发请求，避免在纯前端暴露密钥。'];
      } else if (status === 401) {
        summary = '鉴权失败';
        level = 'warn';
        statusMessage = '鉴权失败，请检查 API Key 或服务权限。';
        steps = ['确认 API Key 是否填写正确。', '本地 Ollama 通常不需要 API Key，可以留空。', '如果是远程 OpenAI-compatible 服务，请确认 Key 仍有效且有模型调用权限。'];
      } else if (status === 403) {
        if (native) {
          summary = '服务拒绝访问';
          level = 'warn';
          statusMessage = 'AI 服务拒绝访问，请检查 API Key、模型权限或服务端访问限制。';
          steps = ['确认 API Key 有效且允许调用当前模型。', '检查服务端 IP 白名单、访问权限和日志。'];
        } else {
          summary = local ? '本地服务拒绝当前网页访问，优先检查 CORS / Origin' : '服务拒绝访问';
          level = 'warn';
          statusMessage = local ? '本地 AI 服务拒绝当前网页访问，优先检查 OLLAMA_ORIGINS 或服务端跨域设置。' : 'AI 服务拒绝访问，请检查权限、来源限制或跨域设置。';
          steps = local ? ['如果使用 Ollama，请把当前页面 Origin 加入 OLLAMA_ORIGINS。', '如果使用 LM Studio，请检查本地服务器是否开启跨域访问。', '修改后完全重启本地 AI 服务。'] : ['确认账号、Key、IP 白名单和 Origin 白名单。', '确认当前模型是否允许被调用。'];
        }
      } else if (status === 404) {
        summary = '接口路径不存在';
        level = 'warn';
        statusMessage = '接口不存在或路径不正确，请检查 Chat Completions 地址。';
        steps = ['Ollama / LM Studio 的 OpenAI-compatible 地址通常应以 /v1/chat/completions 结尾。', '如果只填到 /v1，本页面会自动补全为 /v1/chat/completions。', '确认服务端版本是否支持 Chat Completions。'];
      } else if (status === 405) {
        summary = '接口不支持当前请求方法';
        level = 'warn';
        statusMessage = '接口不支持 Chat Completions POST 请求，请检查地址或服务类型。';
        steps = ['不要填写浏览器管理页面地址，应填写 API 地址。', '确认目标接口支持 POST /v1/chat/completions。'];
      } else if (status === 400 || status === 422) {
        summary = '请求格式或模型名称可能不匹配';
        level = 'warn';
        statusMessage = '接口已响应，但请求格式或模型名称可能不匹配。';
        steps = ['确认模型名称与本地服务中显示的模型名称完全一致。', '如果服务不支持 response_format，本页面已自动重试普通 JSON 请求；仍失败时请查看错误详情。'];
      } else if (status === 429) {
        summary = '请求频率或额度受限';
        level = 'warn';
        statusMessage = '请求过于频繁或账户额度不足。';
        steps = ['稍后重试。', '如果是远程服务，请检查账户额度、速率限制和模型权限。'];
      } else if (status >= 500) {
        summary = 'AI 服务内部错误';
        level = 'warn';
        statusMessage = 'AI 服务内部错误，请稍后重试或查看本地服务日志。';
        steps = ['检查模型是否已成功加载。', '查看本地 AI 服务控制台日志。', '降低模型或上下文规模后重试。'];
      } else if (error) {
        summary = '连接测试失败';
        level = 'warn';
        statusMessage = error.message || '连接测试失败。';
        steps = ['检查服务是否启动、地址是否正确、模型名称是否存在。', native ? '根据错误摘要检查桌面服务和接口状态后重试。' : '如果浏览器控制台出现 CORS、Origin 或 Failed to fetch，按跨域问题处理。'];
      } else {
        steps = ['填写接口地址和模型名称后点击“测试连接”。', native ? '桌面通过原生网络连接服务，请确认地址、模型和 API Key 正确。' : '如果使用 GitHub Pages 访问本地服务，通常还需要本地服务允许跨域访问。'];
      }

      return { time: new Date().toLocaleString('zh-CN', { hour12: false }), mode, provider, providerLabel, endpoint, host: aiEndpointHostV375(endpoint), origin, local, status: status || '', statusLabel: status ? `HTTP ${status}` : '无 HTTP 状态', summary, statusMessage, level, detail: rawDetail || '无额外错误详情', steps };
    }

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
        const rows = [['接口地址', diag.endpoint || '未填写'], ['当前页面', diag.origin], ['服务类型', diag.providerLabel], ['主机', diag.host || '未识别'], ['HTTP 状态', diag.statusLabel], ['判断结果', diag.summary], ['错误摘要', diag.detail]];

        body.innerHTML = `<div class="ai-diagnostics-grid-v375">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b title="${esc(v)}">${esc(v)}</b></div>`).join('')}</div><div class="notice ${diag.level === 'ok' ? 'ok' : 'warn'} ai-diagnostics-advice-v375"><b>${esc(diag.statusMessage)}</b><ol>${(diag.steps || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>`;
      }

      const toggle = $('#ai-toggle-diagnostics-v375');
      if (toggle) {
        toggle.textContent = aiDiagnosticsVisibleV375 ? '隐藏诊断' : '显示诊断';
      }

      const copyCors = $('#ai-copy-ollama-cors-v375');
      if (copyCors) {
        copyCors.classList.toggle('ai-hidden-v99', !aiOllamaCorsCommandV375(diag));
      }
    }

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

      const text = ['Shiroha Quiz AI 连接诊断', `时间：${diag.time}`, `服务类型：${diag.providerLabel}`, `接口地址：${diag.endpoint || '未填写'}`, `当前页面：${diag.origin}`, `HTTP 状态：${diag.statusLabel}`, `判断结果：${diag.summary}`, `错误摘要：${diag.detail}`, '建议：', ...(diag.steps || []).map((x, i) => `${i + 1}. ${x}`)].join('\n');

      copyTextV23(text, '已复制 AI 连接诊断。');
    }

    function copyAiOllamaCorsCommandV375() {
      const diag = aiLastDiagnosticV375 || buildAiDiagnosticV375(null, ensureAiImportStateV99(), 'idle');

      const command = aiOllamaCorsCommandV375(diag);
      if (!command) {
        toast('当前诊断不需要 Ollama 跨域命令。', 'warn');
        return;
      }

      copyTextV23(command, '已复制 Ollama 跨域命令。');
    }

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
        pill.textContent = '正在检查';
      } else if (config.execution?.readiness === 'error' || config.execution?.readiness === 'blocked') {
        pill.textContent = '检查未完成';
        pill.classList.add('is-error');
      } else if (status === 'ok') {
        pill.textContent = '连接正常';
        pill.classList.add('is-ok');
      } else if (status === 'error') {
        pill.textContent = '连接失败';
        pill.classList.add('is-error');
      } else if (configured) {
        pill.textContent = '已配置';
        pill.classList.add('is-ready');
      } else {
        pill.textContent = '未配置';
      }
    }

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
        key.placeholder = readStoredAiKeyV99(config) ? '已保存；留空保留，输入可替换' : 'API Key（可选）';
      }

      updateAiConnectionPillV99();

      renderAiDiagnosticV375();

      ShirohaPlatform.harness?.render();
    }
    function setState(connection, diagnostic) {
      aiConnectionStateV99 = connection;
      aiLastDiagnosticV375 = diagnostic;
    }
    function reset() {
      aiConnectionStateV99 = 'idle';
      aiLastDiagnosticV375 = null;
      aiDiagnosticsVisibleV375 = false;
    }
    return { defaultAiConfigV99, normalizeAiConfigV99, aiProviderLabelV99, isAiHarnessExecutionV99, aiHarnessLabelV99, aiHarnessTaskReasonV99, aiUnavailableReasonV99, aiHarnessPrivacyV99, aiExecutionConfigV99, aiConfiguredV99, aiAvailabilityV99, aiExecutionLabelV99, aiRequestConfigV99, normalizeAiEndpointV99, isLocalAiEndpointV99, readAiFormV99, setAiSettingsStatusV99, sanitizeAiDiagnosticDetailV375, aiOllamaCorsCommandV375, buildAiDiagnosticV375, renderAiDiagnosticV375, setAiDiagnosticV375, toggleAiDiagnosticV375, copyAiDiagnosticV375, copyAiOllamaCorsCommandV375, updateAiConnectionPillV99, renderAiSettingsV99, setState, reset };
  }
  const AI_PROVIDER_PRESETS_V99_DEFAULT = AI_PROVIDER_PRESETS_V99;
  globalThis.ShirohaAiSettings = Object.freeze({ create, presets: AI_PROVIDER_PRESETS_V99 });
})();
