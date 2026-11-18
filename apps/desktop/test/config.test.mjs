import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('running a desktop script refuses missing dependencies without installing them', async (t) => {
  const project = await mkdtemp(path.join(tmpdir(), 'shiroha-pnpm-check-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  await copyFile(new URL('../pnpm-workspace.yaml', import.meta.url), path.join(project, 'pnpm-workspace.yaml'));
  await mkdir(path.join(project, 'sample'));
  await writeFile(path.join(project, 'sample/package.json'), JSON.stringify({ name: 'sample', version: '1.0.0' }));
  await writeFile(path.join(project, 'package.json'), JSON.stringify({
    private: true,
    devDependencies: { sample: 'file:./sample' },
    scripts: { probe: 'node probe.cjs' },
  }));
  await writeFile(path.join(project, 'probe.cjs'), "require('node:fs').writeFileSync('started', 'yes');");

  // pnpm 会让嵌套命令跳过重复检查。夹具模拟从独立终端启动，因此要读取自己的工作区配置。
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => name.toLowerCase() !== 'pnpm_config_verify_deps_before_run'));
  const result = spawnSync('pnpm run probe', {
    cwd: project,
    shell: true,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...environment, PNPM_CONFIG_OFFLINE: 'true', PNPM_CONFIG_STORE_DIR: path.join(project, 'store') },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /ERR_PNPM_VERIFY_DEPS_BEFORE_RUN/);
  const files = await readdir(project);
  for (const name of ['started', 'node_modules', 'pnpm-lock.yaml']) {
    assert(!files.includes(name), `Unexpected write before explicit install: ${name}`);
  }
});

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
  assert.deepEqual(config.app.security.capabilities, [{
    identifier: 'prototype',
    windows: ['main'],
    permissions: [
      'allow-local-initialize', 'allow-local-read', 'allow-local-write', 'allow-local-operation',
      'allow-local-checkpoint', 'allow-local-migrate', 'allow-local-replace', 'allow-local-file',
      'allow-local-task', 'allow-local-query', 'allow-local-commit',
      'allow-service-credential', 'allow-service-request',
      'allow-harness-control', 'allow-harness-execute',
      'allow-codebuddy-control',
      'core:event:allow-listen', 'core:event:allow-unlisten',
      'core:window:allow-start-dragging', 'core:window:allow-minimize',
      'core:window:allow-toggle-maximize', 'core:window:allow-is-maximized',
      'core:window:allow-close', 'core:window:allow-destroy',
    ],
  }]);
  assert.equal(config.app.windows[0].decorations, false);
  const scriptDirective = config.app.security.csp.split(';')
    .find((/** @type {string} */ directive) => directive.trim().startsWith('script-src'));
  assert.equal(scriptDirective.trim(), "script-src 'self' 'wasm-unsafe-eval'");
  assert.equal(config.identifier, 'com.yiqiu.shirohaquiz.desktop');
  assert.equal(config.app.windows[0].dragDropEnabled, false);
});
