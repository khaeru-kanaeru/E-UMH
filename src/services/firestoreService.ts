import { User } from 'firebase/auth';
import {
  DocumentData,
  QueryDocumentSnapshot,
  Timestamp,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { upgradeLegacyCotMatrix, upgradeDifficultyMatrix } from '../data/cotMasterV2';
import { upgradeAssemblyStdParams } from '../data/defaultStdDb';
import { calculateUmh, getAllowSecForMode } from '../engine/umhCalculator';
import { OperationType, db, getLegacyDefaultDb, handleFirestoreError } from '../firebase';
import {
  AssyRecord,
  AutoCutItem,
  FeederItem,
  MasterChangeCategory,
  MasterChangeDiffItem,
  MasterChangeHistoryEntry,
  MasterChangeSource,
  RecycleBinItem,
  RecycleBinItemType,
  RecycleBinOriginalCollection,
  RefreshHistoryEntry,
  StdDatabase,
} from '../types/umh';
import firestoreRulesSource from '../../firestore.rules?raw';

export const FIRESTORE_RULES_SOURCE = firestoreRulesSource;
export const SHARED_MASTER_DOC_ID = 'shared';
export const ASSY_PAGE_SIZE = 33;

export interface CloudActor {
  uid: string;
  name: string;
  email?: string;
}

export interface DuplicateAssyMatch {
  id: string;
  assyNo: string;
  customer: string;
  createdByName?: string;
  updatedAt: string;
}

export interface AssyPageResult {
  records: AssyRecord[];
  firstDoc: QueryDocumentSnapshot<DocumentData> | null;
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

export function getGoogleUserDisplayName(user: User | null | undefined): string {
  if (!user) return '';
  return (user.displayName || user.email || 'User').trim().slice(0, 120);
}

export function toCloudActor(user: User): CloudActor {
  return {
    uid: user.uid,
    name: getGoogleUserDisplayName(user) || 'User',
    email: (user.email || '').trim().slice(0, 254) || undefined,
  };
}

export function normalizeAssyNo(assyNo: string): string {
  return assyNo.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}

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

export function isOfflineOrNetworkError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('client is offline') ||
    msg.includes('could not reach cloud firestore backend') ||
    msg.includes('network-request-failed') ||
    msg.includes('err_network') ||
    msg.includes('failed to fetch') ||
    msg.includes('unavailable')
  );
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
  pendingMasterSync?: boolean;
  updatedByName?: string;
}

const MAX_DOC_BYTES = 860_000; // Safe ceiling below Firestore's 1 MiB document limit

function sanitizeIdPart(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  return cleaned || `item_${Date.now()}`;
}

