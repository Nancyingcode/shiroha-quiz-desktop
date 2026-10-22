'use strict';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const IMAGE = `data:image/png;base64,${PNG_BASE64}`;
const TIME = '2026-10-23T00:00:00.000Z';
const MILLIS = Date.parse(TIME);
const FAKE_SECRETS = {
  ai: 'fake-a2-ai-secret-do-not-export',
  webdav: 'fake-a2-webdav-secret-do-not-export',
  mineru: 'fake-a2-mineru-token-do-not-export',
  reference: 'fake-a2-system-credential-reference',
};
const fakeStorage = {
  shiroha_ai_key_local_v99: FAKE_SECRETS.ai,
  shiroha_webdav_password_local_v378: FAKE_SECRETS.webdav,
  shiroha_webdav_config_local_v378: JSON.stringify({ endpoint: 'https://dav.example.invalid', username: 'fixture', remoteDir: 'backups' }),
  fixture_mineru_token: FAKE_SECRETS.mineru,
  fixture_credential_reference: FAKE_SECRETS.reference,
};

function image(id = 'shared-image', source = IMAGE) {
  return { id, localPath: source, dataUrl: source, sourceName: `${id}.png`, order: 1, width: 1, height: 1, sizeBytes: Buffer.from(PNG_BASE64, 'base64').length };
}

function questions() {
  return [
    { id: 'same-id', number: '1', type: 'single', question: '一加一等于多少？', options: [{ key: 'A', text: '二' }, { key: 'B', text: '三' }], answer: ['A'], analysis: '答案：A。整数加法。', score: 2, category: '单选题' },
    { id: 'multiple', number: '1', type: 'multiple', question: '下列哪些是偶数？', options: [{ key: 'A', text: '二' }, { key: 'B', text: '三' }, { key: 'C', text: '四' }], answer: ['A', 'C'], analysis: '答案：AC。二和四是偶数。', score: 3, category: '多选题' },
    { id: 'judge', number: '1', type: 'judge', question: '一加一等于二。（ ）', options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: ['A'], analysis: '', score: 1, category: '判断题' },
    { id: 'blank', number: '2', type: 'blank', question: '首都为___，简称为___。', options: [], answer: ['北京；京'], blankAnswers: [['北京', '北京市'], ['京']], analysis: '', score: 4, category: '填空题' },
    { id: 'short', number: '3', type: 'short', question: '简述先保存再退出的步骤。', options: [], answer: ['先保存\n再退出'], analysis: '由用户核对后自评。', score: 5, category: '简答题' },
    { id: 'unanswered', number: '4', type: 'single', question: '这道题未提供答案，请人工核对。', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [], analysis: '', category: '单选题' },
    { id: 'rich', number: '5', type: 'single', question: `材料：记录温度为 $x^2$。\n![题干图](${IMAGE})\n求观测结果。`, options: [{ key: 'A', text: `![选项图](${IMAGE})` }, { key: 'B', text: '**文字选项**' }], answer: ['A'], analysis: `答案：A。公式 $x^2$。\n![解析图](${IMAGE})`, images: [image()], score: 2, category: '材料题', richContent: { version: 'shiroha-web-rich-v1', fields: { question: { markdown: `材料：记录温度为 $x^2$。\n![题干图](${IMAGE})\n求观测结果。` } } }, extensions: { fixture: { materialId: 'material-1', value: '必须保留的合法扩展' } } },
  ];
}

