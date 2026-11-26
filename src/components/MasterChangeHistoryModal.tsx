import { useMemo, useState } from 'react';
import {
  CalendarClock,
  FileSpreadsheet,
  History,
  Search,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { MasterChangeCategory, MasterChangeHistoryEntry } from '../types/umh';
import {
  MASTER_CATEGORY_LABELS,
  MASTER_SOURCE_LABELS,
} from '../utils/masterDiffEngine';
import { formatRefreshDateTime } from '../utils/refreshHistoryExporter';
import { exportMasterChangeHistoryExcel } from '../utils/stdExcelHelper';

interface MasterChangeHistoryModalProps {
  history: MasterChangeHistoryEntry[];
  initialCategory?: 'all' | MasterChangeCategory;
  onDeleteEntry: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

const CATEGORY_TABS: { id: 'all' | MasterChangeCategory; label: string }[] = [
  { id: 'all', label: 'Semua' },
  { id: 'assy_manual_edit', label: 'Edit Assy' },
  { id: 'std_params', label: 'Sub-Step' },
  { id: 'std_matrices', label: 'Matriks 2D' },
  { id: 'auto_cut', label: 'Auto-Cut' },
  { id: 'feeder', label: 'Feeder' },
];

export function MasterChangeHistoryModal({
  history,
  initialCategory = 'all',
  onDeleteEntry,
  onClearAll,
  onClose,
}: MasterChangeHistoryModalProps) {
  const [categoryFilter, setCategoryFilter] = useState<'all' | MasterChangeCategory>(
    initialCategory
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(() => history[0]?.id ?? null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const filteredHistory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return history.filter((entry) => {
      if (categoryFilter !== 'all' && entry.category !== categoryFilter) return false;
      if (!q) return true;
      const timeStr = formatRefreshDateTime(entry.changedAt).toLowerCase();
      return (
        entry.responsibleName.toLowerCase().includes(q) ||
        timeStr.includes(q) ||
        MASTER_CATEGORY_LABELS[entry.category].toLowerCase().includes(q) ||
        (entry.sourceFileName || '').toLowerCase().includes(q) ||
        (entry.note || '').toLowerCase().includes(q) ||
        entry.changes.some(
          (c) =>
            c.label.toLowerCase().includes(q) ||
            c.group.toLowerCase().includes(q) ||
            c.beforeValue.toLowerCase().includes(q) ||
            c.afterValue.toLowerCase().includes(q)
        )
      );
    });
  }, [history, categoryFilter, searchQuery]);

  const selectedEntry = useMemo(() => {
    if (filteredHistory.length === 0) return null;
    return filteredHistory.find((e) => e.id === selectedId) ?? filteredHistory[0];
  }, [filteredHistory, selectedId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-2 sm:p-4 print:hidden">
      <div className="glass-modal w-[96vw] max-w-7xl h-[90vh] rounded-2xl flex flex-col overflow-hidden">
        {/* Top Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#1E3A8A]/10 text-[#1E3A8A] flex items-center justify-center shrink-0">
              <History className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#1E3A8A]">
                変更履歴 · Audit Log Master &amp; Perubahan Manual Assy
              </p>
              <h2 className="text-lg font-bold text-slate-900">
                Riwayat Perubahan Master STD, Equipment List &amp; Edit Manual Assy
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {history.length > 0 &&
              (confirmClearAll ? (
                <div className="inline-flex items-center gap-1.5 bg-red-50 border border-red-200 px-2.5 py-1.5 rounded-xl">
                  <span className="text-xs font-medium text-red-700 whitespace-nowrap">
                    Hapus seluruh riwayat master?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onClearAll();
                      setConfirmClearAll(false);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
                  >
                    Ya
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 cursor-pointer"
                  >
                    Batal
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Bersihkan Riwayat</span>
                </button>
              ))}

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
              aria-label="Tutup Riwayat Perubahan Master"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body: Master-Detail Split */}
        {history.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 bg-[#f8fafc]">
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 max-w-md text-center space-y-2.5">
              <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
                <History className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">
                Belum Ada Riwayat Perubahan Master Data
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Setiap perubahan pada <strong>Parameter STD</strong>, <strong>Matriks 2D</strong>,{' '}
                <strong>Auto Cutting List</strong>, <strong>Feeder List</strong>, maupun{' '}
                <strong>Perubahan Manual pada Assy</strong> (parameter, allowance, tingkat kesulitan, atau BOM/PPCS/COT) akan tercatat lengkap di sini beserta nama PIC Google.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row bg-[#f8fafc]">
            {/* Left Sidebar: Log List */}
            <aside className="w-full lg:w-90 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 bg-white flex flex-col max-h-72 lg:max-h-none">
              <div className="p-3.5 border-b border-slate-200 space-y-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari PIC, item, atau file Excel..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                  />
                </div>

                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200 overflow-x-auto">
                  {CATEGORY_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setCategoryFilter(tab.id)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                        categoryFilter === tab.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                {filteredHistory.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    Tidak ada riwayat sesuai filter.
                  </div>
                ) : (
                  filteredHistory.map((entry) => {
                    const isSelected = selectedEntry?.id === entry.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => {
                          setSelectedId(entry.id);
                          setConfirmDeleteId(null);
                        }}
                        className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                          isSelected ? 'bg-blue-50/80' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="font-semibold text-[#1E3A8A] truncate">
                            {MASTER_CATEGORY_LABELS[entry.category]}
                          </span>
                          <span className="font-mono-num text-slate-500 shrink-0">
                            {formatRefreshDateTime(entry.changedAt)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                          <span className="font-bold text-slate-900 truncate">
                            {entry.responsibleName}
                          </span>
                          <span className="text-[11px] text-slate-500 shrink-0">
                            {MASTER_SOURCE_LABELS[entry.source]}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] font-mono-num">
                          {entry.addedCount > 0 && (
                            <span className="text-[#047857] font-semibold">
                              +{entry.addedCount}
                            </span>
                          )}
                          {entry.modifiedCount > 0 && (
                            <span className="text-[#1E3A8A] font-semibold">
                              ~{entry.modifiedCount}
                            </span>
                          )}
                          {entry.removedCount > 0 && (
                            <span className="text-red-600 font-semibold">
                              -{entry.removedCount}
                            </span>
                          )}
                          {entry.sourceFileName && (
                            <span className="text-slate-400 truncate">
                              · {entry.sourceFileName}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            {/* Right Detail Pane */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              {selectedEntry ? (
                <>
                  {/* Detail Header */}
                  <div className="px-6 py-4 bg-white border-b border-slate-200 flex flex-col sm:flex-row sm:items-start justify-between gap-4 shrink-0">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-semibold text-[#1E3A8A]">
                          {MASTER_CATEGORY_LABELS[selectedEntry.category]}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{MASTER_SOURCE_LABELS[selectedEntry.source]}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-num">{selectedEntry.id}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700 pt-0.5">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                          <UserCheck className="w-3.5 h-3.5 text-[#1E3A8A]" />
                          PIC: {selectedEntry.responsibleName}
                        </span>
                        <span className="inline-flex items-center gap-1.5 font-mono-num text-slate-600">
                          <CalendarClock className="w-3.5 h-3.5 text-slate-400" />
                          {formatRefreshDateTime(selectedEntry.changedAt)}
                        </span>
                      </div>

                      {(selectedEntry.sourceFileName || selectedEntry.note) && (
                        <p className="text-xs text-slate-500 pt-0.5">
                          {selectedEntry.sourceFileName && (
                            <span>
                              File:{' '}
                              <strong className="font-mono-num text-slate-700">
                                {selectedEntry.sourceFileName}
                              </strong>
                            </span>
                          )}
                          {selectedEntry.sourceFileName && selectedEntry.note && ' · '}
                          {selectedEntry.note && <span>Catatan: {selectedEntry.note}</span>}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => exportMasterChangeHistoryExcel(selectedEntry)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#047857] text-white text-xs font-semibold hover:bg-[#065F46] transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        <span>Export Excel</span>
                      </button>

                      {confirmDeleteId === selectedEntry.id ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteEntry(selectedEntry.id);
                              setConfirmDeleteId(null);
                            }}
                            className="px-2.5 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
                          >
                            Hapus
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2.5 py-2 rounded-xl bg-slate-200 text-slate-700 text-xs font-medium cursor-pointer"
                          >
                            Batal
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(selectedEntry.id)}
                          className="p-2 rounded-xl bg-white border border-slate-200 text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                          aria-label="Hapus log riwayat ini"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Flat Summary Metrics Row */}
                  <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 grid grid-cols-3 gap-4 text-xs shrink-0">
                    <div>
                      <span className="text-slate-500">Ditambah</span>
                      <p className="text-base font-bold font-mono-num text-[#047857]">
                        +{selectedEntry.addedCount}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">Diubah</span>
                      <p className="text-base font-bold font-mono-num text-[#1E3A8A]">
                        ~{selectedEntry.modifiedCount}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">Dihapus</span>
                      <p className="text-base font-bold font-mono-num text-red-600">
                        -{selectedEntry.removedCount}
                      </p>
                    </div>
                  </div>

                  {/* Detail Diff Table */}
                  <div className="flex-1 overflow-auto p-6">
                    <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                            <th className="py-2.5 px-4 w-24">Status</th>
                            <th className="py-2.5 px-4">Grup / Sheet</th>
                            <th className="py-2.5 px-4">Item / Sel</th>
                            <th className="py-2.5 px-4 text-right">Sebelum</th>
                            <th className="py-2.5 px-4 text-right">Sesudah</th>
                            <th className="py-2.5 px-4 text-right">Selisih</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/70 text-xs">
                          {selectedEntry.changes.map((c, idx) => (
                            <tr key={`${c.key}_${idx}`} className="hover:bg-slate-50/70">
                              <td className="py-2.5 px-4 font-semibold whitespace-nowrap">
                                {c.action === 'added' ? (
                                  <span className="text-[#047857]">Ditambah</span>
                                ) : c.action === 'removed' ? (
                                  <span className="text-red-600">Dihapus</span>
                                ) : (
                                  <span className="text-[#1E3A8A]">Diubah</span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 font-medium text-slate-700 whitespace-nowrap">
                                {c.group}
                              </td>
                              <td className="py-2.5 px-4">
                                <div className="font-semibold text-slate-900">{c.label}</div>
                                {c.subLabel && (
                                  <div className="text-[11px] text-slate-500">{c.subLabel}</div>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono-num text-slate-500 whitespace-nowrap">
                                {c.beforeValue}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono-num font-bold text-slate-900 whitespace-nowrap">
                                {c.afterValue}
                              </td>
                              <td
                                className={`py-2.5 px-4 text-right font-mono-num font-semibold whitespace-nowrap ${
                                  typeof c.deltaNumeric === 'number'
                                    ? c.deltaNumeric > 0
                                      ? 'text-red-600'
                                      : c.deltaNumeric < 0
                                      ? 'text-[#047857]'
                                      : 'text-slate-500'
                                    : 'text-slate-400'
                                }`}
                              >
                                {typeof c.deltaNumeric === 'number'
                                  ? c.deltaNumeric > 0
                                    ? `+${c.deltaNumeric}`
                                    : String(c.deltaNumeric)
                                  : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-slate-500">
                  Pilih salah satu riwayat perubahan di sebelah kiri.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
