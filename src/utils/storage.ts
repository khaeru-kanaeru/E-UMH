import {
  upgradeDifficultyMatrix,
  upgradeLegacyCotMatrix,
} from '../data/cotMasterV2';
import {
  DEFAULT_AUTO_CUT_LIST,
  DEFAULT_FEEDER_LIST,
  DEFAULT_STD_DATABASE,
  upgradeAssemblyStdParams,
} from '../data/defaultStdDb';
import { calculateUmh } from '../engine/umhCalculator';
import {
  AssyInputPayload,
  AssyRecord,
  AutoCutItem,
  FeederItem,
  MasterChangeHistoryEntry,
  RecycleBinItem,
  RefreshHistoryEntry,
  StdDatabase,
} from '../types/umh';

const KEY_RECORDS = 'wh_assy_db_bento_v2';
const KEY_STD_DB = 'wh_std_config_bento_v2';
const KEY_AUTOCUT = 'wh_acl_list_v2';
const KEY_FEEDER = 'wh_fl_list_v2';
const KEY_PENDING_SYNC = 'wh_pending_master_sync_v2';
const KEY_REFRESH_HISTORY = 'wh_umh_refresh_history_v2';
const KEY_MASTER_HISTORY = 'wh_master_change_history_v1';
const KEY_LAST_PIC = 'wh_umh_last_pic_v2';
const KEY_RECYCLE_BIN = 'wh_recycle_bin_v2';

const ALL_LEGACY_LS_KEYS = [
  KEY_RECORDS,
  KEY_STD_DB,
  KEY_AUTOCUT,
  KEY_FEEDER,
  KEY_PENDING_SYNC,
  KEY_REFRESH_HISTORY,
  KEY_MASTER_HISTORY,
  KEY_LAST_PIC,
  KEY_RECYCLE_BIN,
] as const;

const IDB_NAME = 'wh_umh_idb_v1';
const IDB_STORE = 'kv';
const IDB_VERSION = 1;

interface MemoryWorkspace {
  stdDb: StdDatabase;
  autoCutList: AutoCutItem[];
  feederList: FeederItem[];
  records: AssyRecord[];
  refreshHistory: RefreshHistoryEntry[];
  masterChangeHistory: MasterChangeHistoryEntry[];
  recycleBin: RecycleBinItem[];
  pendingMasterSync: boolean;
  lastPicName: string;
}

const mem: MemoryWorkspace = {
  stdDb: structuredClone(DEFAULT_STD_DATABASE),
  autoCutList: structuredClone(DEFAULT_AUTO_CUT_LIST),
  feederList: structuredClone(DEFAULT_FEEDER_LIST),
  records: [],
  refreshHistory: [],
  masterChangeHistory: [],
  recycleBin: [],
  pendingMasterSync: false,
  lastPicName: '',
};

let idbPromise: Promise<IDBDatabase | null> | null = null;

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (idbPromise) return idbPromise;

  idbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return idbPromise;
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openIdb();
    if (!db) return undefined;
    return await new Promise<T | undefined>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  } catch {
    return undefined;
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openIdb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    // Never throw storage quota or IDB errors to UI
  }
}

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openIdb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    // ignore
  }
}

function normalizeStdDb(saved: Partial<StdDatabase> | undefined | null): StdDatabase {
  if (saved && Array.isArray(saved.params)) {
    return {
      params: upgradeAssemblyStdParams(saved.params),
      acMatrix: Array.isArray(saved.acMatrix)
        ? saved.acMatrix
        : structuredClone(DEFAULT_STD_DATABASE.acMatrix),
      saMatrix: Array.isArray(saved.saMatrix)
        ? saved.saMatrix
        : structuredClone(DEFAULT_STD_DATABASE.saMatrix),
      mcMatrix: Array.isArray(saved.mcMatrix)
        ? saved.mcMatrix
        : structuredClone(DEFAULT_STD_DATABASE.mcMatrix),
      cotMatrix: upgradeLegacyCotMatrix(saved.cotMatrix),
      difficultyMatrix: upgradeDifficultyMatrix(saved.difficultyMatrix),
    };
  }
  return structuredClone(DEFAULT_STD_DATABASE);
}

function cleanAssyPayloads(payloads: (AssyInputPayload | AssyRecord)[]) {
  return payloads.map((p) => ({
    id: p.id,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    ...(p.createdByUid ? { createdByUid: p.createdByUid } : {}),
    ...(p.createdByName ? { createdByName: p.createdByName } : {}),
    ...(p.createdByEmail ? { createdByEmail: p.createdByEmail } : {}),
    ...(p.updatedByUid ? { updatedByUid: p.updatedByUid } : {}),
    ...(p.updatedByName ? { updatedByName: p.updatedByName } : {}),
    ...(p.updatedByEmail ? { updatedByEmail: p.updatedByEmail } : {}),
    params: p.params,
    assemblyComponents: p.assemblyComponents,
    partList: p.partList,
    ppcsList: p.ppcsList,
    assemblyCotList: p.assemblyCotList,
    terminalRatios: p.terminalRatios,
    ...('calculation' in p && p.calculation ? { calculation: p.calculation } : {}),
  }));
}

