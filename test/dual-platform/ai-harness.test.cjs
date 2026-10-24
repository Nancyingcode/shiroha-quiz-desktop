'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const status = { mode: 'harness', adapter: 'codex', model: 'mock-model', timeoutSeconds: 120, credentialStatus: 'subscription', runtimePath: 'fixture.exe', runtimeVersion: 'mock', runtimeSource:'custom',runtimeState:'ready',runtimeReceivedBytes:0,runtimeTotalBytes:0, ready: true, reason: '', revision: 4, busy: false };
function client(invoke, elements = {}, clock = {setTimeout,clearTimeout}) {
  const context = vm.createContext({ AbortController: globalThis.AbortController, document: { getElementById(id) { return elements[id] || null; } }, ShirohaPlatform: {}, ShirohaDesktopHost: { invoke }, crypto: { randomUUID: () => 'fixture-request' }, ...clock });
  vm.runInContext(readFileSync(require.resolve('../../apps/desktop/frontend/harness.js'), 'utf8'), context);
  return context.ShirohaPlatform.harness;
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return {promise,resolve,reject};
}
const settleUi = () => new Promise(globalThis.setImmediate);
function settingsElements() {
  const elements = {};
  for(const id of ['ai-execution-settings','ai-execution-api','ai-execution-harness','ai-harness-login','ai-harness-prepare','ai-harness-prepare-cancel','ai-harness-use-managed','ai-harness-runtime-status','ai-harness-runtime-progress','ai-harness-status'])elements[id]={};
  elements['ai-settings']={classList:{contains:()=>true}};
  elements['ai-harness-model']={value:'gpt-6.1-sol'};
  elements['ai-harness-timeout']={value:'120'};
  let selected='api';
  for(const mode of ['api','harness'])Object.defineProperty(elements['ai-execution-'+mode],'checked',{get:()=>selected===mode,set:value=>{if(value)selected=mode;}});
  return elements;
}
function pollingClock() {
  const timers=new Map();let id=0;
  return {setTimeout(callback){timers.set(++id,callback);return id;},clearTimeout(key){timers.delete(key);},async tick(){const entry=timers.entries().next().value;assert(entry,'缺少状态轮询');timers.delete(entry[0]);await entry[1]();},timers};
}
const managedStatus={...status,mode:'api',model:'',credentialStatus:'missing',runtimePath:'',runtimeVersion:'',runtimeSource:'managed',runtimeState:'unprepared',ready:false};

test('Harness 每次操作冻结已保存配置并分派任务，不接触 API 设置', async () => {
  const calls = [];
  const api = client(async (command, args) => { calls.push({ command, request: args.request }); return command === 'harness_execute' ? { content: '{"analysis":"候选"}' } : { ...status }; });
  await api.initialize();
  const snapshot = api.snapshot();
  assert.equal(Object.isFrozen(snapshot), true);
  const result = await api.execute(snapshot, 'question_analysis', [{ role: 'user', content: '测试题' }]);
  assert.equal(result.content, '{"analysis":"候选"}');
  assert.equal(calls[1].request.revision, 4);
  assert.equal(calls[1].request.task, 'question_analysis');
  assert.equal(calls[1].command, 'harness_execute');
  assert.equal('endpoint' in calls[1].request, false);
  assert.equal('apiKey' in calls[1].request, false);
});

test('取消后等待原生终态，迟到结果不能返回给业务', async () => {
  let finish;
  const calls = [];
  const api = client(async (command, args) => {
    calls.push(args.request);
    if (command === 'harness_execute') return new Promise(resolve => { finish = resolve; });
    return { ...status };
  });
  await api.initialize();
  const controller = new globalThis.AbortController();
  const pending = api.execute(api.snapshot(), 'question_followup', [], controller.signal);
  controller.abort();
  assert.equal(api.status().busy, true);
  await assert.rejects(api.execute(api.snapshot(), 'question_analysis', []), error => error.code === 'busy');
  finish({ content: '迟到结果' });
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(calls.some(request => request.kind === 'cancel'), true);
  assert.equal(api.status().busy, false);
});

for (const task of ['connection_test','import_organize','batch_review','batch_analysis','question_analysis','question_followup']) {
  test(`统一执行器发送明确任务种类：${task}`, async () => {
    const requests = [];
    const api = client(async (command, args) => { requests.push(args.request); return command === 'harness_execute' ? {content:'{"ok":true}'} : {...status}; });
    await api.initialize();
    await api.execute(api.snapshot(), task, [{role:'user',content:'自建测试数据'}]);
    assert.equal(requests[1].task, task);
  });
}

