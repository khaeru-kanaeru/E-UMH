import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet,
  Grid3X3,
  History,
  Layers,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Upload,
  X,
} from 'lucide-react';
import {
  DEFAULT_STD_DATABASE,
  SYS_DEFAULT_LOT_PARAM_ID,
  getDefaultLotFromStdDb,
} from '../data/defaultStdDb';
import {
  MasterChangeHistoryEntry,
  MasterChangeSource,
  StdDatabase,
} from '../types/umh';
import {
  MATRIX_CONFIGS,
  MatrixKey,
  computeStdParamsDiff,
  createMasterChangeEntry,
} from '../utils/masterDiffEngine';
import {
  exportStdParamsTemplateXlsx,
  parseStdParamsExcelFile,
} from '../utils/stdExcelHelper';
import { loadLastPicName } from '../utils/storage';
import { ActionMenu } from './ActionMenu';
import { StdBulkEditModal } from './StdBulkEditModal';

interface StdParamsViewProps {
  stdDb: StdDatabase;
  masterHistoryCount: number;
  totalAssyCount?: number;
  currentUserName?: string;
  onCommitStdBulkEdit: (nextDb: StdDatabase, entries: MasterChangeHistoryEntry[]) => void;
  onOpenMasterHistory: (cat: 'std_params' | 'std_matrices') => void;
  onApplyLotAndRefreshAll?: () => void;
}

