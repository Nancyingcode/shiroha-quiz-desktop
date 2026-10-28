'use strict';
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const ready = {mode:'harness',adapter:'codebuddy',model:'deepseek-v4.1-flash',timeoutSeconds:120,credentialStatus:'subscription',runtimePath:'isolated-fake-codebuddy.exe',runtimeVersion:'2.175.0',runtimeSource:'managed',runtimeState:'ready',runtimeReceivedBytes:0,runtimeTotalBytes:0,ready:true,reason:'',revision:4,accountRevision:7,busy:false};
const tick = () => new Promise(globalThis.setImmediate);
function deferred() { let resolve,reject; const promise=new Promise((accept,fail)=>{resolve=accept;reject=fail;}); return {promise,resolve,reject}; }
function fixture(invoke,initial=ready) {
  const elements={};
  for(const id of ['ai-execution-settings','ai-harness-settings','ai-codex-settings','ai-codebuddy-settings','ai-deepseek-settings','ai-api-settings-fields','ai-settings-actions','ai-save-settings-v99','ai-test-connection-v99','ai-clear-settings-v99','ai-settings-status-v99','ai-codebuddy-prepare','ai-codebuddy-prepare-cancel','ai-codebuddy-stop','ai-codebuddy-execution-status','ai-codebuddy-runtime-status','ai-codebuddy-runtime-progress'])elements[id]={};
  elements['ai-execution-harness']={checked:true};elements['ai-harness-adapter']={value:initial.adapter};
  elements['ai-harness-model']={value:'saved-codex-model'};elements['ai-harness-timeout']={value:'600'};
  elements['ai-codebuddy-model']={value:initial.model};elements['ai-codebuddy-model-status']={};elements['ai-codebuddy-model-retry']={};
  const events=[];
  const context=vm.createContext({document:{getElementById:id=>elements[id]||null,dispatchEvent:event=>events.push(event.type)},Event:globalThis.Event,AbortController:globalThis.AbortController,crypto:{randomUUID:()=> 'codebuddy-fixture'},setTimeout,clearTimeout,ShirohaPlatform:{},ShirohaDesktopHost:{invoke}});
  vm.runInContext(readFileSync(require.resolve('../../apps/desktop/frontend/harness.js'),'utf8'),context);
  return {api:context.ShirohaPlatform.harness,elements,events};
}

test('CodeBuddy account warning appears only inside its provider card',async()=>{
  const f=fixture(async()=>({...ready,accountRevision:undefined,ready:false}));
  await f.api.initialize();f.api.render();
  const message=f.elements['ai-codebuddy-execution-status'].textContent;
  assert.match(message,/组件与账户就绪/);
  assert.doesNotMatch(message,/账户状态尚未确认/);
  assert.notEqual(f.elements['ai-settings-status-v99'].textContent,message);
  assert.match(f.elements['ai-settings-status-v99'].textContent,/组件.*登录/);
});

test('CodeBuddy freezes both revisions for its three tasks without consulting Codex fields',async()=>{
  const calls=[];const f=fixture(async(command,{request})=>{calls.push({command,...request});return command==='harness_execute'?{content:'{"ok":true}'}:{...ready};});
  await f.api.initialize();f.api.bind(()=>{},()=>false);
  assert.equal(f.api.snapshot().ready,true);
  assert.equal(f.elements['ai-test-connection-v99'].hidden,false);
  assert.equal(f.elements['ai-clear-settings-v99'].hidden,true);
  for(const task of ['connection_test','question_analysis','question_followup'])await f.api.execute(f.api.snapshot(),task,[{role:'user',content:'合成题目'}]);
  const runs=calls.filter(call=>call.command==='harness_execute');assert.equal(runs.length,3);
  for(const run of runs){assert.equal(run.revision,4);assert.equal(run.accountRevision,7);assert.equal(Object.hasOwn(run,'model'),false);}
  await f.api.test();assert.equal(calls.filter(call=>call.command==='harness_execute').length,4);
  assert.equal(calls.some(call=>['login','inspect','choose_runtime','use_managed_runtime'].includes(call.kind)),false);
});