test('保存 Harness 绕过 API 表单与题库设置写入，原 API 配置原样保留', async () => {
  const source = readFileSync(require.resolve('../../apps/web/app.js'), 'utf8');
  const original = { provider:'ollama',endpoint:'http://127.0.0.1:11434/v1/chat/completions',model:'旧模型',rememberKey:true,timeoutSeconds:60 };
  const state = {settings:{aiImportV99:{...original}}};
  const modes = [];
  const context = vm.createContext({ state, aiTasksBusyV99:()=>false, ShirohaPlatform:{harness:{formMode:()=>'harness',async saveMode(mode){modes.push(mode);}}}, readAiFormV99(){throw new Error('不得读取 API 表单');}, runMutation(){throw new Error('不得写入题库配置');},setAiSettingsStatusV99(){},syncAiImportActionV99(){},updateAiConnectionPillV99(){} });
  vm.runInContext(source.slice(source.indexOf('async function saveAiSettingsV99('),source.indexOf('async function clearAiSettingsV99(')),context);
  await context.saveAiSettingsV99();
  assert.deepEqual(modes,['harness']);
  assert.deepEqual(state.settings.aiImportV99,original);
});

test('切回直接 API 时只改变路由，保留 Codex 运行配置及订阅授权', async () => {
  const requests = [];
  const api = client(async (_command,args) => { requests.push(args.request); return {...status,mode:args.request.mode || status.mode}; });
  await api.initialize();
  await api.saveMode('api');
  assert.equal(requests[1].mode,'api');
  assert.equal(requests[1].model,status.model);
  assert.equal('secret' in requests[1],false);
  assert.equal('rememberKey' in requests[1],false);
  assert.equal('endpoint' in requests[1],false);
  assert.equal(api.snapshot().mode,'api');
});

test('连接测试仅接受校验通过的 JSON，文本响应不能冒充成功', async () => {
  const elements = {'ai-execution-harness':{checked:true},'ai-harness-model':{value:status.model},'ai-harness-timeout':{value:'120'},'ai-harness-status':{}};
  const api = client(async command=>command==='harness_execute'?{content:'已完成！'}:{...status},elements);
  await api.initialize();
  await assert.rejects(api.test(),/不是有效 JSON/);
  assert.match(elements['ai-harness-status'].textContent,/不是有效 JSON/);
  assert.equal(elements['ai-harness-status'].className,'notice warn');
});

for(const available of [false,true])test(`连接测试${available?'执行失败':'尚未就绪'}时清除执行中提示并保留错误`,async()=>{
  const elements={'ai-execution-harness':{checked:true},'ai-harness-model':{value:status.model},'ai-harness-timeout':{value:'120'},'ai-harness-status':{}};
  let executions=0;
  const message=available?'隔离执行失败':'请先完成订阅登录';
  const api=client(async command=>{
    if(command==='harness_execute'){executions++;throw {code:'harness_unavailable',message};}
    return {...status,ready:available,reason:message};
  },elements);
  await api.initialize();
  await assert.rejects(api.test(),error=>error.message===message);
  assert.equal(executions,available?1:0);
  assert.equal(elements['ai-harness-status'].textContent,message);
  assert.equal(elements['ai-harness-status'].className,'notice warn');
  assert.doesNotMatch(elements['ai-harness-status'].textContent,/正在执行/);
});

test('配置更新后拒绝旧快照，未授权不能执行，不静默回退', async () => {
  let current = { ...status };
  let executions = 0;
  const api = client(async command => { if (command === 'harness_execute') executions++; return current; });
  await api.initialize();
  const frozen = api.snapshot();
  current = { ...status, revision: 5 };
  await api.initialize();
  await assert.rejects(api.execute(frozen, 'batch_review', []), error => error.code === 'configuration_changed');
  current = { ...current, ready: false, reason: '请完成订阅登录' };
  await api.initialize();
  await assert.rejects(api.execute(api.snapshot(), 'batch_analysis', []), /订阅登录/);
  assert.equal(executions, 0);
});

test('Harness 初始化失败只关闭 AI 执行，不影响题库初始化', async () => {
  const api = client(async () => { throw { code: 'storage_unavailable', message: '设置读取失败' }; });
  await api.initialize();
  assert.equal(api.status().ready, false);
  assert.match(api.status().reason, /设置读取失败/);
});

