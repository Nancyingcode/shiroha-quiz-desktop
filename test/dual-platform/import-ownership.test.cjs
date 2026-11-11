'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { runWebScripts } = require('./source-tools.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok;reject = fail; });
  return { promise, resolve, reject };
}

function fixture() {
  const pending = new Map();
  const fields = {
    '#import-text': { value: '旧文本', dataset: {} },
    '#dual-question-text': { value: '旧题目' },
    '#dual-answer-text': { value: '旧答案' },
  };
  const events = [];
  const read = (file) => pending.get(file.name).promise;
  const context = vm.createContext({ document: { querySelector: (name) => fields[name] } });
  runWebScripts(context, ['import-preview.js']);
  const draft = context.ShirohaImportPreview.create({
    readers: { readText: read, readDocx: read, readPdf: read, readTable: read },
    ocr: { setOcrImportSource: (file) => events.push(['source', file.name]), setOcrStatus: (message) => events.push(['ocr', message]) },
    setBankName: (name) => events.push(['name', name]),
    applyTable: (result, name) => events.push(['table', name, result]),
    toast: (message) => events.push(['toast', message]),
  });
  const file = (name) => {
    const result = deferred();
    pending.set(name, result);
    return { event: { target: { files: [{ name, size: 1, type: '' }] } }, ...result };
  };
  return { draft, fields, events, file };
}

for (const ext of ['txt', 'docx', 'pdf', 'csv', 'xlsx']) {
  test(`单文件 ${ext} 重选后旧成功与旧失败不能改写当前内容或提示`, async () => {
    const { draft, fields, events, file } = fixture();
    const older = file(`旧.${ext}`);
    const newer = file('新.txt');
    const oldRead = draft.readImportFile(older.event);
    const newRead = draft.readImportFile(newer.event);
    newer.resolve('新文件内容');
    await newRead;
    const before = events.length;
    older.resolve(ext === 'csv' || ext === 'xlsx' ? { questions: ['旧题'] } : '旧文件内容');
    await oldRead;
    assert.equal(fields['#import-text'].value, '新文件内容');
    assert.equal(events.length, before);
    assert.equal(draft.sourceMeta.name, '新.txt');

    const failed = file(`失败.${ext}`);
    const current = file('当前.txt');
    const failedRead = draft.readImportFile(failed.event);
    const currentRead = draft.readImportFile(current.event);
    current.resolve('当前内容');
    await currentRead;
    const afterCurrent = events.length;
    failed.reject(new Error('旧错误'));
    await failedRead;
    assert.equal(fields['#import-text'].value, '当前内容');
    assert.equal(events.length, afterCurrent);
  });
}

test('清空、手动编辑各自废弃单文件迟到结果，当前错误仍提示', async () => {
  const { draft, fields, events, file } = fixture();
  const old = file('旧.pdf');
  const read = draft.readImportFile(old.event);
  fields['#import-text'].value = '';
  draft.clearSingle();
  const before = events.length;
  old.reject(new Error('旧错误'));
  await read;
  assert.equal(fields['#import-text'].value, '');
  assert.equal(events.length, before);

  const edited = file('编辑.docx');
  const pending = draft.readImportFile(edited.event);
  fields['#import-text'].value = '手动内容';
  draft.invalidateRead('single');
  const afterEdit = events.length;
  edited.resolve('迟到正文');
  await pending;
  assert.equal(fields['#import-text'].value, '手动内容');
  assert.equal(events.length, afterEdit);

  const failed = file('当前.pdf');
  const current = draft.readImportFile(failed.event);
  failed.reject(new Error('当前错误'));
  await current;
  assert(events.some(([kind, message]) => kind === 'ocr' && message.includes('当前错误')));
  assert(events.some(([kind, message]) => kind === 'toast' && message.includes('当前错误')));
});

