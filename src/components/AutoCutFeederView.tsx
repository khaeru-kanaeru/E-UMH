import { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  History,
  Pencil,
  RotateCcw,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { DEFAULT_AUTO_CUT_LIST, DEFAULT_FEEDER_LIST } from '../data/defaultStdDb';
import {
  AutoCutItem,
  FeederItem,
  MasterChangeHistoryEntry,
  MasterChangeSource,
} from '../types/umh';
import {
  exportAutoCutTemplateXlsx,
  exportFeederTemplateXlsx,
  parseAutoCutExcelFile,
  parseFeederExcelFile,
} from '../utils/excelParser';
import { ActionMenu } from './ActionMenu';
import { MasterListBulkEditModal } from './MasterListBulkEditModal';

interface AutoCutFeederViewProps {
  autoCutList: AutoCutItem[];
  feederList: FeederItem[];
  autoCutHistoryCount: number;
  feederHistoryCount: number;
  onOpenMasterHistory: (cat: 'auto_cut' | 'feeder') => void;
  onCommitAutoCutChange: (
    nextList: AutoCutItem[],
    entry: MasterChangeHistoryEntry,
    removedItems: AutoCutItem[]
  ) => void;
  onCommitFeederChange: (
    nextList: FeederItem[],
    entry: MasterChangeHistoryEntry,
    removedItems: FeederItem[]
  ) => void;
}

interface BulkModalState {
  kind: 'auto_cut' | 'feeder';
  initialStage: 'edit' | 'confirm';
  source: MasterChangeSource;
  sourceFileName?: string;
  sourceSheetName?: string;
  uploadedAutoCutItems?: AutoCutItem[];
  uploadedFeederItems?: FeederItem[];
  resetTargetAutoCut?: AutoCutItem[];
  resetTargetFeeder?: FeederItem[];
}

export function AutoCutFeederView({
  autoCutList,
  feederList,
  autoCutHistoryCount,
  feederHistoryCount,
  onOpenMasterHistory,
  onCommitAutoCutChange,
  onCommitFeederChange,
}: AutoCutFeederViewProps) {
  const [searchAc, setSearchAc] = useState('');
  const [acUploading, setAcUploading] = useState(false);
  const [acNotice, setAcNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const acFileRef = useRef<HTMLInputElement>(null);

  const [searchFd, setSearchFd] = useState('');
  const [fdUploading, setFdUploading] = useState(false);
  const [fdNotice, setFdNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fdFileRef = useRef<HTMLInputElement>(null);

  const [bulkModal, setBulkModal] = useState<BulkModalState | null>(null);

  const showAcNotice = (kind: 'ok' | 'err', text: string) => {
    setAcNotice({ kind, text });
    if (kind === 'ok') {
      setTimeout(() => {
        setAcNotice((prev) => (prev?.text === text ? null : prev));
      }, 4500);
    }
  };

  const showFdNotice = (kind: 'ok' | 'err', text: string) => {
    setFdNotice({ kind, text });
    if (kind === 'ok') {
      setTimeout(() => {
        setFdNotice((prev) => (prev?.text === text ? null : prev));
      }, 4500);
    }
  };

  const filteredAc = useMemo(() => {
    const q = searchAc.trim().toLowerCase();
    if (!q) return autoCutList;
    return autoCutList.filter(
      (x) =>
        x.terminal.toLowerCase().includes(q) || x.customer.toLowerCase().includes(q)
    );
  }, [autoCutList, searchAc]);

  const filteredFd = useMemo(() => {
    const q = searchFd.trim().toLowerCase();
    if (!q) return feederList;
    return feederList.filter((x) => x.seal.toLowerCase().includes(q));
  }, [feederList, searchFd]);

  const handleAcFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setAcUploading(true);
    setAcNotice(null);
    try {
      const parsed = await parseAutoCutExcelFile(file);
      if (parsed.items.length === 0) {
        showAcNotice(
          'err',
          `Tidak ditemukan data terminal valid pada "${file.name}". Pastikan kolom "Item Terminal" (dan opsional "Customer") terisi.`
        );
        return;
      }
      setBulkModal({
        kind: 'auto_cut',
        initialStage: 'confirm',
        source: 'excel_upload',
        sourceFileName: file.name,
        sourceSheetName: parsed.sheetName,
        uploadedAutoCutItems: parsed.items,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showAcNotice('err', `Gagal membaca file "${file.name}": ${msg}`);
    } finally {
      setAcUploading(false);
    }
  };

  const handleFdFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setFdUploading(true);
    setFdNotice(null);
    try {
      const parsed = await parseFeederExcelFile(file);
      if (parsed.items.length === 0) {
        showFdNotice(
          'err',
          `Tidak ditemukan data seal valid pada "${file.name}". Pastikan kolom "Item Seal" terisi.`
        );
        return;
      }
      setBulkModal({
        kind: 'feeder',
        initialStage: 'confirm',
        source: 'excel_upload',
        sourceFileName: file.name,
        sourceSheetName: parsed.sheetName,
        uploadedFeederItems: parsed.items,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showFdNotice('err', `Gagal membaca file "${file.name}": ${msg}`);
    } finally {
      setFdUploading(false);
    }
  };

  const handleCommitAc = (
    nextList: AutoCutItem[],
    entry: MasterChangeHistoryEntry,
    removedItems: AutoCutItem[]
  ) => {
    onCommitAutoCutChange(nextList, entry, removedItems);
    setBulkModal(null);
    setSearchAc('');
    showAcNotice(
      'ok',
      `Auto Cutting List diperbarui oleh ${entry.responsibleName} (${entry.changes.length} perubahan · total ${nextList.length} item).${
        removedItems.length > 0 ? ` ${removedItems.length} item dihapus dipindahkan ke Recycle Bin.` : ''
      }`
    );
  };

  const handleCommitFd = (
    nextList: FeederItem[],
    entry: MasterChangeHistoryEntry,
    removedItems: FeederItem[]
  ) => {
    onCommitFeederChange(nextList, entry, removedItems);
    setBulkModal(null);
    setSearchFd('');
    showFdNotice(
      'ok',
      `Feeder List diperbarui oleh ${entry.responsibleName} (${entry.changes.length} perubahan · total ${nextList.length} item).${
        removedItems.length > 0 ? ` ${removedItems.length} item dihapus dipindahkan ke Recycle Bin.` : ''
      }`
    );
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* Left: Database Auto Cutting List (Fixed Read-Only Table) */}
      <section className="glass-surface rounded-2xl p-6 flex flex-col gap-4">
        <div className="pb-4 border-b border-slate-200">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-[#1E3A8A]">
                自動切断端子マスタ · Auto Cutting List
              </p>
              <h1 className="text-lg font-bold text-slate-900 mt-0.5">
                Database Auto Cutting List
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Tampilan fixed ·{' '}
                <span className="font-mono-num font-semibold text-slate-700">
                  {autoCutList.length}
                </span>{' '}
                terminal terdaftar
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <input
                ref={acFileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleAcFileSelect}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => onOpenMasterHistory('auto_cut')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <History className="w-3.5 h-3.5 text-[#1E3A8A]" />
                <span>
                  Riwayat{autoCutHistoryCount > 0 ? ` (${autoCutHistoryCount})` : ''}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setBulkModal({
                    kind: 'auto_cut',
                    initialStage: 'edit',
                    source: 'manual_edit',
                  })
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] transition-colors cursor-pointer whitespace-nowrap shadow-xs"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Edit Data</span>
              </button>

              <ActionMenu
                compact
                ariaLabel="Opsi Auto Cutting List"
                items={[
                  {
                    id: 'upload_ac_excel',
                    label: acUploading ? 'Membaca Excel...' : 'Upload Excel (.xlsx / .csv)',
                    description: 'Pratinjau & konfirmasi sebelum simpan',
                    icon: Upload,
                    iconClassName: 'text-[#1E3A8A]',
                    onClick: () => acFileRef.current?.click(),
                  },
                  {
                    id: 'download_ac_template',
                    label: 'Unduh Template .xlsx',
                    description: 'Ekspor format & daftar saat ini',
                    icon: Download,
                    iconClassName: 'text-[#047857]',
                    onClick: () => exportAutoCutTemplateXlsx(autoCutList),
                  },
                  {
                    id: 'reset_ac_default',
                    label: 'Reset ke Default',
                    description: 'Bandingkan & kembalikan daftar standar',
                    icon: RotateCcw,
                    danger: true,
                    dividerBefore: true,
                    onClick: () =>
                      setBulkModal({
                        kind: 'auto_cut',
                        initialStage: 'confirm',
                        source: 'reset_default',
                        resetTargetAutoCut: structuredClone(DEFAULT_AUTO_CUT_LIST),
                      }),
                  },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Inline Notice */}
        {acNotice && (
          <div
            className={`px-3.5 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
              acNotice.kind === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-[#047857]'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            <span className="inline-flex items-center gap-2 font-medium">
              {acNotice.kind === 'ok' && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
              <span>{acNotice.text}</span>
            </span>
            <button
              type="button"
              onClick={() => setAcNotice(null)}
              className="opacity-70 hover:opacity-100 cursor-pointer shrink-0"
              aria-label="Tutup pesan"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchAc}
            onChange={(e) => setSearchAc(e.target.value)}
            placeholder="Cari nomor terminal atau customer..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20"
          />
        </div>

        <div className="overflow-auto max-h-[520px] rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
              <tr>
                <th className="py-2.5 px-3.5 w-12 text-center">#</th>
                <th className="py-2.5 px-3.5 w-32">Customer</th>
                <th className="py-2.5 px-3.5">Item Terminal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70">
              {filteredAc.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-10 text-center text-slate-400 text-xs">
                    {autoCutList.length === 0
                      ? 'Database kosong. Klik Edit Data, Upload Excel, atau Reset ke Default.'
                      : 'Tidak ada terminal yang cocok dengan pencarian.'}
                  </td>
                </tr>
              ) : (
                filteredAc.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-3.5 text-center font-mono-num text-[11px] text-slate-400">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-3.5 font-semibold text-slate-700 whitespace-nowrap">
                      {item.customer}
                    </td>
                    <td className="py-2.5 px-3.5 font-mono-num font-semibold text-slate-900">
                      {item.terminal}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Right: Database Feeder List (Fixed Read-Only Table) */}
      <section className="glass-surface rounded-2xl p-6 flex flex-col gap-4">
        <div className="pb-4 border-b border-slate-200">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-[#1E3A8A]">
                ゴム栓フィーダーマスタ · Auto-Feeder Seal
              </p>
              <h1 className="text-lg font-bold text-slate-900 mt-0.5">
                Database Feeder List (Wire Seal)
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Tampilan fixed ·{' '}
                <span className="font-mono-num font-semibold text-slate-700">
                  {feederList.length}
                </span>{' '}
                wire seal terdaftar
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <input
                ref={fdFileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFdFileSelect}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => onOpenMasterHistory('feeder')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <History className="w-3.5 h-3.5 text-[#1E3A8A]" />
                <span>
                  Riwayat{feederHistoryCount > 0 ? ` (${feederHistoryCount})` : ''}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setBulkModal({
                    kind: 'feeder',
                    initialStage: 'edit',
                    source: 'manual_edit',
                  })
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] transition-colors cursor-pointer whitespace-nowrap shadow-xs"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Edit Data</span>
              </button>

              <ActionMenu
                compact
                ariaLabel="Opsi Feeder List"
                items={[
                  {
                    id: 'upload_fd_excel',
                    label: fdUploading ? 'Membaca Excel...' : 'Upload Excel (.xlsx / .csv)',
                    description: 'Pratinjau & konfirmasi sebelum simpan',
                    icon: Upload,
                    iconClassName: 'text-[#1E3A8A]',
                    onClick: () => fdFileRef.current?.click(),
                  },
                  {
                    id: 'download_fd_template',
                    label: 'Unduh Template .xlsx',
                    description: 'Ekspor format & daftar saat ini',
                    icon: Download,
                    iconClassName: 'text-[#047857]',
                    onClick: () => exportFeederTemplateXlsx(feederList),
                  },
                  {
                    id: 'reset_fd_default',
                    label: 'Reset ke Default',
                    description: 'Bandingkan & kembalikan daftar standar',
                    icon: RotateCcw,
                    danger: true,
                    dividerBefore: true,
                    onClick: () =>
                      setBulkModal({
                        kind: 'feeder',
                        initialStage: 'confirm',
                        source: 'reset_default',
                        resetTargetFeeder: structuredClone(DEFAULT_FEEDER_LIST),
                      }),
                  },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Inline Notice */}
        {fdNotice && (
          <div
            className={`px-3.5 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
              fdNotice.kind === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-[#047857]'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            <span className="inline-flex items-center gap-2 font-medium">
              {fdNotice.kind === 'ok' && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
              <span>{fdNotice.text}</span>
            </span>
            <button
              type="button"
              onClick={() => setFdNotice(null)}
              className="opacity-70 hover:opacity-100 cursor-pointer shrink-0"
              aria-label="Tutup pesan"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchFd}
            onChange={(e) => setSearchFd(e.target.value)}
            placeholder="Cari nomor seal..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20"
          />
        </div>

        <div className="overflow-auto max-h-[520px] rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
              <tr>
                <th className="py-2.5 px-3.5 w-12 text-center">#</th>
                <th className="py-2.5 px-3.5">Item Seal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70">
              {filteredFd.length === 0 ? (
                <tr>
                  <td colSpan={2} className="py-10 text-center text-slate-400 text-xs">
                    {feederList.length === 0
                      ? 'Database kosong. Klik Edit Data, Upload Excel, atau Reset ke Default.'
                      : 'Tidak ada seal yang cocok dengan pencarian.'}
                  </td>
                </tr>
              ) : (
                filteredFd.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-3.5 text-center font-mono-num text-[11px] text-slate-400">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-3.5 font-mono-num font-semibold text-slate-900">
                      {item.seal}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Floating Bulk Edit / Excel Confirm / Reset Confirm Modal */}
      {bulkModal && (
        <MasterListBulkEditModal
          kind={bulkModal.kind}
          currentAutoCut={autoCutList}
          currentFeeder={feederList}
          initialStage={bulkModal.initialStage}
          source={bulkModal.source}
          sourceFileName={bulkModal.sourceFileName}
          sourceSheetName={bulkModal.sourceSheetName}
          uploadedAutoCutItems={bulkModal.uploadedAutoCutItems}
          uploadedFeederItems={bulkModal.uploadedFeederItems}
          resetTargetAutoCut={bulkModal.resetTargetAutoCut}
          resetTargetFeeder={bulkModal.resetTargetFeeder}
          onCommitAutoCut={handleCommitAc}
          onCommitFeeder={handleCommitFd}
          onClose={() => setBulkModal(null)}
        />
      )}
    </div>
  );
}