test('CodeBuddy connection requests a bare exact JSON object without extra formatting',async()=>{
  const calls=[];const f=fixture(async(command,{request})=>{if(command==='harness_execute'){calls.push(request);return {content:'{"ok":true}'};}return {...ready};});
  await f.api.initialize();await f.api.test();
  assert.equal(calls.length,1);assert.equal(calls[0].task,'connection_test');
  assert.match(calls[0].messages[0].content,/不要 Markdown/);
  assert.match(calls[0].messages[0].content,/不要额外字段/);
  assert.equal(calls[0].messages[1].content,'回复 {"ok":true}');
});

test('CodeBuddy explicitly rejects batch/import and missing or stale account revisions before IPC',async()=>{
  const calls=[];const f=fixture(async(command,{request})=>{calls.push({command,...request});return {...ready};});await f.api.initialize();
  for(const task of ['import_organize','batch_review','batch_analysis'])await assert.rejects(f.api.execute(f.api.snapshot(),task,[]),/批量|导入/);
  for(const accountRevision of [undefined,6,NaN,-1])await assert.rejects(f.api.execute({...ready,accountRevision},'question_analysis',[]),/账户|配置/);
  assert.equal(calls.some(call=>call.command==='harness_execute'),false);
});

test('CodeBuddy account cleanup blocks immediately and only confirmed current login restores readiness',async()=>{
  let native={...ready};const f=fixture(async()=>({...native}));await f.api.initialize();const old=f.api.snapshot();
  f.api.codebuddyAccountChanged({revision:7,phase:'signed_in',blocked:true});
  assert.equal(f.api.snapshot().ready,false);await assert.rejects(f.api.execute(old,'question_analysis',[]));
  await f.api.initialize();assert.equal(f.api.snapshot().ready,false,'普通重读不能绕过未完成退出');
  native={...ready,accountRevision:8,credentialStatus:'missing',ready:false};
  f.api.codebuddyAccountChanged({revision:8,phase:'signed_out',blocked:false});await tick();
  native={...ready,accountRevision:9};
  f.api.codebuddyAccountChanged({revision:9,phase:'authenticating',blocked:false});
  f.api.codebuddyAccountChanged({revision:9,phase:'signed_in',blocked:false});await tick();
  assert.equal(f.api.snapshot().ready,true);assert.equal(f.api.snapshot().accountRevision,9);
  await assert.rejects(f.api.execute(old,'question_analysis',[]));
});

test('CodeBuddy account notification never cancels or refreshes the active Codex provider',async()=>{
  const native={...ready,adapter:'codex',accountRevision:undefined,model:'saved-codex-model'};const result=deferred();const calls=[];
  const f=fixture(async(command,{request})=>{calls.push({command,...request});return command==='harness_execute'?result.promise:{...native};},native);await f.api.initialize();
  const pending=f.api.execute(f.api.snapshot(),'question_analysis',[]);
  f.api.codebuddyAccountChanged({revision:8,phase:'signed_out',blocked:false});
  assert.equal(calls.length,2);result.resolve({content:'Codex 原结果'});assert.equal((await pending).content,'Codex 原结果');
  assert.equal(calls.some(call=>call.kind==='cancel_all'||call.kind==='cancel'),false);
});

test('CodeBuddy old candidate is discarded after account changes and auth loss refreshes account card',async()=>{
  const result=deferred();let native={...ready};const f=fixture(async command=>command==='harness_execute'?result.promise:{...native});await f.api.initialize();f.events.length=0;
  const pending=f.api.execute(f.api.snapshot(),'question_analysis',[]);const rejected=assert.rejects(pending,/账户|取消/);
  native={...ready,accountRevision:8,credentialStatus:'missing',ready:false};
  result.resolve({content:'不应采用'});await rejected;
  assert.equal(f.api.snapshot().ready,false);assert(f.events.includes('shiroha-codebuddy-account-refresh'));
});

test('CodeBuddy cancelAll waits for native execution to settle',async()=>{
  const result=deferred();const calls=[];const f=fixture(async(command,{request})=>{calls.push({command,...request});return command==='harness_execute'?result.promise:{...ready};});await f.api.initialize();
  f.api.bind(()=>{},()=>false);
  const pending=f.api.execute(f.api.snapshot(),'question_analysis',[]);const rejected=assert.rejects(pending,error=>error.name==='AbortError');
  assert.equal(f.elements['ai-codebuddy-stop'].hidden,false,'连接测试等在途请求必须能从设置页停止');
  let stopped=false;const stop=f.api.cancelAll().then(()=>{stopped=true;});await tick();
  assert.equal(stopped,false);assert(calls.some(call=>call.kind==='cancel_all'));
  result.resolve({content:'迟到结果'});await rejected;await stop;assert.equal(f.api.status().busy,false);
});

