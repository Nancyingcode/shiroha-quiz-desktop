'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { loadWeb } = require('./web-source.cjs');
const { deflateRawSync } = require('node:zlib');
const { createHash } = require('node:crypto');

test('ZIP 拒绝重名、穿越、链接和中央目录截断', async () => {
  const { api } = loadWeb();
  const duplicate = await api.zipStoreFiles([{ name: 'backup.json', text: 'one' }, { name: 'backup.json', text: 'two' }]).arrayBuffer();
  assert.throws(() => api.parseZipEntries(duplicate), /ZIP/);
  const traversal = await api.zipStoreFiles([{ name: '../backup.json', text: 'one' }]).arrayBuffer();
  assert.throws(() => api.parseZipEntries(traversal), /ZIP/);
  const linked = await api.zipStoreFiles([{ name: 'backup.json', text: 'one' }]).arrayBuffer();
  const view = new DataView(linked); const offset = view.getUint32(linked.byteLength - 6, true);
  view.setUint32(offset + 38, 0xa0000000, true);
  assert.throws(() => api.parseZipEntries(linked), /ZIP/);
  view.setUint32(offset + 38, 0, true); view.setUint32(offset, 0, true);
  assert.throws(() => api.parseZipEntries(linked), /ZIP/);
});

test('ZIP 读取验证声明大小、实际输出和校验码', async () => {
  const { api } = loadWeb();
  const buffer = await api.zipStoreFiles([{ name: 'backup.json', text: 'hello' }]).arrayBuffer();
  const entries = api.parseZipEntries(buffer);
  const view = new DataView(buffer);view.setUint8(30 + 'backup.json'.length, 88);
  await assert.rejects(api.unzipEntryBytes(buffer, entries[0]), /ZIP/);
});

function directoryOffset(buffer) {
  return new DataView(buffer).getUint32(buffer.byteLength - 6, true);
}

async function storedArchive(api, files = [{ name: 'backup.json', text: '123456789' }]) {
  return api.zipStoreFiles(files).arrayBuffer();
}

async function deflatedArchive(api) {
  const stored = Buffer.from(await storedArchive(api));
  const centralOffset = stored.readUInt32LE(stored.length - 6);
  const dataOffset = 30 + stored.readUInt16LE(26) + stored.readUInt16LE(28);
  const compressed = deflateRawSync(Buffer.from('123456789'));
  const archive = Buffer.concat([stored.subarray(0, dataOffset), compressed, stored.subarray(centralOffset)]);
  const newCentralOffset = dataOffset + compressed.length;
  archive.writeUInt16LE(8, 8);
  archive.writeUInt32LE(compressed.length, 18);
  archive.writeUInt16LE(8, newCentralOffset + 10);
  archive.writeUInt32LE(compressed.length, newCentralOffset + 20);
  archive.writeUInt32LE(newCentralOffset, archive.length - 6);
  return Uint8Array.from(archive).buffer;
}

test('ZIP 允许目录条目并保持存储式文本、字节与标准 CRC32', async () => {
  const { api } = loadWeb();
  const buffer = await storedArchive(api, [
    { name: 'word/', text: '' },
    { name: 'word/document.xml', text: '123456789' },
    { name: 'assets/pixel.bin', data: new Uint8Array([0, 128, 255]) },
  ]);
  const entries = api.parseZipEntries(buffer);
  assert.deepEqual(Array.from(entries, (entry) => entry.name), ['word/', 'word/document.xml', 'assets/pixel.bin']);
  assert.deepEqual(Array.from(entries, (entry) => entry.method), [0, 0, 0]);
  assert.equal(entries[1].checksum, 0xcbf43926);
  assert.equal(await api.unzipEntry(buffer, entries[0]), '');
  assert.equal(await api.unzipEntry(buffer, entries[1]), '123456789');
  assert.deepEqual(Array.from(await api.unzipEntryBytes(buffer, entries[2])), [0, 128, 255]);
});

test('ZIP 打包每次取一次当前时间并为所有条目写入相同 DOS 时间', async () => {
  const { api, context } = loadWeb();
  const fixed = new Date(2001, 4, 6, 7, 8, 9);
  let calls = 0;
  context.Date = class extends Date {
    constructor(...args) {
      if (args.length) { return new Date(...args); }
      calls += 1;
      return fixed;
    }
  };
  const buffer = await storedArchive(api, [{ name: 'a', text: 'x' }, { name: 'b', text: 'y' }]);
  assert.equal(
    createHash('sha256').update(Buffer.from(buffer)).digest('hex'),
    'b9596cdc7fe5fb3d65eb13fbb534a77ad4024ffff47b91cf5e77d59e52b96ac4',
  );
  const view = new DataView(buffer);
  const expectedTime = (7 << 11) | (8 << 5) | 4;
  const expectedDate = (21 << 9) | (5 << 5) | 6;
  const secondLocal = 30 + 1 + 1;
  const central = directoryOffset(buffer);
  assert.equal(calls, 1);
  for (const offset of [0, secondLocal]) {
    assert.equal(view.getUint16(offset + 10, true), expectedTime);
    assert.equal(view.getUint16(offset + 12, true), expectedDate);
  }
  for (const offset of [central, central + 47]) {
    assert.equal(view.getUint16(offset + 12, true), expectedTime);
    assert.equal(view.getUint16(offset + 14, true), expectedDate);
  }
  await storedArchive(api, []);
  assert.equal(calls, 2);
});

