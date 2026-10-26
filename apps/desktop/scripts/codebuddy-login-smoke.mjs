import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const LOGIN_TIMEOUT_MS = 15_000;
const LOGIN_POLL_MS = 50;

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('../../web/platform/runtime.d.ts').HarnessStatus} HarnessStatus */
/** @typedef {{phase:string,revision:number,loginUrl:string,message:string,browserOpened:boolean,busy:boolean}} LoginStatus */

/** @param {Page} page @returns {Promise<LoginStatus>} */
async function status(page) {
  return page.evaluate(async () => {
    const host = /** @type {{invoke(command:string,args:Record<string,unknown>):Promise<unknown>}} */ (Reflect.get(window, 'ShirohaDesktopHost'));
    return /** @type {LoginStatus} */ (await host.invoke('codebuddy_control', {request:{kind:'status'}}));
  });
}

/** @param {Page} page @returns {Promise<HarnessStatus>} */
async function executionStatus(page) {
  return page.evaluate(async () => {
    const host = /** @type {{invoke(command:string,args:Record<string,unknown>):Promise<unknown>}} */ (Reflect.get(window, 'ShirohaDesktopHost'));
    return /** @type {HarnessStatus} */ (await host.invoke('harness_control', {request:{kind:'status'}}));
  });
}

/** @param {Page} page @param {string} provider */
async function selectProvider(page, provider) {
  await page.locator('#ai-harness-adapter').selectOption(provider);
  await page.waitForFunction(expected => {
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window, 'ShirohaPlatform'));
    const current = platform.harness?.status();
    return current?.adapter === expected && current.mode === 'harness' && !current.busy;
  }, provider);
  const current = await executionStatus(page);
  assert.equal(current.adapter, provider);
  assert.equal(current.mode, 'harness');
  for (const name of ['codex','codebuddy','deepseek']) {
    assert.equal(await page.locator(`#ai-${name}-settings`).isVisible(), name === provider, '只允许当前订阅面板可见');
  }
  return current;
}

/** @param {Page} page @param {string} model */
async function selectCodeBuddyModel(page, model) {
  const before = await executionStatus(page);
  await page.locator('#ai-codebuddy-model').selectOption(model);
  await page.waitForFunction(({expected,revision}) => {
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window, 'ShirohaPlatform'));
    const current = platform.harness?.status();
    return current?.model === expected && current.revision > revision && !current.busy;
  }, {expected:model,revision:before.revision});
  const selected = await executionStatus(page);
  assert.equal(selected.model, model);
  assert.equal(selected.accountRevision, before.accountRevision, '切换模型不得改变账户会话');
  assert.equal(selected.credentialStatus, before.credentialStatus);
  return selected;
}

/** @param {Page} page @param {string} phase */
async function waitForPhase(page, phase) {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  // Playwright 的页面谓词会把 Promise 当真值；异步 IPC 必须在 Node 侧等待已匹配的快照。
  while (true) {
    const current = await status(page);
    if (current.phase === phase) return current;
    assert(Date.now() < deadline, `等待 ${phase} 超时，当前为 ${current.phase}`);
    await delay(LOGIN_POLL_MS);
  }
}

/** @param {Page} page */
async function apiSettings(page) {
  return {provider:await page.locator('#ai-provider-v99').inputValue(),endpoint:await page.locator('#ai-endpoint-v99').inputValue(),model:await page.locator('#ai-model-v99').inputValue(),timeout:await page.locator('#ai-timeout-v99').inputValue(),remember:await page.locator('#ai-remember-key-v99').isChecked()};
}

/** @param {Page} page */
async function persistedState(page) {
  return page.evaluate(async()=>{
    const platform=/** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
    const host=/** @type {{invoke(command:string):Promise<unknown>}} */ (Reflect.get(window,'ShirohaDesktopHost'));
    await platform.saves.idle();return JSON.stringify(await host.invoke('local_read'));
  });
}

