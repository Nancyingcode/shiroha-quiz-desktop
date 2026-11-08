(() => {
  'use strict';

  function create({ draft: importDraft, configuration, organizer, preview, view, transport, limits }) {
    const { isEditing, current: aiExecutionConfigV99, configured: aiConfiguredV99, unavailable: aiUnavailableReasonV99, request: aiRequestConfigV99, label: aiExecutionLabelV99 } = configuration;
    const { range: aiImportRangeV992, context: aiRefactorContextV384, messages: buildAiMessagesV99, parse: parseAiRefactorPayloadV384, parseText: parseTextQuestions, risk: largeImportRiskMessageV376 } = organizer;
    const { mode: getPreviewMode, collectTargets: collectAiPreviewTargetDetailsV992, key: aiQuestionKeyV991, fingerprint: aiQuestionFingerprintV991, payload: aiQuestionPayloadV991, issueStatus: importIssueStatus, label: aiPreviewModeLabelV991, analysisMessages: buildAiAnalysisMessagesV991, reviewMessages: buildAiReviewMessagesV991, resultArray, normalizeReview, normalizeAnalysis, findIndex } = preview;
    const { select: $, sync: syncAiImportActionV99, refreshImport: refreshAiImportPanelV99, refreshPreview: refreshAiPreviewPanelV991, importStatus: setAiImportStatusV99, previewStatus: setAiPreviewStatusV991, notice: showNotice, render: renderImportPreview } = view;
    const { request: requestAiChatV99, timeout: withAiTimeoutV99 } = transport;
    const { importChars: AI_IMPORT_MAX_CHARS_V99, previewItems: AI_PREVIEW_MAX_ITEMS_V991, analysisBatch: AI_ANALYSIS_DEFAULT_BATCH_V991, reviewBatch: AI_REVIEW_DEFAULT_BATCH_V991 } = limits;
    // 请求状态属于本页导入会话；取消或完成时替换身份，迟到操作不得修改新轮次。
    let aiImportRequestV99 = { running: false, controller: null };
    let aiPreviewRequestV991 = { running: false, mode: '', cancelled: false, controller: null };
    const reviewSuggestions = new Map();
    const analysisSuggestions = new Map();

    function resetAiSuggestionsV991() {
      reviewSuggestions.clear();
      analysisSuggestions.clear();
    }

    function removeAiSuggestionsForQuestionV991(question, index) {
      const key = aiQuestionKeyV991(question, index);
      reviewSuggestions.delete(key);
      analysisSuggestions.delete(key);
    }

    function storeAiBatchResultsV991(mode, content, batchItems) {
      const results = resultArray(content);
      let stored = 0;
      for (const raw of results) {
        const item = mode === 'analysis' ? normalizeAnalysis(raw, batchItems) : normalizeReview(raw, batchItems);
        if (!item) { continue; }
        const target = batchItems.find((value) => value.id === item.questionId);
        const currentIndex = findIndex(item.questionId, item.index);
        const current = importDraft.questions[currentIndex];
        if (!target || !current || aiQuestionFingerprintV991(current) !== target.fingerprint) { continue; }
        if (mode === 'analysis') {
          if (item.analysis || item.note) { analysisSuggestions.set(item.questionId, item);stored += 1; }
        } else if (item.issues.length || item.note || item.canApply) {
          reviewSuggestions.set(item.questionId, item);
          stored += 1;
        }
      }
      return stored;
    }

    function cancelAiImportRequestV99(silent) {
      if (!aiImportRequestV99.running) {
        return;
      }

      const cancelled = aiImportRequestV99;

      cancelled.cancelled = true;

      if (cancelled.controller) {
        try {
          cancelled.controller.abort();
        } catch {
        // 身份已失效；即使底层控制器异常，旧结果也不会进入草稿。
        }
      }
      aiImportRequestV99 = { running: false, controller: null };

      syncAiImportActionV99();
      refreshAiImportPanelV99();

      if (!silent) {
        setAiImportStatusV99('已请求取消，停止接收本次整理结果；现有识别结果未被修改。', 'warn');
      }
    }

    function cancelAiPreviewRequestV991(silent) {
      if (!aiPreviewRequestV991.running) {
        return;
      }

      const cancelled = aiPreviewRequestV991;
      cancelled.cancelled = true;

      if (cancelled.controller) {
        try {
          cancelled.controller.abort();
        } catch {
        // 身份已失效；即使底层控制器异常，旧建议也不会进入预览。
        }
      }
      aiPreviewRequestV991 = { running: false, mode: '', cancelled: false, controller: null };

      syncAiImportActionV99();
      refreshAiPreviewPanelV991();

      if (!silent) {
        setAiPreviewStatusV991('已请求取消，停止接收本次结果；已生成的建议会保留。', 'warn');
      }
    }

    async function requestAiPreviewBatchV991(mode, requestConfig, batchItems, owner) {
      const controller = new AbortController();
      owner.controller = controller;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, requestConfig.timeoutSeconds * 1000);

      try {
        const result = await requestAiChatV99(requestConfig, mode === 'analysis' ? buildAiAnalysisMessagesV991(batchItems.map((x) => x.payload)) : buildAiReviewMessagesV991(batchItems.map((x) => x.payload)), { controller, task: mode === 'analysis' ? 'batch_analysis' : 'batch_review' });
        if (timedOut) { throw new Error(`当前批次请求超过 ${requestConfig.timeoutSeconds} 秒，已自动停止。`); }
        return result;
      } catch (error) {
        if (error?.name === 'AbortError' && timedOut) {
          throw new Error(`当前批次请求超过 ${requestConfig.timeoutSeconds} 秒，已自动停止。`, { cause: error });
        }
        throw error;
      } finally {
        clearTimeout(timer);
        if (aiPreviewRequestV991 === owner && owner.controller === controller) {
          owner.controller = null;
        }
      }
    }

    async function startAiPreviewTaskV991() {
      if (aiPreviewRequestV991.running || aiImportRequestV99.running) {
        return;
      }
      if (isEditing()) {
        setAiPreviewStatusV991('第一阶段不处理题库二次编辑草稿。', 'warn');
        return;
      }

      const config = aiExecutionConfigV99();
      const task = getPreviewMode() === 'analysis' ? 'batch_analysis' : 'batch_review';
      if (!aiConfiguredV99(config, task)) {
        setAiPreviewStatusV991(aiUnavailableReasonV99(config, task), 'warn');
        return;
      }

      const mode = getPreviewMode();
      const scope = $('#ai-preview-scope-v991')?.value || 'range';
      const condition = $('#ai-preview-condition-v992')?.value || 'missing';
      const details = collectAiPreviewTargetDetailsV992(mode, scope, condition);
      const { indexes } = details;

      if (details.error) {
        setAiPreviewStatusV991(details.error, 'warn');
        return;
      }
      if (!details.baseIndexes.length) {
        setAiPreviewStatusV991('当前范围没有题目。', 'warn');
        return;
      }
      if (!indexes.length) {
        setAiPreviewStatusV991(mode === 'analysis' ? '当前范围没有符合解析条件的题目。' : '当前范围没有可处理的题目。', 'warn');
        return;
      }
      if (indexes.length > AI_PREVIEW_MAX_ITEMS_V991) {
        setAiPreviewStatusV991(`实际处理题目超过单次 ${AI_PREVIEW_MAX_ITEMS_V991} 道上限，请缩小范围。`, 'warn');
        return;
      }

      const batchSize = Math.min(30, Math.max(1, Number($('#ai-preview-batch-v991')?.value || (mode === 'analysis' ? AI_ANALYSIS_DEFAULT_BATCH_V991 : AI_REVIEW_DEFAULT_BATCH_V991)) || 1));
      const requestConfig = aiRequestConfigV99(config);

      const owner = { running: true, mode, cancelled: false, controller: null };
      aiPreviewRequestV991 = owner;
      syncAiImportActionV99();
      let processed = 0; let stored = 0;

      const isCurrentPreviewRequest = () => aiPreviewRequestV991 === owner && !owner.cancelled;

      try {
        for (let offset = 0;offset < indexes.length;offset += batchSize) {
          if (!isCurrentPreviewRequest()) {
            return;
          }
          const part = indexes.slice(offset, offset + batchSize);
          const batchItems = part.map((index) => {
            const q = importDraft.questions[index];
            return { id: aiQuestionKeyV991(q, index), index, question: q, fingerprint: aiQuestionFingerprintV991(q), payload: aiQuestionPayloadV991(q, index, importIssueStatus(q, importDraft.diagnostics?.profile || {})) };
          });

          setAiPreviewStatusV991(`正在${aiPreviewModeLabelV991(mode)}：第 ${Math.floor(offset / batchSize) + 1}/${Math.ceil(indexes.length / batchSize)} 批，已处理 ${processed}/${indexes.length} 题。`);

          const result = await requestAiPreviewBatchV991(mode, requestConfig, batchItems, owner);
          if (!isCurrentPreviewRequest()) {
            return;
          }
          stored += storeAiBatchResultsV991(mode, result.content, batchItems);
          processed += batchItems.length;
          renderImportPreview(importDraft.questions);
        }

        if (!isCurrentPreviewRequest()) { return; }
        setAiPreviewStatusV991(`${aiPreviewModeLabelV991(mode)}完成：处理 ${processed} 道题，生成 ${stored} 条建议。建议不会自动修改题目，请逐题采纳或忽略。`, 'ok');
        showNotice(aiPreviewModeLabelV991(mode), `已生成 ${stored} 条建议，请在预览表中逐题核对。`, 'ok');
      } catch (error) {
        if (!isCurrentPreviewRequest()) {
          return;
        }
        setAiPreviewStatusV991(`${error.message || '处理失败'}${processed ? ` 已完成 ${processed} 道题，已有建议已保留。` : ''}`, 'warn');
        showNotice(aiPreviewModeLabelV991(mode), error.message || '处理失败。', 'danger');
      } finally {
        if (isCurrentPreviewRequest()) {
          aiPreviewRequestV991 = { running: false, mode: '', cancelled: false, controller: null };
          syncAiImportActionV99();
          refreshAiPreviewPanelV991();
        }
      }
    }

    async function startAiImportV99() {
      if (aiImportRequestV99.running || aiPreviewRequestV991.running) {
        return;
      }

      if (isEditing()) {
        setAiImportStatusV99('题库二次编辑期间不能使用 AI 替换当前编辑草稿。', 'warn');
        return;
      }

      const config = aiExecutionConfigV99();

      if (!aiConfiguredV99(config, 'import_organize')) {
        refreshAiImportPanelV99();
        setAiImportStatusV99(aiUnavailableReasonV99(config, 'import_organize'), 'warn');
        return;
      }

      const range = aiImportRangeV992();
      const { text } = range;

      if (range.scope === 'selection' && !text) {
        setAiImportStatusV99('当前没有有效的选中文本。请先在导入文本框中选中需要整理的内容。', 'warn');
        return;
      }

      if (!text) {
        setAiImportStatusV99('当前没有可整理的文本。', 'warn');
        return;
      }

      if (text.length > AI_IMPORT_MAX_CHARS_V99) {
        setAiImportStatusV99(`本次${range.label}共 ${text.length.toLocaleString('zh-CN')} 字，超过单次 ${AI_IMPORT_MAX_CHARS_V99.toLocaleString('zh-CN')} 字限制。请缩小范围，程序不会静默截断。`, 'warn');
        return;
      }

      const requestConfig = aiRequestConfigV99(config);
      const beforeCount = importDraft.questions.length;
      const context = aiRefactorContextV384(range);

      const owner = { running: true, controller: null, cancelled: false };
      aiImportRequestV99 = owner;
      syncAiImportActionV99();
      setAiImportStatusV99('正在调用 AI 结构化整理题库。将优先生成 questions，结构校验失败时自动退回文本清洗。');

      const isCurrentImportRequest = () => aiImportRequestV99 === owner && !owner.cancelled;

      const previous = importDraft.snapshot();

      const requestPass = async (mode, fallbackReason = '') => withAiTimeoutV99(config.timeoutSeconds, (controller) => {
        owner.controller = controller;
        return requestAiChatV99(requestConfig, buildAiMessagesV99(text, { requestedMode: mode, fallbackReason, currentQuestions: context.currentQuestions, warnings: context.warnings }), { controller, task: 'import_organize' });
      });

      try {
        let primary = null;
        let primaryError = '';

        // 只有已收到内容后的业务结构失败才允许兜底，避免传输失败或结果未知时重复执行任务。
        const primaryResult = await requestPass('direct_questions');
        if (!isCurrentImportRequest()) {
          return;
        }

        try {
          primary = parseAiRefactorPayloadV384(primaryResult.content);
        } catch (error) {
          primaryError = String(error?.message || '结构化 JSON 无法解析');
        }

        let payload = primary;
        let fallbackReason = '';
        let usedFallback = false;

        if (primary?.structuredUsable) {
          payload = { ...primary, mode: 'direct_questions' };
        } else if (primary?.cleanedText) {
          fallbackReason = [...(primary.structuredIssues || []), 'AI 未返回可用结构化题目'].filter(Boolean).join('；');
          payload = { ...primary, mode: 'clean_text' };
          usedFallback = true;
        } else {
          fallbackReason = [primaryError, ...(primary?.structuredIssues || []), primary && !primary.questions?.length ? 'AI 未返回可用结构化题目' : ''].filter(Boolean).join('；') || '结构化结果不可用';

          setAiImportStatusV99(`结构化结果不可用，正在自动切换文本清洗兜底：${fallbackReason.slice(0, 160)}`, 'warn');

          const fallbackResult = await requestPass('clean_text', fallbackReason);
          if (!isCurrentImportRequest()) {
            return;
          }
          payload = parseAiRefactorPayloadV384(fallbackResult.content);
          usedFallback = true;

          if (!payload.cleanedText) {
            throw new Error(`AI 结构化结果不可用，文本兜底也未返回 cleanedText：${fallbackReason}`);
          }

          payload = { ...payload, mode: 'clean_text' };
        }

        let questions = [];
        let modeLabel = '';
        let parserReport = '';
        let parserWarnings = [];

        if (payload.mode === 'direct_questions') {
          questions = payload.questions;
          modeLabel = 'AI 结构化整理';
          parserReport = 'AI 直接返回经过结构校验的题目对象；仍需人工核对后导入。';
        } else {
          importDraft.warnings = [];
          importDraft.report = '';
          importDraft.diagnostics = null;

          try {
            questions = parseTextQuestions(payload.cleanedText, $('#import-strategy')?.value || 'auto');
            parserReport = importDraft.report;
            parserWarnings = [...importDraft.warnings];
          } catch (error) {
            questions = [];
            parserWarnings = [`AI 清洗文本进入本地解析器时失败：${error.message || error}`];
          }

          modeLabel = usedFallback ? 'AI 文本兜底 → 本地解析器' : 'AI 清洗文本 → 本地解析器';

          if (!questions.length) {
            throw new Error('AI 已返回清洗文本，但本地解析器没有识别到有效题目。原有预览未被修改。');
          }
        }

        importDraft.questions = questions;
        importDraft.selected.clear();
        resetAiSuggestionsV991();

        const structuredWarnings = (payload.structuredIssues || []).map((x) => `结构化校验：${x}`);
        const fallbackNotes = usedFallback && fallbackReason ? [`结构化结果不可用，已自动使用文本兜底：${fallbackReason}`] : [];

        importDraft.warnings = [`${modeLabel}结果必须人工核对。`, ...fallbackNotes, ...structuredWarnings, ...parserWarnings, ...(payload.notes || [])].filter(Boolean).slice(0, 40);

        importDraft.report = `${modeLabel}：${aiExecutionLabelV99(config)} / ${config.model}，${range.label} ${text.length.toLocaleString('zh-CN')} 字。${beforeCount ? `整理前预览 ${beforeCount} 题，整理后 ${importDraft.questions.length} 题。` : ''}${parserReport ? ` ${parserReport}` : ''}`;

        importDraft.diagnostics = { ...(importDraft.diagnostics || {}), strategy: modeLabel, mode: aiExecutionLabelV99(config), aiMode: payload.mode, aiStructuredFirstV384: true, aiUsedCleanTextFallbackV384: usedFallback, expected: importDraft.diagnostics?.expected || {}, profile: importDraft.diagnostics?.profile || {}, candidates: importDraft.diagnostics?.candidates || [] };
        importDraft.filter = 'priority';

        renderImportPreview(importDraft.questions);
        setAiImportStatusV99(`整理完成：${modeLabel}，得到 ${importDraft.questions.length} 道题。请核对题量、题干、选项、答案和解析后再确认导入。`, 'ok');
        {
          const risk = largeImportRiskMessageV376(importDraft.questions);
          showNotice('AI 整理完成', `${modeLabel}得到 ${importDraft.questions.length} 道题，必须人工核对后再导入。${risk ? ` ${risk}` : ''}`, risk ? 'warn' : 'ok');
        }
      } catch (error) {
        if (!isCurrentImportRequest()) {
          return;
        }

        importDraft.restore(previous);

        const isCancelled = error?.name === 'AbortError';
        const message = isCancelled ? 'AI 整理已取消，现有识别结果未被修改。' : (error.message || 'AI 整理失败，现有识别结果未被修改。');

        setAiImportStatusV99(message, 'warn');
        showNotice('AI 整理', message, isCancelled ? 'warn' : 'danger');
      } finally {
        if (isCurrentImportRequest()) {
          aiImportRequestV99 = { running: false, controller: null };
          syncAiImportActionV99();
          refreshAiImportPanelV99();
        }
      }
    }

    return {
      get importRequest() {
        return aiImportRequestV99;
      },
      get previewRequest() {
        return aiPreviewRequestV991;
      },
      cancelAiImportRequestV99, cancelAiPreviewRequestV991, startAiPreviewTaskV991, startAiImportV99,
      resetAiSuggestionsV991, removeAiSuggestionsForQuestionV991,
      getReview: (key) => reviewSuggestions.get(key), getAnalysis: (key) => analysisSuggestions.get(key),
      deleteReview: (key) => reviewSuggestions.delete(key), deleteAnalysis: (key) => analysisSuggestions.delete(key),
    };
  }

  globalThis.ShirohaAiImportSessions = Object.freeze({ create });
})();
