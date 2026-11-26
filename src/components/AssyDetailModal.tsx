import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  Languages,
  Layers,
  Loader2,
  Printer,
  Save,
  SlidersHorizontal,
  Star,
  User as UserIcon,
  X,
} from 'lucide-react';
import {
  DIFFICULTY_ROW_LABELS,
  resolveDifficultyPercentage,
} from '../data/cotMasterV2';
import {
  buildExportRecordForMode,
  calculateUmh,
  getAllowSecForMode,
  getAllowanceModeLabel,
  getEffectiveLot,
  getVariantResult,
} from '../engine/umhCalculator';
import { DuplicateAssyMatch } from '../services/firestoreService';
import {
  AllowanceMode,
  AssyInputPayload,
  AssyRecord,
  AutoCutItem,
  FeederItem,
  ProcessId,
  ResultVariant,
  StdDatabase,
  UiLang,
} from '../types/umh';
import { exportUmhExcel } from '../utils/excelExporter';
import { exportSingleAssyPdf, PdfLayoutMode } from '../utils/pdfExporter';
import {
  translateBasis,
  translateProcessName,
  translateStage,
  translateSubStepName,
  translateSummaryNote,
  UI_LANG_OPTIONS,
} from '../utils/umhTranslator';

interface AssyDetailModalProps {
  record: AssyRecord;
  isDraftPreview?: boolean;
  duplicateWarning?: DuplicateAssyMatch | null;
  stdDb: StdDatabase;
  autoCutList: AutoCutItem[];
  feederList: FeederItem[];
  currentUserName?: string;
  onSaveRecord?: (finalRecord: AssyRecord) => Promise<void> | void;
  onClose: () => void;
  onEdit: (record: AssyRecord) => void;
  onPrintPdf: (
    record: AssyRecord,
    mode: AllowanceMode,
    lang: UiLang,
    layout: PdfLayoutMode
  ) => void;
}

const MODAL_LABELS: Record<
  UiLang,
  {
    subtitle: string;
    tabReg: string;
    tabSmv: string;
    baseCycle: string;
    basePlusDiff: string;
    allowanceTitle: string;
    cctCardTitle: string;
    circuitsUnit: string;
    colNo: string;
    colProcess: string;
    colBaseSec: string;
    colAllowSec: string;
    colBaseMin: string;
    colAllowMin: string;
    colBaseHour: string;
    colAllowHour: string;
    colNotes: string;
    subStage: string;
    subName: string;
    subBasis: string;
    subQty: string;
    subRate: string;
    totalLabel: string;
    secUnit: string;
    minUnit: string;
    hrUnit: string;
  }
> = {
  id: {
    subtitle: 'Rincian Proses & Sub-Step UMH',
    tabReg: 'REG (Normal)',
    tabSmv: 'SMV (Tanpa Autocutting)',
    baseCycle: 'Base Cycle (Murni · 0%)',
    basePlusDiff: 'Base + Tingkat Kesulitan',
    allowanceTitle: 'Allowance',
    cctCardTitle: 'Master CCT & Sirkuit PPCS',
    circuitsUnit: 'sirkuit PPCS',
    colNo: 'No',
    colProcess: 'Item Proses (Klik untuk Sub-Step)',
    colBaseSec: 'Base/STD Sec',
    colAllowSec: 'Allow Sec',
    colBaseMin: 'Base/STD Min',
    colAllowMin: 'Allow Min',
    colBaseHour: 'Base/STD Hour',
    colAllowHour: 'Allow Hour',
    colNotes: 'Rincian',
    subStage: 'Tahapan',
    subName: 'Rincian Sub-Step',
    subBasis: 'Basis',
    subQty: 'Qty',
    subRate: 'Rate (s)',
    totalLabel: 'TOTAL KESELURUHAN',
    secUnit: 'dtk',
    minUnit: 'mnt',
    hrUnit: 'jam',
  },
  en: {
    subtitle: 'UMH Process & Sub-Step Breakdown',
    tabReg: 'REG (Standard)',
    tabSmv: 'SMV (No Autocutting)',
    baseCycle: 'Pure Base Cycle (0%)',
    basePlusDiff: 'Base + Difficulty Rating',
    allowanceTitle: 'Allowance',
    cctCardTitle: 'Master CCT & PPCS Circuits',
    circuitsUnit: 'PPCS circuits',
    colNo: 'No',
    colProcess: 'Process Item (Click for Sub-Steps)',
    colBaseSec: 'Base/STD Sec',
    colAllowSec: 'Allow Sec',
    colBaseMin: 'Base/STD Min',
    colAllowMin: 'Allow Min',
    colBaseHour: 'Base/STD Hour',
    colAllowHour: 'Allow Hour',
    colNotes: 'Details',
    subStage: 'Stage',
    subName: 'Sub-Step Detail',
    subBasis: 'Basis',
    subQty: 'Qty',
    subRate: 'Rate (s)',
    totalLabel: 'GRAND TOTAL',
    secUnit: 'sec',
    minUnit: 'min',
    hrUnit: 'hr',
  },
  jp: {
    subtitle: '工程別・細目標準時間詳細',
    tabReg: 'REG（通常計算）',
    tabSmv: 'SMV（自動切断なし）',
    baseCycle: '正味時間 Base (0%)',
    basePlusDiff: 'Base + 難易度補正',
    allowanceTitle: '余裕配分 Allowance',
    cctCardTitle: 'マスターCCT・回路数',
    circuitsUnit: '回路 PPCS',
    colNo: 'No',
    colProcess: '工程名（クリックで細目表示）',
    colBaseSec: 'Base秒',
    colAllowSec: 'Allow秒',
    colBaseMin: 'Base分',
    colAllowMin: 'Allow分',
    colBaseHour: 'Base時間',
    colAllowHour: 'Allow時間',
    colNotes: '備考',
    subStage: '工程区分',
    subName: '細目作業内容',
    subBasis: '換算基準',
    subQty: '数量',
    subRate: '単価(秒)',
    totalLabel: '総合計',
    secUnit: '秒',
    minUnit: '分',
    hrUnit: '時間',
  },
};

function requiresAllowanceInput(mode: AllowanceMode): boolean {
  return mode === 'by_process' || mode === 'by_final';
}

