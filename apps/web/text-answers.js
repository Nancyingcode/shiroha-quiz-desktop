(() => {
  'use strict';

  function parseAnswerEntries(normalizedText, rules) {
    const { isImportNoiseLine, getHeadingType, splitAnswer, splitTextAnswer } = rules;
    const lines = normalizedText.split('\n')
      .map((line) => line.trim()).filter(Boolean).filter((line) => !isImportNoiseLine(line));
    const entries = [];
    let group = '';
    let pendingNumber = '';
    const push = (number, answer, entryGroup = group) => {
      const choices = splitAnswer(answer);
      const finalAnswer = choices.length ? choices : splitTextAnswer(answer);
      if (finalAnswer.length) {
        entries.push({ number: String(number || ''), group: entryGroup || '', answer: finalAnswer, raw: answer });
      }
    };
    for (const raw of lines) {
      const heading = getHeadingType(raw);
      if (heading) {
        group = heading;
        pendingNumber = '';
        continue;
      }
      let line = raw.replace(/^[-•●]\s*/, '').trim();
      // v58.1：修复答案表中“28 B29 B”这类缺少空格的紧凑粘连。
      line = line.replace(/(\d{1,4})\s*([A-Ga-g])(?=\d{1,4}\s*[A-Ga-g])/g, '$1$2 ');
      // 1-10：D A A B C D A C B D
      const range = line.match(/^\s*(\d+)\s*[-~—至到]\s*(\d+)\s*[:：]\s*(.+)$/);
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        const tokens = range[3].trim().split(/\s+/).filter(Boolean);
        if (tokens.length === end - start + 1) {
          tokens.forEach((token, index) => push(start + index, token));
          continue;
        }
      }
      // 一行多个：1B 2C 3B ... / 1.D 2.A 3.A 4.B 5.C
      // v58.1：优先识别“题号 + 字母答案”的紧凑答案表，避免把 28 B 误拆成 2:8。
      const compactLetterPairs = [];
      let compactMatch;
      const compactLetterRe = /(?:^|\s)(\d{1,4})\s*([A-Ga-g])(?=\s*(?:\d{1,4}\s*[A-Ga-g]|$))/g;
      while ((compactMatch = compactLetterRe.exec(line))) {
        compactLetterPairs.push({ number: compactMatch[1], ans: compactMatch[2] });
      }
      if (compactLetterPairs.length >= 2) {
        compactLetterPairs.forEach((entry) => push(entry.number, entry.ans));
        continue;
      }
      const pairRe = /(?:第\s*)?(\d+)\s*(?:题)?\s*[.、．:：]?\s*(?:答案|正确答案|参考答案)?\s*[:：]?\s*([A-Ga-g]{1,7}|[1-9]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|v|V|T|F|True|False)(?=\s|$|\d+[.、．:：])/g;
      const hits = [];
      let match;
      while ((match = pairRe.exec(line))) {
        hits.push({ number: match[1], ans: match[2] });
      }
      if (hits.length >= 2) {
        hits.forEach((entry) => push(entry.number, entry.ans));
        continue;
      }
      // 第1题：D / 1. D / 1 答案：A、C、D
      const one = line.match(/^\s*(?:第\s*)?(\d+)\s*(?:题)?\s*[.、．:：]?\s*(?:答案|正确答案|参考答案|标准答案|参考要点|答题要点)?\s*[:：]?\s*(.+?)\s*$/);
      if (one) {
        const answer = one[2].trim();
        if (splitAnswer(answer).length) {
          push(one[1], answer);
          pendingNumber = '';
          continue;
        }
      }
      // 只有题号，下一行是答案
      const numberOnly = line.match(/^\s*(?:第\s*)?(\d+)\s*(?:题)?[.、．:：]?\s*$/);
      if (numberOnly) {
        pendingNumber = numberOnly[1];
        continue;
      }
      // 答案：D，没有题号，按顺序使用
      const answerOnly = line.match(/^(?:答案|正确答案|参考答案|标准答案)\s*[:：]?\s*(.+)$/);
      if (answerOnly) {
        push(pendingNumber, answerOnly[1]);
        pendingNumber = '';
        continue;
      }
      // 只有答案，按顺序使用
      if (splitAnswer(line).length && /^([A-Ga-g]{1,7}|[1-9]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|v|V|T|F|True|False)$/.test(line)) {
        push(pendingNumber, line);
        pendingNumber = '';
        continue;
      }
    }
    return entries;
  }

  function findNumberedAnswer(candidates, question, mode, rules) {
    const { normGroup, isRawJudgeSymbolAnswer, isJudgeSymbolAnswer } = rules;
    let hit = null;
    if (candidates.length) {
      const questionGroup = normGroup(question.category || question.group || question.type || '');
      hit = candidates.find((entry) => normGroup(entry.group) === questionGroup) || null;
      if (!hit && question.type === 'judge') {
        hit = candidates.find((entry) => normGroup(entry.group) === 'judge'
          || isRawJudgeSymbolAnswer(entry.raw)
          || (entry.answer || []).some((answer) => isJudgeSymbolAnswer(answer))) || null;
      }
      if (!hit && question.type === 'multiple') {
        hit = candidates.find((entry) => normGroup(entry.group) === 'multiple'
          || ((entry.answer || []).join('').length > 1 && !isRawJudgeSymbolAnswer(entry.raw))) || null;
      }
      if (!hit && question.type === 'single') {
        hit = candidates.find((entry) => normGroup(entry.group) === 'single'
          || ((entry.answer || []).length === 1 && /^[A-G1-9]$/.test(String(entry.answer[0] || ''))
            && !isRawJudgeSymbolAnswer(entry.raw))) || null;
      }
      if (!hit) {
        // 重复题号场景下不要把单选/多选答案强行套给判断题；宁可留给预览区标异常，也不要静默错配。
        hit = (candidates.length === 1 || mode === 'number-strict') ? candidates[0] : null;
      }
    }
    return hit;
  }

  function isSourceAnswerEntryLine(line) {
    const raw = String(line || '').trim();
    if (/^\s*\d{1,4}\s*[.、．:：]\s*(?:【|\[)?\s*(?:答案|正确答案|参考答案|标准答案|解析|答案解析|试题解析)\s*(?:】|\])?\s*[:：]?/i.test(raw)) {
      return true;
    }
    if (/^\s*\d{1,4}\s*[.、．:：]\s*[A-Ga-g]{1,7}(?:\s*(?:【|\[)\s*(?:解析|答案解析)\s*(?:】|\])|[。．、，,；;：:]|\s*$)/.test(raw)) {
      return true;
    }
    return false;
  }

  function sourceQuestionNumberFromLine(line, rules) {
    const raw = String(line || '').trim();
    const isNotQuestion = !raw || rules.isOptionLine(raw) || rules.isAnswerLine(raw)
      || rules.isAnalysisLine(raw) || isSourceAnswerEntryLine(raw)
      || rules.getHeadingType(raw) || rules.isImportNoiseLine(raw);
    if (isNotQuestion) {
      return 0;
    }
    const typed = rules.getNumberedTypeQuestionLineV592(raw);
    if (typed) {
      return Number(typed.number) || 0;
    }
    const header = rules.getNumberedTypeQuestionHeader(raw);
    if (header) {
      return Number(header.number) || 0;
    }
    const match = raw.match(/^\s*(?:第\s*)?(\d{1,4})\s*(?:题)?[、.．:：]/)
      || raw.match(/^\s*[（(【[]\s*(\d{1,4})\s*[）)】\]]/);
    return match ? Number(match[1]) || 0 : 0;
  }

  globalThis.ShirohaTextAnswers = Object.freeze({
    parseAnswerEntries, findNumberedAnswer, sourceQuestionNumberFromLine,
  });
})();
