// 统一历史备份版本检查、来源映射和跨端学习记录转换。
(() => {
  'use strict';

  // 在读取内容前拒绝未来版本，防止导入把无法理解的字段静默丢弃。
  function assertSupportedBackup(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('JSON 根节点不是对象');
    }

    const unsupportedVersion = Number(data.crossPlatformSchemaVersion || 0) > 1
      || (String(data.kind || '').startsWith('shiroha_quiz') && Number(data.version || 0) > 3)
      || Number(data.schemaVersion || 0) > (data.kind === 'shiroha_quiz_full_backup' ? 3 : 1);
    if (unsupportedVersion) {
      throw new Error('不支持此备份版本。');
    }
  }

  // 合并生成新题库标识时同步更新明细和复盘引用；缺少映射时保留原标识。
  function remapSourceBank(entry, bankMap) {
    const mapped = entry.sourceBankId && bankMap[entry.sourceBankId];
    return {
      ...entry,
      sourceBankId: mapped ? mapped.id : entry.sourceBankId,
      sourceBankName: mapped ? mapped.name : entry.sourceBankName,
    };
  }

  // 同时更新记录归属与跨库题目来源，避免合并后回看时引用旧题库。
  function remapBackupRecord(record, bankMap) {
    const mappedRecordBank = record.bankId && bankMap[record.bankId];
    return {
      ...record,
      bankId: mappedRecordBank ? mappedRecordBank.id : record.bankId,
      bankName: mappedRecordBank ? mappedRecordBank.name : record.bankName,
      ...(record.review?.version === 1 && Array.isArray(record.review.items) ? {
        review: {
          ...record.review,
          items: record.review.items.map((item) => remapSourceBank(item, bankMap)),
        },
      } : {}),
      details: (record.details || []).map((detail) => remapSourceBank(detail, bankMap)),
    };
  }

  // 从备份图片的已有后缀恢复媒体类型，未知类型仍可按二进制保留。
  function backupMimeFromPath(path) {
    const ext = String(path || '').split('.').pop().toLowerCase();
    return ({
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
    })[ext] || 'application/octet-stream';
  }

  // 兼容毫秒数、历史数字字符串和日期文本，并保留调用方提供的无效值回退。
  function parseCrossPlatformTime(value, fallback = Date.now()) {
    if (value == null || value === '') { return fallback; }

    if (typeof value === 'number' && Number.isFinite(value)) { return value; }

    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) { return numeric; }

    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function crossTimeToIso(value) {
    const milliseconds = parseCrossPlatformTime(value, NaN);
    return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : '';
  }

  function splitNativeAnswerText(text) {
    const value = String(text || '').trim();
    // 拆分旧备份中以斜杠或中英文分号串接的多个答案。
    return value ? value.split(/\s*(?:\/|；|;)\s*/).map((part) => part.trim()).filter(Boolean) : [];
  }

  // 用调用方的 ID 生成与题目序列化规则构建双向记录转换器。
  function createRecordConverters({
    makeId,
    now,
    serializeQuestion,
    toNativeQuestionType,
  }) {
    const {
      normalizeWebQuestionType,
      normalizeBlankAnswersV58914,
      cloneBlankAnswersV58914,
      isMultiBlankQuestionV58914,
    } = globalThis.ShirohaQuizCore;

    // 优先导出保存时的题目快照，再回退到现有题库或历史明细，保留各端的分数与题目来源。
    function toNativeQuestionResult(detail, index, questionMap, bankId, bank) {
      const questionId = detail.questionId || '';
      const savedQuestion = detail.nativeQuestion && typeof detail.nativeQuestion === 'object'
        ? detail.nativeQuestion : null;
      let question = savedQuestion || questionMap.get(questionId) || {
        id: questionId || makeId('record_q', index),
        number: String(index + 1),
        type: toNativeQuestionType(detail.type || 'short'),
        question: detail.question || '',
        options: [],
        answer: Array.isArray(detail.answer) ? detail.answer : [],
        analysis: '',
        category: detail.category || '',
        images: [],
      };
      if (!Array.isArray(question.blankAnswers) && Array.isArray(detail.blankAnswers)) {
        question = { ...question, blankAnswers: cloneBlankAnswersV58914(detail.blankAnswers) };
      }

      const isMultiBlank = isMultiBlankQuestionV58914(question);
      let userAnswer = [];
      if (Array.isArray(detail.userAnswer)) {
        userAnswer = detail.userAnswer;
      } else if (Array.isArray(detail.chosen)) {
        userAnswer = detail.chosen;
      }

      const directBlankAnswers = Array.isArray(detail.userBlankAnswers) ? detail.userBlankAnswers : null;
      let userBlankAnswers = directBlankAnswers || [];
      if (!userBlankAnswers.length && isMultiBlank) { userBlankAnswers = userAnswer; }

      let answerText;
      if (detail.nativeAnswerText != null) {
        answerText = String(detail.nativeAnswerText);
      } else if (Array.isArray(detail.answer)) {
        answerText = detail.answer.join(' / ');
      } else {
        answerText = String(detail.answer || '');
      }

      const result = {
        question: serializeQuestion(question),
        userAnswer: [...userAnswer],
        correct: !!detail.correct,
        answerText,
        earnedScore: detail.nativeEarnedScore !== undefined ? detail.nativeEarnedScore : (detail.score ?? null),
        maxScore: detail.nativeMaxScore !== undefined ? detail.nativeMaxScore : (detail.fullScore ?? null),
        autoScored: detail.autoScored !== false,
        sourceBankId: detail.sourceBankId || bankId || null,
        sourceBankName: detail.sourceBankName || bank?.name || '',
      };
      if (userBlankAnswers.length || isMultiBlank) { result.userBlankAnswers = [...userBlankAnswers]; }

      return result;
    }

    // 将原生答题结果还原为 Web 明细，保留原生字段用于下次导出，并兼容只保存了答案文本的记录。
    function toWebDetail(result, record) {
      const question = result.question || {};
      const earned = result.earnedScore;
      const max = result.maxScore;
      const blankAnswers = normalizeBlankAnswersV58914(question.blankAnswers);
      const userAnswer = Array.isArray(result.userAnswer)
        ? result.userAnswer.map((value) => String(value ?? '')) : [];
      const directBlankAnswers = Array.isArray(result.userBlankAnswers)
        ? result.userBlankAnswers.map((value) => String(value ?? '')) : null;
      let userBlankAnswers = directBlankAnswers || [];
      if (!userBlankAnswers.length && blankAnswers.length) { userBlankAnswers = [...userAnswer]; }

      let score = result.correct ? 1 : 0;
      if (earned != null) { score = Number(earned); }

      const detail = {
        questionId: question.id || '',
        question: question.question || '',
        type: normalizeWebQuestionType(question.type) || String(question.type || '').toLowerCase(),
        category: question.category || '',
        chosen: userBlankAnswers.length ? [...userBlankAnswers] : [...userAnswer],
        userAnswer: [...userAnswer],
        answer: Array.isArray(question.answer) && question.answer.length
          ? question.answer : splitNativeAnswerText(result.answerText),
        correct: !!result.correct,
        score,
        fullScore: max == null ? 1 : Number(max),
        nativeEarnedScore: earned ?? null,
        nativeMaxScore: max ?? null,
        nativeAnswerText: result.answerText ?? '',
        autoScored: result.autoScored !== false,
        sourceBankId: result.sourceBankId || record.bankId || '',
        sourceBankName: result.sourceBankName || record.bankName || '',
        time: '',
      };
      if (blankAnswers.length) { detail.blankAnswers = cloneBlankAnswersV58914(blankAnswers); }

      if (userBlankAnswers.length || blankAnswers.length) { detail.userBlankAnswers = [...userBlankAnswers]; }

      return detail;
    }

    // 先生成逐题结果，再根据历史缺失字段补全原生记录汇总。
    function toNative(record, bankMap) {
      const bankId = record.bankId || '';
      const bank = bankId ? bankMap.get(bankId) : null;
      const questionMap = new Map(((bank && bank.questions) || []).map((question) => [question.id, question]));
      const questionResults = (record.details || [])
        .map((detail, index) => toNativeQuestionResult(detail, index, questionMap, bankId, bank));
      return {
        id: record.id || makeId('rec'),
        bankId: bankId || null,
        bankName: record.bankName || bank?.name || '',
        source: record.nativeSource || 'web',
        title: record.nativeTitle || record.name || record.mode || '练习',
        scopeType: record.scopeType || null,
        scopeName: record.scopeName || null,
        total: Number(record.total || questionResults.length || 0),
        correct: Number(record.correct || 0),
        timestamp: parseCrossPlatformTime(record.date || record.timestamp, Date.now()),
        durationSeconds: Number(record.duration || 0) || null,
        autoSubmitted: !!record.autoSubmitted,
        startedAt: record.startedAt ? parseCrossPlatformTime(record.startedAt, null) : null,
        earnedScore: record.nativeEarnedScore !== undefined ? record.nativeEarnedScore : (record.score ?? null),
        totalScore: record.nativeTotalScore !== undefined ? record.nativeTotalScore : (record.totalScore ?? null),
        questionResults,
      };
    }

    // 恢复 Web 汇总与明细，保留原生标题、时间与题目快照以支持往返。
    function toWeb(record) {
      const details = (record.questionResults || []).map((result) => toWebDetail(result, record));
      const total = Number(record.total || details.length || 0);
      const correct = Number(record.correct || details.filter((detail) => detail.correct).length || 0);
      details.forEach((detail, index) => {
        const result = (record.questionResults || [])[index];
        if (result && result.question) { detail.nativeQuestion = result.question; }
      });

      return {
        id: record.id || makeId('rec'),
        mode: record.title || record.source || '练习',
        nativeTitle: record.title || '',
        nativeSource: record.source || '',
        bankId: record.bankId || '',
        bankName: record.bankName || '',
        scopeType: record.scopeType || null,
        scopeName: record.scopeName || null,
        date: crossTimeToIso(record.timestamp) || now(),
        total,
        correct,
        wrong: Math.max(0, total - correct),
        answered: total,
        accuracy: total > 0 ? Math.round(correct / total * 100) : 0,
        duration: Number(record.durationSeconds || 0),
        score: record.earnedScore == null ? 0 : Number(record.earnedScore),
        totalScore: record.totalScore == null ? 0 : Number(record.totalScore),
        nativeEarnedScore: record.earnedScore ?? null,
        nativeTotalScore: record.totalScore ?? null,
        passScore: null,
        passed: null,
        details,
        autoSubmitted: !!record.autoSubmitted,
        startedAt: record.startedAt ? crossTimeToIso(record.startedAt) : '',
      };
    }

    return Object.freeze({ toNative, toWeb });
  }

  globalThis.ShirohaBackupCore = Object.freeze({
    assertSupportedBackup,
    remapBackupRecord,
    backupMimeFromPath,
    parseCrossPlatformTime,
    crossTimeToIso,
    createRecordConverters,
  });
})();