test('CodeBuddy explicit component preparation uses current provider and never Codex inspect',async()=>{
  let native={...ready,runtimeState:'unprepared',runtimePath:'',ready:false};const calls=[];
  const f=fixture(async(_command,{request})=>{calls.push(request.kind);if(request.kind==='prepare_runtime')native={...ready};return {...native};});
  await f.api.initialize();f.api.bind(()=>{},()=>false);f.elements['ai-codebuddy-prepare'].onclick();await tick();
  assert.equal(f.api.snapshot().runtimeState,'ready');assert.deepEqual(calls,['status','prepare_runtime']);
});

test('first unchanged account observation does not invalidate an already running CodeBuddy request',async()=>{
  const result=deferred();const f=fixture(async command=>command==='harness_execute'?result.promise:{...ready});await f.api.initialize();
  const pending=f.api.execute(f.api.snapshot(),'question_analysis',[]);
  f.api.codebuddyAccountChanged({revision:7,phase:'signed_in',blocked:false});
  result.resolve({content:'当前账户结果'});assert.equal((await pending).content,'当前账户结果');
});

test('account card refresh rechecks Harness after an earlier unreadable status without changing account',async()=>{
  let native={...ready,ready:false,reason:'等待刷新'};const f=fixture(async()=>({...native}));await f.api.initialize();
  f.api.codebuddyAccountChanged({revision:7,phase:'signed_in',blocked:false});await tick();
  native={...ready};f.api.codebuddyAccountChanged({revision:7,phase:'signed_in',blocked:false});await tick();
  assert.equal(f.api.snapshot().ready,true);
});

test('shared business routes only the three CodeBuddy tasks and never retries through API',async()=>{
  const source=readFileSync(require.resolve('../../apps/web/app.js'),'utf8');const runs=[];let network=0;
  const context=vm.createContext({ShirohaPlatform:{harness:{snapshot:()=>({...ready}),execute:async(snapshot,task)=>{runs.push({snapshot,task});return {content:'合成结果'};}},network:{ai:()=>network++}},AI_PROVIDER_PRESETS_V99:{}});
  vm.runInContext(source.slice(source.indexOf('function aiProviderLabelV99('),source.indexOf('function normalizeAiEndpointV99(')),context);
  vm.runInContext(source.slice(source.indexOf('async function requestAiChatV99('),source.indexOf('async function withAiTimeoutV99(')),context);
  const config=context.aiExecutionConfigV99();assert.equal(config.model,ready.model);assert.equal(config.timeoutSeconds,120);
  for(const task of ['connection_test','question_analysis','question_followup']){
    assert.equal(context.aiConfiguredV99(config,task),true);await context.requestAiChatV99(config,[],{task});
  }
  for(const task of ['import_organize','batch_review','batch_analysis']){
    assert.equal(context.aiConfiguredV99(config,task),false);await assert.rejects(context.requestAiChatV99(config,[],{task}),/批量|导入/);
  }
  assert.equal(runs.length,3);assert.equal(network,0);assert.match(context.aiHarnessPrivacyV99(config,'本题文字'),/CodeBuddy/);assert.doesNotMatch(context.aiHarnessPrivacyV99(config,'本题文字'),/OpenAI|尚未开放模型/);
});

