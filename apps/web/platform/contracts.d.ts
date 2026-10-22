export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export interface JsonObject { readonly [key: string]: JsonValue | undefined }

export type ErrorCode =
  | 'invalid_input' | 'unsupported_version' | 'sensitive_data' | 'not_ready'
  | 'storage_unavailable' | 'corrupt_data' | 'quota_exceeded' | 'revision_conflict'
  | 'duplicate_operation' | 'dependency_failed' | 'operation_busy' | 'outcome_unknown'
  | 'invalid_transition' | 'cancelled' | 'not_found' | 'permission_denied'
  | 'network' | 'timeout' | 'authentication' | 'rate_limited' | 'tls'
  | 'response_too_large' | 'integrity_failed' | 'credential_unavailable';

/** 错误仅携带脱敏提示；禁止原始响应、请求头、凭据和系统路径。 */
export interface PlatformError { readonly code: ErrorCode; readonly message: string; readonly retryable: boolean }
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: PlatformError };
export type CheckResult = Result<undefined>;

/** 完整兼容载荷保留合法扩展；存储层不调用有损题目归一化。 */
export interface Question extends JsonObject {
  readonly id: string;
  readonly type: string;
  readonly question: string;
  readonly options: readonly JsonValue[];
  readonly answer: readonly string[];
}
export interface Bank extends JsonObject { readonly id: string; readonly name: string; readonly questions: readonly Question[] }
export interface StudyRecord extends JsonObject { readonly id: string }
export interface Snapshot extends JsonObject {
  readonly schemaVersion: 1;
  readonly banks: readonly Bank[];
  readonly activeBankId: string;
  readonly wrongBook: JsonObject;
  readonly favorites: JsonObject;
  readonly records: readonly StudyRecord[];
  readonly settings: JsonObject;
  readonly crossPlatformMeta: JsonObject;
}
export interface WebBackup extends JsonObject {
  readonly kind: 'shiroha_quiz_web_full_backup' | 'shiroha_quiz_selected_banks' | 'shiroha_quiz_web_native_backup';
  readonly schemaVersion: 1;
  readonly crossPlatformSchemaVersion?: 1;
  readonly richContentVersion?: 'shiroha-web-rich-v1';
  readonly version?: 3;
  readonly banks: readonly Bank[];
}
export interface NativeBackup extends JsonObject {
  readonly kind: 'shiroha_quiz_full_backup';
  readonly version: 3;
  readonly schemaVersion: 3;
  readonly crossPlatformSchemaVersion: 1;
  readonly banks: readonly Bank[];
}
export type Backup = WebBackup | NativeBackup;
export type BankExport = Bank | (JsonObject & {
  readonly exportType: 'question_banks';
  readonly schemaVersion: 1;
  readonly banks: readonly Bank[];
});

export type InitializationState =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly revision: number; readonly hasData: boolean }
  | { readonly state: 'recovery_required'; readonly error: PlatformError };
export type SaveState =
  | { readonly state: 'saved'; readonly revision: number }
  | { readonly state: 'pending'; readonly operationIds: readonly string[] }
  | { readonly state: 'failed'; readonly operationId: string; readonly error: PlatformError }
  | { readonly state: 'resolving'; readonly operationId: string };

export type Change =
  | { readonly kind: 'put_bank'; readonly bank: Bank }
  | { readonly kind: 'delete_bank'; readonly bankId: string }
  | { readonly kind: 'put_question'; readonly bankId: string; readonly question: Question }
  | { readonly kind: 'delete_question'; readonly bankId: string; readonly questionId: string }
  | { readonly kind: 'select_bank'; readonly bankId: string }
  | { readonly kind: 'put_settings'; readonly settings: JsonObject }
  | { readonly kind: 'put_wrong_book'; readonly bankId: string; readonly entries: readonly JsonValue[] }
  | { readonly kind: 'put_favorites'; readonly bankId: string; readonly questionIds: readonly string[]; readonly metadata: JsonObject }
  | { readonly kind: 'put_record'; readonly record: StudyRecord }
  | { readonly kind: 'delete_record'; readonly recordId: string }
  | { readonly kind: 'replace_snapshot'; readonly snapshot: Snapshot };

