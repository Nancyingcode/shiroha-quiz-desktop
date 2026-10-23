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
      throw Object.assign(new Error('本地操作未完成，原数据已保留。请检查权限、空间或重新启动。'), { code });
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
      const keys=['id','mode','name','bankName','date','total','answered','correct','wrong','accuracy','score','totalScore','passScore','passed','duration','scopeType'];
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
  scope.ShirohaPlatform = { ...scope.ShirohaBrowser, storage, saves: scope.ShirohaSaveQueue.create(storage),
    download, network: scope.ShirohaBrowserCredentials, credentials: scope.ShirohaBrowserCredentials };
})();
