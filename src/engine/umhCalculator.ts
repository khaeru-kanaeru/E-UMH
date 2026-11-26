import {
  calculateCotTapingV2Summary,
  resolveDifficultyPercentage,
} from '../data/cotMasterV2';
import { PROCESS_DIFF_MAP, PROCESS_META } from '../data/defaultStdDb';
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
  ProcessResult,
  ResultVariant,
  StdDatabase,
  SubStepResult,
} from '../types/umh';
import { calculateSpotTapeFromPartList } from '../utils/spotTapeCalculator';

export const DEFAULT_LOT_SIZE = 15;

const JOINT_CODES_LIST = [
  '553800', '565200', 'B-1.25', 'B-2', 'B-5.5', 'B-8', 'B-14', 'B-22', 'B-38', 'B-60',
  'P-1.25', 'P-2', 'P-5.5', 'P-8', 'P-14', 'P-22', 'P-38', 'P-60',
];

const JOINT_CODE_SET = new Set(JOINT_CODES_LIST);

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

export function computeLotMetrics(lotInput?: number, excludeAutoCut = false): LotMetrics {
  const effLot = getEffectiveLot(lotInput);
  return {
    monthlyQty: 0,
    dailyQty: 0,
    rawLot: effLot,
    effectiveLot: effLot,
    isAutoCutActive: !excludeAutoCut,
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

interface CircuitAlloc {
  row: PpcsWireItem;
  sz: number;
  eligibleR: boolean;
  eligibleF: boolean;
  acShare: number;
  remShare: number;
}

interface RawSubStep {
  stage: string;
  name: string;
  basis: string;
  qty: number;
  rate: number;
  baseSec: number;
}

interface NativeProcessOutput {
  active: boolean;
  summaryNote: string;
  subSteps: RawSubStep[];
  baseSec?: number;
}

function isNonCrimpTerm(t: string): boolean {
  const tu = String(t || '').trim().toUpperCase();
  if (!tu) return true;
  if (JOINT_CODE_SET.has(tu)) return true;
  if (tu.startsWith('B-') || tu.startsWith('P-')) return true;
  if (tu.includes('SOLDER')) return true;
  return false;
}

function groupTwistBundles(ppcs: PpcsWireItem[]): {
  bundles: number;
  ccts: number;
  totalLenM: number;
} {
  const twRows = ppcs.filter((r) => r.twist !== '');
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
  const groups: Record<string, number[]> = {};
  twRows.forEach((r) => {
    const root = find(r.cctNo);
    if (!groups[root]) groups[root] = [];
    groups[root].push(r.cl);
  });
  const bundles = Object.keys(groups).length;
  const ccts = twRows.length;
  const totalLenM =
    Object.values(groups).reduce(
      (sum, arr) => sum + arr.reduce((a, b) => a + b, 0) / arr.length,
      0
    ) / 1000;
  return { bundles, ccts, totalLenM };
}

function executeVariant(
  payload: AssyInputPayload,
  stdDb: StdDatabase,
  _autoCutList: AutoCutItem[],
  feederList: FeederItem[],
  twistBundlesCount: number,
  excludeAutoCut: boolean
): CalculationVariant {
  const {
    params,
    assemblyComponents,
    partList: pl,
    ppcsList: ppcs,
    assemblyCotList: dwg,
    terminalRatios: ratios = {},
  } = payload;

  const lotMetrics = computeLotMetrics(params.lot, excludeAutoCut);
  const lot = lotMetrics.effectiveLot;
  const isAcLotActive = lotMetrics.isAutoCutActive;
  const cctMaster = params.masterCct || 0;
  const ppcsCount = ppcs.filter((r) => r.assyNo !== '').length;

  const paramMap = new Map<string, number>();
  stdDb.params.forEach((p) => paramMap.set(p.id, Number(p.val)));

  const getP = (id: string, fallback = 0): number => {
    const val = paramMap.get(id);
    return val !== undefined && Number.isFinite(val) ? val : fallback;
  };

  const mkSub = (
    stage: string,
    name: string,
    basis: string,
    qty: number,
    rate: number,
    secPerUnit: number
  ): RawSubStep => ({
    stage,
    name,
    basis,
    qty,
    rate,
    baseSec: secPerUnit,
  });

  const getTermRatio = (term: string): number => {
    const k = String(term || '').trim().toUpperCase();
    return k in ratios ? ratios[k] / 100 : 1.0;
  };

  const circuitAllocs: CircuitAlloc[] = ppcs.map((r) => {
    const sz = parseWireSize(r.sizeRaw);
    const eligibleR = isAcLotActive && r.rAc && sz < 3;
    const eligibleF = isAcLotActive && r.fAc && sz < 3;
    let acShare = 0;
    if (eligibleR && eligibleF) {
      acShare = (getTermRatio(r.termR) + getTermRatio(r.termF)) / 2;
    } else if (eligibleR) {
      acShare = getTermRatio(r.termR);
    } else if (eligibleF) {
      acShare = getTermRatio(r.termF);
    }
    const remShare = 1 - acShare;
    return { row: r, sz, eligibleR, eligibleF, acShare, remShare };
  });

  const lenRanges7: [string, (r: PpcsWireItem) => boolean][] = [
    ['0~1000mm', (r) => r.cl > 0 && r.cl <= 1000],
    ['1001~2000mm', (r) => r.cl > 1000 && r.cl <= 2000],
    ['2001~3000mm', (r) => r.cl > 2000 && r.cl <= 3000],
    ['3001~4000mm', (r) => r.cl > 3000 && r.cl <= 4000],
    ['4001~5000mm', (r) => r.cl > 4000 && r.cl <= 5000],
    ['5001~6000mm', (r) => r.cl > 5000 && r.cl <= 6000],
    ['6001mm~', (r) => r.cl >= 6001],
  ];

  const computeProcess = (processId: number): NativeProcessOutput => {
    switch (processId) {
      case 1:
      case 8:
      case 15:
      case 18:
        return { active: false, summaryNote: 'Tidak digunakan (0)', subSteps: [] };

      case 2: {
        // Autocutting
        if (excludeAutoCut) {
          return {
            active: false,
            summaryNote: 'Tidak ada Autocutting pada mode SMV (proses lain tetap ada)',
            subSteps: [],
            baseSec: 0,
          };
        }
        const acThresholds = [1, 11, 21, 31, 41, 51];
        const acRowLabels = ['1~10', '11~20', '21~30', '31~40', '41~50', '51~'];
        let acRowIdx = 0;
        acThresholds.forEach((v, idx) => {
          if (lot >= v) acRowIdx = idx;
        });
        const acRates = stdDb.acMatrix[acRowIdx] || stdDb.acMatrix[0];

        const activeAcApps = new Set<string>();
        const activeAcFeeders = new Set<string>();

        circuitAllocs.forEach(({ row: r, eligibleR, eligibleF, acShare }) => {
          if (acShare > 0) {
            if (eligibleR && r.termR) activeAcApps.add(r.termR.toUpperCase());
            if (eligibleF && r.termF) activeAcApps.add(r.termF.toUpperCase());
          }
          if (r.rAf && acShare > 0) {
            [r.accR1, r.accR2].forEach((a) => {
              if (a && feederList.some((f) => f.seal.toLowerCase() === a.toLowerCase())) {
                activeAcFeeders.add(a.toUpperCase());
              }
            });
          }
          if (r.fAf && acShare > 0) {
            [r.accF1, r.accF2].forEach((a) => {
              if (a && feederList.some((f) => f.seal.toLowerCase() === a.toLowerCase())) {
                activeAcFeeders.add(a.toUpperCase());
              }
            });
          }
        });

        const cApp = isAcLotActive ? activeAcApps.size : 0;
        const cFeeder = isAcLotActive ? activeAcFeeders.size : 0;
        const cWireAc = circuitAllocs.reduce((s, c) => s + c.acShare, 0);

        const subSteps: RawSubStep[] = [
          mkSub('Dandori', 'Replace applicator & terminals', 'sec/lot -> sec/unit(pcs)', cApp, getP('ac_rep_app'), (cApp * getP('ac_rep_app')) / lot),
          mkSub('Dandori', 'Check a trial shot', 'sec/lot -> sec/unit(pcs)', cApp, getP('ac_trial'), (cApp * getP('ac_trial')) / lot),
          mkSub('Dandori', 'Replace seal feeder & rubber seals', 'sec/lot -> sec/unit(pcs)', cFeeder, getP('ac_rep_feeder'), (cFeeder * getP('ac_rep_feeder')) / lot),
          mkSub('Dandori', 'Replace the wire', 'sec/lot -> sec/unit(pcs)', cWireAc, getP('ac_rep_wire'), (cWireAc * getP('ac_rep_wire')) / lot),
          mkSub('Before', 'Scan the barcodes', 'sec/lot -> sec/unit(pcs)', cWireAc, getP('ac_scan'), (cWireAc * getP('ac_scan')) / lot),
          mkSub('Before', 'Set the parameters', 'sec/lot -> sec/unit(pcs)', cWireAc, getP('ac_param'), (cWireAc * getP('ac_param')) / lot),
        ];

        lenRanges7.forEach(([lbl, pred], i) => {
          const q = circuitAllocs
            .filter((c) => c.acShare > 0 && pred(c.row))
            .reduce((s, c) => s + c.acShare, 0);
          if (q > 0) {
            subSteps.push(
              mkSub(
                'Main Cutting',
                `Cutting & crimping (${lbl}, LOT ${acRowLabels[acRowIdx]})`,
                'sec/lot -> sec/unit(pcs)',
                q,
                acRates[i],
                (q * acRates[i]) / lot
              )
            );
          }
        });

        const acAftRanges: [string, number, (r: PpcsWireItem) => boolean][] = [
          ['<= 1.5m', getP('ac_after_15'), (r) => r.cl > 0 && r.cl <= 1500],
          ['<= 3.0m', getP('ac_after_30'), (r) => r.cl > 1500 && r.cl <= 3000],
          ['> 3.0m', getP('ac_after_45'), (r) => r.cl > 3000],
        ];
        acAftRanges.forEach(([lbl, rate, pred]) => {
          const q = circuitAllocs
            .filter((c) => c.acShare > 0 && pred(c.row))
            .reduce((s, c) => s + c.acShare, 0);
          if (q > 0) {
            subSteps.push(
              mkSub('After', `Process after auto cutting (${lbl})`, 'sec/lot -> sec/unit(pcs)', q, rate, (q * rate) / lot)
            );
          }
        });

        const baseSec = subSteps.reduce((s, x) => s + x.baseSec, 0);
        return {
          active: baseSec > 0,
          summaryNote: `CCT Efektif: ${cWireAc.toFixed(2)} | App: ${cApp} | Feeder: ${cFeeder} | LOT ${acRowLabels[acRowIdx]}`,
          subSteps,
          baseSec,
        };
      }

      case 3: {
        // Semi-autocutting
        const semiAllocs = circuitAllocs.filter((c) => {
          const r = c.row;
          const isSingle =
            r.colour !== '' &&
            (r.colour.length < 2 || r.colour[1].toUpperCase() !== 'C') &&
            c.sz < 20;
          return isSingle && c.remShare > 0;
        });
        const cSemi = semiAllocs.reduce((s, c) => s + c.remShare, 0);

        const saThresholds = [1, 6, 11, 21, 31, 41, 51];
        const saRowLabels = ['1~5', '6~10', '11~20', '21~30', '31~40', '41~50', '51~'];
        let saRowIdx = 0;
        saThresholds.forEach((v, idx) => {
          if (lot >= v) saRowIdx = idx;
        });
        const saRates = stdDb.saMatrix[saRowIdx] || stdDb.saMatrix[0];

        const subSteps: RawSubStep[] = [
          mkSub('Dandori', 'Wire setting', 'sec/lot -> sec/unit(pcs)', cSemi, getP('sa_wire_set'), (cSemi * getP('sa_wire_set')) / lot),
          mkSub('Before', 'Scan the barcodes', 'sec/lot -> sec/unit(pcs)', cSemi, getP('sa_scan'), (cSemi * getP('sa_scan')) / lot),
          mkSub('Before', 'Add message to WOS', 'sec/lot -> sec/unit(pcs)', cSemi, getP('sa_msg'), (cSemi * getP('sa_msg')) / lot),
          mkSub('Before', 'Set parameters (average)', 'sec/lot -> sec/unit(pcs)', cSemi, getP('sa_param'), (cSemi * getP('sa_param')) / lot),
        ];

        lenRanges7.forEach(([lbl, pred], i) => {
          const q = semiAllocs.filter((c) => pred(c.row)).reduce((s, c) => s + c.remShare, 0);
          if (q > 0) {
            subSteps.push(
              mkSub(
                'Main Cutting',
                `Semi-auto cutting (${lbl}, LOT ${saRowLabels[saRowIdx]})`,
                'sec/lot -> sec/unit(pcs)',
                q,
                saRates[i],
                (q * saRates[i]) / lot
              )
            );
          }
        });

        const saMeasRanges: [string, number, (r: PpcsWireItem) => boolean][] = [
          ['<= 1.5m', getP('sa_meas_15'), (r) => r.cl > 0 && r.cl <= 1500],
          ['<= 3.0m', getP('sa_meas_30'), (r) => r.cl > 1500 && r.cl <= 3000],
          ['<= 4.5m', getP('sa_meas_45'), (r) => r.cl > 3000 && r.cl <= 4500],
          ['<= 6.0m', getP('sa_meas_60'), (r) => r.cl > 4500],
        ];
        saMeasRanges.forEach(([lbl, rate, pred]) => {
          const q = semiAllocs.filter((c) => pred(c.row)).reduce((s, c) => s + c.remShare, 0);
          if (q > 0) {
            subSteps.push(
              mkSub('Measuring', `Measuring length (${lbl})`, 'sec/lot -> sec/unit(pcs)', q, rate, (q * rate) / lot)
            );
          }
        });

        const qSaLt2 = semiAllocs.filter((c) => c.sz < 2).reduce((s, c) => s + c.remShare, 0);
        const qSaGe2 = semiAllocs
          .filter((c) => c.sz >= 2 && c.sz < 20)
          .reduce((s, c) => s + c.remShare, 0);
        if (qSaLt2 > 0) {
          subSteps.push(
            mkSub('After', 'Process after semi-auto (< 2sq)', 'sec/lot -> sec/unit(pcs)', qSaLt2, getP('sa_after_lt2'), (qSaLt2 * getP('sa_after_lt2')) / lot)
          );
        }
        if (qSaGe2 > 0) {
          subSteps.push(
            mkSub('After', 'Process after semi-auto (2sq <= size < 20sq)', 'sec/lot -> sec/unit(pcs)', qSaGe2, getP('sa_after_ge2'), (qSaGe2 * getP('sa_after_ge2')) / lot)
          );
        }

        const baseSec = subSteps.reduce((s, x) => s + x.baseSec, 0);
        return {
          active: baseSec > 0,
          summaryNote: `CCT Efektif: ${cSemi.toFixed(2)} | Matrix LOT ${saRowLabels[saRowIdx]}`,
          subSteps,
          baseSec,
        };
      }

      case 4: {
        // Manual-(Air)cutting
        const manRows = ppcs.filter((r) => {
          const isC = r.colour.length >= 2 && r.colour[1].toUpperCase() === 'C';
          const isBlank = r.colour === '';
          const isBig = parseWireSize(r.sizeRaw) >= 20;
          return (isC || isBlank || isBig) && r.kind !== '';
        });
        const cMan = manRows.length;
        const mcThresholds = [1, 4, 6, 11, 21, 31, 41, 51];
        const mcRowLabels = ['1~3', '4~5', '6~10', '11~20', '21~30', '31~40', '41~50', '51~'];
        let mcRowIdx = 0;
        mcThresholds.forEach((v, idx) => {
          if (lot >= v) mcRowIdx = idx;
        });
        const mcRates = stdDb.mcMatrix[mcRowIdx] || stdDb.mcMatrix[0];

        const mcMainSec =
          (manRows.filter((r) => r.cl > 0 && r.cl <= 1000).length * mcRates[0] +
            manRows.filter((r) => r.cl > 1000 && r.cl <= 2000).length * mcRates[1] +
            manRows.filter((r) => r.cl > 2000 && r.cl <= 5000).length * mcRates[2] +
            manRows.filter((r) => r.cl > 5000).length * mcRates[3]) /
          lot;
        const mcAfterSec =
          (manRows.filter((r) => r.cl > 0 && r.cl <= 1000).length * getP('mc_aft_1000') +
            manRows.filter((r) => r.cl > 1000 && r.cl <= 2000).length * getP('mc_aft_2000') +
            manRows.filter((r) => r.cl > 2000 && r.cl <= 3000).length * getP('mc_aft_3000') +
            manRows.filter((r) => r.cl > 3000 && r.cl <= 4000).length * getP('mc_aft_4000') +
            manRows.filter((r) => r.cl > 4000 && r.cl <= 6000).length * getP('mc_aft_6000') +
            manRows.filter((r) => r.cl > 6000 && r.cl <= 8000).length * getP('mc_aft_8000') +
            manRows.filter((r) => r.cl > 8000 && r.cl <= 10000).length * getP('mc_aft_10000') +
            manRows.filter((r) => r.cl > 10000).length * getP('mc_aft_10001')) /
          lot;

        const subSteps: RawSubStep[] = [
          mkSub('Dandori', 'Set the wire', 'sec/lot -> sec/unit(pcs)', cMan, getP('mc_set_wire'), (cMan * getP('mc_set_wire')) / lot),
          mkSub('Dandori', 'Check & set the WOS', 'sec/lot -> sec/unit(pcs)', cMan, getP('mc_chk_wos'), (cMan * getP('mc_chk_wos')) / lot),
          mkSub('Before', 'Scan the barcodes', 'sec/lot -> sec/unit(pcs)', cMan, getP('mc_scan'), (cMan * getP('mc_scan')) / lot),
          mkSub('Before', 'Set the length', 'sec/lot -> sec/unit(pcs)', cMan, getP('mc_set_len'), (cMan * getP('mc_set_len')) / lot),
          mkSub('Main Cutting', `Manual cutting (LOT ${mcRowLabels[mcRowIdx]})`, 'sec/lot -> sec/unit(pcs)', cMan, cMan ? (mcMainSec * lot) / cMan : 0, mcMainSec),
          mkSub('After', 'Process after manual cutting', 'sec/lot -> sec/unit(pcs)', cMan, cMan ? (mcAfterSec * lot) / cMan : 0, mcAfterSec),
        ];

        const baseSec = subSteps.reduce((s, x) => s + x.baseSec, 0);
        return {
          active: baseSec > 0,
          summaryNote: `CCT (Shield/20sq~): ${cMan} | Matrix LOT ${mcRowLabels[mcRowIdx]}`,
          subSteps,
          baseSec,
        };
      }

      case 5: {
        // Manual-Accesary
        let autoFedSealUsed = 0;
        const manualAutoFeederSealByPn: Record<string, number> = {};
        circuitAllocs.forEach(({ row: r, acShare, remShare }) => {
          if (r.rAf) {
            autoFedSealUsed += acShare;
            [r.accR1, r.accR2].forEach((a) => {
              if (a && feederList.some((f) => f.seal.toLowerCase() === a.toLowerCase())) {
                if (remShare > 0) {
                  manualAutoFeederSealByPn[a.toUpperCase()] =
                    (manualAutoFeederSealByPn[a.toUpperCase()] || 0) + remShare;
                }
              }
            });
          }
          if (r.fAf) {
            autoFedSealUsed += acShare;
            [r.accF1, r.accF2].forEach((a) => {
              if (a && feederList.some((f) => f.seal.toLowerCase() === a.toLowerCase())) {
                if (remShare > 0) {
                  manualAutoFeederSealByPn[a.toUpperCase()] =
                    (manualAutoFeederSealByPn[a.toUpperCase()] || 0) + remShare;
                }
              }
            });
          }
        });

        const sealAllQty = pl
          .filter((r) => r.partName.toLowerCase() === 'seal')
          .reduce((a, b) => a + b.qty, 0);
        const sealQty = Math.max(0, sealAllQty - autoFedSealUsed);
        const sealTypes = pl.filter((r) => {
          if (r.partName.toLowerCase() !== 'seal') return false;
          if (r.desc !== 'auto feeder') return true;
          return (manualAutoFeederSealByPn[r.partNumber.toUpperCase()] || 0) > 0.0001;
        }).length;

        const markerTotal =
          ppcs.filter((r) => r.markerR !== '').length + ppcs.filter((r) => r.markerF !== '').length;
        const markerCcts = ppcs.filter((r) => r.markerR !== '' || r.markerF !== '').length;

        const ringTerms = pl
          .filter(
            (r) =>
              r.partName.toLowerCase() === 'terminal' &&
              (['110400', '110800', '8110-', '8150-', '7009-'].some((k) =>
                r.partNumber.includes(k)
              ) ||
                r.partNumber.toUpperCase().startsWith('R'))
          )
          .reduce((a, b) => a + b.qty, 0);
        const shieldWires = ppcs.filter(
          (r) => r.colour.length >= 2 && r.colour[1].toUpperCase() === 'C'
        ).length;
        const hsD9 = ringTerms + shieldWires;
        const hsL10 = ringTerms + shieldWires * 2;
        const tubeTypes = pl.filter((r) => r.partName.toLowerCase().includes('tube')).length;
        const sleeveQty = pl
          .filter((r) => r.partName.toLowerCase().includes('sleeve'))
          .reduce((a, b) => a + b.qty, 0);
        const sleeveTypes = pl.filter((r) => r.partName.toLowerCase().includes('sleeve')).length;

        const isVoxVob = (str: string) => {
          const u = str.toUpperCase();
          return u.includes('VOX') || u.includes('VOB');
        };
        const voPl = pl.filter((r) => isVoxVob(r.partName) || isVoxVob(r.partNumber)).length;
        const voPpcs =
          ppcs.filter((r) => isVoxVob(r.tubeR)).length +
          ppcs.filter((r) => isVoxVob(r.tubeF)).length;
        const voQty = Math.max(voPl, voPpcs);

        const subSteps: RawSubStep[] = [
          mkSub('Wire Seal', 'Before: Take wires & check WOS', 'sec/lot -> sec/unit(pcs)', sealQty, getP('ma_seal_b1'), (sealQty * getP('ma_seal_b1')) / lot),
          mkSub('Wire Seal', 'Before: Set seal box (per type)', 'sec/lot -> sec/unit(pcs)', sealTypes, getP('ma_seal_b2'), (sealTypes * getP('ma_seal_b2')) / lot),
          mkSub('Wire Seal', 'Before: Register WOS', 'sec/lot -> sec/unit(pcs)', sealQty, getP('ma_seal_b3'), (sealQty * getP('ma_seal_b3')) / lot),
          mkSub('Wire Seal', 'Main: Expose tips & insert seals', 'sec/lot -> sec/unit(pcs)', sealQty, getP('ma_seal_m1') + getP('ma_seal_m2'), (sealQty * (getP('ma_seal_m1') + getP('ma_seal_m2'))) / lot),
          mkSub('Wire Seal', 'After: Sign WOS & hang wires', 'sec/lot -> sec/unit(pcs)', sealQty, getP('ma_seal_a1') + getP('ma_seal_a2'), (sealQty * (getP('ma_seal_a1') + getP('ma_seal_a2'))) / lot),
          mkSub('Marker', 'Before + Main: Remove, expose & insert (per pcs)', 'sec/lot -> sec/unit(pcs)', markerTotal, getP('ma_mrk_b1') + getP('ma_mrk_m1') + getP('ma_mrk_m2'), (markerTotal * (getP('ma_mrk_b1') + getP('ma_mrk_m1') + getP('ma_mrk_m2'))) / lot),
          mkSub('Marker', 'After: Bundle, sign WOS & hang (per CCT)', 'sec/lot -> sec/unit(pcs)', markerCcts, getP('ma_mrk_a1') + getP('ma_mrk_a2') + getP('ma_mrk_a3'), (markerCcts * (getP('ma_mrk_a1') + getP('ma_mrk_a2') + getP('ma_mrk_a3'))) / lot),
          mkSub('Heat Shrink', 'Before: Bring wires & tube box', 'sec/lot -> sec/unit(pcs)', hsD9, getP('ma_hst_b1'), (hsD9 * getP('ma_hst_b1') + tubeTypes * getP('ma_hst_b2')) / lot),
          mkSub('Heat Shrink', 'Main + After: Expose, insert (2x shield), bundle & hang', 'sec/lot -> sec/unit(pcs)', hsL10, getP('ma_hst_m2') + getP('ma_hst_a2'), (hsD9 * (getP('ma_hst_m1') + getP('ma_hst_a1') + getP('ma_hst_a3')) + hsL10 * (getP('ma_hst_m2') + getP('ma_hst_a2'))) / lot),
          mkSub('Sleeve', 'Before + Main + After: Insert & bundle sleeves', 'sec/lot -> sec/unit(pcs)', sleeveQty, 37, (sleeveQty * (getP('ma_slv_b1') + getP('ma_slv_b3') + getP('ma_slv_m1') + getP('ma_slv_m2') + getP('ma_slv_a1') + getP('ma_slv_a2') + getP('ma_slv_a3')) + sleeveTypes * getP('ma_slv_b2')) / lot),
          mkSub('Vinyl Tube', 'Before + Main + After: VOX / VOB tubes', 'sec/lot -> sec/unit(pcs)', voQty, 44, (voQty * (getP('ma_vo_b1') + getP('ma_vo_m1') + getP('ma_vo_m2') + getP('ma_vo_a1') + getP('ma_vo_a2') + getP('ma_vo_a3'))) / lot),
        ];

        const baseSec = subSteps.reduce((s, x) => s + x.baseSec, 0);
        return {
          active: baseSec > 0,
          summaryNote: `Seal Manual: ${sealQty.toFixed(2)} (${sealTypes} box) | Mrk: ${markerTotal}pcs | HS: ${hsD9}/${hsL10} | Slv: ${sleeveQty}`,
          subSteps,
          baseSec,
        };
      }

      case 6: {
        // Manual-Crimping
        const manualAppSet = new Set<string>();
        pl.forEach((r) => {
          if (r.partName.toLowerCase() === 'terminal' && r.desc === '' && !isNonCrimpTerm(r.partNumber)) {
            manualAppSet.add(r.partNumber.toUpperCase());
          }
        });

        let manualEndsTotal = 0;
        circuitAllocs.forEach(({ row: r, eligibleR, eligibleF, remShare }) => {
          if (!r.kind) return;
          if (!isNonCrimpTerm(r.termR)) {
            const endShareR = eligibleR ? remShare : 1.0;
            manualEndsTotal += endShareR;
            if (endShareR > 0.0001) manualAppSet.add(r.termR.toUpperCase());
          }
          if (!isNonCrimpTerm(r.termF)) {
            const endShareF = eligibleF ? remShare : 1.0;
            manualEndsTotal += endShareF;
            if (endShareF > 0.0001) manualAppSet.add(r.termF.toUpperCase());
          }
        });

        const appMc = manualAppSet.size;
        const subSteps: RawSubStep[] = [
          mkSub('Dandori', 'Attach the applicator', 'sec/lot -> sec/unit(pcs)', appMc, getP('mcr_app'), (appMc * getP('mcr_app')) / lot),
          mkSub('Dandori', 'Set the terminals', 'sec/lot -> sec/unit(pcs)', appMc, getP('mcr_term'), (appMc * getP('mcr_term')) / lot),
          mkSub('Before', 'Take wires, sign WOS, scan & remove cap', 'sec/lot -> sec/unit(pcs)', manualEndsTotal, getP('mcr_b1') + getP('mcr_b2') + getP('mcr_b3') + getP('mcr_b4'), (manualEndsTotal * (getP('mcr_b1') + getP('mcr_b2') + getP('mcr_b3') + getP('mcr_b4'))) / lot),
          mkSub('Main Crimping', 'Crimp (measure one) & check', 'sec/unit(pcs)', manualEndsTotal, getP('mcr_main'), manualEndsTotal * getP('mcr_main')),
          mkSub('After', 'Measure one, check, cap & hang wires', 'sec/lot -> sec/unit(pcs)', manualEndsTotal, getP('mcr_a1') + getP('mcr_a2'), (manualEndsTotal * (getP('mcr_a1') + getP('mcr_a2'))) / lot),
        ];

        const baseSec = subSteps.reduce((s, x) => s + x.baseSec, 0);
        return {
          active: baseSec > 0,
          summaryNote: `Manual Ends: ${manualEndsTotal.toFixed(2)} | App (incl. Shield): ${appMc}`,
          subSteps,
          baseSec,
        };
      }

      case 7: {
        // Twist
        const { bundles: twBundles, ccts: twCcts, totalLenM: twLenM } = groupTwistBundles(ppcs);

        const subSteps: RawSubStep[] = [
          mkSub('Before', 'Check WOS, set rotations & remove rubber band (per bundle)', 'sec/lot -> sec/unit(pcs)', twBundles, getP('tw_b1') + getP('tw_b2') + getP('tw_b3'), (twBundles * (getP('tw_b1') + getP('tw_b2') + getP('tw_b3'))) / lot),
          mkSub('Before', 'Remove rubber band each bundle (per CCT)', 'sec/lot -> sec/unit(pcs)', twCcts, getP('tw_b4'), (twCcts * getP('tw_b4')) / lot),
          mkSub('Main Twist', 'Attach & remove wire ends on machine (per bundle)', 'sec/unit(pcs)', twBundles, getP('tw_m1') + getP('tw_m4'), twBundles * (getP('tw_m1') + getP('tw_m4'))),
          mkSub('Main Twist', 'Pull other end of wires (per CCT)', 'sec/unit(pcs)', twCcts, getP('tw_m2'), twCcts * getP('tw_m2')),
          mkSub('Main Twist', 'Run machine & measure length (per meter twist)', 'sec/unit(pcs)', twLenM, getP('tw_m3') + getP('tw_m5'), twLenM * (getP('tw_m3') + getP('tw_m5'))),
          mkSub('After', 'Bundle, attach WOS, cap & hang (1x)', 'sec/lot -> sec/unit(pcs)', twBundles, getP('tw_a1'), (twBundles * getP('tw_a1')) / lot),
        ];

        const baseSec = subSteps.reduce((s, x) => s + x.baseSec, 0);
        return {
          active: baseSec > 0,
          summaryNote: `Bundles: ${twBundles} (${twCcts} CCT) | Len: ${twLenM.toFixed(2)}m`,
          subSteps,
          baseSec,
        };
      }

      case 9: {
        // Pre-joint
        const jointSumPl = pl
          .filter((r) => JOINT_CODE_SET.has(r.partNumber.toUpperCase()))
          .reduce((a, b) => a + b.qty, 0);
        const jointCctsAll = ppcs.filter((r) => r.jointNo !== '');
        const nLong = jointCctsAll.filter((r) => r.cl > 1000).length;
        const nShort = jointCctsAll.filter((r) => r.cl > 0 && r.cl <= 1000).length;
        const pjLongSec =
          jointCctsAll.length > 0 ? getP('pj_long_slope') * nLong + getP('pj_long_int') : 0;
        const pjShortSec =
          jointCctsAll.length > 0 ? getP('pj_short_slope') * (nShort + 1) + getP('pj_short_int') : 0;

        const subSteps: RawSubStep[] = [
          mkSub('Before', 'Remove hanger, untangle & shelf (per joint)', 'sec/lot -> sec/unit(pcs)', jointSumPl, getP('pj_b1') + getP('pj_b3') + getP('pj_b4'), (jointSumPl * (getP('pj_b1') + getP('pj_b3') + getP('pj_b4'))) / lot),
          mkSub('Before', 'Check WOS & place on half-cylinder (per CCT)', 'sec/lot -> sec/unit(pcs)', jointCctsAll.length, getP('pj_b2') + getP('pj_b5'), (jointCctsAll.length * (getP('pj_b2') + getP('pj_b5'))) / lot),
          mkSub('Main Pre-Joint', 'Bundle together — Long (>1000mm)', 'sec/unit(pcs)', nLong, getP('pj_long_slope'), pjLongSec),
          mkSub('Main Pre-Joint', 'Bundle together — Short (<=1000mm)', 'sec/unit(pcs)', nShort, getP('pj_short_slope'), pjShortSec),
          mkSub('After', 'Attach WOS & tie wire bundle (per joint)', 'sec/lot -> sec/unit(pcs)', jointSumPl, getP('pj_a1') + getP('pj_a2'), (jointSumPl * (getP('pj_a1') + getP('pj_a2'))) / lot),
        ];

        const baseSec = subSteps.reduce((s, x) => s + x.baseSec, 0);
        return {
          active: baseSec > 0,
          summaryNote: `Joints: ${jointSumPl} | Long (>1m): ${nLong} | Short (<=1m): ${nShort}`,
          subSteps,
          baseSec,
        };
      }

      case 10: {
        // Joint
        const jointSumPl = pl
          .filter((r) => JOINT_CODE_SET.has(r.partNumber.toUpperCase()))
          .reduce((a, b) => a + b.qty, 0);
        const openJoints = pl
          .filter((r) => ['553800', '565200'].includes(r.partNumber))
          .reduce((a, b) => a + b.qty, 0);
        const closeJoints = jointSumPl - openJoints;
        const openWiresJ = ppcs.filter((r) =>
          ['553800', '565200'].some((k) => r.termR.includes(k) || r.termF.includes(k))
        ).length;
        const closeWiresJ = ppcs.filter((r) =>
          ['P', 'B'].some((k) => r.termR.toUpperCase().includes(k) || r.termF.toUpperCase().includes(k))
        ).length;

        const subSteps: RawSubStep[] = [
          mkSub('Before', 'Open Barrel preparation (per joint & wire)', 'sec/lot -> sec/unit(pcs)', openJoints, 57.5, (openJoints * (getP('jt_b_take_o') + getP('jt_b_wos_o') + getP('jt_b_unb_o') + getP('jt_b_tub_o')) + openWiresJ * getP('jt_b_mat_o')) / lot),
          mkSub('Before', 'Close Barrel preparation (per joint & wire)', 'sec/lot -> sec/unit(pcs)', closeJoints, 59, (closeJoints * (getP('jt_b_take_c') + getP('jt_b_wos_c') + getP('jt_b_unb_c') + getP('jt_b_box_c') + getP('jt_b_tub_c')) + closeWiresJ * getP('jt_b_mat_c')) / lot),
          mkSub('Main Joint', 'Open Barrel: Tube, gather & joint', 'sec/unit(pcs)', openJoints, 7.3, openJoints * (getP('jt_m_ins_o') + getP('jt_m_jnt_o')) + 2 * openWiresJ * getP('jt_m_gat_o')),
          mkSub('Main Joint', 'Close Barrel: Tube, gather & joint', 'sec/unit(pcs)', closeJoints, 10, closeJoints * (getP('jt_m_ins_c') + getP('jt_m_jnt_c')) + closeWiresJ * getP('jt_m_gat_c')),
          mkSub('After', 'Measure, scan WOS & bundle (Open + Close)', 'sec/lot -> sec/unit(pcs)', jointSumPl, 231.4, (openJoints * (getP('jt_a_mea_o') + getP('jt_a_scn_o') + getP('jt_a_bnd_o')) + closeJoints * (getP('jt_a_mea_c') + getP('jt_a_scn_c') + getP('jt_a_bnd_c'))) / lot),
        ];

        const baseSec = subSteps.reduce((s, x) => s + x.baseSec, 0);
        return {
          active: baseSec > 0,
          summaryNote: `Open: ${openJoints} (${openWiresJ}w) | Close: ${closeJoints} (${closeWiresJ}w)`,
          subSteps,
          baseSec,
        };
      }

      case 11: {
        // Solder, SolderCelup
        const dipCcts = ppcs.filter(
          (r) =>
            r.kind !== '' &&
            [r.termR, r.accR1, r.accR2, r.termF, r.accF1, r.accF2].some((x) =>
              x.toLowerCase().includes('celup')
            )
        ).length;
        const solderCcts = ppcs.filter(
          (r) =>
            r.kind !== '' &&
            [r.termR, r.accR1, r.accR2, r.termF, r.accF1, r.accF2].some(
              (x) => x.toLowerCase().includes('solder') && !x.toLowerCase().includes('celup')
            )
        ).length;

        const subSteps: RawSubStep[] = [
          mkSub('Soldering', 'Before + After Soldering', 'sec/lot -> sec/unit(pcs)', solderCcts, 37.8, (solderCcts * (getP('sd_b1') + getP('sd_b2') + getP('sd_b3') + getP('sd_a1') + getP('sd_a2'))) / lot),
          mkSub('Soldering', 'Main Soldering process', 'sec/unit(pcs)', solderCcts, getP('sd_m1'), solderCcts * getP('sd_m1')),
          mkSub('Dip In (Celup)', 'Before + After Solder Celup', 'sec/lot -> sec/unit(pcs)', dipCcts, 66.5, (dipCcts * (getP('dp_b1') + getP('dp_b2') + getP('dp_a1') + getP('dp_a2') + getP('dp_a3'))) / lot),
          mkSub('Dip In (Celup)', 'Main Solder Celup (Dip In)', 'sec/unit(pcs)', dipCcts, getP('dp_m1'), dipCcts * getP('dp_m1')),
        ];

        const baseSec = subSteps.reduce((s, x) => s + x.baseSec, 0);
        return {
          active: baseSec > 0,
          summaryNote: `Soldering: ${solderCcts} CCT | Dip In (Celup): ${dipCcts} CCT`,
          subSteps,
          baseSec,
        };
      }

      case 12: {
        // Buzzer(shielded)
        const shieldWires = ppcs.filter(
          (r) => r.colour.length >= 2 && r.colour[1].toUpperCase() === 'C'
        ).length;

        let shieldCoreCcts = 0;
        ppcs.forEach((r) => {
          const idx = r.colour.toUpperCase().indexOf('C');
          if (idx > 0) {
            const n = parseFloat(r.colour.slice(0, idx));
            if (!Number.isNaN(n)) shieldCoreCcts += n;
          }
        });

        const subSteps: RawSubStep[] = [
          mkSub('Before', 'Check WOS, instruments & markers', 'sec/lot -> sec/unit(pcs)', shieldWires, 39.3, (shieldWires * (getP('bz_b1') + getP('bz_b2') + getP('bz_b3') + getP('bz_b4'))) / lot),
          mkSub('Main Buzzer', 'Check continuity (per shield core CCT)', 'sec/unit(pcs)', shieldCoreCcts, getP('bz_m1'), shieldCoreCcts * getP('bz_m1')),
          mkSub('Main Buzzer', 'Mark & put label on shielded wire', 'sec/unit(pcs)', shieldWires, getP('bz_m2') + getP('bz_m3') + getP('bz_m4'), shieldWires * (getP('bz_m2') + getP('bz_m3') + getP('bz_m4'))),
          mkSub('After', 'Input to PC, message WOS & bundle wire', 'sec/lot -> sec/unit(pcs)', shieldWires, 155, (shieldWires * (getP('bz_a1') + getP('bz_a2') + getP('bz_a3'))) / lot),
        ];

        const baseSec = subSteps.reduce((s, x) => s + x.baseSec, 0);
        return {
          active: baseSec > 0,
          summaryNote: `Shield Wires: ${shieldWires} | Core CCT: ${shieldCoreCcts}`,
          subSteps,
          baseSec,
        };
      }

      case 13: {
        // Open Jacket&Shield,Twist the shield
        const shieldWires = ppcs.filter(
          (r) => r.colour.length >= 2 && r.colour[1].toUpperCase() === 'C'
        ).length;

        const subSteps: RawSubStep[] = [
          mkSub('Before', 'Calling up drawings from WOS', 'sec/lot -> sec/unit(pcs)', shieldWires, getP('oj_b1'), (shieldWires * getP('oj_b1')) / lot),
          mkSub('Main Shield', 'Trim, loosen, gather & twist braid (both ends)', 'sec/unit(pcs)', shieldWires, 29.7, shieldWires * (getP('oj_m1') * 2 + getP('oj_m2') + getP('oj_m3') * 2 + getP('oj_m4') * 2 + getP('oj_m5') * 2)),
          mkSub('After', 'Put on a rack', 'sec/lot -> sec/unit(pcs)', shieldWires, getP('oj_a1'), (shieldWires * getP('oj_a1')) / lot),
        ];

        const baseSec = subSteps.reduce((s, x) => s + x.baseSec, 0);
        return {
          active: baseSec > 0,
          summaryNote: `Shield Wires: ${shieldWires} | Twist Coeff: 2.83`,
          subSteps,
          baseSec,
        };
      }

      case 14: {
        // Heating
        const shieldWires = ppcs.filter(
          (r) => r.colour.length >= 2 && r.colour[1].toUpperCase() === 'C'
        ).length;
        const ringAndJointPl = pl
          .filter(
            (r) =>
              r.partName.toLowerCase() === 'terminal' &&
              (['110400', '110800', '8110-', '8150-', '7009-', '553800', '565200'].some((k) =>
                r.partNumber.includes(k)
              ) ||
                r.partNumber.toUpperCase().startsWith('R') ||
                r.partNumber.toUpperCase().startsWith('B-') ||
                r.partNumber.toUpperCase().startsWith('P-'))
          )
          .reduce((a, b) => a + b.qty, 0);
        const j0SolderCount = ppcs.filter(
          (r) =>
            (r.from.toUpperCase() === 'J0' || r.to.toUpperCase() === 'J0') &&
            (r.termR.toLowerCase().includes('solder') || r.termF.toLowerCase().includes('solder'))
        ).length;
        const heatQty = ringAndJointPl + j0SolderCount + shieldWires * 2;

        const subSteps: RawSubStep[] = [
          mkSub('Before', 'Take wires from hanger & untie band', 'sec/lot -> sec/unit(pcs)', heatQty, getP('ht_b1') + getP('ht_b2'), (heatQty * (getP('ht_b1') + getP('ht_b2'))) / lot),
          mkSub('Main Heating', 'Align tubes, shrink with heat gun & tuck', 'sec/unit(pcs)', heatQty, getP('ht_m1') + getP('ht_m2'), heatQty * (getP('ht_m1') + getP('ht_m2'))),
          mkSub('After', 'Remove holder, sign WOS, cap & bundle', 'sec/lot -> sec/unit(pcs)', heatQty, 77.6, (heatQty * (getP('ht_a1') + getP('ht_a2') + getP('ht_a3') + getP('ht_a4') + getP('ht_a5') + getP('ht_a6'))) / lot),
        ];

        const baseSec = subSteps.reduce((s, x) => s + x.baseSec, 0);
        return {
          active: baseSec > 0,
          summaryNote: `Qty: ${heatQty} (Ring/Joint: ${ringAndJointPl} + J0 Solder: ${j0SolderCount} + 2x Shield: ${shieldWires * 2})`,
          subSteps,
          baseSec,
        };
      }

      case 16: {
        // Housing
        const jointCctsAll = ppcs.filter((r) => r.jointNo !== '');
        const connQty = pl
          .filter((r) => r.routingId === 20 && r.partName.toLowerCase() === 'connector')
          .reduce((a, b) => a + b.qty, 0);
        const sleeveQty = pl
          .filter((r) => r.partName.toLowerCase().includes('sleeve'))
          .reduce((a, b) => a + b.qty, 0);

        const nonJointCct = ppcsCount - jointCctsAll.length;
        const hsBefore =
          (nonJointCct * getP('hs_b1') * getP('hs_b1_pq') +
            jointCctsAll.length * getP('hs_b2') * getP('hs_b2_pq')) /
          lot;
        const housingCcts = ppcs.filter((r) => {
          if (!r.cctNo) return false;
          const exclKeys = ['110400', '110800', '8110-', '8150-', '7009-', '553800', '565200'];
          const bothKey = exclKeys.some((k) => r.termR.includes(k) && r.termF.includes(k));
          const bothPref = ['R', 'B', 'P'].some(
            (p) => r.termR.toUpperCase().startsWith(p) && r.termF.toUpperCase().startsWith(p)
          );
          const bothSlv =
            r.af.toLowerCase().includes('sleeve') && r.ag.toLowerCase().includes('sleeve');
          return !(bothKey || bothPref || bothSlv);
        }).length;
        const housingTerms =
          pl
            .filter(
              (r) =>
                r.partName.toLowerCase() === 'terminal' &&
                !['110400', '110800', '8110-', '8150-', '7009-', '553800', '565200'].some((k) =>
                  r.partNumber.includes(k)
                ) &&
                !['R', 'B', 'P'].includes(r.partNumber.toUpperCase()[0] || '')
            )
            .reduce((a, b) => a + b.qty, 0) - sleeveQty;

        const hsAfter =
          ((housingCcts * getP('hs_a1') + getP('hs_a2') + getP('hs_a3')) * getP('hs_a_pq')) / lot;

        const subSteps: RawSubStep[] = [
          mkSub('Pre-Housing', 'Pattern A (non-joint) & Pattern B (joint)', 'sec/lot -> sec/unit(pcs)', ppcsCount, 15.45, hsBefore),
          mkSub('Main Housing', 'Prepare connector (Routing ID 20)', 'sec/unit(pcs)', connQty, getP('hs_m1'), getP('hs_m1') * connQty),
          mkSub('Main Housing', 'Prepare wire (All non-ring/joint CCT)', 'sec/unit(pcs)', housingCcts, getP('hs_m2'), getP('hs_m2') * housingCcts),
          mkSub('Main Housing', 'Insert terminal into connector (per pair)', 'sec/unit(pcs)', housingTerms / 2, getP('hs_m3'), getP('hs_m3') * (housingTerms / 2)),
          mkSub('Post-Housing', 'Making, organizing & tidying wire bundles', 'sec/lot -> sec/unit(pcs)', housingCcts, 3.16, hsAfter),
        ];

        const baseSec = subSteps.reduce((s, x) => s + x.baseSec, 0);
        return {
          active: baseSec > 0,
          summaryNote: `PQ=1 | Non-J: ${nonJointCct}, J: ${jointCctsAll.length} | Conn: ${connQty} | Term: ${housingTerms}`,
          subSteps,
          baseSec,
        };
      }

      case 17: {
        // Assembly (kronologis & basis tunggal sec/unit(pcs))
        const totalCctPpcs = ppcs.filter(
          (r) =>
            (r.assyNo && String(r.assyNo).trim() !== '') ||
            (r.cctNo && String(r.cctNo).trim() !== '')
        ).length;
        const untangleWireQty = ppcs.filter((r) => Number(r.cl) > 2500).length;

        const preTapeBaseSec = getP('as_cot_pre', 3.5);
        const postTapeBaseSec = getP('as_cot_post', 3.5);
        const cotSlitBaseSec = getP('as_cot_ins_b_base', 3.0);
        const cotSlitPerMmSec = getP('as_cot_ins_b_mm', 0.035);

        const cotV2 = calculateCotTapingV2Summary(dwg, pl, stdDb.cotMatrix, {
          preTapeBaseSec,
          postTapeBaseSec,
          cotBBaseSec: cotSlitBaseSec,
          cotBPerMmSec: cotSlitPerMmSec,
        });
        const totalCotQty = cotV2.totalPieces;
        const totalCotLengthMm = cotV2.totalLengthMm;
        const totalTarikanCot = cotV2.totalTarikanCot;
        const totalCotInsertSec = cotV2.totalInsertSec;
        const cotBQty = cotV2.cotBQty;
        const hCotQty = cotV2.hCotQty;

        const spotFromPl = calculateSpotTapeFromPartList(pl);
        const {
          markerQty: nm = 0,
          spotTapeQty: rawNs = 0,
          namePlateQty: nn = 0,
          clipQty: nx = 0,
          clampQty: ny = 0,
        } = assemblyComponents || {};
        const ns = rawNs > 0 ? rawNs : spotFromPl.spotCount || 0;

        const rateScanStart = getP('as_scan_start', 10.0);
        const rateWireTransport = getP('as_tr_in', 30.0);
        const rateUntangle = getP('as_untangle', 2.0);

        const rateSetPerMm = getP('as_set_mm', 0.18);
        const weightedCotMm = cotV2.weightedLengthMm;
        const cctDensityFactor = 1 + (totalCctPpcs / 1000) * 0.25;
        const settingWireSec = weightedCotMm * rateSetPerMm * cctDensityFactor;
        const settingWireRate =
          totalCotLengthMm > 0 ? settingWireSec / Math.max(totalCotLengthMm, 1) : 0;

        const avgPreRate = totalCotQty > 0 ? cotV2.totalPreSec / totalCotQty : 0;
        const avgCotInsertRate = totalCotQty > 0 ? totalCotInsertSec / totalCotQty : 0;
        const avgUjungRate = totalCotQty > 0 ? cotV2.totalUjungSec / totalCotQty : 0;
        const avgPostRate = totalCotQty > 0 ? cotV2.totalPostSec / totalCotQty : 0;

        const measuringQty = Math.ceil(totalTarikanCot * 1.15);
        const rateMeasuring = getP('as_mea', 9.24);

        const rateMarker = getP('as_mrk', 7.28);
        const rateSpot = getP('as_spt', 10.61);
        const rateClip = getP('as_clp', 9.9);
        const rateClamp = getP('as_clm', 29.11);
        const rateNameplate = getP('as_nmp', 20.0);
        const rateBarcode = getP('as_bar', 166.0);

        const rateRemove = getP('as_rem', 1.23);
        const rateScanEnd = getP('as_scan_end', 5.0);
        const rateTransportOut = getP('as_tr_out', 40.0);

        const cotInsertLabel =
          totalCotQty > 0
            ? `Pemasangan Selang COT Slit (COT-B: ${cotBQty} pcs, H-COT: ${hCotQty} pcs)`
            : 'Pemasangan Selang COT Slit (COT-B & H-COT)';

        const subSteps: RawSubStep[] = [
          mkSub('Persiapan', 'Scan Barcode Awal', 'sec/unit(pcs)', 1, rateScanStart, 1 * rateScanStart),
          mkSub('Persiapan', 'Wire Transport (bawa gulungan ke jig)', 'sec/unit(pcs)', 1, rateWireTransport, 1 * rateWireTransport),
          mkSub('Persiapan', 'Urai Gulungan Wire Panjang (>2500 mm)', 'sec/unit(pcs)', untangleWireQty, rateUntangle, untangleWireQty * rateUntangle),
          mkSub('Setting Wire', `Setting Wires on Board (Weighted COT mm × ${rateSetPerMm.toFixed(2)} × DF ${cctDensityFactor.toFixed(3)})`, 'sec/unit(pcs)', totalCotLengthMm, settingWireRate, settingWireSec),
          mkSub('Master_COT_V2', 'Taping Pre-COT (Full/Half 25mm/Spot 150mm + 3.5s, per DIA)', 'sec/unit(pcs)', totalCotQty, avgPreRate, cotV2.totalPreSec),
          mkSub('Pemasangan COT', cotInsertLabel, 'sec/unit(pcs)', totalCotQty, avgCotInsertRate, totalCotInsertSec),
          mkSub('Master_COT_V2', 'Tutup Ujung & Taping Branch / Persimpangan COT (Multi-Branch D7–D36)', 'sec/unit(pcs)', totalCotQty, avgUjungRate, cotV2.totalUjungSec),
          mkSub('Master_COT_V2', 'Taping Post-COT (Full/Half 25mm/Spot 150mm + 3.5s, per DIA)', 'sec/unit(pcs)', totalCotQty, avgPostRate, cotV2.totalPostSec),
          mkSub('Measuring', 'Measuring dimensi panjang branch (+15% non-COT)', 'sec/unit(pcs)', measuringQty, rateMeasuring, measuringQty * rateMeasuring),
          mkSub('Accessories', 'Attaching Markers (nm)', 'sec/unit(pcs)', nm, rateMarker, nm * rateMarker),
          mkSub('Accessories', 'Attaching Spot Tape Tambahan (ns)', 'sec/unit(pcs)', ns, rateSpot, ns * rateSpot),
          mkSub('Accessories', 'Attaching Clips (nx)', 'sec/unit(pcs)', nx, rateClip, nx * rateClip),
          mkSub('Accessories', 'Attaching Clamps (ny)', 'sec/unit(pcs)', ny, rateClamp, ny * rateClamp),
          mkSub('Accessories', 'Attaching Nameplates (nn)', 'sec/unit(pcs)', nn, rateNameplate, nn * rateNameplate),
          mkSub('Accessories', 'Attaching Barcode Harness', 'sec/unit(pcs)', 1, rateBarcode, 1 * rateBarcode),
          mkSub('Finishing', 'Removing Harness from Board', 'sec/unit(pcs)', totalCotQty, rateRemove, totalCotQty * rateRemove),
          mkSub('Finishing', 'Scan Barcode Akhir', 'sec/unit(pcs)', 1, rateScanEnd, 1 * rateScanEnd),
          mkSub('Finishing', 'Transport the Harness', 'sec/unit(pcs)', 1, rateTransportOut, 1 * rateTransportOut),
        ];

        const baseSec = subSteps.reduce((s, x) => s + x.baseSec, 0);
        const summaryNote =
          `COT: ${totalCotLengthMm.toFixed(0)} mm (${totalCotQty} pcs: B=${cotBQty}, H=${hCotQty}) | ` +
          `PPCS: ${totalCctPpcs} CCT (DF ×${cctDensityFactor.toFixed(3)}) | ` +
          `Taping COT: ${cotV2.totalSec.toFixed(1)}s + Pasang: ${totalCotInsertSec.toFixed(1)}s | ` +
          `Meas: ${measuringQty}`;

        return {
          active: baseSec > 0,
          summaryNote,
          subSteps,
          baseSec,
        };
      }

      case 19: {
        // Visual
        const visualSec = (getP('in_vis_slope') * cctMaster + getP('in_vis_int')) * 86400;
        const subSteps: RawSubStep[] = [
          mkSub('Inspection', 'Visual inspection formula (0.0001*CCT + 0.0083)*86400', 'sec/unit(pcs)', cctMaster, 8.64, visualSec),
        ];
        return {
          active: visualSec > 0,
          summaryNote: `CCT Master: ${cctMaster}`,
          subSteps,
          baseSec: visualSec,
        };
      }

      case 20: {
        // Checker (Linear Kontinyu)
        const slope = getP('in_chk_slope');
        const intercept = getP('in_chk_int');
        const checkerSec = cctMaster > 0 ? (slope * cctMaster + intercept) * 86400 : 0;
        const ratePerCct = slope * 86400;
        const subSteps: RawSubStep[] = [
          mkSub('Inspection', 'Checker formula (0.00004*CCT + 0.0014)*86400', 'sec/unit(pcs)', cctMaster, ratePerCct, checkerSec),
        ];
        return {
          active: checkerSec > 0,
          summaryNote: `CCT Master: ${cctMaster} (Linear Kontinyu)`,
          subSteps,
          baseSec: checkerSec,
        };
      }

      case 21: {
        // finishing
        const finishingSec = (getP('in_fin_slope') * cctMaster + getP('in_fin_int')) * 86400;
        const subSteps: RawSubStep[] = [
          mkSub('Inspection', 'Finishing formula (0.00002*CCT + 0.0025)*86400', 'sec/unit(pcs)', cctMaster, 1.728, finishingSec),
        ];
        return {
          active: finishingSec > 0,
          summaryNote: `CCT Master: ${cctMaster}`,
          subSteps,
          baseSec: finishingSec,
        };
      }

      default:
        return { active: false, summaryNote: 'Tidak digunakan (0)', subSteps: [] };
    }
  };

  let subIdx = 0;
  const rawItems: ProcessResult[] = PROCESS_META.map((meta) => {
    const res = computeProcess(meta.id);
    const subSteps: SubStepResult[] = res.subSteps.map((st) => {
      const safeBase = Number.isFinite(st.baseSec) ? st.baseSec : 0;
      const safeQty = Number.isFinite(st.qty) ? st.qty : 0;
      const safeRate = Number.isFinite(st.rate) ? st.rate : 0;
      return {
        id: `sub_${++subIdx}`,
        stage: st.stage,
        name: st.name,
        basis: st.basis,
        qty: safeQty,
        rate: safeRate,
        baseSec: safeBase,
        allowByProcessSec: safeBase,
        allowByFinalSec: safeBase,
      };
    });

    const computedSum = subSteps.reduce((s, x) => s + x.baseSec, 0);
    const baseSec =
      typeof res.baseSec === 'number' && Number.isFinite(res.baseSec) ? res.baseSec : computedSum;

    return {
      processId: meta.id,
      processName: meta.name,
      jpName: meta.jp,
      weight: meta.weight || PROCESS_DIFF_MAP[meta.name] || 1.0,
      active: res.active,
      summaryNote: res.summaryNote,
      baseSec,
      allowByProcessSec: baseSec,
      allowByFinalSec: baseSec,
      subSteps,
    };
  });

  // --- PURE BASE CYCLE (SEBELUM KESULITAN & SEBELUM ALLOWANCE) ---
  const rawTotalBaseSec = rawItems.reduce((a, b) => a + b.baseSec, 0);

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

  // --- DUAL-MODE ALLOWANCE ENGINE (DIHITUNG DARI BASE + TINGKAT KESULITAN) ---
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
    rawTotalBaseSec,
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
  const twistBundlesCount = groupTwistBundlesCount(ppcs);

  // REG: Standard calculation with Autocutting active
  const reg = executeVariant(
    payload,
    stdDb,
    autoCutList,
    feederList,
    twistBundlesCount,
    false
  );

  // SMV: Special calculation excluding Autocutting (#2) -> falls back to Semi-Auto & Manual
  const smv = executeVariant(
    payload,
    stdDb,
    autoCutList,
    feederList,
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
    rawTotalBaseSec: reg.rawTotalBaseSec,
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
  const fallbackMultiplier =
    1 + ((calculation.difficultyPct ?? 0) > 0 ? (calculation.difficultyPct ?? 0) / 100 : 0);

  if (variant === 'smv' && calculation.smv) {
    return {
      ...calculation.smv,
      rawTotalBaseSec:
        typeof calculation.smv.rawTotalBaseSec === 'number'
          ? calculation.smv.rawTotalBaseSec
          : calculation.smv.totalBaseSec / fallbackMultiplier,
    };
  }
  return {
    rawTotalBaseSec:
      typeof calculation.rawTotalBaseSec === 'number'
        ? calculation.rawTotalBaseSec
        : calculation.totalBaseSec / fallbackMultiplier,
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
    rawTotalBaseSec: variant.rawTotalBaseSec,
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
