// @ts-check
(function () {
  'use strict';
  /** @typedef {import('../../web/platform/contracts').Snapshot} Snapshot */
  const scope = /** @type {typeof globalThis & import('../../web/platform/runtime').BrowserGlobals & {ShirohaDesktopHost?: {invoke<T>(command:string,args?:Record<string,unknown>):Promise<T>}}} */ (globalThis);
  const KEY = 'shiroha_quiz_state_v28_4_c1';
  // 原生修订归当前页面，持久操作结果归数据库；初始化失败始终阻止写入。
  let revision = 0;
  let ready = false;
  let selecting = false;
  /** @type {Snapshot|null} */ let baseline = null;
  // 索引和已加载正文分别归本页面；回滚必须同时恢复两者，不能把未加载题目当作空题写入。
  let loadedQuestions = new Set();
  let loadedRecords = new Set();
  /** @param {string} bankId @param {string} questionId */
  const questionKey = (bankId, questionId) => JSON.stringify([bankId, questionId]);
  /** @param {unknown} a @param {unknown} b */
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** @param {Snapshot} before @param {Snapshot} next */
  function changes(before, next) {
    /** @type {Record<string,unknown>[]} */ const result = [];
    /** @param {unknown} a @param {unknown} b */
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    /** @param {Snapshot} value */
    const header = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['banks', 'records'].includes(key)));
    if (!equal(header(before), header(next))) result.push({ kind: 'put_header', header: header(next) });
    const banks = new Map(before.banks.map(bank => [bank.id, bank]));
    for (const bank of next.banks) {
      const previous = banks.get(bank.id);
      if (!previous) {
        result.push({ kind: 'put_bank', bank });
      } else {
        if (!equal({ ...previous, questions: undefined }, { ...bank, questions: undefined })) result.push({kind:'put_bank_metadata',bank:Object.fromEntries(Object.entries(bank).filter(([key])=>key!=='questions'))});
        const questions = new Map(previous.questions.map(question => [question.id, question]));
        for (const question of bank.questions) if (!equal(questions.get(question.id), question)) {
          if (questions.has(question.id) && !loadedQuestions.has(questionKey(bank.id, question.id))) throw new Error('题目正文尚未读取，已阻止保存。');
          result.push({ kind: 'put_question', bank_id: bank.id, question });
        }
        for (const question of previous.questions) if (!bank.questions.some(item=>item.id===question.id)) result.push({kind:'delete_question',bank_id:bank.id,question_id:question.id});
        if (!equal(previous.questions.map(q=>q.id),bank.questions.map(q=>q.id))) result.push({kind:'question_order',bank_id:bank.id,ids:bank.questions.map(q=>q.id)});
      }
    }
    for (const bank of before.banks) if (!next.banks.some(item => item.id === bank.id)) result.push({ kind: 'delete_bank', bank_id: bank.id });
    if (!equal(before.banks.map(b => b.id), next.banks.map(b => b.id))) result.push({ kind: 'bank_order', ids: next.banks.map(b => b.id) });
    const records = new Map(before.records.map(record => [record.id, record]));
    for (const record of next.records) if (!equal(records.get(record.id), record)) {
      if(records.has(record.id)&&!loadedRecords.has(record.id)) throw new Error('记录详情尚未读取，已阻止保存。');
      result.push({ kind: 'put_record', record });
    }
    for (const record of before.records) if (!next.records.some(item => item.id === record.id)) result.push({ kind: 'delete_record', record_id: record.id });
    if (!equal(before.records.map(r => r.id), next.records.map(r => r.id))) result.push({ kind: 'record_order', ids: next.records.map(r => r.id) });
    return result.length ? result : [{ kind: 'put_header', header: header(next) }];
  }
  /** @template T @param {string} command @param {Record<string,unknown>} [args] @returns {Promise<T>} */
  async function invoke(command, args) {
    if (!scope.ShirohaDesktopHost) throw new Error('桌面服务不可用，请重新启动应用。');
    try { return await scope.ShirohaDesktopHost.invoke(command, args); }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'storage_unavailable';
      const messages = { cancelled: '请求已取消。', timeout: '请求超时，请检查服务连接。', network_unavailable: '无法连接服务，请检查地址、证书和网络。', binding_required: '服务绑定已变化，请重新输入凭据。', credential_pending: '凭据保存尚未完成，请重试保存设置。', credential_unavailable: '系统凭据不可用，未确认清除或保存成功。', configuration_not_committed: '配置尚未保存，凭据尚未生效。', result_unknown: '远端写入结果尚不确定，请先刷新远端列表核对备份。' };
      const localMessages = {
        storage_in_use: '本地数据正在被其他 Shiroha Quiz 窗口使用，原数据已保留。请关闭其他 Shiroha Quiz 窗口后重试。',
        permission_denied: '当前窗口的本地访问未授权，原数据已保留。请关闭当前窗口并重新启动正确的 Shiroha Quiz 桌面程序。',
        corrupt_data: '本地数据校验失败，原数据已保留。请在恢复入口选择已校验的恢复副本。',
        unsupported_version: '当前程序不支持此本地数据版本，原数据已保留。请使用支持该版本的 Shiroha Quiz 桌面程序打开。',
      };
      const serviceMessages = { invalid_service_config: '接口地址配置无效，请使用完整的 HTTP(S) 地址，不含账号、查询参数或片段。', invalid_input: '请求参数无效，请检查服务配置。', redirect_denied: '服务返回了不允许的重定向，请填写最终的 API 接口地址。', network_scope_denied: '请求超出已配置服务的允许范围，请检查接口地址和服务重定向。', network_denied: '当前运行环境不允许访问该网络服务。', response_too_large: '服务响应超过允许大小，请减少本次请求内容。', payload_too_large: '请求内容超过允许大小，请减少本次发送的内容。', invalid_response: '服务响应格式无效，请检查 API 接口地址。' };
      // 只使用显式错误码映射，未知值不能命中对象原型或透出原生错误内容。
      const message = Object.hasOwn(messages, code) ? /** @type {Record<string,string>} */ (messages)[code] : '';
      const localMessage = command === 'local_initialize' && Object.hasOwn(localMessages, code) ? /** @type {Record<string,string>} */ (localMessages)[code] : '';
      const serviceMessage = ['service_request', 'service_credential'].includes(command) && Object.hasOwn(serviceMessages, code) ? /** @type {Record<string,string>} */ (serviceMessages)[code] : '';
      throw Object.assign(new Error(message || localMessage || serviceMessage || '本地操作未完成，原数据已保留。请检查权限、空间或重新启动。'), { code, name: code === 'cancelled' && command === 'service_request' ? 'AbortError' : 'Error' });
    }
  }
  /** @param {string} type */
  function questionType(type) {
    const value=String(type).trim().toLowerCase().replace(/[\s-]+/g,'_');
    const groups={single:['single','single_choice','singlechoice','choice','radio'],multiple:['multiple','multi','multiple_choice','multiplechoice','checkbox'],judge:['judge','judgement','judgment','true_false','truefalse','boolean'],blank:['blank','fill','fill_blank','fillblank','fill_in_blank'],short:['short','short_answer','essay','qa','subjective','question_answer']};
    return Object.entries(groups).find(([,aliases])=>aliases.includes(value))?.[0]||type;
  }
  const storage = {
    async initialize() {
      ready = false;
      baseline = null;
      loadedQuestions.clear(); loadedRecords.clear();
      try {
        const state = await invoke('local_initialize');
        revision = state.revision;
        if (!state.hasData) {
          const legacy = localStorage.getItem(KEY);
          if (legacy !== null) {
            throw Object.assign(new Error('检测到旧原型数据。请先导出恢复副本，再通过迁移入口确认导入；原数据未修改。'), { code: 'migration_required' });
          }
        }
        ready = true;
        return { state: 'ready', revision, hasData: state.hasData };
      } catch (error) { return { state: 'recovery_required', error: error instanceof Error ? error : new Error('本地数据无法读取。') }; }
    },
    /** @returns {Promise<Snapshot|null>} */
    async read() { if (!ready) throw new Error('本地数据尚未就绪。'); const result = /** @type {{revision:number,snapshot:Snapshot|null}} */ (await invoke('local_query',{query:{kind:'summary'}})); if(result.revision!==revision)throw new Error('数据修订已变化，请重新加载。'); for(const bank of result.snapshot?.banks||[])for(const q of bank.questions)Object.assign(q,{type:questionType(q.type)}); loadedQuestions.clear();loadedRecords.clear();baseline = structuredClone(result.snapshot); return result.snapshot; },
    lazy: true,
    /** @param {string} bankId @param {string} questionId */
    isQuestionLoaded(bankId,questionId) { return loadedQuestions.has(questionKey(bankId,questionId)) || !baseline?.banks.find(bank=>bank.id===bankId)?.questions.some(q=>q.id===questionId); },
    checkpointView() {
      const saved = structuredClone(baseline), questions = new Set(loadedQuestions), records = new Set(loadedRecords);
      return () => { baseline = saved; loadedQuestions = questions; loadedRecords = records; };
    },
    /** @param {Snapshot} snapshot @param {{bankId:string,questionId:string}[]} refs */
    async ensureQuestions(snapshot,refs) {
      const expected = revision;
      const groups = new Map();
      for(const ref of refs) if(!storage.isQuestionLoaded(ref.bankId,ref.questionId)) {
        if(!groups.has(ref.bankId)) groups.set(ref.bankId,new Set()); groups.get(ref.bankId).add(ref.questionId);
      }
      for(const [bankId,ids] of groups) {
        const all = [...ids];
        for(let offset=0;offset<all.length;offset+=200) {
          const items = /** @type {import('../../web/platform/contracts').Question[]} */ (await invoke('local_query',{query:{kind:'details',collection:'questions',bank_id:bankId,ids:all.slice(offset,offset+200),revision:expected}}));
          if(revision!==expected)throw new Error('数据修订已变化，请重试读取。');
          for(const item of items) {
            Object.assign(item,{type:questionType(item.type)});
            const target=snapshot.banks.find(b=>b.id===bankId)?.questions.find(q=>q.id===item.id);
            const original=baseline?.banks.find(b=>b.id===bankId)?.questions.find(q=>q.id===item.id);
            if(!target||!original)throw new Error('读取期间题库已变化。');
            Object.assign(target,item);Object.assign(original,structuredClone(item));loadedQuestions.add(questionKey(bankId,item.id));
          }
        }
      }
    },
    /** @param {Snapshot} snapshot @param {string[]} ids */
    async ensureRecords(snapshot,ids) {
      const expected=revision;const missing=ids.filter(id=>!loadedRecords.has(id)&&baseline?.records.some(r=>r.id===id));
      for(let offset=0;offset<missing.length;offset+=200) {
        const items=/** @type {import('../../web/platform/contracts').StudyRecord[]} */ (await invoke('local_query',{query:{kind:'details',collection:'records',bank_id:'',ids:missing.slice(offset,offset+200),revision:expected}}));
        if(revision!==expected)throw new Error('数据修订已变化，请重试读取。');
        for(const item of items){const target=snapshot.records.find(r=>r.id===item.id),original=baseline?.records.find(r=>r.id===item.id);if(!target||!original)throw new Error('读取期间记录已变化。');Object.assign(target,item);Object.assign(original,structuredClone(item));loadedRecords.add(item.id);}
      }
    },
    /** @param {Snapshot} snapshot */
    async ensureAll(snapshot) {
      await storage.ensureQuestions(snapshot,snapshot.banks.flatMap(b=>b.questions.map(q=>({bankId:b.id,questionId:q.id}))));
      await storage.ensureRecords(snapshot,snapshot.records.map(r=>r.id));
      const expected=revision;
      for(const key of ['wrongBook','crossPlatformMeta']) {
        const value=await invoke('local_query',{query:{kind:'hydrate',value:snapshot[key],revision:expected}});
        if(revision!==expected)throw new Error('数据修订已变化，请重试读取。');
        if(baseline&&equal(baseline[key],snapshot[key]))Object.assign(baseline,{[key]:structuredClone(value)});
        Object.assign(snapshot,{[key]:value});
      }
    },
    /** @param {Snapshot} snapshot @param {{bankId:string,questionId:string}[]} keep */
    releaseView(snapshot,keep) {
      if(!baseline)return;
      const retained=new Set(keep.map(ref=>questionKey(ref.bankId,ref.questionId)));
      for(const bank of snapshot.banks) {
        const previous=baseline.banks.find(item=>item.id===bank.id);if(!previous)continue;
        const replacements=new Map();
        for(const question of bank.questions) {
          const key=questionKey(bank.id,question.id);
          if(loadedQuestions.has(key)&&!retained.has(key)&&equal(question,previous.questions.find(q=>q.id===question.id))) {
            replacements.set(question.id,{id:question.id,type:question.type,number:question.number,question:'',options:[],answer:[]});loadedQuestions.delete(key);
          }
        }
        Object.assign(bank,{questions:bank.questions.map(q=>replacements.get(q.id)||q)});
        Object.assign(previous,{questions:previous.questions.map(q=>structuredClone(replacements.get(q.id)||q))});
      }
      const keys=['id','mode','name','bankName','date','total','answered','correct','wrong','accuracy','score','totalScore','passScore','passed','duration','scopeType','reviewSummary'];
      const summaries=new Map();
      for(const record of snapshot.records)if(loadedRecords.has(record.id)&&equal(record,baseline.records.find(r=>r.id===record.id))){summaries.set(record.id,Object.fromEntries(Object.entries(record).filter(([key])=>keys.includes(key))));loadedRecords.delete(record.id);}
      Object.assign(snapshot,{records:snapshot.records.map(r=>summaries.get(r.id)||r)});
      Object.assign(baseline,{records:baseline.records.map(r=>structuredClone(summaries.get(r.id)||r))});
    },
    /** @param {Snapshot} snapshot @param {string} operationId @param {number} expectedRevision */
    async write(snapshot, operationId, expectedRevision) {
      if (!ready) throw new Error('本地数据尚未就绪。');
      /** @type {{revision:number}|null} */ let receipt;
      try {
        receipt = baseline
          ? await invoke('local_commit', { changes: changes(baseline, snapshot), operationId, expectedRevision })
          : await invoke('local_write', { snapshot, operationId, expectedRevision });
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'duplicate_operation') throw error;
        // IPC 回包丢失不代表事务失败；先查持久回执，避免把已保存编辑回滚为旧状态。
        try { receipt = await invoke('local_operation', { operationId }); }
        catch { ready = false; throw new Error('保存结果暂时无法确认，请重新启动以读取本机数据，暂勿重复导入。'); }
        if (!receipt) throw error;
      }
      if (!receipt) throw new Error('本地保存未返回有效回执。');
      revision = receipt.revision;
      for(const bank of snapshot.banks)for(const question of bank.questions)if(!baseline?.banks.find(b=>b.id===bank.id)?.questions.some(q=>q.id===question.id))loadedQuestions.add(questionKey(bank.id,question.id));
      for(const record of snapshot.records)if(!baseline?.records.some(r=>r.id===record.id))loadedRecords.add(record.id);
      baseline = structuredClone(snapshot);
      return receipt;
    },
    /** @param {string} operationId @returns {Promise<{revision:number}|null>} */
    async getOperation(operationId) { return invoke('local_operation', { operationId }); },
    revision: () => revision,
    invalidate() { ready = false; },
    recoveryText() { const raw = localStorage.getItem(KEY); if (raw === null) throw new Error('没有旧浏览器数据可导出，请使用已保留的本地恢复点。'); return raw; },
    async checkpoint() { await invoke('local_checkpoint'); },
    /** @returns {Promise<string[]>} */
    async snapshots() { return invoke('local_query', { query: { kind: 'snapshots' } }); },
    /** @returns {Promise<string[]>} */
    async recoverySnapshots() { return invoke('local_query',{query:{kind:'recovery_snapshots'}}); },
    /** @param {string} snapshotId */
    async recover(snapshotId) { await invoke('local_query',{query:{kind:'recover',snapshot_id:snapshotId}}); },
    /** @param {Snapshot} snapshot */
    async recoverImport(snapshot) { await invoke('local_query',{query:{kind:'recover_import',snapshot}}); },
    /** @param {string} snapshotId */
    async restoreSnapshot(snapshotId) {
      const receipt = await invoke('local_query', { query: { kind: 'restore', snapshot_id: snapshotId, expected_revision: revision, operation_id: `restore-${globalThis.crypto.randomUUID()}` } });
      revision = receipt.revision;
    },
    async migrate() {
      const raw = localStorage.getItem(KEY);
      if (raw === null) throw new Error('没有可迁移的旧数据。');
      const parsed = JSON.parse(raw);
      const snapshot = { schemaVersion: 1, activeBankId: '', wrongBook: {}, favorites: {}, records: [], settings: {}, crossPlatformMeta: {}, ...parsed };
      const config = scope.ShirohaBrowserCredentials.readDav();
      if (config) snapshot.serviceConfigurations = { webdav: config };
      await invoke('local_migrate', { snapshot });
    },
    async reset() {
      const snapshot = { schemaVersion: 1, banks: [], activeBankId: '', wrongBook: {}, favorites: {}, records: [], settings: {}, crossPlatformMeta: {} };
      const receipt = await invoke('local_replace', { snapshot, expectedRevision: revision, operationId: `reset-${globalThis.crypto.randomUUID()}` });
      revision = receipt.revision;
    },
  };
  /** @param {Record<string,unknown>} request */
  async function file(request) { return invoke('local_file', { request }); }
  /** @param {string} name @param {Blob} blob */
  async function download(name, blob) {
    const grant = await file({ kind: 'choose_export', name });
    if (!grant) throw new Error('已取消保存。');
    try {
      for (let offset = 0; offset < blob.size; offset += 262144) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + 262144).arrayBuffer());
        await file({ kind: 'append', token: grant.token, offset, bytes: Array.from(bytes) });
      }
      await file({ kind: 'finish', token: grant.token, size: blob.size });
    } finally { await file({ kind: 'release', token: grant.token }); }
  }
  /** @param {HTMLInputElement} input */
  async function chooseImport(input) {
    if (selecting) return;
    selecting = true;
    try {
      const grant = await file({ kind: 'choose_import' });
      if (!grant) return;
      try {
        const parts = [];
        for (let offset = 0; offset < grant.sizeBytes;) {
          const bytes = new Uint8Array(await file({ kind: 'read', token: grant.token, offset }));
          if (!bytes.length) throw new Error('文件读取未完成。');
          parts.push(bytes); offset += bytes.length;
        }
        const transfer = new DataTransfer();
        transfer.items.add(new File(parts, grant.name)); input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } finally { await file({ kind: 'release', token: grant.token }); }
    } catch (error) {
      const status = document.getElementById('platform-status');
      if (status) { status.hidden = false; status.textContent = error instanceof Error ? error.message : '文件读取失败。'; }
    } finally { selecting = false; }
  }
  if (typeof document !== 'undefined') document.addEventListener('click', event => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'file') {
      event.preventDefault(); void chooseImport(event.target);
    }
  }, true);
  /** @typedef {{endpoint:string,username?:string,remoteDir?:string,rememberKey?:boolean,rememberPassword?:boolean,apiKey?:string}} ServiceConfig */
  const MARKER = '[已保存的凭据]';
  // 这里只缓存非敏感状态；秘密只在用户输入的单次 IPC 参数中出现，不保存页面副本。
  const credentialStates = new Map();
  const staged = new Map();
  const requestContexts = new WeakMap();
  let networkGeneration = 0;
  /** @type {Record<string,unknown>|null} */ let davConfig = null;
  /** @param {'ai'|'webdav'} service @param {ServiceConfig} config */
  function nativeConfig(service, config) { return { service, endpoint: config.endpoint, username: config.username || '', remoteDir: service === 'webdav' ? config.remoteDir || 'ShirohaQuiz/Web' : '' }; }
  /** @param {'ai'|'webdav'} service @param {ServiceConfig} config */
  function binding(service, config) { return JSON.stringify(nativeConfig(service, config)); }
  /** @param {Record<string,unknown>} request */
  async function credential(request) { return invoke('service_credential', { request }); }
  /** @param {'ai'|'webdav'} service @param {ServiceConfig} config */
  async function refreshCredential(service, config) {
    if (!config.endpoint) return;
    const result = await credential({ kind: 'status', config: nativeConfig(service, config) });
    credentialStates.set(binding(service, config), result.state);
  }
  /** @param {'ai'|'webdav'} service @param {ServiceConfig} config @param {string} secret @param {Record<string,unknown>} request @param {AbortSignal} [signal] */
  async function requestService(service, config, secret, request, signal) {
    if (!requestContexts.has(config)) requestContexts.set(config, networkGeneration);
    if (requestContexts.get(config) !== networkGeneration) throw new Error('服务配置或任务已改变，请重新发起操作。');
    const generation = networkGeneration;
    if (signal?.aborted) throw Object.assign(new Error('请求已取消。'), { name: 'AbortError', code: 'cancelled' });
    const requestId = globalThis.crypto.randomUUID();
    const abort = () => { void credential({ kind: 'cancel', request_id: requestId }).catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await invoke('service_request', { requestId, config: nativeConfig(service, config), secret: secret === MARKER ? null : secret, request });
      if (signal?.aborted || generation !== networkGeneration) throw Object.assign(new Error('请求已取消。'), { name: 'AbortError', code: 'cancelled' });
      return new globalThis.Response([204,205,304].includes(response.status) ? null : response.body, { status: response.status, headers: { 'Content-Type': 'application/json' } });
    } finally { signal?.removeEventListener('abort', abort); }
  }
  const network = {
    async cancelAll() { networkGeneration++; await credential({ kind: 'cancel_all' }); },
    /** @param {ServiceConfig} config @param {unknown} payload @param {AbortSignal} [signal] */
    ai(config, payload, signal) { return requestService('ai', config, config.apiKey || '', { kind: 'ai', payload }, signal); },
    /** @param {ServiceConfig} config @param {string} password @param {string} path @param {Parameters<import('../../web/platform/runtime').BrowserNetwork['webdav']>[3]} [options] */
    async webdav(config, password, path, options = {}) {
      const directory = config.remoteDir || 'ShirohaQuiz/Web';
      const method = (options.method || 'GET').toUpperCase();
      /** @type {Record<string,unknown>} */ let operation;
      if (method === 'PROPFIND' && !path) operation = { kind: 'probe' };
      else if (method === 'PROPFIND' && path === directory) operation = { kind: 'list' };
      else if (method === 'MKCOL' && (path === directory || directory.startsWith(path + '/'))) operation = { kind: 'ensure_directory', depth: path.split('/').length };
      else if (['GET', 'PUT'].includes(method) && path.startsWith(directory + '/') && !path.slice(directory.length + 1).includes('/')) {
        const name = path.slice(directory.length + 1);
        if (method === 'GET') operation = { kind: 'download', name };
        else {
          const body = typeof options.body === 'string' ? options.body : await new globalThis.Response(options.body).text();
          operation = { kind: 'upload', name, body };
        }
      } else throw new Error('不允许的 WebDAV 操作或目录。');
      const response = await requestService('webdav', config, password, { kind: 'webdav', operation }, options.signal);
      if (!(options.acceptStatuses || [200,201,204,207]).includes(response.status)) throw Object.assign(new Error(`WebDAV 返回 HTTP ${response.status}。`), { code: 'http', status: response.status, method });
      return response;
    },
  };
  const credentials = {
    ...network,
    native: true,
    /** @param {ServiceConfig} ai @param {Record<string,unknown>} [configurations] */
    async initialize(ai, configurations) {
      davConfig = configurations?.webdav && typeof configurations.webdav === 'object' ? /** @type {Record<string,unknown>} */ (configurations.webdav) : null;
      credentialStates.clear();
      try {
        await credential({ kind: 'reconcile' });
        await refreshCredential('ai', ai);
        if (davConfig) await refreshCredential('webdav', /** @type {ServiceConfig} */ (davConfig));
      } catch { credentialStates.clear(); }
    },
    async migrateLegacy() {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const legacy = JSON.parse(raw);
      const legacyDav = scope.ShirohaBrowserCredentials.readDav();
      /** @type {Array<{service:'ai'|'webdav',config:ServiceConfig,local:string,session:string,remember:boolean}>} */
      const sources = [
        { service: 'ai', config: legacy.settings?.aiImportV99 || { endpoint: '' }, local: 'shiroha_ai_key_local_v99', session: 'shiroha_ai_key_session_v99', remember: !!legacy.settings?.aiImportV99?.rememberKey },
        { service: 'webdav', config: /** @type {ServiceConfig} */ (legacyDav || { endpoint: '' }), local: 'shiroha_webdav_password_local_v378', session: 'shiroha_webdav_password_session_v378', remember: !!legacyDav?.rememberPassword },
      ];
      for (const source of sources) {
        const store = source.remember ? localStorage : sessionStorage;
        const key = source.remember ? source.local : source.session;
        const secret = store.getItem(key);
        if (!secret || !source.config.endpoint) continue;
        const result = await credential({ kind: 'migrate', config: nativeConfig(source.service, source.config), secret, remember: source.remember });
        // 只清理已成功迁移且尚未被用户替换的同一个旧值；清理失败保留来源供重试。
        if (result.allowCleanup && store.getItem(key) === secret) store.removeItem(key);
        await refreshCredential(source.service, source.config);
      }
    },
    /** @param {'ai'|'webdav'} service @param {ServiceConfig} config */
    status(service, config) { return ['remembered','session'].includes(credentialStates.get(binding(service, config))) ? MARKER : ''; },
    /** @param {'ai'|'webdav'} service @param {ServiceConfig} config @param {string} secret @param {boolean} remember */
    async set(service, config, secret, remember) {
      networkGeneration++;
      const input = secret === MARKER ? { kind: 'keep' } : secret ? { kind: 'replace', value: secret } : { kind: 'clear' };
      const result = await credential({ kind: 'stage', config: nativeConfig(service, config), input, remember });
      const undo = async () => { await credential({ kind: 'rollback', id: result.id }); staged.delete(undo); };
      staged.set(undo, { id: result.id, service, config });
      return undo;
    },
    /** @param {()=>void|Promise<void>} undo */
    operationId(undo) { const pending = staged.get(undo); return pending ? `credential-${pending.id}` : undefined; },
    /** @param {()=>void|Promise<void>} undo */
    async finalize(undo) {
      const pending = staged.get(undo); if (!pending) return;
      await credential({ kind: 'commit', id: pending.id });
      await refreshCredential(pending.service, pending.config); staged.delete(undo);
    },
    /** @param {ServiceConfig} _config @param {string} text */
    redact(_config, text) { return text; },
    /** @param {[Storage,string][]} _entries */
    checkpoint(_entries) { return () => {}; },
    readDav() { return davConfig; },
    /** @param {ServiceConfig} config @param {string} password @param {boolean} storePassword */
    async saveDav(config, password, storePassword) {
      if (!storePassword) return;
      const undo = await credentials.set('webdav', config, password, !!config.rememberPassword);
      return undo;
    },
    async clearDav() {
      if (!davConfig) return;
      return credentials.set('webdav', /** @type {ServiceConfig} */ (davConfig), '', false);
    },
    /** @param {Record<string,unknown>|null} config */
    updateDav(config) { davConfig = config; },
    async reset() {
      networkGeneration++; await credential({ kind: 'invalidate' }); credentialStates.clear(); davConfig = null;
      await scope.ShirohaPlatform?.harness?.initialize();
    },
  };
  scope.ShirohaPlatform = { ...scope.ShirohaBrowser, storage, saves: scope.ShirohaSaveQueue.create(storage),
    download, network, credentials };
})();
