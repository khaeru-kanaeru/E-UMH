import { useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderArchive,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  User as UserIcon,
  X,
} from 'lucide-react';
import { resolveDifficultyPercentage } from '../data/cotMasterV2';
import {
  getAllowanceModeLabel,
  getAllowSecForMode,
  getEffectiveLot,
  getVariantResult,
} from '../engine/umhCalculator';
import { AssyInputPayload, AssyRecord } from '../types/umh';
import { exportDatabaseAssyExcel } from '../utils/excelExporter';

import { ActionMenu } from './ActionMenu';
import { BatchExportModal } from './BatchExportModal';

interface DatabaseAssyViewProps {
  records: AssyRecord[];
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  isLoadingPage: boolean;
  onNextPage: () => void;
  onPrevPage: () => void;
  onFirstPage: () => void;
  onFetchAllRecords?: () => Promise<AssyRecord[]>;
  difficultyMatrix?: number[][];
  hasPendingMasterChanges: boolean;
  refreshHistoryCount: number;
  manualEditHistoryCount?: number;
  recycleBinCount: number;
  isCloudActive: boolean;
  externalNotice?: string | null;
  onDismissExternalNotice?: () => void;
  onOpenRefreshModal: () => void;
  onOpenHistoryModal: () => void;
  onOpenManualEditHistory?: () => void;
  onOpenRecycleBin: () => void;
  onOpenDetail: (record: AssyRecord) => void;
  onOpenDailySummaryPdf: (records: AssyRecord[]) => void;
  onDeleteRecord: (id: string) => void;
  onImportJson: (payloads: AssyInputPayload[]) => void;
  onStartWizard: () => void;
}

