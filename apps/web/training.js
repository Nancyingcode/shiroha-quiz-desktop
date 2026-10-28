(() => {
  'use strict';
  const hasAnswer = values => Array.isArray(values) && values.some(value => String(value ?? '').trim());
  const clone = value => JSON.parse(JSON.stringify(value));
  const key = (bankId, questionId) => JSON.stringify([bankId || '', questionId || '']);
  function createClock(at) { return { state: 'running', elapsed: 0, since: at }; }
  function elapsedClock(clock, at) {
    if (!clock) return 0;
    return clock.elapsed + (clock.state === 'running' ? Math.max(0, at - clock.since) : 0);
  }
  function transitionClock(clock, next, at) {
    if (!clock || clock.state === 'stopped' || clock.state === next) return clock;
    return { state: next, elapsed: elapsedClock(clock, at), since: at };
  }
  function formatDuration(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60);
    return (hours ? hours + ':' : '') + String(minutes).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
  }
  function buildReview(items, details, metadata) {
    const indices = new Map(details.map((detail, index) => [key(detail.sourceBankId, detail.questionId), index]));
    return { version: 1, ...metadata, items: items.map(item => {
      const detailIndex = indices.get(key(item.bankId, item.question.id));
      const ref = { sourceBankId: item.bankId || '', sourceBankName: item.bankName || '', questionId: item.question.id, bankQuestionNumber: item.bankQuestionNumber || null };
      if (detailIndex !== undefined) return { ...ref, detailIndex };
      return { ...ref, question: clone(item.question), draft: [...(item.chosen || [])], revealed: !!item.revealed };
    }) };
  }
  function reviewRows(record) {
    const details = Array.isArray(record.details) ? record.details : [];
    const complete = record.review?.version === 1 && Array.isArray(record.review.items);
    const refs = complete ? record.review.items : details.map((_, detailIndex) => ({ detailIndex }));
    return refs.map((ref, index) => {
      const detail = Number.isInteger(ref.detailIndex) ? details[ref.detailIndex] : null;
      const snapshot = detail?.nativeQuestion || ref.question;
      const question = snapshot || (detail ? { id: detail.questionId, question: detail.question || '', type: detail.type, answer: detail.answer || [], options: [], blankAnswers: detail.blankAnswers } : null);
      const chosen = detail?.chosen || detail?.userAnswer || [];
      let status = 'unanswered';
      if (!question) status = 'unrecorded';
      else if (detail && hasAnswer(chosen)) status = detail.correct === true ? 'correct' : 'wrong';
      return { index, roundNumber: complete ? index + 1 : null, bankQuestionNumber: ref.bankQuestionNumber || null,
        bankId: ref.sourceBankId || detail?.sourceBankId || record.bankId || '', bankName: ref.sourceBankName || detail?.sourceBankName || record.bankName || '',
        question, chosen, draft: ref.draft || [], revealed: !!ref.revealed, status, partial: !snapshot, detail };
    });
  }
  function reviewSummary(review, details) {
    return { version: 1, completion: review.completion, submitMode: review.submitMode, timing: review.timing,
      unanswered: reviewRows({ review, details }).filter(row => row.status === 'unanswered').length };
  }
  globalThis.ShirohaTraining = Object.freeze({ createClock, elapsedClock, transitionClock, formatDuration, buildReview, reviewRows, reviewSummary });
})();
