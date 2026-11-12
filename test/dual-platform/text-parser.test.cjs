'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const expected = require('./fixtures/text-parser-expected.json');
const { parseSnapshots, repairSnapshot } = require('./text-parser-cases.cjs');
const { loadWeb, plain } = require('./web-source.cjs');

test('四种策略保留题目、原文元数据、警告和完整诊断', () => {
  assert.deepEqual(parseSnapshots(), expected.cases);
});

test('局部修复只替换异常题，保留前后题及修复报告', () => {
  const result = repairSnapshot();
  assert.equal(result.repaired, 1);
  assert.deepEqual(result, expected.repair);
});

test('诊断构建失败时保留新报告和上一次诊断', () => {
  const marker = 'const diagnostics = { mode: strategyLabel,';
  const { api, context } = loadWeb({
    parserSourceTransform(source) {
      assert.equal(source.split(marker).length, 2);
      return source.replace(marker, `if (globalThis.__failParserDiagnostics) throw new Error('diagnostic failure');\n${marker}`);
    },
  });
  api.parseTextQuestions('1. 首题？\nA. 甲\nB. 乙\n答案：A');
  const previous = api.importState();
  context.__failParserDiagnostics = true;
  assert.throws(() => api.parseTextQuestions('1. 甲？\nA. 甲\nB. 乙\n答案：A\n2. 乙？\nA. 丙\nB. 丁\n答案：B'), /diagnostic failure/);
  const after = api.importState();
  assert.notEqual(after.report, previous.report);
  assert.match(after.report, /最终识别：2题/);
  assert.equal(after.diagnostics, previous.diagnostics);
  assert.equal(after.warnings, previous.warnings);
});

test('导入元数据经对象展开和归一化保留唯一 Symbol 与属性描述', () => {
  const { api, context } = loadWeb();
  const input = { id: 'stable', number: 1, type: 'single', question: '图中为何？', options: [], answer: ['B'] };
  api.attachSourceMetaV58910(input, { sourceStart: 3, sourceEnd: 12, originalNumber: 1 });
  api.attachRecruitmentOptionsV58915(input, [{ key: 'a', text: '甲' }, { key: 'b', text: '乙' }]);
  const symbols = Object.getOwnPropertySymbols(input);
  assert.equal(symbols.length, 2);
  const normalized = api.normalizeQuestion({ ...input });
  assert.deepEqual(new Set(Object.getOwnPropertySymbols(normalized)), new Set(symbols));
  for (const symbol of symbols) {
    const descriptor = Object.getOwnPropertyDescriptor(normalized, symbol);
    assert.equal(descriptor.enumerable, true);
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.configurable, true);
  }
  assert.deepEqual(plain(api.getSourceMetaV58910(normalized)), { sourceStart: 3, sourceEnd: 12, originalNumber: 1 });
  assert.deepEqual(plain(api.getRecruitmentOptionsV58915(normalized)), [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }]);
  const otherParser = context.ShirohaTextParser.create({});
  assert.equal(otherParser.getSourceMetaV58910(normalized), api.getSourceMetaV58910(normalized));
  assert.equal(otherParser.getRecruitmentOptionsV58915(normalized), api.getRecruitmentOptionsV58915(normalized));
  assert.deepEqual(plain(normalized.answer), ['B']);
  assert.equal(JSON.stringify(normalized).includes('sourceStart'), false);
});

test('来源区间的文本起点保留自增时的数值转换', () => {
  const marker = 'const sectionNumberKey = (section, n) =>';
  const { api, context } = loadWeb({
    parserSourceTransform(source) {
      assert.equal(source.split(marker).length, 2);
      return source.replace(marker, `globalThis.__usedSourceBlocks = [...usedBlocks];\n${marker}`);
    },
  });
  const question = { id: 'q1', number: 1, type: 'single', question: '样题？', options: [{ key: 'A', text: '甲' }], answer: ['A'] };
  for (const [start, end, expectedBlocks] of [['1', 3, ['1', 2, 3]], [1n, 3n, [1n, 2n, 3n]]]) {
    const sourceMeta = { sourceBlockStart: start, sourceBlockEnd: end, originalNumber: 1, explicitNumber: true };
    const detailed = { blocks: [{}, {}, {}, {}], pairs: [{ question, sourceMeta }] };
    api.repairMissingAndStuckQuestionsBySourceV58910('', [question], {}, detailed);
    assert.deepEqual(Array.from(context.__usedSourceBlocks), expectedBlocks);
  }
});