test('损坏的执行状态不能隐式回退到直接 API', async () => {
  const api = client(async()=>({mode:'unknown',revision:1,ready:true}));
  await api.initialize();
  assert.equal(api.snapshot().mode,'harness');
  assert.equal(api.snapshot().ready,false);
});

test('Harness 拒绝 API Key 授权状态，只接受订阅登录', async () => {
  const api = client(async()=>({...status,credentialStatus:'remembered'}));
  await api.initialize();
  assert.equal(api.status().ready,false);
  await assert.rejects(api.execute(api.snapshot(),'connection_test',[]),error=>error.code==='harness_unavailable');
});

test('订阅授权只轮询已有登录状态，完成或取消后释放计时器', async () => {
  const timers = new Map();
  let timerId = 0;
  const requests = [];
  let authorization = 'authenticating';
  const api = client(async(_command,args)=>{requests.push(args.request.kind);return {...status,credentialStatus:authorization,ready:authorization==='subscription'};},{},{setTimeout(callback,delay){assert.equal(delay,1000);timers.set(++timerId,callback);return timerId;},clearTimeout(id){timers.delete(id);}});
  await api.initialize();
  assert.equal(timers.size,1);
  const [id,callback] = [...timers][0];timers.delete(id);
  authorization = 'subscription';
  await callback();
  assert.equal(api.status().credentialStatus,'subscription');
  assert.equal(timers.size,0);
  assert.deepEqual(requests,['status','status']);
  authorization = 'authenticating';await api.initialize();
  assert.equal(timers.size,1);
  authorization = 'missing';await api.cancelAll();
  assert.equal(timers.size,0);
});

test('较早发出的 status 迟到不能覆盖登录的新修订或停止授权轮询', async () => {
  const timers = new Map();
  let timerId = 0;
  let resolveStatus;
  let reads = 0;
  const elements = {'ai-harness-login':{},'ai-harness-auth-refresh':{}};
  const initial = {...status,revision:4,credentialStatus:'missing',ready:false};
  const signingIn = {...initial,revision:5,credentialStatus:'authenticating',loginUrl:'https://auth.example.invalid/device',userCode:'TEST-CODE'};
  const api = client(async(_command,args)=>{
    if(args.request.kind==='login')return signingIn;
    if(args.request.kind==='save')return initial;
    if(++reads===1)return initial;
    return new Promise(resolve=>{resolveStatus=resolve;});
  },elements,{setTimeout(callback){timers.set(++timerId,callback);return timerId;},clearTimeout(id){timers.delete(id);}});
  await api.initialize();
  let changed;
  api.bind(()=>changed?.(),()=>false);
  elements['ai-harness-auth-refresh'].onclick();
  const loggedIn = new Promise(resolve=>{changed=()=>{if(api.status().revision===5)resolve();};});
  elements['ai-harness-login'].onclick();
  await loggedIn;
  assert.equal(api.status().revision,5);
  assert.equal(timers.size,1);
  const refreshed = new Promise(resolve=>{changed=resolve;});
  resolveStatus(initial);
  await refreshed;
  assert.equal(api.status().revision,5,'旧 status 覆盖了已接受的新修订');
  assert.equal(api.status().credentialStatus,'authenticating');
  assert.equal(api.status().userCode,'TEST-CODE');
  assert.equal(timers.size,1,'旧 status 停止了仍需进行的授权轮询');
});

for(const action of ['cancel_all','logout']) {
  test(`${action} 完成后迟到的已登录 status 不得恢复授权显示`,async()=>{
    let resolveStatus;
    let reads = 0;
    const elements = {'ai-harness-auth-refresh':{},'ai-harness-logout':{}};
    const ended = {...status,revision:5,credentialStatus:'missing',ready:false};
    const api = client(async(_command,args)=>{
      if(args.request.kind==='logout')return ended;
      if(args.request.kind==='cancel_all')return action==='logout'?status:ended;
      if(++reads===1)return status;
      return new Promise(resolve=>{resolveStatus=resolve;});
    },elements);
    await api.initialize();
    let changed;
    api.bind(()=>changed?.(),()=>false);
    elements['ai-harness-auth-refresh'].onclick();
    if(action==='logout'){
      const loggedOut = new Promise(resolve=>{changed=()=>{if(api.status().revision===5)resolve();};});
      elements['ai-harness-logout'].onclick();
      await loggedOut;
    }else await api.cancelAll();
    assert.equal(api.status().credentialStatus,'missing');
    const refreshed = new Promise(resolve=>{changed=resolve;});
    resolveStatus(status);
    await refreshed;
    assert.equal(api.status().revision,5);
    assert.equal(api.status().credentialStatus,'missing');
    assert.equal(api.status().ready,false);
  });
}

