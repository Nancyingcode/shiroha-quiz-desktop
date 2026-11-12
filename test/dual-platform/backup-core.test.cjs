'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { runWebScripts } = require('./source-tools.cjs');

test('备份转换在无 DOM、存储和文件接口的环境中加载并保留记录源对象', () => {
  const context = vm.createContext({});
  runWebScripts(context, ['backup-core.js']);
  const core = context.ShirohaBackupCore;
  assert.throws(() => core.assertSupportedBackup({ crossPlatformSchemaVersion: 2 }), /版本/);
  const future = { crossPlatformSchemaVersion: 2, get kind() { throw new Error('多余读取'); } };
  assert.throws(() => core.assertSupportedBackup(future), /版本/);
  assert.equal(core.backupMimeFromPath('assets/PHOTO.JPEG'), 'image/jpeg');
  assert.equal(core.backupMimeFromPath('assets/file.unknown'), 'application/octet-stream');
  const record = {
    bankId: 'old',
    bankName: '原题库',
    details: [{ sourceBankId: 'old', sourceBankName: '原题库' }],
    review: { version: 1, items: [{ sourceBankId: 'old', sourceBankName: '原题库', draft: ['甲'] }] },
  };
  const before = structuredClone(record);
  const mapped = core.remapBackupRecord(record, { old: { id: 'new', name: '导入题库' } });
  assert.equal(mapped.bankId, 'new');
  assert.equal(mapped.bankName, '导入题库');
  assert.equal(mapped.details[0].sourceBankId, 'new');
  assert.equal(mapped.review.items[0].sourceBankName, '导入题库');
  assert.deepEqual(Array.from(mapped.review.items[0].draft), ['甲']);
  assert.deepEqual(record, before);
});
