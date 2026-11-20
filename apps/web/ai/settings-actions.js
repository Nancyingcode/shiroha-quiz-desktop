// 将 AI 设置写入、凭据结算和连接请求绑定到当前应用事务与设置面板。
(() => {
  'use strict';

  // 只组装按钮动作，实际表单读取和原生调用均在用户发起操作后执行。
  function create({
    platform,
    settings,
    transport,
    storage,
    confirm,
    isBusy,
    syncImportAction,
    showNotice,
  }) {
    const { credentials, harness } = platform;
    const {
      defaultAiConfigV99,
      readAiFormV99,
      setAiSettingsStatusV99,
      setConnectionTestingV99,
      aiHarnessLabelV99,
      aiHarnessTaskReasonV99,
      aiConfiguredV99,
      buildAiDiagnosticV375,
      setAiDiagnosticV375,
      updateAiConnectionPillV99,
      renderAiSettingsV99,
      renderSavedApiSettingsV99,
      reset,
    } = settings;
    const { requestAiChatV99, withAiTimeoutV99 } = transport;
    const {
      readConfig,
      setConfig,
      transaction,
      save,
      recordSaveError,
    } = storage;

    // 切换失败时已提交的 API 配置仍可供下次切换使用。
    async function activateApiMode() {
      if (!harness) {
        return true;
      }

      try {
        await harness.saveMode('api');
        return true;
      } catch (error) {
        // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
        setAiSettingsStatusV99('API 配置已保存，但执行方式切换失败，原执行方式仍生效：' + (error.message || error), 'warn');
        return false;
      }
    }

    // 将 API 设置及凭据写入纳入同一次保存，失败后恢复原设置。
    async function saveApiSettings() {
      const previousConfig = { ...readConfig() };
      try {
        const config = readAiFormV99();
        const {
          provider,
          endpoint,
          model,
          timeoutSeconds,
          rememberKey,
          apiKey,
        } = config;
        setConfig({ provider, endpoint, model, timeoutSeconds, rememberKey });
        const undoCredential = await credentials.set('ai', config, apiKey, rememberKey);
        try {
          await save(credentials.operationId?.(undoCredential));
        } catch (error) {
          setConfig(previousConfig);
          await undoCredential();
          throw error;
        }

        // 原生确认校验已保存的操作回执。这里失败时由保存事务判断实际修订，再由原生恢复处理暂存。
        await credentials.finalize?.(undoCredential);
        if (!await activateApiMode()) {
          return;
        }

        renderSavedApiSettingsV99(config);
        syncImportAction();
        showNotice('AI 设置', '设置已保存。', 'ok');
      } catch (error) {
        recordSaveError(error);
        setAiSettingsStatusV99(error.message || '保存失败。', 'warn');
        updateAiConnectionPillV99('error');
        showNotice('AI 设置', error.message || '保存失败。', 'danger');
      }
    }

    // AI 任务空闲后才保存执行配置，区分桌面 Harness 和 API 设置。
    async function saveAiSettingsV99() {
      if (isBusy()) {
        setAiSettingsStatusV99('AI 任务仍在执行或停止中，请等待结束后保存设置。', 'warn');
        return;
      }

      if (harness?.formMode() === 'harness') {
        try {
          await harness.saveMode('harness');
          setAiSettingsStatusV99('Harness 设置已保存；原直接 API 设置已保留。', 'ok');
          syncImportAction();
          updateAiConnectionPillV99('idle');
        } catch (error) {
          setAiSettingsStatusV99(error.message || 'Harness 设置保存失败。', 'warn');
        }

        return;
      }

      return transaction(saveApiSettings);
    }

    // 仅当前 Codex 可从共享入口清除。确认后先停止其任务，再清理配置与授权。
    async function clearHarnessSettings() {
      const execution = harness.snapshot();
      const adapter = harness.formAdapter?.() ?? execution.adapter;
      if (adapter !== 'codex') {
        setAiSettingsStatusV99(`${aiHarnessLabelV99(adapter)} 的账户操作请使用对应面板；其他提供方配置已保留。`, 'warn');
        return;
      }

      if (execution.adapter !== adapter) {
        setAiSettingsStatusV99('提供方选择尚未保存，请等待保存完成后再清除配置。', 'warn');
        return;
      }

      if (!await confirm('确定停止 Harness 任务并清除 Codex 配置和订阅授权？原直接 API 配置将保留。')) {
        return;
      }

      try {
        await harness.cancelAll();
        await harness.clear();
        setAiSettingsStatusV99('Codex 配置已清除；如需使用直接 API，请明确选择并保存执行方式。');
        updateAiConnectionPillV99('idle');
        syncImportAction();
      } catch (error) {
        setAiSettingsStatusV99(error.message || '清除失败。', 'warn');
      }
    }

    // 经用户确认后清除 API 配置及凭据，并用保存结果更新提示。
    async function clearApiSettings() {
      if (!await confirm('确定清除 AI 接口配置和已保存的 API Key？')) {
        return;
      }

      const undoCredential = await credentials.set('ai', readConfig(), '', false);
      setConfig(defaultAiConfigV99());
      try {
        await save(credentials.operationId?.(undoCredential));
      } catch (error) {
        await undoCredential();
        // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
        setAiSettingsStatusV99('清除失败，原配置已保留：' + (error.message || error), 'warn');
        return;
      }

      await credentials.finalize?.(undoCredential);
      reset();
      renderAiSettingsV99();
      setAiSettingsStatusV99('AI 配置已清除。');
      syncImportAction();
      showNotice('AI 设置', '配置已清除。', 'ok');
    }

    // 按执行模式清除相应 AI 设置，运行中的任务仍由各模式的状态约束。
    async function clearAiSettingsV99() {
      if (harness?.formMode() === 'harness') {
        return clearHarnessSettings();
      }

      if (isBusy()) {
        setAiSettingsStatusV99('请等待 AI 任务结束后清除配置。', 'warn');
        return undefined;
      }

      return transaction(clearApiSettings);
    }

    // 测试前核对当前执行方式与已保存的提供方，沿用 Harness 的就绪和结果校验。
    async function testHarnessConnection() {
      try {
        const execution = harness.snapshot();
        const adapter = harness.formAdapter?.() ?? execution.adapter;
        const unavailable = aiHarnessTaskReasonV99({ execution: { ...execution, adapter } }, 'connection_test');
        if (unavailable) {
          throw new Error(unavailable);
        }

        if (execution.mode !== 'harness' || execution.adapter !== adapter) {
          throw new Error('请先保存当前提供方和执行方式，再测试执行。');
        }

        if (!aiConfiguredV99({ execution }, 'connection_test')) {
          throw new Error(execution.reason || '当前 Harness 尚未就绪，请先检查设置。');
        }

        setConnectionTestingV99(true);
        await harness.test();
        setAiSettingsStatusV99(`${aiHarnessLabelV99(adapter)} 测试执行成功，结果已通过校验。`, 'ok');
        updateAiConnectionPillV99('ok', true);
      } catch (error) {
        setAiSettingsStatusV99(error.message || 'Harness 测试执行失败。', 'warn');
        updateAiConnectionPillV99('error');
      }
    }

    // 直连使用当前表单及诊断；测试内容固定，不带用户题库数据。
    async function testApiConnection() {
      let config = null;
      try {
        config = readAiFormV99();
        setConnectionTestingV99(true);
        setAiSettingsStatusV99('正在连接接口并调用所选模型……');
        setAiDiagnosticV375(buildAiDiagnosticV375(null, config, 'idle'));
        const messages = [
          { role: 'system', content: '只回复一个 JSON 对象。' },
          { role: 'user', content: '回复 {"ok":true}' },
        ];
        const result = await withAiTimeoutV99(
          config.timeoutSeconds,
          // 连接测试只检查接口是否响应，限制输出长度并允许没有模型正文的 JSON。
          (controller) => requestAiChatV99(config, messages, {
            controller,
            maxTokens: 32,
            testMode: true,
            task: 'connection_test',
          }),
        );
        if (!result.payload) {
          throw new Error('接口没有返回有效结果。');
        }

        const diag = buildAiDiagnosticV375(null, config, 'ok');
        updateAiConnectionPillV99('ok', true);
        setAiDiagnosticV375(diag);
        setAiSettingsStatusV99(diag.statusMessage, 'ok');
        showNotice('AI 连接', '连接测试成功。', 'ok');
      } catch (error) {
        const diag = config ? buildAiDiagnosticV375(error, config, 'error') : null;
        updateAiConnectionPillV99('error', !!config);
        if (diag) {
          setAiDiagnosticV375(diag, true);
        }

        setAiSettingsStatusV99(diag?.statusMessage || error.message || '连接测试失败。', 'warn');
        showNotice('AI 连接', diag?.summary || error.message || '连接测试失败。', 'danger');
      }
    }

    // 使用触发时的执行方式发起测试；完成时由面板按当前模式恢复控件。
    async function testAiConnectionV99() {
      try {
        if (harness?.formMode() === 'harness') {
          await testHarnessConnection();
        } else {
          await testApiConnection();
        }
      } finally {
        setConnectionTestingV99(false);
      }
    }

    return { saveAiSettingsV99, clearAiSettingsV99, testAiConnectionV99 };
  }

  globalThis.ShirohaAiSettingsActions = Object.freeze({ create });
})();