function hydrateAssyList(
  rawList: (AssyInputPayload & { calculation?: AssyRecord['calculation'] })[] | undefined,
  stdDb: StdDatabase,
  autoCutList: AutoCutItem[],
  feederList: FeederItem[]
): AssyRecord[] {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .filter((p) => p && p.id !== 'sample_khr55431')
    .map((p) => {
      if (p.calculation && Array.isArray(p.calculation.processes) && p.calculation.smv) {
        return p as AssyRecord;
      }
      return {
        ...p,
        calculation: calculateUmh(p, stdDb, autoCutList, feederList),
      };
    });
}

function readAndPurgeLegacyLocalStorageKey<T>(key: string, isJson = true): T | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    window.localStorage.removeItem(key);
    if (raw === null) return undefined;
    if (!isJson) return raw as unknown as T;
    return JSON.parse(raw) as T;
  } catch {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return undefined;
  }
}

export function purgeLegacyLocalStorage(): void {
  if (typeof window === 'undefined') return;
  ALL_LEGACY_LS_KEYS.forEach((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  });
}

let hydrationPromise: Promise<MemoryWorkspace> | null = null;

/**
 * Hydrates local workspace from IndexedDB (which has large quota and never fills localStorage),
 * migrates any leftover legacy localStorage data once, and purges all legacy localStorage keys.
 */
export async function hydrateLocalWorkspaceFromIdb(): Promise<MemoryWorkspace> {
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    const [
      idbStd,
      idbAc,
      idbFl,
      idbPending,
      idbRefresh,
      idbMasterHist,
      idbLastPic,
      idbRecycle,
      idbRecords,
    ] = await Promise.all([
      idbGet<Partial<StdDatabase>>(KEY_STD_DB),
      idbGet<AutoCutItem[]>(KEY_AUTOCUT),
      idbGet<FeederItem[]>(KEY_FEEDER),
      idbGet<boolean>(KEY_PENDING_SYNC),
      idbGet<RefreshHistoryEntry[]>(KEY_REFRESH_HISTORY),
      idbGet<MasterChangeHistoryEntry[]>(KEY_MASTER_HISTORY),
      idbGet<string>(KEY_LAST_PIC),
      idbGet<RecycleBinItem[]>(KEY_RECYCLE_BIN),
      idbGet<(AssyInputPayload & { calculation?: AssyRecord['calculation'] })[]>(KEY_RECORDS),
    ]);

    // Migrate & immediately purge any legacy localStorage items so localStorage is completely freed
    const lsStd = readAndPurgeLegacyLocalStorageKey<Partial<StdDatabase>>(KEY_STD_DB);
    const lsAc = readAndPurgeLegacyLocalStorageKey<AutoCutItem[]>(KEY_AUTOCUT);
    const lsFl = readAndPurgeLegacyLocalStorageKey<FeederItem[]>(KEY_FEEDER);
    const lsPendingRaw = readAndPurgeLegacyLocalStorageKey<string>(KEY_PENDING_SYNC, false);
    const lsRefresh = readAndPurgeLegacyLocalStorageKey<RefreshHistoryEntry[]>(KEY_REFRESH_HISTORY);
    const lsMasterHist = readAndPurgeLegacyLocalStorageKey<MasterChangeHistoryEntry[]>(
      KEY_MASTER_HISTORY
    );
    const lsLastPic = readAndPurgeLegacyLocalStorageKey<string>(KEY_LAST_PIC, false);
    const lsRecycle = readAndPurgeLegacyLocalStorageKey<RecycleBinItem[]>(KEY_RECYCLE_BIN);
    const lsRecords = readAndPurgeLegacyLocalStorageKey<
      (AssyInputPayload & { calculation?: AssyRecord['calculation'] })[]
    >(KEY_RECORDS);

    purgeLegacyLocalStorage();

    const rawStd = idbStd ?? lsStd;
    mem.stdDb = normalizeStdDb(rawStd);
    if (!idbStd && lsStd) void idbSet(KEY_STD_DB, mem.stdDb);

    const rawAc = idbAc ?? lsAc;
    mem.autoCutList = Array.isArray(rawAc) ? rawAc : structuredClone(DEFAULT_AUTO_CUT_LIST);
    if (!idbAc && Array.isArray(lsAc)) void idbSet(KEY_AUTOCUT, mem.autoCutList);

    const rawFl = idbFl ?? lsFl;
    mem.feederList = Array.isArray(rawFl) ? rawFl : structuredClone(DEFAULT_FEEDER_LIST);
    if (!idbFl && Array.isArray(lsFl)) void idbSet(KEY_FEEDER, mem.feederList);

    const rawPending = idbPending !== undefined ? idbPending : lsPendingRaw === '1';
    mem.pendingMasterSync = Boolean(rawPending);
    if (idbPending === undefined && lsPendingRaw === '1') void idbSet(KEY_PENDING_SYNC, true);

    const rawRefresh = idbRefresh ?? lsRefresh;
    mem.refreshHistory = Array.isArray(rawRefresh) ? rawRefresh : [];
    if (!idbRefresh && Array.isArray(lsRefresh)) void idbSet(KEY_REFRESH_HISTORY, mem.refreshHistory);

    const rawMasterHist = idbMasterHist ?? lsMasterHist;
    mem.masterChangeHistory = Array.isArray(rawMasterHist) ? rawMasterHist : [];
    if (!idbMasterHist && Array.isArray(lsMasterHist)) {
      void idbSet(KEY_MASTER_HISTORY, mem.masterChangeHistory);
    }

    const rawLastPic = idbLastPic ?? lsLastPic;
    mem.lastPicName = typeof rawLastPic === 'string' ? rawLastPic : '';
    if (!idbLastPic && typeof lsLastPic === 'string' && lsLastPic) {
      void idbSet(KEY_LAST_PIC, mem.lastPicName);
    }

    const validBinTypes = new Set([
      'assy_record',
      'refresh_history',
      'auto_cut_item',
      'feeder_item',
    ]);
    const rawRecycle = idbRecycle ?? lsRecycle;
    mem.recycleBin = Array.isArray(rawRecycle)
      ? rawRecycle.filter((item) => item && validBinTypes.has(item.itemType))
      : [];
    if (!idbRecycle && Array.isArray(lsRecycle)) void idbSet(KEY_RECYCLE_BIN, mem.recycleBin);

    const rawRecords = idbRecords ?? lsRecords;
    mem.records = hydrateAssyList(rawRecords, mem.stdDb, mem.autoCutList, mem.feederList);
    if (!idbRecords && Array.isArray(lsRecords) && mem.records.length > 0) {
      void idbSet(KEY_RECORDS, cleanAssyPayloads(mem.records));
    }

    return mem;
  })();

  return hydrationPromise;
}

