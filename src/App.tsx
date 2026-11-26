import { useCallback, useEffect, useRef, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  CheckCircle2,
  Cloud,
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
import { DEFAULT_STD_DATABASE } from './data/defaultStdDb';
import { calculateUmh } from './engine/umhCalculator';
import {
  FIREBASE_PROJECT_ID,
  FIRESTORE_CONSOLE_RULES_URL,
  FIRESTORE_DATABASE_ID,
  auth,
  googleProvider,
} from './firebase';
import {
  ASSY_PAGE_SIZE,
  DuplicateAssyMatch,
  FIRESTORE_RULES_SOURCE,
  addMasterItemToRecycleBinInCloud,
  batchUpdateAssyRecordsInCloud,
  buildRecycleBinItemFromAssy,
  buildRecycleBinItemFromAutoCut,
  buildRecycleBinItemFromFeeder,
  buildRecycleBinItemFromHistory,
  clearMasterChangeHistoryInCloud,
  createMasterChangeHistoryInCloud,
  createRefreshHistoryInCloud,
  deleteMasterChangeHistoryInCloud,
  emptyRecycleBinInCloud,
  fetchAllAssyRecordsFromCloud,
  fetchAssyRecordsPage,
  fetchAssyTotalCount,
  findDuplicateAssyInCloud,
  getGoogleUserDisplayName,
  initializeCloudWorkspace,
  isRecycleBinPermissionError,
  moveAssyRecordToRecycleBinInCloud,
  moveManyRefreshHistoryToRecycleBinInCloud,
  moveRefreshHistoryToRecycleBinInCloud,
  normalizeAssyNo,
  permanentlyDeleteInPlaceAssyInCloud,
  permanentlyDeleteRecycleBinItemFromCloud,
  replaceAllAssyRecordsInCloud,
  restoreAssyFromRecycleBinInCloud,
  restoreHistoryFromRecycleBinInCloud,
  restoreInPlaceAssyInCloud,
  saveMasterConfigToCloud,
  subscribeMasterConfig,
  subscribeRecycleBin,
  subscribeRefreshHistory,
  subscribeUserProfile,
  toCloudActor,
  toSharedDocId,
  updateSharedPendingMasterSyncInCloud,
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
  RecycleBinItem,
  RefreshHistoryEntry,
  StdDatabase,
  UiLang,
} from './types/umh';
import { computeAssyManualEditDiff, createMasterChangeEntry } from './utils/masterDiffEngine';
import { PdfLayoutMode } from './utils/pdfExporter';
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

interface GlobalToast {
  id: number;
  message: string;
  tone: 'success' | 'info' | 'warning';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [stdDb, setStdDb] = useState<StdDatabase>(() => loadStdDatabase());
  const [autoCutList, setAutoCutList] = useState<AutoCutItem[]>(() => loadAutoCutList());
  const [feederList, setFeederList] = useState<FeederItem[]>(() => loadFeederList());

  // Offline/local full list (used when not signed in to Firebase)
  const [localRecords, setLocalRecords] = useState<AssyRecord[]>(() =>
    loadAssyRecords(loadStdDatabase(), loadAutoCutList(), loadFeederList())
  );

  // Server-side paginated state (33 items/page fetched on demand from Firestore)
  const [cloudPageRecords, setCloudPageRecords] = useState<AssyRecord[]>([]);
  const [pageIndex, setPageIndex] = useState<number>(0);
  const [pageCursors, setPageCursors] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([
    null,
  ]);
  const [hasNextCloudPage, setHasNextCloudPage] = useState<boolean>(false);
  const [totalCloudAssyCount, setTotalCloudAssyCount] = useState<number>(0);
  const [isLoadingAssyPage, setIsLoadingAssyPage] = useState<boolean>(false);

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

  // Modals & Toast
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingPayload, setEditingPayload] = useState<AssyInputPayload | null>(null);
  const [editingOriginalRecord, setEditingOriginalRecord] = useState<AssyRecord | null>(null);

  // Draft preview state opened right after InputWizardModal calculation BEFORE saving to DB
  const [draftPreviewState, setDraftPreviewState] = useState<{
    record: AssyRecord;
    originalRecord: AssyRecord | null;
    duplicateWarning: DuplicateAssyMatch | null;
  } | null>(null);

  const [detailRecord, setDetailRecord] = useState<AssyRecord | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{
    record?: AssyRecord;
    records?: AssyRecord[];
    mode?: AllowanceMode;
    lang: UiLang;
    layout: PdfLayoutMode;
  } | null>(null);
  const [refreshModalOpen, setRefreshModalOpen] = useState(false);
  const [refreshModalRecords, setRefreshModalRecords] = useState<AssyRecord[]>([]);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [masterHistoryModal, setMasterHistoryModal] = useState<{
    open: boolean;
    category: 'all' | MasterChangeCategory;
  }>({ open: false, category: 'all' });
  const [pdfHistoryEntry, setPdfHistoryEntry] = useState<RefreshHistoryEntry | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [globalToast, setGlobalToast] = useState<GlobalToast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentUserName = getGoogleUserDisplayName(authUser);
  const cloudActor = authUser ? toCloudActor(authUser) : null;
  const isCloudActive = Boolean(authUser && authUser.emailVerified && cloudReady);

  const showToast = useCallback(
    (message: string, tone: 'success' | 'info' | 'warning' = 'success') => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      const next: GlobalToast = { id: Date.now(), message, tone };
      setGlobalToast(next);
      toastTimerRef.current = setTimeout(() => {
        setGlobalToast((cur) => (cur?.id === next.id ? null : cur));
      }, 4500);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Latest local state snapshot ref for synchronous master sync & initial cloud seeding
  const localSnapshotRef = useRef({
    stdDb,
    autoCutList,
    feederList,
    localRecords,
    refreshHistory,
    recycleBin,
    hasPendingMasterChanges,
    pageCursors,
    pageIndex,
  });
  localSnapshotRef.current = {
    stdDb,
    autoCutList,
    feederList,
    localRecords,
    refreshHistory,
    recycleBin,
    hasPendingMasterChanges,
    pageCursors,
    pageIndex,
  };

  const handleCopyFirestoreRules = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(FIRESTORE_RULES_SOURCE);
      return true;
    } catch {
      return false;
    }
  };

  const handleCloudMutationError = useCallback((err: unknown) => {
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
  }, []);

  // Load a single 33-item page on demand from Firestore
  const loadCloudAssyPage = useCallback(
    async (
      targetIndex: number,
      cursorOverride?: QueryDocumentSnapshot<DocumentData> | null
    ) => {
      setIsLoadingAssyPage(true);
      try {
        const snap = localSnapshotRef.current;
        const effectiveIndex = Math.max(0, targetIndex);
        const cursor =
          cursorOverride !== undefined
            ? cursorOverride
            : effectiveIndex === 0
            ? null
            : snap.pageCursors[effectiveIndex] ?? null;

        const [pageRes, totalCount] = await Promise.all([
          fetchAssyRecordsPage({
            cursor,
            pageSize: ASSY_PAGE_SIZE,
            stdDb: snap.stdDb,
            autoCutList: snap.autoCutList,
            feederList: snap.feederList,
          }),
          fetchAssyTotalCount(),
        ]);

        setCloudPageRecords(pageRes.records);
        setHasNextCloudPage(pageRes.hasMore);
        setTotalCloudAssyCount(Math.max(totalCount, pageRes.records.length));
        setPageIndex(effectiveIndex);

        setPageCursors((prev) => {
          const next = effectiveIndex === 0 ? [null] : prev.slice(0, effectiveIndex + 1);
          next[effectiveIndex] = cursor;
          if (pageRes.lastDoc) {
            next[effectiveIndex + 1] = pageRes.lastDoc;
          }
          return next;
        });

        // Cache first page locally for quick offline fallback
        if (effectiveIndex === 0 && pageRes.records.length > 0) {
          saveAssyPayloads(pageRes.records);
        }
      } catch (err) {
        handleCloudMutationError(err);
      } finally {
        setIsLoadingAssyPage(false);
      }
    },
    [handleCloudMutationError]
  );

  // Auth listener
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
      if (user) {
        const displayName = getGoogleUserDisplayName(user);
        if (displayName) saveLastPicName(displayName);
      } else {
        setCloudReady(false);
        setPageIndex(0);
        setPageCursors([null]);
      }
    });
    return () => unsubAuth();
  }, []);

  // Firestore shared cross-account subscriptions + initial page 1 fetch (33 records)
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
          records: snap.localRecords,
          refreshHistory: snap.refreshHistory,
          recycleBin: snap.recycleBin,
          lastPicName: getGoogleUserDisplayName(authUser) || loadLastPicName(),
          pendingMasterSync: snap.hasPendingMasterChanges,
        });

        if (cancelled) return;

        setRecycleBinNeedsRulesPublish(!recycleBinCloudAvailable);

        unsubs.push(
          subscribeUserProfile(
            authUser.uid,
            (profile) => {
              if (!profile) return;
              if (profile.lastPicName) {
                saveLastPicName(profile.lastPicName);
              }
            },
            handleCloudMutationError
          )
        );

        unsubs.push(
          subscribeMasterConfig(
            DEFAULT_STD_DATABASE,
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
              if (typeof cfg.pendingMasterSync === 'boolean') {
                setHasPendingMasterChanges(cfg.pendingMasterSync);
                savePendingMasterSync(cfg.pendingMasterSync);
              }
            },
            handleCloudMutationError
          )
        );

        unsubs.push(
          subscribeRefreshHistory(
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

        // Load only page 1 (33 Assy) from shared Firestore database
        await loadCloudAssyPage(0, null);
        if (cancelled) return;

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
  }, [authReady, authUser, cloudRetryNonce, handleCloudMutationError, loadCloudAssyPage]);

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

  const masterCloudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (masterCloudTimerRef.current) {
        clearTimeout(masterCloudTimerRef.current);
      }
    };
  }, []);

  const syncMasterToCloud = (immediate: boolean) => {
    if (!isCloudActive || !cloudActor) return;
    if (masterCloudTimerRef.current) {
      clearTimeout(masterCloudTimerRef.current);
      masterCloudTimerRef.current = null;
    }
    const actor = cloudActor;
    const flush = () => {
      const snap = localSnapshotRef.current;
      void saveMasterConfigToCloud(
        actor,
        snap.stdDb,
        snap.autoCutList,
        snap.feederList,
        snap.hasPendingMasterChanges
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
    if (isCloudActive && cloudActor && authUser) {
      void updateSharedPendingMasterSyncInCloud(cloudActor, true).catch(handleCloudMutationError);
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
    const stampedEntries = currentUserName
      ? entries.map((e) => ({ ...e, responsibleName: currentUserName }))
      : entries;

    setMasterChangeHistory((prev) => {
      const next = [...stampedEntries, ...prev];
      saveMasterChangeHistory(next);
      return next;
    });
    const pic = stampedEntries[0]?.responsibleName;
    if (pic) {
      saveLastPicName(pic);
    }
    if (isCloudActive && authUser) {
      const uid = authUser.uid;
      stampedEntries.forEach((entry) => {
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
    showToast('Perubahan Parameter STD berhasil disimpan & dicatat di Riwayat Perubahan.');
  };

  const handleDeleteMasterHistoryEntry = (id: string) => {
    setMasterChangeHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveMasterChangeHistory(next);
      return next;
    });
    if (isCloudActive && authUser) {
      void deleteMasterChangeHistoryInCloud(id).catch(handleCloudMutationError);
    }
  };

  const handleClearMasterHistory = () => {
    if (masterChangeHistory.length === 0) return;
    const ids = masterChangeHistory.map((e) => e.id);
    setMasterChangeHistory([]);
    saveMasterChangeHistory([]);
    if (isCloudActive && authUser) {
      void clearMasterChangeHistoryInCloud(ids).catch(handleCloudMutationError);
    }
  };

  // On-demand full database fetch (only invoked for bulk operations: Batch ZIP, Backup, Refresh UMH)
  const handleFetchAllAssyRecords = useCallback(async (): Promise<AssyRecord[]> => {
    if (isCloudActive) {
      const snap = localSnapshotRef.current;
      return fetchAllAssyRecordsFromCloud(snap.stdDb, snap.autoCutList, snap.feederList);
    }
    return localSnapshotRef.current.localRecords;
  }, [isCloudActive]);

  // Duplicate Assy Number check across the entire shared database
  const handleCheckDuplicateAssy = useCallback(
    async (assyNo: string, excludeId?: string): Promise<DuplicateAssyMatch | null> => {
      const trimmed = assyNo.trim();
      const norm = normalizeAssyNo(trimmed);
      if (!norm) return null;

      if (isCloudActive) {
        return findDuplicateAssyInCloud(trimmed, excludeId);
      }

      const found = localSnapshotRef.current.localRecords.find(
        (r) =>
          r.id !== excludeId &&
          !r.params._recycleBinMeta &&
          normalizeAssyNo(r.params.assyNo) === norm
      );
      if (!found) return null;
      return {
        id: found.id,
        assyNo: found.params.assyNo,
        customer: found.params.customer || '-',
        createdByName: found.createdByName,
        updatedAt: found.updatedAt,
      };
    },
    [isCloudActive]
  );

  // Pagination handlers
  const visiblePageRecords = isCloudActive
    ? cloudPageRecords
    : localRecords.slice(pageIndex * ASSY_PAGE_SIZE, (pageIndex + 1) * ASSY_PAGE_SIZE);
  const totalAssyCount = isCloudActive
    ? Math.max(totalCloudAssyCount, cloudPageRecords.length)
    : localRecords.length;
  const hasNextPage = isCloudActive
    ? hasNextCloudPage
    : (pageIndex + 1) * ASSY_PAGE_SIZE < localRecords.length;
  const hasPrevPage = pageIndex > 0;

  const handleNextPage = () => {
    if (!hasNextPage) return;
    const nextIdx = pageIndex + 1;
    if (isCloudActive) {
      const nextCursor = pageCursors[nextIdx] ?? null;
      if (!nextCursor) return;
      void loadCloudAssyPage(nextIdx, nextCursor);
    } else {
      setPageIndex(nextIdx);
    }
  };

  const handlePrevPage = () => {
    if (!hasPrevPage) return;
    const prevIdx = Math.max(0, pageIndex - 1);
    if (isCloudActive) {
      const prevCursor = prevIdx === 0 ? null : pageCursors[prevIdx] ?? null;
      void loadCloudAssyPage(prevIdx, prevCursor);
    } else {
      setPageIndex(prevIdx);
    }
  };

  const handleFirstPage = () => {
    if (pageIndex === 0) return;
    if (isCloudActive) {
      void loadCloudAssyPage(0, null);
    } else {
      setPageIndex(0);
    }
  };

  const handleOpenRefreshModal = async () => {
    setRefreshNotice(null);
    const allRecs = await handleFetchAllAssyRecords();
    setRefreshModalRecords(allRecs);
    setRefreshModalOpen(true);
  };

  const handleCompleteRefresh = (
    updatedMap: Map<string, AssyRecord>,
    historyEntry: RefreshHistoryEntry
  ) => {
    const stampedEntry: RefreshHistoryEntry = currentUserName
      ? { ...historyEntry, responsibleName: currentUserName }
      : historyEntry;
    const updatedList = Array.from(updatedMap.values());

    if (updatedMap.size > 0) {
      setLocalRecords((prev) => {
        const next = prev.map((rec) => updatedMap.get(rec.id) ?? rec);
        saveAssyPayloads(next);
        return next;
      });
      setCloudPageRecords((prev) => prev.map((rec) => updatedMap.get(rec.id) ?? rec));
    }

    setRefreshHistory((prev) => {
      const next = [stampedEntry, ...prev];
      saveRefreshHistory(next);
      return next;
    });

    saveLastPicName(stampedEntry.responsibleName);

    const shouldClearPending =
      updatedMap.size > 0 || stampedEntry.totalSelectedCount >= totalAssyCount;
    if (shouldClearPending) {
      setHasPendingMasterChanges(false);
      localSnapshotRef.current.hasPendingMasterChanges = false;
      savePendingMasterSync(false);
    }

    if (isCloudActive && authUser && cloudActor) {
      if (updatedList.length > 0) {
        void batchUpdateAssyRecordsInCloud(cloudActor, updatedList)
          .then(() => loadCloudAssyPage(pageIndex))
          .catch(handleCloudMutationError);
      }
      void createRefreshHistoryInCloud(authUser.uid, stampedEntry).catch(
        handleCloudMutationError
      );
      if (shouldClearPending) {
        void updateSharedPendingMasterSyncInCloud(cloudActor, false).catch(
          handleCloudMutationError
        );
      }
      void updateUserPreferencesInCloud(authUser.uid, {
        lastPicName: stampedEntry.responsibleName,
        ...(shouldClearPending ? { pendingMasterSync: false } : {}),
      }).catch(handleCloudMutationError);
    }

    const noticeMsg =
      updatedMap.size > 0
        ? `Refresh selesai oleh ${stampedEntry.responsibleName}: ${updatedMap.size} Assy terdampak diperbarui & tercatat di Riwayat Refresh.`
        : `Refresh selesai oleh ${stampedEntry.responsibleName}: tidak ada Assy yang mengalami perubahan.`;
    setRefreshNotice(noticeMsg);
    showToast(noticeMsg);
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
          id: isCloudActive ? toSharedDocId(base.id, 'bin_ac') : base.id,
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
    showToast('Perubahan Auto-Cut List disimpan & dicatat di Riwayat Perubahan.');
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
          id: isCloudActive ? toSharedDocId(base.id, 'bin_fd') : base.id,
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
    showToast('Perubahan Feeder List disimpan & dicatat di Riwayat Perubahan.');
  };

  const handleDeleteHistoryEntry = (id: string) => {
    const target = refreshHistory.find((e) => e.id === id);
    if (!target) return;

    const binItem = buildRecycleBinItemFromHistory(target);
    const scopedBinItem: RecycleBinItem = {
      ...binItem,
      id: isCloudActive ? toSharedDocId(binItem.id, 'bin_hist') : binItem.id,
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
        id: isCloudActive ? toSharedDocId(binItem.id, 'bin_hist') : binItem.id,
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

  // Step 1 of Assy flow: Calculate & open Preview BEFORE saving to database
  const handleWizardCalculatePreview = async (payload: AssyInputPayload) => {
    const calc = calculateUmh(payload, stdDb, autoCutList, feederList);
    const original = editingOriginalRecord;
    const finalId = isCloudActive ? toSharedDocId(payload.id, 'assy') : payload.id;

    const draftRecord: AssyRecord = {
      ...payload,
      id: finalId,
      createdByUid: original?.createdByUid || payload.createdByUid || cloudActor?.uid,
      createdByName:
        original?.createdByName || payload.createdByName || currentUserName || undefined,
      createdByEmail: original?.createdByEmail || payload.createdByEmail || cloudActor?.email,
      updatedByUid: cloudActor?.uid || payload.updatedByUid,
      updatedByName: currentUserName || payload.updatedByName,
      updatedByEmail: cloudActor?.email || payload.updatedByEmail,
      calculation: calc,
    };

    const dupWarning = await handleCheckDuplicateAssy(
      payload.params.assyNo,
      original?.id || undefined
    );

    setWizardOpen(false);
    setEditingPayload(null);
    setEditingOriginalRecord(null);
    setDraftPreviewState({
      record: draftRecord,
      originalRecord: original,
      duplicateWarning: dupWarning,
    });
  };

  // Step 2 of Assy flow: Primary bottom Save button commits Assy to DB + logs manual edit history + shows Toast
  const handleCommitAssyRecord = async (
    finalRecord: AssyRecord,
    originalRecord: AssyRecord | null,
    isFromDraftPreview: boolean
  ) => {
    const finalId = isCloudActive ? toSharedDocId(finalRecord.id, 'assy') : finalRecord.id;
    const now = new Date().toISOString();

    const stampedRecord: AssyRecord = {
      ...finalRecord,
      id: finalId,
      updatedAt: now,
      createdByUid: originalRecord?.createdByUid || finalRecord.createdByUid || cloudActor?.uid,
      createdByName:
        originalRecord?.createdByName || finalRecord.createdByName || currentUserName || undefined,
      createdByEmail:
        originalRecord?.createdByEmail || finalRecord.createdByEmail || cloudActor?.email,
      updatedByUid: cloudActor?.uid || finalRecord.updatedByUid,
      updatedByName: currentUserName || finalRecord.updatedByName,
      updatedByEmail: cloudActor?.email || finalRecord.updatedByEmail,
    };

    // Update local cache
    setLocalRecords((prev) => {
      const exists = prev.some((r) => r.id === finalId || r.id === finalRecord.id);
      const nextRecords = exists
        ? prev.map((r) => (r.id === finalId || r.id === finalRecord.id ? stampedRecord : r))
        : [stampedRecord, ...prev];
      saveAssyPayloads(nextRecords);
      return nextRecords;
    });

    if (isCloudActive && cloudActor) {
      try {
        await upsertAssyRecordInCloud(cloudActor, stampedRecord);
        await loadCloudAssyPage(originalRecord ? pageIndex : 0, originalRecord ? undefined : null);
      } catch (err) {
        handleCloudMutationError(err);
        return;
      }
    } else if (authReady && !authUser) {
      setCloudNotice(
        `Assy "${stampedRecord.params.assyNo}" tersimpan di lokal browser. Klik "Masuk Google" untuk menyimpannya langsung ke server Firebase.`
      );
    }

    // Record manual edit history whenever an existing Assy is modified
    let loggedManualEdit = false;
    if (originalRecord) {
      const diffs = computeAssyManualEditDiff(originalRecord, stampedRecord);
      if (diffs.length > 0) {
        const picName = currentUserName || loadLastPicName() || 'User';
        const entry = createMasterChangeEntry({
          responsibleName: picName,
          category: 'assy_manual_edit',
          source: 'manual_edit',
          note: `Perubahan manual Assy ${stampedRecord.params.assyNo} (${stampedRecord.params.customer || '-'})`,
          totalItemsCount: 1,
          changes: diffs,
        });
        recordMasterHistoryEntries([entry]);
        loggedManualEdit = true;
      }
    }

    if (isFromDraftPreview) {
      setDraftPreviewState(null);
      setDetailRecord(stampedRecord);
    } else {
      setDetailRecord(stampedRecord);
    }

    if (originalRecord) {
      showToast(
        loggedManualEdit
          ? `Perubahan Assy "${stampedRecord.params.assyNo}" berhasil disimpan & tercatat di Riwayat Perubahan.`
          : `Assy "${stampedRecord.params.assyNo}" berhasil diperbarui.`
      );
    } else {
      showToast(
        `Assy "${stampedRecord.params.assyNo}" berhasil disimpan ke database${
          isCloudActive ? ' Firebase' : ' lokal'
        }.`
      );
    }
  };

  const handleDeleteRecord = (id: string) => {
    const target = visiblePageRecords.find((r) => r.id === id) || localRecords.find((r) => r.id === id);
    if (!target) return;

    const binItem = buildRecycleBinItemFromAssy(target);
    const sharedId = isCloudActive ? toSharedDocId(target.id, 'assy') : target.id;
    const scopedBinItem: RecycleBinItem = {
      ...binItem,
      id: useDedicatedCloudBin
        ? toSharedDocId(binItem.id, 'bin_assy')
        : isCloudActive
        ? `inplace_${sharedId}`
        : binItem.id,
      originalId: sharedId,
    };

    setLocalRecords((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveAssyPayloads(next);
      return next;
    });
    setCloudPageRecords((prev) => prev.filter((r) => r.id !== id));
    setTotalCloudAssyCount((c) => Math.max(0, c - 1));
    setRecycleBin((prev) => {
      const next = [scopedBinItem, ...prev.filter((b) => b.id !== scopedBinItem.id)];
      saveRecycleBin(next);
      return next;
    });
    if (detailRecord?.id === id) {
      setDetailRecord(null);
    }

    if (isCloudActive && cloudActor) {
      void moveAssyRecordToRecycleBinInCloud(
        cloudActor,
        target,
        scopedBinItem,
        useDedicatedCloudBin
      )
        .then(() => loadCloudAssyPage(pageIndex))
        .catch(handleCloudMutationError);
    }

    const msg = `Assy "${target.params.assyNo}" dipindahkan ke Recycle Bin${
      isCloudActive ? ' Firebase' : ''
    } dan dapat dipulihkan kapan saja.`;
    setRefreshNotice(msg);
    showToast(msg, 'info');
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
        createdByUid: raw.createdByUid,
        createdByName: raw.createdByName,
        createdByEmail: raw.createdByEmail,
        updatedByUid: cloudActor?.uid || raw.updatedByUid,
        updatedByName: currentUserName || raw.updatedByName,
        updatedByEmail: cloudActor?.email || raw.updatedByEmail,
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
      setLocalRecords((prev) => {
        const collision = prev.some((r) => r.id === restoredRecord.id);
        const finalLocalRecord = collision
          ? { ...restoredRecord, id: `restored_${Date.now()}` }
          : restoredRecord;
        const next = [finalLocalRecord, ...prev];
        saveAssyPayloads(next);
        return next;
      });

      if (isCloudActive && cloudActor) {
        const restorePromise = item.id.startsWith('inplace_')
          ? restoreInPlaceAssyInCloud(cloudActor, restoredRecord)
          : useDedicatedCloudBin
          ? restoreAssyFromRecycleBinInCloud(cloudActor, item, restoredRecord)
          : upsertAssyRecordInCloud(cloudActor, restoredRecord);
        void restorePromise
          .then(() => loadCloudAssyPage(0, null))
          .catch(handleCloudMutationError);
      }
      showToast(`Assy "${restoredRecord.params.assyNo}" berhasil dipulihkan dari Recycle Bin.`);
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
      const nextList = [restored, ...autoCutList.filter((a) => a.id !== restored.id)];
      removeLocalBin();
      localSnapshotRef.current.autoCutList = nextList;
      setAutoCutList(nextList);
      saveAutoCutList(nextList);
      markMasterChanged();
      if (isCloudActive && cloudActor) {
        const snap = localSnapshotRef.current;
        void saveMasterConfigToCloud(cloudActor, snap.stdDb, snap.autoCutList, snap.feederList, true)
          .then(() =>
            useDedicatedCloudBin ? permanentlyDeleteRecycleBinItemFromCloud(item.id) : undefined
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
      const nextList = [restored, ...feederList.filter((f) => f.id !== restored.id)];
      removeLocalBin();
      localSnapshotRef.current.feederList = nextList;
      setFeederList(nextList);
      saveFeederList(nextList);
      markMasterChanged();
      if (isCloudActive && cloudActor) {
        const snap = localSnapshotRef.current;
        void saveMasterConfigToCloud(cloudActor, snap.stdDb, snap.autoCutList, snap.feederList, true)
          .then(() =>
            useDedicatedCloudBin ? permanentlyDeleteRecycleBinItemFromCloud(item.id) : undefined
          )
          .catch(handleCloudMutationError);
      }
      return;
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
        void permanentlyDeleteInPlaceAssyInCloud(target.originalId).catch(
          handleCloudMutationError
        );
      } else if (useDedicatedCloudBin) {
        void permanentlyDeleteRecycleBinItemFromCloud(binId).catch(handleCloudMutationError);
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
        void permanentlyDeleteInPlaceAssyInCloud(t.originalId).catch(handleCloudMutationError);
      });
      if (useDedicatedCloudBin && dedicatedIds.length > 0) {
        void emptyRecycleBinInCloud(dedicatedIds).catch(handleCloudMutationError);
      }
    }
  };

  const handleImportJson = async (payloads: AssyInputPayload[]) => {
    const prevRecords = await handleFetchAllAssyRecords();
    const recalculated: AssyRecord[] = payloads.map((p) => ({
      ...p,
      id: isCloudActive ? toSharedDocId(p.id, 'assy') : p.id,
      createdByName: p.createdByName || currentUserName || undefined,
      updatedByName: currentUserName || p.updatedByName,
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
    setLocalRecords(recalculated);
    saveAssyPayloads(recalculated);
    if (isCloudActive && cloudActor) {
      void replaceAllAssyRecordsInCloud(
        cloudActor,
        prevRecords,
        recalculated,
        useDedicatedCloudBin
      )
        .then(() => loadCloudAssyPage(0, null))
        .catch(handleCloudMutationError);
    } else {
      setPageIndex(0);
    }
    showToast(`Restore JSON selesai: ${recalculated.length} Assy dimuat.`);
  };

  const navItems: { id: NavTab; num: string; label: string; jp: string; icon: typeof Home }[] = [
    { id: 'home', num: '01', label: 'Beranda', jp: 'ホーム', icon: Home },
    { id: 'database', num: '02', label: 'Database Assy', jp: '品番一覧', icon: Database },
    { id: 'std_params', num: '03', label: 'Parameter STD (Sec)', jp: '標準時間', icon: Sliders },
    { id: 'lists', num: '04', label: 'Auto-Cut & Feeder List', jp: '設備マスタ', icon: Cpu },
    { id: 'recycle_bin', num: '05', label: 'Recycle Bin', jp: 'ゴミ箱', icon: Trash2 },
  ];

  const manualEditHistoryCount = masterChangeHistory.filter(
    (e) => e.category === 'assy_manual_edit'
  ).length;

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
                  <span className="font-semibold text-slate-800 max-w-[160px] truncate">
                    {currentUserName || authUser.email}
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
                setEditingOriginalRecord(null);
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
              <strong>Mode Lokal Browser:</strong> Masuk dengan akun Google manapun agar seluruh
              database bersama (Assy, Master STD, Riwayat Perubahan &amp; Recycle Bin) tersinkron
              otomatis ke database cloud tim dengan nama penginput &amp; PIC otomatis dari akun
              Google Anda.
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
              <strong>Perlu Publish Rules di Database Firestore:</strong> Data Assy &amp; Master
              sudah tersinkron ke{' '}
              <span className="font-mono-num">
                {FIREBASE_PROJECT_ID} ({FIRESTORE_DATABASE_ID})
              </span>
              , namun koleksi <span className="font-mono-num">/recycleBin</span> butuh aturan
              terbaru di Firebase Console.
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
                href={FIRESTORE_CONSOLE_RULES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-950 text-xs font-semibold hover:bg-amber-100"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Buka Rules Console</span>
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
                      <Icon
                        className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-300' : 'text-slate-400'}`}
                      />
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
                  <span className="font-mono-num font-semibold text-slate-900">
                    {totalAssyCount}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Parameter STD</span>
                  <span className="font-mono-num font-semibold text-slate-900">
                    {stdDb.params.length}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Auto-Cut Terminal</span>
                  <span className="font-mono-num font-semibold text-slate-900">
                    {autoCutList.length}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Feeder Seal</span>
                  <span className="font-mono-num font-semibold text-slate-900">
                    {feederList.length}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Recycle Bin</span>
                  <span className="font-mono-num font-semibold text-slate-900">
                    {recycleBin.length}
                  </span>
                </div>
                {hasPendingMasterChanges && totalAssyCount > 0 && (
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
                      isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
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
              records={visiblePageRecords}
              totalAssyCount={totalAssyCount}
              onStartWizard={() => {
                setEditingPayload(null);
                setEditingOriginalRecord(null);
                setWizardOpen(true);
              }}
              onNavigate={(tab) => setActiveTab(tab)}
              onOpenDetail={(rec) => setDetailRecord(rec)}
            />
          )}

          {activeTab === 'database' && (
            <DatabaseAssyView
              records={visiblePageRecords}
              pageNumber={pageIndex + 1}
              pageSize={ASSY_PAGE_SIZE}
              totalCount={totalAssyCount}
              hasNextPage={hasNextPage}
              hasPrevPage={hasPrevPage}
              isLoadingPage={isLoadingAssyPage}
              onNextPage={handleNextPage}
              onPrevPage={handlePrevPage}
              onFirstPage={handleFirstPage}
              onFetchAllRecords={handleFetchAllAssyRecords}
              difficultyMatrix={stdDb.difficultyMatrix}
              hasPendingMasterChanges={hasPendingMasterChanges}
              refreshHistoryCount={refreshHistory.length}
              manualEditHistoryCount={manualEditHistoryCount}
              recycleBinCount={recycleBin.length}
              isCloudActive={isCloudActive}
              externalNotice={refreshNotice}
              onDismissExternalNotice={() => setRefreshNotice(null)}
              onOpenRefreshModal={() => void handleOpenRefreshModal()}
              onOpenHistoryModal={() => setHistoryModalOpen(true)}
              onOpenManualEditHistory={() =>
                setMasterHistoryModal({ open: true, category: 'assy_manual_edit' })
              }
              onOpenRecycleBin={() => setActiveTab('recycle_bin')}
              onOpenDetail={(rec) => setDetailRecord(rec)}
              onOpenDailySummaryPdf={(recs) =>
                setPdfPreview({
                  records: recs,
                  lang: 'id',
                  layout: 'summary',
                })
              }
              onDeleteRecord={handleDeleteRecord}
              onImportJson={(payloads) => void handleImportJson(payloads)}
              onStartWizard={() => {
                setEditingPayload(null);
                setEditingOriginalRecord(null);
                setWizardOpen(true);
              }}
            />
          )}

          {activeTab === 'std_params' && (
            <StdParamsView
              stdDb={stdDb}
              currentUserName={currentUserName || undefined}
              masterHistoryCount={
                masterChangeHistory.filter(
                  (e) => e.category === 'std_params' || e.category === 'std_matrices'
                ).length
              }
              onCommitStdBulkEdit={handleCommitStdBulkEdit}
              onOpenMasterHistory={(cat) =>
                setMasterHistoryModal({ open: true, category: cat })
              }
            />
          )}

          {activeTab === 'lists' && (
            <AutoCutFeederView
              autoCutList={autoCutList}
              feederList={feederList}
              currentUserName={currentUserName || undefined}
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
          onCheckDuplicateAssy={handleCheckDuplicateAssy}
          onClose={() => {
            setWizardOpen(false);
            setEditingPayload(null);
            setEditingOriginalRecord(null);
          }}
          onSaveAndCalculate={(payload) => void handleWizardCalculatePreview(payload)}
        />
      )}

      {/* Preview-Before-Save Detail Modal (after InputWizardModal calculation) */}
      {draftPreviewState && (
        <AssyDetailModal
          record={draftPreviewState.record}
          isDraftPreview={true}
          duplicateWarning={draftPreviewState.duplicateWarning}
          stdDb={stdDb}
          autoCutList={autoCutList}
          feederList={feederList}
          currentUserName={currentUserName || undefined}
          onSaveRecord={(finalRec) =>
            handleCommitAssyRecord(finalRec, draftPreviewState.originalRecord, true)
          }
          onClose={() => setDraftPreviewState(null)}
          onEdit={(rec) => {
            const orig = draftPreviewState.originalRecord;
            setDraftPreviewState(null);
            setEditingPayload(rec);
            setEditingOriginalRecord(orig);
            setWizardOpen(true);
          }}
          onPrintPdf={(rec, mode, lang, layout) =>
            setPdfPreview({ record: rec, mode, lang, layout })
          }
        />
      )}

      {/* Saved Assy Detail Modal */}
      {detailRecord && !draftPreviewState && (
        <AssyDetailModal
          record={detailRecord}
          isDraftPreview={false}
          stdDb={stdDb}
          autoCutList={autoCutList}
          feederList={feederList}
          currentUserName={currentUserName || undefined}
          onSaveRecord={(finalRec) => handleCommitAssyRecord(finalRec, detailRecord, false)}
          onClose={() => setDetailRecord(null)}
          onEdit={(rec) => {
            setDetailRecord(null);
            setEditingPayload(rec);
            setEditingOriginalRecord(rec);
            setWizardOpen(true);
          }}
          onPrintPdf={(rec, mode, lang, layout) =>
            setPdfPreview({ record: rec, mode, lang, layout })
          }
        />
      )}

      {/* Landscape PDF Print Preview Modal */}
      {pdfPreview && (
        <PdfReportModal
          record={pdfPreview.record}
          records={pdfPreview.records}
          mode={pdfPreview.mode}
          lang={pdfPreview.lang}
          initialLayout={pdfPreview.layout}
          difficultyMatrix={stdDb.difficultyMatrix}
          onClose={() => setPdfPreview(null)}
        />
      )}

      {/* Refresh UMH on Database Assy Modal */}
      {refreshModalOpen && (
        <RefreshUmhModal
          records={refreshModalRecords}
          stdDb={stdDb}
          autoCutList={autoCutList}
          feederList={feederList}
          lockedPicName={currentUserName || undefined}
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

      {/* Master Data & Manual Assy Edit Change History Modal */}
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

      {/* Global Toast Notification */}
      {globalToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-[90] max-w-md print:hidden"
        >
          <div
            className={`rounded-2xl border shadow-xl px-4 py-3 flex items-center gap-3 text-xs font-semibold ${
              globalToast.tone === 'success'
                ? 'bg-emerald-950 text-white border-emerald-800'
                : globalToast.tone === 'warning'
                ? 'bg-amber-950 text-amber-50 border-amber-800'
                : 'bg-slate-900 text-white border-slate-700'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="leading-snug">{globalToast.message}</span>
            <button
              type="button"
              onClick={() => setGlobalToast(null)}
              className="p-1 rounded-lg text-white/70 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
              aria-label="Tutup notifikasi"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
