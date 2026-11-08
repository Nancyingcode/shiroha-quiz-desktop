(() => {
  'use strict';

  function create({ readBuffer, cleanFileName, markdownImageRegex, questionImageDataUriRegex, safeImageId }) {
    const { parseZipEntries, unzipEntry, unzipEntryBytes } = globalThis.ShirohaZip;
    const { backupMimeFromPath } = globalThis.ShirohaBackupCore;

    function dataUriToBytes(dataUri) {
      const match = String(dataUri || '').match(/^data:image\/([A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n\s]+)$/i);
      if (!match) { return null; }
      const mime = match[1].toLowerCase();
      if (!/^(png|jpeg|jpg|gif|webp|bmp)$/.test(mime)) { return null; }
      const ext = mime === 'jpeg' ? 'jpg' : mime.replace(/[^a-z0-9]/g, '') || 'webp';
      try {
        const binary = globalThis.atob(match[2].replace(/\s+/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) { bytes[index] = binary.charCodeAt(index); }
        return { ext, bytes };
      } catch { return null; }
    }

    function registerImage(dataUri, assets, assetMap, hint) {
      const raw = String(dataUri || '').trim();
      if (!questionImageDataUriRegex().test(raw)) { return null; }
      if (assetMap.has(raw)) { return assetMap.get(raw); }
      const parsed = dataUriToBytes(raw);
      if (!parsed) { return null; }
      const index = assets.length + 1;
      const safeHint = cleanFileName(String(hint || 'image')).slice(0, 36) || 'image';
      const fileName = `web_image_${String(index).padStart(4, '0')}_${safeHint}.${parsed.ext}`;
      const asset = { name: `assets/${fileName}`, fileName, bytes: parsed.bytes };
      assets.push(asset);
      assetMap.set(raw, asset);
      return asset;
    }

    function rewriteQuestionImages(question, assets, assetMap) {
      const raw = String(question.question || '');
      if (!/!\[[^\]]{0,120}\]\(data:image\//i.test(raw)) { return; }
      if (!Array.isArray(question.images)) { question.images = []; }
      let nextOrder = (question.images.reduce((highest, image) => Math.max(highest, Number((image && image.order) || 0)), 0)
        || question.images.length) + 1;
      question.question = raw.replace(markdownImageRegex(), (match, alt, src) => {
        const cleanAlt = String(alt || `题目图片${nextOrder}`).replace(/[\]\n\r]/g, '').slice(0, 80)
          || `题目图片${nextOrder}`;
        const asset = registerImage(src, assets, assetMap, cleanAlt);
        if (!asset) { return match; }
        const alreadyIncluded = question.images.some((image) => image && (image.localPath === asset.name
          || image.dataUrl === src || image.dataUri === src || image.localPath === src || image.src === src));
        if (!alreadyIncluded) {
          question.images.push({ id: safeImageId('native_zip', question.id || 'q', nextOrder),
            localPath: asset.name, sourceName: asset.fileName, order: nextOrder,
            width: null, height: null, sizeBytes: asset.bytes.length });
          nextOrder += 1;
        }
        return `\n【${cleanAlt}】\n`;
      }).replace(/\n{3,}/g, '\n\n').trim();
    }

    function externalizeImages(value, assets, assetMap, seen = new Set()) {
      if (!value || typeof value !== 'object' || seen.has(value)) { return; }
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item) => externalizeImages(item, assets, assetMap, seen));
        return;
      }
      if (typeof value.question === 'string') { rewriteQuestionImages(value, assets, assetMap); }
      if (Array.isArray(value.images)) {
        value.images.forEach((image, index) => {
          if (!image || typeof image !== 'object') { return; }
          const src = String(image.dataUrl || image.dataUri || image.localPath || image.src || '').trim();
          const asset = registerImage(src, assets, assetMap, image.sourceName || image.id || `image_${index + 1}`);
          if (!asset) { return; }
          image.localPath = asset.name;
          image.sourceName = image.sourceName || asset.fileName;
          image.order = Number(image.order || index + 1) || index + 1;
          image.sizeBytes = Number(image.sizeBytes || asset.bytes.length) || asset.bytes.length;
          delete image.dataUrl;
          delete image.dataUri;
          delete image.src;
        });
      }
      Object.keys(value).forEach((key) => externalizeImages(value[key], assets, assetMap, seen));
    }

    function bytesToDataUri(bytes, mime) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('备份图片读取失败'));
        reader.readAsDataURL(new Blob([bytes], { type: mime }));
      });
    }

    async function readBackupFile(file) {
      const buffer = await readBuffer(file);
      const bytes = new Uint8Array(buffer);
      const hasZipSignature = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
      if (!/\.zip$/i.test(file.name) && !hasZipSignature) {
        return { text: new TextDecoder('utf-8').decode(bytes), assets: {} };
      }
      const entries = parseZipEntries(buffer);
      const jsonEntry = entries.find((entry) => entry.name === 'backup.json')
        || entries.find((entry) => /\.json$/i.test(entry.name));
      if (!jsonEntry) { throw new Error('ZIP 备份中没有 backup.json'); }
      const text = await unzipEntry(buffer, jsonEntry);
      const assets = {};
      for (const entry of entries.filter((item) => item.name.startsWith('assets/'))) {
        const data = await unzipEntryBytes(buffer, entry);
        assets[entry.name] = await bytesToDataUri(data, backupMimeFromPath(entry.name));
      }
      return { text, assets };
    }

    function applyAssets(value, assets, seen = new Set()) {
      if (!value || typeof value !== 'object' || seen.has(value)) { return; }
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item) => applyAssets(item, assets, seen));
        return;
      }
      const path = String(value.localPath || '').replace(/\\/g, '/').replace(/^\//, '');
      if (path && assets[path]) { value.localPath = assets[path];value.dataUrl = assets[path]; }
      Object.values(value).forEach((item) => applyAssets(item, assets, seen));
    }

    function countUnresolvedImages(value, seen = new Set()) {
      if (!value || typeof value !== 'object' || seen.has(value)) { return 0; }
      seen.add(value);
      if (Array.isArray(value)) {
        return value.reduce((count, item) => count + countUnresolvedImages(item, seen), 0);
      }
      let count = 0;
      if (Array.isArray(value.images)) {
        count += value.images.filter((image) => {
          const src = String((image && (image.dataUrl || image.localPath)) || '');
          return src && !/^data:image\//i.test(src);
        }).length;
      }
      for (const [key, item] of Object.entries(value)) {
        if (key !== 'images') { count += countUnresolvedImages(item, seen); }
      }
      return count;
    }
    return Object.freeze({ externalizeImages, readBackupFile, applyAssets, countUnresolvedImages });
  }

  globalThis.ShirohaBackupArchive = Object.freeze({ create });
})();
