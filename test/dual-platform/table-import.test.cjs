'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadWeb, plain } = require('./web-source.cjs');

test('CSV 引号、跨行、重复表头与分值保持现有题目和警告', async () => {
  const { api } = loadWeb({ deterministicIds: true });
  const text = '\uFEFF题号,题干,A,B,答案,分值\n1,"第一行,内容\n第二行","A. 甲","B. 乙",A,0\n题号,题干,A,B,答案,分值\n2,第二题,甲,乙,B,2';
  const result = plain(await api.readTableImportFileV49({ name: '自建.csv', text: async () => text }));
  assert.equal(result.questions.length, 2);
  assert.deepEqual(result.questions.map((q) => [q.number, q.question, q.answer, q.score]), [
    [1, '第一行,内容 第二行', ['A'], undefined],
    [2, '第二题', ['B'], undefined],
  ]);
  assert.deepEqual(result.questions[0].options.map((o) => o.text), ['甲', '乙']);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.sheets, [{ sheetName: 'CSV', rows: 4 }]);
});

test('XLSX 共享字符串、稀疏列和工作簿关系读取同一表格规则', async () => {
  const { api } = loadWeb({ deterministicIds: true });
  const blob = api.zipStoreFiles([
    { name: 'xl/workbook.xml', text: '<workbook><sheet name="自建&amp;表" r:id="r1"/></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', text: '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', text: '<sst><si><t>题干</t></si><si><t>答案</t></si><si><r><t>自建</t></r><r><t>题目</t></r></si></sst>' },
    { name: 'xl/worksheets/sheet1.xml', text: '<worksheet><row><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row><c r="A2" t="s"><v>2</v></c><c r="C2" t="inlineStr"><is><t>甲</t></is></c></row></worksheet>' },
  ]);
  const result = plain(await api.readTableImportFileV49({ name: '自建.xlsx', arrayBuffer: () => blob.arrayBuffer() }));
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].question, '自建题目');
  assert.deepEqual(result.questions[0].answer, []);
  assert.deepEqual(result.sheets, [{ sheetName: '自建&表', rows: 2 }]);
  assert.deepEqual(result.warnings, []);
});
