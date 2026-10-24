import assert from 'node:assert/strict';

/** @typedef {import('playwright-core').Page} Page */

/** @param {Page} page */
async function executionStatus(page) {
  return page.evaluate(() => {
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
    if (!platform.harness) throw new Error('Harness 平台接口缺失');
    return platform.harness.status();
  });
}

/** @param {Page} page @param {'managed'|'custom'} source */
async function preparedRuntime(page, source) {
  await page.waitForFunction(expected => {
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
    const state = platform.harness?.status();
    return state?.runtimeSource === expected && state.runtimeState === 'ready' && !state.busy;
  }, source);
  const state = await executionStatus(page);
  assert.equal(state.runtimePath,'isolated-fake-codex.exe','拒绝在真实 Codex 环境运行 smoke 登录');
  assert.equal(state.runtimeSource,source);
  assert.equal(state.runtimeState,'ready');
  return state;
}

/** @param {Page} page */
async function apiSettings(page) {
  return {
    provider:await page.locator('#ai-provider-v99').inputValue(),
    endpoint:await page.locator('#ai-endpoint-v99').inputValue(),
    model:await page.locator('#ai-model-v99').inputValue(),
    timeout:await page.locator('#ai-timeout-v99').inputValue(),
    remember:await page.locator('#ai-remember-key-v99').isChecked(),
  };
}

/** @param {Page} page */
async function persistedState(page) {
  return page.evaluate(async () => {
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
    const host = /** @type {{invoke(command:string):Promise<unknown>}} */ (Reflect.get(window,'ShirohaDesktopHost'));
    await platform.saves.idle();
    return JSON.stringify(await host.invoke('local_read'));
  });
}

/**
 * 复用 smoke 的已隔离进程和自建题库；假程序路径验证通过前不触发任何登录。
 * @param {Page} page
 * @param {()=>Promise<unknown>} startPractice
 */
