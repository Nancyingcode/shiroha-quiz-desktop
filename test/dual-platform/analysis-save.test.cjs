'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const test = require('node:test');
const { runWebScripts } = require('./source-tools.cjs');
const { plain } = require('./web-source.cjs');

function setup(changeSource) {
  const context = vm.createContext({});
  runWebScripts(context, ['questions/rich-content.js', 'ai-prompts.js', 'ai/analysis-save.js']);
  const fromItem = (item) => (typeof item.question === 'object' ? item.question : item);
  const { aiSingleFingerprintV613: fingerprint } = context.ShirohaAiPrompts.create({ question: fromItem });
  const rich = {
    buildField: context.ShirohaRichContent.buildRichContentFieldV57,
    schema: context.ShirohaRichContent.RICH_CONTENT_VERSION_V57,
  };
  const q = {
    id: 'same-id', type: 'single', question: '当前题干', options: [], answer: ['A'], analysis: '旧解析', score: 1,
  };
  const bankId = 'source-bank';
  const bank = { id: bankId, questions: [q] };
  const state = {
    banks: [bank, { id: 'other-bank', questions: [q] }],
    wrongBook: {},
    records: [{ review: { items: [{ question: q }] } }],
  };
  const practiceQuestion = { ...q, score: 6, extension: { fixture: '练习' } };
  const examQuestion = { ...q, score: 9, extension: { fixture: '考试' } };
  const detachedQuestion = { ...q, question: '历史期间的旧题干' };
  const practiceItem = { bankId, question: practiceQuestion };
  const examItem = { bankId, question: examQuestion };
  const oldItem = { bankId, question: detachedQuestion };
  const anotherItem = { bankId: 'other-bank', question: q };
  const practice = { current: () => ({ items: [practiceItem, oldItem, anotherItem] }) };
  const exam = { current: { items: [examItem] } };
  const draft = {
    item: { bankId, question: q }, requestId: 1, analysis: { analysis: '确认稿' }, fingerprint: fingerprint(q),
  };
  let writes = 0;
  const actions = context.ShirohaAiAnalysisSave.create({
    state,
    practice,
    exam,
    question: { fromItem, bankId: (entry) => entry.bankId, fingerprint },
    rich,
    storage: {
      load: async () => true,
      transaction: (action) => action(),
      save: async () => {
        writes += 1;
      },

      revision: () => writes,
    },
    view: { review() {} },
    confirm: async () => {
      bank.questions = changeSource(q);
      return true;
    },

    now: () => '2026-11-19T00:00:00.000Z',
  });
  return {
    q,
    state,
    draft,
    items: { practiceItem, examItem, oldItem, anotherItem },
    initial: { practiceQuestion, examQuestion, detachedQuestion },
    save: () => actions.saveReview(draft, () => true),
    writes: () => writes,
  };
}

test('确认后重新定位当前原题，练习与考试保持各自分值、题目扩展和历史记录', async () => {
  const t = setup((q) => [{ ...q, score: 3, extension: { fixture: '新原题' } }]);
  const before = structuredClone(t.state.records);
  assert.equal(await t.save(), true);
  assert.equal(t.writes(), 1);
  assert.deepEqual(plain(t.state.banks[0].questions[0]), {
    ...t.q, score: 3, extension: { fixture: '新原题' }, analysis: '确认稿',
  });
  assert.deepEqual(plain(t.items.practiceItem.question), { ...t.initial.practiceQuestion, analysis: '确认稿' });
  assert.deepEqual(plain(t.items.examItem.question), { ...t.initial.examQuestion, analysis: '确认稿' });
  assert.equal(t.items.oldItem.question, t.initial.detachedQuestion);
  assert.equal(t.items.anotherItem.question, t.q);
  assert.equal(t.state.banks[1].questions[0], t.q);
  assert.deepEqual(t.state.records, before);
});

for (const [label, changeSource, message] of [
  ['原题被删除', () => [], /来源题库或题目不存在/],
  ['原题正文变化', (q) => [{ ...q, question: '新的题干' }], /来源题目已发生变化/],
  ['原解析被替换', (q) => [{ ...q, analysis: '新的本地解析' }], /来源解析已发生变化/],
  ['出现同 ID 同指纹题', (q) => [q, { ...q }], /来源题目已发生变化/],
]) {
  test(`确认期间${label}时保留草稿且零写入`, async () => {
    const t = setup(changeSource);
    assert.equal(await t.save(), false);
    assert.equal(t.writes(), 0);
    assert.equal(t.draft.analysis.analysis, '确认稿');
    assert.match(t.draft.error, message);
    assert.equal(t.items.practiceItem.question, t.initial.practiceQuestion);
    assert.equal(t.items.examItem.question, t.initial.examQuestion);
  });
}
