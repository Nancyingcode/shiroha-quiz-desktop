'use strict';
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { WEB_ROOT } = require('../web-ai-practice/harness.cjs');

async function addSharedStyles(page, source) {
  const html = source ?? await readFile(path.join(WEB_ROOT, 'index.html'), 'utf8');
  const links = await page.evaluate((markup) => {
    const parsed = new globalThis.DOMParser().parseFromString(markup, 'text/html');
    // DOMParser 按脚本关闭解析 noscript；应用运行时脚本已启用。
    return [...parsed.querySelectorAll('link')].filter((link) => {
      if (!(link instanceof globalThis.HTMLLinkElement)) { return false; }
      const relations = [...link.relList].map((relation) => relation.toLowerCase());
      const type = link.type.split(';')[0].trim().toLowerCase();
      const isCss = type === '' || type === 'text/css';
      return relations.includes('stylesheet') && !relations.includes('alternate') && !link.disabled && !link.closest('noscript') && isCss;
    })
      .map((link) => ({ href: link.getAttribute('href'), media: link.getAttribute('media') }));
  }, html);
  if (!links.length) { throw new Error('Web entry has no shared stylesheets'); }
  for (const { href, media } of links) {
    if (!href) { throw new Error('Shared stylesheet has no href'); }
    const file = path.resolve(WEB_ROOT, href);
    const relative = path.relative(WEB_ROOT, file);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
      throw new Error(`Shared stylesheet is outside the Web directory: ${href}`);
    }
    const style = await page.addStyleTag({ path: file });
    if (media) { await style.evaluate((element, value) => { element.media = value; }, media); }
  }
}

module.exports = { addSharedStyles };
