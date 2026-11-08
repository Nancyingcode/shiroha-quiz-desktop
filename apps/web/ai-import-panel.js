(() => {
  'use strict';
  function create({ draft: importDraft, sessions: aiImportSessions, platform: ShirohaPlatform,
    select: $, selectAll: $$, escape: esc, label, toast, showNotice, settings, requests, editor, preview, limits }) {
    const { presets: AI_PROVIDER_PRESETS_V99, config: aiExecutionConfigV99, configured: aiConfiguredV99, isHarness: isAiHarnessExecutionV99,
      unavailable: aiUnavailableReasonV99, executionLabel: aiExecutionLabelV99, privacy: aiHarnessPrivacyV99,
      localEndpoint: isLocalAiEndpointV99, updatePill: updateAiConnectionPillV99, render: renderAiSettingsV99,
      toggleDiagnostic: toggleAiDiagnosticV375, copyDiagnostic: copyAiDiagnosticV375, copyCors: copyAiOllamaCorsCommandV375,
      save: saveAiSettingsV99, test: testAiConnectionV99, clear: clearAiSettingsV99 } = settings;
    const { busy: aiTasksBusyV99, startImport: startAiImportV99, cancelImport: cancelAiImportRequestV99,
      startPreview: startAiPreviewTaskV991, cancelPreview: cancelAiPreviewRequestV991 } = requests;
    const { isEditing: isEditingBank, openQuestion: openEditQuestion, normalizeQuestion } = editor;
    const { status: importIssueStatus, key: aiQuestionKeyV991, findIndex: findImportIndexByAiKeyV991,
      render: renderImportPreview, renderPracticeAi: renderPracticeAiPanelV613, switchView: switchViewV45 } = preview;
    const { importChars: AI_IMPORT_MAX_CHARS_V99, items: AI_PREVIEW_MAX_ITEMS_V991,
      analysisBatch: AI_ANALYSIS_DEFAULT_BATCH_V991, reviewBatch: AI_REVIEW_DEFAULT_BATCH_V991 } = limits;
    // 文本选择与预览范围只属于当前导入页；重新输入时丢弃旧选择。
    let aiPreviewPanelModeV991 = 'review'; let aiImportTextSelectionV992 = { start: 0, end: 0, text: '' };
    function bindAiImportEventsV99() {
      ShirohaPlatform.harness?.bind(() => {
        updateAiConnectionPillV99('idle');
        syncAiImportActionV99();
        refreshAiImportPanelV99();
        refreshAiPreviewPanelV991();
        renderPracticeAiPanelV613();
      }, aiTasksBusyV99);
      const provider = $('#ai-provider-v99');
      if (provider) {
        provider.onchange = () => {
          const endpoint = $('#ai-endpoint-v99');
          if (!endpoint) {
            return;
          }
          const presets = Object.values(AI_PROVIDER_PRESETS_V99).map((x) => x.endpoint).filter(Boolean);
          if (!endpoint.value.trim() || presets.includes(endpoint.value.trim()) || endpoint.value.trim() === endpoint.dataset.lastPreset) {
            endpoint.value = AI_PROVIDER_PRESETS_V99[provider.value]?.endpoint || '';
          }
          endpoint.dataset.lastPreset = AI_PROVIDER_PRESETS_V99[provider.value]?.endpoint || '';
        };
      }
      const save = $('#ai-save-settings-v99');
      if (save) {
        save.onclick = saveAiSettingsV99;
      }
      const test = $('#ai-test-connection-v99');
      if (test) {
        test.onclick = testAiConnectionV99;
      }
      const toggleDiag = $('#ai-toggle-diagnostics-v375');
      if (toggleDiag) {
        toggleDiag.onclick = toggleAiDiagnosticV375;
      }
      const copyDiag = $('#ai-copy-diagnostics-v375');
      if (copyDiag) {
        copyDiag.onclick = copyAiDiagnosticV375;
      }
      const copyCors = $('#ai-copy-ollama-cors-v375');
      if (copyCors) {
        copyCors.onclick = copyAiOllamaCorsCommandV375;
      }
      const clear = $('#ai-clear-settings-v99');
      if (clear) {
        clear.onclick = clearAiSettingsV99;
      }
      const open = $('#ai-organize-import-btn-v99');
      if (open) {
        open.onclick = openAiImportPanelV99;
      }
      const start = $('#ai-import-start-btn-v99');
      if (start) {
        start.onclick = startAiImportV99;
      }
      const cancel = $('#ai-import-cancel-btn-v99');
      if (cancel) {
        cancel.onclick = () => {
          if (aiImportSessions.importRequest.running) {
            cancelAiImportRequestV99(false);
          } else {
            closeAiImportPanelV99();
          }
        };
      }
      const settings = $('#ai-import-settings-btn-v99');
      if (settings) {
        settings.onclick = async () => await switchViewV45('ai-settings');
      }
      const review = $('#ai-review-import-btn-v991');
      if (review) {
        review.onclick = () => openAiPreviewPanelV991('review');
      }
      const analysis = $('#ai-analysis-import-btn-v991');
      if (analysis) {
        analysis.onclick = () => openAiPreviewPanelV991('analysis');
      }
      const previewStart = $('#ai-preview-start-btn-v991');
      if (previewStart) {
        previewStart.onclick = startAiPreviewTaskV991;
      }
      const previewCancel = $('#ai-preview-cancel-btn-v991');
      if (previewCancel) {
        previewCancel.onclick = () => {
          if (aiImportSessions.previewRequest.running) {
            cancelAiPreviewRequestV991(false);
          } else {
            closeAiPreviewPanelV991();
          }
        };
      }
      const previewSettings = $('#ai-preview-settings-btn-v991');
      if (previewSettings) {
        previewSettings.onclick = async () => await switchViewV45('ai-settings');
      }
      const importText = $('#import-text');
      if (importText && !importText.dataset.aiSelectionBoundV992) {
        importText.dataset.aiSelectionBoundV992 = '1';
        const capture = () => {
          captureAiImportSelectionV992();
          if (!$('#ai-import-panel-v99')?.classList.contains('ai-hidden-v99')) {
            refreshAiImportPanelV99();
          }
        };
        importText.addEventListener('select', capture);
        importText.addEventListener('mouseup', capture);
        importText.addEventListener('keyup', capture);
        importText.addEventListener('input', () => {
          aiImportTextSelectionV992 = { start: 0, end: 0, text: '' };
          if (!$('#ai-import-panel-v99')?.classList.contains('ai-hidden-v99')) {
            refreshAiImportPanelV99();
          }
        });
      }
      $$('input[name="ai-import-scope-v992"]').forEach((input) => input.onchange = () => refreshAiImportPanelV99());
      const previewScope = $('#ai-preview-scope-v991');
      if (previewScope) {
        previewScope.onchange = () => {
          clearAiPreviewStatusStickyV991();
          refreshAiPreviewPanelV991();
        };
      }
      const previewCondition = $('#ai-preview-condition-v992');
      if (previewCondition) {
        previewCondition.onchange = () => {
          clearAiPreviewStatusStickyV991();
          refreshAiPreviewPanelV991();
        };
      }
      const previewRangeStart = $('#ai-preview-range-start-v992');
      if (previewRangeStart) {
        previewRangeStart.oninput = () => {
          clearAiPreviewStatusStickyV991();
          refreshAiPreviewPanelV991();
        };
      }
      const previewRangeEnd = $('#ai-preview-range-end-v992');
      if (previewRangeEnd) {
        previewRangeEnd.oninput = () => {
          clearAiPreviewStatusStickyV991();
          refreshAiPreviewPanelV991();
        };
      }
      const previewBatch = $('#ai-preview-batch-v991');
      if (previewBatch) {
        previewBatch.oninput = () => {
          clearAiPreviewStatusStickyV991();
          refreshAiPreviewPanelV991();
        };
      }
      renderAiSettingsV99();
      syncAiImportActionV99();
      syncAiPreviewToolsV991();
    }
    function syncAiImportActionV99() {
      const busy = !!aiImportSessions.importRequest.running || !!aiImportSessions.previewRequest.running;
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
    function aiImportScopeV992() {
      return $('#ai-import-scope-selection-v992')?.checked ? 'selection' : 'all';
    }
    function aiImportRangeV992() {
      const full = String($('#import-text')?.value || '');
      const scope = aiImportScopeV992();
      const selected = currentAiImportSelectionV992();
      return scope === 'selection' ? { scope, text: selected, label: '当前选中文本' } : { scope: 'all', text: full.trim(), label: '全部原始文本' };
    }
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
    function refreshAiImportPanelV99() {
      const config = aiExecutionConfigV99();
      const configured = aiConfiguredV99(config, 'import_organize');
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
      const preview = $('#ai-import-preview-count-v99');
      const badge = $('#ai-import-badge-v99');
      const privacy = $('#ai-import-privacy-v99');
      const start = $('#ai-import-start-btn-v99');
      const settings = $('#ai-import-settings-btn-v99');
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
      if (preview) {
        preview.textContent = `${importDraft.questions.length} 题`;
      }
      if (badge) {
        badge.textContent = showsProvider ? aiExecutionLabelV99(config) : '未配置';
      }
      if (hint) {
        hint.textContent = range.scope === 'selection' ? `将只发送当前选中的 ${range.text.length.toLocaleString('zh-CN')} 字；成功后预览显示本次整理结果，导入框原文不变。` : '将整理导入框中的全部原始文本；成功后更新当前预览，导入框原文不变。';
      }
      if (start) {
        start.classList.toggle('ai-hidden-v99', !configured);
        start.disabled = aiImportSessions.importRequest.running || !range.text || range.text.length > AI_IMPORT_MAX_CHARS_V99;
        start.textContent = aiImportSessions.importRequest.running ? '正在整理……' : '开始整理';
      }
      if (settings) {
        settings.classList.toggle('ai-hidden-v99', configured);
      }
      if (privacy) {
        if (!configured) {
          privacy.textContent = aiUnavailableReasonV99(config, 'import_organize');
          privacy.className = 'notice warn';
        } else if (isHarness) {
          privacy.textContent = aiHarnessPrivacyV99(config, `本次${range.label}及相关核对上下文`) + '只返回待核对结果，不发送本地题库文件或图片。';
          privacy.className = 'notice warn';
        } else if (isLocalAiEndpointV99(config.endpoint)) {
          privacy.textContent = '当前使用本地 AI 服务。浏览器仍需获得跨域访问权限；整理结果只会在成功后替换当前预览。';
          privacy.className = 'notice';
        } else {
          privacy.textContent = `本次${range.label}将发送到远程 AI 接口。请确认题库内容允许上传，并确保所用密钥和服务可信。`;
          privacy.className = 'notice warn';
        }
      }
    }
    function setAiImportStatusV99(message, type = '') {
      const el = $('#ai-import-status-v99');
      if (!el) {
        return;
      }
      el.textContent = message;
      el.className = 'notice' + (type ? ' ' + type : '');
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
    function visibleImportIndexesV991() {
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
    function aiPreviewBaseIndexesV992(mode, scope) {
      const rows = importRowsForAiV991();
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
        return { indexes: rows.filter((r) => r.status !== '正常').map((r) => r.i), error: '' };
      }
      return { indexes: rows.map((r) => r.i), error: '' };
    }
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
    function refreshAiPreviewPanelV991(resetScope = false) {
      const panel = $('#ai-preview-panel-v991');
      if (!panel || panel.classList.contains('ai-hidden-v99')) {
        return;
      }
      const mode = aiPreviewPanelModeV991;
      const config = aiExecutionConfigV99();
      const task = mode === 'analysis' ? 'batch_analysis' : 'batch_review';
      const configured = aiConfiguredV99(config, task);
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
      const settings = $('#ai-preview-settings-btn-v991');
      if (title) {
        title.textContent = aiPreviewModeLabelV991(mode);
      }
      if (badge) {
        badge.textContent = mode === 'analysis' ? '补充解析' : '结果核对';
      }
      if (desc) {
        desc.textContent = mode === 'analysis' ? '选择题目范围后，再按解析条件筛选；AI 只生成解析建议，不修改题干、题型、选项和答案。' : '选择需要核对的题目范围；AI 只生成修改建议，不会自动改题。';
      }
      const options = aiPreviewScopeOptionsV991(mode);
      const wanted = resetScope ? 'range' : (scope?.value || '');
      if (scope) {
        scope.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
        scope.value = options.some(([value]) => value === wanted) ? wanted : options[0][0];
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
        const current = Number(batch.value || 0);
        const defaultBatch = mode === 'analysis' ? AI_ANALYSIS_DEFAULT_BATCH_V991 : AI_REVIEW_DEFAULT_BATCH_V991;
        batch.value = String(resetScope ? defaultBatch : (current || defaultBatch));
        batch.disabled = controlsLocked;
      }
      const batchSize = Math.min(30, Math.max(1, Number(batch?.value || 1) || 1));
      const details = collectAiPreviewTargetDetailsV992(mode, activeScope, condition?.value || 'missing');
      const requests = details.indexes.length ? Math.ceil(details.indexes.length / batchSize) : 0;
      if (rangeCount) {
        rangeCount.textContent = `${details.baseIndexes.length} 题`;
      }
      if (count) {
        count.textContent = `${details.indexes.length} 题`;
      }
      if (requestCount) {
        requestCount.textContent = `${requests} 次`;
      }
      if (service) {
        service.textContent = configured || isHarness ? aiExecutionLabelV99(config) : '未配置';
      }
      if (model) {
        model.textContent = config.model || '—';
      }
      if (settings) {
        settings.classList.toggle('ai-hidden-v99', configured);
      }
      if (start) {
        start.classList.toggle('ai-hidden-v99', !configured);
        start.disabled = aiImportSessions.previewRequest.running || !!details.error || !details.indexes.length || details.indexes.length > AI_PREVIEW_MAX_ITEMS_V991;
        start.textContent = aiImportSessions.previewRequest.running ? '处理中……' : `开始${aiPreviewModeLabelV991(mode)}`;
      }
      const status = $('#ai-preview-status-v991');
      if (status && !aiImportSessions.previewRequest.running && status.dataset.stickyV991 !== '1') {
        if (!configured) {
          status.textContent = aiUnavailableReasonV99(config, task);
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
          status.textContent = `范围内 ${details.baseIndexes.length} 道，实际处理 ${details.indexes.length} 道；按每批 ${batchSize} 道提交，预计请求 ${requests} 次。AI 结果只作为建议。${isHarness ? ' ' + aiHarnessPrivacyV99(config, '所选题目的文字与参考答案') : ''}`;
          status.className = 'notice';
        }
      }
    }
    function clearAiPreviewStatusStickyV991() {
      const el = $('#ai-preview-status-v991');
      if (el) {
        delete el.dataset.stickyV991;
      }
    }
    function setAiPreviewStatusV991(message, type = '', sticky = true) {
      const el = $('#ai-preview-status-v991');
      if (!el) {
        return;
      }
      el.textContent = message;
      el.className = 'notice' + (type ? ' ' + type : '');
      if (sticky) {
        el.dataset.stickyV991 = '1';
      } else {
        delete el.dataset.stickyV991;
      }
    }
    function syncAiPreviewToolsV991() {
      const busy = !!aiImportSessions.importRequest.running || !!aiImportSessions.previewRequest.running;
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
      const raw = { ...q, ...s.changes, id: q.id };
      if (s.changes.options) {
        raw.options = s.changes.options;
      }
      if (s.changes.answer) {
        raw.answer = s.changes.answer;
      }
      importDraft.questions[index] = normalizeQuestion(raw, index);
      aiImportSessions.deleteReview(key);
      aiImportSessions.deleteAnalysis(key);
      renderImportPreview(importDraft.questions);
      toast('已采纳 AI 核对建议，请继续人工确认题目。', 'ok');
    }
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
      importDraft.questions[index] = normalizeQuestion({ ...q, id: q.id, analysis: s.analysis }, index);
      aiImportSessions.deleteAnalysis(key);
      renderImportPreview(importDraft.questions);
      toast('已使用 AI 解析建议。', 'ok');
    }
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
      bindAiImportEventsV99, syncAiImportActionV99, closeAiImportPanelV99, aiImportRangeV992,
      refreshAiImportPanelV99, setAiImportStatusV99, closeAiPreviewPanelV991, aiPreviewModeLabelV991,
      collectAiPreviewTargetDetailsV992, refreshAiPreviewPanelV991, setAiPreviewStatusV991,
      syncAiPreviewToolsV991, renderAiSuggestionRowV991, bindAiSuggestionActionsV991,
      mode: () => aiPreviewPanelModeV991,
    };
  }
  globalThis.ShirohaAiImportPanel = { create };
})();
