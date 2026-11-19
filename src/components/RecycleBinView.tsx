import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Copy,
  Cpu,
  Database,
  Disc,
  ExternalLink,
  History,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { RecycleBinItem, RecycleBinItemType } from '../types/umh';

interface RecycleBinViewProps {
  items: RecycleBinItem[];
  isCloudActive: boolean;
  recycleBinNeedsRulesPublish: boolean;
  onCopyRules: () => Promise<boolean>;
  onRetryCloudSync: () => void;
  onRestoreItem: (item: RecycleBinItem) => void;
  onPermanentDeleteItem: (binId: string) => void;
  onEmptyRecycleBin: () => void;
}

const TYPE_META: Record<
  RecycleBinItemType,
  { label: string; shortLabel: string; colorClass: string; icon: typeof Database }
> = {
  assy_record: {
    label: 'Database Assy',
    shortLabel: 'Assy',
    colorClass: 'text-[#1E3A8A]',
    icon: Database,
  },
  auto_cut_item: {
    label: 'Auto-Cut Terminal',
    shortLabel: 'Auto-Cut',
    colorClass: 'text-[#047857]',
    icon: Cpu,
  },
  feeder_item: {
    label: 'Feeder Seal',
    shortLabel: 'Feeder',
    colorClass: 'text-teal-700',
    icon: Cpu,
  },
  refresh_history: {
    label: 'Riwayat Refresh',
    shortLabel: 'Riwayat',
    colorClass: 'text-amber-700',
    icon: History,
  },
  process_disc: {
    label: 'Logic Disc Kustom',
    shortLabel: 'Logic Disc',
    colorClass: 'text-indigo-700',
    icon: Disc,
  },
};

function formatDeletedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function RecycleBinView({
  items,
  isCloudActive,
  recycleBinNeedsRulesPublish,
  onCopyRules,
  onRetryCloudSync,
  onRestoreItem,
  onPermanentDeleteItem,
  onEmptyRecycleBin,
}: RecycleBinViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | RecycleBinItemType>('all');
  const [confirmPermanentId, setConfirmPermanentId] = useState<string | null>(null);
  const [confirmEmptyAll, setConfirmEmptyAll] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [copiedRules, setCopiedRules] = useState(false);

  const counts = useMemo(() => {
    const map: Record<'all' | RecycleBinItemType, number> = {
      all: items.length,
      assy_record: 0,
      auto_cut_item: 0,
      feeder_item: 0,
      refresh_history: 0,
      process_disc: 0,
    };
    items.forEach((it) => {
      if (it.itemType in map) {
        map[it.itemType] += 1;
      }
    });
    return map;
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (typeFilter !== 'all' && item.itemType !== typeFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        TYPE_META[item.itemType].label.toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery, typeFilter]);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => {
      setFeedback((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  const handleRestore = (item: RecycleBinItem) => {
    onRestoreItem(item);
    setConfirmPermanentId(null);
    showFeedback(
      `"${item.title}" berhasil dipulihkan (restore) ke ${TYPE_META[item.itemType].label}.`
    );
  };

  const handlePermanentDelete = (item: RecycleBinItem) => {
    onPermanentDeleteItem(item.id);
    setConfirmPermanentId(null);
    showFeedback(`"${item.title}" dihapus permanen dari Recycle Bin.`);
  };

  const handleConfirmEmptyAll = () => {
    const total = items.length;
    onEmptyRecycleBin();
    setConfirmEmptyAll(false);
    showFeedback(`${total} item di Recycle Bin telah dihapus permanen.`);
  };

  const filterTabs: { id: 'all' | RecycleBinItemType; label: string }[] = [
    { id: 'all', label: 'Semua' },
    { id: 'assy_record', label: 'Assy' },
    { id: 'auto_cut_item', label: 'Auto-Cut' },
    { id: 'feeder_item', label: 'Feeder' },
    { id: 'refresh_history', label: 'Riwayat Refresh' },
    { id: 'process_disc', label: 'Logic Disc' },
  ];

  return (
    <div className="space-y-5">
      <div className="glass-surface rounded-2xl p-6">
        {/* Header */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-5 border-b border-slate-200">
          <div>
            <p className="text-[11px] font-semibold text-[#1E3A8A]">
              ゴミ箱 · Direktori Recycle Bin Firebase
            </p>
            <h1 className="text-xl font-bold text-slate-900 mt-0.5">Recycle Bin</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {isCloudActive ? (
                <>
                  Data yang dihapus dipindahkan ke direktori{' '}
                  <span className="font-mono-num font-semibold text-slate-700">recycleBin</span> di
                  server Firebase sehingga aman dipulihkan kapan saja.
                </>
              ) : (
                <>
                  Data yang dihapus disimpan sementara di Recycle Bin lokal. Masuk Google untuk
                  menyinkronkan direktori{' '}
                  <span className="font-mono-num font-semibold text-slate-700">recycleBin</span> ke
                  server Firebase.
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari item terhapus..."
                className="pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A] w-56 transition-colors"
              />
            </div>

            {items.length > 0 &&
              (confirmEmptyAll ? (
                <div className="inline-flex items-center gap-1.5 bg-red-50 border border-red-200 px-3 py-1.5 rounded-xl">
                  <span className="text-xs font-medium text-red-700">
                    Hapus permanen {items.length} item?
                  </span>
                  <button
                    type="button"
                    onClick={handleConfirmEmptyAll}
                    className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
                  >
                    Ya, Kosongkan
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmEmptyAll(false)}
                    className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 cursor-pointer"
                  >
                    Batal
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmEmptyAll(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Kosongkan Recycle Bin</span>
                </button>
              ))}
          </div>
        </div>

        {/* Filter Bar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center p-1 rounded-xl bg-slate-100 border border-slate-200">
            {filterTabs.map((tab) => {
              const active = typeFilter === tab.id;
              const count = counts[tab.id];
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTypeFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className="ml-1.5 font-mono-num text-[11px] opacity-75">({count})</span>
                  )}
                </button>
              );
            })}
          </div>

          {isCloudActive && !recycleBinNeedsRulesPublish && (
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[#047857]">
              <Cloud className="w-3.5 h-3.5" />
              <span>Tersinkron langsung ke Firebase /recycleBin</span>
            </div>
          )}
        </div>

        {/* Rules Publish Guidance for (default) database */}
        {isCloudActive && recycleBinNeedsRulesPublish && (
          <div className="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  Aturan koleksi <span className="font-mono-num">/recycleBin</span> belum dipublikasikan di database{' '}
                  <span className="font-mono-num">(default)</span> proyek{' '}
                  <span className="font-mono-num">estdumh</span>.
                </p>
                <p className="text-amber-900/90 mt-0.5">
                  Klik <strong>Salin Firestore Rules</strong>, tempel pada halaman Rules database{' '}
                  <span className="font-mono-num">(default)</span> lalu klik <strong>Publish</strong>, kemudian klik{' '}
                  <strong>Sinkronkan Ulang</strong>.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  const ok = await onCopyRules();
                  if (ok) {
                    setCopiedRules(true);
                    setTimeout(() => setCopiedRules(false), 3000);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-900 text-white text-xs font-semibold hover:bg-amber-950 cursor-pointer whitespace-nowrap"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedRules ? 'Rules Tersalin!' : 'Salin Firestore Rules'}</span>
              </button>
              <a
                href="https://console.firebase.google.com/project/estdumh/firestore/databases/-default-/rules"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-950 text-xs font-semibold hover:bg-amber-100 whitespace-nowrap"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Buka Rules (default)</span>
              </a>
              <button
                type="button"
                onClick={onRetryCloudSync}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Sinkronkan Ulang</span>
              </button>
            </div>
          </div>
        )}

        {/* Feedback Banner */}
        {feedback && (
          <div className="mt-4 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-[#047857] flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>{feedback}</span>
            </span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-emerald-700 hover:text-emerald-950 cursor-pointer"
              aria-label="Tutup pemberitahuan"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Content Table */}
        <div className="mt-5">
          {filteredItems.length === 0 ? (
            <div className="py-14 text-center border border-dashed border-slate-300 rounded-2xl bg-slate-50/70">
              <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                <Trash2 className="w-5 h-5" />
              </div>
              <p className="text-sm font-semibold text-slate-800">
                {items.length === 0
                  ? 'Recycle Bin kosong'
                  : 'Tidak ada item terhapus yang cocok dengan filter'}
              </p>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Saat Anda menghapus data Assy, Auto-Cut Terminal, Feeder Seal, Riwayat Refresh,
                atau Logic Disc kustom, item akan dipindahkan ke sini agar mudah dipulihkan.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 overflow-x-auto bg-white">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-3 px-4 whitespace-nowrap">Kategori</th>
                    <th className="py-3 px-4">Item &amp; Detail</th>
                    <th className="py-3 px-4 whitespace-nowrap">Koleksi Asal</th>
                    <th className="py-3 px-4 whitespace-nowrap">Waktu Dihapus</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80 text-sm">
                  {filteredItems.map((item) => {
                    const meta = TYPE_META[item.itemType] || TYPE_META.assy_record;
                    const Icon = meta.icon;
                    const isConfirming = confirmPermanentId === item.id;

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/90 transition-colors">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.colorClass}`}
                          >
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            <span>{meta.label}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 font-mono-num">
                            {item.title}
                          </div>
                          {item.subtitle && (
                            <div className="text-xs text-slate-500 mt-0.5">{item.subtitle}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-mono-num text-xs text-slate-600">
                            /{item.originalCollection}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap font-mono-num text-xs text-slate-600">
                          {formatDeletedAt(item.deletedAt)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleRestore(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#047857] text-white text-xs font-semibold hover:bg-[#065F46] transition-colors cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Restore</span>
                            </button>

                            {isConfirming ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handlePermanentDelete(item)}
                                  className="px-2.5 py-1.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
                                >
                                  Hapus Permanen
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmPermanentId(null)}
                                  className="px-2.5 py-1.5 rounded-xl bg-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-300 cursor-pointer"
                                >
                                  Batal
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmPermanentId(item.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                                aria-label={`Hapus permanen ${item.title}`}
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
        </div>
      </div>
    </div>
  );
}