test('CodeBuddy model selection autosaves its revision and blocks old snapshots without calling a model',async()=>{
  const saving=deferred();const stale=deferred();const calls=[];let reads=0;let native={...ready};
  const f=fixture(async(command,{request})=>{calls.push({command,...request});if(request.kind==='select_model')return saving.promise;if(request.kind==='status'&&++reads===2)return stale.promise;return {...native};});
  await f.api.initialize();f.api.bind(()=>{},()=>false);const old=f.api.snapshot();
  f.api.codebuddyAccountChanged({revision:7,phase:'signed_in',blocked:false});await tick();
  const pending=f.api.selectModel('hy4-preview');
  assert.equal(f.api.snapshot().ready,false);assert.equal(f.api.snapshot().model,'hy4-preview');assert.equal(f.elements['ai-codebuddy-model'].disabled,true);
  await assert.rejects(f.api.execute(old,'question_analysis',[]));
  native={...ready,model:'hy4-preview',revision:5};saving.resolve(native);await pending;
  stale.resolve({...ready,revision:99});await tick();f.api.render();
  assert.equal(f.api.snapshot().model,'hy4-preview');assert.equal(f.api.snapshot().ready,true);assert.equal(f.api.snapshot().accountRevision,7);
  assert.equal(f.elements['ai-codebuddy-model'].value,'hy4-preview');assert.equal(f.elements['ai-harness-model'].value,'saved-codex-model');
  await assert.rejects(f.api.execute(old,'question_analysis',[]),/配置/);
  assert.deepEqual(calls.find(call=>call.kind==='select_model'),{command:'harness_control',kind:'select_model',model:'hy4-preview',revision:4});
  assert.equal(calls.some(call=>call.command==='harness_execute'||['save','login','logout','clear'].includes(call.kind)),false);
});

test('failed CodeBuddy model save retains its draft through refresh and retries against current revision',async()=>{
  const calls=[];let fail=true;let native={...ready};
  const f=fixture(async(command,{request})=>{calls.push({command,...request});if(request.kind==='select_model'){if(fail)throw {code:'save_failed',message:'合成保存失败'};native={...native,model:request.model,revision:native.revision+1};}return {...native};});
  await f.api.initialize();f.api.bind(()=>{},()=>false);const old=f.api.snapshot();
  await assert.rejects(f.api.selectModel('hy3'),/保存失败/);
  native={...ready,revision:6};f.api.codebuddyAccountChanged({revision:7,phase:'signed_in',blocked:false});await tick();f.api.render();
  assert.equal(f.elements['ai-codebuddy-model'].value,'hy3');assert.equal(f.elements['ai-codebuddy-model-retry'].hidden,false);
  assert.equal(f.api.snapshot().ready,false);await assert.rejects(f.api.execute(old,'question_analysis',[]));await assert.rejects(f.api.test());
  fail=false;f.elements['ai-codebuddy-model-retry'].onclick();await tick();
  assert.equal(f.api.snapshot().ready,true);assert.equal(f.api.snapshot().model,'hy3');assert.equal(f.api.snapshot().revision,7);
  assert.equal(calls.filter(call=>call.kind==='select_model').at(-1).revision,6);
  assert.equal(calls.some(call=>call.command==='harness_execute'||['login','logout','clear'].includes(call.kind)),false);
});

test('CodeBuddy model changes reject busy, unsupported and other-provider selections before IPC',async()=>{
  let busy=true;const calls=[];const f=fixture(async(command,{request})=>{calls.push({command,...request});return {...ready};});
  await f.api.initialize();f.api.bind(()=>{},()=>busy);
  assert.equal(f.elements['ai-codebuddy-model'].disabled,true);await assert.rejects(f.api.selectModel('hy3'),error=>error.code==='busy');
  busy=false;await assert.rejects(f.api.selectModel('arbitrary-remote-model'),/模型/);
  const codex=fixture(async()=>({...ready,adapter:'codex',model:'saved-codex-model'}));await codex.api.initialize();
  await assert.rejects(codex.api.selectModel('hy3'),/CodeBuddy/);
  assert.equal(calls.some(call=>call.kind==='select_model'),false);
});

test('CodeBuddy dropdown changes save only the selected model and require confirmed native acknowledgement',async()=>{
  const calls=[];let confirm=false;let native={...ready};
  const f=fixture(async(command,{request})=>{calls.push({command,...request});if(request.kind==='select_model'&&confirm)native={...native,model:request.model,revision:native.revision+1};return {...native};});
  await f.api.initialize();f.api.bind(()=>{},()=>false);
  f.elements['ai-codebuddy-model'].value='default';f.elements['ai-codebuddy-model'].onchange();await tick();
  assert.equal(f.api.snapshot().ready,false);assert.equal(f.elements['ai-codebuddy-model'].value,'default');
  assert.match(f.elements['ai-codebuddy-model-status'].textContent,/尚未确认保存/);
  confirm=true;f.elements['ai-codebuddy-model-retry'].onclick();await tick();
  assert.equal(f.api.snapshot().ready,true);assert.equal(f.api.snapshot().model,'default');
  assert.deepEqual(calls.filter(call=>call.kind==='select_model').map(call=>call.model),['default','default']);
  assert.equal(calls.some(call=>call.command==='harness_execute'),false);
});