test('双文件各槽位并行，同槽位重选、编辑和清空丢弃迟到结果', async () => {
  const { draft, fields, events, file } = fixture();
  const oldQuestion = file('旧题.docx');
  const question = file('新题.docx');
  const answer = file('答案.pdf');
  const oldRead = draft.readDualFile(oldQuestion.event, 'question');
  const questionRead = draft.readDualFile(question.event, 'question');
  const answerRead = draft.readDualFile(answer.event, 'answer');
  answer.resolve('新答案');
  question.resolve('新题目');
  await Promise.all([questionRead, answerRead]);
  const before = events.length;
  oldQuestion.resolve('旧题目迟到');
  await oldRead;
  assert.equal(fields['#dual-question-text'].value, '新题目');
  assert.equal(fields['#dual-answer-text'].value, '新答案');
  assert.equal(events.length, before);

  const edited = file('旧答案.txt');
  const pending = draft.readDualFile(edited.event, 'answer');
  fields['#dual-answer-text'].value = '手动答案';
  draft.invalidateRead('answer');
  edited.resolve('旧答案迟到');
  await pending;
  assert.equal(fields['#dual-answer-text'].value, '手动答案');

  const lateQuestion = file('清空题.txt');
  const lateAnswer = file('清空答案.txt');
  const qRead = draft.readDualFile(lateQuestion.event, 'question');
  const aRead = draft.readDualFile(lateAnswer.event, 'answer');
  fields['#dual-question-text'].value = '';
  fields['#dual-answer-text'].value = '';
  draft.clearDual();
  const afterClear = events.length;
  lateQuestion.resolve('迟到题');
  lateAnswer.reject(new Error('迟到错误'));
  await Promise.all([qRead, aRead]);
  assert.equal(fields['#dual-question-text'].value, '');
  assert.equal(fields['#dual-answer-text'].value, '');
  assert.equal(events.length, afterClear);

  const currentError = file('当前答案.txt');
  const current = draft.readDualFile(currentError.event, 'answer');
  currentError.reject(new Error('当前答案错误'));
  await current;
  assert(events.some(([kind, message]) => kind === 'toast' && message.includes('当前答案错误')));
});

test('双文件清空后旧表格不能重新写入共享预览', async () => {
  const { draft, events, file } = fixture();
  const table = file('旧表格.csv');
  const tableRead = draft.readImportFile(table.event);
  draft.clearDual();
  const afterClear = events.length;
  table.resolve({ questions: ['旧题'] });
  await tableRead;
  assert.equal(events.length, afterClear);
  assert.equal(draft.questions.length, 0);
});

test('新单文件命名不被旧题文件覆盖，其他槽位仍可完成', async () => {
  const { draft, fields, events, file } = fixture();
  const question = file('旧题目.docx');
  const newSingle = file('新单文件.txt');
  const qRead = draft.readDualFile(question.event, 'question');
  const sRead = draft.readImportFile(newSingle.event);
  newSingle.resolve('新单文件正文');
  await sRead;
  const names = events.filter(([kind]) => kind === 'name').length;
  question.resolve('独立题目正文');
  await qRead;
  assert.equal(fields['#dual-question-text'].value, '独立题目正文');
  assert.equal(fields['#import-text'].value, '新单文件正文');
  assert.equal(events.filter(([kind]) => kind === 'name').length, names);
  assert.deepEqual(events.filter(([kind]) => kind === 'name').at(-1), ['name', '新单文件.txt']);
});

for (const [extension, ignored] of [['csv', true], ['xlsx', true], ['txt', false], ['pdf', false]]) {
  test(`双文件预览变化后 ${extension} 读取失败${ignored ? '不再提示' : '仍提示'}`, async () => {
    const { draft, events, file } = fixture();
    const pending = file(`读取.${extension}`);
    const read = draft.readImportFile(pending.event);
    draft.clearDual();
    const before = events.length;
    pending.reject(new Error('读取失败标记'));
    await read;
    const failureEvents = events.slice(before);
    assert.equal(failureEvents.some(([kind, message]) => kind === 'toast' && message.includes('读取失败标记')), !ignored);
    if (extension === 'pdf') { assert(failureEvents.some(([kind]) => kind === 'ocr')); }
  });
}

for (const slot of ['question', 'answer']) {
  test(`双文件 ${slot} 同槽位重选后旧失败静默，当前失败仍可见`, async () => {
    const { draft, events, file } = fixture();
    const old = file(`旧-${slot}.txt`);
    const current = file(`当前-${slot}.txt`);
    const oldRead = draft.readDualFile(old.event, slot);
    const currentRead = draft.readDualFile(current.event, slot);
    const before = events.length;
    old.reject(new Error('旧槽位错误'));
    await oldRead;
    assert.equal(events.length, before);
    current.reject(new Error('当前槽位错误'));
    await currentRead;
    assert(events.some(([kind, message]) => kind === 'toast' && message.includes('当前槽位错误')));
    assert(!events.some(([kind, message]) => kind === 'toast' && message.includes('旧槽位错误')));
  });
}
