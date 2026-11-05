(() => {
  'use strict';

  function listPageRange(total, page, size) {
    const pages = Math.max(1, Math.ceil(total / size));
    const currentPage = Math.max(0, Math.min(page, pages - 1));
    return {
      page: currentPage,
      pages,
      start: currentPage * size,
      end: Math.min(total, (currentPage + 1) * size),
    };
  }

  function listPageNumbers(page, pages, compact = false) {
    const radius = compact ? 1 : 2;
    const windowSize = radius * 2 + 1;
    if (pages <= windowSize + 2) {
      return Array.from({ length: pages }, (_, index) => index + 1);
    }
    let start = Math.max(1, page - radius);
    let end = Math.min(pages, page + radius);
    if (page <= radius + 1) {
      start = 1;
      end = windowSize;
    } else if (page >= pages - radius) {
      start = pages - windowSize + 1;
      end = pages;
    }
    const numbers = [1];
    if (start === 3) {
      numbers.push(2);
    } else if (start > 3) {
      numbers.push('ellipsis');
    }
    for (let number = Math.max(2, start); number <= Math.min(pages - 1, end); number++) {
      numbers.push(number);
    }
    if (end === pages - 2) {
      numbers.push(pages - 1);
    } else if (end < pages - 2) {
      numbers.push('ellipsis');
    }
    numbers.push(pages);
    return numbers;
  }

  function sameAnswerForQuestion(question, chosen, answer, rules) {
    if (rules.isMultiBlankQuestionV58914(question)) {
      const groups = rules.normalizeBlankAnswersV58914(question.blankAnswers);
      if (!Array.isArray(chosen) || chosen.length !== groups.length) {
        return false;
      }
      return groups.every((accepted, index) => {
        const actual = rules.normalizeBlankTextV58914(chosen[index]);
        return !!actual && accepted.some((item) => rules.normalizeBlankTextV58914(item) === actual);
      });
    }
    if (rules.isTextType(question.type)) {
      const user = rules.normalizeTextAnswerForCompare((chosen || []).join('；'));
      return !!user && (answer || []).some((item) => rules.normalizeTextAnswerForCompare(item) === user);
    }
    return JSON.stringify([...chosen].sort()) === JSON.stringify([...answer].sort());
  }

  globalThis.ShirohaQuizCore = Object.freeze({ listPageRange, listPageNumbers, sameAnswerForQuestion });
})();
