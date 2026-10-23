'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { loadWeb } = require('./web-source.cjs');

test('ZIP 拒绝重名、穿越、链接和中央目录截断', async () => {
  const { api } = loadWeb();
  const duplicate = await api.zipStoreFiles([{name:'backup.json',text:'one'},{name:'backup.json',text:'two'}]).arrayBuffer();
  assert.throws(() => api.parseZipEntries(duplicate), /ZIP/);
  const traversal = await api.zipStoreFiles([{name:'../backup.json',text:'one'}]).arrayBuffer();
  assert.throws(() => api.parseZipEntries(traversal), /ZIP/);
  const linked = await api.zipStoreFiles([{name:'backup.json',text:'one'}]).arrayBuffer();
  const view = new DataView(linked); const offset=view.getUint32(linked.byteLength-6,true);
  view.setUint32(offset+38,0xa0000000,true);
  assert.throws(() => api.parseZipEntries(linked), /ZIP/);
  view.setUint32(offset+38,0,true); view.setUint32(offset,0,true);
  assert.throws(() => api.parseZipEntries(linked), /ZIP/);
});

test('ZIP 读取验证声明大小、实际输出和校验码', async () => {
  const {api}=loadWeb();
  const buffer=await api.zipStoreFiles([{name:'backup.json',text:'hello'}]).arrayBuffer();
  const entries=api.parseZipEntries(buffer);
  const view=new DataView(buffer);view.setUint8(30+'backup.json'.length,88);
  await assert.rejects(api.unzipEntryBytes(buffer,entries[0]), /ZIP/);
});