test('saving a CodeBuddy model does not revert an API radio choice made while the reply is pending',async()=>{
  const saving=deferred();const f=fixture(async(_command,{request})=>request.kind==='select_model'?saving.promise:{...ready});
  f.elements['ai-execution-api']={checked:false};
  await f.api.initialize();f.api.bind(()=>{},()=>false);const pending=f.api.selectModel('hy3');
  f.elements['ai-execution-harness'].checked=false;f.elements['ai-execution-api'].checked=true;f.elements['ai-execution-api'].onchange();
  saving.resolve({...ready,model:'hy3',revision:5});await pending;
  assert.equal(f.api.formMode(),'api');assert.equal(f.elements['ai-codebuddy-settings'].hidden,true);assert.equal(f.api.snapshot().model,'hy3');
});

test('unsaved Harness mode blocks model drafts until the execution mode is saved',async()=>{
  let native={...ready,mode:'api'};const calls=[];
  const f=fixture(async(command,{request})=>{calls.push({command,...request});if(request.kind==='save')native={...native,mode:request.mode,revision:native.revision+1};if(request.kind==='select_model'){assert.equal(native.mode,'harness');native={...native,model:request.model,revision:native.revision+1};}return {...native};},native);
  f.elements['ai-execution-api']={checked:true};f.elements['ai-execution-harness'].checked=false;
  await f.api.initialize();f.api.bind(()=>{},()=>false);
  f.elements['ai-execution-api'].checked=false;f.elements['ai-execution-harness'].checked=true;f.elements['ai-execution-harness'].onchange();
  assert.equal(f.elements['ai-codebuddy-model'].disabled,true);assert.match(f.elements['ai-codebuddy-model-status'].textContent,/先保存/);
  await assert.rejects(f.api.selectModel('hy3'),/先保存/);
  assert.equal(f.api.snapshot().model,ready.model);assert.equal(f.elements['ai-codebuddy-model-retry'].hidden,true);
  assert.equal(calls.some(call=>call.kind==='select_model'),false);
  await f.api.saveMode('harness');assert.equal(f.elements['ai-codebuddy-model'].disabled,false);
  await f.api.selectModel('hy3');assert.equal(f.api.snapshot().model,'hy3');assert.equal(f.api.snapshot().ready,true);
});

test('returning from API saves Harness mode before retrying a retained failed model draft',async()=>{
  let native={...ready};let fail=true;const calls=[];
  const f=fixture(async(command,{request})=>{calls.push({command,...request});if(request.kind==='save')native={...native,mode:request.mode,revision:native.revision+1};if(request.kind==='select_model'){assert.equal(native.mode,'harness');assert.equal(request.revision,native.revision);if(fail)throw new Error('合成保存失败');native={...native,model:request.model,revision:native.revision+1};}return {...native};});
  f.elements['ai-execution-api']={checked:false};await f.api.initialize();f.api.bind(()=>{},()=>false);
  await assert.rejects(f.api.selectModel('hy3'),/保存失败/);
  f.elements['ai-execution-harness'].checked=false;f.elements['ai-execution-api'].checked=true;await f.api.saveMode('api');
  f.elements['ai-execution-api'].checked=false;f.elements['ai-execution-harness'].checked=true;f.elements['ai-execution-harness'].onchange();
  const before=calls.length;await assert.rejects(f.api.saveMode('harness'),/保存失败/);
  assert.deepEqual(calls.slice(before).filter(call=>call.kind!=='status').map(call=>call.kind),['save','select_model']);
  assert.equal(f.api.snapshot().mode,'harness');assert.equal(f.api.snapshot().ready,false);assert.equal(f.elements['ai-codebuddy-model'].value,'hy3');
  fail=false;await f.api.saveMode('harness');assert.equal(f.api.snapshot().model,'hy3');assert.equal(f.api.snapshot().ready,true);
  assert.equal(calls.some(call=>call.command==='harness_execute'||['login','logout','clear'].includes(call.kind)),false);
});

