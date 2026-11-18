// 共享 ZIP 读写实现，在读取文档和备份时校验成员路径、容量及完整性。
(() => {
  'use strict';

  const ZIP_MAX_ENTRIES_V33 = 1200;
  const ZIP_MAX_ENTRY_COMPRESSED_V33 = 40 * 1024 * 1024;
  const ZIP_MAX_ENTRY_UNCOMPRESSED_V33 = 80 * 1024 * 1024;
  const ZIP_MAX_TOTAL_UNCOMPRESSED_V33 = 160 * 1024 * 1024;

  // 允许安全的相对成员路径，拒绝绝对路径及会改变目录归属的片段。
  function isSafeZipEntryNameV33(name) {
    const trimmedName = String(name || '').trim();
    // 盘符前缀也表示绝对路径风险，即使后面没有斜杠。
    const hasDrivePrefix = /^[A-Za-z]:/.test(trimmedName);
    const hasUnsafePrefix = !trimmedName || trimmedName.includes('\0') || trimmedName.includes('\\')
      || trimmedName.startsWith('/') || trimmedName.startsWith('./') || hasDrivePrefix;
    if (hasUnsafePrefix) { return false; }

    // DOCX/XLSX may contain explicit directory entries such as "word/".
    // Allow one trailing slash, while continuing to reject empty middle segments and path traversal.
    const normalized = trimmedName.endsWith('/') ? trimmedName.slice(0, -1) : trimmedName;
    if (!normalized) { return false; }

    return normalized.split('/').every((part) => part && part !== '.' && part !== '..');
  }

  // 数据解压前先检查名称、声明尺寸和本地文件头偏移。
  function assertZipEntrySafeV33(entry, bufLength) {
    if (!entry || !isSafeZipEntryNameV33(entry.name)) { throw new Error('ZIP entry name is unsafe.'); }

    const exceedsSizeLimit = entry.compSize > ZIP_MAX_ENTRY_COMPRESSED_V33
      || entry.uncompSize > ZIP_MAX_ENTRY_UNCOMPRESSED_V33;
    if (exceedsSizeLimit) { throw new Error('ZIP entry is too large.'); }

    if (entry.localOffset < 0 || entry.localOffset >= bufLength) { throw new Error('ZIP entry offset is invalid.'); }
  }

  // 从中央目录读取单个成员，并在返回偏移前拒绝重复名称、加密项和链接。
  function readCentralEntry(view, bytes, off, names) {
    if (off < 0 || off + 46 > bytes.length) { throw new Error('ZIP central directory is truncated.'); }

    if (view.getUint32(off, true) !== 0x02014b50) { throw new Error('ZIP directory is invalid.'); }

    const method = view.getUint16(off + 10, true);
    const compSize = view.getUint32(off + 20, true);
    const uncompSize = view.getUint32(off + 24, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOffset = view.getUint32(off + 42, true);
    if (off + 46 + nameLen + extraLen + commentLen > bytes.length) {
      throw new Error('ZIP central directory entry is truncated.');
    }

    const name = utf8(bytes.slice(off + 46, off + 46 + nameLen));
    const isDuplicate = names.has(name);
    const isLink = ((view.getUint32(off + 38, true) >>> 16) & 0xf000) === 0xa000;
    const isEncrypted = (view.getUint16(off + 8, true) & 1) !== 0;
    if (isDuplicate || isLink || isEncrypted) { throw new Error('ZIP duplicate, linked or encrypted entry.'); }

    names.add(name);
    const entry = { name, method, compSize, uncompSize, localOffset, checksum: view.getUint32(off + 16, true) };
    assertZipEntrySafeV33(entry, bytes.length);
    return { entry, nextOffset: off + 46 + nameLen + extraLen + commentLen };
  }

  // 从目录尾定位成员列表，并限制成员数和整个归档的解压总量。
  function parseZipEntries(buf) {
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }

    if (eocd < 0) { throw new Error('无法识别 docx 压缩结构'); }

    const total = view.getUint16(eocd + 10, true);
    if (total > ZIP_MAX_ENTRIES_V33) { throw new Error('ZIP entry count exceeds limit.'); }

    const cdOffset = view.getUint32(eocd + 16, true);
    let off = cdOffset;
    const out = [];
    let totalUncompressed = 0;
    const names = new Set();
    const invalidDirectory = view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true)
      || view.getUint16(eocd + 8, true) !== total || cdOffset + view.getUint32(eocd + 12, true) !== eocd;
    if (invalidDirectory) { throw new Error('ZIP directory is invalid.'); }

    for (let i = 0; i < total; i += 1) {
      const { entry, nextOffset } = readCentralEntry(view, bytes, off, names);
      totalUncompressed += entry.uncompSize;
      if (totalUncompressed > ZIP_MAX_TOTAL_UNCOMPRESSED_V33) { throw new Error('ZIP total size exceeds limit.'); }

      out.push(entry);
      off = nextOffset;
    }

    return out;
  }

  async function unzipEntry(buf, entry) {
    return new TextDecoder('utf-8').decode(await unzipEntryBytes(buf, entry));
  }

  // 逐块解压成员并限制累计输出，失败时也要关闭读取流。
  async function inflateEntry(data, entry) {
    if (entry.method !== 8) { throw new Error('ZIP compression is unsupported.'); }

    if (!('DecompressionStream' in window)) { throw new Error('当前浏览器不支持本地解压，请使用新版 Chrome/Edge。'); }

    const reader = new Blob([data]).stream().pipeThrough(new window.DecompressionStream('deflate-raw')).getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) { break; }

        size += part.value.byteLength;
        const exceedsOutputLimit = size > entry.uncompSize || size > ZIP_MAX_ENTRY_UNCOMPRESSED_V33;
        if (exceedsOutputLimit) { throw new Error('ZIP entry output is too large.'); }

        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});

      reader.releaseLock();
    }

    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return result;
  }

  // 本地头必须与中央目录一致；解压后再校验声明长度和 CRC。
  async function unzipEntryBytes(buf, entry) {
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    const off = entry.localOffset;
    assertZipEntrySafeV33(entry, bytes.length);
    if (off + 30 > bytes.length || view.getUint32(off, true) !== 0x04034b50) {
      throw new Error('ZIP local header is invalid.');
    }

    const nameLen = view.getUint16(off + 26, true);
    const extraLen = view.getUint16(off + 28, true);
    const dataStart = off + 30 + nameLen + extraLen;
    const invalidData = dataStart + entry.compSize > bytes.length
      || utf8(bytes.slice(off + 30, off + 30 + nameLen)) !== entry.name
      || view.getUint16(off + 8, true) !== entry.method;
    if (invalidData) { throw new Error('ZIP entry data is invalid.'); }

    const data = bytes.slice(dataStart, dataStart + entry.compSize);
    const result = entry.method === 0 ? data : await inflateEntry(data, entry);
    const invalidSize = result.byteLength !== entry.uncompSize;
    const invalidChecksum = !invalidSize && crc32(result) !== entry.checksum;
    if (invalidSize || invalidChecksum) { throw new Error('ZIP entry integrity check failed.'); }

    return result;
  }

  // 按 ZIP 的本地文件头格式写入未压缩数据的位置和校验字段。
  function localZipHeader(nameBytes, data, crc, now) {
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, now.time, true);
    lv.setUint16(12, now.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    return local;
  }

  // 为中央目录登记同一成员，并记录其本地文件头偏移。
  function centralZipHeader(nameBytes, data, crc, now, offset) {
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, now.time, true);
    cv.setUint16(14, now.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    return central;
  }

  // 导出使用存储模式，按顺序写本地成员和中央目录以便应用离线读取。
  function zipStoreFiles(files) {
    const enc = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const now = zipDosTimeDate(new Date());
    for (const file of files) {
      const nameBytes = enc.encode(file.name);
      const data = file.data instanceof Uint8Array ? file.data : enc.encode(String(file.text || ''));
      const crc = crc32(data);
      const local = localZipHeader(nameBytes, data, crc, now);
      localParts.push(local, data);
      const central = centralZipHeader(nameBytes, data, crc, now, offset);
      centralParts.push(central);
      offset += local.length + data.length;
    }

    const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);
    return new Blob([...localParts, ...centralParts, eocd]);
  }

  // ZIP 时间戳从 1980 年起按两秒记录，写入时使用本地日期与时间。
  function zipDosTimeDate(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  // 生成一个字节起始值对应的 CRC 表项，ZIP 使用反射多项式。
  function crc32TableEntry(n) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    return c >>> 0;
  }

  // 对未压缩字节计算 ZIP 使用的 CRC32，可核对写入或读取的数据。
  function crc32(bytes) {
    // CRC 表只在首次计算时构建，归本页面的 ZIP 模块所有，页面卸载时随模块释放。
    if (!crc32.table) {
      crc32.table = Array.from({ length: 256 }, (_, n) => crc32TableEntry(n));
    }

    let c = 0xffffffff;
    for (const byte of bytes) {
      c = crc32.table[(c ^ byte) & 255] ^ (c >>> 8);
    }

    return (c ^ 0xffffffff) >>> 0;
  }

  function utf8(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  globalThis.ShirohaZip = { parseZipEntries, unzipEntry, unzipEntryBytes, zipStoreFiles };
})();
