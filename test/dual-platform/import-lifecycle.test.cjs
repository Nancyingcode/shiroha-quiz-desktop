'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { runWebScripts } = require('./source-tools.cjs');

function fixture() {
  const events = [];
  const fields = {
    '#import-text': { value: '旧文本', dataset: { tableImportV49: '1' } },
    '#dual-question-text': { value: '' },
    '#dual-answer-text': { value: '' },
  };
  const context = vm.createContext({ document: { querySelector: (name) => fields[name] } });
  runWebScripts(context, ['import-preview.js']);
  const draft = context.ShirohaImportPreview.create({
    readers: {
      readTable: async () => ({ questions: ['表格'] }),
      readDocx: async () => 'Word 正文',
      readPdf: async () => { throw new Error('损坏'); },
      readText: async () => '文本内容',
    },
    ocr: {
      setOcrImportSource: (file) => events.push(['source', file.name]),
      setOcrStatus: (message) => events.push(['ocr', message]),
    },
    setBankName: (name) => events.push(['name', name]),
    toast: (message) => events.push(['toast', message]),
    applyTable: (result, name) => events.push(['table', result, name]),
  });
  draft.sourceMeta = { name: '旧文件', size: 3, type: 'text' };
  draft.tableResult = { old: true };
  return { draft, events, fields };
}

test('取消选择保留草稿；表格读取进入预览入口', async () => {
  const { draft, events } = fixture();
  await draft.readImportFile({ target: { files: [] } });
  assert.equal(draft.tableResult.old, true);
  assert.deepEqual(events, []);
  await draft.readImportFile({ target: { files: [{ name: '自建.csv', size: 0, type: 'text/csv' }] } });
  assert.deepEqual(events.map((event) => event[0]), ['name', 'source', 'toast', 'table']);
  assert.deepEqual(JSON.parse(JSON.stringify(draft.sourceMeta)), { name: '自建.csv', size: 0, type: 'text/csv' });
});

test('PDF 读取失败保留原文本和题目草稿并提示 OCR；双文件按原顺序累加大小', async () => {
  const { draft, events, fields } = fixture();
  await draft.readImportFile({ target: { files: [{ name: '损坏.pdf', size: 5, type: '' }] } });
  assert.equal(fields['#import-text'].value, '旧文本');
  assert.equal(draft.tableResult, null);
  assert.match(events.find((event) => event[0] === 'ocr')[1], /损坏/);
  await draft.readDualFile({ target: { files: [{ name: '题目.docx', size: 4 }] } }, 'question');
  assert.equal(fields['#dual-question-text'].value, 'Word 正文');
  assert.deepEqual(JSON.parse(JSON.stringify(draft.sourceMeta)), { name: '题目.docx', size: 9, type: 'dual' });
});

test('AI 失败恢复原草稿引用；单文件与双文件清空保持原有字段边界', () => {
  const { draft } = fixture();
  const questions = [{ question: '草稿', score: 0, enabled: false }];
  const { selected } = draft;
  selected.add(0);
  draft.questions = questions;
  draft.warnings = ['需核对'];
  draft.report = '报告';
  draft.filter = 'all';
  const previous = draft.snapshot();
  draft.questions = [];
  draft.selected = new Set();
  draft.restore(previous);
  assert.equal(draft.questions, questions);
  assert.equal(draft.selected, selected);
  assert.equal(draft.questions[0].score, 0);
  assert.equal(draft.questions[0].enabled, false);
  draft.clearDual();
  assert.equal(draft.questions.length, 0);
  assert.equal(draft.selected.size, 0);
  assert.equal(draft.tableResult.old, true);
  assert.equal(draft.report, '报告');
  assert.equal(draft.filter, 'all');
  draft.clearSingle();
  assert.equal(draft.tableResult, null);
});