export function StdParamsView({
  stdDb,
  masterHistoryCount,
  totalAssyCount = 0,
  currentUserName,
  onCommitStdBulkEdit,
  onOpenMasterHistory,
  onApplyLotAndRefreshAll,
}: StdParamsViewProps) {
  const [draft, setDraft] = useState<StdDatabase>(() => structuredClone(stdDb));
  const currentDefaultLot = useMemo(() => getDefaultLotFromStdDb(draft), [draft]);
  const [lotInputStr, setLotInputStr] = useState<string>(() =>
    String(getDefaultLotFromStdDb(stdDb))
  );
  const [viewMode, setViewMode] = useState<'substeps' | 'matrices'>('substeps');
  const [selectedSheet, setSelectedSheet] = useState<string>('ALL');
  const [searchParam, setSearchParam] = useState<string>('');
  const [selectedMatrix, setSelectedMatrix] = useState<MatrixKey>('acMatrix');
  const [toast, setToast] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [excelUploading, setExcelUploading] = useState(false);

  // Floating Bulk Edit / Excel Confirm / Reset Confirm Modal state
  const [bulkModal, setBulkModal] = useState<{
    initialTab: 'substeps' | 'matrices';
    initialStage: 'edit' | 'confirm';
    initialDraftDb?: StdDatabase;
    source: MasterChangeSource;
    sourceFileName?: string;
    detectedSheets?: string[];
  } | null>(null);

  const stdExcelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(structuredClone(stdDb));
    setLotInputStr(String(getDefaultLotFromStdDb(stdDb)));
  }, [stdDb]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const parsedLotInput = Math.round(Number(lotInputStr));
  const isLotValid = lotInputStr.trim() !== '' && Number.isFinite(parsedLotInput) && parsedLotInput >= 1;
  const isLotDirty = isLotValid && parsedLotInput !== currentDefaultLot;

  const commitDefaultLotValue = (nextLotValue: number): boolean => {
    if (!Number.isFinite(nextLotValue) || nextLotValue < 1) {
      setErrorMsg('Nilai LOT Default harus berupa angka bulat minimal 1.');
      return false;
    }
    const cleanVal = Math.max(1, Math.round(nextLotValue));
    if (cleanVal === currentDefaultLot) return true;

    const nextDb = structuredClone(draft);
    const existingIdx = nextDb.params.findIndex((p) => p.id === SYS_DEFAULT_LOT_PARAM_ID);
    if (existingIdx >= 0) {
      nextDb.params[existingIdx] = { ...nextDb.params[existingIdx], val: cleanVal };
    } else {
      nextDb.params.unshift({
        id: SYS_DEFAULT_LOT_PARAM_ID,
        sheet: 'Kebijakan Umum',
        stage: 'Kebijakan LOT',
        name: 'LOT Default Produksi (pcs/lot)',
        basis: 'pcs/lot',
        val: cleanVal,
      });
    }

    const diffs = computeStdParamsDiff(draft.params, nextDb.params);
    const pic = (currentUserName || loadLastPicName() || 'PIC').trim();
    const entry = createMasterChangeEntry({
      responsibleName: pic,
      category: 'std_params',
      source: 'manual_edit',
      note: `Perubahan kebijakan LOT Default: ${currentDefaultLot} -> ${cleanVal} pcs/lot`,
      totalItemsCount: nextDb.params.length,
      changes: diffs,
    });
    setErrorMsg(null);
    onCommitStdBulkEdit(nextDb, diffs.length > 0 ? [entry] : []);
    showToast(
      `LOT Default diperbarui menjadi ${cleanVal} pcs/lot oleh ${pic}. Klik "Terapkan ke Semua Assy" untuk menyeragamkan seluruh database.`
    );
    return true;
  };

  const handleSaveDefaultLot = () => {
    if (!isLotValid) {
      setErrorMsg('Masukkan nilai LOT Default yang valid (minimal 1).');
      return;
    }
    commitDefaultLotValue(parsedLotInput);
  };

  const handleApplyLotAndRefresh = () => {
    if (isLotDirty) {
      const ok = commitDefaultLotValue(parsedLotInput);
      if (!ok) return;
    } else if (!isLotValid) {
      setErrorMsg('Masukkan nilai LOT Default yang valid (minimal 1).');
      return;
    }
    onApplyLotAndRefreshAll?.();
  };

  const sheets = useMemo(
    () => Array.from(new Set(draft.params.map((p) => p.sheet))),
    [draft.params]
  );

  const filteredParams = useMemo(() => {
    const q = searchParam.trim().toLowerCase();
    return draft.params.filter((p) => {
      if (selectedSheet !== 'ALL' && p.sheet !== selectedSheet) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sheet.toLowerCase().includes(q) ||
        p.stage.toLowerCase().includes(q) ||
        p.basis.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    });
  }, [draft.params, selectedSheet, searchParam]);

  const handleOpenManualEdit = () => {
    setErrorMsg(null);
    setBulkModal({
      initialTab: viewMode === 'matrices' ? 'matrices' : 'substeps',
      initialStage: 'edit',
      source: 'manual_edit',
    });
  };

  const handleOpenResetConfirm = () => {
    setErrorMsg(null);
    const defaultTarget: StdDatabase = structuredClone(DEFAULT_STD_DATABASE);
    setBulkModal({
      initialTab: viewMode === 'matrices' ? 'matrices' : 'substeps',
      initialStage: 'confirm',
      initialDraftDb: defaultTarget,
      source: 'reset_default',
    });
  };

  const handleStdExcelFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setExcelUploading(true);
    setErrorMsg(null);
    try {
      const parsed = await parseStdParamsExcelFile(file, draft);
      if (parsed.matchedParamsRows === 0 && parsed.matchedMatricesCount === 0) {
        setErrorMsg(
          `File "${file.name}" tidak memuat sheet atau kolom Parameter STD / Matriks 2D yang dikenali. Silakan unduh Template .xlsx terlebih dahulu.`
        );
        return;
      }
      if (parsed.paramChanges.length === 0 && parsed.matrixChanges.length === 0) {
        showToast(
          `File "${file.name}" terbaca (${parsed.detectedSheets.join(', ')}), namun seluruh nilainya sudah sama dengan database saat ini.`
        );
        return;
      }
      setBulkModal({
        initialTab: parsed.paramChanges.length > 0 ? 'substeps' : 'matrices',
        initialStage: 'confirm',
        initialDraftDb: parsed.nextDb,
        source: 'excel_upload',
        sourceFileName: file.name,
        detectedSheets: parsed.detectedSheets,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Gagal membaca Excel "${file.name}": ${msg}`);
    } finally {
      setExcelUploading(false);
    }
  };

  const handleCommitBulk = (nextDb: StdDatabase, entries: MasterChangeHistoryEntry[]) => {
    onCommitStdBulkEdit(nextDb, entries);
    setBulkModal(null);
    const totalChanged = entries.reduce((sum, e) => sum + e.changes.length, 0);
    const pic = entries[0]?.responsibleName || 'PIC';
    showToast(
      `Perubahan Parameter STD (${totalChanged} item) disimpan oleh ${pic} & tercatat di Riwayat Perubahan.`
    );
  };

  const activeMatrixConfig =
    MATRIX_CONFIGS.find((c) => c.key === selectedMatrix) ?? MATRIX_CONFIGS[0];
  const matrixMeta = {
    ...activeMatrixConfig,
    data: draft[activeMatrixConfig.key] ?? [],
  };

  const formatMatrixCell = (val: number, key: MatrixKey, colIdx: number): string => {
    if (!Number.isFinite(val)) return '0';
    if (key === 'cotMatrix') {
      const minDecimals = colIdx < 4 ? 4 : 2;
      const str = String(val);
      const fracLen = str.includes('.') ? str.split('.')[1].length : 0;
      return val.toFixed(Math.max(minDecimals, Math.min(fracLen, 6)));
    }
    if (key === 'difficultyMatrix') {
      return `+${val.toFixed(2)}%`;
    }
    return String(val);
  };

  return (
    <div className="space-y-5">
      <div className="glass-surface rounded-2xl p-6">
        {/* Tier 1: Page Title & Bulk Edit / History / Excel Actions */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-200">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-[#1E3A8A]">
              標準時間マスタ · Konstanta &amp; Matriks 2D
            </p>
            <h1 className="text-xl font-bold text-slate-900 mt-0.5">
              Database Parameter STD (Time by Second)
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Tabel tampilan terkunci (read-only). Klik <strong>Edit Data</strong> untuk ubah massal sekaligus atau unggah file Excel STD.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={stdExcelInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleStdExcelFileSelect}
              className="hidden"
            />

            <button
              type="button"
              onClick={() =>
                onOpenMasterHistory(viewMode === 'matrices' ? 'std_matrices' : 'std_params')
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <History className="w-3.5 h-3.5 text-[#1E3A8A]" />
              <span>
                Riwayat
                {masterHistoryCount > 0 ? ` (${masterHistoryCount})` : ''}
              </span>
            </button>

            <button
              type="button"
              onClick={handleOpenManualEdit}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Edit Data</span>
            </button>

            <ActionMenu
              compact
              ariaLabel="Opsi Parameter STD"
              items={[
                {
                  id: 'upload_std_excel',
                  label: excelUploading ? 'Membaca Excel...' : 'Upload Excel STD (.xlsx)',
                  description: 'Perbarui Sub-Step & Matriks 2D sekaligus',
                  icon: Upload,
                  iconClassName: 'text-[#1E3A8A]',
                  onClick: () => stdExcelInputRef.current?.click(),
                },
                {
                  id: 'download_std_template',
                  label: 'Unduh Template .xlsx',
                  description: `${MATRIX_CONFIGS.length + 1} sheet: Sub-Step + ${MATRIX_CONFIGS.length} Matriks 2D saat ini`,
                  icon: FileSpreadsheet,
                  iconClassName: 'text-[#047857]',
                  onClick: () => exportStdParamsTemplateXlsx(draft),
                },
                {
                  id: 'reset_std_default',
                  label: 'Reset ke Default',
                  description: 'Bandingkan & kembalikan nilai standar',
                  icon: RotateCcw,
                  danger: true,
                  dividerBefore: true,
                  onClick: handleOpenResetConfirm,
                },
              ]}
            />
          </div>
        </div>

        {/* Policy Strip: Pengaturan LOT Default & Terapkan ke Semua Assy */}
        <div className="mt-4 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#1E3A8A]/10 text-[#1E3A8A] flex items-center justify-center shrink-0 mt-0.5">
              <Layers className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900">
                Kebijakan LOT Default Produksi
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                Otomatis dipakai saat input Assy baru dan dapat langsung diterapkan ke seluruh
                Database Assy saat terjadi perubahan kebijakan LOT.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="inline-flex items-center rounded-xl bg-white border border-slate-300 overflow-hidden focus-within:border-[#1E3A8A] focus-within:ring-2 focus-within:ring-[#1E3A8A]/20">
              <label
                htmlFor="std-default-lot-input"
                className="px-2.5 py-1.5 bg-slate-100 border-r border-slate-200 text-[11px] font-semibold text-slate-600 whitespace-nowrap"
              >
                LOT Default
              </label>
              <input
                id="std-default-lot-input"
                type="number"
                min={1}
                step={1}
                value={lotInputStr}
                onChange={(e) => setLotInputStr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isLotDirty) {
                    e.preventDefault();
                    handleSaveDefaultLot();
                  }
                }}
                className="w-20 px-2.5 py-1.5 text-xs font-mono-num font-bold text-slate-900 text-right focus:outline-none tabular-nums"
              />
              <span className="pr-2.5 text-[11px] text-slate-500 whitespace-nowrap">pcs/lot</span>
            </div>

            <button
              type="button"
              disabled={!isLotDirty}
              onClick={handleSaveDefaultLot}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5 text-[#1E3A8A]" />
              <span>Simpan LOT</span>
            </button>

            {onApplyLotAndRefreshAll && (
              <button
                type="button"
                disabled={totalAssyCount === 0 || !isLotValid}
                onClick={handleApplyLotAndRefresh}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#047857] text-white text-xs font-semibold hover:bg-[#065F46] disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>
                  Terapkan &amp; Refresh Semua
                  {totalAssyCount > 0 ? ` (${totalAssyCount})` : ''}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Tier 2: View Switcher + Contextual Right Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-4">
          <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200 self-start overflow-x-auto max-w-full">
            <button
              type="button"
              onClick={() => setViewMode('substeps')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                viewMode === 'substeps'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sub-Step <span className="font-mono-num opacity-70">({draft.params.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('matrices')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                viewMode === 'matrices'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              <span>
                Matriks 2D <span className="font-mono-num opacity-70">({MATRIX_CONFIGS.length})</span>
              </span>
            </button>
          </div>

          {/* Contextual Controls for Sub-Step Tab */}
          {viewMode === 'substeps' && (
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchParam}
                  onChange={(e) => setSearchParam(e.target.value)}
                  placeholder="Cari parameter..."
                  className="w-48 sm:w-56 pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20"
                />
              </div>
              <select
                value={selectedSheet}
                onChange={(e) => setSelectedSheet(e.target.value)}
                aria-label="Filter Sheet Proses"
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20"
              >
                <option value="ALL">Semua Sheet Proses</option>
                {sheets.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-500 font-mono-num whitespace-nowrap">
                {filteredParams.length} parameter
              </span>
            </div>
          )}

          {/* Contextual Controls for Matrices Tab */}
          {viewMode === 'matrices' && (
            <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200 self-start lg:self-auto overflow-x-auto max-w-full">
              {MATRIX_CONFIGS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setSelectedMatrix(m.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    selectedMatrix === m.key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {m.shortName}
                </button>
              ))}
            </div>
          )}

        </div>

        {toast && (
          <div className="mt-4 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-[#047857]">
            {toast}
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-800 flex items-center justify-between gap-3">
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-red-600 hover:text-red-900 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* TAB 1: PARAMETER SUB-STEP (FIXED READ-ONLY) */}
        {viewMode === 'substeps' && (
          <div className="mt-4">
            <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                    <th className="py-2.5 px-4">Sheet Proses</th>
                    <th className="py-2.5 px-4">Tahapan</th>
                    <th className="py-2.5 px-4">Sub-Step / Keterangan</th>
                    <th className="py-2.5 px-4">Basis Pembagi</th>
                    <th className="py-2.5 px-4 text-right w-36">Time / Coeff</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 text-xs">
                  {filteredParams.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        Tidak ada parameter yang cocok dengan pencarian.
                      </td>
                    </tr>
                  ) : (
                    filteredParams.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-4 font-semibold text-slate-800 whitespace-nowrap">
                          {p.sheet}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                          {p.stage}
                        </td>
                        <td className="py-2.5 px-4 text-slate-900 font-medium">{p.name}</td>
                        <td className="py-2.5 px-4 font-mono-num text-slate-500 whitespace-nowrap">
                          {p.basis}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono-num font-bold text-[#1E3A8A] tabular-nums whitespace-nowrap">
                          {p.val}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {(selectedSheet === 'Assembly' || selectedSheet === 'ALL') && (
              <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-[11px] text-slate-600 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="space-y-0.5">
                  <p className="text-slate-700 font-medium">
                    <strong>Setting Wires on Board</strong> = Weighted COT (mm × bobot diameter D7–D36) ×{' '}
                    <span className="font-mono-num">as_set_mm (0.18)</span> ×{' '}
                    <span className="font-mono-num">(1 + (CCT_PPCS / 1000) × 0.25)</span>.
                  </p>
                  <p className="text-slate-500">
                    <strong>Pemasangan Selang COT</strong> dipisah dari Taping Pre-COT dan seluruh selang COT-B &amp; H-COT kini disetarakan menggunakan parameter <strong>Slit</strong> (Base 3.0s + 0.035s/mm). Faktor taping Pre/Ujung/Post per DIA (D7–D36) dikelola di tab <strong>Matriks 2D → COT</strong>.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedMatrix('cotMatrix');
                      setViewMode('matrices');
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-[#1E3A8A] hover:bg-blue-50/60 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Buka Matriks COT (D7–D36)
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: MATRIKS 2D (FIXED READ-ONLY) */}
        {viewMode === 'matrices' && (
          <div className="mt-4">
            <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h2 className="text-sm font-bold text-slate-900">{matrixMeta.title}</h2>
                <span className="text-[11px] text-slate-500">
                  Klik <strong>Edit Data</strong> untuk mengubah nilai matriks
                </span>
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-700 bg-slate-50">
                    <th className="py-2.5 px-3 border border-slate-200 whitespace-nowrap">
                      {matrixMeta.rowHeaderLabel}
                    </th>
                    {matrixMeta.colLabels.map((col, ci) => (
                      <th
                        key={ci}
                        className="py-2.5 px-3 border border-slate-200 text-center font-mono-num whitespace-nowrap"
                      >
                        {col}
                        {matrixMeta.colSuffix}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixMeta.rowLabels.map((rowLbl, ri) => (
                    <tr key={ri} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50/80 whitespace-nowrap font-mono-num">
                        {rowLbl}
                      </td>
                      {matrixMeta.colLabels.map((_, ci) => (
                        <td
                          key={ci}
                          className="py-2.5 px-3 border border-slate-200 text-center font-mono-num text-xs font-semibold text-slate-900 tabular-nums"
                        >
                          {formatMatrixCell(matrixMeta.data[ri]?.[ci] ?? 0, selectedMatrix, ci)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {selectedMatrix === 'cotMatrix' && (
                <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-[11px] text-slate-600 space-y-1">
                  <p className="font-semibold text-slate-800">
                    Rumus Kalkulasi Otomatis Proses #17 (Taping COT &amp; Multi-Branch — Master_COT_V2):
                  </p>
                  <p className="font-mono-num text-slate-700">
                    T_pre = ((3.5 + L × Pre_Full) + (3.5 + L × Pre_Half) + (3.5 + max(1, floor(L / 150)) × T_Spot)) / 3
                  </p>
                  <p className="font-mono-num text-slate-700">
                    T_ujung = T_Ujung_Branch &nbsp;|&nbsp; T_post = ((3.5 + L × Post_Full) + (3.5 + L × Post_Half) + (floor(L / 150) &gt; 0 ? 3.5 + floor(L / 150) × T_Spot : 0)) / 3 &nbsp;|&nbsp; Detik/Baris = (T_pre + T_ujung + T_post) × QTY
                  </p>
                  <p className="text-slate-500">
                    Perubahan nilai matriks di sini otomatis diterapkan pada kalkulasi Base UMH (Total Detik / 3600) saat input maupun refresh UMH.
                  </p>
                </div>
              )}

              {selectedMatrix === 'difficultyMatrix' && (
                <div className="mt-4 rounded-xl bg-amber-50/60 border border-amber-200/80 px-4 py-3 text-[11px] text-slate-700 space-y-1">
                  <p className="font-semibold text-amber-950">
                    Rumus Rating Tingkat Kesulitan Manual (0.0 – 5.0 ★, kelipatan 0.5):
                  </p>
                  <p className="font-mono-num text-amber-900">
                    hasilAkhir = hasilDasar × (1 + (Penambahan% / 100)) &nbsp;|&nbsp; Kurva default: 14 × ln(1 + bintang)
                  </p>
                  <p className="text-slate-600">
                    Nilai <strong>0.0 Bintang (0.00%)</strong> tidak mengubah hasil perhitungan sama sekali. Semua nilai persentase pada 11 jenjang di atas dapat disesuaikan melalui tombol <strong>Edit Data</strong> atau <strong>Upload Excel STD</strong>.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Floating Bulk Edit & Save Confirmation Modal for Parameter STD & Matriks 2D */}
      {bulkModal && (
        <StdBulkEditModal
          currentDb={draft}
          initialTab={bulkModal.initialTab}
          initialMatrix={selectedMatrix}
          initialStage={bulkModal.initialStage}
          initialDraftDb={bulkModal.initialDraftDb}
          source={bulkModal.source}
          sourceFileName={bulkModal.sourceFileName}
          detectedSheets={bulkModal.detectedSheets}
          lockedPicName={currentUserName}
          onCommit={handleCommitBulk}
          onClose={() => setBulkModal(null)}
        />
      )}
    </div>
  );
}
