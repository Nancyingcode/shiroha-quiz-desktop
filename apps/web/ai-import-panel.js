// 协调导入整理、预览建议与 AI 设置间的页面操作。
(() => {
  'use strict';
  // 将导入页的草稿、会话、界面及副作用绑定到同一面板。
  function create({
    draft: importDraft,
    sessions: aiImportSessions,
    platform: ShirohaPlatform,
    select: $,
    selectAll: $$,
    escape: esc,
    label,
    toast,
    showNotice,
    settings,
    requests,
    editor,
    preview,
    limits,
  }) {
    const {
      presets: AI_PROVIDER_PRESETS_V99,
      config: aiExecutionConfigV99,
      configured: aiConfiguredV99,
      availability: aiAvailabilityV99,
      isHarness: isAiHarnessExecutionV99,
      executionLabel: aiExecutionLabelV99,
      privacy: aiHarnessPrivacyV99,
      localEndpoint: isLocalAiEndpointV99,
      updatePill: updateAiConnectionPillV99,
      render: renderAiSettingsV99,
      toggleDiagnostic: toggleAiDiagnosticV375,
      copyDiagnostic: copyAiDiagnosticV375,
      copyCors: copyAiOllamaCorsCommandV375,
      save: saveAiSettingsV99,
      test: testAiConnectionV99,
      clear: clearAiSettingsV99,
    } = settings;
    const {
      busy: aiTasksBusyV99,
      startImport: startAiImportV99,
      cancelImport: cancelAiImportRequestV99,
      invalidateImport: invalidateAiImportRequestV99,
      startPreview: startAiPreviewTaskV991,
      cancelPreview: cancelAiPreviewRequestV991,
    } = requests;
    const { isEditing: isEditingBank, openQuestion: openEditQuestion, normalizeQuestion } = editor;
    const {
      status: importIssueStatus,
      key: aiQuestionKeyV991,
      findIndex: findImportIndexByAiKeyV991,
      render: renderImportPreview,
      renderPracticeAi: renderPracticeAiPanelV613,
      updateReview,
      switchView: switchViewV45,
    } = preview;
    const {
      importChars: AI_IMPORT_MAX_CHARS_V99,
      items: AI_PREVIEW_MAX_ITEMS_V991,
      analysisBatch: AI_ANALYSIS_DEFAULT_BATCH_V991,
      reviewBatch: AI_REVIEW_DEFAULT_BATCH_V991,
    } = limits;
    // 文本选择与预览范围只属于当前导入页；重新输入时丢弃旧选择。
    let aiPreviewPanelModeV991 = 'review';
    let aiImportTextSelectionV992 = { start: 0, end: 0, text: '' };
    // 选项状态只属于当前选择框和模式；节点替换或模式变化时重新构建。
    let aiPreviewScopeNodeV991 = null;
    let aiPreviewScopeModeV991 = '';
    const importOrPreviewBusy = () => !!aiImportSessions.importRequest.running || !!aiImportSessions.previewRequest.running;

    // 切换服务商时仅替换空值或默认端点，保留用户填写的自定义地址。
    function changeAiProvider(event) {
      const provider = event.currentTarget;
      const endpoint = $('#ai-endpoint-v99');
      if (!endpoint) {
        return;
      }

      const presets = Object.values(AI_PROVIDER_PRESETS_V99).map((x) => x.endpoint).filter(Boolean);
      if (!endpoint.value.trim() || presets.includes(endpoint.value.trim()) || endpoint.value.trim() === endpoint.dataset.lastPreset) {
        endpoint.value = AI_PROVIDER_PRESETS_V99[provider.value]?.endpoint || '';
      }

      endpoint.dataset.lastPreset = AI_PROVIDER_PRESETS_V99[provider.value]?.endpoint || '';
    }

    // 运行时取消整理请求，空闲时关闭整理面板。
    function cancelImportOrClose() {
      if (aiImportSessions.importRequest.running) {
        cancelAiImportRequestV99(false);
      } else {
        closeAiImportPanelV99();
      }
    }

    // 运行时取消批次，空闲时关闭建议面板。
    function cancelPreviewOrClose() {
      if (aiImportSessions.previewRequest.running) {
        cancelAiPreviewRequestV991(false);
      } else {
        closeAiPreviewPanelV991();
      }
    }

    // 服务就绪状态改变时刷新每个可见入口，让待检查的按钮同步恢复。
    function syncHarnessPanels() {
      updateAiConnectionPillV99('idle');
      syncAiImportActionV99();
      renderPracticeAiPanelV613();
      updateReview?.();
    }

    // 修改范围时让旧整理结果失效，并按需刷新用户看到的范围说明。
    function handleImportScopeChange() {
      const invalidationWillSync = aiImportSessions.importRequest.running;
      invalidateAiImportRequestV99();
      if (!invalidationWillSync) { refreshAiImportPanelV99(); }
    }

    // 只给同一个原文节点接线一次，避免重复捕获选区和取消请求。
    function bindImportTextSelection() {
      const importText = $('#import-text');
      if (importText && !importText.dataset.aiSelectionBoundV992) {
        importText.dataset.aiSelectionBoundV992 = '1';
        // 抓取选区后判断是否需要取消在途整理，仅在它未主动刷新时更新面板。
        const capture = () => {
          const previous = aiImportTextSelectionV992;
          captureAiImportSelectionV992();
          const changed = previous.start !== aiImportTextSelectionV992.start || previous.end !== aiImportTextSelectionV992.end
            || previous.text !== aiImportTextSelectionV992.text;
          const selectionChanged = changed && aiImportScopeV992() === 'selection';
          const invalidationWillSync = selectionChanged && aiImportSessions.importRequest.running;
          if (selectionChanged) {
            invalidateAiImportRequestV99();
            if (!invalidationWillSync) { correctInvalidAiImportSelectionV992(); }
          }

          if (!invalidationWillSync && !$('#ai-import-panel-v99')?.classList.contains('ai-hidden-v99')) {
            refreshAiImportPanelV99();
          }
        };

        importText.addEventListener('select', capture);
        importText.addEventListener('mouseup', capture);
        importText.addEventListener('keyup', capture);
        importText.addEventListener(
          'input',
          // 改写原文时同步丢弃旧选区，运行中的任务自行刷新状态。
          () => {
            const invalidationWillSync = aiImportSessions.importRequest.running;
            aiImportTextSelectionV992 = { start: 0, end: 0, text: '' };
            invalidateAiImportRequestV99();
            if (!invalidationWillSync) { syncAiImportActionV99(); }
          },
        );
      }

      $$('input[name="ai-import-scope-v992"]').forEach((input) => input.onchange = handleImportScopeChange);
    }

    // 在导入页初始化时接入设置、模型就绪通知及当前草稿操作。
    function bindAiImportEventsV99() {
      // 统一的事件属性绑定，避免每处重复“查询 → 判空 → 赋值”；仍用 on* 属性保持覆盖语义。
      const bindEvent = (selector, eventName, handler) => {
        const element = $(selector);
        if (element) {
          element[eventName] = handler;
        }
      };

      const bindClick = (selector, handler) => bindEvent(selector, 'onclick', handler);

      const bindChange = (selector, handler) => bindEvent(selector, 'onchange', handler);

      const bindInput = (selector, handler) => bindEvent(selector, 'oninput', handler);

      ShirohaPlatform.harness?.bind(syncHarnessPanels, aiTasksBusyV99);

      bindChange('#ai-provider-v99', changeAiProvider);

      bindClick('#ai-save-settings-v99', saveAiSettingsV99);
      bindClick('#ai-test-connection-v99', testAiConnectionV99);
      bindClick('#ai-toggle-diagnostics-v375', toggleAiDiagnosticV375);
      bindClick('#ai-copy-diagnostics-v375', copyAiDiagnosticV375);
      bindClick('#ai-copy-ollama-cors-v375', copyAiOllamaCorsCommandV375);
      bindClick('#ai-clear-settings-v99', clearAiSettingsV99);
      bindClick('#ai-organize-import-btn-v99', openAiImportPanelV99);
      bindClick('#ai-import-start-btn-v99', startAiImportV99);
      bindClick('#ai-import-cancel-btn-v99', cancelImportOrClose);

      bindClick('#ai-import-settings-btn-v99', () => openSettingsOrRetry('import_organize'));

      bindClick('#ai-review-import-btn-v991', () => openAiPreviewPanelV991('review'));

      bindClick('#ai-analysis-import-btn-v991', () => openAiPreviewPanelV991('analysis'));

      bindClick('#ai-preview-start-btn-v991', startAiPreviewTaskV991);
      bindClick('#ai-preview-cancel-btn-v991', cancelPreviewOrClose);

      bindClick('#ai-preview-settings-btn-v991', () => openSettingsOrRetry(aiPreviewPanelModeV991 === 'analysis' ? 'batch_analysis' : 'batch_review'));

      bindImportTextSelection();

      // 预览筛选条件变化必须先丢弃粘性状态再重渲染，共用一个处理器避免各处分支漂移。
      const refreshAiPreviewOnFilterChangeV991 = () => {
        clearAiPreviewStatusStickyV991();
        refreshAiPreviewPanelV991();
      };

      bindChange('#ai-preview-scope-v991', refreshAiPreviewOnFilterChangeV991);
      bindChange('#ai-preview-condition-v992', refreshAiPreviewOnFilterChangeV991);
      bindInput('#ai-preview-range-start-v992', refreshAiPreviewOnFilterChangeV991);
      bindInput('#ai-preview-range-end-v992', refreshAiPreviewOnFilterChangeV991);
      bindInput('#ai-preview-batch-v991', refreshAiPreviewOnFilterChangeV991);
      renderAiSettingsV99();
      syncAiImportActionV99();
    }

    // 若后台检查可以恢复就直接重试，否则导航至配置页。
    async function openSettingsOrRetry(task) {
      const availability = aiAvailabilityV99(aiExecutionConfigV99(), task);
      if (availability.retryable) {
        await ShirohaPlatform.harness?.retryReadiness();
      } else {
        await switchViewV45('ai-settings');
      }
    }

    // 同步正在运行的任务与当前可见面板，同时修正失效选区。
    function syncAiImportActionV99() {
      correctInvalidAiImportSelectionV992();
      const busy = importOrPreviewBusy();
      const btn = $('#ai-organize-import-btn-v99');
      if (btn) {
        btn.disabled = busy;
        btn.textContent = aiImportSessions.importRequest.running ? 'AI 整理中……' : 'AI 辅助整理';
      }

      if (!$('#ai-import-panel-v99')?.classList.contains('ai-hidden-v99')) {
        refreshAiImportPanelV99();
      }

      syncAiPreviewToolsV991();
    }

    function closeAiImportPanelV99() {
      const panel = $('#ai-import-panel-v99');
      if (panel) {
        panel.classList.add('ai-hidden-v99');
      }
    }

    // 在焦点离开原文前保存选区两端和原文字面，供整理入口随后核对。
    function captureAiImportSelectionV992() {
      const field = $('#import-text');
      if (!field) {
        return '';
      }

      const start = Math.max(0, Number(field.selectionStart || 0));
      const end = Math.max(start, Number(field.selectionEnd || 0));
      const text = end > start ? String(field.value || '').slice(start, end) : '';
      aiImportTextSelectionV992 = text.trim() ? { start, end, text } : { start: 0, end: 0, text: '' };
      return text;
    }

    // 只有文本仍与抓取时一致才承认选区，避免发送已经编辑过的原文。
    function currentAiImportSelectionV992() {
      const field = $('#import-text');
      if (!field) {
        return '';
      }

      const value = String(field.value || '');
      const { start, end, text } = aiImportTextSelectionV992;
      if (end <= start || !text || value.slice(start, end) !== text) {
        return '';
      }

      return text.trim();
    }

    function correctInvalidAiImportSelectionV992() {
      const selectedInput = $('#ai-import-scope-selection-v992');
      const allInput = $('#ai-import-scope-all-v992');
      if (selectedInput?.checked && !currentAiImportSelectionV992() && allInput) { allInput.checked = true; }
    }

    function aiImportScopeV992() {
      return $('#ai-import-scope-selection-v992')?.checked ? 'selection' : 'all';
    }

    // 明确当前调用发送全文还是选区，并给会话提供对应的原文快照。
    function aiImportRangeV992() {
      const full = String($('#import-text')?.value || '');
      const scope = aiImportScopeV992();
      const selected = currentAiImportSelectionV992();
      if (scope === 'selection') {
        return {
          scope,
          text: selected,
          label: '当前选中文本',
          sourceText: full,
          selectionStart: aiImportTextSelectionV992.start,
          selectionEnd: aiImportTextSelectionV992.end,
        };
      }

      return {
        scope: 'all',
        text: full.trim(),
        label: '全部原始文本',
        sourceText: full,
      };
    }

    // 原文存在且没有二次编辑事务时，才允许进入 AI 整理面板。
    function openAiImportPanelV99() {
      if (isEditingBank()) {
        showNotice('AI 辅助整理', '题库二次编辑期间不能使用 AI 替换当前编辑草稿。请先保存或退出二次编辑。', 'warn');
        return;
      }

      const text = String($('#import-text')?.value || '').trim();
      if (!text) {
        showNotice('AI 辅助整理', '请先粘贴题库文本或上传文件。', 'warn');
        return;
      }

      captureAiImportSelectionV992();
      const panel = $('#ai-import-panel-v99');
      if (!panel) {
        return;
      }

      panel.classList.remove('ai-hidden-v99');
      refreshAiImportPanelV99();
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // 按本地、远程或订阅服务说明实际发送的内容及用户需确认的权限。
    function renderImportPrivacy(privacy, {
      config,
      configured,
      checking,
      isHarness,
      range,
      availability,
    }) {
      privacy.setAttribute?.('role', 'status'); privacy.setAttribute?.('aria-live', 'polite'); privacy.setAttribute?.('aria-busy', String(checking));
      if (!configured) {
        privacy.textContent = availability.reason;
        privacy.className = 'notice warn';
      } else if (isHarness) {
        privacy.textContent = `${aiHarnessPrivacyV99(config, `本次${range.label}及相关核对上下文`)}只返回待核对结果，不发送本地题库文件或图片。`;
        privacy.className = 'notice warn';
      } else if (isLocalAiEndpointV99(config.endpoint)) {
        privacy.textContent = '当前使用本地 AI 服务。浏览器仍需获得跨域访问权限；整理结果只会在成功后替换当前预览。';
        privacy.className = 'notice';
      } else {
        privacy.textContent = `本次${range.label}将发送到远程 AI 接口。请确认题库内容允许上传，并确保所用密钥和服务可信。`;
        privacy.className = 'notice warn';
      }
    }

    // 按服务就绪状态和选区渲染整理范围、可用按钮及数据发送说明。
    function refreshAiImportPanelV99() {
      const config = aiExecutionConfigV99();
      const configured = aiConfiguredV99(config, 'import_organize');
      const availability = aiAvailabilityV99(config, 'import_organize');
      const checking = availability.state === 'checking';
      const isHarness = isAiHarnessExecutionV99(config.execution);
      const selected = currentAiImportSelectionV992();
      const selectedInput = $('#ai-import-scope-selection-v992');
      const selectedSize = $('#ai-import-selection-size-v992');
      const allInput = $('#ai-import-scope-all-v992');
      if (allInput) {
        allInput.disabled = aiImportSessions.importRequest.running;
      }

      if (selectedInput) {
        selectedInput.disabled = aiImportSessions.importRequest.running || !selected;
        if (selectedInput.checked && !selected && allInput) {
          allInput.checked = true;
        }
      }

      if (selectedSize) {
        selectedSize.textContent = selected ? `${selected.length.toLocaleString('zh-CN')} 字` : '未选择';
      }

      const range = aiImportRangeV992();
      const provider = $('#ai-import-provider-v99');
      const model = $('#ai-import-model-v99');
      const size = $('#ai-import-size-v99');
      const previewCountElement = $('#ai-import-preview-count-v99');
      const badge = $('#ai-import-badge-v99');
      const privacy = $('#ai-import-privacy-v99');
      const start = $('#ai-import-start-btn-v99');
      const settingsButton = $('#ai-import-settings-btn-v99');
      const hint = $('#ai-import-range-hint-v992');
      const showsProvider = configured || isHarness;
      if (provider) {
        provider.textContent = showsProvider ? aiExecutionLabelV99(config) : '未配置';
      }

      if (model) {
        model.textContent = config.model || '—';
      }

      if (size) {
        size.textContent = `${range.text.length.toLocaleString('zh-CN')} 字`;
      }

      if (previewCountElement) {
        previewCountElement.textContent = `${importDraft.questions.length} 题`;
      }

      if (badge) {
        badge.textContent = showsProvider ? aiExecutionLabelV99(config) : '未配置';
      }

      if (hint) {
        hint.textContent = range.scope === 'selection' ? `将只发送当前选中的 ${range.text.length.toLocaleString('zh-CN')} 字；成功后预览显示本次整理结果，导入框原文不变。` : '将整理导入框中的全部原始文本；成功后更新当前预览，导入框原文不变。';
      }

      if (start) {
        start.classList.toggle('ai-hidden-v99', !configured && !checking);
        start.disabled = checking || importOrPreviewBusy() || !range.text || range.text.length > AI_IMPORT_MAX_CHARS_V99;
        start.textContent = aiImportSessions.importRequest.running ? '正在整理……' : '开始整理';
      }

      if (settingsButton) {
        settingsButton.classList.toggle('ai-hidden-v99', configured || checking);
        settingsButton.textContent = availability.retryable ? '重试检查' : '前往 AI 设置';
      }

      if (privacy) {
        renderImportPrivacy(privacy, { config, configured, checking, isHarness, range, availability });
      }
    }

    // 用文本显示整理结果及失败提示，保留消息的告警级别。
    function setAiImportStatusV99(message, type = '') {
      const el = $('#ai-import-status-v99');
      if (!el) {
        return;
      }

      el.textContent = message;
      el.className = `notice${type ? ` ${type}` : ''}`;
    }

    function closeAiPreviewPanelV991() {
      const panel = $('#ai-preview-panel-v991');
      if (panel) {
        panel.classList.add('ai-hidden-v99');
      }
    }

    function aiPreviewModeLabelV991(mode) {
      return mode === 'analysis' ? 'AI 补解析' : 'AI 核对';
    }

    function importRowsForAiV991() {
      return (importDraft.questions || []).map((q, i) => ({ q, i, status: importIssueStatus(q, importDraft.diagnostics?.profile || {}) }));
    }

    // 复用当前预览筛选及排序，避免把被筛掉的题混入批量处理范围。
    function visibleImportIndexesV991() {
      if (!['problem', 'normal', 'priority'].includes(importDraft.filter)) {
        return importDraft.questions.map((_, i) => i);
      }

      let rows = importRowsForAiV991();
      if (importDraft.filter === 'problem') {
        rows = rows.filter((r) => r.status !== '正常');
      } else if (importDraft.filter === 'normal') {
        rows = rows.filter((r) => r.status === '正常');
      } else if (importDraft.filter === 'priority') {
        rows.sort((a, b) => {
          const aw = a.status === '正常' ? 1 : 0; const bw = b.status === '正常' ? 1 : 0;
          return aw - bw || a.i - b.i;
        });
      }

      return rows.map((r) => r.i);
    }

    function aiPreviewScopeOptionsV991(mode) {
      return mode === 'analysis' ? [['range', '自定义题号范围'], ['selected', '已选择题目'], ['visible', '当前筛选结果'], ['all', '全部题目']] : [['range', '自定义题号范围'], ['problem', '仅异常题'], ['selected', '已选择题目'], ['visible', '当前筛选结果'], ['all', '全部题目']];
    }

    // 校验一基题号的闭区间，转换成预览数组索引。
    function aiPreviewRangeStateV992() {
      const total = importDraft.questions.length;
      const startInput = $('#ai-preview-range-start-v992');
      const endInput = $('#ai-preview-range-end-v992');
      const first = Number(startInput?.value);
      const last = Number(endInput?.value);
      if (!Number.isInteger(first) || !Number.isInteger(last)) {
        return { indexes: [], error: '请输入完整的开始题号和结束题号。', first, last };
      }

      if (first < 1 || last < 1) {
        return { indexes: [], error: '题号必须从 1 开始。', first, last };
      }

      if (first > last) {
        return { indexes: [], error: '开始题号不能大于结束题号。', first, last };
      }

      if (last > total) {
        return { indexes: [], error: `结束题号不能超过当前识别结果的 ${total} 题。`, first, last };
      }

      return { indexes: Array.from({ length: last - first + 1 }, (_, i) => first - 1 + i), error: '', first, last };
    }

    // 先按范围选出候选题，只有核对模式需要支持仅异常题。
    function aiPreviewBaseIndexesV992(mode, scope) {
      if (scope === 'range') {
        return aiPreviewRangeStateV992();
      }

      if (scope === 'selected') {
        return { indexes: [...importDraft.selected].filter((i) => i >= 0 && i < importDraft.questions.length).sort((a, b) => a - b), error: '' };
      }

      if (scope === 'visible') {
        return { indexes: visibleImportIndexesV991(), error: '' };
      }

      if (mode === 'review' && scope === 'problem') {
        return { indexes: importRowsForAiV991().filter((r) => r.status !== '正常').map((r) => r.i), error: '' };
      }

      return { indexes: importDraft.questions.map((_, i) => i), error: '' };
    }

    // 解析模式额外按现有解析内容筛选，同时保留范围题数用于估算。
    function collectAiPreviewTargetDetailsV992(mode, scope, condition) {
      const base = aiPreviewBaseIndexesV992(mode, scope);
      if (base.error) {
        return { baseIndexes: [], indexes: [], error: base.error };
      }

      const baseIndexes = [...new Set(base.indexes)].filter((i) => i >= 0 && i < importDraft.questions.length);
      let indexes = baseIndexes;
      if (mode === 'analysis') {
        const rule = condition || 'missing';
        if (rule === 'missing') {
          indexes = baseIndexes.filter((i) => !String(importDraft.questions[i]?.analysis || '').trim());
        } else if (rule === 'short') {
          indexes = baseIndexes.filter((i) => String(importDraft.questions[i]?.analysis || '').trim().length < 20);
        }
      }

      return { baseIndexes, indexes, error: '' };
    }

    // 仅以真实识别结果启动核对或补解析，进入后清除旧任务提示。
    function openAiPreviewPanelV991(mode) {
      if (isEditingBank()) {
        showNotice(aiPreviewModeLabelV991(mode), '第一阶段仅用于新题库导入预览，题库二次编辑暂不启用该功能。', 'warn');
        return;
      }

      if (!importDraft.questions.length) {
        showNotice(aiPreviewModeLabelV991(mode), '请先完成普通识别或 AI 辅助整理，再对识别结果进行处理。', 'warn');
        return;
      }

      aiPreviewPanelModeV991 = mode === 'analysis' ? 'analysis' : 'review';
      clearAiPreviewStatusStickyV991();
      const panel = $('#ai-preview-panel-v991');
      if (!panel) {
        return;
      }

      panel.classList.remove('ai-hidden-v99');
      refreshAiPreviewPanelV991(true);
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // 更新范围选项和可编辑状态，仅在节点或模式变化时重建选项。
    function updatePreviewControls({
      scope,
      conditionField,
      condition,
      rangeFields,
      rangeStart,
      rangeEnd,
      batch,
      mode,
      resetScope,
    }) {
      if (scope) {
        const needsOptions = scope !== aiPreviewScopeNodeV991 || mode !== aiPreviewScopeModeV991;
        if (needsOptions) {
          const options = aiPreviewScopeOptionsV991(mode);
          const wanted = resetScope ? 'range' : (scope.value || '');
          scope.innerHTML = options.map(([value, optionLabel]) => `<option value="${value}">${optionLabel}</option>`).join('');

          scope.value = options.some(([value]) => value === wanted) ? wanted : options[0][0];

          aiPreviewScopeNodeV991 = scope;aiPreviewScopeModeV991 = mode;
        } else if (resetScope || !scope.value) {
          scope.value = 'range';
        }
      }

      if (conditionField) {
        conditionField.classList.toggle('ai-hidden-v99', mode !== 'analysis');
      }

      if (condition && resetScope) {
        condition.value = 'missing';
      }

      if (resetScope) {
        if (rangeStart) {
          rangeStart.value = '1';
        }

        if (rangeEnd) {
          rangeEnd.value = String(Math.min(20, importDraft.questions.length));
        }
      }

      const activeScope = scope?.value || 'range';
      if (rangeFields) {
        rangeFields.classList.toggle('ai-hidden-v99', activeScope !== 'range');
      }

      const controlsLocked = aiImportSessions.previewRequest.running;
      if (scope) {
        scope.disabled = controlsLocked;
      }

      if (condition) {
        condition.disabled = controlsLocked;
      }

      if (rangeStart) {
        rangeStart.max = String(Math.max(1, importDraft.questions.length));
        rangeStart.disabled = controlsLocked;
      }

      if (rangeEnd) {
        rangeEnd.max = String(Math.max(1, importDraft.questions.length));
        rangeEnd.disabled = controlsLocked;
      }

      if (batch) {
        if (resetScope) {
          batch.value = String(mode === 'analysis' ? AI_ANALYSIS_DEFAULT_BATCH_V991 : AI_REVIEW_DEFAULT_BATCH_V991);
        }

        batch.disabled = controlsLocked;
      }

      return activeScope;
    }

    // 空闲时解释范围、实际题量和请求次数，运行或任务结果有独立提示。
    function renderPreviewStatus(status, {
      config,
      configured,
      availability,
      checking,
      isHarness,
      mode,
      batchSize,
      details,
      estimatedRequestCount,
    }) {
      status.setAttribute?.('role', 'status'); status.setAttribute?.('aria-live', 'polite'); status.setAttribute?.('aria-busy', String(checking));
      if (!configured) {
        status.textContent = availability.reason;
        status.className = 'notice warn';
      } else if (batchSize === null) {
        status.textContent = globalThis.ShirohaAiImportSessions.previewBatchError;
        status.className = 'notice warn';
      } else if (details.error) {
        status.textContent = details.error;
        status.className = 'notice warn';
      } else if (!details.baseIndexes.length) {
        status.textContent = '当前范围没有题目。';
        status.className = 'notice';
      } else if (!details.indexes.length && mode === 'analysis') {
        status.textContent = `范围内有 ${details.baseIndexes.length} 道题，但没有符合当前解析条件的题目。`;
        status.className = 'notice';
      } else if (details.indexes.length > AI_PREVIEW_MAX_ITEMS_V991) {
        status.textContent = `实际处理 ${details.indexes.length} 道题，超过单次任务 ${AI_PREVIEW_MAX_ITEMS_V991} 道上限。请缩小题号范围或改用勾选后处理，程序不会静默截断。`;
        status.className = 'notice warn';
      } else {
        status.textContent = `范围内 ${details.baseIndexes.length} 道，实际处理 ${details.indexes.length} 道；按每批 ${batchSize} 道提交，预计请求 ${estimatedRequestCount} 次。AI 结果只作为建议。${isHarness ? ` ${aiHarnessPrivacyV99(config, '所选题目的文字与参考答案')}` : ''}`;
        status.className = 'notice';
      }
    }

    // 仅重绘可见的预览面板，按范围及批大小计算任务能否启动。
    function refreshAiPreviewPanelV991(resetScope = false) {
      const panel = $('#ai-preview-panel-v991');
      if (!panel || panel.classList.contains('ai-hidden-v99')) {
        return;
      }

      const mode = aiPreviewPanelModeV991;
      const config = aiExecutionConfigV99();
      const task = mode === 'analysis' ? 'batch_analysis' : 'batch_review';
      const configured = aiConfiguredV99(config, task);
      const availability = aiAvailabilityV99(config, task);
      const checking = availability.state === 'checking';
      const isHarness = isAiHarnessExecutionV99(config.execution);
      const title = $('#ai-preview-title-v991');
      const badge = $('#ai-preview-badge-v991');
      const desc = $('#ai-preview-description-v991');
      const scope = $('#ai-preview-scope-v991');
      const conditionField = $('#ai-preview-condition-field-v992');
      const condition = $('#ai-preview-condition-v992');
      const rangeFields = $('#ai-preview-range-fields-v992');
      const rangeStart = $('#ai-preview-range-start-v992');
      const rangeEnd = $('#ai-preview-range-end-v992');
      const batch = $('#ai-preview-batch-v991');
      const rangeCount = $('#ai-preview-range-count-v992');
      const count = $('#ai-preview-count-v991');
      const requestCount = $('#ai-preview-request-count-v992');
      const service = $('#ai-preview-service-v991');
      const model = $('#ai-preview-model-v991');
      const start = $('#ai-preview-start-btn-v991');
      const settingsButton = $('#ai-preview-settings-btn-v991');
      if (title) {
        title.textContent = aiPreviewModeLabelV991(mode);
      }

      if (badge) {
        badge.textContent = mode === 'analysis' ? '补充解析' : '结果核对';
      }

      if (desc) {
        desc.textContent = mode === 'analysis' ? '选择题目范围后，再按解析条件筛选；AI 只生成解析建议，不修改题干、题型、选项和答案。' : '选择需要核对的题目范围；AI 只生成修改建议，不会自动改题。';
      }

      const activeScope = updatePreviewControls({
        scope,
        conditionField,
        condition,
        rangeFields,
        rangeStart,
        rangeEnd,
        batch,
        mode,
        resetScope,
      });

      const batchSize = globalThis.ShirohaAiImportSessions.previewBatchSize(batch?.value);
      const details = collectAiPreviewTargetDetailsV992(mode, activeScope, condition?.value || 'missing');
      const estimatedRequestCount = batchSize === null ? null : Math.ceil(details.indexes.length / batchSize);
      if (rangeCount) {
        rangeCount.textContent = `${details.baseIndexes.length} 题`;
      }

      if (count) {
        count.textContent = `${details.indexes.length} 题`;
      }

      if (requestCount) {
        requestCount.textContent = estimatedRequestCount === null ? '—' : `${estimatedRequestCount} 次`;
      }

      if (service) {
        service.textContent = configured || isHarness ? aiExecutionLabelV99(config) : '未配置';
      }

      if (model) {
        model.textContent = config.model || '—';
      }

      if (settingsButton) {
        settingsButton.classList.toggle('ai-hidden-v99', configured || checking);
        settingsButton.textContent = availability.retryable ? '重试检查' : '前往 AI 设置';
      }

      if (start) {
        start.classList.toggle('ai-hidden-v99', !configured && !checking);
        start.disabled = checking || importOrPreviewBusy() || batchSize === null || !!details.error || !details.indexes.length || details.indexes.length > AI_PREVIEW_MAX_ITEMS_V991;
        start.textContent = aiImportSessions.previewRequest.running ? '处理中……' : `开始${aiPreviewModeLabelV991(mode)}`;
      }

      const status = $('#ai-preview-status-v991');
      if (status && !aiImportSessions.previewRequest.running && status.dataset.stickyV991 !== '1') {
        renderPreviewStatus(status, {
          config, configured, availability, checking, isHarness, mode, batchSize, details, estimatedRequestCount,
        });
      }
    }

    function clearAiPreviewStatusStickyV991() {
      const el = $('#ai-preview-status-v991');
      if (el) {
        delete el.dataset.stickyV991;
      }
    }

    // 任务结果可保持粘性，普通范围计算不应覆盖它。
    function setAiPreviewStatusV991(message, type = '', sticky = true) {
      const el = $('#ai-preview-status-v991');
      if (!el) {
        return;
      }

      el.textContent = message;
      el.className = `notice${type ? ` ${type}` : ''}`;
      if (sticky) {
        el.dataset.stickyV991 = '1';
      } else {
        delete el.dataset.stickyV991;
      }
    }

    // 使两个批量入口反映任务忙碌状态，并一并刷新当前打开的面板。
    function syncAiPreviewToolsV991() {
      const busy = importOrPreviewBusy();
      const blocked = !!isEditingBank() || !importDraft.questions.length;
      const review = $('#ai-review-import-btn-v991');
      if (review) {
        review.disabled = busy || blocked;
        review.textContent = aiImportSessions.previewRequest.running && aiImportSessions.previewRequest.mode === 'review' ? 'AI 核对中……' : 'AI 核对';
      }

      const analysis = $('#ai-analysis-import-btn-v991');
      if (analysis) {
        analysis.disabled = busy || blocked;
        analysis.textContent = aiImportSessions.previewRequest.running && aiImportSessions.previewRequest.mode === 'analysis' ? 'AI 补解析中……' : 'AI 补解析';
      }

      if (!$('#ai-preview-panel-v991')?.classList.contains('ai-hidden-v99')) {
        refreshAiPreviewPanelV991();
      }
    }

    // 只展示确实存在的修改字段，供用户核对题意和答案。
    function aiReviewChangeBlocksV991(s) {
      const blocks = [];
      if ('type' in s.changes) {
        blocks.push(`<div><b>建议题型</b><p>${esc(label(s.changes.type))}</p></div>`);
      }

      if ('question' in s.changes) {
        blocks.push(`<div><b>建议题干</b><p>${esc(s.changes.question)}</p></div>`);
      }

      if ('options' in s.changes) {
        blocks.push(`<div><b>建议选项</b><p>${esc((s.changes.options || []).map((o) => `${o.key}. ${o.text}`).join('\n'))}</p></div>`);
      }

      if ('answer' in s.changes) {
        blocks.push(`<div><b>建议答案</b><p>${esc((s.changes.answer || []).join('、'))}</p></div>`);
      }

      if ('analysis' in s.changes) {
        blocks.push(`<div><b>建议解析</b><p>${esc(s.changes.analysis)}</p></div>`);
      }

      return blocks.join('');
    }

    // 在对应题目下呈现仍有效的核对和解析建议，直到用户采纳或忽略。
    function renderAiSuggestionRowV991(q, index) {
      const key = aiQuestionKeyV991(q, index);
      const review = aiImportSessions.getReview(key);
      const analysis = aiImportSessions.getAnalysis(key);
      if (!review && !analysis) {
        return '';
      }

      const cards = [];
      if (review) {
        const riskLabel = { low: '低风险修正', cannot: '无法自动修正' }[review.risk] || '需要确认';
        const issueText = review.issues.length ? review.issues.join('；') : 'AI 未提供明确问题说明。';
        cards.push(`<div class="ai-suggestion-card-v991 ai-review-suggestion-v991"><div class="ai-suggestion-head-v991"><div><b>AI 核对建议</b><span>${esc(issueText)}</span></div><span class="pill ai-suggestion-risk-v991 is-${esc(review.risk)}">${riskLabel}</span></div>${review.note ? `<p class="ai-suggestion-note-v991">${esc(review.note)}</p>` : ''}<div class="ai-suggestion-changes-v991">${aiReviewChangeBlocksV991(review) || '<div><b>处理建议</b><p>没有足够依据自动修改，请人工编辑。</p></div>'}</div><div class="actions ai-suggestion-actions-v991">${review.canApply ? `<button class="primary mini-btn" type="button" data-ai-review-apply-v991="${esc(key)}">采纳建议</button>` : ''}<button class="ghost mini-btn" type="button" data-ai-review-ignore-v991="${esc(key)}">忽略</button></div></div>`);
      }

      if (analysis) {
        cards.push(`<div class="ai-suggestion-card-v991 ai-analysis-suggestion-v991"><div class="ai-suggestion-head-v991"><div><b>AI 解析建议</b><span>${analysis.needsReview ? '需要人工核对后使用' : '可核对后使用'}</span></div><span class="pill ai-suggestion-risk-v991 is-analysis">补解析</span></div>${analysis.analysis ? `<div class="ai-analysis-text-v991">${esc(analysis.analysis)}</div>` : '<div class="ai-analysis-text-v991 is-empty">未生成可靠解析。</div>'}${analysis.note ? `<p class="ai-suggestion-note-v991">${esc(analysis.note)}</p>` : ''}<div class="actions ai-suggestion-actions-v991">${analysis.analysis ? `<button class="primary mini-btn" type="button" data-ai-analysis-apply-v991="${esc(key)}">使用此解析</button><button class="ghost mini-btn" type="button" data-ai-analysis-edit-v991="${esc(key)}">编辑后使用</button>` : ''}<button class="ghost mini-btn" type="button" data-ai-analysis-ignore-v991="${esc(key)}">忽略</button></div></div>`);
      }

      return `<tr class="ai-suggestion-row-v991"><td colspan="8"><div class="ai-suggestion-grid-v991">${cards.join('')}</div></td></tr>`;
    }

    // 采纳前重新定位题目，并让会受修改影响的在途任务失效。
    function applyAiReviewSuggestionV991(key) {
      const s = aiImportSessions.getReview(key);
      if (!s) {
        return;
      }

      const index = findImportIndexByAiKeyV991(key, s.index);
      const q = importDraft.questions[index];
      if (!q) {
        aiImportSessions.deleteReview(key);
        renderImportPreview(importDraft.questions);
        return;
      }

      invalidateAiImportRequestV99();
      aiImportSessions.invalidateAiPreviewTargetV991(q, index);
      const raw = { ...q, ...s.changes, id: q.id };
      if (s.changes.options) {
        raw.options = s.changes.options;
      }

      if (s.changes.answer) {
        raw.answer = s.changes.answer;
      }

      importDraft.invalidatePreview?.();
      importDraft.questions[index] = normalizeQuestion(raw, index);
      aiImportSessions.deleteReview(key);
      aiImportSessions.deleteAnalysis(key);
      renderImportPreview(importDraft.questions);
      toast('已采纳 AI 核对建议，请继续人工确认题目。', 'ok');
    }

    // 仅将仍有效的解析写入当前题，同时撤销与旧题内容绑定的请求。
    function applyAiAnalysisSuggestionV991(key) {
      const s = aiImportSessions.getAnalysis(key);
      if (!s || !s.analysis) {
        return;
      }

      const index = findImportIndexByAiKeyV991(key, s.index);
      const q = importDraft.questions[index];
      if (!q) {
        return;
      }

      invalidateAiImportRequestV99();
      aiImportSessions.invalidateAiPreviewTargetV991(q, index);
      importDraft.invalidatePreview?.();
      importDraft.questions[index] = normalizeQuestion({ ...q, id: q.id, analysis: s.analysis }, index);
      aiImportSessions.deleteAnalysis(key);
      renderImportPreview(importDraft.questions);
      toast('已使用 AI 解析建议。', 'ok');
    }

    // 把解析建议带入编辑草稿，等用户核对后显式保存。
    function editAiAnalysisSuggestionV991(key) {
      const s = aiImportSessions.getAnalysis(key);
      if (!s || !s.analysis) {
        return;
      }

      const index = findImportIndexByAiKeyV991(key, s.index);
      if (index < 0) {
        return;
      }

      openEditQuestion(index);
      const field = $('#edit-analysis');
      if (field) {
        field.value = s.analysis;
      }

      const status = $('#edit-status');
      if (status) {
        status.textContent = 'AI 解析建议已填入编辑框，尚未保存。请核对后点击“保存修改”。';
        status.className = 'notice warn';
      }
    }

    // 为重绘后的建议卡绑定采纳、编辑和忽略操作。
    function bindAiSuggestionActionsV991() {
      $$('[data-ai-review-apply-v991]').forEach((btn) => btn.onclick = () => applyAiReviewSuggestionV991(btn.dataset.aiReviewApplyV991));

      $$('[data-ai-review-ignore-v991]').forEach((btn) => btn.onclick = () => {
        aiImportSessions.deleteReview(btn.dataset.aiReviewIgnoreV991);
        renderImportPreview(importDraft.questions);
      });

      $$('[data-ai-analysis-apply-v991]').forEach((btn) => btn.onclick = () => applyAiAnalysisSuggestionV991(btn.dataset.aiAnalysisApplyV991));

      $$('[data-ai-analysis-edit-v991]').forEach((btn) => btn.onclick = () => editAiAnalysisSuggestionV991(btn.dataset.aiAnalysisEditV991));

      $$('[data-ai-analysis-ignore-v991]').forEach((btn) => btn.onclick = () => {
        aiImportSessions.deleteAnalysis(btn.dataset.aiAnalysisIgnoreV991);
        renderImportPreview(importDraft.questions);
      });
    }

    return {
      bindAiImportEventsV99,
      syncAiImportActionV99,
      closeAiImportPanelV99,
      aiImportRangeV992,
      refreshAiImportPanelV99,
      setAiImportStatusV99,
      closeAiPreviewPanelV991,
      aiPreviewModeLabelV991,
      collectAiPreviewTargetDetailsV992,
      refreshAiPreviewPanelV991,
      setAiPreviewStatusV991,
      syncAiPreviewToolsV991,
      renderAiSuggestionRowV991,
      bindAiSuggestionActionsV991,
      mode: () => aiPreviewPanelModeV991,
    };
  }

  globalThis.ShirohaAiImportPanel = { create };
})();
