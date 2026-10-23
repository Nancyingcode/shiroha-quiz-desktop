import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
/** @param {object} scope @returns {{storage:{initialize():Promise<{state:string}>,write(data:unknown,id:string,revision:number):Promise<unknown>,revision():number,getOperation(id:string):Promise<{revision:number}>}}} */
function platform(scope) { return vm.runInNewContext('ShirohaPlatform', scope); }

test('desktop storage fails closed without the native bridge and never writes browser storage', async () => {
  const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
  const scope = { ShirohaBrowser: {}, ShirohaBrowserCredentials: {}, ShirohaSaveQueue: { create: () => ({}) },
    localStorage: { getItem: () => null, setItem: () => assert.fail('browser write') }, structuredClone: globalThis.structuredClone };
  vm.runInNewContext(source, scope);
  const result = await platform(scope).storage.initialize();
  assert.equal(result.state, 'recovery_required');
  await assert.rejects(platform(scope).storage.write({}, 'one', 0));
});

test('native revisions and durable operation receipts drive the existing save queue', async () => {
  const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
  /** @type {Array<[string, unknown]>} */ const calls = [];
  const scope = { ShirohaDesktopHost: { invoke: async (/** @type {string} */ name, /** @type {unknown} */ args) => {
    calls.push([name, args]);
    if (name === 'local_initialize') return { revision: 7, hasData: true };
    if (name === 'local_read') return { schemaVersion: 1, banks: [], records: [] };
    if (name === 'local_write') return { revision: 8 };
    if (name === 'local_operation') return { revision: 8 };
    throw new Error('unexpected command');
  } }, ShirohaBrowser: {}, ShirohaBrowserCredentials: {}, ShirohaSaveQueue: { create: () => ({}) },
  localStorage: { getItem: () => null }, structuredClone: globalThis.structuredClone };
  vm.runInNewContext(source, scope);
  assert.equal((await platform(scope).storage.initialize()).state, 'ready');
  assert.equal(platform(scope).storage.revision(), 7);
  await platform(scope).storage.write({ schemaVersion: 1, banks: [], records: [] }, 'op', 7);
  assert.equal(platform(scope).storage.revision(), 8);
  assert.equal((await platform(scope).storage.getOperation('op')).revision, 8);
  assert.equal(calls[1][0], 'local_write');
});

test('learning-only edits send changes without copying unchanged question images',async()=>{
  const source=await readFile(new URL('../frontend/adapter.js',import.meta.url),'utf8');
  const snapshot={schemaVersion:1,banks:[{id:'b',name:'bank',questions:[{id:'q',question:'large-image-payload',type:'single',answer:[],options:[]}]}],records:[],favorites:{},wrongBook:{},settings:{},activeBankId:'b',crossPlatformMeta:{}};
  /** @type {Array<[string,unknown]>} */const calls=[];
  const scope={ShirohaDesktopHost:{invoke:async(/** @type {string} */name,/** @type {unknown} */args)=>{
    calls.push([name,args]);if(name==='local_initialize')return{revision:1,hasData:true};if(name==='local_query')return{revision:1,snapshot};return{revision:2};
  }},ShirohaBrowser:{},ShirohaBrowserCredentials:{},ShirohaSaveQueue:{create:()=>({})},localStorage:{getItem:()=>null},structuredClone:globalThis.structuredClone};
  vm.runInNewContext(source,scope);
  const storage=/** @type {{initialize():Promise<unknown>,read():Promise<unknown>,write(snapshot:unknown,id:string,revision:number):Promise<unknown>}} */(vm.runInNewContext('ShirohaPlatform.storage',scope));
  await storage.initialize();await storage.read();
  const next=globalThis.structuredClone(snapshot);next.favorites={b:['q']};await storage.write(next,'change',1);
  assert.equal(calls.at(-1)?.[0],'local_commit');
  assert(!JSON.stringify(calls.at(-1)?.[1]).includes('large-image-payload'));
});

test('a lost commit reply is resolved by its durable operation receipt', async () => {
  const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
  const scope = { ShirohaDesktopHost: { invoke: async (/** @type {string} */ name) => {
    if (name === 'local_initialize') return { revision: 0, hasData: false };
    if (name === 'local_write') throw new Error('lost reply');
    if (name === 'local_operation') return { revision: 1 };
    throw new Error('unexpected command');
  } }, ShirohaBrowser: {}, ShirohaBrowserCredentials: {}, ShirohaSaveQueue: { create: () => ({}) },
  localStorage: { getItem: () => null }, structuredClone: globalThis.structuredClone };
  vm.runInNewContext(source, scope);
  await platform(scope).storage.initialize();
  await platform(scope).storage.write({ schemaVersion: 1, banks: [], records: [] }, 'lost', 0);
  assert.equal(platform(scope).storage.revision(), 1);
});

test('lazy metadata writes preserve unread questions and failed edits restore the read baseline',async()=>{
  const source=await readFile(new URL('../frontend/adapter.js',import.meta.url),'utf8');
  const index={schemaVersion:1,banks:[{id:'b',name:'bank',questions:[{id:'q',type:'single',question:'',options:[],answer:[]}]}],records:[],settings:{},wrongBook:{},favorites:{},crossPlatformMeta:{},activeBankId:'b'};
  /** @type {Array<{command:string,args:Record<string,unknown>}>} */const calls=[];
  const scope={ShirohaDesktopHost:{invoke:async(/** @type {string} */command,/** @type {Record<string,unknown>} */args)=>{
    calls.push({command,args});
    if(command==='local_initialize')return{revision:1,hasData:true};
    const query=/** @type {{kind:string}} */(args?.query);
    if(query?.kind==='summary')return{revision:1,snapshot:globalThis.structuredClone(index)};
    if(query?.kind==='details')return[{id:'q',type:'single',question:'完整题干和图片',options:[],answer:[],extension:{preserved:true}}];
    if(command==='local_commit')return{revision:2};
    throw new Error('unexpected');
  }},ShirohaBrowser:{},ShirohaBrowserCredentials:{},ShirohaSaveQueue:{create:()=>({})},localStorage:{getItem:()=>null},structuredClone:globalThis.structuredClone};
  vm.runInNewContext(source,scope);
  const storage=/** @type {import('../../web/platform/runtime.d.ts').BrowserStorage} */(vm.runInNewContext('ShirohaPlatform.storage',scope));
  await storage.initialize();const view=await storage.read();assert(view);
  const rollback=storage.checkpointView?.();
  await storage.ensureQuestions?.(view,[{bankId:'b',questionId:'q'}]);
  assert.equal(view.banks[0].questions[0].question,'完整题干和图片');
  rollback?.();
  const rolledBack=globalThis.structuredClone(index);rolledBack.banks[0].name='rename';
  await storage.write(/** @type {import('../../web/platform/contracts.d.ts').Snapshot} */(rolledBack),'rename',1);
  const changes=/** @type {{kind:string}[]} */(calls.at(-1)?.args.changes);
  assert.deepEqual(Array.from(changes,change=>change.kind),['put_bank_metadata']);
  assert(!JSON.stringify(changes).includes('questions'));
});
