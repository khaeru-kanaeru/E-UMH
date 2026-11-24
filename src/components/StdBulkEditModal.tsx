import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Grid3X3,
  RotateCcw,
  Save,
  Search,
  Sliders,
  UserCheck,
  X,
} from 'lucide-react';
import {
  MasterChangeHistoryEntry,
  MasterChangeSource,
  StdDatabase,
} from '../types/umh';
import {
  MASTER_SOURCE_LABELS,
  MATRIX_CONFIGS,
  MatrixKey,
  computeStdMatricesDiff,
  computeStdParamsDiff,
  createMasterChangeEntry,
} from '../utils/masterDiffEngine';
import { loadLastPicName } from '../utils/storage';

interface StdBulkEditModalProps {
  currentDb: StdDatabase;
  initialTab: 'substeps' | 'matrices';
  initialMatrix?: MatrixKey;
  initialStage?: 'edit' | 'confirm';
  initialDraftDb?: StdDatabase;
  source: MasterChangeSource;
  sourceFileName?: string;
  detectedSheets?: string[];
  onCommit: (nextDb: StdDatabase, entries: MasterChangeHistoryEntry[]) => void;
  onClose: () => void;
}

export function StdBulkEditModal({
  currentDb,
  initialTab,
  initialMatrix = 'acMatrix',
  initialStage = 'edit',
  initialDraftDb,
  source,
  sourceFileName,
  detectedSheets,
  onCommit,
  onClose,
}: StdBulkEditModalProps) {
  const [draft, setDraft] = useState<StdDatabase>(() =>
    structuredClone(initialDraftDb ?? currentDb)
  );
  const [stage, setStage] = useState<'edit' | 'confirm'>(initialStage);
  const [activeTab, setActiveTab] = useState<'substeps' | 'matrices'>(initialTab);
  const [selectedMatrix, setSelectedMatrix] = useState<MatrixKey>(initialMatrix);
  const [selectedSheet, setSelectedSheet] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);

  const [picName, setPicName] = useState<string>(() => loadLastPicName());
  const [note, setNote] = useState<string>('');
  const [picError, setPicError] = useState<string | null>(null);

  const originalParamMap = useMemo(
    () => new Map(currentDb.params.map((p) => [p.id, p.val])),
    [currentDb.params]
  );

  const sheets = useMemo(
    () => Array.from(new Set(draft.params.map((p) => p.sheet))),
    [draft.params]
  );

  const paramDiffs = useMemo(
    () => computeStdParamsDiff(currentDb.params, draft.params),
    [currentDb.params, draft.params]
  );

  const matrixDiffs = useMemo(
    () => computeStdMatricesDiff(currentDb, draft),
    [currentDb, draft]
  );

  const totalChangesCount = paramDiffs.length + matrixDiffs.length;

  const filteredParams = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return draft.params.filter((p) => {
      if (selectedSheet !== 'ALL' && p.sheet !== selectedSheet) return false;
      if (onlyChanged) {
        const orig = originalParamMap.get(p.id) ?? 0;
        if (Math.abs(orig - p.val) < 1e-9) return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sheet.toLowerCase().includes(q) ||
        p.stage.toLowerCase().includes(q) ||
        p.basis.toLowerCase().includes(q)
      );
    });
  }, [draft.params, selectedSheet, onlyChanged, searchQuery, originalParamMap]);

  const activeMatrixCfg = useMemo(
    () => MATRIX_CONFIGS.find((c) => c.key === selectedMatrix) ?? MATRIX_CONFIGS[0],
    [selectedMatrix]
  );

  const handleParamChange = (id: string, val: string) => {
    const num = parseFloat(val);
    setDraft((prev) => ({
      ...prev,
      params: prev.params.map((p) =>
        p.id === id ? { ...p, val: Number.isFinite(num) ? num : 0 } : p
      ),
    }));
  };

  const handleRevertParam = (id: string) => {
    const orig = originalParamMap.get(id);
    if (orig === undefined) return;
    setDraft((prev) => ({
      ...prev,
      params: prev.params.map((p) => (p.id === id ? { ...p, val: orig } : p)),
    }));
  };

  const handleMatrixCellChange = (
    matrixKey: MatrixKey,
    rIdx: number,
    cIdx: number,
    val: string
  ) => {
    const num = parseFloat(val);
    setDraft((prev) => ({
      ...prev,
      [matrixKey]: (prev[matrixKey] ?? []).map((row, ri) =>
        ri === rIdx
          ? row.map((cell, ci) => (ci === cIdx ? (Number.isFinite(num) ? num : 0) : cell))
          : row
      ),
    }));
  };

  const handleResetDraft = () => {
    setDraft(structuredClone(currentDb));
  };

  const handleConfirmSave = () => {
    const trimmedPic = picName.trim();
    if (!trimmedPic) {
      setPicError('Nama penanggung jawab (PIC) wajib diisi sebelum menyimpan perubahan.');
      return;
    }
    if (totalChangesCount === 0) {
      onClose();
      return;
    }

    const entries: MasterChangeHistoryEntry[] = [];
    if (paramDiffs.length > 0) {
      entries.push(
        createMasterChangeEntry({
          responsibleName: trimmedPic,
          category: 'std_params',
          source,
          sourceFileName,
          note,
          totalItemsCount: draft.params.length,
          changes: paramDiffs,
        })
      );
    }
    if (matrixDiffs.length > 0) {
      const totalMatrixCells = MATRIX_CONFIGS.reduce(
        (acc, cfg) => acc + cfg.rowLabels.length * cfg.colLabels.length,
        0
      );
      entries.push(
        createMasterChangeEntry({
          responsibleName: trimmedPic,
          category: 'std_matrices',
          source,
          sourceFileName,
          note,
          totalItemsCount: totalMatrixCells,
          changes: matrixDiffs,
        })
      );
    }

    onCommit(draft, entries);
  };

  const combinedDiffs = useMemo(
    () => [
      ...paramDiffs.map((d) => ({ ...d, categoryTag: 'Sub-Step' })),
      ...matrixDiffs.map((d) => ({ ...d, categoryTag: 'Matriks 2D' })),
    ],
    [paramDiffs, matrixDiffs]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-xs p-2 sm:p-4 print:hidden">
      <div className="glass-modal w-[96vw] max-w-6xl h-[90vh] rounded-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#1E3A8A]/10 text-[#1E3A8A] flex items-center justify-center shrink-0">
              {source === 'excel_upload' ? (
                <FileSpreadsheet className="w-4 h-4" />
              ) : (
                <Sliders className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-[#1E3A8A]">
                {stage === 'edit'
                  ? '一括編集モード · Editor Massal Parameter STD'
                  : `保存確認 · Konfirmasi Perubahan (${MASTER_SOURCE_LABELS[source]})`}
              </p>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 truncate">
                {stage === 'edit'
                  ? 'Edit Data Parameter STD & Matriks 2D'
                  : source === 'excel_upload'
                  ? `Pratinjau & Konfirmasi Upload Excel`
                  : source === 'reset_default'
                  ? 'Konfirmasi Reset Parameter STD ke Default'
                  : 'Konfirmasi & Simpan Perubahan Parameter STD'}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer shrink-0"
            aria-label="Tutup Modal Edit STD"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {stage === 'edit' ? (
          <>
            {/* Edit Toolbar */}
            <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/90 flex flex-col lg:flex-row lg:items-center justify-between gap-3 shrink-0">
              <div className="inline-flex items-center p-1 rounded-xl bg-slate-200/70 border border-slate-200 self-start">
                <button
                  type="button"
                  onClick={() => setActiveTab('substeps')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'substeps'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>Parameter Sub-Step</span>
                  {paramDiffs.length > 0 && (
                    <span className="font-mono-num text-[11px] text-[#1E3A8A]">
                      ({paramDiffs.length} diubah)
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('matrices')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'matrices'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Grid3X3 className="w-3.5 h-3.5" />
                  <span>Matriks 2D</span>
                  {matrixDiffs.length > 0 && (
                    <span className="font-mono-num text-[11px] text-[#1E3A8A]">
                      ({matrixDiffs.length} diubah)
                    </span>
                  )}
                </button>
              </div>

              {activeTab === 'substeps' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-52">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Cari parameter..."
                      className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  <select
                    value={selectedSheet}
                    onChange={(e) => setSelectedSheet(e.target.value)}
                    aria-label="Filter Sheet Proses"
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20"
                  >
                    <option value="ALL">Semua Sheet ({draft.params.length})</option>
                    {sheets.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>

                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer select-none px-2">
                    <input
                      type="checkbox"
                      checked={onlyChanged}
                      onChange={(e) => setOnlyChanged(e.target.checked)}
                      className="rounded border-slate-300 text-[#1E3A8A] focus:ring-[#1E3A8A]"
                    />
                    <span>Hanya diubah</span>
                  </label>
                </div>
              ) : (
                <div className="inline-flex items-center p-1 rounded-xl bg-slate-200/70 border border-slate-200 self-start lg:self-auto overflow-x-auto max-w-full">
                  {MATRIX_CONFIGS.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setSelectedMatrix(m.key)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
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

            {/* Edit Body */}
            <div className="flex-1 min-h-0 overflow-auto p-6 bg-[#f8fafc]">
              {activeTab === 'substeps' ? (
                <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                        <th className="py-2.5 px-4">Sheet Proses</th>
                        <th className="py-2.5 px-4">Tahapan</th>
                        <th className="py-2.5 px-4">Sub-Step / Keterangan</th>
                        <th className="py-2.5 px-4">Basis Pembagi</th>
                        <th className="py-2.5 px-4 text-right w-48">Time / Coeff (Edit Inline)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 text-xs">
                      {filteredParams.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-10 text-center text-slate-500">
                            Tidak ada parameter yang cocok dengan filter saat ini.
                          </td>
                        </tr>
                      ) : (
                        filteredParams.map((p) => {
                          const orig = originalParamMap.get(p.id) ?? 0;
                          const isChanged = Math.abs(orig - p.val) >= 1e-9;
                          return (
                            <tr
                              key={p.id}
                              className={`transition-colors ${
                                isChanged ? 'bg-blue-50/60' : 'hover:bg-slate-50/70'
                              }`}
                            >
                              <td className="py-2.5 px-4 font-semibold text-slate-800 whitespace-nowrap">
                                {p.sheet}
                              </td>
                              <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                                {p.stage}
                              </td>
                              <td className="py-2.5 px-4 text-slate-900 font-medium">
                                <div>{p.name}</div>
                                {isChanged && (
                                  <div className="text-[10px] font-mono-num text-[#1E3A8A] mt-0.5">
                                    Sebelumnya: {orig}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-4 font-mono-num text-slate-500 whitespace-nowrap">
                                {p.basis}
                              </td>
                              <td className="py-2.5 px-4 text-right">
                                <div className="inline-flex items-center justify-end gap-1.5">
                                  <input
                                    type="number"
                                    step="any"
                                    value={p.val}
                                    onChange={(e) => handleParamChange(p.id, e.target.value)}
                                    className={`w-28 text-right font-mono-num font-semibold px-2.5 py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 ${
                                      isChanged
                                        ? 'bg-white border-[#1E3A8A] text-[#1E3A8A]'
                                        : 'bg-slate-50 border-slate-200 text-slate-900 focus:bg-white focus:border-[#1E3A8A]'
                                    }`}
                                  />
                                  {isChanged && (
                                    <button
                                      type="button"
                                      onClick={() => handleRevertParam(p.id)}
                                      title="Kembalikan nilai awal"
                                      className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 cursor-pointer"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <h3 className="text-sm font-bold text-slate-900">{activeMatrixCfg.title}</h3>
                    <span className="text-xs text-slate-500">
                      Semua sel dapat langsung diedit bersamaan
                    </span>
                  </div>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-semibold text-slate-700 bg-slate-50">
                        <th className="py-2.5 px-3 border border-slate-200 whitespace-nowrap">
                          {activeMatrixCfg.rowHeaderLabel}
                        </th>
                        {activeMatrixCfg.colLabels.map((col, ci) => (
                          <th
                            key={ci}
                            className="py-2.5 px-3 border border-slate-200 text-center font-mono-num whitespace-nowrap"
                          >
                            {col}
                            {activeMatrixCfg.colSuffix}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeMatrixCfg.rowLabels.map((rowLbl, ri) => (
                        <tr key={ri} className="hover:bg-slate-50/70">
                          <td className="py-2 px-3 border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50/80 whitespace-nowrap font-mono-num">
                            {rowLbl}
                          </td>
                          {activeMatrixCfg.colLabels.map((_, ci) => {
                            const currVal = draft[selectedMatrix]?.[ri]?.[ci] ?? 0;
                            const origVal = currentDb[selectedMatrix]?.[ri]?.[ci] ?? 0;
                            const isChanged = Math.abs(currVal - origVal) >= 1e-9;
                            return (
                              <td
                                key={ci}
                                className={`py-2 px-2 border border-slate-200 text-center ${
                                  isChanged ? 'bg-blue-50/70' : ''
                                }`}
                              >
                                <input
                                  type="number"
                                  step="any"
                                  value={currVal}
                                  title={isChanged ? `Sebelumnya: ${origVal}` : undefined}
                                  onChange={(e) =>
                                    handleMatrixCellChange(selectedMatrix, ri, ci, e.target.value)
                                  }
                                  className={`${
                                    selectedMatrix === 'settingWireMatrix'
                                      ? 'w-28'
                                      : selectedMatrix === 'cotMatrix'
                                      ? 'w-24'
                                      : 'w-20'
                                  } text-center font-mono-num text-xs font-semibold px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 ${
                                    isChanged
                                      ? 'bg-white border-[#1E3A8A] text-[#1E3A8A]'
                                      : 'bg-slate-50 border-slate-200 text-slate-900 focus:bg-white focus:border-[#1E3A8A]'
                                  }`}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Edit Footer */}
            <div className="px-6 py-3.5 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 text-xs text-slate-600">
                <span className="font-mono-num font-semibold text-slate-900">
                  {totalChangesCount} perubahan terdeteksi
                </span>
                {totalChangesCount > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {paramDiffs.length} Sub-Step, {matrixDiffs.length} Sel Matriks
                    </span>
                    <button
                      type="button"
                      onClick={handleResetDraft}
                      className="text-red-600 hover:underline font-semibold cursor-pointer ml-1"
                    >
                      Batalkan Draft
                    </button>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={totalChangesCount === 0}
                  onClick={() => setStage('confirm')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-xs"
                >
                  <span>Lanjut Konfirmasi Simpan ({totalChangesCount})</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Confirmation Stage Body */}
            <div className="flex-1 min-h-0 overflow-auto p-6 bg-[#f8fafc] space-y-4">
              {/* Source Info Banner */}
              {sourceFileName && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-[#1E3A8A] flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>Sumber Excel:</strong>{' '}
                    <span className="font-mono-num">{sourceFileName}</span>
                    {detectedSheets && detectedSheets.length > 0 && (
                      <> · Sheet terdeteksi: {detectedSheets.join(', ')}</>
                    )}
                  </span>
                  <span className="font-mono-num font-semibold">
                    {totalChangesCount} nilai berubah
                  </span>
                </div>
              )}

              {/* PIC & Note Inputs */}
              <div className="rounded-xl bg-white border border-slate-200 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5 text-[#1E3A8A]" />
                      Nama Penanggung Jawab (PIC) *
                    </span>
                  </label>
                  <input
                    type="text"
                    value={picName}
                    onChange={(e) => {
                      setPicName(e.target.value);
                      if (picError) setPicError(null);
                    }}
                    placeholder="Contoh: Budi Santoso / IE Team"
                    className="w-full px-3.5 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                  />
                  {picError && <p className="text-[11px] text-red-600 mt-1">{picError}</p>}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                    Catatan Perubahan (Opsional)
                  </label>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Contoh: Revisi cycle time Q2 / update standar mesin"
                    className="w-full px-3.5 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                  />
                </div>
              </div>

              {/* Diff Preview Table */}
              {combinedDiffs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center space-y-2">
                  <CheckCircle2 className="w-7 h-7 text-[#047857] mx-auto" />
                  <p className="text-sm font-bold text-slate-900">
                    Tidak Ada Perubahan Nilai Terdeteksi
                  </p>
                  <p className="text-xs text-slate-500">
                    Semua nilai Parameter STD dan Matriks 2D identik dengan data yang sedang aktif.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
                  <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
                    <h3 className="text-xs font-bold text-slate-900">
                      Pratinjau Detail Perubahan ({combinedDiffs.length} item)
                    </h3>
                    <span className="text-[11px] text-slate-500 font-mono-num">
                      {paramDiffs.length} Sub-Step · {matrixDiffs.length} Sel Matriks
                    </span>
                  </div>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-600">
                        <th className="py-2.5 px-4">Kategori</th>
                        <th className="py-2.5 px-4">Sheet / Matriks</th>
                        <th className="py-2.5 px-4">Item / Sel</th>
                        <th className="py-2.5 px-4 text-right">Sebelum</th>
                        <th className="py-2.5 px-4 text-right">Sesudah</th>
                        <th className="py-2.5 px-4 text-right">Selisih</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 text-xs">
                      {combinedDiffs.map((item) => {
                        const delta = item.deltaNumeric ?? 0;
                        return (
                          <tr key={item.key} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-4 font-semibold text-[#1E3A8A] whitespace-nowrap">
                              {item.categoryTag}
                            </td>
                            <td className="py-2.5 px-4 font-medium text-slate-700 whitespace-nowrap">
                              {item.group}
                            </td>
                            <td className="py-2.5 px-4">
                              <div className="font-semibold text-slate-900">{item.label}</div>
                              {item.subLabel && (
                                <div className="text-[11px] text-slate-500">{item.subLabel}</div>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono-num text-slate-500 whitespace-nowrap">
                              {item.beforeValue}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono-num font-bold text-slate-900 whitespace-nowrap">
                              {item.afterValue}
                            </td>
                            <td
                              className={`py-2.5 px-4 text-right font-mono-num font-semibold whitespace-nowrap ${
                                delta > 0
                                  ? 'text-red-600'
                                  : delta < 0
                                  ? 'text-[#047857]'
                                  : 'text-slate-500'
                              }`}
                            >
                              {delta > 0 ? `+${delta}` : delta}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Confirmation Footer */}
            <div className="px-6 py-3.5 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 shrink-0">
              {source === 'manual_edit' ? (
                <button
                  type="button"
                  onClick={() => setStage('edit')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Kembali ke Editor</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Batal
                </button>
              )}

              <div className="flex items-center gap-2">
                {source === 'manual_edit' && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Batal
                  </button>
                )}
                <button
                  type="button"
                  disabled={totalChangesCount === 0}
                  onClick={handleConfirmSave}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#047857] text-white text-xs font-semibold hover:bg-[#065F46] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-xs"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Konfirmasi &amp; Simpan ke Firebase</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
