import { resolveDifficultyPercentage } from '../data/cotMasterV2';
import {
  DEFAULT_PROCESS_DISCS,
  upgradeBuiltinProcessDiscs,
} from '../data/defaultProcessDiscs';
import { PROCESS_DIFF_MAP } from '../data/defaultStdDb';
import {
  AllowanceMode,
  AssyInputPayload,
  AssyRecord,
  AutoCutItem,
  CalculationResult,
  CalculationVariant,
  FeederItem,
  LotMetrics,
  PpcsWireItem,
  ProcessLogicDisc,
  ProcessResult,
  ResultVariant,
  StdDatabase,
} from '../types/umh';
import { buildProcessDiscContext, executeProcessDisc } from '../utils/discEngine';

export const DEFAULT_LOT_SIZE = 15;

export function getEffectiveLot(lotInput?: number): number {
  return typeof lotInput === 'number' && Number.isFinite(lotInput) && lotInput > 0
    ? Math.max(1, lotInput)
    : DEFAULT_LOT_SIZE;
}

export function getAllowanceModeLabel(
  mode: AllowanceMode,
  style: 'short' | 'numbered' = 'short'
): string {
  if (mode === 'none') {
    return style === 'numbered' ? '0. Tanpa Allowance' : 'Tanpa Allowance';
  }
  if (mode === 'by_final') {
    return style === 'numbered' ? '2. By Hasil Akhir' : 'By Hasil Akhir';
  }
  return style === 'numbered' ? '1. By Proses' : 'By Proses';
}

export function getAllowSecForMode(
  mode: AllowanceMode,
  baseSec: number,
  allowByProcessSec: number,
  allowByFinalSec: number
): number {
  if (mode === 'none') return baseSec;
  if (mode === 'by_final') return allowByFinalSec;
  return allowByProcessSec;
}

export function computeLotMetrics(lotInput?: number): LotMetrics {
  const effLot = getEffectiveLot(lotInput);
  return {
    monthlyQty: 0,
    dailyQty: 0,
    rawLot: effLot,
    effectiveLot: effLot,
    isAutoCutActive: true,
  };
}

