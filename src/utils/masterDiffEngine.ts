import {
  STD_COT_COL_LABELS,
  STD_COT_ROW_LABELS,
  STD_SETTING_WIRE_COL_LABELS,
  STD_SETTING_WIRE_ROW_LABELS,
  DIFFICULTY_ROW_LABELS,
} from '../data/cotMasterV2';
import {
  AutoCutItem,
  FeederItem,
  MasterChangeCategory,
  MasterChangeDiffItem,
  MasterChangeHistoryEntry,
  MasterChangeSource,
  StdDatabase,
  StdParamItem,
} from '../types/umh';

export {
  STD_COT_COL_LABELS,
  STD_COT_ROW_LABELS,
  STD_SETTING_WIRE_COL_LABELS,
  STD_SETTING_WIRE_ROW_LABELS,
  DIFFICULTY_ROW_LABELS,
};

export type MatrixKey =
  | 'acMatrix'
  | 'saMatrix'
  | 'mcMatrix'
  | 'cotMatrix'
  | 'settingWireMatrix'
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
    key: 'settingWireMatrix',
    name: 'Matriks Setting Wires on Board (T1–T7)',
    shortName: 'Setting Wires (T1–T7)',
    sheetName: 'Matriks Setting Wire',
    title: 'Auto-Lookup Matrix Setting Wires on Board — MATRIX_SETTING_WIRE_CCT (Jenjang CCT PPCS × Rate dtk/CCT)',
    rowHeaderLabel: 'Jenjang CCT (PPCS)',
    colSuffix: '',
    unitLabel: 'dtk / CCT',
    rowLabels: STD_SETTING_WIRE_ROW_LABELS,
    colLabels: STD_SETTING_WIRE_COL_LABELS,
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

export const MASTER_CATEGORY_LABELS: Record<MasterChangeCategory, string> = {
  std_params: 'Parameter STD (Sub-Step)',
  std_matrices: 'Matriks 2D (LOT × Panjang & COT V2)',
  auto_cut: 'Auto Cutting List',
  feeder: 'Feeder List (Wire Seal)',
};

export const MASTER_SOURCE_LABELS: Record<MasterChangeSource, string> = {
  manual_edit: 'Edit Manual Massal',
  excel_upload: 'Upload Excel',
  reset_default: 'Reset Default',
};
