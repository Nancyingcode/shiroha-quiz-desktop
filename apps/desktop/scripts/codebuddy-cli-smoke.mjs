import assert from 'node:assert/strict';
import { access, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { apiSettings, executionStatus, persistedState, questionSmoke, selectCodeBuddyModel, selectProvider, waitForPhase } from './codebuddy-login-smoke.mjs';

/** @typedef {import('playwright-core').Page} Page */

/** @param {string} profile */
async function fixtureFile(profile) {
  const root = await realpath(profile);
  assert.equal(path.dirname(root).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
  assert(path.basename(root).startsWith('shiroha-native-smoke-'));
  assert.equal(await readFile(path.join(root, 'test-isolation'), 'utf8'), 'fake-credentials\nnetwork-denied\n');
  const directory = path.join(root, 'codebuddy-cli-fixture');
  await mkdir(directory, { recursive: true });
  assert.equal((await realpath(directory)).toLowerCase(), directory.toLowerCase());
  return path.join(directory, 'Tencent-Cloud.coding-copilot.info');
}

/** @param {string} profile @param {boolean} [expired] */
async function loginFixture(profile, expired = false) {
  const file = await fixtureFile(profile);
  await rm(`${file}.logged-out`, { force: true });
  await writeFile(file, JSON.stringify({ auth: { accessToken: 'synthetic-memory-session', tokenType: 'Bearer', domain: 'copilot.tencent.com', expiresAt: expired ? 1 : Date.now() + 3_600_000 }, account: { uid: 'synthetic-user', type: 'personal' } }));
}

/** @param {Page} page */
async function credentialSnapshot(page) {
  const config = await apiSettings(page);
  const credential = await page.evaluate((value) => {
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window, 'ShirohaPlatform'));
    return platform.credentials.status('ai', { endpoint: value.endpoint, rememberKey: value.remember });
  }, config);
  return { config, credential };
}

/** @param {Page} page @param {string} profile @param {()=>Promise<unknown>} startPractice */
export async function codebuddyCliSmoke(page, profile, startPractice) {
  await page.locator('.nav[data-view="ai-settings"]').click();
  const before = await credentialSnapshot(page);
  await page.locator('#ai-execution-harness').check();
  assert.equal((await executionStatus(page)).runtimePath, 'isolated-fake-codex.exe');
  await page.locator('#ai-harness-login').click();
  await page.waitForFunction(() => document.querySelector('#ai-harness-auth-status')?.textContent?.includes('订阅已登录'));
  await selectProvider(page, 'codebuddy');
  assert.equal((await executionStatus(page)).runtimePath, 'isolated-fake-codebuddy.exe');
  await waitForPhase(page, 'signed_out');
  await page.locator('#ai-codebuddy-cli-guide').waitFor({ state: 'visible' });
  assert.match(await page.locator('#ai-codebuddy-cli-guide').innerText(), /打开终端[\s\S]*codebuddy[\s\S]*国内站[\s\S]*刷新登录状态/);
  for (const name of ['login', 'remember', 'logout', 'login-url']) { assert.equal(await page.locator(`#ai-codebuddy-${name}`).count(), 0); }
  const denied = await page.evaluate(async () => {
    const host = /** @type {{invoke(command:string,args:Record<string,unknown>):Promise<unknown>}} */ (Reflect.get(window, 'ShirohaDesktopHost'));
    let rejected = 0;
    for (const request of [{ kind: 'login', revision: 0 }, { kind: 'logout' }, { kind: 'set_remember', revision: 0, remember: true }, { kind: 'refresh', revision: 0, path: 'untrusted' }]) {
      try { await host.invoke('codebuddy_control', { request }); } catch { rejected += 1; }
    }
    return rejected;
  });
  assert.equal(denied, 4);
  await loginFixture(profile);
  await waitForPhase(page, 'signed_out');
  await page.locator('#ai-codebuddy-refresh').click();
  const signedIn = await waitForPhase(page, 'signed_in');
  await page.locator('#ai-codebuddy-cli-guide').waitFor({ state: 'hidden' });
  assert.equal(signedIn.rememberLogin, false);
  assert.equal(signedIn.persistenceState, 'none');
  await page.waitForFunction(() => Reflect.get(window, 'ShirohaPlatform')?.harness?.status().ready);
  await page.locator('#ai-test-connection-v99').click();
  await page.waitForFunction(() => document.querySelector('#ai-settings-status-v99')?.textContent?.includes('CodeBuddy 测试执行成功'));
  await questionSmoke(page, startPractice);
  assert.doesNotMatch(await persistedState(page), /synthetic-memory-session|synthetic-user/);
  const file = await fixtureFile(profile);
  await writeFile(`${file}.logged-out`, 'synthetic-logout');
  const signedOut = await waitForPhase(page, 'signed_out');
  assert(signedOut.revision > signedIn.revision);
  assert.equal((await executionStatus(page)).ready, false);
  await page.locator('#ai-codebuddy-cli-guide').waitFor({ state: 'visible' });
  await selectProvider(page, 'codex');
  assert.equal((await executionStatus(page)).credentialStatus, 'subscription');
  await selectProvider(page, 'codebuddy');
  await loginFixture(profile);
  await waitForPhase(page, 'signed_in');
  await selectCodeBuddyModel(page, 'hy3');
  assert.deepEqual(await credentialSnapshot(page), before);
  await assert.rejects(access(path.join(profile, 'codebuddy-account.sqlite3')));
  return { cliGuidance: true, cliLoginReused: true, cliLogoutObserved: true, connectionTest: true, questionAnalysis: true, followUp: true, manualSave: true, apiPreserved: true, codexPreserved: true, legacyActionsRejected: denied, noAppCredentials: true };
}

