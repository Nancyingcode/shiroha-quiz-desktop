'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const path = require('node:path');
function harness() {
  const storage = () => { const data=new Map(); return { getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k) }; };
  const local=storage(),session=storage(),calls=[];
  const context=vm.createContext({ localStorage:local,sessionStorage:session,ShirohaBrowserNetwork:{ai:config=>{calls.push(config);return Promise.resolve({})},webdav:()=>Promise.resolve({})} });
  vm.runInContext(readFileSync(path.join(__dirname,'../../apps/web/platform/browser-credentials.js'),'utf8'),context);
  return { api:context.ShirohaBrowserCredentials,local,session,calls };
}
const config={endpoint:'https://mock.invalid/ai',rememberKey:false};
test('旧凭据只绑定初始化端点，UI 只得到状态；端点改变不泄露',async()=>{
  const h=harness();h.session.setItem('shiroha_ai_key_session_v99','fake-key');h.api.initialize(config);
  const marker=h.api.status('ai',config);assert(marker&&!marker.includes('fake-key'));
  await h.api.ai({...config,apiKey:marker},{},undefined);assert.equal(h.calls[0].apiKey,'fake-key');
  await h.api.ai({...config,endpoint:'https://other.invalid',apiKey:marker},{},undefined);assert.equal(h.calls[1].apiKey,'');
});
test('切换记住选项迁移已有秘密并删除旧副本，补偿闭包不暴露值',()=>{
  const h=harness();h.api.initialize(config);h.api.set('ai',config,'fake-key',false);
  const marker=h.api.status('ai',config);const undo=h.api.set('ai',{...config,rememberKey:true},marker,true);
  assert.equal(h.local.getItem('shiroha_ai_key_local_v99'),'fake-key');assert.equal(h.session.getItem('shiroha_ai_key_session_v99'),null);
  undo();assert.equal(h.local.getItem('shiroha_ai_key_local_v99'),null);assert.equal(h.session.getItem('shiroha_ai_key_session_v99'),'fake-key');
});
test('删除旧凭据副本失败会抛错并保留原值，不能假报成功',()=>{
  const h=harness();h.api.initialize(config);h.api.set('ai',config,'fake-key',false);
  const remove=h.session.removeItem;let failed=false;h.session.removeItem=k=>{if(!failed){failed=true;throw new Error('denied')}return remove(k)};
  assert.throws(()=>h.api.set('ai',{...config,rememberKey:true},h.api.status('ai',config),true),/denied/);
  assert.equal(h.local.getItem('shiroha_ai_key_local_v99'),null);assert.equal(h.session.getItem('shiroha_ai_key_session_v99'),'fake-key');
});
test('重置删除失败补偿主数据和凭据',()=>{
  const h=harness();h.local.setItem('shiroha_quiz_state_v28_4_c1','original-data');h.api.initialize(config);h.api.set('ai',config,'fake-key',false);
  const remove=h.local.removeItem;h.local.removeItem=k=>{if(k==='shiroha_quiz_state_v28_4_c1')throw new Error('denied');return remove(k)};
  assert.throws(()=>h.api.reset(),/denied/);assert.equal(h.local.getItem('shiroha_quiz_state_v28_4_c1'),'original-data');assert.equal(h.session.getItem('shiroha_ai_key_session_v99'),'fake-key');
});
