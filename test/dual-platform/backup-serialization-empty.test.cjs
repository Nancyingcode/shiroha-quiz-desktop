'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadWeb, plain } = require('./web-source.cjs');
const { androidBackup, IMAGE, MILLIS } = require('./fixtures/dataset.cjs');

function serializedQuestion(question) {
  const source = JSON.stringify(question);
  const { api } = loadWeb();
  const result = plain(api.serializeBankForCrossExportV53({ id: 'empty-images-bank', questions: [question] })).questions[0];
  assert.equal(JSON.stringify(question), source, '序列化不得修改输入题目');
  return result;
}

const baseQuestion = { id: 'empty-images-question', type: 'single', question: '无图题目', options: [], answer: ['A'] };

test('跨端序列化保留题目自有空图片数组', () => {
  const output = serializedQuestion({ ...baseQuestion, images: [] });
  assert.equal(Object.hasOwn(output, 'images'), true);
  assert.deepEqual(output.images, []);
});

test('跨端序列化保留缺少图片字段的状态', () => {
  const output = serializedQuestion({ ...baseQuestion });
  assert.equal(Object.hasOwn(output, 'images'), false);
});

test('跨端序列化仍清理无效的非空图片内容', () => {
  for (const images of [null, [null, {}, { localPath: '' }]]) {
    const output = serializedQuestion({ ...baseQuestion, images });
    assert.equal(Object.hasOwn(output, 'images'), false);
  }
});

test('跨端序列化从题干图片生成资产而不受空数组阻断', () => {
  const output = serializedQuestion({ ...baseQuestion, question: `题干\n![图](${IMAGE})`, images: [] });
  assert.equal(output.images.length, 1);
  assert.equal(output.images[0].dataUrl, IMAGE);
});

async function historyWithDifferentCurrentQuestion() {
  const currentQuestion = {
    id: 'native-blank', number: '1', type: 'BLANK', question: '题库中的新题干。', options: [],
    answer: ['当前答案'], blankAnswers: [['当前答案']], analysis: '', images: [], score: 4, version: 1,
  };
  const wrongHistory = {
    ...currentQuestion, question: '错题条目保存的旧题干。', answer: ['旧错题答案'],
    blankAnswers: [['旧错题答案']], extensions: { history: '错题原始信息' },
  };
  const favoriteHistory = {
    ...currentQuestion, question: '收藏条目保存的旧题干。', answer: ['旧收藏答案'],
    blankAnswers: [['旧收藏答案']], extensions: { history: '收藏原始信息' },
  };
  const wrongOrphan = { ...wrongHistory, id: 'deleted-wrong', question: '孤儿错题快照。' };
  const favoriteOrphan = { ...favoriteHistory, id: 'deleted-favorite', question: '孤儿收藏快照。' };
  const source = plain(androidBackup());
  source.banks[0].questions[0] = structuredClone(currentQuestion);
  source.wrongBook[0].question = structuredClone(wrongHistory);
  source.wrongBook.push({ ...source.wrongBook[0], question: structuredClone(wrongOrphan), wrongCount: 5 });
  source.favoriteQuestions[0].question = structuredClone(favoriteHistory);
  source.favoriteQuestions.push({ ...source.favoriteQuestions[0], question: structuredClone(favoriteOrphan), favoritedAt: MILLIS + 1000 });
  source.studyRecords[0].questionResults[0].question.images = [];
  const original = plain(source);
  const first = loadWeb().api;
  const initial = plain(first.normalizeBackupPayloadV23(source, 'history.json'));
  const { api } = loadWeb({ state: initial });
  const beforeExport = api.snapshot();
  const webPayload = plain(api.buildBackupPayloadV23(beforeExport.banks, 'all_data', true));
  const fromWeb = plain(api.normalizeBackupPayloadV23(webPayload, 'web-history.json'));
  const archive = api.buildNativeCompatibleBackupZipV611();
  const read = await api.readBackupFileV24({ name: 'history.zip', arrayBuffer: () => archive.blob.arrayBuffer() });
  const final = plain(api.normalizeBackupPayloadV23(JSON.parse(read.text), 'history.zip'));
  const currentExport = {
    ...currentQuestion, volume: '', group: '', category: '', subject: '', grade: '', difficulty: '',
    knowledgePoints: [], tags: [], source: '', sourceFileId: '', reviewStatus: 'approved', aiConfidence: null,
    warnings: [], normalized: '题库中的新题干',
  };
  assert.deepEqual(source, original);
  assert.deepEqual(api.snapshot(), beforeExport);
  assert.deepEqual(plain(read.assets), {});
  for (const key of ['wrongBook', 'favorites', 'records', 'crossPlatformMeta']) {
    assert.deepEqual(fromWeb[key], initial[key], `Web JSON ${key}`);
  }
  assert.deepEqual(final.records, initial.records);
  return { initial, exported: plain(archive.payload.crossPlatform), currentExport, wrongHistory, favoriteHistory, wrongOrphan, favoriteOrphan };
}

function expectedWrongEntry(question, wrongCount) {
  return {
    bankId: 'native-bank', bankName: 'Android 自建兼容样本', question, lastAnswer: ['南京', '宁'],
    source: 'native', timestamp: MILLIS, wrongCount, rightCount: 1, reviewRightCount: 1, streakCorrectCount: 1,
    lastWrongAt: MILLIS, lastCorrectAt: MILLIS, status: '复习中', lastReviewedAt: null, nextReviewAt: null, reviewLevel: 0,
  };
}

for (const category of ['wrongBook', 'favoriteQuestions']) {
  test(`原生 ZIP 中${category}优先当前题并保留孤儿回退`, async () => {
    const fixture = await historyWithDifferentCurrentQuestion();
    if (category === 'wrongBook') {
      assert.deepEqual(fixture.initial.wrongBook['native-bank'][0].nativeQuestion, fixture.wrongHistory);
      assert.deepEqual(fixture.initial.wrongBook['native-bank'][1].nativeQuestion, fixture.wrongOrphan);
      assert.deepEqual(fixture.exported.wrongBook, [
        expectedWrongEntry(fixture.currentExport, 2), expectedWrongEntry(fixture.wrongOrphan, 5),
      ]);
    } else {
      const initialMeta = fixture.initial.crossPlatformMeta.favoriteQuestions['native-bank'];
      assert.deepEqual(initialMeta, {
        'native-blank': { favoritedAt: MILLIS, question: fixture.favoriteHistory },
        'deleted-favorite': { favoritedAt: MILLIS + 1000, question: fixture.favoriteOrphan },
      });
      assert.deepEqual(fixture.exported.favoriteQuestions, [
        { question: fixture.currentExport, bankId: 'native-bank', bankName: 'Android 自建兼容样本', favoritedAt: MILLIS },
        { question: fixture.favoriteOrphan, bankId: 'native-bank', bankName: 'Android 自建兼容样本', favoritedAt: MILLIS + 1000 },
      ]);
    }
  });
}
