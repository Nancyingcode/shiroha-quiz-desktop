import type { CommitRequest, FileGrant, NativeBackup, PlatformServices, ServiceBinding } from '../../apps/web/platform/contracts';

const validCommit = {
  contractVersion: 1,
  operationId: 'type-test-operation',
  expectedRevision: 0,
  changes: [{ kind: 'select_bank', bankId: 'bank-1' }],
} satisfies CommitRequest;

export const nativeFixture = {
  kind: 'shiroha_quiz_full_backup', version: 3, schemaVersion: 3, crossPlatformSchemaVersion: 1,
  banks: [{ id: 'native-bank', name: 'Android 自建兼容样本', questions: [{ id: 'native-blank', type: 'BLANK', question: '首都___，简称___。', options: [], answer: ['北京；京'], blankAnswers: [['北京', '北京市'], ['京']] }] }],
} satisfies NativeBackup;

/** 仅由 tsc 检查，不执行平台操作；错误期望失效时类型门禁必须失败。 */
export function checkBoundaries(platform: PlatformServices, binding: ServiceBinding, grant: FileGrant) {
  void platform.storage.commit(validCommit);
  void platform.credentials.status(binding);
  void platform.files.read(grant, { taskId: 'type-test-task' });

  // @ts-expect-error 凭据边界只暴露设置、替换、删除和状态，不能读取明文。
  void platform.credentials.getSecret(binding);
  // @ts-expect-error 业务查询不能传任意 SQL。
  void platform.storage.query({ kind: 'sql', sql: 'SELECT * FROM banks' });
  // @ts-expect-error 文件读取必须携带用户选择产生的授权，不能传系统路径。
  void platform.files.read('C:\\private\\bank.json', { taskId: 'type-test-task' });
  // @ts-expect-error AI 请求不接受页面自行构造的鉴权头或任意 URL。
  void platform.ai.request({ url: 'https://example.test', headers: { Authorization: 'FAKE' } }, { taskId: 'type-test-task' });
  // @ts-expect-error 完整恢复有独立排他接口，不能混入普通变更。
  void platform.storage.commit({ ...validCommit, changes: [{ kind: 'reset' }] });
  // @ts-expect-error 契约版本必须显式兼容，不接受任意数字。
  void platform.storage.commit({ ...validCommit, contractVersion: 2 });
}
