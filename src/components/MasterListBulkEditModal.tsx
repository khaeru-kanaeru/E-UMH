import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Cpu,
  FileSpreadsheet,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import {
  AutoCutItem,
  FeederItem,
  MasterChangeHistoryEntry,
  MasterChangeSource,
} from '../types/umh';
import {
  MASTER_SOURCE_LABELS,
  computeAutoCutDiff,
  computeFeederDiff,
  createMasterChangeEntry,
} from '../utils/masterDiffEngine';
import { loadLastPicName } from '../utils/storage';

interface MasterListBulkEditModalProps {
  kind: 'auto_cut' | 'feeder';
  currentAutoCut?: AutoCutItem[];
  currentFeeder?: FeederItem[];
  initialStage?: 'edit' | 'confirm';
  source: MasterChangeSource;
  sourceFileName?: string;
  sourceSheetName?: string;
  uploadedAutoCutItems?: AutoCutItem[];
  uploadedFeederItems?: FeederItem[];
  resetTargetAutoCut?: AutoCutItem[];
  resetTargetFeeder?: FeederItem[];
  onCommitAutoCut?: (
    nextList: AutoCutItem[],
    entry: MasterChangeHistoryEntry,
    removedItems: AutoCutItem[]
  ) => void;
  onCommitFeeder?: (
    nextList: FeederItem[],
    entry: MasterChangeHistoryEntry,
    removedItems: FeederItem[]
  ) => void;
  onClose: () => void;
}

interface EditableAcRow extends AutoCutItem {
  _deleted?: boolean;
  _isNew?: boolean;
}

interface EditableFdRow extends FeederItem {
  _deleted?: boolean;
  _isNew?: boolean;
}

