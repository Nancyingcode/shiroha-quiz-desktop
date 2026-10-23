import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the desktop allows only local main-window controls and keeps executable assets local', async () => {
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(config.build.frontendDist, '../dist');
  assert.equal(config.build.devUrl, undefined);
  assert.equal(config.app.withGlobalTauri, true);
  assert.deepEqual(config.app.security.capabilities, [{ identifier: 'prototype', windows: ['main'], permissions: [
    'core:window:allow-start-dragging', 'core:window:allow-minimize',
    'core:window:allow-toggle-maximize', 'core:window:allow-is-maximized', 'core:window:allow-close',
  ] }]);
  assert.equal(config.app.windows[0].decorations, false);
  const scriptDirective = config.app.security.csp.split(';').find((/** @type {string} */ directive) => directive.trim().startsWith('script-src'));
  assert.equal(scriptDirective.trim(), "script-src 'self' 'wasm-unsafe-eval'");
  assert.equal(config.identifier, 'com.yiqiu.shirohaquiz.desktop');
  assert.equal(config.app.windows[0].dragDropEnabled, false);
});
