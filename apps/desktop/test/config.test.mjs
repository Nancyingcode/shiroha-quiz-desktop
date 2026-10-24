import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the desktop allows only local main-window controls and keeps executable assets local', async () => {
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(config.build.frontendDist, '../dist');
  assert.equal(config.build.devUrl, undefined);
  assert.equal(config.app.withGlobalTauri, false);
  assert.deepEqual(config.app.security.capabilities, [{ identifier: 'prototype', windows: ['main'], permissions: [
    'allow-local-initialize', 'allow-local-read', 'allow-local-write', 'allow-local-operation', 'allow-local-checkpoint', 'allow-local-migrate', 'allow-local-replace', 'allow-local-file', 'allow-local-task', 'allow-local-query', 'allow-local-commit',
    'allow-service-credential', 'allow-service-request',
    'allow-harness-control', 'allow-harness-execute',
    'core:event:allow-listen', 'core:event:allow-unlisten',
    'core:window:allow-start-dragging', 'core:window:allow-minimize',
    'core:window:allow-toggle-maximize', 'core:window:allow-is-maximized', 'core:window:allow-close', 'core:window:allow-destroy',
  ] }]);
  assert.equal(config.app.windows[0].decorations, false);
  const scriptDirective = config.app.security.csp.split(';').find((/** @type {string} */ directive) => directive.trim().startsWith('script-src'));
  assert.equal(scriptDirective.trim(), "script-src 'self' 'wasm-unsafe-eval'");
  assert.equal(config.identifier, 'com.yiqiu.shirohaquiz.desktop');
  assert.equal(config.app.windows[0].dragDropEnabled, false);
});