export async function harnessSmoke(page,startPractice) {
  await page.locator('.nav[data-view="ai-settings"]').click();
  const originalApi = await apiSettings(page);
  const originalCredential = await page.evaluate(config=>{
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
    return platform.credentials.status('ai',{endpoint:config.endpoint,rememberKey:config.remember});
  },originalApi);
  assert(originalCredential,'既有 API 验收未留下可核对的隔离凭据');
  let isolatedRuntime = false;
  let practiceStarted = false;
  try {
    await page.locator('#ai-execution-harness').check();
    assert.equal(await page.locator('#ai-api-settings-fields').isVisible(),false);
    assert.equal(await page.locator('#ai-harness-key,#ai-harness-remember').count(),0,'订阅 Harness 不得提供 API Key 配置');
    assert.equal(await page.locator('#ai-harness-advanced').getAttribute('open'),null,'默认流程不应展开高级程序配置');
    const unsigned = await preparedRuntime(page,'managed');
    isolatedRuntime = true;
    assert.equal(unsigned.mode,'api','自动准备擅自提交了执行方式');
    assert.equal(unsigned.ready,false,'未登录的 Harness 被标为可执行');
    assert.equal(unsigned.credentialStatus,'missing');
    assert.deepEqual(await apiSettings(page),originalApi,'自动准备改变了原 API 设置');

    await page.locator('#ai-harness-login').click();
    await page.waitForFunction(()=>document.querySelector('#ai-harness-auth-status')?.textContent?.includes('订阅已登录'));
    const loggedIn = await executionStatus(page);
    assert.equal(loggedIn.mode,'harness','登录未自动保存 Harness 执行方式');
    assert.equal(loggedIn.credentialStatus,'subscription');
    assert.equal(loggedIn.runtimeSource,'managed');
    assert.deepEqual(await apiSettings(page),originalApi,'登录自动保存改变了原 API 设置');
    await page.locator('#ai-test-connection-v99').click();
    await page.waitForFunction(()=>document.querySelector('#ai-settings-status-v99')?.textContent?.includes('Codex 测试执行成功'));

    await page.locator('.nav[data-view="practice"]').click();
    await page.locator('#practice-submit-mode').selectOption('total');
    await startPractice();
    practiceStarted = true;
    await page.locator('#practice-card .option[data-key="B"]').click();
    const beforeAi = await persistedState(page);
    await page.locator('[data-ai-single-open-v613]').click();
    await page.waitForFunction(()=>document.querySelector('#p-ai-v613 .practice-ai-text-v613')?.textContent?.includes('隔离 Harness 测试解析。'));
    assert(await page.locator('#practice-card .option[data-key="B"] input').isChecked(),'AI 改变了作答草稿');
    assert.match(await page.locator('#p-total-status').innerText(),/已填写 1 题/);
    const initialAnalysis = await page.locator('.practice-ai-text-v613').innerText();
    await page.locator('[data-ai-single-follow-v613]').click();
    await page.locator('#practice-ai-follow-input-v613').fill('请补充测试题的解题步骤。');
    await page.locator('[data-ai-single-send-v613]').click();
    await page.waitForFunction(()=>!!document.querySelector('.practice-ai-chat-v613 .is-assistant'));
    assert.equal(await page.locator('.practice-ai-chat-v613 .is-assistant').count(),1);
    const revisedAnalysis = await page.locator('.practice-ai-text-v613').innerText();
    assert(revisedAnalysis.trim() && revisedAnalysis !== initialAnalysis,'追问未更新独立解析草稿');
    assert.equal(await persistedState(page),beforeAi,'生成或追问未经采纳就改变了题库或学习数据');

    const cancelled = await page.evaluate(async()=>{
      const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
      const harness = platform.harness;if(!harness)throw new Error('Harness 平台接口缺失');
      const controller = new window.AbortController();
      const pending = harness.execute(harness.snapshot(),'question_analysis',[{role:'user',content:'自建取消测试，无用户数据。'}],controller.signal);
      controller.abort();
      try { await pending; throw new Error('取消后的结果仍返回给业务'); }
      catch(error) { if(!error || typeof error !== 'object' || !('name' in error) || error.name !== 'AbortError')throw error; }
      if(harness.status().busy)throw new Error('取消完成后仍处于忙碌状态');
      return true;
    });
    assert.equal(await persistedState(page),beforeAi,'取消任务改变了题库或学习数据');
    assert.equal(await page.locator('.practice-ai-text-v613').innerText(),revisedAnalysis,'取消任务覆盖了已有解析草稿');
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('#p-exit').click();
    practiceStarted = false;
    await page.waitForFunction(()=>!document.body.classList.contains('practice-focus'));
    await page.locator('#practice-submit-mode').selectOption('single');

    await page.locator('.nav[data-view="ai-settings"]').click();
    await page.locator('#ai-harness-logout').click();
    await page.waitForFunction(()=>document.querySelector('#ai-harness-auth-status')?.textContent==='尚未登录订阅');
    const loggedOut = await executionStatus(page);
    assert.equal(loggedOut.mode,'harness','退出登录静默切换了执行方式');
    assert.equal(loggedOut.ready,false);
    assert.equal(loggedOut.credentialStatus,'missing');

    await page.locator('#ai-harness-advanced > summary').click();
    await page.locator('#ai-harness-choose').click();
    await page.waitForFunction(()=>{
      const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
      return platform.harness?.status().runtimeSource === 'custom';
    });
    assert.equal((await executionStatus(page)).runtimePath,'isolated-fake-codex.exe','高级选择只能使用隔离假程序');
    await page.locator('#ai-harness-inspect').click();
    await preparedRuntime(page,'custom');
    await page.locator('#ai-save-settings-v99').click();
    await page.waitForFunction(()=>document.querySelector('#ai-settings-status-v99')?.textContent?.includes('Harness 设置已保存'));
    await page.locator('#ai-harness-use-managed').click();
    const managedAgain = await preparedRuntime(page,'managed');
    assert.equal(managedAgain.mode,'harness');
    assert.equal(managedAgain.credentialStatus,'missing','切回自动管理不应发起登录');
    assert.deepEqual(await apiSettings(page),originalApi,'高级程序切换改变了原 API 设置');
    await page.locator('#ai-harness-advanced > summary').click();
    await page.locator('#ai-execution-api').check();
    await page.locator('#ai-save-settings-v99').click();
    await page.waitForFunction(()=>document.querySelector('#ai-settings-status-v99')?.textContent?.includes('设置已保存'));
    assert.equal((await executionStatus(page)).mode,'api');
    assert.deepEqual(await apiSettings(page),originalApi,'切回 API 后原配置丢失');
    assert.equal(await page.evaluate(config=>{
      const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
      return platform.credentials.status('ai',{endpoint:config.endpoint,rememberKey:config.remember});
    },originalApi),originalCredential,'Harness 登录或退出清除了原 API 凭据');
    return {fakeRuntime:true,automaticPreparation:true,loginWithoutManualSetup:true,advancedCustomRuntime:true,managedRuntimeRestored:true,subscriptionLogin:true,connectionTest:true,questionAnalysis:true,followUp:true,cancelled,draftOnly:true,apiPreserved:true,logoutUnavailable:true};
  } finally {
    if (isolatedRuntime) await page.evaluate(async()=>{
      const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
      await platform.harness?.cancelAll();
      if(platform.harness?.status().mode!=='api')await platform.harness?.saveMode('api');
    });
    if (practiceStarted && await page.locator('#p-exit').isVisible()) {
      page.once('dialog',dialog=>dialog.accept());
      await page.locator('#p-exit').click();
    }
  }
}
