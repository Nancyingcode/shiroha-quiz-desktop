'use strict';
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { WEB_ROOT } = require('../web-ai-practice/harness.cjs');

async function addSharedStyles(page) {
  const html = await readFile(path.join(WEB_ROOT, 'index.html'), 'utf8');
  const links = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/gi)];
  if (!links.length) { throw new Error('Web entry has no shared stylesheets'); }
  for (const [, href] of links) {
    const file = path.resolve(WEB_ROOT, href);
    const relative = path.relative(WEB_ROOT, file);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
      throw new Error(`Shared stylesheet is outside the Web directory: ${href}`);
    }
    await page.addStyleTag({ path: file });
  }
}

module.exports = { addSharedStyles };
