import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** 官方桥接仅提供给桌面适配器和标题栏，业务页面仍通过平台接口调用。 */
const host = { invoke, window: getCurrentWindow(), canClose: async () => true };
// 退出决策属于主窗口；官方关闭事件等待业务确认后才销毁窗口。
let closing = false;
void host.window.onCloseRequested(async event => {
  if (closing) { event.preventDefault(); return; }
  closing = true;
  try {
    if (!await host.canClose()) event.preventDefault();
  } catch {
    event.preventDefault();
  } finally { closing = false; }
});
/** @type {typeof globalThis & {ShirohaDesktopHost?: typeof host}} */ (globalThis).ShirohaDesktopHost = host;
