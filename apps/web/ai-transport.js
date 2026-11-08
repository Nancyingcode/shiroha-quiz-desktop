(() => {
  'use strict';

  function create({ platform, harness, response }) {
    async function requestAiChatV99(config, messages, { controller, maxTokens, testMode, plainText, task } = {}) {
      if (harness.isHarness(config.execution)) {
        if (!platform.harness) { throw new Error('当前平台不支持 Harness，请在桌面端配置。'); }
        const unavailable = harness.taskReason(config, task);
        if (unavailable) { throw new Error(unavailable); }
        if (config.execution.adapter === 'codebuddy' && !harness.configured(config, task)) {
          throw new Error(harness.unavailableReason(config, task));
        }
        return platform.harness.execute(config.execution, task, messages, controller?.signal);
      }
      const base = { model: config.model, messages, temperature: 0, stream: false };
      if (maxTokens) { base.max_tokens = maxTokens; }
      const attempts = plainText ? [base] : [{ ...base, response_format: { type: 'json_object' } }, base];
      let lastError = null;
      for (let index = 0; index < attempts.length; index += 1) {
        let result;
        try {
          result = await platform.network.ai(config, attempts[index], controller?.signal);
        } catch (error) {
          if (error?.name === 'AbortError' || platform.credentials.native) { throw error; }
          const failure = new Error('无法访问 AI 接口。请检查服务是否启动、地址是否正确，以及接口是否允许浏览器跨域访问。');
          failure.cause = error;
          failure.network = true;
          failure.aiStage = 'fetch';
          failure.endpoint = config.endpoint;
          failure.provider = config.provider;
          throw failure;
        }
        const raw = await result.text();
        if (controller?.signal?.aborted) {
          // 响应体读取后重新确认取消，避免忽略信号的传输触发格式回退或交付迟到结果。
          const error = new Error('AI 请求已取消。');
          error.name = 'AbortError';
          throw error;
        }
        if (result.ok) {
          let payload;
          try {
            payload = raw ? JSON.parse(raw) : {};
          } catch {
            const failure = new Error('接口已响应，但返回内容不是有效 JSON。');
            failure.aiStage = 'json';
            failure.endpoint = config.endpoint;
            failure.provider = config.provider;
            failure.detail = raw.replace(/\s+/g, ' ').slice(0, 400);
            throw failure;
          }
          const content = response.content(payload);
          if (!content && !testMode) {
            const failure = new Error('接口返回成功，但没有找到模型输出内容。');
            failure.aiStage = 'empty';
            failure.endpoint = config.endpoint;
            failure.provider = config.provider;
            throw failure;
          }
          return { payload, content };
        }
        const detail = raw.replace(/\s+/g, ' ').slice(0, 400);
        const error = new Error(response.httpErrorMessage(result.status, detail));
        error.status = result.status;
        error.detail = detail;
        error.endpoint = config.endpoint;
        error.provider = config.provider;
        error.aiStage = 'http';
        lastError = error;
        const canRetryWithoutResponseFormat = index === 0 && (result.status === 400 || result.status === 422);
        if (canRetryWithoutResponseFormat) { continue; }
        throw error;
      }
      throw lastError || new Error('AI 请求失败。');
    }

    async function withAiTimeoutV99(timeoutSeconds, runner) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, Math.max(10, timeoutSeconds) * 1000);
      try {
        const value = await runner(controller);
        if (timedOut) { throw new Error(`AI 请求超过 ${timeoutSeconds} 秒，已自动停止。`); }
        return value;
      } catch (error) {
        if (error?.name !== 'AbortError' || !timedOut) { throw error; }
      } finally {
        clearTimeout(timer);
      }
      throw new Error(`AI 请求超过 ${timeoutSeconds} 秒，已自动停止。`);
    }

    return { requestAiChatV99, withAiTimeoutV99 };
  }

  globalThis.ShirohaAiTransport = Object.freeze({ create });
})();
