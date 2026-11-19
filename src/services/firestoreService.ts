import { User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getAllowSecForMode } from '../engine/umhCalculator';
import { OperationType, db, handleFirestoreError } from '../firebase';
import {
  AssyRecord,
  AutoCutItem,
  FeederItem,
  MasterChangeCategory,
  MasterChangeDiffItem,
  MasterChangeHistoryEntry,
  MasterChangeSource,
  ProcessLogicDisc,
  RecycleBinItem,
  RecycleBinItemType,
  RecycleBinOriginalCollection,
  RefreshHistoryEntry,
  StdDatabase,
} from '../types/umh';
import firestoreRulesSource from '../../firestore.rules?raw';

export const FIRESTORE_RULES_SOURCE = firestoreRulesSource;

function isPermissionDeniedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('Missing or insufficient permissions') ||
    msg.includes('permission-denied') ||
    msg.includes('PERMISSION_DENIED')
  );
}

export function isRecycleBinPermissionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (!isPermissionDeniedError(err)) return false;
  return msg.includes('recycleBin');
}

export interface CloudUserProfile {
  uid: string;
  displayName?: string;
  email: string;
  photoURL?: string;
  lastPicName?: string;
  pendingMasterSync: boolean;
}

export interface CloudMasterConfig {
  stdDb: StdDatabase;
  autoCutList: AutoCutItem[];
  feederList: FeederItem[];
}

const MAX_DOC_BYTES = 860_000; // Safe ceiling below Firestore's 1 MiB document limit

function sanitizeIdPart(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  return cleaned || `item_${Date.now()}`;
}

export function toScopedDocId(uid: string, localId: string): string {
  const prefix = `${sanitizeIdPart(uid).slice(0, 12)}_`;
  const cleanLocal = sanitizeIdPart(localId);
  const combined = cleanLocal.startsWith(prefix) ? cleanLocal : `${prefix}${cleanLocal}`;
  return combined.slice(0, 128);
}

export function createLocalRecycleId(prefix = 'bin'): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}

function matrixToMap(matrix: number[][]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  matrix.forEach((row, idx) => {
    out[String(idx)] = row.map((v) => (Number.isFinite(v) ? v : 0));
  });
  return out;
}

function mapToMatrix(
  mapVal: Record<string, number[]> | undefined,
  fallback: number[][]
): number[][] {
  if (!mapVal || typeof mapVal !== 'object') return structuredClone(fallback);
  const keys = Object.keys(mapVal)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b));
  if (keys.length === 0) return structuredClone(fallback);
  return keys.map((k) =>
    Array.isArray(mapVal[k]) ? mapVal[k].map((n) => Number(n) || 0) : []
  );
}

function cleanForFirestore<T>(val: T): T {
  if (val === null || typeof val === 'string' || typeof val === 'boolean') {
    return val;
  }
  if (typeof val === 'number') {
    return (Number.isFinite(val) ? val : 0) as unknown as T;
  }
  if (Array.isArray(val)) {
    return val
      .filter((item) => item !== undefined)
      .map((item) => cleanForFirestore(item)) as unknown as T;
  }
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = cleanForFirestore(v);
      }
    }
    return out as T;
  }
  return val;
}

function estimateUtf8Bytes(obj: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(obj)).length;
  } catch {
    return 0;
  }
}

function tsToIso(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string' && val) {
    return val;
  }
  return new Date().toISOString();
}

function compactAssyRecordPayload(record: AssyRecord): Record<string, unknown> {
  const calculationPayload: Record<string, unknown> = cleanForFirestore(
    record.calculation
  ) as unknown as Record<string, unknown>;

  const payload: Record<string, unknown> = {
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    params: cleanForFirestore({
      ...record.params,
      assyNo: (record.params.assyNo || '').trim().slice(0, 120) || 'ASSY',
      customer: (record.params.customer || '').trim().slice(0, 120),
    }),
    assemblyComponents: cleanForFirestore(record.assemblyComponents),
    partList: cleanForFirestore(record.partList.slice(0, 2000)),
    ppcsList: cleanForFirestore(record.ppcsList.slice(0, 5000)),
    assemblyCotList: cleanForFirestore(record.assemblyCotList.slice(0, 1500)),
    terminalRatios: cleanForFirestore(record.terminalRatios),
    calculation: calculationPayload,
  };

  if (estimateUtf8Bytes(payload) > MAX_DOC_BYTES - 40_000) {
    const { smv: _omitSmv, ...regOnly } = calculationPayload;
    payload.calculation = regOnly;
  }
  if (estimateUtf8Bytes(payload) > MAX_DOC_BYTES - 40_000) {
    payload.calculation = {
      lotMetrics: record.calculation.lotMetrics,
      totalBaseSec: record.calculation.totalBaseSec,
      totalAllowByProcessSec: record.calculation.totalAllowByProcessSec,
      totalAllowByFinalSec: record.calculation.totalAllowByFinalSec,
      twistBundlesCount: record.calculation.twistBundlesCount,
      autoCutCandidateTerminals: record.calculation.autoCutCandidateTerminals,
      processes: [],
      _compact: true,
    };
  }
  return payload;
}

function buildAssyPayloadFields(uid: string, record: AssyRecord, scopedId: string) {
  const assyNo = (record.params.assyNo || '').trim().slice(0, 120) || 'ASSY';
  const customer = (record.params.customer || '').trim().slice(0, 120);

  const calculationPayload: Record<string, unknown> = cleanForFirestore(
    record.calculation
  ) as unknown as Record<string, unknown>;

  const payload = {
    id: scopedId,
    ownerId: uid,
    assyNo,
    customer,
    params: cleanForFirestore({
      ...record.params,
      assyNo,
      customer,
    }),
    assemblyComponents: cleanForFirestore(record.assemblyComponents),
    partList: cleanForFirestore(record.partList.slice(0, 2000)),
    ppcsList: cleanForFirestore(record.ppcsList.slice(0, 5000)),
    assemblyCotList: cleanForFirestore(record.assemblyCotList.slice(0, 1500)),
    terminalRatios: cleanForFirestore(record.terminalRatios),
    calculation: calculationPayload,
  };

  if (estimateUtf8Bytes(payload) > MAX_DOC_BYTES) {
    const { smv: _omitSmv, ...regOnly } = calculationPayload;
    payload.calculation = regOnly;
  }
  if (estimateUtf8Bytes(payload) > MAX_DOC_BYTES) {
    payload.calculation = {
      lotMetrics: record.calculation.lotMetrics,
      totalBaseSec: record.calculation.totalBaseSec,
      totalAllowByProcessSec: record.calculation.totalAllowByProcessSec,
      totalAllowByFinalSec: record.calculation.totalAllowByFinalSec,
      twistBundlesCount: record.calculation.twistBundlesCount,
      autoCutCandidateTerminals: record.calculation.autoCutCandidateTerminals,
      processes: [],
      _compact: true,
    };
  }

  return payload;
}

