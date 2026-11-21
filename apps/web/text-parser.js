// 注册 Web 和桌面共用的文本题库解析器；来源元数据只在内存修复阶段使用。
(() => {
  'use strict';

  /* SHIROHA_WEB_V58_9_10_SOURCE_INTERVAL_LOCAL_REPAIR */
  // v58.9.10：导入阶段内部原文定位元数据。使用 Symbol 避免写入题库 JSON/备份包。
  const SOURCE_META_V58910 = Symbol('shiroha_source_meta_v58_9_10');
  const RECRUITMENT_OPTIONS_V58915 = Symbol('shiroha_recruitment_options_v58_9_15');

  // 注入富文本读取、图片还原与 ID 生成能力，保持解析器可以在界面外独立测试。
  function create({
    makeId,
    warnDev,
    docxXmlToText,
    decodeXml,
    pickRichTextFieldV57,
    pickRichOptionTextV57,
    normalizeQuestionImagesForWebV83,
    injectQuestionImagesForWebV83,
  }) {
    const {
      normalizeWebQuestionType,
      isTextType,
      normalizeBlankAnswersV58914,
      isMultiBlankQuestionV58914,
      primaryBlankAnswerV58914,
      cloneBlankAnswersV58914,
      normalizeTextAnswerForCompare,
    } = globalThis.ShirohaQuizCore;

    function getRecruitmentOptionsV58915(q) {
      return (q && q[RECRUITMENT_OPTIONS_V58915]) || null;
    }

    // 保存招聘题原始选项，确保后续归一化不会丢失已确认的图文选项。
    function attachRecruitmentOptionsV58915(q, options) {
      if (!q || !Array.isArray(options) || options.length < 2) { return q; }

      const value = options.map((o) => ({ key: normalizeOptionKey(o.key), text: String(o.text || '').trim() })).filter((o) => o.text);
      try { Object.defineProperty(q, RECRUITMENT_OPTIONS_V58915, { value, writable: true, configurable: true, enumerable: true }); } catch { q[RECRUITMENT_OPTIONS_V58915] = value; }

      return q;
    }

    function getSourceMetaV58910(q) {
      return (q && q[SOURCE_META_V58910]) || null;
    }

    function attachSourceMetaV58910(q, meta) {
      if (!q || !meta) { return q; }

      try { Object.defineProperty(q, SOURCE_META_V58910, { value: { ...meta }, writable: true, configurable: true, enumerable: true }); } catch { q[SOURCE_META_V58910] = { ...meta }; }

      return q;
    }

    // 按字段优先级读取选项，兼容富文本旧结构与分列选项，再合并重复或分裂的选项。
    function normalizeImportedOptionFields(q) {
      let options = [];
      let richFieldsV57 = null;
      if (q && q.richContent && typeof q.richContent === 'object') {
        const hasRichFields = q.richContent.fields && typeof q.richContent.fields === 'object';
        richFieldsV57 = hasRichFields ? q.richContent.fields : q.richContent;
      }

      const richOptionsV57 = richFieldsV57 && Array.isArray(richFieldsV57.options) ? richFieldsV57.options : [];
      if (Array.isArray(q.options)) {
        options = q.options.map((o, j) => (typeof o === 'string' ? { key: String.fromCharCode(65 + j), text: o } : { key: normalizeOptionKey(o.key || o.label || o.value || String.fromCharCode(65 + j)), text: pickRichOptionTextV57(q, j, o).trim() })).filter((o) => o.text);
      } else if (Array.isArray(q.choices)) {
        options = q.choices.map((o, j) => (typeof o === 'string' ? { key: String.fromCharCode(65 + j), text: o } : { key: normalizeOptionKey(o.key || o.label || o.value || String.fromCharCode(65 + j)), text: pickRichOptionTextV57(q, j, o).trim() })).filter((o) => o.text);
      } else if (richOptionsV57.length) {
        options = richOptionsV57.map((o, j) => {
          const text = typeof o === 'string' ? o : String((o && (o.text ?? o.markdown ?? o.sourceText ?? o.fallbackText ?? o.plainText)) ?? '');
          const key = typeof o === 'object' && o ? normalizeOptionKey(o.key || o.label || o.value || String.fromCharCode(65 + j)) : String.fromCharCode(65 + j);
          return { key, text: text.trim() };
        }).filter((o) => o.text);
      } else {
        const keys = 'ABCDEFG';
        for (const k of keys) { if (q[k] != null || q[k.toLowerCase()] != null) { options.push({ key: k, text: String(q[k] ?? q[k.toLowerCase()] ?? '').trim() }); } }
      }

      return repairStandaloneOptionLabels(mergeDuplicateOptions(repairEmbeddedOptions(options.filter((o) => o.text))));
    }

    // 将异构题库字段归一为题目模型，并保留评分所需的答案以及来源修复所需的元数据。
    function normalizeQuestion(q, i = 0) {
      const recruitmentOptionsV58915 = getRecruitmentOptionsV58915(q);
      let type = normalizeType(q.type || q.questionType || q.kind || '');
      const rawAnswer = q.answer ?? q.answerKeys ?? q.correctAnswer ?? q.correct ?? q.rightAnswer ?? q.referenceAnswer ?? q.standardAnswer ?? [];
      const blankAnswersV58914 = normalizeBlankAnswersV58914(q.blankAnswers);
      let answer;
      if (Array.isArray(rawAnswer)) {
        answer = rawAnswer.map(trimMultilineBoundaryV5910);
      } else if (isTextType(type)) {
        answer = splitTextAnswer(rawAnswer);
      } else {
        answer = splitAnswer(rawAnswer);
      }

      let options = normalizeImportedOptionFields(q);
      let questionText = trimMultilineBoundaryV5910(pickRichTextFieldV57(q, 'question', q.question || q.title || q.stem || ''));
      const stemImageRepairV588 = repairStemImageOptionMisplacementV588(questionText, options, q.group || q.category || '');
      questionText = stemImageRepairV588.question;
      options = stemImageRepairV588.options;
      const stemARepairV589 = repairStemTrailingAOptionTextV589(questionText, options, q.group || q.category || '');
      questionText = stemARepairV589.question;
      options = stemARepairV589.options;
      const pureJudge = extractPureJudgeStemAnswer(questionText);
      if (pureJudge && !options.length && (!type || type === 'single' || type === 'judge')) {
        type = 'judge';
        questionText = pureJudge.question;
        answer = answer.concat([pureJudge.answer]);
      }

      if (!type) { type = guessType(questionText, options, answer, q.group || q.category || ''); }

      if (shouldUseDefaultImageOptions(questionText, options, answer, type, q.group || q.category || '')) {
        options = defaultChoiceOptionsFromAnswer(answer);
        if (!type || isTextType(type)) { type = answer.length > 1 ? 'multiple' : 'single'; }
      }

      const fixedStem = cleanQuestionStemAndAnswer(questionText, answer, type, options);
      questionText = fixedStem.question;
      answer = fixedStem.answer;
      if (shouldUpgradeSingleToMultipleV372(type, options, answer)) { type = 'multiple'; }

      const structuredImages = normalizeQuestionImagesForWebV83(q.images || q.questionImages || q.media || []);
      questionText = injectQuestionImagesForWebV83(questionText, structuredImages);
      // 兼容纯判断题：题干末尾直接写（√）（×）（对）（错），且没有 A/B 选项和题型标题。
      // 这类题如果先按普通选择题猜型，会出现“单选题缺少选项”。
      if (!options.length && answer.length && answer.some((a) => isJudgeSymbolAnswer(a))) {
        type = 'judge';
      }

      if (type === 'judge') {
        options = normalizeJudgeOptions(options);
      }

      if (isTextType(type)) {
        answer = splitTextAnswer((Array.isArray(rawAnswer) && rawAnswer.length) ? rawAnswer : (rawAnswer || answer));
        if (type === 'blank' && blankAnswersV58914.length) { answer = [primaryBlankAnswerV58914(blankAnswersV58914)]; }
      } else {
        answer = normalizeAnswer(answer, options, type);
        if (shouldUpgradeSingleToMultipleV372(type, options, answer)) { type = 'multiple'; }
      }

      let analysisText = trimMultilineBoundaryV5910(pickRichTextFieldV57(q, 'analysis', q.analysis || q.explanation || q.explain || ''));
      const analysisImageOptionsV589 = extractInlineImageTokensV589(analysisText);
      if (!options.length && analysisImageOptionsV589.length >= 2 && (answer || []).some((a) => /* 只有已保存答案指向单个 A–G 或数字选项时，才把解析中的多张图片还原为选项。 */ /^[A-G1-9]$/.test(String(a || '').trim()))) {
        options = imageTokensToChoiceOptionsV589(analysisImageOptionsV589);
        // 图片提升为选项后，如果解析只剩选项字母和分隔符，则清空占位残文。
        analysisText = stripAnswerPrefix(stripInlineImageTokensV589(analysisText)).replace(/^[A-G]{1,7}[。．.、，,；;：:\s]*$/i, '').trim();
      }

      // 正文已经以答案标题开头时，无需再为客观题补一次答案标签。
      if (analysisText && answer.length && !isTextType(type) && !/^\s*(?:答案|【\s*答案\s*】|正确答案|参考答案)/.test(analysisText)) {
        const ansLabel = answer.join('');
        if (ansLabel && !/* 识别可选答案标签后的现有答案，只有命中标点或空白边界才视为重复。 */ new RegExp(`^\\s*(?:【?答案】?\\s*[:：]?\\s*)?${ansLabel.replace(/* 引用答案字面量之前转义正则元字符，避免答案内容改变匹配范围。 */ /[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[。．.、，,：:；;]|\\s)`).test(analysisText)) {
          // 去掉将要衔接到答案标签后的开头标点和空白，避免出现重复分隔符。
          analysisText = `答案：${ansLabel}。${analysisText.replace(/^[。．.、，,：:；;\s]+/, '')}`;
        }
      }

      const normalizedQuestion = { id: q.id || makeId('q', i), type, number: q.number || i + 1, volume: q.volume || '', group: q.group || '', question: questionText, options, answer, analysis: analysisText, category: q.category || q.topic || q.group || '', images: structuredImages, score: Number(q.score || 0) || undefined, subject: q.subject || '', grade: q.grade || '', difficulty: q.difficulty || '', knowledgePoints: Array.isArray(q.knowledgePoints) ? q.knowledgePoints : [], tags: Array.isArray(q.tags) ? q.tags : [], source: q.source || '', sourceFileId: q.sourceFileId || '', version: Number(q.version || 1) || 1, reviewStatus: q.reviewStatus || 'approved', aiConfidence: q.aiConfidence == null ? null : Number(q.aiConfidence), warnings: Array.isArray(q.warnings) ? q.warnings : [], normalized: normalizeText(questionText) };
      if (Array.isArray(q.blankAnswers)) { normalizedQuestion.blankAnswers = cloneBlankAnswersV58914(blankAnswersV58914); }

      if (Array.isArray(recruitmentOptionsV58915) && recruitmentOptionsV58915.length >= 2) {
        normalizedQuestion.options = recruitmentOptionsV58915.map((o) => ({ key: normalizeOptionKey(o.key), text: String(o.text || '').trim() })).filter((o) => o.text);

        normalizedQuestion.answer = normalizeAnswer(normalizedQuestion.answer, normalizedQuestion.options, normalizedQuestion.type);
        attachRecruitmentOptionsV58915(normalizedQuestion, normalizedQuestion.options);
      }

      const sourceMeta = getSourceMetaV58910(q);
      if (sourceMeta) { attachSourceMetaV58910(normalizedQuestion, sourceMeta); }

      return normalizedQuestion;
    }

    // 优先采用跨端共享题型映射，并为历史中文题型名称保留解析器的兼容映射。
    function normalizeType(t) {
      const raw = String(t || '').trim();
      if (!raw) { return ''; }

      const normalized = normalizeWebQuestionType(raw);
      if (normalized) { return normalized; }

      return mapType(raw) || '';
    }

    // 文本题按文本答案拆分；题型未确定时，只有具备明显文本特征才允许回退到文本答案。
    function splitAnswerByType(s, type) {
      if (isTextType(type)) { return splitTextAnswer(s); }

      const a = splitAnswer(s);
      if (a.length) { return a; }

      if (!type && looksLikeTextualAnswer(s)) { return splitTextAnswer(s); }

      return [];
    }

    // 移除历史中英文参考答案标题，保留标题后或同一括号内的作答内容。
    function stripAnswerPrefix(s) {
      return String(s ?? '').trim()
        .replace(/* 辨认整个答案被包在带标题的中式或方括号中的格式，并取出括号里的作答。 */ /^\s*[【[]\s*(?:正确答案|参考答案|标准答案|答案|答|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|Answer|Correct\s*answer)\s*[:：]?\s*([^】\]]*)\s*[】\]]\s*$/i, '$1')
        .replace(/* 清除独立的中英文答案标题及其后的冒号、标点或空白。 */ /^\s*(?:【|\[)?\s*(?:正确答案|参考答案|标准答案|答案|答|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|Answer|Correct\s*answer)\s*(?:】|\])?\s*(?:[:：,，、.．;；]|\s+)?\s*/i, '')
        .trim();
    }

    // 在推断主观题前排除字母、数字和判断符号，避免把客观答案误当作自由文本。
    function isObjectiveAnswerText(inputS) {
      let s = inputS;
      // 剥离候选末尾的题库标点和空白，再判断是否仍为单独的客观答案。
      s = stripAnswerPrefix(s).replace(/[?.!??;?,?\s]+$/, '').trim();
      if (!s) { return false; }

      // 去除客观答案中的分隔符和括号，让连续字母或数字能够统一识别。
      const compact = s.replace(/[\s,??;?/\\??()]+/g, '').toUpperCase();
      // A–G 的短字母串可表示一个或多个选项。
      if (/^[A-G]{1,7}$/.test(compact)) { return true; }

      // 仅包含 1–9 的短数字串可表示按序号填写的选项。
      if (/^[1-9]{1,9}$/.test(compact)) { return true; }

      // 中文对错词、勾叉符号和英文真假标记都应保留在客观答案分支。
      if (/^(?:\u5bf9|\u9519|\u6b63\u786e|\u9519\u8bef|\u662f|\u5426|\u221A|\u2713|\u2714|\u00D7|X|V|T|F|TRUE|FALSE)$/i.test(s)) { return true; }

      // 带 A–G 选项标签及其后文本的单行结构仍视为客观答案。
      if (/^([A-Ga-g])\s*[、.．:：]\s*.+$/.test(s)) { return true; }

      return false;
    }

    // 只有排除明确客观答案后，才按长度、正文标点和行动用语推断为主观题答案。
    function looksLikeTextualAnswer(inputS) {
      let s = inputS;
      s = stripAnswerPrefix(s).trim();
      if (!s || isObjectiveAnswerText(s)) { return false; }

      const compact = normalizeTextAnswerForCompare(s);
      if (compact.length > 20) { return true; }

      // 换行和指定分隔符提供自由文本的结构证据。
      if (/[??;\n]/.test(s)) { return true; }

      // 带问号的内容只有通过随后客观答案复核时，才作为文本候选。
      if (/[??]/.test(s) && !isObjectiveAnswerText(s)) { return true; }

      // 用步骤、法规要求或安全措施等常见作答用语识别短篇的主观参考答案。
      if (/(?:\u5305\u62ec|\u5e94\u5f53|\u9700\u8981|\u6b65\u9aa4|\u63aa\u65bd|\u6d41\u7a0b|\u539f\u56e0|\u8981\u6c42|\u5185\u5bb9|\u68c0\u67e5|\u6838\u5bf9|\u8fdb\u884c|\u4fdd\u8bc1|\u786e\u4fdd|\u4e25\u7981|\u5fc5\u987b|\u4e0d\u5f97|\u9996\u5148|\u5176\u6b21|\u7136\u540e|\u6700\u540e|\u4e00\u662f|\u4e8c\u662f|\u4e09\u662f|\u65bd\u5de5|\u8bbe\u5907|\u5b89\u5168|\u53c2\u6570)/.test(s)) { return true; }

      return false;
    }

    function hasShortAnswerPrompt(question) {
      // v58.9.3："作用"本身不是简答题强信号。带（）/横线的"主要作用是（ ）"应优先识别为填空题。
      return /简述|说明|阐述|分析|论述|列举|写出|叙述|解释|概括|谈谈|提出|给出|简答|问答|名词解释|含义|定义|为什么|原因|措施|流程|步骤|要求|内容|注意事项|如何|哪些|什么是|是什么|怎么办|怎么做|意义|影响|区别|联系|原则|要点|路径/.test(String(question || ''));
    }

    function hasExplicitBlankPrompt(question) {
      const q = String(question || '');
      // 横线、空括号或明确的填写提示是允许推断填空题的独立证据。
      return /_{2,}|____|[（(]\s*[）)]|\[\s*\]|填空|填入|补全|补充完整|空白处|空格|横线|括号内|空内/.test(q);
    }

    function shouldGuessBlankFromNoOption(question, _answer) {
      // v52：填空题必须有明确填空特征；短答案不再单独作为填空依据。
      // v58.9.3：格式优先于语义。出现（）/横线等填空标记时，除非显式简答分区/标签已指定，否则优先填空。
      if (hasExplicitBlankPrompt(question)) { return true; }

      if (hasShortAnswerPrompt(question)) { return false; }

      return false;
    }

    function normalizeJsonMultilineTextV5910(value) {
      // 兼容 Windows 和旧式回车换行，统一成后续分行使用的换行符。
      return String(value ?? '').replace(/\r\n?/g, '\n');
    }

    // 替换换行格式并只清除多行或代码答案两端的空行，保留内部缩进。
    function trimMultilineBoundaryV5910(value) {
      const normalized = normalizeJsonMultilineTextV5910(value);
      if (!/* 换行或制表符意味着内部空白可能属于答案结构。 */ /[\n\t]/.test(normalized) && !/* 围栏代码应保留原有缩进和空白边界。 */ /```/.test(normalized)) { return normalized.trim(); }

      const lines = normalized.split('\n');
      while (lines.length && !lines[0].trim()) { lines.shift(); }

      while (lines.length && !lines[lines.length - 1].trim()) { lines.pop(); }

      return lines.join('\n');
    }

    // 解析简答或填空参考答案，保留代码与多行内容，并兼容单行等价答案分隔符。
    function splitTextAnswer(inputS) {
      let s = inputS;
      if (Array.isArray(s)) { return s.map(trimMultilineBoundaryV5910).filter((x) => x.trim()); }

      // 清除常见的中英文答案标题和外层标题括号，再判断参考答案内容。
      s = trimMultilineBoundaryV5910(s).replace(/^\s*(?:【|\[)?\s*(?:正确答案|参考答案|标准答案|答案|参考要点|答题要点|Answer|Correct\s*answer)\s*(?:】|\])?\s*[:：]?\s*/i, '');
      s = trimMultilineBoundaryV5910(s);
      if (!s) { return []; }

      // 多行文本、制表符和代码块按一个完整参考答案保存，避免 Shell 的 || 等语法被误拆。
      if (/[\n\t]/.test(s) || /* 代码围栏与多行文本一样，整段保留以避免拆开代码中的分隔符。 */ /```/.test(s)) { return [s]; }

      // 单行文本仍支持用 || 或 ｜ 分隔多个等价参考答案。
      return s.split(/\s*(?:\|\||｜)\s*/).map((x) => x.trim()).filter(Boolean);
    }

    // 从没有独立答案行的判断题尾部恢复括号内的答案，并留下空白作答位置。
    function extractPureJudgeStemAnswer(text) {
      const s = String(text || '').trim();
      // 只识别题干末尾独立括号内的判断符号，避免提取正文括号里的文字。
      const m = s.match(/[（(]\s*(对|错|正确|错误|是|否|√|✓|✔|×|X|x|v|V|T|F|True|False)\s*[）)]\s*[。.!！?？]*\s*$/i);
      if (!m) { return null; }

      const ans = m[1].trim();
      // 去掉原答案前的句末标点，为补回空括号留出稳定的边界。
      const question = `${s.slice(0, m.index).trim().replace(/[。.!！?？]*\s*$/, '')}（ ）`;
      return { question, answer: ans };
    }

    function normalizeText(t) {
      return String(t).replace(/* 比较题目时忽略普通和全角空白。 */ /[\s\u3000]/g, '').replace(/* 去掉约定的中英文括号和标点，供题干指纹比较。 */ /[（）()【】[\]{}。？?！!，,、：:；;.*]/g, '').toLowerCase();
    }

    function countTypes(qs) {
      return qs.reduce((a, q) => {
        a[q.type] = (a[q.type] || 0) + 1;return a;
      }, { single: 0, multiple: 0, multi: 0, judge: 0, blank: 0, short: 0 });
    }

    function escapeRegExpV51(s) {
      // 转义动态模式中的正则控制字符，使输入按字面量匹配。
      return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // 检查导入题目的必备字段、答案与选项对应关系以及明显的题干污染，并返回首个提示。
    function validateQuestion(q) {
      if (!q.question) { return '缺少题干'; }

      if (['single', 'multiple'].includes(q.type) && !q.options.length) { return '选择题缺少选项'; }

      if (q.type === 'judge') {
        const map = judgeOptionMap(q.options || []);
        const keys = (q.options || []).map((o) => o.key);
        if (!keys.length) { return '判断题缺少正确/错误选项'; }

        if (!q.answer.length) { return '缺少答案'; }

        if (q.answer.some((a) => !keys.includes(a))) { return '判断题答案无法映射到正确/错误'; }

        if (q.answer.length > 1) { return '判断题出现多个答案'; }

        if (!map.confidence && !(keys.includes('A') && keys.includes('B'))) { return '判断题选项含义疑似不明确'; }
      }

      if (!q.answer.length) { return isTextType(q.type) ? '缺少参考答案' : '缺少答案'; }

      if (isMultiBlankQuestionV58914(q) && normalizeBlankAnswersV58914(q.blankAnswers).some((group) => !group.length)) { return '多空题存在缺少主答案的题空'; }

      const keys = q.options.map((o) => o.key);
      if (['single', 'multiple'].includes(q.type) && q.answer.some((a) => !keys.includes(a))) { return '答案超出选项范围'; }

      if (q.type === 'single' && q.answer.length > 1) { return '单选题出现多个答案'; }

      if (q.type === 'multiple' && q.answer.length === 1) { return '多选题只有一个答案'; }

      // 检测疑似留在题干末尾的 A 选项；还须同时存在 B 且缺少独立 A。
      if (['single', 'multiple', 'judge'].includes(q.type) && /(?:^|[\s。？！?])A\s*[^\s]{1,40}$/.test(q.question || '') && q.options.some((o) => o.key === 'B') && !q.options.some((o) => o.key === 'A')) { return '题干疑似混入A选项'; }

      // 题干若保留答案标题，提示用户核对原文边界。
      if (/【?\s*(?:答案|正确答案|参考答案)|(?:答案|正确答案|参考答案)\s*(?::|：)/.test(q.question || '')) { return '题干残留答案标记'; }

      if ((q.options || []).some((o) => {
        const text = visibleOptionTextForRisk(o.text || '');return text.length > 240 || /* 选项中再次出现答案标题或带题号的答案条目，可能表示不同题块发生粘连。 */ /(?:【\s*(?:答案|正确答案|参考答案)|(?:^|[\s；;，,。])(?:答案|正确答案|参考答案)\s*[:：])|\b\d{1,3}\s*[、.．:：].+【\s*答案/.test(text);
      })) { return '选项疑似粘连'; }

      return '正常';
    }

    // 读取独立选项行，兼容括号、字母以及数字编号的旧题库格式。
    function parseOptionsText(text) {
      const lines = String(text || '').split('\n').map((x) => x.trim()).filter(Boolean);
      const out = [];
      for (const line of lines) {
        // 从行首取出带适当边界的选项编号和正文，避免识别题干中间的字母。
        const m = line.match(/^\s*(?:[（(]\s*([A-Ga-g1-90])\s*[）)]|([A-Ga-g0])\s*(?:[、.．:：]|\s+)|([1-9])\s*(?:[、.．:：]|\s+))\s*(.*)$/);
        if (m) { out.push({ key: normalizeOptionKey(m[1] || m[2] || m[3]), text: (m[4] || '').trim() }); } else { out.push({ key: String.fromCharCode(65 + out.length), text: line }); }
      }

      return out.filter((o) => o.text);
    }

    function hasQuestionImageContent(s) {
      // 内嵌 Markdown 图片提供恢复图形题选项的直接证据。
      return /!\[[^\]]*\]\(data:image\//.test(String(s || ''));
    }

    // 修复首个选项只重复写了选项标签的情况，避免把标签当作正文。
    function repairStandaloneOptionLabels(inputOptions) {
      let options = inputOptions;
      options = (options || []).filter((o) => o && String(o.text || '').trim());

      if (options.length === 1 && String(options[0].key || '').toUpperCase() === 'A') {
        // 去除分隔符后比较选项正文与其编号，允许历史文档用空格和标点重复标签。
        const compact = String(options[0].text || '').replace(/[\s,，、;；/\\]+/g, '').toUpperCase();
        if (compact === 'BCD') { return ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: k })); }
      }

      return options;
    }

    // 题库只保留答案字母时，为可确认的图形选择题生成最小的候选选项组。
    function defaultChoiceOptionsFromAnswer(answer) {
      const letters = (answer || []).flatMap((a) => splitAnswer(a)).map((a) => String(a || '').toUpperCase()).filter((a) => /* 只用明确的 A–G 字母确定补建选项的最高编号。 */ /^[A-G]$/.test(a));
      const max = letters.reduce((m, a) => Math.max(m, a.charCodeAt(0)), 68);
      const end = String.fromCharCode(Math.max(68, Math.min(71, max)));
      const arr = [];for (let c = 65;c <= end.charCodeAt(0);c += 1) { const k = String.fromCharCode(c);arr.push({ key: k, text: k }); }

      return arr;
    }

    // 仅在题目缺少选项且确有图形或材料证据时，才允许用答案补建默认选项。
    function shouldUseDefaultImageOptions(question, options, answer, type, group = '') {
      if ((options || []).length >= 2) { return false; }

      const letters = (answer || []).flatMap((a) => splitAnswer(a)).map((a) => String(a || '').toUpperCase()).filter((a) => /* 忽略不能对应 A–G 的答案，避免文本答案触发选项回退。 */ /^[A-G]$/.test(a));
      if (!letters.length) { return false; }

      const context = `${String(question || '')} ${String(group || '')}`;
      return hasQuestionImageContent(context) || /* 图形、折叠、图表等题型用语可作为图片选项丢失的补充证据。 */ /图形|图表|纸盒|折叠|问号|资料分析|材料分析/.test(context);
    }

    const sourceQuestionNumberRulesV58910 = {
      isOptionLine,
      isAnswerLine,
      isAnalysisLine,
      getHeadingType,
      isImportNoiseLine,
      getNumberedTypeQuestionLineV592,
      getNumberedTypeQuestionHeader,
    };
    function sourceQuestionNumberFromLineV58910(line) {
      return globalThis.ShirohaTextAnswers.sourceQuestionNumberFromLine(line, sourceQuestionNumberRulesV58910);
    }

    // 收集单个原文块中可确认的题号，供识别多个题干误粘连时定位原文。
    function sourceQuestionNumbersInBlockV58910(block) {
      const out = [];
      const lines = block?.lines || [];
      lines.forEach((line) => {
        const n = sourceQuestionNumberFromLineV58910(line);if (n && !out.includes(n)) { out.push(n); }
      });

      // v58.9.23：简答题答案中的“(1)…(12)…”属于答题要点，不是同一原文块里的新题号。
      // 真实的新题号仍由上面的逐行题号识别保留，只排除答案区内部的括号序号。
      let inlineLines = lines;
      if (mapType(block?.group || '') === 'short') {
        let inAnswerSection = false;
        inlineLines = lines.filter(/* 优先使用同时保有题号和正文的行，减少把替代答题编号计为题号的概率。 */ (line) => {
          const raw = String(line || '').trim();
          if (isStandaloneAnswerHeaderV58917(raw) || isAnswerLine(raw)) { inAnswerSection = true;return false; }

          if (inAnswerSection) { return false; }

          return true;
        });
      }

      const joined = inlineLines.join('\n');
      // 句末、换行或明显的空白分隔后，带正文的括号题号可指示块内漏分题目。
      const inline = /(?:^|[\n。！？?!；;]\s*|\s{2,})[（(【[]\s*(\d{1,4})\s*[）)】\]]\s*\S/g;let m;
      while ((m = inline.exec(joined))) { const n = Number(m[1]) || 0;if (n && !out.includes(n)) { out.push(n); } }

      return out;
    }

    // 为分块结果定位原文区间，从上次匹配末尾继续查找以区分重复文本。
    function locateQuestionBlocksV58910(sourceText, blocks) {
      let cursor = 0;
      return (blocks || []).map(/* 逐块记录原文起止位置，并在无法精确定位时保留可用的近似区间。 */ (rawBlock, idx) => {
        const block = { ...rawBlock, lines: [...(rawBlock.lines || [])] };
        let start = -1; let end = -1; let scan = cursor;
        for (const rawLine of block.lines) {
          const line = String(rawLine || '').trim();if (!line) { continue; }

          let pos = sourceText.indexOf(line, scan);
          if (pos < 0) { pos = sourceText.indexOf(line, cursor); }

          if (pos < 0) { continue; }

          if (start < 0) { start = pos; }

          end = pos + line.length;scan = end;
        }

        if (start < 0) { start = cursor;end = cursor; }

        cursor = Math.max(cursor, end);
        const sourceQuestionNumbers = sourceQuestionNumbersInBlockV58910(block);
        const meaningful = (block.lines || []).filter((x) => !isImportNoiseLine(x) && !getHeadingType(x));
        const sourceLikelyQuestion = sourceQuestionNumbers.length > 0 || meaningful.some((x) => looksLikeNewQuestionLine(x, block.group || '')) || ((block.lines || []).some(isOptionLine) && meaningful.some((x) => !isOptionLine(x) && !isAnswerLine(x) && !isAnalysisLine(x)));
        return { ...block, sourceStart: start, sourceEnd: end, sourceBlockStart: idx, sourceBlockEnd: idx, sourceQuestionNumbers, sourceLikelyQuestion };
      });
    }

    function sourceMetaForBlockV58910(block, blockIndex) {
      const nums = block?.sourceQuestionNumbers || [];
      return { sourceStart: block?.sourceStart ?? -1, sourceEnd: block?.sourceEnd ?? -1, sourceBlockStart: blockIndex, sourceBlockEnd: blockIndex, blockIndex, originalNumber: nums.length ? nums[0] : null, sourceQuestionNumbers: [...nums], explicitNumber: nums.length > 0, group: block?.group || '', volume: block?.volume || '', chapter: block?.chapter || '' };
    }

    // 完成基础切块和题目归一化，同时保存后续局部修复可以复用的题目与原文块对应关系。
    function parseTextQuestionsBaseDetailed(inputText) {
      let text = inputText;
      const protectedPack = protectDocxImageMarkdownForParser(text);
      const restore = protectedPack.restore || ((x) => x);
      text = repairDocxLostQuestionNumberLines(normalizeImportText(protectedPack.text));
      text = preSplitVolumeAndCompactQuestions(text);
      if (!text.trim()) { return { questions: [], blocks: [], pairs: [], sourceText: '' }; }

      const blocks = locateQuestionBlocksV58910(text, splitQuestionBlocks(text));
      const questions = [];const pairs = [];
      blocks.forEach(/* 跳过未能解析的块，并用原文位置为已保留的题目附上修复元数据。 */ (block, idx) => {
        const q = parseBlock(block, idx);
        if (q && q.question && (q.options.length || q.answer.length || q.type === 'judge' || isTextType(q.type))) {
          const restored = { ...q, question: restore(q.question || ''), analysis: restore(q.analysis || ''), options: (q.options || []).map((o) => ({ ...o, text: restore(o.text || '') })) };
          const nq = normalizeQuestion({ ...restored, volume: block.volume || restored.volume || '', group: block.group || restored.group || '' }, questions.length);
          attachSourceMetaV58910(nq, sourceMetaForBlockV58910(block, idx));
          questions.push(nq);pairs.push({ question: nq, block, blockIndex: idx, sourceMeta: getSourceMetaV58910(nq) });
        }
      });

      return { questions, blocks, pairs, sourceText: text };
    }

    function parseTextQuestionsBase(text) {
      return parseTextQuestionsBaseDetailed(text).questions;
    }

    function importWarningsForStrategy(qs, profile) {
      const warnings = collectImportWarnings(qs || []);
      const sourceLikelyHasAnswers = !!(profile && (profile.inlineAnswerLikely || profile.hasAnswerAnalysisSection)) || (qs || []).some((q) => (q.answer || []).length);
      return sourceLikelyHasAnswers ? warnings : warnings.filter((w) => !/* 只有原文估计含答案时才提示答案缺失，避免无答案题卷被大量标为异常。 */ /缺少答案|缺少参考答案/.test(w));
    }

    // 将参考答案并入供核对的解析文本，识别并保留已经明确写出答案的解析。
    function formatAnswerAnalysisForReview(answer, analysis = '') {
      const ans = (answer || []).map((a) => String(a || '').trim().toUpperCase()).filter(Boolean).join('');
      let text = String(analysis || '').trim();
      if (!ans) { return text; }

      // 比较解析开头和答案时忽略空白，兼容导出排版差异。
      const compact = text.replace(/\s+/g, '');
      const escapedAns = escapeRegExpV51(ans);
      // 解析已用答案标题或标点边界明确写出答案时，保留原文避免重复。
      if (new RegExp(`^(?:答案|正确答案|参考答案)?[:：]?${escapedAns}(?:[。．.、，,；;：:]|$)`, 'i').test(compact)) { return text; }

      // 兼容解析以“选 X”或“选择 X 项”直接开头的写法。
      if (new RegExp(`^(?:选|选择)${escapedAns}(?:项|选项)?(?:[。．.、，,；;：:]|$)`, 'i').test(compact)) { return text; }

      // 在补充答案标签之前清除可能导致重复的解析开头分隔符。
      text = text.replace(/^[。．.、，,；;：:]\s*/, '');
      return text ? `答案：${ans}。${text}` : `答案：${ans}`;
    }

    function visibleQuestionTextForRisk(s) {
      // 风险计数用图片占位替换内嵌图片，避免把编码长度算作过长题干。
      return String(s || '').replace(/!\[[^\]]{0,80}\]\(data:image\/(?:png|jpeg|jpg|gif|webp|bmp|svg\+xml);base64,[^)]+\)/g, '[图片]');
    }

    // 风险检测仅比较可见选项文本，避免图片数据和导入占位符触发过长选项提示。
    function visibleOptionTextForRisk(s) {
      return visibleQuestionTextForRisk(s)
        .replace(/* 选项中裸露的内嵌图片地址同样折叠成一个图片标记。 */ /data:image\/(?:png|jpeg|jpg|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/=\r\n]+/g, '[图片]')
        .replace(/* 将常见 Markdown 图片引用计为一个可见图片标记。 */ /!\[[^\]]{0,80}\]\([^)]{0,120}\)/g, '[图片]')
        .replace(/* 兼容文档导入暂存的方括号图片标记，避免计入正文长度。 */ /\[?【SHIROHA_IMAGE:[^】]+】\]?/g, '[图片]');
    }

    // 为具有明确公考题型证据的长题干保留例外，同时检查题干中是否误混入答案和选项。
    function isCivilServiceLongStemAllowed(q, profile = {}) {
      const question = visibleQuestionTextForRisk(q?.question || '');
      const group = String(q?.group || q?.category || profile?.group || '');
      const options = q?.options || [];
      const answer = q?.answer || [];
      if (question.length <= 260) { return true; }

      if (!['single', 'multiple', 'judge'].includes(q?.type)) { return false; }

      if (['single', 'multiple'].includes(q?.type) && options.length < 3) { return false; }

      if (!answer.length) { return false; }

      // 忽略公考试题分区名称中的空白，兼容 OCR 或 Word 的分散排版。
      const label = group.replace(/\s+/g, '');
      // 用常见行测模块标签识别长篇阅读、资料或推理题。
      const moduleLike = /(?:言语理解|语言理解|言语表达|语言表达|片段阅读|篇章阅读|词语理解|主旨概括|意图判断|语句排序|数量关系|数学运算|判断推理|逻辑判断|定义判断|类比推理|图形推理|资料分析|材料分析|常识判断|综合素质|行政职业能力)/.test(label);
      // 用常见阅读、推理或资料题干表述补足分区标题不明时的判断。
      const stemLike = /(?:这段文字|这段话|文段|文中|划线|横线|依次填入|下列说法|下列选项|下列表述|根据上述定义|根据上述资料|根据下列资料|根据以下资料|根据资料|由此可以推出|最能支持|最能削弱|最能质疑|最恰当|意在说明|主要介绍|主要说的是|概括|理解正确|属于|不属于|回答\s*\d+\s*[~～至\-—]\s*\d+\s*题|规模以上|进出口|增长速度|实现利润|参保人数|房地产开发投资|低保对象)/.test(question);
      // 题干夹带答案或下一题的答案行时，取消长题干豁免。
      const hasPollution = /【\s*(?:答案|正确答案|参考答案|解析)|(?:答案|正确答案|参考答案)\s*[:：]|\n\s*\d{1,4}\s*[、.．:：]\s*【\s*答案/.test(question);
      // 题干中接连出现 A 和 B 选项标签可能表示分块失败。
      const optionPollution = /(?:^|\s)A\s*[、.．:：]\s*.+(?:\s|\n)B\s*[、.．:：]/.test(question);
      return (moduleLike || stemLike) && !hasPollution && !optionPollution;
    }

    // 在一般题目校验基础上识别偏长内容和选项边界污染，返回有助于局部修复决策的状态。
    function localRepairRiskStatus(q, profile) {
      const status = validateQuestion(q);
      // 原文若没有明显行内答案，缺少答案的提示不会单独触发局部修复。
      if (status !== '正常' && !(!profile?.inlineAnswerLikely && /缺少答案|缺少参考答案/.test(status))) { return status; }

      const question = visibleQuestionTextForRisk(q.question || '');
      const options = q.options || [];
      if ((options || []).some((o) => {
        const text = visibleOptionTextForRisk(o.text || '');return text.length > 220 || /* 选项出现答案标记或带新题号的答案提示时，可能发生选项跨题粘连。 */ /【\s*(?:答案|正确答案)|\b\d{1,4}\s*[、.．:：].+【\s*答案/.test(text);
      })) { return '选项疑似粘连'; }

      // 题干中的明确答案标签视为原文边界污染。
      if (/【\s*(?:答案|正确答案|参考答案)|(?:答案|正确答案|参考答案)\s*[:：]/.test(question)) { return '题干残留答案标记'; }

      if (question.length > 260 && !isCivilServiceLongStemAllowed(q, profile)) { return '题干过长'; }

      if (['single', 'multiple'].includes(q.type)) {
        if (/* 空括号后直接出现 A 标签，可能是首个选项未被切分。 */ /[（(]\s*[）)]\s*A\s*(?:[、.．:：]|\s+|(?=[\u4e00-\u9fa5]))/.test(question) || /* 句末后出现孤立的 A 选项标签需检查，排除等级等正常题干表述。 */ /[。？！?]\s*A\s*(?:[、.．:：]|\s+)(?!级|PI\b|P\b)/i.test(question)) { return '题干疑似混入A选项'; }

        const explicitSingle = mapType(q.group || q.category || '') === 'single';
        const optionKeys = new Set(options.map((o) => String(o.key || '').toUpperCase()));
        const answerFitsTwoOption = (q.answer || []).length === 1 && optionKeys.has(String(q.answer[0] || '').toUpperCase());
        if (q.type === 'single' && options.length === 2 && !isJudgeBlock(options, q.answer || []) && !(explicitSingle && answerFitsTwoOption)) { return '单选题选项数量偏少'; }

        if (q.type === 'multiple' && options.length < 3) { return '多选题选项数量偏少'; }
      }

      if (q.type === 'judge') {
        const map = judgeOptionMap(options);
        if (options.length >= 2 && !map.confidence && !(options.some((o) => o.key === 'A') && options.some((o) => o.key === 'B'))) { return '判断题选项含义疑似不明确'; }
      }

      return '正常';
    }

    function isConfirmableImportIssue(status) {
      // 识别可以由用户核对的软风险提示，避免把不确定提示当成解析失败。
      return /请确认|偏少|过短|疑似判断题被识别为单选题/.test(String(status || ''));
    }

    // 保留明确的题目异常，并区分可以人工确认的较弱风险。
    function importIssueStatus(q, profile) {
      const hard = validateQuestion(q);
      if (hard !== '正常') { return isConfirmableImportIssue(hard) ? `异常：${hard}` : hard; }

      const soft = localRepairRiskStatus(q, profile || {});
      return soft === '正常' ? '正常' : `异常：${soft}`;
    }

    // 汇总每道题可人工确认的风险提醒，保留题号方便查找。
    function collectSoftRiskWarnings(arr, profile) {
      const warnings = [];
      (arr || []).forEach((q, i) => {
        const status = importIssueStatus(q, profile || {});if (status !== '正常') { warnings.push(`第${i + 1}题：${status}`); }
      });

      return warnings;
    }

    function countLocalRepairWarnings(qs, profile) {
      return (qs || []).reduce((n, q) => n + (localRepairRiskStatus(q, profile) === '正常' ? 0 : 1), 0);
    }

    /* SHIROHA_WEB_V58_9_12_LOCAL_REPAIR_AUDIT_FIX */
    function localRepairQuestionLimitV58912(count) {
      const n = Math.max(0, Number(count) || 0);
      if (n <= 20) { return Math.min(2, n); }

      return Math.min(8, Math.max(2, Math.ceil(n * 0.04)));
    }

    // 为局部切块候选统计缺失答案和异常程度，供候选替换时比较。
    function scoreLocalSegment(qs, profile) {
      let score = ((qs || []).length * 30) - (countLocalRepairWarnings(qs, profile) * 120);
      (qs || []).forEach(/* 逐题区分可确认提示和明显异常，以不同权重影响局部候选得分。 */ (q) => {
        if (q.question && q.question.length > 260 && !isCivilServiceLongStemAllowed(q, profile)) { score -= 30; }

        if ((q.options || []).some((o) => String(o.text || '').length > 220)) { score -= 40; }

        if (['single', 'multiple'].includes(q.type) && q.options.length >= 2) { score += 20; }

        if (q.type === 'judge' && q.options.length >= 2) { score += 20; }
      });

      return score;
    }

    // 使用标准、分卷及紧凑题号路径重新识别同一局部原文，供调用方比较。
    function parseLocalRepairCandidates(text) {
      const arr = [];
      const push = (name, fn) => {
        try { const qs = fn().map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);arr.push({ name, questions: qs }); } catch (err) { warnDev(`局部解析候选失败：${name}`, err); }
      };

      push('标准试卷段落解析', () => parseStructuredExamText(text));

      push('局部标准解析', () => parseTextQuestionsBase(text));

      push('局部紧凑解析', () => parseTextQuestionsBase(forceSplitCompactText(text)));

      push('局部分卷分区解析', () => parseByVolumeAndSections(text));

      return arr.filter((c) => c.questions.length);
    }

    // 整理局部候选的可见题干、选项和解析，供前后内容保全检查。
    function localVisibleContentV599(qs) {
      return normalizeText((qs || []).map((q) => [
        visibleQuestionTextForRisk(q.question || ''),
        ...(q.options || []).map((o) => visibleOptionTextForRisk(o.text || '')),
      ].join('\n')).join('\n'));
    }

    // 统计图片、表格和公式证据，确保局部修复没有丢弃富文本内容。
    function localRichContentStatsV58912(qs) {
      const all = (qs || []).map((q) => [q?.question || '', q?.analysis || '', ...(q?.options || []).map((o) => o?.text || '')].join('\n')).join('\n');
      const count = (re) => (all.match(re) || []).length;

      const imageTokens = extractInlineImageTokensV589(all).length + count(/* 统计数字编号的 DOCX 图片占位符。 */ /\[\[DOCX_IMAGE_\d+\]\]/g) + count(/* 兼容带说明文字的旧 DOCX 图片占位格式。 */ /【DOCX图片\d+[^】]*】/g);
      return {
        images: imageTokens + (qs || []).reduce((n, q) => n + (Array.isArray(q?.images) ? q.images.length : 0), 0),
        tables: count(/* 按表格起始标记统计 Word 表格。 */ /【DOCX表格开始】/g),
        formulas: count(/* 统计带参数或直接闭合的 Word OMML 公式标记。 */ /【DOCX公式OMML(?::|】)/g),
      };
    }

    function localRichContentPreservedV58912(beforeQs, afterQs) {
      const before = localRichContentStatsV58912(beforeQs); const after = localRichContentStatsV58912(afterQs);
      return after.images >= before.images && after.tables >= before.tables && after.formulas >= before.formulas;
    }

    // 校对原题和候选的顺序及对应关系，防止局部替换时题目发生漂移。
    function localSequenceAlignedV599(base, pairs) {
      if (!base.length || base.length !== pairs.length) { return false; }

      let textMatched = 0;
      for (let i = 0;i < base.length;i += 1) {
        const pairQ = pairs[i]?.question;
        if (!pairQ || String(base[i].number) !== String(pairQ.number)) { return false; }

        const a = normalizeText(visibleQuestionTextForRisk(base[i].question || ''));
        const b = normalizeText(visibleQuestionTextForRisk(pairQ.question || ''));
        if (!a || !b) { continue; }

        const aHead = a.slice(0, 24); const bHead = b.slice(0, 24);
        if (a.includes(bHead) || b.includes(aHead)) { textMatched += 1; }
      }

      return textMatched >= Math.max(1, Math.ceil(base.length * 0.7));
    }

    // 只用内容未减少且质量确有提高的候选替换原段，避免把局部异常扩大到正常题。
    function localCandidateCanReplaceV599(originalQs, candidateQs, profile) {
      if (!originalQs.length || candidateQs.length !== originalQs.length) { return false; }

      if (!originalQs.every((q, i) => String(q.number) === String(candidateQs[i]?.number))) { return false; }

      const beforeRisk = countLocalRepairWarnings(originalQs, profile);
      const afterRisk = countLocalRepairWarnings(candidateQs, profile);
      if (afterRisk >= beforeRisk) { return false; }

      const before = localVisibleContentV599(originalQs);
      const after = localVisibleContentV599(candidateQs);
      if (before.length) {
        const ratio = after.length / before.length;
        if (ratio < 0.85) { return false; }
      }

      const beforeAnswered = originalQs.filter((q) => (q.answer || []).length).length;
      const afterAnswered = candidateQs.filter((q) => (q.answer || []).length).length;
      if (afterAnswered < beforeAnswered) { return false; }

      if (!localRichContentPreservedV58912(originalQs, candidateQs)) { return false; }

      return scoreLocalSegment(candidateQs, profile) > scoreLocalSegment(originalQs, profile) + 20;
    }

    function questionTextComparableV58910(q) {
      return normalizeText(visibleQuestionTextForRisk(q?.question || ''));
    }

    // 按完整题干相等和包含关系估计原题与候选的匹配强度。
    function questionMatchStrengthV58910(a, b) {
      const x = questionTextComparableV58910(a); const y = questionTextComparableV58910(b);if (!x || !y) { return 0; }

      if (x === y) { return 4; }

      const shortX = x.slice(0, 32); const shortY = y.slice(0, 32);
      if (x.includes(shortY) || y.includes(shortX)) { return 3; }

      let same = 0;const limit = Math.min(48, x.length, y.length);for (let i = 0;i < limit && x[i] === y[i];i += 1) { same += 1; }

      if (same >= 18) { return 2; }

      if (same >= 10) { return 1; }

      return 0;
    }

    // 将已匹配原始分块的来源区间附回题目，避免重新猜测偏移。
    function attachDetailedSourceMetaToQuestionsV58910(questions, detailed) {
      const qs = questions || []; const pairs = detailed?.pairs || [];let cursor = 0; let matched = 0;
      for (let i = 0;i < qs.length;i += 1) {
        const q = qs[i];let best = -1; let bestScore = -1;
        for (let j = cursor;j < Math.min(pairs.length, cursor + 12);j += 1) {
          const pq = pairs[j]?.question;if (!pq) { continue; }

          const noSame = String(q.number || '') === String(pq.number || '');
          const strength = questionMatchStrengthV58910(q, pq);
          const score = (noSame ? 6 : 0) + strength - ((j - cursor) * 0.05);
          if ((noSame || strength >= 2) && score > bestScore) { best = j;bestScore = score; }
        }

        if (best < 0) { continue; }

        const pair = pairs[best]; const meta = { ...(pair.sourceMeta || getSourceMetaV58910(pair.question) || sourceMetaForBlockV58910(pair.block, pair.blockIndex)), pairIndex: best };
        attachSourceMetaV58910(q, meta);cursor = best + 1;matched += 1;
      }

      return { questions: qs, matched, total: qs.length, ratio: qs.length ? matched / qs.length : 0 };
    }

    // 同行题号粘连时补入换行，给后续按原文锚点重新切块创造分界。
    function forceSplitSourceQuestionAnchorsV58910(text) {
      return String(text || '')
        .replace(/* 标点后出现带正文的括号题号时，可在保留标点的前提下换行。 */ /([。！？?!；;])\s*(?=[（(【[]\s*\d{1,4}\s*[）)】\]]\s*\S)/g, '$1\n')
        .replace(/* 由空白分隔且带正文的括号题号也可作为独立题的开始。 */ /([^\n])\s+(?=[（(【[]\s*\d{1,4}\s*[）)】\]]\s*\S)/g, '$1\n')
        .replace(/* 由空白分隔的数字、可选“第”“题”和题号标点识别为另一类粘连题号。 */ /([^\n])\s+(?=(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]\s*\S)/g, '$1\n');
    }

    // 确认局部候选没有改写锁定题目的原意和既有答案。
    function questionLockedEquivalentV58910(original, candidate, profile) {
      if (!original || !candidate || String(original.number) !== String(candidate.number)) { return false; }

      const strength = questionMatchStrengthV58910(original, candidate);
      const originalRisk = localRepairRiskStatus(original, profile); const candidateRisk = localRepairRiskStatus(candidate, profile);
      if (candidateRisk !== '正常' && originalRisk === '正常') { return false; }

      if (strength < 2 && originalRisk === '正常') { return false; }

      const beforeAnswered = (original.answer || []).length > 0; const afterAnswered = (candidate.answer || []).length > 0;
      if (beforeAnswered && !afterAnswered) { return false; }

      if (originalRisk === '正常' && (candidate.options || []).length < Math.min(2, (original.options || []).length)) { return false; }

      if (!localRichContentPreservedV58912([original], [candidate])) { return false; }

      return true;
    }

    // 按原文区间拼接所选题块，保留分组切换提示用于重新解析。
    function blockTextV58910(blocks, start, end) {
      let lastVolume = ''; let lastChapter = ''; let lastGroup = '';const parts = [];
      (blocks || []).slice(start, end + 1).forEach(/* 跨题组时插入新的组名，并按原顺序追加原文块。 */ (b) => {
        const head = [];
        if ((b.volume || '') !== lastVolume && b.volume) { head.push(b.volume); }

        if ((b.chapter || '') !== lastChapter && b.chapter) { head.push(b.chapter); }

        if ((b.group || '') !== lastGroup && b.group) { head.push(b.group); }

        const body = (b.lines || []).join('\n');parts.push([...head, body].filter(Boolean).join('\n'));
        lastVolume = b.volume || lastVolume;lastChapter = b.chapter || lastChapter;lastGroup = b.group || lastGroup;
      });

      return parts.join('\n');
    }

    function candidateExplicitNumbersV58910(qs) {
      return (qs || []).map((q) => Number(q.number || 0)).filter((n) => n > 0 && n < 10000);
    }

    // 将局部重解析的题号映射到已知缺口，同时保留原来可确认的题号。
    function renumberLocalGapCandidateV58910(qs, originalSegment, expectedSet, _profile) {
      const arr = (qs || []).map((q, i) => normalizeQuestion(q, i));
      const originals = originalSegment || [];if (!arr.length || !originals.length) { return arr; }

      const originalNums = originals.map((q) => Number(q.number || 0)).filter(Boolean);
      const target = [...new Set([...originalNums, ...expectedSet].map(Number).filter(Boolean))].sort((a, b) => a - b);
      if (target.length !== arr.length) { return arr; }

      for (const oq of originals) {
        const pos = target.indexOf(Number(oq.number || 0));
        if (pos < 0 || questionMatchStrengthV58910(oq, arr[pos]) < 2) { return arr; }
      }

      return arr.map((q, i) => normalizeQuestion({ ...q, number: target[i] }, i));
    }

    // 根据同组且顺序可信的前后题号推断缺号，给重新切块限定合理范围。
    function inferLostNumbersBetweenAnchorsV58910(base) {
      const out = [...(base || [])];let changed = 0;const segments = [];
      let left = 0;
      while (left < out.length) {
        const lm = getSourceMetaV58910(out[left]);
        if (!lm?.explicitNumber) { left += 1;continue; }

        let right = left + 1;
        while (right < out.length && !getSourceMetaV58910(out[right])?.explicitNumber) { right += 1; }

        if (right >= out.length) { break; }

        const rm = getSourceMetaV58910(out[right]);
        const ln = Number(lm.originalNumber || out[left].number || 0); const rn = Number(rm.originalNumber || out[right].number || 0);
        const sameSection = sameSourceSectionV58911(lm, rm);
        if (sameSection && right - left > 1 && rn - ln === right - left && rn > ln) {
          for (let i = left + 1;i < right;i += 1) {
            const inferred = ln + (i - left); const old = out[i]; const meta = getSourceMetaV58910(old) || {};
            const next = normalizeQuestion({ ...old, number: inferred }, i);
            attachSourceMetaV58910(next, { ...meta, originalNumber: null, explicitNumber: false, inferredNumber: inferred });
            out[i] = next;changed += 1;
          }

          segments.push(`题号${ln}-${rn}之间：依据前后真实题号恢复${right - left - 1}道题的编号`);
        }

        left = right;
      }

      return { questions: out, changed, segments };
    }

    // 共享标准局部策略和强制分题候选；强制分题失败时仍保留标准候选。
    function collectAnchoredRepairCandidates(rawText, failureNotice) {
      const candidates = parseLocalRepairCandidates(rawText);
      try {
        const splitText = forceSplitSourceQuestionAnchorsV58910(rawText);
        const qs = parseTextQuestionsBase(splitText).map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
        if (qs.length) { candidates.push({ name: '局部题号边界解析', questions: qs }); }
      } catch (e) { warnDev(failureNotice, e); }

      return candidates;
    }

    // 用可追溯的原文窗口修复缺号和粘连，只替换证据充分且不会覆盖其他题目的局部片段。
    function repairMissingAndStuckQuestionsBySourceV58910(original, standardQuestions, profile, detailedInput) {
      const detailed = detailedInput || parseTextQuestionsBaseDetailed(original);
      let base = (standardQuestions || []).map((q, i) => normalizeQuestion(q, i));
      const alignment = attachDetailedSourceMetaToQuestionsV58910(base, detailed);
      if (!base.length || alignment.ratio < 0.6) { return { questions: base, repaired: 0, segments: [], sourceAligned: alignment.matched }; }

      const inferred = inferLostNumbersBetweenAnchorsV58910(base);base = inferred.questions;
      const blocks = detailed.blocks || [];const windows = new Map();
      // 合并同一来源范围的修复证据，记录预期题号供候选校验。
      const addWindow = (blockStart, blockEnd, reason, expectedNumbers = []) => {
        if (blockStart < 0 || blockEnd < blockStart || blockEnd >= blocks.length) { return; }

        const key = `${blockStart}:${blockEnd}`;const old = windows.get(key) || { blockStart, blockEnd, reasons: [], expectedNumbers: [] };
        if (!old.reasons.includes(reason)) { old.reasons.push(reason); }

        expectedNumbers.forEach((inputN) => {
          let n = inputN;n = Number(n) || 0;if (n && !old.expectedNumbers.includes(n)) { old.expectedNumbers.push(n); }
        });

        windows.set(key, old);
      };

      base.forEach((q) => {
        const meta = getSourceMetaV58910(q);if (!meta) { return; }

        const nums = (meta.sourceQuestionNumbers || []).map(Number).filter(Boolean);
        if (nums.length >= 2) { addWindow(meta.sourceBlockStart, meta.sourceBlockEnd, '单块含多个题号', nums); }
      });

      for (let i = 0;i < base.length - 1;i += 1) {
        const a = base[i]; const b = base[i + 1]; const ma = getSourceMetaV58910(a); const mb = getSourceMetaV58910(b);if (!ma || !mb) { continue; }

        const na = Number(a.number || 0); const nb = Number(b.number || 0);
        const sameSection = sameSourceSectionV58911(ma, mb);
        if (sameSection && na > 0 && nb - na >= 2 && nb - na <= 8) {
          const missing = [];for (let n = na + 1;n < nb;n += 1) { missing.push(n); }

          addWindow(ma.sourceBlockStart, Math.max(ma.sourceBlockEnd, mb.sourceBlockStart - 1), '题号缺口', missing.concat([na]));
        }
      }

      const usedBlocks = new Set();base.forEach((q) => {
        // eslint-disable-next-line no-plusplus -- 来源区间起点可为字符串或 BigInt；限定元数据类型后移除此例外。
        const m = getSourceMetaV58910(q);if (m) { for (let i = m.sourceBlockStart;i <= m.sourceBlockEnd;i++) { usedBlocks.add(i); } }
      });

      const sectionNumberKey = (section, n) => [normalizeSectionLabelV58911(section?.volume || ''), normalizeSectionLabelV58911(section?.chapter || ''), normalizeSectionLabelV58911(section?.group || ''), Number(n) || 0].join('|');

      const existingSectionNumbers = new Set();
      base.forEach((q) => {
        const m = getSourceMetaV58910(q) || {};const n = Number(m.originalNumber || q.number || 0);if (n) { existingSectionNumbers.add(sectionNumberKey(m, n)); }
      });

      blocks.forEach((block, idx) => {
        if (usedBlocks.has(idx) || !block.sourceLikelyQuestion) { return; }

        const nums = (block.sourceQuestionNumbers || []).map(Number).filter((n) => n && !existingSectionNumbers.has(sectionNumberKey(block, n)));
        if (nums.length) { addWindow(idx, idx, '未消费题目区间', nums); }
      });

      const prepared = [...windows.values()].sort((a, b) => a.blockStart - b.blockStart || a.blockEnd - b.blockEnd);
      const replacements = [];const occupiedBlocks = [];const segments = [...inferred.segments];let repaired = inferred.changed;
      for (const win of prepared) {
        if (occupiedBlocks.some(([a, b]) => !(win.blockEnd < a || win.blockStart > b))) { continue; }

        const originalIndexes = [];
        base.forEach((q, i) => {
          const m = getSourceMetaV58910(q);if (m && m.sourceBlockStart <= win.blockEnd && m.sourceBlockEnd >= win.blockStart) { originalIndexes.push(i); }
        });

        const baseStart = originalIndexes.length ? Math.min(...originalIndexes) : (base.findIndex((q) => (getSourceMetaV58910(q)?.sourceBlockStart ?? Infinity) > win.blockEnd));
        const insertAt = baseStart < 0 ? base.length : baseStart;
        const baseEnd = originalIndexes.length ? Math.max(...originalIndexes) : insertAt - 1;
        const originalSegment = originalIndexes.length ? base.slice(baseStart, baseEnd + 1) : [];
        const expectedSet = new Set(win.expectedNumbers.map(Number).filter(Boolean));
        (blocks.slice(win.blockStart, win.blockEnd + 1) || []).forEach((b) => (b.sourceQuestionNumbers || []).forEach((n) => expectedSet.add(Number(n))));

        const rawText = blockTextV58910(blocks, win.blockStart, win.blockEnd);
        const candidates = collectAnchoredRepairCandidates(rawText, '局部题号边界解析失败。');
        let best = null;
        for (const candidate of candidates) {
          let qs = (candidate.questions || []).map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
          if (!qs.length) { continue; }

          qs = renumberLocalGapCandidateV58910(qs, originalSegment, expectedSet, profile);
          const nums = candidateExplicitNumbersV58910(qs); const unique = [...new Set(nums)];
          if (nums.length !== unique.length) { continue; }

          const originalNums = originalSegment.map((q) => Number(q.number || 0)).filter(Boolean);
          if (!originalNums.every((n) => unique.includes(n))) { continue; }

          const newlyAdded = unique.filter((n) => !originalNums.includes(n));
          if (!newlyAdded.length) { continue; }

          if (newlyAdded.some((n) => expectedSet.size && !expectedSet.has(n))) { continue; }

          const explained = [...expectedSet].filter((n) => newlyAdded.includes(n)).length;
          if (expectedSet.size && explained === 0) { continue; }

          let lockedOk = true;
          for (const oq of originalSegment) { const cq = qs.find((x) => String(x.number) === String(oq.number));if (!questionLockedEquivalentV58910(oq, cq, profile)) { lockedOk = false;break; } }

          if (!lockedOk) { continue; }

          const oldRisk = countLocalRepairWarnings(originalSegment, profile); const newRisk = countLocalRepairWarnings(qs, profile);
          if (newRisk > oldRisk) { continue; }

          if (!localRichContentPreservedV58912(originalSegment, qs)) { continue; }

          const rank = ((explained * 500) + (newlyAdded.length * 200)) - (newRisk * 120) + scoreLocalSegment(qs, profile);
          if (!best || rank > best.rank) { best = { ...candidate, questions: qs, rank, newlyAdded }; }
        }

        if (!best) { continue; }

        const spanMeta = { sourceStart: blocks[win.blockStart]?.sourceStart ?? -1, sourceEnd: blocks[win.blockEnd]?.sourceEnd ?? -1, sourceBlockStart: win.blockStart, sourceBlockEnd: win.blockEnd, blockIndex: win.blockStart, sourceQuestionNumbers: [...expectedSet], group: blocks[win.blockStart]?.group || '', volume: blocks[win.blockStart]?.volume || '', chapter: blocks[win.blockStart]?.chapter || '' };
        best.questions.forEach((q) => attachSourceMetaV58910(q, { ...spanMeta, originalNumber: Number(q.number) || null, explicitNumber: expectedSet.has(Number(q.number)) }));

        replacements.push({ start: insertAt, end: baseEnd, questions: best.questions });
        occupiedBlocks.push([win.blockStart, win.blockEnd]);repaired += best.newlyAdded.length;
        segments.push(`原文块${win.blockStart + 1}-${win.blockEnd + 1}：${win.reasons.join('、')}，${best.name}补回题号${best.newlyAdded.join('、')}`);
      }

      if (!replacements.length) { return { questions: base, repaired, segments, sourceAligned: alignment.matched }; }

      const out = [...base];
      replacements.sort((a, b) => b.start - a.start).forEach((rep) => out.splice(rep.start, Math.max(0, rep.end - rep.start + 1), ...rep.questions));

      return { questions: out.map((q, i) => normalizeQuestion(q, i)), repaired, segments, sourceAligned: alignment.matched };
    }

    // 检查过度切分的连续原文窗口，用更完整的候选修复错误产生的题目。
    function repairOverSplitQuestionsBySourceV58911(original, standardQuestions, profile, detailedInput) {
      const detailed = detailedInput || parseTextQuestionsBaseDetailed(original);
      const base = (standardQuestions || []).map((q, i) => normalizeQuestion(q, i));
      const alignment = attachDetailedSourceMetaToQuestionsV58910(base, detailed);
      if (base.length < 3 || alignment.ratio < 0.6) { return { questions: base, repaired: 0, segments: [], sourceAligned: alignment.matched }; }

      const blocks = detailed.blocks || []; const windows = [];
      const anchors = [];
      base.forEach((q, i) => {
        const m = getSourceMetaV58910(q);if (m?.explicitNumber && Number(m.originalNumber || 0) > 0) { anchors.push({ index: i, number: Number(m.originalNumber), meta: m }); }
      });

      for (let a = 0;a < anchors.length - 1;a += 1) {
        const left = anchors[a]; const right = anchors[a + 1];
        if (!sameSourceSectionV58911(left.meta, right.meta) || right.number <= left.number) { continue; }

        const parsedCount = right.index - left.index; const expectedCount = right.number - left.number; const extra = parsedCount - expectedCount;
        if (extra <= 0 || extra > 3 || expectedCount < 1 || expectedCount > 8) { continue; }

        const blockStart = Number(left.meta.sourceBlockStart); const blockEnd = Number(right.meta.sourceBlockStart) - 1;
        if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd) || blockEnd < blockStart || blockEnd >= blocks.length) { continue; }

        windows.push({ start: left.index, end: right.index - 1, blockStart, blockEnd, leftNumber: left.number, rightNumber: right.number, extra });
      }

      if (!windows.length) { return { questions: base, repaired: 0, segments: [], sourceAligned: alignment.matched }; }

      const replacements = []; const occupied = [];const segments = [];let repaired = 0;
      for (const win of windows) {
        if (occupied.some(([a, b]) => !(win.end < a || win.start > b))) { continue; }

        const originalSegment = base.slice(win.start, win.end + 1); const targetNumbers = [];
        for (let n = win.leftNumber;n < win.rightNumber;n += 1) { targetNumbers.push(n); }

        const rawText = blockTextV58910(blocks, win.blockStart, win.blockEnd);
        const candidates = collectAnchoredRepairCandidates(rawText, '过度拆题局部边界解析失败。');
        let best = null;
        for (const candidate of candidates) {
          let qs = (candidate.questions || []).map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
          if (qs.length !== targetNumbers.length) { continue; }

          qs = qs.map((q, i) => normalizeQuestion({ ...q, number: targetNumbers[i] }, i));

          if (!questionLockedEquivalentV58910(originalSegment[0], qs[0], profile)) { continue; }

          const beforeRisk = countLocalRepairWarnings(originalSegment, profile); const afterRisk = countLocalRepairWarnings(qs, profile);
          if (afterRisk > beforeRisk) { continue; }

          const beforeContent = localVisibleContentV599(originalSegment); const afterContent = localVisibleContentV599(qs);
          if (beforeContent.length && afterContent.length / beforeContent.length < 0.78) { continue; }

          const beforeAnswered = originalSegment.filter((q) => (q.answer || []).length).length; const afterAnswered = qs.filter((q) => (q.answer || []).length).length;
          if (beforeAnswered > 0 && afterAnswered === 0) { continue; }

          if (!localRichContentPreservedV58912(originalSegment, qs)) { continue; }

          const rank = scoreLocalSegment(qs, profile) - (afterRisk * 120) + Math.min(180, afterContent.length) - (Math.abs(afterContent.length - beforeContent.length) * 0.1);
          if (!best || rank > best.rank) { best = { name: candidate.name, questions: qs, rank }; }
        }

        if (!best) { continue; }

        const firstBlock = blocks[win.blockStart]; const lastBlock = blocks[win.blockEnd];
        const spanMeta = { sourceStart: firstBlock?.sourceStart ?? -1, sourceEnd: lastBlock?.sourceEnd ?? -1, sourceBlockStart: win.blockStart, sourceBlockEnd: win.blockEnd, blockIndex: win.blockStart, sourceQuestionNumbers: [...targetNumbers], group: firstBlock?.group || '', volume: firstBlock?.volume || '', chapter: firstBlock?.chapter || '' };
        best.questions.forEach((q, i) => attachSourceMetaV58910(q, { ...spanMeta, originalNumber: targetNumbers[i], explicitNumber: i === 0 || ((blocks || []).slice(win.blockStart, win.blockEnd + 1).some((b) => (b.sourceQuestionNumbers || []).includes(targetNumbers[i]))) }));

        replacements.push({ start: win.start, end: win.end, questions: best.questions });occupied.push([win.start, win.end]);repaired += win.extra;
        segments.push(`题号${win.leftNumber}-${win.rightNumber}之间：${best.name}合并${win.extra}道过度拆分结果`);
      }

      if (!replacements.length) { return { questions: base, repaired: 0, segments: [], sourceAligned: alignment.matched }; }

      const out = [...base];
      replacements.sort((a, b) => b.start - a.start).forEach((rep) => out.splice(rep.start, rep.end - rep.start + 1, ...rep.questions));

      return { questions: out.map((q, i) => normalizeQuestion(q, i)), repaired, segments, sourceAligned: alignment.matched };
    }

    // 仅重解析被标为异常的相邻片段，保留原题顺序及未受影响的数据。
    function repairParsedQuestionsLocally(original, standardQuestions, profile) {
      const detailed = parseTextQuestionsBaseDetailed(original);
      const base = (standardQuestions && standardQuestions.length ? standardQuestions : detailed.questions).map((q, i) => normalizeQuestion(q, i));
      const pairs = detailed.pairs || [];
      // v58.9.9：局部替换必须先证明“标准结果索引”和原始块一一对应；漏题/粘题时不再靠数组下标猜测。
      if (!localSequenceAlignedV599(base, pairs)) { return { questions: base, repaired: 0, segments: [] }; }

      const risky = [];
      base.forEach((q, i) => {
        if (localRepairRiskStatus(q, profile) !== '正常') { risky.push(i); }
      });

      if (!risky.length) { return { questions: base, repaired: 0, segments: [] }; }

      // 这里只处理少量“已存在题目的题内异常”。大量异常、漏题和粘题留给后续原文区间机制或整卷最后兜底。
      if (risky.length > localRepairQuestionLimitV58912(base.length)) { return { questions: base, repaired: 0, segments: [] }; }

      const replacements = [];let repaired = 0;const segments = [];
      let r = 0;
      while (r < risky.length) {
        const start = risky[r];let end = start;
        while (r + 1 < risky.length && risky[r + 1] <= end + 1) { r += 1;end = risky[r]; }

        const segStart = Math.max(0, start - 1); const segEnd = Math.min(pairs.length - 1, end + 1);
        const localBlocks = pairs.slice(segStart, segEnd + 1).map((p) => p.block).filter(Boolean);
        const segmentText = localBlocks.map((b) => {
          const head = [b.volume, b.group].filter(Boolean).join('\n');
          const body = (b.lines || []).join('\n');
          return [head, body].filter(Boolean).join('\n');
        }).join('\n');
        const windowOriginal = base.slice(segStart, segEnd + 1);
        const targetOffset = start - segStart;
        const targetLength = end - start + 1;
        const originalTarget = base.slice(start, end + 1);
        let best = { name: '原标准片段', questions: originalTarget, score: scoreLocalSegment(originalTarget, profile) };
        parseLocalRepairCandidates(segmentText).forEach(/* 评估不同切块策略在同一原文片段上的质量，选取能够改善原结果的候选。 */ (c) => {
          // 前后正常题只作为边界锚点，不允许被候选一起替换。
          if (c.questions.length !== windowOriginal.length) { return; }

          if (!c.questions.every((q, i) => String(q.number) === String(windowOriginal[i].number))) { return; }

          const candidateTarget = c.questions.slice(targetOffset, targetOffset + targetLength);
          if (!localCandidateCanReplaceV599(originalTarget, candidateTarget, profile)) { return; }

          const sc = scoreLocalSegment(candidateTarget, profile);
          if (sc > best.score) { best = { name: c.name, questions: candidateTarget, score: sc }; }
        });

        if (best.name !== '原标准片段') {
          replacements.push({ start, end, questions: best.questions, name: best.name });
          const delta = countLocalRepairWarnings(originalTarget, profile) - countLocalRepairWarnings(best.questions, profile);
          repaired += Math.max(1, delta);
          segments.push(`第${start + 1}-${end + 1}题：${best.name}，仅替换异常题，前后题保持锁定`);
        }

        r += 1;
      }

      if (!replacements.length) { return { questions: base, repaired: 0, segments: [] }; }

      const out = [];
      for (let i = 0;i < base.length;) {
        const rep = replacements.find((x) => x.start === i);
        if (rep) {
          rep.questions.forEach((q) => out.push(q));

          i = rep.end + 1;continue;
        }

        out.push(base[i]);i += 1;
      }

      return { questions: out.map((q, i) => normalizeQuestion(q, i)), repaired, segments };
    }

    // 辨认带有编号和答案证据的解析条目，供正文与答案分区分离使用。
    function isAnswerAnalysisEntryLine(line) {
      const s = String(line || '').trim();
      if (!s) { return false; }

      // 识别带括号或冒号标题的编号答案行。
      if (/^\s*\d{1,4}\s*(?:[.、．:：]\s*)?(?:【\s*(?:答案|正确答案|参考答案|标准答案)\s*】|\[\s*(?:答案|正确答案|参考答案|标准答案)\s*\]|(?:答案|正确答案|参考答案|标准答案)\s*[:：])\s*(?:[A-Ga-g]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)/i.test(s)) { return true; }

      // 识别带编号、解析标题及选项或对错符号的答案解析行。
      if (/^\s*\d{1,4}\s*[.、．:：]\s*(?:【\s*(?:解析|答案解析|试题解析)\s*】|\[\s*(?:解析|答案解析|试题解析)\s*\]|(?:解析|答案解析|试题解析|分析)\s*[:：])\s*(?:选\s*)?(?:[A-Ga-g]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)/i.test(s)) { return true; }

      // 兼容省略答案标题、用标点或解析标题隔开后文的紧凑答案行。
      if (/^\s*\d{1,4}\s*[.、．:：]\s*[A-Ga-g]{1,7}(?=$|[\s。．.、，,；;：:]|【\s*解析\s*】|\[\s*解析\s*\]|解析|分析)/.test(s)) { return true; }

      // 识别选项字母直接连着解析数字的历史排版。
      if (/^\s*\d{1,4}\s*[.、．:：]\s*[A-Ga-g][\d/.]+/.test(s)) { return true; } // 16.B352 / 20.A122/199

      return false;
    }

    // 用标题后的内容确认答案分区，避免把题干中独立出现的“答案”误识为分区。
    function isAnswerSectionHeading(line, nextLines = []) {
      const raw = String(line || '').trim();
      // 折叠标题中的普通和全角空白，兼容逐字排版。
      const s = raw.replace(/[\s\u3000]+/g, '');
      if (!s) { return false; }

      // 匹配可能带中文章节号的完整答案或解析标题。
      const heading = /^(?:[一二三四五六七八九十]+[、.．:：]?)?(?:答案|参考答案|标准答案|正确答案|答案解析|答案及解析|答案与解析|试题解析|真题答案|解析)$/.test(s);
      if (!heading) { return false; }

      const look = (nextLines || []).slice(0, 6).filter(Boolean).map((x) => String(x).trim());
      const hits = look.filter(isAnswerAnalysisEntryLine).length;
      const hasAnswerWords = look.some((l) => /* 后续行中的答案标记或选项结论也是答案区的可靠证据。 */ /【\s*(?:答案|解析)\s*】|(?:答案|正确答案|参考答案|标准答案|解析|分析)\s*[:：]|故(?:答案)?选|本题(?:答案)?(?:为|选)|因此.*(?:答案|选)|所以.*选/.test(l));
      return hits >= 1 || hasAnswerWords;
    }

    // 依据短标题的编号、题型语义和后续题目证据识别通用分区，避免混入普通题干。
    function isGenericQuestionSectionHeading(line, nextLines = []) {
      const raw = String(line || '').trim();
      if (!raw || raw.length > 50) { return false; }

      if (isOptionLine(raw) || isAnswerAnalysisEntryLine(raw) || isAnswerLine(raw) || isAnalysisLine(raw)) { return false; }

      // 识别分区语义前折叠普通和全角空白。
      const compact = raw.replace(/[\s\u3000]+/g, '');
      // 真实分区通常是“第一部分/一、言语理解/三、图形推理/四、逻辑判断”；
      // 普通题目也可能以“1．心理契约……”开头，不能当分区。
      const chineseSection = /^(?:第[一二三四五六七八九十0-9]+部分|[一二三四五六七八九十]+[、.．:：])/.test(compact)
    && /* 编号标题还须出现题型或行测模块名，避免把带中文序号的正文当成标题。 */ /(?:言语|语言|数学|数量|图形|逻辑|判断推理|定义判断|类比推理|资料分析|材料分析|综合|能力|常识|单选|多选|判断题|填空|简答)/.test(compact);
      // 允许阿拉伯数字后带章节分隔符的短小题型标题。
      const numericTypeSection = /^\d+[、.．:：]/.test(compact)
    && compact.length <= 20
    && /* 限制数字编号短标题的主题，防止普通题号被误作分区。 */ /(?:言语|语言|数学|数量|图形|逻辑|判断推理|资料分析|材料分析|单选|多选|判断题|填空|简答)/.test(compact);
      if (!chineseSection && !numericTypeSection) { return false; }

      const look = (nextLines || []).slice(0, 10).filter(Boolean).map((x) => String(x).trim());
      const qHits = look.filter((l) => hasStrongQuestionNo(l) || /* 用中式或方括号题号统计标题后可辨认的题目证据。 */ /^[【[]\s*\d{1,4}\s*[】\]]/.test(l) || isQuestionStart(l) || /* 单独占行且以标点结尾的数字也可指示下一道题。 */ /^\d{1,4}\s*[.、．:：]\s*$/.test(l)).length;
      const aHits = look.filter(isAnswerAnalysisEntryLine).length;
      return qHits >= 1 || aHits >= 1 || chineseSection;
    }

    // 将同义分区标题归为稳定键，避免用标题格式判断答案条目的归属。
    function sectionKeyFromText(s) {
      // 分区名称比较忽略排版空白。
      const x = String(s || '').replace(/\s+/g, '');
      if (!x) { return ''; }

      // 归并“言语”和“语言”模块的标题差异。
      if (/言语|语言/.test(x)) { return 'verbal'; }

      // 归并数学与数量关系模块。
      if (/数学|数量/.test(x)) { return 'math'; }

      // 把图形类标题归到同一个推理分区。
      if (/图形/.test(x)) { return 'graph'; }

      // 归并逻辑、定义、类比和判断推理标题。
      if (/逻辑|定义判断|类比推理|判断推理/.test(x)) { return 'logic'; }

      // 把资料分析和材料分析当作同类分区。
      if (/资料分析|材料分析/.test(x)) { return 'data'; }

      // 兼容判断题的正误和是非标题。
      if (/判断题|正误|是非/.test(x)) { return 'judge'; }

      // 多选题标题可能使用“多选”或“多项”。
      if (/多选|多项/.test(x)) { return 'multiple'; }

      // 单选题标题可能使用“单选”或“单项”。
      if (/单选|单项/.test(x)) { return 'single'; }

      return '';
    }

    // 用明确答案标题或局部连续出现的答案条目判定是否值得尝试分区解析。
    function hasAnswerAnalysisSignal(text) {
      const lines = normalizeImportText(text).split('\n').map((x) => x.trim()).filter(Boolean);
      for (let i = 0;i < lines.length;i += 1) {
        if (isAnswerSectionHeading(lines[i], lines.slice(i + 1, i + 7))) { return true; }
      }

      for (let i = 0;i < lines.length - 2;i += 1) {
        const win = lines.slice(i, i + 4);
        if (win.filter(isAnswerAnalysisEntryLine).length >= 2) { return true; }
      }

      return false;
    }

    // 按标记强弱从参考文本提取客观答案，只有调用方允许时才读取文本开头的裸答案。
    function extractObjectiveAnswerFromText(raw, allowLeading = true) {
      let s = String(raw || '').trim();
      if (!s) { return []; }

      // 去掉括号包裹的参考答案标题，为后续读取答案正文腾出开头。
      s = s.replace(/^[【[]\s*(?:答案|正确答案|参考答案|标准答案)\s*[】\]]\s*/, '').trim();
      // 去掉带冒号的答案标题，兼容没有括号的文档。
      s = s.replace(/^(?:答案|正确答案|参考答案|标准答案)\s*[:：]\s*/, '').trim();
      // 解析标题如果明确给出选项或判断符号，则提取其首个答案。
      let m = s.match(/^[【[]\s*(?:解析|答案解析|试题解析)\s*[】\]]\s*(?:选\s*)?([A-Ga-g]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)/i);
      if (m) { return splitAnswer(m[1]); }

      // 兼容冒号分隔的解析说明标题，并读取紧接着的客观结论。
      m = s.match(/^(?:解析|答案解析|试题解析|分析|详解|说明|思路|解题思路)\s*[:：]\s*(?:选\s*)?([A-Ga-g]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)/i);
      if (m) { return splitAnswer(m[1]); }

      // 兼容简写“答”和序号式客观答案。
      m = s.match(/^(?:答|答案)\s*[:：]\s*(?:选\s*)?([A-Ga-g]{1,7}|[1-9]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)/i);
      if (m) { return splitAnswer(m[1]); }

      // 从带“答案为”等明确表达的结论中提取客观结果。
      m = s.match(/(?:故|因此|所以|故而|因而)?\s*(?:本题)?\s*(?:正确)?答案\s*(?:为|是|选|选择)?\s*([A-Ga-g]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)(?:项|选项)?/i);
      if (m) { return splitAnswer(m[1]); }

      // 从“因此选 C”一类推导结论中提取字母选项。
      m = s.match(/(?:故|因此|所以|故而|因而)\s*(?:本题)?\s*(?:应|可)?\s*(?:选|选择)\s*([A-Ga-g]{1,7})(?:项|选项)?/i);
      if (m) { return splitAnswer(m[1]); }

      // 兼容“本题选择 A”一类不带答案标题的结论。
      m = s.match(/(?:本题|此题)\s*(?:应|可)?\s*(?:选|选择)\s*([A-Ga-g]{1,7})(?:项|选项)?/i);
      if (m) { return splitAnswer(m[1]); }

      if (allowLeading) {
        // 仅在允许读取裸答案时接受以标点、空白或解析标记结束的客观答案。
        m = s.match(/^([A-Ga-g]{1,7}|[1-9]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)(?=$|[\s。．.、，,；;：:]|【|\[|解析|分析)/i);
        if (m) { return splitAnswer(m[1]); }
      }

      return [];
    }

    // 按卷、章和题型分区收集答案和解析，保留同号题目在不同原文区间中的记录。
    function parseAnswerAnalysisEntries(text) {
      const lines = normalizeImportText(text).split('\n').map((x) => x.trim()).filter(Boolean);
      const entries = [];let currentVolume = '';let currentChapter = '';let currentGroup = '';let inAnswerSection = false;let currentNumber = '';let currentEntry = null;
      // 只为有效客观答案保留来源和解析，同时更新当前题号以接收续行。
      const push = (number, ans, analysis = '', raw = '', group = currentGroup, volume = currentVolume, chapter = currentChapter) => {
        const a = Array.isArray(ans) ? ans : splitAnswer(ans);
        if (!number || !a.length) { return; }

        // 答案解析区只接收客观题/判断题答案；纯数字“2、3、5”这类是解析文字，不是答案。
        const valid = a.filter((x) => /* 答案解析区只接受客观字母选项和判断符号，避免把解析里的数字列举当作答案。 */ /^[A-G]$/.test(String(x || '').toUpperCase()) || isJudgeSymbolAnswer(x));
        if (!valid.length) { return; }

        const entry = { number: String(number), volume: volume || '', chapter: chapter || '', group: group || '', answer: valid.map((x) => String(x).toUpperCase()), analysis: String(analysis || '').trim(), raw: String(raw || '') };
        entries.push(entry);currentEntry = entry;currentNumber = String(number);
      };

      const appendAnalysis = (txt) => {
        if (currentEntry && txt) { const t = String(txt || '').trim();if (t) { currentEntry.analysis = (currentEntry.analysis ? `${currentEntry.analysis}\n` : '') + t; } }
      };

      // 按明确答案标签、解析标题和紧凑字母形式的顺序识别独立编号答案行。
      const parseNumberedLine = (line, onlyStrong = false) => {
        let m;
        // 1.【答案】A【解析】... / 1.答案：A ...
        m = line.match(/^\s*(?:第\s*)?(\d{1,4})\s*(?:题)?[.、．:：]?\s*(?:【\s*(?:答案|正确答案|参考答案|标准答案)\s*】|\[\s*(?:答案|正确答案|参考答案|标准答案)\s*\]|(?:答案|正确答案|参考答案|标准答案)\s*[:：])\s*(.+)$/i);
        if (m) {
          const a = extractObjectiveAnswerFromText(m[2], true);
          if (a.length) { return { number: m[1], answer: a, analysis: m[2].replace(/* 答案已单独记录后，删除解析首部重复的字母或对错答案及分隔符。 */ /^([A-Ga-g]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)\s*[。．.、，,；;：:]?/i, '').trim(), raw: line }; }
        }

        // 1.【解析】A。... / 1.解析：A。... / 1.分析：选D...
        m = line.match(/^\s*(?:第\s*)?(\d{1,4})\s*(?:题)?[.、．:：]?\s*(?:【\s*(?:解析|答案解析|试题解析)\s*】|\[\s*(?:解析|答案解析|试题解析)\s*\]|(?:解析|答案解析|试题解析|分析)\s*[:：])\s*(.+)$/i);
        if (m) {
          const a = extractObjectiveAnswerFromText(m[2], true);
          if (a.length) { return { number: m[1], answer: a, analysis: m[2], raw: line }; }
        }

        // 1.A.【解析】... / 1.A 解析... / 16.B352
        m = line.match(/^\s*(?:第\s*)?(\d{1,4})\s*(?:题)?[.、．:：]\s*([A-Ga-g]{1,7})(?=$|[\s。．.、，,；;：:]|【|\[|解析|分析|\d)/i);
        if (m) {
          const rest = line.slice(m[0].length).trim();
          return { number: m[1], answer: splitAnswer(m[2]), analysis: rest, raw: line };
        }

        if (onlyStrong) { return null; }

        return null;
      };

      for (let i = 0;i < lines.length;i += 1) {
        const line = lines[i];const next = lines.slice(i + 1, i + 8);
        if (isAnswerSectionHeading(line, next)) {
          inAnswerSection = true;currentEntry = null;currentNumber = '';if (/* 全局解析标题开启新的答案区，应清掉上一卷或上一分区的归属。 */ /解析|答案及解析|答案与解析|试题解析|真题答案/.test(line)) { currentVolume = '';currentChapter = '';currentGroup = ''; }

          continue;
        }

        if (isVolumeHeading(line)) { currentVolume = getVolumeLabel(line);currentChapter = '';currentGroup = '';currentEntry = null;currentNumber = '';continue; }

        if (isChapterHeadingV58911(line, next)) { currentChapter = line;currentGroup = '';currentEntry = null;currentNumber = '';continue; }

        if (inAnswerSection && isGenericQuestionSectionHeading(line, next)) { currentEntry = null;currentNumber = '';currentGroup = line;continue; }

        if (isGenericQuestionSectionHeading(line, next)) { currentGroup = line;currentNumber = '';currentEntry = null;continue; }

        const heading = getHeadingType(line);
        if (heading) { currentGroup = heading;currentEntry = null;currentNumber = '';continue; }

        // 优先处理紧凑答案表：1【答案】D 2【答案】D 3【答案】B ...
        if ((inAnswerSection || /\d{1,4}\s*(?:题)?\s*【\s*(?:答案|正确答案|参考答案|标准答案)\s*】/.test(line)) && (line.match(/* 即便正文没有独立答案标题，只要单行明确出现带编号的答案标签也可识别紧凑答案表。 */ /【\s*(?:答案|正确答案|参考答案|标准答案)\s*】/g) || []).length >= 2) {
          // 将紧凑答案表中的题号、答案字母或判断符号按原顺序拆为独立条目。
          const compactAnswerRe = /(?:第\s*)?(\d{1,4})\s*(?:题)?\s*(?:[.、．:：])?\s*【\s*(?:答案|正确答案|参考答案|标准答案)\s*】\s*([A-Ga-g]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)/gi;
          const compactHits = [];let cm;
          while ((cm = compactAnswerRe.exec(line))) { compactHits.push({ number: cm[1], ans: cm[2], index: cm.index }); }

          if (compactHits.length >= 2) {
            compactHits.forEach((h, idx) => {
              const end = idx + 1 < compactHits.length ? compactHits[idx + 1].index : line.length;
              push(h.number, h.ans, line.slice(h.index, end), line.slice(h.index, end));
            });

            continue;
          }
        }

        const numbered = parseNumberedLine(line, !inAnswerSection);
        if (numbered) {
          push(numbered.number, numbered.answer, numbered.analysis, numbered.raw);
          continue;
        }

        // 紧凑答案表：1【答案】D 2【答案】D 3【答案】B ...
        if (inAnswerSection || /\d{1,4}\s*(?:题)?\s*【\s*(?:答案|正确答案|参考答案|标准答案)\s*】/.test(line)) {
          // 兼容紧凑答案表作为编号解释的回退，一个明确答案也可独立入表。
          const compactAnswerRe = /(?:第\s*)?(\d{1,4})\s*(?:题)?\s*(?:[.、．:：])?\s*【\s*(?:答案|正确答案|参考答案|标准答案)\s*】\s*([A-Ga-g]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)/gi;
          const compactHits = [];let cm;
          while ((cm = compactAnswerRe.exec(line))) { compactHits.push({ number: cm[1], ans: cm[2], index: cm.index }); }

          if (compactHits.length >= 1) {
            compactHits.forEach((h, idx) => {
              const end = idx + 1 < compactHits.length ? compactHits[idx + 1].index : line.length;
              push(h.number, h.ans, line.slice(h.index, end), line.slice(h.index, end));
            });

            continue;
          }
        }

        // 答案区里的一行多个短答案：1.A 2.B 3.C（不接收数字答案，避免“2、3、5”解析文字误拆）
        if (inAnswerSection) {
          // 在答案区拆分一行多个带题号的短答案，不接收纯数字列表。
          const pairRe = /(?:第\s*)?(\d{1,4})\s*(?:题)?[.、．:：]\s*(?:【\s*(?:答案|正确答案|参考答案|标准答案|解析|答案解析|试题解析)\s*】\s*)?(?:答案|正确答案|参考答案|标准答案|解析|分析)?\s*[:：]?\s*(?:选\s*)?([A-Ga-g]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)(?=\s|$|[。．.、，,；;：:]|【|\[|\d{1,4}\s*[.、．:：])/gi;
          const hits = [];let m;
          while ((m = pairRe.exec(line))) { hits.push({ number: m[1], ans: m[2], index: m.index }); }

          if (hits.length >= 2) {
            hits.forEach((h, idx) => {
              const end = idx + 1 < hits.length ? hits[idx + 1].index : line.length;
              push(h.number, h.ans, line.slice(h.index, end), line.slice(h.index, end));
            });

            continue;
          }
        }

        // 记录普通题号，供紧随其后的“分析：选D / 答：选C”回填。
        const qNo = line.match(/^\s*(?:第\s*)?(\d{1,4})\s*(?:题)?[.、．:：]\s*\S+/) || line.match(/* 兼容另起一行的括号题号，为随后的分析或答案保留题号上下文。 */ /^\s*[【[]\s*(\d{1,4})\s*[】\]]\s*\S+/);
        // 已出现明显答案标记的行应交给答案解析，而不是覆盖当前题号。
        const lineIsAnswerish = isAnswerAnalysisEntryLine(line) || /【\s*(?:答案|解析)\s*】|(?:答案|正确答案|参考答案|标准答案|解析|分析|答)\s*[:：]|故(?:答案)?选|本题(?:答案)?(?:为|选)|因此.*(?:答案|选)|所以.*选/.test(line);
        if (qNo && !lineIsAnswerish) { currentNumber = qNo[1];currentEntry = null; }

        // 无题号但当前题块下的“分析：选D / 答：选C / 故答案选B”。只在答案区或刚读到题号后生效。
        if ((inAnswerSection || currentNumber) && /^(?:分析|解析|答|答案|详解|说明|思路|解题思路)\s*[:：]|故(?:答案)?选|故选择|因此|所以|本题/.test(line)) {
          const a = extractObjectiveAnswerFromText(line, false);
          if (a.length) { push(currentNumber, a, line, line);continue; }

          appendAnalysis(line);continue;
        }

        if (inAnswerSection && currentEntry && !isAnswerAnalysisEntryLine(line) && !hasStrongQuestionNo(line)) { appendAnalysis(line); }
      }

      // 去重：相同题号按出现顺序保留；如果答案相同则合并解析。重复题号可能属于不同分区，不能全局合并掉。
      const out = [];
      entries.forEach(/* 仅合并相邻且归属、题号和答案均一致的重复条目，保留跨分区同号题。 */ (e) => {
        const last = out[out.length - 1];
        if (last && last.number === e.number && normalizeSectionLabelV58911(last.volume) === normalizeSectionLabelV58911(e.volume) && normalizeSectionLabelV58911(last.chapter) === normalizeSectionLabelV58911(e.chapter) && normalizeSectionLabelV58911(last.group) === normalizeSectionLabelV58911(e.group) && (last.answer || []).join('') === (e.answer || []).join('')) {
          if (e.analysis && !last.analysis.includes(e.analysis)) { last.analysis += (last.analysis ? '\n' : '') + e.analysis; }
        } else { out.push(e); }
      });

      return out;
    }

    // 在题干解析前过滤答案区内容，同时保留真正的题型与分区边界。
    function stripAnswerAnalysisTextForQuestions(text) {
      const lines = normalizeImportText(text).split('\n').map((x) => x.trim()).filter(Boolean);
      const out = [];let inAnswerSection = false;
      for (let i = 0;i < lines.length;i += 1) {
        const line = lines[i];const next = lines.slice(i + 1, i + 7);
        if (isAnswerSectionHeading(line, next)) { inAnswerSection = true;continue; }

        if (inAnswerSection && isGenericQuestionSectionHeading(line, next)) { inAnswerSection = false;out.push(line);continue; }

        if (inAnswerSection) { continue; }

        if (isAnswerAnalysisEntryLine(line)) { continue; }

        // 过滤答案区以解析标题和选项字母开头的结论行。
        if (/^(?:分析|解析|答|答案|详解|说明|思路|解题思路)\s*[:：]\s*(?:选\s*)?[A-Ga-g]/.test(line)) { continue; }

        // 过滤明确以推导结论开头的答案提示，避免混入题干。
        if (/^(?:故|因此|所以|故而|因而)\s*(?:本题)?\s*(?:正确)?答案/.test(line)) { continue; }

        out.push(line);
      }

      return out.join('\n');
    }

    // 根据题号、所属分区和答案类型匹配已提取的答案，保留原有答案和可追溯的解析。
    function mergeAnswerAnalysisEntries(questions, entries) {
      const qs = (questions || []).map((q, i) => ({ ...q, answer: [...(q.answer || [])], analysis: q.analysis || '', number: q.number || i + 1 }));
      const warnings = [];let matched = 0;let cursor = 0;
      const qSec = (q) => sectionKeyFromText(q.category || q.group || '');

      const eSec = (e) => sectionKeyFromText(e.group || '');

      // 先验证候选答案与题型兼容，再进行题号和分区对应。
      const compatible = (q, e) => {
        const ans = e.answer || [];
        if (q.type === 'judge') { return ans.some((a) => isJudgeSymbolAnswer(a) || ['A', 'B'].includes(String(a).toUpperCase())); }

        if (['single', 'multiple'].includes(q.type)) { return ans.every((a) => /* 选择题的答案应只包含 A–G 字母选项。 */ /^[A-G]$/.test(String(a).toUpperCase())); }

        return true;
      };

      // 只有候选答案符合题目来源约束时才可与该题合并。
      const canUse = (q, e, strictSection = false) => {
        if (String(q.number) !== String(e.number)) { return false; }

        if (!compatible(q, e)) { return false; }

        const es = eSec(e); const qsx = qSec(q);
        if (es && qsx && es !== qsx) { return false; }

        if (strictSection && es && !qsx) { return false; }

        return true;
      };

      for (const e of (entries || [])) {
        const es = eSec(e);
        let idx = -1;
        // 1) 优先在当前位置之后找“题号 + 分区”都匹配的题。
        for (let i = cursor;i < qs.length;i += 1) {
          if (canUse(qs[i], e, true)) { idx = i;break; }
        }

        // 2) 再允许全局同分区未答题匹配。
        if (idx < 0) {
          for (let i = 0;i < qs.length;i += 1) {
            if (!qs[i].answer.length && canUse(qs[i], e, true)) { idx = i;break; }
          }
        }

        // 3) 没有分区信息时，才按旧的顺序题号匹配。
        if (idx < 0 && !es) {
          for (let i = cursor;i < qs.length;i += 1) { if (canUse(qs[i], e, false)) { idx = i;break; } }

          if (idx < 0) { for (let i = 0;i < qs.length;i += 1) { if (!qs[i].answer.length && canUse(qs[i], e, false)) { idx = i;break; } } }
        }

        // 4) 有明确分区但项目没有解析出对应分区题目，例如图形题只有图片，跳过，不要污染后续逻辑题。
        if (idx < 0) { continue; }

        // eslint-disable-next-line prefer-template -- 外部值可能是对象，保留 + 的默认转换；输入类型受约束后移除此例外。
        const mergedImageOptionsV589 = extractInlineImageTokensV589((e.analysis || '') + ' ' + (e.raw || ''));
        if (!(qs[idx].options || []).length && mergedImageOptionsV589.length >= 2 && (e.answer || []).some((a) => /* 有可对应的字母或数字答案时，才允许将解析里的多张图片还原为选项。 */ /^[A-G1-9]$/.test(String(a || '').trim()))) {
          qs[idx].options = imageTokensToChoiceOptionsV589(mergedImageOptionsV589);
        }

        qs[idx].answer = normalizeAnswer(e.answer, qs[idx].options || [], qs[idx].type);
        let mergedAnalysisV589 = e.analysis || qs[idx].analysis || '';
        if (mergedImageOptionsV589.length >= 2) { mergedAnalysisV589 = stripAnswerPrefix(stripInlineImageTokensV589(mergedAnalysisV589)).replace(/* 图片提升为选项后，去掉只剩字母和分隔符的空解析。 */ /^[A-G]{1,7}[。．.、，,；;：:\s]*$/i, '').trim(); }

        qs[idx].analysis = formatAnswerAnalysisForReview(qs[idx].answer, mergedAnalysisV589);
        cursor = idx + 1;matched += 1;
      }

      if (entries.length && !matched) { warnings.push('检测到答案解析区，但未能按题号合并答案。'); }

      return { questions: qs.map((q, i) => normalizeQuestion(q, i)), warnings, matched };
    }

    // 比较多种去除答案区后的题干候选，再合并独立答案和解析，选择风险最低的结果。
    function parseDocumentWithAnswerSections(text) {
      if (!hasAnswerAnalysisSignal(text)) { return []; }

      const qText = stripAnswerAnalysisTextForQuestions(text);
      const entries = parseAnswerAnalysisEntries(text);
      if (!entries.length) { return []; }

      const qCandidates = [];
      // 收集成功且含题目的候选，单个策略失败时保留其他候选供比较。
      const push = (name, fn) => {
        try {
          const qs = fn().map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
          if (qs.length) { qCandidates.push({ name, questions: qs, score: scoreParsedQuestions(qs, {}) }); }
        } catch (err) { warnDev(`题目区候选解析失败：${name}`, err); }
      };

      push('题目区标准试卷段落解析', () => parseStructuredExamText(qText));

      push('题目区标准逐行解析', () => parseTextQuestionsBase(qText));

      push('题目区紧凑解析', () => parseTextQuestionsBase(forceSplitCompactText(qText)));

      const mergedCandidates = qCandidates.map(/* 为每个候选合并答案并计算警告、缺答和题干污染，供选择时比较。 */ (c) => {
        const merged = mergeAnswerAnalysisEntries(c.questions, entries);
        const qs = merged.questions || [];
        const warnings = collectImportWarnings(qs);
        const answered = qs.filter((q) => (q.answer || []).length).length;
        const missing = warnings.filter((w) => /* 将缺答单独计数，让选中的候选尽量匹配到可用的原始答案。 */ /缺少答案|缺少参考答案/.test(w)).length;
        const hard = warnings.length - missing;
        const polluted = qs.filter((q) => /* 含独立答案标题的题干视为候选的边界污染。 */ /【\s*(?:答案|解析)\s*】|答案解析|正确答案|参考答案/.test(q.question || '')).length;
        // 这里不能只看题量。标准段落解析在 2014 这类“每区后置答案”文本中
        // 可能少识别一两个图片题/材料引导块，但题号、分区、答案匹配最稳。
        const score = ((answered * 120) - (missing * 90) - (hard * 140) - (polluted * 250)) + (Math.min(qs.length, answered) * 5);
        return { ...c, questions: qs, warnings, answered, score };
      }).filter((c) => c.questions && c.questions.length);

      mergedCandidates.sort((a, b) => b.score - a.score || b.answered - a.answered || a.warnings.length - b.warnings.length || b.questions.length - a.questions.length);

      const best = mergedCandidates[0];
      if (!best) { return []; }

      return best.questions;
    }

    // 结合题量、可用答案和正文污染为分区解析候选计分。
    function scoreAnswerSectionCandidate(qs, profile) {
      const arr = qs || [];
      let score = scoreParsedQuestions(arr, profile || {});
      const answered = arr.filter((q) => (q.answer || []).length).length;
      const answerRate = arr.length ? answered / arr.length : 0;
      const polluted = arr.filter((q) => /* 统计仍在题干中出现答案解析标题的题目。 */ /【\s*(?:答案|解析)\s*】|答案解析|正确答案|参考答案/.test(q.question || '')).length;
      const warnings = collectImportWarnings(arr);
      const hard = warnings.filter((w) => !/* 可待用户核对的缺答与单个多选答案不计入硬错误。 */ /缺少答案|缺少参考答案|多选题只有一个答案/.test(w)).length;
      score += answered * 80;
      if (answerRate >= 0.5) { score += 600; }

      if (answerRate >= 0.75) { score += 800; }

      score -= polluted * 250;
      score -= hard * 90;
      if (profile && profile.expectedByHeadings) { score -= Math.min(400, Math.abs(arr.length - profile.expectedByHeadings) * 12); }

      return score;
    }

    // 用稳定编号暂存 Word 内嵌图片，并提供还原函数，避免图片编码干扰题号与选项识别。
    function protectDocxImageMarkdownForParser(text) {
      const images = [];
      const s = String(text || '').replace(/* 只暂存完整的内嵌 Markdown 图片，并保留其图片类型和原始地址。 */ /!\[[^\]]{0,80}\]\((data:image\/(?:png|jpeg|jpg|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/=]+)\)/g, (m) => {
        const id = images.length + 1;images.push(m);return `\n[[DOCX_IMAGE_${id}]]\n`;
      });
      return { text: s, images, restore: (x) => String(x || '').replace(/* 按一基编号恢复原图片；超出当前记录范围的占位符保持原样。 */ /\[\[DOCX_IMAGE_(\d+)\]\]/g, (m, n) => images[Number(n) - 1] || m) };
    }

    // 在招聘题专项切块前归整 Word 行边界、粘连分区、拆开的题号和图片位置。
    function normalizeRecruitmentExamTextForParser(text) {
      let s = String(text || '');
      s = s.replace(/* 将旧式回车作为招聘题原文的换行。 */ /\r/g, '\n').replace(/* 将不换行空格和全角空格换成普通分隔空格。 */ /[\u00a0\u3000]+/g, ' ');
      // 为粘在上一行末尾的“第 N 部分”补分区换行，保留前文。
      s = s.replace(/([。！？?；;）)\]】]|\S)(第[一二三四五六七八九十0-9]+部分\s*[^\n]{0,40})/g, '$1\n$2');
      // 兼容用中文章号和行测模块名标记的粘连分区。
      s = s.replace(/([。！？?；;）)\]】]|\S)([一二三四五六七八九十]+[、.．:：]\s*(?:言语|语言|数学|数量|图形|逻辑|判断推理|资料分析|材料分析)[^\n]{0,40})/g, '$1\n$2');
      // 合并被 Word 排版空格拆开的两位题号，限于行首且后跟题号标点。
      s = s.replace(/(^|\n)\s*(\d)\s+(\d)([.．、])/g, '$1$2$3$4');
      // 当编号后提供题干或图片证据时，为同行中粘连的下一题恢复换行。
      s = s.replace(/([^\n\d])((?:\d{1,3}|[【[]\s*\d{1,3}\s*[】\]])\s*[.．、]?\s*(?=(?:从所给|根据|有着|市场|所谓|每个|某|甲|乙|超市|草地|连接|左边|下列|海洋|有医学|在一次|以下|我国|截至|如按|2010年|2011年|[\u4e00-\u9fa5]|!|\[\[DOCX_IMAGE_)))/g, '$1\n$2');
      // 让图片占位符有清晰行边界，区分题干材料和独立选项。
      s = s.replace(/(\[\[DOCX_IMAGE_\d+\]\])/g, '\n$1\n');
      return s.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    }

    function getRecruitmentSectionHeading(line) {
      const raw = String(line || '').trim();const s = raw.replace(/* 忽略标题内部的排版空白，匹配成功时仍返回未压缩的原始标题。 */ /\s+/g, '');
      if (/* 要求分区有“第 N 部分”或中文序号前缀。 */ /^(?:第[一二三四五六七八九十0-9]+部分|[一二三四五六七八九十]+[、.．:：])/.test(s) && /* 具备行测模块关键词才接受分区，排除带中文序号的普通行。 */ /(?:言语|语言|数学|数量|图形|逻辑|判断推理|资料分析|材料分析)/.test(s)) { return raw; }

      return '';
    }

    function protectAnswerAnalysisForQuestionPart(text) {
      let s = String(text || '');
      // 用统一哨兵标记独立成行的答案小节，后续可截断题干。
      s = s.replace(/\n\s*(答案解析|答案及解析|答案与解析|参考答案|正确答案)\s*\n/g, '\n<<ANSWER_SECTION>>\n');
      return s;
    }

    // 从连续题号之间的间隙寻找共享材料，保留表格或带资料分析证据的尾段。
    function extractRecruitmentMaterialFromGap(gap) {
      const s = String(gap || '').split('<<ANSWER_SECTION>>')[0].trim();
      if (!s) { return ''; }

      // 资料/材料分析题的材料通常出现在上一题结束后、下一题题号前。
      // 不能把整段 gap 当材料，否则会把上一题题干粘到 6-10 / 11-15 等题目前面。
      const re = /(?:[一二三四五六七八九十]+[、.．:：]\s*)?根据(?:下列|以下|资料)[\s\S]{0,80}?回答\s*\d{1,3}\s*(?:[~～\-—至到]|～)\s*\d{1,3}\s*题[。.]?/g;
      let last = null; let m;
      while ((m = re.exec(s))) { last = { idx: m.index }; }

      if (last) { return s.slice(last.idx).trim(); }

      // 兼容“表1/表2 + 图片/表格”材料块。
      const tableIdx = Math.max(s.lastIndexOf('表 1'), s.lastIndexOf('表1'), s.lastIndexOf('2010 年'), s.lastIndexOf('2011 年'));
      // 只有表格后仍有指标、增长率等资料词语时，才把该段当作共享资料。
      if (tableIdx > 0 && /(?:资料分析|材料分析|指标|收入|增长|进出口|产业结构|市场|用户|投资|利润|表\s*\d)/.test(s.slice(tableIdx))) { return s.slice(tableIdx).trim(); }

      return '';
    }

    // 按招聘题紧凑答案表的常见排版提取题号、选项答案和附带解析。
    function extractRecruitmentAnswerMap(text) {
      const map = {};const analysis = {};const s = String(text || '').replace(/* 压缩段内连续空白，兼容答案项在文档中被软换行。 */ /\s+/g, ' ');
      const put = (inputN, inputA, tail = '') => {
        let n = inputN;
        let a = inputA;n = Number(n);a = String(a || '').trim().toUpperCase();if (n && /* 仅把合法 A–G 短序列写入答案映射，正文留给解析。 */ /^[A-G]{1,7}$/.test(a)) { map[n] = a.split(''); if (tail) { analysis[n] = String(tail || '').trim(); } }
      };

      let m;
      const patterns = [
        /* 有标点的编号后跟单个选项并紧接下一个数字，兼容紧凑串排。 */ /(\d{1,3})\s*[.．、]\s*([A-G])\s*(?=\d|\s*\d)/gi,
        /* 选项直接连着中文解析时，以中文开头确认单字母答案结束。 */ /(\d{1,3})\s*[.．、]?\s*([A-G])(?=[\u4e00-\u9fa5])/gi,
        /* 选项后的空白及中文或罗马数字可界定解析开始。 */ /(\d{1,3})\s*[.．、]?\s*([A-G])\s+(?=[\u4e00-\u9fa5ⅠⅡⅢⅣIVX])/gi,
        /* 选项组以“解析”标识或标点后的中文正文为边界。 */ /(\d{1,3})\s*[.．、]?\s*([A-G]{1,7})\s*(?=[.．、。\s]*[【[]?\s*(?:解析|答案解析|试题解析)|[.．、。]\s*[\u4e00-\u9fa5])/gi,
        /* 有明确括号解析标题时，同时收集其选项答案和一小段解释正文。 */ /(\d{1,3})\s*[.．、]\s*[【[]\s*(?:解析|答案解析|试题解析)\s*[】\]]\s*([A-G]{1,7})([^\d]{0,180})/gi,
        /* 带括号答案标题的编号项可携带明确的答案和解释尾部。 */ /(\d{1,3})\s*[.．、]?\s*[【[]\s*(?:答案|正确答案|参考答案|标准答案)\s*[】\]]\s*[:：]?\s*([A-G]{1,7})([^\d]{0,180})/gi,
        /* 兼容同一答案标题省略括号而以冒号引出正文的形式。 */ /(\d{1,3})\s*[.．、]?\s*(?:答案|正确答案|参考答案|标准答案)\s*[:：]?\s*([A-G]{1,7})([^\d]{0,180})/gi,
        /* 编号和字母没有标题时，要求随后出现解析、结论提示或行尾。 */ /(\d{1,3})\s*[.．、]\s*([A-G]{1,7})\s*(?=(?:[【[]\s*解析|解析|分析|故|本题|选|$))/gi,
        /* 直接兼容“题号【答案】字母”形式。 */ /(\d{1,3})\s*【\s*答案\s*】\s*([A-G]{1,7})/gi,
        /* 最后的紧凑回退要求下一个可识别的编号答案对或文本结束。 */ /(\d{1,3})\s*[.．、]?\s*([A-G])\s*(?=(?:\d{1,3}\s*[.．、]?\s*[A-G]|$))/gi,
      ];
      patterns.forEach((re) => {
        while ((m = re.exec(s))) { put(m[1], m[2], m[3] || ''); }
      });

      return { answerMap: map, analysisMap: analysis };
    }

    // 找出分行后的候选题号，排除答案或解析小节中复用的编号。
    function splitRecruitmentQuestionStarts(text) {
      const s = String(text || '');const re = /* 只从行首识别独立括号题号或带题号标点的数字。 */ /(^|\n)\s*(?:[【[]\s*(\d{1,3})\s*[】\]]|(\d{1,3})\s*[.．、])\s*/g;const hits = [];let m;
      while ((m = re.exec(s))) {
        const n = Number(m[2] || m[3]);if (!n) { continue; }

        const idx = m.index + (m[1] ? m[1].length : 0);
        const after = s.slice(re.lastIndex, re.lastIndex + 30);
        // 答案或解析标题开头说明编号属于答案区，不能切为新题。
        if (/^\s*(?:【\s*(?:答案|解析)|答案|解析|\[\s*(?:答案|解析))/.test(after)) { continue; }

        hits.push({ idx, bodyStart: re.lastIndex, number: n });
      }

      return hits;
    }

    // 在多个 A–D 选项标签组合间挑选可信且连续的序列，避免截断题干中自然出现的字母。
    function selectRecruitmentOptionHitSequence(hits) {
      if (!hits || hits.length < 2) { return hits || []; }

      const code = (k) => String(k || 'A').toUpperCase().charCodeAt(0);

      const candidates = [];
      for (let i = 0;i < hits.length;i += 1) {
        if (String(hits[i].key).toUpperCase() !== 'A') { continue; }

        const seq = [hits[i]];let need = 66;
        for (let j = i + 1;j < hits.length && need <= 68;j += 1) {
          if (code(hits[j].key) === need) { seq.push(hits[j]);need += 1; }
        }

        const hasD = seq.some((h) => String(h.key).toUpperCase() === 'D');
        if (seq.length >= 3 || hasD) { candidates.push(seq); }
      }

      if (!candidates.length) { const aHits = hits.filter((h) => String(h.key).toUpperCase() === 'A');return aHits.length > 1 ? [aHits[aHits.length - 1]] : hits; }

      candidates.sort(/* 优先按选项顺序与覆盖范围选择符合招聘题排版的候选序列。 */ (a, b) => {
        const spanA = (a[a.length - 1].idx - a[0].idx); const spanB = (b[b.length - 1].idx - b[0].idx);
        const hasDA = a.some((h) => String(h.key).toUpperCase() === 'D') ? 1 : 0;
        const hasDB = b.some((h) => String(h.key).toUpperCase() === 'D') ? 1 : 0;
        if (hasDB - hasDA) { return hasDB - hasDA; }

        // 优先紧凑选项组，避免把题干里的“A、B、C工程队”与后面的 D 选项强行拼成一组。
        if (Math.abs(spanA - spanB) > 40) { return spanA - spanB; }

        const lenDiff = b.length - a.length;if (lenDiff) { return lenDiff; }

        return b[0].idx - a[0].idx;
      });

      return candidates[0];
    }

    // 分离招聘题题干和 A–D 选项；原文只有选项标签或图片时保留可作答的占位选项。
    function splitRecruitmentOptions(seg) {
      const s = String(seg || '').trim();
      // 只有 Word 图片占位符及可选尾部 A–D 标签时，按纯图片题处理。
      const imageOnly = /^\s*(?:\[\[DOCX_IMAGE_\d+\]\]\s*)+(?:A\s+B\s+C\s+D\s*)?$/i.test(s);
      const hits = [];let m;
      // 从适当的文字或标点边界识别 A–D 选项标签，避免误切英文单词。
      const re = /(^|\n|\s|[。？！?；;:：）)（(]|[\u4e00-\u9fa5])([A-D])\s*[.．、]\s*/g;
      while ((m = re.exec(s))) {
        const idx = m.index + m[1].length;hits.push({ idx, end: re.lastIndex, key: m[2].toUpperCase() });
      }

      const selectedHits = [...selectRecruitmentOptionHitSequence(hits)];
      hits.length = 0;hits.push(...selectedHits);
      if (!hits.length) {
        // 将行尾独立的空白分隔 A–D 识别为空选项标签列表。
        const plain = s.match(/(?:^|\n|\s)A\s+B\s+C\s+D\s*$/i);
        if (plain) { return { question: s.replace(/* 已确认末尾为标签列表后从题干排除，列表本身作为选项。 */ /A\s+B\s+C\s+D\s*$/i, '').trim(), options: ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: k })) }; }

        if (imageOnly) { return { question: s.replace(/* 纯图片题同样去除尾部空标签，保留题干图片占位。 */ /A\s+B\s+C\s+D\s*$/i, '').trim(), options: ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: k })) }; }

        return { question: s, options: [] };
      }

      const start = hits[0].idx;
      const q = s.slice(0, start).trim();
      const opts = [];
      for (let i = 0;i < hits.length;i += 1) {
        const h = hits[i]; const next = i + 1 < hits.length ? hits[i + 1].idx : s.length;
        // 剥离选项切片末尾的列表分隔符，避免把排版符号放入选项正文。
        const text = s.slice(h.end, next).trim().replace(/[;；，,]+$/, '').trim();
        opts.push({ key: h.key, text });
      }

      // OCR/文本提取偶发把 A 误成 B，形成 B/B/C/D；按出现顺序纠正为 A/B/C/D。
      const keys = opts.map((o) => o.key).join('');
      if (!keys.includes('A') && /* 只在已知 BBCD 错标且至少有四个选项时，恢复原有 A–D 顺序。 */ /^BBCD/.test(keys) && opts.length >= 4) { for (let i = 0;i < 4;i += 1) { opts[i].key = String.fromCharCode(65 + i); } }

      const de = [];const seen = {};
      for (const o of opts) {
        // 对只保留 A–D 标签的空选项填上标签，避免题目不可作答。
        if (!o.text && /^[A-D]$/.test(o.key)) { o.text = o.key; }

        if (seen[o.key]) { seen[o.key].text = (`${seen[o.key].text} ${o.text}`).trim();continue; }

        seen[o.key] = o;de.push(o);
      }

      return { question: q, options: de.filter((o) => o.text) };
    }

    // 从招聘题原文已出现的选择结论或答案标签提取答案，保持文本顺序。
    function extractInlineAnswerFromRecruitmentSegment(seg) {
      const s = String(seg || '');let m;
      // 识别“选 X”以及带简写“答”的单选结论。
      m = s.match(/(?:答\s*[:：]?\s*)?选\s*([A-G])/i);if (m) { return [m[1].toUpperCase()]; }

      // 兼容明确答案标题后紧随的一个或多个字母选项。
      m = s.match(/(?:答案|正确答案|参考答案)\s*[:：]?\s*([A-G]{1,7})/i);if (m) { return m[1].toUpperCase().split(''); }

      return [];
    }

    // 从招聘题原文拆分行内解析；题干没有可信的选项边界时保留原段。
    function splitRecruitmentInlineAnalysisV58915(seg) {
      const lines = String(seg || '').split('\n');
      let cut = -1;
      for (let i = 1;i < lines.length;i += 1) {
        // 独立行首的解析或作答标题可作为解析切分起点。
        if (/^(?:分析|解析|答|答案|详解|说明|解题思路|思路(?:一|二|三)?)\s*[:：]/.test(String(lines[i] || '').trim())) { cut = i;break; }
      }

      if (cut < 0) { return { body: String(seg || '').trim(), analysis: '' }; }

      const body = lines.slice(0, cut).join('\n').trim();
      // 只有解析前的正文仍含独立 A 选项，才接受分离后的题干。
      if (!/(?:^|\n)\s*A\s*[.．、]/i.test(body)) { return { body: String(seg || '').trim(), analysis: '' }; }

      return { body, analysis: lines.slice(cut).join('\n').trim() };
    }

    function recruitmentGroupToType(group) {
      // 明确标为多选的分区按多选题处理。
      if (/多选|多项/.test(group)) { return 'multiple'; }

      // 判断正误、是非等分区按判断题处理。
      if (/判断题|判断正误|是非/.test(group)) { return 'judge'; }

      return 'single';
    }

    // 从单道招聘题末尾去除明确属于下一段共享材料的文本。
    function stripTrailingRecruitmentNextMaterial(seg) {
      const s = String(seg || '');
      const patterns = [
        /* 剥离下一处资料分析或材料分析分区及其尾段。 */ /\n\s*(?:第[一二三四五六七八九十0-9]+部分\s*)?(?:材料分析|资料分析)[\s\S]*$/i,
        /* 剥离由“根据下列资料”等语句明确开启的新材料。 */ /\n\s*(?:[一二三四五六七八九十]+[、.．:：]\s*)?根据(?:下列|以下|资料)[\s\S]*$/i,
        /* 兼容已有招聘题资料样例中缺少通用引导词的两处表格和材料起点。 */ /\n\s*(?:表\s*1\s*2010年三大经济圈|2010年，某省广电实际总收入)[\s\S]*$/i,
      ];
      let cut = s.length;
      for (const re of patterns) {
        const m = s.match(re);
        if (m && m.index > 0) { cut = Math.min(cut, m.index); }
      }

      return s.slice(0, cut).trim();
    }

    // 当 Word 把后续选项粘入前一选项正文时按顺序恢复对应标签。
    function repairRecruitmentEmbeddedOptions(options) {
      const out = [];
      const keyCode = (k) => String(k || 'A').toUpperCase().charCodeAt(0);

      for (const opt of (options || [])) {
        const txt = String(opt.text || '').trim();
        const base = keyCode(opt.key);
        const hits = [];let m;
        // 以 A–D 加题库分隔标点寻找粘连的选项标签。
        const re = /([A-D])\s*[.．、]\s*/g;
        while ((m = re.exec(txt))) {
          const key = String(m[1]).toUpperCase();
          if (keyCode(key) <= base) { continue; }

          const idx = m.index;
          // 需要像选项标记：后面不能立即结束，且不要把普通英文缩写拆开。
          const after = txt.slice(re.lastIndex, re.lastIndex + 20);
          if (!after.trim()) { continue; }

          hits.push({ idx, end: re.lastIndex, key });
        }

        if (!hits.length) { out.push({ ...opt, text: txt });continue; }

        out.push({ ...opt, text: txt.slice(0, hits[0].idx).trim() });
        for (let i = 0;i < hits.length;i += 1) {
          const start = hits[i].end;
          const end = i + 1 < hits.length ? hits[i + 1].idx : txt.length;
          const part = txt.slice(start, end).trim();
          if (part) { out.push({ key: hits[i].key, text: part }); }
        }
      }

      return out.filter((o) => String(o.text || '').trim());
    }

    // 将误落在选项中的 Word 图片移回题干，保留可见的合法选项并移除后续分区残文。
    function moveRecruitmentOptionImagesToQuestion(inputQuestion, options) {
      let question = inputQuestion;
      const moved = [];
      const cleaned = (options || []).map(/* 逐项确认边界和图片位置，图片统一交由题干恢复阶段处理。 */ (o) => {
        let txt = String(o.text || '');
        // 移除混入选项结尾的行测分区小节和后文。
        txt = txt.replace(/(?:\n|\s)*(?:第[一二三四五六七八九十0-9]+部分\s*)?(?:语言理解与表达|言语理解与表达|数学能力|数学运算|判断推理|材料分析|资料分析)[\s\S]*$/, '').trim();
        // 移除作为下一题起点的资料文本，避免残留到前一选项。
        txt = txt.replace(/(?:\n|\s)*(?:[一二三四五六七八九十]+[、.．:：]\s*)?根据(?:下列|以下|资料)[\s\S]*$/, '').trim();
        // 去掉招聘题试卷结束提示及随后的残文。
        txt = txt.replace(/\s*全部测验到此结束[\s\S]*$/, '').trim();
        // 将 Word 图片占位符从选项收集回共享题干。
        txt = txt.replace(/\[\[DOCX_IMAGE_\d+\]\]/g, (m) => {
          moved.push(m);return ' ';
        }).replace(/* 单个选项的剩余正文只保留普通空格，消除 Word 排版多余空白。 */ /\s+/g, ' ').trim();

        return { ...o, text: txt };
      }).filter((o) => String(o.text || '').trim());
      if (moved.length) {
        const missing = moved.filter((m) => !String(question || '').includes(m));
        if (missing.length) { question = `${String(question || '').trim()}\n${missing.join('\n')}`; }
      }

      return { question, options: cleaned };
    }

    // 将专项切块还原为标准题目，修复图片与候选选项的归属，并保留分区答案和解析。
    function makeRecruitmentQuestion(seg, ctx, idx, restore) {
      let raw = String(seg || '').trim();
      const num = ctx.number || idx + 1;
      // 去掉题块首行已单独记录的括号或数字题号。
      raw = raw.replace(/^\s*(?:[【[]\s*\d{1,3}\s*[】\]]|\d{1,3}\s*[.．、])\s*/, '').trim();
      // 将只剩答案小节哨兵的片段过滤掉，避免生成空题。
      raw = raw.replace(/^<<ANSWER_SECTION>>[\s\S]*$/, '').trim();
      raw = stripTrailingRecruitmentNextMaterial(raw);
      let ans = (ctx.answer || []).map((a) => String(a).toUpperCase());
      const inline = extractInlineAnswerFromRecruitmentSegment(raw);if (!ans.length && inline.length) { ans = inline; }

      const inlineAnalysisV58915 = splitRecruitmentInlineAnalysisV58915(raw);
      // 从题干移除已提取的“选 X”提示，避免泄露答案。
      raw = inlineAnalysisV58915.body.replace(/(?:答\s*[:：]?\s*)?选\s*[A-G]\s*[，,。；;]?/ig, '').trim();
      const split = splitRecruitmentOptions(raw);
      let question = split.question || raw;
      let options = mergeDuplicateOptions(repairRecruitmentEmbeddedOptions(split.options || []));
      const movedMedia = moveRecruitmentOptionImagesToQuestion(question, options);question = movedMedia.question;options = movedMedia.options;
      if ((!/* 无实质文字的题干可进入图片选项兜底。 */ /\S/.test(question) || /* 题干含 Word 图片占位时也可进入同一路径。 */ /\[\[DOCX_IMAGE_\d+\]\]/.test(question)) && options.length < 2 && ans.some((a) => /* 至少有一个明确字母答案才补足图片题的可作答选项。 */ /^[A-G]$/.test(a))) {
        options = ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: k }));
      }

      if (options.length < 2 && /* 旧图片题原文仍保留 Word 图片占位时，可用 A–D 标签补回缺失选项。 */ /\[\[DOCX_IMAGE_\d+\]\]/.test(raw)) { options = ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: k })); }

      if (ctx.material) { question = (`${ctx.material}\n${question}`).trim(); }

      question = restore(question).trim();
      const group = ctx.group || '';
      let type = recruitmentGroupToType(group);
      if (ans.length > 1) { type = 'multiple'; }

      const q = { id: makeId('imp', idx), type, number: num, question, options, answer: ans, analysis: ctx.analysis || inlineAnalysisV58915.analysis || '', group, category: group };
      // 专用真题解析已经按明确 A-D 边界拆好选项，使用内部标记避免后续多次规范化把“A等/B等、A队/B队”等正文再次拆坏。
      attachRecruitmentOptionsV58915(q, options);
      return normalizeQuestion(q, idx);
    }

    // 按已定位的题号构造题目，让两种定位方式沿用相同的分区、共享材料和答案边界。
    function parseRecruitmentQuestionBlocks(text, starts, {
      answerMap,
      analysisMap,
      group,
      restore,
    }) {
      const questions = [];
      let currentGroup = group || '';
      // 只有资料分区携带当前共享材料，保持其他题型的独立题干。
      let currentMaterial = '';
      for (let index = 0; index < starts.length; index += 1) {
        const start = starts[index];
        const previousStart = starts[index - 1]?.idx ?? 0;
        const nextStart = starts[index + 1]?.idx ?? text.length;
        const gap = text.slice(previousStart, start.idx);
        const heading = gap.split('\n').map(getRecruitmentSectionHeading).filter(Boolean).pop();
        if (heading) {
          currentGroup = heading;
        }

        // 只有资料或材料分析分区才继承上一个共享材料块。
        const inMaterialSection = /(?:资料分析|材料分析)/.test(currentGroup);
        if (inMaterialSection) {
          // 材料分析题可以使用题块附近的共享资料；其他分区保持独立。
          const material = extractRecruitmentMaterialFromGap(gap);
          if (material) {
            currentMaterial = material;
          }
        }

        let segment = text.slice(start.idx, nextStart).trim();
        // 答案区哨兵之后不再属于当前题干。
        const answerSectionStart = segment.indexOf('<<ANSWER_SECTION>>');
        if (answerSectionStart !== -1) {
          // 截掉答案分区哨兵及其后内容，避免混入题干。
          segment = segment.slice(0, answerSectionStart).trim();
        }

        const context = {
          number: start.number,
          group: currentGroup,
          answer: answerMap[start.number] || [],
          analysis: analysisMap[start.number] || '',
          // 仅向资料分区题目传入共享材料，防止材料泄漏到其他分区。
          material: inMaterialSection ? currentMaterial : '',
        };
        const question = makeRecruitmentQuestion(segment, context, questions.length, restore);
        if (!question?.question) {
          continue;
        }

        // 允许可辨认的内嵌图片成为保留无独立选项或答案题目的证据。
        if (question.options.length || question.answer.length
          || /* 只有题干仍含内嵌图片时，才接受缺少独立选项或答案的图片题。 */ /data:image\//.test(question.question)) {
          questions.push(question);
        }
      }

      return questions.map((question, index) => normalizeQuestion(question, index));
    }

    // 按可辨认的题号切分招聘题试卷，并为资料分区中的每题绑定共享材料。
    function parseRecruitmentQuestionPart(qText, answerMap = {}, analysisMap = {}, group = '', restore = (x) => x) {
      const text = normalizeRecruitmentExamTextForParser(protectAnswerAnalysisForQuestionPart(qText));
      const starts = splitRecruitmentQuestionStarts(text);
      return parseRecruitmentQuestionBlocks(text, starts, { answerMap, analysisMap, group, restore });
    }

    // 按已有可信题号查找正文锚点，拒绝答案或解析中的同号候选。
    function findExpectedRecruitmentQuestionStarts(text, nums) {
      const starts = [];let cursor = 0;const s = String(text || '');
      for (const n of nums) {
        // 转义传入题号的正则元字符，保证按字面量定位。
        const escaped = String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // 从行首、标点或换行后匹配预计题号，兼容括号和题号标点。
        const re = new RegExp(`(^|\\n|[。？！?；;])\\s*(?:[【\\[]\\s*${escaped}\\s*[】\\]]|${escaped}\\s*[.．、])\\s*`, 'g');
        re.lastIndex = cursor;let m; let hit = null;
        while ((m = re.exec(s))) {
          const idx = m.index + (m[1] ? m[1].length : 0);const after = s.slice(re.lastIndex, re.lastIndex + 50);
          // 排除答案、解析及紧随字母选项的解析提示，保留真正题干候选。
          if (/^\\s*(?:【\\s*(?:答案|解析)|答案|解析|[A-G]\\s*[.．、]?\\s*【\\s*解析)/.test(after)) { continue; }

          hit = { idx, bodyStart: re.lastIndex, number: Number(n) };break;
        }

        if (hit) { starts.push(hit);cursor = hit.idx + 1; }
      }

      return starts;
    }

    // 按预计题号切块修复缺少标准换行的招聘题，并沿用共享材料和来源答案。
    function parseRecruitmentQuestionPartByExpectedNumbers(qText, nums, answerMap = {}, analysisMap = {}, group = '', restore = (x) => x) {
      const text = normalizeRecruitmentExamTextForParser(protectAnswerAnalysisForQuestionPart(qText));
      const starts = findExpectedRecruitmentQuestionStarts(text, nums);
      return parseRecruitmentQuestionBlocks(text, starts, { answerMap, analysisMap, group, restore });
    }

    function numberRange(a, b) {
      const arr = [];for (let i = a;i <= b;i += 1) { arr.push(i); }

      return arr;
    }

    function sliceBetweenRecruitmentHeadings(text, headingRe, nextRe) {
      const s = String(text || '');const m = s.match(headingRe);if (!m) { return ''; }

      const start = m.index;const rest = s.slice(start);const n = rest.slice(m[0].length).search(nextRe);
      return n >= 0 ? rest.slice(0, m[0].length + n) : rest;
    }

    // 按招聘试题各分区已知的首条答案形式，分离误连在题干末尾的答案区。
    function splitRecruitmentSectionQuestionAnswer(section, kind) {
      const s = String(section || '');let idx = -1;
      const patterns = {
        language: [
          // 语言分区的答案标题后可能另起一行写第 1 题解析。
          /\n\s*答案\s*\n\s*1\s*[.．、]?\s*[【[]?解析/i,
          // 同一分区也可能直接以带编号的括号解析开始。
          /\n\s*1\s*[.．、]\s*【\s*解析/i,
        ],
        math: [
          // 数学分区的答案编号可从第 6 题开始，兼容括号标题形式。
          /\n\s*6\s*[.．、]?\s*[【[]?答案/i,
          // 兼容同一首题省略括号的答案标记。
          /\n\s*6\s*[.．、]?\s*答案/i,
        ],
        figure: [
          // 图形分区可直接通过第 1 题答案标题切分。
          /\n\s*1\s*[.．、]?\s*答案/i,
          // 若缺答案标题，则保留通过第 1 题解析切分的回退。
          /\n\s*1\s*[.．、]\s*[【[]?解析/i,
        ],
        logic: [
          // 逻辑分区优先找带第 1 题编号的解析标题。
          /\n\s*1\s*[.．、]\s*[【[]?解析/i,
          // 逻辑分区缺解析标题时，以第 1 题答案标题切分。
          /\n\s*1\s*[.．、]?\s*答案/i,
        ],
        data: [
          // 资料分区可能在数字后紧接答案括号。
          /\n\s*1\s*【\s*答案\s*】/i,
          // 也接受该数字与答案括号之间带题号标点的形式。
          /\n\s*1\s*[.．、]?\s*【\s*答案\s*】/i,
        ],
      }[kind] || [];
      for (const re of patterns) { const m = s.match(re);if (m) { idx = m.index;break; } }

      if (idx < 0) { return { qText: s, aText: '' }; }

      return { qText: s.slice(0, idx), aText: s.slice(idx) };
    }

    // 按招聘考试的分区与答案表特点重建图文题，缺少足够图片题证据时放弃专项候选。
    function parseRecruitmentImagePostAnswerExam(text) {
      const protectedPack = protectDocxImageMarkdownForParser(normalizeImportText(text));
      const s = normalizeRecruitmentExamTextForParser(protectedPack.text);
      const { restore } = protectedPack;
      const hasImages = protectedPack.images.length > 0;
      // 用招聘试卷常见年份和行测分区用语判断专项策略是否值得尝试。
      const looksRecruitment = /201[45].{0,20}(?:招聘|校园招聘|笔试|综合素质能力测试)|答案解析|图形推理|判断推理|资料分析|材料分析/.test(s);
      if (!looksRecruitment && !hasImages) { return []; }

      let questions = [];
      // 2015 这类：题目区连续编号，最后统一“答案解析”。
      const ansIdx = s.search(/\n\s*(?:答案解析|答案及解析|答案与解析)\s*\n/);
      if (ansIdx > 0 && /* 整卷含统一答案区和标准分区时，先按统一答案表合并。 */ /第一部分|第二部分|第三部分|第四部分/.test(s)) {
        const qText = s.slice(0, ansIdx);const aText = s.slice(ansIdx);
        const ans = extractRecruitmentAnswerMap(aText);
        const maxNo = Math.max(0, ...Object.keys(ans.answerMap || {}).map(Number).filter(Boolean));
        const nums = maxNo >= 40 ? numberRange(1, maxNo) : [];
        questions = nums.length ? parseRecruitmentQuestionPartByExpectedNumbers(qText, nums, ans.answerMap, ans.analysisMap, '', restore) : parseRecruitmentQuestionPart(qText, ans.answerMap, ans.analysisMap, '', restore);
      } else {
        const sections = [
          { kind: 'language', group: '一、言语理解与表达', text: sliceBetweenRecruitmentHeadings(s, /* 识别言语理解分区开始。 */ /一[、.．:：]\s*言语理解与表达[:：]?/, /* 遇到数学运算标题时停止收集言语理解原文。 */ /二[、.．:：]\s*数学运算/) },
          { kind: 'math', group: '二、数学运算', text: sliceBetweenRecruitmentHeadings(s, /* 识别数学运算分区开始。 */ /二[、.．:：]\s*数学运算[:：]?/, /* 遇到图形推理标题时停止收集数学运算原文。 */ /三[、.．:：]\s*图形推理/) },
          { kind: 'figure', group: '三、图形推理', text: sliceBetweenRecruitmentHeadings(s, /* 识别图形推理分区开始。 */ /三[、.．:：]\s*图形推理[:：]?/, /* 遇到逻辑判断标题时停止收集图形推理原文。 */ /四[、.．:：]\s*逻辑判断/) },
          { kind: 'logic', group: '四、逻辑判断', text: sliceBetweenRecruitmentHeadings(s, /* 识别逻辑判断分区开始。 */ /四[、.．:：]\s*逻辑判断[:：]?/, /* 遇到资料分析标题时停止收集逻辑判断原文。 */ /五[、.．:：]\s*资料分析/) },
          { kind: 'data', group: '五、资料分析', text: sliceBetweenRecruitmentHeadings(s, /* 识别最后一个资料分析分区的起点。 */ /五[、.．:：]\s*资料分析[:：]?/, /* 最后一个分区以文本结束为边界，因此使用不会匹配的结束模式。 */ /$a/) },
        ];
        sections.forEach(/* 逐分区分离正文与答案，并按各自编号范围恢复图片题。 */ (sec) => {
          if (!sec.text) { return; }

          const parts = splitRecruitmentSectionQuestionAnswer(sec.text, sec.kind);
          const ans = extractRecruitmentAnswerMap(parts.aText);
          const expected = { language: numberRange(1, 15), math: numberRange(1, 15), figure: numberRange(1, 5), logic: numberRange(1, 20), data: numberRange(1, 15) }[sec.kind] || [];
          const qs = expected.length ? parseRecruitmentQuestionPartByExpectedNumbers(parts.qText, expected, ans.answerMap, ans.analysisMap, sec.group, restore) : parseRecruitmentQuestionPart(parts.qText, ans.answerMap, ans.analysisMap, sec.group, restore);
          questions.push(...qs);
        });
      }

      questions = questions.map((q, i) => normalizeQuestion(q, i)).filter((q) => q && q.question);

      // 只在明显优于普通解析时返回，避免误伤普通题库。
      const imgQ = questions.filter((q) => /* 统计恢复了内嵌图片的题目，作为专项解析成功证据。 */ /data:image\//.test(q.question || '')).length;
      const answered = questions.filter((q) => (q.answer || []).length).length;
      if (questions.length >= 40 && (imgQ || answered >= Math.max(20, Math.floor(questions.length * 0.55)))) { return questions; }

      return [];
    }

    // 为招聘图文策略按题量、恢复图片、已有答案和风险计分。
    function scoreRecruitmentImageCandidate(qs, profile) {
      const arr = qs || [];const img = arr.filter((q) => /* 只计入真实保留内嵌图片的题目，避免用图片占位撑高得分。 */ /data:image\//.test(q.question || '')).length;const answered = arr.filter((q) => (q.answer || []).length).length;
      let score = scoreAnswerSectionCandidate(arr, profile || {});
      score += (img * 180) + (answered * 60) + (arr.length * 20);
      const expected = (profile && profile.expectedByHeadings) || 0;if (expected) { score -= Math.min(500, Math.abs(arr.length - expected) * 20); }

      return score + 1600;
    }

    // 汇总专项候选的题量、答案和硬错误，以便与常规候选比较。
    function recruitmentFallbackStatsV58915(questions) {
      const arr = questions || [];
      const warnings = collectImportWarnings(arr);
      const hard = warnings.filter((w) => !/* 缺答和只有单个多选答案可由用户核对，不能单独否定候选。 */ /缺少答案|缺少参考答案|多选题只有一个答案/.test(w)).length;
      const answered = arr.filter((q) => (q.answer || []).length).length;
      const objective = arr.filter((q) => ['single', 'multiple', 'judge'].includes(q.type)).length;
      return { count: arr.length, answered, answerRate: arr.length ? answered / arr.length : 0, objective, hard };
    }

    function isHighConfidenceRecruitmentFallbackV58915(questions) {
      const st = recruitmentFallbackStatsV58915(questions);
      return st.count >= 40 && st.answerRate >= 0.9 && st.objective >= Math.floor(st.count * 0.9) && st.hard <= Math.max(1, Math.floor(st.count * 0.01));
    }

    // 只有专项候选在题量和风险上提供明显改善时，才允许取代常规解析。
    function recruitmentFallbackClearlyBetterV58915(fallbackQuestions, mainlineQuestions) {
      if (!isHighConfidenceRecruitmentFallbackV58915(fallbackQuestions)) { return false; }

      const next = recruitmentFallbackStatsV58915(fallbackQuestions);
      const current = recruitmentFallbackStatsV58915(mainlineQuestions);
      const answerGain = next.answered - current.answered;
      if (answerGain >= Math.max(5, Math.ceil(next.count * 0.08))) { return true; }

      if (current.hard - next.hard >= 3) { return true; }

      return next.count < current.count && next.answered === next.count && current.hard > next.hard && (current.count - next.count) <= Math.ceil(next.count * 0.25);
    }

    // 合并 Word 表格材料与被错误分成下一题的短提示，避免重复生成无意义的题目。
    function repairDocxTablePromptSplitQuestions(questions) {
      const src = (questions || []).map((q) => ({ ...q, options: [...(q.options || [])], answer: [...(q.answer || [])] }));
      const out = [];
      for (let i = 0;i < src.length;i += 1) {
        const q = src[i];
        const next = src[i + 1];
        // 以 Word 表格起始标记识别可能缺少后续提问的材料题。
        const hasDocxTable = /【DOCX表格开始】/.test(String(q.question || ''));
        const weakOptions = (q.options || []).length < 2;
        const nextHasOptions = next && (next.options || []).length >= 2;
        const nextLooksPrompt = next && !/* 短提示若自身也有表格，则更像独立题目而不是上一材料的续行。 */ /【DOCX表格开始】/.test(String(next.question || '')) && String(next.question || '').length <= 180;
        if (hasDocxTable && weakOptions && nextHasOptions && nextLooksPrompt) {
          const merged = { ...q };
          merged.question = [q.question, next.question].map((x) => String(x || '').trim()).filter(Boolean).join('\n');

          merged.options = [...(next.options || [])];
          if (!(merged.answer || []).length && (next.answer || []).length) { merged.answer = [...(next.answer || [])]; }

          if (!merged.analysis && next.analysis) { merged.analysis = next.analysis; }

          out.push(merged);
          i += 1;
          continue;
        }

        out.push(q);
      }

      return out;
    }

    /* SHIROHA_WEB_V58_9_9_STANDARD_MAINLINE_LOCAL_REPAIR_GUARD */
    function standardHardLimitV599(count) {
      const n = Math.max(0, Number(count) || 0);
      if (n <= 20) { return 0; }

      if (n <= 100) { return 1; }

      return Math.max(1, Math.ceil(n * 0.015));
    }

    // 标记缺失、越界或疑似属于其他题型的答案，供有来源证据时局部修复。
    function answerNeedsLocalRepairV599(q) {
      const ans = (q?.answer || []).map((x) => String(x || '').trim().toUpperCase()).filter(Boolean);
      if (!ans.length) { return true; }

      if (q?.type === 'judge') { return ans.some((a) => !['A', 'B'].includes(a)); }

      if (['single', 'multiple'].includes(q?.type)) {
        const keys = new Set((q.options || []).map((o) => String(o.key || '').trim().toUpperCase()).filter(Boolean));
        if (!keys.size) { return true; }

        return ans.some((a) => !keys.has(a));
      }

      return false;
    }

    // 检查提取答案能否用于当前题型和已有选项，避免合并无对应选项的答案。
    function answerCompatibleWithQuestionV599(q, answer, options = q?.options || []) {
      const ans = (answer || []).map((x) => String(x || '').trim().toUpperCase()).filter(Boolean);
      if (!ans.length) { return false; }

      if (q?.type === 'judge') { return ans.every((a) => ['A', 'B'].includes(a)); }

      if (['single', 'multiple'].includes(q?.type)) {
        const keys = new Set((options || []).map((o) => String(o.key || '').trim().toUpperCase()).filter(Boolean));
        return keys.size > 0 && ans.every((a) => keys.has(a));
      }

      return true;
    }

    // 按卷、章、分组和编号确定答案匹配优先级，对重复题号使用更严格的来源证据。
    function answerEntryMatchRankV58911(q, entry, questionIndex, entryIndex, numberMultiplicity) {
      if (String(q?.number) !== String(entry?.number) || !answerCompatibleWithQuestionV599(q, entry?.answer || [], q?.options || [])) { return -Infinity; }

      const qp = sectionPartsForQuestionV58911(q); const ep = sectionPartsForAnswerEntryV58911(entry);
      let rank = 0; let explicitMatches = 0;
      for (const key of ['volume', 'chapter']) {
        if (qp[key] && ep[key]) {
          if (qp[key] !== ep[key]) { return -Infinity; }

          rank += key === 'chapter' ? 180 : 140;explicitMatches += 1;
        }
      }

      if (qp.group && ep.group) {
        if (qp.group === ep.group) { rank += 90;explicitMatches += 1; } else if (qp.groupType && ep.groupType && qp.groupType === ep.groupType) { rank += 55;explicitMatches += 1; } else { return -Infinity; }
      } else if (qp.groupType && ep.groupType) {
        if (qp.groupType !== ep.groupType) { return -Infinity; }

        rank += 40;explicitMatches += 1;
      }

      const qHasSection = !!(qp.volume || qp.chapter || qp.group || qp.groupType);
      const eHasSection = !!(ep.volume || ep.chapter || ep.group || ep.groupType);
      if (numberMultiplicity > 1 && explicitMatches === 0 && (qHasSection || eHasSection)) { return -Infinity; }

      if (numberMultiplicity > 1 && explicitMatches === 0) { return -Infinity; }

      if (numberMultiplicity <= 1) { rank += Math.max(0, 20 - Math.abs(questionIndex - entryIndex)); }

      return rank;
    }

    // 在保留标准题目顺序和题干的前提下补齐独立答案，只接收具有可靠来源的条目。
    function mergeAnswerEntriesOntoLockedMainlineV599(questions, entries) {
      const base = (questions || []).map((q, i) => normalizeQuestion(q, i));
      const answerEntries = (entries || []).map((e) => ({ ...e, answer: [...(e.answer || [])] }));
      if (!base.length || !answerEntries.length) { return { questions: base, changed: 0, segments: [] }; }

      const entryCountByNumber = new Map(); const questionCountByNumber = new Map();
      answerEntries.forEach((e) => entryCountByNumber.set(String(e.number), (entryCountByNumber.get(String(e.number)) || 0) + 1));

      base.forEach((q) => questionCountByNumber.set(String(q.number), (questionCountByNumber.get(String(q.number)) || 0) + 1));

      const used = new Set();let changed = 0;const segments = [];
      const out = base.map(/* 逐题先锁定同一来源的候选，再核对已有答案和匹配规则，逐条消费已使用答案。 */ (q, i) => {
        if (!answerNeedsLocalRepairV599(q)) { return q; }

        const number = String(q.number); const multiplicity = Math.max(entryCountByNumber.get(number) || 0, questionCountByNumber.get(number) || 0);
        const qp = sectionPartsForQuestionV58911(q);
        const sameNumberEntries = answerEntries.filter((entry, ei) => !used.has(ei) && String(entry.number) === number);
        const sameNumberQuestions = base.filter((item) => String(item.number) === number);
        const strongSections = new Set(sameNumberEntries.map((entry) => {
          const ep = sectionPartsForAnswerEntryV58911(entry);return [ep.volume, ep.chapter].filter(Boolean).join('|');
        }).filter(Boolean));
        if (strongSections.size > 1 && !qp.volume && !qp.chapter) { return q; }

        if ((questionCountByNumber.get(number) || 0) > 1) {
          if (qp.volume || qp.chapter) {
            const hasStrongMatch = sameNumberEntries.some((entry) => {
              const ep = sectionPartsForAnswerEntryV58911(entry);return (!qp.volume || ep.volume === qp.volume) && (!qp.chapter || ep.chapter === qp.chapter) && (ep.volume || ep.chapter);
            });
            if (!hasStrongMatch) { return q; }
          } else {
            const groupKeys = new Set(sameNumberQuestions.map((item) => {
              const part = sectionPartsForQuestionV58911(item);return part.group || part.groupType;
            }).filter(Boolean));
            if (groupKeys.size <= 1) { return q; }
          }
        }

        const ranked = [];
        answerEntries.forEach((entry, ei) => {
          if (used.has(ei)) { return; }

          const rank = answerEntryMatchRankV58911(q, entry, i, ei, multiplicity);
          if (Number.isFinite(rank)) { ranked.push({ entry, ei, rank }); }
        });

        ranked.sort((a, b) => b.rank - a.rank || a.ei - b.ei);

        if (!ranked.length) { return q; }

        if (ranked.length > 1 && ranked[0].rank === ranked[1].rank) { return q; }

        const hit = ranked[0];
        let options = [...(q.options || [])];
        // eslint-disable-next-line prefer-template -- 外部值可能是对象，保留 + 的默认转换；输入类型受约束后移除此例外。
        const imageOptions = extractInlineImageTokensV589((hit.entry.analysis || '') + ' ' + (hit.entry.raw || ''));
        if (options.length < 2 && imageOptions.length >= 2) { options = imageTokensToChoiceOptionsV589(imageOptions); }

        const answer = normalizeAnswer(hit.entry.answer || [], options, q.type);
        if (!answerCompatibleWithQuestionV599(q, answer, options)) { return q; }

        used.add(hit.ei);changed += 1;
        const section = [hit.entry.volume, hit.entry.chapter, hit.entry.group].filter(Boolean).join(' / ');
        segments.push(`第${i + 1}题：按${section ? '分区 + ' : ''}原始题号回填答案${options.length > (q.options || []).length ? '与缺失选项' : ''}`);
        let analysis = hit.entry.analysis || q.analysis || '';
        if (imageOptions.length >= 2) { analysis = stripAnswerPrefix(stripInlineImageTokensV589(analysis)).replace(/* 图片移入选项时去掉解析里只剩字母和间隔符的残文。 */ /^[A-G]{1,7}[。．.、，,；;：:\s]*$/i, '').trim(); }

        return normalizeQuestion({ ...q, options, answer, analysis: formatAnswerAnalysisForReview(answer, analysis) }, i);
      });
      return { questions: out, changed, segments };
    }

    // 确认证据来自同一题目序列，避免将图形专项候选按错误位置拼回主结果。
    function lockedSequenceAlignedV599(base, candidate) {
      if (!base.length || base.length !== candidate.length) { return false; }

      let textMatched = 0;
      for (let i = 0;i < base.length;i += 1) {
        if (String(base[i].number) !== String(candidate[i].number)) { return false; }

        const a = normalizeText(stripInlineImageTokensV589(base[i].question || ''));
        const b = normalizeText(stripInlineImageTokensV589(candidate[i].question || ''));
        if (!a || !b) { continue; }

        const ah = a.slice(0, 24); const bh = b.slice(0, 24);
        if (a.includes(bh) || b.includes(ah)) { textMatched += 1; }
      }

      return textMatched >= Math.max(1, Math.ceil(base.length * 0.7));
    }

    // 用专项图文候选补充主结果的图片和选项，同时锁住可以确认的正文和答案。
    function mergeImageCandidateOntoLockedMainlineV599(questions, imageQuestions, profile) {
      const base = (questions || []).map((q, i) => normalizeQuestion(q, i));
      const candidate = (imageQuestions || []).map((q, i) => normalizeQuestion(q, i));
      if (!lockedSequenceAlignedV599(base, candidate)) { return { questions: base, changed: 0, segments: [] }; }

      let changed = 0;const segments = [];
      const out = base.map(/* 逐题检查文本与选项兼容性，只有确实改善答案或图文信息时才采用候选。 */ (q, i) => {
        const cq = candidate[i];
        const beforeRisk = localRepairRiskStatus(q, profile);
        const baseImages = extractInlineImageTokensV589(q.question || '');
        const candidateImages = extractInlineImageTokensV589(cq.question || '');
        let question = q.question || '';
        let options = (q.options || []).map((o) => ({ ...o }));
        let answer = [...(q.answer || [])];
        let analysis = q.analysis || '';
        let touched = false;
        if (!baseImages.length && candidateImages.length) {
          const unique = candidateImages.filter((x) => !question.includes(x));
          if (unique.length) { question = [question, ...unique].filter(Boolean).join('\n');touched = true; }
        }

        if (options.length < 2 && (cq.options || []).length >= 2) {
          options = (cq.options || []).map((o) => ({ ...o }));

          touched = true;
        }

        if (answerNeedsLocalRepairV599({ ...q, options, answer }) && answerCompatibleWithQuestionV599({ ...q, options }, cq.answer || [], options)) {
          answer = normalizeAnswer(cq.answer || [], options, q.type);touched = true;
        }

        if (!analysis && cq.analysis) { analysis = cq.analysis;touched = true; }

        if (!touched) { return q; }

        const next = normalizeQuestion({ ...q, question, options, answer, analysis }, i);
        const afterRisk = localRepairRiskStatus(next, profile);
        const addedImage = !baseImages.length && candidateImages.length;
        if (afterRisk !== '正常' && beforeRisk === '正常' && !addedImage) { return q; }

        changed += 1;
        segments.push(`第${i + 1}题：局部补全${addedImage ? '图片' : ''}${options.length > (q.options || []).length ? '选项' : ''}${answer.length > (q.answer || []).length ? '答案' : ''}`);
        return next;
      });
      return { questions: out, changed, segments };
    }

    // 根据期望题量、正文污染和异常率识别足以解锁专项兜底的严重失败。
    function standardMainlineSeverelyFailedV599(candidate, ev, profile) {
      const qs = candidate?.questions || [];
      if (!qs.length) { return true; }

      const expected = Number(profile?.expectedByHeadings || 0);
      if (expected) {
        const ratio = qs.length / expected;
        if (ratio < 0.6 || ratio > 1.4) { return true; }
      }

      if (ev?.hardCount > Math.max(8, Math.ceil(qs.length * 0.30))) { return true; }

      if (!ev?.typeOk && expected && qs.length < Math.max(3, Math.floor(expected * 0.6))) { return true; }

      return false;
    }

    /* SHIROHA_WEB_V37_7_SHARED_STEM_MATERIAL_FALLBACK */
    // 与原生版保持同一兼容思路：不新增父子题结构，只在导入阶段把高置信度共用材料补到各小题题干。
    function sharedStemIntroV377(line) {
      const raw = String(line || '').trim();
      if (!raw || hasStrongQuestionNo(raw) || isOptionLine(raw) || isAnswerLine(raw) || isAnalysisLine(raw)) { return null; }

      // 识别阅读共享资料后答指定连续题号范围的导语，保留同行材料开头。
      let m = raw.match(/^(?:请\s*)?(?:阅读|根据)\s*(?:以下|下列|上述|给定)?\s*(?:统计资料|资料|材料|图表|病例|案例|病历)[\s，,：:]*(?:并\s*)?(?:回答|完成|解答|作答)\s*(?:第\s*)?(\d{1,4})\s*(?:题)?\s*[-~～—–至到]\s*(?:第\s*)?(\d{1,4})\s*题\s*[：:]?\s*(.*)$/i);
      if (m) {
        const start = Number(m[1]) || 0; const end = Number(m[2]) || 0;
        if (start > 0 && end >= start && end - start < 200) { return { kind: 'range', label: '共用材料', rangeStart: start, rangeEnd: end, lead: String(m[3] || '').trim() }; }
      }

      // 识别没有明示题号范围、仅说明共用题干或案例的标题。
      m = raw.match(/^(?:[【[]\s*)?(共用题干题|共用题干|共用材料题|共用材料|共用资料题|共用资料|共用案例题|共用案例|共用病例题|共用病例)(?:\s*[】\]])?\s*(?:[：:]\s*(.*))?$/);
      if (m) { return { kind: 'explicit', label: m[1], rangeStart: 0, rangeEnd: 0, lead: String(m[2] || '').trim() }; }

      // 兼容以“材料一”等带序号的材料标题和冒号起始的共用内容。
      m = raw.match(/^(?:[【[]\s*)?((?:材料|资料|案例|病例)\s*[一二三四五六七八九十百千万0-9]+)(?:\s*[】\]])?\s*[：:]\s*(.*)$/);
      if (m) { return { kind: 'numbered_material', label: m[1], rangeStart: 0, rangeEnd: 0, lead: String(m[2] || '').trim() }; }

      return null;
    }

    // 从共享材料后的小题首行识别题号，并剥离题型和编号标签以比较题干。
    function sharedStemChildLineV377(line) {
      const raw = String(line || '').trim();
      if (!raw || isOptionLine(raw) || isAnswerLine(raw) || isAnalysisLine(raw) || getHeadingType(raw) || isImportNoiseLine(raw)) { return null; }

      const number = questionNumberFromLineV58917(raw);if (!number) { return null; }

      const stem = raw
        .replace(/* 兼容题型名称紧接编号的共享材料小题。 */ /^\s*(?:单选题|单选|单项选择题|多选题|多选|多项选择题|判断题|判断|填空题|填空|简答题|简答|问答题)\s*(?:第\s*)?\d{1,4}\s*(?:题)?\s*[：:]?\s*/, '')
        .replace(/* 去掉普通数字题号和可选“第”“题”标识。 */ /^\s*(?:第\s*)?\d{1,4}\s*(?:题)?\s*[、.．:：]?\s*/, '')
        .replace(/* 去掉用圆括号或方括号标记的小题号。 */ /^\s*[（(【[]\s*\d{1,4}\s*[）)】\]]\s*/, '').trim();
      return { number, stem };
    }

    function sharedStemBoundaryV377(line, nextLines = []) {
      const raw = String(line || '').trim();if (!raw) { return false; }

      return !!sharedStemIntroV377(raw) || isVolumeHeading(raw) || !!getHeadingType(raw) || isChapterHeadingV58911(raw, nextLines) || isAnswerSectionHeading(raw, nextLines);
    }

    // 检查候选行后是否有题目语义或选项证据，排除共享材料内部的数字列举。
    function sharedStemChildEvidenceV377(lines, start, end) {
      const segment = (lines || []).slice(start, Math.max(start + 1, end));
      const first = sharedStemChildLineV377(segment[0] || '');
      const text = segment.join('\n');
      const optionCount = segment.slice(1).filter(isOptionLine).length;
      if (optionCount >= 2 || segment.some(hasInlineAnswerTag) || segment.some(isAnswerLine) || segment.some(isAnalysisLine)) { return true; }

      const stem = String(first?.stem || '').trim();
      if (/* 典型问句以问号结束，可作为有独立作答任务的证据。 */ /[？?]\s*$/.test(stem) || /* 空括号或长横线提示需要作答，也可确认独立小题。 */ /[（(]\s*[）)]|_{3,}/.test(stem)) { return true; }

      return /* 识别常见作答动词开头或问句语义结尾的题干。 */ /^(?:请|试|简述|说明|分析|计算|判断|指出|概括|解释|论述|回答)|(?:什么|哪些|为何|为什么|如何|是否|正确的是|错误的是|不正确|最恰当|主要|下列|可以推出|表明|说明)[^\n]{0,12}$/i.test(stem)
    || /* 相邻的 A、B 独立选项也能确认此前文本属于题干。 */ /(?:A\s*[、.．:：].+B\s*[、.．:：])/.test(text);
    }

    function sharedStemMaterialUsefulV377(value) {
      const raw = String(value || '').trim();if (!raw) { return false; }

      // 内嵌图片、Word 图片、表格或公式本身就是有效材料内容。
      if (/!\[[^\]]*\]\(data:image\/|\[\[DOCX_IMAGE_\d+\]\]|【DOCX表格开始】|【DOCX公式OMML：/.test(raw)) { return true; }

      // 忽略 Unicode 空格、标点和符号，检查是否有足够可读的材料正文。
      return raw.replace(/[\s\p{P}\p{S}]/gu, '').length >= 4;
    }

    // 查找共享材料及其后的小题，验证题号范围和边界证据后才建立关联。
    function detectSharedStemGroupsV377(text) {
      const pack = protectDocxImageMarkdownForParser(text);const restore = pack.restore || ((x) => x);
      const lines = normalizeImportText(pack.text).split('\n').map((x) => x.trim()).filter(Boolean);
      const groups = [];
      for (let introIndex = 0;introIndex < lines.length;introIndex += 1) {
        const intro = sharedStemIntroV377(lines[introIndex]);if (!intro) { continue; }

        let limit = lines.length;
        for (let j = introIndex + 1;j < lines.length;j += 1) {
          if (sharedStemBoundaryV377(lines[j], lines.slice(j + 1, j + 7))) { limit = j;break; }
        }

        const anchors = [];
        for (let j = introIndex + 1;j < limit;j += 1) {
          const child = sharedStemChildLineV377(lines[j]);if (!child) { continue; }

          if (intro.rangeStart && child.number < intro.rangeStart) { continue; }

          if (intro.rangeEnd && child.number > intro.rangeEnd) { break; }

          anchors.push({ lineIndex: j, ...child });
        }

        let run = [];
        if (intro.rangeStart) {
          const startAt = anchors.findIndex((x) => x.number === intro.rangeStart);
          if (startAt >= 0) {
            let expected = intro.rangeStart;
            for (let j = startAt;j < anchors.length && expected <= intro.rangeEnd;j += 1) {
              const item = anchors[j];if (item.number !== expected) { break; }

              run.push(item);expected += 1;
            }
          }

          const evidenceCount = run.filter((item, idx) => sharedStemChildEvidenceV377(lines, item.lineIndex, run[idx + 1]?.lineIndex || limit)).length;
          if (evidenceCount < Math.min(2, run.length)) { run = []; }
        } else {
          for (let start = 0;start < anchors.length && !run.length;start += 1) {
            const candidate = [anchors[start]];
            for (let j = start + 1;j < anchors.length;j += 1) {
              if (anchors[j].number !== candidate[candidate.length - 1].number + 1) { break; }

              candidate.push(anchors[j]);
            }

            if (candidate.length < 2) { continue; }

            const evidenceCount = candidate.filter((item, idx) => sharedStemChildEvidenceV377(lines, item.lineIndex, candidate[idx + 1]?.lineIndex || limit)).length;
            const required = Math.min(2, candidate.length);
            if (evidenceCount >= required) { run = candidate; }
          }
        }

        if (run.length < 2) { continue; }

        const firstChildLine = run[0].lineIndex;
        const materialLines = [intro.lead, ...lines.slice(introIndex + 1, firstChildLine)].map((x) => String(x || '').trim()).filter(Boolean);
        const material = restore(materialLines.join('\n').trim());
        if (!sharedStemMaterialUsefulV377(material)) { continue; }

        groups.push({ kind: intro.kind, label: intro.label, rangeStart: intro.rangeStart, rangeEnd: intro.rangeEnd, material, children: run.map((item) => ({ number: item.number, stem: restore(item.stem) })) });

        introIndex = Math.max(introIndex, run[run.length - 1].lineIndex - 1);
      }

      return groups;
    }

    function sharedStemComparableTextV377(value) {
      return normalizeText(visibleQuestionTextForRisk(stripInlineImageTokensV589(String(value || ''))));
    }

    // 核对题号和题干是否吻合，避免把共享材料绑定到同号的其他题目。
    function sharedStemQuestionMatchesV377(question, child) {
      if (String(question?.number || '') !== String(child?.number || '')) { return false; }

      const childText = sharedStemComparableTextV377(child?.stem || '');
      if (childText.length < 4) { return true; }

      const questionText = sharedStemComparableTextV377(question?.question || '');
      const head = childText.slice(0, Math.min(24, childText.length));
      return questionText.includes(head) || childText.includes(questionText.slice(-Math.min(24, questionText.length)));
    }

    // 把可确定归属的共享材料补到小题正文，同时跳过已包含同一材料的题目。
    function expandSharedStemQuestionsV377(questions, groups) {
      const out = (questions || []).map((q, i) => normalizeQuestion(q, i));let cursor = 0; let appliedGroups = 0; let appliedChildren = 0; let changedQuestions = 0;const segments = [];
      for (const group of groups || []) {
        const indexes = [];let searchFrom = cursor;
        for (const child of group.children || []) {
          let found = -1;
          for (let i = searchFrom;i < out.length;i += 1) { if (sharedStemQuestionMatchesV377(out[i], child)) { found = i;break; } }

          if (found < 0) { indexes.length = 0;break; }

          indexes.push(found);searchFrom = found + 1;
        }

        if (indexes.length < 2) { continue; }

        const material = String(group.material || '').trim();const materialKey = sharedStemComparableTextV377(material);let groupChanged = 0;
        for (const index of indexes) {
          const q = out[index]; const question = String(q.question || '').trim(); const questionKey = sharedStemComparableTextV377(question);
          const head = materialKey.slice(0, Math.min(36, materialKey.length));
          if (head.length >= 4 && questionKey.includes(head)) { continue; }

          out[index] = normalizeQuestion({ ...q, question: [material, question].filter(Boolean).join('\n\n') }, index);groupChanged += 1;changedQuestions += 1;
        }

        appliedGroups += 1;appliedChildren += indexes.length;cursor = indexes[indexes.length - 1] + 1;
        segments.push(`${group.label || '共用材料'}：已展开到 ${indexes.length} 道小题${groupChanged < indexes.length ? `（${indexes.length - groupChanged} 道原已包含材料）` : ''}`);
      }

      return { questions: out, appliedGroups, appliedChildren, changedQuestions, segments };
    }

    /* SHIROHA_WEB_V37_7_SHARED_STEM_MATERIAL_FALLBACK_END */
    function parseTextQuestions(text, strategy = 'auto', publishReport = () => {}) {
      const original = String(text || '');
      const profile = analyzeQuestionTextProfile(original);
      let sharedStemGroupsV377 = [];
      try { sharedStemGroupsV377 = detectSharedStemGroupsV377(original); } catch (e) { warnDev('共用题干/材料识别失败，继续使用标准解析。', e); }

      let standardSourceDetailedV58910 = null;
      try { standardSourceDetailedV58910 = parseTextQuestionsBaseDetailed(original); } catch (e) { warnDev('标准原文定位初始化失败。', e); }

      const candidates = [];
      // 各解析策略单独产生题目候选，失败只影响该策略并保留后续决策。
      const addCandidate = (name, fn) => {
        try {
          let qs = fn().map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
          qs = repairDocxTablePromptSplitQuestions(qs).map(sanitizeQuestionOptionsForDocxBoundariesV583).map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);

          // 标准策略才有当前标准原文分块元数据可复用。
          if (/^标准/.test(name) && standardSourceDetailedV58910) { attachDetailedSourceMetaToQuestionsV58910(qs, standardSourceDetailedV58910); }

          candidates.push({ name, questions: qs, score: scoreParsedQuestions(qs, profile), warnings: collectImportWarnings(qs) });
        // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
        } catch (e) { candidates.push({ name, questions: [], score: -9999, warnings: ['解析失败：' + e.message] }); }
      };

      // 归一每个候选的题量、答案与风险数据，供两阶段比较共享。
      const evaluateCandidate = (candidate) => {
        if (!candidate || !candidate.questions || !candidate.questions.length) {
          return { qtyOk: false, warnOk: false, typeOk: false, hardCount: 9999, allowedHard: 0, localRisk: 9999, warnings: [] };
        }

        const warnings = importWarningsForStrategy(candidate.questions, profile);
        const hard = warnings.filter((w) => !/* 缺答案与单个多选答案可让用户复核，不作为否定候选的硬错误。 */ /缺少答案|缺少参考答案|多选题只有一个答案/.test(w));
        const expected = profile.expectedByHeadings || 0;
        const qtyOk = !expected || Math.abs(candidate.questions.length - expected) <= Math.max(2, Math.ceil(expected * 0.05));
        const typeExpected = profile.expectedByType || {};
        const st = countTypes(candidate.questions || []);
        const judgeCountAcceptable = !typeExpected.judge || st.judge >= Math.max(0, typeExpected.judge - 2);
        const classifiedCount = st.single + st.multiple + st.multi + st.judge + st.blank + st.short;
        const classifiedCountAcceptable = !typeExpected.single || classifiedCount >= candidate.questions.length * 0.9;
        const typeOk = judgeCountAcceptable && classifiedCountAcceptable;
        const allowedHard = standardHardLimitV599(candidate.questions.length);
        const warnOk = hard.length <= allowedHard;
        const localRisk = countLocalRepairWarnings(candidate.questions, profile);
        return { qtyOk, warnOk, typeOk, hardCount: hard.length, allowedHard, localRisk, warnings };
      };

      const expectedDiff = (candidate) => (profile.expectedByHeadings ? Math.abs((candidate.questions || []).length - profile.expectedByHeadings) : 0);

      const repairKeepsQuality = (evaluation, previous) => evaluation.typeOk
        && evaluation.hardCount <= previous.hardCount && evaluation.localRisk <= previous.localRisk;

      const canAdoptCompleteRepair = (evaluation, previous) => evaluation.qtyOk
        && repairKeepsQuality(evaluation, previous);

      // 在优先保留标准正文的前提下，比较候选的题量与解析证据。
      const standardComparator = (a, b) => {
        const ae = a.eval || evaluateCandidate(a); const be = b.eval || evaluateCandidate(b);
        const aGood = ae.qtyOk && ae.typeOk && ae.warnOk ? 1 : 0;
        const bGood = be.qtyOk && be.typeOk && be.warnOk ? 1 : 0;
        const aBase = ae.qtyOk && ae.typeOk ? 1 : 0;
        const bBase = be.qtyOk && be.typeOk ? 1 : 0;
        return bGood - aGood || bBase - aBase || ae.hardCount - be.hardCount || ae.localRisk - be.localRisk || expectedDiff(a) - expectedDiff(b) || b.score - a.score;
      };

      // 按严重风险、题量与图文保全证据比较允许参与全卷替换的候选。
      const fallbackComparator = (a, b) => {
        const ae = a.eval || evaluateCandidate(a); const be = b.eval || evaluateCandidate(b);
        const aGood = ae.qtyOk && ae.typeOk && ae.warnOk ? 1 : 0;
        const bGood = be.qtyOk && be.typeOk && be.warnOk ? 1 : 0;
        const aAnswered = (a.questions || []).filter((q) => (q.answer || []).length).length;
        const bAnswered = (b.questions || []).filter((q) => (q.answer || []).length).length;
        return bGood - aGood || ae.hardCount - be.hardCount || ae.localRisk - be.localRisk || expectedDiff(a) - expectedDiff(b) || bAnswered - aAnswered || b.score - a.score;
      };

      const strategyLabel = { auto: '自动推荐', standard: '标准逐行解析', volume: '分卷分区三层解析', compact: '紧凑格式解析' }[strategy] || '自动推荐';
      let autoBest = null;
      if (strategy === 'standard') {
        addCandidate('标准试卷段落解析', () => parseStructuredExamText(original));

        addCandidate('标准逐行解析', () => parseTextQuestionsBase(original));
      } else if (strategy === 'volume') { addCandidate('分卷分区三层解析', () => parseByVolumeAndSections(original)); } else if (strategy === 'compact') { addCandidate('紧凑题干选项解析', () => parseTextQuestionsBase(forceSplitCompactText(original))); } else {
        // v58.9.9：自动模式先只建立标准主线，复杂整卷解析不再与标准结果同层抢分。
        addCandidate('标准试卷段落解析', () => parseStructuredExamText(original));

        addCandidate('标准逐行解析', () => parseTextQuestionsBase(original));

        const baselineCandidates = candidates
          .filter((c) => ['标准试卷段落解析', '标准逐行解析'].includes(c.name))
          .filter((c) => c.questions && c.questions.length)
          .map((c) => ({ ...c, eval: evaluateCandidate(c) }))
          .sort(standardComparator);
        let primary = baselineCandidates[0] || candidates[0] || { name: '标准逐行解析', questions: [], warnings: [], score: -9999 };
        primary = { ...primary, eval: primary.eval || evaluateCandidate(primary) };

        const primaryHasQuestions = (primary.questions || []).length > 0;
        // 标准候选评分后到此处未修改题集或 profile，可复用同一次评分的风险计数。
        const localRisk = primaryHasQuestions ? primary.eval.localRisk : countLocalRepairWarnings(primary.questions || [], profile);
        const primaryMatchesProfile = primary.eval.qtyOk && primary.eval.typeOk;
        const localRiskIsLimited = localRisk > 0 && localRisk <= localRepairQuestionLimitV58912((primary.questions || []).length);
        const localRepairWorthTrying = primaryHasQuestions && primaryMatchesProfile && localRiskIsLimited;
        if (localRepairWorthTrying) {
          const repaired = repairParsedQuestionsLocally(original, primary.questions, profile);
          if (repaired.repaired > 0) {
            const qs = repaired.questions.map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
            const warnings = importWarningsForStrategy(qs, profile);
            const score = scoreParsedQuestions(qs, profile) + Math.min(120, repaired.repaired * 20);
            candidates.push({ name: '标准解析 + 异常局部修复', questions: qs, score, warnings, segments: repaired.segments });
          }
        }

        const standardNames = new Set(['标准试卷段落解析', '标准逐行解析', '标准解析 + 异常局部修复']);
        const standardMainline = candidates
          .filter((c) => standardNames.has(c.name) && c.questions && c.questions.length)
          .map((c) => ({ ...c, eval: evaluateCandidate(c) }))
          .sort(standardComparator);
        let mainlineBest = standardMainline[0] || primary;

        // 多章节重复题号时，结构化段落解析在质量相当的情况下仍优先，避免逐行解析多切少量伪题。
        const structuredMain = candidates.find((c) => c.name === '标准试卷段落解析' && c.questions && c.questions.length);
        const lineMain = candidates.find((c) => c.name === '标准逐行解析' && c.questions && c.questions.length);
        if (mainlineBest && mainlineBest.name === '标准逐行解析' && structuredMain && lineMain && profile.repeatedQuestionNumbers && profile.hasTypeSections) {
          const diff = (lineMain.questions || []).length - (structuredMain.questions || []).length;
          const structuredEval = evaluateCandidate(structuredMain);
          const lineEval = evaluateCandidate(lineMain);
          const structuredNoWorse = structuredEval.hardCount <= lineEval.hardCount && structuredEval.localRisk <= lineEval.localRisk;
          if (diff > 0 && diff <= 3 && lineMain.score - structuredMain.score <= 500 && structuredNoWorse) { mainlineBest = { ...structuredMain, eval: structuredEval }; }
        }

        const canRepairBySource = () => !!((mainlineBest.questions || []).length && standardSourceDetailedV58910);

        // v58.9.10：基于原文块位置补漏题/拆粘题。正常标准题保持锁定，只替换能够解释题号缺口的局部区间。
        if (canRepairBySource()) {
          try {
            const sourceRepair = repairMissingAndStuckQuestionsBySourceV58910(original, mainlineBest.questions, profile, standardSourceDetailedV58910);
            if (sourceRepair.repaired > 0) {
              const candidate = { name: '标准主线 + 原文区间局部修复', questions: sourceRepair.questions, score: scoreParsedQuestions(sourceRepair.questions, profile) + Math.min(180, sourceRepair.repaired * 30), warnings: importWarningsForStrategy(sourceRepair.questions, profile), segments: sourceRepair.segments };
              const ev = evaluateCandidate(candidate); const before = mainlineBest.eval || evaluateCandidate(mainlineBest);
              const beforeDiff = expectedDiff(mainlineBest); const afterDiff = expectedDiff(candidate);
              candidates.push(candidate);
              const repairsExpectedGap = !profile.expectedByHeadings || afterDiff < beforeDiff;
              if (repairKeepsQuality(ev, before) && repairsExpectedGap) { mainlineBest = { ...candidate, eval: ev }; }
            }
          } catch (e) { warnDev('标准主线原文区间局部修复失败。', e); }
        }

        // v58.9.11：真实题号锚点之间若解析结果数量过多，只在该原文区间合并过度拆分题目。
        if (canRepairBySource()) {
          try {
            const overSplitRepair = repairOverSplitQuestionsBySourceV58911(original, mainlineBest.questions, profile, standardSourceDetailedV58910);
            if (overSplitRepair.repaired > 0) {
              const candidate = { name: '标准主线 + 过度拆题局部合并', questions: overSplitRepair.questions, score: scoreParsedQuestions(overSplitRepair.questions, profile) + Math.min(120, overSplitRepair.repaired * 20), warnings: importWarningsForStrategy(overSplitRepair.questions, profile), segments: overSplitRepair.segments };
              const ev = evaluateCandidate(candidate); const before = mainlineBest.eval || evaluateCandidate(mainlineBest);
              candidates.push(candidate);
              if (repairKeepsQuality(ev, before)) { mainlineBest = { ...candidate, eval: ev }; }
            }
          } catch (e) { warnDev('标准主线过度拆题局部合并失败。', e); }
        }

        // 答案解析区只对标准主线中缺失或越界的答案做局部映射，不再重建整份题目结构。
        if ((profile.hasAnswerAnalysisSection || hasAnswerAnalysisSignal(original)) && (mainlineBest.questions || []).length) {
          try {
            const entries = parseAnswerAnalysisEntries(original);
            const mapped = mergeAnswerEntriesOntoLockedMainlineV599(mainlineBest.questions, entries);
            if (mapped.changed > 0) {
              const candidate = { name: '标准主线 + 答案局部映射', questions: mapped.questions, score: scoreParsedQuestions(mapped.questions, profile) + Math.min(120, mapped.changed * 8), warnings: importWarningsForStrategy(mapped.questions, profile), segments: mapped.segments };
              const ev = evaluateCandidate(candidate); const before = mainlineBest.eval || evaluateCandidate(mainlineBest);
              candidates.push(candidate);
              if (canAdoptCompleteRepair(ev, before)) { mainlineBest = { ...candidate, eval: ev }; }
            }
          } catch (e) { warnDev('标准主线答案局部映射失败。', e); }
        }

        // 特殊图片真题解析器只提供局部图片/选项/答案补全；标准主线合格时禁止整卷覆盖。
        let imageWholeQuestions = [];
        try { imageWholeQuestions = parseRecruitmentImagePostAnswerExam(original).map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question); } catch (e) { warnDev('图片真题候选解析失败。', e); }

        if (imageWholeQuestions.length && (mainlineBest.questions || []).length) {
          const enriched = mergeImageCandidateOntoLockedMainlineV599(mainlineBest.questions, imageWholeQuestions, profile);
          if (enriched.changed > 0) {
            const candidate = { name: '标准主线 + 图片答案局部补全', questions: enriched.questions, score: scoreParsedQuestions(enriched.questions, profile) + Math.min(160, enriched.changed * 10), warnings: importWarningsForStrategy(enriched.questions, profile), segments: enriched.segments };
            const ev = evaluateCandidate(candidate); const before = mainlineBest.eval || evaluateCandidate(mainlineBest);
            candidates.push(candidate);
            if (canAdoptCompleteRepair(ev, before)) { mainlineBest = { ...candidate, eval: ev }; }
          }
        }

        const mainlineEval = mainlineBest.eval || evaluateCandidate(mainlineBest);
        const preferRecruitmentFallbackV58915 = imageWholeQuestions.length && recruitmentFallbackClearlyBetterV58915(imageWholeQuestions, mainlineBest.questions || []);
        const needWholeDocumentFallback = preferRecruitmentFallbackV58915 || standardMainlineSeverelyFailedV599(mainlineBest, mainlineEval, profile);
        autoBest = mainlineBest;

        // 只有标准主线整体严重失效，或专用真题解析结果高置信度且明显更完整时，才允许复杂解析器生成整卷候选。
        if (needWholeDocumentFallback) {
          if (profile.hasAnswerAnalysisSection || hasAnswerAnalysisSignal(original)) {
            try {
              const qs = parseDocumentWithAnswerSections(original).map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
              if (qs.length) { candidates.push({ name: '整卷兜底：题目区 + 答案解析区', questions: qs, score: scoreAnswerSectionCandidate(qs, profile), warnings: collectImportWarnings(qs) }); }
            // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
            } catch (e) { candidates.push({ name: '整卷兜底：题目区 + 答案解析区', questions: [], score: -9999, warnings: ['解析失败：' + e.message] }); }
          }

          if (imageWholeQuestions.length) { candidates.push({ name: '整卷兜底：图片真题 + 后置答案', questions: imageWholeQuestions, score: scoreRecruitmentImageCandidate(imageWholeQuestions, profile), warnings: collectImportWarnings(imageWholeQuestions) }); }

          if (profile.hasVolumeHeading || profile.repeatedQuestionNumbers || profile.hasTypeSections) { addCandidate('整卷兜底：分卷分区三层解析', () => parseByVolumeAndSections(original)); }

          if (profile.inlineOptionLikely || profile.inlineAnswerLikely || !mainlineEval.qtyOk || !mainlineEval.typeOk) { addCandidate('整卷兜底：紧凑题干选项解析', () => parseTextQuestionsBase(forceSplitCompactText(original))); }

          const fallbackCandidates = candidates
            .filter((c) => /* 只允许明确标为“整卷兜底”的候选参与全卷替换。 */ /^整卷兜底：/.test(c.name) && c.questions && c.questions.length)
            .map((c) => ({ ...c, eval: evaluateCandidate(c) }))
            .sort(fallbackComparator);
          const fallbackBest = fallbackCandidates[0];
          const recruitmentBest = preferRecruitmentFallbackV58915 ? fallbackCandidates.find((c) => c.name === '整卷兜底：图片真题 + 后置答案') : null;
          if (recruitmentBest) { autoBest = recruitmentBest; } else if (fallbackBest) {
            const fallbackGood = fallbackBest.eval.qtyOk && fallbackBest.eval.typeOk && fallbackBest.eval.hardCount < mainlineEval.hardCount;
            const mainlineEmpty = !(mainlineBest.questions || []).length;
            if (mainlineEmpty || fallbackGood) { autoBest = fallbackBest; }
          }
        }
      }

      let best = autoBest || candidates.filter((c) => c.questions && c.questions.length).map((c) => ({ ...c, eval: evaluateCandidate(c) })).sort(strategy === 'auto' ? standardComparator : fallbackComparator)[0] || { name: '标准逐行解析', questions: [], score: 0, warnings: [] };
      let sharedStemExpansionV377 = { questions: best.questions || [], appliedGroups: 0, appliedChildren: 0, changedQuestions: 0, segments: [] };
      if (sharedStemGroupsV377.length && (best.questions || []).length) {
        try {
          sharedStemExpansionV377 = expandSharedStemQuestionsV377(best.questions, sharedStemGroupsV377);
          if (sharedStemExpansionV377.changedQuestions > 0) {
            const qs = sharedStemExpansionV377.questions;
            const candidate = { name: '标准主线 + 共用材料展开', questions: qs, score: scoreParsedQuestions(qs, profile) + Math.min(120, sharedStemExpansionV377.changedQuestions * 12), warnings: importWarningsForStrategy(qs, profile), segments: sharedStemExpansionV377.segments };
            candidates.push(candidate);best = candidate;
          }
        } catch (e) { warnDev('共用题干/材料展开失败，保留原解析结果。', e); }
      }

      profile.sharedStemDetectedGroups = sharedStemGroupsV377.length;
      profile.sharedStemAppliedGroups = sharedStemExpansionV377.appliedGroups || 0;
      profile.sharedStemAppliedChildren = sharedStemExpansionV377.appliedChildren || 0;
      const finalQuestions = repairDocxTablePromptSplitQuestions(best.questions || []).map(sanitizeQuestionOptionsForDocxBoundariesV583).map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
      const stats = countTypes(finalQuestions || []);
      const profileBits = [];
      if (profile.hasVolumeHeading) { profileBits.push('检测到分卷'); }

      if (profile.hasTypeSections) { profileBits.push('检测到题型分区'); }

      if (profile.repeatedQuestionNumbers) { profileBits.push('题号存在重复'); }

      if (profile.inlineOptionLikely) { profileBits.push('存在同一行选项'); }

      if (profile.inlineAnswerLikely) { profileBits.push('存在题尾答案标记'); }

      if (profile.hasAnswerAnalysisSection) { profileBits.push('检测到答案解析区'); }

      if (profile.sharedStemAppliedGroups) { profileBits.push(`共用材料展开${profile.sharedStemAppliedGroups}组/${profile.sharedStemAppliedChildren}题`); }

      const candidateLine = candidates.map((c) => `${c.name}${c.questions.length}题/质量${c.score}${c.segments?.length ? `（局部修复${c.segments.length}处）` : ''}`).join('；');
      const expected = profile.expectedByHeadings ? `；标题预期约${profile.expectedByHeadings}题，实际${finalQuestions.length}题，差值${finalQuestions.length - profile.expectedByHeadings}` : '';
      const report = `解析模式：${strategyLabel}；采用策略：${best.name}。${profileBits.length ? `格式画像：${profileBits.join('、')}。` : ''}候选结果：${candidateLine}。最终识别：${finalQuestions.length}题（单选${stats.single || 0}、多选${(stats.multiple || 0) + (stats.multi || 0)}、判断${stats.judge || 0}、填空${stats.blank || 0}、简答${stats.short || 0}）${expected}。`;
      // 诊断构建失败时，页面仍需保留本次报告及上一次成功的诊断。
      publishReport(report);
      const diagnostics = { mode: strategyLabel, strategy: best.name, profile, candidates: candidates.map((c) => ({ name: c.name, questions: c.questions.length, score: c.score, warnings: c.warnings || [], segments: c.segments || [] })), expected: { total: profile.expectedByHeadings || 0, types: profile.expectedByType || {} }, stats, warnings: collectImportWarnings(finalQuestions), sharedStem: { detectedGroups: sharedStemGroupsV377.length, appliedGroups: sharedStemExpansionV377.appliedGroups || 0, appliedChildren: sharedStemExpansionV377.appliedChildren || 0, changedQuestions: sharedStemExpansionV377.changedQuestions || 0 } };
      return { questions: finalQuestions, diagnostics };
    }

    // 从原文汇总题号、分卷及内嵌选项证据，供选择和评价解析策略。
    function analyzeQuestionTextProfile(text) {
      const t = normalizeImportText(text);
      const lines = t.split('\n').map((x) => x.trim()).filter(Boolean);
      const qnums = [];
      lines.forEach((l) => {
        // 从常见题号开头读出编号，估计连续性和重复情况。
        const m = l.match(/^\s*(?:第\s*)?(\d{1,3})\s*(?:题)?[、.．:：]/);if (m) { qnums.push(m[1]); }
      });

      const seen = new Set();let repeated = false;for (const n of qnums) {
        if (seen.has(n)) { repeated = true;break; }

        seen.add(n);
      }

      return {
        lineCount: lines.length,
        hasVolumeHeading: lines.some(isVolumeHeading) || /* 兼容年份加卷号连写的试卷标题，补充独立卷标题检测。 */ /202\d年.*(?:试卷|考试).*?[·._-]?[一二三四五六七八九十0-9]+卷/.test(t),
        hasTypeSections: lines.some((l) => !!getHeadingType(l)),
        repeatedQuestionNumbers: repeated,
        inlineOptionLikely: /* 分号隔开的后续选项可指示题干和选项在同一行。 */ /[A-Ga-g]\s*[、.．:：]?[^\n]{1,50}[;；]\s*[B-Gb-g]\s*[、.．:：]?/.test(t) || /* 没有分号时仍可用相邻带标点的选项标签判断行内结构。 */ /[A-Ga-g][、.．:：][^\n]{1,50}[B-Gb-g][、.．:：]/.test(t),
        inlineAnswerLikely: /* 答案标题和冒号出现在括号后，是原文含行内答案的证据。 */ /[【[（(]\s*(?:答案|正确答案|参考答案|标准答案)\s*[:：]/.test(t),
        hasAnswerAnalysisSection: hasAnswerAnalysisSignal(t),
        expectedByHeadings: estimateExpectedQuestionCount(t),
        expectedByType: estimateExpectedQuestionTypeCounts(t),
      };
    }

    // 按分区题数、分值换算及编号范围估计预期题量，较强证据优先。
    function estimateExpectedQuestionCount(text) {
      let total = 0;let m;
      // 从“某题型共 N 题”的明确描述读取题量。
      const direct = /(?:单选题|单项选择题|多选题|多项选择题|判断题|填空题|简答题)[^\n]{0,25}?共\s*(\d{1,4})\s*题/g;
      while ((m = direct.exec(text))) { const n = Number(m[1]);if (n > 0) { total += n; } }

      if (total) { return total; }

      // 在只有每题分值和总分时，利用两者推算题数。
      const re = /(单选题|多选题|判断题|填空题|简答题)[^\n]{0,30}?每题\s*([\d.]+)\s*分[^\n]{0,20}?共\s*([\d.]+)\s*分/g;
      while ((m = re.exec(text))) { const per = Number(m[2]); const sum = Number(m[3]);if (per > 0 && sum > 0) { total += Math.round(sum / per); } }

      if (total) { return total; }

      // 放宽题型名称及量词形式，兼容省略“共”的简短描述。
      const loose = /(单项选择题|单选题|单选|多项选择题|多选题|多选|判断题|判断|填空题|填空|简答题|简答)[^\n]{0,20}?(\d{1,4})\s*(?:题|道)/g;
      while ((m = loose.exec(text))) { if (!/* 排除题数松匹配误读的“每题”提示。 */ /每题\s*$/.test(m[0])) { const n = Number(m[2]);if (n > 0) { total += n; } } }

      if (total) { return total; }

      // 题数未明确给出时，从某题型起止题号估计题量。
      const range = /(单项选择题|单选题|单选|多项选择题|多选题|多选|判断题|判断|填空题|填空|简答题|简答)[^\n]{0,15}?(\d{1,4})\s*(?:-|~|—|至|到)\s*(\d{1,4})/g;
      while ((m = range.exec(text))) { const a = Number(m[2]); const b = Number(m[3]);if (b >= a && b - a < 2000) { total += b - a + 1; } }

      return total || 0;
    }

    // 按题型比较原文中明确的题量及分值证据，保留最可信的各类题量上限。
    function estimateExpectedQuestionTypeCounts(text) {
      const out = { single: 0, multiple: 0, judge: 0, blank: 0, short: 0 };
      const map = { 单选题: 'single', 单选: 'single', 单项选择题: 'single', 多选题: 'multiple', 多选: 'multiple', 多项选择题: 'multiple', 判断题: 'judge', 判断: 'judge', 填空题: 'blank', 填空: 'blank', 简答题: 'short', 简答: 'short' };
      let m;
      // 按题型汇总明确的“共 N 题”描述。
      const direct = /(单项选择题|单选题|单选|多项选择题|多选题|多选|判断题|判断|填空题|填空|简答题|简答)[^\n]{0,25}?共\s*(\d{1,4})\s*题/g;
      while ((m = direct.exec(text))) { const t = map[m[1]];if (t) { out[t] += Number(m[2] || 0); } }

      // 缺少明确题量时，允许用该题型总分除以每题分值估计题量。
      const score = /(单项选择题|单选题|单选|多项选择题|多选题|多选|判断题|判断|填空题|填空|简答题|简答)[^\n]{0,30}?每题\s*([\d.]+)\s*分[^\n]{0,20}?共\s*([\d.]+)\s*分/g;
      while ((m = score.exec(text))) { const t = map[m[1]]; const per = Number(m[2]); const sum = Number(m[3]);if (t && per > 0 && sum > 0) { out[t] += Math.round(sum / per); } }

      // 兼容题型附近不含“共”的数字题量说明。
      const loose = /(单项选择题|单选题|单选|多项选择题|多选题|多选|判断题|判断|填空题|填空|简答题|简答)[^\n]{0,20}?(\d{1,4})\s*(?:题|道)/g;
      while ((m = loose.exec(text))) { const t = map[m[1]]; const n = Number(m[2]);if (t && n > 0 && !/* 不使用只表示单题分值的“每题”前缀作为题量证据。 */ /每题\s*$/.test(m[0])) { out[t] = Math.max(out[t] || 0, n); } }

      // 兼容给出连续编号范围而没有明确题数的题型说明。
      const range = /(单项选择题|单选题|单选|多项选择题|多选题|多选|判断题|判断|填空题|填空|简答题|简答)[^\n]{0,15}?(\d{1,4})\s*(?:-|~|—|至|到)\s*(\d{1,4})/g;
      while ((m = range.exec(text))) { const t = map[m[1]]; const a = Number(m[2]); const b = Number(m[3]);if (t && b >= a && b - a < 2000) { out[t] = Math.max(out[t] || 0, b - a + 1); } }

      return out;
    }

    // 统计题号的连续性及缺口，重复题号与跨分区重置依既有规则处理。
    function scoreQuestionNumberContinuity(qs) {
      const arr = qs || [];
      const explicitNums = arr.map((q) => {
        const meta = getSourceMetaV58910(q);return meta?.explicitNumber ? Number(meta.originalNumber || 0) : 0;
      }).filter((n) => n > 0 && n < 10000);
      // v58.9.12：连续性只评价原文真实题号。真实题号覆盖不足时直接不给分，禁止自动编号伪造连续性。
      if (explicitNums.length < Math.max(5, Math.ceil(arr.length * 0.6))) { return 0; }

      const nums = explicitNums;
      const unique = [...new Set(nums)].sort((a, b) => a - b);
      const min = unique[0]; const max = unique[unique.length - 1];
      const span = max - min + 1;
      const gaps = Math.max(0, span - unique.length);
      const dups = Math.max(0, nums.length - unique.length);
      let score = (unique.length * 5) - (gaps * 80) - (dups * 45);
      if (min === 1 && max === unique.length && gaps === 0 && dups === 0) { score += 360; }

      if (gaps > 0) { score -= Math.min(300, gaps * 60); }

      return score;
    }

    // 识别粘到选项正文的卷章或题型标题，供清理时与合法短选项区分。
    function isLeakedHeadingOptionTextV583(text) {
      const t = String(text || '').trim();
      if (!t) { return false; }

      if (getHeadingType(t) || isVolumeHeading(t)) { return true; }

      if (isChapterHeadingV58911(t) || /* “模块”或“专题”后跟编号通常是后续分区标题。 */ /^(?:模块|专题)[一二三四五六七八九十百千万0-9]+/.test(t.replace(/* 忽略“模块”“专题”内部的排版空白。 */ /\s+/g, ''))) { return true; }

      if (/* 只有整段等同于已知题型标题时才将其作为标题污染。 */ /^(?:单项选择题|单选题|多项选择题|多选题|判断题|填空题|简答题)$/.test(t.replace(/* 比较题型标题时忽略空白，兼容 Word 的中文分散排版。 */ /\s+/g, ''))) { return true; }

      return false;
    }

    // 结合选项位置与表格结构证据辨认 Word 数据表格残片。
    function isDocxTableArtifactOptionV583(option) {
      const key = String(option?.key || option?.label || '').trim().toUpperCase();
      const t = String(option?.text || '');
      // 只把标准 A–D 之后的 E–G 选项纳入表格残片检查。
      if (!/^[E-GF]$/.test(key)) { return false; }

      return /* 管道符表明疑似 Markdown 表格单元格。 */ /\|/.test(t) && /* 方差、残差或回归统计字段进一步确认正文来自数据表格。 */ /(?:Significance|回归分析|残差|总计|df|SS|MS|---|方差)/i.test(t);
    }

    // 只移除泄漏的标题和表格残片，复制题目后再调整选项与答案。
    function sanitizeQuestionOptionsForDocxBoundariesV583(q) {
      const copy = { ...q };
      const opts = (copy.options || []).filter(/* 保留答案引用的选项，其他选项须通过标题与表格残片检查。 */ (o) => {
        const visible = visibleOptionTextForRisk(o?.text || '');
        if (isLeakedHeadingOptionTextV583(visible)) { return false; }

        if (isDocxTableArtifactOptionV583(o)) { return false; }

        return true;
      });
      copy.options = opts;
      return copy;
    }

    // 汇总候选题目的选项边界污染，供解析候选按质量比较。
    function countBoundaryOptionPollutionV583(qs) {
      let n = 0;
      (qs || []).forEach((q) => {
        (q.options || []).forEach((o) => {
          const visible = visibleOptionTextForRisk(o?.text || '');if (isLeakedHeadingOptionTextV583(visible) || isDocxTableArtifactOptionV583(o)) { n += 1; }
        });
      });

      return n;
    }

    // 结合期望题型和题量、答案、连续性与异常提示评估解析候选。
    function scoreParsedQuestions(qs, profile) {
      const arr = qs || [];let score = arr.length * 10;
      const warnings = collectImportWarnings(arr);
      // 题目文件和答案文件分离时，题目本身没有答案是正常现象，不能让“缺少答案”主导策略选择。
      const sourceLikelyHasAnswers = !!(profile.inlineAnswerLikely || profile.hasAnswerAnalysisSection) || arr.some((q) => (q.answer || []).length);
      warnings.forEach((w) => {
        score -= w.includes('缺少答案') && !sourceLikelyHasAnswers ? 3 : 25;
      });

      let suspicious = 0;
      arr.forEach(/* 统计题干和选项中仍含答案标记或异常长文本的题目。 */ (q) => {
        if ((q.options || []).some((o) => String(o.text || '').length > 220 || /* 选项中出现答案标签或编号答案条目，提示正文跨题粘连。 */ /【\s*答案|\b\d{1,3}\s*[、.．:：].+【\s*答案/.test(o.text))) { suspicious += 1; }

        // 题干中出现答案区域标记时计入可疑候选。
        if (/【\s*答案|正确答案|参考答案/.test(q.question || '')) { suspicious += 1; }

        if ((q.question || '').length > 260) { suspicious += 1; }

        if (localRepairRiskStatus(q, profile) !== '正常') { suspicious += 1; }
      });

      score -= suspicious * 30;
      if (profile.expectedByHeadings) { const diff = Math.abs(arr.length - profile.expectedByHeadings);score -= Math.min(300, diff * 12); }

      score -= countBoundaryOptionPollutionV583(arr) * 140;
      score += scoreQuestionNumberContinuity(arr);
      return score;
    }

    // 恢复紧凑排版的题干与选项边界，仅在 A、B 顺序证据成立时切分。
    function forceSplitCompactText(text) {
      let s = String(text || '');
      // 行尾 A 段紧接下一行 B 时保留句末标点与选项之间的分界。
      s = s.replace(/([。？！?])\s*(?=A\s*[^A-G\n]{1,80}\s*[\n\r]+\s*B\s*[、.．:：\s])/g, '$1 ');
      // 行内出现 A 段继而 B 标签时，在 A 前恢复独立选项换行。
      s = s.replace(/([^\n])\s+(?=A\s*[^A-G\n]{1,80}\s*B\s*[、.．:：])/g, '$1\n');
      return preSplitVolumeAndCompactQuestions(s);
    }

    // 当首个标签与后续连排选项竞争时，检查是否应保留独立首项。
    function preferLeadingStandaloneOptionV58923(line, rich) {
      const raw = String(line || '').trim();
      // 读取筛选标记、可选括号或标点形式的首个字母选项。
      const leadMatch = raw.match(/^\s*(?:[oOxXuUyYvV√✔✓]\s*)?(?:[（(]\s*([A-Ga-g])\s*[）)]|([A-Ga-g])\s*[、.．:：，,])\s*(.*)$/);
      if (!leadMatch || !rich || !Array.isArray(rich.options) || rich.options.length < 2) { return false; }

      const lead = normalizeOptionKey(leadMatch[1] || leadMatch[2]);
      const keys = rich.options.map((o) => normalizeOptionKey(o.key));
      if (rich.prefix || keys[0] !== lead) { return true; }

      for (let i = 0;i < keys.length;i += 1) {
        if (keys[i] !== String.fromCharCode(lead.charCodeAt(0) + i)) { return true; }
      }

      const next = String.fromCharCode(lead.charCodeAt(0) + 1);
      const body = leadMatch[3] || '';
      // 用下一个预期选项加分隔标点检查正文是否已有独立选项。
      const explicitMarker = new RegExp(`${next}\\s*[、.．:：]`).test(body);
      // 兼容下一个选项字母直接紧接中文正文的无标点排版。
      const noSeparatorMarker = new RegExp(`(?:^|[\\s;；，,、])${next}(?=[\\u4e00-\\u9fa5])`).test(body);
      return !explicitMarker && !noSeparatorMarker;
    }

    // 识别有独立题号且正文含多处括号数字列举的叙述题，避免误拆题干。
    function isNumberedNarrativeEnumerationV58923(line, group = '') {
      const type = mapType(group || '');
      if (!['judge', 'blank', 'short'].includes(type)) { return false; }

      const raw = String(line || '').trim();
      // 需要先有完整题号前缀才检查正文内数字列举。
      if (!/^\s*(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]/.test(raw)) { return false; }

      // 统计正文中括号圈住的一位或两位数字项目。
      const items = raw.match(/[（(]\s*\d{1,2}\s*[）)]/g) || [];
      return items.length >= 2;
    }

    // 判别富选项识别命中是正文里的英语字母，还是题号后的真实连排选项。
    function isNumberedQuestionRichOptionFalsePositiveV58923(line, rich) {
      const raw = String(line || '').trim();
      if (!rich || !Array.isArray(rich.options) || rich.options.length < 2) { return false; }

      // 提取带正式题号的行中剩余正文，保证只对题干内容检查假阳性。
      const numbered = raw.match(/^\s*(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]\s*(.*)$/);
      if (!numbered) { return false; }

      const body = numbered[1] || '';
      // 统计带分隔标点的明确选项标签。
      const explicit = (body.match(/(?:^|[\s；;，,、])(?:[A-G])\s*[、.．:：]/g) || []).length;
      // 额外统计直接连中文文本、没有标点的候选字母。
      const noSeparator = (body.match(/(?:^|[\s；;，,、])(?:[A-G])(?=[\u4e00-\u9fa5])/g) || []).length;
      return explicit + noSeparator < 2;
    }

    function shouldAdoptContextualType(currentType, contextualType) {
      return !currentType && contextualType;
    }

    // 解析含卷、题型分区和答案表的文档，按先遇到的字段更新当前题目。
    function parseStructuredExamText(text) {
      const s = repairDocxLostQuestionNumberLines(normalizeImportText(text));
      const lines = s.split('\n').map((x) => x.trim()).filter(Boolean);
      const questions = []; let currentType = ''; let currentVolume = ''; let current = null; let collectingAnalysis = false;let collectingSubjectiveAnswerV58917 = false;
      const hasPendingAnalysis = () => current && collectingAnalysis;

      // 结束当前题块时整理题干、答案和解析，并保持卷章归属。
      const flush = () => {
        if (!current) { return; }

        const stem = stripLeadingQuestionTypeLabelV592((current.questionLines || []).join(' ').replace(/* 预览题干合并分行时折叠排版空白，保留原先检测的题型标签。 */ /\s+/g, ' ').trim());
        const mergedOptions = mergeDuplicateOptions(repairEmbeddedOptions(current.options || [])).filter((o) => o.text);
        let answer = [...(current.answer || [])];
        const groupType = mapType(current.group || '');
        let type = current.type || guessType(stem, mergedOptions, answer, current.group || '');
        const subjectiveAnswerTextV58917 = (current.subjectiveAnswerLinesV58917 || []).join('\n').trim();
        if (type === 'short' && subjectiveAnswerTextV58917) { answer = [subjectiveAnswerTextV58917]; }

        // v58.9.7：选项结构优先于题干填空/问答语义；只有显式分区/显式题型才保留 blank/short。
        if (mergedOptions.length && !groupType && !current.explicitType && ['blank', 'short'].includes(type)) {
          type = guessType(stem, mergedOptions, answer, '');
        }

        const fixed = cleanQuestionStemAndAnswer(stem, answer, type, mergedOptions);
        answer = isTextType(type) ? splitTextAnswer(fixed.answer.join('；')) : normalizeAnswer(fixed.answer, mergedOptions, type);
        const finalOptions = (type === 'judge' && !mergedOptions.length) ? [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }] : mergedOptions;
        questions.push({
          id: makeId('structured', questions.length),
          type,
          number: current.number || questions.length + 1,
          question: fixed.question,
          options: finalOptions,
          answer,
          analysis: formatAnswerAnalysisForReview(answer, (current.analysisLines || []).join('\n').trim()),
          group: current.group || '',
          volume: current.volume || '',
        });
        current = null;collectingSubjectiveAnswerV58917 = false;
      };

      const beginQuestion = (number, lineAfterNo) => {
        flush();
        current = { number, questionLines: [], options: [], answer: [], analysisLines: [], subjectiveAnswerLinesV58917: [], group: currentType, volume: currentVolume, type: mapType(currentType) || '', explicitType: false };
        if (lineAfterNo) { current.questionLines.push(lineAfterNo.trim()); }
      };

      for (let i = 0;i < lines.length;i += 1) {
        let line = lines[i];
        const numberedTypedLineV592 = getNumberedTypeQuestionLineV592(line);
        const forcedLineTypeV592 = numberedTypedLineV592?.type || '';
        if (numberedTypedLineV592) { line = `${numberedTypedLineV592.number}. ${numberedTypedLineV592.stem}`; }

        const nextLines = lines.slice(i + 1, i + 9);
        if (isVolumeHeading(line)) { flush();currentVolume = getVolumeLabel(line);continue; }

        if (isChapterHeadingV58911(line, nextLines)) { flush();continue; }

        const heading = getHeadingType(line);
        if (heading) { flush();currentType = heading;continue; }

        if (isImportNoiseLine(line)) { continue; }

        if (current && collectingSubjectiveAnswerV58917) {
          if (isAnalysisLine(line)) { collectingSubjectiveAnswerV58917 = false; } else if (!isDefiniteQuestionBoundaryAfterSubjectiveAnswerV58917(line, Number(current.number) || 0, nextLines)) {
            current.subjectiveAnswerLinesV58917 = current.subjectiveAnswerLinesV58917 || [];
            current.subjectiveAnswerLinesV58917.push(line);continue;
          } else { collectingSubjectiveAnswerV58917 = false; }
        }

        if (current && isStandaloneAnswerHeaderV58917(line)) {
          const currentContextTypeV58917 = current.type || inferQuestionTypeFromPromptV592((current.questionLines || []).join(' '), current.group || currentType || '');
          if (currentContextTypeV58917 === 'short' || mapType(current.group || currentType || '') === 'short') {
            current.type = 'short';current.subjectiveAnswerLinesV58917 = current.subjectiveAnswerLinesV58917 || [];collectingSubjectiveAnswerV58917 = true;collectingAnalysis = false;continue;
          }
        }

        // Handle 答案解析 prefix: strip and re-process as answer content
        if (/^答案解析\s*\d/.test(line)) {
          // 去掉独立答案解析标题，才能识别其同行的编号答案。
          const after = line.replace(/^答案解析\s*/, '');
          if (hasPendingAnalysis()) { current.analysisLines.push(after);collectingAnalysis = false; }

          // 兼容单个编号答案后自带明确的解析标签。
          const combinedM = after.match(/^(\d{1,4})\s*[.、．]\s*(?:【答案】\s*)?([A-Ga-g]{1,7})\s*(?:【解析】\s*(.*))?$/);
          if (combinedM) {
            flush();current = { number: Number(combinedM[1]), questionLines: [], options: [], answer: splitAnswerByType(combinedM[2], currentType || ''), analysisLines: combinedM[3] ? [combinedM[3].trim()] : [], group: currentType, volume: currentVolume, type: mapType(currentType) || '' };collectingAnalysis = !!combinedM[3];
          } else {
            // 从紧凑答案表提取编号和选项，答案后应为新标记或行尾。
            const compactReg = /(\d{1,4})\s*[.、．]\s*([A-Ga-g]{1,7})\s*(?=【|$)/g;let cm;const pairs = [];
            while ((cm = compactReg.exec(after)) !== null) { pairs.push({ no: Number(cm[1]), ans: cm[2] }); }

            if (pairs.length) {
              flush();
              for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
                const p = pairs[pairIndex];
                if (pairIndex > 0) { flush(); }

                current = { number: p.no, questionLines: [], options: [], answer: splitAnswerByType(p.ans, currentType || ''), analysisLines: [], group: currentType, volume: currentVolume, type: mapType(currentType) || '' };
              }
            } else {
              current.answer = splitAnswerByType(after, current.type || '');
            }
          }

          continue;
        }

        // Handle 解析 continuation lines (e.g., 2．【解析】C。explanation)
        const analysisNum = line.match(/^\s*(\d{1,4})\s*[.、．]\s*【解析】\s*([A-Ga-g]{1,7})\s*[。.]?\s*(.*)$/);
        if (analysisNum) {
          if (hasPendingAnalysis()) { current.analysisLines.push(line);collectingAnalysis = false; } else { flush();current = { number: Number(analysisNum[1]), questionLines: [], options: [], answer: splitAnswerByType(analysisNum[2], currentType || ''), analysisLines: analysisNum[3] ? [analysisNum[3].trim()] : [], group: currentType, volume: currentVolume, type: mapType(currentType) || '' };collectingAnalysis = !!analysisNum[3]; }

          continue;
        }

        // Handle combined 【答案】...【解析】... format (e.g., 21.【答案】C【解析】explanation)
        const combined = line.match(/^\s*(\d{1,4})\s*[.、．]\s*【答案】\s*([A-Ga-g]{1,7})\s*【解析】\s*(.*)$/);
        if (combined) {
          flush();
          current = { number: Number(combined[1]), questionLines: [], options: [], answer: splitAnswerByType(combined[2], currentType || ''), analysisLines: combined[3] ? [combined[3].trim()] : [], group: currentType, volume: currentVolume, type: mapType(currentType) || '' };
          collectingAnalysis = !!combined[3];
          continue;
        }

        // Handle compact multi-answer lines (e.g., 1.A    2.B    3.C)
        const compactPairs = line.match(/^(\d{1,4})\s*[.、．]\s*(?:【答案】\s*)?([A-Ga-g]{1,7})\s*(?:【解析】\s*[^\d]*?)?(?=\s+\d{1,4}\s*[.、．]|\s*$)/);
        // 只有同一行明确出现多个编号字母对时，才按短答案表分拆。
        if (compactPairs && /\d{1,4}\s*[.、．]\s*[A-Ga-g]{1,7}.*\d{1,4}\s*[.、．]\s*[A-Ga-g]{1,7}/.test(line)) {
          // 提取同一短答案表中的编号、选项和可选解析，以下一题或行尾结束。
          const compactReg = /(\d{1,4})\s*[.、．]\s*(?:【答案】\s*)?([A-Ga-g]{1,7})\s*(?:【解析】\s*([^\d]*?))?(?=\s+\d{1,4}\s*[.、．]|\s*$)/g;let cm;const pairs = [];
          while ((cm = compactReg.exec(line)) !== null) { pairs.push({ no: Number(cm[1]), ans: cm[2], analysis: (cm[3] || '').trim() }); }

          if (hasPendingAnalysis()) { collectingAnalysis = false; }

          for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
            const p = pairs[pairIndex];
            if (pairIndex === 0 && current && current.number === p.no && !current.answer.length) { current.answer = splitAnswerByType(p.ans, current.type || '');if (p.analysis) { current.analysisLines.push(p.analysis); } } else { flush();current = { number: p.no, questionLines: [], options: [], answer: splitAnswerByType(p.ans, currentType || ''), analysisLines: p.analysis ? [p.analysis] : [], group: currentType, volume: currentVolume, type: mapType(currentType) || '' }; }
          }

          if (pairs.length) { continue; }
        }

        // 识别行首的括号题号或带“第”“题”的普通题号，保留同一行题干。
        const qm = line.match(/^\s*(?:[【[]\s*(\d{1,4})\s*[】\]]|(?:第\s*)?(\d{1,4})\s*(?:题)?[.、．:：]?)\s*(.*)$/);
        const narrativeEnumerationV58923 = isNumberedNarrativeEnumerationV58923(line, currentType);
        const boundaryRichV58923 = extractInlineOptionsRich(line);
        const numberedStemRichFalsePositiveV58923 = isNumberedQuestionRichOptionFalsePositiveV58923(line, boundaryRichV58923);
        const optionLike = narrativeEnumerationV58923 ? false : (isOptionLine(line) || (!numberedStemRichFalsePositiveV58923 && !!boundaryRichV58923) || splitInlineOptions(line).length >= 2);
        if (qm && !optionLike) {
          beginQuestion(Number(qm[1] || qm[2]), stripLeadingQuestionTypeLabelV592(qm[3] || ''));
          if (forcedLineTypeV592 && current) { current.type = forcedLineTypeV592;current.explicitType = true; }

          continue;
        }

        if (!current) { continue; }

        const contextualTypeV592 = current.type || inferQuestionTypeFromPromptV592((current.questionLines || []).join(' '), current.group || currentType || '');
        const inlineAnswerTag = extractInlineAnswerTag(line, contextualTypeV592);
        if (inlineAnswerTag.answer.length) {
          if (shouldAdoptContextualType(current.type, contextualTypeV592)) { current.type = contextualTypeV592; }

          current.answer.push(...inlineAnswerTag.answer);line = inlineAnswerTag.text;
        }

        const trailingAnswer = extractTrailingAnswerFromText(line, contextualTypeV592);
        if (trailingAnswer.answer.length && !isAnswerLine(line)) {
          if (shouldAdoptContextualType(current.type, contextualTypeV592)) { current.type = contextualTypeV592; }

          current.answer.push(...trailingAnswer.answer);line = trailingAnswer.text;
        }

        if (isAnswerLine(line)) {
          // 在独立答案行中移除中英文标签和分隔符，不丢弃作答正文。
          const stripped = line.replace(/^(?:【|\[)?\s*(?:正确答案|参考答案|标准答案|答案解析|答案|参考要点|答题要点|Answer|Correct\s*answer)\s*(?:】|\])?\s*[:：]?\s*/i, '').trim();
          const answerTypeV592 = current.type || contextualTypeV592 || '';
          // 识别答案行自带的编号、字母答案和解析段。
          const ca = stripped.match(/^(\d{1,4})\s*[.、．]\s*(?:【答案】\s*)?([A-Ga-g]{1,7})\s*【解析】\s*(.*)$/);
          if (ca) { current.answer = splitAnswerByType(ca[2], answerTypeV592);current.analysisLines = [ca[3].trim()];collectingAnalysis = true; } else {
            current.answer = splitAnswerByType(stripped, answerTypeV592);if (!current.type && answerTypeV592) { current.type = answerTypeV592; }

            collectingAnalysis = false;
          }

          continue;
        }

        if (isAnalysisLine(line)) { current.analysisLines.push(line.replace(/* 写入独立解析字段时移除“考点”等解析标题及冒号。 */ /^(?:【|\[)?\s*(?:解析|答案解析|试题解析|说明|考点)\s*(?:】|\])?\s*[:：]?\s*/i, '').trim());collectingAnalysis = true;continue; }

        let rich = extractInlineOptionsRich(line);
        if (preferLeadingStandaloneOptionV58923(line, rich)) { rich = null; }

        if (rich && rich.options.length >= 2) {
          if (rich.prefix) { current.questionLines.push(rich.prefix); }

          for (const it of rich.options) {
            const key = normalizeOptionKey(it.key);let txt = (it.text || '').trim();
            if (hasCorrectOptionMark(it, txt)) { current.answer.push(key);txt = removeCorrectMark(txt); }

            if (it.extraAnswer && it.extraAnswer.length) { current.answer.push(...it.extraAnswer); }

            if (txt) { current.options.push({ key, text: txt }); }
          }

          continue;
        }

        const inline = narrativeEnumerationV58923 ? [] : splitInlineOptions(line);
        if (inline.length >= 2) {
          for (const it of inline) {
            const key = normalizeOptionKey(it.key);let txt = (it.text || '').trim();
            if (hasCorrectOptionMark(it, txt)) { current.answer.push(key);txt = removeCorrectMark(txt); }

            if (txt) { current.options.push({ key, text: txt }); }
          }

          continue;
        }

        const bareEnglishStemWithoutQuestionV5982 = !(current.questionLines || []).length && !(current.options || []).length && isBareEnglishStemStartV5982(line);
        // 兼容括号、字母和数字选项，以及前面可能自带的勾选标记。
        const om = bareEnglishStemWithoutQuestionV5982 ? null : line.match(/^\s*([oOxXuUyYvV√✔✓])?\s*(?:[（(]\s*([A-Ga-g1-90])\s*[）)]|([A-Ga-g0])\s*(?:[、.．:：，,]|\s+))\s*(.*)$/);
        if (om) {
          const key = normalizeOptionKey(om[2] || om[3]); let txt = (om[4] || '').trim();
          if (om[1] || hasCorrectMark(txt)) { current.answer.push(key);txt = removeCorrectMark(txt); }

          if (txt) { current.options.push({ key, text: txt }); }

          continue;
        }

        if (collectingAnalysis) { current.analysisLines.push(line);continue; }

        if (current.options.length) {
          current.options[current.options.length - 1].text = (`${current.options[current.options.length - 1].text} ${line}`).trim();
        } else {
          current.questionLines.push(line);
        }
      }

      flush();
      return questions.map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question && (q.options.length || q.answer.length || q.type === 'judge' || isTextType(q.type)));
    }

    // 将试卷先按卷切分，再分别交给结构化解析器，以保留跨卷重号。
    function parseByVolumeAndSections(text) {
      const s = preSplitVolumeAndCompactQuestions(repairDocxLostQuestionNumberLines(normalizeImportText(text)));
      const lines = s.split('\n').map((x) => x.trim()).filter(Boolean);
      const blocks = [];let volume = '';let group = '';let section = [];
      // 解析当前卷的累计行，并对各题保留所属卷标签。
      const flush = () => {
        if (section.length) {
          if (!group && !section.some((l) => looksLikeNewQuestionLine(l, group) || hasStrongQuestionNo(l) || hasInlineAnswerTag(l))) { section = [];return; }

          const sub = splitQuestionBlocks(section.join('\n'), group);
          sub.forEach((b) => blocks.push({ ...b, volume: volume || b.volume || '', group: group || b.group || '' }));

          section = [];
        }
      };

      for (const line of lines) {
        if (isVolumeHeading(line)) { flush();volume = getVolumeLabel(line);group = '';continue; }

        const h = getHeadingType(line);if (h) { flush();group = h;continue; }

        if (isImportNoiseLine(line)) { continue; }

        section.push(line);
      }

      flush();
      return blocks.map((b, i) => parseBlock({ ...b, volume: b.volume || volume, group: b.group || group }, i)).filter((q) => q && q.question && (q.options.length || q.answer.length || q.type === 'judge' || isTextType(q.type))).map((q, i) => normalizeQuestion(q, i));
    }

    // 兼容普通导入文本和历史 Word XML，统一后续识别依赖的字符形式。
    function normalizeImportText(text) {
      let raw = String(text || '');
      // 识别含完整 Word 文本节点的 XML，以优先保留 Word 结构。
      if (/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/.test(raw)) {
        try {
          const extracted = docxXmlToText(raw);
          if (extracted && extracted.trim()) { raw = extracted; } else {
            const parts = [];let m;const re = /* Word 文档解析失败时，仍读取独立文本节点保留可见内容。 */ /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
            while ((m = re.exec(raw))) { parts.push(decodeXml(m[1])); }

            if (parts.length) { raw = parts.join('\n'); }
          }
        } catch (err) {
          warnDev('Word XML 文本提取失败，使用兜底提取。', err);
          const parts = [];let m;const re = /* 环境没有 Word 专用解析器时，兼容直接取出文本节点。 */ /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
          while ((m = re.exec(raw))) { parts.push(decodeXml(m[1])); }

          if (parts.length) { raw = parts.join('\n'); }
        }
      }

      // 若仍存在 Word XML 标签前缀，使用剩余标签清理路径。
      if (/<w:/.test(raw)) {
        raw = raw.replace(/* 将 Word 文本节点开头换成换行，保留后续分块可能依赖的边界。 */ /<w:t(?:\s[^>]*)?>/g, '\n').replace(/* 去掉 XML 包装标签后再解码文本实体。 */ /<[^>]+>/g, '').split('\n').map((x) => decodeXml(x).trim()).filter(Boolean).join('\n');
      }

      return raw
        .replace(/* 去掉残留回车，使换行处理统一使用 LF。 */ /\r/g, '')
        .replace(/* 将不换行空格还原为常规空格。 */ /\u00a0/g, ' ')
        .replace(/* 编辑器插入的零宽字符和 BOM 不应妨碍行首题号匹配。 */ /[\u200b\ufeff]/g, '')
        .replace(/* 将 Word 排版生成的全角 A–G 字母转回选项识别使用的半角。 */ /[Ａ-Ｇａ-ｇ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        .replace(/* 将全角数字转回半角，保持题号解析兼容。 */ /[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    }

    // 依据 Word 富文本证据、章节和现有题号判断是否启用缺号恢复。
    function shouldApplyDocxLostQuestionNumberRepairV584(text) {
      const s = String(text || '');
      if (!s.trim()) { return false; }

      // Word 表格、公式、图片占位和内嵌图片为缺号启发式提供文档来源证据。
      const hasDocxRich = /【DOCX表格开始】|【DOCX公式OMML：|\[\[DOCX_IMAGE_\d+\]\]|!\[[^\]]*\]\(data:image\//.test(s);
      // 统计明确的行首章标题，兼容中文与数字章号。
      const chapterCount = (s.match(/(?:^|\n)\s*第[一二三四五六七八九十百千万0-9]+章/g) || []).length;
      // 统计完整占行的题型标题，排除普通正文提及题型的情况。
      const typeSectionCount = (s.match(/(?:^|\n)\s*(?:单项选择题|单选题|单选|多项选择题|多选题|多选|判断题|判断|填空题|填空|简答题|简答)\s*(?:$|\n)/g) || []).length;
      // 统计带明确编号标点的题目，作为已知题号密度。
      const strongNoCount = (s.match(/(?:^|\n)\s*(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]/g) || []).length;
      // 统计紧接正文但没有题号标点的短行首数字。
      const noPuncNoCount = (s.match(/(?:^|\n)\s*\d{1,3}(?=[^\d\s、.．:：）)\]】])/g) || []).length;
      // v58.4：这类补题号/补标点是给 DOCX 多章节、富文本抽取损失做的兜底，不能默认污染标准纯文本主线。
      if (hasDocxRich && strongNoCount >= 1) { return true; }

      if (chapterCount >= 2 && strongNoCount >= 8) { return true; }

      if (typeSectionCount >= 2 && strongNoCount >= 8 && noPuncNoCount >= 1) { return true; }

      if (noPuncNoCount >= 2 && strongNoCount >= 8 && /* 行首独立 A 选项为缺号恢复补充选择题证据。 */ /(?:^|\n)\s*A\s*[、.．:：，,\s]/i.test(s) && /* 同时要求独立 B 选项，避免只凭偶然 A 字母启用缺号修复。 */ /(?:^|\n)\s*B\s*[、.．:：，,\s]/i.test(s)) { return true; }

      return false;
    }

    // 只在连续题号、附近选项和题干证据吻合时恢复 Word 遗失的题号标点。
    function repairDocxLostQuestionNumberLines(text) {
      if (!shouldApplyDocxLostQuestionNumberRepairV584(text)) { return String(text || ''); }

      const lines = String(text || '').split('\n');
      const out = [];let pendingFirst = 0;let lastQuestionNo = 0;
      const isChapterLike = (s) => /* 章标题是题号推断的上下文边界。 */ /^第[一二三四五六七八九十百千万0-9]+章/.test(String(s || '').replace(/* 比对章标题前折叠分散排版的空白。 */ /\s+/g, ''));

      const strongNoOf = (s) => {
        const t = String(s || '').trim();
        const m = t.match(/* 读取普通编号题号，供约束可补标点的候选。 */ /^\s*(?:第\s*)?(\d{1,4})\s*(?:题)?[、.．:：]/) || t.match(/* 兼容括号题号充当同样的前后锚点。 */ /^\s*[（(【[]\s*(\d{1,4})\s*[）)】\]]/);
        return m ? Number(m[1]) : 0;
      };

      const looksLikeChoiceA = (s) => /* 查找带分隔符的半角 A 选项首行。 */ /^\s*A\s*[、.．:：，,\s]/i.test(String(s || '')) || /* 兼容排版中未转换的全角 A 选项。 */ /^\s*Ａ\s*[、.．:：，,\s]/.test(String(s || ''));

      const looksLikeChoiceB = (s) => /* 查找带分隔符的半角 B 选项首行。 */ /^\s*B\s*[、.．:：，,\s]/i.test(String(s || '')) || /* 兼容排版中未转换的全角 B 选项。 */ /^\s*Ｂ\s*[、.．:：，,\s]/.test(String(s || ''));

      const hasInlineAB = (s) => /* 同行内近距离相继出现 A 和 B 也能证明该题有选项。 */ /A\s*[、.．:：，,\s].{0,100}B\s*[、.．:：，,\s]/i.test(String(s || ''));

      // 查找题干附近可靠的成组选项证据，避免给资料数字误加题号。
      const hasNearbyOptions = (idx) => {
        let a = false; let b = false; let seen = 0;
        for (let j = idx + 1;j < lines.length && seen < 8;j += 1) {
          const t = String(lines[j] || '').trim();if (!t) { continue; }

          seen += 1;
          if (isChapterLike(t) || getHeadingType(t) || isVolumeHeading(t)) { break; }

          if (looksLikeChoiceA(t) || /* 补充识别 OCR 紧贴标点的简短 A 标签。 */ /^\s*A[.．、:：]/i.test(t) || hasInlineAB(t)) { a = true; }

          if (looksLikeChoiceB(t) || /* 补充识别 OCR 紧贴标点的简短 B 标签。 */ /^\s*B[.．、:：]/i.test(t) || hasInlineAB(t)) { b = true; }
        }

        return a && b;
      };

      // 读取后续已知题号来限定缺号候选的范围。
      const nextStrongNo = (idx) => {
        let seen = 0;
        for (let j = idx + 1;j < lines.length && seen < 14;j += 1) {
          const t = String(lines[j] || '').trim();if (!t) { continue; }

          seen += 1;
          if (isChapterLike(t) || getHeadingType(t) || isVolumeHeading(t)) { break; }

          const n = strongNoOf(t);if (n) { return n; }
        }

        return 0;
      };

      // 要有题干语义和选项等局部证据才允许补入题号。
      const canBeQuestionWithoutNumber = (s, idx) => {
        const t = String(s || '').trim();
        if (!t || strongNoOf(t) || isOptionLine(t) || isAnswerLine(t) || isAnalysisLine(t) || getHeadingType(t) || isImportNoiseLine(t) || isChapterLike(t)) { return false; }

        if (t.length < 8) { return false; }

        // 常见问句、定义和括号提示提供独立题干的识别线索。
        if (!/[（(][^）)]{0,80}[）)]|[?？。]$|称为|属于|是|指/.test(t)) { return false; }

        return hasNearbyOptions(idx);
      };

      for (let i = 0;i < lines.length;i += 1) {
        let raw = lines[i];let t = String(raw || '').trim();
        if (!t) { out.push(raw);continue; }

        if (isChapterLike(t) || getHeadingType(t) || isVolumeHeading(t)) {
          pendingFirst = 4;lastQuestionNo = 0;out.push(raw);continue;
        }

        const originalStrong = strongNoOf(t);
        if (pendingFirst > 0 && canBeQuestionWithoutNumber(t, i)) {
          raw = String(raw).replace(t, `1．${t}`);t = String(raw).trim();pendingFirst = 0;
        } else if (canBeQuestionWithoutNumber(t, i)) {
          const nextNo = nextStrongNo(i);
          if (lastQuestionNo > 0 && nextNo === lastQuestionNo + 2) {
            raw = String(raw).replace(t, `${lastQuestionNo + 1}．${t}`);t = String(raw).trim();
          }
        } else if (pendingFirst > 0 && !isImportNoiseLine(t)) {
          pendingFirst -= 1;
        }

        // DOCX/Word 有时会丢失题号后的标点，如“3下列……”。只在后续邻近存在 A/B 选项时补回，避免误伤普通数字文本。
        const noPunc = t.match(/^(\d{1,3})(?=[^\d\s、.．:：）)\]】])/);
        if (noPunc && hasNearbyOptions(i)) {
          // 仅对行首尚未跟编号标点的短数字补全角句点。
          raw = String(raw).replace(/^(\s*\d{1,3})(?=[^\d\s、.．:：）)\]】])/, '$1．');
          t = String(raw).trim();
        }

        const n = strongNoOf(t);
        if (n) { lastQuestionNo = n; } else if (originalStrong) { lastQuestionNo = originalStrong; }

        out.push(raw);
      }

      return out.join('\n');
    }

    // 先恢复卷标题及行内题号边界，再交给标准分块规则。
    function preSplitVolumeAndCompactQuestions(text) {
      let s = String(text || '');
      // 支持“单选题 1 / 判断题 31 / 多选题 115”这种标准导出题头：强制独占一行，避免整卷粘连。
      s = s.replace(/([^\n])\s+((?:单选题|单选|单项选择题|多选题|多选|多项选择题|判断题|判断|填空题|填空|简答题|简答|问答题)\s*(?:第\s*)?\d{1,4}\s*(?:题)?)(?=\s+\S)/g, '$1\n$2\n');
      // 独立题型标题和数字题号后已有正文时，为两者补出分行。
      s = s.replace(/(^|\n)\s*((?:单选题|单选|单项选择题|多选题|多选|多项选择题|判断题|判断|填空题|填空|简答题|简答|问答题)\s*(?:第\s*)?\d{1,4}\s*(?:题)?)\s+(?=\S)/g, '$1$2\n');
      // 让“第一卷/第二卷/第1套/试卷一”等标题独占一行，避免卷内重复 1-25 题被拼接。
      s = s.replace(/(^|\n|[ \t]{2,}|[。；;])\s*((?:第\s*[一二三四五六七八九十百千万0-9]+\s*(?:卷|套|部分|单元)|试卷\s*[一二三四五六七八九十百千万0-9]+|卷\s*[一二三四五六七八九十百千万0-9]+))(?=\s*(?:$|\n|(?:单选题|单选|单项选择题|多选题|多选|多项选择题|判断题|判断|填空题|填空|简答题|简答|问答题)|(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]))/gm, (m, prefix, heading) => `${prefix || '\n'}\n${heading}\n`);

      // 若多个题目在同一段里，用题号强制切题。
      // 增强：避免把选项值“A. 1.O m / B.1.2 m”里的“1.O”误认为新题号。
      s = s.replace(/([^\n])\s+((?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]\s*(?!\s*\d)(?!mm|cm|m|MPa|bar|kg|℃|%))/gi, /* 检查粘连编号前后的选项和测量值证据，避免把 OCR 小数当成题号。 */ (m, prev, next, offset, full) => {
        const before = full.slice(Math.max(0, offset - 8), offset + 1);
        // 保留前面有 A–G 选项标签的数字或单位描述。
        if (/[A-Ga-g0]\s*[、.．:：]\s*$/.test(before)) { return `${prev} ${next}`; }

        // 保留 OCR 中小数点后错识为字母 O 或 I 的选项值。
        if (/^\d+\s*[.．]\s*[OoIl]\b/.test(next)) { return `${prev} ${next}`; }

        return `${prev}\n${next}`;
      });

      // 答案标记后面紧跟下一题题号时切开。
      s = s.replace(/([】\])）])\s+(?=(?:第\s*)?\d{1,3}\s*(?:题)?[、.．:：])/g, '$1\n');
      // 兼容“题干【答案：B.20mm】 A...;B...;C...”这种紧凑格式：先把答案标记前后留出边界。
      s = s.replace(/[ \t]*(【\s*(?:正确答案|参考答案|标准答案|答案)\s*[:：][^】]{1,80}】)[ \t]*/g, ' $1 ');
      return s;
    }

    // 识别简短的卷、套或单元标题，并兼容带年份及简短副标题的试卷。
    function isVolumeHeading(line) {
      const raw = String(line || '').trim();
      // 忽略标题内部空白，以识别 Word 的分散排版。
      const s = raw.replace(/\s/g, '');
      // 匹配没有副标题的卷、套、部分或单元编号。
      if (/^(?:第[一二三四五六七八九十百千万0-9]+(?:卷|套|部分|单元)|试卷[一二三四五六七八九十百千万0-9]+|卷[一二三四五六七八九十百千万0-9]+)$/.test(s)) { return true; }

      // 兼容年份、试卷名称与末尾卷号连排的标题。
      if (/^202\d年.*(?:试卷|考试).*?[·._-]?[一二三四五六七八九十百千万0-9]+卷$/.test(s)) { return true; }

      // 允许短副标题，但拒绝包含一般题干句末标点的文本。
      return /^(?:第\s*[一二三四五六七八九十百千万0-9]+\s*(?:卷|套|部分|单元)|试卷\s*[一二三四五六七八九十百千万0-9]+|卷\s*[一二三四五六七八九十百千万0-9]+)(?:\s+|[-—_:：·.．]\s*)[^。？！?!；;]{1,24}$/.test(raw);
    }

    // 优先归一标题中的卷号，无法提取时保留经过空白整理的原标签。
    function getVolumeLabel(line) {
      // 折叠原始卷标题的空白并保留可读的单空格。
      const raw = String(line || '').replace(/[\s\u3000]+/g, ' ').trim();
      // 提取尾部卷号时忽略可能分开字符的空白。
      const compact = raw.replace(/\s/g, '');
      // 识别标题末尾的中文或数字卷编号。
      const m = compact.match(/([一二三四五六七八九十百千万0-9]+)卷$/);
      if (m) { return `第${m[1]}卷`; }

      return raw;
    }

    function hasInlineAnswerTag(line) {
      const s = String(line || '');
      // 识别括号内带明确答案标题和冒号的行内答案标记。
      return /[【[（(]\s*(?:正确答案|参考答案|标准答案|答案|参考要点|答题要点)\s*[:：]/i.test(s)
    || /* 也接受在行首或空白边界后以答案标题直接引出正文的格式。 */ /(?:^|\s)(?:正确答案|参考答案|标准答案|答案|参考要点|答题要点)\s*[:：]\s*\S+/i.test(s);
    }

    // 判断题干中的短括号内容是否真为该题型允许的答案，避免误拆正文括注。
    function hasEmbeddedAnswerStem(line, group = '') {
      const raw = String(line || '').trim();
      if (!raw || isOptionLine(raw) || isAnswerLine(raw) || isAnalysisLine(raw) || getHeadingType(raw) || isImportNoiseLine(raw)) { return false; }

      if (hasInlineAnswerTag(raw)) { return true; }

      const gt = mapType(group);
      // 只检查长度受限且不嵌套的括号内容。
      const m = raw.match(/[（(]\s*([^()（）]{1,100})\s*[）)]/);
      if (!m) { return false; }

      const inner = m[1].trim();
      if (!inner) { return false; }

      // 比对选项答案前移除不同的中英文分隔符。
      const compact = inner.replace(/[\s,，、;；/\\]+/g, '').toUpperCase();
      // 对错、勾叉和真假词是可识别的判断题答案。
      const pureJudgeInner = /^(?:对|错|正确|错误|是|否|√|✓|✔|×|X|x|v|V|T|F|True|False)$/i.test(inner);
      const choiceInner = /* 连续 A–G 字母支持选择题括号答案。 */ /^[A-G]{1,7}$/.test(compact) || /* 允许用数字选项序号填写答案。 */ /^[1-9]{1,9}$/.test(compact);
      if (gt === 'judge') { return pureJudgeInner; }

      if (gt === 'multiple') { return /* 多选分区至少需要两个字母选项才接受括号内答案。 */ /^[A-G]{2,7}$/.test(compact) || /* 以数字编号书写的多选答案同样至少需要两项。 */ /^[1-9]{2,9}$/.test(compact); }

      if (gt === 'single') { return /* 单选分区的括号答案必须只含一个选项字母。 */ /^[A-G]$/.test(compact) || /* 单个数字也能作为单选题选项答案。 */ /^[1-9]$/.test(compact); }

      // 没有分区上下文时，仅接受强题号题干中的明确括号答案，避免普通题干括号污染触发错误切题。
      if (!gt && hasStrongQuestionNo(raw)) { return pureJudgeInner || choiceInner; }

      return false;
    }

    function looksLikeNewQuestionLine(line, group = '') {
      if (isOptionLine(line) || isAnswerLine(line) || isAnalysisLine(line) || getHeadingType(line) || isImportNoiseLine(line)) { return false; }

      return !!getNumberedTypeQuestionHeader(line) || hasStrongQuestionNo(line) || !!detectType(line) || hasEmbeddedAnswerStem(line, group) || isQuestionStart(line);
    }

    // 使用明确答案标题取出题干中的括号答案，同时保留题干和合法答案。
    function extractInlineAnswerTag(line, type) {
      let s = String(line || '');const answers = [];
      // 识别用中式或方括号圈住的短标题答案。
      s = s.replace(/[【[]\s*(?:正确答案|参考答案|标准答案|答案)\s*[:：]?\s*([^】\]]{1,100})\s*[】\]]/gi, (m, a) => {
        answers.push(...splitAnswerByType(a, type));return ' ';
      });

      // 兼容同一答案提示用圆括号包裹的排版。
      s = s.replace(/[（(]\s*(?:正确答案|参考答案|标准答案|答案)\s*[:：]?\s*([^）)]{1,100})\s*[）)]/gi, (m, a) => {
        answers.push(...splitAnswerByType(a, type));return ' ';
      });

      // 移除答案后折叠正文空白，避免保留过宽的题干间隔。
      return { text: s.replace(/\s+/g, ' ').trim(), answer: answers };
    }

    // 仅有足够的选项标签和答案一致性证据时，才按中英文分号拆行内选项。
    function splitSemicolonOptionsFromLine(line, answer = []) {
      const raw = String(line || '').trim();
      // 没有中英文分号时，跳过此行内分隔策略。
      if (!raw || !/[;；]/.test(raw)) { return null; }

      // 按 Word 或纯文本常用的中英文分号分开候选选项。
      const parts = raw.split(/[;；]/).map((x) => x.trim()).filter(Boolean);
      if (parts.length < 2 || parts.length > 8) { return null; }

      // 显式标号选项里的分号属于选项内容，不能再按分号兜底拆选项。
      // 例如：A. 人民；经济 / B. 人民；生命，应保持为完整 A/B 选项。
      // 只有 A...；B...；C... 这类每段都带选项标号的紧凑写法，才允许继续拆。
      const startsWithExplicitOption = /^\s*(?:[oOxXuUyYvV√✔✓]\s*)?(?:[（(]\s*[A-Ga-g1-9]\s*[）)]|[A-Ga-g]\s*(?:[、.．:：，,]|\s+|(?=[\u4e00-\u9fa5])))/.test(raw);
      if (startsWithExplicitOption) {
        const labeledCount = parts.filter((part) => /* 统计有明确标签的候选段，避免把普通带分号正文误作选项。 */ /^\s*(?:[oOxXuUyYvV√✔✓]\s*)?(?:[（(]\s*[A-Ga-g1-9]\s*[）)]|[A-Ga-g]\s*[、.．:：，,])/.test(part)).length;
        if (labeledCount < 2) { return null; }
      }

      const opts = [];
      for (let i = 0;i < parts.length;i += 1) {
        const part = parts[i];
        // 从各片段首部读取可选标点分隔的选项字母和正文。
        const m = part.match(/^([A-Ga-g])\s*[、.．:：]?\s*(.+)$/);
        if (m) { opts.push({ key: m[1].toUpperCase(), text: m[2].trim() }); } else if (i === 0) { opts.push({ key: 'A', text: part }); } else { opts.push({ key: String.fromCharCode(65 + i), text: part }); }
      }

      // 如果答案写成 B.20mm，而选项中有 “20mm”，优先映射到 B。
      (answer || []).map((x) => String(x || '')).join(' ');

      return opts.some((o) => o.text) ? opts : null;
    }

    /* SHIROHA_WEB_V58_9_11_OVERSPLIT_SECTION_AWARE_ANSWER */
    function isChapterHeadingV58911(line, nextLines = []) {
      const raw = String(line || '').trim();
      if (!raw || raw.length > 60 || isOptionLine(raw) || isAnswerLine(raw) || isAnalysisLine(raw) || hasStrongQuestionNo(raw) || getHeadingType(raw)) { return false; }

      // 章标题证据不受普通和全角空格影响。
      const compact = raw.replace(/[\s\u3000]+/g, '');
      // 明确的章、节、单元或篇编号可直接确认分区标题。
      if (/^(?:第[一二三四五六七八九十百千万0-9]+(?:章|节|单元|篇)|章节[一二三四五六七八九十百千万0-9]+)[^。？！?!；;]{0,36}$/.test(compact)) { return true; }

      // 模块、专题或括号编号的短标题需结合后续题目证据判断。
      const scoped = /^(?:模块[一二三四五六七八九十百千万0-9]+|专题[一二三四五六七八九十百千万0-9]+|[（(][一二三四五六七八九十百千万0-9]+[）)]|[一二三四五六七八九十]+[、.．:：])[^。？！?!；;]{0,32}$/.test(compact);
      if (!scoped) { return false; }

      const look = (nextLines || []).slice(0, 8).map((x) => String(x || '').trim()).filter(Boolean);
      return look.some((l) => hasStrongQuestionNo(l) || isAnswerAnalysisEntryLine(l) || /* 后续独立行的短题号是候选分区标题有效的补充证据。 */ /^\d{1,4}\s*[.、．:：]\s*$/.test(l));
    }

    function normalizeSectionLabelV58911(value) {
      return String(value || '').replace(/* 卷章分组比较忽略普通和全角空白。 */ /[\s\u3000]+/g, '').replace(/* 消除标题外层括号和常见连接标点，兼容相同分区的不同排版。 */ /[【】[\]()（）:：、，,。．.；;_-]+/g, '').toLowerCase();
    }

    // 从题目字段和来源元数据提取卷、章及分组，用于约束答案匹配。
    function sectionPartsForQuestionV58911(q) {
      const meta = getSourceMetaV58910(q) || {};
      return {
        volume: normalizeSectionLabelV58911(meta.volume || q?.volume || ''),
        chapter: normalizeSectionLabelV58911(meta.chapter || q?.chapter || ''),
        group: normalizeSectionLabelV58911(meta.group || q?.group || q?.category || ''),
        groupType: sectionKeyFromText(meta.group || q?.group || q?.category || ''),
      };
    }

    // 统一可从答案条目取得的分区信息，避免跨卷章同号误合并。
    function sectionPartsForAnswerEntryV58911(entry) {
      return {
        volume: normalizeSectionLabelV58911(entry?.volume || ''),
        chapter: normalizeSectionLabelV58911(entry?.chapter || ''),
        group: normalizeSectionLabelV58911(entry?.group || ''),
        groupType: sectionKeyFromText(entry?.group || ''),
      };
    }

    function sameSourceSectionV58911(a, b) {
      return normalizeSectionLabelV58911(a?.volume || '') === normalizeSectionLabelV58911(b?.volume || '')
    && normalizeSectionLabelV58911(a?.chapter || '') === normalizeSectionLabelV58911(b?.chapter || '')
    && normalizeSectionLabelV58911(a?.group || '') === normalizeSectionLabelV58911(b?.group || '');
    }

    // 将明确题号、卷章和题型标题作为边界，同时保护尚未包含提问的表格材料。
    function splitQuestionBlocks(text, inheritedGroup = '') {
      const lines = text.split('\n').map((x) => x.trim()).filter(Boolean);
      const blocks = [];let cur = [];let group = inheritedGroup || '';let curGroup = group;let volume = '';let curVolume = '';let chapter = '';let curChapter = '';let collectingSubjectiveAnswerV58917 = false;let currentQuestionNumberV58917 = 0;
      const flush = () => {
        if (cur.length) { blocks.push({ group: curGroup || group, volume: curVolume || volume, chapter: curChapter || chapter, lines: [...cur] });cur = [];curGroup = group;curVolume = volume;curChapter = chapter; }

        collectingSubjectiveAnswerV58917 = false;currentQuestionNumberV58917 = 0;
      };

      const curHasContent = () => cur.length > 0;

      const curHasRealQuestion = () => cur.some((l) => !isOptionLine(l) && !isAnswerLine(l) && !isAnalysisLine(l) && !getHeadingType(l));

      const curHasAnsweredStem = () => cur.some((l) => hasInlineAnswerTag(l) || hasEmbeddedAnswerStem(l, curGroup || group));

      const curHasDocxTable = () => cur.some((l) => /* 检查完整占行的 Word 表格标记，区分未消费的材料与已出现答案的题块。 */ /^【DOCX表格开始】$/.test(String(l || '').trim())) && !cur.some((l) => isOptionLine(l) || isAnswerLine(l));

      for (let lineIndex = 0;lineIndex < lines.length;lineIndex += 1) {
        const raw = lines[lineIndex]; const nextLines = lines.slice(lineIndex + 1, lineIndex + 9);
        if (isVolumeHeading(raw)) { flush();volume = getVolumeLabel(raw);curVolume = volume;chapter = '';curChapter = '';continue; }

        if (isChapterHeadingV58911(raw, nextLines)) { flush();chapter = raw;curChapter = chapter;continue; }

        if (isImportNoiseLine(raw)) { continue; }

        const headingType = getHeadingType(raw);
        if (headingType) { flush();group = headingType;curGroup = group;continue; }

        const line = raw;
        if (collectingSubjectiveAnswerV58917) {
          if (isAnalysisLine(line)) { collectingSubjectiveAnswerV58917 = false; } else if (!isDefiniteQuestionBoundaryAfterSubjectiveAnswerV58917(line, currentQuestionNumberV58917, nextLines)) {
            if (!cur.length) { curGroup = group;curVolume = volume;curChapter = chapter; }

            cur.push(line);continue;
          } else {
            flush();
          }
        }

        if (isStandaloneAnswerHeaderV58917(line) && curHasContent() && blockHasSubjectiveContextV58917(cur, curGroup || group)) {
          collectingSubjectiveAnswerV58917 = true;
          if (!currentQuestionNumberV58917) { currentQuestionNumberV58917 = cur.map(questionNumberFromLineV58917).find(Boolean) || 0; }

          cur.push(line);continue;
        }

        const newQuestion = looksLikeNewQuestionLine(line, group);
        const option = isOptionLine(line); const answerLine = isAnswerLine(line); const analysisLine = isAnalysisLine(line);
        if (curHasContent() && !option && !answerLine && !analysisLine) {
          const hasPrevOptions = cur.some(isOptionLine) || cur.some((l) => extractInlineOptionsRich(l)?.options?.length >= 2);
          const hasPrevAnswer = cur.some(isAnswerLine) || curHasAnsweredStem();
          const hasEmbeddedBoundary = hasEmbeddedAnswerStem(line, group);
          let shouldStartNew = newQuestion && (hasPrevOptions || hasPrevAnswer || (curHasRealQuestion() && hasStrongQuestionNo(line)) || ((hasInlineAnswerTag(line) || hasEmbeddedBoundary) && curHasRealQuestion()));
          // v58.1：DOCX 表格常作为题干材料出现，真正的提问句和选项可能在表格之后。
          // 表格后紧跟的非强题号句（如“根据上表计算……”）不能被切成新题；只有遇到新的强题号才切题。
          if (shouldStartNew && curHasDocxTable() && !hasPrevOptions && !hasPrevAnswer && !hasStrongQuestionNo(line)) { shouldStartNew = false; }

          if (shouldStartNew) { flush(); }
        }

        if (!cur.length) { curGroup = group;curVolume = volume;curChapter = chapter; }

        const numberV58917 = questionNumberFromLineV58917(line);if (numberV58917 && !currentQuestionNumberV58917) { currentQuestionNumberV58917 = numberV58917; }

        cur.push(line);
      }

      flush();
      if (blocks.length < 2) {
        // 富图片、表格和公式题独有的标记决定是否保留原分块。
        const hasDocxRichBlock = /\[\[DOCX_IMAGE_\d+\]\]|!\[[^\]]{0,120}\]\(data:image\/(?:png|jpeg|jpg|gif|webp|bmp);base64,|【DOCX表格开始】|【DOCX公式OMML：/.test(String(text || ''));
        const hasSubjectiveMultilineAnswerV58917 = blocks.some((block) => (block.lines || []).some(isStandaloneAnswerHeaderV58917) && blockHasSubjectiveContextV58917(block.lines || [], block.group || ''));
        // v58.9.4：DOCX 图片/表格/公式常会在同一道题内部形成空行。
        // 只有一道题时不能再按空行拆段，否则会把“题干 + 图片 + A/B/C/D选项”拆成两块，导致图片丢失、选项丢失并误判为填空题。
        if (hasDocxRichBlock || hasSubjectiveMultilineAnswerV58917) { return blocks; }

        // 没找到更强题号边界时，以空行分隔段落作为兼容回退。
        return text.split(/\n\s*\n+/).map((x) => ({ group: '', volume: '', lines: x.split('\n').map((y) => y.trim()).filter(Boolean) })).filter((b) => b.lines.length);
      }

      return blocks;
    }

    // 过滤题库导出时带入的摘要、卷头和编辑器占位行，确保后续只切题目内容。
    function isImportNoiseLine(line) {
      const s = String(line || '').trim();
      if (!s) { return true; }

      // 题量或卷量摘要没有题目正文，应在分块之前排除。
      if (/^共\s*\d+\s*题(?:\s*[|｜]\s*\d+\s*卷)?$/.test(s)) { return true; }

      return /* 过滤完全由栏目名组成的独立行。 */ /^(基本信息|题目|答案表|参考答案|答案解析)$/.test(s) || /* 兼容以“基本信息”开始并可带冒号的摘要标签。 */ /^基本信息[:：]?/.test(s)
    || /* 删去带 2020 年代日期的考试或试卷封面行。 */ /^202\d年.*(?:考试|试卷).*(?:卷|套)?$/.test(s)
    || /* 排除试卷封面和考试时间、满分说明，以免识别为题干。 */ /^(?:.*(?:考试试卷|知识考试试卷|综合知识考试试卷).*|[（(]?考试时间[:：]?.*满分.*|满分\d+分.*考试时间.*)$/.test(s)
    || /* 跳过历史导出中的矩阵文本题编辑器标签。 */ /^\[?矩阵文本题\]?/.test(s)
    || /* 仅由星号组成的行是排版分隔线。 */ /^\*+$/.test(s);
    }

    // 统一题干内简繁体题型标签，供切块和归一化共享。
    function mapInlineQuestionTypeLabelV592(label) {
      // 去掉题型标签内的排版空格。
      const s = String(label || '').replace(/\s/g, '');
      // 将简答、问答、名词解释和论述视为同类文本题。
      if (/^(?:简答题|簡答題|简答|問答題|问答题|名词解释|名詞解釋|论述题|論述題)$/.test(s)) { return 'short'; }

      // 将填充题和填空题归为按空作答。
      if (/^(?:填空题|填空|填充题)$/.test(s)) { return 'blank'; }

      // 归并判断、是非和繁体判断题名称。
      if (/^(?:判断题|判断|判斷題|是非题|是非題)$/.test(s)) { return 'judge'; }

      // 兼容多项选择与简繁体复选名称。
      if (/^(?:多选题|多选|多项选择题|多選題|多選|复选题|複選題|复选|複選)$/.test(s)) { return 'multiple'; }

      // 兼容单项选择与繁体单选名称。
      if (/^(?:单选题|单项选择题|单选|單選題|單選)$/.test(s)) { return 'single'; }

      return '';
    }

    // 识别题号和题型标签同处题干首行的格式，排除分区题量说明。
    function getNumberedTypeQuestionLineV592(line) {
      const raw = String(line || '').trim();
      const labels = '单选题|单项选择题|单选|單選題|單選|多选题|多项选择题|多选|多選題|多選|复选题|複選題|复选|複選|判断题|判断|判斷題|是非题|是非題|填空题|填空|填充题|简答题|簡答題|简答|問答題|问答题|名词解释|名詞解釋|论述题|論述題';
      // 依次捕获有效题号、已知题型标签以及冒号后的非空正文。
      const re = new RegExp(`^\\s*(?:第\\s*)?(\\d{1,4})\\s*(?:题)?[.、．:：]?\\s*(${labels})\\s*[:：]\\s*(\\S[\\s\\S]*)$`);
      const m = raw.match(re);
      if (!m) { return null; }

      const type = mapInlineQuestionTypeLabelV592(m[2]);
      const stem = String(m[3] || '').trim();
      if (!type || !stem) { return null; }

      if (/* 排除“共 N 题”等说明字段，避免把分区统计当作题干。 */ /^(?:共\d+题|每题|满分|分，共|题，每题)/.test(stem.replace(/* 去除说明标题中的排版空白再检查语义。 */ /\s/g, ''))) { return null; }

      return { number: Number(m[1]), label: m[2], type, stem };
    }

    function stripLeadingQuestionTypeLabelV592(text) {
      // 仅剥离以冒号结尾的行首题型标签，保留题干中自然出现的题型词。
      return String(text || '').trim().replace(/^\s*(?:单选题|单项选择题|单选|單選題|單選|多选题|多项选择题|多选|多選題|多選|复选题|複選題|复选|複選|判断题|判断|判斷題|是非题|是非題|填空题|填空|填充题|简答题|簡答題|简答|問答題|问答题|名词解释|名詞解釋|论述题|論述題)\s*[:：]\s*/, '').trim();
    }

    // 依据明确题型、分区与作答提示确定题型，保留无充分证据的未判定状态。
    function inferQuestionTypeFromPromptV592(text, group = '') {
      const gt = mapType(group);if (gt) { return gt; }

      const s = String(text || '');
      // v58.9.3：标准主线采用"显式题型 > 选项 > 填空格式 > 简答语义"。
      if (hasExplicitBlankPrompt(s)) { return 'blank'; }

      if (hasShortAnswerPrompt(s)) { return 'short'; }

      return '';
    }

    // 用标题形态区分题型分区与普通题干，并保留行测模块名称。
    function getHeadingType(line) {
      const raw = String(line || '').trim();
      // 忽略分散排版的空格，比对标题词的连写形式。
      const s = raw.replace(/\s/g, '');
      if (!s) { return ''; }

      // 题号 + 题型 + 冒号 + 真实题干，是标准单题写法，不是题型分区。
      if (getNumberedTypeQuestionLineV592(raw)) { return ''; }

      // 只把“短标题/带章节序号/带题量分值说明”的行识别为题型分区。
      // 避免把题干里的“判断某段程序……”、选项里的“单选/多选”等误当成题型标题。
      const hasSectionPrefix = /^(?:第[一二三四五六七八九十0-9]+部分|[一二三四五六七八九十]+[、.．:：])/.test(s) || /* 题型名之前有阿拉伯数字和题号标点时也可视为编号分区。 */ /^\d+[、.．:：](?:单选题|单项选择题|多选题|多项选择题|判断题|填空题|简答题)/.test(s);
      // 含题量、每题分值或满分的题型行是可信分区说明。
      const hasCountInfo = /^(?:[一二三四五六七八九十]+[、.．:：])?(?:单选题|单项选择题|多选题|多项选择题|判断题|填空题|简答题).{0,40}(?:共\d+题|每题|满分|分，共|题，每题)/.test(s);
      // 仅有题型名及可选括号的整行可作为独立分区标题。
      const bracketOnly = /^[[【(（]?(?:单选题|单选|单项选择题|單選題|單選|多选题|多选|多项选择题|多選題|多選|复选题|複選題|复选|複選|判断题|判断|判斷題|是非题|是非題|填空题|填空|填充题|简答题|簡答題|简答|問答題|问答题|名词解释|名詞解釋|论述题|論述題)[\]】)）]?$/.test(s);
      const likelyHeading = bracketOnly || hasSectionPrefix || hasCountInfo;
      if (!likelyHeading) { return ''; }

      // 缺少其他分区证据时，句末标点应使该行保留为正文。
      if (/[。？?！!；;]$/.test(raw) && !hasSectionPrefix && !hasCountInfo && !bracketOnly) { return ''; }

      // 含字母冒号选项标签时，排除含同名题型词的普通选项行。
      if (/[A-G][:：]/.test(s)) { return ''; }

      // 识别行测逻辑、图形、资料等模块标题并保留原始显示名称。
      if (/(?:逻辑判断|判断推理|图形推理|定义判断|类比推理|资料分析|材料分析|言语理解|语言理解|数学运算|数量关系|综合能力|常识判断)/.test(s)) { return raw; }

      // 将所有填空分区别名归为填空题。
      if (/(?:填空题|填空|填充题)/.test(s)) { return '填空题'; }

      // 将简答、问答、名词解释和论述分区归为简答题。
      if (/(?:简答题|簡答題|简答|問答題|问答题|名词解释|名詞解釋|论述题|論述題)/.test(s)) { return '简答题'; }

      // 将单选或单项选择别名归为单选题。
      if (/(?:单选题|单项选择题|单选|單選題|單選)/.test(s)) { return '单选题'; }

      // 将复选和多项选择别名归为多选题。
      if (/(?:多选题|多项选择题|多选|复选题|複選題|复选|複選|多選題|多選)/.test(s)) { return '多选题'; }

      // 将判断和是非题分区归为判断题。
      if (/(?:判断题|判断|判斷題|是非题|是非題)/.test(s)) { return '判断题'; }

      return '';
    }

    // 读取仅包含题型名和题号的独立题头，为下一行题干提供归属。
    function getNumberedTypeQuestionHeader(line) {
      const raw = String(line || '').trim();
      // 匹配占满一行的题型标签与题号，排除已经带题干的行。
      const m = raw.match(/^(单选题|单选|单项选择题|多选题|多选|多项选择题|判断题|判断|填空题|填空|简答题|简答|问答题)\s*(?:第\s*)?(\d{1,4})\s*(?:题)?\s*$/);
      if (!m) { return null; }

      const label = m[1];
      let type = 'single';
      if (/* 将题头中“多”解释为多选。 */ /多/.test(label)) { type = 'multiple'; } else if (/* 按判断类标签建立判断题。 */ /判断/.test(label)) { type = 'judge'; } else if (/* 按空格作答的标签识别为填空题。 */ /填空/.test(label)) { type = 'blank'; } else if (/* 对简答、问答题头沿用主观题类型。 */ /简答|问答/.test(label)) { type = 'short'; }

      return { label, number: m[2], type };
    }

    function hasStrongQuestionNo(line) {
      // 具备“第 N 题”、数字和标点或成对括号的行首编号才是强题号。
      return !!getNumberedTypeQuestionHeader(line) || /^\s*(?:第\s*\d+\s*题|\d+\s*[、.．:：]|[（(]\s*\d+\s*[）)]|[【[]\s*\d+\s*[】\]])/.test(line);
    }

    // 识别可能开启独立题目的行，明确编号和题型优先于正文标点推断。
    function isQuestionStart(line) {
      if (isOptionLine(line) || isAnswerLine(line) || isAnalysisLine(line)) { return false; }

      if (getNumberedTypeQuestionHeader(line)) { return true; }

      if (hasInlineAnswerTag(line)) { return true; }

      return hasStrongQuestionNo(line) || !!detectType(line) || (/* 空括号可以作为需要作答的题干提示。 */ /[（(]\s*[）)]/.test(line) && /* 空括号题兼容可选句末标点和 Word 星号。 */ /[。？?]?\s*\*?$/.test(line)) || (/* 较长文本以典型题干标点结束时可作为候选。 */ /[。？?]\s*\*?$/.test(line) && line.length > 8) || (/* 兼容较长题干只在末尾加星号的历史写法。 */ /\*\s*$/.test(line) && line.length > 8);
    }

    // v58.9.8.2：英文题干可能以冠词 A/a 或小写字母开头，例如“17. A vowel...”。
    // 这类裸字母 + 空格不是可靠的选项标号；真正的无标点英文选项只在已有题干上下文中识别。
    function isBareEnglishStemStartV5982(line) {
      // 去掉可选题号，再检查英语题干开头是否看似字母选项。
      const raw = String(line || '').trim().replace(/^(?:第\s*)?\d{1,4}\s*(?:题)?[.、．:：]?\s*/, '');
      // 判断 A 或小写字母后紧接英文单词的情况，避免把英语正文切为选项。
      return /^(?:A|[a-g])\s+[A-Za-z][A-Za-z'’-]*/.test(raw);
    }

    function isOptionLine(line) {
      if (isBareEnglishStemStartV5982(line)) { return false; }

      // 辨认带勾选前缀、括号或分隔标点的选项，排除加号后缀。
      return /^\s*(?:[oOxXuUyYvV√✔✓]\s*)?(?:[（(]\s*[A-Ga-g1-9]\s*[）)]|[A-Ga-g]\s*(?:[、.．:：，,]|\s+|(?=[\u4e00-\u9fa5]))|0\s*[.．、:：]\s+(?=\S))(?![+＋])/.test(line);
    }

    function isStandaloneAnswerHeaderV58917(line) {
      // 答案标题可单独占行，支持中英文括号和冒号形式。
      return /^\s*(?:(?:【|\[)\s*(?:正确答案|参考答案|标准答案|答案|答|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|Answer|Correct\s*answer)\s*(?:】|\])|(?:正确答案|参考答案|标准答案|答案|答|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|Answer|Correct\s*answer)\s*[:：])\s*$/i.test(String(line || ''));
    }

    function isAnswerLine(line) {
      // 在答案标题之后有实际文本时，将整行作为答案行。
      return isStandaloneAnswerHeaderV58917(line) || /^\s*(?:【|\[)?\s*(?:正确答案|参考答案|标准答案|答案|答|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|Answer|Correct\s*answer)\s*(?:】|\])?\s*(?:[:：,，、.．;；]|\s+|[（(])\s*\S+/i.test(line);
    }

    function isAnalysisLine(line) {
      // 在行首识别解析、说明或考点的可选括号标题。
      return /^(?:【|\[)?\s*(?:解析|答案解析|试题解析|说明|考点)\s*(?:】|\])?\s*[:：]?/i.test(line);
    }

    // 依据分区与明确的题型标签确定主观题上下文，保护编号式作答要点。
    function blockHasSubjectiveContextV58917(lines, group = '') {
      if (mapType(group) === 'short') { return true; }

      const arr = Array.isArray(lines) ? lines : [];
      if (arr.some((line) => getNumberedTypeQuestionLineV592(line)?.type === 'short' || getNumberedTypeQuestionHeader(line)?.type === 'short')) { return true; }

      if (arr.some(isOptionLine)) { return false; }

      return inferQuestionTypeFromPromptV592(arr.join(' '), group) === 'short';
    }

    // 从题头、普通编号或括号编号提取题号，供主观答案后的分题校验。
    function questionNumberFromLineV58917(line) {
      const typed = getNumberedTypeQuestionLineV592(line);if (typed) { return Number(typed.number) || 0; }

      const header = getNumberedTypeQuestionHeader(line);if (header) { return Number(header.number) || 0; }

      const m = String(line || '').trim().match(/* 兼容前缀“第 N 题”的明确题号。 */ /^第\s*(\d{1,4})\s*题/) || String(line || '').trim().match(/* 兼容行首数字加分隔标点的题号。 */ /^(\d{1,4})\s*[、.．:：]/) || String(line || '').trim().match(/* 兼容用圆括号或方括号标记的行首题号。 */ /^[（(【[]\s*(\d{1,4})\s*[）)】\]]/);
      return m ? Number(m[1]) || 0 : 0;
    }

    // 在主观答案结束后只接受有充分证据的下一题，避免把答案列举误拆。
    function isDefiniteQuestionBoundaryAfterSubjectiveAnswerV58917(line, currentNumber = 0, nextLines = []) {
      const raw = String(line || '').trim();if (!raw) { return false; }

      // 明确写成“第 N 题”的行提供不含歧义的边界证据。
      if (getNumberedTypeQuestionLineV592(raw) || getNumberedTypeQuestionHeader(raw) || /^第\s*\d{1,4}\s*题/.test(raw)) { return true; }

      // 拆出编号、实际标点和正文，供后续区别顿号列举。
      const numbered = raw.match(/^(\d{1,4})\s*([、.．:：])\s*(.+)$/);
      // 没有普通编号时尝试带正文的括号题号。
      const bracketed = numbered ? null : raw.match(/^[（(【[]\s*(\d{1,4})\s*[）)】\]]\s*(.+)$/);
      if (!numbered && !bracketed) { return false; }

      const number = Number((numbered || bracketed)[1]) || 0; const separator = numbered ? numbered[2] : ''; const stem = String((numbered || bracketed)[numbered ? 3 : 2] || '').trim();
      if (currentNumber && number !== currentNumber + 1) { return false; }

      // 末尾问号可证明正文具有独立提问语义。
      const promptLike = /[？?]\s*$/.test(stem) || hasShortAnswerPrompt(stem) || hasExplicitBlankPrompt(stem) || detectType(stem) !== '';
      if (!promptLike) { return false; }

      if (separator === '、' && !/* 顿号编号后如果没有问号，继续排查其是否为答案列举。 */ /[？?]\s*$/.test(stem) && !/* “请”或“试”等作答动词可支持顿号编号行确是题干。 */ /^(?:请|试|请你|请简要)/.test(stem)) {
        let hasNearbyAnswerMarker = false;
        for (const next of (nextLines || [])) {
          if (isAnswerLine(next)) { hasNearbyAnswerMarker = true;break; }

          if (questionNumberFromLineV58917(next)) { break; }
        }

        if (!hasNearbyAnswerMarker) { return false; }
      }

      return true;
    }

    // 按显式括号题型或独立标签识别题型，不凭单个正文词猜测。
    function detectType(text) {
      const s = String(text || '').trim();
      // 去掉独立题型标签的空格，用于完整标签比较。
      const compact = s.replace(/\s/g, '');
      // 单题题型只识别显式标记或非常短的独立题型词；不能把“判断某段程序……”误识别为判断题。
      if (/[[【(（]\s*(简答题|简答|问答题|问答|名词解释|论述题)\s*[\]】)）]/.test(s) || /* 整行主观题型标签作为括号标签之外的回退形式。 */ /^(?:简答题|简答|问答题|问答|名词解释|论述题)$/.test(compact)) { return 'short'; }

      if (/* 识别题干中的带括号填空题标签。 */ /[[【(（]\s*(填空题|填空|填充题)\s*[\]】)）]/.test(s) || /* 兼容独立成行的填空类题型标签。 */ /^(?:填空题|填空|填充题)$/.test(compact)) { return 'blank'; }

      if (/* 识别题干中的带括号多选题标签。 */ /[[【(（]\s*(多选题|多选|多项选择题)\s*[\]】)）]/.test(s) || /* 兼容独立成行的多项选择题标签。 */ /^(?:多选题|多选|多项选择题)$/.test(compact)) { return 'multiple'; }

      if (/* 识别题干中用括号标注的判断题类型。 */ /[[【(（]\s*(判断题|判断)\s*[\]】)）]/.test(s) || /* 兼容独立成行的判断、是非题型标签。 */ /^(?:判断题|判断|是非题)$/.test(compact)) { return 'judge'; }

      if (/* 识别题干中的括号单选题标签。 */ /[[【(（]\s*(单选题|单选|单项选择题)\s*[\]】)）]/.test(s) || /* 兼容独立成行的单项选择题类型标签。 */ /^(?:单选题|单选|单项选择题)$/.test(compact)) { return 'single'; }

      return '';
    }

    // 用下一行确有 B 选项作为证据，从题干尾部恢复被粘连的 A 选项。
    function splitTrailingFirstOptionFromQuestion(line, nextLine) {
      const raw = String(line || '').trim();const next = String(nextLine || '').trim();
      // 下一行必须是有正文边界的 B 标签，才尝试切开 A。
      if (!/^B\s*(?:[、.．:：，,]|\s+|(?=[\u4e00-\u9fa5]))/i.test(next)) { return null; }

      if (isOptionLine(raw) || isAnswerLine(raw) || isAnalysisLine(raw) || getHeadingType(raw)) { return null; }

      const patterns = [
        /* 用空白分隔的题干和尾部 A 选项可在该空白边界分开。 */ /^(.*?)(?:\s+|\u3000+)(A)\s*[、.．:：]?\s*([^A-G\n]{1,120})$/i,
        /* 若没有空白，也可用题干句末标点与 A 标签的边界。 */ /^(.*?[。？！?）)])\s*(A)\s*[、.．:：]?\s*([^A-G\n]{1,120})$/i,
      ];
      for (const re of patterns) {
        const m = raw.match(re);if (!m) { continue; }

        const q = (m[1] || '').trim();const txt = (m[3] || '').trim();
        if (q.length < 8 || !txt || /* 选项正文若含答案或解析标题，不应从此处提取选项。 */ /(?:答案|解析)\s*[:：]/.test(txt)) { continue; }

        if (txt.length > 80) { continue; }

        // 题干较短时要求有空括号或句末标点，防止误切正文。
        if (!/[（(]\s*[）)]|[。？！?]$/.test(q) && q.length < 16) { continue; }

        return { question: q, key: 'A', text: txt };
      }

      return null;
    }

    // 在 B、C 等后续标签可确证时，恢复未标注字母的首个选项。
    function extractImplicitLeadingAOptions(line) {
      const s = String(line || '').trim();
      if (!s || /* 已有正常选项标签时，不需要推断省略的 A。 */ /^[A-Ga-g]\s*[、.．:：，,]/.test(s)) { return null; }

      // 答案或解析行不参与隐含选项推断。
      if (/^(?:答案|解析|正确答案|参考答案|标准答案)\s*[:：]/.test(s)) { return null; }

      const hits = [];let m;
      // 搜集 B–G 的明确分隔标点，用于确认后续选项序列。
      const re = /([B-Gb-g])\s*[、.．:：，,]\s*/g;
      while ((m = re.exec(s))) { hits.push({ idx: m.index, len: m[0].length, key: normalizeOptionKey(m[1]) }); }

      if (hits.length < 2 || hits[0].key !== 'B') { return null; }

      const keys = hits.map((h) => h.key).join('');
      // 只有发现连续的 B、C 标签才允许重建 A。
      if (!/^BC/.test(keys)) { return null; }

      const firstText = s.slice(0, hits[0].idx).trim();
      if (!firstText || firstText.length > 120) { return null; }

      const options = [{ key: 'A', text: firstText }];
      for (let i = 0;i < hits.length;i += 1) {
        const start = hits[i].idx + hits[i].len;
        const end = i + 1 < hits.length ? hits[i + 1].idx : s.length;
        const txt = s.slice(start, end).trim();
        if (txt) { options.push({ key: hits[i].key, text: txt }); }
      }

      return options.length >= 3 ? options : null;
    }

    // 检查去掉导入支持的图片标记后是否还剩正文，用于判断纯图片题。
    function isProtectedOrMarkdownImageOnlyV588(text) {
      const raw = String(text || '').trim();
      if (!raw) { return false; }

      const withoutImages = raw
        .replace(/* 移除完整的 Markdown 内嵌图片再检查正文。 */ /!\[[^\]]{0,120}\]\(data:image\/[^)]+\)/gi, '')
        .replace(/* 忽略当前 Word 图片暂存编号。 */ /\[\[DOCX_IMAGE_\d+\]\]/g, '')
        .replace(/* 兼容题库中用于记录已移除图片的占位符。 */ /\[图片已移除\]/g, '')
        .replace(/* 也忽略旧 Word 导入的中式括号图片标记。 */ /【DOCX图片\d+[^】]*】/g, '')
        .trim();
      // 原文必须至少包含一种识别出的图片，空白行不能视为纯图。
      return !withoutImages && /!\[[^\]]{0,120}\]\(data:image\/|\[\[DOCX_IMAGE_\d+\]\]|\[图片已移除\]|【DOCX图片\d+/i.test(raw);
    }

    function stemLikelyNeedsFigureMaterialV588(text, group = '') {
      // 整理题干与分区文本，避免分散排版影响图形材料判断。
      const s = (`${String(text || '')} ${String(group || '')}`).replace(/\s+/g, '');
      // 图表指代与观察动作相邻，表明题干依赖图片材料。
      return /(?:根据|依据|观察|由|结合|如|见).{0,16}(?:下图|下面的图|以下图|上图|图中|图示|散点图|统计图|折线图|柱状图|饼图|曲线图|示意图|图表)|(?:下图|下面的散点图|散点图|统计图|折线图|柱状图|饼图|曲线图|示意图)可以|根据下面的散点图/.test(s);
    }

    // 拟定图片归属后，仅在有明确题干图表证据时移回落在 A 选项的图片。
    function repairStemImageOptionMisplacementV588(question, options, group = '') {
      let questionText = String(question || '').trim();
      let opts = Array.isArray(options) ? options.map((o) => ({ ...o, text: String((o && o.text) || '') })) : [];
      if (!opts.length) { return { question: questionText, options: opts }; }

      const first = opts[0];
      if (String((first && first.key) || '').toUpperCase() !== 'A') { return { question: questionText, options: opts }; }

      if (!isProtectedOrMarkdownImageOnlyV588(first.text)) { return { question: questionText, options: opts }; }

      if (!stemLikelyNeedsFigureMaterialV588(questionText, group)) { return { question: questionText, options: opts }; }

      const rest = opts.slice(1).filter((o) => String((o && o.text) || '').trim());
      if (rest.length < 2 || !hasSequentialOptionKeysV591(rest, 'B', 2) || !arePlainShortChoiceOptionsV591(rest)) { return { question: questionText, options: opts }; }

      const img = String(first.text || '').trim();
      if (img && !questionText.includes(img)) { questionText = [questionText, img].filter(Boolean).join('\n'); }

      opts = rest.map((o) => ({ ...o, key: normalizeOptionKey(o.key) }));

      return { question: questionText, options: opts };
    }

    // 根据题干图形提示和待补选项的语境决定遇到的独立图片属于题干还是选项。
    function shouldMovePendingImageToStemV588(pendingKey, line, qlines, options, group = '') {
      if (String(pendingKey || '').toUpperCase() !== 'A') { return false; }

      if ((options || []).length) { return false; }

      if (!isProtectedOrMarkdownImageOnlyV588(line)) { return false; }

      return stemLikelyNeedsFigureMaterialV588((qlines || []).join(' '), group);
    }

    // 按原文顺序收集图片内容和中间占位符，保留后续题目归属修复所需位置。
    function extractInlineImageTokensV589(text) {
      const raw = String(text || '');
      // 识别 Markdown 图片以及新旧 Word 导入生成的图片标记。
      const re = /!\[[^\]]{0,120}\]\(data:image\/[^)]+\)|\[\[DOCX_IMAGE_\d+\]\]|【DOCX图片\d+[^】]*】/gi;
      const out = [];let m;
      while ((m = re.exec(raw))) { out.push(m[0]); }

      return out;
    }

    // 移除已另行收集的图片标记，保留正文以及稳定的词间分隔。
    function stripInlineImageTokensV589(text) {
      return String(text || '')
        .replace(/* 用空格替代内嵌 Markdown 图片，避免把相邻正文粘起来。 */ /!\[[^\]]{0,120}\]\(data:image\/[^)]+\)/gi, ' ')
        .replace(/* 清除新 Word 图片占位编号。 */ /\[\[DOCX_IMAGE_\d+\]\]/g, ' ')
        .replace(/* 兼容清除旧 Word 图片的中式括号占位。 */ /【DOCX图片\d+[^】]*】/g, ' ')
        .replace(/* 将去掉图片后重复留下的空白合成单空格。 */ /\s+/g, ' ')
        .trim();
    }

    // 仅在答案与选项可明确对应时拆出答案尾部图片，避免误拆正文中的图片。
    function splitAnswerAndTrailingImagesV589(text, type = '') {
      const raw = String(text || '').trim();
      const images = extractInlineImageTokensV589(raw);
      if (!images.length) { return { answer: [], images: [] }; }

      // 清除图片移除后留在答案两端的标点和空白。
      const answerPart = stripInlineImageTokensV589(raw).replace(/^[。．.、，,；;：:\s]+|[。．.、，,；;：:\s]+$/g, '').trim();
      const answer = splitAnswerByType(answerPart, type);
      if (!answer.length || !answer.every((a) => /* 每个结果必须是单个字母或数字选项，才接受从答案恢复图片。 */ /^[A-G1-9]$/.test(String(a || '').trim()))) { return { answer: [], images: [] }; }

      return { answer, images };
    }

    // 按图片在原文中的先后生成顺序选项。
    function imageTokensToChoiceOptionsV589(images) {
      const clean = (images || []).map((x) => String(x || '').trim()).filter(Boolean);
      const max = Math.min(clean.length, 7);
      const out = [];
      for (let i = 0;i < max;i += 1) { out.push({ key: String.fromCharCode(65 + i), text: clean[i] }); }

      return out;
    }

    // 检查候选选项编号是否从指定字母开始连续排列，供修复时保护原题结构。
    function hasSequentialOptionKeysV591(options, start = 'A', minCount = 2) {
      const opts = Array.isArray(options) ? options : [];
      if (opts.length < minCount) { return false; }

      const startCode = String(start || 'A').toUpperCase().charCodeAt(0);
      for (let i = 0;i < Math.min(opts.length, 7);i += 1) {
        const key = String((opts[i] && opts[i].key) || '').toUpperCase();
        if (key !== String.fromCharCode(startCode + i)) { return false; }
      }

      return true;
    }

    // 允许图形题兜底替换简单标签，但先排除已有实际正文的选项。
    function arePlainShortChoiceOptionsV591(options) {
      const opts = Array.isArray(options) ? options : [];
      if (!opts.length) { return false; }

      return opts.every(/* 比较每个选项的长度和标签特征，确保原有正文不会被占位图覆盖。 */ (o) => {
        const text = String((o && o.text) || '').trim();
        if (!text || text.length > 140) { return false; }

        if (hasQuestionImageContent(text)) { return false; }

        if (isAnswerLine(text) || isAnalysisLine(text) || looksLikeNewQuestionLine(text, '')) { return false; }

        return true;
      });
    }

    // 判断题目是在比较候选图形，避免把资料图表误认成图片选项。
    function isVisualImageChoiceContextV591(question, group = '') {
      // 合并题干和分区文字并忽略分散空白，识别图形作答提示。
      const s = (`${String(question || '')} ${String(group || '')}`).replace(/\s+/g, '');
      if (!s) { return false; }

      // 图形、旋转等含义与选择或填入提示相近时，可确认候选图片选项的语义。
      if (/(?:图形推理|图形判断|图形规律|图形题|图形|图案|九宫格|问号|空缺|缺失|补入|填入|纸盒|折叠|展开图|立体图|平面图|视觉|拼合|旋转|翻转).{0,24}(?:选出|选择|最合适|最恰当|正确|符合|应填|应该|问号|空缺|缺失)|(?:选出|选择|最合适|最恰当|正确|符合|应填|应该).{0,24}(?:图形|图案|问号|空缺|缺失|纸盒|折叠|展开图|九宫格|规律)/.test(s)) { return true; }

      // 题型明确是图形推理或纸盒折叠时，也可提供图片区分证据。
      if (/(?:图形推理|图形判断|图形规律|纸盒折叠|九宫格)/.test(s)) { return true; }

      return false;
    }

    function isChartMaterialContextV591(question, group = '') {
      // 折叠题干与组名空白，统一判断资料图表用语。
      const s = (`${String(question || '')} ${String(group || '')}`).replace(/\s+/g, '');
      // 散点图、回归和方差等词提示图片用于提供数据材料。
      return /(?:散点图|统计图|折线图|柱状图|饼图|曲线图|回归|相关系数|变量|方差分析表|判定系数|置信区间|预测区间|最小二乘法|线性相关|线性回归)/.test(s);
    }

    // 仅在合法答案和图形题语境支持时，允许用答案尾部的图片补齐选项。
    function allowAnswerImageOptionFallbackV591(question, group, type, answer, images) {
      const imgCount = (images || []).filter(Boolean).length;
      if (imgCount < 2 || imgCount > 7) { return false; }

      const ans = (answer || []).map((a) => String(a || '').trim()).filter(Boolean);
      if (!ans.length || !ans.every((a) => /* 只有可关联到 A–G 或数字编号的答案才触发图形选项回退。 */ /^[A-G1-9]$/.test(a))) { return false; }

      if (type && !['single', 'multiple'].includes(String(type))) { return false; }

      if (isChartMaterialContextV591(question, group) && !isVisualImageChoiceContextV591(question, group)) { return false; }

      return isVisualImageChoiceContextV591(question, group);
    }

    // 将题干图片后误留的选项 A 文本移回选项，并保留真正的材料尾句。
    function repairStemTrailingAOptionTextV589(question, options, group = '') {
      const questionText = String(question || '').trim();
      let opts = Array.isArray(options) ? options.map((o) => ({ ...o, text: String((o && o.text) || '') })) : [];
      if (!questionText || opts.some((o) => String((o && o.key) || '').toUpperCase() === 'A')) { return { question: questionText, options: opts }; }

      if (!opts.length || String((opts[0] && opts[0].key) || '').toUpperCase() !== 'B') { return { question: questionText, options: opts }; }

      if (!hasSequentialOptionKeysV591(opts, 'B', 2) || !arePlainShortChoiceOptionsV591(opts)) { return { question: questionText, options: opts }; }

      if (!stemLikelyNeedsFigureMaterialV588(questionText, group) || !hasQuestionImageContent(questionText)) { return { question: questionText, options: opts }; }

      // 查找最后一张内嵌图或 Word 图片占位，分离候选尾部。
      const re = /!\[[^\]]{0,120}\]\(data:image\/[^)]+\)|\[\[DOCX_IMAGE_\d+\]\]|【DOCX图片\d+[^】]*】/gi;
      let last = null; let m;
      while ((m = re.exec(questionText))) { last = { idx: m.index, end: re.lastIndex, text: m[0] }; }

      if (!last) { return { question: questionText, options: opts }; }

      // 去掉图后选项尾部前的排版和分隔标点，再判断是否为内容。
      const tail = questionText.slice(last.end).trim().replace(/^[-—–；;，,。．.、\s]+/, '').trim();
      const before = questionText.slice(0, last.end).trim();
      if (!tail || tail.length > 80) { return { question: questionText, options: opts }; }

      if (hasQuestionImageContent(tail) || isAnswerLine(tail) || isAnalysisLine(tail) || isOptionLine(tail) || looksLikeNewQuestionLine(tail, group)) { return { question: questionText, options: opts }; }

      // 较长且包含句级标点的尾部仍可能是材料正文，保留在题干。
      if (/[。？！?；;]/.test(tail) && tail.length > 24) { return { question: questionText, options: opts }; }

      opts = [{ key: 'A', text: tail }, ...opts];
      return { question: before, options: opts };
    }

    // 判断现有选择项是否仅是自动生成图形标签，供合并阶段决定能否安全替换。
    function isDefaultImageChoiceSetV589(q) {
      const opts = Array.isArray(q && q.options) ? q.options : [];
      if (opts.length < 2) { return false; }

      const self = opts.every((o) => String((o && o.text) || '').trim().toUpperCase() === String((o && o.key) || '').trim().toUpperCase());
      if (!self) { return false; }

      const context = [q && q.question, q && q.analysis, q && q.group, q && q.category].map((x) => String(x || '')).join(' ');
      return hasQuestionImageContent(context) || /* 图形或资料分区特征是自动生成图形标签的补充证据。 */ /(?:图形|图表|纸盒|折叠|问号|资料分析|材料分析|根据下图|下图)/.test(context);
    }

    // 将误粘入选项的圈号陈述移回题干，保留原有组合选项。
    function repairCircledCombinationQuestion(q) {
      // 候选题干必须有空括号，才尝试还原圈号组合选择题。
      if (!q || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 7 || !/[（(]\s*[）)]/.test(q.question || '')) { return q; }

      // 旧解析器曾将无标号陈述与同键组合选项拼接；仅在完整顺序和引用均能核实时恢复显示，兼容旧题库期间保留。
      const parts = [];
      for (const [index, option] of q.options.entries()) {
        // 捕获前导圈号陈述和后部由多个圈号组成的真实选项组合。
        const match = String(option.text || '').trim().match(/^([①-⑳])([^①-⑳]+?)\s+([①-⑳]{2,})$/);
        const expectedStatement = String.fromCharCode('①'.charCodeAt(0) + index);
        // 前段必须含有正常语言文本，避免把纯圈号组合误当陈述。
        if (option.key !== String.fromCharCode(65 + index) || !match || match[1] !== expectedStatement || !/[\u4e00-\u9fffA-Za-z]/.test(match[2])) { return q; }

        parts.push({ statement: match[1] + match[2].trim(), combination: match[3] });
      }

      const markers = new Set(parts.map((part) => part.statement[0]));
      if (parts.some((part) => [...part.combination].some((marker) => !markers.has(marker)))) { return q; }

      // 如果题干已包含圈号陈述，跳过该修复。
      if (/[①-⑳]/.test(q.question)) { return q; }

      return { ...q, question: [q.question, ...parts.map((part) => part.statement)].join('\n'), options: q.options.map((option, index) => ({ ...option, text: parts[index].combination })) };
    }

    // 在题目保留了原始图文选项时优先显示可信内容，避免因归一化丢失图片。
    function displayOptionTextV589(q, inputO) {
      let o = inputO;
      const repaired = repairCircledCombinationQuestion(q);
      if (repaired !== q) { o = repaired.options.find((option) => option.key === o.key) || o; }

      const text = String((o && o.text) || '').trim();
      const key = String((o && o.key) || '').trim();
      if (text && key && text.toUpperCase() === key.toUpperCase() && isDefaultImageChoiceSetV589(q)) { return ''; }

      return text;
    }

    // 在读取原文块之后统一确认题号、题型和作答字段，保持分块与归一化的职责独立。
    function finalizeParsedQuestion(fields, idx) {
      let {
        number,
        type,
        options,
        answer,
      } = fields;
      const {
        qlines,
        group,
        groupTypeV592,
        explicitTypeV592,
        answerImageOptionsV589,
        subjectiveAnswerLinesV58917,
        analysis,
      } = fields;
      // 从题干首行提取括号题号或带分隔标点的题号，保留实际编号。
      const qNo = (qlines[0] || '').match(/^\s*(?:[【[]\s*(\d+)\s*[】\]]|(?:第\s*)?(\d+)\s*(?:题)?[.、．:：])/);
      if (qNo) { number = qNo[1] || qNo[2]; }

      let question = stripLeadingQuestionTypeLabelV592(qlines.join(' ')
        .replace(/* 已提取题号后，从显示题干中移除开头的标记。 */ /^\s*(?:[【[]\s*\d+\s*[】\]]|第\s*\d+\s*题|\d+\s*[.、．:：])\s*/, '')
        .replace(/* 兼容圆括号标记的重复题号。 */ /^\s*[（(]\s*\d+\s*[）)]\s*/, '')
        .replace(/* 移除常见括号题型提示；题型由解析器维护，不混入题干正文。 */ /[[【(（]\s*(单选题|单选|单项选择题|單選題|單選|多选题|多选|多项选择题|多選題|多選|复选题|複選題|判断题|判断|判斷題|是非题|是非題|填空题|填空|填充题|简答题|简答|問答題|问答题|名词解释|名詞解釋|论述题|論述題)\s*[\]】)）]/g, '')
        .replace(/* 去掉 Word 题目末尾用于排版的星号。 */ /\s*\*+\s*$/, '')
        .trim());
      if (!options.length && allowAnswerImageOptionFallbackV591(question, group, type, answer, answerImageOptionsV589)) {
        options = imageTokensToChoiceOptionsV589(answerImageOptionsV589);
      }

      options = mergeDuplicateOptions(repairEmbeddedOptions(options)).filter((o) => o.text && !/* 合并选项后丢弃仅含空白的项，避免形成可选择的空内容。 */ /^\s*$/.test(o.text));

      const stemImageRepairV588 = repairStemImageOptionMisplacementV588(question, options, group);
      question = stemImageRepairV588.question;
      options = stemImageRepairV588.options;
      const stemARepairV589 = repairStemTrailingAOptionTextV589(question, options, group);
      question = stemARepairV589.question;
      options = stemARepairV589.options;
      if (options.length && !groupTypeV592 && !explicitTypeV592 && ['blank', 'short'].includes(type)) { type = ''; }

      if (!type) { type = guessType(question, options, answer, group); }

      const subjectiveAnswerTextV58917 = subjectiveAnswerLinesV58917.join('\n').trim();
      if (type === 'short' && subjectiveAnswerTextV58917) { answer = [subjectiveAnswerTextV58917]; }

      const fixedQuestion = cleanQuestionStemAndAnswer(question, answer, type, options);
      question = fixedQuestion.question;
      answer = fixedQuestion.answer;
      if (type === 'judge' && !options.length) { options = [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }]; }

      answer = isTextType(type) ? splitTextAnswer(answer.join('；')) : normalizeAnswer(answer, options, type);
      return { id: makeId('imp', idx), type, number, question, options, answer, analysis: formatAnswerAnalysisForReview(answer, analysis.trim()), group };
    }

    // 将一个原文题块还原为题干、选项和答案解析，保留明确题型与原文选项的优先级。
    function parseBlock(block, idx) {
      const lines = (Array.isArray(block) ? block : block.lines || String(block).split('\n')).map((x) => String(x).trim()).filter(Boolean);
      const group = block.group || '';const groupTypeV592 = mapType(group) || '';let type = groupTypeV592;let explicitTypeV592 = false;let answer = [];let analysis = '';const options = [];const qlines = [];let collectingAnalysis = false;let unkeyedMode = false;let pendingOptionKey = '';let seenQuestion = false;let number = idx + 1;const answerImageOptionsV589 = [];let collectingAnswerImageOptionsV589 = false;let collectingSubjectiveAnswerV58917 = false;const subjectiveAnswerLinesV58917 = [];
      const full = lines.join('\n');const inlineType = detectType(full);if (inlineType) { type = inlineType; }

      for (let li = 0;li < lines.length;li += 1) {
        let line = lines[li].trim();
        const numberedTypedLineV592 = getNumberedTypeQuestionLineV592(line);
        if (numberedTypedLineV592) { type = numberedTypedLineV592.type;explicitTypeV592 = true;number = numberedTypedLineV592.number;line = `${numberedTypedLineV592.number}. ${numberedTypedLineV592.stem}`; }

        const numberedTypeHeader = getNumberedTypeQuestionHeader(line);
        if (numberedTypeHeader) { type = numberedTypeHeader.type;explicitTypeV592 = true;number = numberedTypeHeader.number;collectingAnalysis = false;continue; }

        const t = detectType(line);if (t) { type = t;explicitTypeV592 = true; }

        const contextualTypeV592 = type || inferQuestionTypeFromPromptV592([qlines.join(' '), line].filter(Boolean).join(' '), group);
        if (collectingSubjectiveAnswerV58917) {
          if (isAnalysisLine(line)) { collectingSubjectiveAnswerV58917 = false; } else { subjectiveAnswerLinesV58917.push(line);continue; }
        }

        if (isStandaloneAnswerHeaderV58917(line) && (type === 'short' || contextualTypeV592 === 'short' || groupTypeV592 === 'short')) {
          type = 'short';collectingSubjectiveAnswerV58917 = true;collectingAnalysis = false;continue;
        }

        const inlineAnswerTag = extractInlineAnswerTag(line, contextualTypeV592);
        if (inlineAnswerTag.answer.length) {
          if (shouldAdoptContextualType(type, contextualTypeV592)) { type = contextualTypeV592; }

          answer.push(...inlineAnswerTag.answer);line = inlineAnswerTag.text;
        }

        const lineAnswerExtract = extractTrailingAnswerFromText(line, contextualTypeV592);
        if (lineAnswerExtract.answer.length && !isAnswerLine(line)) {
          if (shouldAdoptContextualType(type, contextualTypeV592)) { type = contextualTypeV592; }

          answer.push(...lineAnswerExtract.answer);
          line = lineAnswerExtract.text;
        }

        const bareJudgeExtract = extractBareJudgeAnswerFromLine(line, type, group);
        if (bareJudgeExtract.answer.length) {
          type = 'judge';
          answer.push(...bareJudgeExtract.answer);
          line = bareJudgeExtract.text;
        }

        if (collectingAnswerImageOptionsV589) {
          if (isProtectedOrMarkdownImageOnlyV588(line)) {
            answerImageOptionsV589.push(...extractInlineImageTokensV589(line));
            continue;
          }

          collectingAnswerImageOptionsV589 = false;
        }

        // Handle combined 【答案】...【解析】... format
        const pbCombined = line.match(/^\s*(\d{1,4})\s*[.、．]\s*【答案】\s*([A-Ga-g]{1,7})\s*【解析】\s*(.*)$/);
        if (pbCombined) {
          number = pbCombined[1];answer = splitAnswerByType(pbCombined[2], type);
          analysis = (pbCombined[3] || '').trim();collectingAnalysis = true;seenQuestion = true;
          continue;
        }

        // Handle 答案解析 prefix
        if (/^答案解析\s*\d/.test(line)) {
          // 剥离同行答案解析标题，以便识别后续编号答案。
          const after = line.replace(/^答案解析\s*/, '');
          // 识别附带独立解析的编号和字母答案。
          const pbCA = after.match(/^(\d{1,4})\s*[.、．]\s*(?:【答案】\s*)?([A-Ga-g]{1,7})\s*(?:【解析】\s*(.*))?$/);
          if (pbCA) {
            number = pbCA[1];answer = splitAnswerByType(pbCA[2], type);if (pbCA[3]) { analysis = pbCA[3].trim();collectingAnalysis = true; }

            seenQuestion = true;
          }

          continue;
        }

        // Handle 解析 continuation lines (e.g., 2．【解析】C。explanation)
        const pbAnalysis = line.match(/^\s*(\d{1,4})\s*[.、．]\s*【解析】\s*([A-Ga-g]{1,7})\s*[。.]?\s*(.*)$/);
        if (pbAnalysis) {
          number = pbAnalysis[1];answer = splitAnswerByType(pbAnalysis[2], type);
          analysis = (pbAnalysis[3] || '').trim();collectingAnalysis = true;seenQuestion = true;
          continue;
        }

        // 支持”题号 答案 题目”格式，如：15. B 以下何者…… / 1. AD 下列何者……
        const pre = line.match(/^\s*(?:第\s*)?(\d+)\s*(?:题)?[.、．:：]?\s+([A-Ga-g]{1,7}|[对错正确错误√×XxTtFf])(?:\s+(.+))?$/);
        const englishArticleStemV5982 = !!(pre && /* 选项候选恰好是英语冠词 A 时需进一步检查。 */ /^[Aa]$/.test(pre[2] || '') && /* 冠词后跟正常英文单词时，优先保留为英语题干。 */ /^[A-Za-z][A-Za-z'’-]*/.test(String(pre[3] || '').trim()));
        if (pre && !englishArticleStemV5982 && (!seenQuestion || !options.length) && !isOptionLine(line)) {
          const maybeCode = /* 多个连续字母可能是编码的开头，并不一定是答案。 */ /^[A-Ga-g]{2,7}$/.test(pre[2] || '') && /* 字母后直接出现数字时按编码线索处理，排除答案成对误识别。 */ /^\s*\d/.test(pre[3] || '');
          // 已有明确解析标题的文本不能按普通题干回退。
          if (!maybeCode && !/【解析】/.test(pre[3] || '')) {
            number = pre[1]; answer.push(...splitAnswerByType(pre[2], type));
            if (pre[3]) { qlines.push(pre[3].trim());seenQuestion = true; }

            continue;
          }
        }

        // 支持答案在题号下一行分裂显示：2. / ABC / DE / 题干
        const onlyNo = line.match(/^\s*(?:第\s*)?(\d+)\s*(?:题)?[.、．:：]?\s*$/);
        if (onlyNo && !seenQuestion && !options.length) { number = onlyNo[1];continue; }

        // 独立字母串若出现在正文和选项之前，可作为原题预置答案。
        if (!seenQuestion && !options.length && /^[A-Ga-g]{1,7}$/.test(line)) {
          answer.push(...splitAnswer(line));
          continue;
        }

        // 兼容括号和中英文标题的明确参考答案行。
        const am = line.match(/^(?:【|\[)?\s*(?:正确答案|参考答案|标准答案|答案解析|答案|参考要点|答题要点|Answer|Correct\s*answer)\s*(?:】|\])?\s*[:：]?\s*(.+)$/i);
        if (am) {
          const amText = am[1].trim();
          const answerTypeV592 = type || inferQuestionTypeFromPromptV592(qlines.join(' '), group) || '';
          const amImageOptionsV589 = splitAnswerAndTrailingImagesV589(amText, answerTypeV592);
          // 单个答案行自带题号和解析时，分开保存字母答案和正文。
          const amCombined = amText.match(/^(\d{1,4})\s*[.、．]\s*(?:【答案】\s*)?([A-Ga-g]{1,7})\s*【解析】\s*(.*)$/);
          if (amImageOptionsV589.answer.length && amImageOptionsV589.images.length && !options.length) {
            answer = amImageOptionsV589.answer;
            answerImageOptionsV589.push(...amImageOptionsV589.images);
            collectingAnswerImageOptionsV589 = true;
            collectingAnalysis = false;
          } else if (amCombined) { number = amCombined[1];answer = splitAnswerByType(amCombined[2], answerTypeV592);analysis = (amCombined[3] || '').trim();collectingAnalysis = true; } else {
            answer = splitAnswerByType(amText, answerTypeV592);if (!type && answerTypeV592) { type = answerTypeV592; }

            collectingAnalysis = false;
          }

          continue;
        }

        // 捕获专门解析行的可选正文，兼容说明或考点标签。
        const xm = line.match(/^(?:【|\[)?\s*(?:解析|答案解析|试题解析|说明|考点)\s*(?:】|\])?\s*[:：]?\s*(.*)$/i);
        if (xm) { analysis = xm[1] || '';collectingAnalysis = true;continue; }

        // 兼容题干被 Word 断成两行：上一行“……使用”，下一行“(D）来选取文本。”，再下一行才是 A/B/C/D 选项。
        const leadingAnswerContinuation = line.match(/^\s*[（(]\s*([A-Ga-g]{1,7}|[1-9]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F)\s*[）)〕]\s*(.+)$/);
        // 下一行恢复 A 选项时，先结束题干前的答案续行状态。
        if (leadingAnswerContinuation && qlines.length && !options.length && /^\s*A\s*[、.．:：，,\s]/.test(lines[li + 1] || '')) {
          answer.push(...splitAnswerByType(leadingAnswerContinuation[1], type));
          qlines.push(leadingAnswerContinuation[2].trim());seenQuestion = true;
          continue;
        }

        // v58.1：兼容 Word/DOCX 中“选项标号单独一行，公式或图片在下一行”的场景。
        // 例如：A．\n![DOCX图片] 或 A．\n【DOCX公式OMML：...】。旧逻辑会把空选项丢掉，导致全公式/全图片选项题被跳过。
        if (pendingOptionKey && shouldMovePendingImageToStemV588(pendingOptionKey, line, qlines, options, group)) {
          qlines.push(line);seenQuestion = true;collectingAnalysis = false;unkeyedMode = false;
          continue;
        }

        if (pendingOptionKey && (isOptionLine(line) || isAnswerLine(line) || isAnalysisLine(line) || getHeadingType(line))) {
          pendingOptionKey = '';
        }

        if (pendingOptionKey && !isOptionLine(line) && !isAnswerLine(line) && !isAnalysisLine(line) && !getHeadingType(line)) {
          const pendingText = line.trim();
          if (pendingText) { options.push({ key: pendingOptionKey, text: pendingText }); }

          pendingOptionKey = '';collectingAnalysis = false;unkeyedMode = false;seenQuestion = true;
          continue;
        }

        // 选项仅有标签时暂存其编号，供下一行文字或图片补全。
        const labelOnlyOption = line.match(/^\s*(?:[oOxXuUyYvV√✔✓]\s*)?(?:[（(]\s*([A-Ga-g1-90])\s*[）)]|([A-Ga-g0])\s*[、.．:：，,]?)\s*$/);
        if (labelOnlyOption && (seenQuestion || qlines.length)) {
          pendingOptionKey = normalizeOptionKey(labelOnlyOption[1] || labelOnlyOption[2]);
          collectingAnalysis = false;unkeyedMode = false;seenQuestion = true;
          continue;
        }

        const firstOpt = splitTrailingFirstOptionFromQuestion(line, lines[li + 1] || '');
        if (firstOpt && !options.length) {
          qlines.push(firstOpt.question);seenQuestion = true;collectingAnalysis = false;unkeyedMode = false;pendingOptionKey = '';
          options.push({ key: firstOpt.key, text: firstOpt.text });
          continue;
        }

        // v58.1：兼容首个 A 选项标号在 Word 提取中丢失，但 B/C/D 仍在同一行的情况。
        // 例如：0.9005 B．0.9521 C．0.8573 D．0.9232，应恢复为 A/B/C/D 四个选项。
        const implicitAOptions = extractImplicitLeadingAOptions(line);
        if (implicitAOptions && implicitAOptions.length >= 3 && (seenQuestion || qlines.length) && !options.length) {
          collectingAnalysis = false;unkeyedMode = false;pendingOptionKey = '';
          for (const option of implicitAOptions) { if (option.text) { options.push(option); } }

          continue;
        }

        const narrativeEnumerationV58923 = isNumberedNarrativeEnumerationV58923(line, group);
        let richInline = narrativeEnumerationV58923 ? null : extractInlineOptionsRich(line);
        if (isNumberedQuestionRichOptionFalsePositiveV58923(line, richInline) || preferLeadingStandaloneOptionV58923(line, richInline)) { richInline = null; }

        if (richInline && richInline.options.length >= 2) {
          collectingAnalysis = false;unkeyedMode = false;pendingOptionKey = '';
          if (richInline.prefix && !options.length) { qlines.push(richInline.prefix);seenQuestion = true; }

          for (const it of richInline.options) {
            const key = normalizeOptionKey(it.key);let txt = (it.text || '').trim();
            if (hasCorrectOptionMark(it, txt)) { answer.push(key);txt = removeCorrectMark(txt); }

            if (it.extraAnswer && it.extraAnswer.length) { answer.push(...it.extraAnswer); }

            if (txt) { options.push({ key, text: txt }); }
          }

          continue;
        }

        // 组合题先列圈号陈述，再由 A-D 引用组合；这些陈述不能进入无标号选项兜底。
        const isCircledStemStatement = !options.length && !collectingAnalysis && qlines.length
      && /^[①-⑳]/.test(line) && /* 圈号行必须带实际陈述文字，排除只由组合符号组成的选项。 */ /[^①-⑳\s、，,；;。．.]/.test(line)
      && lines.slice(li + 1).some((next) => /* 后续存在明确 A 选项时，此前圈号行可确认为题干陈述。 */ /^\s*(?:A\s*[、.．:：]|[（(]\s*A\s*[）)])/.test(next));
        if (isCircledStemStatement) {
          qlines.push(line);seenQuestion = true;
          continue;
        }

        const semiOptions = splitSemicolonOptionsFromLine(line, answer);
        if (semiOptions && semiOptions.length >= 2 && (seenQuestion || qlines.length)) {
          collectingAnalysis = false;unkeyedMode = false;
          for (const option of semiOptions) { if (option.text) { options.push(option); } }

          continue;
        }

        const inlineOpts = narrativeEnumerationV58923 ? [] : splitInlineOptions(line);
        if (inlineOpts.length >= 2 || (inlineOpts.length === 1 && (options.length || seenQuestion))) {
          collectingAnalysis = false;unkeyedMode = false;
          for (const it of inlineOpts) {
            const key = normalizeOptionKey(it.key);let txt = (it.text || '').trim();
            if (hasCorrectOptionMark(it, txt)) { answer.push(key);txt = removeCorrectMark(txt); }

            if (txt) { options.push({ key, text: txt }); }
          }

          continue;
        }

        const bareEnglishStemWithoutQuestionV5982 = !seenQuestion && !qlines.length && !options.length && isBareEnglishStemStartV5982(line);
        // 兼容勾选前缀以及括号、分隔标点或直接接中文的普通选项。
        const om = bareEnglishStemWithoutQuestionV5982 ? null : line.match(/^\s*([oOxXuUyYvV√✔✓])?\s*(?:[（(]\s*([A-Ga-g1-90])\s*[）)]|([A-Ga-g0])\s*(?:[、.．:：，,]|\s+|(?=[\u4e00-\u9fa5])))\s*(.*)$/);
        if (om) {
          collectingAnalysis = false;unkeyedMode = false;
          const key = normalizeOptionKey(om[2] || om[3]);let txt = (om[4] || '').trim();
          if (om[1] || hasCorrectMark(txt)) { answer.push(key);txt = removeCorrectMark(txt); }

          // 检查选项尾部是否粘有明确答案标签，将答案与选项正文重新分离。
          const inlineAns = txt.match(/(?:^|[（(【[])(?:答案|正确答案)\s*[:：]?\s*([A-Ga-g1-9对错正确错误√×XxTtFf,，、;；/\s]+)[）)】\]]?$/);
          if (inlineAns) { answer.push(...splitAnswer(inlineAns[1]));txt = txt.replace(inlineAns[0], '').trim(); }

          if (txt) { options.push({ key, text: txt }); }

          continue;
        }

        if (collectingAnalysis) { analysis += (analysis ? '\n' : '') + line;continue; }

        const questionSeed = qlines.join(' ');
        const nextLine = lines[li + 1] || '';
        // 有明确 B–G 后续选项时，当前无标签行可能是前一个选项。
        const nextLooksLikeLaterOption = /^\s*[B-Gb-g]\s*[、.．:：]/.test(nextLine);
        const shouldBeUnkeyedOption = qlines.length && !looksLikeNewQuestionLine(line, group) && !isAnswerLine(line) && !isAnalysisLine(line) && (unkeyedMode || hasCorrectMark(line) || detectType(full) || /* 题干空括号支持紧随其后的无标签选项。 */ /[（(]\s*[）)]/.test(questionSeed) || nextLooksLikeLaterOption || /* 独立的判断用语也能成为无标签判断选项。 */ /^(对|错|正确|错误)$/.test(line));
        if (shouldBeUnkeyedOption) {
          const key = String.fromCharCode(65 + options.length);let txt = line.trim();unkeyedMode = true;
          if (hasCorrectMark(txt)) { answer.push(key);txt = removeCorrectMark(txt); }

          if (txt) { options.push({ key, text: txt }); }

          continue;
        }

        if (options.length && !unkeyedMode && !looksLikeNewQuestionLine(line, group) && !isAnswerLine(line) && !isAnalysisLine(line)) {
          options[options.length - 1].text = (`${options[options.length - 1].text} ${line}`).trim();
        } else if (!getHeadingType(line)) {
          qlines.push(line);seenQuestion = true;
        }
      }

      return finalizeParsedQuestion({
        number,
        type,
        options,
        answer,
        qlines,
        group,
        groupTypeV592,
        explicitTypeV592,
        answerImageOptionsV589,
        subjectiveAnswerLinesV58917,
        analysis,
      }, idx);
    }

    // 将历史数字和字母选项键归一为界面和评分使用的选项标签。
    function normalizeOptionKey(inputK) {
      let k = inputK;
      k = String(k || '').trim();
      if (k === '0') { return 'D'; }

      // 将小写 a–g 对应到大写选项编号。
      if (/^[a-g]$/.test(k)) { return k.toUpperCase(); }

      // 已标准化的 A–G 保留原样。
      if (/^[A-G]$/.test(k)) { return k; }

      return k;
    }

    // 拆解一行内用括号并排标记的选项，排除正文里的编号引用。
    function splitInlineOptions(line) {
      const rawLine = String(line || '');
      // 已用明确首行选项标签的内容由逐行选项规则读取。
      if (/^\s*(?:[oOxXuUyYvV√✔✓]\s*)?[A-Ga-g]\s*[、.．:：，,]/.test(rawLine)) { return []; }

      const s = maskLatexForOptionDetectionV58920(rawLine);
      // 收集带可选答案勾选标记的括号选项编号的位置。
      const re = /([oOxXuUyYvV√✔✓])?\s*[（(]\s*([A-Ga-g1-9])\s*[）)]/g;
      const hits = [];let m;
      while ((m = re.exec(s))) { hits.push({ idx: m.index, len: m[0].length, correct: !!m[1], key: m[2] }); }

      for (let i = hits.length - 1;i >= 0;i -= 1) {
        const h = hits[i];
        const key = String(h.key || '');
        // 数字标签比字母更可能是正文引用，需要额外核对上下文。
        if (/^\d$/.test(key)) {
          const before = rawLine.slice(Math.max(0, h.idx - 3), h.idx);
          const after = rawLine.slice(h.idx + h.len, h.idx + h.len + 3);
          if (/* 括号数字之前出现“第”时，应将其保留为正文序号。 */ /第\s*$/.test(before) || /* 括号数字后如果跟步骤、题号或次数等量词，也按正文引用处理。 */ /^\s*(?:步|式|项|問|问|题|處|处|次)/.test(after)) { hits.splice(i, 1); }
        }
      }

      if (hits.length < 1) { return []; }

      if (hits.length === 1 && hits[0].idx > 3) { return []; }

      return hits.map((h, i) => {
        const start = h.idx + h.len;const end = i + 1 < hits.length ? hits[i + 1].idx : rawLine.length;
        return { key: h.key, correct: h.correct, text: rawLine.slice(start, end).trim().replace(/* 清除单个选项正文末尾的中英文列表分隔符。 */ /[;；，,]+$/, '').trim() };
      }).filter((o) => o.text || o.correct);
    }

    // 当 Word 把多个标签和正文并入同一选项时恢复原顺序，同时保护图片内容。
    function repairEmbeddedOptions(options) {
      const out = [];
      const keyCode = (k) => String(k || 'A').toUpperCase().charCodeAt(0);

      for (const opt of (options || [])) {
        const txt = String(opt.text || '');
        if (/* 内嵌图片地址存在时避免扫描图像编码内的 A–G。 */ /data:image\//i.test(txt) || /* Markdown 图片中的字母标签同样不参与正文选项切分。 */ /!\[[^\]]*\]\(data:image\//i.test(txt) || /* 保护尚未还原的 Word 图片占位符，防止切断占位文本。 */ /\[\[DOCX_IMAGE_\d+\]\]/.test(txt)) {
          out.push(opt);
          continue;
        }

        const hits = [];
        const base = keyCode(opt.key);
        for (let i = 1;i < txt.length;i += 1) {
          const ch = txt[i];
          // 候选嵌套标签首先必须是 A–G 的单个大写字母。
          if (!/^[A-G]$/.test(ch)) { continue; }

          const key = normalizeOptionKey(ch);
          if (keyCode(key) <= base) { continue; }

          const prev = txt[i - 1] || '';
          const next = txt[i + 1] || '';
          // 常见标点或空白可以结束选项标签并开始新正文。
          const explicitAfter = /[、.．:：，,；;\s]/.test(next);
          // 字母直接接中文是无标点分隔的一种兼容形式。
          const noSeparatorAfter = /[\u4e00-\u9fa5]/.test(next);
          if (!explicitAfter && !noSeparatorAfter) { continue; }

          // v58.9.7：标准英文选项内容中大量出现 a/b/c/d/e/f/g，不能拆成新选项。
          // v58.9.23：无标点的 B/C/D 只有位于空白或标点边界时才是嵌入选项；
          // “A和B均”“A相/B相/C相”等普通题干、选项正文不能被二次拆分。
          if (followsAlphanumeric(prev)) { continue; }

          // 无标点标签前还应有空白或标点边界，排除词中偶然字母。
          if (noSeparatorAfter && prev && !/[\s；;，,、。！？?!]/.test(prev)) { continue; }

          let len = 1;
          // 跳过标签后连续出现的分隔符，让切片从实际正文开始。
          while (i + len < txt.length && /[、.．:：，,；;\s]/.test(txt[i + len])) { len += 1; }

          hits.push({ idx: i, len, key });
        }

        if (!hits.length) { out.push(opt);continue; }

        out.push({ ...opt, text: txt.slice(0, hits[0].idx).trim() });
        for (let i = 0;i < hits.length;i += 1) {
          const start = hits[i].idx + hits[i].len;
          const end = i + 1 < hits.length ? hits[i + 1].idx : txt.length;
          const part = txt.slice(start, end).trim();
          if (part) { out.push({ key: hits[i].key, text: part }); }
        }
      }

      return out.filter((o) => o.text);
    }

    function mergeDuplicateOptions(options) {
      const map = new Map();
      for (const o of options) { if (!map.has(o.key)) { map.set(o.key, { key: o.key, text: o.text }); } else { map.get(o.key).text = (`${map.get(o.key).text} ${o.text}`).trim(); } }

      return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
    }

    // 从历史题型字段或分区描述识别简繁体和英文题型别名。
    function mapType(inputS) {
      let s = inputS;
      s = String(s || '');
      // “逻辑判断/判断推理”是行测题型分区，仍然通常是单选题，不能按 true/false 判断题处理。
      if (/逻辑判断|判断推理|图形推理|定义判断|类比推理|资料分析|材料分析|言语理解|语言理解|数学运算|数量关系/i.test(s)) { return 'single'; }

      // 短答、问答、论述和主观等历史名称归为简答型。
      if (/简答|簡答|问答|問答|主观|主觀|名词解释|名詞解釋|论述|論述|short|essay/i.test(s)) { return 'short'; }

      // 填空或填充及英文别名归为按空作答。
      if (/填空|填充|blank|fill/i.test(s)) { return 'blank'; }

      // 复选、多项和英文 multiple 等别名归为多选题。
      if (/多选|多選|多项|多項|复选|複選|multiple|multi/i.test(s)) { return 'multiple'; }

      // 判断正误、是非和英文真假类型归为判断题。
      if (/判断题|判斷題|判断正误|判斷正誤|正误判断|是非题|judge|truefalse/i.test(s)) { return 'judge'; }

      // 兼容单项选择的简繁体标签和英文 single。
      if (/单选|單選|单项|單項|single/i.test(s)) { return 'single'; }

      return '';
    }

    function compactChoiceAnswerTokenV373(value) {
      // 压缩字母答案中的空白和分隔符，用于统一比较选项序列。
      return String(value || '').replace(/[\s\u3000,，、;；/|]+/g, '').toUpperCase();
    }

    // 将顺序合法的连续字母范围展开为独立选项，保持边界和顺序。
    function expandLetterAnswerRangeV373(value) {
      const s = String(value || '').trim();
      // 兼容中英文范围连接符，但两端必须是 A–G 中的单个字母。
      const m = s.match(/^\s*([A-Ga-g])\s*(?:-|－|–|—|~|～|至|到)\s*([A-Ga-g])\s*$/);
      if (!m) { return null; }

      const start = m[1].toUpperCase().charCodeAt(0);
      const end = m[2].toUpperCase().charCodeAt(0);
      if (start > end) { return null; }

      const out = [];
      for (let c = start;c <= end;c += 1) { out.push(String.fromCharCode(c)); }

      return out;
    }

    function isFullChoiceAnswerTokenV373(value) {
      // 清除全选提示中的夹杂分隔符，兼容导出排版。
      const s = String(value || '').trim().replace(/[\s\u3000,，、;；.。]+/g, '');
      // 只接受表达全选含义的完整短语，避免把正文中的“全部”视为答案。
      return /^(?:全选|全部|全部选项|所有选项|以上全选|以上都选|全都选|都选)$/.test(s);
    }

    // 单选题带多项合法且可对应的答案时需要以多选题语义保存。
    function shouldUpgradeSingleToMultipleV372(type, options, answer) {
      if (type !== 'single') { return false; }

      const opts = (options || []).filter((o) => o && String(o.key || '').trim());
      if (opts.length < 2) { return false; }

      const validKeys = new Set(opts.map((o) => normalizeOptionKey(o.key)).filter((k) => /* 只把 A–G 的真实选项键当作题型升级的证据。 */ /^[A-G]$/.test(k)));
      if (validKeys.size < 2) { return false; }

      const keys = (answer || []).flatMap((a) => splitAnswer(a)).map((a) => String(a || '').trim().toUpperCase()).filter((a) => validKeys.has(a));
      return new Set(keys).size > 1;
    }

    // 在缺少显式类型时根据分区、选项、答案及题干作答信号推断题型。
    function guessType(question, options, answer, group = '') {
      const gt = mapType(group);if (gt) { return gt; }

      const optionCount = (options || []).length;
      const hasChoiceOptions = optionCount >= 3 || (options || []).some((o) => /* C–G 选项说明题目超出通常的两项判断题结构。 */ /^[C-G]$/.test(String(o.key || '').toUpperCase()));
      const ans = (answer || []).map((a) => String(a || '').trim()).filter(Boolean);
      // 只要已经识别到选项，优先作为客观选择题处理。
      // “填入横线/补全语句”在行测、公考题库里通常仍是单选题，不能因为题干有空格就改成填空题。
      if (optionCount) {
        if (!hasChoiceOptions && isJudgeBlock(options, ans)) { return 'judge'; }

        if (ans.length > 1 && ans.every((a) => /* 多个可对应字母或数字选项的答案支持多选推断。 */ /^[A-G1-9]$/.test(String(a)))) { return 'multiple'; }

        // 题干明确要求多项选择时沿用该作答要求。
        if (/多选|多项选择/.test(question)) { return 'multiple'; }

        return 'single';
      }

      // v58.9.3：无选项题先看填空符号，再看简答语义，避免"主要作用是（）"被误判成简答。
      if (hasExplicitBlankPrompt(question)) { return 'blank'; }

      if (hasShortAnswerPrompt(question)) { return 'short'; }

      if (!optionCount && ans.length) {
        if (ans.some((a) => isJudgeSymbolAnswer(a))) { return 'judge'; }

        if (ans.every((a) => /* 没有可靠选项时，纯字母答案仍可提供单选或多选信号。 */ /^[A-Ga-g]$/.test(a))) { return ans.length > 1 ? 'multiple' : 'single'; }

        // 无选项题不再只凭“答案短/数字短”推成填空，避免简答题被误判。
        return 'short';
      }

      return 'single';
    }

    function hasCorrectMark(s) {
      const text = String(s || '');
      return /* 选项中明确答案字样或独立勾选字符可标记正确答案。 */ /(?:正确答案|答案正确|参考答案|标准答案|✔|✓)/.test(text) || /* 因根号也用于公式，只有位于空白或括号边界的 √ 才当勾选标记。 */ /(?:^|[\s（(【[])√(?=\s|$|[）)】\]])/.test(text);
    }

    function hasCorrectOptionMark(option, text) {
      return option.correct || hasCorrectMark(text);
    }

    function followsAlphanumeric(previous) {
      // 若前一个字符是英文字母或数字，选项字母可能仍在原词内。
      return previous && /[A-Za-z0-9]/.test(previous);
    }

    // 保留选项内容并剥离已用于识别正确答案的显示标记。
    function removeCorrectMark(s) {
      return String(s || '')
        .replace(/* 移除括号完整包裹的正确选项标记。 */ /[（(【[]\s*(?:正确答案|答案正确|参考答案|标准答案)\s*[）)】\]]/g, '')
        .replace(/* 兼容不带括号的显式答案字样。 */ /(?:正确答案|答案正确|参考答案|标准答案)/g, '')
        .replace(/* 去掉已经消费的勾选符号。 */ /[✔✓]/g, '')
        .replace(/* 只在约定边界移除 √，保留真正的数学根号。 */ /(^|[\s（(【[])√(?=\s|$|[）)】\]])/g, '$1')
        .replace(/* 折叠移除标记后残留的重复空白。 */ /\s+/g, ' ').trim();
    }

    // 解析旧题库常见的选择和判断答案格式，并避免把解析正文或说明词当作选项。
    function splitAnswer(inputS) {
      let s = inputS;
      if (Array.isArray(s)) { return s.flatMap((x) => splitAnswer(x)); }

      s = String(s ?? '').trim();
      // 若答案附带解析标题，只保留标题以前的答案。
      s = s.replace(/\s*(?:解析|答案解析|说明|解题思路)\s*[:：][\s\S]*$/, '').trim();
      s = stripAnswerPrefix(s);
      // 当整个短答案在圆括号内时去掉外层括号。
      s = s.replace(/^[（(]\s*([\s\S]{1,80})\s*[）)]$/, '$1').trim();
      // 兼容用中式或方括号包裹整个短答案。
      s = s.replace(/^[【[]\s*([\s\S]{1,80})\s*[】\]]$/, '$1').trim();
      // 移除答案尾部的中英文句读和空白。
      s = s.replace(/[。．.、，,；;：:\s]+$/, '').trim();
      if (!s) { return []; }

      const letterRangeV373 = expandLetterAnswerRangeV373(s);if (letterRangeV373) { return letterRangeV373; }

      if (isFullChoiceAnswerTokenV373(s)) { return ['__ALL_OPTIONS__']; }

      // 接受单个数字选项及其可选圆括号。
      const numeric = s.match(/^[（(]?\s*([1-9])\s*[）)]?$/);if (numeric) { return [numeric[1]]; }

      // 数字序号答案可能使用中英文列表分隔符或括号。
      const numericCompact = s.replace(/[\s,，、;；/\\()（）]+/g, '');
      // 连续两项以上有效数字可逐字恢复多项序号答案。
      if (/^[1-9]{2,9}$/.test(numericCompact)) { return numericCompact.split(''); }

      // 处理用空白、标点或括号分隔的字母答案，并统一大小写。
      const letterCompact = s.replace(/[\s,，、;；/\\()（）]+/g, '').toUpperCase();
      // A–G 的短字母序列可直接拆成一个或多个选项。
      if (/^[A-G]{1,7}$/.test(letterCompact)) { return letterCompact.split(''); }

      // 提取答案中疑似独立的 A–G 字母，以便进一步排除混入正文。
      const separatedLetters = s.match(/[A-Ga-g]/g);
      if (separatedLetters && separatedLetters.length >= 2 && s.replace(/* 只有去掉字母与约定分隔符后无剩余内容，才接受提取出的多项答案。 */ /[A-Ga-g\s,，、;；/\\()（）]+/g, '').trim() === '') { return separatedLetters.map((x) => x.toUpperCase()); }

      // “A. 选项正文”格式只取开头有明确标点的选项键。
      const leadOpt = s.match(/^([A-Ga-g])\s*[、.．:：]\s*.+$/);if (leadOpt) { return [leadOpt[1].toUpperCase()]; }

      // 把中文肯定词、勾记和英文真假标记统一为正确。
      if (/^(?:对|正确|是|√|✓|✔|v|V|T|True)$/i.test(s)) { return ['正确']; }

      // 把中文否定词、叉记和英文假标记统一为错误。
      if (/^(?:错|错误|否|×|X|x|F|False)$/i.test(s)) { return ['错误']; }

      if (looksLikeTextualAnswer(s)) { return []; }

      // 最后的兼容路径按中英文空白和分隔符拆开候选。
      const parts = s.split(/[\s,，、;；/\\]+/).map((x) => x.trim()).filter(Boolean);
      if (parts.length > 1) {
        const parsed = parts.flatMap((x) => splitAnswer(x));
        return parsed.length && parsed.length === parts.length ? parsed : [];
      }

      return [];
    }

    // 让各答案项遵循题型和已有选项键，避免原始别名进入评分。
    function normalizeAnswer(answer, options, type) {
      const out = [];
      for (const raw of (answer || [])) {
        const token = String(raw ?? '').trim();if (!token) { continue; }

        const key = mapAnswerToken(token, options, type);
        if (Array.isArray(key)) { out.push(...key); } else if (key) { out.push(key); }
      }

      return [...new Set(out.map((x) => String(x).trim().toUpperCase()).filter(Boolean))];
    }

    // 将单个已分割答案映射为正式选项，兼容组合字母和数字序号。
    function mapAnswerToken(token, options, type) {
      const t = String(token).trim();
      if (type === 'judge') { return judgeToKey(t, options); }

      const rangeV373 = expandLetterAnswerRangeV373(t);if (rangeV373) { return rangeV373; }

      if (t === '__ALL_OPTIONS__' || isFullChoiceAnswerTokenV373(t)) {
        const keys = (options || []).map((o) => normalizeOptionKey(o.key)).filter((k) => /* 过滤无法与评分规则对应的选项键，供答案映射使用。 */ /^[A-G1-9]$/.test(k));
        return keys.length >= 2 ? keys : [];
      }

      // 将单个小写或大写字母归一成大写选项键。
      if (/^[A-Ga-g]$/.test(t)) { return t.toUpperCase(); }

      // 将不含分隔符的多个字母拆成独立选项。
      if (/^[A-Ga-g]{2,7}$/.test(t)) { return t.toUpperCase().split(''); }

      // 单个数字序号保持原始文本形式，交给上层选项匹配。
      if (/^[1-9]$/.test(t)) { return t; }

      // 多个连续数字应作为独立的序号选项。
      if (/^[1-9]{2,9}$/.test(t)) { return t.split(''); }

      // 非判断题不把 √/×/v/x 当成 A/B，避免题型误判时静默错配。
      if (isJudgeSymbolAnswer(t)) { return ''; }

      const hit = options.find((o) => normalizeText(o.text) === normalizeText(t) || (normalizeText(o.text).includes(normalizeText(t)) && normalizeText(t).length >= 2));
      return hit ? hit.key : t;
    }

    function isJudgeSymbolAnswer(a) {
      // 只有整段内容是对错词或约定符号时才视为判断答案。
      return /^(?:对|错|正确|错误|是|否|√|✓|✔|×|X|x|v|V|T|F|True|False)$/i.test(String(a ?? '').trim());
    }

    function isRawJudgeSymbolAnswer(a) {
      // 清除明示答案标签后再识别判断符号，兼容原始导入行。
      return isJudgeSymbolAnswer(String(a ?? '').replace(/^(?:答案|正确答案|参考答案|标准答案)\s*[:：]?\s*/, '').trim());
    }

    function isJudgeCorrectToken(t) {
      // 将对、是、√ 和真值等明确标记映射到肯定判断。
      return /^(?:对|正确|是|√|✓|✔|v|V|T|True)$/i.test(String(t ?? '').trim());
    }

    function isJudgeWrongToken(t) {
      // 将错、否、× 和假值等明确标记映射到否定判断。
      return /^(?:\u9519|\u9519\u8bef|\u5426|\u00D7|X|x|F|False)$/i.test(String(t ?? '').trim());
    }

    function isExactJudgeOptionText(s) {
      // 判断选项应是完整的对错标记，排除同时包含解释文字的选项。
      return /^(?:\u5bf9|\u9519|\u6b63\u786e|\u9519\u8bef|\u662f|\u5426|\u221A|\u2713|\u2714|\u00D7|x|true|false)$/i.test(String(s || '').trim());
    }

    // 只有两项明确且相反的判断选项，才用选项结构证实判断题。
    function isJudgeOptionPair(options) {
      const opts = (options || []).filter((o) => o && String(o.text || '').trim());
      if (opts.length !== 2) { return false; }

      const a = String(opts[0].text || '').trim();
      const b = String(opts[1].text || '').trim();
      const aRight = isJudgeCorrectToken(a); const aWrong = isJudgeWrongToken(a);
      const bRight = isJudgeCorrectToken(b); const bWrong = isJudgeWrongToken(b);
      return isExactJudgeOptionText(a) && isExactJudgeOptionText(b) && ((aRight && bWrong) || (aWrong && bRight));
    }

    // 根据已有选项和对错答案判断题块类型，保留选择题证据优先级。
    function isJudgeBlock(options, answer) {
      const opts = options || [];
      const explicitJudge = (answer || []).some((a) => isJudgeSymbolAnswer(a));
      if (!opts.length) { return explicitJudge; }

      if (opts.length >= 3 || opts.some((o) => /* C–G 的独立选项排除只有两项正误选项的判断题。 */ /^[C-G]$/.test(String(o.key || '').toUpperCase()))) { return false; }

      return explicitJudge && isJudgeOptionPair(opts);
    }

    // 兼容只导入一个正误选项的判断题，同时保留原有选项键和文本。
    function normalizeJudgeOptions(inputOptions) {
      let options = inputOptions;
      options = (options || []).filter((o) => o && o.text).map((o) => ({ key: normalizeOptionKey(o.key), text: String(o.text || '').trim() }));

      if (!options.length) { return [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }]; }

      if (options.length === 1) {
        const t = normalizeText(options[0].text);
        // 只有明确正确项时补入缺失的错误项。
        if (/^(对|正确|是|√|v|true)$/.test(t)) { return [options[0], { key: 'B', text: '错误' }]; }

        // 只有明确错误项时补入缺失的正确项。
        if (/^(错|错误|否|×|x|false)$/.test(t)) { return [{ key: 'A', text: '正确' }, options[0]]; }
      }

      return options;
    }

    // 优先按完整正误符号确定选项归属，再回退到选项描述中的证据。
    function judgeOptionMap(inputOptions) {
      let options = inputOptions;
      options = normalizeJudgeOptions(options);
      const exactCorrect = options.find((o) => /* 完整的对、是、勾或真值是最高优先级的肯定选项。 */ /^(对|正确|是|√|✓|✔|true)$/i.test(String(o.text || '').trim()));
      const exactWrong = options.find((o) => /* 完整的错、否、叉或假值是最高优先级的否定选项。 */ /^(错|错误|否|×|x|false)$/i.test(String(o.text || '').trim()));
      const looseCorrect = options.find((o) => /* 回退寻找正文中的肯定词，排除它紧随“不”或“非”的情况。 */ /(^|[^不非])(?:对|正确|是|√|✓|✔|true)/i.test(String(o.text || '')));
      const looseWrong = options.find((o) => /* 回退允许选项正文中包含明确否定词或叉记。 */ /(错|错误|否|×|x|false)/i.test(String(o.text || '')));
      return {
        correctKey: (exactCorrect || looseCorrect || options[0] || { key: 'A' }).key,
        wrongKey: (exactWrong || looseWrong || options[1] || { key: 'B' }).key,
        confidence: !!((exactCorrect || looseCorrect) && (exactWrong || looseWrong)),
      };
    }

    // 兼容直接给出的 A/B 键，也能把判断符号映射到正确的原选项。
    function judgeToKey(a, options) {
      const t = String(a ?? '').trim();
      const map = judgeOptionMap(options);
      // 对已明确填写 A 或 B 的答案保留其选项键。
      if (/^[A-Ba-b]$/.test(t)) { return t.toUpperCase(); }

      // 判断题只接受 A/B 或明确的对错符号；C/D/E 等选择题答案不再静默接受。
      if (/^[C-Gc-g]$/.test(t)) { return ''; }

      if (isJudgeCorrectToken(t)) { return map.correctKey; }

      if (isJudgeWrongToken(t)) { return map.wrongKey; }

      return '';
    }

    // 收集题目级导入异常，保留题号以便在预览中定位。
    function collectImportWarnings(arr) {
      const warnings = [];
      (arr || []).forEach((q, i) => {
        const status = validateQuestion(q);if (status !== '正常') { warnings.push(`第${i + 1}题：${status}`); }
      });

      return warnings;
    }

    function cleanImportedQuestion(q) {
      const fixed = cleanQuestionStemAndAnswer(q.question, q.answer, q.type, q.options || []);
      return { ...q, question: fixed.question, answer: isTextType(q.type) ? splitTextAnswer(fixed.answer.join('；')) : normalizeAnswer(fixed.answer, q.options || [], q.type), normalized: normalizeText(fixed.question) };
    }

    // 仅在题型或题号提供证据时，从行尾分离没有标签的判断答案。
    function extractBareJudgeAnswerFromLine(line, type = '', group = '') {
      const s = String(line || '').trim();
      if (!s || isAnswerLine(s) || isOptionLine(s)) { return { text: s, answer: [] }; }

      const contextIsJudge = mapType(group) === 'judge' || type === 'judge';
      // 捕获由空白或标点隔开的行尾正误结果，允许附带简短答案前缀。
      const m = s.match(/^(.*?)(?:\s+|[。\uFF1B;，,\u3001])(?:\u7b54\u6848\s*(?::|\uFF1A)?\s*)?(\u6b63\u786e|\u9519\u8bef|\u5bf9|\u9519|\u662f|\u5426|\u221A|\u2713|\u2714|\u00D7|X|x|T|F|True|False)\s*$/i);
      if (!m) { return { text: s, answer: [] }; }

      const stem = (m[1] || '').trim();
      const token = (m[2] || '').trim();
      // 明确编号题干比无编号正文更适合拆分裸判断答案。
      const hasQuestionNo = /^\s*(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]/.test(stem);
      // 单独的勾叉等符号比对错词更能明确指出行尾答案。
      const tokenIsSymbol = /^(?:\u221A|\u2713|\u2714|\u00D7|X|x|T|F)$/i.test(token);
      if (!contextIsJudge && !(hasQuestionNo && tokenIsSymbol)) { return { text: s, answer: [] }; }

      if (stem.length < 6) { return { text: s, answer: [] }; }

      // 去掉从原题干中分离答案后余下的句末分隔符。
      return { text: stem.replace(/[??;?,?]\s*$/, '').trim(), answer: splitAnswer(token) };
    }

    // 找出题干末尾的明确答案标记，在保留题干文字的同时分离答案。
    function extractTrailingAnswerFromText(text, type) {
      let s = String(text || '').trim();let found = [];
      // 捕获题干末尾用括号写出的对错答案，保留之前的正文。
      const bareJudge = s.match(/^(.*?)[。.!！?？]?\s*[\uFF08(]\s*(\u5bf9|\u9519|\u6b63\u786e|\u9519\u8bef|\u662f|\u5426|\u221A|\u2713|\u2714|\u00D7|X|x|v|V|T|F|True|False)\s*[\uFF09)]\s*$/i);
      if (bareJudge) {
        const stem = (bareJudge[1] || '').trim();
        // 使用明确题号支持识别尾部括号正误答案。
        const hasQuestionNo = /^\s*(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]/.test(stem);
        // 已出现同行选择题选项时，不应把尾部括号符号当作裸判断答案。
        const hasInlineChoice = /(?:^|[\s;，、])A\s*[、.．:：，,]|(?:^|[\s;，、])B\s*[、.．:：，,]|(?:^|[\s;，、])C\s*[、.．:：，,]|(?:^|[\s;，、])D\s*[、.．:：，,]/i.test(stem);
        if ((type === 'judge' || (hasQuestionNo && stem.length >= 8 && !hasInlineChoice))) {
          // 取走判断答案后清除题干尾部的分隔标点。
          return { text: stem.replace(/[?.!???]\s*$/, '').trim(), answer: splitAnswer(bareJudge[2]) };
        }
      }

      const pats = [
        /* 识别用圆括号或中式方括号包裹的明确答案标题。 */ /(?:[\uFF08(\u3010[]\s*(?:\u6b63\u786e\u7b54\u6848|\u53c2\u8003\u7b54\u6848|\u6807\u51c6\u7b54\u6848|\u7b54\u6848)\s*(?::|\uFF1A)?\s*([^\uFF09)\u3011\]]+)\s*[\uFF09)\u3011\]]\s*)$/i,
        /* 兼容裸露在题干末尾的答案或参考要点标题。 */ /(?:\s|^)(?:\u6b63\u786e\u7b54\u6848|\u53c2\u8003\u7b54\u6848|\u6807\u51c6\u7b54\u6848|\u7b54\u6848|\u53c2\u8003\u8981\u70b9|\u7b54\u9898\u8981\u70b9)\s*(?::|\uFF1A)?\s*([^\n]+?)\s*$/i,
      ];
      for (const re of pats) {
        const m = s.match(re);
        if (m) {
          const candidate = m[1].trim();
          const a = splitAnswerByType(candidate, type);
          if (a.length) { found = a;s = s.slice(0, m.index).trim();break; }
        }
      }

      return { text: s, answer: found };
    }

    // 分离题干内泄漏的已知答案，保护 LaTeX、正常括注和题目已有正确选项。
    function cleanQuestionStemAndAnswer(question, answer = [], type = '', options = []) {
      let ans = [...(answer || [])].filter(Boolean);
      let q = String(question || '').trim();
      const ex = extractTrailingAnswerFromText(q, type);
      if (ex.answer.length) { ans = ans.concat(ex.answer);q = ex.text; }

      const optionTexts = (options || []).map((o) => String(o.text || '')).filter(Boolean);
      const latexMaskV58920 = maskLatexForOptionDetectionV58920(q);
      const inLatexV58920 = (offset, len) => /* 当候选区间全被掩码空白覆盖时，将其视为 LaTeX 内容并跳过。 */ /^\s+$/.test(latexMaskV58920.slice(offset, offset + len));

      const answerKeys = ans.map((a) => String(a || '').trim().toUpperCase()).filter((a) => /* 仅抽出已有答案中的明确字母选项，供比较括号中的内容。 */ /^[A-G]$/.test(a));
      const correctOptionTexts = (options || []).filter((o) => answerKeys.includes(String(o.key || '').toUpperCase())).map((o) => String(o.text || ''));
      q = q.replace(/* 查找可能泄露答案的短括号内容，保留判断所需的原文偏移。 */ /[\uFF08(]\s*([^()\uFF08\uFF09]{1,120})\s*[\uFF09)\u3015]/g, /* 用题型、已有选项和 LaTeX 掩码判断每个括号是否可换成作答空位。 */ (m, inner, offset) => {
        if (inLatexV58920(offset, m.length)) { return m; }

        const raw = String(inner || '').trim();
        if (!raw) { return '（ ）'; }

        // 兼容字母范围连接符，压缩后再检查是否只含选项字符。
        const compact = compactChoiceAnswerTokenV373(raw).replace(/[-－–—~～]/g, '');
        const looksLikeChoiceAnswer = /* 短 A–G 字母串可能是显式选择答案。 */ /^[A-G]{1,7}$/.test(compact) || /* 仅包含数字选项的短串也作为已知答案证据。 */ /^[1-9]{1,9}$/.test(compact);
        // 对错词、真假或勾叉符号可明确表示判断答案。
        const looksLikeJudgeAnswer = /^(?:\u5bf9|\u9519|\u6b63\u786e|\u9519\u8bef|\u662f|\u5426|\u221A|\u00D7|X|x|v|V|T|F|TRUE|FALSE)$/i.test(raw);
        const allowChoiceAnswer = looksLikeChoiceAnswer && type !== 'judge';
        if (allowChoiceAnswer || (looksLikeJudgeAnswer && (type === 'judge' || !(options || []).length))) {
          const hasKeyAnswer = ans.some((a) => /* 已有明确字母答案时，后续拆分须避免覆盖真实答案。 */ /^[A-Ga-g]$/.test(String(a || '').trim()));
          // 只有允许选择题且候选是纯字母答案时，才附加到既有答案。
          const shouldAdd = !hasKeyAnswer || (allowChoiceAnswer && /^[A-G]{1,7}$/.test(compact)) || (looksLikeJudgeAnswer && type === 'judge');
          if (shouldAdd) { ans = ans.concat(splitAnswer(raw)); }

          return '（ ）';
        }

        const n = normalizeTextAnswerForCompare(raw);
        const normAns = ans.map((a) => normalizeTextAnswerForCompare(a)).filter(Boolean);
        if (normAns.includes(n)) { return '（ ）'; }

        const matchesOption = optionTexts.some((t) => {
          const nt = normalizeTextAnswerForCompare(t);
          return nt === n || (n.length >= 2 && nt.includes(n)) || (nt.length >= 2 && n.includes(nt));
        });
        const matchesCorrectOption = correctOptionTexts.some((t) => {
          const nt = normalizeTextAnswerForCompare(t);
          return nt === n || (n.length >= 2 && nt.includes(n)) || (nt.length >= 2 && n.includes(nt));
        });
        // 预案、队站或行政区划类文字通常是正文括注，即使命中选项文字也予以保留。
        if ((matchesCorrectOption || matchesOption) && !/预案|方案|队站|站|县级以上|市级以上/.test(raw)) { return '（ ）'; }

        return m;
      });

      q = q.replace(/* 兼容因导入截断缺右括号的题干尾部短答案。 */ /[\uFF08(]\s*([A-Ga-g][A-Ga-g\s,，、;；/\\]{0,12}|[1-9][1-9\s,，、;；/\\]{0,12}|对|错|正确|错误|是|否|\u221A|\u00D7|X|v|V|T|F|True|False)\s*$/g, /* 对未闭合的尾部括注同样验证其是否为答案，并保留公式内容。 */ (m, inner, offset) => {
        if (inLatexV58920(offset, m.length)) { return m; }

        // 去掉尾部答案中的空白和列表分隔，再判断其选项语义。
        const compact = String(inner || '').replace(/[\s,，、;；/\\]+/g, '').toUpperCase();
        const isChoice = /* A–G 字母序列可作为未闭合括号内的客观答案。 */ /^[A-G]{1,7}$/.test(compact) || /* 数字序号序列也可作为客观答案。 */ /^[1-9]{1,9}$/.test(compact);
        if (type === 'judge' && isChoice) { return m; }

        ans = ans.concat(splitAnswer(inner));
        return '（ ）';
      });

      // 清理替换答案后多出的空白，恢复稳定的题干间隔。
      return { question: q.replace(/\s+/g, ' ').trim(), answer: [...new Set(ans)] };
    }

    // 根据候选位置与选项键连续性选出可信序列，减少自然文本间偶然匹配。
    function selectOrderedOptionHits(inputHits) {
      let hits = inputHits;
      hits = [...hits].map((h) => (String(h.key) === '0' ? { ...h, key: 'D' } : h)).sort((a, b) => a.idx - b.idx);

      const de = [];
      for (const h of hits) { if (!de.some((x) => Math.abs(x.idx - h.idx) < 2 && String(x.key).toUpperCase() === String(h.key).toUpperCase())) { de.push(h); } }

      const letters = de.filter((h) => /* 分开考虑 A–G 字母选项，保持对前后顺序的验证。 */ /^[A-Ga-g]$/.test(String(h.key || '')));
      if (letters.length >= 2) {
        const start = letters.find((h) => String(h.key).toUpperCase() === 'A') || letters[0];
        const seq = [];const need = String(start.key).toUpperCase().charCodeAt(0);let pos = start.idx - 1;
        for (let code = need;code <= 71;code += 1) {
          const previousPosition = pos;
          const hit = letters.find((h) => h.idx > previousPosition && String(h.key).toUpperCase().charCodeAt(0) === code);
          if (!hit) { break; }

          seq.push(hit);pos = hit.idx;
        }

        if (seq.length >= 2) { return seq; }
      }

      const nums = de.filter((h) => /* 数字候选单独验证，避免与字母候选混用造成错配。 */ /^[1-9]$/.test(String(h.key || '')));
      if (nums.length >= 2) {
        const start = nums.find((h) => String(h.key) === '1') || nums[0];
        const seq = [];const need = Number(start.key);let pos = start.idx - 1;
        for (let n = need;n <= 9;n += 1) {
          const previousPosition = pos;
          const hit = nums.find((h) => h.idx > previousPosition && String(h.key) === String(n));
          if (!hit) { break; }

          seq.push(hit);pos = hit.idx;
        }

        if (seq.length >= 2) { return seq; }
      }

      return de;
    }

    // 用等长空白掩盖 LaTeX 区间，防止公式内部字母被误认为选项且保留偏移。
    function maskLatexForOptionDetectionV58920(text) {
      const raw = String(text || '');
      if (!raw) { return raw; }

      let out = '';
      for (let i = 0;i < raw.length;) {
        if (raw[i] === '\\' && (raw[i + 1] === '(' || raw[i + 1] === '[')) {
          const close = raw[i + 1] === '(' ? '\\)' : '\\]';
          const end = raw.indexOf(close, i + 2);
          if (end >= 0) { const seg = raw.slice(i, end + 2);out += ' '.repeat(seg.length);i = end + 2;continue; }
        }

        if (raw[i] === '$') {
          let j = i + 1;
          if (raw[j] === '$') { j += 1; }

          const double = raw[i + 1] === '$';
          let end = -1;
          for (let k = j;k < raw.length;k += 1) {
            if (raw[k] === '\\') { k += 1;continue; }

            if (raw[k] === '$') {
              if (double) { if (raw[k + 1] === '$') { end = k + 2;break; } } else { end = k + 1;break; }
            }
          }

          if (end > i) { const seg = raw.slice(i, end);out += ' '.repeat(seg.length);i = end;continue; }
        }

        if (raw.startsWith('【DOCX公式OMML：', i)) {
          const end = raw.indexOf('】', i);
          if (end >= 0) { const seg = raw.slice(i, end + 1);out += ' '.repeat(seg.length);i = end + 1;continue; }
        }

        out += raw[i];i += 1;
      }

      return out;
    }

    // 恢复富文本中的同行选项，按多种排版证据选取连续标签并保护数学表达式。
    function extractInlineOptionsRich(line) {
      const rawLine = String(line || '').trim();
      if (!rawLine) { return null; }

      const s = maskLatexForOptionDetectionV58920(rawLine);
      // 兼容答案选项本身也是字母的紧凑行：A.D B.C C.B D.A
      if (!/[\u4e00-\u9fa5]/.test(s)) {
        const vals = [];let vm;const vre = /* 识别用明确字母选项标签分隔且正文也为单字母的短选项。 */ /([A-Ga-g])\s*[.．、:：]\s*([A-Ga-g])(?=\s|$|[A-Ga-g]\s*[.．、:：])/g;
        while ((vm = vre.exec(s))) { vals.push({ key: normalizeOptionKey(vm[1]), text: vm[2].toUpperCase() }); }

        if (vals.length >= 2) {
          const order = vals.map((v) => v.key).join('');
          // 只接受从 A 开始的有序选项串，排除正文中的零散字母。
          if (/^ABCD?|ABCDEF?G?$/.test(order)) { return { prefix: '', options: vals }; }
        }
      }

      // 兼容强粘连选项：A.0.2MPaB.0.3MPaC.0.5MPaD.0.8MPa
      {
        const gh = [];let gm;const gre = /* 搜索紧凑的独立选项标签，兼容 OCR 将 D 错写成 0。 */ /([A-Da-d0])\s*[、.．:：]\s*/g;
        while ((gm = gre.exec(s))) {
          const idx = gm.index; const key = gm[1];
          const prev = idx > 0 ? s[idx - 1] : '';
          const after = s.slice(gre.lastIndex).trimStart()[0] || '';
          if (key === '0' && (/* 0 后还有数字时更可能是数字值，不能修成 D。 */ /^[\d]/.test(after) || /* 数字或小数点之后的 0 仍属于数值。 */ /[\d.．]/.test(prev))) { continue; }

          if (/* 括号左半边紧邻候选时，需验证其是否为正文括注。 */ /[（(]/.test(prev) && /* 同时紧跟右括号表明该匹配很可能来自完整括注。 */ /[）)〕]/.test(after)) { continue; }

          gh.push({ idx, len: gm[0].length, key, correct: false });
        }

        const seq = selectOrderedOptionHits(gh);
        if (seq.length >= 3 && String(seq[0].key).toUpperCase() === 'A') {
          // 切出题干后去掉因选项分段而遗留的列表分隔标点。
          const prefix = rawLine.slice(0, seq[0].idx).trim().replace(/[;；，,、]+$/, '').trim();
          const options = seq.map(/* 按选项位置提取正文，并保持 OCR 修复后的键和顺序。 */ (h, i) => {
            const start = h.idx + h.len;const end = i + 1 < seq.length ? seq[i + 1].idx : s.length;
            const txt = rawLine.slice(start, end).trim().replace(/* 跳过紧跟在选项标签后的列表分隔符。 */ /^[;；，,、]+/, '').replace(/* 去掉选项切片末端的列表分隔符。 */ /[;；，,、]+$/, '').trim();
            const ex = extractTrailingAnswerFromText(txt, '');
            return { key: normalizeOptionKey(h.key), correct: false, text: ex.text, extraAnswer: ex.answer };
          }).filter((o) => o.text || o.extraAnswer.length);
          if (options.length >= 2) { return { prefix, options }; }
        }
      }

      const hits = [];
      // 收集带标点或空白边界的 A–G 标签，并纳入可能误识别为 0 的 D。
      const re = /([A-Ga-g0])\s*([、.．:：，,]|\s+)\s*/g;
      let m;
      while ((m = re.exec(s))) {
        const idx = m.index;
        const keyRaw = m[1];
        const sep = m[2] || '';
        const prev = idx > 0 ? s[idx - 1] : '';
        const next = s[re.lastIndex] || '';
        const after = s.slice(re.lastIndex).trimStart()[0] || '';
        // 若标签只靠空白分隔，则需要更强选项结构证据。
        const whitespaceSepOnly = /^\s+$/.test(sep);
        // v58.9.7：英文判断题题干里常有 “a vowel sound and ...”、"a television ..."。
        // 不能把小写 a/b/c/d/e/f/g + 空格误当作 A-G 选项；否则标准英文判断题会粘连/拆坏。
        // 真正的英文选项通常写成 A. / B.，或至少用大写 A/B/C/D 作为独立标号。
        if (whitespaceSepOnly && /^[a-g]$/.test(keyRaw)) { continue; }

        // 避免把 API、100Bc、A级油井水泥、题干括号里的答案“（D ）”误作选项。
        if (followsAlphanumeric(prev)) { continue; }

        if ((/* 检查紧邻的左括号，以跳过正文中的括号字母。 */ /[（(]/.test(prev) || /* 左括号和字母之间允许排版空白，仍视为括注候选。 */ /[（(]\s*$/.test(s.slice(Math.max(0, idx - 4), idx))) && /* 只有对应右括号时，才据此排除独立选项标签。 */ /[）)〕]/.test(after)) { continue; }

        if (keyRaw === '0' && (/* 0 后连着数字时是数值的一部分，不能修复为 D。 */ /^[\d]/.test(after) || /* 数字或小数标记紧随在候选前时，优先保留数值含义。 */ /[\d.．]/.test(prev))) { continue; }

        if (!next) { continue; }

        hits.push({ idx, len: m[0].length, key: keyRaw, correct: false });
      }

      // 兼容 A从左向右、B粉煤灰、C控制系统、D套管 这种没有标点的选项。
      const noSepRe = /([A-Da-d])(?=[\u4e00-\u9fa5])/g;
      while ((m = noSepRe.exec(s))) {
        const idx = m.index;
        const prev = idx > 0 ? s[idx - 1] : '';
        const next = s[idx + 1] || '';
        // 避免 HSE计划、API标准、A级/G级、WB型、C100-30 等被当作无分隔选项。
        if (followsAlphanumeric(prev)) { continue; }

        // 排除“A级”“B类”等在正文中用于分级分类的字母。
        if (/[级型类款层]/.test(next)) { continue; }

        hits.push({ idx, len: 1, key: m[1], correct: false });
      }

      // 兼容 (A) / （A） / √(A)
      const parRe = /([oOxXuUyYvV√✔✓])?\s*[（(]\s*([A-Ga-g1-9])\s*[）)]/g;
      while ((m = parRe.exec(s))) {
        const idx = m.index;
        const prev = idx > 0 ? s[idx - 1] : '';
        // 标签前紧邻单词、数字或括号边界时保留原文语义。
        if (prev && /[A-Za-z0-9\u4e00-\u9fa5）)】\]]/.test(prev)) { continue; }

        hits.push({ idx, len: m[0].length, key: m[2], correct: !!m[1] && /* 只有约定的勾选或 OCR 标记才设置正确选项信号。 */ /[oOyYvV√✔✓]/.test(m[1]) });
      }

      const uniq = selectOrderedOptionHits(hits);
      if (uniq.length < 2) { return null; }

      // 清理题干切片末尾用于引出行内选项的列表标点。
      const prefix = rawLine.slice(0, uniq[0].idx).trim().replace(/[;；，,、]+$/, '').trim();
      // 如果第一组选项标记前只有题号，例如“86. A级油井水泥……”，这里的 A 是题干首字母，不是 A 选项。
      if (/^\s*(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]\s*$/.test(prefix)) { return null; }

      const options = uniq.map(/* 按最终选项边界建立正文和已识别的正确标记。 */ (h, i) => {
        const start = h.idx + h.len;const end = i + 1 < uniq.length ? uniq[i + 1].idx : s.length;
        const txt = rawLine.slice(start, end).trim().replace(/* 从选项切片开头移除排版分隔符。 */ /^[;；，,、]+/, '').replace(/* 从选项正文末尾移除排版分隔符。 */ /[;；，,、]+$/, '').trim();
        const ex = extractTrailingAnswerFromText(txt, '');
        return { key: normalizeOptionKey(h.key), correct: h.correct, text: ex.text, extraAnswer: ex.answer };
      }).filter((o) => o.text || o.correct || o.extraAnswer.length);
      if (options.length < 2) { return null; }

      return { prefix, options };
    }

    return Object.freeze({
      analyzeQuestionTextProfile,
      attachRecruitmentOptionsV58915,
      attachSourceMetaV58910,
      cleanImportedQuestion,
      collectImportWarnings,
      collectSoftRiskWarnings,
      countTypes,
      displayOptionTextV589,
      escapeRegExpV51,
      extractInlineOptionsRich,
      getHeadingType,
      getRecruitmentOptionsV58915,
      getSourceMetaV58910,
      importIssueStatus,
      isImportNoiseLine,
      isJudgeSymbolAnswer,
      isRawJudgeSymbolAnswer,
      mapType,
      mergeDuplicateOptions,
      normalizeAnswer,
      normalizeImportText,
      normalizeJsonMultilineTextV5910,
      normalizeOptionKey,
      normalizeQuestion,
      normalizeText,
      normalizeType,
      parseAnswerAnalysisEntries,
      parseOptionsText,
      parseTextQuestions,
      parseTextQuestionsBase,
      parseTextQuestionsBaseDetailed,
      repairCircledCombinationQuestion,
      repairEmbeddedOptions,
      repairMissingAndStuckQuestionsBySourceV58910,
      repairParsedQuestionsLocally,
      sourceQuestionNumberFromLineV58910,
      shouldGuessBlankFromNoOption,
      splitAnswer,
      splitAnswerByType,
      splitSemicolonOptionsFromLine,
      splitTextAnswer,
      trimMultilineBoundaryV5910,
      validateQuestion,
    });
  }

  globalThis.ShirohaTextParser = Object.freeze({ create });
})();
