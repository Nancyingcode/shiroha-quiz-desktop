'use strict';
const { observeAppDialogs } = require('../web-ai-practice/dialogs.cjs');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const test = require('node:test');
const { chromium } = require('../../apps/desktop/node_modules/playwright-core');
const { startServer, WEB_ROOT } = require('../web-ai-practice/harness.cjs');
const { loadWeb } = require('./web-source.cjs');

async function verifyOcrOutput(page) {
  const result = page.locator('#ocr-result');
  const original = page.locator('#import-text');
  const preview = page.locator('#import-preview');
  const previousPreview = await preview.innerHTML();
  const outputLines = ['第一行：题干 <核对> & "引文"', "第二行：'答案' > 样例"];
  await result.fill(outputLines.join('\n'));
  const download = page.waitForEvent('download');
  await page.locator('#ocr-download-docx-btn').click();
  const file = await download;
  assert.equal(file.suggestedFilename(), '阶段E_OCR.docx');
  const bytes = new Uint8Array(await readFile(await file.path())).buffer;
  const { api } = loadWeb();
  const entries = api.parseZipEntries(bytes);
  assert.deepEqual(
    Array.from(entries, (entry) => entry.name),
    ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'],
  );
  const xml = await api.unzipEntry(bytes, entries[2]);
  assert.match(xml, /题干 &lt;核对&gt; &amp; &quot;引文&quot;/);
  assert.match(xml, /&apos;答案&apos; &gt; 样例/);
  const paragraphs = await page.evaluate((documentXml) => {
    const xmlDocument = new globalThis.DOMParser().parseFromString(documentXml, 'application/xml');
    if (xmlDocument.querySelector('parsererror')) { throw new Error('OCR 下载的 Word 文档 XML 无法解析。'); }

    const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    return Array.from(xmlDocument.getElementsByTagNameNS(namespace, 'p'), (paragraph) => paragraph.textContent);
  }, xml);
  assert.equal(paragraphs[1], '来源文件：阶段E.pdf');
  assert.deepEqual(paragraphs.slice(-3), ['', ...outputLines]);

  const oldText = '必须保留的导入原文';
  await original.fill(oldText);
  for (const empty of ['', '   ']) {
    await result.fill(empty);
    await page.locator('#ocr-use-text-btn').click();
    assert.equal(await original.inputValue(), oldText);
    assert.match(await page.locator('#ocr-status').innerText(), /没有可填入的 OCR 文本/);
  }

  await result.fill(outputLines.join('\n'));
  await page.locator('#ocr-use-text-btn').click();
  assert.equal(await original.inputValue(), outputLines.join('\n'));
  assert.equal(await preview.innerHTML(), previousPreview);
}

test('Web offline Chinese PDF and OOXML import pipeline', { timeout: 240000 }, async () => {
  const server = await startServer(WEB_ROOT);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext();
    await context.route('**/*', (route) => (
      new URL(route.request().url()).origin === new URL(server.url).origin ? route.continue() : route.abort()
    ));
    const page = await context.newPage();
    await observeAppDialogs(page);
    page.on('app-dialog', (dialog) => dialog.accept());
    await page.goto(server.url);
    await page.locator('body[data-storage-state="ready"]').waitFor();
    const { documentSmoke } = await import('../../apps/desktop/scripts/document-smoke.mjs');
    console.log(await documentSmoke(page, verifyOcrOutput));
  } finally { await browser?.close(); await server.close(); }
});