function webState() {
  const first = questions();
  const historical = { id: 'deleted-question', number: '8', type: 'blank', question: '历史图片___。', options: [], answer: ['保全'], analysis: '', images: [image('history-image')] };
  return {
    schemaVersion: 1,
    banks: [
      { id: 'bank-a', name: '阶段A全题型', groupName: '自建样本', createdAt: TIME, updatedAt: TIME, questions: first, extensions: { fixture: '题库扩展' } },
      { id: 'bank-b', name: '跨题库同ID', groupName: '自建样本', createdAt: TIME, updatedAt: TIME, questions: [{ ...first[0], question: '第二题库同 ID，但答案不同。', answer: ['B'] }] },
    ],
    activeBankId: 'bank-a',
    wrongBook: { 'bank-a': [{ id: 'deleted-question', wrongCount: 2, rightCount: 1, reviewRightCount: 1, streakCorrectCount: 1, lastWrongAt: TIME, lastCorrectAt: TIME, lastReviewedAt: TIME, nextReviewAt: '2026-10-24T00:00:00.000Z', reviewLevel: 1, lastAnswer: ['遗失'], source: 'fixture', timestamp: MILLIS, status: '复习中', nativeQuestion: historical }] },
    favorites: { 'bank-a': ['deleted-question'], 'bank-b': ['same-id'] },
    records: [{ id: 'record-1', mode: '考试', bankId: 'bank-a', bankName: '阶段A全题型', date: TIME, total: 2, answered: 2, correct: 1, wrong: 1, accuracy: 50, duration: 30, score: 4, totalScore: 5, details: [
      { questionId: 'blank', question: first[3].question, type: 'blank', chosen: ['北京市', '京'], userAnswer: ['北京市', '京'], userBlankAnswers: ['北京市', '京'], blankAnswers: [['北京', '北京市'], ['京']], answer: ['北京；京'], correct: true, score: 4, fullScore: 4, sourceBankId: 'bank-a', sourceBankName: '阶段A全题型', nativeQuestion: first[3] },
      { questionId: 'deleted-question', question: historical.question, type: 'blank', chosen: ['遗失'], userAnswer: ['遗失'], answer: ['保全'], correct: false, score: 0, fullScore: 1, sourceBankId: 'bank-a', sourceBankName: '阶段A全题型', nativeQuestion: historical },
    ] }],
    settings: { suppressDefaultBank: true, aiImportV99: { provider: 'custom', endpoint: 'https://ai.example.invalid/v1/chat/completions', model: 'fixture-model', rememberKey: false } },
    crossPlatformMeta: { favoriteQuestions: { 'bank-a': { 'deleted-question': { favoritedAt: MILLIS, question: historical } } } },
  };
}

function androidBackup() {
  const question = { id: 'native-blank', number: '1', type: 'BLANK', question: '首都___，简称___。', options: [], answer: ['北京；京'], blankAnswers: [['北京', '北京市'], ['京']], analysis: '', images: [{ id: 'native-image', localPath: 'assets/pixel.png', sourceName: 'pixel.png', order: 1, width: 1, height: 1, sizeBytes: Buffer.from(PNG_BASE64, 'base64').length }], score: 4, version: 1 };
  return {
    app: 'Shiroha Quiz', kind: 'shiroha_quiz_full_backup', version: 3, schemaVersion: 3, crossPlatformSchemaVersion: 1, exportedBy: 'native', exportedAt: MILLIS, activeBankId: 'native-bank',
    banks: [{ id: 'native-bank', name: 'Android 自建兼容样本', groupName: '互通', createdAt: MILLIS, updatedAt: MILLIS, questions: [question] }],
    wrongBook: [{ bankId: 'native-bank', bankName: 'Android 自建兼容样本', question, wrongCount: 2, rightCount: 1, reviewRightCount: 1, streakCorrectCount: 1, lastWrongAt: MILLIS, lastCorrectAt: MILLIS, timestamp: MILLIS, lastAnswer: ['南京', '宁'], status: '复习中' }],
    favoriteQuestions: [{ bankId: 'native-bank', bankName: 'Android 自建兼容样本', question, favoritedAt: MILLIS }],
    studyRecords: [{ id: 'native-record', bankId: 'native-bank', bankName: 'Android 自建兼容样本', source: 'practice', title: '练习', total: 1, correct: 1, timestamp: MILLIS, durationSeconds: 8, earnedScore: 4, totalScore: 4, questionResults: [{ question, userAnswer: ['北京市', '京'], userBlankAnswers: ['北京市', '京'], answerText: '北京；京', correct: true, earnedScore: 4, maxScore: 4, autoScored: true, sourceBankId: 'native-bank', sourceBankName: 'Android 自建兼容样本' }] }],
    slashedQuestions: [],
  };
}

module.exports = { IMAGE, PNG_BASE64, TIME, MILLIS, FAKE_SECRETS, fakeStorage, image, questions, webState, androidBackup };
