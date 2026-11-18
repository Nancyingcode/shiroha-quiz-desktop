// 向 Web 和桌面提供相同的分页、题型归一化与答案比较规则。
(() => {
  'use strict';

  // 将页码限制在有效页内，返回可直接用于数组切片的起止索引。
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

  // 首尾附近把页码窗口贴边，避免可见页码数量随滚动起伏。
  function pageWindow(page, pages, radius, windowSize) {
    let start = Math.max(1, page - radius);
    let end = Math.min(pages, page + radius);
    if (page <= radius + 1) {
      start = 1;
      end = windowSize;
    } else if (page >= pages - radius) {
      start = pages - windowSize + 1;
      end = pages;
    }

    return { start, end };
  }

  // 保留首尾页，连续缺少多页时才插入省略号。
  function listPageNumbers(page, pages, compact = false) {
    const radius = compact ? 1 : 2;
    const windowSize = (radius * 2) + 1;
    if (pages <= windowSize + 2) {
      return Array.from({ length: pages }, (_, index) => index + 1);
    }

    const { start, end } = pageWindow(page, pages, radius, windowSize);
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

  // 将外部题库的英文题型别名转换为评分和导入共同使用的类型。
  function normalizeWebQuestionType(type) {
    // 空白和连字符都视为英文题型单词间的分隔符。
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

  // 每空只去除空答案和重复项，首个答案仍作为界面显示的主答案。
  function normalizeBlankGroup(group) {
    const values = Array.isArray(group) ? group : [group];
    const seen = new Set();
    const accepted = [];
    values.forEach(
      // 同一空的等价答案按原始录入顺序保留。
      (item) => {
        const answer = String(item ?? '').trim();
        if (answer && !seen.has(answer)) {
          seen.add(answer);
          accepted.push(answer);
        }
      },
    );

    return accepted;
  }

  function normalizeBlankAnswersV58914(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map(normalizeBlankGroup);
  }

  // 只有显式保存了按空答案组的填空题才按位置评分。
  function isMultiBlankQuestionV58914(question) {
    const isBlank = normalizeWebQuestionType(question && question.type) === 'blank';
    if (!isBlank) {
      return false;
    }

    const hasBlankGroups = Array.isArray(question && question.blankAnswers)
      && question.blankAnswers.length > 0;
    return hasBlankGroups;
  }

  // 多空填空在同一空内比较，统一中英文书写差异并保留中间标点。
  function normalizeBlankTextV58914(value) {
    let text = String(value ?? '');
    try {
      text = text.normalize('NFKC');
    } catch {
      // 兼容缺少 Unicode 归一化的旧环境；最低浏览器版本保证支持后可移除回退。
    }

    const punctuation = { '，': ',', '；': ';', '：': ':', '（': '(', '）': ')', '。': '.', '！': '!', '？': '?' };
    // 将指定全角标点转换为对应的半角标点。
    text = text.replace(/[，；：（）。！？]/g, (char) => punctuation[char] || char);

    // 抹去空白（含全角空格），避免录入的间距影响判定。
    const normalized = text.trim().replace(/[\s\u3000]+/g, '').toLowerCase();
    // 忽略两端的句读符号，内部标点仍参与比较。
    return normalized.replace(/^[.,;:!?，。；：！？、]+|[.,;:!?，。；：！？、]+$/g, '');
  }

  function primaryBlankAnswerV58914(groups) {
    return normalizeBlankAnswersV58914(groups).map((group) => group[0] || '').join('；');
  }

  function cloneBlankAnswersV58914(groups) {
    return normalizeBlankAnswersV58914(groups).map((group) => [...group]);
  }

  function normalizeTextAnswerForCompare(value) {
    // 旧文本题把整份作答合并后比较，合并时忽略中英文空格。
    const text = String(value || '').trim().replace(/[\s\u3000]+/g, '');
    // 过滤旧文本比较规则允许忽略的中英文标点。
    return text.replace(/[，,。.;；:：、!！?？]/g, '').toLowerCase();
  }

  // 多空填空必须逐空命中各自的等价答案，空白或少一空都不能得分。
  function matchBlankGroups(groups, chosen) {
    if (!Array.isArray(chosen) || chosen.length !== groups.length) {
      return false;
    }

    return groups.every(
      // 仅比较同一位置的答案组，避免相邻两空对调后仍判对。
      (accepted, index) => {
        const actual = normalizeBlankTextV58914(chosen[index]);
        if (!actual) {
          return false;
        }

        return accepted.some((item) => normalizeBlankTextV58914(item) === actual);
      },
    );
  }

  // 按题型应用文本、逐空或选项序列比较规则，排序前复制作答和参考答案。
  function sameAnswerForQuestion(question, chosen, answer) {
    if (isMultiBlankQuestionV58914(question)) {
      const groups = normalizeBlankAnswersV58914(question.blankAnswers);
      return matchBlankGroups(groups, chosen);
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
