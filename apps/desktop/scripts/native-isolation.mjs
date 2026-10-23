import { lstat, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** 本次 runner 创建的空目录才可标记；正式构建拒绝这个环境变量。 @param {string} directory */
export async function markNativeIsolation(directory) {
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('测试数据目录不能是链接');
  const root = await realpath(directory);
  if (path.dirname(root) !== await realpath(tmpdir()) || !path.basename(root).startsWith('shiroha-native-')) throw new Error('测试数据目录越界');
  await writeFile(path.join(root, 'test-isolation'), 'fake-credentials\nnetwork-denied\n', { flag: 'wx' });
  return root;
}
