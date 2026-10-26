import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the main window is created from restored geometry instead of moved after creation', async () => {
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const main = config.app.windows.find((/** @type {{label: string}} */ window) => window.label === 'main');
  assert.equal(main.create, false, '读取保存位置前不得自动创建窗口');
  assert.equal(main.visible, false, '启动初始化完成前不得显示窗口');
  assert.equal(main.center, true, '没有有效窗口记录时应默认居中');
  const source = await readFile(new URL('../src-tauri/src/window_state.rs', import.meta.url), 'utf8');
  assert.match(source, /WebviewWindowBuilder::from_config/);
  assert.doesNotMatch(source, /window\.(set_position|set_size|center)\(/, '创建后不得再恢复位置或尺寸');
});

test('the desktop allows only local main-window controls and keeps executable assets local', async () => {
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(config.build.frontendDist, '../dist');
  assert.equal(config.build.devUrl, undefined);
  assert.equal(config.app.withGlobalTauri, false);
  assert.deepEqual(config.app.security.capabilities, [{ identifier: 'prototype', windows: ['main'], permissions: [
    'allow-local-initialize', 'allow-local-read', 'allow-local-write', 'allow-local-operation', 'allow-local-checkpoint', 'allow-local-migrate', 'allow-local-replace', 'allow-local-file', 'allow-local-task', 'allow-local-query', 'allow-local-commit',
    'allow-service-credential', 'allow-service-request',
    'allow-harness-control', 'allow-harness-execute',
    'allow-codebuddy-control',
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
