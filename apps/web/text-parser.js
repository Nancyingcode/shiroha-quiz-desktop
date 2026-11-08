(() => {
  'use strict';

  /* SHIROHA_WEB_V58_9_10_SOURCE_INTERVAL_LOCAL_REPAIR */
  // v58.9.10：导入阶段内部原文定位元数据。使用 Symbol 避免写入题库 JSON/备份包。
  const SOURCE_META_V58910 = Symbol('shiroha_source_meta_v58_9_10');
  const RECRUITMENT_OPTIONS_V58915 = Symbol('shiroha_recruitment_options_v58_9_15');

  function create({
    makeId, warnDev, docxXmlToText, decodeXml, pickRichTextFieldV57, pickRichOptionTextV57,
    normalizeQuestionImagesForWebV83, injectQuestionImagesForWebV83,
  }) {
    const {
      normalizeWebQuestionType, isTextType, normalizeBlankAnswersV58914, isMultiBlankQuestionV58914,
      primaryBlankAnswerV58914, cloneBlankAnswersV58914, normalizeTextAnswerForCompare,
    } = globalThis.ShirohaQuizCore;

    function getRecruitmentOptionsV58915(q) { return (q && q[RECRUITMENT_OPTIONS_V58915]) || null; }
    function attachRecruitmentOptionsV58915(q, options) {
      if (!q || !Array.isArray(options) || options.length < 2) { return q; }
      const value = options.map((o) => ({ key: normalizeOptionKey(o.key), text: String(o.text || '').trim() })).filter((o) => o.text);
      try { Object.defineProperty(q, RECRUITMENT_OPTIONS_V58915, { value, writable: true, configurable: true, enumerable: true }); } catch { q[RECRUITMENT_OPTIONS_V58915] = value; }
      return q;
    }
    function getSourceMetaV58910(q) { return (q && q[SOURCE_META_V58910]) || null; }
    function attachSourceMetaV58910(q, meta) {
      if (!q || !meta) { return q; }
      try { Object.defineProperty(q, SOURCE_META_V58910, { value: { ...meta }, writable: true, configurable: true, enumerable: true }); } catch { q[SOURCE_META_V58910] = { ...meta }; }
      return q;
    }
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
      options = repairStandaloneOptionLabels(mergeDuplicateOptions(repairEmbeddedOptions(options.filter((o) => o.text))));
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
      if (!options.length && analysisImageOptionsV589.length >= 2 && (answer || []).some((a) => /^[A-G1-9]$/.test(String(a || '').trim()))) {
        options = imageTokensToChoiceOptionsV589(analysisImageOptionsV589);
        analysisText = stripAnswerPrefix(stripInlineImageTokensV589(analysisText)).replace(/^[A-G]{1,7}[。．.、，,；;：:\s]*$/i, '').trim();
      }
      if (analysisText && answer.length && !isTextType(type) && !/^\s*(?:答案|【\s*答案\s*】|正确答案|参考答案)/.test(analysisText)) {
        const ansLabel = answer.join('');
        if (ansLabel && !new RegExp('^\\s*(?:【?答案】?\\s*[:：]?\\s*)?' + ansLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[。．.、，,：:；;]|\\s)').test(analysisText)) {
          analysisText = '答案：' + ansLabel + '。' + analysisText.replace(/^[。．.、，,：:；;\s]+/, '');
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
    function normalizeType(t) {
      const raw = String(t || '').trim();
      if (!raw) { return ''; }
      const normalized = normalizeWebQuestionType(raw);
      if (normalized) { return normalized; }
      return mapType(raw) || '';
    }
    function splitAnswerByType(s, type) {
      if (isTextType(type)) { return splitTextAnswer(s); }
      const a = splitAnswer(s);
      if (a.length) { return a; }
      if (!type && looksLikeTextualAnswer(s)) { return splitTextAnswer(s); }
      return [];
    }
    function stripAnswerPrefix(s) {
      return String(s ?? '').trim()
        .replace(/^\s*[【[]\s*(?:正确答案|参考答案|标准答案|答案|答|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|Answer|Correct\s*answer)\s*[:：]?\s*([^】\]]*)\s*[】\]]\s*$/i, '$1')
        .replace(/^\s*(?:【|\[)?\s*(?:正确答案|参考答案|标准答案|答案|答|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|Answer|Correct\s*answer)\s*(?:】|\])?\s*(?:[:：,，、.．;；]|\s+)?\s*/i, '')
        .trim();
    }
    function isObjectiveAnswerText(inputS) {
      let s = inputS;
      s = stripAnswerPrefix(s).replace(/[?.!??;?,?\s]+$/, '').trim();
      if (!s) { return false; }
      const compact = s.replace(/[\s,??;?/\\??()]+/g, '').toUpperCase();
      if (/^[A-G]{1,7}$/.test(compact)) { return true; }
      if (/^[1-9]{1,9}$/.test(compact)) { return true; }
      if (/^(?:\u5bf9|\u9519|\u6b63\u786e|\u9519\u8bef|\u662f|\u5426|\u221A|\u2713|\u2714|\u00D7|X|V|T|F|TRUE|FALSE)$/i.test(s)) { return true; }
      if (/^([A-Ga-g])\s*[、.．:：]\s*.+$/.test(s)) { return true; }
      return false;
    }
    function looksLikeTextualAnswer(inputS) {
      let s = inputS;
      s = stripAnswerPrefix(s).trim();
      if (!s || isObjectiveAnswerText(s)) { return false; }
      const compact = normalizeTextAnswerForCompare(s);
      if (compact.length > 20) { return true; }
      if (/[??;\n]/.test(s)) { return true; }
      if (/[??]/.test(s) && !isObjectiveAnswerText(s)) { return true; }
      if (/(?:\u5305\u62ec|\u5e94\u5f53|\u9700\u8981|\u6b65\u9aa4|\u63aa\u65bd|\u6d41\u7a0b|\u539f\u56e0|\u8981\u6c42|\u5185\u5bb9|\u68c0\u67e5|\u6838\u5bf9|\u8fdb\u884c|\u4fdd\u8bc1|\u786e\u4fdd|\u4e25\u7981|\u5fc5\u987b|\u4e0d\u5f97|\u9996\u5148|\u5176\u6b21|\u7136\u540e|\u6700\u540e|\u4e00\u662f|\u4e8c\u662f|\u4e09\u662f|\u65bd\u5de5|\u8bbe\u5907|\u5b89\u5168|\u53c2\u6570)/.test(s)) { return true; }
      return false;
    }
    function hasShortAnswerPrompt(question) {
      // v58.9.3："作用"本身不是简答题强信号。带（）/横线的"主要作用是（ ）"应优先识别为填空题。
      return /简述|说明|阐述|分析|论述|列举|写出|叙述|解释|概括|谈谈|提出|给出|简答|问答|名词解释|含义|定义|为什么|原因|措施|流程|步骤|要求|内容|注意事项|如何|哪些|什么是|是什么|怎么办|怎么做|意义|影响|区别|联系|原则|要点|路径/.test(String(question || ''));
    }
    function hasExplicitBlankPrompt(question) {
      const q = String(question || '');
      return /_{2,}|____|[（(]\s*[）)]|\[\s*\]|填空|填入|补全|补充完整|空白处|空格|横线|括号内|空内/.test(q);
    }
    function shouldGuessBlankFromNoOption(question, _answer) {
      // v52：填空题必须有明确填空特征；短答案不再单独作为填空依据。
      // v58.9.3：格式优先于语义。出现（）/横线等填空标记时，除非显式简答分区/标签已指定，否则优先填空。
      if (hasExplicitBlankPrompt(question)) { return true; }
      if (hasShortAnswerPrompt(question)) { return false; }
      return false;
    }
    function normalizeJsonMultilineTextV5910(value) { return String(value ?? '').replace(/\r\n?/g, '\n'); }
    function trimMultilineBoundaryV5910(value) {
      const normalized = normalizeJsonMultilineTextV5910(value);
      if (!/[\n\t]/.test(normalized) && !/```/.test(normalized)) { return normalized.trim(); }
      const lines = normalized.split('\n');
      while (lines.length && !lines[0].trim()) { lines.shift(); }
      while (lines.length && !lines[lines.length - 1].trim()) { lines.pop(); }
      return lines.join('\n');
    }
    function splitTextAnswer(inputS) {
      let s = inputS;
      if (Array.isArray(s)) { return s.map(trimMultilineBoundaryV5910).filter((x) => x.trim()); }
      s = trimMultilineBoundaryV5910(s).replace(/^\s*(?:【|\[)?\s*(?:正确答案|参考答案|标准答案|答案|参考要点|答题要点|Answer|Correct\s*answer)\s*(?:】|\])?\s*[:：]?\s*/i, '');
      s = trimMultilineBoundaryV5910(s);
      if (!s) { return []; }
      // 多行文本、制表符和代码块按一个完整参考答案保存，避免 Shell 的 || 等语法被误拆。
      if (/[\n\t]/.test(s) || /```/.test(s)) { return [s]; }
      // 单行文本仍支持用 || 或 ｜ 分隔多个等价参考答案。
      return s.split(/\s*(?:\|\||｜)\s*/).map((x) => x.trim()).filter(Boolean);
    }

    function extractPureJudgeStemAnswer(text) {
      const s = String(text || '').trim();
      const m = s.match(/[（(]\s*(对|错|正确|错误|是|否|√|✓|✔|×|X|x|v|V|T|F|True|False)\s*[）)]\s*[。.!！?？]*\s*$/i);
      if (!m) { return null; }
      const ans = m[1].trim();
      const question = s.slice(0, m.index).trim().replace(/[。.!！?？]*\s*$/, '') + '（ ）';
      return { question, answer: ans };
    }

    function normalizeText(t) { return String(t).replace(/[\s\u3000]/g, '').replace(/[（）()【】[\]{}。？?！!，,、：:；;.*]/g, '').toLowerCase(); }
    function countTypes(qs) { return qs.reduce((a, q) => { a[q.type] = (a[q.type] || 0) + 1;return a; }, { single: 0, multiple: 0, multi: 0, judge: 0, blank: 0, short: 0 }); }
    function escapeRegExpV51(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
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
      if (['single', 'multiple', 'judge'].includes(q.type) && /(?:^|[\s。？！?])A\s*[^\s]{1,40}$/.test(q.question || '') && q.options.some((o) => o.key === 'B') && !q.options.some((o) => o.key === 'A')) { return '题干疑似混入A选项'; }
      if (/【?\s*(?:答案|正确答案|参考答案)|(?:答案|正确答案|参考答案)\s*(?::|：)/.test(q.question || '')) { return '题干残留答案标记'; }
      if ((q.options || []).some((o) => { const text = visibleOptionTextForRisk(o.text || '');return text.length > 240 || /(?:【\s*(?:答案|正确答案|参考答案)|(?:^|[\s；;，,。])(?:答案|正确答案|参考答案)\s*[:：])|\b\d{1,3}\s*[、.．:：].+【\s*答案/.test(text); })) { return '选项疑似粘连'; }
      return '正常';
    }
    function parseOptionsText(text) {
      const lines = String(text || '').split('\n').map((x) => x.trim()).filter(Boolean);
      const out = [];
      for (const line of lines) {
        const m = line.match(/^\s*(?:[（(]\s*([A-Ga-g1-90])\s*[）)]|([A-Ga-g0])\s*(?:[、.．:：]|\s+)|([1-9])\s*(?:[、.．:：]|\s+))\s*(.*)$/);
        if (m) { out.push({ key: normalizeOptionKey(m[1] || m[2] || m[3]), text: (m[4] || '').trim() }); } else { out.push({ key: String.fromCharCode(65 + out.length), text: line }); }
      }
      return out.filter((o) => o.text);
    }
    function hasQuestionImageContent(s) { return /!\[[^\]]*\]\(data:image\//.test(String(s || '')); }
    function repairStandaloneOptionLabels(inputOptions) {
      let options = inputOptions;
      options = (options || []).filter((o) => o && String(o.text || '').trim());
      if (options.length === 1 && String(options[0].key || '').toUpperCase() === 'A') {
        const compact = String(options[0].text || '').replace(/[\s,，、;；/\\]+/g, '').toUpperCase();
        if (compact === 'BCD') { return ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: k })); }
      }
      return options;
    }
    function defaultChoiceOptionsFromAnswer(answer) {
      const letters = (answer || []).flatMap((a) => splitAnswer(a)).map((a) => String(a || '').toUpperCase()).filter((a) => /^[A-G]$/.test(a));
      const max = letters.reduce((m, a) => Math.max(m, a.charCodeAt(0)), 68);
      const end = String.fromCharCode(Math.max(68, Math.min(71, max)));
      const arr = [];for (let c = 65;c <= end.charCodeAt(0);c++) { const k = String.fromCharCode(c);arr.push({ key: k, text: k }); }
      return arr;
    }
    function shouldUseDefaultImageOptions(question, options, answer, type, group = '') {
      if ((options || []).length >= 2) { return false; }
      const letters = (answer || []).flatMap((a) => splitAnswer(a)).map((a) => String(a || '').toUpperCase()).filter((a) => /^[A-G]$/.test(a));
      if (!letters.length) { return false; }
      const context = String(question || '') + ' ' + String(group || '');
      return hasQuestionImageContent(context) || /图形|图表|纸盒|折叠|问号|资料分析|材料分析/.test(context);
    }
    const sourceQuestionNumberRulesV58910 = {
      isOptionLine, isAnswerLine, isAnalysisLine, getHeadingType, isImportNoiseLine,
      getNumberedTypeQuestionLineV592, getNumberedTypeQuestionHeader,
    };
    function sourceQuestionNumberFromLineV58910(line) {
      return globalThis.ShirohaTextAnswers.sourceQuestionNumberFromLine(line, sourceQuestionNumberRulesV58910);
    }
    function sourceQuestionNumbersInBlockV58910(block) {
      const out = [];
      const lines = block?.lines || [];
      lines.forEach((line) => { const n = sourceQuestionNumberFromLineV58910(line);if (n && !out.includes(n)) { out.push(n); } });
      // v58.9.23：简答题答案中的“(1)…(12)…”属于答题要点，不是同一原文块里的新题号。
      // 真实的新题号仍由上面的逐行题号识别保留，只排除答案区内部的括号序号。
      let inlineLines = lines;
      if (mapType(block?.group || '') === 'short') {
        let inAnswerSection = false;
        inlineLines = lines.filter((line) => {
          const raw = String(line || '').trim();
          if (isStandaloneAnswerHeaderV58917(raw) || isAnswerLine(raw)) { inAnswerSection = true;return false; }
          if (inAnswerSection) { return false; }
          return true;
        });
      }
      const joined = inlineLines.join('\n');
      const inline = /(?:^|[\n。！？?!；;]\s*|\s{2,})[（(【[]\s*(\d{1,4})\s*[）)】\]]\s*\S/g;let m;
      while ((m = inline.exec(joined))) { const n = Number(m[1]) || 0;if (n && !out.includes(n)) { out.push(n); } }
      return out;
    }
    function locateQuestionBlocksV58910(sourceText, blocks) {
      let cursor = 0;
      return (blocks || []).map((rawBlock, idx) => {
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
    function parseTextQuestionsBaseDetailed(inputText) {
      let text = inputText;
      const protectedPack = protectDocxImageMarkdownForParser(text);
      const restore = protectedPack.restore || ((x) => x);
      text = repairDocxLostQuestionNumberLines(normalizeImportText(protectedPack.text));
      text = preSplitVolumeAndCompactQuestions(text);
      if (!text.trim()) { return { questions: [], blocks: [], pairs: [], sourceText: '' }; }
      const blocks = locateQuestionBlocksV58910(text, splitQuestionBlocks(text));
      const questions = [];const pairs = [];
      blocks.forEach((block, idx) => {
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
      return sourceLikelyHasAnswers ? warnings : warnings.filter((w) => !/缺少答案|缺少参考答案/.test(w));
    }

    function formatAnswerAnalysisForReview(answer, analysis = '') {
      const ans = (answer || []).map((a) => String(a || '').trim().toUpperCase()).filter(Boolean).join('');
      let text = String(analysis || '').trim();
      if (!ans) { return text; }
      const compact = text.replace(/\s+/g, '');
      const escapedAns = escapeRegExpV51(ans);
      if (new RegExp('^(?:答案|正确答案|参考答案)?[:：]?' + escapedAns + '(?:[。．.、，,；;：:]|$)', 'i').test(compact)) { return text; }
      if (new RegExp('^(?:选|选择)' + escapedAns + '(?:项|选项)?(?:[。．.、，,；;：:]|$)', 'i').test(compact)) { return text; }
      text = text.replace(/^[。．.、，,；;：:]\s*/, '');
      return text ? `答案：${ans}。${text}` : `答案：${ans}`;
    }

    function visibleQuestionTextForRisk(s) {
      return String(s || '').replace(/!\[[^\]]{0,80}\]\(data:image\/(?:png|jpeg|jpg|gif|webp|bmp|svg\+xml);base64,[^)]+\)/g, '[图片]');
    }
    function visibleOptionTextForRisk(s) {
      return visibleQuestionTextForRisk(s)
        .replace(/data:image\/(?:png|jpeg|jpg|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/=\r\n]+/g, '[图片]')
        .replace(/!\[[^\]]{0,80}\]\([^)]{0,120}\)/g, '[图片]')
        .replace(/\[?【SHIROHA_IMAGE:[^】]+】\]?/g, '[图片]');
    }
    function isCivilServiceLongStemAllowed(q, profile = {}) {
      const question = visibleQuestionTextForRisk(q?.question || '');
      const group = String(q?.group || q?.category || profile?.group || '');
      const options = q?.options || [];
      const answer = q?.answer || [];
      if (question.length <= 260) { return true; }
      if (!['single', 'multiple', 'judge'].includes(q?.type)) { return false; }
      if (['single', 'multiple'].includes(q?.type) && options.length < 3) { return false; }
      if (!answer.length) { return false; }
      const label = group.replace(/\s+/g, '');
      const moduleLike = /(?:言语理解|语言理解|言语表达|语言表达|片段阅读|篇章阅读|词语理解|主旨概括|意图判断|语句排序|数量关系|数学运算|判断推理|逻辑判断|定义判断|类比推理|图形推理|资料分析|材料分析|常识判断|综合素质|行政职业能力)/.test(label);
      const stemLike = /(?:这段文字|这段话|文段|文中|划线|横线|依次填入|下列说法|下列选项|下列表述|根据上述定义|根据上述资料|根据下列资料|根据以下资料|根据资料|由此可以推出|最能支持|最能削弱|最能质疑|最恰当|意在说明|主要介绍|主要说的是|概括|理解正确|属于|不属于|回答\s*\d+\s*[~～至\-—]\s*\d+\s*题|规模以上|进出口|增长速度|实现利润|参保人数|房地产开发投资|低保对象)/.test(question);
      const hasPollution = /【\s*(?:答案|正确答案|参考答案|解析)|(?:答案|正确答案|参考答案)\s*[:：]|\n\s*\d{1,4}\s*[、.．:：]\s*【\s*答案/.test(question);
      const optionPollution = /(?:^|\s)A\s*[、.．:：]\s*.+(?:\s|\n)B\s*[、.．:：]/.test(question);
      return (moduleLike || stemLike) && !hasPollution && !optionPollution;
    }

    function localRepairRiskStatus(q, profile) {
      const status = validateQuestion(q);
      if (status !== '正常' && !(!profile?.inlineAnswerLikely && /缺少答案|缺少参考答案/.test(status))) { return status; }
      const question = visibleQuestionTextForRisk(q.question || '');
      const options = q.options || [];
      if ((options || []).some((o) => { const text = visibleOptionTextForRisk(o.text || '');return text.length > 220 || /【\s*(?:答案|正确答案)|\b\d{1,4}\s*[、.．:：].+【\s*答案/.test(text); })) { return '选项疑似粘连'; }
      if (/【\s*(?:答案|正确答案|参考答案)|(?:答案|正确答案|参考答案)\s*[:：]/.test(question)) { return '题干残留答案标记'; }
      if (question.length > 260 && !isCivilServiceLongStemAllowed(q, profile)) { return '题干过长'; }
      if (['single', 'multiple'].includes(q.type)) {
        if (/[（(]\s*[）)]\s*A\s*(?:[、.．:：]|\s+|(?=[\u4e00-\u9fa5]))/.test(question) || /[。？！?]\s*A\s*(?:[、.．:：]|\s+)(?!级|PI\b|P\b)/i.test(question)) { return '题干疑似混入A选项'; }
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
      return /请确认|偏少|过短|疑似判断题被识别为单选题/.test(String(status || ''));
    }
    function importIssueStatus(q, profile) {
      const hard = validateQuestion(q);
      if (hard !== '正常') { return isConfirmableImportIssue(hard) ? '异常：' + hard : hard; }
      const soft = localRepairRiskStatus(q, profile || {});
      return soft === '正常' ? '正常' : '异常：' + soft;
    }

    function collectSoftRiskWarnings(arr, profile) {
      const warnings = [];
      (arr || []).forEach((q, i) => { const status = importIssueStatus(q, profile || {});if (status !== '正常') { warnings.push(`第${i + 1}题：${status}`); } });
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
    function scoreLocalSegment(qs, profile) {
      let score = ((qs || []).length * 30) - (countLocalRepairWarnings(qs, profile) * 120);
      (qs || []).forEach((q) => {
        if (q.question && q.question.length > 260 && !isCivilServiceLongStemAllowed(q, profile)) { score -= 30; }
        if ((q.options || []).some((o) => String(o.text || '').length > 220)) { score -= 40; }
        if (['single', 'multiple'].includes(q.type) && q.options.length >= 2) { score += 20; }
        if (q.type === 'judge' && q.options.length >= 2) { score += 20; }
      });
      return score;
    }
    function parseLocalRepairCandidates(text) {
      const arr = [];
      const push = (name, fn) => { try { const qs = fn().map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);arr.push({ name, questions: qs }); } catch (err) { warnDev('局部解析候选失败：' + name, err); } };
      push('标准试卷段落解析', () => parseStructuredExamText(text));
      push('局部标准解析', () => parseTextQuestionsBase(text));
      push('局部紧凑解析', () => parseTextQuestionsBase(forceSplitCompactText(text)));
      push('局部分卷分区解析', () => parseByVolumeAndSections(text));
      return arr.filter((c) => c.questions.length);
    }
    function localVisibleContentV599(qs) {
      return normalizeText((qs || []).map((q) => [
        visibleQuestionTextForRisk(q.question || ''),
        ...(q.options || []).map((o) => visibleOptionTextForRisk(o.text || '')),
      ].join('\n')).join('\n'));
    }
    function localRichContentStatsV58912(qs) {
      const all = (qs || []).map((q) => [q?.question || '', q?.analysis || '', ...(q?.options || []).map((o) => o?.text || '')].join('\n')).join('\n');
      const count = (re) => (all.match(re) || []).length;
      const imageTokens = extractInlineImageTokensV589(all).length + count(/\[\[DOCX_IMAGE_\d+\]\]/g) + count(/【DOCX图片\d+[^】]*】/g);
      return {
        images: imageTokens + (qs || []).reduce((n, q) => n + (Array.isArray(q?.images) ? q.images.length : 0), 0),
        tables: count(/【DOCX表格开始】/g),
        formulas: count(/【DOCX公式OMML(?::|】)/g),
      };
    }
    function localRichContentPreservedV58912(beforeQs, afterQs) {
      const before = localRichContentStatsV58912(beforeQs); const after = localRichContentStatsV58912(afterQs);
      return after.images >= before.images && after.tables >= before.tables && after.formulas >= before.formulas;
    }
    function localSequenceAlignedV599(base, pairs) {
      if (!base.length || base.length !== pairs.length) { return false; }
      let textMatched = 0;
      for (let i = 0;i < base.length;i++) {
        const pairQ = pairs[i]?.question;
        if (!pairQ || String(base[i].number) !== String(pairQ.number)) { return false; }
        const a = normalizeText(visibleQuestionTextForRisk(base[i].question || ''));
        const b = normalizeText(visibleQuestionTextForRisk(pairQ.question || ''));
        if (!a || !b) { continue; }
        const aHead = a.slice(0, 24); const bHead = b.slice(0, 24);
        if (a.includes(bHead) || b.includes(aHead)) { textMatched++; }
      }
      return textMatched >= Math.max(1, Math.ceil(base.length * 0.7));
    }
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

    function questionTextComparableV58910(q) { return normalizeText(visibleQuestionTextForRisk(q?.question || '')); }
    function questionMatchStrengthV58910(a, b) {
      const x = questionTextComparableV58910(a); const y = questionTextComparableV58910(b);if (!x || !y) { return 0; }
      if (x === y) { return 4; }
      const shortX = x.slice(0, 32); const shortY = y.slice(0, 32);
      if (x.includes(shortY) || y.includes(shortX)) { return 3; }
      let same = 0;const limit = Math.min(48, x.length, y.length);for (let i = 0;i < limit && x[i] === y[i];i++) { same++; }
      if (same >= 18) { return 2; }
      if (same >= 10) { return 1; }
      return 0;
    }
    function attachDetailedSourceMetaToQuestionsV58910(questions, detailed) {
      const qs = questions || []; const pairs = detailed?.pairs || [];let cursor = 0; let matched = 0;
      for (let i = 0;i < qs.length;i++) {
        const q = qs[i];let best = -1; let bestScore = -1;
        for (let j = cursor;j < Math.min(pairs.length, cursor + 12);j++) {
          const pq = pairs[j]?.question;if (!pq) { continue; }
          const noSame = String(q.number || '') === String(pq.number || '');
          const strength = questionMatchStrengthV58910(q, pq);
          const score = (noSame ? 6 : 0) + strength - ((j - cursor) * 0.05);
          if ((noSame || strength >= 2) && score > bestScore) { best = j;bestScore = score; }
        }
        if (best < 0) { continue; }
        const pair = pairs[best]; const meta = { ...(pair.sourceMeta || getSourceMetaV58910(pair.question) || sourceMetaForBlockV58910(pair.block, pair.blockIndex)), pairIndex: best };
        attachSourceMetaV58910(q, meta);cursor = best + 1;matched++;
      }
      return { questions: qs, matched, total: qs.length, ratio: qs.length ? matched / qs.length : 0 };
    }
    function forceSplitSourceQuestionAnchorsV58910(text) {
      return String(text || '')
        .replace(/([。！？?!；;])\s*(?=[（(【[]\s*\d{1,4}\s*[）)】\]]\s*\S)/g, '$1\n')
        .replace(/([^\n])\s+(?=[（(【[]\s*\d{1,4}\s*[）)】\]]\s*\S)/g, '$1\n')
        .replace(/([^\n])\s+(?=(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]\s*\S)/g, '$1\n');
    }
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
    function blockTextV58910(blocks, start, end) {
      let lastVolume = ''; let lastChapter = ''; let lastGroup = '';const parts = [];
      (blocks || []).slice(start, end + 1).forEach((b) => {
        const head = [];
        if ((b.volume || '') !== lastVolume && b.volume) { head.push(b.volume); }
        if ((b.chapter || '') !== lastChapter && b.chapter) { head.push(b.chapter); }
        if ((b.group || '') !== lastGroup && b.group) { head.push(b.group); }
        const body = (b.lines || []).join('\n');parts.push([...head, body].filter(Boolean).join('\n'));
        lastVolume = b.volume || lastVolume;lastChapter = b.chapter || lastChapter;lastGroup = b.group || lastGroup;
      });
      return parts.join('\n');
    }
    function candidateExplicitNumbersV58910(qs) { return (qs || []).map((q) => Number(q.number || 0)).filter((n) => n > 0 && n < 10000); }
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
    function inferLostNumbersBetweenAnchorsV58910(base) {
      const out = [...(base || [])];let changed = 0;const segments = [];
      let left = 0;
      while (left < out.length) {
        const lm = getSourceMetaV58910(out[left]);
        if (!lm?.explicitNumber) { left++;continue; }
        let right = left + 1;
        while (right < out.length && !getSourceMetaV58910(out[right])?.explicitNumber) { right++; }
        if (right >= out.length) { break; }
        const rm = getSourceMetaV58910(out[right]);
        const ln = Number(lm.originalNumber || out[left].number || 0); const rn = Number(rm.originalNumber || out[right].number || 0);
        const sameSection = sameSourceSectionV58911(lm, rm);
        if (sameSection && right - left > 1 && rn - ln === right - left && rn > ln) {
          for (let i = left + 1;i < right;i++) {
            const inferred = ln + (i - left); const old = out[i]; const meta = getSourceMetaV58910(old) || {};
            const next = normalizeQuestion({ ...old, number: inferred }, i);
            attachSourceMetaV58910(next, { ...meta, originalNumber: null, explicitNumber: false, inferredNumber: inferred });
            out[i] = next;changed++;
          }
          segments.push(`题号${ln}-${rn}之间：依据前后真实题号恢复${right - left - 1}道题的编号`);
        }
        left = right;
      }
      return { questions: out, changed, segments };
    }
    function repairMissingAndStuckQuestionsBySourceV58910(original, standardQuestions, profile, detailedInput) {
      const detailed = detailedInput || parseTextQuestionsBaseDetailed(original);
      let base = (standardQuestions || []).map((q, i) => normalizeQuestion(q, i));
      const alignment = attachDetailedSourceMetaToQuestionsV58910(base, detailed);
      if (!base.length || alignment.ratio < 0.6) { return { questions: base, repaired: 0, segments: [], sourceAligned: alignment.matched }; }
      const inferred = inferLostNumbersBetweenAnchorsV58910(base);base = inferred.questions;
      const blocks = detailed.blocks || [];const windows = new Map();
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
      for (let i = 0;i < base.length - 1;i++) {
        const a = base[i]; const b = base[i + 1]; const ma = getSourceMetaV58910(a); const mb = getSourceMetaV58910(b);if (!ma || !mb) { continue; }
        const na = Number(a.number || 0); const nb = Number(b.number || 0);
        const sameSection = sameSourceSectionV58911(ma, mb);
        if (sameSection && na > 0 && nb - na >= 2 && nb - na <= 8) {
          const missing = [];for (let n = na + 1;n < nb;n++) { missing.push(n); }
          addWindow(ma.sourceBlockStart, Math.max(ma.sourceBlockEnd, mb.sourceBlockStart - 1), '题号缺口', missing.concat([na]));
        }
      }
      const usedBlocks = new Set();base.forEach((q) => { const m = getSourceMetaV58910(q);if (m) { for (let i = m.sourceBlockStart;i <= m.sourceBlockEnd;i++) { usedBlocks.add(i); } } });
      const sectionNumberKey = (section, n) => [normalizeSectionLabelV58911(section?.volume || ''), normalizeSectionLabelV58911(section?.chapter || ''), normalizeSectionLabelV58911(section?.group || ''), Number(n) || 0].join('|');
      const existingSectionNumbers = new Set();
      base.forEach((q) => { const m = getSourceMetaV58910(q) || {};const n = Number(m.originalNumber || q.number || 0);if (n) { existingSectionNumbers.add(sectionNumberKey(m, n)); } });
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
        base.forEach((q, i) => { const m = getSourceMetaV58910(q);if (m && m.sourceBlockStart <= win.blockEnd && m.sourceBlockEnd >= win.blockStart) { originalIndexes.push(i); } });
        const baseStart = originalIndexes.length ? Math.min(...originalIndexes) : (base.findIndex((q) => (getSourceMetaV58910(q)?.sourceBlockStart ?? Infinity) > win.blockEnd));
        const insertAt = baseStart < 0 ? base.length : baseStart;
        const baseEnd = originalIndexes.length ? Math.max(...originalIndexes) : insertAt - 1;
        const originalSegment = originalIndexes.length ? base.slice(baseStart, baseEnd + 1) : [];
        const expectedSet = new Set(win.expectedNumbers.map(Number).filter(Boolean));
        (blocks.slice(win.blockStart, win.blockEnd + 1) || []).forEach((b) => (b.sourceQuestionNumbers || []).forEach((n) => expectedSet.add(Number(n))));
        const rawText = blockTextV58910(blocks, win.blockStart, win.blockEnd);
        const candidates = parseLocalRepairCandidates(rawText);
        try {
          const splitText = forceSplitSourceQuestionAnchorsV58910(rawText);
          const qs = parseTextQuestionsBase(splitText).map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
          if (qs.length) { candidates.push({ name: '局部题号边界解析', questions: qs }); }
        } catch (e) { warnDev('局部题号边界解析失败。', e); }
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

    function repairOverSplitQuestionsBySourceV58911(original, standardQuestions, profile, detailedInput) {
      const detailed = detailedInput || parseTextQuestionsBaseDetailed(original);
      const base = (standardQuestions || []).map((q, i) => normalizeQuestion(q, i));
      const alignment = attachDetailedSourceMetaToQuestionsV58910(base, detailed);
      if (base.length < 3 || alignment.ratio < 0.6) { return { questions: base, repaired: 0, segments: [], sourceAligned: alignment.matched }; }
      const blocks = detailed.blocks || []; const windows = [];
      const anchors = [];
      base.forEach((q, i) => { const m = getSourceMetaV58910(q);if (m?.explicitNumber && Number(m.originalNumber || 0) > 0) { anchors.push({ index: i, number: Number(m.originalNumber), meta: m }); } });
      for (let a = 0;a < anchors.length - 1;a++) {
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
        for (let n = win.leftNumber;n < win.rightNumber;n++) { targetNumbers.push(n); }
        const rawText = blockTextV58910(blocks, win.blockStart, win.blockEnd);
        const candidates = parseLocalRepairCandidates(rawText);
        try {
          const forced = parseTextQuestionsBase(forceSplitSourceQuestionAnchorsV58910(rawText)).map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
          if (forced.length) { candidates.push({ name: '局部题号边界解析', questions: forced }); }
        } catch (e) { warnDev('过度拆题局部边界解析失败。', e); }
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

    function repairParsedQuestionsLocally(original, standardQuestions, profile) {
      const detailed = parseTextQuestionsBaseDetailed(original);
      const base = (standardQuestions && standardQuestions.length ? standardQuestions : detailed.questions).map((q, i) => normalizeQuestion(q, i));
      const pairs = detailed.pairs || [];
      // v58.9.9：局部替换必须先证明“标准结果索引”和原始块一一对应；漏题/粘题时不再靠数组下标猜测。
      if (!localSequenceAlignedV599(base, pairs)) { return { questions: base, repaired: 0, segments: [] }; }
      const risky = [];
      base.forEach((q, i) => { if (localRepairRiskStatus(q, profile) !== '正常') { risky.push(i); } });
      if (!risky.length) { return { questions: base, repaired: 0, segments: [] }; }
      // 这里只处理少量“已存在题目的题内异常”。大量异常、漏题和粘题留给后续原文区间机制或整卷最后兜底。
      if (risky.length > localRepairQuestionLimitV58912(base.length)) { return { questions: base, repaired: 0, segments: [] }; }
      const replacements = [];let repaired = 0;const segments = [];
      let r = 0;
      while (r < risky.length) {
        const start = risky[r];let end = start;
        while (r + 1 < risky.length && risky[r + 1] <= end + 1) { r++;end = risky[r]; }
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
        parseLocalRepairCandidates(segmentText).forEach((c) => {
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
        r++;
      }
      if (!replacements.length) { return { questions: base, repaired: 0, segments: [] }; }
      const out = [];
      for (let i = 0;i < base.length;) {
        const rep = replacements.find((x) => x.start === i);
        if (rep) { rep.questions.forEach((q) => out.push(q));i = rep.end + 1;continue; }
        out.push(base[i]);i++;
      }
      return { questions: out.map((q, i) => normalizeQuestion(q, i)), repaired, segments };
    }

    function isAnswerAnalysisEntryLine(line) {
      const s = String(line || '').trim();
      if (!s) { return false; }
      if (/^\s*\d{1,4}\s*(?:[.、．:：]\s*)?(?:【\s*(?:答案|正确答案|参考答案|标准答案)\s*】|\[\s*(?:答案|正确答案|参考答案|标准答案)\s*\]|(?:答案|正确答案|参考答案|标准答案)\s*[:：])\s*(?:[A-Ga-g]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)/i.test(s)) { return true; }
      if (/^\s*\d{1,4}\s*[.、．:：]\s*(?:【\s*(?:解析|答案解析|试题解析)\s*】|\[\s*(?:解析|答案解析|试题解析)\s*\]|(?:解析|答案解析|试题解析|分析)\s*[:：])\s*(?:选\s*)?(?:[A-Ga-g]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)/i.test(s)) { return true; }
      if (/^\s*\d{1,4}\s*[.、．:：]\s*[A-Ga-g]{1,7}(?=$|[\s。．.、，,；;：:]|【\s*解析\s*】|\[\s*解析\s*\]|解析|分析)/.test(s)) { return true; }
      if (/^\s*\d{1,4}\s*[.、．:：]\s*[A-Ga-g][\d/.]+/.test(s)) { return true; } // 16.B352 / 20.A122/199
      return false;
    }
    function isAnswerSectionHeading(line, nextLines = []) {
      const raw = String(line || '').trim();
      const s = raw.replace(/[\s\u3000]+/g, '');
      if (!s) { return false; }
      const heading = /^(?:[一二三四五六七八九十]+[、.．:：]?)?(?:答案|参考答案|标准答案|正确答案|答案解析|答案及解析|答案与解析|试题解析|真题答案|解析)$/.test(s);
      if (!heading) { return false; }
      const look = (nextLines || []).slice(0, 6).filter(Boolean).map((x) => String(x).trim());
      const hits = look.filter(isAnswerAnalysisEntryLine).length;
      const hasAnswerWords = look.some((l) => /【\s*(?:答案|解析)\s*】|(?:答案|正确答案|参考答案|标准答案|解析|分析)\s*[:：]|故(?:答案)?选|本题(?:答案)?(?:为|选)|因此.*(?:答案|选)|所以.*选/.test(l));
      return hits >= 1 || hasAnswerWords;
    }
    function isGenericQuestionSectionHeading(line, nextLines = []) {
      const raw = String(line || '').trim();
      if (!raw || raw.length > 50) { return false; }
      if (isOptionLine(raw) || isAnswerAnalysisEntryLine(raw) || isAnswerLine(raw) || isAnalysisLine(raw)) { return false; }
      const compact = raw.replace(/[\s\u3000]+/g, '');
      // 真实分区通常是“第一部分/一、言语理解/三、图形推理/四、逻辑判断”；
      // 普通题目也可能以“1．心理契约……”开头，不能当分区。
      const chineseSection = /^(?:第[一二三四五六七八九十0-9]+部分|[一二三四五六七八九十]+[、.．:：])/.test(compact)
    && /(?:言语|语言|数学|数量|图形|逻辑|判断推理|定义判断|类比推理|资料分析|材料分析|综合|能力|常识|单选|多选|判断题|填空|简答)/.test(compact);
      const numericTypeSection = /^\d+[、.．:：]/.test(compact)
    && compact.length <= 20
    && /(?:言语|语言|数学|数量|图形|逻辑|判断推理|资料分析|材料分析|单选|多选|判断题|填空|简答)/.test(compact);
      if (!chineseSection && !numericTypeSection) { return false; }
      const look = (nextLines || []).slice(0, 10).filter(Boolean).map((x) => String(x).trim());
      const qHits = look.filter((l) => hasStrongQuestionNo(l) || /^[【[]\s*\d{1,4}\s*[】\]]/.test(l) || isQuestionStart(l) || /^\d{1,4}\s*[.、．:：]\s*$/.test(l)).length;
      const aHits = look.filter(isAnswerAnalysisEntryLine).length;
      return qHits >= 1 || aHits >= 1 || chineseSection;
    }
    function sectionKeyFromText(s) {
      const x = String(s || '').replace(/\s+/g, '');
      if (!x) { return ''; }
      if (/言语|语言/.test(x)) { return 'verbal'; }
      if (/数学|数量/.test(x)) { return 'math'; }
      if (/图形/.test(x)) { return 'graph'; }
      if (/逻辑|定义判断|类比推理|判断推理/.test(x)) { return 'logic'; }
      if (/资料分析|材料分析/.test(x)) { return 'data'; }
      if (/判断题|正误|是非/.test(x)) { return 'judge'; }
      if (/多选|多项/.test(x)) { return 'multiple'; }
      if (/单选|单项/.test(x)) { return 'single'; }
      return '';
    }
    function hasAnswerAnalysisSignal(text) {
      const lines = normalizeImportText(text).split('\n').map((x) => x.trim()).filter(Boolean);
      for (let i = 0;i < lines.length;i++) {
        if (isAnswerSectionHeading(lines[i], lines.slice(i + 1, i + 7))) { return true; }
      }
      for (let i = 0;i < lines.length - 2;i++) {
        const win = lines.slice(i, i + 4);
        if (win.filter(isAnswerAnalysisEntryLine).length >= 2) { return true; }
      }
      return false;
    }
    function extractObjectiveAnswerFromText(raw, allowLeading = true) {
      let s = String(raw || '').trim();
      if (!s) { return []; }
      s = s.replace(/^[【[]\s*(?:答案|正确答案|参考答案|标准答案)\s*[】\]]\s*/, '').trim();
      s = s.replace(/^(?:答案|正确答案|参考答案|标准答案)\s*[:：]\s*/, '').trim();
      let m = s.match(/^[【[]\s*(?:解析|答案解析|试题解析)\s*[】\]]\s*(?:选\s*)?([A-Ga-g]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)/i);
      if (m) { return splitAnswer(m[1]); }
      m = s.match(/^(?:解析|答案解析|试题解析|分析|详解|说明|思路|解题思路)\s*[:：]\s*(?:选\s*)?([A-Ga-g]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)/i);
      if (m) { return splitAnswer(m[1]); }
      m = s.match(/^(?:答|答案)\s*[:：]\s*(?:选\s*)?([A-Ga-g]{1,7}|[1-9]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)/i);
      if (m) { return splitAnswer(m[1]); }
      m = s.match(/(?:故|因此|所以|故而|因而)?\s*(?:本题)?\s*(?:正确)?答案\s*(?:为|是|选|选择)?\s*([A-Ga-g]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)(?:项|选项)?/i);
      if (m) { return splitAnswer(m[1]); }
      m = s.match(/(?:故|因此|所以|故而|因而)\s*(?:本题)?\s*(?:应|可)?\s*(?:选|选择)\s*([A-Ga-g]{1,7})(?:项|选项)?/i);
      if (m) { return splitAnswer(m[1]); }
      m = s.match(/(?:本题|此题)\s*(?:应|可)?\s*(?:选|选择)\s*([A-Ga-g]{1,7})(?:项|选项)?/i);
      if (m) { return splitAnswer(m[1]); }
      if (allowLeading) {
        m = s.match(/^([A-Ga-g]{1,7}|[1-9]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)(?=$|[\s。．.、，,；;：:]|【|\[|解析|分析)/i);
        if (m) { return splitAnswer(m[1]); }
      }
      return [];
    }
    function parseAnswerAnalysisEntries(text) {
      const lines = normalizeImportText(text).split('\n').map((x) => x.trim()).filter(Boolean);
      const entries = [];let currentVolume = '';let currentChapter = '';let currentGroup = '';let inAnswerSection = false;let currentNumber = '';let currentEntry = null;
      const push = (number, ans, analysis = '', raw = '', group = currentGroup, volume = currentVolume, chapter = currentChapter) => {
        const a = Array.isArray(ans) ? ans : splitAnswer(ans);
        if (!number || !a.length) { return; }
        // 答案解析区只接收客观题/判断题答案；纯数字“2、3、5”这类是解析文字，不是答案。
        const valid = a.filter((x) => /^[A-G]$/.test(String(x || '').toUpperCase()) || isJudgeSymbolAnswer(x));
        if (!valid.length) { return; }
        const entry = { number: String(number), volume: volume || '', chapter: chapter || '', group: group || '', answer: valid.map((x) => String(x).toUpperCase()), analysis: String(analysis || '').trim(), raw: String(raw || '') };
        entries.push(entry);currentEntry = entry;currentNumber = String(number);
      };
      const appendAnalysis = (txt) => { if (currentEntry && txt) { const t = String(txt || '').trim();if (t) { currentEntry.analysis = (currentEntry.analysis ? currentEntry.analysis + '\n' : '') + t; } } };
      const parseNumberedLine = (line, onlyStrong = false) => {
        let m;
        // 1.【答案】A【解析】... / 1.答案：A ...
        m = line.match(/^\s*(?:第\s*)?(\d{1,4})\s*(?:题)?[.、．:：]?\s*(?:【\s*(?:答案|正确答案|参考答案|标准答案)\s*】|\[\s*(?:答案|正确答案|参考答案|标准答案)\s*\]|(?:答案|正确答案|参考答案|标准答案)\s*[:：])\s*(.+)$/i);
        if (m) {
          const a = extractObjectiveAnswerFromText(m[2], true);
          if (a.length) { return { number: m[1], answer: a, analysis: m[2].replace(/^([A-Ga-g]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F|True|False)\s*[。．.、，,；;：:]?/i, '').trim(), raw: line }; }
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
      for (let i = 0;i < lines.length;i++) {
        const line = lines[i];const next = lines.slice(i + 1, i + 8);
        if (isAnswerSectionHeading(line, next)) { inAnswerSection = true;currentEntry = null;currentNumber = '';if (/解析|答案及解析|答案与解析|试题解析|真题答案/.test(line)) { currentVolume = '';currentChapter = '';currentGroup = ''; } continue; }
        if (isVolumeHeading(line)) { currentVolume = getVolumeLabel(line);currentChapter = '';currentGroup = '';currentEntry = null;currentNumber = '';continue; }
        if (isChapterHeadingV58911(line, next)) { currentChapter = line;currentGroup = '';currentEntry = null;currentNumber = '';continue; }
        if (inAnswerSection && isGenericQuestionSectionHeading(line, next)) { currentEntry = null;currentNumber = '';currentGroup = line;continue; }
        if (isGenericQuestionSectionHeading(line, next)) { currentGroup = line;currentNumber = '';currentEntry = null;continue; }
        const heading = getHeadingType(line);
        if (heading) { currentGroup = heading;currentEntry = null;currentNumber = '';continue; }

        // 优先处理紧凑答案表：1【答案】D 2【答案】D 3【答案】B ...
        if ((inAnswerSection || /\d{1,4}\s*(?:题)?\s*【\s*(?:答案|正确答案|参考答案|标准答案)\s*】/.test(line)) && (line.match(/【\s*(?:答案|正确答案|参考答案|标准答案)\s*】/g) || []).length >= 2) {
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
        const qNo = line.match(/^\s*(?:第\s*)?(\d{1,4})\s*(?:题)?[.、．:：]\s*\S+/) || line.match(/^\s*[【[]\s*(\d{1,4})\s*[】\]]\s*\S+/);
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
      entries.forEach((e) => {
        const last = out[out.length - 1];
        if (last && last.number === e.number && normalizeSectionLabelV58911(last.volume) === normalizeSectionLabelV58911(e.volume) && normalizeSectionLabelV58911(last.chapter) === normalizeSectionLabelV58911(e.chapter) && normalizeSectionLabelV58911(last.group) === normalizeSectionLabelV58911(e.group) && (last.answer || []).join('') === (e.answer || []).join('')) {
          if (e.analysis && !last.analysis.includes(e.analysis)) { last.analysis += (last.analysis ? '\n' : '') + e.analysis; }
        } else { out.push(e); }
      });
      return out;
    }
    function stripAnswerAnalysisTextForQuestions(text) {
      const lines = normalizeImportText(text).split('\n').map((x) => x.trim()).filter(Boolean);
      const out = [];let inAnswerSection = false;
      for (let i = 0;i < lines.length;i++) {
        const line = lines[i];const next = lines.slice(i + 1, i + 7);
        if (isAnswerSectionHeading(line, next)) { inAnswerSection = true;continue; }
        if (inAnswerSection && isGenericQuestionSectionHeading(line, next)) { inAnswerSection = false;out.push(line);continue; }
        if (inAnswerSection) { continue; }
        if (isAnswerAnalysisEntryLine(line)) { continue; }
        if (/^(?:分析|解析|答|答案|详解|说明|思路|解题思路)\s*[:：]\s*(?:选\s*)?[A-Ga-g]/.test(line)) { continue; }
        if (/^(?:故|因此|所以|故而|因而)\s*(?:本题)?\s*(?:正确)?答案/.test(line)) { continue; }
        out.push(line);
      }
      return out.join('\n');
    }
    function mergeAnswerAnalysisEntries(questions, entries) {
      const qs = (questions || []).map((q, i) => ({ ...q, answer: [...(q.answer || [])], analysis: q.analysis || '', number: q.number || i + 1 }));
      const warnings = [];let matched = 0;let cursor = 0;
      const qSec = (q) => sectionKeyFromText(q.category || q.group || '');
      const eSec = (e) => sectionKeyFromText(e.group || '');
      const compatible = (q, e) => {
        const ans = e.answer || [];
        if (q.type === 'judge') { return ans.some((a) => isJudgeSymbolAnswer(a) || ['A', 'B'].includes(String(a).toUpperCase())); }
        if (['single', 'multiple'].includes(q.type)) { return ans.every((a) => /^[A-G]$/.test(String(a).toUpperCase())); }
        return true;
      };
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
        for (let i = cursor;i < qs.length;i++) {
          if (canUse(qs[i], e, true)) { idx = i;break; }
        }
        // 2) 再允许全局同分区未答题匹配。
        if (idx < 0) {
          for (let i = 0;i < qs.length;i++) {
            if (!qs[i].answer.length && canUse(qs[i], e, true)) { idx = i;break; }
          }
        }
        // 3) 没有分区信息时，才按旧的顺序题号匹配。
        if (idx < 0 && !es) {
          for (let i = cursor;i < qs.length;i++) { if (canUse(qs[i], e, false)) { idx = i;break; } }
          if (idx < 0) { for (let i = 0;i < qs.length;i++) { if (!qs[i].answer.length && canUse(qs[i], e, false)) { idx = i;break; } } }
        }
        // 4) 有明确分区但项目没有解析出对应分区题目，例如图形题只有图片，跳过，不要污染后续逻辑题。
        if (idx < 0) { continue; }
        const mergedImageOptionsV589 = extractInlineImageTokensV589((e.analysis || '') + ' ' + (e.raw || ''));
        if (!(qs[idx].options || []).length && mergedImageOptionsV589.length >= 2 && (e.answer || []).some((a) => /^[A-G1-9]$/.test(String(a || '').trim()))) {
          qs[idx].options = imageTokensToChoiceOptionsV589(mergedImageOptionsV589);
        }
        qs[idx].answer = normalizeAnswer(e.answer, qs[idx].options || [], qs[idx].type);
        let mergedAnalysisV589 = e.analysis || qs[idx].analysis || '';
        if (mergedImageOptionsV589.length >= 2) { mergedAnalysisV589 = stripAnswerPrefix(stripInlineImageTokensV589(mergedAnalysisV589)).replace(/^[A-G]{1,7}[。．.、，,；;：:\s]*$/i, '').trim(); }
        qs[idx].analysis = formatAnswerAnalysisForReview(qs[idx].answer, mergedAnalysisV589);
        cursor = idx + 1;matched++;
      }
      if (entries.length && !matched) { warnings.push('检测到答案解析区，但未能按题号合并答案。'); }
      return { questions: qs.map((q, i) => normalizeQuestion(q, i)), warnings, matched };
    }
    function parseDocumentWithAnswerSections(text) {
      if (!hasAnswerAnalysisSignal(text)) { return []; }
      const qText = stripAnswerAnalysisTextForQuestions(text);
      const entries = parseAnswerAnalysisEntries(text);
      if (!entries.length) { return []; }
      const qCandidates = [];
      const push = (name, fn) => {
        try {
          const qs = fn().map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
          if (qs.length) { qCandidates.push({ name, questions: qs, score: scoreParsedQuestions(qs, {}) }); }
        } catch (err) { warnDev('题目区候选解析失败：' + name, err); }
      };
      push('题目区标准试卷段落解析', () => parseStructuredExamText(qText));
      push('题目区标准逐行解析', () => parseTextQuestionsBase(qText));
      push('题目区紧凑解析', () => parseTextQuestionsBase(forceSplitCompactText(qText)));

      const mergedCandidates = qCandidates.map((c) => {
        const merged = mergeAnswerAnalysisEntries(c.questions, entries);
        const qs = merged.questions || [];
        const warnings = collectImportWarnings(qs);
        const answered = qs.filter((q) => (q.answer || []).length).length;
        const missing = warnings.filter((w) => /缺少答案|缺少参考答案/.test(w)).length;
        const hard = warnings.length - missing;
        const polluted = qs.filter((q) => /【\s*(?:答案|解析)\s*】|答案解析|正确答案|参考答案/.test(q.question || '')).length;
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

    function scoreAnswerSectionCandidate(qs, profile) {
      const arr = qs || [];
      let score = scoreParsedQuestions(arr, profile || {});
      const answered = arr.filter((q) => (q.answer || []).length).length;
      const answerRate = arr.length ? answered / arr.length : 0;
      const polluted = arr.filter((q) => /【\s*(?:答案|解析)\s*】|答案解析|正确答案|参考答案/.test(q.question || '')).length;
      const warnings = collectImportWarnings(arr);
      const hard = warnings.filter((w) => !/缺少答案|缺少参考答案|多选题只有一个答案/.test(w)).length;
      score += answered * 80;
      if (answerRate >= 0.5) { score += 600; }
      if (answerRate >= 0.75) { score += 800; }
      score -= polluted * 250;
      score -= hard * 90;
      if (profile && profile.expectedByHeadings) { score -= Math.min(400, Math.abs(arr.length - profile.expectedByHeadings) * 12); }
      return score;
    }

    function protectDocxImageMarkdownForParser(text) {
      const images = [];
      const s = String(text || '').replace(/!\[[^\]]{0,80}\]\((data:image\/(?:png|jpeg|jpg|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/=]+)\)/g, (m) => {
        const id = images.length + 1;images.push(m);return `\n[[DOCX_IMAGE_${id}]]\n`;
      });
      return { text: s, images, restore: (x) => String(x || '').replace(/\[\[DOCX_IMAGE_(\d+)\]\]/g, (m, n) => images[Number(n) - 1] || m) };
    }
    function normalizeRecruitmentExamTextForParser(text) {
      let s = String(text || '');
      s = s.replace(/\r/g, '\n').replace(/[\u00a0\u3000]+/g, ' ');
      s = s.replace(/([。！？?；;）)\]】]|\S)(第[一二三四五六七八九十0-9]+部分\s*[^\n]{0,40})/g, '$1\n$2');
      s = s.replace(/([。！？?；;）)\]】]|\S)([一二三四五六七八九十]+[、.．:：]\s*(?:言语|语言|数学|数量|图形|逻辑|判断推理|资料分析|材料分析)[^\n]{0,40})/g, '$1\n$2');
      s = s.replace(/(^|\n)\s*(\d)\s+(\d)([.．、])/g, '$1$2$3$4');
      s = s.replace(/([^\n\d])((?:\d{1,3}|[【[]\s*\d{1,3}\s*[】\]])\s*[.．、]?\s*(?=(?:从所给|根据|有着|市场|所谓|每个|某|甲|乙|超市|草地|连接|左边|下列|海洋|有医学|在一次|以下|我国|截至|如按|2010年|2011年|[\u4e00-\u9fa5]|!|\[\[DOCX_IMAGE_)))/g, '$1\n$2');
      s = s.replace(/(\[\[DOCX_IMAGE_\d+\]\])/g, '\n$1\n');
      return s.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    }
    function getRecruitmentSectionHeading(line) {
      const raw = String(line || '').trim();const s = raw.replace(/\s+/g, '');
      if (/^(?:第[一二三四五六七八九十0-9]+部分|[一二三四五六七八九十]+[、.．:：])/.test(s) && /(?:言语|语言|数学|数量|图形|逻辑|判断推理|资料分析|材料分析)/.test(s)) { return raw; }
      return '';
    }
    function protectAnswerAnalysisForQuestionPart(text) {
      let s = String(text || '');
      s = s.replace(/\n\s*(答案解析|答案及解析|答案与解析|参考答案|正确答案)\s*\n/g, '\n<<ANSWER_SECTION>>\n');
      return s;
    }

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
      if (tableIdx > 0 && /(?:资料分析|材料分析|指标|收入|增长|进出口|产业结构|市场|用户|投资|利润|表\s*\d)/.test(s.slice(tableIdx))) { return s.slice(tableIdx).trim(); }
      return '';
    }
    function extractRecruitmentAnswerMap(text) {
      const map = {};const analysis = {};const s = String(text || '').replace(/\s+/g, ' ');
      const put = (inputN, inputA, tail = '') => {
        let n = inputN;
        let a = inputA;n = Number(n);a = String(a || '').trim().toUpperCase();if (n && /^[A-G]{1,7}$/.test(a)) { map[n] = a.split(''); if (tail) { analysis[n] = String(tail || '').trim(); } }
      };
      let m;
      const patterns = [
        /(\d{1,3})\s*[.．、]\s*([A-G])\s*(?=\d|\s*\d)/gi,
        /(\d{1,3})\s*[.．、]?\s*([A-G])(?=[\u4e00-\u9fa5])/gi,
        /(\d{1,3})\s*[.．、]?\s*([A-G])\s+(?=[\u4e00-\u9fa5ⅠⅡⅢⅣIVX])/gi,
        /(\d{1,3})\s*[.．、]?\s*([A-G]{1,7})\s*(?=[.．、。\s]*[【[]?\s*(?:解析|答案解析|试题解析)|[.．、。]\s*[\u4e00-\u9fa5])/gi,
        /(\d{1,3})\s*[.．、]\s*[【[]\s*(?:解析|答案解析|试题解析)\s*[】\]]\s*([A-G]{1,7})([^\d]{0,180})/gi,
        /(\d{1,3})\s*[.．、]?\s*[【[]\s*(?:答案|正确答案|参考答案|标准答案)\s*[】\]]\s*[:：]?\s*([A-G]{1,7})([^\d]{0,180})/gi,
        /(\d{1,3})\s*[.．、]?\s*(?:答案|正确答案|参考答案|标准答案)\s*[:：]?\s*([A-G]{1,7})([^\d]{0,180})/gi,
        /(\d{1,3})\s*[.．、]\s*([A-G]{1,7})\s*(?=(?:[【[]\s*解析|解析|分析|故|本题|选|$))/gi,
        /(\d{1,3})\s*【\s*答案\s*】\s*([A-G]{1,7})/gi,
        /(\d{1,3})\s*[.．、]?\s*([A-G])\s*(?=(?:\d{1,3}\s*[.．、]?\s*[A-G]|$))/gi,
      ];
      patterns.forEach((re) => { while ((m = re.exec(s))) { put(m[1], m[2], m[3] || ''); } });
      return { answerMap: map, analysisMap: analysis };
    }
    function splitRecruitmentQuestionStarts(text) {
      const s = String(text || '');const re = /(^|\n)\s*(?:[【[]\s*(\d{1,3})\s*[】\]]|(\d{1,3})\s*[.．、])\s*/g;const hits = [];let m;
      while ((m = re.exec(s))) {
        const n = Number(m[2] || m[3]);if (!n) { continue; }
        const idx = m.index + (m[1] ? m[1].length : 0);
        const after = s.slice(re.lastIndex, re.lastIndex + 30);
        if (/^\s*(?:【\s*(?:答案|解析)|答案|解析|\[\s*(?:答案|解析))/.test(after)) { continue; }
        hits.push({ idx, bodyStart: re.lastIndex, number: n });
      }
      return hits;
    }

    function selectRecruitmentOptionHitSequence(hits) {
      if (!hits || hits.length < 2) { return hits || []; }
      const code = (k) => String(k || 'A').toUpperCase().charCodeAt(0);
      const candidates = [];
      for (let i = 0;i < hits.length;i++) {
        if (String(hits[i].key).toUpperCase() !== 'A') { continue; }
        const seq = [hits[i]];let need = 66;
        for (let j = i + 1;j < hits.length && need <= 68;j++) {
          if (code(hits[j].key) === need) { seq.push(hits[j]);need++; }
        }
        const hasD = seq.some((h) => String(h.key).toUpperCase() === 'D');
        if (seq.length >= 3 || hasD) { candidates.push(seq); }
      }
      if (!candidates.length) { const aHits = hits.filter((h) => String(h.key).toUpperCase() === 'A');return aHits.length > 1 ? [aHits[aHits.length - 1]] : hits; }
      candidates.sort((a, b) => {
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
    function splitRecruitmentOptions(seg) {
      const s = String(seg || '').trim();
      const imageOnly = /^\s*(?:\[\[DOCX_IMAGE_\d+\]\]\s*)+(?:A\s+B\s+C\s+D\s*)?$/i.test(s);
      const hits = [];let m;
      const re = /(^|\n|\s|[。？！?；;:：）)（(]|[\u4e00-\u9fa5])([A-D])\s*[.．、]\s*/g;
      while ((m = re.exec(s))) {
        const idx = m.index + m[1].length;hits.push({ idx, end: re.lastIndex, key: m[2].toUpperCase() });
      }
      const selectedHits = [...selectRecruitmentOptionHitSequence(hits)];
      hits.length = 0;hits.push(...selectedHits);
      if (!hits.length) {
        const plain = s.match(/(?:^|\n|\s)A\s+B\s+C\s+D\s*$/i);
        if (plain) { return { question: s.replace(/A\s+B\s+C\s+D\s*$/i, '').trim(), options: ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: k })) }; }
        if (imageOnly) { return { question: s.replace(/A\s+B\s+C\s+D\s*$/i, '').trim(), options: ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: k })) }; }
        return { question: s, options: [] };
      }
      const start = hits[0].idx;
      const q = s.slice(0, start).trim();
      const opts = [];
      for (let i = 0;i < hits.length;i++) {
        const h = hits[i]; const next = i + 1 < hits.length ? hits[i + 1].idx : s.length;
        const text = s.slice(h.end, next).trim().replace(/[;；，,]+$/, '').trim();
        opts.push({ key: h.key, text });
      }
      // OCR/文本提取偶发把 A 误成 B，形成 B/B/C/D；按出现顺序纠正为 A/B/C/D。
      const keys = opts.map((o) => o.key).join('');
      if (!keys.includes('A') && /^BBCD/.test(keys) && opts.length >= 4) { for (let i = 0;i < 4;i++) { opts[i].key = String.fromCharCode(65 + i); } }
      const de = [];const seen = {};
      for (const o of opts) {
        if (!o.text && /^[A-D]$/.test(o.key)) { o.text = o.key; }
        if (seen[o.key]) { seen[o.key].text = (seen[o.key].text + ' ' + o.text).trim();continue; }
        seen[o.key] = o;de.push(o);
      }
      return { question: q, options: de.filter((o) => o.text) };
    }
    function extractInlineAnswerFromRecruitmentSegment(seg) {
      const s = String(seg || '');let m;
      m = s.match(/(?:答\s*[:：]?\s*)?选\s*([A-G])/i);if (m) { return [m[1].toUpperCase()]; }
      m = s.match(/(?:答案|正确答案|参考答案)\s*[:：]?\s*([A-G]{1,7})/i);if (m) { return m[1].toUpperCase().split(''); }
      return [];
    }
    function splitRecruitmentInlineAnalysisV58915(seg) {
      const lines = String(seg || '').split('\n');
      let cut = -1;
      for (let i = 1;i < lines.length;i++) {
        if (/^(?:分析|解析|答|答案|详解|说明|解题思路|思路(?:一|二|三)?)\s*[:：]/.test(String(lines[i] || '').trim())) { cut = i;break; }
      }
      if (cut < 0) { return { body: String(seg || '').trim(), analysis: '' }; }
      const body = lines.slice(0, cut).join('\n').trim();
      if (!/(?:^|\n)\s*A\s*[.．、]/i.test(body)) { return { body: String(seg || '').trim(), analysis: '' }; }
      return { body, analysis: lines.slice(cut).join('\n').trim() };
    }
    function recruitmentGroupToType(group) {
      if (/多选|多项/.test(group)) { return 'multiple'; }
      if (/判断题|判断正误|是非/.test(group)) { return 'judge'; }
      return 'single';
    }

    function stripTrailingRecruitmentNextMaterial(seg) {
      const s = String(seg || '');
      const patterns = [
        /\n\s*(?:第[一二三四五六七八九十0-9]+部分\s*)?(?:材料分析|资料分析)[\s\S]*$/i,
        /\n\s*(?:[一二三四五六七八九十]+[、.．:：]\s*)?根据(?:下列|以下|资料)[\s\S]*$/i,
        /\n\s*(?:表\s*1\s*2010年三大经济圈|2010年，某省广电实际总收入)[\s\S]*$/i,
      ];
      let cut = s.length;
      for (const re of patterns) {
        const m = s.match(re);
        if (m && m.index > 0) { cut = Math.min(cut, m.index); }
      }
      return s.slice(0, cut).trim();
    }
    function repairRecruitmentEmbeddedOptions(options) {
      const out = [];
      const keyCode = (k) => String(k || 'A').toUpperCase().charCodeAt(0);
      for (const opt of (options || [])) {
        const txt = String(opt.text || '').trim();
        const base = keyCode(opt.key);
        const hits = [];let m;
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
        for (let i = 0;i < hits.length;i++) {
          const start = hits[i].end;
          const end = i + 1 < hits.length ? hits[i + 1].idx : txt.length;
          const part = txt.slice(start, end).trim();
          if (part) { out.push({ key: hits[i].key, text: part }); }
        }
      }
      return out.filter((o) => String(o.text || '').trim());
    }
    function moveRecruitmentOptionImagesToQuestion(inputQuestion, options) {
      let question = inputQuestion;
      const moved = [];
      const cleaned = (options || []).map((o) => {
        let txt = String(o.text || '');
        txt = txt.replace(/(?:\n|\s)*(?:第[一二三四五六七八九十0-9]+部分\s*)?(?:语言理解与表达|言语理解与表达|数学能力|数学运算|判断推理|材料分析|资料分析)[\s\S]*$/, '').trim();
        txt = txt.replace(/(?:\n|\s)*(?:[一二三四五六七八九十]+[、.．:：]\s*)?根据(?:下列|以下|资料)[\s\S]*$/, '').trim();
        txt = txt.replace(/\s*全部测验到此结束[\s\S]*$/, '').trim();
        txt = txt.replace(/\[\[DOCX_IMAGE_\d+\]\]/g, (m) => { moved.push(m);return ' '; }).replace(/\s+/g, ' ').trim();
        return { ...o, text: txt };
      }).filter((o) => String(o.text || '').trim());
      if (moved.length) {
        const missing = moved.filter((m) => !String(question || '').includes(m));
        if (missing.length) { question = String(question || '').trim() + '\n' + missing.join('\n'); }
      }
      return { question, options: cleaned };
    }
    function makeRecruitmentQuestion(seg, ctx, idx, restore) {
      let raw = String(seg || '').trim();
      const num = ctx.number || idx + 1;
      raw = raw.replace(/^\s*(?:[【[]\s*\d{1,3}\s*[】\]]|\d{1,3}\s*[.．、])\s*/, '').trim();
      raw = raw.replace(/^<<ANSWER_SECTION>>[\s\S]*$/, '').trim();
      raw = stripTrailingRecruitmentNextMaterial(raw);
      let ans = (ctx.answer || []).map((a) => String(a).toUpperCase());
      const inline = extractInlineAnswerFromRecruitmentSegment(raw);if (!ans.length && inline.length) { ans = inline; }
      const inlineAnalysisV58915 = splitRecruitmentInlineAnalysisV58915(raw);
      raw = inlineAnalysisV58915.body.replace(/(?:答\s*[:：]?\s*)?选\s*[A-G]\s*[，,。；;]?/ig, '').trim();
      const split = splitRecruitmentOptions(raw);
      let question = split.question || raw;
      let options = mergeDuplicateOptions(repairRecruitmentEmbeddedOptions(split.options || []));
      const movedMedia = moveRecruitmentOptionImagesToQuestion(question, options);question = movedMedia.question;options = movedMedia.options;
      if ((!/\S/.test(question) || /\[\[DOCX_IMAGE_\d+\]\]/.test(question)) && options.length < 2 && ans.some((a) => /^[A-G]$/.test(a))) {
        options = ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: k }));
      }
      if (options.length < 2 && /\[\[DOCX_IMAGE_\d+\]\]/.test(raw)) { options = ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: k })); }
      if (ctx.material) { question = (ctx.material + '\n' + question).trim(); }
      question = restore(question).trim();
      const group = ctx.group || '';
      let type = recruitmentGroupToType(group);
      if (ans.length > 1) { type = 'multiple'; }
      const q = { id: makeId('imp', idx), type, number: num, question, options, answer: ans, analysis: ctx.analysis || inlineAnalysisV58915.analysis || '', group, category: group };
      // 专用真题解析已经按明确 A-D 边界拆好选项，使用内部标记避免后续多次规范化把“A等/B等、A队/B队”等正文再次拆坏。
      attachRecruitmentOptionsV58915(q, options);
      return normalizeQuestion(q, idx);
    }
    function parseRecruitmentQuestionPart(qText, answerMap = {}, analysisMap = {}, group = '', restore = (x) => x) {
      const text = normalizeRecruitmentExamTextForParser(protectAnswerAnalysisForQuestionPart(qText));
      const starts = splitRecruitmentQuestionStarts(text);
      const out = [];let currentGroup = group || '';let currentMaterial = '';
      for (let i = 0;i < starts.length;i++) {
        const st = starts[i]; const next = i + 1 < starts.length ? starts[i + 1].idx : text.length;
        const gap = text.slice(i ? starts[i - 1].idx : 0, st.idx);
        const gh = gap.split('\n').map(getRecruitmentSectionHeading).filter(Boolean).pop();
        if (gh) { currentGroup = gh; }
        if (/(资料分析|材料分析)/.test(currentGroup)) {
          const material = extractRecruitmentMaterialFromGap(gap);
          if (material) { currentMaterial = material; }
        }
        let seg = text.slice(st.idx, next).trim();
        if (/<<ANSWER_SECTION>>/.test(seg)) { seg = seg.split('<<ANSWER_SECTION>>')[0].trim(); }
        const ctx = { number: st.number, group: currentGroup, answer: answerMap[st.number] || [], analysis: analysisMap[st.number] || '', material: /(资料分析|材料分析)/.test(currentGroup) ? currentMaterial : '' };
        const q = makeRecruitmentQuestion(seg, ctx, out.length, restore);
        if (q && q.question && (q.options.length || q.answer.length || /data:image\//.test(q.question))) { out.push(q); }
      }
      return out.map((q, i) => normalizeQuestion(q, i));
    }

    function findExpectedRecruitmentQuestionStarts(text, nums) {
      const starts = [];let cursor = 0;const s = String(text || '');
      for (const n of nums) {
        const escaped = String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('(^|\\n|[。？！?；;])\\s*(?:[【\\[]\\s*' + escaped + '\\s*[】\\]]|' + escaped + '\\s*[.．、])\\s*', 'g');
        re.lastIndex = cursor;let m; let hit = null;
        while ((m = re.exec(s))) {
          const idx = m.index + (m[1] ? m[1].length : 0);const after = s.slice(re.lastIndex, re.lastIndex + 50);
          if (/^\\s*(?:【\\s*(?:答案|解析)|答案|解析|[A-G]\\s*[.．、]?\\s*【\\s*解析)/.test(after)) { continue; }
          hit = { idx, bodyStart: re.lastIndex, number: Number(n) };break;
        }
        if (hit) { starts.push(hit);cursor = hit.idx + 1; }
      }
      return starts;
    }
    function parseRecruitmentQuestionPartByExpectedNumbers(qText, nums, answerMap = {}, analysisMap = {}, group = '', restore = (x) => x) {
      const text = normalizeRecruitmentExamTextForParser(protectAnswerAnalysisForQuestionPart(qText));
      const starts = findExpectedRecruitmentQuestionStarts(text, nums);
      if (!starts.length) { return []; }
      const out = [];let currentGroup = group || '';let currentMaterial = '';
      for (let i = 0;i < starts.length;i++) {
        const st = starts[i]; const next = i + 1 < starts.length ? starts[i + 1].idx : text.length;
        const gap = text.slice(i ? starts[i - 1].idx : 0, st.idx);
        const gh = gap.split('\n').map(getRecruitmentSectionHeading).filter(Boolean).pop();
        if (gh) { currentGroup = gh; }
        if (/(资料分析|材料分析)/.test(currentGroup)) {
          const material = extractRecruitmentMaterialFromGap(gap);
          if (material) { currentMaterial = material; }
        }
        let seg = text.slice(st.idx, next).trim();
        if (/<<ANSWER_SECTION>>/.test(seg)) { seg = seg.split('<<ANSWER_SECTION>>')[0].trim(); }
        const ctx = { number: st.number, group: currentGroup, answer: answerMap[st.number] || [], analysis: analysisMap[st.number] || '', material: /(资料分析|材料分析)/.test(currentGroup) ? currentMaterial : '' };
        const q = makeRecruitmentQuestion(seg, ctx, out.length, restore);
        if (q && q.question && (q.options.length || q.answer.length || /data:image\//.test(q.question))) { out.push(q); }
      }
      return out.map((q, i) => normalizeQuestion(q, i));
    }
    function numberRange(a, b) { const arr = [];for (let i = a;i <= b;i++) { arr.push(i); } return arr; }
    function sliceBetweenRecruitmentHeadings(text, headingRe, nextRe) {
      const s = String(text || '');const m = s.match(headingRe);if (!m) { return ''; }
      const start = m.index;const rest = s.slice(start);const n = rest.slice(m[0].length).search(nextRe);
      return n >= 0 ? rest.slice(0, m[0].length + n) : rest;
    }
    function splitRecruitmentSectionQuestionAnswer(section, kind) {
      const s = String(section || '');let idx = -1;
      const patterns = {
        language: [/\n\s*答案\s*\n\s*1\s*[.．、]?\s*[【[]?解析/i, /\n\s*1\s*[.．、]\s*【\s*解析/i],
        math: [/\n\s*6\s*[.．、]?\s*[【[]?答案/i, /\n\s*6\s*[.．、]?\s*答案/i],
        figure: [/\n\s*1\s*[.．、]?\s*答案/i, /\n\s*1\s*[.．、]\s*[【[]?解析/i],
        logic: [/\n\s*1\s*[.．、]\s*[【[]?解析/i, /\n\s*1\s*[.．、]?\s*答案/i],
        data: [/\n\s*1\s*【\s*答案\s*】/i, /\n\s*1\s*[.．、]?\s*【\s*答案\s*】/i],
      }[kind] || [];
      for (const re of patterns) { const m = s.match(re);if (m) { idx = m.index;break; } }
      if (idx < 0) { return { qText: s, aText: '' }; }
      return { qText: s.slice(0, idx), aText: s.slice(idx) };
    }
    function parseRecruitmentImagePostAnswerExam(text) {
      const protectedPack = protectDocxImageMarkdownForParser(normalizeImportText(text));
      const s = normalizeRecruitmentExamTextForParser(protectedPack.text);
      const { restore } = protectedPack;
      const hasImages = protectedPack.images.length > 0;
      const looksRecruitment = /201[45].{0,20}(?:招聘|校园招聘|笔试|综合素质能力测试)|答案解析|图形推理|判断推理|资料分析|材料分析/.test(s);
      if (!looksRecruitment && !hasImages) { return []; }
      let questions = [];
      // 2015 这类：题目区连续编号，最后统一“答案解析”。
      const ansIdx = s.search(/\n\s*(?:答案解析|答案及解析|答案与解析)\s*\n/);
      if (ansIdx > 0 && /第一部分|第二部分|第三部分|第四部分/.test(s)) {
        const qText = s.slice(0, ansIdx);const aText = s.slice(ansIdx);
        const ans = extractRecruitmentAnswerMap(aText);
        const maxNo = Math.max(0, ...Object.keys(ans.answerMap || {}).map(Number).filter(Boolean));
        const nums = maxNo >= 40 ? numberRange(1, maxNo) : [];
        questions = nums.length ? parseRecruitmentQuestionPartByExpectedNumbers(qText, nums, ans.answerMap, ans.analysisMap, '', restore) : parseRecruitmentQuestionPart(qText, ans.answerMap, ans.analysisMap, '', restore);
      } else {
        const sections = [
          { kind: 'language', group: '一、言语理解与表达', text: sliceBetweenRecruitmentHeadings(s, /一[、.．:：]\s*言语理解与表达[:：]?/, /二[、.．:：]\s*数学运算/) },
          { kind: 'math', group: '二、数学运算', text: sliceBetweenRecruitmentHeadings(s, /二[、.．:：]\s*数学运算[:：]?/, /三[、.．:：]\s*图形推理/) },
          { kind: 'figure', group: '三、图形推理', text: sliceBetweenRecruitmentHeadings(s, /三[、.．:：]\s*图形推理[:：]?/, /四[、.．:：]\s*逻辑判断/) },
          { kind: 'logic', group: '四、逻辑判断', text: sliceBetweenRecruitmentHeadings(s, /四[、.．:：]\s*逻辑判断[:：]?/, /五[、.．:：]\s*资料分析/) },
          { kind: 'data', group: '五、资料分析', text: sliceBetweenRecruitmentHeadings(s, /五[、.．:：]\s*资料分析[:：]?/, /$a/) },
        ];
        sections.forEach((sec) => {
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
      const imgQ = questions.filter((q) => /data:image\//.test(q.question || '')).length;
      const answered = questions.filter((q) => (q.answer || []).length).length;
      if (questions.length >= 40 && (imgQ || answered >= Math.max(20, Math.floor(questions.length * 0.55)))) { return questions; }
      return [];
    }
    function scoreRecruitmentImageCandidate(qs, profile) {
      const arr = qs || [];const img = arr.filter((q) => /data:image\//.test(q.question || '')).length;const answered = arr.filter((q) => (q.answer || []).length).length;
      let score = scoreAnswerSectionCandidate(arr, profile || {});
      score += (img * 180) + (answered * 60) + (arr.length * 20);
      const expected = (profile && profile.expectedByHeadings) || 0;if (expected) { score -= Math.min(500, Math.abs(arr.length - expected) * 20); }
      return score + 1600;
    }

    function recruitmentFallbackStatsV58915(questions) {
      const arr = questions || [];
      const warnings = collectImportWarnings(arr);
      const hard = warnings.filter((w) => !/缺少答案|缺少参考答案|多选题只有一个答案/.test(w)).length;
      const answered = arr.filter((q) => (q.answer || []).length).length;
      const objective = arr.filter((q) => ['single', 'multiple', 'judge'].includes(q.type)).length;
      return { count: arr.length, answered, answerRate: arr.length ? answered / arr.length : 0, objective, hard };
    }
    function isHighConfidenceRecruitmentFallbackV58915(questions) {
      const st = recruitmentFallbackStatsV58915(questions);
      return st.count >= 40 && st.answerRate >= 0.9 && st.objective >= Math.floor(st.count * 0.9) && st.hard <= Math.max(1, Math.floor(st.count * 0.01));
    }
    function recruitmentFallbackClearlyBetterV58915(fallbackQuestions, mainlineQuestions) {
      if (!isHighConfidenceRecruitmentFallbackV58915(fallbackQuestions)) { return false; }
      const next = recruitmentFallbackStatsV58915(fallbackQuestions);
      const current = recruitmentFallbackStatsV58915(mainlineQuestions);
      const answerGain = next.answered - current.answered;
      if (answerGain >= Math.max(5, Math.ceil(next.count * 0.08))) { return true; }
      if (current.hard - next.hard >= 3) { return true; }
      return next.count < current.count && next.answered === next.count && current.hard > next.hard && (current.count - next.count) <= Math.ceil(next.count * 0.25);
    }

    function repairDocxTablePromptSplitQuestions(questions) {
      const src = (questions || []).map((q) => ({ ...q, options: [...(q.options || [])], answer: [...(q.answer || [])] }));
      const out = [];
      for (let i = 0;i < src.length;i++) {
        const q = src[i];
        const next = src[i + 1];
        const hasDocxTable = /【DOCX表格开始】/.test(String(q.question || ''));
        const weakOptions = (q.options || []).length < 2;
        const nextHasOptions = next && (next.options || []).length >= 2;
        const nextLooksPrompt = next && !/【DOCX表格开始】/.test(String(next.question || '')) && String(next.question || '').length <= 180;
        if (hasDocxTable && weakOptions && nextHasOptions && nextLooksPrompt) {
          const merged = { ...q };
          merged.question = [q.question, next.question].map((x) => String(x || '').trim()).filter(Boolean).join('\n');
          merged.options = [...(next.options || [])];
          if (!(merged.answer || []).length && (next.answer || []).length) { merged.answer = [...(next.answer || [])]; }
          if (!merged.analysis && next.analysis) { merged.analysis = next.analysis; }
          out.push(merged);
          i++;
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
    function answerEntryMatchRankV58911(q, entry, questionIndex, entryIndex, numberMultiplicity) {
      if (String(q?.number) !== String(entry?.number) || !answerCompatibleWithQuestionV599(q, entry?.answer || [], q?.options || [])) { return -Infinity; }
      const qp = sectionPartsForQuestionV58911(q); const ep = sectionPartsForAnswerEntryV58911(entry);
      let rank = 0; let explicitMatches = 0;
      for (const key of ['volume', 'chapter']) {
        if (qp[key] && ep[key]) {
          if (qp[key] !== ep[key]) { return -Infinity; }
          rank += key === 'chapter' ? 180 : 140;explicitMatches++;
        }
      }
      if (qp.group && ep.group) {
        if (qp.group === ep.group) { rank += 90;explicitMatches++; } else if (qp.groupType && ep.groupType && qp.groupType === ep.groupType) { rank += 55;explicitMatches++; } else { return -Infinity; }
      } else if (qp.groupType && ep.groupType) {
        if (qp.groupType !== ep.groupType) { return -Infinity; }
        rank += 40;explicitMatches++;
      }
      const qHasSection = !!(qp.volume || qp.chapter || qp.group || qp.groupType);
      const eHasSection = !!(ep.volume || ep.chapter || ep.group || ep.groupType);
      if (numberMultiplicity > 1 && explicitMatches === 0 && (qHasSection || eHasSection)) { return -Infinity; }
      if (numberMultiplicity > 1 && explicitMatches === 0) { return -Infinity; }
      if (numberMultiplicity <= 1) { rank += Math.max(0, 20 - Math.abs(questionIndex - entryIndex)); }
      return rank;
    }
    function mergeAnswerEntriesOntoLockedMainlineV599(questions, entries) {
      const base = (questions || []).map((q, i) => normalizeQuestion(q, i));
      const answerEntries = (entries || []).map((e) => ({ ...e, answer: [...(e.answer || [])] }));
      if (!base.length || !answerEntries.length) { return { questions: base, changed: 0, segments: [] }; }
      const entryCountByNumber = new Map(); const questionCountByNumber = new Map();
      answerEntries.forEach((e) => entryCountByNumber.set(String(e.number), (entryCountByNumber.get(String(e.number)) || 0) + 1));
      base.forEach((q) => questionCountByNumber.set(String(q.number), (questionCountByNumber.get(String(q.number)) || 0) + 1));
      const used = new Set();let changed = 0;const segments = [];
      const out = base.map((q, i) => {
        if (!answerNeedsLocalRepairV599(q)) { return q; }
        const number = String(q.number); const multiplicity = Math.max(entryCountByNumber.get(number) || 0, questionCountByNumber.get(number) || 0);
        const qp = sectionPartsForQuestionV58911(q);
        const sameNumberEntries = answerEntries.filter((entry, ei) => !used.has(ei) && String(entry.number) === number);
        const sameNumberQuestions = base.filter((item) => String(item.number) === number);
        const strongSections = new Set(sameNumberEntries.map((entry) => { const ep = sectionPartsForAnswerEntryV58911(entry);return [ep.volume, ep.chapter].filter(Boolean).join('|'); }).filter(Boolean));
        if (strongSections.size > 1 && !qp.volume && !qp.chapter) { return q; }
        if ((questionCountByNumber.get(number) || 0) > 1) {
          if (qp.volume || qp.chapter) {
            const hasStrongMatch = sameNumberEntries.some((entry) => { const ep = sectionPartsForAnswerEntryV58911(entry);return (!qp.volume || ep.volume === qp.volume) && (!qp.chapter || ep.chapter === qp.chapter) && (ep.volume || ep.chapter); });
            if (!hasStrongMatch) { return q; }
          } else {
            const groupKeys = new Set(sameNumberQuestions.map((item) => { const part = sectionPartsForQuestionV58911(item);return part.group || part.groupType; }).filter(Boolean));
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
        const imageOptions = extractInlineImageTokensV589((hit.entry.analysis || '') + ' ' + (hit.entry.raw || ''));
        if (options.length < 2 && imageOptions.length >= 2) { options = imageTokensToChoiceOptionsV589(imageOptions); }
        const answer = normalizeAnswer(hit.entry.answer || [], options, q.type);
        if (!answerCompatibleWithQuestionV599(q, answer, options)) { return q; }
        used.add(hit.ei);changed++;
        const section = [hit.entry.volume, hit.entry.chapter, hit.entry.group].filter(Boolean).join(' / ');
        segments.push(`第${i + 1}题：按${section ? '分区 + ' : ''}原始题号回填答案${options.length > (q.options || []).length ? '与缺失选项' : ''}`);
        let analysis = hit.entry.analysis || q.analysis || '';
        if (imageOptions.length >= 2) { analysis = stripAnswerPrefix(stripInlineImageTokensV589(analysis)).replace(/^[A-G]{1,7}[。．.、，,；;：:\s]*$/i, '').trim(); }
        return normalizeQuestion({ ...q, options, answer, analysis: formatAnswerAnalysisForReview(answer, analysis) }, i);
      });
      return { questions: out, changed, segments };
    }
    function lockedSequenceAlignedV599(base, candidate) {
      if (!base.length || base.length !== candidate.length) { return false; }
      let textMatched = 0;
      for (let i = 0;i < base.length;i++) {
        if (String(base[i].number) !== String(candidate[i].number)) { return false; }
        const a = normalizeText(stripInlineImageTokensV589(base[i].question || ''));
        const b = normalizeText(stripInlineImageTokensV589(candidate[i].question || ''));
        if (!a || !b) { continue; }
        const ah = a.slice(0, 24); const bh = b.slice(0, 24);
        if (a.includes(bh) || b.includes(ah)) { textMatched++; }
      }
      return textMatched >= Math.max(1, Math.ceil(base.length * 0.7));
    }
    function mergeImageCandidateOntoLockedMainlineV599(questions, imageQuestions, profile) {
      const base = (questions || []).map((q, i) => normalizeQuestion(q, i));
      const candidate = (imageQuestions || []).map((q, i) => normalizeQuestion(q, i));
      if (!lockedSequenceAlignedV599(base, candidate)) { return { questions: base, changed: 0, segments: [] }; }
      let changed = 0;const segments = [];
      const out = base.map((q, i) => {
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
        if (options.length < 2 && (cq.options || []).length >= 2) { options = (cq.options || []).map((o) => ({ ...o }));touched = true; }
        if (answerNeedsLocalRepairV599({ ...q, options, answer }) && answerCompatibleWithQuestionV599({ ...q, options }, cq.answer || [], options)) {
          answer = normalizeAnswer(cq.answer || [], options, q.type);touched = true;
        }
        if (!analysis && cq.analysis) { analysis = cq.analysis;touched = true; }
        if (!touched) { return q; }
        const next = normalizeQuestion({ ...q, question, options, answer, analysis }, i);
        const afterRisk = localRepairRiskStatus(next, profile);
        const addedImage = !baseImages.length && candidateImages.length;
        if (afterRisk !== '正常' && beforeRisk === '正常' && !addedImage) { return q; }
        changed++;
        segments.push(`第${i + 1}题：局部补全${addedImage ? '图片' : ''}${options.length > (q.options || []).length ? '选项' : ''}${answer.length > (q.answer || []).length ? '答案' : ''}`);
        return next;
      });
      return { questions: out, changed, segments };
    }
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
      let m = raw.match(/^(?:请\s*)?(?:阅读|根据)\s*(?:以下|下列|上述|给定)?\s*(?:统计资料|资料|材料|图表|病例|案例|病历)[\s，,：:]*(?:并\s*)?(?:回答|完成|解答|作答)\s*(?:第\s*)?(\d{1,4})\s*(?:题)?\s*[-~～—–至到]\s*(?:第\s*)?(\d{1,4})\s*题\s*[：:]?\s*(.*)$/i);
      if (m) {
        const start = Number(m[1]) || 0; const end = Number(m[2]) || 0;
        if (start > 0 && end >= start && end - start < 200) { return { kind: 'range', label: '共用材料', rangeStart: start, rangeEnd: end, lead: String(m[3] || '').trim() }; }
      }
      m = raw.match(/^(?:[【[]\s*)?(共用题干题|共用题干|共用材料题|共用材料|共用资料题|共用资料|共用案例题|共用案例|共用病例题|共用病例)(?:\s*[】\]])?\s*(?:[：:]\s*(.*))?$/);
      if (m) { return { kind: 'explicit', label: m[1], rangeStart: 0, rangeEnd: 0, lead: String(m[2] || '').trim() }; }
      m = raw.match(/^(?:[【[]\s*)?((?:材料|资料|案例|病例)\s*[一二三四五六七八九十百千万0-9]+)(?:\s*[】\]])?\s*[：:]\s*(.*)$/);
      if (m) { return { kind: 'numbered_material', label: m[1], rangeStart: 0, rangeEnd: 0, lead: String(m[2] || '').trim() }; }
      return null;
    }
    function sharedStemChildLineV377(line) {
      const raw = String(line || '').trim();
      if (!raw || isOptionLine(raw) || isAnswerLine(raw) || isAnalysisLine(raw) || getHeadingType(raw) || isImportNoiseLine(raw)) { return null; }
      const number = questionNumberFromLineV58917(raw);if (!number) { return null; }
      const stem = raw
        .replace(/^\s*(?:单选题|单选|单项选择题|多选题|多选|多项选择题|判断题|判断|填空题|填空|简答题|简答|问答题)\s*(?:第\s*)?\d{1,4}\s*(?:题)?\s*[：:]?\s*/, '')
        .replace(/^\s*(?:第\s*)?\d{1,4}\s*(?:题)?\s*[、.．:：]?\s*/, '')
        .replace(/^\s*[（(【[]\s*\d{1,4}\s*[）)】\]]\s*/, '').trim();
      return { number, stem };
    }
    function sharedStemBoundaryV377(line, nextLines = []) {
      const raw = String(line || '').trim();if (!raw) { return false; }
      return !!sharedStemIntroV377(raw) || isVolumeHeading(raw) || !!getHeadingType(raw) || isChapterHeadingV58911(raw, nextLines) || isAnswerSectionHeading(raw, nextLines);
    }
    function sharedStemChildEvidenceV377(lines, start, end) {
      const segment = (lines || []).slice(start, Math.max(start + 1, end));
      const first = sharedStemChildLineV377(segment[0] || '');
      const text = segment.join('\n');
      const optionCount = segment.slice(1).filter(isOptionLine).length;
      if (optionCount >= 2 || segment.some(hasInlineAnswerTag) || segment.some(isAnswerLine) || segment.some(isAnalysisLine)) { return true; }
      const stem = String(first?.stem || '').trim();
      if (/[？?]\s*$/.test(stem) || /[（(]\s*[）)]|_{3,}/.test(stem)) { return true; }
      return /^(?:请|试|简述|说明|分析|计算|判断|指出|概括|解释|论述|回答)|(?:什么|哪些|为何|为什么|如何|是否|正确的是|错误的是|不正确|最恰当|主要|下列|可以推出|表明|说明)[^\n]{0,12}$/i.test(stem)
    || /(?:A\s*[、.．:：].+B\s*[、.．:：])/.test(text);
    }
    function sharedStemMaterialUsefulV377(value) {
      const raw = String(value || '').trim();if (!raw) { return false; }
      if (/!\[[^\]]*\]\(data:image\/|\[\[DOCX_IMAGE_\d+\]\]|【DOCX表格开始】|【DOCX公式OMML：/.test(raw)) { return true; }
      return raw.replace(/[\s\p{P}\p{S}]/gu, '').length >= 4;
    }
    function detectSharedStemGroupsV377(text) {
      const pack = protectDocxImageMarkdownForParser(text);const restore = pack.restore || ((x) => x);
      const lines = normalizeImportText(pack.text).split('\n').map((x) => x.trim()).filter(Boolean);
      const groups = [];
      for (let introIndex = 0;introIndex < lines.length;introIndex++) {
        const intro = sharedStemIntroV377(lines[introIndex]);if (!intro) { continue; }
        let limit = lines.length;
        for (let j = introIndex + 1;j < lines.length;j++) {
          if (sharedStemBoundaryV377(lines[j], lines.slice(j + 1, j + 7))) { limit = j;break; }
        }
        const anchors = [];
        for (let j = introIndex + 1;j < limit;j++) {
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
            for (let j = startAt;j < anchors.length && expected <= intro.rangeEnd;j++) {
              const item = anchors[j];if (item.number !== expected) { break; }
              run.push(item);expected++;
            }
          }
          const evidenceCount = run.filter((item, idx) => sharedStemChildEvidenceV377(lines, item.lineIndex, run[idx + 1]?.lineIndex || limit)).length;
          if (evidenceCount < Math.min(2, run.length)) { run = []; }
        } else {
          for (let start = 0;start < anchors.length && !run.length;start++) {
            const candidate = [anchors[start]];
            for (let j = start + 1;j < anchors.length;j++) {
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
    function sharedStemQuestionMatchesV377(question, child) {
      if (String(question?.number || '') !== String(child?.number || '')) { return false; }
      const childText = sharedStemComparableTextV377(child?.stem || '');
      if (childText.length < 4) { return true; }
      const questionText = sharedStemComparableTextV377(question?.question || '');
      const head = childText.slice(0, Math.min(24, childText.length));
      return questionText.includes(head) || childText.includes(questionText.slice(-Math.min(24, questionText.length)));
    }
    function expandSharedStemQuestionsV377(questions, groups) {
      const out = (questions || []).map((q, i) => normalizeQuestion(q, i));let cursor = 0; let appliedGroups = 0; let appliedChildren = 0; let changedQuestions = 0;const segments = [];
      for (const group of groups || []) {
        const indexes = [];let searchFrom = cursor;
        for (const child of group.children || []) {
          let found = -1;
          for (let i = searchFrom;i < out.length;i++) { if (sharedStemQuestionMatchesV377(out[i], child)) { found = i;break; } }
          if (found < 0) { indexes.length = 0;break; }
          indexes.push(found);searchFrom = found + 1;
        }
        if (indexes.length < 2) { continue; }
        const material = String(group.material || '').trim();const materialKey = sharedStemComparableTextV377(material);let groupChanged = 0;
        indexes.forEach((index) => {
          const q = out[index]; const question = String(q.question || '').trim(); const questionKey = sharedStemComparableTextV377(question);
          const head = materialKey.slice(0, Math.min(36, materialKey.length));
          if (head.length >= 4 && questionKey.includes(head)) { return; }
          out[index] = normalizeQuestion({ ...q, question: [material, question].filter(Boolean).join('\n\n') }, index);groupChanged++;changedQuestions++;
        });
        appliedGroups++;appliedChildren += indexes.length;cursor = indexes[indexes.length - 1] + 1;
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
      const addCandidate = (name, fn) => {
        try {
          let qs = fn().map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
          qs = repairDocxTablePromptSplitQuestions(qs).map(sanitizeQuestionOptionsForDocxBoundariesV583).map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
          if (/^标准/.test(name) && standardSourceDetailedV58910) { attachDetailedSourceMetaToQuestionsV58910(qs, standardSourceDetailedV58910); }
          candidates.push({ name, questions: qs, score: scoreParsedQuestions(qs, profile), warnings: collectImportWarnings(qs) });
        } catch (e) { candidates.push({ name, questions: [], score: -9999, warnings: ['解析失败：' + e.message] }); }
      };
      const evaluateCandidate = (candidate) => {
        if (!candidate || !candidate.questions || !candidate.questions.length) {
          return { qtyOk: false, warnOk: false, typeOk: false, hardCount: 9999, allowedHard: 0, localRisk: 9999, warnings: [] };
        }
        const warnings = importWarningsForStrategy(candidate.questions, profile);
        const hard = warnings.filter((w) => !/缺少答案|缺少参考答案|多选题只有一个答案/.test(w));
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
      const standardComparator = (a, b) => {
        const ae = a.eval || evaluateCandidate(a); const be = b.eval || evaluateCandidate(b);
        const aGood = ae.qtyOk && ae.typeOk && ae.warnOk ? 1 : 0;
        const bGood = be.qtyOk && be.typeOk && be.warnOk ? 1 : 0;
        const aBase = ae.qtyOk && ae.typeOk ? 1 : 0;
        const bBase = be.qtyOk && be.typeOk ? 1 : 0;
        return bGood - aGood || bBase - aBase || ae.hardCount - be.hardCount || ae.localRisk - be.localRisk || expectedDiff(a) - expectedDiff(b) || b.score - a.score;
      };
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

        const localRisk = countLocalRepairWarnings(primary.questions || [], profile);
        const primaryHasQuestions = (primary.questions || []).length > 0;
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
            } catch (e) { candidates.push({ name: '整卷兜底：题目区 + 答案解析区', questions: [], score: -9999, warnings: ['解析失败：' + e.message] }); }
          }
          if (imageWholeQuestions.length) { candidates.push({ name: '整卷兜底：图片真题 + 后置答案', questions: imageWholeQuestions, score: scoreRecruitmentImageCandidate(imageWholeQuestions, profile), warnings: collectImportWarnings(imageWholeQuestions) }); }
          if (profile.hasVolumeHeading || profile.repeatedQuestionNumbers || profile.hasTypeSections) { addCandidate('整卷兜底：分卷分区三层解析', () => parseByVolumeAndSections(original)); }
          if (profile.inlineOptionLikely || profile.inlineAnswerLikely || !mainlineEval.qtyOk || !mainlineEval.typeOk) { addCandidate('整卷兜底：紧凑题干选项解析', () => parseTextQuestionsBase(forceSplitCompactText(original))); }
          const fallbackCandidates = candidates
            .filter((c) => /^整卷兜底：/.test(c.name) && c.questions && c.questions.length)
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
      const candidateLine = candidates.map((c) => `${c.name}${c.questions.length}题/质量${c.score}${c.segments?.length ? '（局部修复' + c.segments.length + '处）' : ''}`).join('；');
      const expected = profile.expectedByHeadings ? `；标题预期约${profile.expectedByHeadings}题，实际${finalQuestions.length}题，差值${finalQuestions.length - profile.expectedByHeadings}` : '';
      const report = `解析模式：${strategyLabel}；采用策略：${best.name}。${profileBits.length ? '格式画像：' + profileBits.join('、') + '。' : ''}候选结果：${candidateLine}。最终识别：${finalQuestions.length}题（单选${stats.single || 0}、多选${(stats.multiple || 0) + (stats.multi || 0)}、判断${stats.judge || 0}、填空${stats.blank || 0}、简答${stats.short || 0}）${expected}。`;
      // 诊断构建失败时，页面仍需保留本次报告及上一次成功的诊断。
      publishReport(report);
      const diagnostics = { mode: strategyLabel, strategy: best.name, profile, candidates: candidates.map((c) => ({ name: c.name, questions: c.questions.length, score: c.score, warnings: c.warnings || [], segments: c.segments || [] })), expected: { total: profile.expectedByHeadings || 0, types: profile.expectedByType || {} }, stats, warnings: collectImportWarnings(finalQuestions), sharedStem: { detectedGroups: sharedStemGroupsV377.length, appliedGroups: sharedStemExpansionV377.appliedGroups || 0, appliedChildren: sharedStemExpansionV377.appliedChildren || 0, changedQuestions: sharedStemExpansionV377.changedQuestions || 0 } };
      return { questions: finalQuestions, diagnostics };
    }
    function analyzeQuestionTextProfile(text) {
      const t = normalizeImportText(text);
      const lines = t.split('\n').map((x) => x.trim()).filter(Boolean);
      const qnums = [];
      lines.forEach((l) => { const m = l.match(/^\s*(?:第\s*)?(\d{1,3})\s*(?:题)?[、.．:：]/);if (m) { qnums.push(m[1]); } });
      const seen = new Set();let repeated = false;for (const n of qnums) { if (seen.has(n)) { repeated = true;break; }seen.add(n); }
      return {
        lineCount: lines.length,
        hasVolumeHeading: lines.some(isVolumeHeading) || /202\d年.*(?:试卷|考试).*?[·._-]?[一二三四五六七八九十0-9]+卷/.test(t),
        hasTypeSections: lines.some((l) => !!getHeadingType(l)),
        repeatedQuestionNumbers: repeated,
        inlineOptionLikely: /[A-Ga-g]\s*[、.．:：]?[^\n]{1,50}[;；]\s*[B-Gb-g]\s*[、.．:：]?/.test(t) || /[A-Ga-g][、.．:：][^\n]{1,50}[B-Gb-g][、.．:：]/.test(t),
        inlineAnswerLikely: /[【[（(]\s*(?:答案|正确答案|参考答案|标准答案)\s*[:：]/.test(t),
        hasAnswerAnalysisSection: hasAnswerAnalysisSignal(t),
        expectedByHeadings: estimateExpectedQuestionCount(t),
        expectedByType: estimateExpectedQuestionTypeCounts(t),
      };
    }
    function estimateExpectedQuestionCount(text) {
      let total = 0;let m;
      const direct = /(?:单选题|单项选择题|多选题|多项选择题|判断题|填空题|简答题)[^\n]{0,25}?共\s*(\d{1,4})\s*题/g;
      while ((m = direct.exec(text))) { const n = Number(m[1]);if (n > 0) { total += n; } }
      if (total) { return total; }
      const re = /(单选题|多选题|判断题|填空题|简答题)[^\n]{0,30}?每题\s*([\d.]+)\s*分[^\n]{0,20}?共\s*([\d.]+)\s*分/g;
      while ((m = re.exec(text))) { const per = Number(m[2]); const sum = Number(m[3]);if (per > 0 && sum > 0) { total += Math.round(sum / per); } }
      if (total) { return total; }
      const loose = /(单项选择题|单选题|单选|多项选择题|多选题|多选|判断题|判断|填空题|填空|简答题|简答)[^\n]{0,20}?(\d{1,4})\s*(?:题|道)/g;
      while ((m = loose.exec(text))) { if (!/每题\s*$/.test(m[0])) { const n = Number(m[2]);if (n > 0) { total += n; } } }
      if (total) { return total; }
      const range = /(单项选择题|单选题|单选|多项选择题|多选题|多选|判断题|判断|填空题|填空|简答题|简答)[^\n]{0,15}?(\d{1,4})\s*(?:-|~|—|至|到)\s*(\d{1,4})/g;
      while ((m = range.exec(text))) { const a = Number(m[2]); const b = Number(m[3]);if (b >= a && b - a < 2000) { total += b - a + 1; } }
      return total || 0;
    }
    function estimateExpectedQuestionTypeCounts(text) {
      const out = { single: 0, multiple: 0, judge: 0, blank: 0, short: 0 };
      const map = { 单选题: 'single', 单选: 'single', 单项选择题: 'single', 多选题: 'multiple', 多选: 'multiple', 多项选择题: 'multiple', 判断题: 'judge', 判断: 'judge', 填空题: 'blank', 填空: 'blank', 简答题: 'short', 简答: 'short' };
      let m;
      const direct = /(单项选择题|单选题|单选|多项选择题|多选题|多选|判断题|判断|填空题|填空|简答题|简答)[^\n]{0,25}?共\s*(\d{1,4})\s*题/g;
      while ((m = direct.exec(text))) { const t = map[m[1]];if (t) { out[t] += Number(m[2] || 0); } }
      const score = /(单项选择题|单选题|单选|多项选择题|多选题|多选|判断题|判断|填空题|填空|简答题|简答)[^\n]{0,30}?每题\s*([\d.]+)\s*分[^\n]{0,20}?共\s*([\d.]+)\s*分/g;
      while ((m = score.exec(text))) { const t = map[m[1]]; const per = Number(m[2]); const sum = Number(m[3]);if (t && per > 0 && sum > 0) { out[t] += Math.round(sum / per); } }
      const loose = /(单项选择题|单选题|单选|多项选择题|多选题|多选|判断题|判断|填空题|填空|简答题|简答)[^\n]{0,20}?(\d{1,4})\s*(?:题|道)/g;
      while ((m = loose.exec(text))) { const t = map[m[1]]; const n = Number(m[2]);if (t && n > 0 && !/每题\s*$/.test(m[0])) { out[t] = Math.max(out[t] || 0, n); } }
      const range = /(单项选择题|单选题|单选|多项选择题|多选题|多选|判断题|判断|填空题|填空|简答题|简答)[^\n]{0,15}?(\d{1,4})\s*(?:-|~|—|至|到)\s*(\d{1,4})/g;
      while ((m = range.exec(text))) { const t = map[m[1]]; const a = Number(m[2]); const b = Number(m[3]);if (t && b >= a && b - a < 2000) { out[t] = Math.max(out[t] || 0, b - a + 1); } }
      return out;
    }

    function scoreQuestionNumberContinuity(qs) {
      const arr = qs || [];
      const explicitNums = arr.map((q) => { const meta = getSourceMetaV58910(q);return meta?.explicitNumber ? Number(meta.originalNumber || 0) : 0; }).filter((n) => n > 0 && n < 10000);
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

    function isLeakedHeadingOptionTextV583(text) {
      const t = String(text || '').trim();
      if (!t) { return false; }
      if (getHeadingType(t) || isVolumeHeading(t)) { return true; }
      if (isChapterHeadingV58911(t) || /^(?:模块|专题)[一二三四五六七八九十百千万0-9]+/.test(t.replace(/\s+/g, ''))) { return true; }
      if (/^(?:单项选择题|单选题|多项选择题|多选题|判断题|填空题|简答题)$/.test(t.replace(/\s+/g, ''))) { return true; }
      return false;
    }
    function isDocxTableArtifactOptionV583(option) {
      const key = String(option?.key || option?.label || '').trim().toUpperCase();
      const t = String(option?.text || '');
      if (!/^[E-GF]$/.test(key)) { return false; }
      return /\|/.test(t) && /(?:Significance|回归分析|残差|总计|df|SS|MS|---|方差)/i.test(t);
    }
    function sanitizeQuestionOptionsForDocxBoundariesV583(q) {
      const copy = { ...q };
      const opts = (copy.options || []).filter((o) => {
        const visible = visibleOptionTextForRisk(o?.text || '');
        if (isLeakedHeadingOptionTextV583(visible)) { return false; }
        if (isDocxTableArtifactOptionV583(o)) { return false; }
        return true;
      });
      copy.options = opts;
      return copy;
    }
    function countBoundaryOptionPollutionV583(qs) {
      let n = 0;
      (qs || []).forEach((q) => { (q.options || []).forEach((o) => { const visible = visibleOptionTextForRisk(o?.text || '');if (isLeakedHeadingOptionTextV583(visible) || isDocxTableArtifactOptionV583(o)) { n++; } }); });
      return n;
    }

    function scoreParsedQuestions(qs, profile) {
      const arr = qs || [];let score = arr.length * 10;
      const warnings = collectImportWarnings(arr);
      // 题目文件和答案文件分离时，题目本身没有答案是正常现象，不能让“缺少答案”主导策略选择。
      const sourceLikelyHasAnswers = !!(profile.inlineAnswerLikely || profile.hasAnswerAnalysisSection) || arr.some((q) => (q.answer || []).length);
      warnings.forEach((w) => { score -= w.includes('缺少答案') && !sourceLikelyHasAnswers ? 3 : 25; });
      let suspicious = 0;
      arr.forEach((q) => {
        if ((q.options || []).some((o) => String(o.text || '').length > 220 || /【\s*答案|\b\d{1,3}\s*[、.．:：].+【\s*答案/.test(o.text))) { suspicious++; }
        if (/【\s*答案|正确答案|参考答案/.test(q.question || '')) { suspicious++; }
        if ((q.question || '').length > 260) { suspicious++; }
        if (localRepairRiskStatus(q, profile) !== '正常') { suspicious++; }
      });
      score -= suspicious * 30;
      if (profile.expectedByHeadings) { const diff = Math.abs(arr.length - profile.expectedByHeadings);score -= Math.min(300, diff * 12); }
      score -= countBoundaryOptionPollutionV583(arr) * 140;
      score += scoreQuestionNumberContinuity(arr);
      return score;
    }
    function forceSplitCompactText(text) {
      let s = String(text || '');
      s = s.replace(/([。？！?])\s*(?=A\s*[^A-G\n]{1,80}\s*[\n\r]+\s*B\s*[、.．:：\s])/g, '$1 ');
      s = s.replace(/([^\n])\s+(?=A\s*[^A-G\n]{1,80}\s*B\s*[、.．:：])/g, '$1\n');
      return preSplitVolumeAndCompactQuestions(s);
    }
    function preferLeadingStandaloneOptionV58923(line, rich) {
      const raw = String(line || '').trim();
      const leadMatch = raw.match(/^\s*(?:[oOxXuUyYvV√✔✓]\s*)?(?:[（(]\s*([A-Ga-g])\s*[）)]|([A-Ga-g])\s*[、.．:：，,])\s*(.*)$/);
      if (!leadMatch || !rich || !Array.isArray(rich.options) || rich.options.length < 2) { return false; }
      const lead = normalizeOptionKey(leadMatch[1] || leadMatch[2]);
      const keys = rich.options.map((o) => normalizeOptionKey(o.key));
      if (rich.prefix || keys[0] !== lead) { return true; }
      for (let i = 0;i < keys.length;i++) {
        if (keys[i] !== String.fromCharCode(lead.charCodeAt(0) + i)) { return true; }
      }
      const next = String.fromCharCode(lead.charCodeAt(0) + 1);
      const body = leadMatch[3] || '';
      const explicitMarker = new RegExp(next + '\\s*[、.．:：]').test(body);
      const noSeparatorMarker = new RegExp('(?:^|[\\s;；，,、])' + next + '(?=[\\u4e00-\\u9fa5])').test(body);
      return !explicitMarker && !noSeparatorMarker;
    }
    function isNumberedNarrativeEnumerationV58923(line, group = '') {
      const type = mapType(group || '');
      if (!['judge', 'blank', 'short'].includes(type)) { return false; }
      const raw = String(line || '').trim();
      if (!/^\s*(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]/.test(raw)) { return false; }
      const items = raw.match(/[（(]\s*\d{1,2}\s*[）)]/g) || [];
      return items.length >= 2;
    }
    function isNumberedQuestionRichOptionFalsePositiveV58923(line, rich) {
      const raw = String(line || '').trim();
      if (!rich || !Array.isArray(rich.options) || rich.options.length < 2) { return false; }
      const numbered = raw.match(/^\s*(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]\s*(.*)$/);
      if (!numbered) { return false; }
      const body = numbered[1] || '';
      const explicit = (body.match(/(?:^|[\s；;，,、])(?:[A-G])\s*[、.．:：]/g) || []).length;
      const noSeparator = (body.match(/(?:^|[\s；;，,、])(?:[A-G])(?=[\u4e00-\u9fa5])/g) || []).length;
      return explicit + noSeparator < 2;
    }

    function parseStructuredExamText(text) {
      const s = repairDocxLostQuestionNumberLines(normalizeImportText(text));
      const lines = s.split('\n').map((x) => x.trim()).filter(Boolean);
      const questions = []; let currentType = ''; let currentVolume = ''; let current = null; let collectingAnalysis = false;let collectingSubjectiveAnswerV58917 = false;
      const hasPendingAnalysis = () => current && collectingAnalysis;
      const flush = () => {
        if (!current) { return; }
        const stem = stripLeadingQuestionTypeLabelV592((current.questionLines || []).join(' ').replace(/\s+/g, ' ').trim());
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
      for (let i = 0;i < lines.length;i++) {
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
          const after = line.replace(/^答案解析\s*/, '');
          if (hasPendingAnalysis()) { current.analysisLines.push(after);collectingAnalysis = false; }
          const combinedM = after.match(/^(\d{1,4})\s*[.、．]\s*(?:【答案】\s*)?([A-Ga-g]{1,7})\s*(?:【解析】\s*(.*))?$/);
          if (combinedM) {
            flush();current = { number: Number(combinedM[1]), questionLines: [], options: [], answer: splitAnswerByType(combinedM[2], currentType || ''), analysisLines: combinedM[3] ? [combinedM[3].trim()] : [], group: currentType, volume: currentVolume, type: mapType(currentType) || '' };collectingAnalysis = !!combinedM[3];
          } else {
            const compactReg = /(\d{1,4})\s*[.、．]\s*([A-Ga-g]{1,7})\s*(?=【|$)/g;let cm;const pairs = [];
            while ((cm = compactReg.exec(after)) !== null) { pairs.push({ no: Number(cm[1]), ans: cm[2] }); }
            if (pairs.length) {
              flush();
              pairs.forEach((p, idx) => {
                if (idx > 0) { flush(); }
                current = { number: p.no, questionLines: [], options: [], answer: splitAnswerByType(p.ans, currentType || ''), analysisLines: [], group: currentType, volume: currentVolume, type: mapType(currentType) || '' };
              });
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
        if (compactPairs && /\d{1,4}\s*[.、．]\s*[A-Ga-g]{1,7}.*\d{1,4}\s*[.、．]\s*[A-Ga-g]{1,7}/.test(line)) {
          const compactReg = /(\d{1,4})\s*[.、．]\s*(?:【答案】\s*)?([A-Ga-g]{1,7})\s*(?:【解析】\s*([^\d]*?))?(?=\s+\d{1,4}\s*[.、．]|\s*$)/g;let cm;const pairs = [];
          while ((cm = compactReg.exec(line)) !== null) { pairs.push({ no: Number(cm[1]), ans: cm[2], analysis: (cm[3] || '').trim() }); }
          if (hasPendingAnalysis()) { collectingAnalysis = false; }
          pairs.forEach((p, idx) => {
            if (idx === 0 && current && current.number === p.no && !current.answer.length) { current.answer = splitAnswerByType(p.ans, current.type || '');if (p.analysis) { current.analysisLines.push(p.analysis); } } else { flush();current = { number: p.no, questionLines: [], options: [], answer: splitAnswerByType(p.ans, currentType || ''), analysisLines: p.analysis ? [p.analysis] : [], group: currentType, volume: currentVolume, type: mapType(currentType) || '' }; }
          });
          if (pairs.length) { continue; }
        }
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
        const shouldAdoptContextualType = () => !current.type && contextualTypeV592;
        const inlineAnswerTag = extractInlineAnswerTag(line, contextualTypeV592);
        if (inlineAnswerTag.answer.length) { if (shouldAdoptContextualType()) { current.type = contextualTypeV592; }current.answer.push(...inlineAnswerTag.answer);line = inlineAnswerTag.text; }
        const trailingAnswer = extractTrailingAnswerFromText(line, contextualTypeV592);
        if (trailingAnswer.answer.length && !isAnswerLine(line)) { if (shouldAdoptContextualType()) { current.type = contextualTypeV592; }current.answer.push(...trailingAnswer.answer);line = trailingAnswer.text; }
        if (isAnswerLine(line)) {
          const stripped = line.replace(/^(?:【|\[)?\s*(?:正确答案|参考答案|标准答案|答案解析|答案|参考要点|答题要点|Answer|Correct\s*answer)\s*(?:】|\])?\s*[:：]?\s*/i, '').trim();
          const answerTypeV592 = current.type || contextualTypeV592 || '';
          const ca = stripped.match(/^(\d{1,4})\s*[.、．]\s*(?:【答案】\s*)?([A-Ga-g]{1,7})\s*【解析】\s*(.*)$/);
          if (ca) { current.answer = splitAnswerByType(ca[2], answerTypeV592);current.analysisLines = [ca[3].trim()];collectingAnalysis = true; } else { current.answer = splitAnswerByType(stripped, answerTypeV592);if (!current.type && answerTypeV592) { current.type = answerTypeV592; }collectingAnalysis = false; }
          continue;
        }
        if (isAnalysisLine(line)) { current.analysisLines.push(line.replace(/^(?:【|\[)?\s*(?:解析|答案解析|试题解析|说明|考点)\s*(?:】|\])?\s*[:：]?\s*/i, '').trim());collectingAnalysis = true;continue; }
        let rich = extractInlineOptionsRich(line);
        if (preferLeadingStandaloneOptionV58923(line, rich)) { rich = null; }
        if (rich && rich.options.length >= 2) {
          if (rich.prefix) { current.questionLines.push(rich.prefix); }
          rich.options.forEach((it) => {
            const key = normalizeOptionKey(it.key);let txt = (it.text || '').trim();
            if (hasCorrectOptionMark(it, txt)) { current.answer.push(key);txt = removeCorrectMark(txt); }
            if (it.extraAnswer && it.extraAnswer.length) { current.answer.push(...it.extraAnswer); }
            if (txt) { current.options.push({ key, text: txt }); }
          });
          continue;
        }
        const inline = narrativeEnumerationV58923 ? [] : splitInlineOptions(line);
        if (inline.length >= 2) {
          inline.forEach((it) => {
            const key = normalizeOptionKey(it.key);let txt = (it.text || '').trim();
            if (hasCorrectOptionMark(it, txt)) { current.answer.push(key);txt = removeCorrectMark(txt); }
            if (txt) { current.options.push({ key, text: txt }); }
          });
          continue;
        }
        const bareEnglishStemWithoutQuestionV5982 = !(current.questionLines || []).length && !(current.options || []).length && isBareEnglishStemStartV5982(line);
        const om = bareEnglishStemWithoutQuestionV5982 ? null : line.match(/^\s*([oOxXuUyYvV√✔✓])?\s*(?:[（(]\s*([A-Ga-g1-90])\s*[）)]|([A-Ga-g0])\s*(?:[、.．:：，,]|\s+))\s*(.*)$/);
        if (om) {
          const key = normalizeOptionKey(om[2] || om[3]); let txt = (om[4] || '').trim();
          if (om[1] || hasCorrectMark(txt)) { current.answer.push(key);txt = removeCorrectMark(txt); }
          if (txt) { current.options.push({ key, text: txt }); }
          continue;
        }
        if (collectingAnalysis) { current.analysisLines.push(line);continue; }
        if (current.options.length) {
          current.options[current.options.length - 1].text = (current.options[current.options.length - 1].text + ' ' + line).trim();
        } else {
          current.questionLines.push(line);
        }
      }
      flush();
      return questions.map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question && (q.options.length || q.answer.length || q.type === 'judge' || isTextType(q.type)));
    }
    function parseByVolumeAndSections(text) {
      const s = preSplitVolumeAndCompactQuestions(repairDocxLostQuestionNumberLines(normalizeImportText(text)));
      const lines = s.split('\n').map((x) => x.trim()).filter(Boolean);
      const blocks = [];let volume = '';let group = '';let section = [];
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

    function normalizeImportText(text) {
      let raw = String(text || '');
      if (/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/.test(raw)) {
        try {
          const extracted = docxXmlToText(raw);
          if (extracted && extracted.trim()) { raw = extracted; } else {
            const parts = [];let m;const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
            while ((m = re.exec(raw))) { parts.push(decodeXml(m[1])); }
            if (parts.length) { raw = parts.join('\n'); }
          }
        } catch (err) {
          warnDev('Word XML 文本提取失败，使用兜底提取。', err);
          const parts = [];let m;const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
          while ((m = re.exec(raw))) { parts.push(decodeXml(m[1])); }
          if (parts.length) { raw = parts.join('\n'); }
        }
      }
      if (/<w:/.test(raw)) {
        raw = raw.replace(/<w:t(?:\s[^>]*)?>/g, '\n').replace(/<[^>]+>/g, '').split('\n').map((x) => decodeXml(x).trim()).filter(Boolean).join('\n');
      }
      return raw
        .replace(/\r/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/[\u200b\ufeff]/g, '')
        .replace(/[Ａ-Ｇａ-ｇ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    }

    function shouldApplyDocxLostQuestionNumberRepairV584(text) {
      const s = String(text || '');
      if (!s.trim()) { return false; }
      const hasDocxRich = /【DOCX表格开始】|【DOCX公式OMML：|\[\[DOCX_IMAGE_\d+\]\]|!\[[^\]]*\]\(data:image\//.test(s);
      const chapterCount = (s.match(/(?:^|\n)\s*第[一二三四五六七八九十百千万0-9]+章/g) || []).length;
      const typeSectionCount = (s.match(/(?:^|\n)\s*(?:单项选择题|单选题|单选|多项选择题|多选题|多选|判断题|判断|填空题|填空|简答题|简答)\s*(?:$|\n)/g) || []).length;
      const strongNoCount = (s.match(/(?:^|\n)\s*(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]/g) || []).length;
      const noPuncNoCount = (s.match(/(?:^|\n)\s*\d{1,3}(?=[^\d\s、.．:：）)\]】])/g) || []).length;
      // v58.4：这类补题号/补标点是给 DOCX 多章节、富文本抽取损失做的兜底，不能默认污染标准纯文本主线。
      if (hasDocxRich && strongNoCount >= 1) { return true; }
      if (chapterCount >= 2 && strongNoCount >= 8) { return true; }
      if (typeSectionCount >= 2 && strongNoCount >= 8 && noPuncNoCount >= 1) { return true; }
      if (noPuncNoCount >= 2 && strongNoCount >= 8 && /(?:^|\n)\s*A\s*[、.．:：，,\s]/i.test(s) && /(?:^|\n)\s*B\s*[、.．:：，,\s]/i.test(s)) { return true; }
      return false;
    }
    function repairDocxLostQuestionNumberLines(text) {
      if (!shouldApplyDocxLostQuestionNumberRepairV584(text)) { return String(text || ''); }
      const lines = String(text || '').split('\n');
      const out = [];let pendingFirst = 0;let lastQuestionNo = 0;
      const isChapterLike = (s) => /^第[一二三四五六七八九十百千万0-9]+章/.test(String(s || '').replace(/\s+/g, ''));
      const strongNoOf = (s) => {
        const t = String(s || '').trim();
        const m = t.match(/^\s*(?:第\s*)?(\d{1,4})\s*(?:题)?[、.．:：]/) || t.match(/^\s*[（(【[]\s*(\d{1,4})\s*[）)】\]]/);
        return m ? Number(m[1]) : 0;
      };
      const looksLikeChoiceA = (s) => /^\s*A\s*[、.．:：，,\s]/i.test(String(s || '')) || /^\s*Ａ\s*[、.．:：，,\s]/.test(String(s || ''));
      const looksLikeChoiceB = (s) => /^\s*B\s*[、.．:：，,\s]/i.test(String(s || '')) || /^\s*Ｂ\s*[、.．:：，,\s]/.test(String(s || ''));
      const hasInlineAB = (s) => /A\s*[、.．:：，,\s].{0,100}B\s*[、.．:：，,\s]/i.test(String(s || ''));
      const hasNearbyOptions = (idx) => {
        let a = false; let b = false; let seen = 0;
        for (let j = idx + 1;j < lines.length && seen < 8;j++) {
          const t = String(lines[j] || '').trim();if (!t) { continue; }seen++;
          if (isChapterLike(t) || getHeadingType(t) || isVolumeHeading(t)) { break; }
          if (looksLikeChoiceA(t) || /^\s*A[.．、:：]/i.test(t) || hasInlineAB(t)) { a = true; }
          if (looksLikeChoiceB(t) || /^\s*B[.．、:：]/i.test(t) || hasInlineAB(t)) { b = true; }
        }
        return a && b;
      };
      const nextStrongNo = (idx) => {
        let seen = 0;
        for (let j = idx + 1;j < lines.length && seen < 14;j++) {
          const t = String(lines[j] || '').trim();if (!t) { continue; }seen++;
          if (isChapterLike(t) || getHeadingType(t) || isVolumeHeading(t)) { break; }
          const n = strongNoOf(t);if (n) { return n; }
        }
        return 0;
      };
      const canBeQuestionWithoutNumber = (s, idx) => {
        const t = String(s || '').trim();
        if (!t || strongNoOf(t) || isOptionLine(t) || isAnswerLine(t) || isAnalysisLine(t) || getHeadingType(t) || isImportNoiseLine(t) || isChapterLike(t)) { return false; }
        if (t.length < 8) { return false; }
        if (!/[（(][^）)]{0,80}[）)]|[?？。]$|称为|属于|是|指/.test(t)) { return false; }
        return hasNearbyOptions(idx);
      };
      for (let i = 0;i < lines.length;i++) {
        let raw = lines[i];let t = String(raw || '').trim();
        if (!t) { out.push(raw);continue; }
        if (isChapterLike(t) || getHeadingType(t) || isVolumeHeading(t)) {
          pendingFirst = 4;lastQuestionNo = 0;out.push(raw);continue;
        }
        const originalStrong = strongNoOf(t);
        if (pendingFirst > 0 && canBeQuestionWithoutNumber(t, i)) {
          raw = String(raw).replace(t, '1．' + t);t = String(raw).trim();pendingFirst = 0;
        } else if (canBeQuestionWithoutNumber(t, i)) {
          const nextNo = nextStrongNo(i);
          if (lastQuestionNo > 0 && nextNo === lastQuestionNo + 2) {
            raw = String(raw).replace(t, (lastQuestionNo + 1) + '．' + t);t = String(raw).trim();
          }
        } else if (pendingFirst > 0 && !isImportNoiseLine(t)) {
          pendingFirst--;
        }
        // DOCX/Word 有时会丢失题号后的标点，如“3下列……”。只在后续邻近存在 A/B 选项时补回，避免误伤普通数字文本。
        const noPunc = t.match(/^(\d{1,3})(?=[^\d\s、.．:：）)\]】])/);
        if (noPunc && hasNearbyOptions(i)) {
          raw = String(raw).replace(/^(\s*\d{1,3})(?=[^\d\s、.．:：）)\]】])/, '$1．');
          t = String(raw).trim();
        }
        const n = strongNoOf(t);
        if (n) { lastQuestionNo = n; } else if (originalStrong) { lastQuestionNo = originalStrong; }
        out.push(raw);
      }
      return out.join('\n');
    }

    function preSplitVolumeAndCompactQuestions(text) {
      let s = String(text || '');
      // 支持“单选题 1 / 判断题 31 / 多选题 115”这种标准导出题头：强制独占一行，避免整卷粘连。
      s = s.replace(/([^\n])\s+((?:单选题|单选|单项选择题|多选题|多选|多项选择题|判断题|判断|填空题|填空|简答题|简答|问答题)\s*(?:第\s*)?\d{1,4}\s*(?:题)?)(?=\s+\S)/g, '$1\n$2\n');
      s = s.replace(/(^|\n)\s*((?:单选题|单选|单项选择题|多选题|多选|多项选择题|判断题|判断|填空题|填空|简答题|简答|问答题)\s*(?:第\s*)?\d{1,4}\s*(?:题)?)\s+(?=\S)/g, '$1$2\n');
      // 让“第一卷/第二卷/第1套/试卷一”等标题独占一行，避免卷内重复 1-25 题被拼接。
      s = s.replace(/(^|\n|[ \t]{2,}|[。；;])\s*((?:第\s*[一二三四五六七八九十百千万0-9]+\s*(?:卷|套|部分|单元)|试卷\s*[一二三四五六七八九十百千万0-9]+|卷\s*[一二三四五六七八九十百千万0-9]+))(?=\s*(?:$|\n|(?:单选题|单选|单项选择题|多选题|多选|多项选择题|判断题|判断|填空题|填空|简答题|简答|问答题)|(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]))/gm, (m, prefix, heading) => `${prefix || '\n'}\n${heading}\n`);
      // 若多个题目在同一段里，用题号强制切题。
      // 增强：避免把选项值“A. 1.O m / B.1.2 m”里的“1.O”误认为新题号。
      s = s.replace(/([^\n])\s+((?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]\s*(?!\s*\d)(?!mm|cm|m|MPa|bar|kg|℃|%))/gi, (m, prev, next, offset, full) => {
        const before = full.slice(Math.max(0, offset - 8), offset + 1);
        if (/[A-Ga-g0]\s*[、.．:：]\s*$/.test(before)) { return prev + ' ' + next; }
        if (/^\d+\s*[.．]\s*[OoIl]\b/.test(next)) { return prev + ' ' + next; }
        return prev + '\n' + next;
      });
      // 答案标记后面紧跟下一题题号时切开。
      s = s.replace(/([】\])）])\s+(?=(?:第\s*)?\d{1,3}\s*(?:题)?[、.．:：])/g, '$1\n');
      // 兼容“题干【答案：B.20mm】 A...;B...;C...”这种紧凑格式：先把答案标记前后留出边界。
      s = s.replace(/[ \t]*(【\s*(?:正确答案|参考答案|标准答案|答案)\s*[:：][^】]{1,80}】)[ \t]*/g, ' $1 ');
      return s;
    }
    function isVolumeHeading(line) {
      const raw = String(line || '').trim();
      const s = raw.replace(/\s/g, '');
      if (/^(?:第[一二三四五六七八九十百千万0-9]+(?:卷|套|部分|单元)|试卷[一二三四五六七八九十百千万0-9]+|卷[一二三四五六七八九十百千万0-9]+)$/.test(s)) { return true; }
      if (/^202\d年.*(?:试卷|考试).*?[·._-]?[一二三四五六七八九十百千万0-9]+卷$/.test(s)) { return true; }
      return /^(?:第\s*[一二三四五六七八九十百千万0-9]+\s*(?:卷|套|部分|单元)|试卷\s*[一二三四五六七八九十百千万0-9]+|卷\s*[一二三四五六七八九十百千万0-9]+)(?:\s+|[-—_:：·.．]\s*)[^。？！?!；;]{1,24}$/.test(raw);
    }
    function getVolumeLabel(line) {
      const raw = String(line || '').replace(/[\s\u3000]+/g, ' ').trim();
      const compact = raw.replace(/\s/g, '');
      const m = compact.match(/([一二三四五六七八九十百千万0-9]+)卷$/);
      if (m) { return '第' + m[1] + '卷'; }
      return raw;
    }
    function hasInlineAnswerTag(line) {
      const s = String(line || '');
      return /[【[（(]\s*(?:正确答案|参考答案|标准答案|答案|参考要点|答题要点)\s*[:：]/i.test(s)
    || /(?:^|\s)(?:正确答案|参考答案|标准答案|答案|参考要点|答题要点)\s*[:：]\s*\S+/i.test(s);
    }
    function hasEmbeddedAnswerStem(line, group = '') {
      const raw = String(line || '').trim();
      if (!raw || isOptionLine(raw) || isAnswerLine(raw) || isAnalysisLine(raw) || getHeadingType(raw) || isImportNoiseLine(raw)) { return false; }
      if (hasInlineAnswerTag(raw)) { return true; }
      const gt = mapType(group);
      const m = raw.match(/[（(]\s*([^()（）]{1,100})\s*[）)]/);
      if (!m) { return false; }
      const inner = m[1].trim();
      if (!inner) { return false; }
      const compact = inner.replace(/[\s,，、;；/\\]+/g, '').toUpperCase();
      const pureJudgeInner = /^(?:对|错|正确|错误|是|否|√|✓|✔|×|X|x|v|V|T|F|True|False)$/i.test(inner);
      const choiceInner = /^[A-G]{1,7}$/.test(compact) || /^[1-9]{1,9}$/.test(compact);
      if (gt === 'judge') { return pureJudgeInner; }
      if (gt === 'multiple') { return /^[A-G]{2,7}$/.test(compact) || /^[1-9]{2,9}$/.test(compact); }
      if (gt === 'single') { return /^[A-G]$/.test(compact) || /^[1-9]$/.test(compact); }
      // 没有分区上下文时，仅接受强题号题干中的明确括号答案，避免普通题干括号污染触发错误切题。
      if (!gt && hasStrongQuestionNo(raw)) { return pureJudgeInner || choiceInner; }
      return false;
    }
    function looksLikeNewQuestionLine(line, group = '') {
      if (isOptionLine(line) || isAnswerLine(line) || isAnalysisLine(line) || getHeadingType(line) || isImportNoiseLine(line)) { return false; }
      return !!getNumberedTypeQuestionHeader(line) || hasStrongQuestionNo(line) || !!detectType(line) || hasEmbeddedAnswerStem(line, group) || isQuestionStart(line);
    }
    function extractInlineAnswerTag(line, type) {
      let s = String(line || '');const answers = [];
      s = s.replace(/[【[]\s*(?:正确答案|参考答案|标准答案|答案)\s*[:：]?\s*([^】\]]{1,100})\s*[】\]]/gi, (m, a) => { answers.push(...splitAnswerByType(a, type));return ' '; });
      s = s.replace(/[（(]\s*(?:正确答案|参考答案|标准答案|答案)\s*[:：]?\s*([^）)]{1,100})\s*[）)]/gi, (m, a) => { answers.push(...splitAnswerByType(a, type));return ' '; });
      return { text: s.replace(/\s+/g, ' ').trim(), answer: answers };
    }
    function splitSemicolonOptionsFromLine(line, answer = []) {
      const raw = String(line || '').trim();
      if (!raw || !/[;；]/.test(raw)) { return null; }
      const parts = raw.split(/[;；]/).map((x) => x.trim()).filter(Boolean);
      if (parts.length < 2 || parts.length > 8) { return null; }
      // 显式标号选项里的分号属于选项内容，不能再按分号兜底拆选项。
      // 例如：A. 人民；经济 / B. 人民；生命，应保持为完整 A/B 选项。
      // 只有 A...；B...；C... 这类每段都带选项标号的紧凑写法，才允许继续拆。
      const startsWithExplicitOption = /^\s*(?:[oOxXuUyYvV√✔✓]\s*)?(?:[（(]\s*[A-Ga-g1-9]\s*[）)]|[A-Ga-g]\s*(?:[、.．:：，,]|\s+|(?=[\u4e00-\u9fa5])))/.test(raw);
      if (startsWithExplicitOption) {
        const labeledCount = parts.filter((part) => /^\s*(?:[oOxXuUyYvV√✔✓]\s*)?(?:[（(]\s*[A-Ga-g1-9]\s*[）)]|[A-Ga-g]\s*[、.．:：，,])/.test(part)).length;
        if (labeledCount < 2) { return null; }
      }
      const opts = [];
      for (let i = 0;i < parts.length;i++) {
        const part = parts[i];
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
      const compact = raw.replace(/[\s\u3000]+/g, '');
      if (/^(?:第[一二三四五六七八九十百千万0-9]+(?:章|节|单元|篇)|章节[一二三四五六七八九十百千万0-9]+)[^。？！?!；;]{0,36}$/.test(compact)) { return true; }
      const scoped = /^(?:模块[一二三四五六七八九十百千万0-9]+|专题[一二三四五六七八九十百千万0-9]+|[（(][一二三四五六七八九十百千万0-9]+[）)]|[一二三四五六七八九十]+[、.．:：])[^。？！?!；;]{0,32}$/.test(compact);
      if (!scoped) { return false; }
      const look = (nextLines || []).slice(0, 8).map((x) => String(x || '').trim()).filter(Boolean);
      return look.some((l) => hasStrongQuestionNo(l) || isAnswerAnalysisEntryLine(l) || /^\d{1,4}\s*[.、．:：]\s*$/.test(l));
    }
    function normalizeSectionLabelV58911(value) {
      return String(value || '').replace(/[\s\u3000]+/g, '').replace(/[【】[\]()（）:：、，,。．.；;_-]+/g, '').toLowerCase();
    }
    function sectionPartsForQuestionV58911(q) {
      const meta = getSourceMetaV58910(q) || {};
      return {
        volume: normalizeSectionLabelV58911(meta.volume || q?.volume || ''),
        chapter: normalizeSectionLabelV58911(meta.chapter || q?.chapter || ''),
        group: normalizeSectionLabelV58911(meta.group || q?.group || q?.category || ''),
        groupType: sectionKeyFromText(meta.group || q?.group || q?.category || ''),
      };
    }
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
    function splitQuestionBlocks(text, inheritedGroup = '') {
      const lines = text.split('\n').map((x) => x.trim()).filter(Boolean);
      const blocks = [];let cur = [];let group = inheritedGroup || '';let curGroup = group;let volume = '';let curVolume = '';let chapter = '';let curChapter = '';let collectingSubjectiveAnswerV58917 = false;let currentQuestionNumberV58917 = 0;
      const flush = () => { if (cur.length) { blocks.push({ group: curGroup || group, volume: curVolume || volume, chapter: curChapter || chapter, lines: [...cur] });cur = [];curGroup = group;curVolume = volume;curChapter = chapter; }collectingSubjectiveAnswerV58917 = false;currentQuestionNumberV58917 = 0; };
      const curHasContent = () => cur.length > 0;
      const curHasRealQuestion = () => cur.some((l) => !isOptionLine(l) && !isAnswerLine(l) && !isAnalysisLine(l) && !getHeadingType(l));
      const curHasAnsweredStem = () => cur.some((l) => hasInlineAnswerTag(l) || hasEmbeddedAnswerStem(l, curGroup || group));
      const curHasDocxTable = () => cur.some((l) => /^【DOCX表格开始】$/.test(String(l || '').trim())) && !cur.some((l) => isOptionLine(l) || isAnswerLine(l));
      for (let lineIndex = 0;lineIndex < lines.length;lineIndex++) {
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
        const hasDocxRichBlock = /\[\[DOCX_IMAGE_\d+\]\]|!\[[^\]]{0,120}\]\(data:image\/(?:png|jpeg|jpg|gif|webp|bmp);base64,|【DOCX表格开始】|【DOCX公式OMML：/.test(String(text || ''));
        const hasSubjectiveMultilineAnswerV58917 = blocks.some((block) => (block.lines || []).some(isStandaloneAnswerHeaderV58917) && blockHasSubjectiveContextV58917(block.lines || [], block.group || ''));
        // v58.9.4：DOCX 图片/表格/公式常会在同一道题内部形成空行。
        // 只有一道题时不能再按空行拆段，否则会把“题干 + 图片 + A/B/C/D选项”拆成两块，导致图片丢失、选项丢失并误判为填空题。
        if (hasDocxRichBlock || hasSubjectiveMultilineAnswerV58917) { return blocks; }
        return text.split(/\n\s*\n+/).map((x) => ({ group: '', volume: '', lines: x.split('\n').map((y) => y.trim()).filter(Boolean) })).filter((b) => b.lines.length);
      }
      return blocks;
    }
    function isImportNoiseLine(line) {
      const s = String(line || '').trim();
      if (!s) { return true; }
      if (/^共\s*\d+\s*题(?:\s*[|｜]\s*\d+\s*卷)?$/.test(s)) { return true; }
      return /^(基本信息|题目|答案表|参考答案|答案解析)$/.test(s) || /^基本信息[:：]?/.test(s)
    || /^202\d年.*(?:考试|试卷).*(?:卷|套)?$/.test(s)
    || /^(?:.*(?:考试试卷|知识考试试卷|综合知识考试试卷).*|[（(]?考试时间[:：]?.*满分.*|满分\d+分.*考试时间.*)$/.test(s)
    || /^\[?矩阵文本题\]?/.test(s)
    || /^\*+$/.test(s);
    }

    function mapInlineQuestionTypeLabelV592(label) {
      const s = String(label || '').replace(/\s/g, '');
      if (/^(?:简答题|簡答題|简答|問答題|问答题|名词解释|名詞解釋|论述题|論述題)$/.test(s)) { return 'short'; }
      if (/^(?:填空题|填空|填充题)$/.test(s)) { return 'blank'; }
      if (/^(?:判断题|判断|判斷題|是非题|是非題)$/.test(s)) { return 'judge'; }
      if (/^(?:多选题|多选|多项选择题|多選題|多選|复选题|複選題|复选|複選)$/.test(s)) { return 'multiple'; }
      if (/^(?:单选题|单项选择题|单选|單選題|單選)$/.test(s)) { return 'single'; }
      return '';
    }
    function getNumberedTypeQuestionLineV592(line) {
      const raw = String(line || '').trim();
      const labels = '单选题|单项选择题|单选|單選題|單選|多选题|多项选择题|多选|多選題|多選|复选题|複選題|复选|複選|判断题|判断|判斷題|是非题|是非題|填空题|填空|填充题|简答题|簡答題|简答|問答題|问答题|名词解释|名詞解釋|论述题|論述題';
      const re = new RegExp('^\\s*(?:第\\s*)?(\\d{1,4})\\s*(?:题)?[.、．:：]?\\s*(' + labels + ')\\s*[:：]\\s*(\\S[\\s\\S]*)$');
      const m = raw.match(re);
      if (!m) { return null; }
      const type = mapInlineQuestionTypeLabelV592(m[2]);
      const stem = String(m[3] || '').trim();
      if (!type || !stem) { return null; }
      if (/^(?:共\d+题|每题|满分|分，共|题，每题)/.test(stem.replace(/\s/g, ''))) { return null; }
      return { number: Number(m[1]), label: m[2], type, stem };
    }
    function stripLeadingQuestionTypeLabelV592(text) {
      return String(text || '').trim().replace(/^\s*(?:单选题|单项选择题|单选|單選題|單選|多选题|多项选择题|多选|多選題|多選|复选题|複選題|复选|複選|判断题|判断|判斷題|是非题|是非題|填空题|填空|填充题|简答题|簡答題|简答|問答題|问答题|名词解释|名詞解釋|论述题|論述題)\s*[:：]\s*/, '').trim();
    }
    function inferQuestionTypeFromPromptV592(text, group = '') {
      const gt = mapType(group);if (gt) { return gt; }
      const s = String(text || '');
      // v58.9.3：标准主线采用"显式题型 > 选项 > 填空格式 > 简答语义"。
      if (hasExplicitBlankPrompt(s)) { return 'blank'; }
      if (hasShortAnswerPrompt(s)) { return 'short'; }
      return '';
    }

    function getHeadingType(line) {
      const raw = String(line || '').trim();
      const s = raw.replace(/\s/g, '');
      if (!s) { return ''; }
      // 题号 + 题型 + 冒号 + 真实题干，是标准单题写法，不是题型分区。
      if (getNumberedTypeQuestionLineV592(raw)) { return ''; }
      // 只把“短标题/带章节序号/带题量分值说明”的行识别为题型分区。
      // 避免把题干里的“判断某段程序……”、选项里的“单选/多选”等误当成题型标题。
      const hasSectionPrefix = /^(?:第[一二三四五六七八九十0-9]+部分|[一二三四五六七八九十]+[、.．:：])/.test(s) || /^\d+[、.．:：](?:单选题|单项选择题|多选题|多项选择题|判断题|填空题|简答题)/.test(s);
      const hasCountInfo = /^(?:[一二三四五六七八九十]+[、.．:：])?(?:单选题|单项选择题|多选题|多项选择题|判断题|填空题|简答题).{0,40}(?:共\d+题|每题|满分|分，共|题，每题)/.test(s);
      const bracketOnly = /^[[【(（]?(?:单选题|单选|单项选择题|單選題|單選|多选题|多选|多项选择题|多選題|多選|复选题|複選題|复选|複選|判断题|判断|判斷題|是非题|是非題|填空题|填空|填充题|简答题|簡答題|简答|問答題|问答题|名词解释|名詞解釋|论述题|論述題)[\]】)）]?$/.test(s);
      const likelyHeading = bracketOnly || hasSectionPrefix || hasCountInfo;
      if (!likelyHeading) { return ''; }
      if (/[。？?！!；;]$/.test(raw) && !hasSectionPrefix && !hasCountInfo && !bracketOnly) { return ''; }
      if (/[A-G][:：]/.test(s)) { return ''; }
      if (/(?:逻辑判断|判断推理|图形推理|定义判断|类比推理|资料分析|材料分析|言语理解|语言理解|数学运算|数量关系|综合能力|常识判断)/.test(s)) { return raw; }
      if (/(?:填空题|填空|填充题)/.test(s)) { return '填空题'; }
      if (/(?:简答题|簡答題|简答|問答題|问答题|名词解释|名詞解釋|论述题|論述題)/.test(s)) { return '简答题'; }
      if (/(?:单选题|单项选择题|单选|單選題|單選)/.test(s)) { return '单选题'; }
      if (/(?:多选题|多项选择题|多选|复选题|複選題|复选|複選|多選題|多選)/.test(s)) { return '多选题'; }
      if (/(?:判断题|判断|判斷題|是非题|是非題)/.test(s)) { return '判断题'; }
      return '';
    }

    function getNumberedTypeQuestionHeader(line) {
      const raw = String(line || '').trim();
      const m = raw.match(/^(单选题|单选|单项选择题|多选题|多选|多项选择题|判断题|判断|填空题|填空|简答题|简答|问答题)\s*(?:第\s*)?(\d{1,4})\s*(?:题)?\s*$/);
      if (!m) { return null; }
      const label = m[1];
      let type = 'single';
      if (/多/.test(label)) { type = 'multiple'; } else if (/判断/.test(label)) { type = 'judge'; } else if (/填空/.test(label)) { type = 'blank'; } else if (/简答|问答/.test(label)) { type = 'short'; }
      return { label, number: m[2], type };
    }
    function hasStrongQuestionNo(line) { return !!getNumberedTypeQuestionHeader(line) || /^\s*(?:第\s*\d+\s*题|\d+\s*[、.．:：]|[（(]\s*\d+\s*[）)]|[【[]\s*\d+\s*[】\]])/.test(line); }
    function isQuestionStart(line) {
      if (isOptionLine(line) || isAnswerLine(line) || isAnalysisLine(line)) { return false; }
      if (getNumberedTypeQuestionHeader(line)) { return true; }
      if (hasInlineAnswerTag(line)) { return true; }
      return hasStrongQuestionNo(line) || !!detectType(line) || (/[（(]\s*[）)]/.test(line) && /[。？?]?\s*\*?$/.test(line)) || (/[。？?]\s*\*?$/.test(line) && line.length > 8) || (/\*\s*$/.test(line) && line.length > 8);
    }
    // v58.9.8.2：英文题干可能以冠词 A/a 或小写字母开头，例如“17. A vowel...”。
    // 这类裸字母 + 空格不是可靠的选项标号；真正的无标点英文选项只在已有题干上下文中识别。
    function isBareEnglishStemStartV5982(line) {
      const raw = String(line || '').trim().replace(/^(?:第\s*)?\d{1,4}\s*(?:题)?[.、．:：]?\s*/, '');
      return /^(?:A|[a-g])\s+[A-Za-z][A-Za-z'’-]*/.test(raw);
    }
    function isOptionLine(line) {
      if (isBareEnglishStemStartV5982(line)) { return false; }
      return /^\s*(?:[oOxXuUyYvV√✔✓]\s*)?(?:[（(]\s*[A-Ga-g1-9]\s*[）)]|[A-Ga-g]\s*(?:[、.．:：，,]|\s+|(?=[\u4e00-\u9fa5]))|0\s*[.．、:：]\s+(?=\S))(?![+＋])/.test(line);
    }
    function isStandaloneAnswerHeaderV58917(line) { return /^\s*(?:(?:【|\[)\s*(?:正确答案|参考答案|标准答案|答案|答|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|Answer|Correct\s*answer)\s*(?:】|\])|(?:正确答案|参考答案|标准答案|答案|答|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|Answer|Correct\s*answer)\s*[:：])\s*$/i.test(String(line || '')); }
    function isAnswerLine(line) { return isStandaloneAnswerHeaderV58917(line) || /^\s*(?:【|\[)?\s*(?:正确答案|参考答案|标准答案|答案|答|参考要点|参考思路|答题要点|答题思路|作答思路|评分要点|参考作答|Answer|Correct\s*answer)\s*(?:】|\])?\s*(?:[:：,，、.．;；]|\s+|[（(])\s*\S+/i.test(line); }
    function isAnalysisLine(line) { return /^(?:【|\[)?\s*(?:解析|答案解析|试题解析|说明|考点)\s*(?:】|\])?\s*[:：]?/i.test(line); }
    function blockHasSubjectiveContextV58917(lines, group = '') {
      if (mapType(group) === 'short') { return true; }
      const arr = Array.isArray(lines) ? lines : [];
      if (arr.some((line) => getNumberedTypeQuestionLineV592(line)?.type === 'short' || getNumberedTypeQuestionHeader(line)?.type === 'short')) { return true; }
      if (arr.some(isOptionLine)) { return false; }
      return inferQuestionTypeFromPromptV592(arr.join(' '), group) === 'short';
    }
    function questionNumberFromLineV58917(line) {
      const typed = getNumberedTypeQuestionLineV592(line);if (typed) { return Number(typed.number) || 0; }
      const header = getNumberedTypeQuestionHeader(line);if (header) { return Number(header.number) || 0; }
      const m = String(line || '').trim().match(/^第\s*(\d{1,4})\s*题/) || String(line || '').trim().match(/^(\d{1,4})\s*[、.．:：]/) || String(line || '').trim().match(/^[（(【[]\s*(\d{1,4})\s*[）)】\]]/);
      return m ? Number(m[1]) || 0 : 0;
    }
    function isDefiniteQuestionBoundaryAfterSubjectiveAnswerV58917(line, currentNumber = 0, nextLines = []) {
      const raw = String(line || '').trim();if (!raw) { return false; }
      if (getNumberedTypeQuestionLineV592(raw) || getNumberedTypeQuestionHeader(raw) || /^第\s*\d{1,4}\s*题/.test(raw)) { return true; }
      const numbered = raw.match(/^(\d{1,4})\s*([、.．:：])\s*(.+)$/);
      const bracketed = numbered ? null : raw.match(/^[（(【[]\s*(\d{1,4})\s*[）)】\]]\s*(.+)$/);
      if (!numbered && !bracketed) { return false; }
      const number = Number((numbered || bracketed)[1]) || 0; const separator = numbered ? numbered[2] : ''; const stem = String((numbered || bracketed)[numbered ? 3 : 2] || '').trim();
      if (currentNumber && number !== currentNumber + 1) { return false; }
      const promptLike = /[？?]\s*$/.test(stem) || hasShortAnswerPrompt(stem) || hasExplicitBlankPrompt(stem) || detectType(stem) !== '';
      if (!promptLike) { return false; }
      if (separator === '、' && !/[？?]\s*$/.test(stem) && !/^(?:请|试|请你|请简要)/.test(stem)) {
        let hasNearbyAnswerMarker = false;
        for (const next of (nextLines || [])) {
          if (isAnswerLine(next)) { hasNearbyAnswerMarker = true;break; }
          if (questionNumberFromLineV58917(next)) { break; }
        }
        if (!hasNearbyAnswerMarker) { return false; }
      }
      return true;
    }
    function detectType(text) {
      const s = String(text || '').trim();
      const compact = s.replace(/\s/g, '');
      // 单题题型只识别显式标记或非常短的独立题型词；不能把“判断某段程序……”误识别为判断题。
      if (/[[【(（]\s*(简答题|简答|问答题|问答|名词解释|论述题)\s*[\]】)）]/.test(s) || /^(?:简答题|简答|问答题|问答|名词解释|论述题)$/.test(compact)) { return 'short'; }
      if (/[[【(（]\s*(填空题|填空|填充题)\s*[\]】)）]/.test(s) || /^(?:填空题|填空|填充题)$/.test(compact)) { return 'blank'; }
      if (/[[【(（]\s*(多选题|多选|多项选择题)\s*[\]】)）]/.test(s) || /^(?:多选题|多选|多项选择题)$/.test(compact)) { return 'multiple'; }
      if (/[[【(（]\s*(判断题|判断)\s*[\]】)）]/.test(s) || /^(?:判断题|判断|是非题)$/.test(compact)) { return 'judge'; }
      if (/[[【(（]\s*(单选题|单选|单项选择题)\s*[\]】)）]/.test(s) || /^(?:单选题|单选|单项选择题)$/.test(compact)) { return 'single'; }
      return '';
    }

    function splitTrailingFirstOptionFromQuestion(line, nextLine) {
      const raw = String(line || '').trim();const next = String(nextLine || '').trim();
      if (!/^B\s*(?:[、.．:：，,]|\s+|(?=[\u4e00-\u9fa5]))/i.test(next)) { return null; }
      if (isOptionLine(raw) || isAnswerLine(raw) || isAnalysisLine(raw) || getHeadingType(raw)) { return null; }
      const patterns = [
        /^(.*?)(?:\s+|\u3000+)(A)\s*[、.．:：]?\s*([^A-G\n]{1,120})$/i,
        /^(.*?[。？！?）)])\s*(A)\s*[、.．:：]?\s*([^A-G\n]{1,120})$/i,
      ];
      for (const re of patterns) {
        const m = raw.match(re);if (!m) { continue; }
        const q = (m[1] || '').trim();const txt = (m[3] || '').trim();
        if (q.length < 8 || !txt || /(?:答案|解析)\s*[:：]/.test(txt)) { continue; }
        if (txt.length > 80) { continue; }
        if (!/[（(]\s*[）)]|[。？！?]$/.test(q) && q.length < 16) { continue; }
        return { question: q, key: 'A', text: txt };
      }
      return null;
    }

    function extractImplicitLeadingAOptions(line) {
      const s = String(line || '').trim();
      if (!s || /^[A-Ga-g]\s*[、.．:：，,]/.test(s)) { return null; }
      if (/^(?:答案|解析|正确答案|参考答案|标准答案)\s*[:：]/.test(s)) { return null; }
      const hits = [];let m;
      const re = /([B-Gb-g])\s*[、.．:：，,]\s*/g;
      while ((m = re.exec(s))) { hits.push({ idx: m.index, len: m[0].length, key: normalizeOptionKey(m[1]) }); }
      if (hits.length < 2 || hits[0].key !== 'B') { return null; }
      const keys = hits.map((h) => h.key).join('');
      if (!/^BC/.test(keys)) { return null; }
      const firstText = s.slice(0, hits[0].idx).trim();
      if (!firstText || firstText.length > 120) { return null; }
      const options = [{ key: 'A', text: firstText }];
      for (let i = 0;i < hits.length;i++) {
        const start = hits[i].idx + hits[i].len;
        const end = i + 1 < hits.length ? hits[i + 1].idx : s.length;
        const txt = s.slice(start, end).trim();
        if (txt) { options.push({ key: hits[i].key, text: txt }); }
      }
      return options.length >= 3 ? options : null;
    }

    function isProtectedOrMarkdownImageOnlyV588(text) {
      const raw = String(text || '').trim();
      if (!raw) { return false; }
      const withoutImages = raw
        .replace(/!\[[^\]]{0,120}\]\(data:image\/[^)]+\)/gi, '')
        .replace(/\[\[DOCX_IMAGE_\d+\]\]/g, '')
        .replace(/\[图片已移除\]/g, '')
        .replace(/【DOCX图片\d+[^】]*】/g, '')
        .trim();
      return !withoutImages && /!\[[^\]]{0,120}\]\(data:image\/|\[\[DOCX_IMAGE_\d+\]\]|\[图片已移除\]|【DOCX图片\d+/i.test(raw);
    }
    function stemLikelyNeedsFigureMaterialV588(text, group = '') {
      const s = (String(text || '') + ' ' + String(group || '')).replace(/\s+/g, '');
      return /(?:根据|依据|观察|由|结合|如|见).{0,16}(?:下图|下面的图|以下图|上图|图中|图示|散点图|统计图|折线图|柱状图|饼图|曲线图|示意图|图表)|(?:下图|下面的散点图|散点图|统计图|折线图|柱状图|饼图|曲线图|示意图)可以|根据下面的散点图/.test(s);
    }
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
    function shouldMovePendingImageToStemV588(pendingKey, line, qlines, options, group = '') {
      if (String(pendingKey || '').toUpperCase() !== 'A') { return false; }
      if ((options || []).length) { return false; }
      if (!isProtectedOrMarkdownImageOnlyV588(line)) { return false; }
      return stemLikelyNeedsFigureMaterialV588((qlines || []).join(' '), group);
    }

    function extractInlineImageTokensV589(text) {
      const raw = String(text || '');
      const re = /!\[[^\]]{0,120}\]\(data:image\/[^)]+\)|\[\[DOCX_IMAGE_\d+\]\]|【DOCX图片\d+[^】]*】/gi;
      const out = [];let m;
      while ((m = re.exec(raw))) { out.push(m[0]); }
      return out;
    }
    function stripInlineImageTokensV589(text) {
      return String(text || '')
        .replace(/!\[[^\]]{0,120}\]\(data:image\/[^)]+\)/gi, ' ')
        .replace(/\[\[DOCX_IMAGE_\d+\]\]/g, ' ')
        .replace(/【DOCX图片\d+[^】]*】/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    function splitAnswerAndTrailingImagesV589(text, type = '') {
      const raw = String(text || '').trim();
      const images = extractInlineImageTokensV589(raw);
      if (!images.length) { return { answer: [], images: [] }; }
      const answerPart = stripInlineImageTokensV589(raw).replace(/^[。．.、，,；;：:\s]+|[。．.、，,；;：:\s]+$/g, '').trim();
      const answer = splitAnswerByType(answerPart, type);
      if (!answer.length || !answer.every((a) => /^[A-G1-9]$/.test(String(a || '').trim()))) { return { answer: [], images: [] }; }
      return { answer, images };
    }
    function imageTokensToChoiceOptionsV589(images) {
      const clean = (images || []).map((x) => String(x || '').trim()).filter(Boolean);
      const max = Math.min(clean.length, 7);
      const out = [];
      for (let i = 0;i < max;i++) { out.push({ key: String.fromCharCode(65 + i), text: clean[i] }); }
      return out;
    }

    function hasSequentialOptionKeysV591(options, start = 'A', minCount = 2) {
      const opts = Array.isArray(options) ? options : [];
      if (opts.length < minCount) { return false; }
      const startCode = String(start || 'A').toUpperCase().charCodeAt(0);
      for (let i = 0;i < Math.min(opts.length, 7);i++) {
        const key = String((opts[i] && opts[i].key) || '').toUpperCase();
        if (key !== String.fromCharCode(startCode + i)) { return false; }
      }
      return true;
    }
    function arePlainShortChoiceOptionsV591(options) {
      const opts = Array.isArray(options) ? options : [];
      if (!opts.length) { return false; }
      return opts.every((o) => {
        const text = String((o && o.text) || '').trim();
        if (!text || text.length > 140) { return false; }
        if (hasQuestionImageContent(text)) { return false; }
        if (isAnswerLine(text) || isAnalysisLine(text) || looksLikeNewQuestionLine(text, '')) { return false; }
        return true;
      });
    }
    function isVisualImageChoiceContextV591(question, group = '') {
      const s = (String(question || '') + ' ' + String(group || '')).replace(/\s+/g, '');
      if (!s) { return false; }
      if (/(?:图形推理|图形判断|图形规律|图形题|图形|图案|九宫格|问号|空缺|缺失|补入|填入|纸盒|折叠|展开图|立体图|平面图|视觉|拼合|旋转|翻转).{0,24}(?:选出|选择|最合适|最恰当|正确|符合|应填|应该|问号|空缺|缺失)|(?:选出|选择|最合适|最恰当|正确|符合|应填|应该).{0,24}(?:图形|图案|问号|空缺|缺失|纸盒|折叠|展开图|九宫格|规律)/.test(s)) { return true; }
      if (/(?:图形推理|图形判断|图形规律|纸盒折叠|九宫格)/.test(s)) { return true; }
      return false;
    }
    function isChartMaterialContextV591(question, group = '') {
      const s = (String(question || '') + ' ' + String(group || '')).replace(/\s+/g, '');
      return /(?:散点图|统计图|折线图|柱状图|饼图|曲线图|回归|相关系数|变量|方差分析表|判定系数|置信区间|预测区间|最小二乘法|线性相关|线性回归)/.test(s);
    }
    function allowAnswerImageOptionFallbackV591(question, group, type, answer, images) {
      const imgCount = (images || []).filter(Boolean).length;
      if (imgCount < 2 || imgCount > 7) { return false; }
      const ans = (answer || []).map((a) => String(a || '').trim()).filter(Boolean);
      if (!ans.length || !ans.every((a) => /^[A-G1-9]$/.test(a))) { return false; }
      if (type && !['single', 'multiple'].includes(String(type))) { return false; }
      if (isChartMaterialContextV591(question, group) && !isVisualImageChoiceContextV591(question, group)) { return false; }
      return isVisualImageChoiceContextV591(question, group);
    }
    function repairStemTrailingAOptionTextV589(question, options, group = '') {
      const questionText = String(question || '').trim();
      let opts = Array.isArray(options) ? options.map((o) => ({ ...o, text: String((o && o.text) || '') })) : [];
      if (!questionText || opts.some((o) => String((o && o.key) || '').toUpperCase() === 'A')) { return { question: questionText, options: opts }; }
      if (!opts.length || String((opts[0] && opts[0].key) || '').toUpperCase() !== 'B') { return { question: questionText, options: opts }; }
      if (!hasSequentialOptionKeysV591(opts, 'B', 2) || !arePlainShortChoiceOptionsV591(opts)) { return { question: questionText, options: opts }; }
      if (!stemLikelyNeedsFigureMaterialV588(questionText, group) || !hasQuestionImageContent(questionText)) { return { question: questionText, options: opts }; }
      const re = /!\[[^\]]{0,120}\]\(data:image\/[^)]+\)|\[\[DOCX_IMAGE_\d+\]\]|【DOCX图片\d+[^】]*】/gi;
      let last = null; let m;
      while ((m = re.exec(questionText))) { last = { idx: m.index, end: re.lastIndex, text: m[0] }; }
      if (!last) { return { question: questionText, options: opts }; }
      const tail = questionText.slice(last.end).trim().replace(/^[-—–；;，,。．.、\s]+/, '').trim();
      const before = questionText.slice(0, last.end).trim();
      if (!tail || tail.length > 80) { return { question: questionText, options: opts }; }
      if (hasQuestionImageContent(tail) || isAnswerLine(tail) || isAnalysisLine(tail) || isOptionLine(tail) || looksLikeNewQuestionLine(tail, group)) { return { question: questionText, options: opts }; }
      if (/[。？！?；;]/.test(tail) && tail.length > 24) { return { question: questionText, options: opts }; }
      opts = [{ key: 'A', text: tail }, ...opts];
      return { question: before, options: opts };
    }
    function isDefaultImageChoiceSetV589(q) {
      const opts = Array.isArray(q && q.options) ? q.options : [];
      if (opts.length < 2) { return false; }
      const self = opts.every((o) => String((o && o.text) || '').trim().toUpperCase() === String((o && o.key) || '').trim().toUpperCase());
      if (!self) { return false; }
      const context = [q && q.question, q && q.analysis, q && q.group, q && q.category].map((x) => String(x || '')).join(' ');
      return hasQuestionImageContent(context) || /(?:图形|图表|纸盒|折叠|问号|资料分析|材料分析|根据下图|下图)/.test(context);
    }
    function repairCircledCombinationQuestion(q) {
      if (!q || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 7 || !/[（(]\s*[）)]/.test(q.question || '')) { return q; }
      // 旧解析器曾将无标号陈述与同键组合选项拼接；仅在完整顺序和引用均能核实时恢复显示，兼容旧题库期间保留。
      const parts = [];
      for (const [index, option] of q.options.entries()) {
        const match = String(option.text || '').trim().match(/^([①-⑳])([^①-⑳]+?)\s+([①-⑳]{2,})$/);
        const expectedStatement = String.fromCharCode('①'.charCodeAt(0) + index);
        if (option.key !== String.fromCharCode(65 + index) || !match || match[1] !== expectedStatement || !/[\u4e00-\u9fffA-Za-z]/.test(match[2])) { return q; }
        parts.push({ statement: match[1] + match[2].trim(), combination: match[3] });
      }
      const markers = new Set(parts.map((part) => part.statement[0]));
      if (parts.some((part) => [...part.combination].some((marker) => !markers.has(marker)))) { return q; }
      if (/[①-⑳]/.test(q.question)) { return q; }
      return { ...q, question: [q.question, ...parts.map((part) => part.statement)].join('\n'), options: q.options.map((option, index) => ({ ...option, text: parts[index].combination })) };
    }
    function displayOptionTextV589(q, inputO) {
      let o = inputO;
      const repaired = repairCircledCombinationQuestion(q);
      if (repaired !== q) { o = repaired.options.find((option) => option.key === o.key) || o; }
      const text = String((o && o.text) || '').trim();
      const key = String((o && o.key) || '').trim();
      if (text && key && text.toUpperCase() === key.toUpperCase() && isDefaultImageChoiceSetV589(q)) { return ''; }
      return text;
    }

    function parseBlock(block, idx) {
      const lines = (Array.isArray(block) ? block : block.lines || String(block).split('\n')).map((x) => String(x).trim()).filter(Boolean);
      const group = block.group || '';const groupTypeV592 = mapType(group) || '';let type = groupTypeV592;let explicitTypeV592 = false;let answer = [];let analysis = '';let options = [];const qlines = [];let collectingAnalysis = false;let unkeyedMode = false;let pendingOptionKey = '';let seenQuestion = false;let number = idx + 1;const answerImageOptionsV589 = [];let collectingAnswerImageOptionsV589 = false;let collectingSubjectiveAnswerV58917 = false;const subjectiveAnswerLinesV58917 = [];
      const full = lines.join('\n');const inlineType = detectType(full);if (inlineType) { type = inlineType; }
      for (let li = 0;li < lines.length;li++) {
        let line = lines[li].trim();
        const numberedTypedLineV592 = getNumberedTypeQuestionLineV592(line);
        if (numberedTypedLineV592) { type = numberedTypedLineV592.type;explicitTypeV592 = true;number = numberedTypedLineV592.number;line = `${numberedTypedLineV592.number}. ${numberedTypedLineV592.stem}`; }
        const numberedTypeHeader = getNumberedTypeQuestionHeader(line);
        if (numberedTypeHeader) { type = numberedTypeHeader.type;explicitTypeV592 = true;number = numberedTypeHeader.number;collectingAnalysis = false;continue; }
        const t = detectType(line);if (t) { type = t;explicitTypeV592 = true; }
        const contextualTypeV592 = type || inferQuestionTypeFromPromptV592([qlines.join(' '), line].filter(Boolean).join(' '), group);
        const shouldAdoptContextualType = () => !type && contextualTypeV592;
        if (collectingSubjectiveAnswerV58917) {
          if (isAnalysisLine(line)) { collectingSubjectiveAnswerV58917 = false; } else { subjectiveAnswerLinesV58917.push(line);continue; }
        }
        if (isStandaloneAnswerHeaderV58917(line) && (type === 'short' || contextualTypeV592 === 'short' || groupTypeV592 === 'short')) {
          type = 'short';collectingSubjectiveAnswerV58917 = true;collectingAnalysis = false;continue;
        }
        const inlineAnswerTag = extractInlineAnswerTag(line, contextualTypeV592);
        if (inlineAnswerTag.answer.length) { if (shouldAdoptContextualType()) { type = contextualTypeV592; }answer.push(...inlineAnswerTag.answer);line = inlineAnswerTag.text; }
        const lineAnswerExtract = extractTrailingAnswerFromText(line, contextualTypeV592);
        if (lineAnswerExtract.answer.length && !isAnswerLine(line)) {
          if (shouldAdoptContextualType()) { type = contextualTypeV592; }
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
          const after = line.replace(/^答案解析\s*/, '');
          const pbCA = after.match(/^(\d{1,4})\s*[.、．]\s*(?:【答案】\s*)?([A-Ga-g]{1,7})\s*(?:【解析】\s*(.*))?$/);
          if (pbCA) { number = pbCA[1];answer = splitAnswerByType(pbCA[2], type);if (pbCA[3]) { analysis = pbCA[3].trim();collectingAnalysis = true; }seenQuestion = true; }
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
        const englishArticleStemV5982 = !!(pre && /^[Aa]$/.test(pre[2] || '') && /^[A-Za-z][A-Za-z'’-]*/.test(String(pre[3] || '').trim()));
        if (pre && !englishArticleStemV5982 && (!seenQuestion || !options.length) && !isOptionLine(line)) {
          const maybeCode = /^[A-Ga-g]{2,7}$/.test(pre[2] || '') && /^\s*\d/.test(pre[3] || '');
          if (!maybeCode && !/【解析】/.test(pre[3] || '')) {
            number = pre[1]; answer.push(...splitAnswerByType(pre[2], type));
            if (pre[3]) { qlines.push(pre[3].trim());seenQuestion = true; }
            continue;
          }
        }
        // 支持答案在题号下一行分裂显示：2. / ABC / DE / 题干
        const onlyNo = line.match(/^\s*(?:第\s*)?(\d+)\s*(?:题)?[.、．:：]?\s*$/);
        if (onlyNo && !seenQuestion && !options.length) { number = onlyNo[1];continue; }
        if (!seenQuestion && !options.length && /^[A-Ga-g]{1,7}$/.test(line)) {
          answer.push(...splitAnswer(line));
          continue;
        }

        const am = line.match(/^(?:【|\[)?\s*(?:正确答案|参考答案|标准答案|答案解析|答案|参考要点|答题要点|Answer|Correct\s*answer)\s*(?:】|\])?\s*[:：]?\s*(.+)$/i);
        if (am) {
          const amText = am[1].trim();
          const answerTypeV592 = type || inferQuestionTypeFromPromptV592(qlines.join(' '), group) || '';
          const amImageOptionsV589 = splitAnswerAndTrailingImagesV589(amText, answerTypeV592);
          const amCombined = amText.match(/^(\d{1,4})\s*[.、．]\s*(?:【答案】\s*)?([A-Ga-g]{1,7})\s*【解析】\s*(.*)$/);
          if (amImageOptionsV589.answer.length && amImageOptionsV589.images.length && !options.length) {
            answer = amImageOptionsV589.answer;
            answerImageOptionsV589.push(...amImageOptionsV589.images);
            collectingAnswerImageOptionsV589 = true;
            collectingAnalysis = false;
          } else if (amCombined) { number = amCombined[1];answer = splitAnswerByType(amCombined[2], answerTypeV592);analysis = (amCombined[3] || '').trim();collectingAnalysis = true; } else { answer = splitAnswerByType(amText, answerTypeV592);if (!type && answerTypeV592) { type = answerTypeV592; }collectingAnalysis = false; }
          continue;
        }
        const xm = line.match(/^(?:【|\[)?\s*(?:解析|答案解析|试题解析|说明|考点)\s*(?:】|\])?\s*[:：]?\s*(.*)$/i);
        if (xm) { analysis = xm[1] || '';collectingAnalysis = true;continue; }

        // 兼容题干被 Word 断成两行：上一行“……使用”，下一行“(D）来选取文本。”，再下一行才是 A/B/C/D 选项。
        const leadingAnswerContinuation = line.match(/^\s*[（(]\s*([A-Ga-g]{1,7}|[1-9]{1,7}|对|错|正确|错误|√|✓|✔|×|X|x|T|F)\s*[）)〕]\s*(.+)$/);
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
          implicitAOptions.forEach((o) => { if (o.text) { options.push(o); } });
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
      && /^[①-⑳]/.test(line) && /[^①-⑳\s、，,；;。．.]/.test(line)
      && lines.slice(li + 1).some((next) => /^\s*(?:A\s*[、.．:：]|[（(]\s*A\s*[）)])/.test(next));
        if (isCircledStemStatement) {
          qlines.push(line);seenQuestion = true;
          continue;
        }
        const semiOptions = splitSemicolonOptionsFromLine(line, answer);
        if (semiOptions && semiOptions.length >= 2 && (seenQuestion || qlines.length)) {
          collectingAnalysis = false;unkeyedMode = false;
          semiOptions.forEach((o) => { if (o.text) { options.push(o); } });
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
        const om = bareEnglishStemWithoutQuestionV5982 ? null : line.match(/^\s*([oOxXuUyYvV√✔✓])?\s*(?:[（(]\s*([A-Ga-g1-90])\s*[）)]|([A-Ga-g0])\s*(?:[、.．:：，,]|\s+|(?=[\u4e00-\u9fa5])))\s*(.*)$/);
        if (om) {
          collectingAnalysis = false;unkeyedMode = false;
          const key = normalizeOptionKey(om[2] || om[3]);let txt = (om[4] || '').trim();
          if (om[1] || hasCorrectMark(txt)) { answer.push(key);txt = removeCorrectMark(txt); }
          const inlineAns = txt.match(/(?:^|[（(【[])(?:答案|正确答案)\s*[:：]?\s*([A-Ga-g1-9对错正确错误√×XxTtFf,，、;；/\s]+)[）)】\]]?$/);
          if (inlineAns) { answer.push(...splitAnswer(inlineAns[1]));txt = txt.replace(inlineAns[0], '').trim(); }
          if (txt) { options.push({ key, text: txt }); }
          continue;
        }
        if (collectingAnalysis) { analysis += (analysis ? '\n' : '') + line;continue; }
        const questionSeed = qlines.join(' ');
        const nextLine = lines[li + 1] || '';
        const nextLooksLikeLaterOption = /^\s*[B-Gb-g]\s*[、.．:：]/.test(nextLine);
        const shouldBeUnkeyedOption = qlines.length && !looksLikeNewQuestionLine(line, group) && !isAnswerLine(line) && !isAnalysisLine(line) && (unkeyedMode || hasCorrectMark(line) || detectType(full) || /[（(]\s*[）)]/.test(questionSeed) || nextLooksLikeLaterOption || /^(对|错|正确|错误)$/.test(line));
        if (shouldBeUnkeyedOption) {
          const key = String.fromCharCode(65 + options.length);let txt = line.trim();unkeyedMode = true;
          if (hasCorrectMark(txt)) { answer.push(key);txt = removeCorrectMark(txt); }
          if (txt) { options.push({ key, text: txt }); }
          continue;
        }
        if (options.length && !unkeyedMode && !looksLikeNewQuestionLine(line, group) && !isAnswerLine(line) && !isAnalysisLine(line)) {
          options[options.length - 1].text = (options[options.length - 1].text + ' ' + line).trim();
        } else if (!getHeadingType(line)) {
          qlines.push(line);seenQuestion = true;
        }
      }
      const qNo = (qlines[0] || '').match(/^\s*(?:[【[]\s*(\d+)\s*[】\]]|(?:第\s*)?(\d+)\s*(?:题)?[.、．:：])/);
      if (qNo) { number = qNo[1] || qNo[2]; }
      let question = stripLeadingQuestionTypeLabelV592(qlines.join(' ')
        .replace(/^\s*(?:[【[]\s*\d+\s*[】\]]|第\s*\d+\s*题|\d+\s*[.、．:：])\s*/, '')
        .replace(/^\s*[（(]\s*\d+\s*[）)]\s*/, '')
        .replace(/[[【(（]\s*(单选题|单选|单项选择题|單選題|單選|多选题|多选|多项选择题|多選題|多選|复选题|複選題|判断题|判断|判斷題|是非题|是非題|填空题|填空|填充题|简答题|简答|問答題|问答题|名词解释|名詞解釋|论述题|論述題)\s*[\]】)）]/g, '')
        .replace(/\s*\*+\s*$/, '')
        .trim());
      if (!options.length && allowAnswerImageOptionFallbackV591(question, group, type, answer, answerImageOptionsV589)) {
        options = imageTokensToChoiceOptionsV589(answerImageOptionsV589);
      }
      options = mergeDuplicateOptions(repairEmbeddedOptions(options)).filter((o) => o.text && !/^\s*$/.test(o.text));
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

    function normalizeOptionKey(inputK) {
      let k = inputK;
      k = String(k || '').trim();
      if (k === '0') { return 'D'; }
      if (/^[a-g]$/.test(k)) { return k.toUpperCase(); }
      if (/^[A-G]$/.test(k)) { return k; }
      return k;
    }
    function splitInlineOptions(line) {
      const rawLine = String(line || '');
      if (/^\s*(?:[oOxXuUyYvV√✔✓]\s*)?[A-Ga-g]\s*[、.．:：，,]/.test(rawLine)) { return []; }
      const s = maskLatexForOptionDetectionV58920(rawLine);
      const re = /([oOxXuUyYvV√✔✓])?\s*[（(]\s*([A-Ga-g1-9])\s*[）)]/g;
      const hits = [];let m;
      while ((m = re.exec(s))) { hits.push({ idx: m.index, len: m[0].length, correct: !!m[1], key: m[2] }); }
      for (let i = hits.length - 1;i >= 0;i--) {
        const h = hits[i];
        const key = String(h.key || '');
        if (/^\d$/.test(key)) {
          const before = rawLine.slice(Math.max(0, h.idx - 3), h.idx);
          const after = rawLine.slice(h.idx + h.len, h.idx + h.len + 3);
          if (/第\s*$/.test(before) || /^\s*(?:步|式|项|問|问|题|處|处|次)/.test(after)) { hits.splice(i, 1); }
        }
      }
      if (hits.length < 1) { return []; }
      if (hits.length === 1 && hits[0].idx > 3) { return []; }
      return hits.map((h, i) => {
        const start = h.idx + h.len;const end = i + 1 < hits.length ? hits[i + 1].idx : rawLine.length;
        return { key: h.key, correct: h.correct, text: rawLine.slice(start, end).trim().replace(/[;；，,]+$/, '').trim() };
      }).filter((o) => o.text || o.correct);
    }
    function repairEmbeddedOptions(options) {
      const out = [];
      const keyCode = (k) => String(k || 'A').toUpperCase().charCodeAt(0);
      for (const opt of (options || [])) {
        const txt = String(opt.text || '');
        if (/data:image\//i.test(txt) || /!\[[^\]]*\]\(data:image\//i.test(txt) || /\[\[DOCX_IMAGE_\d+\]\]/.test(txt)) {
          out.push(opt);
          continue;
        }
        const hits = [];
        const base = keyCode(opt.key);
        for (let i = 1;i < txt.length;i++) {
          const ch = txt[i];
          if (!/^[A-G]$/.test(ch)) { continue; }
          const key = normalizeOptionKey(ch);
          if (keyCode(key) <= base) { continue; }
          const prev = txt[i - 1] || '';
          const next = txt[i + 1] || '';
          const explicitAfter = /[、.．:：，,；;\s]/.test(next);
          const noSeparatorAfter = /[\u4e00-\u9fa5]/.test(next);
          if (!explicitAfter && !noSeparatorAfter) { continue; }
          // v58.9.7：标准英文选项内容中大量出现 a/b/c/d/e/f/g，不能拆成新选项。
          // v58.9.23：无标点的 B/C/D 只有位于空白或标点边界时才是嵌入选项；
          // “A和B均”“A相/B相/C相”等普通题干、选项正文不能被二次拆分。
          if (followsAlphanumeric(prev)) { continue; }
          if (noSeparatorAfter && prev && !/[\s；;，,、。！？?!]/.test(prev)) { continue; }
          let len = 1;
          while (i + len < txt.length && /[、.．:：，,；;\s]/.test(txt[i + len])) { len++; }
          hits.push({ idx: i, len, key });
        }
        if (!hits.length) { out.push(opt);continue; }
        out.push({ ...opt, text: txt.slice(0, hits[0].idx).trim() });
        for (let i = 0;i < hits.length;i++) {
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
      for (const o of options) { if (!map.has(o.key)) { map.set(o.key, { key: o.key, text: o.text }); } else { map.get(o.key).text = (map.get(o.key).text + ' ' + o.text).trim(); } }
      return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
    }
    function mapType(inputS) {
      let s = inputS;
      s = String(s || '');
      // “逻辑判断/判断推理”是行测题型分区，仍然通常是单选题，不能按 true/false 判断题处理。
      if (/逻辑判断|判断推理|图形推理|定义判断|类比推理|资料分析|材料分析|言语理解|语言理解|数学运算|数量关系/i.test(s)) { return 'single'; }
      if (/简答|簡答|问答|問答|主观|主觀|名词解释|名詞解釋|论述|論述|short|essay/i.test(s)) { return 'short'; }
      if (/填空|填充|blank|fill/i.test(s)) { return 'blank'; }
      if (/多选|多選|多项|多項|复选|複選|multiple|multi/i.test(s)) { return 'multiple'; }
      if (/判断题|判斷題|判断正误|判斷正誤|正误判断|是非题|judge|truefalse/i.test(s)) { return 'judge'; }
      if (/单选|單選|单项|單項|single/i.test(s)) { return 'single'; }
      return '';
    }
    function compactChoiceAnswerTokenV373(value) {
      return String(value || '').replace(/[\s\u3000,，、;；/|]+/g, '').toUpperCase();
    }
    function expandLetterAnswerRangeV373(value) {
      const s = String(value || '').trim();
      const m = s.match(/^\s*([A-Ga-g])\s*(?:-|－|–|—|~|～|至|到)\s*([A-Ga-g])\s*$/);
      if (!m) { return null; }
      const start = m[1].toUpperCase().charCodeAt(0);
      const end = m[2].toUpperCase().charCodeAt(0);
      if (start > end) { return null; }
      const out = [];
      for (let c = start;c <= end;c++) { out.push(String.fromCharCode(c)); }
      return out;
    }
    function isFullChoiceAnswerTokenV373(value) {
      const s = String(value || '').trim().replace(/[\s\u3000,，、;；.。]+/g, '');
      return /^(?:全选|全部|全部选项|所有选项|以上全选|以上都选|全都选|都选)$/.test(s);
    }
    function shouldUpgradeSingleToMultipleV372(type, options, answer) {
      if (type !== 'single') { return false; }
      const opts = (options || []).filter((o) => o && String(o.key || '').trim());
      if (opts.length < 2) { return false; }
      const validKeys = new Set(opts.map((o) => normalizeOptionKey(o.key)).filter((k) => /^[A-G]$/.test(k)));
      if (validKeys.size < 2) { return false; }
      const keys = (answer || []).flatMap((a) => splitAnswer(a)).map((a) => String(a || '').trim().toUpperCase()).filter((a) => validKeys.has(a));
      return new Set(keys).size > 1;
    }
    function guessType(question, options, answer, group = '') {
      const gt = mapType(group);if (gt) { return gt; }
      const optionCount = (options || []).length;
      const hasChoiceOptions = optionCount >= 3 || (options || []).some((o) => /^[C-G]$/.test(String(o.key || '').toUpperCase()));
      const ans = (answer || []).map((a) => String(a || '').trim()).filter(Boolean);
      // 只要已经识别到选项，优先作为客观选择题处理。
      // “填入横线/补全语句”在行测、公考题库里通常仍是单选题，不能因为题干有空格就改成填空题。
      if (optionCount) {
        if (!hasChoiceOptions && isJudgeBlock(options, ans)) { return 'judge'; }
        if (ans.length > 1 && ans.every((a) => /^[A-G1-9]$/.test(String(a)))) { return 'multiple'; }
        if (/多选|多项选择/.test(question)) { return 'multiple'; }
        return 'single';
      }
      // v58.9.3：无选项题先看填空符号，再看简答语义，避免"主要作用是（）"被误判成简答。
      if (hasExplicitBlankPrompt(question)) { return 'blank'; }
      if (hasShortAnswerPrompt(question)) { return 'short'; }
      if (!optionCount && ans.length) {
        if (ans.some((a) => isJudgeSymbolAnswer(a))) { return 'judge'; }
        if (ans.every((a) => /^[A-Ga-g]$/.test(a))) { return ans.length > 1 ? 'multiple' : 'single'; }
        // 无选项题不再只凭“答案短/数字短”推成填空，避免简答题被误判。
        return 'short';
      }
      return 'single';
    }
    function hasCorrectMark(s) {
      const text = String(s || '');
      return /(?:正确答案|答案正确|参考答案|标准答案|✔|✓)/.test(text) || /(?:^|[\s（(【[])√(?=\s|$|[）)】\]])/.test(text);
    }
    function hasCorrectOptionMark(option, text) {
      return option.correct || hasCorrectMark(text);
    }
    function followsAlphanumeric(previous) {
      return previous && /[A-Za-z0-9]/.test(previous);
    }
    function removeCorrectMark(s) {
      return String(s || '')
        .replace(/[（(【[]\s*(?:正确答案|答案正确|参考答案|标准答案)\s*[）)】\]]/g, '')
        .replace(/(?:正确答案|答案正确|参考答案|标准答案)/g, '')
        .replace(/[✔✓]/g, '')
        .replace(/(^|[\s（(【[])√(?=\s|$|[）)】\]])/g, '$1')
        .replace(/\s+/g, ' ').trim();
    }
    function splitAnswer(inputS) {
      let s = inputS;
      if (Array.isArray(s)) { return s.flatMap((x) => splitAnswer(x)); }
      s = String(s ?? '').trim();
      s = s.replace(/\s*(?:解析|答案解析|说明|解题思路)\s*[:：][\s\S]*$/, '').trim();
      s = stripAnswerPrefix(s);
      s = s.replace(/^[（(]\s*([\s\S]{1,80})\s*[）)]$/, '$1').trim();
      s = s.replace(/^[【[]\s*([\s\S]{1,80})\s*[】\]]$/, '$1').trim();
      s = s.replace(/[。．.、，,；;：:\s]+$/, '').trim();
      if (!s) { return []; }
      const letterRangeV373 = expandLetterAnswerRangeV373(s);if (letterRangeV373) { return letterRangeV373; }
      if (isFullChoiceAnswerTokenV373(s)) { return ['__ALL_OPTIONS__']; }
      const numeric = s.match(/^[（(]?\s*([1-9])\s*[）)]?$/);if (numeric) { return [numeric[1]]; }
      const numericCompact = s.replace(/[\s,，、;；/\\()（）]+/g, '');
      if (/^[1-9]{2,9}$/.test(numericCompact)) { return numericCompact.split(''); }
      const letterCompact = s.replace(/[\s,，、;；/\\()（）]+/g, '').toUpperCase();
      if (/^[A-G]{1,7}$/.test(letterCompact)) { return letterCompact.split(''); }
      const separatedLetters = s.match(/[A-Ga-g]/g);
      if (separatedLetters && separatedLetters.length >= 2 && s.replace(/[A-Ga-g\s,，、;；/\\()（）]+/g, '').trim() === '') { return separatedLetters.map((x) => x.toUpperCase()); }
      const leadOpt = s.match(/^([A-Ga-g])\s*[、.．:：]\s*.+$/);if (leadOpt) { return [leadOpt[1].toUpperCase()]; }
      if (/^(?:对|正确|是|√|✓|✔|v|V|T|True)$/i.test(s)) { return ['正确']; }
      if (/^(?:错|错误|否|×|X|x|F|False)$/i.test(s)) { return ['错误']; }
      if (looksLikeTextualAnswer(s)) { return []; }
      const parts = s.split(/[\s,，、;；/\\]+/).map((x) => x.trim()).filter(Boolean);
      if (parts.length > 1) {
        const parsed = parts.flatMap((x) => splitAnswer(x));
        return parsed.length && parsed.length === parts.length ? parsed : [];
      }
      return [];
    }
    function normalizeAnswer(answer, options, type) {
      const out = [];
      for (const raw of (answer || [])) {
        const token = String(raw ?? '').trim();if (!token) { continue; }
        const key = mapAnswerToken(token, options, type);
        if (Array.isArray(key)) { out.push(...key); } else if (key) { out.push(key); }
      }
      return [...new Set(out.map((x) => String(x).trim().toUpperCase()).filter(Boolean))];
    }
    function mapAnswerToken(token, options, type) {
      const t = String(token).trim();
      if (type === 'judge') { return judgeToKey(t, options); }
      const rangeV373 = expandLetterAnswerRangeV373(t);if (rangeV373) { return rangeV373; }
      if (t === '__ALL_OPTIONS__' || isFullChoiceAnswerTokenV373(t)) {
        const keys = (options || []).map((o) => normalizeOptionKey(o.key)).filter((k) => /^[A-G1-9]$/.test(k));
        return keys.length >= 2 ? keys : [];
      }
      if (/^[A-Ga-g]$/.test(t)) { return t.toUpperCase(); }
      if (/^[A-Ga-g]{2,7}$/.test(t)) { return t.toUpperCase().split(''); }
      if (/^[1-9]$/.test(t)) { return t; }
      if (/^[1-9]{2,9}$/.test(t)) { return t.split(''); }
      // 非判断题不把 √/×/v/x 当成 A/B，避免题型误判时静默错配。
      if (isJudgeSymbolAnswer(t)) { return ''; }
      const hit = options.find((o) => normalizeText(o.text) === normalizeText(t) || (normalizeText(o.text).includes(normalizeText(t)) && normalizeText(t).length >= 2));
      return hit ? hit.key : t;
    }
    function isJudgeSymbolAnswer(a) { return /^(?:对|错|正确|错误|是|否|√|✓|✔|×|X|x|v|V|T|F|True|False)$/i.test(String(a ?? '').trim()); }
    function isRawJudgeSymbolAnswer(a) { return isJudgeSymbolAnswer(String(a ?? '').replace(/^(?:答案|正确答案|参考答案|标准答案)\s*[:：]?\s*/, '').trim()); }
    function isJudgeCorrectToken(t) { return /^(?:对|正确|是|√|✓|✔|v|V|T|True)$/i.test(String(t ?? '').trim()); }
    function isJudgeWrongToken(t) { return /^(?:\u9519|\u9519\u8bef|\u5426|\u00D7|X|x|F|False)$/i.test(String(t ?? '').trim()); }
    function isExactJudgeOptionText(s) { return /^(?:\u5bf9|\u9519|\u6b63\u786e|\u9519\u8bef|\u662f|\u5426|\u221A|\u2713|\u2714|\u00D7|x|true|false)$/i.test(String(s || '').trim()); }
    function isJudgeOptionPair(options) {
      const opts = (options || []).filter((o) => o && String(o.text || '').trim());
      if (opts.length !== 2) { return false; }
      const a = String(opts[0].text || '').trim();
      const b = String(opts[1].text || '').trim();
      const aRight = isJudgeCorrectToken(a); const aWrong = isJudgeWrongToken(a);
      const bRight = isJudgeCorrectToken(b); const bWrong = isJudgeWrongToken(b);
      return isExactJudgeOptionText(a) && isExactJudgeOptionText(b) && ((aRight && bWrong) || (aWrong && bRight));
    }
    function isJudgeBlock(options, answer) {
      const opts = options || [];
      const explicitJudge = (answer || []).some((a) => isJudgeSymbolAnswer(a));
      if (!opts.length) { return explicitJudge; }
      if (opts.length >= 3 || opts.some((o) => /^[C-G]$/.test(String(o.key || '').toUpperCase()))) { return false; }
      return explicitJudge && isJudgeOptionPair(opts);
    }
    function normalizeJudgeOptions(inputOptions) {
      let options = inputOptions;
      options = (options || []).filter((o) => o && o.text).map((o) => ({ key: normalizeOptionKey(o.key), text: String(o.text || '').trim() }));
      if (!options.length) { return [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }]; }
      if (options.length === 1) {
        const t = normalizeText(options[0].text);
        if (/^(对|正确|是|√|v|true)$/.test(t)) { return [options[0], { key: 'B', text: '错误' }]; }
        if (/^(错|错误|否|×|x|false)$/.test(t)) { return [{ key: 'A', text: '正确' }, options[0]]; }
      }
      return options;
    }
    function judgeOptionMap(inputOptions) {
      let options = inputOptions;
      options = normalizeJudgeOptions(options);
      const exactCorrect = options.find((o) => /^(对|正确|是|√|✓|✔|true)$/i.test(String(o.text || '').trim()));
      const exactWrong = options.find((o) => /^(错|错误|否|×|x|false)$/i.test(String(o.text || '').trim()));
      const looseCorrect = options.find((o) => /(^|[^不非])(?:对|正确|是|√|✓|✔|true)/i.test(String(o.text || '')));
      const looseWrong = options.find((o) => /(错|错误|否|×|x|false)/i.test(String(o.text || '')));
      return {
        correctKey: (exactCorrect || looseCorrect || options[0] || { key: 'A' }).key,
        wrongKey: (exactWrong || looseWrong || options[1] || { key: 'B' }).key,
        confidence: !!((exactCorrect || looseCorrect) && (exactWrong || looseWrong)),
      };
    }
    function judgeToKey(a, options) {
      const t = String(a ?? '').trim();
      const map = judgeOptionMap(options);
      if (/^[A-Ba-b]$/.test(t)) { return t.toUpperCase(); }
      // 判断题只接受 A/B 或明确的对错符号；C/D/E 等选择题答案不再静默接受。
      if (/^[C-Gc-g]$/.test(t)) { return ''; }
      if (isJudgeCorrectToken(t)) { return map.correctKey; }
      if (isJudgeWrongToken(t)) { return map.wrongKey; }
      return '';
    }

    function collectImportWarnings(arr) {
      const warnings = [];
      (arr || []).forEach((q, i) => { const status = validateQuestion(q);if (status !== '正常') { warnings.push(`第${i + 1}题：${status}`); } });
      return warnings;
    }
    function cleanImportedQuestion(q) {
      const fixed = cleanQuestionStemAndAnswer(q.question, q.answer, q.type, q.options || []);
      return { ...q, question: fixed.question, answer: isTextType(q.type) ? splitTextAnswer(fixed.answer.join('；')) : normalizeAnswer(fixed.answer, q.options || [], q.type), normalized: normalizeText(fixed.question) };
    }

    function extractBareJudgeAnswerFromLine(line, type = '', group = '') {
      const s = String(line || '').trim();
      if (!s || isAnswerLine(s) || isOptionLine(s)) { return { text: s, answer: [] }; }
      const contextIsJudge = mapType(group) === 'judge' || type === 'judge';
      const m = s.match(/^(.*?)(?:\s+|[。\uFF1B;，,\u3001])(?:\u7b54\u6848\s*(?::|\uFF1A)?\s*)?(\u6b63\u786e|\u9519\u8bef|\u5bf9|\u9519|\u662f|\u5426|\u221A|\u2713|\u2714|\u00D7|X|x|T|F|True|False)\s*$/i);
      if (!m) { return { text: s, answer: [] }; }
      const stem = (m[1] || '').trim();
      const token = (m[2] || '').trim();
      const hasQuestionNo = /^\s*(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]/.test(stem);
      const tokenIsSymbol = /^(?:\u221A|\u2713|\u2714|\u00D7|X|x|T|F)$/i.test(token);
      if (!contextIsJudge && !(hasQuestionNo && tokenIsSymbol)) { return { text: s, answer: [] }; }
      if (stem.length < 6) { return { text: s, answer: [] }; }
      return { text: stem.replace(/[??;?,?]\s*$/, '').trim(), answer: splitAnswer(token) };
    }
    function extractTrailingAnswerFromText(text, type) {
      let s = String(text || '').trim();let found = [];
      const bareJudge = s.match(/^(.*?)[。.!！?？]?\s*[\uFF08(]\s*(\u5bf9|\u9519|\u6b63\u786e|\u9519\u8bef|\u662f|\u5426|\u221A|\u2713|\u2714|\u00D7|X|x|v|V|T|F|True|False)\s*[\uFF09)]\s*$/i);
      if (bareJudge) {
        const stem = (bareJudge[1] || '').trim();
        const hasQuestionNo = /^\s*(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]/.test(stem);
        const hasInlineChoice = /(?:^|[\s;，、])A\s*[、.．:：，,]|(?:^|[\s;，、])B\s*[、.．:：，,]|(?:^|[\s;，、])C\s*[、.．:：，,]|(?:^|[\s;，、])D\s*[、.．:：，,]/i.test(stem);
        if ((type === 'judge' || (hasQuestionNo && stem.length >= 8 && !hasInlineChoice))) {
          return { text: stem.replace(/[?.!???]\s*$/, '').trim(), answer: splitAnswer(bareJudge[2]) };
        }
      }
      const pats = [
        /(?:[\uFF08(\u3010[]\s*(?:\u6b63\u786e\u7b54\u6848|\u53c2\u8003\u7b54\u6848|\u6807\u51c6\u7b54\u6848|\u7b54\u6848)\s*(?::|\uFF1A)?\s*([^\uFF09)\u3011\]]+)\s*[\uFF09)\u3011\]]\s*)$/i,
        /(?:\s|^)(?:\u6b63\u786e\u7b54\u6848|\u53c2\u8003\u7b54\u6848|\u6807\u51c6\u7b54\u6848|\u7b54\u6848|\u53c2\u8003\u8981\u70b9|\u7b54\u9898\u8981\u70b9)\s*(?::|\uFF1A)?\s*([^\n]+?)\s*$/i,
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
    function cleanQuestionStemAndAnswer(question, answer = [], type = '', options = []) {
      let ans = [...(answer || [])].filter(Boolean);
      let q = String(question || '').trim();
      const ex = extractTrailingAnswerFromText(q, type);
      if (ex.answer.length) { ans = ans.concat(ex.answer);q = ex.text; }
      const optionTexts = (options || []).map((o) => String(o.text || '')).filter(Boolean);
      const latexMaskV58920 = maskLatexForOptionDetectionV58920(q);
      const inLatexV58920 = (offset, len) => /^\s+$/.test(latexMaskV58920.slice(offset, offset + len));
      const answerKeys = ans.map((a) => String(a || '').trim().toUpperCase()).filter((a) => /^[A-G]$/.test(a));
      const correctOptionTexts = (options || []).filter((o) => answerKeys.includes(String(o.key || '').toUpperCase())).map((o) => String(o.text || ''));
      q = q.replace(/[\uFF08(]\s*([^()\uFF08\uFF09]{1,120})\s*[\uFF09)\u3015]/g, (m, inner, offset) => {
        if (inLatexV58920(offset, m.length)) { return m; }
        const raw = String(inner || '').trim();
        if (!raw) { return '（ ）'; }
        const compact = compactChoiceAnswerTokenV373(raw).replace(/[-－–—~～]/g, '');
        const looksLikeChoiceAnswer = /^[A-G]{1,7}$/.test(compact) || /^[1-9]{1,9}$/.test(compact);
        const looksLikeJudgeAnswer = /^(?:\u5bf9|\u9519|\u6b63\u786e|\u9519\u8bef|\u662f|\u5426|\u221A|\u00D7|X|x|v|V|T|F|TRUE|FALSE)$/i.test(raw);
        const allowChoiceAnswer = looksLikeChoiceAnswer && type !== 'judge';
        if (allowChoiceAnswer || (looksLikeJudgeAnswer && (type === 'judge' || !(options || []).length))) {
          const hasKeyAnswer = ans.some((a) => /^[A-Ga-g]$/.test(String(a || '').trim()));
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
        if ((matchesCorrectOption || matchesOption) && !/预案|方案|队站|站|县级以上|市级以上/.test(raw)) { return '（ ）'; }
        return m;
      });
      q = q.replace(/[\uFF08(]\s*([A-Ga-g][A-Ga-g\s,，、;；/\\]{0,12}|[1-9][1-9\s,，、;；/\\]{0,12}|对|错|正确|错误|是|否|\u221A|\u00D7|X|v|V|T|F|True|False)\s*$/g, (m, inner, offset) => {
        if (inLatexV58920(offset, m.length)) { return m; }
        const compact = String(inner || '').replace(/[\s,，、;；/\\]+/g, '').toUpperCase();
        const isChoice = /^[A-G]{1,7}$/.test(compact) || /^[1-9]{1,9}$/.test(compact);
        if (type === 'judge' && isChoice) { return m; }
        ans = ans.concat(splitAnswer(inner));
        return '（ ）';
      });
      return { question: q.replace(/\s+/g, ' ').trim(), answer: [...new Set(ans)] };
    }
    function selectOrderedOptionHits(inputHits) {
      let hits = inputHits;
      hits = [...hits].map((h) => (String(h.key) === '0' ? { ...h, key: 'D' } : h)).sort((a, b) => a.idx - b.idx);
      const de = [];
      for (const h of hits) { if (!de.some((x) => Math.abs(x.idx - h.idx) < 2 && String(x.key).toUpperCase() === String(h.key).toUpperCase())) { de.push(h); } }
      const letters = de.filter((h) => /^[A-Ga-g]$/.test(String(h.key || '')));
      if (letters.length >= 2) {
        const start = letters.find((h) => String(h.key).toUpperCase() === 'A') || letters[0];
        const seq = [];const need = String(start.key).toUpperCase().charCodeAt(0);let pos = start.idx - 1;
        for (let code = need;code <= 71;code++) {
          const hit = letters.find((h) => h.idx > pos && String(h.key).toUpperCase().charCodeAt(0) === code);
          if (!hit) { break; }
          seq.push(hit);pos = hit.idx;
        }
        if (seq.length >= 2) { return seq; }
      }
      const nums = de.filter((h) => /^[1-9]$/.test(String(h.key || '')));
      if (nums.length >= 2) {
        const start = nums.find((h) => String(h.key) === '1') || nums[0];
        const seq = [];const need = Number(start.key);let pos = start.idx - 1;
        for (let n = need;n <= 9;n++) {
          const hit = nums.find((h) => h.idx > pos && String(h.key) === String(n));
          if (!hit) { break; }
          seq.push(hit);pos = hit.idx;
        }
        if (seq.length >= 2) { return seq; }
      }
      return de;
    }

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
          if (raw[j] === '$') { j++; }
          const double = raw[i + 1] === '$';
          let end = -1;
          for (let k = j;k < raw.length;k++) {
            if (raw[k] === '\\') { k++;continue; }
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
        out += raw[i];i++;
      }
      return out;
    }

    function extractInlineOptionsRich(line) {
      const rawLine = String(line || '').trim();
      if (!rawLine) { return null; }
      const s = maskLatexForOptionDetectionV58920(rawLine);
      // 兼容答案选项本身也是字母的紧凑行：A.D B.C C.B D.A
      if (!/[\u4e00-\u9fa5]/.test(s)) {
        const vals = [];let vm;const vre = /([A-Ga-g])\s*[.．、:：]\s*([A-Ga-g])(?=\s|$|[A-Ga-g]\s*[.．、:：])/g;
        while ((vm = vre.exec(s))) { vals.push({ key: normalizeOptionKey(vm[1]), text: vm[2].toUpperCase() }); }
        if (vals.length >= 2) {
          const order = vals.map((v) => v.key).join('');
          if (/^ABCD?|ABCDEF?G?$/.test(order)) { return { prefix: '', options: vals }; }
        }
      }
      // 兼容强粘连选项：A.0.2MPaB.0.3MPaC.0.5MPaD.0.8MPa
      {
        const gh = [];let gm;const gre = /([A-Da-d0])\s*[、.．:：]\s*/g;
        while ((gm = gre.exec(s))) {
          const idx = gm.index; const key = gm[1];
          const prev = idx > 0 ? s[idx - 1] : '';
          const after = s.slice(gre.lastIndex).trimStart()[0] || '';
          if (key === '0' && (/^[\d]/.test(after) || /[\d.．]/.test(prev))) { continue; }
          if (/[（(]/.test(prev) && /[）)〕]/.test(after)) { continue; }
          gh.push({ idx, len: gm[0].length, key, correct: false });
        }
        const seq = selectOrderedOptionHits(gh);
        if (seq.length >= 3 && String(seq[0].key).toUpperCase() === 'A') {
          const prefix = rawLine.slice(0, seq[0].idx).trim().replace(/[;；，,、]+$/, '').trim();
          const options = seq.map((h, i) => {
            const start = h.idx + h.len;const end = i + 1 < seq.length ? seq[i + 1].idx : s.length;
            const txt = rawLine.slice(start, end).trim().replace(/^[;；，,、]+/, '').replace(/[;；，,、]+$/, '').trim();
            const ex = extractTrailingAnswerFromText(txt, '');
            return { key: normalizeOptionKey(h.key), correct: false, text: ex.text, extraAnswer: ex.answer };
          }).filter((o) => o.text || o.extraAnswer.length);
          if (options.length >= 2) { return { prefix, options }; }
        }
      }
      const hits = [];
      const re = /([A-Ga-g0])\s*([、.．:：，,]|\s+)\s*/g;
      let m;
      while ((m = re.exec(s))) {
        const idx = m.index;
        const keyRaw = m[1];
        const sep = m[2] || '';
        const prev = idx > 0 ? s[idx - 1] : '';
        const next = s[re.lastIndex] || '';
        const after = s.slice(re.lastIndex).trimStart()[0] || '';
        const whitespaceSepOnly = /^\s+$/.test(sep);
        // v58.9.7：英文判断题题干里常有 “a vowel sound and ...”、"a television ..."。
        // 不能把小写 a/b/c/d/e/f/g + 空格误当作 A-G 选项；否则标准英文判断题会粘连/拆坏。
        // 真正的英文选项通常写成 A. / B.，或至少用大写 A/B/C/D 作为独立标号。
        if (whitespaceSepOnly && /^[a-g]$/.test(keyRaw)) { continue; }
        // 避免把 API、100Bc、A级油井水泥、题干括号里的答案“（D ）”误作选项。
        if (followsAlphanumeric(prev)) { continue; }
        if ((/[（(]/.test(prev) || /[（(]\s*$/.test(s.slice(Math.max(0, idx - 4), idx))) && /[）)〕]/.test(after)) { continue; }
        if (keyRaw === '0' && (/^[\d]/.test(after) || /[\d.．]/.test(prev))) { continue; }
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
        if (/[级型类款层]/.test(next)) { continue; }
        hits.push({ idx, len: 1, key: m[1], correct: false });
      }
      // 兼容 (A) / （A） / √(A)
      const parRe = /([oOxXuUyYvV√✔✓])?\s*[（(]\s*([A-Ga-g1-9])\s*[）)]/g;
      while ((m = parRe.exec(s))) {
        const idx = m.index;
        const prev = idx > 0 ? s[idx - 1] : '';
        if (prev && /[A-Za-z0-9\u4e00-\u9fa5）)】\]]/.test(prev)) { continue; }
        hits.push({ idx, len: m[0].length, key: m[2], correct: !!m[1] && /[oOyYvV√✔✓]/.test(m[1]) });
      }
      const uniq = selectOrderedOptionHits(hits);
      if (uniq.length < 2) { return null; }
      const prefix = rawLine.slice(0, uniq[0].idx).trim().replace(/[;；，,、]+$/, '').trim();
      // 如果第一组选项标记前只有题号，例如“86. A级油井水泥……”，这里的 A 是题干首字母，不是 A 选项。
      if (/^\s*(?:第\s*)?\d{1,4}\s*(?:题)?[、.．:：]\s*$/.test(prefix)) { return null; }
      const options = uniq.map((h, i) => {
        const start = h.idx + h.len;const end = i + 1 < uniq.length ? uniq[i + 1].idx : s.length;
        const txt = rawLine.slice(start, end).trim().replace(/^[;；，,、]+/, '').replace(/[;；，,、]+$/, '').trim();
        const ex = extractTrailingAnswerFromText(txt, '');
        return { key: normalizeOptionKey(h.key), correct: h.correct, text: ex.text, extraAnswer: ex.answer };
      }).filter((o) => o.text || o.correct || o.extraAnswer.length);
      if (options.length < 2) { return null; }
      return { prefix, options };
    }
    return Object.freeze({
      analyzeQuestionTextProfile, attachRecruitmentOptionsV58915, attachSourceMetaV58910,
      cleanImportedQuestion, collectImportWarnings, collectSoftRiskWarnings, countTypes,
      displayOptionTextV589, escapeRegExpV51, extractInlineOptionsRich, getHeadingType,
      getRecruitmentOptionsV58915, getSourceMetaV58910, importIssueStatus, isImportNoiseLine,
      isJudgeSymbolAnswer, isRawJudgeSymbolAnswer, mapType, mergeDuplicateOptions,
      normalizeAnswer, normalizeImportText, normalizeJsonMultilineTextV5910, normalizeOptionKey,
      normalizeQuestion, normalizeText, normalizeType, parseAnswerAnalysisEntries, parseOptionsText,
      parseTextQuestions, parseTextQuestionsBase, parseTextQuestionsBaseDetailed,
      repairCircledCombinationQuestion, repairEmbeddedOptions, repairMissingAndStuckQuestionsBySourceV58910,
      repairParsedQuestionsLocally, sourceQuestionNumberFromLineV58910, shouldGuessBlankFromNoOption,
      splitAnswer, splitAnswerByType, splitSemicolonOptionsFromLine, splitTextAnswer,
      trimMultilineBoundaryV5910, validateQuestion,
    });
  }

  globalThis.ShirohaTextParser = Object.freeze({ create });
})();