test('ZIP 拒绝不安全路径以及加密、无效目录和大小超限', async () => {
  const { api } = loadWeb();
  for (const name of ['', '/absolute', './relative', 'C:drive', 'a//b', 'a/../b', 'a\\b', 'a\0b', '/']) {
    const buffer = await storedArchive(api, [{ name, text: '' }]);
    assert.throws(() => api.parseZipEntries(buffer), { message: 'ZIP entry name is unsafe.' }, name);
  }
  const mutations = [
    [(view, central) => view.setUint16(central + 8, 1, true), 'ZIP duplicate, linked or encrypted entry.'],
    [(view, central) => view.setUint32(central + 20, (40 * 1024 * 1024) + 1, true), 'ZIP entry is too large.'],
    [(view, central) => view.setUint32(central + 24, (80 * 1024 * 1024) + 1, true), 'ZIP entry is too large.'],
    [(view, central) => view.setUint32(central + 42, view.byteLength, true), 'ZIP entry offset is invalid.'],
    [(view) => view.setUint16(view.byteLength - 12, 1201, true), 'ZIP entry count exceeds limit.'],
    [(view) => view.setUint16(view.byteLength - 18, 1, true), 'ZIP directory is invalid.'],
    [(view, central) => view.setUint16(central + 28, 65535, true), 'ZIP central directory entry is truncated.'],
  ];
  for (const [mutate, message] of mutations) {
    const buffer = await storedArchive(api);
    const view = new DataView(buffer);
    mutate(view, directoryOffset(buffer));
    assert.throws(() => api.parseZipEntries(buffer), { message });
  }
  const total = await storedArchive(api, [{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
  const totalView = new DataView(total);
  const central = directoryOffset(total);
  totalView.setUint32(central + 24, 80 * 1024 * 1024, true);
  totalView.setUint32(central + 47 + 24, 80 * 1024 * 1024, true);
  totalView.setUint32(central + 20, 40 * 1024 * 1024, true);
  assert.equal(api.parseZipEntries(total).length, 3);
  totalView.setUint32(central + 94 + 24, 1, true);
  assert.throws(() => api.parseZipEntries(total), { message: 'ZIP total size exceeds limit.' });
  assert.throws(() => api.parseZipEntries(new ArrayBuffer(0)), { message: '无法识别 docx 压缩结构' });
});

test('OCR 文档导出使用共享 ZIP 且保留正文和 XML 转义', async () => {
  const { api, context } = loadWeb();
  assert.equal(api.zipStoreFiles, context.ShirohaZip.zipStoreFiles);
  assert.equal(api.parseZipEntries, context.ShirohaZip.parseZipEntries);
  const blob = api.createOcrDocxBlob('自建题目 <第一行>\n第二行 & 答案', '测试 & 来源.pdf');
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const buffer = await blob.arrayBuffer();
  const entries = api.parseZipEntries(buffer);
  assert.deepEqual(
    Array.from(entries, (entry) => entry.name),
    ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'],
  );
  const document = await api.unzipEntry(buffer, entries[2]);
  assert.match(document, /测试 &amp; 来源\.pdf/);
  assert.match(document, /自建题目 &lt;第一行&gt;/);
  assert.match(document, /第二行 &amp; 答案/);
});

test('ZIP 校验本地头、压缩方式、解压大小及 CRC', async () => {
  const { api, context } = loadWeb();
  const compressed = await deflatedArchive(api);
  const [entry] = api.parseZipEntries(compressed);
  assert.equal(entry.method, 8);
  assert.equal(await api.unzipEntry(compressed, entry), '123456789');

  const localHeader = compressed.slice(0);
  new DataView(localHeader).setUint32(0, 0, true);
  await assert.rejects(api.unzipEntryBytes(localHeader, entry), { message: 'ZIP local header is invalid.' });
  const localName = compressed.slice(0);
  new DataView(localName).setUint8(30, 88);
  await assert.rejects(api.unzipEntryBytes(localName, entry), { message: 'ZIP entry data is invalid.' });
  const localMethod = compressed.slice(0);
  new DataView(localMethod).setUint16(8, 0, true);
  await assert.rejects(api.unzipEntryBytes(localMethod, entry), { message: 'ZIP entry data is invalid.' });
  const unsupported = compressed.slice(0);
  new DataView(unsupported).setUint16(8, 99, true);
  await assert.rejects(api.unzipEntryBytes(unsupported, { ...entry, method: 99 }), { message: 'ZIP compression is unsupported.' });
  await assert.rejects(api.unzipEntryBytes(compressed, { ...entry, uncompSize: 8 }), { message: 'ZIP entry output is too large.' });
  await assert.rejects(api.unzipEntryBytes(compressed, { ...entry, checksum: 0 }), { message: 'ZIP entry integrity check failed.' });
  delete context.DecompressionStream;
  await assert.rejects(api.unzipEntryBytes(compressed, entry), { message: '当前浏览器不支持本地解压，请使用新版 Chrome/Edge。' });
});
