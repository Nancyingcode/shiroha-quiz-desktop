// 集中题目富文本和内嵌图片的计算，供解析、展示和跨端备份共享。
(() => {
  'use strict';

  const RICH_CONTENT_VERSION_V57 = 'shiroha-web-rich-v1';
  const MAX_RICH_TEXT_LENGTH_V58919 = 200_000;

  // 兼容历史富文本字段形态，选择第一份有效文本并按安全规则处理。
  function pickRichTextFieldV57(q, field, fallback = '') {
    const rich = q && q.richContent;
    const candidates = [];
    if (rich && typeof rich === 'object') {
      const fields = rich.fields && typeof rich.fields === 'object' ? rich.fields : rich;
      const item = fields && fields[field];
      if (typeof item === 'string') {
        candidates.push(item);
      } else if (item && typeof item === 'object') {
        candidates.push(item.text, item.markdown, item.sourceText, item.fallbackText, item.plainText);
      }
    }

    candidates.push(fallback);
    const found = candidates.find((v) => v != null && String(v).trim());
    return sanitizeRichTextValueV57(found);
  }

  // 按选项位置读取富文本，缺失时保留旧选项的文本表示。
  function pickRichOptionTextV57(q, index, opt) {
    const fallback = opt && (opt.text ?? opt.content ?? opt.label ?? '');
    const rich = q && q.richContent;
    if (rich && typeof rich === 'object') {
      const fields = rich.fields && typeof rich.fields === 'object' ? rich.fields : rich;
      const options = fields && fields.options;
      if (Array.isArray(options)) {
        const item = options[index];
        if (typeof item === 'string' && item.trim()) {
          return sanitizeRichTextValueV57(item);
        }

        if (item && typeof item === 'object') {
          const value = item.text ?? item.markdown ?? item.sourceText ?? item.fallbackText ?? item.plainText;
          if (value != null && String(value).trim()) {
            return sanitizeRichTextValueV57(value);
          }
        }
      }
    }

    return sanitizeRichTextValueV57(fallback);
  }

  /* SHIROHA_WEB_V58_9_19_DOCX_ANALYSIS_IMAGE_TRUNCATION_FIX_START */
  function truncateRichTextPreservingImagesV58919(text, maxPlainLength = MAX_RICH_TEXT_LENGTH_V58919) {
    const images = [];
    const protect = (image) => {
      const index = images.push(image) - 1;
      return `\uE000SHIROHA_RICH_IMAGE_${index}\uE001`;
    };

    let masked = String(text || '').replace(markdownImageRegexV83(), (match) => protect(match));
    masked = masked.replace(/* 把允许的内嵌位图暂存为占位标识，便于清理富文本时保留有效图片。 */ /data:image\/(?:png|jpeg|jpg|gif|webp|bmp);base64,[A-Za-z0-9+/=\r\n]+/gi, (match) => (questionImageDataUriRegexV83().test(match) ? protect(match) : '[图片已移除]'));

    if (masked.length > maxPlainLength) {
      masked = masked.slice(0, maxPlainLength);
    }

    return masked.replace(/* 以编号找回暂存的安全图片，未知编号不会恢复为原始内容。 */ /\uE000SHIROHA_RICH_IMAGE_(\d+)\uE001/g, (_, index) => images[Number(index)] || '');
  }

  // 富文本清洗在限制文本体积时保留合法的内嵌图片。
  function sanitizeRichTextValueV57(value) {
    const safe = stripUnsafeImageDataUrisV83(String(value || ''));
    if (safe.length <= MAX_RICH_TEXT_LENGTH_V58919) {
      return safe;
    }

    // 只限制普通文本长度，不能在合法 Base64 图片中间截断，否则图片会变成无法渲染的残缺 Markdown。
    return truncateRichTextPreservingImagesV58919(safe);
  }

  /* SHIROHA_WEB_V58_9_19_DOCX_ANALYSIS_IMAGE_TRUNCATION_FIX_END */
  function detectRichFeaturesV57(text, extraImages) {
    const s = String(text || '');
    const features = [];
    if (/* DOCX 导入的表格边界标记用于声明表格兼容能力。 */ /【DOCX表格开始】[\s\S]*?【DOCX表格结束】/.test(s)) {
      features.push('docx_table');
    }

    if (/* OMML 标记表示源 DOCX 含公式，保留给后续导出能力判断。 */ /【DOCX公式OMML(?::|】)/.test(s)) {
      features.push('docx_omml_formula');
    }

    if (/* 识别受支持的 LaTeX 命令或公式定界符，给富文本字段标记公式能力。 */ /\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|theta|vartheta|lambda|mu|sigma|Sigma|pi|rho|bar|hat|sqrt|sum|frac|begin\{cases\})\b|\\\(|\\\[|\$[^\n$]{1,280}\$/.test(s)) {
      features.push('latex_formula');
    }

    if (markdownImageRegexV83().test(s) || ((extraImages || []).length > 0)) {
      features.push('image');
    }

    return [...new Set(features)];
  }

  // 给富文本字段附带来源和能力信息，供跨端导入选择与降级。
  function buildRichContentFieldV57(text, source, extraImages) {
    const value = String(text || '');
    const features = detectRichFeaturesV57(value, extraImages);
    if (!features.length) {
      return null;
    }

    return { text: value, source: source || 'web', features };
  }

  // 收集题干、选项和解析的富文本表示，空内容不生成无用字段。
  function buildQuestionRichContentV57(q) {
    if (!q || typeof q !== 'object') {
      return null;
    }

    const fields = {};
    const questionField = buildRichContentFieldV57(q.question, 'question', q.images);
    if (questionField) {
      fields.question = questionField;
    }

    const analysisField = buildRichContentFieldV57(q.analysis, 'analysis', []);
    if (analysisField) {
      fields.analysis = analysisField;
    }

    const optionFields = (q.options || []).map((o) => buildRichContentFieldV57(o && o.text, 'option', []));
    if (optionFields.some(Boolean)) {
      fields.options = optionFields.map((x) => x || null);
    }

    const allFeatures = [...new Set(Object.values(fields).flatMap((v) => (Array.isArray(v) ? v.filter(Boolean).flatMap((x) => x.features || []) : (v.features || []))))];
    if (!allFeatures.length) {
      return null;
    }

    return { schema: RICH_CONTENT_VERSION_V57, features: allFeatures, fields };
  }

  // 汇总全部导出题库使用的富文本能力，便于接收端判断兼容性。
  function buildRichContentCapabilitiesV57(banks) {
    const caps = { schema: RICH_CONTENT_VERSION_V57, exportedBy: 'web-v33', fallback: 'plain_text_with_safe_unknown_fields', features: [] };
    const set = new Set();
    (banks || []).forEach((bank) => (bank.questions || []).forEach((q) => {
      const rich = q && q.richContent;
      (rich && Array.isArray(rich.features) ? rich.features : []).forEach((f) => set.add(f));
    }));

    caps.features = [...set].sort();
    return caps;
  }

  function questionImageDataUriRegexV83() {
    return /* 仅接受列出的位图 MIME 和 Base64 数据，供题目图片来源校验。 */ /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp);base64,[A-Za-z0-9+/=\r\n]+$/i;
  }

  function markdownImageRegexV83() {
    return /* 识别题干内嵌位图的 Markdown 表示，捕获替代文字和数据地址。 */ /!\[([^\]]{0,120})\]\((data:image\/(?:png|jpeg|jpg|gif|webp|bmp);base64,[^)]+)\)/gi;
  }

  // 资源导出用 MIME 推导文件扩展名，统一 JPEG 的两种写法。
  function dataUriMimeExtV83(dataUri) {
    const m = String(dataUri || '').match(/* 提取内嵌位图的 MIME 子类型，供资产文件扩展名选择。 */ /^data:image\/([^;]+);base64,/i);
    const t = ((m && m[1]) || 'webp').toLowerCase();
    if (t === 'jpeg' || t === 'jpg') {
      return 'jpg';
    }

    return t.replace(/* MIME 子类型只能留下 ASCII 扩展名字符，空值回退到 webp。 */ /[^a-z0-9]+/g, '') || 'webp';
  }

  function dataUriSizeBytesV83(dataUri) {
    const b64 = String(dataUri || '').split(',')[1] || '';
    return Math.max(0, Math.floor(b64.replace(/* 忽略 Base64 的换行和间隔，再按字符数估算图像字节数。 */ /\s/g, '').length * 3 / 4));
  }

  function safeImageIdV83(prefix, a, b) {
    return `${String(prefix || 'img')}_${String(a || 'q').replace(/* 来源标识只使用可移植字符，避免占位编号影响文件名。 */ /[^A-Za-z0-9_-]+/g, '_').slice(0, 32)}_${String(b || 1).replace(/* 图片序号也限制为可移植字符，以免旧备份值引入分隔符。 */ /[^A-Za-z0-9_-]+/g, '_')}`;
  }

  function stripUnsafeImageDataUrisV83(text) {
    return String(text || '')
      .replace(/* 逐个检查 Markdown 内嵌图像，仅保留完整的安全数据地址。 */ /!\[[^\]]{0,120}\]\((data:image\/[^;)\s]+;base64,[^)]+)\)/gi, (m, src) => (questionImageDataUriRegexV83().test(src) ? m : '[图片已移除]'))
      .replace(/* 兼容未包在 Markdown 标记里的图片数据，去除不适合展示的源。 */ /data:image\/[^;)\s]+;base64,[A-Za-z0-9+/=\r\n]+/gi, (m) => (questionImageDataUriRegexV83().test(m) ? m : '[图片已移除]'));
  }

  // 将历史图片数组归一化，保留显示和跨端复用所需的身份及尺寸字段。
  function normalizeQuestionImagesForWebV83(images) {
    if (!Array.isArray(images)) {
      return [];
    }

    return images.map(/* 单个图片缺少有效来源时允许过滤，避免将空描述写入导出资产。 */ (img, i) => {
      if (!img || typeof img !== 'object') {
        return null;
      }

      const src = String(img.dataUrl || img.dataUri || img.src || img.localPath || '').trim();
      if (!src) {
        return null;
      }

      const sourceName = String(img.sourceName || img.name || img.alt || (`题目图片${i + 1}`)).trim() || (`题目图片${i + 1}`);
      return { id: String(img.id || safeImageIdV83('img', sourceName, i + 1)), localPath: src, dataUrl: src, sourceName, order: Number(img.order || i + 1) || i + 1, width: img.width ?? null, height: img.height ?? null, sizeBytes: Number(img.sizeBytes || dataUriSizeBytesV83(src)) || 0 };
    }).filter(Boolean);
  }

  function questionTextContainsDataUriV83(question, dataUri) {
    return !!dataUri && String(question || '').includes(String(dataUri).slice(0, 80));
  }

  // 将有效图片补到题干里，避免重复插入原文中已有的相同资源。
  function injectQuestionImagesForWebV83(question, images) {
    let text = String(question || '').trim();
    const imgs = normalizeQuestionImagesForWebV83(images).filter((img) => questionImageDataUriRegexV83().test(img.dataUrl || img.localPath || ''));
    const additions = [];
    imgs.forEach(/* 只为正文未引用的图片补 Markdown，避免重复显示。 */ (img, i) => {
      const src = img.dataUrl || img.localPath;
      if (!questionTextContainsDataUriV83(text, src)) {
        const alt = (img.sourceName || (`题目图片${i + 1}`)).replace(/* 删除会结束替代文字或引入新行的字符，避免破坏 Markdown 图片边界。 */ /[\]\n\r]/g, '').slice(0, 80) || '题目图片';
        additions.push(`![${alt}](${src})`);
      }
    });

    if (additions.length) {
      text = [text, ...additions].filter(Boolean).join('\n');
    }

    return text;
  }

  // 保留题干图片顺序，合并独立图片列表时跳过已处理的来源。
  function exportQuestionImagesForCrossExportV83(q) {
    const question = String((q && q.question) || '');
    const images = [];
    let order = 1;
    const cleanQuestion = question.replace(markdownImageRegexV83(), /* 将题干里的内嵌图片收录为资产，同时留下人可读的占位名称。 */ (m, alt, src) => {
      const cleanAlt = String(alt || (`题目图片${order}`)).trim() || (`题目图片${order}`);
      const ext = dataUriMimeExtV83(src);
      images.push({ id: safeImageIdV83('web', (q && q.id) || 'q', order), localPath: src, dataUrl: src, sourceName: `${cleanAlt}.${ext}`, order, width: null, height: null, sizeBytes: dataUriSizeBytesV83(src) });
      order += 1;
      return `\n【${cleanAlt}】\n`;
    }).replace(/* 图片转换会留下额外换行，超过一个空白段时折叠为单个空白段。 */ /\n{3,}/g, '\n\n').trim();
    normalizeQuestionImagesForWebV83(q && q.images).forEach(/* 补充只存在于结构化图片数组的资源，保留已有顺序号。 */ (img) => {
      const src = img.dataUrl || img.localPath || '';
      if (!src || images.some((x) => x.localPath === src || x.dataUrl === src)) {
        return;
      }

      const exportedImage = { ...img, order: img.order || order };
      if (!img.order) {
        order += 1;
      }

      images.push(exportedImage);
    });

    return { question: cleanQuestion, images };
  }

  globalThis.ShirohaRichContent = Object.freeze({
    RICH_CONTENT_VERSION_V57,
    pickRichTextFieldV57,
    pickRichOptionTextV57,
    questionImageDataUriRegexV83,
    markdownImageRegexV83,
    safeImageIdV83,
    stripUnsafeImageDataUrisV83,
    normalizeQuestionImagesForWebV83,
    questionTextContainsDataUriV83,
    injectQuestionImagesForWebV83,
    buildRichContentFieldV57,
    buildQuestionRichContentV57,
    buildRichContentCapabilitiesV57,
    exportQuestionImagesForCrossExportV83,
  });
})();