test('取消全部任务等待在途执行终态，再允许保存配置', async () => {
  let finish;
  const api = client(async command=>command==='harness_execute'?new Promise(resolve=>{finish=resolve;}):{...status});
  await api.initialize();
  const pending = api.execute(api.snapshot(),'question_analysis',[]);
  const rejected = assert.rejects(pending,error=>error.name==='AbortError');
  let stopped = false;
  const stopping = api.cancelAll().then(()=>{stopped=true;});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(stopped,false);
  finish({content:'旧结果'});
  await rejected;
  await stopping;
  assert.equal(stopped,true);
  await api.saveMode('api');
});

test('统一入口返回 Harness 内容，失败不走 API response_format 重试', async () => {
  const source = readFileSync(require.resolve('../../apps/web/app.js'), 'utf8');
  const fragment = source.slice(source.indexOf('async function requestAiChatV99('), source.indexOf('async function withAiTimeoutV99('));
  let apiCalls = 0;
  let harnessCalls = 0;
  const context = vm.createContext({ ShirohaPlatform: { credentials: { native: true }, network: { ai() { apiCalls++; } }, harness: { async execute(snapshot, task) { harnessCalls++; assert.equal(snapshot.revision, 4); assert.equal(task, 'import_organize'); throw Object.assign(new Error('额度不足'), { code: 'quota_exceeded' }); } } } });
  vm.runInContext(fragment, context);
  await assert.rejects(context.requestAiChatV99({ execution: status }, [], { task: 'import_organize' }), /额度不足/);
  assert.equal(apiCalls, 0);
  assert.equal(harnessCalls, 1);
});

test('同一修订的 status 逆序返回不能恢复较旧的 busy 状态', async () => {
  const older = deferred();
  const newer = deferred();
  let reads = 0;
  const elements = {'ai-harness-auth-refresh':{}};
  const api = client(async()=>++reads===1?status:reads===2?older.promise:newer.promise,elements);
  await api.initialize();
  api.bind(()=>{},()=>false);
  elements['ai-harness-auth-refresh'].onclick();
  elements['ai-harness-auth-refresh'].onclick();
  newer.resolve({...status,busy:false});
  await settleUi();
  older.resolve({...status,busy:true});
  await settleUi();
  assert.equal(api.status().busy,false);
});

for (const ending of ['success','cancel']) {
  test(`执行 ${ending} 终态重新查询 busy，迟到的运行中 status 不覆盖终态`, async()=>{
    const execution = deferred();
    const delayedStatus = deferred();
    let phase = 'idle';
    let reads = 0;
    const elements = {'ai-harness-auth-refresh':{}};
    const api = client(async(command,args)=>{
      if(command==='harness_execute')return execution.promise;
      if(args.request.kind==='cancel')return {...status,busy:true};
      if(++reads===3)return delayedStatus.promise;
      return {...status,busy:phase==='running'};
    },elements);
    await api.initialize();
    api.bind(()=>{},()=>false);
    const controller = new globalThis.AbortController();
    const pending = api.execute(api.snapshot(),'question_analysis',[],controller.signal);
    const completion = ending==='cancel'?assert.rejects(pending,error=>error.name==='AbortError'):pending;
    phase='running';
    elements['ai-harness-auth-refresh'].onclick();
    await settleUi();
    elements['ai-harness-auth-refresh'].onclick();
    if(ending==='cancel')controller.abort();
    phase='idle';
    execution.resolve({content:'完成结果'});
    await completion;
    assert.equal(api.status().busy,false,'终态必须查询原生状态，不能保留运行中的缓存');
    delayedStatus.resolve({...status,busy:true});
    await settleUi();
    assert.equal(api.status().busy,false,'迟到的同修订查询不能回写运行中状态');
  });
}