export function parseWireSize(sz: string): number {
  if (!sz) return 0;
  const cleaned = String(sz).toLowerCase().replace(/f/g, '').trim();
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

export function extractAutoCutCandidateTerminals(
  ppcsList: PpcsWireItem[]
): { partNo: string; count: number }[] {
  const termCounts: Record<string, number> = {};
  for (const r of ppcsList) {
    if (parseWireSize(r.sizeRaw) >= 3) continue;
    if (r.rAc && r.termR) {
      const k = r.termR.toUpperCase();
      termCounts[k] = (termCounts[k] || 0) + 1;
    }
    if (r.fAc && r.termF) {
      const k = r.termF.toUpperCase();
      termCounts[k] = (termCounts[k] || 0) + 1;
    }
  }
  return Object.entries(termCounts).map(([partNo, count]) => ({ partNo, count }));
}

export function groupTwistBundlesCount(ppcsList: PpcsWireItem[]): number {
  const twRows = ppcsList.filter((r) => r.twist !== '');
  if (twRows.length === 0) return 0;
  const parent: Record<string, string> = {};
  const find = (x: string): string => {
    if (!(x in parent)) parent[x] = x;
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  twRows.forEach((r) => {
    find(r.cctNo);
    r.twist.split(',').forEach((p) => {
      const pt = p.trim();
      if (pt) union(r.cctNo, pt);
    });
  });
  const roots = new Set<string>();
  twRows.forEach((r) => roots.add(find(r.cctNo)));
  return roots.size;
}

function executeVariant(
  payload: AssyInputPayload,
  stdDb: StdDatabase,
  autoCutList: AutoCutItem[],
  feederList: FeederItem[],
  activeDiscs: ProcessLogicDisc[],
  twistBundlesCount: number,
  excludeAutoCut: boolean
): CalculationVariant {
  const { params } = payload;
  const ctx = buildProcessDiscContext(payload, stdDb, autoCutList, feederList, {
    excludeAutoCut,
  });

  let subIdx = 0;
  const rawItems: ProcessResult[] = activeDiscs.map((disc) => {
    if (excludeAutoCut && disc.processId === 2) {
      return {
        processId: disc.processId,
        processName: disc.processName,
        jpName: disc.jpName,
        weight: disc.weight || PROCESS_DIFF_MAP[disc.processName] || 1.0,
        active: false,
        summaryNote: 'Tidak ada Autocutting pada mode SMV (proses lain tetap ada)',
        baseSec: 0,
        allowByProcessSec: 0,
        allowByFinalSec: 0,
        subSteps: [],
      };
    }

    const res = executeProcessDisc(disc, ctx, subIdx);
    subIdx = res.nextSubIdx;

    return {
      processId: disc.processId,
      processName: disc.processName,
      jpName: disc.jpName,
      weight: disc.weight || PROCESS_DIFF_MAP[disc.processName] || 1.0,
      active: res.active,
      summaryNote: res.summaryNote,
      baseSec: res.baseSec,
      allowByProcessSec: res.baseSec,
      allowByFinalSec: res.baseSec,
      subSteps: res.subSteps,
    };
  });

  // --- MANUAL DIFFICULTY RATING SCALING ---
  const rating = params.difficultyRating ?? 0;
  const diffPct = resolveDifficultyPercentage(rating, stdDb.difficultyMatrix);
  const diffMultiplier = 1 + diffPct / 100;

  if (diffMultiplier !== 1) {
    rawItems.forEach((it) => {
      it.baseSec *= diffMultiplier;
      it.subSteps.forEach((st) => {
        st.baseSec *= diffMultiplier;
      });
    });
  }

  // --- DUAL-MODE ALLOWANCE ENGINE ---
  const totalBaseSec = rawItems.reduce((a, b) => a + b.baseSec, 0);
  const rate = (params.pfdAllowancePct || 0) / 100;
  const totalAllowSec = totalBaseSec * rate;

  const activeItems = rawItems.filter((it) => it.baseSec > 0);
  const sumWeight = activeItems.reduce(
    (s, it) => s + it.baseSec * (it.weight || PROCESS_DIFF_MAP[it.processName] || 1.0),
    0
  );

  for (const it of rawItems) {
    if (it.baseSec <= 0 || rate <= 0) {
      it.allowByProcessSec = it.baseSec;
      it.allowByFinalSec = it.baseSec;
      continue;
    }

    const procWeight = it.weight || PROCESS_DIFF_MAP[it.processName] || 1.0;
    const procAllowByProcess = it.baseSec * rate;
    const procAllowByFinal =
      totalAllowSec * ((it.baseSec * procWeight) / (sumWeight || 1));

    it.allowByProcessSec = it.baseSec + procAllowByProcess;
    it.allowByFinalSec = it.baseSec + procAllowByFinal;

    const subs = it.subSteps;
    const subWeights = subs.map((st) => {
      const stageBoost = st.stage && st.stage.toLowerCase().includes('main') ? 1.35 : 1.0;
      return Math.pow(Math.max(0, st.baseSec), 1.2) * stageBoost;
    });
    const sumSubW = subWeights.reduce((a, b) => a + b, 0);

    subs.forEach((st, idx) => {
      const share = sumSubW > 0 ? subWeights[idx] / sumSubW : 0;
      st.allowByProcessSec = st.baseSec + procAllowByProcess * share;
      st.allowByFinalSec = st.baseSec + procAllowByFinal * share;
    });
  }

  const totalAllowByProcessSec = rawItems.reduce((a, b) => a + b.allowByProcessSec, 0);
  const totalAllowByFinalSec = rawItems.reduce((a, b) => a + b.allowByFinalSec, 0);

  return {
    totalBaseSec,
    totalAllowByProcessSec,
    totalAllowByFinalSec,
    processes: rawItems,
    twistBundlesCount,
  };
}

export function calculateUmh(
  payload: AssyInputPayload,
  stdDb: StdDatabase,
  autoCutList: AutoCutItem[],
  feederList: FeederItem[]
): CalculationResult {
  const { ppcsList: ppcs } = payload;
  const lotMetrics = computeLotMetrics(payload.params.lot);

  const activeDiscs = upgradeBuiltinProcessDiscs(
    stdDb.processDiscs && stdDb.processDiscs.length > 0
      ? [...stdDb.processDiscs]
      : [...DEFAULT_PROCESS_DISCS]
  ).sort((a, b) => a.processId - b.processId);

  const twistBundlesCount = groupTwistBundlesCount(ppcs);

  // REG: Standard calculation with Autocutting active
  const reg = executeVariant(
    payload,
    stdDb,
    autoCutList,
    feederList,
    activeDiscs,
    twistBundlesCount,
    false
  );

  // SMV: Special calculation excluding Autocutting (#2) -> falls back to Semi-Auto & Manual
  const smv = executeVariant(
    payload,
    stdDb,
    autoCutList,
    feederList,
    activeDiscs,
    twistBundlesCount,
    true
  );

  const appliedDifficultyRating = payload.params.difficultyRating ?? 0;
  const appliedDifficultyPct = resolveDifficultyPercentage(
    appliedDifficultyRating,
    stdDb.difficultyMatrix
  );

  return {
    lotMetrics,
    totalBaseSec: reg.totalBaseSec,
    totalAllowByProcessSec: reg.totalAllowByProcessSec,
    totalAllowByFinalSec: reg.totalAllowByFinalSec,
    processes: reg.processes,
    twistBundlesCount: reg.twistBundlesCount,
    autoCutCandidateTerminals: extractAutoCutCandidateTerminals(ppcs),
    difficultyRating: appliedDifficultyRating,
    difficultyPct: appliedDifficultyPct,
    smv,
  };
}

export function getVariantResult(
  record: AssyRecord,
  variant: ResultVariant
): CalculationVariant {
  const { calculation } = record;
  if (variant === 'smv' && calculation.smv) {
    return calculation.smv;
  }
  return {
    totalBaseSec: calculation.totalBaseSec,
    totalAllowByProcessSec: calculation.totalAllowByProcessSec,
    totalAllowByFinalSec: calculation.totalAllowByFinalSec,
    processes: calculation.processes,
    twistBundlesCount: calculation.twistBundlesCount,
  };
}

function applyAllowanceRateToVariant(
  variant: CalculationVariant,
  pct: number
): CalculationVariant {
  const rate = Math.max(0, pct) / 100;
  const clonedProcs: ProcessResult[] = structuredClone(variant.processes);
  const totalBaseSec = clonedProcs.reduce((a, b) => a + b.baseSec, 0);
  const totalAllowSec = totalBaseSec * rate;

  const activeItems = clonedProcs.filter((it) => it.baseSec > 0);
  const sumWeight = activeItems.reduce(
    (s, it) => s + it.baseSec * (it.weight || PROCESS_DIFF_MAP[it.processName] || 1.0),
    0
  );

  for (const it of clonedProcs) {
    if (it.baseSec <= 0 || rate <= 0) {
      it.allowByProcessSec = it.baseSec;
      it.allowByFinalSec = it.baseSec;
      it.subSteps.forEach((st) => {
        st.allowByProcessSec = st.baseSec;
        st.allowByFinalSec = st.baseSec;
      });
      continue;
    }

    const procWeight = it.weight || PROCESS_DIFF_MAP[it.processName] || 1.0;
    const procAllowByProcess = it.baseSec * rate;
    const procAllowByFinal =
      totalAllowSec * ((it.baseSec * procWeight) / (sumWeight || 1));

    it.allowByProcessSec = it.baseSec + procAllowByProcess;
    it.allowByFinalSec = it.baseSec + procAllowByFinal;

    const subs = it.subSteps;
    const subWeights = subs.map((st) => {
      const stageBoost = st.stage && st.stage.toLowerCase().includes('main') ? 1.35 : 1.0;
      return Math.pow(Math.max(0, st.baseSec), 1.2) * stageBoost;
    });
    const sumSubW = subWeights.reduce((a, b) => a + b, 0);

    subs.forEach((st, idx) => {
      const share = sumSubW > 0 ? subWeights[idx] / sumSubW : 0;
      st.allowByProcessSec = st.baseSec + procAllowByProcess * share;
      st.allowByFinalSec = st.baseSec + procAllowByFinal * share;
    });
  }

  return {
    totalBaseSec,
    totalAllowByProcessSec: clonedProcs.reduce((a, b) => a + b.allowByProcessSec, 0),
    totalAllowByFinalSec: clonedProcs.reduce((a, b) => a + b.allowByFinalSec, 0),
    processes: clonedProcs,
    twistBundlesCount: variant.twistBundlesCount,
  };
}

/**
 * Returns a record adjusted for exporting in a specific AllowanceMode
 * (and optional override percentage when exporting from a 0% / Tanpa Allowance record).
 */
export function buildExportRecordForMode(
  record: AssyRecord,
  exportMode: AllowanceMode,
  overridePct?: number
): AssyRecord {
  const effectivePct =
    exportMode === 'none'
      ? 0
      : overridePct !== undefined && Number.isFinite(overridePct)
      ? Math.max(0, overridePct)
      : record.params.pfdAllowancePct || 0;

  const needsRecompute =
    exportMode !== 'none' && Math.abs(effectivePct - (record.params.pfdAllowancePct || 0)) > 1e-6;

  if (!needsRecompute) {
    return {
      ...record,
      params: {
        ...record.params,
        allowanceMode: exportMode,
        pfdAllowancePct: exportMode === 'none' ? 0 : record.params.pfdAllowancePct,
      },
    };
  }

  const regVariant = applyAllowanceRateToVariant(getVariantResult(record, 'reg'), effectivePct);
  const smvVariant = record.calculation.smv
    ? applyAllowanceRateToVariant(record.calculation.smv, effectivePct)
    : undefined;

  return {
    ...record,
    params: {
      ...record.params,
      allowanceMode: exportMode,
      pfdAllowancePct: effectivePct,
    },
    calculation: {
      ...record.calculation,
      totalBaseSec: regVariant.totalBaseSec,
      totalAllowByProcessSec: regVariant.totalAllowByProcessSec,
      totalAllowByFinalSec: regVariant.totalAllowByFinalSec,
      processes: regVariant.processes,
      smv: smvVariant,
    },
  };
}
