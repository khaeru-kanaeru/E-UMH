import { useEffect, useRef, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  Cloud,
  CloudOff,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  Home,
  LogIn,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Sliders,
  Trash2,
  X,
} from 'lucide-react';
import { AssyDetailModal } from './components/AssyDetailModal';
import { AutoCutFeederView } from './components/AutoCutFeederView';
import { DatabaseAssyView } from './components/DatabaseAssyView';
import { HomeView } from './components/HomeView';
import { InputWizardModal } from './components/InputWizardModal';
import { MasterChangeHistoryModal } from './components/MasterChangeHistoryModal';
import { PdfReportModal } from './components/PdfReportModal';
import { RecycleBinView } from './components/RecycleBinView';
import { RefreshHistoryModal } from './components/RefreshHistoryModal';
import { RefreshHistoryPdfModal } from './components/RefreshHistoryPdfModal';
import { RefreshUmhModal } from './components/RefreshUmhModal';
import { StdParamsView } from './components/StdParamsView';
import { DEFAULT_PROCESS_DISCS } from './data/defaultProcessDiscs';
import { DEFAULT_STD_DATABASE } from './data/defaultStdDb';
import { calculateUmh } from './engine/umhCalculator';
import { FIRESTORE_DATABASE_ID, auth, googleProvider } from './firebase';
import {
  FIRESTORE_RULES_SOURCE,
  addMasterItemToRecycleBinInCloud,
  batchUpdateAssyRecordsInCloud,
  buildRecycleBinItemFromAssy,
  buildRecycleBinItemFromAutoCut,
  buildRecycleBinItemFromDisc,
  buildRecycleBinItemFromFeeder,
  buildRecycleBinItemFromHistory,
  clearMasterChangeHistoryInCloud,
  createMasterChangeHistoryInCloud,
  createRefreshHistoryInCloud,
  deleteMasterChangeHistoryInCloud,
  emptyRecycleBinInCloud,
  initializeCloudWorkspace,
  isRecycleBinPermissionError,
  moveAssyRecordToRecycleBinInCloud,
  moveManyRefreshHistoryToRecycleBinInCloud,
  moveRefreshHistoryToRecycleBinInCloud,
  permanentlyDeleteInPlaceAssyInCloud,
  permanentlyDeleteRecycleBinItemFromCloud,
  replaceAllAssyRecordsInCloud,
  restoreAssyFromRecycleBinInCloud,
  restoreHistoryFromRecycleBinInCloud,
  restoreInPlaceAssyInCloud,
  saveMasterConfigToCloud,
  subscribeAssyRecords,
  subscribeMasterConfig,
  subscribeRecycleBin,
  subscribeRefreshHistory,
  subscribeUserProfile,
  toScopedDocId,
  updateUserPreferencesInCloud,
  upsertAssyRecordInCloud,
} from './services/firestoreService';
import {
  AllowanceMode,
  AssyInputPayload,
  AssyRecord,
  AutoCutItem,
  FeederItem,
  MasterChangeCategory,
  MasterChangeHistoryEntry,
  NavTab,
  ProcessLogicDisc,
  RecycleBinItem,
  RefreshHistoryEntry,
  StdDatabase,
  UiLang,
} from './types/umh';
import {
  loadAssyRecords,
  loadAutoCutList,
  loadFeederList,
  loadLastPicName,
  loadMasterChangeHistory,
  loadPendingMasterSync,
  loadRecycleBin,
  loadRefreshHistory,
  loadStdDatabase,
  saveAssyPayloads,
  saveAutoCutList,
  saveFeederList,
  saveLastPicName,
  saveMasterChangeHistory,
  savePendingMasterSync,
  saveRecycleBin,
  saveRefreshHistory,
  saveStdDatabase,
} from './utils/storage';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [stdDb, setStdDb] = useState<StdDatabase>(() => loadStdDatabase());
  const [autoCutList, setAutoCutList] = useState<AutoCutItem[]>(() => loadAutoCutList());
  const [feederList, setFeederList] = useState<FeederItem[]>(() => loadFeederList());
  const [records, setRecords] = useState<AssyRecord[]>(() =>
    loadAssyRecords(loadStdDatabase(), loadAutoCutList(), loadFeederList())
  );

  const [hasPendingMasterChanges, setHasPendingMasterChanges] = useState<boolean>(() =>
    loadPendingMasterSync()
  );
  const [refreshHistory, setRefreshHistory] = useState<RefreshHistoryEntry[]>(() =>
    loadRefreshHistory()
  );
  const [masterChangeHistory, setMasterChangeHistory] = useState<MasterChangeHistoryEntry[]>(() =>
    loadMasterChangeHistory()
  );
  const [recycleBin, setRecycleBin] = useState<RecycleBinItem[]>(() => loadRecycleBin());

  // Firebase Auth & Sync state
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudNotice, setCloudNotice] = useState<string | null>(null);
  const [recycleBinNeedsRulesPublish, setRecycleBinNeedsRulesPublish] = useState(false);
  const [copiedRulesBanner, setCopiedRulesBanner] = useState(false);
  const [cloudRetryNonce, setCloudRetryNonce] = useState(0);
  const [dismissLoginHint, setDismissLoginHint] = useState(false);
  const [fatalCloudError, setFatalCloudError] = useState<Error | null>(null);

  if (fatalCloudError) {
    throw fatalCloudError;
  }

  // Modals
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingPayload, setEditingPayload] = useState<AssyInputPayload | null>(null);
  const [detailRecord, setDetailRecord] = useState<AssyRecord | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{
    record: AssyRecord;
    mode: AllowanceMode;
    lang: UiLang;
  } | null>(null);
  const [refreshModalOpen, setRefreshModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [masterHistoryModal, setMasterHistoryModal] = useState<{
    open: boolean;
    category: 'all' | MasterChangeCategory;
  }>({ open: false, category: 'all' });
  const [pdfHistoryEntry, setPdfHistoryEntry] = useState<RefreshHistoryEntry | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

  // Latest local state snapshot ref for synchronous master sync & initial cloud seeding
  const localSnapshotRef = useRef({
    stdDb,
    autoCutList,
    feederList,
    records,
    refreshHistory,
    recycleBin,
    hasPendingMasterChanges,
  });
  localSnapshotRef.current = {
    stdDb,
    autoCutList,
    feederList,
    records,
    refreshHistory,
    recycleBin,
    hasPendingMasterChanges,
  };

  const handleCopyFirestoreRules = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(FIRESTORE_RULES_SOURCE);
      return true;
    } catch {
      return false;
    }
  };

  const handleCloudMutationError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (isRecycleBinPermissionError(err)) {
      setRecycleBinNeedsRulesPublish(true);
      return;
    }
    if (msg.includes('Quota exceeded')) {
      setCloudNotice(
        'Kuota harian gratis Firestore tercapai (reset besok). Anda tetap dapat bekerja dengan cache lokal.'
      );
      return;
    }
    setFatalCloudError(err instanceof Error ? err : new Error(msg));
  };

  // Auth listener
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
      if (!user) {
        setCloudReady(false);
      }
    });
    return () => unsubAuth();
  }, []);

  // Firestore realtime subscriptions (only when authReady && verified user)
  useEffect(() => {
    if (!authReady || !authUser || !authUser.emailVerified) {
      return;
    }

    let cancelled = false;
    const unsubs: (() => void)[] = [];

    const setupCloud = async () => {
      try {
        const snap = localSnapshotRef.current;
        const { recycleBinCloudAvailable } = await initializeCloudWorkspace(authUser, {
          stdDb: snap.stdDb,
          autoCutList: snap.autoCutList,
          feederList: snap.feederList,
          records: snap.records,
          refreshHistory: snap.refreshHistory,
          recycleBin: snap.recycleBin,
          lastPicName: loadLastPicName(),
          pendingMasterSync: snap.hasPendingMasterChanges,
        });

        if (cancelled) return;

        setRecycleBinNeedsRulesPublish(!recycleBinCloudAvailable);

        unsubs.push(
          subscribeUserProfile(
            authUser.uid,
            (profile) => {
              if (!profile) return;
              setHasPendingMasterChanges(profile.pendingMasterSync);
              savePendingMasterSync(profile.pendingMasterSync);
              if (profile.lastPicName) {
                saveLastPicName(profile.lastPicName);
              }
            },
            handleCloudMutationError
          )
        );

        unsubs.push(
          subscribeMasterConfig(
            authUser.uid,
            {
              ...DEFAULT_STD_DATABASE,
              processDiscs: structuredClone(DEFAULT_PROCESS_DISCS),
            },
            (cfg) => {
              if (!cfg) return;
              localSnapshotRef.current.stdDb = cfg.stdDb;
              localSnapshotRef.current.autoCutList = cfg.autoCutList;
              localSnapshotRef.current.feederList = cfg.feederList;
              setStdDb(cfg.stdDb);
              saveStdDatabase(cfg.stdDb);
              setAutoCutList(cfg.autoCutList);
              saveAutoCutList(cfg.autoCutList);
              setFeederList(cfg.feederList);
              saveFeederList(cfg.feederList);
            },
            handleCloudMutationError
          )
        );

        unsubs.push(
          subscribeAssyRecords(
            authUser.uid,
            (cloudRecords) => {
              const snapNow = localSnapshotRef.current;
              const normalized = cloudRecords.map((rec) => {
                const needsRecompute =
                  !rec.calculation ||
                  !rec.calculation.smv ||
                  !Array.isArray(rec.calculation.processes) ||
                  rec.calculation.processes.length === 0;
                return needsRecompute
                  ? {
                      ...rec,
                      calculation: calculateUmh(
                        rec,
                        snapNow.stdDb,
                        snapNow.autoCutList,
                        snapNow.feederList
                      ),
                    }
                  : rec;
              });

              const activeOnly = normalized.filter((rec) => !rec.params?._recycleBinMeta);
              const trashedAssys = normalized.filter((rec) => Boolean(rec.params?._recycleBinMeta));

              setRecords(activeOnly);
              saveAssyPayloads(activeOnly);

              const inPlaceBinItems: RecycleBinItem[] = trashedAssys.map((rec) => {
                const meta = rec.params._recycleBinMeta!;
                const { _recycleBinMeta: _omit, ...cleanParams } = rec.params;
                const cleanRec: AssyRecord = { ...rec, params: cleanParams };
                const baseBin = buildRecycleBinItemFromAssy(cleanRec);
                return {
                  ...baseBin,
                  id: meta.binId || `inplace_${rec.id}`,
                  originalId: rec.id,
                  deletedAt: meta.deletedAt || rec.updatedAt,
                };
              });

              setRecycleBin((prev) => {
                const withoutOldInPlace = prev.filter((b) => !b.id.startsWith('inplace_'));
                const merged = [...inPlaceBinItems, ...withoutOldInPlace].sort((a, b) =>
                  b.deletedAt.localeCompare(a.deletedAt)
                );
                saveRecycleBin(merged);
                return merged;
              });
            },
            handleCloudMutationError
          )
        );

        unsubs.push(
          subscribeRefreshHistory(
            authUser.uid,
            (cloudHistory) => {
              setRefreshHistory(cloudHistory);
              saveRefreshHistory(cloudHistory);
            },
            handleCloudMutationError,
            (cloudMasterHist) => {
              setMasterChangeHistory(cloudMasterHist);
              saveMasterChangeHistory(cloudMasterHist);
            }
          )
        );

        if (recycleBinCloudAvailable) {
          unsubs.push(
            subscribeRecycleBin(
              authUser.uid,
              (cloudBinItems) => {
                setRecycleBin((prev) => {
                  const inPlaceOnly = prev.filter((b) => b.id.startsWith('inplace_'));
                  const merged = [...cloudBinItems, ...inPlaceOnly].sort((a, b) =>
                    b.deletedAt.localeCompare(a.deletedAt)
                  );
                  saveRecycleBin(merged);
                  return merged;
                });
              },
              handleCloudMutationError
            )
          );
        }

        setCloudReady(true);
        setCloudNotice(null);
      } catch (err) {
        if (!cancelled) {
          handleCloudMutationError(err);
        }
      }
    };

    void setupCloud();

    return () => {
      cancelled = true;
      unsubs.forEach((fn) => fn());
    };
  }, [authReady, authUser, cloudRetryNonce]);

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    setCloudNotice(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('popup-closed-by-user')) {
        setCloudNotice(`Gagal masuk Google: ${msg}`);
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleSignOut = async () => {
    setAuthBusy(true);
    try {
      await signOut(auth);
      setCloudReady(false);
      setCloudNotice(null);
    } finally {
      setAuthBusy(false);
    }
  };

  const isCloudActive = Boolean(authUser && authUser.emailVerified && cloudReady);
  const masterCloudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (masterCloudTimerRef.current) {
        clearTimeout(masterCloudTimerRef.current);
      }
    };
  }, []);

  const syncMasterToCloud = (immediate: boolean) => {
    if (!isCloudActive || !authUser) return;
    if (masterCloudTimerRef.current) {
      clearTimeout(masterCloudTimerRef.current);
      masterCloudTimerRef.current = null;
    }
    const uid = authUser.uid;
    const flush = () => {
      const snap = localSnapshotRef.current;
      void saveMasterConfigToCloud(
        uid,
        snap.stdDb,
        snap.autoCutList,
        snap.feederList
      ).catch(handleCloudMutationError);
    };
    if (immediate) {
      flush();
    } else {
      masterCloudTimerRef.current = setTimeout(() => {
        masterCloudTimerRef.current = null;
        flush();
      }, 350);
    }
  };

  const markMasterChanged = () => {
    setHasPendingMasterChanges(true);
    localSnapshotRef.current.hasPendingMasterChanges = true;
    savePendingMasterSync(true);
    if (isCloudActive && authUser) {
      void updateUserPreferencesInCloud(authUser.uid, { pendingMasterSync: true }).catch(
        handleCloudMutationError
      );
    }
  };

  const handleSaveStdDb = (nextDb: StdDatabase) => {
    localSnapshotRef.current.stdDb = nextDb;
    setStdDb(nextDb);
    saveStdDatabase(nextDb);
    markMasterChanged();
    syncMasterToCloud(true);
  };

  const handleUpdateAutoCut = (nextList: AutoCutItem[], immediate = true) => {
    localSnapshotRef.current.autoCutList = nextList;
    setAutoCutList(nextList);
    saveAutoCutList(nextList);
    markMasterChanged();
    syncMasterToCloud(immediate);
  };

  const handleUpdateFeeder = (nextList: FeederItem[], immediate = true) => {
    localSnapshotRef.current.feederList = nextList;
    setFeederList(nextList);
    saveFeederList(nextList);
    markMasterChanged();
    syncMasterToCloud(immediate);
  };

  const recordMasterHistoryEntries = (entries: MasterChangeHistoryEntry[]) => {
    if (entries.length === 0) return;
    setMasterChangeHistory((prev) => {
      const next = [...entries, ...prev];
      saveMasterChangeHistory(next);
      return next;
    });
    const pic = entries[0]?.responsibleName;
    if (pic) {
      saveLastPicName(pic);
    }
    if (isCloudActive && authUser) {
      const uid = authUser.uid;
      entries.forEach((entry) => {
        void createMasterChangeHistoryInCloud(uid, entry).catch(handleCloudMutationError);
      });
      if (pic) {
        void updateUserPreferencesInCloud(uid, { lastPicName: pic }).catch(
          handleCloudMutationError
        );
      }
    }
  };

  const handleCommitStdBulkEdit = (
    nextDb: StdDatabase,
    entries: MasterChangeHistoryEntry[]
  ) => {
    handleSaveStdDb(nextDb);
    recordMasterHistoryEntries(entries);
  };

  const handleDeleteMasterHistoryEntry = (id: string) => {
    setMasterChangeHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveMasterChangeHistory(next);
      return next;
    });
    if (isCloudActive && authUser) {
      void deleteMasterChangeHistoryInCloud(authUser.uid, id).catch(handleCloudMutationError);
    }
  };

  const handleClearMasterHistory = () => {
    if (masterChangeHistory.length === 0) return;
    const ids = masterChangeHistory.map((e) => e.id);
    setMasterChangeHistory([]);
    saveMasterChangeHistory([]);
    if (isCloudActive && authUser) {
      void clearMasterChangeHistoryInCloud(authUser.uid, ids).catch(handleCloudMutationError);
    }
  };

  const handleCompleteRefresh = (
    updatedMap: Map<string, AssyRecord>,
    historyEntry: RefreshHistoryEntry
  ) => {
    const updatedList = Array.from(updatedMap.values());
    if (updatedMap.size > 0) {
      setRecords((prev) => {
        const next = prev.map((rec) => updatedMap.get(rec.id) ?? rec);
        saveAssyPayloads(next);
        return next;
      });
    }

    setRefreshHistory((prev) => {
      const next = [historyEntry, ...prev];
      saveRefreshHistory(next);
      return next;
    });

    saveLastPicName(historyEntry.responsibleName);

    const shouldClearPending =
      updatedMap.size > 0 || historyEntry.totalSelectedCount >= records.length;
    if (shouldClearPending) {
      setHasPendingMasterChanges(false);
      savePendingMasterSync(false);
    }

    if (isCloudActive && authUser) {
      if (updatedList.length > 0) {
        void batchUpdateAssyRecordsInCloud(authUser.uid, updatedList).catch(
          handleCloudMutationError
        );
      }
      void createRefreshHistoryInCloud(authUser.uid, historyEntry).catch(
        handleCloudMutationError
      );
      void updateUserPreferencesInCloud(authUser.uid, {
        lastPicName: historyEntry.responsibleName,
        ...(shouldClearPending ? { pendingMasterSync: false } : {}),
      }).catch(handleCloudMutationError);
    }

    setRefreshNotice(
      updatedMap.size > 0
        ? `Refresh selesai oleh ${historyEntry.responsibleName}: ${updatedMap.size} Assy terdampak diperbarui & tercatat di Riwayat Refresh.`
        : `Refresh selesai oleh ${historyEntry.responsibleName}: tidak ada Assy yang mengalami perubahan.`
    );
  };

  const useDedicatedCloudBin = isCloudActive && Boolean(authUser) && !recycleBinNeedsRulesPublish;

  const handleCommitAutoCutChange = (
    nextList: AutoCutItem[],
    entry: MasterChangeHistoryEntry,
    removedItems: AutoCutItem[]
  ) => {
    handleUpdateAutoCut(nextList, true);
    recordMasterHistoryEntries([entry]);

    if (removedItems.length > 0) {
      const binItems: RecycleBinItem[] = removedItems.map((item) => {
        const base = buildRecycleBinItemFromAutoCut(item);
        return {
          ...base,
          id: isCloudActive && authUser ? toScopedDocId(authUser.uid, base.id) : base.id,
        };
      });
      setRecycleBin((prev) => {
        const next = [...binItems, ...prev];
        saveRecycleBin(next);
        return next;
      });
      if (useDedicatedCloudBin && authUser) {
        const uid = authUser.uid;
        binItems.forEach((b) => {
          void addMasterItemToRecycleBinInCloud(uid, b).catch(handleCloudMutationError);
        });
      }
    }
  };

  const handleCommitFeederChange = (
    nextList: FeederItem[],
    entry: MasterChangeHistoryEntry,
    removedItems: FeederItem[]
  ) => {
    handleUpdateFeeder(nextList, true);
    recordMasterHistoryEntries([entry]);

    if (removedItems.length > 0) {
      const binItems: RecycleBinItem[] = removedItems.map((item) => {
        const base = buildRecycleBinItemFromFeeder(item);
        return {
          ...base,
          id: isCloudActive && authUser ? toScopedDocId(authUser.uid, base.id) : base.id,
        };
      });
      setRecycleBin((prev) => {
        const next = [...binItems, ...prev];
        saveRecycleBin(next);
        return next;
      });
      if (useDedicatedCloudBin && authUser) {
        const uid = authUser.uid;
        binItems.forEach((b) => {
          void addMasterItemToRecycleBinInCloud(uid, b).catch(handleCloudMutationError);
        });
      }
    }
  };

  const handleDeleteCustomDisc = (disc: ProcessLogicDisc, nextDb: StdDatabase) => {
    const binItem = buildRecycleBinItemFromDisc(disc);
    const scopedBinItem: RecycleBinItem = {
      ...binItem,
      id: isCloudActive && authUser ? toScopedDocId(authUser.uid, binItem.id) : binItem.id,
    };

    localSnapshotRef.current.stdDb = nextDb;
    setStdDb(nextDb);
    saveStdDatabase(nextDb);
    setRecycleBin((prev) => {
      const next = [scopedBinItem, ...prev];
      saveRecycleBin(next);
      return next;
    });
    markMasterChanged();
    syncMasterToCloud(true);

    if (useDedicatedCloudBin && authUser) {
      void addMasterItemToRecycleBinInCloud(authUser.uid, scopedBinItem).catch(
        handleCloudMutationError
      );
    }
  };

  const handleDeleteHistoryEntry = (id: string) => {
    const target = refreshHistory.find((e) => e.id === id);
    if (!target) return;

    const binItem = buildRecycleBinItemFromHistory(target);
    const scopedBinItem: RecycleBinItem = {
      ...binItem,
      id: isCloudActive && authUser ? toScopedDocId(authUser.uid, binItem.id) : binItem.id,
    };

    setRefreshHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveRefreshHistory(next);
      return next;
    });
    setRecycleBin((prev) => {
      const next = [scopedBinItem, ...prev];
      saveRecycleBin(next);
      return next;
    });

    if (isCloudActive && authUser) {
      void moveRefreshHistoryToRecycleBinInCloud(
        authUser.uid,
        target,
        scopedBinItem,
        useDedicatedCloudBin
      ).catch(handleCloudMutationError);
    }
  };

  const handleClearHistory = () => {
    if (refreshHistory.length === 0) return;
    const pairs = refreshHistory.map((entry) => {
      const binItem = buildRecycleBinItemFromHistory(entry);
      const scopedBinItem: RecycleBinItem = {
        ...binItem,
        id: isCloudActive && authUser ? toScopedDocId(authUser.uid, binItem.id) : binItem.id,
      };
      return { entry, binItem: scopedBinItem };
    });

    setRefreshHistory([]);
    saveRefreshHistory([]);
    setRecycleBin((prev) => {
      const next = [...pairs.map((p) => p.binItem), ...prev];
      saveRecycleBin(next);
      return next;
    });

    if (isCloudActive && authUser) {
      void moveManyRefreshHistoryToRecycleBinInCloud(
        authUser.uid,
        pairs,
        useDedicatedCloudBin
      ).catch(handleCloudMutationError);
    }
  };

  const handleSaveAndCalculateAssy = (payload: AssyInputPayload) => {
    const calc = calculateUmh(payload, stdDb, autoCutList, feederList);
    const finalId =
      isCloudActive && authUser ? toScopedDocId(authUser.uid, payload.id) : payload.id;
    const fullRecord: AssyRecord = { ...payload, id: finalId, calculation: calc };

    setRecords((prev) => {
      const exists = prev.some((r) => r.id === finalId || r.id === payload.id);
      const nextRecords = exists
        ? prev.map((r) => (r.id === finalId || r.id === payload.id ? fullRecord : r))
        : [fullRecord, ...prev];
      saveAssyPayloads(nextRecords);
      return nextRecords;
    });

    if (isCloudActive && authUser) {
      void upsertAssyRecordInCloud(authUser.uid, fullRecord).catch(handleCloudMutationError);
    } else if (authReady && !authUser) {
      setCloudNotice(
        `Assy "${fullRecord.params.assyNo}" tersimpan di lokal browser. Klik "Masuk Google" untuk menyimpannya langsung ke server Firebase.`
      );
    }

    setWizardOpen(false);
    setEditingPayload(null);
    setDetailRecord(fullRecord);
  };

  const handleDeleteRecord = (id: string) => {
    const target = records.find((r) => r.id === id);
    if (!target) return;

    const binItem = buildRecycleBinItemFromAssy(target);
    const scopedId = isCloudActive && authUser ? toScopedDocId(authUser.uid, target.id) : target.id;
    const scopedBinItem: RecycleBinItem = {
      ...binItem,
      id: useDedicatedCloudBin && authUser
        ? toScopedDocId(authUser.uid, binItem.id)
        : isCloudActive && authUser
        ? `inplace_${scopedId}`
        : binItem.id,
      originalId: scopedId,
    };

    setRecords((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveAssyPayloads(next);
      return next;
    });
    setRecycleBin((prev) => {
      const next = [scopedBinItem, ...prev.filter((b) => b.id !== scopedBinItem.id)];
      saveRecycleBin(next);
      return next;
    });
    if (detailRecord?.id === id) {
      setDetailRecord(null);
    }

    if (isCloudActive && authUser) {
      void moveAssyRecordToRecycleBinInCloud(
        authUser.uid,
        target,
        scopedBinItem,
        useDedicatedCloudBin
      ).catch(handleCloudMutationError);
    }

    setRefreshNotice(
      `Assy "${target.params.assyNo}" dipindahkan ke Recycle Bin${
        isCloudActive ? ' Firebase' : ''
      } dan dapat dipulihkan kapan saja.`
    );
  };

  const handleRestoreRecycleItem = (item: RecycleBinItem) => {
    const removeLocalBin = () => {
      setRecycleBin((prev) => {
        const next = prev.filter((b) => b.id !== item.id);
        saveRecycleBin(next);
        return next;
      });
    };

    if (item.itemType === 'assy_record') {
      const raw = item.payload as Partial<AssyRecord>;
      const basePayload: AssyInputPayload = {
        id: item.originalId || String(raw.id || `assy_${Date.now()}`),
        createdAt: String(raw.createdAt || new Date().toISOString()),
        updatedAt: new Date().toISOString(),
        params: raw.params!,
        assemblyComponents: raw.assemblyComponents!,
        partList: Array.isArray(raw.partList) ? raw.partList : [],
        ppcsList: Array.isArray(raw.ppcsList) ? raw.ppcsList : [],
        assemblyCotList: Array.isArray(raw.assemblyCotList) ? raw.assemblyCotList : [],
        terminalRatios: raw.terminalRatios || {},
      };
      const needsRecompute =
        !raw.calculation ||
        !raw.calculation.smv ||
        !Array.isArray(raw.calculation.processes) ||
        raw.calculation.processes.length === 0;
      const restoredRecord: AssyRecord = {
        ...basePayload,
        calculation: needsRecompute
          ? calculateUmh(basePayload, stdDb, autoCutList, feederList)
          : raw.calculation!,
      };

      removeLocalBin();
      setRecords((prev) => {
        const collision = prev.some((r) => r.id === restoredRecord.id);
        const finalLocalRecord = collision
          ? { ...restoredRecord, id: `restored_${Date.now()}` }
          : restoredRecord;
        const next = [finalLocalRecord, ...prev];
        saveAssyPayloads(next);
        return next;
      });

      if (isCloudActive && authUser) {
        if (item.id.startsWith('inplace_')) {
          void restoreInPlaceAssyInCloud(authUser.uid, restoredRecord).catch(
            handleCloudMutationError
          );
        } else if (useDedicatedCloudBin) {
          void restoreAssyFromRecycleBinInCloud(authUser.uid, item, restoredRecord).catch(
            handleCloudMutationError
          );
        } else {
          void upsertAssyRecordInCloud(authUser.uid, restoredRecord).catch(
            handleCloudMutationError
          );
        }
      }
      return;
    }

    if (item.itemType === 'refresh_history') {
      const raw = item.payload as Partial<RefreshHistoryEntry>;
      const restoredEntry: RefreshHistoryEntry = {
        id: item.originalId || String(raw.id || `hist_${Date.now()}`),
        refreshedAt: String(raw.refreshedAt || new Date().toISOString()),
        responsibleName: String(raw.responsibleName || 'PIC'),
        totalSelectedCount: Number(raw.totalSelectedCount) || 0,
        affectedAssyCount: Number(raw.affectedAssyCount) || 0,
        unaffectedAssyCount: Number(raw.unaffectedAssyCount) || 0,
        affectedDiffs: Array.isArray(raw.affectedDiffs) ? raw.affectedDiffs : [],
      };

      removeLocalBin();
      setRefreshHistory((prev) => {
        const collision = prev.some((h) => h.id === restoredEntry.id);
        const finalEntry = collision
          ? { ...restoredEntry, id: `restored_hist_${Date.now()}` }
          : restoredEntry;
        const next = [finalEntry, ...prev];
        saveRefreshHistory(next);
        return next;
      });

      if (isCloudActive && authUser) {
        if (useDedicatedCloudBin) {
          void restoreHistoryFromRecycleBinInCloud(authUser.uid, item, restoredEntry).catch(
            handleCloudMutationError
          );
        } else {
          void createRefreshHistoryInCloud(authUser.uid, restoredEntry).catch(
            handleCloudMutationError
          );
        }
      }
      return;
    }

    if (item.itemType === 'auto_cut_item') {
      const raw = item.payload as Partial<AutoCutItem>;
      const restored: AutoCutItem = {
        id: String(raw.id || `acl_${Date.now()}`),
        customer: String(raw.customer || 'All'),
        terminal: String(raw.terminal || item.title),
        process: String(raw.process || 'auto cut'),
      };
      const nextList = [
        restored,
        ...autoCutList.filter((a) => a.id !== restored.id),
      ];
      removeLocalBin();
      localSnapshotRef.current.autoCutList = nextList;
      setAutoCutList(nextList);
      saveAutoCutList(nextList);
      markMasterChanged();
      if (isCloudActive && authUser) {
        const uid = authUser.uid;
        const snap = localSnapshotRef.current;
        void saveMasterConfigToCloud(uid, snap.stdDb, snap.autoCutList, snap.feederList)
          .then(() =>
            useDedicatedCloudBin
              ? permanentlyDeleteRecycleBinItemFromCloud(uid, item.id)
              : undefined
          )
          .catch(handleCloudMutationError);
      }
      return;
    }

    if (item.itemType === 'feeder_item') {
      const raw = item.payload as Partial<FeederItem>;
      const restored: FeederItem = {
        id: String(raw.id || `fl_${Date.now()}`),
        seal: String(raw.seal || item.title),
        process: String(raw.process || 'auto feeder'),
      };
      const nextList = [
        restored,
        ...feederList.filter((f) => f.id !== restored.id),
      ];
      removeLocalBin();
      localSnapshotRef.current.feederList = nextList;
      setFeederList(nextList);
      saveFeederList(nextList);
      markMasterChanged();
      if (isCloudActive && authUser) {
        const uid = authUser.uid;
        const snap = localSnapshotRef.current;
        void saveMasterConfigToCloud(uid, snap.stdDb, snap.autoCutList, snap.feederList)
          .then(() =>
            useDedicatedCloudBin
              ? permanentlyDeleteRecycleBinItemFromCloud(uid, item.id)
              : undefined
          )
          .catch(handleCloudMutationError);
      }
      return;
    }

    if (item.itemType === 'process_disc') {
      const restoredDisc = item.payload as unknown as ProcessLogicDisc;
      const currentDiscs = stdDb.processDiscs ?? DEFAULT_PROCESS_DISCS;
      const nextDiscs = [
        ...currentDiscs.filter((d) => d.processId !== restoredDisc.processId),
        restoredDisc,
      ].sort((a, b) => a.processId - b.processId);
      const nextDb: StdDatabase = { ...stdDb, processDiscs: nextDiscs };
      removeLocalBin();
      localSnapshotRef.current.stdDb = nextDb;
      setStdDb(nextDb);
      saveStdDatabase(nextDb);
      markMasterChanged();
      if (isCloudActive && authUser) {
        const uid = authUser.uid;
        const snap = localSnapshotRef.current;
        void saveMasterConfigToCloud(uid, snap.stdDb, snap.autoCutList, snap.feederList)
          .then(() =>
            useDedicatedCloudBin
              ? permanentlyDeleteRecycleBinItemFromCloud(uid, item.id)
              : undefined
          )
          .catch(handleCloudMutationError);
      }
    }
  };

  const handlePermanentDeleteRecycleItem = (binId: string) => {
    const target = recycleBin.find((b) => b.id === binId);
    setRecycleBin((prev) => {
      const next = prev.filter((b) => b.id !== binId);
      saveRecycleBin(next);
      return next;
    });
    if (isCloudActive && authUser) {
      if (binId.startsWith('inplace_') && target) {
        void permanentlyDeleteInPlaceAssyInCloud(authUser.uid, target.originalId).catch(
          handleCloudMutationError
        );
      } else if (useDedicatedCloudBin) {
        void permanentlyDeleteRecycleBinItemFromCloud(authUser.uid, binId).catch(
          handleCloudMutationError
        );
      }
    }
  };

  const handleEmptyRecycleBin = () => {
    const inPlaceTargets = recycleBin.filter((b) => b.id.startsWith('inplace_'));
    const dedicatedIds = recycleBin
      .filter((b) => !b.id.startsWith('inplace_'))
      .map((b) => b.id);
    setRecycleBin([]);
    saveRecycleBin([]);
    if (isCloudActive && authUser) {
      inPlaceTargets.forEach((t) => {
        void permanentlyDeleteInPlaceAssyInCloud(authUser.uid, t.originalId).catch(
          handleCloudMutationError
        );
      });
      if (useDedicatedCloudBin && dedicatedIds.length > 0) {
        void emptyRecycleBinInCloud(authUser.uid, dedicatedIds).catch(handleCloudMutationError);
      }
    }
  };

  const handleImportJson = (payloads: AssyInputPayload[]) => {
    const prevRecords = records;
    const recalculated: AssyRecord[] = payloads.map((p) => ({
      ...p,
      id: isCloudActive && authUser ? toScopedDocId(authUser.uid, p.id) : p.id,
      calculation: calculateUmh(p, stdDb, autoCutList, feederList),
    }));
    const newIdSet = new Set(recalculated.map((r) => r.id));
    const removedLocally = prevRecords.filter((r) => !newIdSet.has(r.id));
    if (!isCloudActive && removedLocally.length > 0) {
      const archived = removedLocally.map((r) => buildRecycleBinItemFromAssy(r));
      setRecycleBin((prev) => {
        const next = [...archived, ...prev];
        saveRecycleBin(next);
        return next;
      });
    }
    setRecords(recalculated);
    saveAssyPayloads(recalculated);
    if (isCloudActive && authUser) {
      void replaceAllAssyRecordsInCloud(
        authUser.uid,
        prevRecords,
        recalculated,
        useDedicatedCloudBin
      ).catch(handleCloudMutationError);
    }
  };

  const navItems: { id: NavTab; num: string; label: string; jp: string; icon: typeof Home }[] = [
    { id: 'home', num: '01', label: 'Beranda', jp: 'ホーム', icon: Home },
    { id: 'database', num: '02', label: 'Database Assy', jp: '品番一覧', icon: Database },
    { id: 'std_params', num: '03', label: 'Parameter STD (Sec)', jp: '標準時間', icon: Sliders },
    { id: 'lists', num: '04', label: 'Auto-Cut & Feeder List', jp: '設備マスタ', icon: Cpu },
    { id: 'recycle_bin', num: '05', label: 'Recycle Bin', jp: 'ゴミ箱', icon: Trash2 },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Sticky Top Header */}
      <header className="sticky top-0 z-30 glass-header print:hidden">
        <div className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="lg:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 cursor-pointer"
              aria-label="Menu Navigasi"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            {/* Clean Japanese Precision Engineering Mark */}
            <div
              className="hidden sm:flex w-8 h-8 rounded-xl bg-[#1E3A8A] text-white items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="4" y="4" width="16" height="16" rx="3" strokeOpacity="0.45" />
                <path d="M8 9h8M8 12h5M8 15h8" strokeLinecap="round" />
                <circle cx="16.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
              </svg>
            </div>

            <span className="text-base sm:text-[17px] font-bold tracking-tight text-slate-900 whitespace-nowrap truncate">
              STD / UMH Wire Harness Studio
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {authUser ? (
              <div className="inline-flex items-center rounded-xl bg-white border border-slate-200 divide-x divide-slate-200 overflow-hidden">
                <div className="hidden md:flex items-center gap-2 px-3 py-2 text-xs bg-slate-50/70">
                  <Cloud className="w-3.5 h-3.5 text-[#047857] shrink-0" />
                  <span className="font-semibold text-slate-800 max-w-[150px] truncate">
                    {authUser.displayName || authUser.email}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={handleGoogleSignOut}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Keluar</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={authBusy || !authReady}
                onClick={handleGoogleSignIn}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <LogIn className="w-3.5 h-3.5 text-[#1E3A8A]" />
                <span>Masuk Google</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setEditingPayload(null);
                setWizardOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs sm:text-sm font-semibold hover:bg-[#172E6E] active:scale-[0.99] transition-all whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Input Assy</span>
            </button>
          </div>
        </div>
      </header>

      {!authUser && authReady && !dismissLoginHint && !cloudNotice && (
        <div className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 pt-3 print:hidden">
          <div className="px-4 py-2.5 rounded-xl bg-blue-50 border border-blue-200 text-xs text-[#1E3A8A] flex flex-wrap items-center justify-between gap-3">
            <span>
              <strong>Mode Lokal Browser:</strong> Masuk dengan akun Google agar semua CRUD (
              <span className="font-mono-num">assyRecords</span>,{' '}
              <span className="font-mono-num">masterConfigs</span>,{' '}
              <span className="font-mono-num">refreshHistory</span>,{' '}
              <span className="font-mono-num">recycleBin</span>) langsung tersimpan ke server
              Firebase <strong>estdumh ({FIRESTORE_DATABASE_ID})</strong>.
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={authBusy}
                onClick={handleGoogleSignIn}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Masuk Google &amp; Sinkronkan</span>
              </button>
              <button
                type="button"
                onClick={() => setDismissLoginHint(true)}
                className="text-blue-700 hover:text-blue-950 cursor-pointer"
                aria-label="Tutup pemberitahuan"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {isCloudActive && recycleBinNeedsRulesPublish && (
        <div className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 pt-3 print:hidden">
          <div className="px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-3">
            <span>
              <strong>Perlu Publish Rules di Database (default):</strong> Data Assy &amp; Master
              sudah tersinkron ke <span className="font-mono-num">estdumh ({FIRESTORE_DATABASE_ID})</span>,
              namun koleksi <span className="font-mono-num">/recycleBin</span> butuh aturan terbaru
              di Firebase Console.
            </span>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  const ok = await handleCopyFirestoreRules();
                  if (ok) {
                    setCopiedRulesBanner(true);
                    setTimeout(() => setCopiedRulesBanner(false), 3000);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-900 text-white text-xs font-semibold hover:bg-amber-950 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedRulesBanner ? 'Rules Tersalin!' : 'Salin Firestore Rules'}</span>
              </button>
              <a
                href="https://console.firebase.google.com/project/estdumh/firestore/databases/-default-/rules"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-950 text-xs font-semibold hover:bg-amber-100"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Buka Rules (default)</span>
              </a>
              <button
                type="button"
                onClick={() => setCloudRetryNonce((n) => n + 1)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Sinkronkan Ulang</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {cloudNotice && (
        <div className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 pt-3 print:hidden">
          <div className="px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between gap-3">
            <span>{cloudNotice}</span>
            <button
              type="button"
              onClick={() => setCloudNotice(null)}
              className="text-amber-700 hover:text-amber-950 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Layout: Left Sidebar + Content */}
      <div className="flex-1 flex max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6 gap-6 print:hidden">
        {/* Left Sidebar Navigation (Desktop) */}
        <aside className="hidden lg:flex flex-col w-[252px] shrink-0">
          <div className="glass-surface rounded-2xl p-3 sticky top-22 flex flex-col gap-3">
            <div className="px-2.5 pt-1 pb-2 border-b border-slate-100">
              <p className="text-[11px] font-semibold text-slate-400 tracking-wide">
                工程管理ナビゲーション
              </p>
            </div>

            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all text-left cursor-pointer whitespace-nowrap ${
                      isActive
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-300' : 'text-slate-400'}`} />
                      <span className="truncate">
                        {item.label}
                        {item.id === 'recycle_bin' && recycleBin.length > 0
                          ? ` (${recycleBin.length})`
                          : ''}
                      </span>
                    </span>
                    <span
                      className={`text-[10px] font-normal shrink-0 ${
                        isActive ? 'text-slate-300' : 'text-slate-400'
                      }`}
                    >
                      {item.jp}
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* Clean Unboxed Engineering Master Summary */}
            <div className="mt-2 pt-3 px-2.5 border-t border-slate-100 space-y-2">
              <p className="text-[11px] font-semibold text-slate-400">マスタ概要 · Ringkasan</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-slate-600">
                  <span>Assy Tersimpan</span>
                  <span className="font-mono-num font-semibold text-slate-900">{records.length}</span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Parameter STD</span>
                  <span className="font-mono-num font-semibold text-slate-900">{stdDb.params.length}</span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Auto-Cut Terminal</span>
                  <span className="font-mono-num font-semibold text-slate-900">{autoCutList.length}</span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Feeder Seal</span>
                  <span className="font-mono-num font-semibold text-slate-900">{feederList.length}</span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Recycle Bin</span>
                  <span className="font-mono-num font-semibold text-slate-900">{recycleBin.length}</span>
                </div>
                <div className="pt-2 mt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Sinkronisasi</span>
                  {isCloudActive ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-[#047857]">
                      <Cloud className="w-3 h-3" />
                      estdumh · {FIRESTORE_DATABASE_ID}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-medium text-slate-500">
                      <CloudOff className="w-3 h-3" />
                      Lokal Browser
                    </span>
                  )}
                </div>
                {hasPendingMasterChanges && records.length > 0 && (
                  <div className="pt-1 text-[11px] font-semibold text-amber-700">
                    Parameter berubah · Perlu Refresh UMH
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* Mobile Drawer Navigation */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden flex">
            <div
              className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs"
              onClick={() => setMobileMenuOpen(false)}
            />
            <nav className="relative z-50 w-72 bg-white h-full p-4 shadow-2xl space-y-1.5 border-r border-slate-200">
              <div className="px-3 py-2.5 mb-2 border-b border-slate-200 flex items-center justify-between">
                <span className="text-sm font-bold text-slate-900">Navigasi Studio</span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 rounded-xl text-slate-500 hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all text-left cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </span>
                    <span className={`text-[11px] ${isActive ? 'text-slate-300' : 'text-slate-400'}`}>
                      {item.jp}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>
        )}

        {/* Active View Content */}
        <main className="flex-1 min-w-0">
          {activeTab === 'home' && (
            <HomeView
              records={records}
              onStartWizard={() => {
                setEditingPayload(null);
                setWizardOpen(true);
              }}
              onNavigate={(tab) => setActiveTab(tab)}
              onOpenDetail={(rec) => setDetailRecord(rec)}
            />
          )}

          {activeTab === 'database' && (
            <DatabaseAssyView
              records={records}
              hasPendingMasterChanges={hasPendingMasterChanges}
              refreshHistoryCount={refreshHistory.length}
              recycleBinCount={recycleBin.length}
              isCloudActive={isCloudActive}
              externalNotice={refreshNotice}
              onDismissExternalNotice={() => setRefreshNotice(null)}
              onOpenRefreshModal={() => {
                setRefreshNotice(null);
                setRefreshModalOpen(true);
              }}
              onOpenHistoryModal={() => setHistoryModalOpen(true)}
              onOpenRecycleBin={() => setActiveTab('recycle_bin')}
              onOpenDetail={(rec) => setDetailRecord(rec)}
              onDeleteRecord={handleDeleteRecord}
              onImportJson={handleImportJson}
              onStartWizard={() => {
                setEditingPayload(null);
                setWizardOpen(true);
              }}
            />
          )}

          {activeTab === 'std_params' && (
            <StdParamsView
              stdDb={stdDb}
              autoCutList={autoCutList}
              feederList={feederList}
              masterHistoryCount={
                masterChangeHistory.filter(
                  (e) => e.category === 'std_params' || e.category === 'std_matrices'
                ).length
              }
              onSaveStdDb={handleSaveStdDb}
              onCommitStdBulkEdit={handleCommitStdBulkEdit}
              onOpenMasterHistory={(cat) =>
                setMasterHistoryModal({ open: true, category: cat })
              }
              onDeleteCustomDisc={handleDeleteCustomDisc}
            />
          )}

          {activeTab === 'lists' && (
            <AutoCutFeederView
              autoCutList={autoCutList}
              feederList={feederList}
              autoCutHistoryCount={
                masterChangeHistory.filter((e) => e.category === 'auto_cut').length
              }
              feederHistoryCount={
                masterChangeHistory.filter((e) => e.category === 'feeder').length
              }
              onOpenMasterHistory={(cat) =>
                setMasterHistoryModal({ open: true, category: cat })
              }
              onCommitAutoCutChange={handleCommitAutoCutChange}
              onCommitFeederChange={handleCommitFeederChange}
            />
          )}

          {activeTab === 'recycle_bin' && (
            <RecycleBinView
              items={recycleBin}
              isCloudActive={isCloudActive}
              recycleBinNeedsRulesPublish={recycleBinNeedsRulesPublish}
              onCopyRules={handleCopyFirestoreRules}
              onRetryCloudSync={() => setCloudRetryNonce((n) => n + 1)}
              onRestoreItem={handleRestoreRecycleItem}
              onPermanentDeleteItem={handlePermanentDeleteRecycleItem}
              onEmptyRecycleBin={handleEmptyRecycleBin}
            />
          )}
        </main>
      </div>

      {/* Landscape 3-Section Input Modal */}
      {wizardOpen && (
        <InputWizardModal
          initialPayload={editingPayload}
          autoCutList={autoCutList}
          feederList={feederList}
          cotMatrix={stdDb.cotMatrix}
          difficultyMatrix={stdDb.difficultyMatrix}
          onClose={() => {
            setWizardOpen(false);
            setEditingPayload(null);
          }}
          onSaveAndCalculate={handleSaveAndCalculateAssy}
        />
      )}

      {/* Wide Landscape Detail Modal */}
      {detailRecord && (
        <AssyDetailModal
          record={detailRecord}
          difficultyMatrix={stdDb.difficultyMatrix}
          onClose={() => setDetailRecord(null)}
          onEdit={(rec) => {
            setDetailRecord(null);
            setEditingPayload(rec);
            setWizardOpen(true);
          }}
          onPrintPdf={(rec, mode, lang) => setPdfPreview({ record: rec, mode, lang })}
        />
      )}

      {/* Landscape PDF Print Preview Modal */}
      {pdfPreview && (
        <PdfReportModal
          record={pdfPreview.record}
          mode={pdfPreview.mode}
          lang={pdfPreview.lang}
          onClose={() => setPdfPreview(null)}
        />
      )}

      {/* Refresh UMH on Database Assy Modal */}
      {refreshModalOpen && (
        <RefreshUmhModal
          records={records}
          stdDb={stdDb}
          autoCutList={autoCutList}
          feederList={feederList}
          onCompleteRefresh={handleCompleteRefresh}
          onPrintPdf={(entry) => setPdfHistoryEntry(entry)}
          onCancelAll={() => {
            setRefreshModalOpen(false);
            setRefreshNotice(
              'Refresh UMH dibatalkan (Cancel All Progress). Database Assy tidak berubah.'
            );
          }}
          onClose={() => setRefreshModalOpen(false)}
        />
      )}

      {/* Refresh UMH Change History Modal */}
      {historyModalOpen && (
        <RefreshHistoryModal
          history={refreshHistory}
          onDeleteEntry={handleDeleteHistoryEntry}
          onClearAll={handleClearHistory}
          onPrintPdf={(entry) => setPdfHistoryEntry(entry)}
          onClose={() => setHistoryModalOpen(false)}
        />
      )}

      {/* Master Data Change History Modal (Parameter STD, Matriks 2D, Auto-Cut & Feeder) */}
      {masterHistoryModal.open && (
        <MasterChangeHistoryModal
          history={masterChangeHistory}
          initialCategory={masterHistoryModal.category}
          onDeleteEntry={handleDeleteMasterHistoryEntry}
          onClearAll={handleClearMasterHistory}
          onClose={() => setMasterHistoryModal((prev) => ({ ...prev, open: false }))}
        />
      )}

      {/* Landscape PDF Print Preview Modal for Refresh Change History */}
      {pdfHistoryEntry && (
        <RefreshHistoryPdfModal
          entry={pdfHistoryEntry}
          onClose={() => setPdfHistoryEntry(null)}
        />
      )}
    </div>
  );
}