export function MasterListBulkEditModal({
  kind,
  currentAutoCut = [],
  currentFeeder = [],
  initialStage = 'edit',
  source,
  sourceFileName,
  sourceSheetName,
  uploadedAutoCutItems,
  uploadedFeederItems,
  resetTargetAutoCut,
  resetTargetFeeder,
  onCommitAutoCut,
  onCommitFeeder,
  onClose,
}: MasterListBulkEditModalProps) {
  const isAc = kind === 'auto_cut';

  const [stage, setStage] = useState<'edit' | 'confirm'>(initialStage);
  const [uploadMode, setUploadMode] = useState<'replace' | 'merge'>('replace');

  // Bulk editable state for manual edit
  const [acRows, setAcRows] = useState<EditableAcRow[]>(() =>
    currentAutoCut.map((x) => ({ ...x }))
  );
  const [fdRows, setFdRows] = useState<EditableFdRow[]>(() =>
    currentFeeder.map((x) => ({ ...x }))
  );

  // Quick add row inputs
  const [newCust, setNewCust] = useState('All');
  const [newTerm, setNewTerm] = useState('');
  const [newSeal, setNewSeal] = useState('');

  // Filters inside editor
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);

  // Confirmation metadata
  const [picName, setPicName] = useState<string>(() => loadLastPicName());
  const [note, setNote] = useState<string>('');
  const [picError, setPicError] = useState<string | null>(null);

  const origAcMap = useMemo(
    () => new Map(currentAutoCut.map((x) => [x.id, x])),
    [currentAutoCut]
  );
  const origFdMap = useMemo(
    () => new Map(currentFeeder.map((x) => [x.id, x])),
    [currentFeeder]
  );

  // Compute the effective target list depending on source (manual / excel upload / reset)
  const targetAutoCut = useMemo<AutoCutItem[]>(() => {
    if (!isAc) return [];
    if (source === 'reset_default' && resetTargetAutoCut) {
      return resetTargetAutoCut;
    }
    if (source === 'excel_upload' && uploadedAutoCutItems) {
      if (uploadMode === 'replace') {
        return uploadedAutoCutItems;
      }
      const existingKeys = new Set(
        currentAutoCut.map(
          (x) => `${x.customer.trim().toLowerCase()}||${x.terminal.trim().toLowerCase()}`
        )
      );
      const additions = uploadedAutoCutItems.filter((x) => {
        const key = `${x.customer.trim().toLowerCase()}||${x.terminal.trim().toLowerCase()}`;
        return !existingKeys.has(key);
      });
      return [...additions, ...currentAutoCut];
    }
    return acRows
      .filter((r) => !r._deleted && r.terminal.trim() !== '')
      .map(({ _deleted: _d, _isNew: _n, ...item }) => ({
        ...item,
        customer: item.customer.trim() || 'All',
        terminal: item.terminal.trim(),
      }));
  }, [isAc, source, resetTargetAutoCut, uploadedAutoCutItems, uploadMode, currentAutoCut, acRows]);

  const targetFeeder = useMemo<FeederItem[]>(() => {
    if (isAc) return [];
    if (source === 'reset_default' && resetTargetFeeder) {
      return resetTargetFeeder;
    }
    if (source === 'excel_upload' && uploadedFeederItems) {
      if (uploadMode === 'replace') {
        return uploadedFeederItems;
      }
      const existingKeys = new Set(currentFeeder.map((x) => x.seal.trim().toLowerCase()));
      const additions = uploadedFeederItems.filter(
        (x) => !existingKeys.has(x.seal.trim().toLowerCase())
      );
      return [...additions, ...currentFeeder];
    }
    return fdRows
      .filter((r) => !r._deleted && r.seal.trim() !== '')
      .map(({ _deleted: _d, _isNew: _n, ...item }) => ({
        ...item,
        seal: item.seal.trim(),
      }));
  }, [isAc, source, resetTargetFeeder, uploadedFeederItems, uploadMode, currentFeeder, fdRows]);

  const acDiffResult = useMemo(
    () => (isAc ? computeAutoCutDiff(currentAutoCut, targetAutoCut) : { diffs: [], removedItems: [] }),
    [isAc, currentAutoCut, targetAutoCut]
  );

  const fdDiffResult = useMemo(
    () => (!isAc ? computeFeederDiff(currentFeeder, targetFeeder) : { diffs: [], removedItems: [] }),
    [isAc, currentFeeder, targetFeeder]
  );

  const activeDiffs = isAc ? acDiffResult.diffs : fdDiffResult.diffs;
  const addedCount = activeDiffs.filter((d) => d.action === 'added').length;
  const modifiedCount = activeDiffs.filter((d) => d.action === 'modified').length;
  const removedCount = activeDiffs.filter((d) => d.action === 'removed').length;

  const handleAddAcRow = (e: React.FormEvent) => {
    e.preventDefault();
    const term = newTerm.trim();
    if (!term) return;
    setAcRows((prev) => [
      {
        id: `acl_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        customer: newCust.trim() || 'All',
        terminal: term,
        process: 'auto cut',
        _isNew: true,
      },
      ...prev,
    ]);
    setNewTerm('');
  };

  const handleAddFdRow = (e: React.FormEvent) => {
    e.preventDefault();
    const seal = newSeal.trim();
    if (!seal) return;
    setFdRows((prev) => [
      {
        id: `fl_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        seal,
        process: 'auto feeder',
        _isNew: true,
      },
      ...prev,
    ]);
    setNewSeal('');
  };

  const filteredAcRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return acRows.filter((row) => {
      if (onlyChanged) {
        const orig = origAcMap.get(row.id);
        const isChanged =
          row._isNew ||
          row._deleted ||
          !orig ||
          orig.customer.trim() !== row.customer.trim() ||
          orig.terminal.trim() !== row.terminal.trim();
        if (!isChanged) return false;
      }
      if (!q) return true;
      return (
        row.terminal.toLowerCase().includes(q) || row.customer.toLowerCase().includes(q)
      );
    });
  }, [acRows, searchQuery, onlyChanged, origAcMap]);

  const filteredFdRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return fdRows.filter((row) => {
      if (onlyChanged) {
        const orig = origFdMap.get(row.id);
        const isChanged =
          row._isNew || row._deleted || !orig || orig.seal.trim() !== row.seal.trim();
        if (!isChanged) return false;
      }
      if (!q) return true;
      return row.seal.toLowerCase().includes(q);
    });
  }, [fdRows, searchQuery, onlyChanged, origFdMap]);

  const handleConfirmSave = () => {
    const trimmedPic = picName.trim();
    if (!trimmedPic) {
      setPicError('Nama penanggung jawab (PIC) wajib diisi sebelum menyimpan perubahan.');
      return;
    }
    if (activeDiffs.length === 0) {
      onClose();
      return;
    }

    const entry = createMasterChangeEntry({
      responsibleName: trimmedPic,
      category: isAc ? 'auto_cut' : 'feeder',
      source,
      sourceFileName,
      note:
        source === 'excel_upload'
          ? `${uploadMode === 'replace' ? 'Mode Replace' : 'Mode Merge'}${
              note.trim() ? ` · ${note.trim()}` : ''
            }`
          : note,
      totalItemsCount: isAc ? targetAutoCut.length : targetFeeder.length,
      changes: activeDiffs,
    });

    if (isAc && onCommitAutoCut) {
      onCommitAutoCut(targetAutoCut, entry, acDiffResult.removedItems);
    } else if (!isAc && onCommitFeeder) {
      onCommitFeeder(targetFeeder, entry, fdDiffResult.removedItems);
    }
  };

  const titleLabel = isAc ? 'Database Auto Cutting List' : 'Database Feeder List (Wire Seal)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-xs p-2 sm:p-4 print:hidden">
      <div className="glass-modal w-[95vw] max-w-5xl h-[88vh] rounded-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#1E3A8A]/10 text-[#1E3A8A] flex items-center justify-center shrink-0">
              {source === 'excel_upload' ? (
                <FileSpreadsheet className="w-4 h-4" />
              ) : (
                <Cpu className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-[#1E3A8A]">
                {stage === 'edit'
                  ? `一括編集 · Editor Massal ${titleLabel}`
                  : `保存確認 · Konfirmasi Perubahan (${MASTER_SOURCE_LABELS[source]})`}
              </p>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 truncate">
                {stage === 'edit'
                  ? `Edit Data ${titleLabel}`
                  : `Konfirmasi & Simpan ${titleLabel}`}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer shrink-0"
            aria-label="Tutup Modal Edit"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {stage === 'edit' ? (
          <>
            {/* Quick Add + Search Bar */}
            <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/90 flex flex-col lg:flex-row lg:items-center justify-between gap-3 shrink-0">
              {isAc ? (
                <form onSubmit={handleAddAcRow} className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={newCust}
                    onChange={(e) => setNewCust(e.target.value)}
                    placeholder="Customer"
                    className="w-28 px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                  />
                  <input
                    type="text"
                    value={newTerm}
                    onChange={(e) => setNewTerm(e.target.value)}
                    placeholder="Tambah kode terminal baru..."
                    className="w-52 px-3 py-1.5 text-xs font-mono-num font-medium bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleAddFdRow} className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={newSeal}
                    onChange={(e) => setNewSeal(e.target.value)}
                    placeholder="Tambah kode wire seal baru..."
                    className="w-64 px-3 py-1.5 text-xs font-mono-num font-medium bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah</span>
                  </button>
                </form>
              )}

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative w-52">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={isAc ? 'Cari customer / terminal...' : 'Cari kode wire seal...'}
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

                <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={onlyChanged}
                    onChange={(e) => setOnlyChanged(e.target.checked)}
                    className="rounded border-slate-300 text-[#1E3A8A] focus:ring-[#1E3A8A]"
                  />
                  <span>Hanya diubah</span>
                </label>
              </div>
            </div>

            {/* Bulk Editable Table */}
            <div className="flex-1 min-h-0 overflow-auto p-6 bg-[#f8fafc]">
              <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
                {isAc ? (
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                        <th className="py-2.5 px-4 w-44">Customer</th>
                        <th className="py-2.5 px-4">Item Terminal</th>
                        <th className="py-2.5 px-4 w-28">Status</th>
                        <th className="py-2.5 px-4 text-right w-24">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 text-xs">
                      {filteredAcRows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-10 text-center text-slate-500">
                            Tidak ada data terminal yang cocok.
                          </td>
                        </tr>
                      ) : (
                        filteredAcRows.map((row) => {
                          const orig = origAcMap.get(row.id);
                          const isModified =
                            !row._isNew &&
                            !row._deleted &&
                            orig &&
                            (orig.customer.trim() !== row.customer.trim() ||
                              orig.terminal.trim() !== row.terminal.trim());
                          return (
                            <tr
                              key={row.id}
                              className={
                                row._deleted
                                  ? 'bg-red-50/70 opacity-75'
                                  : row._isNew
                                  ? 'bg-emerald-50/50'
                                  : isModified
                                  ? 'bg-blue-50/50'
                                  : 'hover:bg-slate-50/70'
                              }
                            >
                              <td className="py-2 px-4">
                                <input
                                  type="text"
                                  disabled={row._deleted}
                                  value={row.customer}
                                  onChange={(e) =>
                                    setAcRows((prev) =>
                                      prev.map((x) =>
                                        x.id === row.id ? { ...x, customer: e.target.value } : x
                                      )
                                    )
                                  }
                                  className="w-full px-2.5 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-[#1E3A8A] disabled:line-through disabled:bg-transparent"
                                />
                              </td>
                              <td className="py-2 px-4">
                                <input
                                  type="text"
                                  disabled={row._deleted}
                                  value={row.terminal}
                                  onChange={(e) =>
                                    setAcRows((prev) =>
                                      prev.map((x) =>
                                        x.id === row.id ? { ...x, terminal: e.target.value } : x
                                      )
                                    )
                                  }
                                  className="w-full px-2.5 py-1.5 text-xs font-mono-num font-semibold bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-[#1E3A8A] disabled:line-through disabled:bg-transparent"
                                />
                              </td>
                              <td className="py-2 px-4 whitespace-nowrap font-semibold">
                                {row._deleted ? (
                                  <span className="text-red-600">Dihapus</span>
                                ) : row._isNew ? (
                                  <span className="text-[#047857]">Baru</span>
                                ) : isModified ? (
                                  <span className="text-[#1E3A8A]">Diubah</span>
                                ) : (
                                  <span className="text-slate-400 font-normal">Tetap</span>
                                )}
                              </td>
                              <td className="py-2 px-4 text-right whitespace-nowrap">
                                {row._deleted ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setAcRows((prev) =>
                                        prev.map((x) =>
                                          x.id === row.id ? { ...x, _deleted: false } : x
                                        )
                                      )
                                    }
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                    <span>Batal</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (row._isNew) {
                                        setAcRows((prev) => prev.filter((x) => x.id !== row.id));
                                      } else {
                                        setAcRows((prev) =>
                                          prev.map((x) =>
                                            x.id === row.id ? { ...x, _deleted: true } : x
                                          )
                                        );
                                      }
                                    }}
                                    className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"
                                    aria-label={`Hapus ${row.terminal}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                        <th className="py-2.5 px-4">Item Seal (Rubber Wire Seal)</th>
                        <th className="py-2.5 px-4 w-28">Status</th>
                        <th className="py-2.5 px-4 text-right w-24">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 text-xs">
                      {filteredFdRows.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="py-10 text-center text-slate-500">
                            Tidak ada data wire seal yang cocok.
                          </td>
                        </tr>
                      ) : (
                        filteredFdRows.map((row) => {
                          const orig = origFdMap.get(row.id);
                          const isModified =
                            !row._isNew &&
                            !row._deleted &&
                            orig &&
                            orig.seal.trim() !== row.seal.trim();
                          return (
                            <tr
                              key={row.id}
                              className={
                                row._deleted
                                  ? 'bg-red-50/70 opacity-75'
                                  : row._isNew
                                  ? 'bg-emerald-50/50'
                                  : isModified
                                  ? 'bg-blue-50/50'
                                  : 'hover:bg-slate-50/70'
                              }
                            >
                              <td className="py-2 px-4">
                                <input
                                  type="text"
                                  disabled={row._deleted}
                                  value={row.seal}
                                  onChange={(e) =>
                                    setFdRows((prev) =>
                                      prev.map((x) =>
                                        x.id === row.id ? { ...x, seal: e.target.value } : x
                                      )
                                    )
                                  }
                                  className="w-full px-2.5 py-1.5 text-xs font-mono-num font-semibold bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-[#1E3A8A] disabled:line-through disabled:bg-transparent"
                                />
                              </td>
                              <td className="py-2 px-4 whitespace-nowrap font-semibold">
                                {row._deleted ? (
                                  <span className="text-red-600">Dihapus</span>
                                ) : row._isNew ? (
                                  <span className="text-[#047857]">Baru</span>
                                ) : isModified ? (
                                  <span className="text-[#1E3A8A]">Diubah</span>
                                ) : (
                                  <span className="text-slate-400 font-normal">Tetap</span>
                                )}
                              </td>
                              <td className="py-2 px-4 text-right whitespace-nowrap">
                                {row._deleted ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setFdRows((prev) =>
                                        prev.map((x) =>
                                          x.id === row.id ? { ...x, _deleted: false } : x
                                        )
                                      )
                                    }
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                    <span>Batal</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (row._isNew) {
                                        setFdRows((prev) => prev.filter((x) => x.id !== row.id));
                                      } else {
                                        setFdRows((prev) =>
                                          prev.map((x) =>
                                            x.id === row.id ? { ...x, _deleted: true } : x
                                          )
                                        );
                                      }
                                    }}
                                    className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"
                                    aria-label={`Hapus ${row.seal}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Edit Footer */}
            <div className="px-6 py-3.5 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 font-mono-num">
                <span className="font-semibold text-slate-900">
                  {activeDiffs.length} perubahan
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-[#047857]">+{addedCount} Ditambah</span>
                <span aria-hidden="true">·</span>
                <span className="text-[#1E3A8A]">~{modifiedCount} Diubah</span>
                <span aria-hidden="true">·</span>
                <span className="text-red-600">-{removedCount} Dihapus</span>
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
                  disabled={activeDiffs.length === 0}
                  onClick={() => setStage('confirm')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-xs"
                >
                  <span>Lanjut Konfirmasi Simpan ({activeDiffs.length})</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Confirmation Body */}
            <div className="flex-1 min-h-0 overflow-auto p-6 bg-[#f8fafc] space-y-4">
              {source === 'excel_upload' && sourceFileName && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs text-[#1E3A8A]">
                    <p className="font-bold">
                      File Excel: <span className="font-mono-num">{sourceFileName}</span>
                      {sourceSheetName && sourceSheetName !== sourceFileName && (
                        <span className="font-normal"> (Sheet: {sourceSheetName})</span>
                      )}
                    </p>
                    <p className="text-blue-900/80 mt-0.5">
                      Pilih metode penerapan: ganti seluruh daftar atau tambahkan item baru saja.
                    </p>
                  </div>
                  <div className="inline-flex items-center p-1 rounded-xl bg-white border border-blue-200 shrink-0 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setUploadMode('replace')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                        uploadMode === 'replace'
                          ? 'bg-[#1E3A8A] text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Ganti Semua
                    </button>
                    <button
                      type="button"
                      onClick={() => setUploadMode('merge')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                        uploadMode === 'merge'
                          ? 'bg-[#047857] text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Tambah Baru Saja
                    </button>
                  </div>
                </div>
              )}

              {/* PIC & Note */}
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
                    placeholder="Contoh: Budi Santoso / PE Team"
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
                    placeholder="Contoh: Tambah terminal baru model 2026"
                    className="w-full px-3.5 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                  />
                </div>
              </div>

              {removedCount > 0 && (
                <div className="px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <strong>{removedCount} item yang dihapus</strong> akan otomatis dipindahkan ke{' '}
                  <strong>Recycle Bin</strong> sehingga tetap dapat di-restore sewaktu-waktu.
                </div>
              )}

              {/* Diff Table */}
              {activeDiffs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center space-y-2">
                  <CheckCircle2 className="w-7 h-7 text-[#047857] mx-auto" />
                  <p className="text-sm font-bold text-slate-900">
                    Tidak Ada Perubahan Data Terdeteksi
                  </p>
                  <p className="text-xs text-slate-500">
                    Daftar item sudah identik dengan data aktif saat ini.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
                  <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
                    <h3 className="text-xs font-bold text-slate-900">
                      Pratinjau Detail Perubahan ({activeDiffs.length} item)
                    </h3>
                    <span className="text-[11px] text-slate-500 font-mono-num">
                      +{addedCount} Ditambah · ~{modifiedCount} Diubah · -{removedCount} Dihapus
                    </span>
                  </div>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-600">
                        <th className="py-2.5 px-4 w-28">Status</th>
                        <th className="py-2.5 px-4">Item</th>
                        <th className="py-2.5 px-4">Nilai Sebelum</th>
                        <th className="py-2.5 px-4">Nilai Sesudah</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 text-xs">
                      {activeDiffs.map((item) => (
                        <tr key={item.key} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-4 font-semibold whitespace-nowrap">
                            {item.action === 'added' ? (
                              <span className="text-[#047857]">Ditambah</span>
                            ) : item.action === 'removed' ? (
                              <span className="text-red-600">Dihapus</span>
                            ) : (
                              <span className="text-[#1E3A8A]">Diubah</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 font-mono-num font-semibold text-slate-900">
                            {item.label}
                          </td>
                          <td className="py-2.5 px-4 font-mono-num text-slate-500">
                            {item.beforeValue}
                          </td>
                          <td className="py-2.5 px-4 font-mono-num font-semibold text-slate-900">
                            {item.afterValue}
                          </td>
                        </tr>
                      ))}
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
                  disabled={activeDiffs.length === 0}
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
