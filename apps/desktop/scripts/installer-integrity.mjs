import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/** @typedef {(command: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<string>} IntegrityRunner */
const executeFile = promisify(execFile);
const mediumIntegrity = 8192;
const integrityTimeoutMs = 30_000;
const integrityAliases = new Map([['UN', 0], ['LW', 4096], ['ME', mediumIntegrity], ['MP', 8448], ['HI', 12288], ['SI', 16384]]);

// 只读取 mandatory label，不请求审计 SACL 权限，也不依赖 icacls 的本地化输出。
const readLabelCommand = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class ShirohaInstallerLabel {
  private const uint LabelSecurityInformation = 0x10;
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
  private static extern uint GetNamedSecurityInfo(string name, int type, uint info,
    out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(
    IntPtr descriptor, uint revision, uint info, out IntPtr text, out uint length);
  [DllImport("kernel32.dll")]
  private static extern IntPtr LocalFree(IntPtr memory);
  public static string Read(string name) {
    IntPtr owner, group, dacl, sacl, descriptor;
    uint status = GetNamedSecurityInfo(name, 1, LabelSecurityInformation,
      out owner, out group, out dacl, out sacl, out descriptor);
    if (status != 0) { throw new Win32Exception((int)status); }
    IntPtr text = IntPtr.Zero;
    try {
      uint length;
      if (!ConvertSecurityDescriptorToStringSecurityDescriptor(descriptor, 1,
        LabelSecurityInformation, out text, out length)) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      return Marshal.PtrToStringUni(text);
    } finally {
      if (text != IntPtr.Zero) { LocalFree(text); }
      LocalFree(descriptor);
    }
  }
}
'@
@{ sddl = [ShirohaInstallerLabel]::Read($env:SHIROHA_INSTALLER_FILE) } | ConvertTo-Json -Compress
`;

/** @type {IntegrityRunner} */
async function runWindows(command, args, env = process.env) {
  const { stdout } = await executeFile(command, args, {
    encoding: 'utf8', windowsHide: true, timeout: integrityTimeoutMs, maxBuffer: 1024 * 1024, env,
  });
  return stdout;
}

/** @param {string} file */
async function validateInstaller(file) {
  const absolute = path.resolve(file);
  for (let current = absolute; ; current = path.dirname(current)) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) { throw new Error(`安装包不接受链接路径: ${current}`); }
    if (current === absolute && (!stat.isFile() || stat.size === 0 || path.extname(current) !== '.exe')) {
      throw new Error(`安装包必须是非空 EXE 普通文件: ${current}`);
    }
    if (current === path.dirname(current)) { break; }
  }
}

/** @param {string} file @param {IntegrityRunner} run */
async function integrityLevel(file, run) {
  const output = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', readLabelCommand], {
    ...process.env, SHIROHA_INSTALLER_FILE: path.resolve(file),
  });
  const { sddl } = JSON.parse(output);
  if (typeof sddl !== 'string') { throw new Error('无法读取安装包完整性标记'); }
  // Windows 将没有显式完整性标记的文件视为 Medium。
  if (sddl === '' || /^S:[A-Z]*$/.test(sddl)) { return mediumIntegrity; }
  const match = /^S:[A-Z]*\(ML;[^;()]*;[^;()]*;;;([^()]+)\)$/.exec(sddl);
  const sid = match?.[1] ?? '';
  const alias = integrityAliases.get(sid);
  if (alias !== undefined) { return alias; }
  if (/^S-1-16-\d+$/.test(sid)) { return Number(sid.slice('S-1-16-'.length)); }
  throw new Error('无法识别安装包完整性标记');
}

/**
 * @param {string} file
 * @param {{ repair?: boolean, platform?: string, run?: IntegrityRunner }} [options]
 */
export async function ensureInstallerIntegrity(file, { repair = true, platform = process.platform, run = runWindows } = {}) {
  await validateInstaller(file);
  if (platform !== 'win32') { return false; }
  try {
    if (await integrityLevel(file, run) >= mediumIntegrity) { return false; }
    if (!repair) { throw new Error('安装包仍带有低完整性标记'); }
    // 仅覆盖当前制品的标记；目录继承和访问授权继续由工作区所有者维护。
    await run('icacls.exe', [path.resolve(file), '/setintegritylevel', 'M']);
    if (await integrityLevel(file, run) < mediumIntegrity) { throw new Error('安装包仍带有低完整性标记'); }
    return true;
  } catch (error) {
    throw new Error(`安装包完整性检查失败: ${file}。低完整性安装包无法写入正常临时目录；请在普通 PowerShell 中重新运行打包命令或 npm run repair:installer。`, { cause: error });
  }
}

/** @param {string} root */
export async function prepareInstaller(root) {
  const config = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  if (config.productName !== 'Shiroha Quiz' || typeof config.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(config.version)) {
    throw new Error('安装包名称或版本配置无效');
  }
  const installer = path.join(root, `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Shiroha Quiz_${config.version}_x64-setup.exe`);
  await ensureInstallerIntegrity(installer);
  return installer;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`安装包完整性检查通过: ${await prepareInstaller(fileURLToPath(new URL('..', import.meta.url)))}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : '安装包完整性检查失败');
    process.exitCode = 1;
  }
}
