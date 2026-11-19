// 对双文件导入的候选答案打分并匹配题目，预览诊断由导入流程写入。
(() => {
  'use strict';

  const SOURCE_WEIGHTS = { answered: 120, invalid: 100, unanswered: 90, typeMismatch: 150, warnings: 10 };
  const MODE_WEIGHTS = { answered: 100, invalid: 80, unanswered: 50, typeMismatch: 120, warnings: 8 };

  // 复用文本解析提供的题型、答案归一化和异常诊断规则。
  function create({
    collectImportWarnings,
    getHeadingType,
    isImportNoiseLine,
    isJudgeSymbolAnswer,
    isRawJudgeSymbolAnswer,
    mapType,
    normalizeAnswer,
    normalizeImportText,
    normalizeQuestion,
    splitAnswer,
    splitTextAnswer,
  }) {
    const answerEntryRules = {
      isImportNoiseLine, getHeadingType, splitAnswer, splitTextAnswer,
    };

    function parseAnswerEntries(text) {
      const normalizedText = normalizeImportText(text);
      return globalThis.ShirohaTextAnswers.parseAnswerEntries(normalizedText, answerEntryRules);
    }

    // 答案表专用解析不足时，复用普通题库解析结果提取可用答案。
    function extractParsedAnswerEntries(parsed) {
      const entries = [];
      parsed.forEach(/* 仅收录有可辨认答案的解析题，并保留原序号供后续合并。 */ (q, i) => {
        const ans = (q.answer || []).map((x) => String(x || '').trim()).filter(Boolean);
        if (!ans.length) {
          return;
        }

        entries.push({
          number: String(q.number || i + 1),
          group: q.category || q.group || q.type || '',
          answer: ans,
          raw: ans.join(''),
        });
      });

      return { entries, questionCount: parsed.length };
    }

    // 同时统计缺答和异常，分别供答案来源和匹配方式择优。
    function countMatchResults(questions) {
      const importWarns = collectImportWarnings(questions);
      const unanswered = questions.filter((q) => !(q.answer || []).length).length;
      const invalid = importWarns.filter((w) => !/* 缺答单独计入匹配率，不重复计入无效答案诊断。 */ /缺少答案|缺少参考答案/.test(w)).length;
      const typeMismatch = questions.filter((q) => q.type === 'judge' && (q.answer || []).some((a) => !['A', 'B'].includes(String(a)))).length;
      return { answered: questions.length - unanswered, invalid, unanswered, typeMismatch };
    }

    // 无效评分排除已单独计入未作答权重的缺答诊断。
    function scoreMatchQuality({
      answered,
      invalid,
      unanswered,
      typeMismatch,
    }, warningCount, weights) {
      return (answered * weights.answered)
        - (invalid * weights.invalid)
        - (unanswered * weights.unanswered)
        - (typeMismatch * weights.typeMismatch)
        - (warningCount * weights.warnings);
    }

    // 在多个解析来源中保留最先出现的同题号、同分组和同答案条目。
    function combineDualAnswerEntries(...entryGroups) {
      const merged = [];
      const seen = new Set();
      for (const entries of entryGroups) {
        for (const entry of entries) {
          const key = `${String(entry.number || '')}|${String(entry.group || '')}|${(entry.answer || []).join('')}`;
          if (seen.has(key)) {
            continue;
          }

          seen.add(key);
          merged.push(entry);
        }
      }

      return merged;
    }

    // 独立保留每种答案解析来源，完整题库解析也可补充答案表遗漏的题号。
    function collectDualAnswerCandidates({ standardEntries, analysisEntries, fallbackQuestions }) {
      const fullParsed = extractParsedAnswerEntries(fallbackQuestions);
      const candidates = [
        { key: 'simple', name: '答案表提取', entries: standardEntries, detail: `答案表提取${standardEntries.length}条` },
      ];
      if (analysisEntries.length) {
        candidates.push({ key: 'analysis', name: '答案解析区提取', entries: analysisEntries, detail: `答案解析区提取${analysisEntries.length}条` });
      }

      if (fullParsed.entries.length) {
        candidates.push({ key: 'full', name: '完整题库解析兜底', entries: fullParsed.entries, detail: `完整题库解析${fullParsed.entries.length}条（共识别${fullParsed.questionCount || 0}题）` });
      }

      if ((standardEntries.length || analysisEntries.length) && fullParsed.entries.length) {
        const merged = combineDualAnswerEntries(standardEntries, analysisEntries, fullParsed.entries);
        candidates.push({ key: 'hybrid', name: '答案表提取 + 完整题库解析兜底', entries: merged, detail: `混合提取${merged.length}条（答案表${standardEntries.length} + 答案解析${analysisEntries.length} + 完整题库${fullParsed.entries.length}）` });
      }

      return candidates;
    }

    // 综合答案表、解析区和完整题库解析，依据合并质量选择可用答案来源。
    function resolveDualAnswerCandidates(questions, sources, mode = 'auto') {
      const candidates = collectDualAnswerCandidates(sources);
      const evaluated = candidates.map(/* 使用同一批题目试配各来源，保证来源得分可比较。 */ (c) => {
        const result = mergeQuestionAnswers(questions, c.entries, mode);
        const quality = countMatchResults(result?.questions || []);
        const score = scoreMatchQuality(quality, (result?.warnings || []).length, SOURCE_WEIGHTS);
        return { ...c, result, score };
      }).sort((a, b) => b.score - a.score);
      const best = evaluated[0] || { entries: [], name: '答案表提取', detail: '答案表提取0条', result: mergeQuestionAnswers(questions, [], mode), score: -999999 };
      return {
        answerEntries: best.entries || [],
        answerSourceName: best.name,
        answerSourceSummary: evaluated.map((c) => `${c.name}${(c.entries || []).length}条/质量${c.score}`).join('；'),
        result: best.result,
        candidates: evaluated,
      };
    }

    // 按题型分组、题号或顺序匹配答案；自动模式比较匹配质量后择优。
    function mergeQuestionAnswers(questions, answers, mode) {
      if (mode === 'auto') {
        const labelMap = { group: '按题型分组 + 组内题号对应', number: '智能按题号对应', order: '按顺序对应' };
        const candidates = ['group', 'number', 'order'].map(/* 单独试算每种合并模式，按照缺答、无效答案和题型冲突排序。 */ (m) => {
          const r = mergeQuestionAnswers(questions, answers, m);
          const quality = countMatchResults(r.questions || []);
          const score = scoreMatchQuality(quality, (r.warnings || []).length, MODE_WEIGHTS);
          return { ...r, chosenMode: m, strategyName: labelMap[m], autoScore: score, autoUnanswered: quality.unanswered, autoInvalid: quality.invalid };
        });
        candidates.sort((a, b) => b.autoScore - a.autoScore);

        const best = candidates[0] || { questions: [], warnings: [] };
        const summary = candidates.map((c) => `${c.strategyName}${(c.questions || []).length}题/缺答案${c.autoUnanswered}/质量${c.autoScore}`).join('；');
        best.autoSummary = summary;
        return best;
      }

      const warnings = [];
      if (!questions.length) {
        warnings.push('题目文件未识别到题目。');
      }

      if (!answers.length) {
        warnings.push('答案文件未识别到答案。');
      }

      const qs = questions.map((q, i) => ({ ...q, answer: [], number: q.number || i + 1 }));
      const normGroup = (s) => mapType(s) || mapType(String(s || '').replace(/* 在题型映射前兼容末尾存在“题”字的分组名称。 */ /题$/, '')) || String(s || '').replace(/* 未识别为题型的来源分组按去除内部空白的名称匹配。 */ /\s/g, '');

      if (mode === 'order') {
        qs.forEach((q, i) => {
          if (answers[i]) {
            q.answer = normalizeAnswer(answers[i].answer, q.options, q.type);
          }
        });
      } else if (mode === 'group') {
        const used = new Set();
        qs.forEach(/* 同组同题号只消耗一条答案，避免重复题号共用答案。 */ (q) => {
          const qg = normGroup(q.category || q.group || '');
          const hitIndex = answers.findIndex((a, ai) => !used.has(ai) && String(a.number) === String(q.number) && normGroup(a.group) === qg);
          if (hitIndex >= 0) {
            q.answer = normalizeAnswer(answers[hitIndex].answer, q.options, q.type);
            used.add(hitIndex);
          }
        });

        if (qs.some((q) => !q.answer.length)) {
          warnings.push('部分题目没有按“题型分组 + 题号”匹配到答案，可尝试改用“按顺序对应”或检查分组标题。');
        }
      } else {
        // 按题号对应时也要兼容“每个题型都从 1 重新编号”的答案表。
        // 如果同一题号在单选/多选/判断区重复出现，优先按题目自身题型匹配答案分组，避免判断题误取单选题的 C/D 答案。
        const byNumber = new Map();
        const dup = new Set();
        answers.forEach(/* 收集同号候选，供后续按题型区分。 */ (a, idx) => {
          if (!a.number) {
            return;
          }

          const key = String(a.number);
          if (!byNumber.has(key)) {
            byNumber.set(key, []);
          } else {
            dup.add(key);
          }

          byNumber.get(key).push({ ...a, idx });
        });

        if (dup.size) {
          warnings.push(`答案文件存在重复题号：${[...dup].slice(0, 10).join('、')}。已优先按题型分组匹配；如仍有异常，请使用“按题型分组 + 组内题号对应”。`);
        }

        qs.forEach(/* 从同题号候选中择优匹配，无明确题号的答案才可按原顺序补入。 */ (q, i) => {
          const candidates = byNumber.get(String(q.number)) || [];
          const hit = globalThis.ShirohaTextAnswers.findNumberedAnswer(candidates, q, mode, {
            normGroup, isRawJudgeSymbolAnswer, isJudgeSymbolAnswer,
          });
          if (hit) {
            q.answer = normalizeAnswer(hit.answer, q.options, q.type);
          } else if (answers[i] && !answers[i].number) {
            q.answer = normalizeAnswer(answers[i].answer, q.options, q.type);
          }
        });
      }

      const unanswered = qs.filter((q) => !q.answer.length).length;
      if (questions.length !== answers.length) {
        warnings.push(`数量提示：识别到题目 ${questions.length} 道，答案 ${answers.length} 个。`);
      }

      if (unanswered) {
        warnings.push(`合并后仍有 ${unanswered} 道题缺少答案。`);
      }

      return { questions: qs.map((q, i) => normalizeQuestion(q, i)), warnings };
    }

    return { parseAnswerEntries, resolveDualAnswerCandidates, mergeQuestionAnswers };
  }

  globalThis.ShirohaDualAnswers = Object.freeze({ create });
})();