export function toSharedDocId(rawId: string, prefix = 'doc'): string {
  const clean = sanitizeIdPart(rawId).slice(0, 128);
  if (clean && clean !== 'item_') return clean;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.slice(0, 128);
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

function hydrateAssyRecordFromDoc(
  docId: string,
  d: Record<string, unknown>,
  recalcContext?: {
    stdDb: StdDatabase;
    autoCutList: AutoCutItem[];
    feederList: FeederItem[];
  }
): AssyRecord {
  const baseRec: AssyRecord = {
    id: String(d.id || docId),
    createdAt: tsToIso(d.createdAt),
    updatedAt: tsToIso(d.updatedAt),
    createdByUid: typeof d.createdByUid === 'string' ? d.createdByUid : undefined,
    createdByName: typeof d.createdByName === 'string' ? d.createdByName : undefined,
    createdByEmail: typeof d.createdByEmail === 'string' ? d.createdByEmail : undefined,
    updatedByUid: typeof d.updatedByUid === 'string' ? d.updatedByUid : undefined,
    updatedByName: typeof d.updatedByName === 'string' ? d.updatedByName : undefined,
    updatedByEmail: typeof d.updatedByEmail === 'string' ? d.updatedByEmail : undefined,
    params: d.params as AssyRecord['params'],
    assemblyComponents: d.assemblyComponents as AssyRecord['assemblyComponents'],
    partList: Array.isArray(d.partList) ? (d.partList as AssyRecord['partList']) : [],
    ppcsList: Array.isArray(d.ppcsList) ? (d.ppcsList as AssyRecord['ppcsList']) : [],
    assemblyCotList: Array.isArray(d.assemblyCotList)
      ? (d.assemblyCotList as AssyRecord['assemblyCotList'])
      : [],
    terminalRatios: (d.terminalRatios as AssyRecord['terminalRatios']) || {},
    calculation: d.calculation as AssyRecord['calculation'],
  };

  if (
    recalcContext &&
    (!baseRec.calculation ||
      !Array.isArray(baseRec.calculation.processes) ||
      baseRec.calculation.processes.length === 0)
  ) {
    baseRec.calculation = calculateUmh(
      baseRec,
      recalcContext.stdDb,
      recalcContext.autoCutList,
      recalcContext.feederList
    );
  }

  return baseRec;
}

function compactAssyRecordPayload(record: AssyRecord): Record<string, unknown> {
  const calculationPayload: Record<string, unknown> = cleanForFirestore(
    record.calculation
  ) as unknown as Record<string, unknown>;

  const payload: Record<string, unknown> = {
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.createdByUid ? { createdByUid: record.createdByUid } : {}),
    ...(record.createdByName ? { createdByName: record.createdByName } : {}),
    ...(record.createdByEmail ? { createdByEmail: record.createdByEmail } : {}),
    ...(record.updatedByUid ? { updatedByUid: record.updatedByUid } : {}),
    ...(record.updatedByName ? { updatedByName: record.updatedByName } : {}),
    ...(record.updatedByEmail ? { updatedByEmail: record.updatedByEmail } : {}),
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
      rawTotalBaseSec: record.calculation.rawTotalBaseSec,
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

function buildAssyPayloadFields(
  actor: CloudActor,
  record: AssyRecord,
  docId: string,
  existingDocData?: Record<string, unknown>
) {
  const assyNo = (record.params.assyNo || '').trim().slice(0, 120) || 'ASSY';
  const assyNoNormalized = normalizeAssyNo(assyNo) || 'assy';
  const customer = (record.params.customer || '').trim().slice(0, 120);

  const calculationPayload: Record<string, unknown> = cleanForFirestore(
    record.calculation
  ) as unknown as Record<string, unknown>;

  const existingCreatedByUid =
    typeof existingDocData?.createdByUid === 'string' && existingDocData.createdByUid
      ? existingDocData.createdByUid
      : undefined;
  const existingCreatedByName =
    typeof existingDocData?.createdByName === 'string' && existingDocData.createdByName
      ? existingDocData.createdByName
      : record.createdByName;
  const existingCreatedByEmail =
    typeof existingDocData?.createdByEmail === 'string' && existingDocData.createdByEmail
      ? existingDocData.createdByEmail
      : record.createdByEmail;

  // On create (no existingDocData), createdByUid MUST match actor.uid to satisfy Firestore create rules,
  // while createdByName/Email can still preserve original attribution (e.g. recycle-bin restore).
  const createdByUid = sanitizeIdPart(existingCreatedByUid || actor.uid).slice(0, 128);
  const createdByName = (existingCreatedByName || actor.name || 'User').trim().slice(0, 120);
  const createdByEmail = (existingCreatedByEmail || actor.email || '').trim().slice(0, 254);

  const updatedByUid = sanitizeIdPart(actor.uid).slice(0, 128);
  const updatedByName = (actor.name || 'User').trim().slice(0, 120);
  const updatedByEmail = (actor.email || '').trim().slice(0, 254);

  const payload: Record<string, unknown> = {
    id: docId,
    ownerId: actor.uid,
    assyNo,
    assyNoNormalized,
    customer,
    createdByUid,
    createdByName,
    ...(createdByEmail ? { createdByEmail } : {}),
    updatedByUid,
    updatedByName,
    ...(updatedByEmail ? { updatedByEmail } : {}),
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
      rawTotalBaseSec: record.calculation.rawTotalBaseSec,
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

function buildRecycleBinFirestoreDoc(uid: string, item: RecycleBinItem, docBinId: string) {
  const allowedTypes: RecycleBinItemType[] = [
    'assy_record',
    'refresh_history',
    'auto_cut_item',
    'feeder_item',
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
    id: docBinId,
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
  const actor = toCloudActor(user);
  const uid = actor.uid;
  const userPath = `users/${uid}`;
  const sharedMasterPath = `masterConfigs/${SHARED_MASTER_DOC_ID}`;
  let recycleBinCloudAvailable = true;

  // 1. Ensure user profile exists (strictly owner-only PII)
  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    const displayName = (user.displayName || '').slice(0, 120);
    const email = (user.email || 'user@example.com').slice(0, 254);
    const photoURL = (user.photoURL || '').slice(0, 1000);
    const lastPicName = (actor.name || localState.lastPicName || '').slice(0, 120);

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
        ...(lastPicName ? { lastPicName } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  // 2. Ensure shared master config (`masterConfigs/shared`) exists
  //    If `shared` does not exist yet, migrate from legacy `masterConfigs/{uid}` if present, else seed from local state.
  try {
    const sharedMasterRef = doc(db, 'masterConfigs', SHARED_MASTER_DOC_ID);
    const sharedMasterSnap = await getDoc(sharedMasterRef);

    if (!sharedMasterSnap.exists()) {
      let legacyData: Record<string, unknown> | null = null;
      try {
        const legacySnap = await getDoc(doc(db, 'masterConfigs', uid));
        if (legacySnap.exists()) {
          legacyData = legacySnap.data() as Record<string, unknown>;
        }
      } catch {
        // Ignore if legacy doc doesn't exist in current DB
      }
      if (!legacyData) {
        const legacyDb = getLegacyDefaultDb();
        if (legacyDb) {
          try {
            const defaultLegacySnap = await getDoc(doc(legacyDb, 'masterConfigs', uid));
            if (defaultLegacySnap.exists()) {
              legacyData = defaultLegacySnap.data() as Record<string, unknown>;
            }
          } catch {
            // Ignore if legacy (default) DB is inaccessible or empty
          }
        }
      }

      const seedStdParams =
        legacyData && Array.isArray(legacyData.params)
          ? upgradeAssemblyStdParams(legacyData.params)
          : localState.stdDb.params;
      const seedAc = legacyData
        ? mapToMatrix(legacyData.acMatrixMap as Record<string, number[]> | undefined, localState.stdDb.acMatrix)
        : localState.stdDb.acMatrix;
      const seedSa = legacyData
        ? mapToMatrix(legacyData.saMatrixMap as Record<string, number[]> | undefined, localState.stdDb.saMatrix)
        : localState.stdDb.saMatrix;
      const seedMc = legacyData
        ? mapToMatrix(legacyData.mcMatrixMap as Record<string, number[]> | undefined, localState.stdDb.mcMatrix)
        : localState.stdDb.mcMatrix;
      const seedCot = legacyData
        ? upgradeLegacyCotMatrix(
            mapToMatrix(legacyData.cotMatrixMap as Record<string, number[]> | undefined, localState.stdDb.cotMatrix)
          )
        : localState.stdDb.cotMatrix;
      const seedDiff = legacyData
        ? upgradeDifficultyMatrix(
            mapToMatrix(
              legacyData.difficultyMatrixMap as Record<string, number[]> | undefined,
              localState.stdDb.difficultyMatrix
            )
          )
        : localState.stdDb.difficultyMatrix;
      const seedAutoCut =
        legacyData && Array.isArray(legacyData.autoCutList)
          ? (legacyData.autoCutList as AutoCutItem[])
          : localState.autoCutList;
      const seedFeeder =
        legacyData && Array.isArray(legacyData.feederList)
          ? (legacyData.feederList as FeederItem[])
          : localState.feederList;

      await setDoc(sharedMasterRef, {
        ownerId: uid,
        updatedByUid: uid,
        updatedByName: actor.name,
        pendingMasterSync: Boolean(localState.pendingMasterSync),
        params: cleanForFirestore(seedStdParams.slice(0, 300)),
        acMatrixMap: matrixToMap(seedAc),
        saMatrixMap: matrixToMap(seedSa),
        mcMatrixMap: matrixToMap(seedMc),
        cotMatrixMap: matrixToMap(seedCot),
        difficultyMatrixMap: matrixToMap(seedDiff),
        autoCutList: cleanForFirestore(seedAutoCut.slice(0, 2000)),
        feederList: cleanForFirestore(seedFeeder.slice(0, 2000)),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, sharedMasterPath);
  }

  // 3. Probe shared `/recycleBin` availability (lightweight limit 1 query)
  try {
    await getDocs(query(collection(db, 'recycleBin'), limit(1)));
  } catch (probeErr) {
    if (isPermissionDeniedError(probeErr)) {
      recycleBinCloudAvailable = false;
    } else {
      handleFirestoreError(probeErr, OperationType.LIST, 'recycleBin');
    }
  }

  // 4. Remove any previously auto-seeded KHR sample doc, and seed Assy records only if collection is empty.
  //    Checks legacy `(default)` DB first (if user had real data saved there earlier), then falls back to localState.
  try {
    try {
      const sampleRef = doc(db, 'assyRecords', 'sample_khr55431');
      const sampleSnap = await getDoc(sampleRef);
      if (sampleSnap.exists()) {
        await deleteDoc(sampleRef);
      }
    } catch {
      // Ignore if sample doc doesn't exist
    }

    const anyAssySnap = await getDocs(query(collection(db, 'assyRecords'), limit(1)));
    if (anyAssySnap.empty) {
      const seedRecords: AssyRecord[] = [];
      const seenDocIds = new Set<string>();

      const legacyDb = getLegacyDefaultDb();
      if (legacyDb) {
        try {
          const legacyAssySnap = await getDocs(
            query(collection(legacyDb, 'assyRecords'), where('ownerId', '==', uid))
          );
          legacyAssySnap.forEach((docSnap) => {
            if (docSnap.id === 'sample_khr55431') return;
            const hydrated = hydrateAssyRecordFromDoc(
              docSnap.id,
              docSnap.data() as Record<string, unknown>
            );
            if (!hydrated.params?._recycleBinMeta && hydrated.id !== 'sample_khr55431') {
              const docId = toSharedDocId(hydrated.id, 'assy');
              if (!seenDocIds.has(docId)) {
                seenDocIds.add(docId);
                seedRecords.push({ ...hydrated, id: docId });
              }
            }
          });
        } catch {
          // Ignore if legacy (default) DB is inaccessible or empty
        }
      }

      localState.records.forEach((rec) => {
        if (rec.id === 'sample_khr55431') return;
        const docId = toSharedDocId(rec.id, 'assy');
        if (!seenDocIds.has(docId)) {
          seenDocIds.add(docId);
          seedRecords.push(rec);
        }
      });

      for (const rec of seedRecords) {
        const docId = toSharedDocId(rec.id, 'assy');
        await setDoc(doc(db, 'assyRecords', docId), {
          ...buildAssyPayloadFields(actor, rec, docId),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'assyRecords');
  }

  // 5. Silently migrate prior `refreshHistory` from legacy `(default)` DB if shared history is empty
  try {
    const anyHistSnap = await getDocs(query(collection(db, 'refreshHistory'), limit(1)));
    if (anyHistSnap.empty) {
      const legacyDb = getLegacyDefaultDb();
      if (legacyDb) {
        const legacyHistSnap = await getDocs(
          query(collection(legacyDb, 'refreshHistory'), where('ownerId', '==', uid))
        );
        for (const docSnap of legacyHistSnap.docs) {
          const d = docSnap.data() as Record<string, unknown>;
          const docId = toSharedDocId(String(d.id || docSnap.id), 'hist');
          await setDoc(doc(db, 'refreshHistory', docId), {
            id: docId,
            ownerId: uid,
            refreshedAt: serverTimestamp(),
            responsibleName: String(d.responsibleName || actor.name || 'PIC').slice(0, 120),
            totalSelectedCount: Math.max(0, Math.min(1000, Number(d.totalSelectedCount) || 0)),
            affectedAssyCount: Math.max(0, Math.min(1000, Number(d.affectedAssyCount) || 0)),
            unaffectedAssyCount: Math.max(0, Math.min(1000, Number(d.unaffectedAssyCount) || 0)),
            affectedDiffs: Array.isArray(d.affectedDiffs)
              ? cleanForFirestore(d.affectedDiffs.slice(0, 500))
              : [],
            createdAt: serverTimestamp(),
          });
        }
      }
    }
  } catch {
    // Ignore if legacy (default) history cannot be read
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
  fallbackStd: StdDatabase,
  onData: (cfg: CloudMasterConfig | null) => void,
  onError: (err: Error) => void
) {
  const path = `masterConfigs/${SHARED_MASTER_DOC_ID}`;
  return onSnapshot(
    doc(db, 'masterConfigs', SHARED_MASTER_DOC_ID),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const d = snap.data();
      onData({
        stdDb: {
          params: Array.isArray(d.params)
            ? upgradeAssemblyStdParams(d.params)
            : structuredClone(fallbackStd.params),
          acMatrix: mapToMatrix(d.acMatrixMap, fallbackStd.acMatrix),
          saMatrix: mapToMatrix(d.saMatrixMap, fallbackStd.saMatrix),
          mcMatrix: mapToMatrix(d.mcMatrixMap, fallbackStd.mcMatrix),
          cotMatrix: upgradeLegacyCotMatrix(mapToMatrix(d.cotMatrixMap, fallbackStd.cotMatrix)),
          difficultyMatrix: upgradeDifficultyMatrix(
            mapToMatrix(d.difficultyMatrixMap, fallbackStd.difficultyMatrix)
          ),
        },
        autoCutList: Array.isArray(d.autoCutList) ? d.autoCutList : [],
        feederList: Array.isArray(d.feederList) ? d.feederList : [],
        pendingMasterSync:
          typeof d.pendingMasterSync === 'boolean' ? d.pendingMasterSync : undefined,
        updatedByName: typeof d.updatedByName === 'string' ? d.updatedByName : undefined,
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
  actor: CloudActor,
  stdDb: StdDatabase,
  autoCutList: AutoCutItem[],
  feederList: FeederItem[],
  pendingMasterSync?: boolean
): Promise<void> {
  const path = `masterConfigs/${SHARED_MASTER_DOC_ID}`;
  const ref = doc(db, 'masterConfigs', SHARED_MASTER_DOC_ID);
  const bodyFull: Record<string, unknown> = {
    params: cleanForFirestore(stdDb.params.slice(0, 300)),
    acMatrixMap: matrixToMap(stdDb.acMatrix),
    saMatrixMap: matrixToMap(stdDb.saMatrix),
    mcMatrixMap: matrixToMap(stdDb.mcMatrix),
    cotMatrixMap: matrixToMap(stdDb.cotMatrix),
    difficultyMatrixMap: matrixToMap(stdDb.difficultyMatrix),
    autoCutList: cleanForFirestore(autoCutList.slice(0, 2000)),
    feederList: cleanForFirestore(feederList.slice(0, 2000)),
    updatedByUid: actor.uid,
    updatedByName: (actor.name || 'User').slice(0, 120),
    ...(typeof pendingMasterSync === 'boolean' ? { pendingMasterSync } : {}),
    updatedAt: serverTimestamp(),
  };

  const runWrite = async () => {
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          ...bodyFull,
          processDiscs: deleteField(),
          settingWireMatrixMap: deleteField(),
        });
      } else {
        await setDoc(ref, {
          ownerId: actor.uid,
          ...bodyFull,
          createdAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const nextOp = masterConfigWriteQueue.then(runWrite, runWrite);
  masterConfigWriteQueue = nextOp.catch(() => undefined);
  return nextOp;
}

export async function updateSharedPendingMasterSyncInCloud(
  actor: CloudActor,
  pendingMasterSync: boolean
): Promise<void> {
  const path = `masterConfigs/${SHARED_MASTER_DOC_ID}`;
  try {
    const ref = doc(db, 'masterConfigs', SHARED_MASTER_DOC_ID);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    await updateDoc(ref, {
      pendingMasterSync,
      updatedByUid: actor.uid,
      updatedByName: (actor.name || 'User').slice(0, 120),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Server-side cursor-based pagination for `assyRecords` (fetches ONLY `pageSize` = 33 items per request).
 * Uses `orderBy('updatedAt', 'desc')` with `limit(pageSize + 1)` and optional `startAfter(cursor)`.
 */
export async function fetchAssyRecordsPage(options: {
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
  pageSize?: number;
  stdDb?: StdDatabase;
  autoCutList?: AutoCutItem[];
  feederList?: FeederItem[];
}): Promise<AssyPageResult> {
  const pageSize = options.pageSize ?? ASSY_PAGE_SIZE;
  const recalcContext =
    options.stdDb && options.autoCutList && options.feederList
      ? {
          stdDb: options.stdDb,
          autoCutList: options.autoCutList,
          feederList: options.feederList,
        }
      : undefined;

  const activeRecords: AssyRecord[] = [];
  const activeSnaps: QueryDocumentSnapshot<DocumentData>[] = [];
  let currentCursor = options.cursor ?? null;
  let hasMore = false;
  let loopGuard = 0;

  try {
    while (activeRecords.length < pageSize && loopGuard < 5) {
      loopGuard += 1;
      const remaining = pageSize - activeRecords.length;
      const fetchLimit = remaining + 1;
      const q = currentCursor
        ? query(
            collection(db, 'assyRecords'),
            orderBy('updatedAt', 'desc'),
            startAfter(currentCursor),
            limit(fetchLimit)
          )
        : query(collection(db, 'assyRecords'), orderBy('updatedAt', 'desc'), limit(fetchLimit));

      const snap = await getDocs(q);
      if (snap.empty) {
        hasMore = false;
        break;
      }

      const docs = snap.docs;
      let exhaustedBatch = true;
      for (let i = 0; i < docs.length; i += 1) {
        const docSnap = docs[i];
        const data = docSnap.data() as Record<string, unknown>;
        const rec = hydrateAssyRecordFromDoc(docSnap.id, data, recalcContext);
        if (rec.params?._recycleBinMeta) {
          continue;
        }
        if (activeRecords.length < pageSize) {
          activeRecords.push(rec);
          activeSnaps.push(docSnap);
        } else {
          hasMore = true;
          exhaustedBatch = false;
          break;
        }
      }

      if (!exhaustedBatch) {
        break;
      }

      if (docs.length < fetchLimit) {
        hasMore = false;
        break;
      }

      currentCursor = docs[docs.length - 1];
      if (activeRecords.length >= pageSize) {
        // Need to know if there's at least 1 more active doc after this cursor
        hasMore = true;
        break;
      }
    }

    return {
      records: activeRecords,
      firstDoc: activeSnaps[0] ?? null,
      lastDoc: activeSnaps[activeSnaps.length - 1] ?? null,
      hasMore,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'assyRecords');
  }
}

/**
 * Fetches total document count in `assyRecords` from server without downloading all documents.
 */
export async function fetchAssyTotalCount(): Promise<number> {
  try {
    const snap = await getCountFromServer(collection(db, 'assyRecords'));
    return snap.data().count;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'assyRecords');
  }
}

/**
 * On-demand full fetch of all active `assyRecords` ONLY for bulk operations
 * (Refresh UMH, Batch Export ZIP, Daily Summary PDF, Backup JSON, or cross-page search).
 */
export async function fetchAllAssyRecordsFromCloud(
  stdDb?: StdDatabase,
  autoCutList?: AutoCutItem[],
  feederList?: FeederItem[]
): Promise<AssyRecord[]> {
  const recalcContext =
    stdDb && autoCutList && feederList ? { stdDb, autoCutList, feederList } : undefined;
  try {
    const q = query(collection(db, 'assyRecords'), orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    const list: AssyRecord[] = [];
    snap.docs.forEach((docSnap) => {
      const rec = hydrateAssyRecordFromDoc(
        docSnap.id,
        docSnap.data() as Record<string, unknown>,
        recalcContext
      );
      if (!rec.params?._recycleBinMeta) {
        list.push(rec);
      }
    });
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'assyRecords');
  }
}

/**
 * Checks Firestore server-side whether an Assy with the same `assyNo` already exists
 * across the entire shared database (not just the currently visible 33-row page).
 */
export async function findDuplicateAssyInCloud(
  assyNo: string,
  excludeId?: string
): Promise<DuplicateAssyMatch | null> {
  const trimmed = assyNo.trim();
  const norm = normalizeAssyNo(trimmed);
  if (!norm) return null;

  try {
    const [byNormSnap, byExactSnap] = await Promise.all([
      getDocs(query(collection(db, 'assyRecords'), where('assyNoNormalized', '==', norm), limit(5))),
      getDocs(query(collection(db, 'assyRecords'), where('assyNo', '==', trimmed), limit(5))),
    ]);

    const seen = new Set<string>();
    const combinedDocs = [...byNormSnap.docs, ...byExactSnap.docs];
    for (const docSnap of combinedDocs) {
      if (seen.has(docSnap.id)) continue;
      seen.add(docSnap.id);

      const d = docSnap.data() as Record<string, unknown>;
      const recId = String(d.id || docSnap.id);
      if (excludeId && (recId === excludeId || docSnap.id === excludeId)) continue;

      const params = d.params as AssyRecord['params'] | undefined;
      if (params?._recycleBinMeta) continue;

      const foundAssyNo = String(d.assyNo || params?.assyNo || '').trim();
      if (normalizeAssyNo(foundAssyNo) !== norm) continue;

      return {
        id: recId,
        assyNo: foundAssyNo,
        customer: String(d.customer || params?.customer || ''),
        createdByName: typeof d.createdByName === 'string' ? d.createdByName : undefined,
        updatedAt: tsToIso(d.updatedAt),
      };
    }

    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'assyRecords');
  }
}

export async function upsertAssyRecordInCloud(
  actor: CloudActor,
  record: AssyRecord
): Promise<AssyRecord> {
  const docId = toSharedDocId(record.id, 'assy');
  const path = `assyRecords/${docId}`;
  const ref = doc(db, 'assyRecords', docId);

  let existsInCloud = false;
  try {
    const existingSnap = await getDoc(ref);
    existsInCloud = existingSnap.exists();
    const existingData = existsInCloud
      ? (existingSnap.data() as Record<string, unknown>)
      : undefined;

    const fields = buildAssyPayloadFields(actor, record, docId, existingData);

    if (existsInCloud) {
      const updateBody: Record<string, unknown> = {
        assyNo: fields.assyNo,
        assyNoNormalized: fields.assyNoNormalized,
        customer: fields.customer,
        params: fields.params,
        assemblyComponents: fields.assemblyComponents,
        partList: fields.partList,
        ppcsList: fields.ppcsList,
        assemblyCotList: fields.assemblyCotList,
        terminalRatios: fields.terminalRatios,
        calculation: fields.calculation,
        updatedByUid: fields.updatedByUid,
        updatedByName: fields.updatedByName,
        ...(fields.updatedByEmail ? { updatedByEmail: fields.updatedByEmail } : {}),
        updatedAt: serverTimestamp(),
      };
      // Backfill createdBy* only if the legacy document does not have it yet
      if (!existingData?.createdByUid && fields.createdByUid) {
        updateBody.createdByUid = fields.createdByUid;
        updateBody.createdByName = fields.createdByName;
        if (fields.createdByEmail) updateBody.createdByEmail = fields.createdByEmail;
      }
      await updateDoc(ref, updateBody);
    } else {
      await setDoc(ref, {
        ...fields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    return {
      ...record,
      id: docId,
      createdByUid: String(fields.createdByUid || actor.uid),
      createdByName: String(fields.createdByName || actor.name),
      createdByEmail: fields.createdByEmail ? String(fields.createdByEmail) : undefined,
      updatedByUid: String(fields.updatedByUid || actor.uid),
      updatedByName: String(fields.updatedByName || actor.name),
      updatedByEmail: fields.updatedByEmail ? String(fields.updatedByEmail) : undefined,
    };
  } catch (error) {
    handleFirestoreError(
      error,
      existsInCloud ? OperationType.UPDATE : OperationType.CREATE,
      path
    );
  }
}

export async function batchUpdateAssyRecordsInCloud(
  actor: CloudActor,
  records: AssyRecord[]
): Promise<void> {
  if (records.length === 0) return;
  const path = 'assyRecords';
  try {
    // Check existence per docId in parallel chunks
    const docIds = records.map((r) => toSharedDocId(r.id, 'assy'));
    const existingMap = new Map<string, Record<string, unknown>>();
    await Promise.all(
      docIds.map(async (id) => {
        const snap = await getDoc(doc(db, 'assyRecords', id));
        if (snap.exists()) {
          existingMap.set(id, snap.data() as Record<string, unknown>);
        }
      })
    );

    const CHUNK = 200;
    for (let i = 0; i < records.length; i += CHUNK) {
      const slice = records.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      slice.forEach((rec) => {
        const docId = toSharedDocId(rec.id, 'assy');
        const ref = doc(db, 'assyRecords', docId);
        const existingData = existingMap.get(docId);
        const fields = buildAssyPayloadFields(actor, rec, docId, existingData);
        if (existingData) {
          const updateBody: Record<string, unknown> = {
            assyNo: fields.assyNo,
            assyNoNormalized: fields.assyNoNormalized,
            customer: fields.customer,
            params: fields.params,
            assemblyComponents: fields.assemblyComponents,
            partList: fields.partList,
            ppcsList: fields.ppcsList,
            assemblyCotList: fields.assemblyCotList,
            terminalRatios: fields.terminalRatios,
            calculation: fields.calculation,
            updatedByUid: fields.updatedByUid,
            updatedByName: fields.updatedByName,
            ...(fields.updatedByEmail ? { updatedByEmail: fields.updatedByEmail } : {}),
            updatedAt: serverTimestamp(),
          };
          if (!existingData.createdByUid && fields.createdByUid) {
            updateBody.createdByUid = fields.createdByUid;
            updateBody.createdByName = fields.createdByName;
            if (fields.createdByEmail) updateBody.createdByEmail = fields.createdByEmail;
          }
          batch.update(ref, updateBody);
        } else {
          batch.set(ref, {
            ...fields,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function moveAssyRecordToRecycleBinInCloud(
  actor: CloudActor,
  record: AssyRecord,
  binItem: RecycleBinItem,
  useDedicatedRecycleBin = true
): Promise<string> {
  const assyDocId = toSharedDocId(record.id, 'assy');
  const binDocId = toSharedDocId(binItem.id, 'bin_assy');

  if (!useDedicatedRecycleBin) {
    const assyPath = `assyRecords/${assyDocId}`;
    try {
      const { _recycleBinMeta: _omit, ...cleanParams } = record.params;
      await updateDoc(doc(db, 'assyRecords', assyDocId), {
        params: cleanForFirestore({
          ...cleanParams,
          _recycleBinMeta: {
            binId: `inplace_${assyDocId}`,
            deletedAt: binItem.deletedAt,
          },
        }),
        updatedByUid: actor.uid,
        updatedByName: actor.name,
        updatedAt: serverTimestamp(),
      });
      return `inplace_${assyDocId}`;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, assyPath);
    }
  }

  const path = `recycleBin/${binDocId}`;
  try {
    const existingSnap = await getDoc(doc(db, 'assyRecords', assyDocId));
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'recycleBin', binDocId),
      buildRecycleBinFirestoreDoc(actor.uid, { ...binItem, originalId: assyDocId }, binDocId)
    );
    if (existingSnap.exists()) {
      batch.delete(doc(db, 'assyRecords', assyDocId));
    }
    await batch.commit();
    return binDocId;
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      return moveAssyRecordToRecycleBinInCloud(actor, record, binItem, false);
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function restoreInPlaceAssyInCloud(
  actor: CloudActor,
  record: AssyRecord
): Promise<void> {
  const assyDocId = toSharedDocId(record.id, 'assy');
  const path = `assyRecords/${assyDocId}`;
  try {
    const { _recycleBinMeta: _omit, ...cleanParams } = record.params;
    await updateDoc(doc(db, 'assyRecords', assyDocId), {
      params: cleanForFirestore(cleanParams),
      updatedByUid: actor.uid,
      updatedByName: actor.name,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function permanentlyDeleteInPlaceAssyInCloud(originalId: string): Promise<void> {
  const assyDocId = toSharedDocId(originalId, 'assy');
  const path = `assyRecords/${assyDocId}`;
  try {
    const existingSnap = await getDoc(doc(db, 'assyRecords', assyDocId));
    if (existingSnap.exists()) {
      await deleteDoc(doc(db, 'assyRecords', assyDocId));
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
  onData: (entries: RefreshHistoryEntry[]) => void,
  onError: (err: Error) => void,
  onMasterHistory?: (entries: MasterChangeHistoryEntry[]) => void
) {
  const path = 'refreshHistory';
  const q = query(collection(db, 'refreshHistory'));
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
  const docId = toSharedDocId(entry.id, 'hist');
  const path = `refreshHistory/${docId}`;
  try {
    await setDoc(doc(db, 'refreshHistory', docId), {
      id: docId,
      ownerId: uid,
      refreshedAt: serverTimestamp(),
      responsibleName: (entry.responsibleName || 'PIC').slice(0, 120),
      totalSelectedCount: Math.max(0, Math.min(1000, entry.totalSelectedCount)),
      affectedAssyCount: Math.max(0, Math.min(1000, entry.affectedAssyCount)),
      unaffectedAssyCount: Math.max(0, Math.min(1000, entry.unaffectedAssyCount)),
      affectedDiffs: cleanForFirestore(entry.affectedDiffs.slice(0, 500)),
      createdAt: serverTimestamp(),
    });
    return { ...entry, id: docId };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function createMasterChangeHistoryInCloud(
  uid: string,
  entry: MasterChangeHistoryEntry
): Promise<MasterChangeHistoryEntry> {
  const docId = toSharedDocId(entry.id, 'mhist');
  const path = `refreshHistory/${docId}`;
  const totalChanged = entry.addedCount + entry.modifiedCount + entry.removedCount;
  const clampedTotal = Math.max(0, Math.min(1000, entry.totalItemsCount));
  const clampedChanged = Math.max(0, Math.min(1000, totalChanged));
  const clampedUnchanged = Math.max(0, Math.min(1000, Math.max(0, clampedTotal - clampedChanged)));

  try {
    await setDoc(doc(db, 'refreshHistory', docId), {
      id: docId,
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
    return { ...entry, id: docId };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteMasterChangeHistoryInCloud(entryId: string): Promise<void> {
  const docId = toSharedDocId(entryId, 'mhist');
  const path = `refreshHistory/${docId}`;
  try {
    const snap = await getDoc(doc(db, 'refreshHistory', docId));
    if (snap.exists()) {
      await deleteDoc(doc(db, 'refreshHistory', docId));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function clearMasterChangeHistoryInCloud(entryIds: string[]): Promise<void> {
  if (entryIds.length === 0) return;
  const path = 'refreshHistory';
  try {
    const uniqueIds = Array.from(new Set(entryIds.map((id) => toSharedDocId(id, 'mhist'))));
    const CHUNK = 200;
    for (let i = 0; i < uniqueIds.length; i += CHUNK) {
      const batch = writeBatch(db);
      uniqueIds.slice(i, i + CHUNK).forEach((docId) => {
        batch.delete(doc(db, 'refreshHistory', docId));
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function moveRefreshHistoryToRecycleBinInCloud(
  uid: string,
  entry: RefreshHistoryEntry,
  binItem: RecycleBinItem,
  useDedicatedRecycleBin = true
): Promise<string> {
  const histDocId = toSharedDocId(entry.id, 'hist');
  const binDocId = toSharedDocId(binItem.id, 'bin_hist');
  const path = useDedicatedRecycleBin ? `recycleBin/${binDocId}` : `refreshHistory/${histDocId}`;
  try {
    const snap = await getDoc(doc(db, 'refreshHistory', histDocId));
    if (!useDedicatedRecycleBin) {
      if (snap.exists()) {
        await deleteDoc(doc(db, 'refreshHistory', histDocId));
      }
      return binDocId;
    }

    const batch = writeBatch(db);
    batch.set(
      doc(db, 'recycleBin', binDocId),
      buildRecycleBinFirestoreDoc(uid, { ...binItem, originalId: histDocId }, binDocId)
    );
    if (snap.exists()) {
      batch.delete(doc(db, 'refreshHistory', histDocId));
    }
    await batch.commit();
    return binDocId;
  } catch (error) {
    if (useDedicatedRecycleBin && isPermissionDeniedError(error)) {
      return moveRefreshHistoryToRecycleBinInCloud(uid, entry, binItem, false);
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function moveManyRefreshHistoryToRecycleBinInCloud(
  uid: string,
  pairs: { entry: RefreshHistoryEntry; binItem: RecycleBinItem }[],
  useDedicatedRecycleBin = true
): Promise<void> {
  if (pairs.length === 0) return;
  const path = useDedicatedRecycleBin ? 'recycleBin' : 'refreshHistory';
  try {
    const CHUNK = 200;
    for (let i = 0; i < pairs.length; i += CHUNK) {
      const slice = pairs.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      slice.forEach(({ entry, binItem }) => {
        const histDocId = toSharedDocId(entry.id, 'hist');
        const binDocId = toSharedDocId(binItem.id, 'bin_hist');
        if (useDedicatedRecycleBin) {
          batch.set(
            doc(db, 'recycleBin', binDocId),
            buildRecycleBinFirestoreDoc(uid, { ...binItem, originalId: histDocId }, binDocId)
          );
        }
        batch.delete(doc(db, 'refreshHistory', histDocId));
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

export async function addMasterItemToRecycleBinInCloud(
  uid: string,
  binItem: RecycleBinItem
): Promise<string> {
  const binDocId = toSharedDocId(binItem.id, 'bin');
  const path = `recycleBin/${binDocId}`;
  try {
    await setDoc(
      doc(db, 'recycleBin', binDocId),
      buildRecycleBinFirestoreDoc(uid, binItem, binDocId)
    );
    return binDocId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeRecycleBin(
  onData: (items: RecycleBinItem[]) => void,
  onError: (err: Error) => void
) {
  const path = 'recycleBin';
  const q = query(collection(db, 'recycleBin'));
  const validTypes = new Set<string>([
    'assy_record',
    'refresh_history',
    'auto_cut_item',
    'feeder_item',
  ]);
  return onSnapshot(
    q,
    (snap) => {
      const items: RecycleBinItem[] = snap.docs
        .map((docSnap) => {
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
        })
        .filter((item) => validTypes.has(item.itemType));
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

export async function restoreAssyFromRecycleBinInCloud(
  actor: CloudActor,
  binItem: RecycleBinItem,
  restoredRecord: AssyRecord
): Promise<AssyRecord> {
  const binDocId = toSharedDocId(binItem.id, 'bin_assy');
  const path = `recycleBin/${binDocId}`;
  try {
    let targetAssyId = toSharedDocId(binItem.originalId || restoredRecord.id, 'assy');
    const [existingAssySnap, existingBinSnap] = await Promise.all([
      getDoc(doc(db, 'assyRecords', targetAssyId)),
      getDoc(doc(db, 'recycleBin', binDocId)),
    ]);

    if (existingAssySnap.exists()) {
      targetAssyId = `restored_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    }

    const fields = buildAssyPayloadFields(
      actor,
      { ...restoredRecord, id: targetAssyId },
      targetAssyId
    );
    const batch = writeBatch(db);
    batch.set(doc(db, 'assyRecords', targetAssyId), {
      ...fields,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (existingBinSnap.exists()) {
      batch.delete(doc(db, 'recycleBin', binDocId));
    }
    await batch.commit();
    return {
      ...restoredRecord,
      id: targetAssyId,
      createdByUid: String(fields.createdByUid || actor.uid),
      createdByName: String(fields.createdByName || actor.name),
      updatedByUid: actor.uid,
      updatedByName: actor.name,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function restoreHistoryFromRecycleBinInCloud(
  uid: string,
  binItem: RecycleBinItem,
  restoredEntry: RefreshHistoryEntry
): Promise<RefreshHistoryEntry> {
  const binDocId = toSharedDocId(binItem.id, 'bin_hist');
  const path = `recycleBin/${binDocId}`;
  try {
    let targetHistId = toSharedDocId(binItem.originalId || restoredEntry.id, 'hist');
    const [existingHistSnap, existingBinSnap] = await Promise.all([
      getDoc(doc(db, 'refreshHistory', targetHistId)),
      getDoc(doc(db, 'recycleBin', binDocId)),
    ]);

    if (existingHistSnap.exists()) {
      targetHistId = `restored_hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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
    if (existingBinSnap.exists()) {
      batch.delete(doc(db, 'recycleBin', binDocId));
    }
    await batch.commit();
    return { ...restoredEntry, id: targetHistId };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function permanentlyDeleteRecycleBinItemFromCloud(binId: string): Promise<void> {
  const binDocId = toSharedDocId(binId, 'bin');
  const path = `recycleBin/${binDocId}`;
  try {
    const snap = await getDoc(doc(db, 'recycleBin', binDocId));
    if (snap.exists()) {
      await deleteDoc(doc(db, 'recycleBin', binDocId));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function emptyRecycleBinInCloud(binIds: string[]): Promise<void> {
  if (binIds.length === 0) return;
  const path = 'recycleBin';
  try {
    const uniqueIds = Array.from(new Set(binIds.map((id) => toSharedDocId(id, 'bin'))));
    const CHUNK = 400;
    for (let i = 0; i < uniqueIds.length; i += CHUNK) {
      const slice = uniqueIds.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      slice.forEach((docId) => {
        batch.delete(doc(db, 'recycleBin', docId));
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function replaceAllAssyRecordsInCloud(
  actor: CloudActor,
  existingRecords: AssyRecord[],
  newRecords: AssyRecord[],
  useDedicatedRecycleBin = true
): Promise<AssyRecord[]> {
  const path = 'assyRecords';
  try {
    const existingSnap = await getDocs(collection(db, 'assyRecords'));
    const cloudExistingMap = new Map<string, { raw: Record<string, unknown>; rec: AssyRecord }>();
    existingSnap.forEach((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      cloudExistingMap.set(docSnap.id, {
        raw: d,
        rec: hydrateAssyRecordFromDoc(docSnap.id, d),
      });
    });

    const batch = writeBatch(db);
    const newDocIds = new Set<string>();
    const resultRecords: AssyRecord[] = [];

    newRecords.forEach((rec) => {
      const docId = toSharedDocId(rec.id, 'assy');
      newDocIds.add(docId);
      const { _recycleBinMeta: _omit, ...cleanParams } = rec.params;
      const cleanRec = { ...rec, params: cleanParams };
      const existingEntry = cloudExistingMap.get(docId);
      const fields = buildAssyPayloadFields(actor, cleanRec, docId, existingEntry?.raw);
      const ref = doc(db, 'assyRecords', docId);
      if (existingEntry) {
        const updateBody: Record<string, unknown> = {
          assyNo: fields.assyNo,
          assyNoNormalized: fields.assyNoNormalized,
          customer: fields.customer,
          params: fields.params,
          assemblyComponents: fields.assemblyComponents,
          partList: fields.partList,
          ppcsList: fields.ppcsList,
          assemblyCotList: fields.assemblyCotList,
          terminalRatios: fields.terminalRatios,
          calculation: fields.calculation,
          updatedByUid: fields.updatedByUid,
          updatedByName: fields.updatedByName,
          ...(fields.updatedByEmail ? { updatedByEmail: fields.updatedByEmail } : {}),
          updatedAt: serverTimestamp(),
        };
        if (!existingEntry.raw.createdByUid && fields.createdByUid) {
          updateBody.createdByUid = fields.createdByUid;
          updateBody.createdByName = fields.createdByName;
          if (fields.createdByEmail) updateBody.createdByEmail = fields.createdByEmail;
        }
        batch.update(ref, updateBody);
      } else {
        batch.set(ref, {
          ...fields,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      resultRecords.push({
        ...cleanRec,
        id: docId,
        createdByUid: String(fields.createdByUid || actor.uid),
        createdByName: String(fields.createdByName || actor.name),
        updatedByUid: actor.uid,
        updatedByName: actor.name,
      });
    });

    const localMap = new Map(existingRecords.map((r) => [toSharedDocId(r.id, 'assy'), r]));
    cloudExistingMap.forEach(({ rec: cloudRec }, docId) => {
      if (cloudRec.params?._recycleBinMeta) return;
      if (!newDocIds.has(docId)) {
        const snapshotRec = localMap.get(docId) ?? cloudRec;
        const binItem = buildRecycleBinItemFromAssy(snapshotRec);
        if (useDedicatedRecycleBin) {
          const binDocId = toSharedDocId(binItem.id, 'bin_assy');
          batch.set(
            doc(db, 'recycleBin', binDocId),
            buildRecycleBinFirestoreDoc(actor.uid, { ...binItem, originalId: docId }, binDocId)
          );
          batch.delete(doc(db, 'assyRecords', docId));
        } else {
          batch.update(doc(db, 'assyRecords', docId), {
            params: cleanForFirestore({
              ...snapshotRec.params,
              _recycleBinMeta: {
                binId: `inplace_${docId}`,
                deletedAt: binItem.deletedAt,
              },
            }),
            updatedByUid: actor.uid,
            updatedByName: actor.name,
            updatedAt: serverTimestamp(),
          });
        }
      }
    });

    await batch.commit();
    return resultRecords;
  } catch (error) {
    if (useDedicatedRecycleBin && isPermissionDeniedError(error)) {
      return replaceAllAssyRecordsInCloud(actor, existingRecords, newRecords, false);
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