test('failed CodeBuddy model draft does not block switching providers and remains pending on return',async()=>{
  let native={...ready};const calls=[];
  const f=fixture(async(command,{request})=>{calls.push({command,...request});if(request.kind==='select_model')throw new Error('合成保存失败');if(request.kind==='select_adapter')native={...native,adapter:request.adapter,model:request.adapter==='codex'?'saved-codex-model':ready.model,revision:native.revision+1};return {...native};});
  await f.api.initialize();f.api.bind(()=>{},()=>false);await assert.rejects(f.api.selectModel('hy3'));
  await f.api.selectAdapter('codex');await tick();assert.equal(f.api.snapshot().ready,true);assert.equal(f.api.snapshot().model,'saved-codex-model');
  await f.api.selectAdapter('codebuddy');assert.equal(f.api.snapshot().ready,false);assert.equal(f.elements['ai-codebuddy-model'].value,'hy3');
  assert.equal(f.api.snapshot().credentialStatus,'subscription');assert.equal(calls.some(call=>['login','logout','clear'].includes(call.kind)),false);
});

for(const outcome of ['success','failure'])test(`model save ${outcome} after reinitialization cannot restore stale execution`,async()=>{
  const saving=deferred();let native={...ready};const f=fixture(async(_command,{request})=>request.kind==='select_model'?saving.promise:{...native});
  await f.api.initialize();f.api.bind(()=>{},()=>false);const old=f.api.snapshot();const pending=f.api.selectModel('hy3');const rejected=assert.rejects(pending);
  native={...ready,model:'hy3',revision:5};await f.api.initialize();
  if(outcome==='success')saving.resolve(native);else saving.reject(new Error('迟到失败'));
  await rejected;assert.equal(f.api.snapshot().ready,false);await assert.rejects(f.api.execute(old,'question_analysis',[]));
  await f.api.initialize();assert.equal(f.api.snapshot().model,'hy3');assert.equal(f.api.snapshot().ready,true);
});

test('shared connection button reaches CodeBuddy test without reading hidden Codex form',async()=>{
  const source=readFileSync(require.resolve('../../apps/web/app.js'),'utf8');let tested=0;const notices=[];const button={disabled:false};
  const context=vm.createContext({ShirohaPlatform:{harness:{formMode:()=> 'harness',formAdapter:()=> 'codebuddy',snapshot:()=>({...ready}),test:async()=>{tested++;}}},$:()=>button,setAiSettingsStatusV99:message=>notices.push(message),updateAiConnectionPillV99(){}});
  vm.runInContext(source.slice(source.indexOf('function aiProviderLabelV99('),source.indexOf('function normalizeAiEndpointV99(')),context);
  vm.runInContext(source.slice(source.indexOf('async function testAiConnectionV99('),source.indexOf('function ',source.indexOf('async function testAiConnectionV99(')+30)),context);
  await context.testAiConnectionV99();assert.equal(tested,1);assert.equal(button.disabled,false);assert(notices.some(message=>message.includes('CodeBuddy 测试执行成功')));
});

test('known CodeBuddy failures retain one fixed diagnostic code through repeated wrapping',async()=>{
  const codes=['codebuddy_request_denied','codebuddy_request_budget','codebuddy_upstream_unverified','codebuddy_candidate_rejected','codebuddy_business_json','codebuddy_frame_invalid','codebuddy_output_invalid','codebuddy_pipe_closed','codebuddy_worker_failed','codebuddy_isolation_failed','codebuddy_cleanup_failed','codebuddy_profile_cleanup_failed','codebuddy_relay_io_failed','codebuddy_relay_peer_closed','codebuddy_relay_start_failed','codebuddy_auth_network','codebuddy_runtime_integrity','codebuddy_account_stale','codebuddy_upstream_length','codebuddy_upstream_content_filter','codebuddy_upstream_tool_call','codebuddy_upstream_unknown_field','codebuddy_upstream_incomplete'];
  codes.push('codebuddy_business_limit','codebuddy_connection_result','codebuddy_analysis_result','codebuddy_followup_result');
  for(const code of codes){
    const message='CodeBuddy 未确认任务成功。';
    const f=fixture(async command=>{if(command==='harness_execute')throw {code,message,detail:'synthetic-private-body',cause:{message:'C:\\private\\synthetic-token'}};return {...ready};});
    await f.api.initialize();
    const expected=`${message}（诊断码：${code}）`;
    await assert.rejects(f.api.test(),error=>{assert.equal(error.code,code);assert.equal(error.message,expected);return true;});
    assert.equal(f.elements['ai-codebuddy-execution-status'].textContent,expected,'连接测试重复包装后仍只显示一次诊断码');
  }
});

