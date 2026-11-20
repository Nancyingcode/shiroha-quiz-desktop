'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { runWebScripts } = require('./source-tools.cjs');

const context = vm.createContext({});
runWebScripts(context, ['banks/metadata.js', 'study/scope.js']);
const { ShirohaBankMetadata: metadata, ShirohaStudyScope: scopeModule } = context;
const plain = (value) => JSON.parse(JSON.stringify(value));
const bank = (id, name, groupName, questions = []) => ({ id, name, groupName, questions });

test('题库分组归一化保留旧字段优先级、显式未分组和同名匹配规则', () => {
  assert.equal(metadata.pickGroupNameFromJson({ groupName: '', bankGroup: '旧组' }), '');
  assert.equal(metadata.pickGroupNameFromJson({ bankGroup: '\t旧\n分组', parentName: '前级' }), '旧 分组');
  assert.equal(metadata.pickGroupNameFromJson({ bankGroup: null, parentName: ' 前级 ', groupTitle: '旧标题' }), '前级');
  assert.equal(metadata.pickGroupNameFromJson({ groupTitle: '  最后别名  ' }), '最后别名');
  assert.equal(metadata.normalizeGroupName('组'.repeat(65)).length, 60);
  assert.equal(metadata.bankPathLabel({ name: '空组题库' }), '未分组 / 空组题库');
  assert.equal(metadata.bankNameKey(' A\tB ', '  TEst '), 'a b::test');
  assert.deepEqual(plain(metadata.groupSuggestions([{ groupName: ' C ' }, { groupName: '' }, { groupName: 'C' }])), ['C']);
});

test('范围读取使用替换后的题库和设置，区分当前设置修复和显式覆盖', () => {
  const first = bank('a', '甲库', '', [{ id: 'a1' }]);
  const second = bank('b', '乙库', '未分组', [{ id: 'b1' }, { id: 'b2' }]);
  const third = bank('c', '丙库', '第三组');
  const state = {
    banks: [first, second, third],
    activeBankId: 'c',
    settings: { practiceScope: { type: 'GROUP', value: ' 未分组 ' } },
  };
  const scope = scopeModule.create({ state });
  assert.deepEqual(plain(scope.current()), { type: 'group', value: '未分组' });
  assert.deepEqual(Array.from(scope.banks()), [first, second]);
  assert.equal(scope.label(), '未分组');
  assert.equal(scope.summary(), '2 个题库 · 3 题');
  assert.equal(scope.activeBank(), third);
  assert.equal(scope.banks({ type: 'group', value: '已删除组' }).length, 0);
  assert.deepEqual(Array.from(scope.banks({ type: 'bank', value: '已删除库' })), [third]);
  assert.deepEqual(plain(state.settings.practiceScope), { type: 'group', value: '未分组' });

  state.banks = [third];
  state.settings = { suppressDefaultBank: true, practiceScope: { type: 'group', value: '未分组' } };
  assert.deepEqual(plain(scope.current()), { type: 'bank', value: 'c' });
  assert.equal(scope.label(), '丙库');
  assert.equal(state.settings.suppressDefaultBank, true);
  state.banks = [];
  state.activeBankId = '';
  state.settings = null;
  assert.deepEqual(plain(scope.current()), { type: 'bank', value: '' });
  assert.equal(scope.banks().length, 0);
  assert.equal(scope.summary(), '0 题');
});

test('设置范围只在有效且主动切换到不同当前库时请求重置分页', () => {
  const state = {
    banks: [bank('a', '甲库', '一组'), bank('b', '乙库', '')],
    activeBankId: 'a',
    settings: { practiceScope: { type: 'bank', value: 'a' } },
  };
  const resetForBanks = [];
  const scope = scopeModule.create({ state, resetPages: () => resetForBanks.push(state.activeBankId) });
  assert.equal(scope.setBank('missing'), false);
  assert.equal(scope.setGroup('missing'), false);
  assert.equal(scope.setBank('b', false), true);
  assert.equal(state.activeBankId, 'a');
  assert.deepEqual(plain(state.settings.practiceScope), { type: 'bank', value: 'b' });
  assert.equal(scope.setGroup('  未分组  '), true);
  assert.equal(state.activeBankId, 'a');
  assert.deepEqual(plain(state.settings.practiceScope), { type: 'group', value: '未分组' });
  assert.equal(scope.setBank('a'), true);
  assert.deepEqual(resetForBanks, []);
  assert.equal(scope.setBank('b'), true);
  assert.equal(scope.setBank('b'), true);
  assert.deepEqual(resetForBanks, ['a']);
  assert.equal(state.activeBankId, 'b');
  assert.deepEqual(plain(state.settings.practiceScope), { type: 'bank', value: 'b' });
});

test('历史重复 ID 沿用本轮后缀算法，真实来源独立于本轮题目键', () => {
  const duplicates = ['q', 'q#1', 'q', 'q#2', 'q'].map((id) => ({ id }));
  const first = bank('a', '甲库', '', duplicates);
  const second = bank('a#q', '乙库', '二组', [{ id: '1' }]);
  const state = { banks: [first, second], activeBankId: 'a' };
  const scope = scopeModule.create({ state });
  const items = scopeModule.itemsForBanks(state.banks);
  assert.deepEqual(Array.from(items, scope.itemKey), ['a#q', 'a#q#1', 'a#q#2', 'a#q#2#1', 'a#q#3', 'a#q#1#1']);
  assert.equal(scopeModule.question(items[2]), duplicates[2]);
  assert.deepEqual(plain(scope.questionRef(items[2])), { bankId: 'a', questionId: 'q' });
  assert.deepEqual(plain(scope.questionRef(items[5])), { bankId: 'a#q', questionId: '1' });
  assert.equal(scope.itemBankName(items[5]), '乙库');
  assert.equal(scope.itemKey(duplicates[0]), 'a#q');
  assert.equal(scope.bankQuestionNumber(items[5]), 1);
  state.banks = [first];
  assert.equal(scope.bankQuestionNumber(items[5]), null);
});
