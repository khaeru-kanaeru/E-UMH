import {
  STD_COT_COL_LABELS,
  STD_COT_ROW_LABELS,
  DIFFICULTY_ROW_LABELS,
} from '../data/cotMasterV2';
import {
  AssyRecord,
  AutoCutItem,
  FeederItem,
  MasterChangeCategory,
  MasterChangeDiffItem,
  MasterChangeHistoryEntry,
  MasterChangeSource,
  StdDatabase,
  StdParamItem,
} from '../types/umh';
import { getAllowanceModeLabel, getAllowSecForMode } from '../engine/umhCalculator';

export {
  STD_COT_COL_LABELS,
  STD_COT_ROW_LABELS,
  DIFFICULTY_ROW_LABELS,
};

export type MatrixKey =
  | 'acMatrix'
  | 'saMatrix'
  | 'mcMatrix'
  | 'cotMatrix'
  | 'difficultyMatrix';

export const STD_COL_LABELS_7 = [
  '0~1000',
  '1001~2000',
  '2001~3000',
  '3001~4000',
  '4001~5000',
  '5001~6000',
  '6001~',
];

export const STD_COL_LABELS_4 = ['0~1000', '1001~2000', '2001~5000', '5001~'];

export const STD_AC_ROW_LABELS = [
  'LOT 1~10',
  'LOT 11~20',
  'LOT 21~30',
  'LOT 31~40',
  'LOT 41~50',
  'LOT 51~',
];

export const STD_SA_ROW_LABELS = [
  'LOT 1~5',
  'LOT 6~10',
  'LOT 11~20',
  'LOT 21~30',
  'LOT 31~40',
  'LOT 41~50',
  'LOT 51~',
];

export const STD_MC_ROW_LABELS = [
  'LOT 1~3',
  'LOT 4~5',
  'LOT 6~10',
  'LOT 11~20',
  'LOT 21~30',
  'LOT 31~40',
  'LOT 41~50',
  'LOT 51~',
];

export interface MatrixConfigDef {
  key: MatrixKey;
  name: string;
  shortName: string;
  sheetName: string;
  title: string;
  rowHeaderLabel: string;
  colSuffix: string;
  unitLabel: string;
  rowLabels: string[];
  colLabels: string[];
}

export const MATRIX_CONFIGS: MatrixConfigDef[] = [
  {
    key: 'acMatrix',
    name: 'Matriks 2D Autocutting',
    shortName: 'Autocutting',
    sheetName: 'Matriks Autocutting',
    title: 'Matriks 2D Autocutting (Detik/CCT: LOT × Panjang Kabel)',
    rowHeaderLabel: 'Rentang LOT',
    colSuffix: ' mm',
    unitLabel: 'Detik / CCT',
    rowLabels: STD_AC_ROW_LABELS,
    colLabels: STD_COL_LABELS_7,
  },
  {
    key: 'saMatrix',
    name: 'Matriks 2D Semi-autocutting',
    shortName: 'Semi-Auto',
    sheetName: 'Matriks Semi-Auto',
    title: 'Matriks 2D Semi-autocutting (Detik/CCT: LOT × Panjang Kabel)',
    rowHeaderLabel: 'Rentang LOT',
    colSuffix: ' mm',
    unitLabel: 'Detik / CCT',
    rowLabels: STD_SA_ROW_LABELS,
    colLabels: STD_COL_LABELS_7,
  },
  {
    key: 'mcMatrix',
    name: 'Matriks 2D Manual-(Air)cutting',
    shortName: 'Manual-(Air)',
    sheetName: 'Matriks Manual',
    title: 'Matriks 2D Manual-（Air）cutting (Detik/CCT: LOT × Panjang Kabel)',
    rowHeaderLabel: 'Rentang LOT',
    colSuffix: ' mm',
    unitLabel: 'Detik / CCT',
    rowLabels: STD_MC_ROW_LABELS,
    colLabels: STD_COL_LABELS_4,
  },
  {
    key: 'cotMatrix',
    name: 'Matriks COT (Master_COT_V2)',
    shortName: 'COT (Master_COT_V2)',
    sheetName: 'Matriks COT V2',
    title: 'Matriks Faktor Waktu Taping COT — Master_COT_V2 (DIA × Faktor Detik)',
    rowHeaderLabel: 'DIA',
    colSuffix: '',
    unitLabel: 'Master_COT_V2',
    rowLabels: STD_COT_ROW_LABELS,
    colLabels: STD_COT_COL_LABELS,
  },
  {
    key: 'difficultyMatrix',
    name: 'Matriks Kesulitan Manual (Bintang 0.0–5.0)',
    shortName: 'Difficulty Matrix',
    sheetName: 'Matriks Kesulitan',
    title: 'Matriks Penambahan Persentase Kesulitan Berdasarkan Rating Bintang (0.0–5.0 ★)',
    rowHeaderLabel: 'Rating Bintang',
    colSuffix: '',
    unitLabel: 'Penambahan (%)',
    rowLabels: DIFFICULTY_ROW_LABELS,
    colLabels: ['Penambahan (%)'],
  },
];

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '0';
  return Number(v.toFixed(6)).toString();
}