export function AssyDetailModal({
  record,
  isDraftPreview = false,
  duplicateWarning = null,
  stdDb,
  autoCutList,
  feederList,
  currentUserName,
  onSaveRecord,
  onClose,
  onEdit,
  onPrintPdf,
}: AssyDetailModalProps) {
  const [workingRecord, setWorkingRecord] = useState<AssyRecord>(record);
  const [hasPendingChanges, setHasPendingChanges] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState<boolean>(false);

  const [activeVariant, setActiveVariant] = useState<ResultVariant>('reg');
  const [activeMode, setActiveMode] = useState<AllowanceMode>(record.params.allowanceMode);
  const [uiLang, setUiLang] = useState<UiLang>('id');
  const [expandedIds, setExpandedIds] = useState<Set<ProcessId>>(new Set([2, 3, 17]));

  // Sub-modal: Tetapkan Allowance & Tingkat Kesulitan
  const [configModalOpen, setConfigModalOpen] = useState<boolean>(false);
  const [draftMode, setDraftMode] = useState<AllowanceMode>(record.params.allowanceMode);
  const [draftPfdStr, setDraftPfdStr] = useState<string>(
    requiresAllowanceInput(record.params.allowanceMode) && record.params.pfdAllowancePct > 0
      ? String(record.params.pfdAllowancePct)
      : ''
  );
  const [draftDifficulty, setDraftDifficulty] = useState<number>(
    record.params.difficultyRating ?? 0
  );
  const [hoverStar, setHoverStar] = useState<number | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  // Floating Export Method Picker state (for Excel & PDF)
  const [exportPicker, setExportPicker] = useState<{
    target: 'excel' | 'pdf';
    chosenMode: AllowanceMode;
    pdfLayout: PdfLayoutMode;
    overridePctStr: string;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    setWorkingRecord(record);
    setActiveMode(record.params.allowanceMode);
    setHasPendingChanges(false);
  }, [record]);

  const difficultyMatrix = stdDb.difficultyMatrix;
  const { params } = workingRecord;
  const effectiveLot = getEffectiveLot(params.lot);
  const difficultyRating = params.difficultyRating ?? 0;
  const difficultyPct =
    workingRecord.calculation.difficultyPct !== undefined
      ? workingRecord.calculation.difficultyPct
      : resolveDifficultyPercentage(difficultyRating, difficultyMatrix);

  const variantCalc = getVariantResult(workingRecord, activeVariant);
  const { totalBaseSec, totalAllowByProcessSec, totalAllowByFinalSec, processes } = variantCalc;
  // Pure Base Cycle (before difficulty rating & before allowance)
  const rawBaseSec =
    typeof variantCalc.rawTotalBaseSec === 'number' && Number.isFinite(variantCalc.rawTotalBaseSec)
      ? variantCalc.rawTotalBaseSec
      : difficultyPct > 0
      ? totalBaseSec / (1 + difficultyPct / 100)
      : totalBaseSec;

  const regCalc = getVariantResult(workingRecord, 'reg');
  const smvCalc = getVariantResult(workingRecord, 'smv');

  const currentTotalAllowSec = getAllowSecForMode(
    activeMode,
    totalBaseSec,
    totalAllowByProcessSec,
    totalAllowByFinalSec
  );

  // Explicit deltas vs Pure Base Cycle
  const diffDeltaSec = totalBaseSec - rawBaseSec;
  const allowDeltaVsRawBaseSec = currentTotalAllowSec - rawBaseSec;

  const L = MODAL_LABELS[uiLang];

  const creatorLabel =
    workingRecord.createdByName || (isDraftPreview ? currentUserName : undefined) || '-';
  const updaterLabel =
    workingRecord.updatedByName && workingRecord.updatedByName !== creatorLabel
      ? workingRecord.updatedByName
      : null;

  const hasUnsavedState = isDraftPreview || hasPendingChanges;

  const handleRequestClose = () => {
    if (isSaving) return;
    if (hasUnsavedState) {
      setShowCancelConfirm(true);
    } else {
      onClose();
    }
  };

  const openConfigModal = () => {
    setDraftMode(params.allowanceMode);
    setDraftPfdStr(
      requiresAllowanceInput(params.allowanceMode) && params.pfdAllowancePct > 0
        ? String(params.pfdAllowancePct)
        : ''
    );
    setDraftDifficulty(params.difficultyRating ?? 0);
    setHoverStar(null);
    setConfigError(null);
    setConfigModalOpen(true);
  };

  // Live preview calculation inside the Allowance & Difficulty sub-modal
  const configLivePreview = useMemo(() => {
    if (!configModalOpen) return null;
    const pctNum = requiresAllowanceInput(draftMode)
      ? Math.max(0, Number(draftPfdStr) || 0)
      : 0;
    const nextPayload: AssyInputPayload = {
      id: workingRecord.id,
      createdAt: workingRecord.createdAt,
      updatedAt: workingRecord.updatedAt,
      createdByUid: workingRecord.createdByUid,
      createdByName: workingRecord.createdByName,
      createdByEmail: workingRecord.createdByEmail,
      updatedByUid: workingRecord.updatedByUid,
      updatedByName: workingRecord.updatedByName,
      updatedByEmail: workingRecord.updatedByEmail,
      params: {
        ...workingRecord.params,
        allowanceMode: draftMode,
        pfdAllowancePct: pctNum,
        difficultyRating: draftDifficulty,
      },
      assemblyComponents: workingRecord.assemblyComponents,
      partList: workingRecord.partList,
      ppcsList: workingRecord.ppcsList,
      assemblyCotList: workingRecord.assemblyCotList,
      terminalRatios: workingRecord.terminalRatios,
    };
    const calc = calculateUmh(nextPayload, stdDb, autoCutList, feederList);
    const vCalc = activeVariant === 'smv' && calc.smv ? calc.smv : calc;
    const rawSec = vCalc.rawTotalBaseSec ?? vCalc.totalBaseSec;
    const baseWithDiffSec = vCalc.totalBaseSec;
    const allowSec = getAllowSecForMode(
      draftMode,
      vCalc.totalBaseSec,
      vCalc.totalAllowByProcessSec,
      vCalc.totalAllowByFinalSec
    );
    return {
      nextPayload,
      calc,
      rawSec,
      baseWithDiffSec,
      allowSec,
      diffPct: calc.difficultyPct ?? resolveDifficultyPercentage(draftDifficulty, difficultyMatrix),
    };
  }, [
    configModalOpen,
    draftMode,
    draftPfdStr,
    draftDifficulty,
    workingRecord,
    stdDb,
    autoCutList,
    feederList,
    activeVariant,
    difficultyMatrix,
  ]);

  const handleApplyConfig = () => {
    if (requiresAllowanceInput(draftMode)) {
      if (
        draftPfdStr.trim() === '' ||
        !Number.isFinite(Number(draftPfdStr)) ||
        Number(draftPfdStr) < 0
      ) {
        setConfigError('Masukkan angka % Allowance PFD terlebih dahulu untuk metode yang dipilih.');
        return;
      }
    }
    if (!configLivePreview) return;

    const updatedRecord: AssyRecord = {
      ...configLivePreview.nextPayload,
      updatedAt: new Date().toISOString(),
      calculation: configLivePreview.calc,
    };
    setWorkingRecord(updatedRecord);
    setActiveMode(draftMode);
    setHasPendingChanges(true);
    setConfigModalOpen(false);
    setConfigError(null);
  };

  const handleSavePrimary = async () => {
    if (!onSaveRecord || isSaving) return;
    setIsSaving(true);
    try {
      const recordToSave: AssyRecord = {
        ...workingRecord,
        updatedAt: new Date().toISOString(),
      };
      await onSaveRecord(recordToSave);
      setHasPendingChanges(false);
    } finally {
      setIsSaving(false);
    }
  };

  const openExportPicker = (target: 'excel' | 'pdf') => {
    setExportPicker({
      target,
      chosenMode: activeMode,
      pdfLayout: 'summary',
      overridePctStr: params.pfdAllowancePct > 0 ? String(params.pfdAllowancePct) : '',
      error: null,
    });
  };

  const previewExportRecord = useMemo(() => {
    if (!exportPicker) return null;
    const pctNum =
      exportPicker.chosenMode === 'none'
        ? 0
        : exportPicker.overridePctStr.trim() === ''
        ? params.pfdAllowancePct || 0
        : Math.max(0, Number(exportPicker.overridePctStr) || 0);
    return buildExportRecordForMode(workingRecord, exportPicker.chosenMode, pctNum);
  }, [exportPicker, workingRecord, params.pfdAllowancePct]);

  const handleConfirmExport = (pdfAction: 'preview' | 'download' = 'preview') => {
    if (!exportPicker) return;
    const needsCustomPct =
      exportPicker.chosenMode !== 'none' &&
      (params.pfdAllowancePct || 0) <= 0 &&
      exportPicker.overridePctStr.trim() === '';
    if (needsCustomPct) {
      setExportPicker((prev) =>
        prev
          ? {
              ...prev,
              error: 'Masukkan angka % Allowance untuk mengekspor dengan metode ini.',
            }
          : null
      );
      return;
    }

    const finalRecord =
      previewExportRecord ?? buildExportRecordForMode(workingRecord, exportPicker.chosenMode);
    if (exportPicker.target === 'excel') {
      exportUmhExcel(finalRecord, exportPicker.chosenMode, uiLang, difficultyMatrix);
    } else if (pdfAction === 'download') {
      exportSingleAssyPdf(
        finalRecord,
        exportPicker.chosenMode,
        exportPicker.pdfLayout,
        uiLang,
        difficultyMatrix
      );
    } else {
      onPrintPdf(finalRecord, exportPicker.chosenMode, uiLang, exportPicker.pdfLayout);
    }
    setExportPicker(null);
  };

  const toggleProcessDrawer = (pid: ProcessId, hasSubSteps: boolean) => {
    if (!hasSubSteps) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const renderAllowCell = (
    baseSec: number,
    allowSec: number,
    divisor: number,
    digits: number,
    diffDigits: number,
    unitLabel: string,
    showPct = false
  ) => {
    const allowVal = allowSec / divisor;
    const diffSec = allowSec - baseSec;
    const effPct = baseSec > 0 ? (diffSec / baseSec) * 100 : 0;

    return (
      <div className="flex flex-col items-end">
        <span className="font-mono-num font-bold text-emerald-700">
          {allowVal.toFixed(digits)}
        </span>
        <span className="font-mono-num text-[10px] text-slate-500 whitespace-nowrap leading-tight">
          (+{(diffSec / divisor).toFixed(diffDigits)} {unitLabel})
          {showPct ? ` ${effPct.toFixed(1)}%` : ''}
        </span>
      </div>
    );
  };

  const previewStar = hoverStar !== null ? hoverStar : draftDifficulty;
  const draftDifficultyPct = resolveDifficultyPercentage(draftDifficulty, difficultyMatrix);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-2 sm:p-4 print:hidden">
      <div className="glass-modal w-[96vw] h-[94vh] rounded-2xl flex flex-col overflow-hidden">
        {/* Tier 1: Modal Title & Document Actions */}
        <div className="px-6 py-3.5 border-b border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold text-[#1E3A8A]">{L.subtitle}</span>
              {isDraftPreview && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-[11px] font-semibold text-[#1E3A8A]">
                  Preview Sebelum Simpan
                </span>
              )}
              {!isDraftPreview && hasPendingChanges && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-800">
                  Perubahan Belum Disimpan
                </span>
              )}
              <span aria-hidden="true">·</span>
              <span className="truncate">{params.customer || '-'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num whitespace-nowrap">LOT {effectiveLot}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-slate-600 whitespace-nowrap">
                <UserIcon className="w-3 h-3 text-slate-400" />
                <span>Penginput: {creatorLabel}</span>
              </span>
              {updaterLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-500 whitespace-nowrap">
                    Diubah: {updaterLabel}
                  </span>
                </>
              )}
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-mono-num mt-0.5 truncate">
              {params.assyNo}{' '}
              <span className="font-normal text-slate-500 text-sm sm:text-base">
                ({params.customer || '-'})
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onEdit(workingRecord)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Data</span>
            </button>

            <button
              type="button"
              onClick={() => openExportPicker('excel')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#047857] text-white text-xs font-semibold hover:bg-[#065F46] transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>

            <button
              type="button"
              onClick={() => openExportPicker('pdf')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>PDF</span>
            </button>

            <span className="h-5 w-px bg-slate-200 mx-0.5" aria-hidden="true" />

            <button
              type="button"
              onClick={handleRequestClose}
              className="p-2 rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-700 transition-colors cursor-pointer"
              aria-label="Batalkan / Tutup"
              title={hasUnsavedState ? 'Batalkan operasi (perlu konfirmasi)' : 'Tutup detail'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Duplicate Warning Banner (if Assy No already exists in DB) */}
        {duplicateWarning && (
          <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2.5 text-xs text-amber-950 shrink-0">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Notifikasi Assy Duplikat:</strong> Nomor Assy{' '}
              <strong className="font-mono-num">{duplicateWarning.assyNo}</strong> sudah pernah
              tersimpan di database (Customer: <strong>{duplicateWarning.customer || '-'}</strong>
              {duplicateWarning.createdByName ? (
                <>
                  {' '}· Penginput: <strong>{duplicateWarning.createdByName}</strong>
                </>
              ) : null}
              ). Klik <strong>Edit Data</strong> jika ingin mengubah nomor Assy, atau tetap klik{' '}
              <strong>Konfirmasi &amp; Simpan</strong> jika memang sengaja membuat entri baru.
            </span>
          </div>
        )}

        {/* Tier 2: Calculation Variant & Translation Controls */}
        <div className="px-6 py-2 border-b border-slate-200 bg-slate-50/90 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Result Variant Tabs: REG vs SMV */}
            <div className="inline-flex items-center p-1 rounded-xl bg-slate-200/70 border border-slate-200">
              <button
                type="button"
                onClick={() => setActiveVariant('reg')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  activeVariant === 'reg'
                    ? 'bg-[#1E3A8A] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {L.tabReg}
              </button>
              <button
                type="button"
                onClick={() => setActiveVariant('smv')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  activeVariant === 'smv'
                    ? 'bg-[#047857] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {L.tabSmv}
              </button>
            </div>

            {/* Active Allowance & Difficulty Summary Chip */}
            <div className="inline-flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-semibold text-slate-800">
                <span>Metode Aktif:</span>
                <span className="text-[#047857]">
                  {getAllowanceModeLabel(activeMode, 'short')}
                  {activeMode !== 'none' ? ` (+${params.pfdAllowancePct}%)` : ' (0%)'}
                </span>
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-mono-num font-semibold ${
                  difficultyRating > 0
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-white border-slate-200 text-slate-600'
                }`}
              >
                <Star
                  className={`w-3 h-3 ${
                    difficultyRating > 0 ? 'fill-amber-400 text-amber-500' : 'text-slate-400'
                  }`}
                />
                <span>
                  {difficultyRating.toFixed(1)} ★ (+{difficultyPct.toFixed(2)}%)
                </span>
              </span>
            </div>
          </div>

          {/* Translate Toggle: ID | EN | JP */}
          <div
            className="inline-flex items-center p-1 rounded-xl bg-slate-200/70 border border-slate-200"
            title="Terjemahkan Nama Subproses & Sub-Step"
          >
            <Languages className="w-3.5 h-3.5 text-slate-500 ml-1.5 mr-1 shrink-0" />
            {UI_LANG_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setUiLang(opt.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  uiLang === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.short}
              </button>
            ))}
          </div>
        </div>

        {/* Header KPI Strip: Base Cycle | Base + Tingkat Kesulitan | Allowance (dari Base + Kesulitan) | CCT */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 shrink-0">
          {/* Card 1: Pure Base Cycle */}
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-slate-500">
                {L.baseCycle} · {activeVariant.toUpperCase()}
              </p>
              <span className="text-[10px] font-mono-num text-slate-400">Dasar</span>
            </div>
            <div className="flex items-baseline justify-between mt-1 gap-2">
              <span className="text-lg font-bold font-mono-num text-slate-900">
                {rawBaseSec.toFixed(2)}s
              </span>
              <span className="text-xs font-mono-num font-semibold text-slate-600">
                {(rawBaseSec / 3600).toFixed(4)} UMH
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5 truncate">
              Sebelum tingkat kesulitan &amp; allowance
            </p>
          </div>

          {/* Card 2: Base + Tingkat Kesulitan (and delta vs pure Base Cycle) */}
          <div
            className={`rounded-xl border px-4 py-2.5 transition-colors ${
              difficultyRating > 0
                ? 'bg-amber-50/60 border-amber-300'
                : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-slate-700 truncate">
                {L.basePlusDiff}
              </p>
              <span className="text-[10px] font-mono-num font-bold text-amber-800 whitespace-nowrap">
                {difficultyRating.toFixed(1)} ★ (+{difficultyPct.toFixed(2)}%)
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-1 gap-2">
              <span className="text-lg font-bold font-mono-num text-slate-900">
                {totalBaseSec.toFixed(2)}s
              </span>
              <span className="text-xs font-mono-num font-semibold text-slate-700">
                {(totalBaseSec / 3600).toFixed(4)} UMH
              </span>
            </div>
            <p className="text-[10px] font-mono-num text-amber-900 mt-0.5 truncate">
              Selisih vs Base: +{diffDeltaSec.toFixed(2)}s (+{(diffDeltaSec / 3600).toFixed(4)} hr)
            </p>
          </div>

          {/* Card 3: Allowance (computed from Base + Kesulitan, delta vs pure Base Cycle) */}
          <div
            className={`rounded-xl border px-4 py-2.5 transition-colors ${
              activeMode !== 'none'
                ? 'bg-emerald-50/70 border-emerald-300'
                : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-slate-700 truncate">
                {L.allowanceTitle} · {getAllowanceModeLabel(activeMode, 'short')}
              </p>
              <span className="text-[10px] font-mono-num font-bold text-[#047857] whitespace-nowrap">
                {activeMode === 'none' ? '0%' : `+${params.pfdAllowancePct}%`}
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-1 gap-2">
              <span className="text-lg font-bold font-mono-num text-[#047857]">
                {currentTotalAllowSec.toFixed(2)}s
              </span>
              <span className="text-xs font-mono-num font-semibold text-[#047857]">
                {(currentTotalAllowSec / 3600).toFixed(4)} UMH
              </span>
            </div>
            <p className="text-[10px] font-mono-num text-emerald-800 mt-0.5 truncate">
              Selisih vs Base: +{allowDeltaVsRawBaseSec.toFixed(2)}s (+
              {(allowDeltaVsRawBaseSec / 3600).toFixed(4)} hr)
            </p>
          </div>

          {/* Card 4: Master CCT & REG/SMV comparison */}
          <div className="rounded-xl bg-white border border-slate-200 px-4 py-2.5">
            <p className="text-[11px] font-semibold text-slate-500">{L.cctCardTitle}</p>
            <div className="flex items-baseline justify-between mt-1 gap-2">
              <span className="text-base font-bold font-mono-num text-slate-900">
                {params.masterCct} CCT · {workingRecord.ppcsList.length} {L.circuitsUnit}
              </span>
            </div>
            <p className="text-[10px] font-mono-num text-slate-500 mt-0.5 truncate">
              {activeVariant === 'reg'
                ? `SMV Base ${(smvCalc.totalBaseSec / 3600).toFixed(4)} hr`
                : `REG Base ${(regCalc.totalBaseSec / 3600).toFixed(4)} hr`}{' '}
              · LOT {effectiveLot}
            </p>
          </div>
        </div>

        {/* Main 1-Language Table with FROZEN Sticky Column Header */}
        <div className="flex-1 min-h-0 px-6 py-4 bg-[#f8fafc] flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
            <table className="w-full text-left border-collapse min-w-[980px]">
              <thead>
                <tr className="text-white text-[11px] font-semibold">
                  <th className="sticky top-0 z-20 bg-slate-900 py-3 px-3 w-10 text-center">
                    {L.colNo}
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-900 py-3 px-3">{L.colProcess}</th>
                  <th className="sticky top-0 z-20 bg-slate-900 py-3 px-3 text-right">
                    {L.colBaseSec}
                  </th>
                  <th className="sticky top-0 z-20 bg-[#064E3B] py-3 px-3 text-right">
                    {L.colAllowSec}
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-900 py-3 px-3 text-right">
                    {L.colBaseMin}
                  </th>
                  <th className="sticky top-0 z-20 bg-[#064E3B] py-3 px-3 text-right">
                    {L.colAllowMin}
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-900 py-3 px-3 text-right">
                    {L.colBaseHour}
                  </th>
                  <th className="sticky top-0 z-20 bg-[#064E3B] py-3 px-3 text-right">
                    {L.colAllowHour}
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-900 py-3 px-3">{L.colNotes}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {processes.map((proc) => {
                  const allowSec = getAllowSecForMode(
                    activeMode,
                    proc.baseSec,
                    proc.allowByProcessSec,
                    proc.allowByFinalSec
                  );
                  const hasSubs = proc.subSteps.length > 0;
                  const isExpanded = expandedIds.has(proc.processId);
                  const displayName = translateProcessName(
                    proc.processId,
                    proc.processName,
                    proc.jpName,
                    uiLang
                  );
                  const displayNote = translateSummaryNote(proc.summaryNote, uiLang);

                  return (
                    <Fragment key={proc.processId}>
                      <tr
                        onClick={() => toggleProcessDrawer(proc.processId, hasSubs)}
                        className={`transition-colors ${
                          hasSubs
                            ? 'cursor-pointer hover:bg-slate-50'
                            : 'text-slate-400 bg-slate-50/50'
                        }`}
                      >
                        <td className="py-3 px-3 text-center font-mono-num font-semibold text-slate-500">
                          {proc.processId}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            {hasSubs ? (
                              isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                              )
                            ) : (
                              <span className="w-4 h-4 shrink-0" />
                            )}
                            <span
                              className={`text-[13px] ${
                                proc.baseSec > 0
                                  ? 'font-semibold text-slate-900'
                                  : 'font-medium text-slate-500'
                              }`}
                            >
                              {displayName}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono-num font-bold text-slate-800">
                          {proc.baseSec.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right bg-emerald-50/50">
                          {renderAllowCell(proc.baseSec, allowSec, 1, 2, 2, L.secUnit, true)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono-num font-bold text-slate-800">
                          {(proc.baseSec / 60).toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right bg-emerald-50/50">
                          {renderAllowCell(proc.baseSec, allowSec, 60, 2, 4, L.minUnit)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono-num font-bold text-slate-800">
                          {(proc.baseSec / 3600).toFixed(4)}
                        </td>
                        <td className="py-3 px-3 text-right bg-emerald-50/50">
                          {renderAllowCell(proc.baseSec, allowSec, 3600, 4, 6, L.hrUnit)}
                        </td>
                        <td className="py-3 px-3 text-[11px] text-slate-600 max-w-[260px]">
                          {displayNote}
                        </td>
                      </tr>

                      {/* Sub-Step Drawer */}
                      {isExpanded && hasSubs && (
                        <tr className="bg-slate-50/90">
                          <td colSpan={9} className="p-0">
                            <div className="px-8 py-3 border-y border-slate-200/80">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="text-[11px] font-semibold text-slate-500 border-b border-slate-200/80">
                                    <th className="py-1.5 px-2">{L.subStage}</th>
                                    <th className="py-1.5 px-2">{L.subName}</th>
                                    <th className="py-1.5 px-2">{L.subBasis}</th>
                                    <th className="py-1.5 px-2 text-right">{L.subQty}</th>
                                    <th className="py-1.5 px-2 text-right">{L.subRate}</th>
                                    <th className="py-1.5 px-2 text-right">{L.colBaseSec}</th>
                                    <th className="py-1.5 px-2 text-right text-emerald-800">
                                      {L.colAllowSec}
                                    </th>
                                    <th className="py-1.5 px-2 text-right">{L.colBaseMin}</th>
                                    <th className="py-1.5 px-2 text-right text-emerald-800">
                                      {L.colAllowMin}
                                    </th>
                                    <th className="py-1.5 px-2 text-right">{L.colBaseHour}</th>
                                    <th className="py-1.5 px-2 text-right text-emerald-800">
                                      {L.colAllowHour}
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/50 text-[11px]">
                                  {proc.subSteps.map((sub) => {
                                    const subAllowSec = getAllowSecForMode(
                                      activeMode,
                                      sub.baseSec,
                                      sub.allowByProcessSec,
                                      sub.allowByFinalSec
                                    );
                                    const subDiff = subAllowSec - sub.baseSec;

                                    return (
                                      <tr key={sub.id} className="hover:bg-white/70">
                                        <td className="py-2 px-2 font-semibold text-blue-700">
                                          {translateStage(sub.stage, uiLang)}
                                        </td>
                                        <td className="py-2 px-2 text-slate-800">
                                          {translateSubStepName(sub.name, uiLang)}
                                        </td>
                                        <td className="py-2 px-2 text-slate-500">
                                          {translateBasis(sub.basis, uiLang)}
                                        </td>
                                        <td className="py-2 px-2 text-right font-mono-num text-slate-600">
                                          {sub.qty.toFixed(2)}
                                        </td>
                                        <td className="py-2 px-2 text-right font-mono-num text-slate-600">
                                          {sub.rate.toFixed(2)}
                                        </td>
                                        <td className="py-2 px-2 text-right font-mono-num text-slate-700">
                                          {sub.baseSec.toFixed(3)}
                                        </td>
                                        <td className="py-2 px-2 text-right font-mono-num font-bold text-emerald-700">
                                          <div>{subAllowSec.toFixed(3)}</div>
                                          <div className="text-[10px] font-normal text-slate-500">
                                            (+{subDiff.toFixed(3)}s)
                                          </div>
                                        </td>
                                        <td className="py-2 px-2 text-right font-mono-num text-slate-700">
                                          {(sub.baseSec / 60).toFixed(4)}
                                        </td>
                                        <td className="py-2 px-2 text-right font-mono-num font-bold text-emerald-700">
                                          <div>{(subAllowSec / 60).toFixed(4)}</div>
                                          <div className="text-[10px] font-normal text-slate-500">
                                            (+{(subDiff / 60).toFixed(5)}m)
                                          </div>
                                        </td>
                                        <td className="py-2 px-2 text-right font-mono-num text-slate-700">
                                          {(sub.baseSec / 3600).toFixed(6)}
                                        </td>
                                        <td className="py-2 px-2 text-right font-mono-num font-bold text-emerald-700">
                                          <div>{(subAllowSec / 3600).toFixed(6)}</div>
                                          <div className="text-[10px] font-normal text-slate-500">
                                            (+{(subDiff / 3600).toFixed(6)}h)
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-xs">
                  <td colSpan={2} className="py-3.5 px-4 text-slate-900">
                    {L.totalLabel} ({activeVariant.toUpperCase()} ·{' '}
                    {activeMode === 'none'
                      ? '0. TANPA ALLOWANCE'
                      : activeMode === 'by_final'
                      ? '2. ALLOWANCE BY HASIL AKHIR'
                      : '1. ALLOWANCE BY PROSES'}
                    )
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono-num text-slate-900">
                    {totalBaseSec.toFixed(2)}
                  </td>
                  <td className="py-3.5 px-3 text-right bg-emerald-100/80">
                    {renderAllowCell(totalBaseSec, currentTotalAllowSec, 1, 2, 2, L.secUnit, true)}
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono-num text-slate-900">
                    {(totalBaseSec / 60).toFixed(2)}
                  </td>
                  <td className="py-3.5 px-3 text-right bg-emerald-100/80">
                    {renderAllowCell(totalBaseSec, currentTotalAllowSec, 60, 2, 4, L.minUnit)}
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono-num text-slate-900">
                    {(totalBaseSec / 3600).toFixed(4)}
                  </td>
                  <td className="py-3.5 px-3 text-right bg-emerald-100/80">
                    {renderAllowCell(totalBaseSec, currentTotalAllowSec, 3600, 4, 6, L.hrUnit)}
                  </td>
                  <td className="py-3.5 px-3 font-mono-num text-slate-700">
                    {params.masterCct} CCT · LOT {effectiveLot}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Sticky Bottom Action Footer: Tetapkan Allowance & Tingkat Kesulitan + Simpan / Konfirmasi Assy */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-1">
            {isDraftPreview ? (
              <span className="font-semibold text-[#1E3A8A]">
                Status: Pratinjau belum disimpan — tetapkan Allowance &amp; Kesulitan lalu klik Simpan.
              </span>
            ) : hasPendingChanges ? (
              <span className="font-semibold text-amber-800">
                Allowance / Kesulitan diubah — klik Simpan Perubahan agar tercatat ke database &amp; riwayat.
              </span>
            ) : (
              <span>
                Tersimpan di database · Penginput: <strong>{creatorLabel}</strong>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={openConfigModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50 hover:border-[#1E3A8A] hover:text-[#1E3A8A] transition-colors cursor-pointer whitespace-nowrap"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#1E3A8A]" />
              <span>Tetapkan Allowance &amp; Tingkat Kesulitan</span>
            </button>

            {onSaveRecord && (
              <button
                type="button"
                disabled={isSaving || (!isDraftPreview && !hasPendingChanges)}
                onClick={() => void handleSavePrimary()}
                className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shadow-xs ${
                  isDraftPreview || hasPendingChanges
                    ? 'bg-[#047857] text-white hover:bg-[#065F46] cursor-pointer'
                    : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none'
                }`}
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isDraftPreview || hasPendingChanges ? (
                  <Save className="w-4 h-4" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>
                  {isSaving
                    ? 'Menyimpan...'
                    : isDraftPreview
                    ? 'Konfirmasi & Simpan Assy'
                    : hasPendingChanges
                    ? 'Simpan Perubahan'
                    : 'Tersimpan'}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sub-Modal: Tetapkan Allowance & Tingkat Kesulitan */}
      {configModalOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          onClick={() => setConfigModalOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#1E3A8A] text-white flex items-center justify-center shrink-0">
                  <SlidersHorizontal className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 truncate">
                    Tetapkan Allowance &amp; Tingkat Kesulitan
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono-num truncate">
                    {params.assyNo} · Allowance dihitung dari Base Cycle + Tingkat Kesulitan
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfigModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                aria-label="Tutup pengaturan allowance"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              {/* 1. Rating Tingkat Kesulitan Manual (0.0 – 5.0 ★, step 0.5) */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800">
                    1. Tingkat Kesulitan Manual (0.0–5.0 ★)
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono-num text-[11px] font-semibold whitespace-nowrap ${
                      draftDifficulty > 0
                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    {draftDifficulty.toFixed(1)} ★ (+{draftDifficultyPct.toFixed(2)}%)
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div
                    className="inline-flex items-center gap-1"
                    onMouseLeave={() => setHoverStar(null)}
                    role="group"
                    aria-label="Pilih rating bintang kesulitan (kelipatan 0.5)"
                  >
                    {[1, 2, 3, 4, 5].map((starNum) => {
                      const halfVal = starNum - 0.5;
                      const isFull = previewStar >= starNum;
                      const isHalf = !isFull && previewStar >= halfVal;
                      return (
                        <div key={starNum} className="relative w-7 h-7 shrink-0">
                          <Star
                            className={`w-7 h-7 transition-colors ${
                              isFull
                                ? 'fill-amber-400 text-amber-500'
                                : 'fill-slate-100 text-slate-300'
                            }`}
                          />
                          {isHalf && (
                            <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden pointer-events-none">
                              <Star className="w-7 h-7 fill-amber-400 text-amber-500" />
                            </div>
                          )}
                          <button
                            type="button"
                            aria-label={`${halfVal.toFixed(1)} Bintang`}
                            title={`${halfVal.toFixed(1)} ★ (+${resolveDifficultyPercentage(
                              halfVal,
                              difficultyMatrix
                            ).toFixed(2)}%)`}
                            onMouseEnter={() => setHoverStar(halfVal)}
                            onClick={() =>
                              setDraftDifficulty((prev) => (prev === halfVal ? 0 : halfVal))
                            }
                            className="absolute inset-y-0 left-0 w-1/2 cursor-pointer focus:outline-none"
                          />
                          <button
                            type="button"
                            aria-label={`${starNum.toFixed(1)} Bintang`}
                            title={`${starNum.toFixed(1)} ★ (+${resolveDifficultyPercentage(
                              starNum,
                              difficultyMatrix
                            ).toFixed(2)}%)`}
                            onMouseEnter={() => setHoverStar(starNum)}
                            onClick={() =>
                              setDraftDifficulty((prev) => (prev === starNum ? 0 : starNum))
                            }
                            className="absolute inset-y-0 right-0 w-1/2 cursor-pointer focus:outline-none"
                          />
                        </div>
                      );
                    })}
                  </div>

                  {draftDifficulty > 0 && (
                    <button
                      type="button"
                      onClick={() => setDraftDifficulty(0)}
                      className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 underline cursor-pointer whitespace-nowrap"
                    >
                      Reset 0.0
                    </button>
                  )}
                </div>

                <select
                  aria-label="Pilih jenjang tingkat kesulitan"
                  value={draftDifficulty}
                  onChange={(e) => setDraftDifficulty(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                >
                  {DIFFICULTY_ROW_LABELS.map((lbl, idx) => {
                    const starVal = idx * 0.5;
                    const pct = resolveDifficultyPercentage(starVal, difficultyMatrix);
                    return (
                      <option key={starVal} value={starVal}>
                        {lbl} — +{pct.toFixed(2)}%
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* 2. Metode Distribusi Allowance */}
              <div className="space-y-2.5">
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-800">
                    2. Metode Distribusi Allowance
                  </span>
                  <select
                    value={draftMode}
                    onChange={(e) => {
                      const nextMode = e.target.value as AllowanceMode;
                      setDraftMode(nextMode);
                      setConfigError(null);
                      if (!requiresAllowanceInput(nextMode)) {
                        setDraftPfdStr('');
                      }
                    }}
                    className="w-full px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                  >
                    <option value="none">0. Tanpa Allowance (Base / 0%)</option>
                    <option value="by_process">1. By Proses (+% Tiap Proses → Substep)</option>
                    <option value="by_final">
                      2. By Hasil Akhir (Distribusi Kesulitan → Substep)
                    </option>
                  </select>
                </label>

                {/* CRITICAL: Numeric % Allowance input ONLY renders when an allowance method is chosen */}
                {requiresAllowanceInput(draftMode) && (
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold text-slate-700">
                      Angka % Allowance PFD <span className="text-red-500">*</span>
                    </span>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        max="100"
                        value={draftPfdStr}
                        onChange={(e) => {
                          setDraftPfdStr(e.target.value);
                          setConfigError(null);
                        }}
                        placeholder="Masukkan persentase allowance (cth: 15)"
                        className="w-full px-3 py-2 pr-8 text-sm font-mono-num bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                        %
                      </span>
                    </div>
                  </label>
                )}

                {configError && (
                  <p className="text-xs font-semibold text-red-600">{configError}</p>
                )}
              </div>

              {/* 3. Live Impact Preview */}
              {configLivePreview && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2 text-xs">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Pratinjau Dampak ({activeVariant.toUpperCase()})
                  </p>
                  <div className="space-y-1.5 font-mono-num">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-sans text-slate-600">Base Cycle (Murni)</span>
                      <span className="font-semibold text-slate-900">
                        {configLivePreview.rawSec.toFixed(2)}s ·{' '}
                        {(configLivePreview.rawSec / 3600).toFixed(4)} hr
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-sans text-slate-600">
                        Base + Kesulitan ({draftDifficulty.toFixed(1)} ★)
                      </span>
                      <span className="font-semibold text-amber-800">
                        {configLivePreview.baseWithDiffSec.toFixed(2)}s (+
                        {(configLivePreview.baseWithDiffSec - configLivePreview.rawSec).toFixed(2)}s)
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-200">
                      <span className="font-sans font-bold text-slate-800">
                        Allowance ({getAllowanceModeLabel(draftMode, 'short')})
                      </span>
                      <span className="font-bold text-[#047857]">
                        {configLivePreview.allowSec.toFixed(2)}s ·{' '}
                        {(configLivePreview.allowSec / 3600).toFixed(4)} hr (+
                        {(configLivePreview.allowSec - configLivePreview.rawSec).toFixed(2)}s vs Base)
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfigModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleApplyConfig}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1E3A8A] hover:bg-[#172E6E] text-white text-xs font-semibold cursor-pointer shadow-xs"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Terapkan ke Preview</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Operation Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Batalkan Operasi?</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  {isDraftPreview
                    ? `Hasil kalkulasi Assy "${params.assyNo}" belum disimpan ke database. Yakin ingin membatalkan?`
                    : `Perubahan Allowance / Tingkat Kesulitan pada "${params.assyNo}" belum disimpan. Yakin ingin membuang perubahan?`}
                </p>
              </div>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCancelConfirm(false)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Kembali
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCancelConfirm(false);
                  onClose();
                }}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
              >
                Ya, Batalkan &amp; Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Export Method Picker Modal (Choose among 3 Allowance Methods before Excel/PDF) */}
      {exportPicker && previewExportRecord && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/55 backdrop-blur-xs p-4"
          onClick={() => setExportPicker(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white ${
                    exportPicker.target === 'excel' ? 'bg-[#047857]' : 'bg-[#1E3A8A]'
                  }`}
                >
                  {exportPicker.target === 'excel' ? (
                    <FileSpreadsheet className="w-4 h-4" />
                  ) : (
                    <Printer className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 truncate">
                    {exportPicker.target === 'excel'
                      ? 'Pilih Metode untuk Ekspor Excel'
                      : 'Pilih Metode untuk Ekspor PDF'}
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono-num truncate">
                    Assy {params.assyNo} · {params.masterCct} CCT · LOT {effectiveLot}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExportPicker(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                aria-label="Tutup pilihan ekspor"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5">
              <p className="text-xs text-slate-600">
                Pilih salah satu dari 3 metode perhitungan allowance yang akan dipakai pada laporan{' '}
                <strong>{exportPicker.target === 'excel' ? 'Excel (.xlsx)' : 'PDF Landscape'}</strong>:
              </p>

              <div className="space-y-2">
                {(
                  [
                    {
                      mode: 'none' as AllowanceMode,
                      title: '0. Tanpa Allowance (Base 0%)',
                      desc: 'Waktu dasar (+ kesulitan bila ada) tanpa tambahan allowance PFD.',
                      sec: previewExportRecord.calculation.totalBaseSec,
                    },
                    {
                      mode: 'by_process' as AllowanceMode,
                      title: `1. By Proses (+${
                        exportPicker.overridePctStr.trim() !== ''
                          ? Math.max(0, Number(exportPicker.overridePctStr) || 0)
                          : params.pfdAllowancePct || 0
                      }%)`,
                      desc: 'Tambahan allowance diterapkan merata di setiap proses hingga substep.',
                      sec: previewExportRecord.calculation.totalAllowByProcessSec,
                    },
                    {
                      mode: 'by_final' as AllowanceMode,
                      title: `2. By Hasil Akhir (+${
                        exportPicker.overridePctStr.trim() !== ''
                          ? Math.max(0, Number(exportPicker.overridePctStr) || 0)
                          : params.pfdAllowancePct || 0
                      }%)`,
                      desc: 'Allowance didistribusikan berdasarkan bobot kesulitan tiap proses.',
                      sec: previewExportRecord.calculation.totalAllowByFinalSec,
                    },
                  ]
                ).map((opt) => {
                  const selected = exportPicker.chosenMode === opt.mode;
                  return (
                    <button
                      key={opt.mode}
                      type="button"
                      onClick={() =>
                        setExportPicker((prev) =>
                          prev ? { ...prev, chosenMode: opt.mode, error: null } : null
                        )
                      }
                      className={`w-full text-left px-4 py-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        selected
                          ? 'border-[#1E3A8A] bg-blue-50/70 ring-2 ring-[#1E3A8A]/15'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                              selected
                                ? 'border-[#1E3A8A] bg-[#1E3A8A] text-white'
                                : 'border-slate-300 bg-white'
                            }`}
                          >
                            {selected && <Check className="w-2.5 h-2.5" />}
                          </span>
                          <span className="text-xs font-bold text-slate-900">{opt.title}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1 pl-6">{opt.desc}</p>
                      </div>
                      <div className="text-right font-mono-num shrink-0">
                        <div className="text-xs font-bold text-slate-900">
                          {opt.sec.toFixed(2)}s
                        </div>
                        <div className="text-[11px] text-[#047857] font-semibold">
                          {(opt.sec / 3600).toFixed(4)} hr
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {exportPicker.chosenMode !== 'none' && (
                <div className="rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800">
                      Persentase Allowance Ekspor (%)
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {params.pfdAllowancePct > 0
                        ? `Mengikuti setting Assy (${params.pfdAllowancePct}%), bisa disesuaikan khusus ekspor ini.`
                        : 'Assy disimpan tanpa allowance (0%). Masukkan % untuk ekspor metode ini.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="100"
                      value={exportPicker.overridePctStr}
                      onChange={(e) =>
                        setExportPicker((prev) =>
                          prev
                            ? { ...prev, overridePctStr: e.target.value, error: null }
                            : null
                        )
                      }
                      placeholder="15"
                      className="w-20 text-right font-mono-num text-xs font-semibold px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]"
                    />
                    <span className="text-xs font-semibold text-slate-600">%</span>
                  </div>
                </div>
              )}

              {exportPicker.target === 'pdf' && (
                <div className="space-y-2 pt-1 border-t border-slate-200">
                  <p className="text-xs font-semibold text-slate-800">Format Tampilan PDF:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExportPicker((prev) =>
                          prev ? { ...prev, pdfLayout: 'summary' } : null
                        )
                      }
                      className={`text-left px-3 py-2.5 rounded-xl border transition-all cursor-pointer ${
                        exportPicker.pdfLayout === 'summary'
                          ? 'border-[#047857] bg-emerald-50/70 ring-2 ring-[#047857]/15'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                        <FileText className="w-3.5 h-3.5 text-[#047857] shrink-0" />
                        <span>Ringkas (Summary 21 Proses)</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Laporan harian padat 1 halaman A4 Landscape berisi rekap 21 item proses (REG &amp; SMV).
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setExportPicker((prev) =>
                          prev ? { ...prev, pdfLayout: 'detailed' } : null
                        )
                      }
                      className={`text-left px-3 py-2.5 rounded-xl border transition-all cursor-pointer ${
                        exportPicker.pdfLayout === 'detailed'
                          ? 'border-[#1E3A8A] bg-blue-50/70 ring-2 ring-[#1E3A8A]/15'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                        <Layers className="w-3.5 h-3.5 text-[#1E3A8A] shrink-0" />
                        <span>Lengkap (+ Sub-Step)</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Tabel 21 proses beserta lampiran rincian sub-step aktif REG &amp; SMV.
                      </p>
                    </button>
                  </div>
                </div>
              )}

              {exportPicker.error && (
                <p className="text-xs font-semibold text-red-600">{exportPicker.error}</p>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setExportPicker(null)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Batal
              </button>
              {exportPicker.target === 'excel' ? (
                <button
                  type="button"
                  onClick={() => handleConfirmExport()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#047857] hover:bg-[#065F46] text-white text-xs font-semibold cursor-pointer shadow-xs"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Ekspor Excel (.xlsx)</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleConfirmExport('preview')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-xs font-semibold cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Pratinjau / Cetak</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfirmExport('download')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1E3A8A] hover:bg-[#172E6E] text-white text-xs font-semibold cursor-pointer shadow-xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Unduh PDF (.pdf)</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
