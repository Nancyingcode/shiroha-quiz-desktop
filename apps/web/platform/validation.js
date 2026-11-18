// @ts-check
// 校验 Web 与桌面的共享存储请求、备份内容和任务状态变化。
(function () {
  'use strict';

  /** @typedef {import('./contracts').CheckResult} CheckResult */
  /** @typedef {import('./contracts').ErrorCode} ErrorCode */
  /** @typedef {import('./contracts').CommitContext} CommitContext */
  const CONTRACT_VERSION = 1;
  const STATE_SCHEMA_VERSION = 1;
  const NATIVE_BACKUP_VERSION = 3;
  const RICH_CONTENT_VERSION = 'shiroha-web-rich-v1';
  // 拒绝无法安全递归检查的输入，不截断数据；解析器与原生边界仍须各自验证。
  const MAX_JSON_DEPTH = 100;
  const SECRET_KEYS = new Set(['apikey', 'aikey', 'aiapikey', 'minerutoken', 'accesstoken', 'refreshtoken', 'password', 'webdavpassword', 'secret', 'clientsecret', 'authorization', 'credentials', 'credential', 'credentialref', 'credentialreference', 'credentialid', 'credentialtarget']);
  const BACKUP_SETTINGS = new Set(['suppressDefaultBank', 'aiImportV99', 'practiceProgressV58916', 'practiceScope', 'lastMigratedFromSchema', 'lastMigratedAt', 'migratedFromStorageKey']);
  /** @type {Readonly<Record<ErrorCode, true>>} */
  const ERROR_CODES = Object.freeze({
    invalid_input: true,
    unsupported_version: true,
    sensitive_data: true,
    not_ready: true,
    storage_unavailable: true,
    corrupt_data: true,
    quota_exceeded: true,
    revision_conflict: true,
    duplicate_operation: true,
    dependency_failed: true,
    operation_busy: true,
    outcome_unknown: true,
    invalid_transition: true,
    cancelled: true,
    not_found: true,
    permission_denied: true,
    network: true,
    timeout: true,
    authentication: true,
    rate_limited: true,
    tls: true,
    response_too_large: true,
    integrity_failed: true,
    credential_unavailable: true,
  });

  /** @param {ErrorCode} code @returns {CheckResult} */
  function fail(code) {
    return { ok: false, error: { code, message: '平台契约校验未通过。', retryable: false } };
  }

  /** @returns {CheckResult} */
  function pass() {
    return { ok: true, value: undefined };
  }

  /** @param {unknown} value @returns {value is Record<string, unknown>} */
  function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /** @param {unknown} value @returns {value is string} */
  function id(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  /** @param {unknown} value */
  function revision(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  }

  /** @param {Record<string, unknown>} value @param {readonly string[]} keys */
  function onlyKeys(value, keys) {
    return Object.keys(value).every((key) => keys.includes(key));
  }

  // 递归检查可安全序列化的 JSON 数据，保留超深、循环和敏感字段的具体错误。
  /** @param {unknown} value @param {Set<object>} ancestors @param {number} depth @returns {ErrorCode | null} */
  function inspectJson(value, ancestors = new Set(), depth = 0) {
    if (depth > MAX_JSON_DEPTH) { return 'invalid_input'; }

    if (value === null || typeof value === 'string' || typeof value === 'boolean') { return null; }

    if (typeof value === 'number') { return Number.isFinite(value) ? null : 'invalid_input'; }

    if (typeof value !== 'object' || ancestors.has(value)) { return 'invalid_input'; }

    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== null && Object.getPrototypeOf(prototype) !== null) { return 'invalid_input'; }

    if (Reflect.ownKeys(value).some((key) => typeof key !== 'string')) { return 'invalid_input'; }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (array && Object.keys(value).length !== value.length) { return 'invalid_input'; }

    ancestors.add(value);
    // 先检查描述符，避免校验/冻结执行 getter，或把隐藏字段和稀疏数组静默丢掉。
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (array && key === 'length') { continue; }

      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) { return 'invalid_input'; }

      // 数组只允许连续的规范十进制下标；额外属性不会随 JSON 数组导出。
      if (array && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) { return 'invalid_input'; }

      // 忽略大小写、分隔符等字段拼法差异，再与敏感字段名比较。
      if (SECRET_KEYS.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase())) { return 'sensitive_data'; }

      if (key === '__proto__' || key === 'constructor' || key === 'prototype') { return 'invalid_input'; }

      const error = inspectJson(descriptor.value, ancestors, depth + 1);
      if (error) { return error; }
    }

    ancestors.delete(value);
    return null;
  }

  /** @param {unknown} value */
  function question(value) {
    return object(value) && id(value.id) && id(value.type) && typeof value.question === 'string'
      && Array.isArray(value.options) && Array.isArray(value.answer) && value.answer.every((item) => typeof item === 'string');
  }

  // 验证题库及同库内试题 ID 的唯一性，避免提交时互相覆盖。
  /** @param {unknown} value */
  function bank(value) {
    if (!object(value) || !id(value.id) || typeof value.name !== 'string' || !Array.isArray(value.questions)) { return false; }

    const ids = new Set();
    return value.questions.every((item) => {
      if (!question(item) || ids.has(item.id)) { return false; }

      ids.add(item.id);
      return true;
    });
  }

  // 校验整组选定题库，拒绝重复 ID。
  /** @param {unknown} value */
  function banks(value) {
    if (!Array.isArray(value)) { return false; }

    const ids = new Set();
    return value.every((item) => {
      if (!bank(item) || ids.has(item.id)) { return false; }

      ids.add(item.id);
      return true;
    });
  }

  // 验证完整浏览器快照的版本以及题库、记录和设置字段。
  /** @param {unknown} value */
  function snapshot(value) {
    return object(value) && value.schemaVersion === STATE_SCHEMA_VERSION && banks(value.banks)
      && typeof value.activeBankId === 'string' && object(value.wrongBook) && object(value.favorites)
      && Array.isArray(value.records) && value.records.every((record) => object(record) && id(record.id))
      && object(value.settings) && object(value.crossPlatformMeta);
  }

  // 根据提交操作的类型核对允许字段和载荷结构。
  /** @param {unknown} value */
  function change(value) {
    if (!object(value)) { return false; }

    switch (value.kind) {
      case 'put_bank': return onlyKeys(value, ['kind', 'bank']) && bank(value.bank);
      case 'delete_bank': return onlyKeys(value, ['kind', 'bankId']) && id(value.bankId);
      case 'put_question': return onlyKeys(value, ['kind', 'bankId', 'question']) && id(value.bankId) && question(value.question);
      case 'delete_question': return onlyKeys(value, ['kind', 'bankId', 'questionId']) && id(value.bankId) && id(value.questionId);
      case 'select_bank': return onlyKeys(value, ['kind', 'bankId']) && typeof value.bankId === 'string';
      case 'put_settings': return onlyKeys(value, ['kind', 'settings']) && object(value.settings);
      case 'put_wrong_book': return onlyKeys(value, ['kind', 'bankId', 'entries']) && id(value.bankId) && Array.isArray(value.entries);
      case 'put_favorites': return onlyKeys(value, ['kind', 'bankId', 'questionIds', 'metadata']) && id(value.bankId) && Array.isArray(value.questionIds) && value.questionIds.every(id) && object(value.metadata);
      case 'put_record': return onlyKeys(value, ['kind', 'record']) && object(value.record) && id(value.record.id);
      case 'delete_record': return onlyKeys(value, ['kind', 'recordId']) && id(value.recordId);
      case 'replace_snapshot': return onlyKeys(value, ['kind', 'snapshot']) && snapshot(value.snapshot);
      default: return false;
    }
  }

  // 验证操作身份及当前修订号，按照既有优先级处理重复和冲突。
  /** @param {Record<string, unknown>} request @param {CommitContext} context @returns {CheckResult} */
  function identity(request, context) {
    if (request.contractVersion !== CONTRACT_VERSION) { return fail('unsupported_version'); }

    if (!id(request.operationId) || !revision(request.expectedRevision) || !revision(context.currentRevision)) { return fail('invalid_input'); }

    if (context.initialization !== 'ready') { return fail('not_ready'); }

    // 已知操作先查历史结果，不能因修订已推进而误当成一个新的过期写入。
    if (context.knownOperationIds.includes(request.operationId) || context.pendingOperationIds?.includes(request.operationId)) { return fail('duplicate_operation'); }

    if (request.expectedRevision !== context.currentRevision) { return fail('revision_conflict'); }

    if (context.blockedByOperationId) { return fail('dependency_failed'); }

    if (context.exclusiveOperationId) { return fail('operation_busy'); }

    return pass();
  }

  // 校验一组改动是否可提交，整份快照替换必须独占一次提交。
  /** @param {unknown} request @param {CommitContext} context @returns {CheckResult} */
  function validateCommit(request, context) {
    const jsonError = inspectJson(request);
    if (jsonError) { return fail(jsonError); }

    if (!object(request) || !onlyKeys(request, ['contractVersion', 'operationId', 'expectedRevision', 'changes'])) { return fail('invalid_input'); }

    const checked = identity(request, context);
    if (!checked.ok) { return checked; }

    if (!Array.isArray(request.changes) || !request.changes.length || !request.changes.every(change)) { return fail('invalid_input'); }

    if (request.changes.length > 1 && request.changes.some((item) => item.kind === 'replace_snapshot')) { return fail('invalid_input'); }

    return pass();
  }

  /** @param {unknown} value @returns {unknown} */
  function freezeCopy(value) {
    if (Array.isArray(value)) { return Object.freeze(value.map(freezeCopy)); }

    if (object(value)) { return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freezeCopy(child)]))); }

    return value;
  }

  /** @param {unknown} request @param {CommitContext} context @returns {import('./contracts').Result<import('./contracts').CommitRequest>} */
  function freezeCommit(request, context) {
    const checked = validateCommit(request, context);
    if (!checked.ok) { return checked; }

    return { ok: true, value: /** @type {import('./contracts').CommitRequest} */ (freezeCopy(request)) };
  }

  // URL 主机前的用户信息可能包含服务账号或密码。
  const userInfo = /^https?:\/\/[^/]*@/i;

  // 查询参数里可能直接附带密钥、令牌或密码，不能随设置导出。
  const secretQuery = /[?&](?:api_?key|access_?token|password)=/i;

  // 盘符、根路径以及 file URL 都可能暴露本机文件位置。
  const absolutePath = /^(?:[a-z]:[\\/]|[\\/]|file:)/i;

  // 文件、Tauri/asset 地址和 Blob 只在创建者的运行环境可用。
  const localResource = /^(?:(?:file|asset|tauri|blob):|https?:\/\/(?:asset|tauri)\.localhost)/i;

  /** 检查单个字符串字段，拒绝导出凭据和仅在当前设备可解析的资源引用。
   * @param {string} field @param {string} text @returns {ErrorCode | null}
   */
  function inspectExportString(field, text) {
    if (field === 'endpoint' && (userInfo.test(text) || secretQuery.test(text))) { return 'sensitive_data'; }

    if (['path', 'localpath', 'absolutepath', 'filepath'].includes(field) && absolutePath.test(text)) { return 'invalid_input'; }

    if (['src', 'url', 'dataurl', 'localpath'].includes(field) && localResource.test(text)) { return 'invalid_input'; }

    return null;
  }

  /** 递归检查通过结构校验的导出对象，保留首次出现的错误。
   * @param {unknown} value @returns {ErrorCode | null}
   */
  function inspectExport(value) {
    if (!value || typeof value !== 'object') { return null; }

    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string') {
        const error = inspectExportString(key.toLowerCase(), child);
        if (error) { return error; }
      }

      const error = inspectExport(child);
      if (error) { return error; }
    }

    return null;
  }

  // 允许旧备份省略可选协议版本，但拒绝显式无法读取的版本。
  /** @param {Record<string, unknown>} value @returns {CheckResult} */
  function exchangeVersions(value) {
    if ((value.crossPlatformSchemaVersion !== undefined && value.crossPlatformSchemaVersion !== STATE_SCHEMA_VERSION)
      || (value.richContentVersion !== undefined && value.richContentVersion !== RICH_CONTENT_VERSION)
      || (object(value.crossPlatform) && value.crossPlatform.schemaVersion !== STATE_SCHEMA_VERSION)) { return fail('unsupported_version'); }

    return pass();
  }

  // 校验各端学习数据容器，可选字段缺省时仍可导入旧数据。
  /** @param {Record<string, unknown>} value @param {boolean} native */
  function learningData(value, native = false) {
    if (value.wrongBook !== undefined && !(native ? Array.isArray(value.wrongBook) : object(value.wrongBook))) { return false; }

    for (const key of ['records', 'studyRecords', 'favoriteQuestions']) {
      if (value[key] !== undefined && !Array.isArray(value[key])) { return false; }
    }

    if (value.favorites !== undefined && !object(value.favorites)) { return false; }

    return true;
  }

  /** 备份各处设置共享字段白名单，AI 设置只保存非凭据配置。
   * @param {unknown} settings
   */
  function backupSettingsAllowed(settings) {
    if (settings !== undefined && (!object(settings) || !Object.keys(settings).every((key) => BACKUP_SETTINGS.has(key)))) {
      return false;
    }

    return !object(settings) || settings.aiImportV99 === undefined
      || (object(settings.aiImportV99)
        && onlyKeys(settings.aiImportV99, ['provider', 'endpoint', 'model', 'timeoutSeconds', 'rememberKey']));
  }

  /** 在恢复前验证跨端版本、学习数据及允许随备份迁移的字段。
   * @param {unknown} value @returns {CheckResult}
   */
  function validateBackup(value) {
    const jsonError = inspectJson(value);
    if (jsonError) { return fail(jsonError); }

    if (!object(value)) { return fail('invalid_input'); }

    const native = value.kind === 'shiroha_quiz_full_backup';
    if (value.schemaVersion !== (native ? NATIVE_BACKUP_VERSION : STATE_SCHEMA_VERSION)
      || ((native || value.kind === 'shiroha_quiz_web_native_backup') && value.version !== NATIVE_BACKUP_VERSION)) { return fail('unsupported_version'); }

    if (value.crossPlatform !== undefined && (!object(value.crossPlatform) || !learningData(value.crossPlatform, true))) { return fail('invalid_input'); }

    const versions = exchangeVersions(value);
    if (!versions.ok) { return versions; }

    if (!['shiroha_quiz_web_full_backup', 'shiroha_quiz_selected_banks', 'shiroha_quiz_web_native_backup', 'shiroha_quiz_full_backup'].includes(String(value.kind)) || !banks(value.banks)) { return fail('invalid_input'); }

    if (!learningData(value, native) || (value.webState !== undefined && !object(value.webState))) { return fail('invalid_input'); }

    const webState = object(value.webState) ? value.webState : {};
    if (!learningData(webState)) { return fail('invalid_input'); }

    for (const settings of [value.settings, webState.settings, value.webSettings]) {
      if (!backupSettingsAllowed(settings)) { return fail('invalid_input'); }
    }

    const exportError = inspectExport(value);
    if (exportError) { return fail(exportError); }

    return pass();
  }

  // 校验仅含题库的交换数据，避免作为全量备份导出学习记录。
  /** @param {unknown} value @returns {CheckResult} */
  function validateBankExport(value) {
    const jsonError = inspectJson(value);
    if (jsonError) { return fail(jsonError); }

    if (!object(value)) { return fail('invalid_input'); }

    if (value.schemaVersion !== undefined && value.schemaVersion !== STATE_SCHEMA_VERSION) { return fail('unsupported_version'); }

    const versions = exchangeVersions(value);
    if (!versions.ok) { return versions; }

    if (value.kind !== undefined || ['wrongBook', 'favorites', 'records', 'settings', 'webState', 'crossPlatform'].some((key) => key in value)) { return fail('invalid_input'); }

    if (!(value.exportType === 'question_banks' ? value.schemaVersion === STATE_SCHEMA_VERSION && banks(value.banks) : bank(value))) { return fail('invalid_input'); }

    const exportError = inspectExport(value);
    return exportError ? fail(exportError) : pass();
  }

  // 专有操作在无待处理提交时才可开始，并按模式检查恢复或合并载荷。
  /** @param {unknown} request @param {CommitContext} context @returns {CheckResult} */
  function validateExclusive(request, context) {
    const jsonError = inspectJson(request);
    if (jsonError) { return fail(jsonError); }

    if (!object(request)) { return fail('invalid_input'); }

    const checked = identity(request, context);
    if (!checked.ok) { return checked; }

    if (context.pendingOperationIds?.length) { return fail('operation_busy'); }

    const baseKeys = ['contractVersion', 'operationId', 'expectedRevision', 'kind'];
    if (request.kind === 'reset') { return onlyKeys(request, baseKeys) ? pass() : fail('invalid_input'); }

    if (request.kind === 'import_banks') { return onlyKeys(request, [...baseKeys, 'banks']) && banks(request.banks) ? pass() : fail('invalid_input'); }

    if (request.kind !== 'restore' || !onlyKeys(request, [...baseKeys, 'mode', 'backup']) || !['merge', 'replace'].includes(String(request.mode))) { return fail('invalid_input'); }

    return validateBackup(request.backup);
  }

  // 验证任务消息结构和进度取值，限制失败状态可携带的字段。
  /** @param {unknown} value @returns {value is Record<string, unknown>} */
  function task(value) {
    if (inspectJson(value) || !object(value) || !id(value.taskId)) { return false; }

    if (value.state === 'running') {
      if (!onlyKeys(value, ['taskId', 'state', 'phase', 'completed', 'total'])) { return false; }

      if (!['working', 'staging', 'validating', 'committing', 'resolving'].includes(String(value.phase))) { return false; }

      if ([value.completed, value.total].some((count) => count !== undefined && !revision(count))) { return false; }

      return typeof value.completed !== 'number' || typeof value.total !== 'number' || value.completed <= value.total;
    }

    if (value.state === 'failed') {
      return onlyKeys(value, ['taskId', 'state', 'error']) && object(value.error)
        && onlyKeys(value.error, ['code', 'message', 'retryable']) && typeof value.error.code === 'string'
        && Object.hasOwn(ERROR_CODES, value.error.code) && typeof value.error.message === 'string' && typeof value.error.retryable === 'boolean';
    }

    return onlyKeys(value, ['taskId', 'state']) && ['queued', 'succeeded', 'cancelled'].includes(String(value.state));
  }

  // 保持任务终态不可逆，提交开始后拒绝取消或回到前置步骤。
  /** @param {unknown} current @param {unknown} next @returns {CheckResult} */
  function validateTaskTransition(current, next) {
    if (!task(current) || !task(next) || current.taskId !== next.taskId) { return fail('invalid_transition'); }

    if (next.state === 'failed' && object(next.error) && next.error.code === 'outcome_unknown') { return fail('invalid_transition'); }

    if (['succeeded', 'failed', 'cancelled'].includes(String(current.state))) { return fail('invalid_transition'); }

    if (current.state === 'queued') { return ['running', 'failed', 'cancelled'].includes(String(next.state)) ? pass() : fail('invalid_transition'); }

    if (next.state === 'queued') { return fail('invalid_transition'); }

    const commitStarted = current.phase === 'committing' || current.phase === 'resolving';
    if (commitStarted && (next.state === 'cancelled' || (next.state === 'running' && !['committing', 'resolving'].includes(String(next.phase))))) { return fail('invalid_transition'); }

    return pass();
  }

  /** @type {import('./contracts').ValidationApi} */
  const api = Object.freeze({ validateCommit, freezeCommit, validateExclusive, validateBackup, validateBankExport, validateTaskTransition });
  /** @type {typeof globalThis & { ShirohaPlatformValidation?: import('./contracts').ValidationApi }} */ (globalThis).ShirohaPlatformValidation = api;
})();
