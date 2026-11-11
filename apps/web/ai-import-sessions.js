(() => {
  'use strict';

  const PREVIEW_BATCH_ERROR = '单批提交题数须为 1～30 的整数。';

  function previewBatchSize(value) {
    const raw = String(value ?? '').trim();
    const size = Number(raw);
    return raw && Number.isInteger(size) && size >= 1 && size <= 30 ? size : null;
  }

  function create({ draft: importDraft, configuration, organizer, preview, view, transport, limits }) {
    const { isEditing, current: aiExecutionConfigV99, configured: aiConfiguredV99, unavailable: aiUnavailableReasonV99, request: aiRequestConfigV99, label: aiExecutionLabelV99 } = configuration;
    const { range: aiImportRangeV992, context: aiRefactorContextV384, messages: buildAiMessagesV99, parse: parseAiRefactorPayloadV384, parseText: parseTextQuestions, risk: largeImportRiskMessageV376 } = organizer;
    const { mode: getPreviewMode, collectTargets: collectAiPreviewTargetDetailsV992, key: aiQuestionKeyV991, fingerprint: aiQuestionFingerprintV991, payload: aiQuestionPayloadV991, issueStatus: importIssueStatus, label: aiPreviewModeLabelV991, analysisMessages: buildAiAnalysisMessagesV991, reviewMessages: buildAiReviewMessagesV991, resultArray, normalizeReview, normalizeAnalysis, findIndex } = preview;
    const { select: $, sync: syncAiImportActionV99, refreshImport: refreshAiImportPanelV99, importStatus: setAiImportStatusV99, previewStatus: setAiPreviewStatusV991, notice: showNotice, render: renderImportPreview } = view;
    const { request: requestAiChatV99, timeout: withAiTimeoutV99 } = transport;
    const { importChars: AI_IMPORT_MAX_CHARS_V99, previewItems: AI_PREVIEW_MAX_ITEMS_V991 } = limits;
    // 请求状态属于本页导入会话；取消或完成时替换身份，迟到操作不得修改新轮次。
    let aiImportRequestV99 = { running: false, controller: null };
    let aiPreviewRequestV991 = { running: false, mode: '', cancelled: false, controller: null };
    const reviewSuggestions = new Map();
    const analysisSuggestions = new Map();

    function resetAiSuggestionsV991() {
      reviewSuggestions.clear();
      analysisSuggestions.clear();
    }

    // 编辑后即使内容被改回原值，也不能让本轮旧批次继续使用该目标。
    function invalidateAiPreviewTargetV991(question, index) {
      if (aiPreviewRequestV991.running) {
        aiPreviewRequestV991.invalidatedIds.add(aiQuestionKeyV991(question, index));
      }
    }

    function removeAiSuggestionsForQuestionV991(question, index) {
      invalidateAiPreviewTargetV991(question, index);
      const key = aiQuestionKeyV991(question, index);
      reviewSuggestions.delete(key);
      analysisSuggestions.delete(key);
    }

    function currentAiTargetIndexV991(target) {
      const index = findIndex(target.id, -1);
      const question = importDraft.questions[index];
      return question && aiQuestionKeyV991(question, index) === target.id
        && aiQuestionFingerprintV991(question) === target.fingerprint ? index : -1;
    }

    function isAiPreviewTargetCurrentV991(target, owner) {
      return !owner.invalidatedIds.has(target.id) && currentAiTargetIndexV991(target) >= 0;
    }

    function currentAiSuggestionV991(suggestions, key) {
      const suggestion = suggestions.get(key);
      return suggestion && currentAiTargetIndexV991({ id: key, fingerprint: suggestion.fingerprint }) >= 0
        ? suggestion : undefined;
    }

    function storeAiBatchResultsV991(mode, content, batchItems) {
      const results = resultArray(content);
      let stored = 0;
      for (const raw of results) {
        const item = mode === 'analysis' ? normalizeAnalysis(raw, batchItems) : normalizeReview(raw, batchItems);
        if (!item) { continue; }
        const target = batchItems.find((value) => value.id === item.questionId);
        if (!target || currentAiTargetIndexV991(target) < 0) { continue; }
        item.fingerprint = target.fingerprint;
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

      if (!silent) {
        setAiImportStatusV99('已请求取消，停止接收本次整理结果；现有识别结果未被修改。', 'warn');
      }
    }

    function invalidateAiImportRequestV99() {
      if (!aiImportRequestV99.running) { return; }
      cancelAiImportRequestV99(true);
      setAiImportStatusV99('原文或识别预览已变化，本次整理结果已失效；已请求停止，请重新开始。', 'warn');
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

      if (!silent) {
        setAiPreviewStatusV991('已请求取消，停止接收本次结果；已生成的建议会保留。', 'warn');
      }
    }

    async function requestAiPreviewBatchV991(mode, requestConfig, batchItems, remainingTargets, owner) {
      const controller = new AbortController();
      owner.controller = controller;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, requestConfig.timeoutSeconds * 1000);

      try {
        const isCurrent = () => aiPreviewRequestV991 === owner && !owner.cancelled && getPreviewMode() === mode
          && remainingTargets.every((item) => isAiPreviewTargetCurrentV991(item, owner));
        const result = await requestAiChatV99(requestConfig, mode === 'analysis' ? buildAiAnalysisMessagesV991(batchItems.map((x) => x.payload)) : buildAiReviewMessagesV991(batchItems.map((x) => x.payload)), { controller, task: mode === 'analysis' ? 'batch_analysis' : 'batch_review', isCurrent });
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

      const batchSize = previewBatchSize($('#ai-preview-batch-v991')?.value);
      if (batchSize === null) {
        setAiPreviewStatusV991(PREVIEW_BATCH_ERROR, 'warn');
        return;
      }
      const requestConfig = aiRequestConfigV99(config);
      const targets = indexes.map((index) => {
        const question = importDraft.questions[index];
        const id = aiQuestionKeyV991(question, index);
        return { id, index, question, fingerprint: aiQuestionFingerprintV991(question),
          payload: aiQuestionPayloadV991(question, index, importIssueStatus(question, importDraft.diagnostics?.profile || {})) };
      });
      if (targets.some((target) => !target.id || findIndex(target.id, -1) !== target.index)) {
        setAiPreviewStatusV991('目标题目身份不唯一或缺失，请重新识别并选择后再试。', 'warn');
        return;
      }

      const owner = { running: true, mode, cancelled: false, controller: null, invalidatedIds: new Set() };
      aiPreviewRequestV991 = owner;
      syncAiImportActionV99();
      let processed = 0; let stored = 0;

      const isCurrentPreviewRequest = () => aiPreviewRequestV991 === owner && !owner.cancelled;

      try {
        for (let offset = 0;offset < indexes.length;offset += batchSize) {
          if (!isCurrentPreviewRequest()) {
            return;
          }
          const batchItems = targets.slice(offset, offset + batchSize);
          const remainingTargets = targets.slice(offset);
          if (remainingTargets.some((item) => !isAiPreviewTargetCurrentV991(item, owner))) {
            throw new Error('目标题目已变化或身份不唯一，请重新选择后再试。');
          }

          setAiPreviewStatusV991(`正在${aiPreviewModeLabelV991(mode)}：第 ${Math.floor(offset / batchSize) + 1}/${Math.ceil(indexes.length / batchSize)} 批，已处理 ${processed}/${indexes.length} 题。`);

          let result;
          try {
            result = await requestAiPreviewBatchV991(mode, requestConfig, batchItems, remainingTargets, owner);
          } catch (error) {
            if (isCurrentPreviewRequest() && remainingTargets.some((item) => !isAiPreviewTargetCurrentV991(item, owner))) {
              throw new Error('目标题目已变化或身份不唯一，请重新选择后再试。', { cause: error });
            }
            throw error;
          }
          if (!isCurrentPreviewRequest()) {
            return;
          }
          if (batchItems.some((item) => !isAiPreviewTargetCurrentV991(item, owner))) {
            throw new Error('目标题目已变化或身份不唯一，请重新选择后再试。');
          }
          stored += storeAiBatchResultsV991(mode, result.content, batchItems);
          processed += batchItems.length;
          // 最后一批与结束状态一起同步；中间批次仍立即展示建议。
          renderImportPreview(importDraft.questions, { syncPreviewTools: processed < indexes.length });
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
      const contextSnapshot = JSON.stringify(context);
      const rangeSnapshot = JSON.stringify(range);
      const previous = importDraft.snapshot();
      const { tableResult, sourceMeta } = importDraft;
      const draftSnapshot = JSON.stringify({ questions: importDraft.questions, selected: [...importDraft.selected],
        warnings: importDraft.warnings, report: importDraft.report, diagnostics: importDraft.diagnostics,
        filter: importDraft.filter, tableResult, sourceMeta });

      const owner = { running: true, controller: null, cancelled: false };
      aiImportRequestV99 = owner;
      syncAiImportActionV99();
      setAiImportStatusV99('正在调用 AI 结构化整理题库。将优先生成 questions，结构校验失败时自动退回文本清洗。');

      const isCurrentImportRequest = () => aiImportRequestV99 === owner && !owner.cancelled;
      const isCurrentBeforeSend = () => {
        const currentRange = aiImportRangeV992();
        const sameDraft = importDraft.questions === previous.cache
          && importDraft.warnings === previous.warnings && importDraft.diagnostics === previous.diagnostics
          && importDraft.tableResult === tableResult && importDraft.sourceMeta === sourceMeta
          && JSON.stringify({ questions: importDraft.questions, selected: [...importDraft.selected],
            warnings: importDraft.warnings, report: importDraft.report, diagnostics: importDraft.diagnostics,
            filter: importDraft.filter, tableResult: importDraft.tableResult, sourceMeta: importDraft.sourceMeta }) === draftSnapshot;
        return isCurrentImportRequest() && sameDraft && JSON.stringify(currentRange) === rangeSnapshot
          && JSON.stringify(aiRefactorContextV384(currentRange)) === contextSnapshot;
      };

      const requestPass = async (mode, fallbackReason = '') => withAiTimeoutV99(config.timeoutSeconds, (controller) => {
        owner.controller = controller;
        return requestAiChatV99(requestConfig, buildAiMessagesV99(text, { requestedMode: mode, fallbackReason, currentQuestions: context.currentQuestions, warnings: context.warnings }), { controller, task: 'import_organize', isCurrent: isCurrentBeforeSend });
      });

      try {
        let primary = null;
        let primaryError = '';

        // 只有已收到内容后的业务结构失败才允许兜底，避免传输失败或结果未知时重复执行任务。
        const primaryResult = await requestPass('direct_questions');
        if (!isCurrentBeforeSend()) {
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
          if (!isCurrentBeforeSend()) {
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
            importDraft.warnings = previous.warnings;
            importDraft.report = previous.report;
            importDraft.diagnostics = previous.diagnostics;
            throw new Error('AI 已返回清洗文本，但本地解析器没有识别到有效题目。原有预览未被修改。');
          }
        }

        importDraft.invalidatePreview?.();
        importDraft.questions = questions;
        importDraft.selected.clear();
        resetAiSuggestionsV991();

        const structuredWarnings = (payload.structuredIssues || []).map((x) => `结构化校验：${x}`);
        const fallbackNotes = usedFallback && fallbackReason ? [`结构化结果不可用，已自动使用文本兜底：${fallbackReason}`] : [];

        importDraft.warnings = [`${modeLabel}结果必须人工核对。`, ...fallbackNotes, ...structuredWarnings, ...parserWarnings, ...(payload.notes || [])].filter(Boolean).slice(0, 40);

        importDraft.report = `${modeLabel}：${aiExecutionLabelV99(config)} / ${config.model}，${range.label} ${text.length.toLocaleString('zh-CN')} 字。${beforeCount ? `整理前预览 ${beforeCount} 题，整理后 ${importDraft.questions.length} 题。` : ''}${parserReport ? ` ${parserReport}` : ''}`;

        importDraft.diagnostics = { ...(importDraft.diagnostics || {}), strategy: modeLabel, mode: aiExecutionLabelV99(config), aiMode: payload.mode, aiStructuredFirstV384: true, aiUsedCleanTextFallbackV384: usedFallback, expected: importDraft.diagnostics?.expected || {}, profile: importDraft.diagnostics?.profile || {}, candidates: importDraft.diagnostics?.candidates || [] };
        importDraft.filter = 'priority';

        renderImportPreview(importDraft.questions, { syncPreviewTools: false });
        setAiImportStatusV99(`整理完成：${modeLabel}，得到 ${importDraft.questions.length} 道题。请核对题量、题干、选项、答案和解析后再确认导入。`, 'ok');
        {
          const risk = largeImportRiskMessageV376(importDraft.questions);
          showNotice('AI 整理完成', `${modeLabel}得到 ${importDraft.questions.length} 道题，必须人工核对后再导入。${risk ? ` ${risk}` : ''}`, risk ? 'warn' : 'ok');
        }
      } catch (error) {
        if (!isCurrentBeforeSend()) {
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
      cancelAiImportRequestV99, invalidateAiImportRequestV99, cancelAiPreviewRequestV991,
      startAiPreviewTaskV991, startAiImportV99,
      resetAiSuggestionsV991, removeAiSuggestionsForQuestionV991, invalidateAiPreviewTargetV991,
      getReview: (key) => currentAiSuggestionV991(reviewSuggestions, key),
      getAnalysis: (key) => currentAiSuggestionV991(analysisSuggestions, key),
      deleteReview: (key) => reviewSuggestions.delete(key), deleteAnalysis: (key) => analysisSuggestions.delete(key),
    };
  }

  globalThis.ShirohaAiImportSessions = Object.freeze({ create, previewBatchSize, previewBatchError: PREVIEW_BATCH_ERROR });
})();