export interface OperationIdentity {
  readonly contractVersion: 1;
  readonly operationId: string;
  readonly expectedRevision: number;
}
/** 调用方入队时冻结载荷；同一 ID 只能代表同一载荷，重试先查询结果。 */
export interface CommitRequest extends OperationIdentity { readonly changes: readonly Change[] }
export type ExclusiveRequest = OperationIdentity & (
  | { readonly kind: 'restore'; readonly mode: 'merge' | 'replace'; readonly backup: Backup }
  | { readonly kind: 'import_banks'; readonly banks: readonly Bank[] }
  | { readonly kind: 'reset' }
);
export interface CommitReceipt { readonly operationId: string; readonly revision: number }
export type OperationResult =
  | { readonly state: 'not_found'; readonly operationId: string }
  | { readonly state: 'pending' | 'unknown'; readonly operationId: string }
  | { readonly state: 'committed'; readonly receipt: CommitReceipt }
  | { readonly state: 'failed'; readonly operationId: string; readonly error: PlatformError }
  | { readonly state: 'cancelled'; readonly operationId: string };

export interface CommitContext {
  readonly initialization: InitializationState['state'];
  readonly currentRevision: number;
  readonly knownOperationIds: readonly string[];
  readonly pendingOperationIds?: readonly string[];
  readonly blockedByOperationId?: string;
  readonly exclusiveOperationId?: string;
}

export interface PageRequest { readonly cursor?: string; readonly limit: number }
export interface BankSummary extends JsonObject { readonly id: string; readonly name: string; readonly questionCount: number }
export type StorageQuery =
  | { readonly kind: 'snapshot' }
  | { readonly kind: 'banks'; readonly page: PageRequest }
  | { readonly kind: 'questions'; readonly bankId: string; readonly page: PageRequest }
  | { readonly kind: 'records'; readonly page: PageRequest }
  | { readonly kind: 'learning'; readonly bankId: string }
  | { readonly kind: 'settings' };
export type QueryData =
  | { readonly kind: 'snapshot'; readonly snapshot: Snapshot }
  | { readonly kind: 'banks'; readonly items: readonly BankSummary[]; readonly nextCursor?: string }
  | { readonly kind: 'questions'; readonly items: readonly Question[]; readonly nextCursor?: string }
  | { readonly kind: 'records'; readonly items: readonly StudyRecord[]; readonly nextCursor?: string }
  | { readonly kind: 'learning'; readonly wrongBook: readonly JsonValue[]; readonly favorites: readonly string[]; readonly metadata: JsonObject }
  | { readonly kind: 'settings'; readonly settings: JsonObject };
export interface StorageService {
  initialize(): Promise<InitializationState>;
  query(query: StorageQuery): Promise<Result<{ readonly revision: number; readonly data: QueryData }>>;
  commit(request: CommitRequest): Promise<Result<CommitReceipt>>;
  /** 导入、恢复、重置排他执行；覆盖前必须建立可用恢复快照。 */
  exclusive(request: ExclusiveRequest, taskId: string): Promise<Result<CommitReceipt>>;
  getOperation(operationId: string): Promise<Result<OperationResult>>;
}

export type TaskPhase = 'working' | 'staging' | 'validating' | 'committing' | 'resolving';
export type TaskState =
  | { readonly taskId: string; readonly state: 'queued' }
  | { readonly taskId: string; readonly state: 'running'; readonly phase: TaskPhase; readonly completed?: number; readonly total?: number }
  | { readonly taskId: string; readonly state: 'succeeded' | 'cancelled' }
  | { readonly taskId: string; readonly state: 'failed'; readonly error: PlatformError };
export interface TaskOptions { readonly taskId: string; readonly signal?: AbortSignal }
export interface TaskService {
  get(taskId: string): Promise<Result<TaskState>>;
  /** 提交后拒绝取消；accepted 只表示请求被接收，终态仍以 get 为准。 */
  cancel(taskId: string): Promise<Result<{ readonly accepted: boolean; readonly state: TaskState }>>;
  subscribe(listener: (state: TaskState) => void): () => void;
}

export type CapabilityState = { readonly state: 'probing' } | { readonly state: 'available' } | { readonly state: 'unavailable'; readonly reason: string };
export interface Capabilities {
  readonly nativeSave: CapabilityState;
  readonly protectedCredentials: CapabilityState;
  readonly pdf: CapabilityState;
  readonly ocr: CapabilityState;
}

export type ExchangeFormat = 'web_full_json' | 'selected_banks_json' | 'images_zip' | 'android_native_zip';
export interface FileGrant {
  readonly token: string;
  readonly purpose: 'import' | 'export';
  readonly name: string;
  readonly sizeBytes?: number;
}
export type FileSelection = { readonly state: 'cancelled' } | { readonly state: 'selected'; readonly grant: FileGrant };
export interface FileService {
  chooseImport(): Promise<Result<FileSelection>>;
  chooseExport(format: ExchangeFormat, suggestedName: string): Promise<Result<FileSelection>>;
  /** 令牌由选择/拖放产生，绑定当前会话与用途；原生层重新核验，不能当任意路径使用。 */
  read(grant: FileGrant, options: TaskOptions): Promise<Result<Uint8Array>>;
  write(grant: FileGrant, data: Uint8Array, options: TaskOptions): Promise<Result<{ readonly state: 'saved' }>>;
  release(grant: FileGrant): Promise<Result<undefined>>;
}
export interface MediaService {
  stage(data: Uint8Array, mimeType: string, options: TaskOptions): Promise<Result<{ readonly resourceId: string; readonly sha256: string }>>;
  resolveDisplay(resourceId: string): Promise<Result<{ readonly url: string; readonly leaseId: string }>>;
  releaseDisplay(leaseId: string): Promise<Result<undefined>>;
}

