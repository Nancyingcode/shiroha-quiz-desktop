// 解析并校验 AI 的导入、核对和单题响应，保持人工确认语义。
(() => {
  'use strict';

  // 将模型响应解析与调用方的题型、答案和文本规则装配在同一模块。
  function create({
    normalizeType,
    normalizeQuestion,
    makeId,
    trimMultilineBoundaryV5910,
    splitAnswer,
  }) {
    // 兼容导入模型常用的题目列表字段与以序号为键的对象。
    function aiRefactorRawQuestionsV384(data) {
      let raw = Array.isArray(data) ? data : (data?.questions ?? data?.items ?? data?.data ?? data?.题目 ?? []);

      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        raw = Object.values(raw);
      }

      return Array.isArray(raw) ? raw : [];
    }

    // 逐项检查原始选项，避免归一化掩盖非法键、空内容或重复选项。
    function validateAiOptions(item, label, issues) {
      const rawOptions = item.options ?? item.choices ?? item['选项'] ?? [];

      if (rawOptions != null && !Array.isArray(rawOptions)) {
        issues.push(`${label}选项不是数组`);
        return false;
      }

      const seen = new Set();
      let invalid = false;

      for (const option of (rawOptions || [])) {
        if (!option || typeof option !== 'object' || Array.isArray(option)) {
          issues.push(`${label}存在非对象选项`);
          invalid = true;
          continue;
        }

        const key = String(option.key ?? option.label ?? '').trim().toUpperCase();
        const text = String(option.text ?? option.value ?? '').trim();

        // 预览只接受 A 到 G 的单字母选项键。
        if (!/^[A-G]$/.test(key)) {
          issues.push(`${label}存在非法选项键：${key || '空'}`);
          invalid = true;
        } else if (!text) {
          issues.push(`${label}选项${key}内容为空`);
          invalid = true;
        } else if (seen.has(key)) {
          issues.push(`${label}选项${key}重复`);
          invalid = true;
        } else {
          seen.add(key);
        }
      }

      return !invalid;
    }

    // 先验证原始题目，再归一化和检查答案；失败时保留题目级诊断，供导入选择兜底。
    function validateAiQuestion(item, index, issues) {
      const label = `第${index + 1}题`;

      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        issues.push(`${label}不是题目对象`);
        return;
      }

      const question = String(item.question ?? item.title ?? item.stem ?? item['题干'] ?? '').trim();

      if (!question) {
        issues.push(`${label}题干为空`);
        return;
      }

      const type = normalizeType(item.type ?? item.questionType ?? item.kind ?? item['题型'] ?? '');

      if (!['single', 'multiple', 'judge', 'blank', 'short'].includes(type)) {
        issues.push(`${label}题型无效`);
        return;
      }

      if (!validateAiOptions(item, label, issues)) {
        return;
      }

      const canonical = canonicalizeAiQuestionV99(item, index);
      const normalized = normalizeQuestion(canonical, index);

      if (type === 'single' && normalized.answer.length > 1) {
        issues.push(`${label}为单选题但返回多个答案`);
        return;
      }

      if ((type === 'single' || type === 'multiple') && normalized.options.length === 1) {
        issues.push(`${label}选择题仅有一个有效选项`);
      }

      if ((type === 'single' || type === 'multiple') && normalized.options.length) {
        const keys = new Set(normalized.options.map((o) => o.key));
        const unknown = normalized.answer.filter((a) => !keys.has(a));
        if (unknown.length) {
          issues.push(`${label}答案超出已有选项：${unknown.join(',')}`);
          return;
        }
      }

      if (type === 'judge' && normalized.answer.length > 1) {
        issues.push(`${label}判断题返回多个答案`);
        return;
      }

      return normalized;
    }

    // 只有每一题都能安全使用时才接受结构化结果，诊断按原顺序去重。
    function validateAiRefactorStructuredV384(data) {
      const raw = aiRefactorRawQuestionsV384(data);
      const issues = [];

      if (!raw.length) {
        return { usable: false, issues: ['AI 未返回可用结构化题目'], questions: [] };
      }

      const questions = [];

      raw.forEach((item, index) => {
        const normalized = validateAiQuestion(item, index, issues);
        if (normalized) {
          questions.push(normalized);
        }
      });

      return { usable: questions.length === raw.length && raw.length > 0, issues: [...new Set(issues)], questions };
    }

    // 保留结构化和文本两种导入结果，让调用方根据模式及校验结果决定如何处理。
    function parseAiRefactorPayloadV384(content) {
      let data = extractBalancedJsonV99(content);
      if (typeof data === 'string') {
        data = extractBalancedJsonV99(data);
      }

      if (!data || typeof data !== 'object') {
        throw new Error('AI 返回内容不是有效对象。');
      }

      const modeRaw = String(data.mode || data.resultMode || '').trim().toLowerCase();
      const raw = aiRefactorRawQuestionsV384(data);

      const directMode = ['direct_questions', 'structured_questions', 'structured', 'questions'].includes(modeRaw);
      const cleanMode = ['clean_text', 'cleaned_text', 'cleantext'].includes(modeRaw);
      let mode = raw.length ? 'direct_questions' : 'clean_text';
      if (directMode) {
        mode = 'direct_questions';
      } else if (cleanMode) {
        mode = 'clean_text';
      }

      const cleanedText = String(data.cleanedText ?? data.clean_text ?? data.text ?? '').trim();
      const cleanedAnswerText = String(data.cleanedAnswerText ?? data.cleaned_answer_text ?? '').trim();

      const notes = [...(Array.isArray(data.notes) ? data.notes : []), ...(Array.isArray(data.warnings) ? data.warnings : [])].map((x) => String(x || '').trim()).filter(Boolean);

      const structured = validateAiRefactorStructuredV384(data);

      return { mode, cleanedText, cleanedAnswerText, questions: structured.questions, structuredUsable: mode === 'direct_questions' && structured.usable, structuredIssues: structured.issues, notes, data };
    }

    // 读取不同提供商的输出字段，并按原顺序拼接分段内容。
    function aiResponseContentV99(payload) {
      const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text ?? payload?.output_text ?? payload?.response ?? payload?.text;

      if (Array.isArray(content)) {
        return content.map((x) => (typeof x === 'string' ? x : (x?.text || x?.content || ''))).join('');
      }

      return String(content ?? '');
    }

    // 从一个括号开头扫描候选 JSON，忽略字符串内的括号并尊重转义状态。
    function parseBalancedJsonAt(s, start) {
      const stack = [];
      let quoted = false;
      let escaped = false;

      for (let i = start;i < s.length;i += 1) {
        const ch = s[i];

        if (quoted) {
          if (escaped) {
            escaped = false;
          } else if (ch === '\\') {
            escaped = true;
          } else if (ch === '"') {
            quoted = false;
          }

          continue;
        }

        if (ch === '"') {
          quoted = true;
          continue;
        }

        if (ch === '{' || ch === '[') {
          stack.push(ch);
        } else if (ch === '}' || ch === ']') {
          const open = stack.pop();
          if (!open || (open === '{' && ch !== '}') || (open === '[' && ch !== ']')) {
            break;
          }

          if (!stack.length) {
            const part = s.slice(start, i + 1);
            try {
              return JSON.parse(part);
            } catch {
              break;
            }
          }
        }
      }

      return undefined;
    }

    // 优先解析完整响应，允许从带说明的模型输出中恢复首个合法 JSON。
    function extractBalancedJsonV99(text) {
      // 格式化工具可能在响应开头插入 BOM，解析前仅移除开头的标记。
      const s = String(text || '').replace(/^\uFEFF/, '').trim();

      try {
        return JSON.parse(s);
      } catch {
        // 模型可能在 JSON 前后附带说明，继续查找平衡的对象或数组。
      }

      for (let start = 0;start < s.length;start += 1) {
        if (s[start] !== '{' && s[start] !== '[') {
          continue;
        }

        const parsed = parseBalancedJsonAt(s, start);
        if (parsed !== undefined) {
          return parsed;
        }
      }

      throw new Error('AI 已返回内容，但无法提取合法 JSON。');
    }

    // 把以字母开头的字符串转成键值对，保留原来已结构化或无标号的内容。
    function canonicalizeAiOption(item) {
      if (typeof item === 'string') {
        // 识别带字母和标点的字符串选项，保留后续的完整选项文字。
        const m = item.match(/^\s*([A-Ga-g])\s*[、.．:：]\s*(.+)$/s);
        return m ? { key: m[1].toUpperCase(), text: m[2] } : item;
      }

      return item;
    }

    // 将数组或对象形式的选项转成后续校验能够统一读取的格式。
    function canonicalizeAiOptionsV99(value) {
      if (Array.isArray(value)) {
        return value.map(canonicalizeAiOption);
      }

      if (value && typeof value === 'object') {
        return Object.entries(value).map(([key, text]) => ({ key: String(key).toUpperCase(), text: typeof text === 'object' ? (text?.text ?? text?.content ?? JSON.stringify(text)) : String(text ?? '') }));
      }

      return [];
    }

    // 兼容模型返回的中英文题目字段，导入为带待核对状态的候选题。
    function canonicalizeAiQuestionV99(raw, index) {
      const q = raw && typeof raw === 'object' ? raw : {};

      const answer = q.answer ?? q.correctAnswer ?? q.answerKeys ?? q['答案'] ?? q['正确答案'] ?? [];

      return {
        ...q,
        id: makeId('aiq', index),
        number: q.number ?? q['序号'] ?? index + 1,
        type: q.type ?? q.questionType ?? q.kind ?? q['题型'] ?? '',
        question: q.question ?? q.title ?? q.stem ?? q.content ?? q['题干'] ?? q['问题'] ?? '',
        options: canonicalizeAiOptionsV99(q.options ?? q.choices ?? q['选项'] ?? []),
        answer: answer && typeof answer === 'object' && !Array.isArray(answer) ? (answer.keys ?? answer.value ?? answer.text ?? []) : answer,
        blankAnswers: q.blankAnswers ?? q['逐空答案'] ?? q['填空答案'] ?? [],
        analysis: q.analysis ?? q.explanation ?? q.explain ?? q['解析'] ?? '',
        category: q.category ?? q.topic ?? q.group ?? q.section ?? q['分类'] ?? q['章节'] ?? q['分区'] ?? '',
        source: q.source ?? q['来源'] ?? 'ai-assisted-import-v99',
        reviewStatus: 'pending',
        warnings: Array.isArray(q.warnings) ? q.warnings : [],
      };
    }

    // 读取批量建议列表，兼容模型将 JSON 对象再次编码成字符串。
    function aiResultArrayV991(content) {
      let data = extractBalancedJsonV99(content);
      if (typeof data === 'string') {
        data = extractBalancedJsonV99(data);
      }

      const results = Array.isArray(data) ? data : (data?.results ?? data?.items ?? data?.data ?? data?.建议);
      if (!Array.isArray(results)) {
        throw new Error('AI 返回内容中没有找到 results 数组。');
      }

      return results;
    }

    // 优先使用响应中的题目 ID，其次用原序号或批内位置匹配，防止建议串题。
    function findBatchQuestionV991(raw, batchItems) {
      const id = String(raw?.id ?? raw?.questionId ?? '');
      if (id) {
        return batchItems.find((x) => x.id === id) || null;
      }

      const value = Number(raw?.index ?? raw?.number ?? 0);
      const absolute = value - 1;
      const exact = batchItems.find((x) => x.index === absolute);
      if (exact) {
        return exact;
      }

      if (value >= 1 && value <= batchItems.length) {
        return batchItems[value - 1];
      }

      const batchIndex = Number(raw?.batchIndex ?? 0);
      return batchIndex >= 1 && batchIndex <= batchItems.length ? batchItems[batchIndex - 1] : null;
    }

    // 只采集模型明确给出的非空建议，缺失或无法识别的字段保留为未建议修改。
    function collectSuggestedChanges(raw) {
      const has = (key) => Object.prototype.hasOwnProperty.call(raw, key);

      const changes = {};

      if (has('suggestedType') && String(raw.suggestedType || '').trim()) {
        const type = normalizeType(raw.suggestedType);
        if (type) {
          changes.type = type;
        }
      }

      if (has('suggestedQuestion') && String(raw.suggestedQuestion || '').trim()) {
        changes.question = trimMultilineBoundaryV5910(raw.suggestedQuestion);
      }

      if (has('suggestedOptions')) {
        const options = canonicalizeAiOptionsV99(raw.suggestedOptions);
        if (options.length) {
          changes.options = options;
        }
      }

      if (has('suggestedAnswer')) {
        const answer = Array.isArray(raw.suggestedAnswer) ? raw.suggestedAnswer.map((x) => String(x || '').trim()).filter(Boolean) : splitAnswer(raw.suggestedAnswer);
        if (answer.length) {
          changes.answer = answer;
        }
      }

      if (has('suggestedAnalysis') && String(raw.suggestedAnalysis || '').trim()) {
        changes.analysis = trimMultilineBoundaryV5910(raw.suggestedAnalysis);
      }

      return changes;
    }

    // 把建议关联回当前批次，只有实际变化且允许采纳时才启用应用操作。
    function normalizeAiReviewResultV991(raw, batchItems) {
      const target = findBatchQuestionV991(raw, batchItems);
      if (!target) {
        return null;
      }

      const original = target.question;
      const changes = collectSuggestedChanges(raw);
      const meaningful = Object.keys(changes).some((key) => JSON.stringify(changes[key]) !== JSON.stringify(original[key]));
      return { questionId: target.id, index: target.index, risk: ['low', 'confirm', 'cannot'].includes(String(raw.risk)) ? String(raw.risk) : 'confirm', issues: Array.isArray(raw.issues) ? raw.issues.map((x) => String(x || '').trim()).filter(Boolean) : [], note: String(raw.note || raw.reason || '').trim(), canApply: raw.canApply !== false && meaningful, changes };
    }

    // 解析批量题解建议并保留人工复核状态，只接受当前批次的题目。
    function normalizeAiAnalysisResultV991(raw, batchItems) {
      const target = findBatchQuestionV991(raw, batchItems);
      if (!target) {
        return null;
      }

      return { questionId: target.id, index: target.index, analysis: trimMultilineBoundaryV5910(raw.analysis ?? raw.explanation ?? raw.解析 ?? ''), needsReview: raw.needsReview !== false, note: String(raw.note || raw.reason || '').trim() };
    }

    function needsManualAiReview(data, knownConfidence, confidence) {
      return data.needsReview !== false || !knownConfidence || confidence === 'LOW';
    }

    // 分别限制对话回复与可保存草稿，低置信度或未知置信度交给用户复核。
    function parseAiSingleFollowUpV381(content) {
      if (String(content || '').length > 100000) {
        throw new Error('AI 返回内容过长，请减少上下文后重试。');
      }

      let data = extractBalancedJsonV99(content);
      if (typeof data === 'string') {
        data = extractBalancedJsonV99(data);
      }

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('AI 返回的追问结构无效。');
      }

      const reply = trimMultilineBoundaryV5910(data.reply ?? data.answer ?? '');

      const revisedAnalysis = trimMultilineBoundaryV5910(data.revisedAnalysis ?? data.analysis ?? '');

      if (!reply || reply.length > 20000) {
        throw new Error('AI 未返回有效的追问内容。');
      }

      if (!revisedAnalysis || revisedAnalysis.length > 12000) {
        throw new Error('AI 未返回可保存的完整解析草稿。');
      }

      const confidence = String(data.confidence || '').toUpperCase();

      const knownConfidence = ['HIGH', 'MEDIUM', 'LOW'].includes(confidence);

      return { reply, revisedAnalysis, confidence: knownConfidence ? confidence : 'LOW', needsReview: needsManualAiReview(data, knownConfidence, confidence), warning: String(data.warning || '').trim() };
    }

    function mergeAiSingleWarningV381(...values) {
      return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].join(' ');
    }

    // 保留模型答案与题库答案是否一致的独立状态，并校验解析长度。
    function parseAiSingleAnalysisV613(content) {
      if (String(content || '').length > 100000) {
        throw new Error('AI 返回内容过长，请减少上下文后重试。');
      }

      let data = extractBalancedJsonV99(content);
      if (typeof data === 'string') {
        data = extractBalancedJsonV99(data);
      }

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('AI 返回的解析结构无效。');
      }

      const analysis = data.analysis ?? data.explanation;

      if (typeof analysis !== 'string' || !analysis.trim() || analysis.length > 12000) {
        throw new Error('AI 未返回有效的解析文本。');
      }

      const confidence = String(data?.confidence || '').toUpperCase();

      const knownConfidence = ['HIGH', 'MEDIUM', 'LOW'].includes(confidence);

      return { suggestedAnswer: String(data?.suggestedAnswer ?? data?.answer ?? '').trim(), matchesLocalAnswer: typeof data?.matchesLocalAnswer === 'boolean' ? data.matchesLocalAnswer : null, analysis: trimMultilineBoundaryV5910(analysis), confidence: knownConfidence ? confidence : 'LOW', needsReview: needsManualAiReview(data, knownConfidence, confidence) || data.matchesLocalAnswer === false, warning: String(data?.warning || '').trim() };
    }

    // 将常见接口错误转换为对应的配置、额度或重试提示。
    function aiHttpErrorMessage(status, detail) {
      if (status === 401 || status === 403) {
        return '鉴权失败，请检查 API Key。';
      }

      if (status === 404) {
        return '接口不存在或路径不正确，请检查 Chat Completions 地址。';
      }

      if (status === 429) {
        return '请求过于频繁或账户额度不足。';
      }

      if (status >= 500) {
        return 'AI 服务内部错误，请稍后重试。';
      }

      // eslint-disable-next-line prefer-template -- 外部值可能是对象，保留 + 的默认转换；输入类型受约束后移除此例外。
      return `AI 接口返回 HTTP ${status}${detail ? '：' + detail : ''}`;
    }

    return { parseAiRefactorPayloadV384, aiResponseContentV99, aiResultArrayV991, normalizeAiReviewResultV991, normalizeAiAnalysisResultV991, parseAiSingleFollowUpV381, mergeAiSingleWarningV381, parseAiSingleAnalysisV613, aiHttpErrorMessage };
  }

  globalThis.ShirohaAiResults = Object.freeze({ create });
})();
