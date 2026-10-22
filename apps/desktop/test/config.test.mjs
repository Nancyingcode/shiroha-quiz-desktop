import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the prototype has local executable assets and no native permissions', async () => {
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(config.build.frontendDist, '../dist');
  assert.equal(config.build.devUrl, undefined);
  assert.equal(config.app.withGlobalTauri, false);
  assert.deepEqual(config.app.security.capabilities.flatMap((/** @type {{ permissions: string[] }} */ capability) => capability.permissions), []);
  const scriptDirective = config.app.security.csp.split(';').find((/** @type {string} */ directive) => directive.trim().startsWith('script-src'));
  assert.equal(scriptDirective.trim(), "script-src 'self' 'wasm-unsafe-eval'");
  assert.equal(config.identifier, 'com.yiqiu.shirohaquiz.desktop');
  assert.equal(config.app.windows[0].dragDropEnabled, false);
});