export function loadPendingMasterSync(): boolean {
  return mem.pendingMasterSync;
}

export function savePendingMasterSync(pending: boolean): void {
  mem.pendingMasterSync = pending;
  if (pending) {
    void idbSet(KEY_PENDING_SYNC, true);
  } else {
    void idbDelete(KEY_PENDING_SYNC);
  }
}

export function loadRefreshHistory(): RefreshHistoryEntry[] {
  return mem.refreshHistory;
}

export function saveRefreshHistory(entries: RefreshHistoryEntry[]): void {
  mem.refreshHistory = entries;
  void idbSet(KEY_REFRESH_HISTORY, entries);
}

export function loadLastPicName(): string {
  return mem.lastPicName;
}

export function saveLastPicName(name: string): void {
  mem.lastPicName = name;
  void idbSet(KEY_LAST_PIC, name);
}

export function loadStdDatabase(): StdDatabase {
  return mem.stdDb;
}

export function saveStdDatabase(db: StdDatabase): void {
  mem.stdDb = db;
  void idbSet(KEY_STD_DB, db);
}

export function resetStdDatabase(): StdDatabase {
  const fresh: StdDatabase = structuredClone(DEFAULT_STD_DATABASE);
  saveStdDatabase(fresh);
  return fresh;
}

export function loadAutoCutList(): AutoCutItem[] {
  return mem.autoCutList;
}

export function saveAutoCutList(list: AutoCutItem[]): void {
  mem.autoCutList = list;
  void idbSet(KEY_AUTOCUT, list);
}

export function loadFeederList(): FeederItem[] {
  return mem.feederList;
}

export function saveFeederList(list: FeederItem[]): void {
  mem.feederList = list;
  void idbSet(KEY_FEEDER, list);
}

export function loadAssyRecords(
  _stdDb: StdDatabase,
  _autoCutList: AutoCutItem[],
  _feederList: FeederItem[]
): AssyRecord[] {
  return mem.records;
}

export function saveAssyPayloads(payloads: (AssyInputPayload | AssyRecord)[]): void {
  const clean = cleanAssyPayloads(payloads);
  mem.records = payloads as AssyRecord[];
  void idbSet(KEY_RECORDS, clean);
}

export function loadRecycleBin(): RecycleBinItem[] {
  return mem.recycleBin;
}

export function saveRecycleBin(items: RecycleBinItem[]): void {
  mem.recycleBin = items;
  void idbSet(KEY_RECYCLE_BIN, items);
}

export function loadMasterChangeHistory(): MasterChangeHistoryEntry[] {
  return mem.masterChangeHistory;
}

export function saveMasterChangeHistory(entries: MasterChangeHistoryEntry[]): void {
  mem.masterChangeHistory = entries;
  void idbSet(KEY_MASTER_HISTORY, entries);
}