export function computeStdParamsDiff(
  before: StdParamItem[],
  after: StdParamItem[]
): MasterChangeDiffItem[] {
  const beforeMap = new Map(before.map((p) => [p.id, p]));
  const afterMap = new Map(after.map((p) => [p.id, p]));
  const diffs: MasterChangeDiffItem[] = [];

  for (const nextItem of after) {
    const prevItem = beforeMap.get(nextItem.id);
    if (!prevItem) {
      diffs.push({
        key: `param_${nextItem.id}`,
        group: nextItem.sheet,
        label: nextItem.name,
        subLabel: `${nextItem.stage} · ${nextItem.basis}`,
        action: 'added',
        beforeValue: '-',
        afterValue: fmtNum(nextItem.val),
        deltaNumeric: nextItem.val,
      });
    } else if (!nearlyEqual(prevItem.val, nextItem.val)) {
      diffs.push({
        key: `param_${nextItem.id}`,
        group: nextItem.sheet,
        label: nextItem.name,
        subLabel: `${nextItem.stage} · ${nextItem.basis}`,
        action: 'modified',
        beforeValue: fmtNum(prevItem.val),
        afterValue: fmtNum(nextItem.val),
        deltaNumeric: Number((nextItem.val - prevItem.val).toFixed(6)),
      });
    }
  }

  for (const prevItem of before) {
    if (!afterMap.has(prevItem.id)) {
      diffs.push({
        key: `param_${prevItem.id}`,
        group: prevItem.sheet,
        label: prevItem.name,
        subLabel: `${prevItem.stage} · ${prevItem.basis}`,
        action: 'removed',
        beforeValue: fmtNum(prevItem.val),
        afterValue: '-',
        deltaNumeric: -prevItem.val,
      });
    }
  }

  return diffs;
}

export function computeStdMatricesDiff(
  before: StdDatabase,
  after: StdDatabase
): MasterChangeDiffItem[] {
  const diffs: MasterChangeDiffItem[] = [];

  for (const cfg of MATRIX_CONFIGS) {
    const prevMat = before[cfg.key] || [];
    const nextMat = after[cfg.key] || [];

    cfg.rowLabels.forEach((rowLbl, rIdx) => {
      cfg.colLabels.forEach((colLbl, cIdx) => {
        const prevVal = Number(prevMat[rIdx]?.[cIdx] ?? 0);
        const nextVal = Number(nextMat[rIdx]?.[cIdx] ?? 0);
        if (!nearlyEqual(prevVal, nextVal)) {
          diffs.push({
            key: `${cfg.key}_${rIdx}_${cIdx}`,
            group: cfg.name,
            label: `${rowLbl} × ${colLbl}${cfg.colSuffix}`,
            subLabel: cfg.unitLabel,
            action: 'modified',
            beforeValue: fmtNum(prevVal),
            afterValue: fmtNum(nextVal),
            deltaNumeric: Number((nextVal - prevVal).toFixed(6)),
          });
        }
      });
    });
  }

  return diffs;
}

