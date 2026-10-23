import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** 官方桥接仅提供给桌面适配器和标题栏，业务页面仍通过平台接口调用。 */
const host = { invoke, window: getCurrentWindow() };
/** @type {typeof globalThis & {ShirohaDesktopHost?: typeof host}} */ (globalThis).ShirohaDesktopHost = host;