function buildRecycleBinFirestoreDoc(uid: string, item: RecycleBinItem, scopedBinId: string) {
  const allowedTypes: RecycleBinItemType[] = [
    'assy_record',
    'refresh_history',
    'auto_cut_item',
    'feeder_item',
    'process_disc',
  ];
  const allowedCols: RecycleBinOriginalCollection[] = [
    'assyRecords',
    'refreshHistory',
    'masterConfigs',
  ];
  const itemType: RecycleBinItemType = allowedTypes.includes(item.itemType)
    ? item.itemType
    : 'assy_record';
  const originalCollection: RecycleBinOriginalCollection = allowedCols.includes(
    item.originalCollection
  )
    ? item.originalCollection
    : 'assyRecords';

  const originalId = sanitizeIdPart(item.originalId || item.id).slice(0, 128);
  const title = (item.title || 'Item').trim().slice(0, 160) || 'Item';
  const subtitle = (item.subtitle || '').trim().slice(0, 240);
  const cleanedPayload = cleanForFirestore(item.payload || {}) as Record<string, unknown>;

  return {
    id: scopedBinId,
    ownerId: uid,
    itemType,
    originalCollection,
    originalId,
    title,
    subtitle,
    payload: cleanedPayload,
    deletedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };
}

export function buildRecycleBinItemFromAssy(record: AssyRecord): RecycleBinItem {
  const allowSec = getAllowSecForMode(
    record.params.allowanceMode,
    record.calculation.totalBaseSec,
    record.calculation.totalAllowByProcessSec,
    record.calculation.totalAllowByFinalSec
  );
  const allowHr = (allowSec / 3600).toFixed(4);
  return {
    id: createLocalRecycleId('bin_assy'),
    itemType: 'assy_record',
    originalCollection: 'assyRecords',
    originalId: sanitizeIdPart(record.id).slice(0, 128),
    title: (record.params.assyNo || 'ASSY').trim().slice(0, 160) || 'ASSY',
    subtitle: `${record.params.customer || '-'} · ${record.params.masterCct} CCT · REG ${allowHr} hr (${allowSec.toFixed(2)}s)`.slice(
      0,
      240
    ),
    deletedAt: new Date().toISOString(),
    payload: compactAssyRecordPayload(record),
  };
}

export function buildRecycleBinItemFromHistory(entry: RefreshHistoryEntry): RecycleBinItem {
  return {
    id: createLocalRecycleId('bin_hist'),
    itemType: 'refresh_history',
    originalCollection: 'refreshHistory',
    originalId: sanitizeIdPart(entry.id).slice(0, 128),
    title: `Refresh UMH · PIC ${entry.responsibleName || 'PIC'}`.slice(0, 160),
    subtitle: `${entry.affectedAssyCount}/${entry.totalSelectedCount} Assy terdampak · ${entry.refreshedAt.slice(0, 19).replace('T', ' ')}`.slice(
      0,
      240
    ),
    deletedAt: new Date().toISOString(),
    payload: cleanForFirestore({
      id: entry.id,
      refreshedAt: entry.refreshedAt,
      responsibleName: entry.responsibleName,
      totalSelectedCount: entry.totalSelectedCount,
      affectedAssyCount: entry.affectedAssyCount,
      unaffectedAssyCount: entry.unaffectedAssyCount,
      affectedDiffs: entry.affectedDiffs.slice(0, 500),
    }) as unknown as Record<string, unknown>,
  };
}

export function buildRecycleBinItemFromAutoCut(item: AutoCutItem): RecycleBinItem {
  return {
    id: createLocalRecycleId('bin_ac'),
    itemType: 'auto_cut_item',
    originalCollection: 'masterConfigs',
    originalId: sanitizeIdPart(item.id).slice(0, 128),
    title: (item.terminal || 'Terminal').trim().slice(0, 160) || 'Terminal',
    subtitle: `Auto Cutting List · Customer: ${item.customer || 'All'}`.slice(0, 240),
    deletedAt: new Date().toISOString(),
    payload: cleanForFirestore(item) as unknown as Record<string, unknown>,
  };
}

export function buildRecycleBinItemFromFeeder(item: FeederItem): RecycleBinItem {
  return {
    id: createLocalRecycleId('bin_fd'),
    itemType: 'feeder_item',
    originalCollection: 'masterConfigs',
    originalId: sanitizeIdPart(item.id).slice(0, 128),
    title: (item.seal || 'Wire Seal').trim().slice(0, 160) || 'Wire Seal',
    subtitle: 'Feeder List (Wire Seal)'.slice(0, 240),
    deletedAt: new Date().toISOString(),
    payload: cleanForFirestore(item) as unknown as Record<string, unknown>,
  };
}

export function buildRecycleBinItemFromDisc(disc: ProcessLogicDisc): RecycleBinItem {
  return {
    id: createLocalRecycleId('bin_disc'),
    itemType: 'process_disc',
    originalCollection: 'masterConfigs',
    originalId: sanitizeIdPart(`disc_${disc.processId}`).slice(0, 128),
    title: `#${String(disc.processId).padStart(2, '0')} ${disc.processName || 'Custom Process'}`.slice(
      0,
      160
    ),
    subtitle: `Logic Disc Sub-Proses · v${disc.version || '1.0.0'} · Bobot ${disc.weight}`.slice(
      0,
      240
    ),
    deletedAt: new Date().toISOString(),
    payload: cleanForFirestore(disc) as unknown as Record<string, unknown>,
  };
}