for (const ending of ['unreadable','poisoned']) {
  test(`执行终态 ${ending} 时保持不可运行，刷新确认前拒绝旧快照`, async()=>{
    let reads = 0;
    let runs = 0;
    const api = client(async command=>{
      if(command==='harness_execute'){runs++;return {content:'完成结果'};}
      if(++reads===1)return status;
      if(ending==='unreadable')throw {code:'storage_unavailable',message:'状态查询失败'};
      return {...status,ready:false,busy:true,reason:'进程尚未停止'};
    });
    await api.initialize();
    const oldSnapshot = api.snapshot();
    await api.execute(oldSnapshot,'question_analysis',[]);
    assert.equal(api.status().ready,false);
    assert.equal(api.status().busy,true);
    await assert.rejects(api.execute(oldSnapshot,'question_analysis',[]));
    assert.equal(runs,1);
  });
}

for (const action of ['logout','clear']) {
  test(`${action} 开始即停用；失败刷新真实状态且旧授权不得复活，允许重试退出`, async()=>{
    const operation = deferred();
    let reads = 0;
    let attempts = 0;
    const elements = {'ai-harness-logout':{},'ai-harness-auth-refresh':{},'ai-harness-status':{}};
    const api = client(async(_command,args)=>{
      if(args.request.kind==='status'){reads++;return status;}
      if(args.request.kind==='cancel_all')return status;
      if(args.request.kind===action && ++attempts===1)return operation.promise;
      return {...status,revision:5,credentialStatus:'missing',ready:false};
    },elements);
    await api.initialize();
    api.bind(()=>{},()=>false);
    const oldSnapshot = api.snapshot();
    let failed;
    if(action==='clear')failed=assert.rejects(api.clear(),/退出失败/);
    else elements['ai-harness-logout'].onclick();
    assert.equal(api.status().ready,false,'破坏性操作开始时不再显示可运行');
    await assert.rejects(api.execute(oldSnapshot,'question_analysis',[]));
    operation.reject({code:'logout_incomplete',message:'退出失败'});
    if(failed)await failed;
    await settleUi();
    assert.ok(reads>=2,'失败后必须查询原生状态');
    assert.equal(api.status().ready,false,'失败后的旧订阅状态不能重新启用');
    assert.equal(api.status().credentialStatus,'missing');
    assert.match(api.status().reason,/重试退出/);
    elements['ai-harness-auth-refresh'].onclick();
    await settleUi();
    assert.equal(api.status().ready,false,'手动刷新旧状态也不能绕过未完成退出');
    elements['ai-harness-logout'].onclick();
    await settleUi();
    assert.equal(api.status().revision,5);
    assert.equal(api.status().credentialStatus,'missing');
    assert.equal(api.status().ready,false);
  });
}

test('cancel_all 期间查询不得覆盖完成结果，即使查询与完成共用 revision',async()=>{
  const stopping = deferred();
  const observed = deferred();
  let reads = 0;
  const elements = {'ai-harness-auth-refresh':{}};
  const api = client(async(_command,args)=>{
    if(args.request.kind==='cancel_all')return stopping.promise;
    return ++reads===1?status:observed.promise;
  },elements);
  await api.initialize();
  api.bind(()=>{},()=>false);
  const cancelled = api.cancelAll();
  elements['ai-harness-auth-refresh'].onclick();
  observed.resolve({...status,busy:true,ready:false});
  await settleUi();
  stopping.resolve(status);
  await cancelled;
  assert.equal(api.status().busy,false);
  assert.equal(api.status().ready,true);
});

test('终态查询过程中取消仍等待停止并重新确认状态，不返回已取消的结果',async()=>{
  const terminal = deferred();
  const stopping = deferred();
  let reads = 0;
  let phase = 'idle';
  const api = client(async(command,args)=>{
    if(command==='harness_execute')return {content:'不能采用的结果'};
    if(args.request.kind==='cancel')return stopping.promise;
    if(++reads===2){phase='refreshing';return terminal.promise;}
    return status;
  });
  await api.initialize();
  const controller = new globalThis.AbortController();
  const pending = api.execute(api.snapshot(),'question_analysis',[],controller.signal);
  const rejected = assert.rejects(pending,error=>error.name==='AbortError');
  await settleUi();
  assert.equal(phase,'refreshing');
  controller.abort();
  terminal.resolve({...status,busy:true});
  await settleUi();
  assert.equal(api.status().busy,true);
  stopping.resolve(status);
  await rejected;
  assert.equal(api.status().busy,false);
  assert.ok(reads>=3,'取消后的终态必须再确认');
});

