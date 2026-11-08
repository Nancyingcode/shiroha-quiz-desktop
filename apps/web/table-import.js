(() => {
  'use strict';

  function create({ readText, readBuffer, parser, decodeXml, makeId }) {
    const { parseZipEntries, unzipEntry } = globalThis.ShirohaZip;
    const { isTextType } = globalThis.ShirohaQuizCore;
    const { parseTextQuestionsBase, normalizeQuestion, countTypes, extractInlineOptionsRich, normalizeOptionKey, normalizeType, mapType, splitTextAnswer, splitAnswerByType, parseOptionsText, mergeDuplicateOptions, repairEmbeddedOptions, splitSemicolonOptionsFromLine } = parser;
    async function readTableImportFileV49(file) {
      const lower = String(file.name || '').toLowerCase();
      let sheets;
      if (lower.endsWith('.csv')) {
        const text = await readText(file);
        sheets = [{ sheetName: 'CSV', rows: parseDelimitedTextRowsV49(text) }];
      } else if (lower.endsWith('.xlsx')) {
        sheets = await extractXlsxSheetsV49(file);
      } else {throw new Error('暂不支持该表格格式，请使用 .xlsx 或 .csv');}
      return tableSheetsToQuestionsV49(sheets, file.name || '表格题库');
    }

    function tableImportPreviewTextV49(result, fileName) {
      const sheets = (result.sheets || []).map((s)=>`${s.sheetName || 'Sheet'}：${s.rows || 0} 行`).join('；');
      const sample = (result.questions || []).slice(0, 5).map((q, i)=>`${i + 1}. ${q.question || ''}`).join('\n');
      return `已从表格文件解析题库：${fileName || ''}\n${sheets || ''}\n识别题数：${(result.questions || []).length}\n\n预览：\n${sample}`.trim();
    }
    function parseDelimitedTextRowsV49(text) {
      const source = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
      const delimiter = detectDelimitedSeparatorV49(source);
      const rows = [];let row = [], cell = '', inQuotes = false;
      for (let i = 0;i < source.length;i++) {
        const ch = source[i];
        if (ch === '"') {
          if (inQuotes && source[i + 1] === '"') {cell += '"';i++;}
          else {inQuotes = !inQuotes;}
        } else if (ch === delimiter && !inQuotes) {row.push(normalizeTableCellTextV49(cell));cell = '';}
        else if (ch === '\n' && !inQuotes) {row.push(normalizeTableCellTextV49(cell));rows.push(row);row = [];cell = '';}
        else {cell += ch;}
      }
      row.push(normalizeTableCellTextV49(cell));
      if (row.some((x)=>String(x || '').trim())) {rows.push(row);}
      return rows;
    }
    function countDelimiterOutsideQuotesV49(line, delimiter) {
      let n = 0, inQuotes = false;
      for (let i = 0;i < line.length;i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {i++;}
          else {inQuotes = !inQuotes;}
        } else if (ch === delimiter && !inQuotes) {n++;}
      }
      return n;
    }
    function detectDelimitedSeparatorV49(text) {
      const lines = String(text || '').split(/\n/).filter((x)=>x.trim()).slice(0, 20);
      const candidates = ['\t', ',', ';'];
      let best = ',', bestScore = -1;
      for (const d of candidates) {
        const counts = lines.map((l)=>countDelimiterOutsideQuotesV49(l, d)).filter((n)=>n > 0);
        const score = counts.length * 4 + counts.reduce((a, b)=>a + b, 0) - (d === ';' ? 1 : 0);
        if (score > bestScore) {bestScore = score;best = d;}
      }
      return bestScore > 0 ? best : ',';
    }
    function normalizeTableCellTextV49(s) {
      return String(s ?? '').replace(/\u00A0/g, ' ').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();
    }
    async function extractXlsxSheetsV49(file) {
      const buf = await readBuffer(file);
      const entries = parseZipEntries(buf);
      const get = async (name)=>{
        const entry = entries.find((e)=>e.name === name);
        return entry ? await unzipEntry(buf, entry) : '';
      };
      const workbook = await get('xl/workbook.xml');
      if (!workbook) {throw new Error('未找到 xl/workbook.xml，可能不是有效 .xlsx 文件');}
      const rels = await get('xl/_rels/workbook.xml.rels');
      const shared = await get('xl/sharedStrings.xml');
      const sharedStrings = parseXlsxSharedStringsV49(shared);
      const relMap = parseXlsxWorkbookRelsV49(rels);
      const sheets = [];let m;
      const sheetRe = /<sheet\b[^>]*>/g;
      while ((m = sheetRe.exec(workbook))) {
        const tag = m[0];
        const name = decodeXml((tag.match(/name="([^"]*)"/) || [])[1] || 'Sheet');
        const rid = (tag.match(/r:id="([^"]+)"/) || [])[1] || '';
        let target = relMap[rid] || '';
        if (!target) {continue;}
        target = target.replace(/^\//, '');
        if (!target.startsWith('xl/')) {target = 'xl/' + target.replace(/^\.\//, '');}
        const xml = await get(target);
        if (!xml) {continue;}
        sheets.push({ sheetName: name, rows: parseXlsxSheetRowsV49(xml, sharedStrings) });
      }
      if (!sheets.length) {
        const fallback = entries.filter((e)=>/^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
        for (const e of fallback) {
          const xml = await unzipEntry(buf, e);
          sheets.push({ sheetName: e.name.split('/').pop().replace(/\.xml$/, ''), rows: parseXlsxSheetRowsV49(xml, sharedStrings) });
        }
      }
      return sheets;
    }
    function parseXlsxSharedStringsV49(xml) {
      const out = [];if (!xml) {return out;}
      let m;const siRe = /<si\b[\s\S]*?<\/si>/g;
      while ((m = siRe.exec(xml))) {
        const si = m[0];const parts = [];let tm;const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
        while ((tm = tRe.exec(si))) {parts.push(decodeXml(tm[1]));}
        out.push(normalizeTableCellTextV49(parts.join('')));
      }
      return out;
    }
    function parseXlsxWorkbookRelsV49(xml) {
      const out = {};let m;const re = /<Relationship\b[^>]*>/g;
      while ((m = re.exec(String(xml || '')))) {
        const tag = m[0];const id = (tag.match(/Id="([^"]+)"/) || [])[1];const target = (tag.match(/Target="([^"]+)"/) || [])[1];
        if (id && target) {out[id] = decodeXml(target);}
      }
      return out;
    }
    function parseXlsxSheetRowsV49(xml, sharedStrings = []) {
      const rows = [];let rm;const rowRe = /<row\b[^>]*>[\s\S]*?<\/row>/g;
      while ((rm = rowRe.exec(String(xml || '')))) {
        const rowXml = rm[0];const row = [];let cm;const cRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
        while ((cm = cRe.exec(rowXml))) {
          const attrs = cm[1] || '', body = cm[2] || '';
          const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1] || '';
          const idx = ref ? xlsxColToIndexV49(ref) : row.length;
          row[idx] = xlsxCellValueV49(attrs, body, sharedStrings);
        }
        if (row.some((x)=>String(x || '').trim())) {rows.push(row.map((x)=>normalizeTableCellTextV49(x || '')));}
      }
      return rows;
    }
    function xlsxColToIndexV49(col) {let n = 0;for (const ch of String(col || '')) {n = n * 26 + (ch.charCodeAt(0) - 64);} return Math.max(0, n - 1);}
    function xlsxCellValueV49(attrs, body, sharedStrings) {
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || '';
      if (type === 'inlineStr') {
        const parts = [];let tm;const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
        while ((tm = tRe.exec(body))) {parts.push(decodeXml(tm[1]));}
        return parts.join('');
      }
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (v == null) {return '';}
      const raw = decodeXml(v);
      if (type === 's') {return sharedStrings[Number(raw)] || '';}
      if (type === 'b') {return raw === '1' ? 'TRUE' : 'FALSE';}
      return raw;
    }
    function tableSheetsToQuestionsV49(sheets, fileName) {
      const questions = [];const warnings = [];const sheetSummary = [];
      for (const sheet of (sheets || [])) {
        const rows = (sheet.rows || []).filter((r)=>(r || []).some((c)=>String(c || '').trim()));
        sheetSummary.push({ sheetName: sheet.sheetName || 'Sheet', rows: rows.length });
        if (!rows.length) {continue;}
        const hasTableHeader = findTableHeaderRowV49(rows) >= 0;
        const parsed = parseTableRowsWithHeaderV49(rows, sheet.sheetName || '');
        if (parsed.questions.length) {questions.push(...parsed.questions);}
        else if (!hasTableHeader) {
          const text = rows.map((r)=>r.map((c)=>String(c || '').trim()).filter(Boolean).join('\n')).filter(Boolean).join('\n');
          const fallback = parseTextQuestionsBase(text).map((q, i)=>({ ...q, group: q.group || sheet.sheetName || '', number: q.number || questions.length + i + 1 }));
          if (fallback.length) {questions.push(...fallback);}
          else {warnings.push(`${sheet.sheetName || 'Sheet'}：未识别到有效题目`);}
        } else {warnings.push(`${sheet.sheetName || 'Sheet'}：表头已识别，但没有填写题目数据`);}
      }
      const normalized = questions.map((q, i)=>normalizeQuestion(q, i)).filter((q)=>q.question);
      const stats = countTypes(normalized);
      return { questions: normalized, warnings, sheets: sheetSummary, report: `解析策略：Excel/CSV 表格题库解析；来源：${fileName || '表格文件'}；识别 ${normalized.length} 题（单选${stats.single || 0}、多选${(stats.multiple || 0) + (stats.multi || 0)}、判断${stats.judge || 0}、填空${stats.blank || 0}、简答${stats.short || 0}）。` };
    }
    function parseTableRowsWithHeaderV49(rows, sheetName = '') {
      const headerIndex = findTableHeaderRowV49(rows);
      if (headerIndex < 0) {return { questions: [] };}
      let map = buildTableHeaderMapV49(rows[headerIndex]);
      const questions = [];
      for (let r = headerIndex + 1;r < rows.length;r++) {
        const row = rows[r] || [];
        if (!row.some((c)=>String(c || '').trim())) {continue;}
        const nextMap = buildTableHeaderMapV49(row);
        if (nextMap.score >= map.score && nextMap.question != null) {map = nextMap;continue;}
        const q = tableRowToQuestionV49(row, map, questions.length, sheetName);
        if (q && q.question) {questions.push(q);}
      }
      return { questions };
    }
    function findTableHeaderRowV49(rows) {
      let best = -1, bestScore = 0;
      const max = Math.min(rows.length, 12);
      for (let i = 0;i < max;i++) {
        const map = buildTableHeaderMapV49(rows[i] || []);
        if (map.score > bestScore) {best = i;bestScore = map.score;}
      }
      return bestScore >= 5 ? best : -1;
    }
    function buildTableHeaderMapV49(row) {
      const map = { optionCols: {}, score: 0 };
      (row || []).forEach((cell, idx)=>{
        const field = tableHeaderFieldV49(cell);
        if (!field) {return;}
        if (/^opt[A-G]$/.test(field)) {map.optionCols[field.slice(3)] = idx;map.score += 2;return;}
        if (field === 'options') {map.options = idx;map.score += 2;return;}
        if (map[field] == null) {
          map[field] = idx;
          let fieldScore = 1;
          if (field === 'question') {fieldScore = 5;}
          else if (field === 'answer') {fieldScore = 3;}
          map.score += fieldScore;
        }
      });
      if (Object.keys(map.optionCols).length >= 2) {map.score += 2;}
      return map;
    }
    function compactHeaderV49(s) {return String(s || '').trim().replace(/\s+/g, '').replace(/[：:\-_/（）()[\]【】]/g, '').toLowerCase();}
    function tableHeaderFieldV49(cell) {
      const raw = String(cell || '').trim();if (!raw) {return '';}
      const h = compactHeaderV49(raw);
      const opt = raw.match(/^\s*(?:选项\s*([A-Ga-g])|([A-Ga-g])\s*选项|option\s*([A-Ga-g])|choice\s*([A-Ga-g])|([A-Ga-g]))\s*$/i);
      if (opt) {return 'opt' + String(opt[1] || opt[2] || opt[3] || opt[4] || opt[5]).toUpperCase();}
      if (['题型', '类型', 'questiontype', 'type', 'kind'].includes(h)) {return 'type';}
      if (['题号', '序号', '编号', 'no', 'number', 'num', 'id'].includes(h)) {return 'number';}
      if (['题干', '题目', '问题', 'question', 'stem', 'title', '题目内容'].includes(h)) {return 'question';}
      if (['选项', '选项内容', 'choices', 'options', 'choice', 'option'].includes(h)) {return 'options';}
      if (['答案', '正确答案', '参考答案', '标准答案', '答', 'answer', 'correctanswer', 'rightanswer', 'standardanswer'].includes(h)) {return 'answer';}
      if (['解析', '答案解析', '说明', '解题思路', 'analysis', 'explanation', 'explain'].includes(h)) {return 'analysis';}
      if (['分类', '分组', '章节', '标签', '来源', 'category', 'group', 'topic', 'section'].includes(h)) {return 'category';}
      if (['分值', 'score', 'points', 'point'].includes(h)) {return 'score';}
      if (['难度', 'difficulty', 'level'].includes(h)) {return 'difficulty';}
      return '';
    }
    function tableCellV49(row, idx) {return idx == null ? '' : normalizeTableCellTextV49(row[idx] || '');}
    function tableRowToQuestionV49(row, map, idx, sheetName = '') {
      const rawType = tableCellV49(row, map.type);
      const rawNumber = tableCellV49(row, map.number);
      let question = tableCellV49(row, map.question);
      const answerCell = tableCellV49(row, map.answer);
      let analysis = tableCellV49(row, map.analysis);
      const category = tableCellV49(row, map.category) || sheetName || '';
      if (!question) {return null;}
      const options = [];
      const optionCols = map.optionCols || {};
      'ABCDEFG'.split('').forEach((k)=>{
        const v = tableCellV49(row, optionCols[k]);
        if (v) {options.push({ key: k, text: stripLeadingOptionLabelV49(v, k) });}
      });
      const optionsCell = tableCellV49(row, map.options);
      if (optionsCell) {options.push(...parseTableOptionsCellV49(optionsCell));}
      if (!options.length) {
        const rich = extractInlineOptionsRich(question);
        if (rich && rich.options && rich.options.length >= 2) {
          question = rich.prefix || question;
          options.push(...rich.options.map((o)=>({ key: normalizeOptionKey(o.key), text: o.text || '', correct: !!o.correct })));
        }
      }
      const aa = extractTableAnswerAnalysisV49(answerCell);
      const rawAnswer = aa.answer || answerCell;
      if (!analysis && aa.analysis) {analysis = aa.analysis;}
      const type = normalizeType(rawType) || mapType(rawType) || '';
      const answer = isTextType(type) ? splitTextAnswer(rawAnswer) : splitAnswerByType(rawAnswer, type);
      const correctFromOptions = options.filter((o)=>o.correct).map((o)=>o.key);
      const num = Number(String(rawNumber || '').match(/\d+/)?.[0] || 0) || undefined;
      return { id: makeId('tbl', idx), type, number: num || idx + 1, question, options: options.filter((o)=>o.text), answer: answer.length ? answer : correctFromOptions, analysis, category, group: category, score: tableCellV49(row, map.score) };
    }
    function stripLeadingOptionLabelV49(text, key = '') {
      const k = String(key || '').toUpperCase();
      return String(text || '').trim().replace(new RegExp('^\\s*(?:[（(]\\s*' + k + '\\s*[）)]|' + k + '\\s*[、.．:：])\\s*', 'i'), '').trim();
    }
    function parseTableOptionsCellV49(text) {
      const s = String(text || '').trim();if (!s) {return [];}
      const lines = s.split(/\n+/).map((x)=>x.trim()).filter(Boolean);
      if (lines.length >= 2) {
        const out = lines.flatMap((line)=>parseOptionsText(line));
        if (out.length >= 2) {return mergeDuplicateOptions(repairEmbeddedOptions(out));}
      }
      const rich = extractInlineOptionsRich(s);
      if (rich && rich.options && rich.options.length >= 2) {return mergeDuplicateOptions(repairEmbeddedOptions(rich.options.map((o)=>({ key: normalizeOptionKey(o.key), text: o.text || '', correct: !!o.correct }))));}
      const sem = splitSemicolonOptionsFromLine(s, []);
      if (sem && sem.length >= 2) {return mergeDuplicateOptions(repairEmbeddedOptions(sem));}
      return parseOptionsText(s);
    }
    function extractTableAnswerAnalysisV49(text) {
      const s = String(text || '').trim();if (!s) {return { answer: '', analysis: '' };}
      const m = s.match(/([\s\S]*?)(?:\s*(?:解析|答案解析|说明|解题思路)\s*[:：]\s*)([\s\S]+)$/);
      if (m) {return { answer: m[1].trim(), analysis: m[2].trim() };}
      return { answer: s, analysis: '' };
    }

    return { readTableImportFileV49, tableImportPreviewTextV49 };
  }

  globalThis.ShirohaTableImport = Object.freeze({ create });
})();
