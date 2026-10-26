import type { Snapshot } from './contracts';
export interface BrowserStorage {
  initialize(): Promise<{state: string; hasData?: boolean; error?: Error}>;
  read(): Promise<Snapshot|null>;
  write(snapshot: Snapshot, id: string, revision: number): Promise<{revision:number}>;
  getOperation(id: string): Promise<{revision:number}|null>;
  revision(): number;
  invalidate():void;
  recoveryText():string;
  checkpoint?():Promise<void>;
  migrate?():Promise<void>;
  reset?():Promise<void>;
  snapshots?():Promise<string[]>;
  restoreSnapshot?(snapshotId:string):Promise<void>;
  recoverySnapshots?():Promise<string[]>;
  recover?(snapshotId:string):Promise<void>;
  recoverImport?(snapshot:Snapshot):Promise<void>;
  readonly lazy?: boolean;
  isQuestionLoaded?(bankId:string,questionId:string):boolean;
  checkpointView?():()=>void;
  ensureQuestions?(snapshot:Snapshot,refs:{bankId:string;questionId:string}[]):Promise<void>;
  ensureRecords?(snapshot:Snapshot,ids:string[]):Promise<void>;
  ensureAll?(snapshot:Snapshot):Promise<void>;
  releaseView?(snapshot:Snapshot,keep:{bankId:string;questionId:string}[]):void;
}
export interface SaveQueue {
  save(snapshot: Snapshot,operationId?:string): Promise<void>;
  resume(): void;
  idle(): Promise<void>;
  status(): {state:string; revision:number};
}
export interface BrowserNetwork {
  cancelAll?():Promise<void>;
  ai(config:{endpoint:string;apiKey?:string}, payload:unknown, signal?:AbortSignal):Promise<Response>;
  webdav(config:{endpoint:string;username?:string},password:string,path:string,options?:{method?:string;trailingSlash?:boolean;timeoutMs?:number;headers?:Record<string,string>;body?:BodyInit;acceptStatuses?:number[];signal?:AbortSignal}):Promise<Response>;
}
export interface BrowserCredentials extends BrowserNetwork {
  readonly native?:boolean;
  migrateLegacy?():Promise<void>;
  initialize(ai:{endpoint:string},configurations?:Record<string,unknown>):void|Promise<void>;
  status(service:'ai'|'webdav',config:{endpoint:string;username?:string;rememberKey?:boolean;rememberPassword?:boolean}):string;
  set(service:'ai'|'webdav',config:{endpoint:string;username?:string;rememberKey?:boolean;rememberPassword?:boolean},secret:string,remember:boolean):(()=>void)|Promise<()=>Promise<void>>;
  finalize?(undo:()=>void|Promise<void>):Promise<void>;
  operationId?(undo:()=>void|Promise<void>):string|undefined;
  updateDav?(config:Record<string,unknown>|null):void;
  redact(config:{endpoint:string;rememberKey?:boolean},text:string):string;
  checkpoint(entries:[Storage,string][]):()=>void;
  readDav(): Record<string,unknown>|null;
  saveDav(config:{endpoint:string;username?:string;rememberPassword?:boolean},password:string,storePassword:boolean):void|Promise<(()=>Promise<void>)|undefined>;
  clearDav():void|Promise<(()=>Promise<void>)|undefined>;
  reset():void|Promise<void>;
}
export interface BrowserFiles {
  readBuffer(file:Blob):Promise<ArrayBuffer>;
  readText(file:Blob):Promise<string>;
}
export interface BrowserPreferences { sidebar():boolean; setSidebar(collapsed:boolean):void }
export interface BrowserMedia { display(resource:string):string }
export type AiTaskKind = 'connection_test'|'import_organize'|'batch_review'|'batch_analysis'|'question_analysis'|'question_followup';
export interface HarnessStatus {
  mode:'api'|'harness'; adapter:string; model:string; timeoutSeconds:number;
  credentialStatus:string; runtimePath:string; runtimeVersion:string; ready:boolean; reason:string; revision:number; busy:boolean;
  runtimeSource:'managed'|'custom'; runtimeState:'unprepared'|'preparing'|'ready'|'failed'|'cancelled'; runtimeReceivedBytes:number; runtimeTotalBytes:number;
  loginUrl?:string; userCode?:string;
  accountRevision?:number;
}
export interface HarnessApi {
  initialize():Promise<void>;
  status():HarnessStatus;
  snapshot():Readonly<HarnessStatus>;
  execute(snapshot:Readonly<HarnessStatus>,task:AiTaskKind,messages:{role:'system'|'user'|'assistant';content:string}[],signal?:AbortSignal):Promise<{content:string}>;
  cancelAll():Promise<void>;
  formMode():'api'|'harness';
  formAdapter():string;
  selectAdapter(adapter:string):Promise<void>;
  selectModel(model:string):Promise<void>;
  codebuddyAccountChanged(account:{revision:number;phase:string;blocked:boolean}):void;
  saveMode(mode:'api'|'harness'):Promise<void>;
  clear():Promise<void>;
  test():Promise<void>;
  render():void;
  bind(onChanged:()=>void,isBusy:()=>boolean):void;
}
export interface BrowserGlobals {
  ShirohaPlatformValidation: import('./contracts').ValidationApi;
  ShirohaBrowserCredentials: BrowserCredentials;
  ShirohaBrowserNetwork: BrowserNetwork;
  ShirohaBrowser: { createStorage(storage: Pick<Storage,'getItem'|'setItem'|'removeItem'>, key:string): BrowserStorage; download(name:string, blob:Blob):void; files:BrowserFiles; preferences:BrowserPreferences; media:BrowserMedia; resourceJson(url:string):Promise<unknown> };
  ShirohaSaveQueue: { create(storage:BrowserStorage):SaveQueue };
  ShirohaPlatform: {
    harness?:HarnessApi;
    storage: BrowserStorage;
    saves: SaveQueue;
    network: BrowserNetwork;
    credentials: BrowserCredentials;
    files:BrowserFiles;
    preferences:BrowserPreferences;
    media:BrowserMedia;
    resourceJson(url:string):Promise<unknown>;
    download(name:string, blob:Blob):void|Promise<void>;
  };
}