test('退出失败且状态读取失败后仍可重试退出，新的登录不绕过未完成清理',async()=>{
  let phase = 'initial';
  let logins = 0;
  const elements = {'ai-harness-logout':{},'ai-harness-login':{},'ai-harness-status':{}};
  const api = client(async(_command,args)=>{
    if(args.request.kind==='status' && phase==='failed')throw {message:'状态读取失败'};
    if(args.request.kind==='logout' && phase==='initial'){phase='failed';throw {message:'退出失败'};}
    if(args.request.kind==='login')logins++;
    return phase==='retry'?{...status,revision:5,credentialStatus:'missing',ready:false}:status;
  },elements);
  await api.initialize();
  api.bind(()=>{},()=>false);
  elements['ai-harness-logout'].onclick();
  await settleUi();
  assert.equal(api.status().ready,false);
  assert.equal(api.status().busy,true);
  elements['ai-harness-login'].onclick();
  await settleUi();
  assert.equal(logins,0);
  phase='retry';
  elements['ai-harness-logout'].onclick();
  await settleUi();
  assert.equal(api.status().busy,false);
  assert.equal(api.status().credentialStatus,'missing');
  assert.equal(api.status().revision,5);
});

test('初始化与 API 页面不准备组件，选择 Harness 后自动单次准备且展示真实字节',async()=>{
  const calls=[];const elements=settingsElements();const clock=pollingClock();
  const preparing={...managedStatus,runtimeState:'preparing',runtimeReceivedBytes:1024,runtimeTotalBytes:341270320,busy:true,revision:5};
  const api=client(async(_command,{request})=>{calls.push(request.kind);return request.kind==='prepare_runtime'?preparing:managedStatus;},elements,clock);
  await api.initialize();api.bind(()=>{},()=>false);api.render();await settleUi();
  assert.deepEqual(calls,['status']);
  elements['ai-execution-harness'].checked=true;elements['ai-execution-harness'].onchange();
  await settleUi();elements['ai-execution-harness'].onchange();await settleUi();
  assert.equal(calls.filter(kind=>kind==='prepare_runtime').length,1);
  assert.equal(calls.includes('login'),false);assert.equal(calls.includes('save'),false);
  assert.match(elements['ai-harness-runtime-status'].textContent,/准备中/);
  assert.match(elements['ai-harness-runtime-progress'].textContent,/1,024.*341,270,320.*字节/);
});

test('登录加入准备任务，组件就绪后才自动保存并登录，不自动调用模型',async()=>{
  const calls=[];const elements=settingsElements();const clock=pollingClock();let native={...managedStatus};
  const api=client(async(command,{request})=>{
    assert.equal(command,'harness_control','准备与登录不得执行模型任务');calls.push({...request});
    if(request.kind==='prepare_runtime')native={...native,runtimeState:'preparing',busy:true,revision:5};
    if(request.kind==='save'){assert.equal(native.runtimeState,'ready');assert.equal(request.revision,native.revision);native={...native,mode:request.mode,model:request.model,timeoutSeconds:request.timeoutSeconds,revision:7};}
    if(request.kind==='login')native={...native,credentialStatus:'authenticating',revision:8};
    return {...native};
  },elements,clock);
  await api.initialize();api.bind(()=>{},()=>false);
  elements['ai-execution-harness'].checked=true;elements['ai-execution-harness'].onchange();
  await settleUi();elements['ai-harness-login'].onclick();elements['ai-harness-login'].onclick();await settleUi();
  assert.equal(calls.some(call=>call.kind==='save'||call.kind==='login'),false);
  native={...native,runtimeState:'ready',runtimePath:'managed-fixture.exe',busy:false,revision:6};
  await clock.tick();await settleUi();
  assert.deepEqual(calls.filter(call=>call.kind!=='status').map(call=>call.kind),['prepare_runtime','save','login']);
  const saved=calls.find(call=>call.kind==='save');assert.equal(saved.model,'gpt-6.1-sol');assert.equal(saved.timeoutSeconds,120);
  assert.equal('secret' in saved,false);assert.equal('endpoint' in saved,false);
  assert.equal(api.status().credentialStatus,'authenticating');
});

