(() => {
  'use strict';

  function assertSupportedBackup(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('JSON 根节点不是对象');
    }
    const unsupportedVersion = Number(data.crossPlatformSchemaVersion || 0) > 1
      || (String(data.kind || '').startsWith('shiroha_quiz') && Number(data.version || 0) > 3)
      || Number(data.schemaVersion || 0) > (data.kind === 'shiroha_quiz_full_backup' ? 3 : 1);
    if (unsupportedVersion) {
      throw new Error('不支持此备份版本。');
    }
  }

  function remapBackupRecord(record, bankMap) {
    const mappedRecordBank = record.bankId && bankMap[record.bankId];
    return {
      ...record,
      bankId: mappedRecordBank ? mappedRecordBank.id : record.bankId,
      bankName: mappedRecordBank ? mappedRecordBank.name : record.bankName,
      ...(record.review?.version === 1 && Array.isArray(record.review.items) ? {
        review: {
          ...record.review,
          items: record.review.items.map((item) => {
            const mapped = item.sourceBankId && bankMap[item.sourceBankId];
            return {
              ...item,
              sourceBankId: mapped ? mapped.id : item.sourceBankId,
              sourceBankName: mapped ? mapped.name : item.sourceBankName,
            };
          }),
        },
      } : {}),
      details: (record.details || []).map((detail) => {
        const mapped = detail.sourceBankId && bankMap[detail.sourceBankId];
        return {
          ...detail,
          sourceBankId: mapped ? mapped.id : detail.sourceBankId,
          sourceBankName: mapped ? mapped.name : detail.sourceBankName,
        };
      }),
    };
  }

  function backupMimeFromPath(path) {
    const ext = String(path || '').split('.').pop().toLowerCase();
    return ({
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', bmp: 'image/bmp',
    })[ext] || 'application/octet-stream';
  }

  globalThis.ShirohaBackupCore = Object.freeze({ assertSupportedBackup, remapBackupRecord, backupMimeFromPath });
})();