/** @param {Page} page @param {()=>Promise<unknown>} startPractice */
export async function codebuddyCliAfterRestart(page, startPractice) {
  await waitForPhase(page, 'signed_in');
  await page.waitForFunction(() => Reflect.get(window, 'ShirohaPlatform')?.harness?.status().ready);
  assert.equal(await page.locator('#ai-settings').evaluate((element) => element.classList.contains('active')), false);
  const selected = await executionStatus(page);
  assert.equal(selected.adapter, 'codebuddy');
  assert.equal(selected.model, 'hy3');
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#practice-submit-mode').selectOption('total');
  await startPractice();
  await page.locator('#practice-card .option[data-key="B"]').click();
  await page.locator('[data-ai-single-open-v613]').click();
  await page.locator('[data-ai-single-analysis-v613]').click();
  await page.waitForFunction(() => document.querySelector('.practice-ai-text-v613')?.textContent?.includes('隔离 CodeBuddy 测试解析。'));
  await page.locator('#p-exit').click();
  await page.locator('#app-dialog [data-dialog-accept]').click();
  await page.waitForFunction(() => !document.body.classList.contains('practice-focus'));
  await page.locator('#practice-submit-mode').selectOption('single');
  const stopped = await page.evaluate(async () => {
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window, 'ShirohaPlatform'));
    await platform.credentials.reset();
    const host = /** @type {{invoke(command:string,args:Record<string,unknown>):Promise<unknown>}} */ (Reflect.get(window, 'ShirohaDesktopHost'));
    const account = /** @type {{phase:string,cliLoginAvailable:boolean}} */ (await host.invoke('codebuddy_control', { request: { kind: 'status' } }));
    return { ready: platform.harness?.status().ready, phase: account.phase, available: account.cliLoginAvailable };
  });
  assert.deepEqual(stopped, { ready: false, phase: 'signed_out', available: false });
  await page.reload();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.waitForFunction(() => Reflect.get(window, 'ShirohaPlatform')?.harness?.status().readiness === 'blocked');
  assert.equal((await executionStatus(page)).ready, false);
  await page.locator('.nav[data-view="ai-settings"]').click();
  await page.locator('#ai-codebuddy-refresh').click();
  await waitForPhase(page, 'signed_in');
  await page.waitForFunction(() => Reflect.get(window, 'ShirohaPlatform')?.harness?.status().ready);
  await page.locator('#ai-codebuddy-cli-guide').waitFor({ state: 'hidden' });
  return { cliReverifiedAfterRestart: true, modelPreserved: true, practiceBeforeSettings: true, restoreRequiresRefresh: true };
}

/** @param {Page} initialPage @param {string} profile @param {()=>Promise<Page>} restart */
export async function codebuddyCliPersistenceSmoke(initialPage, profile, restart) {
  let page = initialPage;
  await loginFixture(profile, true);
  await waitForPhase(page, 'expired');
  await page.locator('#ai-codebuddy-cli-guide').waitFor({ state: 'visible' });
  await loginFixture(profile);
  await waitForPhase(page, 'signed_in');
  page = await restart();
  await waitForPhase(page, 'signed_in');
  const file = await fixtureFile(profile);
  await writeFile(`${file}.logged-out`, 'synthetic-logout');
  await waitForPhase(page, 'signed_out');
  page = await restart();
  await waitForPhase(page, 'signed_out');
  await assert.rejects(access(path.join(profile, 'codebuddy-account.sqlite3')));
  await page.locator('.nav[data-view="ai-settings"]').click();
  await selectProvider(page, 'codex');
  await page.locator('#ai-harness-logout').click();
  await page.waitForFunction(() => document.querySelector('#ai-harness-auth-status')?.textContent === '尚未登录订阅');
  await page.locator('#ai-execution-api').check();
  await page.locator('#ai-save-settings-v99').click();
  await page.waitForFunction(() => Reflect.get(window, 'ShirohaPlatform')?.harness?.status().mode === 'api');
  await page.locator('.nav[data-view="dashboard"]').click();
  return { expiryGuidance: true, cliReverifiedAfterRestart: true, cliLogoutSurvivesRestart: true, noAppCredentials: true };
}