export function computeAutoCutDiff(
  before: AutoCutItem[],
  after: AutoCutItem[]
): { diffs: MasterChangeDiffItem[]; removedItems: AutoCutItem[] } {
  const beforeMap = new Map(before.map((x) => [x.id, x]));
  const afterMap = new Map(after.map((x) => [x.id, x]));
  const diffs: MasterChangeDiffItem[] = [];
  const removedItems: AutoCutItem[] = [];

  for (const nextItem of after) {
    const prevItem = beforeMap.get(nextItem.id);
    if (!prevItem) {
      diffs.push({
        key: `ac_${nextItem.id}`,
        group: nextItem.customer || 'All',
        label: nextItem.terminal,
        subLabel: 'Auto Cutting List',
        action: 'added',
        beforeValue: '-',
        afterValue: `${nextItem.customer || 'All'} · ${nextItem.terminal}`,
        deltaNumeric: null,
      });
    } else if (
      prevItem.customer.trim() !== nextItem.customer.trim() ||
      prevItem.terminal.trim() !== nextItem.terminal.trim()
    ) {
      diffs.push({
        key: `ac_${nextItem.id}`,
        group: nextItem.customer || 'All',
        label: nextItem.terminal,
        subLabel: 'Auto Cutting List',
        action: 'modified',
        beforeValue: `${prevItem.customer || 'All'} · ${prevItem.terminal}`,
        afterValue: `${nextItem.customer || 'All'} · ${nextItem.terminal}`,
        deltaNumeric: null,
      });
    }
  }

  for (const prevItem of before) {
    if (!afterMap.has(prevItem.id)) {
      removedItems.push(prevItem);
      diffs.push({
        key: `ac_${prevItem.id}`,
        group: prevItem.customer || 'All',
        label: prevItem.terminal,
        subLabel: 'Auto Cutting List',
        action: 'removed',
        beforeValue: `${prevItem.customer || 'All'} · ${prevItem.terminal}`,
        afterValue: '-',
        deltaNumeric: null,
      });
    }
  }

  return { diffs, removedItems };
}

export function computeFeederDiff(
  before: FeederItem[],
  after: FeederItem[]
): { diffs: MasterChangeDiffItem[]; removedItems: FeederItem[] } {
  const beforeMap = new Map(before.map((x) => [x.id, x]));
  const afterMap = new Map(after.map((x) => [x.id, x]));
  const diffs: MasterChangeDiffItem[] = [];
  const removedItems: FeederItem[] = [];

  for (const nextItem of after) {
    const prevItem = beforeMap.get(nextItem.id);
    if (!prevItem) {
      diffs.push({
        key: `fd_${nextItem.id}`,
        group: 'Wire Seal',
        label: nextItem.seal,
        subLabel: 'Feeder List',
        action: 'added',
        beforeValue: '-',
        afterValue: nextItem.seal,
        deltaNumeric: null,
      });
    } else if (prevItem.seal.trim() !== nextItem.seal.trim()) {
      diffs.push({
        key: `fd_${nextItem.id}`,
        group: 'Wire Seal',
        label: nextItem.seal,
        subLabel: 'Feeder List',
        action: 'modified',
        beforeValue: prevItem.seal,
        afterValue: nextItem.seal,
        deltaNumeric: null,
      });
    }
  }

  for (const prevItem of before) {
    if (!afterMap.has(prevItem.id)) {
      removedItems.push(prevItem);
      diffs.push({
        key: `fd_${prevItem.id}`,
        group: 'Wire Seal',
        label: prevItem.seal,
        subLabel: 'Feeder List',
        action: 'removed',
        beforeValue: prevItem.seal,
        afterValue: '-',
        deltaNumeric: null,
      });
    }
  }

  return { diffs, removedItems };
}

