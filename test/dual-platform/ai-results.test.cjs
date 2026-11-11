'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { runWebScripts } = require('./source-tools.cjs');

function results() {
  const context = vm.createContext({});
  runWebScripts(context, ['ai-results.js']);
  return context.ShirohaAiResults.create({
    normalizeType: (type) => type,
    normalizeQuestion: (question) => ({ ...question, options: question.options || [], answer: question.answer || [] }),
    makeId: (_prefix, index) => `fixture-${index}`,
    trimMultilineBoundaryV5910: (value) => String(value).trim(),
    splitAnswer: (value) => String(value || '').split(',').filter(Boolean),
  });
}

test('AI 结果模式保留显式别名、结构推断及文本兜底', () => {
  const api = results();
  const question = { question: '样题', type: 'single', options: [{ key: 'A', text: '选项' }], answer: ['A'] };
  for (const mode of ['direct_questions', 'structured_questions', 'structured', 'questions', '']) {
    const parsed = api.parseAiRefactorPayloadV384(JSON.stringify({ mode, questions: [question] }));
    assert.equal(parsed.mode, 'direct_questions');
    assert.equal(parsed.structuredUsable, true);
    assert.equal(parsed.questions[0].question, '样题');
  }
  for (const mode of ['clean_text', 'cleaned_text', 'cleantext', '']) {
    const parsed = api.parseAiRefactorPayloadV384(JSON.stringify({ mode, cleanedText: ' 文本 ' }));
    assert.equal(parsed.mode, 'clean_text');
    assert.equal(parsed.cleanedText, '文本');
    assert.equal(parsed.structuredUsable, false);
  }
});

test('单题结果区分答案匹配的缺省、null、false 和 true', () => {
  const api = results();
  for (const value of [undefined, null, false, true]) {
    const parsed = api.parseAiSingleAnalysisV613(JSON.stringify({ analysis: '解析', confidence: 'HIGH', needsReview: false, matchesLocalAnswer: value }));
    assert.equal(parsed.matchesLocalAnswer, typeof value === 'boolean' ? value : null);
    assert.equal(parsed.needsReview, value === false);
  }
  assert.equal(api.parseAiSingleAnalysisV613('{"analysis":"解析","confidence":"HIGH"}').needsReview, true);
  assert.equal(api.parseAiSingleAnalysisV613('{"analysis":"解析","confidence":"unknown","needsReview":false}').needsReview, true);
  assert.equal(api.parseAiSingleFollowUpV381('{"reply":"追问","revisedAnalysis":"解析","confidence":"HIGH","needsReview":false}').needsReview, false);
  for (const [confidence, needsReview, expected] of [
    ['HIGH', false, false], ['MEDIUM', false, false], ['LOW', false, true],
    ['unknown', false, true], ['HIGH', true, true], ['HIGH', undefined, true],
  ]) {
    const common = { confidence, needsReview };
    assert.equal(api.parseAiSingleAnalysisV613(JSON.stringify({ ...common, analysis: '解析' })).needsReview, expected);
    assert.equal(api.parseAiSingleFollowUpV381(JSON.stringify({ ...common, reply: '追问', revisedAnalysis: '解析' })).needsReview, expected);
  }
});

test('批量解析的缺省核对标记与明确 false 保持区别', () => {
  const api = results();
  const batch = [{ id: 'question', index: 0, question: {} }];
  assert.equal(api.normalizeAiAnalysisResultV991({ id: 'question', analysis: '解析' }, batch).needsReview, true);
  assert.equal(api.normalizeAiAnalysisResultV991({ id: 'question', analysis: '解析', needsReview: false }, batch).needsReview, false);
  assert.equal(api.normalizeAiAnalysisResultV991({ id: 'missing', index: 9 }, batch), null);
});

test('HTTP 分类保留认证、地址、限流及服务端错误', () => {
  const api = results();
  assert.match(api.aiHttpErrorMessage(401, ''), /鉴权/);
  assert.match(api.aiHttpErrorMessage(403, ''), /鉴权/);
  assert.match(api.aiHttpErrorMessage(404, ''), /路径/);
  assert.match(api.aiHttpErrorMessage(429, ''), /频繁|额度/);
  assert.match(api.aiHttpErrorMessage(503, ''), /内部错误/);
  assert.equal(api.aiHttpErrorMessage(400, '错误详情'), 'AI 接口返回 HTTP 400：错误详情');
});

test('HTTP 错误详情保留对象的默认转换提示', () => {
  const hints = [];
  const detail = { [Symbol.toPrimitive](hint) { hints.push(hint);return hint; } };
  assert.equal(results().aiHttpErrorMessage(400, detail), 'AI 接口返回 HTTP 400：default');
  assert.deepEqual(hints, ['default']);
});

test('结果带未知 ID 时不能改用有效序号归属到其他题', () => {
  const api = results();
  const batch = [{ id: 'B', index: 1, question: {} }, { id: 'D', index: 3, question: {} }];
  assert.equal(api.normalizeAiAnalysisResultV991({ id: 'unknown', index: 2, analysis: '误归属' }, batch), null);
  assert.equal(api.normalizeAiAnalysisResultV991({ index: 4, analysis: '按发送题号' }, batch).questionId, 'D');
});
