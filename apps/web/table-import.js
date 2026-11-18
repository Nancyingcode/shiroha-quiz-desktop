// 读取 CSV 和 XLSX 题库，按表头保留题型、答案与原有题目顺序。
(() => {
  'use strict';

  // 注入现有解析与清洗规则，让表格和文本导入使用相同的题库结构。
  function create({
    readText,
    readBuffer,
    parser,
    decodeXml,
    makeId,
  }) {
    const { parseZipEntries, unzipEntry } = globalThis.ShirohaZip;
    const { isTextType } = globalThis.ShirohaQuizCore;
    const {
      parseTextQuestionsBase,
      normalizeQuestion,
      countTypes,
      extractInlineOptionsRich,
      normalizeOptionKey,
      normalizeType,
      mapType,
      splitTextAnswer,
      splitAnswerByType,
      parseOptionsText,
      mergeDuplicateOptions,
      repairEmbeddedOptions,
      splitSemicolonOptionsFromLine,
    } = parser;
    // 依文件格式选择读取器，再统一产出题目和工作表摘要。
    async function readTableImportFileV49(file) {
      const lower = String(file.name || '').toLowerCase();
      let sheets;
      if (lower.endsWith('.csv')) {
        const text = await readText(file);
        sheets = [{ sheetName: 'CSV', rows: parseDelimitedTextRowsV49(text) }];
      } else if (lower.endsWith('.xlsx')) {
        sheets = await extractXlsxSheetsV49(file);
      } else { throw new Error('暂不支持该表格格式，请使用 .xlsx 或 .csv'); }

      return tableSheetsToQuestionsV49(sheets, file.name || '表格题库');
    }

    function tableImportPreviewTextV49(result, fileName) {
      const sheets = (result.sheets || []).map((s) => `${s.sheetName || 'Sheet'}：${s.rows || 0} 行`).join('；');
      const sample = (result.questions || []).slice(0, 5).map((q, i) => `${i + 1}. ${q.question || ''}`).join('\n');
      return `已从表格文件解析题库：${fileName || ''}\n${sheets || ''}\n识别题数：${(result.questions || []).length}\n\n预览：\n${sample}`.trim();
    }

    // 逐字符处理引号状态，保留被引号包住的逗号、换行和重复双引号。
    function parseDelimitedTextRowsV49(text) {
      // 只移除文件开头的 UTF-8 BOM，避免它进入首列表头。
      const withoutBom = String(text || '').replace(/^\uFEFF/, '');
      // 将 CRLF 和单独 CR 转成解析器使用的行边界。
      const source = withoutBom.replace(/\r\n?/g, '\n');
      const delimiter = detectDelimitedSeparatorV49(source);
      const rows = [];let row = []; let cell = ''; let inQuotes = false;
      for (let i = 0;i < source.length;i += 1) {
        const ch = source[i];
        if (ch === '"') {
          if (inQuotes && source[i + 1] === '"') { cell += '"';i += 1; } else { inQuotes = !inQuotes; }
        } else if (ch === delimiter && !inQuotes) { row.push(normalizeTableCellTextV49(cell));cell = ''; } else if (ch === '\n' && !inQuotes) { row.push(normalizeTableCellTextV49(cell));rows.push(row);row = [];cell = ''; } else { cell += ch; }
      }

      row.push(normalizeTableCellTextV49(cell));
      if (row.some((x) => String(x || '').trim())) { rows.push(row); }

      return rows;
    }

    // 为分隔符探测统计实际列边界，忽略引号里的普通字符。
    function countDelimiterOutsideQuotesV49(line, delimiter) {
      let n = 0; let inQuotes = false;
      for (let i = 0;i < line.length;i += 1) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { i += 1; } else { inQuotes = !inQuotes; }
        } else if (ch === delimiter && !inQuotes) { n += 1; }
      }

      return n;
    }

    // 用前 20 个非空行比较候选分隔符，缺少足够证据时按逗号处理。
    function detectDelimitedSeparatorV49(text) {
      // 样本以归一化后的 LF 切行，仅用于统计分隔符出现频率。
      const lines = String(text || '').split(/\n/).filter((x) => x.trim()).slice(0, 20);
      const candidates = ['\t', ',', ';'];
      let best = ','; let bestScore = -1;
      for (const d of candidates) {
        const counts = lines.map((l) => countDelimiterOutsideQuotesV49(l, d)).filter((n) => n > 0);
        const score = (counts.length * 4) + counts.reduce((a, b) => a + b, 0) - (d === ';' ? 1 : 0);
        if (score > bestScore) { bestScore = score;best = d; }
      }

      return bestScore > 0 ? best : ',';
    }

    // 保留单元格内部换行，清除从办公文档复制时引入的行边缘空白。
    function normalizeTableCellTextV49(s) {
      // 将 Excel 中的不可断空格换成普通空格。
      const text = String(s ?? '').replace(/\u00A0/g, ' ');
      // 各种回车格式统一落为一个逻辑换行。
      const normalized = text.replace(/\r\n?/g, '\n');
      // 去除换行前的残留空格和制表符。
      const trimmedEnd = normalized.replace(/[ \t]+\n/g, '\n');
      // 去除换行后的缩进，保留换行本身。
      return trimmedEnd.replace(/\n[ \t]+/g, '\n').trim();
    }

    // 解析工作簿登记的表名和关系路径，保持工作表按清单顺序读取。
    function workbookSheet(tag, relMap) {
      // 读取 sheet 标签的 name 属性并解码为显示名称。
      const name = decodeXml((tag.match(/name="([^"]*)"/) || [])[1] || 'Sheet');
      // 提取关系 ID，以便定位工作表所在的 ZIP 成员。
      const rid = (tag.match(/r:id="([^"]+)"/) || [])[1] || '';
      let target = relMap[rid] || '';
      if (!target) { return null; }

      // 标准绝对成员路径去掉开头的斜杠后，可用于归档内查找。
      target = target.replace(/^\//, '');
      if (!target.startsWith('xl/')) {
        // 相对关系路径以工作簿目录为根，先去掉显式的当前目录前缀。
        target = `xl/${target.replace(/^\.\//, '')}`;
      }

      return { name, target };
    }

    // 优先按关系清单读取工作表，旧文件缺少可用映射时尝试标准命名。
    async function extractXlsxSheetsV49(file) {
      const buf = await readBuffer(file);
      const entries = parseZipEntries(buf);
      const get = async (name) => {
        const entry = entries.find((e) => e.name === name);
        if (!entry) { return ''; }

        return unzipEntry(buf, entry);
      };

      const workbook = await get('xl/workbook.xml');
      if (!workbook) { throw new Error('未找到 xl/workbook.xml，可能不是有效 .xlsx 文件'); }

      const rels = await get('xl/_rels/workbook.xml.rels');
      const shared = await get('xl/sharedStrings.xml');
      const sharedStrings = parseXlsxSharedStringsV49(shared);
      const relMap = parseXlsxWorkbookRelsV49(rels);
      const sheets = [];let m;
      // 遍历工作簿的 sheet 标签，保留工作簿登记顺序。
      const sheetRe = /<sheet\b[^>]*>/g;
      while ((m = sheetRe.exec(workbook))) {
        const sheet = workbookSheet(m[0], relMap);
        if (!sheet) { continue; }

        const { name, target } = sheet;
        const xml = await get(target);
        if (!xml) { continue; }

        sheets.push({ sheetName: name, rows: parseXlsxSheetRowsV49(xml, sharedStrings) });
      }

      if (!sheets.length) {
        // 关系清单不可用时，只尝试归档中的标准工作表成员名。
        const sheetPath = /^xl\/worksheets\/sheet\d+\.xml$/;
        const fallback = entries.filter((e) => sheetPath.test(e.name));
        for (const e of fallback) {
          const xml = await unzipEntry(buf, e);
          // 移除工作表成员名末尾的 XML 后缀，作为兜底显示名。
          sheets.push({ sheetName: e.name.split('/').pop().replace(/\.xml$/, ''), rows: parseXlsxSheetRowsV49(xml, sharedStrings) });
        }
      }

      return sheets;
    }

    // 把一项共享字符串或内联单元格中的多个文字片段按 XML 原顺序串接。
    function readXlsxTextRuns(xml) {
      const parts = [];
      let tm;
      // 逐一匹配共享字符串或内联富文本中的 t 元素。
      const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
      while ((tm = tRe.exec(xml))) { parts.push(decodeXml(tm[1])); }

      return parts.join('');
    }

    // 按 XML 中的共享字符串顺序建立索引表，空表也可继续解析。
    function parseXlsxSharedStringsV49(xml) {
      const out = [];if (!xml) { return out; }

      let m;
      // 按 si 元素切分共享字符串表，使其编号与工作表引用一致。
      const siRe = /<si\b[\s\S]*?<\/si>/g;
      while ((m = siRe.exec(xml))) {
        out.push(normalizeTableCellTextV49(readXlsxTextRuns(m[0])));
      }

      return out;
    }

    // 建立关系 ID 到归档成员路径的映射。
    function parseXlsxWorkbookRelsV49(xml) {
      const out = {};
      let m;
      // 遍历关系标签，提取工作表可引用的关系记录。
      const re = /<Relationship\b[^>]*>/g;
      while ((m = re.exec(String(xml || '')))) {
        const tag = m[0];
        // 从关系标签读取 Id，用于匹配工作簿中的 r:id。
        const id = (tag.match(/Id="([^"]+)"/) || [])[1];
        // 从关系标签读取 Target，保留其路径待工作簿解析。
        const target = (tag.match(/Target="([^"]+)"/) || [])[1];
        if (id && target) { out[id] = decodeXml(target); }
      }

      return out;
    }

    // 按单元格引用恢复列位置，缺少引用时沿用文件中的单元格顺序。
    function readXlsxRow(rowXml, sharedStrings) {
      const row = [];
      let cm;
      // 提取每个单元格的属性和内容，以恢复列编号和数据。
      const cRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      while ((cm = cRe.exec(rowXml))) {
        const attrs = cm[1] || ''; const body = cm[2] || '';
        // 将 A1 形式引用的列字母提取出来，行号由 row 元素提供。
        const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1] || '';
        const idx = ref ? xlsxColToIndexV49(ref) : row.length;
        row[idx] = xlsxCellValueV49(attrs, body, sharedStrings);
      }

      return row;
    }

    // 从工作表 XML 读取非空行并归一化已填入的单元格。
    function parseXlsxSheetRowsV49(xml, sharedStrings = []) {
      const rows = [];
      let rm;
      // 匹配完整的 row 元素，保留元素内单元格的顺序。
      const rowRe = /<row\b[^>]*>[\s\S]*?<\/row>/g;
      while ((rm = rowRe.exec(String(xml || '')))) {
        const row = readXlsxRow(rm[0], sharedStrings);
        if (row.some((x) => String(x || '').trim())) { rows.push(row.map((x) => normalizeTableCellTextV49(x || ''))); }
      }

      return rows;
    }

    function xlsxColToIndexV49(col) {
      let n = 0;for (const ch of String(col || '')) { n = (n * 26) + (ch.charCodeAt(0) - 64); }

      return Math.max(0, n - 1);
    }

    // 按单元格类型解码内联字符串、共享字符串索引和布尔值。
    function xlsxCellValueV49(attrs, body, sharedStrings) {
      // 从单元格属性读取 t 字段，用于选择对应编码。
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || '';
      if (type === 'inlineStr') {
        return readXlsxTextRuns(body);
      }

      // 读取 v 元素中的原始值，由单元格类型决定如何解释。
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (v == null) { return ''; }

      const raw = decodeXml(v);
      if (type === 's') { return sharedStrings[Number(raw)] || ''; }

      if (type === 'b') { return raw === '1' ? 'TRUE' : 'FALSE'; }

      return raw;
    }

    // 逐表收集题目与诊断，只在确实没有表头时回退到文本解析。
    function tableSheetsToQuestionsV49(sheets, fileName) {
      const questions = [];const warnings = [];const sheetSummary = [];
      for (const sheet of (sheets || [])) {
        const rows = (sheet.rows || []).filter((r) => (r || []).some((c) => String(c || '').trim()));
        sheetSummary.push({ sheetName: sheet.sheetName || 'Sheet', rows: rows.length });
        if (!rows.length) { continue; }

        const hasTableHeader = findTableHeaderRowV49(rows) >= 0;
        const parsed = parseTableRowsWithHeaderV49(rows, sheet.sheetName || '');
        if (parsed.questions.length) { questions.push(...parsed.questions); } else if (!hasTableHeader) {
          const text = rows.map((r) => r.map((c) => String(c || '').trim()).filter(Boolean).join('\n')).filter(Boolean).join('\n');
          const fallback = parseTextQuestionsBase(text).map((q, i) => ({ ...q, group: q.group || sheet.sheetName || '', number: q.number || questions.length + i + 1 }));
          if (fallback.length) { questions.push(...fallback); } else { warnings.push(`${sheet.sheetName || 'Sheet'}：未识别到有效题目`); }
        } else { warnings.push(`${sheet.sheetName || 'Sheet'}：表头已识别，但没有填写题目数据`); }
      }

      const normalized = questions.map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
      const stats = countTypes(normalized);
      return { questions: normalized, warnings, sheets: sheetSummary, report: `解析策略：Excel/CSV 表格题库解析；来源：${fileName || '表格文件'}；识别 ${normalized.length} 题（单选${stats.single || 0}、多选${(stats.multiple || 0) + (stats.multi || 0)}、判断${stats.judge || 0}、填空${stats.blank || 0}、简答${stats.short || 0}）。` };
    }

    // 根据表头读取题目行，并在工作表内出现重复或更新表头时切换映射。
    function parseTableRowsWithHeaderV49(rows, sheetName = '') {
      const headerIndex = findTableHeaderRowV49(rows);
      if (headerIndex < 0) { return { questions: [] }; }

      let map = buildTableHeaderMapV49(rows[headerIndex]);
      const questions = [];
      for (let r = headerIndex + 1;r < rows.length;r += 1) {
        const row = rows[r] || [];
        if (!row.some((c) => String(c || '').trim())) { continue; }

        const nextMap = buildTableHeaderMapV49(row);
        if (nextMap.score >= map.score && nextMap.question != null) { map = nextMap;continue; }

        const q = tableRowToQuestionV49(row, map, questions.length, sheetName);
        if (q && q.question) { questions.push(q); }
      }

      return { questions };
    }

    // 从开头若干行选择证据最充分的表头，忽略低分的普通数据行。
    function findTableHeaderRowV49(rows) {
      let best = -1; let bestScore = 0;
      const max = Math.min(rows.length, 12);
      for (let i = 0;i < max;i += 1) {
        const map = buildTableHeaderMapV49(rows[i] || []);
        if (map.score > bestScore) { best = i;bestScore = map.score; }
      }

      return bestScore >= 5 ? best : -1;
    }

    // 普通字段保留首列位置，专用选项列分别计分。
    function addTableHeaderField(map, cell, idx) {
      const field = tableHeaderFieldV49(cell);
      if (!field) { return; }

      // 内部选项列编码是 opt 加一个大写选项字母。
      if (/^opt[A-G]$/.test(field)) { map.optionCols[field.slice(3)] = idx;map.score += 2;return; }

      if (field === 'options') { map.options = idx;map.score += 2;return; }

      if (map[field] == null) {
        map[field] = idx;
        let fieldScore = 1;
        if (field === 'question') { fieldScore = 5; } else if (field === 'answer') { fieldScore = 3; }

        map.score += fieldScore;
      }
    }

    // 把识别的字段和专用选项列映射到列号，为表头选择累计证据。
    function buildTableHeaderMapV49(row) {
      const map = { optionCols: {}, score: 0 };
      (row || []).forEach((cell, idx) => addTableHeaderField(map, cell, idx));

      if (Object.keys(map.optionCols).length >= 2) { map.score += 2; }

      return map;
    }

    function compactHeaderV49(s) {
      // 表头别名比较时忽略词间空白。
      const text = String(s || '').trim().replace(/\s+/g, '');
      // 括号、连字符等常作为装饰，不改变表头字段含义。
      return text.replace(/[：:\-_/（）()[\]【】]/g, '').toLowerCase();
    }

    // 将中英文列名映射到固定字段，单独识别 A 到 G 的选项列。
    function tableHeaderFieldV49(cell) {
      const raw = String(cell || '').trim();if (!raw) { return ''; }

      const h = compactHeaderV49(raw);
      // 兼容 A、选项A、A选项及英文 option/choice 加字母的列名。
      const opt = raw.match(/^\s*(?:选项\s*([A-Ga-g])|([A-Ga-g])\s*选项|option\s*([A-Ga-g])|choice\s*([A-Ga-g])|([A-Ga-g]))\s*$/i);
      if (opt) { return `opt${String(opt[1] || opt[2] || opt[3] || opt[4] || opt[5]).toUpperCase()}`; }

      if (['题型', '类型', 'questiontype', 'type', 'kind'].includes(h)) { return 'type'; }

      if (['题号', '序号', '编号', 'no', 'number', 'num', 'id'].includes(h)) { return 'number'; }

      if (['题干', '题目', '问题', 'question', 'stem', 'title', '题目内容'].includes(h)) { return 'question'; }

      if (['选项', '选项内容', 'choices', 'options', 'choice', 'option'].includes(h)) { return 'options'; }

      if (['答案', '正确答案', '参考答案', '标准答案', '答', 'answer', 'correctanswer', 'rightanswer', 'standardanswer'].includes(h)) { return 'answer'; }

      if (['解析', '答案解析', '说明', '解题思路', 'analysis', 'explanation', 'explain'].includes(h)) { return 'analysis'; }

      if (['分类', '分组', '章节', '标签', '来源', 'category', 'group', 'topic', 'section'].includes(h)) { return 'category'; }

      if (['分值', 'score', 'points', 'point'].includes(h)) { return 'score'; }

      if (['难度', 'difficulty', 'level'].includes(h)) { return 'difficulty'; }

      return '';
    }

    function tableCellV49(row, idx) {
      return idx == null ? '' : normalizeTableCellTextV49(row[idx] || '');
    }

    // 从专用列或合并列读取选项，缺少选项时才尝试拆出题干中的内联选项。
    function getTableRowOptions(row, map, originalQuestion) {
      let question = originalQuestion;
      const options = [];
      const optionCols = map.optionCols || {};
      'ABCDEFG'.split('').forEach((k) => {
        const v = tableCellV49(row, optionCols[k]);
        if (v) { options.push({ key: k, text: stripLeadingOptionLabelV49(v, k) }); }
      });

      const optionsCell = tableCellV49(row, map.options);
      if (optionsCell) { options.push(...parseTableOptionsCellV49(optionsCell)); }

      if (!options.length) {
        const rich = extractInlineOptionsRich(question);
        if (rich && rich.options && rich.options.length >= 2) {
          question = rich.prefix || question;
          options.push(...rich.options.map((o) => ({ key: normalizeOptionKey(o.key), text: o.text || '', correct: !!o.correct })));
        }
      }

      return { question, options };
    }

    // 读取一行的题干、选项和答案，缺少编号时按当前题序编号。
    function tableRowToQuestionV49(row, map, idx, sheetName = '') {
      const rawType = tableCellV49(row, map.type);
      const rawNumber = tableCellV49(row, map.number);
      let question = tableCellV49(row, map.question);
      const answerCell = tableCellV49(row, map.answer);
      let analysis = tableCellV49(row, map.analysis);
      const category = tableCellV49(row, map.category) || sheetName || '';
      if (!question) { return null; }

      const parsed = getTableRowOptions(row, map, question);
      question = parsed.question;
      const { options } = parsed;
      const aa = extractTableAnswerAnalysisV49(answerCell);
      const rawAnswer = aa.answer || answerCell;
      if (!analysis && aa.analysis) { analysis = aa.analysis; }

      const type = normalizeType(rawType) || mapType(rawType) || '';
      const answer = isTextType(type) ? splitTextAnswer(rawAnswer) : splitAnswerByType(rawAnswer, type);
      const correctFromOptions = options.filter((o) => o.correct).map((o) => o.key);
      // 接受“第12题”等带装饰的题号，仅使用首段数字。
      const num = Number(String(rawNumber || '').match(/\d+/)?.[0] || 0) || undefined;
      return { id: makeId('tbl', idx), type, number: num || idx + 1, question, options: options.filter((o) => o.text), answer: answer.length ? answer : correctFromOptions, analysis, category, group: category, score: tableCellV49(row, map.score) };
    }

    function stripLeadingOptionLabelV49(text, key = '') {
      const k = String(key || '').toUpperCase();
      // 仅去掉与本列键相同的开头选项标号，保留正文中的字母。
      return String(text || '').trim().replace(new RegExp(`^\\s*(?:[（(]\\s*${k}\\s*[）)]|${k}\\s*[、.．:：])\\s*`, 'i'), '').trim();
    }

    // 在合并选项列中按多行、富文本和分号形式依次尝试，复用文本选项修复。
    function parseTableOptionsCellV49(text) {
      const s = String(text || '').trim();if (!s) { return []; }

      // 按连续换行切分合并选项列，先尝试一行一个选项。
      const lines = s.split(/\n+/).map((x) => x.trim()).filter(Boolean);
      if (lines.length >= 2) {
        const out = lines.flatMap((line) => parseOptionsText(line));
        if (out.length >= 2) { return mergeDuplicateOptions(repairEmbeddedOptions(out)); }
      }

      const rich = extractInlineOptionsRich(s);
      if (rich && rich.options && rich.options.length >= 2) { return mergeDuplicateOptions(repairEmbeddedOptions(rich.options.map((o) => ({ key: normalizeOptionKey(o.key), text: o.text || '', correct: !!o.correct })))); }

      const sem = splitSemicolonOptionsFromLine(s, []);
      if (sem && sem.length >= 2) { return mergeDuplicateOptions(repairEmbeddedOptions(sem)); }

      return parseOptionsText(s);
    }

    // 当答案单元格附了解析时，在保留答案的同时拆出解析正文。
    function extractTableAnswerAnalysisV49(text) {
      const s = String(text || '').trim();if (!s) { return { answer: '', analysis: '' }; }

      // 识别答案后明确的解析前缀及冒号，前缀前仍属于答案。
      const m = s.match(/([\s\S]*?)(?:\s*(?:解析|答案解析|说明|解题思路)\s*[:：]\s*)([\s\S]+)$/);
      if (m) { return { answer: m[1].trim(), analysis: m[2].trim() }; }

      return { answer: s, analysis: '' };
    }

    return { readTableImportFileV49, tableImportPreviewTextV49 };
  }

  globalThis.ShirohaTableImport = Object.freeze({ create });
})();