export function createMasterChangeEntry(params: {
  responsibleName: string;
  category: MasterChangeCategory;
  source: MasterChangeSource;
  sourceFileName?: string;
  note?: string;
  totalItemsCount: number;
  changes: MasterChangeDiffItem[];
}): MasterChangeHistoryEntry {
  const addedCount = params.changes.filter((c) => c.action === 'added').length;
  const modifiedCount = params.changes.filter((c) => c.action === 'modified').length;
  const removedCount = params.changes.filter((c) => c.action === 'removed').length;

  return {
    id: `MC-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`,
    changedAt: new Date().toISOString(),
    responsibleName: params.responsibleName.trim().slice(0, 120) || 'PIC',
    category: params.category,
    source: params.source,
    ...(params.sourceFileName ? { sourceFileName: params.sourceFileName.slice(0, 160) } : {}),
    ...(params.note?.trim() ? { note: params.note.trim().slice(0, 240) } : {}),
    totalItemsCount: params.totalItemsCount,
    addedCount,
    modifiedCount,
    removedCount,
    changes: params.changes,
  };
}

export function computeAssyManualEditDiff(
  before: AssyRecord,
  after: AssyRecord
): MasterChangeDiffItem[] {
  const diffs: MasterChangeDiffItem[] = [];
  const group = `Assy ${after.params.assyNo || before.params.assyNo}`;

  const pushTextDiff = (key: string, label: string, subLabel: string, prevVal: string, nextVal: string) => {
    if (prevVal.trim() !== nextVal.trim()) {
      diffs.push({
        key,
        group,
        label,
        subLabel,
        action: 'modified',
        beforeValue: prevVal || '-',
        afterValue: nextVal || '-',
        deltaNumeric: null,
      });
    }
  };

  const pushNumDiff = (
    key: string,
    label: string,
    subLabel: string,
    prevVal: number,
    nextVal: number,
    digits = 2,
    suffix = ''
  ) => {
    if (Math.abs(prevVal - nextVal) >= 1e-6) {
      const delta = Number((nextVal - prevVal).toFixed(digits));
      diffs.push({
        key,
        group,
        label,
        subLabel,
        action: 'modified',
        beforeValue: `${prevVal.toFixed(digits)}${suffix}`,
        afterValue: `${nextVal.toFixed(digits)}${suffix}`,
        deltaNumeric: delta,
      });
    }
  };

  pushTextDiff('assy_no', 'Assy Number', 'Identitas Assy', before.params.assyNo, after.params.assyNo);
  pushTextDiff('customer', 'Customer', 'Identitas Assy', before.params.customer || '-', after.params.customer || '-');
  pushNumDiff('master_cct', 'Jumlah CCT', 'Parameter Produksi', before.params.masterCct, after.params.masterCct, 0, ' CCT');
  pushNumDiff('lot', 'LOT Produksi', 'Parameter Produksi', before.params.lot ?? 15, after.params.lot ?? 15, 0, '');

  const prevDiffStar = before.params.difficultyRating ?? 0;
  const nextDiffStar = after.params.difficultyRating ?? 0;
  if (Math.abs(prevDiffStar - nextDiffStar) >= 1e-6) {
    diffs.push({
      key: 'difficulty_rating',
      group,
      label: 'Tingkat Kesulitan (Bintang)',
      subLabel: 'Pengaturan Kesulitan',
      action: 'modified',
      beforeValue: `${prevDiffStar.toFixed(1)} ★ (+${(before.calculation.difficultyPct ?? 0).toFixed(2)}%)`,
      afterValue: `${nextDiffStar.toFixed(1)} ★ (+${(after.calculation.difficultyPct ?? 0).toFixed(2)}%)`,
      deltaNumeric: Number((nextDiffStar - prevDiffStar).toFixed(1)),
    });
  }

  if (before.params.allowanceMode !== after.params.allowanceMode) {
    diffs.push({
      key: 'allowance_mode',
      group,
      label: 'Metode Allowance',
      subLabel: 'Pengaturan Allowance',
      action: 'modified',
      beforeValue: getAllowanceModeLabel(before.params.allowanceMode, 'short'),
      afterValue: getAllowanceModeLabel(after.params.allowanceMode, 'short'),
      deltaNumeric: null,
    });
  }

  const prevPfd = before.params.allowanceMode === 'none' ? 0 : before.params.pfdAllowancePct || 0;
  const nextPfd = after.params.allowanceMode === 'none' ? 0 : after.params.pfdAllowancePct || 0;
  pushNumDiff('pfd_allowance', 'Persentase Allowance PFD', 'Pengaturan Allowance', prevPfd, nextPfd, 2, '%');

  // Assembly components
  const asmFields: { key: keyof AssyRecord['assemblyComponents']; label: string }[] = [
    { key: 'markerQty', label: 'Komponen Marker (nm)' },
    { key: 'spotTapeQty', label: 'Komponen Spot Tape (ns)' },
    { key: 'namePlateQty', label: 'Komponen Name Plate (nn)' },
    { key: 'clipQty', label: 'Komponen Clip (nx)' },
    { key: 'clampQty', label: 'Komponen Clamp (ny)' },
  ];
  asmFields.forEach(({ key, label }) => {
    pushNumDiff(
      `asm_${key}`,
      label,
      'Komponen Assembly',
      before.assemblyComponents?.[key] ?? 0,
      after.assemblyComponents?.[key] ?? 0,
      0
    );
  });

  // Dataset counts
  pushNumDiff('pl_count', 'Jumlah Baris PART LIST', 'Data BOM', before.partList.length, after.partList.length, 0);
  pushNumDiff('ppcs_count', 'Jumlah Sirkuit PPCS', 'Data Wire List', before.ppcsList.length, after.ppcsList.length, 0);
  pushNumDiff('cot_count', 'Jumlah Baris Assembly COT', 'Data COT', before.assemblyCotList.length, after.assemblyCotList.length, 0);

  // Terminal ratios change summary
  const beforeRatiosJson = JSON.stringify(before.terminalRatios || {});
  const afterRatiosJson = JSON.stringify(after.terminalRatios || {});
  if (beforeRatiosJson !== afterRatiosJson) {
    diffs.push({
      key: 'terminal_ratios',
      group,
      label: 'Rasio Terminal Auto-Cut',
      subLabel: 'Konfigurasi Mesin',
      action: 'modified',
      beforeValue: `${Object.keys(before.terminalRatios || {}).length} terminal`,
      afterValue: `${Object.keys(after.terminalRatios || {}).length} terminal (diperbarui)`,
      deltaNumeric: null,
    });
  }

  // Resulting Base Cycle & Standard Allow UMH
  pushNumDiff(
    'base_cycle_sec',
    'Base Cycle + Kesulitan (REG)',
    'Hasil Kalkulasi (Detik)',
    before.calculation.totalBaseSec,
    after.calculation.totalBaseSec,
    2,
    ' s'
  );

  const beforeAllowSec = getAllowSecForMode(
    before.params.allowanceMode,
    before.calculation.totalBaseSec,
    before.calculation.totalAllowByProcessSec,
    before.calculation.totalAllowByFinalSec
  );
  const afterAllowSec = getAllowSecForMode(
    after.params.allowanceMode,
    after.calculation.totalBaseSec,
    after.calculation.totalAllowByProcessSec,
    after.calculation.totalAllowByFinalSec
  );
  pushNumDiff('allow_sec', 'Total Allow REG (Detik)', 'Hasil Kalkulasi (Detik)', beforeAllowSec, afterAllowSec, 2, ' s');
  pushNumDiff('allow_hr', 'Standard UMH REG (Hour)', 'Hasil Kalkulasi (Jam)', beforeAllowSec / 3600, afterAllowSec / 3600, 4, ' hr');

  return diffs;
}

export const MASTER_CATEGORY_LABELS: Record<MasterChangeCategory, string> = {
  std_params: 'Parameter STD (Sub-Step)',
  std_matrices: 'Matriks 2D (LOT × Panjang & COT V2)',
  auto_cut: 'Auto Cutting List',
  feeder: 'Feeder List (Wire Seal)',
  assy_manual_edit: 'Perubahan Manual Assy',
};

export const MASTER_SOURCE_LABELS: Record<MasterChangeSource, string> = {
  manual_edit: 'Edit Manual',
  excel_upload: 'Upload Excel',
  reset_default: 'Reset Default',
};