export async function initializeCloudWorkspace(
  user: User,
  localState: {
    stdDb: StdDatabase;
    autoCutList: AutoCutItem[];
    feederList: FeederItem[];
    records: AssyRecord[];
    refreshHistory: RefreshHistoryEntry[];
    recycleBin: RecycleBinItem[];
    lastPicName: string;
    pendingMasterSync: boolean;
  }
): Promise<{ recycleBinCloudAvailable: boolean }> {
  const uid = user.uid;
  const userPath = `users/${uid}`;
  const masterPath = `masterConfigs/${uid}`;
  let recycleBinCloudAvailable = true;

  // 1. Ensure user profile exists
  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    const displayName = (user.displayName || '').slice(0, 120);
    const email = (user.email || 'user@example.com').slice(0, 254);
    const photoURL = (user.photoURL || '').slice(0, 1000);
    const lastPicName = (localState.lastPicName || '').slice(0, 120);

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid,
        email,
        ...(displayName ? { displayName } : {}),
        ...(photoURL ? { photoURL } : {}),
        ...(lastPicName ? { lastPicName } : {}),
        pendingMasterSync: localState.pendingMasterSync,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        email,
        ...(displayName ? { displayName } : {}),
        ...(photoURL ? { photoURL } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  // 2. Ensure master config exists (with fallback if (default) DB rules do not yet include processDiscs)
  try {
    const masterRef = doc(db, 'masterConfigs', uid);
    const masterSnap = await getDoc(masterRef);

    if (!masterSnap.exists()) {
      const baseMaster = {
        ownerId: uid,
        params: cleanForFirestore(localState.stdDb.params.slice(0, 300)),
        acMatrixMap: matrixToMap(localState.stdDb.acMatrix),
        saMatrixMap: matrixToMap(localState.stdDb.saMatrix),
        mcMatrixMap: matrixToMap(localState.stdDb.mcMatrix),
        autoCutList: cleanForFirestore(localState.autoCutList.slice(0, 2000)),
        feederList: cleanForFirestore(localState.feederList.slice(0, 2000)),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      try {
        await setDoc(masterRef, {
          ...baseMaster,
          processDiscs: cleanForFirestore((localState.stdDb.processDiscs ?? []).slice(0, 100)),
        });
      } catch (innerErr) {
        if (isPermissionDeniedError(innerErr)) {
          await setDoc(masterRef, baseMaster);
        } else {
          throw innerErr;
        }
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, masterPath);
  }

  // 3. Quietly check if /recycleBin rules are published on the active Firestore database
  const existingBinIds = new Set<string>();
  const binnedOriginalIds = new Set<string>();
  try {
    const binSnap = await getDocs(
      query(collection(db, 'recycleBin'), where('ownerId', '==', uid))
    );
    binSnap.forEach((d) => {
      existingBinIds.add(d.id);
      const data = d.data();
      if (typeof data.originalId === 'string') {
        binnedOriginalIds.add(data.originalId);
        binnedOriginalIds.add(toScopedDocId(uid, data.originalId));
      }
    });

    // Sync any local recycleBin items not yet in Firestore
    if (localState.recycleBin.length > 0) {
      for (const binItem of localState.recycleBin.slice(0, 100)) {
        // Skip in-place trashed assy markers that already live in assyRecords
        if (binItem.id.startsWith('inplace_')) continue;
        const scopedBinId = toScopedDocId(uid, binItem.id);
        if (existingBinIds.has(scopedBinId)) continue;
        const binPath = `recycleBin/${scopedBinId}`;
        try {
          await setDoc(
            doc(db, 'recycleBin', scopedBinId),
            buildRecycleBinFirestoreDoc(uid, binItem, scopedBinId)
          );
          existingBinIds.add(scopedBinId);
          binnedOriginalIds.add(binItem.originalId);
          binnedOriginalIds.add(toScopedDocId(uid, binItem.originalId));
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, binPath);
        }
      }
    }
  } catch (probeErr) {
    if (isPermissionDeniedError(probeErr)) {
      recycleBinCloudAvailable = false;
    } else {
      handleFirestoreError(probeErr, OperationType.LIST, 'recycleBin');
    }
  }

  // Also include local recycleBin originalIds so locally-deleted items are not re-seeded
  localState.recycleBin.forEach((b) => {
    binnedOriginalIds.add(b.originalId);
    binnedOriginalIds.add(toScopedDocId(uid, b.originalId));
  });

  // 4. Sync any local Assy records not yet present in Firestore (and not in Recycle Bin)
  if (localState.records.length > 0) {
    const existingAssyIds = new Set<string>();
    try {
      const existingSnap = await getDocs(
        query(collection(db, 'assyRecords'), where('ownerId', '==', uid))
      );
      existingSnap.forEach((d) => existingAssyIds.add(d.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'assyRecords');
    }

    for (const rec of localState.records) {
      const scopedId = toScopedDocId(uid, rec.id);
      if (existingAssyIds.has(scopedId) || binnedOriginalIds.has(scopedId) || binnedOriginalIds.has(rec.id)) {
        continue;
      }
      const recPath = `assyRecords/${scopedId}`;
      try {
        await setDoc(doc(db, 'assyRecords', scopedId), {
          ...buildAssyPayloadFields(uid, rec, scopedId),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, recPath);
      }
    }
  }

  // 5. Sync any local refresh history entries not yet present in Firestore (and not in Recycle Bin)
  if (localState.refreshHistory.length > 0) {
    const existingHistIds = new Set<string>();
    try {
      const existingSnap = await getDocs(
        query(collection(db, 'refreshHistory'), where('ownerId', '==', uid))
      );
      existingSnap.forEach((d) => existingHistIds.add(d.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'refreshHistory');
    }

    for (const entry of localState.refreshHistory.slice(0, 50)) {
      const scopedId = toScopedDocId(uid, entry.id);
      if (existingHistIds.has(scopedId) || binnedOriginalIds.has(scopedId) || binnedOriginalIds.has(entry.id)) {
        continue;
      }
      const histPath = `refreshHistory/${scopedId}`;
      try {
        await setDoc(doc(db, 'refreshHistory', scopedId), {
          id: scopedId,
          ownerId: uid,
          refreshedAt: serverTimestamp(),
          responsibleName: (entry.responsibleName || 'PIC').slice(0, 120),
          totalSelectedCount: Math.max(0, Math.min(1000, entry.totalSelectedCount)),
          affectedAssyCount: Math.max(0, Math.min(1000, entry.affectedAssyCount)),
          unaffectedAssyCount: Math.max(0, Math.min(1000, entry.unaffectedAssyCount)),
          affectedDiffs: cleanForFirestore(entry.affectedDiffs.slice(0, 500)),
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, histPath);
      }
    }
  }

  return { recycleBinCloudAvailable };
}

export function subscribeUserProfile(
  uid: string,
  onData: (profile: CloudUserProfile | null) => void,
  onError: (err: Error) => void
) {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const d = snap.data();
      onData({
        uid: String(d.uid || uid),
        displayName: typeof d.displayName === 'string' ? d.displayName : undefined,
        email: String(d.email || ''),
        photoURL: typeof d.photoURL === 'string' ? d.photoURL : undefined,
        lastPicName: typeof d.lastPicName === 'string' ? d.lastPicName : undefined,
        pendingMasterSync: Boolean(d.pendingMasterSync),
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export async function updateUserPreferencesInCloud(
  uid: string,
  updates: { pendingMasterSync?: boolean; lastPicName?: string }
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (typeof updates.pendingMasterSync === 'boolean') {
      payload.pendingMasterSync = updates.pendingMasterSync;
    }
    if (typeof updates.lastPicName === 'string') {
      payload.lastPicName = updates.lastPicName.slice(0, 120);
    }
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeMasterConfig(
  uid: string,
  fallbackStd: StdDatabase,
  onData: (cfg: CloudMasterConfig | null) => void,
  onError: (err: Error) => void
) {
  const path = `masterConfigs/${uid}`;
  return onSnapshot(
    doc(db, 'masterConfigs', uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const d = snap.data();
      onData({
        stdDb: {
          params: Array.isArray(d.params) ? d.params : structuredClone(fallbackStd.params),
          acMatrix: mapToMatrix(d.acMatrixMap, fallbackStd.acMatrix),
          saMatrix: mapToMatrix(d.saMatrixMap, fallbackStd.saMatrix),
          mcMatrix: mapToMatrix(d.mcMatrixMap, fallbackStd.mcMatrix),
          processDiscs:
            Array.isArray(d.processDiscs) && d.processDiscs.length > 0
              ? (d.processDiscs as ProcessLogicDisc[])
              : fallbackStd.processDiscs
              ? structuredClone(fallbackStd.processDiscs)
              : undefined,
        },
        autoCutList: Array.isArray(d.autoCutList) ? d.autoCutList : [],
        feederList: Array.isArray(d.feederList) ? d.feederList : [],
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

let masterConfigWriteQueue: Promise<void> = Promise.resolve();

export function saveMasterConfigToCloud(
  uid: string,
  stdDb: StdDatabase,
  autoCutList: AutoCutItem[],
  feederList: FeederItem[]
): Promise<void> {
  const path = `masterConfigs/${uid}`;
  const ref = doc(db, 'masterConfigs', uid);
  const baseBody = {
    params: cleanForFirestore(stdDb.params.slice(0, 300)),
    acMatrixMap: matrixToMap(stdDb.acMatrix),
    saMatrixMap: matrixToMap(stdDb.saMatrix),
    mcMatrixMap: matrixToMap(stdDb.mcMatrix),
    autoCutList: cleanForFirestore(autoCutList.slice(0, 2000)),
    feederList: cleanForFirestore(feederList.slice(0, 2000)),
    updatedAt: serverTimestamp(),
  };
  const bodyWithDiscs = {
    ...baseBody,
    processDiscs: cleanForFirestore((stdDb.processDiscs ?? []).slice(0, 100)),
  };

  const runWrite = async () => {
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        try {
          await updateDoc(ref, bodyWithDiscs);
        } catch (innerErr) {
          if (isPermissionDeniedError(innerErr)) {
            await updateDoc(ref, baseBody);
          } else {
            throw innerErr;
          }
        }
      } else {
        try {
          await setDoc(ref, {
            ownerId: uid,
            ...bodyWithDiscs,
            createdAt: serverTimestamp(),
          });
        } catch (innerErr) {
          if (isPermissionDeniedError(innerErr)) {
            await setDoc(ref, {
              ownerId: uid,
              ...baseBody,
              createdAt: serverTimestamp(),
            });
          } else {
            throw innerErr;
          }
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const nextOp = masterConfigWriteQueue.then(runWrite, runWrite);
  masterConfigWriteQueue = nextOp.catch(() => undefined);
  return nextOp;
}

export function subscribeAssyRecords(
  uid: string,
  onData: (records: AssyRecord[]) => void,
  onError: (err: Error) => void
) {
  const path = 'assyRecords';
  const q = query(collection(db, 'assyRecords'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list: AssyRecord[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: String(d.id || docSnap.id),
          createdAt: tsToIso(d.createdAt),
          updatedAt: tsToIso(d.updatedAt),
          params: d.params,
          assemblyComponents: d.assemblyComponents,
          partList: Array.isArray(d.partList) ? d.partList : [],
          ppcsList: Array.isArray(d.ppcsList) ? d.ppcsList : [],
          assemblyCotList: Array.isArray(d.assemblyCotList) ? d.assemblyCotList : [],
          terminalRatios: d.terminalRatios || {},
          calculation: d.calculation,
        } as AssyRecord;
      });
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export async function upsertAssyRecordInCloud(
  uid: string,
  record: AssyRecord
): Promise<AssyRecord> {
  const scopedId = toScopedDocId(uid, record.id);
  const path = `assyRecords/${scopedId}`;
  const fields = buildAssyPayloadFields(uid, record, scopedId);

  let existsInCloud = false;
  try {
    const ownedSnap = await getDocs(
      query(collection(db, 'assyRecords'), where('ownerId', '==', uid))
    );
    existsInCloud = ownedSnap.docs.some((d) => d.id === scopedId);

    const ref = doc(db, 'assyRecords', scopedId);
    if (existsInCloud) {
      await updateDoc(ref, {
        assyNo: fields.assyNo,
        customer: fields.customer,
        params: fields.params,
        assemblyComponents: fields.assemblyComponents,
        partList: fields.partList,
        ppcsList: fields.ppcsList,
        assemblyCotList: fields.assemblyCotList,
        terminalRatios: fields.terminalRatios,
        calculation: fields.calculation,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...fields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return { ...record, id: scopedId };
  } catch (error) {
    handleFirestoreError(
      error,
      existsInCloud ? OperationType.UPDATE : OperationType.CREATE,
      path
    );
  }
}

export async function batchUpdateAssyRecordsInCloud(
  uid: string,
  records: AssyRecord[]
): Promise<void> {
  if (records.length === 0) return;
  const path = 'assyRecords';
  try {
    const ownedSnap = await getDocs(
      query(collection(db, 'assyRecords'), where('ownerId', '==', uid))
    );
    const existingIds = new Set<string>();
    ownedSnap.forEach((d) => existingIds.add(d.id));

    const batch = writeBatch(db);
    records.forEach((rec) => {
      const scopedId = toScopedDocId(uid, rec.id);
      const ref = doc(db, 'assyRecords', scopedId);
      const fields = buildAssyPayloadFields(uid, rec, scopedId);
      if (existingIds.has(scopedId)) {
        batch.update(ref, {
          assyNo: fields.assyNo,
          customer: fields.customer,
          params: fields.params,
          assemblyComponents: fields.assemblyComponents,
          partList: fields.partList,
          ppcsList: fields.ppcsList,
          assemblyCotList: fields.assemblyCotList,
          terminalRatios: fields.terminalRatios,
          calculation: fields.calculation,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(ref, {
          ...fields,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Soft-deletes an AssyRecord in Firebase:
 * - Primary: atomic writeBatch creating `recycleBin/{binId}` + deleting `assyRecords/{scopedId}`.
 * - Fallback (when (default) DB does not yet have `/recycleBin` rules published):
 *   marks `params._recycleBinMeta` on `assyRecords/{scopedId}` so the soft-delete still persists on Firebase server.
 */
export async function moveAssyRecordToRecycleBinInCloud(
  uid: string,
  record: AssyRecord,
  binItem: RecycleBinItem,
  useDedicatedRecycleBin = true
): Promise<string> {
  const scopedAssyId = toScopedDocId(uid, record.id);
  const scopedBinId = toScopedDocId(uid, binItem.id);

  if (!useDedicatedRecycleBin) {
    const assyPath = `assyRecords/${scopedAssyId}`;
    try {
      const { _recycleBinMeta: _omit, ...cleanParams } = record.params;
      await updateDoc(doc(db, 'assyRecords', scopedAssyId), {
        params: cleanForFirestore({
          ...cleanParams,
          _recycleBinMeta: {
            binId: `inplace_${scopedAssyId}`,
            deletedAt: binItem.deletedAt,
          },
        }),
        updatedAt: serverTimestamp(),
      });
      return `inplace_${scopedAssyId}`;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, assyPath);
    }
  }

  const path = `recycleBin/${scopedBinId}`;
  try {
    const ownedSnap = await getDocs(
      query(collection(db, 'assyRecords'), where('ownerId', '==', uid))
    );
    const existsInCloud = ownedSnap.docs.some((d) => d.id === scopedAssyId);

    const batch = writeBatch(db);
    batch.set(
      doc(db, 'recycleBin', scopedBinId),
      buildRecycleBinFirestoreDoc(uid, { ...binItem, originalId: scopedAssyId }, scopedBinId)
    );
    if (existsInCloud) {
      batch.delete(doc(db, 'assyRecords', scopedAssyId));
    }
    await batch.commit();
    return scopedBinId;
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      return moveAssyRecordToRecycleBinInCloud(uid, record, binItem, false);
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function restoreInPlaceAssyInCloud(
  uid: string,
  record: AssyRecord
): Promise<void> {
  const scopedAssyId = toScopedDocId(uid, record.id);
  const path = `assyRecords/${scopedAssyId}`;
  try {
    const { _recycleBinMeta: _omit, ...cleanParams } = record.params;
    await updateDoc(doc(db, 'assyRecords', scopedAssyId), {
      params: cleanForFirestore(cleanParams),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function permanentlyDeleteInPlaceAssyInCloud(
  uid: string,
  originalId: string
): Promise<void> {
  const scopedAssyId = toScopedDocId(uid, originalId);
  const path = `assyRecords/${scopedAssyId}`;
  try {
    const ownedSnap = await getDocs(
      query(collection(db, 'assyRecords'), where('ownerId', '==', uid))
    );
    if (ownedSnap.docs.some((d) => d.id === scopedAssyId)) {
      await deleteDoc(doc(db, 'assyRecords', scopedAssyId));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

function isMasterLogDoc(d: Record<string, unknown>): boolean {
  const diffs = d.affectedDiffs;
  return (
    Array.isArray(diffs) &&
    diffs.length > 0 &&
    typeof diffs[0] === 'object' &&
    diffs[0] !== null &&
    (diffs[0] as Record<string, unknown>)._masterLog === true
  );
}

function parseMasterHistoryDoc(
  docId: string,
  d: Record<string, unknown>
): MasterChangeHistoryEntry {
  const meta = ((Array.isArray(d.affectedDiffs) ? d.affectedDiffs[0] : {}) || {}) as Record<
    string,
    unknown
  >;
  const rawChanges = Array.isArray(meta.changes)
    ? (meta.changes as MasterChangeDiffItem[])
    : [];
  return {
    id: String(d.id || docId),
    changedAt: tsToIso(d.refreshedAt),
    responsibleName: String(d.responsibleName || 'PIC'),
    category: (meta.category as MasterChangeCategory) || 'std_params',
    source: (meta.source as MasterChangeSource) || 'manual_edit',
    ...(typeof meta.sourceFileName === 'string' && meta.sourceFileName
      ? { sourceFileName: meta.sourceFileName }
      : {}),
    ...(typeof meta.note === 'string' && meta.note ? { note: meta.note } : {}),
    totalItemsCount: Number(d.totalSelectedCount) || 0,
    addedCount: Number(meta.addedCount) || 0,
    modifiedCount: Number(meta.modifiedCount) || 0,
    removedCount: Number(meta.removedCount) || 0,
    changes: rawChanges,
  };
}

export function subscribeRefreshHistory(
  uid: string,
  onData: (entries: RefreshHistoryEntry[]) => void,
  onError: (err: Error) => void,
  onMasterHistory?: (entries: MasterChangeHistoryEntry[]) => void
) {
  const path = 'refreshHistory';
  const q = query(collection(db, 'refreshHistory'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const refreshEntries: RefreshHistoryEntry[] = [];
      const masterEntries: MasterChangeHistoryEntry[] = [];

      snap.docs.forEach((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        if (isMasterLogDoc(d)) {
          masterEntries.push(parseMasterHistoryDoc(docSnap.id, d));
        } else {
          refreshEntries.push({
            id: String(d.id || docSnap.id),
            refreshedAt: tsToIso(d.refreshedAt),
            responsibleName: String(d.responsibleName || ''),
            totalSelectedCount: Number(d.totalSelectedCount) || 0,
            affectedAssyCount: Number(d.affectedAssyCount) || 0,
            unaffectedAssyCount: Number(d.unaffectedAssyCount) || 0,
            affectedDiffs: Array.isArray(d.affectedDiffs)
              ? (d.affectedDiffs as RefreshHistoryEntry['affectedDiffs'])
              : [],
          });
        }
      });

      refreshEntries.sort((a, b) => b.refreshedAt.localeCompare(a.refreshedAt));
      masterEntries.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
      onData(refreshEntries);
      if (onMasterHistory) {
        onMasterHistory(masterEntries);
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export async function createRefreshHistoryInCloud(
  uid: string,
  entry: RefreshHistoryEntry
): Promise<RefreshHistoryEntry> {
  const scopedId = toScopedDocId(uid, entry.id);
  const path = `refreshHistory/${scopedId}`;
  try {
    await setDoc(doc(db, 'refreshHistory', scopedId), {
      id: scopedId,
      ownerId: uid,
      refreshedAt: serverTimestamp(),
      responsibleName: (entry.responsibleName || 'PIC').slice(0, 120),
      totalSelectedCount: Math.max(0, Math.min(1000, entry.totalSelectedCount)),
      affectedAssyCount: Math.max(0, Math.min(1000, entry.affectedAssyCount)),
      unaffectedAssyCount: Math.max(0, Math.min(1000, entry.unaffectedAssyCount)),
      affectedDiffs: cleanForFirestore(entry.affectedDiffs.slice(0, 500)),
      createdAt: serverTimestamp(),
    });
    return { ...entry, id: scopedId };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function createMasterChangeHistoryInCloud(
  uid: string,
  entry: MasterChangeHistoryEntry
): Promise<MasterChangeHistoryEntry> {
  const scopedId = toScopedDocId(uid, entry.id);
  const path = `refreshHistory/${scopedId}`;
  const totalChanged = entry.addedCount + entry.modifiedCount + entry.removedCount;
  const clampedTotal = Math.max(0, Math.min(1000, entry.totalItemsCount));
  const clampedChanged = Math.max(0, Math.min(1000, totalChanged));
  const clampedUnchanged = Math.max(0, Math.min(1000, Math.max(0, clampedTotal - clampedChanged)));

  try {
    await setDoc(doc(db, 'refreshHistory', scopedId), {
      id: scopedId,
      ownerId: uid,
      refreshedAt: serverTimestamp(),
      responsibleName: (entry.responsibleName || 'PIC').slice(0, 120),
      totalSelectedCount: clampedTotal,
      affectedAssyCount: clampedChanged,
      unaffectedAssyCount: clampedUnchanged,
      affectedDiffs: [
        cleanForFirestore({
          _masterLog: true,
          category: entry.category,
          source: entry.source,
          ...(entry.sourceFileName ? { sourceFileName: entry.sourceFileName.slice(0, 160) } : {}),
          ...(entry.note ? { note: entry.note.slice(0, 240) } : {}),
          addedCount: entry.addedCount,
          modifiedCount: entry.modifiedCount,
          removedCount: entry.removedCount,
          changes: entry.changes.slice(0, 500),
        }),
      ],
      createdAt: serverTimestamp(),
    });
    return { ...entry, id: scopedId };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteMasterChangeHistoryInCloud(
  uid: string,
  entryId: string
): Promise<void> {
  const scopedId = toScopedDocId(uid, entryId);
  const path = `refreshHistory/${scopedId}`;
  try {
    const ownedSnap = await getDocs(
      query(collection(db, 'refreshHistory'), where('ownerId', '==', uid))
    );
    if (ownedSnap.docs.some((d) => d.id === scopedId)) {
      await deleteDoc(doc(db, 'refreshHistory', scopedId));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function clearMasterChangeHistoryInCloud(
  uid: string,
  entryIds: string[]
): Promise<void> {
  if (entryIds.length === 0) return;
  const path = 'refreshHistory';
  try {
    const ownedSnap = await getDocs(
      query(collection(db, 'refreshHistory'), where('ownerId', '==', uid))
    );
    const existingIds = new Set(ownedSnap.docs.map((d) => d.id));
    const toDelete = entryIds
      .map((id) => toScopedDocId(uid, id))
      .filter((sid) => existingIds.has(sid));

    const CHUNK = 200;
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      const batch = writeBatch(db);
      toDelete.slice(i, i + CHUNK).forEach((sid) => {
        batch.delete(doc(db, 'refreshHistory', sid));
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Soft-deletes a RefreshHistoryEntry into Firebase `recycleBin` (or deletes active doc cleanly if /recycleBin rules pending).
 */
export async function moveRefreshHistoryToRecycleBinInCloud(
  uid: string,
  entry: RefreshHistoryEntry,
  binItem: RecycleBinItem,
  useDedicatedRecycleBin = true
): Promise<string> {
  const scopedHistId = toScopedDocId(uid, entry.id);
  const scopedBinId = toScopedDocId(uid, binItem.id);
  const path = useDedicatedRecycleBin ? `recycleBin/${scopedBinId}` : `refreshHistory/${scopedHistId}`;
  try {
    const ownedSnap = await getDocs(
      query(collection(db, 'refreshHistory'), where('ownerId', '==', uid))
    );
    const existsInCloud = ownedSnap.docs.some((d) => d.id === scopedHistId);

    if (!useDedicatedRecycleBin) {
      if (existsInCloud) {
        await deleteDoc(doc(db, 'refreshHistory', scopedHistId));
      }
      return scopedBinId;
    }

    const batch = writeBatch(db);
    batch.set(
      doc(db, 'recycleBin', scopedBinId),
      buildRecycleBinFirestoreDoc(uid, { ...binItem, originalId: scopedHistId }, scopedBinId)
    );
    if (existsInCloud) {
      batch.delete(doc(db, 'refreshHistory', scopedHistId));
    }
    await batch.commit();
    return scopedBinId;
  } catch (error) {
    if (useDedicatedRecycleBin && isPermissionDeniedError(error)) {
      return moveRefreshHistoryToRecycleBinInCloud(uid, entry, binItem, false);
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Soft-deletes multiple RefreshHistoryEntry documents into Firebase `recycleBin` (with fallback if /recycleBin rules pending).
 */
export async function moveManyRefreshHistoryToRecycleBinInCloud(
  uid: string,
  pairs: { entry: RefreshHistoryEntry; binItem: RecycleBinItem }[],
  useDedicatedRecycleBin = true
): Promise<void> {
  if (pairs.length === 0) return;
  const path = useDedicatedRecycleBin ? 'recycleBin' : 'refreshHistory';
  try {
    const ownedSnap = await getDocs(
      query(collection(db, 'refreshHistory'), where('ownerId', '==', uid))
    );
    const existingIds = new Set<string>();
    ownedSnap.forEach((d) => existingIds.add(d.id));

    const CHUNK = 200;
    for (let i = 0; i < pairs.length; i += CHUNK) {
      const slice = pairs.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      slice.forEach(({ entry, binItem }) => {
        const scopedHistId = toScopedDocId(uid, entry.id);
        const scopedBinId = toScopedDocId(uid, binItem.id);
        if (useDedicatedRecycleBin) {
          batch.set(
            doc(db, 'recycleBin', scopedBinId),
            buildRecycleBinFirestoreDoc(uid, { ...binItem, originalId: scopedHistId }, scopedBinId)
          );
        }
        if (existingIds.has(scopedHistId)) {
          batch.delete(doc(db, 'refreshHistory', scopedHistId));
        }
      });
      await batch.commit();
    }
  } catch (error) {
    if (useDedicatedRecycleBin && isPermissionDeniedError(error)) {
      return moveManyRefreshHistoryToRecycleBinInCloud(uid, pairs, false);
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Saves a soft-deleted master item (Auto-Cut terminal, Feeder seal, or Custom Logic Disc)
 * into the Firebase `recycleBin` directory.
 */
export async function addMasterItemToRecycleBinInCloud(
  uid: string,
  binItem: RecycleBinItem
): Promise<string> {
  const scopedBinId = toScopedDocId(uid, binItem.id);
  const path = `recycleBin/${scopedBinId}`;
  try {
    await setDoc(
      doc(db, 'recycleBin', scopedBinId),
      buildRecycleBinFirestoreDoc(uid, binItem, scopedBinId)
    );
    return scopedBinId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeRecycleBin(
  uid: string,
  onData: (items: RecycleBinItem[]) => void,
  onError: (err: Error) => void
) {
  const path = 'recycleBin';
  const q = query(collection(db, 'recycleBin'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: RecycleBinItem[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: String(d.id || docSnap.id),
          itemType: d.itemType as RecycleBinItemType,
          originalCollection: d.originalCollection as RecycleBinOriginalCollection,
          originalId: String(d.originalId || ''),
          title: String(d.title || 'Item'),
          subtitle: String(d.subtitle || ''),
          deletedAt: tsToIso(d.deletedAt),
          payload: (d.payload && typeof d.payload === 'object' ? d.payload : {}) as Record<
            string,
            unknown
          >,
        };
      });
      items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

/**
 * Atomically restores an AssyRecord from Firebase `recycleBin` back to `assyRecords`.
 */
export async function restoreAssyFromRecycleBinInCloud(
  uid: string,
  binItem: RecycleBinItem,
  restoredRecord: AssyRecord
): Promise<AssyRecord> {
  const scopedBinId = toScopedDocId(uid, binItem.id);
  const path = `recycleBin/${scopedBinId}`;
  try {
    const [ownedAssySnap, ownedBinSnap] = await Promise.all([
      getDocs(query(collection(db, 'assyRecords'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'recycleBin'), where('ownerId', '==', uid))),
    ]);
    const existingAssyIds = new Set<string>();
    ownedAssySnap.forEach((d) => existingAssyIds.add(d.id));
    const binExists = ownedBinSnap.docs.some((d) => d.id === scopedBinId);

    let targetAssyId = toScopedDocId(uid, binItem.originalId || restoredRecord.id);
    if (existingAssyIds.has(targetAssyId)) {
      targetAssyId = toScopedDocId(
        uid,
        `restored_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      );
    }

    const fields = buildAssyPayloadFields(uid, { ...restoredRecord, id: targetAssyId }, targetAssyId);
    const batch = writeBatch(db);
    batch.set(doc(db, 'assyRecords', targetAssyId), {
      ...fields,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (binExists) {
      batch.delete(doc(db, 'recycleBin', scopedBinId));
    }
    await batch.commit();
    return { ...restoredRecord, id: targetAssyId };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Atomically restores a RefreshHistoryEntry from Firebase `recycleBin` back to `refreshHistory`.
 */
export async function restoreHistoryFromRecycleBinInCloud(
  uid: string,
  binItem: RecycleBinItem,
  restoredEntry: RefreshHistoryEntry
): Promise<RefreshHistoryEntry> {
  const scopedBinId = toScopedDocId(uid, binItem.id);
  const path = `recycleBin/${scopedBinId}`;
  try {
    const [ownedHistSnap, ownedBinSnap] = await Promise.all([
      getDocs(query(collection(db, 'refreshHistory'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'recycleBin'), where('ownerId', '==', uid))),
    ]);
    const existingHistIds = new Set<string>();
    ownedHistSnap.forEach((d) => existingHistIds.add(d.id));
    const binExists = ownedBinSnap.docs.some((d) => d.id === scopedBinId);

    let targetHistId = toScopedDocId(uid, binItem.originalId || restoredEntry.id);
    if (existingHistIds.has(targetHistId)) {
      targetHistId = toScopedDocId(
        uid,
        `restored_hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      );
    }

    const batch = writeBatch(db);
    batch.set(doc(db, 'refreshHistory', targetHistId), {
      id: targetHistId,
      ownerId: uid,
      refreshedAt: serverTimestamp(),
      responsibleName: (restoredEntry.responsibleName || 'PIC').slice(0, 120),
      totalSelectedCount: Math.max(0, Math.min(1000, restoredEntry.totalSelectedCount || 0)),
      affectedAssyCount: Math.max(0, Math.min(1000, restoredEntry.affectedAssyCount || 0)),
      unaffectedAssyCount: Math.max(0, Math.min(1000, restoredEntry.unaffectedAssyCount || 0)),
      affectedDiffs: cleanForFirestore((restoredEntry.affectedDiffs || []).slice(0, 500)),
      createdAt: serverTimestamp(),
    });
    if (binExists) {
      batch.delete(doc(db, 'recycleBin', scopedBinId));
    }
    await batch.commit();
    return { ...restoredEntry, id: targetHistId };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function permanentlyDeleteRecycleBinItemFromCloud(
  uid: string,
  binId: string
): Promise<void> {
  const scopedBinId = toScopedDocId(uid, binId);
  const path = `recycleBin/${scopedBinId}`;
  try {
    const ownedBinSnap = await getDocs(
      query(collection(db, 'recycleBin'), where('ownerId', '==', uid))
    );
    if (ownedBinSnap.docs.some((d) => d.id === scopedBinId)) {
      await deleteDoc(doc(db, 'recycleBin', scopedBinId));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function emptyRecycleBinInCloud(
  uid: string,
  binIds: string[]
): Promise<void> {
  if (binIds.length === 0) return;
  const path = 'recycleBin';
  try {
    const ownedBinSnap = await getDocs(
      query(collection(db, 'recycleBin'), where('ownerId', '==', uid))
    );
    const existingIds = new Set<string>();
    ownedBinSnap.forEach((d) => existingIds.add(d.id));

    const toDelete = Array.from(
      new Set(binIds.map((id) => toScopedDocId(uid, id)).filter((id) => existingIds.has(id)))
    );

    const CHUNK = 400;
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      const slice = toDelete.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      slice.forEach((scopedId) => {
        batch.delete(doc(db, 'recycleBin', scopedId));
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function replaceAllAssyRecordsInCloud(
  uid: string,
  existingRecords: AssyRecord[],
  newRecords: AssyRecord[],
  useDedicatedRecycleBin = true
): Promise<AssyRecord[]> {
  const path = 'assyRecords';
  try {
    const existingSnap = await getDocs(
      query(collection(db, 'assyRecords'), where('ownerId', '==', uid))
    );
    const cloudExistingMap = new Map<string, AssyRecord>();
    existingSnap.forEach((docSnap) => {
      const d = docSnap.data();
      cloudExistingMap.set(docSnap.id, {
        id: String(d.id || docSnap.id),
        createdAt: tsToIso(d.createdAt),
        updatedAt: tsToIso(d.updatedAt),
        params: d.params,
        assemblyComponents: d.assemblyComponents,
        partList: Array.isArray(d.partList) ? d.partList : [],
        ppcsList: Array.isArray(d.ppcsList) ? d.ppcsList : [],
        assemblyCotList: Array.isArray(d.assemblyCotList) ? d.assemblyCotList : [],
        terminalRatios: d.terminalRatios || {},
        calculation: d.calculation,
      } as AssyRecord);
    });

    const batch = writeBatch(db);
    const newScopedIds = new Set<string>();
    const resultRecords: AssyRecord[] = [];

    newRecords.forEach((rec) => {
      const scopedId = toScopedDocId(uid, rec.id);
      newScopedIds.add(scopedId);
      const { _recycleBinMeta: _omit, ...cleanParams } = rec.params;
      const cleanRec = { ...rec, params: cleanParams };
      const fields = buildAssyPayloadFields(uid, cleanRec, scopedId);
      const ref = doc(db, 'assyRecords', scopedId);
      if (cloudExistingMap.has(scopedId)) {
        batch.update(ref, {
          assyNo: fields.assyNo,
          customer: fields.customer,
          params: fields.params,
          assemblyComponents: fields.assemblyComponents,
          partList: fields.partList,
          ppcsList: fields.ppcsList,
          assemblyCotList: fields.assemblyCotList,
          terminalRatios: fields.terminalRatios,
          calculation: fields.calculation,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(ref, {
          ...fields,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      resultRecords.push({ ...cleanRec, id: scopedId });
    });

    // Move any replaced/removed active Assy records into Recycle Bin instead of hard deleting
    const localMap = new Map(existingRecords.map((r) => [toScopedDocId(uid, r.id), r]));
    cloudExistingMap.forEach((cloudRec, scopedId) => {
      if (cloudRec.params?._recycleBinMeta) return;
      if (!newScopedIds.has(scopedId)) {
        const snapshotRec = localMap.get(scopedId) ?? cloudRec;
        const binItem = buildRecycleBinItemFromAssy(snapshotRec);
        if (useDedicatedRecycleBin) {
          const scopedBinId = toScopedDocId(uid, binItem.id);
          batch.set(
            doc(db, 'recycleBin', scopedBinId),
            buildRecycleBinFirestoreDoc(uid, { ...binItem, originalId: scopedId }, scopedBinId)
          );
          batch.delete(doc(db, 'assyRecords', scopedId));
        } else {
          batch.update(doc(db, 'assyRecords', scopedId), {
            params: cleanForFirestore({
              ...snapshotRec.params,
              _recycleBinMeta: {
                binId: `inplace_${scopedId}`,
                deletedAt: binItem.deletedAt,
              },
            }),
            updatedAt: serverTimestamp(),
          });
        }
      }
    });

    await batch.commit();
    return resultRecords;
  } catch (error) {
    if (useDedicatedRecycleBin && isPermissionDeniedError(error)) {
      return replaceAllAssyRecordsInCloud(uid, existingRecords, newRecords, false);
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