export function DatabaseAssyView({
  records,
  pageNumber,
  pageSize,
  totalCount,
  hasNextPage,
  hasPrevPage,
  isLoadingPage,
  onNextPage,
  onPrevPage,
  onFirstPage,
  onFetchAllRecords,
  difficultyMatrix,
  hasPendingMasterChanges,
  refreshHistoryCount,
  manualEditHistoryCount = 0,
  recycleBinCount,
  isCloudActive,
  externalNotice,
  onDismissExternalNotice,
  onOpenRefreshModal,
  onOpenHistoryModal,
  onOpenManualEditHistory,
  onOpenRecycleBin,
  onOpenDetail,
  onOpenDailySummaryPdf,
  onDeleteRecord,
  onImportJson,
  onStartWizard,
}: DatabaseAssyViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchRecords, setBatchRecords] = useState<AssyRecord[] | null>(null);
  const [isBulkLoading, setIsBulkLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveTotalCount = Math.max(totalCount, records.length);
  const totalPages = Math.max(1, Math.ceil(effectiveTotalCount / Math.max(1, pageSize)));
  const startItemIdx = records.length === 0 ? 0 : (pageNumber - 1) * pageSize + 1;
  const endItemIdx = records.length === 0 ? 0 : startItemIdx + records.length - 1;

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.params.assyNo.toLowerCase().includes(q) ||
        r.params.customer.toLowerCase().includes(q) ||
        (r.createdByName || '').toLowerCase().includes(q)
    );
  }, [records, searchQuery]);

  const fetchAllOrCurrent = async (): Promise<AssyRecord[]> => {
    if (onFetchAllRecords && effectiveTotalCount > records.length) {
      setIsBulkLoading(true);
      try {
        return await onFetchAllRecords();
      } finally {
        setIsBulkLoading(false);
      }
    }
    return records;
  };

  const handleBackupJson = async () => {
    const allRecs = await fetchAllOrCurrent();
    const cleanPayloads = allRecs.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      createdByUid: r.createdByUid,
      createdByName: r.createdByName,
      createdByEmail: r.createdByEmail,
      updatedByUid: r.updatedByUid,
      updatedByName: r.updatedByName,
      updatedByEmail: r.updatedByEmail,
      params: r.params,
      assemblyComponents: r.assemblyComponents,
      partList: r.partList,
      ppcsList: r.ppcsList,
      assemblyCotList: r.assemblyCotList,
      terminalRatios: r.terminalRatios,
    }));
    const blob = new Blob([JSON.stringify(cleanPayloads, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `UMH_Database_Assy_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFeedback(`Backup JSON (${cleanPayloads.length} Assy) berhasil diunduh.`);
    setTimeout(() => setFeedback(null), 3500);
  };

  const activeSelectedIds = useMemo(() => {
    const validIdSet = new Set(records.map((r) => r.id));
    const next = new Set<string>();
    selectedIds.forEach((id) => {
      if (validIdSet.has(id)) next.add(id);
    });
    return next;
  }, [records, selectedIds]);

  const selectedRecords = useMemo(
    () => records.filter((r) => activeSelectedIds.has(r.id)),
    [records, activeSelectedIds]
  );

  const allFilteredSelected =
    filteredRecords.length > 0 &&
    filteredRecords.every((r) => activeSelectedIds.has(r.id));

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredRecords.forEach((r) => next.delete(r.id));
      } else {
        filteredRecords.forEach((r) => next.add(r.id));
      }
      return next;
    });
  };

  const handleOpenBatchModal = async () => {
    if (selectedRecords.length > 0) {
      setBatchRecords(records);
      setBatchModalOpen(true);
      return;
    }
    const allRecs = await fetchAllOrCurrent();
    setBatchRecords(allRecs);
    setBatchModalOpen(true);
  };

  const handleExportExcel = async () => {
    const targets =
      selectedRecords.length > 0
        ? selectedRecords
        : searchQuery.trim()
        ? filteredRecords
        : await fetchAllOrCurrent();
    if (targets.length === 0) return;
    exportDatabaseAssyExcel(targets, 'id');
    setFeedback(
      `File Excel gabungan untuk ${targets.length} Assy (Ringkasan + Breakdown Proses REG/SMV + Detail per Assy) berhasil diunduh.`
    );
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleOpenDailySummary = async () => {
    const targets =
      selectedRecords.length > 0
        ? selectedRecords
        : searchQuery.trim()
        ? filteredRecords
        : await fetchAllOrCurrent();
    if (targets.length === 0) return;
    onOpenDailySummaryPdf(targets);
  };

  const handleRestoreJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        onImportJson(parsed);
        setFeedback(`Berhasil memulihkan ${parsed.length} data Assy dari JSON.`);
      } else {
        setFeedback('Format JSON tidak valid (harus berupa array data Assy).');
      }
    } catch {
      setFeedback('Gagal membaca file JSON.');
    }
    e.target.value = '';
    setTimeout(() => setFeedback(null), 3500);
  };

  return (
    <div className="space-y-5">
      <div className="glass-surface rounded-2xl p-6">
        {/* Tier 1: Page Title & Primary Actions */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-200">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-[#1E3A8A]">
              品番データベース · Riwayat Kalkulasi
            </p>
            <h1 className="text-xl font-bold text-slate-900 mt-0.5">Database Assy</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {isCloudActive
                ? `Tersinkron lintas akun Google di Firebase · Menampilkan maksimal ${pageSize} Assy per halaman (request server).`
                : `Tersimpan di browser lokal · Menampilkan maksimal ${pageSize} Assy per halaman.`}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {effectiveTotalCount > 0 && (
              <button
                type="button"
                onClick={onOpenRefreshModal}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  hasPendingMasterChanges
                    ? 'bg-[#047857] text-white hover:bg-[#065F46] shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-800 hover:bg-slate-50'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh UMH</span>
              </button>
            )}

            <button
              type="button"
              onClick={onStartWizard}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Assy Baru</span>
            </button>
          </div>
        </div>

        {/* Tier 2: Search & Secondary Utility Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="relative w-full md:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari Assy No, Customer, atau Penginput (halaman ini)..."
                className="w-full pl-9 pr-8 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A] transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  aria-label="Hapus pencarian"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <span className="hidden sm:inline text-xs text-slate-500 font-mono-num whitespace-nowrap shrink-0">
              {searchQuery.trim()
                ? `${filteredRecords.length} / ${records.length} (Hal ${pageNumber})`
                : `${startItemIdx}–${endItemIdx} / ${effectiveTotalCount} Assy`}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={effectiveTotalCount === 0 || isBulkLoading}
              onClick={() => void handleOpenBatchModal()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              {isBulkLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-300" />
              ) : (
                <FolderArchive className="w-3.5 h-3.5 text-blue-300" />
              )}
              <span>
                Batch Export (ZIP)
                {selectedRecords.length > 0 ? ` · ${selectedRecords.length}` : ''}
              </span>
            </button>

            <button
              type="button"
              disabled={effectiveTotalCount === 0 || isBulkLoading}
              onClick={() => void handleOpenDailySummary()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-blue-50 hover:border-blue-300 hover:text-[#1E3A8A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-[#1E3A8A]" />
              <span>
                PDF Ringkas
                {selectedRecords.length > 0
                  ? ` (${selectedRecords.length})`
                  : searchQuery.trim() && filteredRecords.length > 0
                  ? ` (${filteredRecords.length})`
                  : ''}
              </span>
            </button>

            <button
              type="button"
              disabled={effectiveTotalCount === 0 || isBulkLoading}
              onClick={() => void handleExportExcel()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-emerald-50 hover:border-emerald-300 hover:text-[#047857] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#047857]" />
              <span>
                Ekspor Excel
                {selectedRecords.length > 0
                  ? ` (${selectedRecords.length})`
                  : searchQuery.trim() && filteredRecords.length > 0
                  ? ` (${filteredRecords.length})`
                  : ''}
              </span>
            </button>

            <button
              type="button"
              onClick={onOpenHistoryModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <History className="w-3.5 h-3.5 text-[#1E3A8A]" />
              <span>Riwayat Refresh</span>
              {refreshHistoryCount > 0 && (
                <span className="font-mono-num text-[11px] text-slate-500">
                  · {refreshHistoryCount}
                </span>
              )}
            </button>

            <ActionMenu
              label="Lainnya"
              ariaLabel="Opsi riwayat edit assy, backup, restore, dan recycle bin"
              items={[
                ...(onOpenManualEditHistory
                  ? [
                      {
                        id: 'manual_edit_history',
                        label: 'Riwayat Edit Assy',
                        description: 'Audit perubahan manual per Assy',
                        icon: History,
                        count: manualEditHistoryCount,
                        onClick: onOpenManualEditHistory,
                      },
                    ]
                  : []),
                {
                  id: 'backup_json',
                  label: 'Backup JSON',
                  description: 'Unduh cadangan seluruh data Assy',
                  icon: Download,
                  dividerBefore: Boolean(onOpenManualEditHistory),
                  onClick: () => void handleBackupJson(),
                },
                {
                  id: 'restore_json',
                  label: 'Restore JSON',
                  description: 'Pulihkan data dari file cadangan',
                  icon: Upload,
                  onClick: () => fileInputRef.current?.click(),
                },
                {
                  id: 'recycle_bin',
                  label: 'Buka Recycle Bin',
                  description: 'Lihat & pulihkan data terhapus',
                  icon: Trash2,
                  count: recycleBinCount,
                  dividerBefore: true,
                  onClick: onOpenRecycleBin,
                },
              ]}
            />

            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleRestoreJson}
              className="hidden"
            />
          </div>
        </div>

        {hasPendingMasterChanges && effectiveTotalCount > 0 && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-amber-900">
              <strong className="font-semibold">Perubahan Parameter STD / Auto-Cut List terdeteksi.</strong>{' '}
              Klik <strong>Refresh UMH on Database Assy</strong> untuk memilih Assy yang ingin
              dihitung ulang dan melihat pratinjau perubahannya.
            </div>
            <button
              type="button"
              onClick={onOpenRefreshModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-900 text-white text-xs font-semibold hover:bg-amber-950 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Pilih &amp; Refresh</span>
            </button>
          </div>
        )}

        {externalNotice && (
          <div className="mt-4 px-4 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-xs font-medium text-slate-800 flex items-center justify-between gap-2">
            <span>{externalNotice}</span>
            {onDismissExternalNotice && (
              <button
                type="button"
                onClick={onDismissExternalNotice}
                className="text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {feedback && (
          <div className="mt-4 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-[#047857]">
            {feedback}
          </div>
        )}

        {selectedRecords.length > 0 && (
          <div className="mt-4 px-4 py-2.5 rounded-xl bg-blue-50 border border-blue-200 flex flex-wrap items-center justify-between gap-3 text-xs text-[#1E3A8A]">
            <span className="font-semibold">
              <span className="font-mono-num">{selectedRecords.length}</span> Assy dipilih untuk ekspor.
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleOpenDailySummary()}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white border border-blue-300 text-[#1E3A8A] text-xs font-semibold hover:bg-blue-100 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF Ringkas ({selectedRecords.length})</span>
              </button>
              <button
                type="button"
                onClick={() => void handleOpenBatchModal()}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] cursor-pointer"
              >
                <FolderArchive className="w-3.5 h-3.5" />
                <span>Batch Export ZIP ({selectedRecords.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-100 cursor-pointer"
              >
                Batalkan
              </button>
            </div>
          </div>
        )}

        <div className="mt-5">
          {isLoadingPage ? (
            <div className="py-16 text-center border border-slate-200 rounded-2xl bg-slate-50/70 flex flex-col items-center justify-center gap-2.5">
              <Loader2 className="w-6 h-6 animate-spin text-[#1E3A8A]" />
              <p className="text-xs font-semibold text-slate-700">
                Memuat Halaman {pageNumber} (maks. {pageSize} Assy dari server)...
              </p>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="py-14 text-center border border-dashed border-slate-300 rounded-2xl bg-slate-50/70">
              <p className="text-sm font-semibold text-slate-800">
                {records.length === 0
                  ? 'Belum ada data Assy tersimpan'
                  : 'Tidak ada Assy yang sesuai dengan pencarian'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Gunakan wizard Input / Konfigurasi Assy untuk menghitung Assy baru.
              </p>
              <button
                type="button"
                onClick={onStartWizard}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Input Assy Pertama</span>
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 overflow-x-auto bg-white">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-3 pl-4 pr-2 w-10">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAllFiltered}
                        aria-label="Pilih semua Assy yang tampil"
                        className="w-4 h-4 rounded border-slate-300 text-[#1E3A8A] focus:ring-[#1E3A8A] cursor-pointer"
                      />
                    </th>
                    <th className="py-3 px-4">Assy Number</th>
                    <th className="py-3 px-4">Customer &amp; Metode</th>
                    <th className="py-3 px-4 text-right">CCT</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Std Sec (s)</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Allow Sec (s)</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Std Hour (hr)</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Allow Hour (hr)</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80 text-sm">
                  {filteredRecords.map((rec) => {
                    const regCalc = getVariantResult(rec, 'reg');
                    const smvCalc = getVariantResult(rec, 'smv');
                    const regStdSec = regCalc.totalBaseSec;
                    const regAllowSec = getAllowSecForMode(
                      rec.params.allowanceMode,
                      regCalc.totalBaseSec,
                      regCalc.totalAllowByProcessSec,
                      regCalc.totalAllowByFinalSec
                    );
                    const smvStdSec = smvCalc.totalBaseSec;
                    const smvAllowSec = getAllowSecForMode(
                      rec.params.allowanceMode,
                      smvCalc.totalBaseSec,
                      smvCalc.totalAllowByProcessSec,
                      smvCalc.totalAllowByFinalSec
                    );
                    const isConfirming = confirmDeleteId === rec.id;
                    const isSelected = activeSelectedIds.has(rec.id);

                    return (
                      <tr
                        key={rec.id}
                        className={`transition-colors ${
                          isSelected ? 'bg-blue-50/50 hover:bg-blue-50/80' : 'hover:bg-slate-50/90'
                        }`}
                      >
                        <td className="py-3 pl-4 pr-2 w-10">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectRow(rec.id)}
                            aria-label={`Pilih ${rec.params.assyNo}`}
                            className="w-4 h-4 rounded border-slate-300 text-[#1E3A8A] focus:ring-[#1E3A8A] cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-900 font-mono-num whitespace-nowrap">
                          {rec.params.assyNo}
                        </td>
                        <td className="py-3 px-4 text-slate-700">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-slate-900">
                              {rec.params.customer || '-'}
                            </span>
                            {(rec.params.difficultyRating ?? 0) > 0 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-[10px] font-mono-num font-semibold text-amber-800 whitespace-nowrap">
                                Kesulitan: {(rec.params.difficultyRating ?? 0).toFixed(1)} ★ (+
                                {(
                                  rec.calculation.difficultyPct ??
                                  resolveDifficultyPercentage(rec.params.difficultyRating ?? 0)
                                ).toFixed(2)}
                                %)
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500">
                            {getAllowanceModeLabel(rec.params.allowanceMode, 'short')}
                            {rec.params.allowanceMode !== 'none' && (
                              <>
                                {' '}· PFD{' '}
                                <span className="font-mono-num">{rec.params.pfdAllowancePct}%</span>
                              </>
                            )}{' '}
                            · LOT{' '}
                            <span className="font-mono-num">{getEffectiveLot(rec.params.lot)}</span>
                          </div>
                          {(rec.createdByName || rec.updatedByName) && (
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                              <span className="inline-flex items-center gap-1">
                                <UserIcon className="w-3 h-3 text-slate-400" />
                                <span>{rec.createdByName || '-'}</span>
                              </span>
                              {rec.updatedByName && rec.updatedByName !== rec.createdByName && (
                                <span className="text-slate-400">
                                  · Edit: {rec.updatedByName}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num text-slate-700">
                          {rec.params.masterCct}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num">
                          <div className="font-semibold text-slate-800">{regStdSec.toFixed(2)}</div>
                          <div className="text-[11px] text-slate-500">SMV {smvStdSec.toFixed(2)}</div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num">
                          <div className="font-bold text-[#047857]">{regAllowSec.toFixed(2)}</div>
                          <div className="text-[11px] text-slate-500">SMV {smvAllowSec.toFixed(2)}</div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num">
                          <div className="font-semibold text-slate-800">
                            {(regStdSec / 3600).toFixed(4)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            SMV {(smvStdSec / 3600).toFixed(4)}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num">
                          <div className="font-bold text-[#1E3A8A]">
                            {(regAllowSec / 3600).toFixed(4)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            SMV {(smvAllowSec / 3600).toFixed(4)}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => onOpenDetail(rec)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Buka</span>
                            </button>

                            {isConfirming ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDeleteRecord(rec.id);
                                    setConfirmDeleteId(null);
                                  }}
                                  className="px-2.5 py-1.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer whitespace-nowrap"
                                >
                                  Ke Recycle Bin
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2 py-1.5 rounded-xl bg-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-300 cursor-pointer"
                                >
                                  Batal
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(rec.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                                aria-label={`Hapus ${rec.params.assyNo}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Hapus</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Server-Side Pagination Controls (33 items/page) */}
          {(effectiveTotalCount > 0 || pageNumber > 1) && (
            <div className="mt-4 pt-3.5 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="text-slate-600 font-mono-num">
                Menampilkan{' '}
                <strong className="text-slate-900">
                  {startItemIdx}–{endItemIdx}
                </strong>{' '}
                dari <strong className="text-slate-900">{effectiveTotalCount}</strong> Assy ·
                Halaman <strong className="text-slate-900">{pageNumber}</strong> / {totalPages} (
                {pageSize}/halaman)
              </div>

              <div className="flex items-center gap-2">
                {pageNumber > 2 && (
                  <button
                    type="button"
                    disabled={isLoadingPage}
                    onClick={() => {
                      setSelectedIds(new Set());
                      onFirstPage();
                    }}
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                  >
                    Hal 1
                  </button>
                )}
                <button
                  type="button"
                  disabled={!hasPrevPage || isLoadingPage}
                  onClick={() => {
                    setSelectedIds(new Set());
                    onPrevPage();
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Sebelumnya</span>
                </button>
                <button
                  type="button"
                  disabled={!hasNextPage || isLoadingPage}
                  onClick={() => {
                    setSelectedIds(new Set());
                    onNextPage();
                  }}
                  className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-xl bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <span>Berikutnya</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {batchModalOpen && (
        <BatchExportModal
          records={batchRecords ?? records}
          initialSelectedIds={Array.from(activeSelectedIds)}
          difficultyMatrix={difficultyMatrix}
          onClose={() => {
            setBatchModalOpen(false);
            setBatchRecords(null);
          }}
          onSuccess={(res) => {
            setFeedback(
              `Batch ZIP (${res.zipFileName}) berhasil diunduh: ${res.assyCount} Assy (${
                res.excelCount > 0 ? `${res.excelCount} Excel` : ''
              }${res.excelCount > 0 && res.pdfCount > 0 ? ' + ' : ''}${
                res.pdfCount > 0 ? `${res.pdfCount} PDF` : ''
              }).`
            );
            setTimeout(() => setFeedback(null), 5000);
          }}
        />
      )}
    </div>
  );
}
