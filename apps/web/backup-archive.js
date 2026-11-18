// 读写备份包和配套图片，兼容只含 JSON 的历史备份。
(() => {
  'use strict';

  // 为备份包绑定文件读取、题目图片识别和资源命名规则。
  function create({
    readBuffer,
    cleanFileName,
    markdownImageRegex,
    questionImageDataUriRegex,
    safeImageId,
  }) {
    const { parseZipEntries, unzipEntry, unzipEntryBytes } = globalThis.ShirohaZip;
    const { backupMimeFromPath } = globalThis.ShirohaBackupCore;

    // 只将支持的 base64 位图转换为 ZIP 可存储的字节；无效数据交回调用方处理。
    function dataUriToBytes(dataUri) {
      // 分别捕获 data URI 的图片子类型和 base64 内容，排除其他 URI 形式。
      const match = String(dataUri || '').match(/^data:image\/([A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n\s]+)$/i);
      if (!match) { return null; }

      const mime = match[1].toLowerCase();
      // 限制可归档的图片子类型，避免把任意数据类型写成题库图片。
      if (!/^(png|jpeg|jpg|gif|webp|bmp)$/.test(mime)) { return null; }

      // 以常用扩展名保存 JPEG，其他类型仅保留可写入扩展名的字母和数字。
      const ext = mime === 'jpeg' ? 'jpg' : mime.replace(/[^a-z0-9]/g, '') || 'webp';
      try {
        // 兼容历史 base64 内容中的换行和空格，解码前移除空白。
        const binary = globalThis.atob(match[2].replace(/\s+/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) { bytes[index] = binary.charCodeAt(index); }

        return { ext, bytes };
      } catch { return null; }
    }

    // 按原始数据去重，同一张图片只写入一次 assets 目录。
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

    // 复用题目原有的同一张附件，只有新增附件才推进备份顺序。
    function appendQuestionImage(question, asset, src, order) {
      const alreadyIncluded = question.images.some((image) => image && (image.localPath === asset.name
        || image.dataUrl === src || image.dataUri === src || image.localPath === src || image.src === src));
      if (!alreadyIncluded) {
        question.images.push({
          id: safeImageId('native_zip', question.id || 'q', order),
          localPath: asset.name,
          sourceName: asset.fileName,
          order,
          width: null,
          height: null,
          sizeBytes: asset.bytes.length,
        });
        return order + 1;
      }

      return order;
    }

    // 将题干中可归档的图片转成附件引用，并保留原来的题干说明与图片顺序。
    function rewriteQuestionImages(question, assets, assetMap) {
      const raw = String(question.question || '');
      // 先检查 Markdown 内嵌图片前缀，避免对无图片题干做替换处理。
      if (!/!\[[^\]]{0,120}\]\(data:image\//i.test(raw)) { return; }

      if (!Array.isArray(question.images)) { question.images = []; }

      let nextOrder = (question.images.reduce(
        (highest, image) => Math.max(highest, Number((image && image.order) || 0)),
        0,
      )
        || question.images.length) + 1;
      // 将识别到的图片替换为题干说明，并更新对应的归档附件引用。
      const replaceImage = (match, alt, src) => {
        // 替换后的题干说明需要留在一行，去掉闭括号及换行。
        const cleanAlt = String(alt || `题目图片${nextOrder}`).replace(/[\]\n\r]/g, '').slice(0, 80)
          || `题目图片${nextOrder}`;
        const asset = registerImage(src, assets, assetMap, cleanAlt);
        if (!asset) { return match; }

        nextOrder = appendQuestionImage(question, asset, src, nextOrder);
        return `\n【${cleanAlt}】\n`;
      };

      // 替换内嵌图片可能在交界处堆叠换行，合并为一个空行。
      question.question = raw.replace(markdownImageRegex(), replaceImage).replace(/\n{3,}/g, '\n\n').trim();
    }

    // 附件入包后将所有旧内嵌来源替换为包内路径，保留图片顺序和大小。
    function replaceImageReference(image, index, assets, assetMap) {
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
    }

    // 遍历备份数据并把题库图片转成包内路径；重复引用只处理一次。
    function externalizeImages(value, assets, assetMap, seen = new Set()) {
      if (!value || typeof value !== 'object' || seen.has(value)) { return; }

      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item) => externalizeImages(item, assets, assetMap, seen));

        return;
      }

      if (typeof value.question === 'string') { rewriteQuestionImages(value, assets, assetMap); }

      if (Array.isArray(value.images)) {
        value.images.forEach((image, index) => replaceImageReference(image, index, assets, assetMap));
      }

      Object.keys(value).forEach((key) => externalizeImages(value[key], assets, assetMap, seen));
    }

    // 以浏览器可直接显示的 data URI 恢复包内附件。
    function bytesToDataUri(bytes, mime) {
      return new Promise(
        // 等待读取完成再交回图片数据，避免导入使用半成品。
        (resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));

          reader.onerror = () => reject(new Error('备份图片读取失败'));

          reader.readAsDataURL(new Blob([bytes], { type: mime }));
        },
      );
    }

    // 根据包签名或文件名决定读取 ZIP 附件还是兼容历史 JSON。
    async function readBackupFile(file) {
      const buffer = await readBuffer(file);
      const bytes = new Uint8Array(buffer);
      const hasZipSignature = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
      // 当文件名与 ZIP 签名均未表明存在归档时，按普通 JSON 读取。
      if (!/\.zip$/i.test(file.name) && !hasZipSignature) {
        return { text: new TextDecoder('utf-8').decode(bytes), assets: {} };
      }

      const entries = parseZipEntries(buffer);
      // 旧归档可能使用任意 JSON 名称，标准文件缺失时读取首个 JSON。
      const jsonExtension = /\.json$/i;
      const jsonEntry = entries.find((entry) => entry.name === 'backup.json')
        || entries.find((entry) => jsonExtension.test(entry.name));
      if (!jsonEntry) { throw new Error('ZIP 备份中没有 backup.json'); }

      const text = await unzipEntry(buffer, jsonEntry);
      const assets = {};
      for (const entry of entries.filter((item) => item.name.startsWith('assets/'))) {
        const data = await unzipEntryBytes(buffer, entry);
        assets[entry.name] = await bytesToDataUri(data, backupMimeFromPath(entry.name));
      }

      return { text, assets };
    }

    // 还原包内已解析的附件，缺失项保持为原路径供导入时报出。
    function applyAssets(value, assets, seen = new Set()) {
      if (!value || typeof value !== 'object' || seen.has(value)) { return; }

      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item) => applyAssets(item, assets, seen));

        return;
      }

      // 兼容 Windows 风格的备份路径，先统一目录分隔符。
      const slashPath = String(value.localPath || '').replace(/\\/g, '/');
      // 资源表使用包内相对路径，允许历史引用带单个起始斜杠。
      const path = slashPath.replace(/^\//, '');
      if (path && assets[path]) { value.localPath = assets[path];value.dataUrl = assets[path]; }

      Object.values(value).forEach((item) => applyAssets(item, assets, seen));
    }

    // 统计仍引用外部路径的图片，避免导入时静默丢图。
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
          // 已还原为图片 data URI 的资源无需再次提示缺失。
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