test('unknown or malformed codes never enter diagnostic text and cancellation keeps its semantics',async()=>{
  for(const code of ['codebuddy_unknown_future','codebuddy_worker_failed\nC:\\private\\synthetic-token','codebuddy_worker_failed:secret',42,null,'cancelled']){
    const message=code==='cancelled'?'AI 任务已停止。':'固定安全说明。';
    const f=fixture(async command=>{if(command==='harness_execute')throw {code,message};return {...ready};});
    await f.api.initialize();
    await assert.rejects(f.api.execute(f.api.snapshot(),'question_analysis',[]),error=>{
      assert.equal(error.message,message);assert.doesNotMatch(error.message,/诊断码|private|secret/);
      if(code==='cancelled')assert.equal(error.name,'AbortError');
      return true;
    });
  }
});

test('an already formatted known CodeBuddy failure does not duplicate its diagnostic suffix',async()=>{
  const code='codebuddy_candidate_rejected';const message=`CodeBuddy 结果未通过校验。（诊断码：${code}）`;
  const f=fixture(async command=>{if(command==='harness_execute')throw {code,message};return {...ready};});
  await f.api.initialize();
  await assert.rejects(f.api.test(),error=>error.message===message);
  assert.equal(f.elements['ai-codebuddy-execution-status'].textContent,message);
});

test('single analysis and followup show the fixed native diagnostic while preserving existing drafts',async()=>{
  const source=readFileSync(require.resolve('../../apps/web/app.js'),'utf8');const calls=[];const notices=[];
  const code='codebuddy_upstream_unverified';const message='CodeBuddy 上游响应未通过完整性校验。';
  const f=fixture(async(command,{request})=>{if(command==='harness_execute'){calls.push(request.task);throw {code,message,detail:'synthetic-private-body',cause:{message:'synthetic-private-token'}};}return {...ready};});
  await f.api.initialize();
  const item={id:'synthetic-question'};const practice={};
  const session={requestId:0,fingerprint:'same',loading:'',draft:'保留当前追问',analysis:{analysis:'保留原解析'},initialAnalysis:'保留初始解析',messages:[{role:'assistant',content:'保留历史'}]};
  const original=JSON.stringify({analysis:session.analysis,initialAnalysis:session.initialAnalysis,messages:session.messages,draft:session.draft});
  const context=vm.createContext({practice,currentPracticeItemV8916:()=>item,aiSingleAllowedV613:()=>true,practiceItemKeyV8916:()=> 'synthetic-key',aiSingleSessionV613:()=>session,aiSingleSessionsV613:new Map([['synthetic-key',session]]),aiSingleFingerprintV613:()=> 'same',aiSingleConfigV613:()=>({configured:true,requestConfig:{execution:f.api.snapshot(),timeoutSeconds:120}}),getPracticeAnswerStateV26:()=>({chosen:['B']}),renderPracticeAiPanelV613(){},withAiTimeoutV99:async(_seconds,run)=>run({}),requestAiChatV99:(_config,_messages,options)=>f.api.execute(f.api.snapshot(),options.task,[]),buildAiSingleAnalysisMessagesV613:()=>[],buildAiSingleFollowUpMessagesV613:()=>[],showNotice:(_title,text)=>notices.push(text),ShirohaPlatform:{credentials:{redact:(_config,text)=>text}}});
  vm.runInContext(source.slice(source.indexOf('function sanitizeAiDiagnosticDetailV375('),source.indexOf('function aiOllamaCorsCommandV375(')),context);
  vm.runInContext(source.slice(source.indexOf('async function runAiSingleAnalysisV613('),source.indexOf('function aiSingleWithAnalysisV613(')),context);
  await context.runAiSingleAnalysisV613();await context.runAiSingleFollowUpV613();
  const expected=`${message}（诊断码：${code}）`;
  assert.deepEqual(calls,['question_analysis','question_followup']);assert.deepEqual(notices,[expected,expected]);assert.equal(session.error,expected);
  assert.equal(JSON.stringify({analysis:session.analysis,initialAnalysis:session.initialAnalysis,messages:session.messages,draft:session.draft}),original);
  assert.equal(session.loading,'');assert.equal(session.controller,null);assert.doesNotMatch(session.error,/private|token/);
});
