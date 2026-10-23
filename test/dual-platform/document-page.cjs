'use strict';
const test = require('node:test');
const { chromium } = require('../../apps/desktop/node_modules/playwright-core');
const { startServer, WEB_ROOT } = require('../web-ai-practice/harness.cjs');

test('Web offline Chinese PDF and OOXML import pipeline', { timeout: 240000 }, async () => {
  const server = await startServer(WEB_ROOT);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext();
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(server.url).origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    await page.goto(server.url);
    await page.locator('body[data-storage-state="ready"]').waitFor();
    const { documentSmoke } = await import('../../apps/desktop/scripts/document-smoke.mjs');
    console.log(await documentSmoke(page));
  } finally { await browser?.close(); await server.close(); }
});
