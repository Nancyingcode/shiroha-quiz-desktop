import type { Snapshot } from './contracts';
export interface BrowserStorage {
  initialize(): Promise<{state: string; hasData?: boolean; error?: Error}>;
  read(): Promise<Snapshot|null>;
  write(snapshot: Snapshot, id: string, revision: number): Promise<{revision:number}>;
  getOperation(id: string): Promise<{revision:number}|null>;
  revision(): number;
  invalidate():void;
  recoveryText():string;
}
export interface SaveQueue {
  save(snapshot: Snapshot): Promise<void>;
  resume(): void;
  idle(): Promise<void>;
  status(): {state:string; revision:number};
}
export interface BrowserNetwork {
  ai(config:{endpoint:string;apiKey?:string}, payload:unknown, signal?:AbortSignal):Promise<Response>;
  webdav(config:{endpoint:string;username?:string},password:string,path:string,options?:{method?:string;trailingSlash?:boolean;timeoutMs?:number;headers?:Record<string,string>;body?:BodyInit;acceptStatuses?:number[];signal?:AbortSignal}):Promise<Response>;
}
export interface BrowserCredentials extends BrowserNetwork {
  initialize(ai:{endpoint:string}):void;
  status(service:'ai'|'webdav',config:{endpoint:string;username?:string;rememberKey?:boolean;rememberPassword?:boolean}):string;
  set(service:'ai'|'webdav',config:{endpoint:string;username?:string;rememberKey?:boolean;rememberPassword?:boolean},secret:string,remember:boolean):()=>void;
  redact(config:{endpoint:string;rememberKey?:boolean},text:string):string;
  checkpoint(entries:[Storage,string][]):()=>void;
  readDav(): Record<string,unknown>|null;
  saveDav(config:{endpoint:string;username?:string;rememberPassword?:boolean},password:string,storePassword:boolean):void;
  clearDav():void;
  reset():void;
}
export interface BrowserFiles {
  readBuffer(file:Blob):Promise<ArrayBuffer>;
  readText(file:Blob):Promise<string>;
}
export interface BrowserPreferences { sidebar():boolean; setSidebar(collapsed:boolean):void }
export interface BrowserMedia { display(resource:string):string }
export interface BrowserGlobals {
  ShirohaPlatformValidation: import('./contracts').ValidationApi;
  ShirohaBrowserCredentials: BrowserCredentials;
  ShirohaBrowserNetwork: BrowserNetwork;
  ShirohaBrowser: { createStorage(storage: Pick<Storage,'getItem'|'setItem'|'removeItem'>, key:string): BrowserStorage; download(name:string, blob:Blob):void; files:BrowserFiles; preferences:BrowserPreferences; media:BrowserMedia; resourceJson(url:string):Promise<unknown> };
  ShirohaSaveQueue: { create(storage:BrowserStorage):SaveQueue };
  ShirohaPlatform: {
    storage: BrowserStorage;
    saves: SaveQueue;
    network: BrowserNetwork;
    credentials: BrowserCredentials;
    files:BrowserFiles;
    preferences:BrowserPreferences;
    media:BrowserMedia;
    resourceJson(url:string):Promise<unknown>;
    download(name:string, blob:Blob):void;
  };
}