for(const outcome of ['failed','cancelled'])test(`准备 ${outcome} 后不继续登录或自动重试，显式重试才重新准备`,async()=>{
  const calls=[];const elements=settingsElements();const clock=pollingClock();let native={...managedStatus};
  const api=client(async(_command,{request})=>{calls.push(request.kind);if(request.kind==='prepare_runtime')native={...native,runtimeState:'preparing',busy:true,revision:native.revision+1};return {...native};},elements,clock);
  await api.initialize();api.bind(()=>{},()=>false);elements['ai-execution-harness'].checked=true;
  elements['ai-harness-login'].onclick();await settleUi();
  native={...native,runtimeState:outcome,busy:false,reason:'组件准备未完成'};
  await clock.tick();await settleUi();elements['ai-execution-harness'].onchange();await settleUi();
  assert.equal(calls.filter(kind=>kind==='prepare_runtime').length,1);
  assert.equal(calls.includes('save'),false);assert.equal(calls.includes('login'),false);
  elements['ai-harness-prepare'].onclick();await settleUi();
  assert.equal(calls.filter(kind=>kind==='prepare_runtime').length,2);
});

test('切回 API 取消准备和待续登录，迟到的已准备状态不能重新登录',async()=>{
  const prepared=deferred();const calls=[];const elements=settingsElements();const clock=pollingClock();let reads=0;
  const api=client(async(_command,{request})=>{
    calls.push(request.kind);
    if(request.kind==='prepare_runtime')return {...managedStatus,runtimeState:'preparing',busy:true,revision:5};
    if(request.kind==='cancel_all')return {...managedStatus,runtimeState:'cancelled',revision:6};
    if(++reads===1)return managedStatus;
    return prepared.promise;
  },elements,clock);
  await api.initialize();api.bind(()=>{},()=>false);elements['ai-execution-harness'].checked=true;
  elements['ai-harness-login'].onclick();await settleUi();
  const poll=clock.tick();await settleUi();
  elements['ai-execution-api'].checked=true;elements['ai-execution-api'].onchange();await settleUi();
  prepared.resolve({...managedStatus,runtimeState:'ready',revision:5});await poll;await settleUi();
  assert.equal(calls.includes('cancel_all'),true);assert.equal(calls.includes('save'),false);assert.equal(calls.includes('login'),false);
  assert.equal(api.status().runtimeState,'cancelled');assert.equal(api.formMode(),'api');
});

test('自定义组件保留来源，只有高级恢复自动管理操作才请求切换',async()=>{
  const elements=settingsElements();const clock=pollingClock();const calls=[];
  let native={...status,credentialStatus:'missing',ready:false};
  const api=client(async(_command,{request})=>{calls.push(request.kind);if(request.kind==='use_managed_runtime')native={...native,runtimeState:'preparing',busy:true,revision:5};return {...native};},elements,clock);
  await api.initialize();api.bind(()=>{},()=>false);api.render();await settleUi();
  assert.deepEqual(calls,['status','inspect']);assert.equal(api.status().runtimeSource,'custom');
  elements['ai-harness-use-managed'].onclick();await settleUi();assert.equal(calls.includes('use_managed_runtime'),true);
  native={...native,runtimeState:'failed',busy:false,reason:'隔离下载失败'};await clock.tick();await settleUi();
  assert.equal(api.status().runtimeSource,'custom');assert.equal(api.status().runtimePath,'fixture.exe');
});

test('准备就绪进入 Harness 时只显式检查一次，刷新状态可重新核验订阅',async()=>{
  const elements=settingsElements();elements['ai-harness-auth-refresh']={};const calls=[];
  const api=client(async(_command,{request})=>{calls.push(request.kind);return {...status,credentialStatus:request.kind==='inspect'?'subscription':'missing',ready:request.kind==='inspect'};},elements);
  await api.initialize();assert.deepEqual(calls,['status']);api.bind(()=>{},()=>false);
  api.render();await settleUi();api.render();await settleUi();
  assert.deepEqual(calls,['status','inspect']);
  elements['ai-harness-auth-refresh'].onclick();await settleUi();
  assert.equal(calls.at(-1),'inspect');assert.equal(api.status().credentialStatus,'subscription');
});

test('自动保存发现现有订阅时直接就绪，不重复启动登录',async()=>{
  const elements=settingsElements();const calls=[];
  const api=client(async(_command,{request})=>{calls.push(request.kind);return {...status,credentialStatus:request.kind==='save'?'subscription':'missing',ready:request.kind==='save'};},elements);
  await api.initialize();api.bind(()=>{},()=>false);elements['ai-harness-login'].onclick();await settleUi();
  assert.deepEqual(calls,['status','save']);assert.equal(api.status().credentialStatus,'subscription');
});

