// 解析独立答案表、匹配题号，并区分原文题干和答案区条目。
(() => {
  'use strict';

  // 只有答案数量等于区间题量时，才能按区间展开对应题号。
  function parseAnswerRange(line) {
    // 1-10：D A A B C D A C B D
    const range = line.match(/^\s*(\d+)\s*[-~—至到]\s*(\d+)\s*[:：]\s*(.+)$/);
    if (!range) {
      return null;
    }

    const start = Number(range[1]);
    const end = Number(range[2]);
    // 区间内的答案以连续空白分隔，每个片段对应一道题。
    const tokens = range[3].trim().split(/\s+/).filter(Boolean);
    return tokens.length === end - start + 1 ? { start, tokens } : null;
  }

  // 保留一行内多组题号和答案的匹配顺序，供调用方判断是否成立。
  function collectAnswerPairs(line, pattern) {
    const pairs = [];
    let match;
    while ((match = pattern.exec(line))) {
      pairs.push({ number: match[1], ans: match[2] });
    }

    return pairs;
  }

  // 先解析紧凑字母答案表，缺少足够的匹配证据时再尝试通用答案表。
  function parseAnswerPairs(line) {
    // 一行多个：1B 2C 3B ... / 1.D 2.A 3.A 4.B 5.C
    // v58.1：优先识别“题号 + 字母答案”的紧凑答案表，避免把 28 B 误拆成 2:8。
    const compactLetterRe = /(?:^|\s)(\d{1,4})\s*([A-Ga-g])(?=\s*(?:\d{1,4}\s*[A-Ga-g]|$))/g;
    const compactLetterPairs = collectAnswerPairs(line, compactLetterRe);
    if (compactLetterPairs.length >= 2) {
      return compactLetterPairs;
    }

    // 匹配带可选题号标点和答案前缀的字母、数字或判断答案。
    const pairRe = /(?:第\s*)?(\d+)\s*(?:题)?\s*[.、．:：]?\s*(?:答案|正确答案|参考答案)?\s*[:：]?\s*([A-Ga-g]{1,7}|[1-9]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|v|V|T|F|True|False)(?=\s|$|\d+[.、．:：])/g;
    return collectAnswerPairs(line, pairRe);
  }

  // 识别单条答案或待续的题号；只识别到题号时将答案标为空。
  function parseSingleAnswerLine(line, splitAnswer, pendingNumber) {
    // 第1题：D / 1. D / 1 答案：A、C、D
    const one = line.match(/^\s*(?:第\s*)?(\d+)\s*(?:题)?\s*[.、．:：]?\s*(?:答案|正确答案|参考答案|标准答案|参考要点|答题要点)?\s*[:：]?\s*(.+?)\s*$/);
    if (one) {
      const answer = one[2].trim();
      if (splitAnswer(answer).length) {
        return { number: one[1], answer };
      }
    }

    // 只有题号，下一行是答案
    const numberOnly = line.match(/^\s*(?:第\s*)?(\d+)\s*(?:题)?[.、．:：]?\s*$/);
    if (numberOnly) {
      return { number: numberOnly[1], answer: null };
    }

    // 答案：D，没有题号，按顺序使用
    const answerOnly = line.match(/^(?:答案|正确答案|参考答案|标准答案)\s*[:：]?\s*(.+)$/);
    if (answerOnly) {
      return { number: pendingNumber, answer: answerOnly[1] };
    }

    // 只有答案，按顺序使用
    if (splitAnswer(line).length && /^([A-Ga-g]{1,7}|[1-9]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|v|V|T|F|True|False)$/.test(line)) {
      return { number: pendingNumber, answer: line };
    }

    return null;
  }

  // 按分组保留答案和原始输入，题号单独成行时等待随后出现的答案。
  function parseAnswerEntries(normalizedText, rules) {
    const {
      isImportNoiseLine,
      getHeadingType,
      splitAnswer,
      splitTextAnswer,
    } = rules;
    const lines = normalizedText.split('\n')
      .map((line) => line.trim()).filter(Boolean).filter((line) => !isImportNoiseLine(line));
    const entries = [];
    let group = '';
    let pendingNumber = '';
    // 先尝试客观题答案，失败后保留可识别的文本答案。
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

      // 去掉列表项目符号及其后的空白，便于读取题号。
      let line = raw.replace(/^[-•●]\s*/, '').trim();
      // v58.1：修复答案表中“28 B29 B”这类缺少空格的紧凑粘连。
      line = line.replace(/(\d{1,4})\s*([A-Ga-g])(?=\d{1,4}\s*[A-Ga-g])/g, '$1$2 ');
      const range = parseAnswerRange(line);
      if (range) {
        range.tokens.forEach((token, index) => push(range.start + index, token));

        continue;
      }

      const hits = parseAnswerPairs(line);
      if (hits.length >= 2) {
        hits.forEach((entry) => push(entry.number, entry.ans));

        continue;
      }

      const single = parseSingleAnswerLine(line, splitAnswer, pendingNumber);
      if (single) {
        if (single.answer === null) {
          pendingNumber = single.number;
        } else {
          push(single.number, single.answer);
          pendingNumber = '';
        }
      }
    }

    return entries;
  }

  // 重号先按题型分组找答案，再按已有答案结构择优，最后按模式决定是否回退。
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
        // 单个字母或选项序号可作为单选候选，但仍须排除原始判断符号。
        const singleChoice = /^[A-G1-9]$/;
        hit = candidates.find((entry) => normGroup(entry.group) === 'single'
          || ((entry.answer || []).length === 1 && singleChoice.test(String(entry.answer[0] || ''))
            && !isRawJudgeSymbolAnswer(entry.raw))) || null;
      }

      if (!hit) {
        // 重复题号场景下不要把单选/多选答案强行套给判断题；宁可留给预览区标异常，也不要静默错配。
        hit = (candidates.length === 1 || mode === 'number-strict') ? candidates[0] : null;
      }
    }

    return hit;
  }

  // 识别看似带题号的答案或解析行，避免误计为正文中的新题。
  function isSourceAnswerEntryLine(line) {
    const raw = String(line || '').trim();
    // 匹配题号后显式标注答案、参考答案或解析的行。
    if (/^\s*\d{1,4}\s*[.、．:：]\s*(?:【|\[)?\s*(?:答案|正确答案|参考答案|标准答案|解析|答案解析|试题解析)\s*(?:】|\])?\s*[:：]?/i.test(raw)) {
      return true;
    }

    // 匹配题号后紧跟选项字母及解析标记或行尾的紧凑答案。
    if (/^\s*\d{1,4}\s*[.、．:：]\s*[A-Ga-g]{1,7}(?:\s*(?:【|\[)\s*(?:解析|答案解析)\s*(?:】|\])|[。．、，,；;：:]|\s*$)/.test(raw)) {
      return true;
    }

    return false;
  }

  // 排除章节、选项和答案后再识别原文题号，缺少明确题号时返回零。
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

    // 识别“第12题：”或“12、”等依靠标点界定的题号。
    const punctuated = raw.match(/^\s*(?:第\s*)?(\d{1,4})\s*(?:题)?[、.．:：]/);
    // 普通带标点的题号未命中时，再识别圆括号或方括号包住的开头数字。
    const match = punctuated || raw.match(/^\s*[（(【[]\s*(\d{1,4})\s*[）)】\]]/);
    return match ? Number(match[1]) || 0 : 0;
  }

  globalThis.ShirohaTextAnswers = Object.freeze({
    parseAnswerEntries, findNumberedAnswer, sourceQuestionNumberFromLine,
  });
})();