/** @param {Page} page @param {()=>Promise<unknown>} startPractice */
async function questionSmoke(page,startPractice) {
  let started=false;
  try {
    await page.locator('.nav[data-view="practice"]').click();
    await page.locator('#practice-submit-mode').selectOption('total');
    await startPractice();started=true;
    await page.locator('#practice-card .option[data-key="B"]').click();
    const before=await persistedState(page);
    await page.locator('[data-ai-single-open-v613]').click();
    await page.waitForFunction(()=>document.querySelector('.practice-ai-text-v613')?.textContent?.includes('隔离 CodeBuddy 测试解析。'));
    assert(await page.locator('#practice-card .option[data-key="B"] input').isChecked(),'CodeBuddy 不能改动答题草稿');
    assert.match(await page.locator('#p-ai-v613').innerText(),/CodeBuddy Harness/);
    assert.match(await page.locator('#p-ai-v613').innerText(),/deepseek-v4\.1-flash/,'解析面板须显示执行快照中的模型');
    await page.locator('[data-ai-single-follow-v613]').click();
    await page.locator('#practice-ai-follow-input-v613').fill('请补充这道合成题的推理步骤。');
    await page.locator('[data-ai-single-send-v613]').click();
    await page.waitForFunction(()=>document.querySelector('.practice-ai-text-v613')?.textContent?.includes('隔离 CodeBuddy 测试修订解析。'));
    assert.match(await page.locator('.practice-ai-chat-v613 .is-assistant').innerText(),/隔离 CodeBuddy 测试追问。/);
    assert.match(await page.locator('#p-ai-v613').innerText(),/人工确认/);
    assert.equal(await persistedState(page),before,'单题和追问未经采纳不得改变题库或学习数据');
    const savedDraft=await page.locator('.practice-ai-text-v613').innerText();
    await page.evaluate(async()=>{
      const platform=/** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
      const harness=platform.harness;if(!harness)throw new Error('Harness 缺失');
      const controller=new window.AbortController();
      const pending=harness.execute(harness.snapshot(),'question_analysis',[{role:'user',content:'隔离取消测试'}],controller.signal);
      controller.abort();
      try {await pending;throw new Error('取消结果仍被返回');}
      catch(error){if(!error||typeof error!=='object'||!('name' in error)||error.name!=='AbortError')throw error;}
      if(harness.status().busy)throw new Error('取消未收敛');
    });
    assert.equal(await persistedState(page),before);
    assert.equal(await page.locator('.practice-ai-text-v613').innerText(),savedDraft);
    const beforeSave=/** @type {import('../../web/platform/contracts.d.ts').Snapshot} */ (JSON.parse(before));
    const sourceBank=beforeSave.banks.find(bank=>bank.id===beforeSave.activeBankId);
    assert(sourceBank&&sourceBank.questions.length===1,'人工保存验收须定位当前隔离单题题库');
    const sourceQuestion=sourceBank.questions[0];
    const conversation=await page.locator('.practice-ai-chat-v613').innerText();
    const progress=await page.locator('#practice-progress').innerText();
    const answerStatus=await page.locator('#p-total-status').innerText();
    const nextFollowUp='保留的下一条合成追问草稿。';
    await page.locator('#practice-ai-follow-input-v613').fill(nextFollowUp);
    /** @param {import('playwright-core').Locator} dialog */
    const confirmReplacement=dialog=>dialog.locator('[data-dialog-accept]').click();
    await page.locator('[data-ai-single-save-v613]').click();
    if(sourceQuestion.analysis&&sourceQuestion.analysis!==savedDraft)await confirmReplacement(page.locator('#app-dialog'));
    await page.waitForFunction(()=>document.querySelector('[data-ai-single-save-v613]')?.textContent?.includes('已写入题库解析'));
    const afterSave=/** @type {import('../../web/platform/contracts.d.ts').Snapshot} */ (JSON.parse(await persistedState(page)));
    const savedBank=afterSave.banks.find(bank=>bank.id===sourceBank.id);
    assert(savedBank,'保存后来源题库必须存在');
    assert.deepEqual(afterSave.banks,beforeSave.banks.map(bank=>bank.id===sourceBank.id?{
      ...bank,updatedAt:savedBank.updatedAt,
      questions:bank.questions.map(question=>question.id===sourceQuestion.id?{...question,analysis:savedDraft}:question),
    }:bank),'人工保存只能更新当前题解析和所属题库更新时间，题干、选项、答案及其他题目必须保留');
    assert.deepEqual(afterSave.records,beforeSave.records,'保存解析不能提交答案或新增练习记录');
    assert.equal(afterSave.activeBankId,beforeSave.activeBankId);
    assert(await page.locator('[data-ai-single-save-v613]').isDisabled());
    assert(await page.locator('#practice-card .option[data-key="B"] input').isChecked(),'保存解析必须保留当前作答');
    assert.equal(await page.locator('#practice-progress').innerText(),progress);
    assert.equal(await page.locator('#p-total-status').innerText(),answerStatus);
    assert.equal(await page.locator('.practice-ai-chat-v613').innerText(),conversation,'人工保存必须保留追问记录');
    assert.equal(await page.locator('#practice-ai-follow-input-v613').inputValue(),nextFollowUp,'人工保存必须保留未发送的追问草稿');
  } finally {
    if(started&&await page.locator('#p-exit').isVisible()) {await page.locator('#p-exit').click();await page.locator('#app-dialog [data-dialog-accept]').click();}
    await page.waitForFunction(()=>!document.body.classList.contains('practice-focus'));
    await page.locator('#practice-submit-mode').selectOption('single');
    await page.locator('.nav[data-view="ai-settings"]').click();
  }
}

/** 只由已经检查隔离 native-test 构建的主 smoke 调用。 @param {Page} page @param {()=>Promise<unknown>} startPractice */
export async function codebuddyLoginSmoke(page,startPractice) {
  await page.locator('.nav[data-view="ai-settings"]').click();
  const originalApi=await apiSettings(page);
  const originalCredential=await page.evaluate(config=>{
    const platform=/** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
    return platform.credentials.status('ai',{endpoint:config.endpoint,rememberKey:config.remember});
  },originalApi);
  assert.equal(await page.locator('#ai-codebuddy-settings').isVisible(), false, 'API 模式不得显示订阅面板');
  assert.equal(await page.locator('#ai-harness-settings').isVisible(), false);
  await page.locator('#ai-execution-harness').check();
  assert.equal((await executionStatus(page)).runtimePath, 'isolated-fake-codex.exe', '只在隔离假组件中验证账户保留');
  await page.locator('#ai-harness-login').click();
  await page.waitForFunction(() => document.querySelector('#ai-harness-auth-status')?.textContent?.includes('订阅已登录'));
  const codex = await executionStatus(page);
  assert.equal(codex.credentialStatus, 'subscription');
  await selectProvider(page, 'codebuddy');
  await page.waitForFunction(()=>{
    const platform=/** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
    const current=platform.harness?.status();return current?.runtimeState==='ready'&&!current.busy;
  });
  const settings=await executionStatus(page);
  assert.equal(settings.runtimePath,'isolated-fake-codebuddy.exe','只允许隔离假 CodeBuddy 执行客户端 smoke');
  assert.equal(settings.ready, false);
  const initial = await status(page);
  assert.equal(initial.phase, 'signed_out');
  assert.equal(initial.loginUrl, '');
  const rejected = await page.evaluate(async () => {
    const host = /** @type {{invoke(command:string,args:Record<string,unknown>):Promise<unknown>}} */ (Reflect.get(window, 'ShirohaDesktopHost'));
    let denied = 0;
    for (const request of [{kind:'login',url:'https://example.invalid'}, {kind:'execute'}, {kind:'logout',token:'fake'}]) {
      try { await host.invoke('codebuddy_control', {request}); } catch { denied++; }
    }
    return denied;
  });
  assert.equal(rejected, 3);
  assert.deepEqual(await status(page), initial, '非法登录控制不得改变状态');

  await page.locator('#ai-codebuddy-login').click();
  await page.locator('#ai-codebuddy-cancel').waitFor({state:'visible'});
  await page.locator('#ai-codebuddy-cancel').click();
  await waitForPhase(page, 'cancelled');
  await page.locator('#ai-codebuddy-login').click();
  const loggedIn = await waitForPhase(page, 'signed_in');
  await page.waitForFunction(() => document.querySelector('#ai-codebuddy-phase')?.textContent?.includes('已登录'));
  assert(loggedIn.revision > initial.revision);
  assert.equal(loggedIn.busy, false, `登录完成后不应仍繁忙：${loggedIn.phase}`);
  assert.equal(loggedIn.loginUrl, '');
  assert.deepEqual(Object.keys(loggedIn).sort(), ['phase','revision','loginUrl','message','browserOpened','busy'].sort(), '登录状态不得公开令牌或个人标识');
  await page.waitForFunction(()=>{
    const platform=/** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
    const current=platform.harness?.status();return current?.adapter==='codebuddy'&&current.ready&&!current.busy;
  });
  const available=await executionStatus(page);
  assert.equal(available.revision,settings.revision,'CodeBuddy 登录不改变配置修订');
  assert.equal(available.accountRevision,loggedIn.revision);
  assert.equal(available.model,'deepseek-v4.1-flash');assert.equal(available.timeoutSeconds,120);
  await page.locator('#ai-execution-api').check();
  await page.locator('#ai-save-settings-v99').click();
  await page.waitForFunction(()=>{
    const platform=/** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
    return platform.harness?.status().mode==='api';
  });
  await page.locator('#ai-execution-harness').check();
  assert(await page.locator('#ai-codebuddy-model').isDisabled(),'执行方式未保存时不能建立模型草稿');
  await page.locator('#ai-save-settings-v99').click();
  await page.waitForFunction(()=>{
    const platform=/** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
    return platform.harness?.status().mode==='harness';
  });
  assert.equal((await status(page)).phase,'signed_in','切换执行方式不得注销 CodeBuddy');
  assert.deepEqual(await page.locator('#ai-codebuddy-model option').evaluateAll(options=>options.map(option=>/** @type {HTMLOptionElement} */ (option).value)),['deepseek-v4.1-flash','hy4-preview','hy3','default']);
  await selectCodeBuddyModel(page,'hy4-preview');
  const staleModelRequest = await page.evaluate(async snapshot => {
    const host = /** @type {{invoke(command:string,args:Record<string,unknown>):Promise<unknown>}} */ (Reflect.get(window,'ShirohaDesktopHost'));
    try { await host.invoke('harness_execute',{request:{id:window.crypto.randomUUID(),revision:snapshot.revision,accountRevision:snapshot.accountRevision,task:'connection_test',messages:[{role:'user',content:'过期模型快照'}]}}); return ''; }
    catch(error) { return error && typeof error === 'object' && 'code' in error ? error.code : 'unknown'; }
  },available);
  assert.equal(staleModelRequest,'harness_stale','旧模型快照必须在执行前拒绝');
  await selectCodeBuddyModel(page,'deepseek-v4.1-flash');
  await page.locator('#ai-test-connection-v99').click();
  await page.waitForFunction(()=>document.querySelector('#ai-settings-status-v99')?.textContent?.includes('CodeBuddy 测试执行成功'));
  const deniedTasks=await page.evaluate(async()=>{
    const host=/** @type {{invoke(command:string,args:Record<string,unknown>):Promise<unknown>}} */ (Reflect.get(window,'ShirohaDesktopHost'));
    const platform=/** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
    const snapshot=platform.harness?.snapshot();if(!snapshot)throw new Error('Harness 缺失');
    const errors=[];
    for(const task of ['import_organize','batch_review','batch_analysis']) {
      try {await host.invoke('harness_execute',{request:{id:window.crypto.randomUUID(),revision:snapshot.revision,accountRevision:snapshot.accountRevision,task,messages:[{role:'user',content:'隔离拒绝测试'}]}});errors.push('accepted');}
      catch(error){errors.push(error&&typeof error==='object'&&'code' in error?error.code:'unknown');}
    }
    return errors;
  });
  assert.deepEqual(deniedTasks,['harness_task_unavailable','harness_task_unavailable','harness_task_unavailable']);
  await questionSmoke(page,startPractice);

  const switchedBack = await selectProvider(page, 'codex');
  assert.equal(switchedBack.credentialStatus, 'subscription', '切换不能注销 Codex');
  assert.equal(switchedBack.ready, true);
  assert.equal((await status(page)).phase, 'signed_in', '隐藏 CodeBuddy 面板不能注销账户');
  for (const field of ['model','runtimePath','runtimeSource','timeoutSeconds']) {
    assert.equal(Reflect.get(switchedBack, field), Reflect.get(codex, field), '切换不得覆盖 Codex 配置');
  }
  const unavailable = await selectProvider(page, 'deepseek');
  assert.equal(unavailable.ready, false);
  assert.match(await page.locator('#ai-deepseek-settings').innerText(), /尚未接入/);
  assert.equal(await page.locator('#ai-test-connection-v99').isVisible(), false);
  const blocked = await page.evaluate(async revision => {
    const host = /** @type {{invoke(command:string,args:Record<string,unknown>):Promise<unknown>}} */ (Reflect.get(window, 'ShirohaDesktopHost'));
    try { await host.invoke('harness_execute', {request:{id:window.crypto.randomUUID(),revision,task:'connection_test',messages:[{role:'user',content:'合成拒绝用例'}]}}); return ''; }
    catch (error) { return error && typeof error === 'object' && 'code' in error ? error.code : 'unknown'; }
  }, unavailable.revision);
  assert.equal(blocked, 'harness_provider_unavailable', '未接入提供方不得回退 Codex');
  assert.equal((await status(page)).phase, 'signed_in');
  await selectProvider(page, 'codebuddy');
  await page.waitForFunction(() => document.querySelector('#ai-codebuddy-phase')?.textContent?.includes('已登录'));
  assert.equal((await executionStatus(page)).model,'deepseek-v4.1-flash','切换提供方必须保留 CodeBuddy 模型');

  await page.locator('#ai-codebuddy-logout').click();
  await waitForPhase(page, 'signed_out');
  await page.locator('#ai-codebuddy-login').click();
  await waitForPhase(page, 'signed_in');
  const after = await selectProvider(page, 'codex');
  assert.equal(after.credentialStatus, 'subscription', '退出 CodeBuddy 不得注销 Codex');
  await selectProvider(page, 'codebuddy');
  await selectCodeBuddyModel(page,'hy3');
  assert.deepEqual(await apiSettings(page),originalApi);
  assert.equal(await page.evaluate(config=>{
    const platform=/** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window,'ShirohaPlatform'));
    return platform.credentials.status('ai',{endpoint:config.endpoint,rememberKey:config.remember});
  },originalApi),originalCredential);
  return {login:true,cancel:true,logout:true,connectionTest:true,questionAnalysis:true,followUp:true,draftOnly:true,manualSave:true,executionCancelled:true,batchAndImportRejected:true,apiPreserved:true,invalidRequestsRejected:rejected,exclusivePanels:true,bothAccountsPreserved:true,modelSelection:true,staleModelRejected:true,unavailableExecutionBlocked:true,sessionLeftForRestartCheck:true};
}

/** @param {Page} page */
export async function codebuddyLoginAfterRestart(page) {
  const restarted = await status(page);
  assert.equal(restarted.phase, 'signed_out', '仅内存登录不应在重启后恢复');
  assert.equal(restarted.loginUrl, '');
  assert.equal(restarted.busy, false);
  const selected = await executionStatus(page);
  assert.equal(selected.adapter, 'codebuddy', '重启应保留唯一活动提供方');
  assert.equal(selected.model, 'hy3', '重启应保留用户选择的 CodeBuddy 模型');
  assert.equal(selected.ready, false);
  await page.locator('.nav[data-view="ai-settings"]').click();
  await page.locator('#ai-codebuddy-settings').waitFor({state:'visible'});
  assert.equal(await page.locator('#ai-codebuddy-model').inputValue(),'hy3');
  await selectProvider(page, 'codex');
  await page.waitForFunction(() => document.querySelector('#ai-harness-auth-status')?.textContent?.includes('订阅已登录'));
  // 后续存储回归从首页与未授权的假组件开始；这里只清理本脚本建立的隔离账户。
  await page.locator('#ai-harness-logout').click();
  await page.waitForFunction(() => document.querySelector('#ai-harness-auth-status')?.textContent === '尚未登录订阅');
  await page.locator('#ai-execution-api').check();
  await page.locator('#ai-save-settings-v99').click();
  await page.waitForFunction(() => {
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window, 'ShirohaPlatform'));
    return platform.harness?.status().mode === 'api';
  });
  await page.locator('.nav[data-view="dashboard"]').click();
  return {signedOutAfterRestart:true,selectedProviderPersisted:true,selectedModelPersisted:true};
}
