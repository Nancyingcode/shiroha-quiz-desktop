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
    const windowSize = (radius * 2) + 1;
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
    for (let number = Math.max(2, start); number <= Math.min(pages - 1, end); number += 1) {
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

  function normalizeWebQuestionType(type) {
    const value = String(type || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (['single', 'single_choice', 'singlechoice', 'choice', 'radio'].includes(value)) {
      return 'single';
    }
    if (['multiple', 'multi', 'multiple_choice', 'multiplechoice', 'checkbox'].includes(value)) {
      return 'multiple';
    }
    if (['judge', 'judgement', 'judgment', 'true_false', 'truefalse', 'boolean'].includes(value)) {
      return 'judge';
    }
    if (['blank', 'fill', 'fill_blank', 'fillblank', 'fill_in_blank'].includes(value)) {
      return 'blank';
    }
    if (['short', 'short_answer', 'essay', 'qa', 'subjective', 'question_answer'].includes(value)) {
      return 'short';
    }
    return '';
  }

  function isTextType(type) {
    return type === 'blank' || type === 'short' || type === 'short_answer';
  }

  function normalizeBlankAnswersV58914(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((group) => {
      const values = Array.isArray(group) ? group : [group];
      const seen = new Set();
      const accepted = [];
      values.forEach((item) => {
        const answer = String(item ?? '').trim();
        if (answer && !seen.has(answer)) {
          seen.add(answer);
          accepted.push(answer);
        }
      });
      return accepted;
    });
  }

  function isMultiBlankQuestionV58914(question) {
    const isBlank = normalizeWebQuestionType(question && question.type) === 'blank';
    if (!isBlank) {
      return false;
    }
    const hasBlankGroups = Array.isArray(question && question.blankAnswers)
      && question.blankAnswers.length > 0;
    return hasBlankGroups;
  }

  function normalizeBlankTextV58914(value) {
    let text = String(value ?? '');
    try {
      text = text.normalize('NFKC');
    } catch {
      // 兼容缺少 Unicode 归一化的旧环境；最低浏览器版本保证支持后可移除回退。
    }
    const punctuation = { '，': ',', '；': ';', '：': ':', '（': '(', '）': ')', '。': '.', '！': '!', '？': '?' };
    text = text.replace(/[，；：（）。！？]/g, (char) => punctuation[char] || char);
    return text.trim().replace(/[\s\u3000]+/g, '').toLowerCase()
      .replace(/^[.,;:!?，。；：！？、]+|[.,;:!?，。；：！？、]+$/g, '');
  }

  function primaryBlankAnswerV58914(groups) {
    return normalizeBlankAnswersV58914(groups).map((group) => group[0] || '').join('；');
  }

  function cloneBlankAnswersV58914(groups) {
    return normalizeBlankAnswersV58914(groups).map((group) => [...group]);
  }

  function normalizeTextAnswerForCompare(value) {
    return String(value || '').trim().replace(/[\s\u3000]+/g, '')
      .replace(/[，,。.;；:：、!！?？]/g, '').toLowerCase();
  }

  function sameAnswerForQuestion(question, chosen, answer) {
    if (isMultiBlankQuestionV58914(question)) {
      const groups = normalizeBlankAnswersV58914(question.blankAnswers);
      const hasExpectedBlankCount = Array.isArray(chosen) && chosen.length === groups.length;
      if (!hasExpectedBlankCount) {
        return false;
      }
      return groups.every((accepted, index) => {
        const actual = normalizeBlankTextV58914(chosen[index]);
        if (!actual) {
          return false;
        }
        return accepted.some((item) => normalizeBlankTextV58914(item) === actual);
      });
    }
    if (isTextType(question.type)) {
      const user = normalizeTextAnswerForCompare((chosen || []).join('；'));
      if (!user) {
        return false;
      }
      return (answer || []).some((item) => normalizeTextAnswerForCompare(item) === user);
    }
    return JSON.stringify([...chosen].sort()) === JSON.stringify([...answer].sort());
  }

  globalThis.ShirohaQuizCore = Object.freeze({
    listPageRange,
    listPageNumbers,
    normalizeWebQuestionType,
    isTextType,
    normalizeBlankAnswersV58914,
    isMultiBlankQuestionV58914,
    normalizeBlankTextV58914,
    primaryBlankAnswerV58914,
    cloneBlankAnswersV58914,
    normalizeTextAnswerForCompare,
    sameAnswerForQuestion,
  });
})();