test('自动保存尚未返回时切 API 不能继续登录或把界面切回 Harness',async()=>{
  const saving=deferred();const elements=settingsElements();const calls=[];
  const api=client(async(_command,{request})=>{
    calls.push(request.kind);
    if(request.kind==='save')return saving.promise;
    return {...managedStatus,runtimeState:'ready',revision:request.kind==='cancel_all'?6:4};
  },elements);
  await api.initialize();api.bind(()=>{},()=>false);elements['ai-execution-harness'].checked=true;
  elements['ai-harness-login'].onclick();await settleUi();assert.equal(calls.includes('save'),true);
  elements['ai-execution-api'].checked=true;elements['ai-execution-api'].onchange();await settleUi();
  saving.resolve({...status,revision:5});await settleUi();
  assert.equal(calls.includes('login'),false);assert.equal(api.formMode(),'api');assert.equal(api.status().revision,6);
});

test('恢复初始化废弃等待准备的登录流程，初始化本身不重启准备',async()=>{
  const elements=settingsElements();const clock=pollingClock();const calls=[];let native={...managedStatus};
  const api=client(async(_command,{request})=>{calls.push(request.kind);if(request.kind==='prepare_runtime')native={...native,runtimeState:'preparing',busy:true,revision:5};return {...native};},elements,clock);
  await api.initialize();api.bind(()=>{},()=>false);elements['ai-execution-harness'].checked=true;elements['ai-harness-login'].onclick();await settleUi();
  native={...managedStatus,revision:6};await api.initialize();await settleUi();
  assert.equal(calls.filter(kind=>kind==='prepare_runtime').length,1);assert.equal(calls.includes('save'),false);assert.equal(calls.includes('login'),false);assert.equal(clock.timers.size,0);
});

test('恢复后仍停留在 Harness 页面时渲染不重新准备，重新选择才激活',async()=>{
  const elements=settingsElements();const clock=pollingClock();const calls=[];let native={...status};
  const api=client(async(_command,{request})=>{calls.push(request.kind);if(request.kind==='prepare_runtime')native={...native,runtimeState:'preparing',busy:true};return {...native};},elements,clock);
  await api.initialize();api.bind(()=>{},()=>false);api.render();await settleUi();
  assert.equal(elements['ai-execution-harness'].checked,true);
  native={...native,runtimeState:'unprepared',ready:false,revision:5};
  calls.length=0;await api.initialize();api.render();await settleUi();
  assert.deepEqual(calls,['status'],'恢复后的普通渲染不能自动启动准备或检测');
  elements['ai-execution-api'].checked=true;elements['ai-execution-api'].onchange();
  elements['ai-execution-harness'].checked=true;elements['ai-execution-harness'].onchange();await settleUi();
  assert.deepEqual(calls,['status','prepare_runtime'],'用户重新选择 Harness 后仍应自动准备');
});

test('自定义来源恢复自动管理时展示受管下载进度，失败后恢复来源显示',async()=>{
  const elements=settingsElements();const clock=pollingClock();let native={...status};
  const api=client(async(_command,{request})=>{
    if(request.kind==='use_managed_runtime')native={...native,runtimeState:'preparing',runtimeReceivedBytes:1024,runtimeTotalBytes:341270320,busy:true,revision:5};
    return {...native};
  },elements,clock);
  await api.initialize();api.bind(()=>{},()=>false);elements['ai-harness-use-managed'].onclick();await settleUi();
  assert.equal(api.status().runtimeSource,'custom','准备成功前不能改已保存来源');
  assert.equal(api.status().runtimePath,'fixture.exe');
  assert.match(elements['ai-harness-runtime-status'].textContent,/自动管理.*准备中/);
  assert.equal(elements['ai-harness-runtime-progress'].hidden,false);
  assert.match(elements['ai-harness-runtime-progress'].textContent,/1,024.*341,270,320.*字节/);
  native={...native,runtimeState:'failed',busy:false,reason:'隔离下载失败'};await clock.tick();await settleUi();
  assert.match(elements['ai-harness-runtime-status'].textContent,/自定义程序.*失败/);
  assert.equal(elements['ai-harness-runtime-progress'].hidden,true);
});
