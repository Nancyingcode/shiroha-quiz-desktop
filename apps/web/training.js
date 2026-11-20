// 将练习计时、题号选择和复盘的数据操作注册到页面共享接口。
(() => {
  'use strict';
  const ANSWER_DETAIL_SUMMARY_LENGTH = 120;
  const hasAnswer = (values) => Array.isArray(values) && values.some((value) => String(value ?? '').trim());

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const key = (bankId, questionId) => JSON.stringify([bankId || '', questionId || '']);

  // 识别单个题号或闭区间，返回校验后的首尾题号，供调用方统一展开成索引。
  function parsePracticeNumberToken(token, max) {
    // 仅将完整的数字片段作为单题，供范围校验使用。
    const single = token.match(/^(\d+)$/);
    if (single) {
      const value = Number(single[1]);
      return value >= 1 && value <= max ? { start: value, end: value } : null;
    }

    // 识别 2-4、2~4、2—4 和 2至4，取出首尾题号供区间校验。
    const range = token.match(/^(\d+)\s*(?:-|~|—|至)\s*(\d+)$/);
    if (!range) {
      return null;
    }

    const start = Number(range[1]);
    const end = Number(range[2]);
    return start < 1 || end < start || end > max ? null : { start, end };
  }

  // 将题号列表转换为去重、升序的零基索引。任一片段无效时，整次选择返回错误。
  function parsePracticeNumberRangeV58916(raw, max) {
    const text = String(raw || '').trim();
    if (!text) {
      return { indexes: [], error: '请输入题号，例如 1,3,5-10,20。' };
    }

    // 将中英文列表分隔符和空白视为题号片段的边界。
    const tokens = text.split(/[，,、；;\s]+/).filter(Boolean);
    const selected = new Set();
    const invalid = [];
    for (const token of tokens) {
      const range = parsePracticeNumberToken(token, max);
      if (!range) {
        invalid.push(token);
        continue;
      }

      for (let number = range.start; number <= range.end; number += 1) {
        selected.add(number - 1);
      }
    }

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

  // 将累计秒数显示为时分秒，未满一小时保留分秒格式。
  function formatDuration(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor(value % 3600 / 60);
    return `${(hours ? `${hours}:` : '') + String(minutes).padStart(2, '0')
    }:${String(value % 60).padStart(2, '0')}`;
  }

  // 将已读题目连同原题库和题号固化，便于跨库复盘时定位。
  function snapshotItem({
    bankId,
    bankName,
    bankQuestionNumber,
    question,
  }) {
    // 复制题目快照，防止题库后续编辑影响已保存的记录。
    return { bankId, bankName, bankQuestionNumber, question: clone(question) };
  }

  // 为成绩记录保存答题快照，供跨库复盘和多空题逐空核对。
  function answerDetail({
    question,
    bankId,
    bankName,
    chosen,
    correct,
    score,
    time,
  }, { short, isMultiBlank, cloneBlankAnswers }) {
    const values = Array.isArray(chosen) ? [...chosen] : [];
    const detail = {
      questionId: question.id,
      question: short(question.question, ANSWER_DETAIL_SUMMARY_LENGTH),
      type: question.type,
      category: question.category || '',
      chosen: values,
      userAnswer: [...values],
      answer: [...question.answer],
      correct: !!correct,
      score: correct ? score : 0,
      fullScore: score,
      time,
      sourceBankId: bankId,
      sourceBankName: bankName,
      nativeQuestion: clone(question),
    };
    if (isMultiBlank(question)) {
      detail.blankAnswers = cloneBlankAnswers(question.blankAnswers);
      detail.userBlankAnswers = [...values];
    }

    return detail;
  }

  // 按本轮顺序建立复盘条目，答题明细已有正文时仅保存引用。
  function buildReview(items, details, metadata) {
    const indices = new Map(details.map((detail, index) => [key(detail.sourceBankId, detail.questionId), index]));
    return {
      version: 1,
      ...metadata,
      items: items.map(
        // 未提交的题目保存快照，便于事后复盘时恢复原题和草稿。
        (item) => {
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
        },
      ),
    };
  }

  // 将新版复盘快照和旧版答题明细转换为页面共用的展示条目。
  function reviewRows(record) {
    const details = Array.isArray(record.details) ? record.details : [];
    const complete = record.review?.version === 1 && Array.isArray(record.review.items);
    const refs = complete ? record.review.items : details.map((_, detailIndex) => ({ detailIndex }));
    return refs.map(
      // 旧记录保留未知的本轮题号。缺题目快照时将条目标记为部分记录。
      (ref, index) => {
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
      },
    );
  }

  // 汇总训练结束方式、计时和未作答数量，供复盘列表显示。
  function reviewSummary(review, details) {
    return {
      version: 1,
      completion: review.completion,
      submitMode: review.submitMode,
      timing: review.timing,
      unanswered: reviewRows({ review, details }).filter((row) => row.status === 'unanswered').length,
    };
  }

  function buildReviewData(items, details, metadata) {
    const review = buildReview(items, details, metadata);
    return { review, reviewSummary: reviewSummary(review, details) };
  }

  globalThis.ShirohaTraining = Object.freeze({
    parsePracticeNumberRangeV58916,
    formatExactPracticeNumbersV58916,
    createClock,
    elapsedClock,
    transitionClock,
    formatDuration,
    snapshotItem,
    answerDetail,
    buildReview,
    reviewRows,
    reviewSummary,
    buildReviewData,
  });
})();
