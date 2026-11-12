(() => {
  'use strict';
  const hasAnswer = (values) => Array.isArray(values) && values.some((value) => String(value ?? '').trim());
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const key = (bankId, questionId) => JSON.stringify([bankId || '', questionId || '']);

  function parsePracticeNumberRangeV58916(raw, max) {
    const text = String(raw || '').trim();
    if (!text) {
      return { indexes: [], error: '请输入题号，例如 1,3,5-10,20。' };
    }
    const selected = new Set();
    const invalid = [];
    text.split(/[，,、；;\s]+/).filter(Boolean).forEach((token) => {
      const single = token.match(/^(\d+)$/);
      const range = token.match(/^(\d+)\s*(?:-|~|—|至)\s*(\d+)$/);
      if (single) {
        const value = Number(single[1]);
        const isInRange = value >= 1 && value <= max;
        if (isInRange) {
          selected.add(value - 1);
        } else {
          invalid.push(token);
        }
        return;
      }
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        const isInvalidRange = start < 1 || end < start || end > max;
        if (isInvalidRange) {
          invalid.push(token);
          return;
        }
        for (let number = start; number <= end; number += 1) {
          selected.add(number - 1);
        }
        return;
      }
      invalid.push(token);
    });
    if (invalid.length) {
      const suffix = invalid.length > 5 ? '…' : '';
      return { indexes: [], error: `题号格式或范围有误：${invalid.slice(0, 5).join('、')}${suffix}` };
    }
    const indexes = [...selected].sort((a, b) => a - b);
    return indexes.length ? { indexes, error: '' } : { indexes: [], error: '没有可用的题号。' };
  }

  function formatExactPracticeNumbersV58916(numbers) {
    if (numbers.length === 1) {
      // 单个数字代表起点，精确重练必须用单题区间避免带入后续题目。
      return `${numbers[0]}-${numbers[0]}`;
    }
    return numbers.join(',');
  }

  function createClock(at) {
    return { state: 'running', elapsed: 0, since: at };
  }
  function elapsedClock(clock, at) {
    if (!clock) {
      return 0;
    }
    return clock.elapsed + (clock.state === 'running' ? Math.max(0, at - clock.since) : 0);
  }
  function transitionClock(clock, next, at) {
    if (!clock || clock.state === 'stopped' || clock.state === next) {
      return clock;
    }
    return { state: next, elapsed: elapsedClock(clock, at), since: at };
  }
  function formatDuration(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor(value % 3600 / 60);
    return `${(hours ? `${hours}:` : '') + String(minutes).padStart(2, '0')
    }:${String(value % 60).padStart(2, '0')}`;
  }
  function buildReview(items, details, metadata) {
    const indices = new Map(details.map((detail, index) => [key(detail.sourceBankId, detail.questionId), index]));
    return {
      version: 1,
      ...metadata,
      items: items.map((item) => {
        const detailIndex = indices.get(key(item.bankId, item.question.id));
        const ref = {
          sourceBankId: item.bankId || '',
          sourceBankName: item.bankName || '',
          questionId: item.question.id,
          bankQuestionNumber: item.bankQuestionNumber || null,
        };
        if (detailIndex !== undefined) {
          return { ...ref, detailIndex };
        }
        return { ...ref, question: clone(item.question), draft: [...(item.chosen || [])], revealed: !!item.revealed };
      }),
    };
  }
  function reviewRows(record) {
    const details = Array.isArray(record.details) ? record.details : [];
    const complete = record.review?.version === 1 && Array.isArray(record.review.items);
    const refs = complete ? record.review.items : details.map((_, detailIndex) => ({ detailIndex }));
    return refs.map((ref, index) => {
      const detail = Number.isInteger(ref.detailIndex) ? details[ref.detailIndex] : null;
      const snapshot = detail?.nativeQuestion || ref.question;
      const question = snapshot || (detail ? {
        id: detail.questionId,
        question: detail.question || '',
        type: detail.type,
        answer: detail.answer || [],
        options: [],
        blankAnswers: detail.blankAnswers,
      } : null);
      const chosen = detail?.chosen || detail?.userAnswer || [];
      let status = 'unanswered';
      if (!question) {
        status = 'unrecorded';
      } else if (detail && hasAnswer(chosen)) {
        status = detail.correct === true ? 'correct' : 'wrong';
      }
      return {
        index,
        roundNumber: complete ? index + 1 : null,
        bankQuestionNumber: ref.bankQuestionNumber || null,
        bankId: ref.sourceBankId || detail?.sourceBankId || record.bankId || '',
        bankName: ref.sourceBankName || detail?.sourceBankName || record.bankName || '',
        question,
        chosen,
        draft: ref.draft || [],
        revealed: !!ref.revealed,
        status,
        partial: !snapshot,
        detail,
      };
    });
  }
  function reviewSummary(review, details) {
    return {
      version: 1,
      completion: review.completion,
      submitMode: review.submitMode,
      timing: review.timing,
      unanswered: reviewRows({ review, details }).filter((row) => row.status === 'unanswered').length,
    };
  }
  globalThis.ShirohaTraining = Object.freeze({
    parsePracticeNumberRangeV58916,
    formatExactPracticeNumbersV58916,
    createClock,
    elapsedClock,
    transitionClock,
    formatDuration,
    buildReview,
    reviewRows,
    reviewSummary,
  });
})();