export interface ServiceBinding { readonly service: 'ai' | 'webdav'; readonly serviceId: string; readonly endpoint: string; readonly account: string }
export type ServiceConfiguration =
  | { readonly service: 'ai'; readonly serviceId: string; readonly endpoint: string; readonly account: string; readonly model: string; readonly timeoutSeconds: number }
  | { readonly service: 'webdav'; readonly serviceId: string; readonly endpoint: string; readonly account: string; readonly remoteDirectory: string };
export interface ServiceConfigurationService {
  get(serviceId: string): Promise<Result<ServiceConfiguration>>;
  /** 端点/账号更改使旧绑定失效；恢复配置不能自动关联本机凭据。 */
  save(configuration: ServiceConfiguration): Promise<Result<ServiceBinding>>;
}
export type CredentialState =
  | { readonly state: 'missing' | 'session' | 'remembered' | 'binding_required' }
  | { readonly state: 'unavailable'; readonly error: PlatformError };
export interface CredentialService {
  set(binding: ServiceBinding, secret: string, remember: boolean): Promise<Result<CredentialState>>;
  replace(binding: ServiceBinding, secret: string, remember: boolean): Promise<Result<CredentialState>>;
  delete(binding: ServiceBinding): Promise<Result<CredentialState>>;
  status(binding: ServiceBinding): Promise<Result<CredentialState>>;
}

export interface AiRequest {
  readonly serviceId: string;
  readonly requestId: string;
  readonly question: { readonly bankId: string; readonly questionId: string; readonly fingerprint: string } | null;
  readonly messages: readonly { readonly role: 'system' | 'user' | 'assistant'; readonly content: string }[];
  readonly responseFormat: 'text' | 'json_object';
}
export interface AiService {
  request(request: AiRequest, options: TaskOptions): Promise<Result<{ readonly requestId: string; readonly question: AiRequest['question']; readonly content: string }>>;
}
export interface RemoteBackup { readonly objectId: string; readonly name: string; readonly sizeBytes: number; readonly sha256?: string; readonly createdAt: string }
export type RemoteOperationResult =
  | { readonly state: 'not_found' | 'pending' | 'unknown' | 'cancelled'; readonly operationId: string }
  | { readonly state: 'uploaded'; readonly operationId: string; readonly backup: RemoteBackup }
  | { readonly state: 'history_saved_latest_failed'; readonly operationId: string; readonly backup: RemoteBackup; readonly error: PlatformError }
  | { readonly state: 'failed'; readonly operationId: string; readonly error: PlatformError };
export interface WebdavService {
  test(serviceId: string, options: TaskOptions): Promise<Result<undefined>>;
  list(serviceId: string, options: TaskOptions): Promise<Result<readonly RemoteBackup[]>>;
  upload(serviceId: string, backup: Backup, operationId: string, options: TaskOptions): Promise<Result<
    { readonly state: 'uploaded'; readonly backup: RemoteBackup } |
    { readonly state: 'history_saved_latest_failed'; readonly backup: RemoteBackup; readonly error: PlatformError }
  >>;
  download(serviceId: string, objectId: string, options: TaskOptions): Promise<Result<{ readonly backup: Backup; readonly integrity: 'verified' | 'unavailable' }>>;
  getOperation(serviceId: string, operationId: string): Promise<Result<RemoteOperationResult>>;
}

export interface PlatformServices {
  readonly contractVersion: 1;
  readonly storage: StorageService;
  readonly files: FileService;
  readonly media: MediaService;
  readonly configurations: ServiceConfigurationService;
  readonly credentials: CredentialService;
  readonly ai: AiService;
  readonly webdav: WebdavService;
  readonly tasks: TaskService;
  capabilities(): Promise<Capabilities>;
}

export interface ValidationApi {
  validateCommit(request: unknown, context: CommitContext): CheckResult;
  freezeCommit(request: unknown, context: CommitContext): Result<CommitRequest>;
  validateExclusive(request: unknown, context: CommitContext): CheckResult;
  validateBackup(backup: unknown): CheckResult;
  validateBankExport(payload: unknown): CheckResult;
  validateTaskTransition(current: unknown, next: unknown): CheckResult;
}
