import { AssemblyCotItem, PartListItem } from '../types/umh';

export type CotDiaCode =
  | 'D7'
  | 'D10'
  | 'D13'
  | 'D15'
  | 'D19'
  | 'D22'
  | 'D25'
  | 'D28'
  | 'D32'
  | 'D36';

export interface SettingWireCctTier {
  code: string;
  minCct: number;
  maxCct: number | null;
  label: string;
  rate: number; // dtk/CCT
}

/**
 * MATRIX_SETTING_WIRE_CCT:
 * Matriks rate berjenjang untuk sub-step Setting Wires on Board berdasarkan jumlah CCT aktual PPCS.
 * Sweet spot berada pada 201–300 CCT (7.30 dtk/CCT) dan melandai di 301–601+ CCT.
 */
export const MATRIX_SETTING_WIRE_CCT: SettingWireCctTier[] = [
  { code: 'T1', minCct: 1, maxCct: 50, label: '1 – 50 CCT', rate: 4.25 },
  { code: 'T2', minCct: 51, maxCct: 100, label: '51 – 100 CCT', rate: 5.80 },
  { code: 'T3', minCct: 101, maxCct: 200, label: '101 – 200 CCT', rate: 6.85 },
  { code: 'T4', minCct: 201, maxCct: 300, label: '201 – 300 CCT', rate: 7.30 },
  { code: 'T5', minCct: 301, maxCct: 450, label: '301 – 450 CCT', rate: 6.40 },
  { code: 'T6', minCct: 451, maxCct: 600, label: '451 – 600 CCT', rate: 5.45 },
  { code: 'T7', minCct: 601, maxCct: null, label: '601+ CCT', rate: 4.70 },
];

export const STD_SETTING_WIRE_ROW_LABELS: string[] = [
  'T1 (1 – 50 CCT)',
  'T2 (51 – 100 CCT)',
  'T3 (101 – 200 CCT)',
  'T4 (201 – 300 CCT · Sweet Spot)',
  'T5 (301 – 450 CCT)',
  'T6 (451 – 600 CCT)',
  'T7 (601+ CCT)',
];

export const STD_SETTING_WIRE_COL_LABELS: string[] = ['Rate Dasar (dtk / CCT)'];

export const DEFAULT_SETTING_WIRE_MATRIX: number[][] = MATRIX_SETTING_WIRE_CCT.map((t) => [t.rate]);

export function upgradeSettingWireMatrix(matrix?: number[][]): number[][] {
  if (!Array.isArray(matrix) || matrix.length !== MATRIX_SETTING_WIRE_CCT.length) {
    return structuredClone(DEFAULT_SETTING_WIRE_MATRIX);
  }
  return MATRIX_SETTING_WIRE_CCT.map((tier, idx) => {
    const val = Number(matrix[idx]?.[0]);
    return [Number.isFinite(val) && val >= 0 ? val : tier.rate];
  });
}

export function settingWireMatrixToRates(matrix?: number[][]): number[] {
  return upgradeSettingWireMatrix(matrix).map((row) => row[0]);
}

export function resolveSettingWireRate(
  totalCctPpcs: number,
  customRates?: number[]
): { code: string; label: string; rate: number } {
  const cct = Math.max(0, Math.floor(Number(totalCctPpcs) || 0));
  if (cct <= 0) {
    return { code: 'T0', label: '0 CCT', rate: 0 };
  }

  let matchedIdx = MATRIX_SETTING_WIRE_CCT.length - 1;
  for (let i = 0; i < MATRIX_SETTING_WIRE_CCT.length; i++) {
    const tier = MATRIX_SETTING_WIRE_CCT[i];
    if (cct >= tier.minCct && (tier.maxCct === null || cct <= tier.maxCct)) {
      matchedIdx = i;
      break;
    }
  }

  const tier = MATRIX_SETTING_WIRE_CCT[matchedIdx];
  const customVal = customRates?.[matchedIdx];
  const rate =
    typeof customVal === 'number' && Number.isFinite(customVal) && customVal >= 0
      ? customVal
      : tier.rate;

  return {
    code: tier.code,
    label: tier.label,
    rate,
  };
}

export interface CotMasterFactorV2 {
  dia: CotDiaCode;
  diaMm: number;
  preFull: number;      // dtk/mm COT
  preHalf: number;      // dtk/mm COT
  postFull: number;     // dtk/mm COT
  postHalf: number;     // dtk/mm COT
  tSpot: number;        // dtk/titik
  tUjungBranch: number; // dtk (skala multi-branch per diameter)
}

/**
 * Master_COT_V2: Matriks faktor waktu taping COT & multi-branch per diameter (D7–D36).
 * Nilai T_Ujung_Branch sudah mencakup skala multi-branch per diameter.
 */
export const MASTER_COT_V2_LIST: CotMasterFactorV2[] = [
  { dia: 'D7',  diaMm: 7,  preFull: 0.0156, preHalf: 0.0094, postFull: 0.0215, postHalf: 0.0137, tSpot: 1.50, tUjungBranch: 3.20 },
  { dia: 'D10', diaMm: 10, preFull: 0.0184, preHalf: 0.0103, postFull: 0.0243, postHalf: 0.0140, tSpot: 1.60, tUjungBranch: 3.78 },
  { dia: 'D13', diaMm: 13, preFull: 0.0212, preHalf: 0.0113, postFull: 0.0268, postHalf: 0.0144, tSpot: 1.75, tUjungBranch: 4.37 },
  { dia: 'D15', diaMm: 15, preFull: 0.0238, preHalf: 0.0122, postFull: 0.0292, postHalf: 0.0150, tSpot: 1.90, tUjungBranch: 5.13 },
  { dia: 'D19', diaMm: 19, preFull: 0.0266, preHalf: 0.0131, postFull: 0.0315, postHalf: 0.0155, tSpot: 2.05, tUjungBranch: 6.16 },
  { dia: 'D22', diaMm: 22, preFull: 0.0293, preHalf: 0.0141, postFull: 0.0342, postHalf: 0.0164, tSpot: 2.20, tUjungBranch: 7.29 },
  { dia: 'D25', diaMm: 25, preFull: 0.0345, preHalf: 0.0161, postFull: 0.0394, postHalf: 0.0185, tSpot: 2.35, tUjungBranch: 8.50 },
  { dia: 'D28', diaMm: 28, preFull: 0.0372, preHalf: 0.0170, postFull: 0.0422, postHalf: 0.0195, tSpot: 2.50, tUjungBranch: 9.81 },
  { dia: 'D32', diaMm: 32, preFull: 0.0399, preHalf: 0.0180, postFull: 0.0449, postHalf: 0.0205, tSpot: 2.65, tUjungBranch: 11.20 },
  { dia: 'D36', diaMm: 36, preFull: 0.0451, preHalf: 0.0200, postFull: 0.0502, postHalf: 0.0227, tSpot: 2.80, tUjungBranch: 12.90 },
];

const LEGACY_T_UJUNG_2SISI = [3.20, 3.50, 3.80, 4.10, 4.40, 4.70, 5.00, 5.30, 5.60, 6.00];

export const STD_COT_ROW_LABELS: CotDiaCode[] = MASTER_COT_V2_LIST.map((x) => x.dia);

export const STD_COT_COL_LABELS: string[] = [
  'Pre_Full (dtk/mm)',
  'Pre_Half (dtk/mm)',
  'Post_Full (dtk/mm)',
  'Post_Half (dtk/mm)',
  'T_Spot (dtk/titik)',
  'T_Ujung_Branch (dtk)',
];

export const DEFAULT_COT_MATRIX: number[][] = MASTER_COT_V2_LIST.map((x) => [
  x.preFull,
  x.preHalf,
  x.postFull,
  x.postHalf,
  x.tSpot,
  x.tUjungBranch,
]);

export const MASTER_COT_V2_MAP: Record<CotDiaCode, CotMasterFactorV2> = MASTER_COT_V2_LIST.reduce(
  (acc, item) => {
    acc[item.dia] = item;
    return acc;
  },
  {} as Record<CotDiaCode, CotMasterFactorV2>
);

const VALID_DIA_CODES = new Set<string>(MASTER_COT_V2_LIST.map((x) => x.dia));

/**
 * Upgrade otomatis kolom 5 (T_Ujung_2Sisi lama -> T_Ujung_Branch multi-branch baru)
 * apabila user belum mengedit nilai T_Ujung lama secara manual.
 */
export function upgradeLegacyCotMatrix(cotMatrix?: number[][]): number[][] {
  if (!Array.isArray(cotMatrix) || cotMatrix.length === 0) {
    return structuredClone(DEFAULT_COT_MATRIX);
  }
  const cloned = cotMatrix.map((row) => (Array.isArray(row) ? [...row] : []));
  const matchesLegacyUjung =
    cloned.length === LEGACY_T_UJUNG_2SISI.length &&
    LEGACY_T_UJUNG_2SISI.every((oldVal, idx) => {
      const curVal = Number(cloned[idx]?.[5]);
      return Number.isFinite(curVal) && Math.abs(curVal - oldVal) < 1e-6;
    });

  if (matchesLegacyUjung) {
    return cloned.map((row, idx) => {
      const next = [...row];
      next[5] = MASTER_COT_V2_LIST[idx].tUjungBranch;
      return next;
    });
  }
  return cloned;
}

/**
 * Konversi 2D matrix (10 baris D7..D36 × 6 kolom) dari Parameter STD menjadi daftar
 * faktor Master_COT_V2 aktif, dengan fallback aman ke nilai standar bila sel kosong.
 */
export function cotMatrixToFactors(cotMatrix?: number[][]): CotMasterFactorV2[] {
  if (!Array.isArray(cotMatrix) || cotMatrix.length === 0) {
    return MASTER_COT_V2_LIST;
  }
  const safeCell = (row: number[] | undefined, colIdx: number, fallback: number): number => {
    const v = Number(row?.[colIdx]);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  return MASTER_COT_V2_LIST.map((def, rIdx) => {
    const row = Array.isArray(cotMatrix[rIdx]) ? cotMatrix[rIdx] : undefined;
    return {
      dia: def.dia,
      diaMm: def.diaMm,
      preFull: safeCell(row, 0, def.preFull),
      preHalf: safeCell(row, 1, def.preHalf),
      postFull: safeCell(row, 2, def.postFull),
      postHalf: safeCell(row, 3, def.postHalf),
      tSpot: safeCell(row, 4, def.tSpot),
      tUjungBranch: safeCell(row, 5, def.tUjungBranch),
    };
  });
}

/**
 * Ekstrak kode diameter (`D7`, `D10`, ..., `D36`) dari kolom `TUBE NAME`
 * (contoh: `H-COT-D7-Gy` -> `D7`, `COT-F-D10-B` -> `D10`) tanpa karakter `-`.
 */
export function extractCotDiaCode(rawName: string, fallbackName = ''): string {
  const candidates = [rawName, fallbackName];
  for (const cand of candidates) {
    const text = String(cand ?? '').trim().toUpperCase();
    if (!text) continue;

    // Utamakan pola berbatas non-alfanumerik: "-D7-", "-D10-", " D15 ", atau di awal/akhir string
    const bounded = text.match(/(?:^|[^A-Z0-9])D(\d{1,2})(?=$|[^0-9])/);
    if (bounded) {
      return `D${parseInt(bounded[1], 10)}`;
    }

    // Fallback pola D diikuti 1-2 digit angka tanpa karakter lanjutan angka
    const loose = text.match(/D(\d{1,2})(?=\D|$)/);
    if (loose) {
      return `D${parseInt(loose[1], 10)}`;
    }
  }
  return '';
}

/**
 * Resolve kode diameter ke baris faktor Master_COT_V2 (mendukung custom cotMatrix dari Parameter STD).
 * Jika diameter numerik non-standar ditemukan (mis. D5 atau D12),
 * snap ke diameter standar terdekat agar tidak pernah menghasilkan 0 / NaN.
 */
export function resolveCotMasterFactor(
  diaCodeOrName: string,
  cotMatrix?: number[][]
): CotMasterFactorV2 {
  const factors = cotMatrixToFactors(cotMatrix);
  const trimmedUp = diaCodeOrName.trim().toUpperCase();
  const extracted = VALID_DIA_CODES.has(trimmedUp) ? trimmedUp : extractCotDiaCode(diaCodeOrName);

  if (extracted && VALID_DIA_CODES.has(extracted)) {
    const exact = factors.find((f) => f.dia === extracted);
    if (exact) return exact;
  }

  const mmMatch = extracted.match(/^D(\d+)$/);
  if (mmMatch) {
    const targetMm = parseInt(mmMatch[1], 10);
    let nearest = factors[0];
    let bestDiff = Math.abs(nearest.diaMm - targetMm);
    for (const item of factors) {
      const diff = Math.abs(item.diaMm - targetMm);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = item;
      }
    }
    return nearest;
  }

  // Fallback aman jika tubeName tidak mencantumkan kode D (default D10)
  return factors.find((f) => f.dia === 'D10') ?? factors[0];
}

export type CotTubeKind = 'H-COT' | 'COT-B';

/**
 * Klasifikasi jenis selang COT berdasarkan TUBE NAME / PART NAME:
 * - H-COT (non-slit / selongsong utuh): diawali atau memuat token 'H-COT' / 'HCOT'
 * - COT-B (slit / selang belah): seluruh selang COT selain H-COT
 */
export function classifyCotTubeKind(
  tubeName?: string,
  partName?: string,
  tubeNo?: string
): CotTubeKind {
  const combined = `${tubeName || ''} ${partName || ''} ${tubeNo || ''}`.trim();
  if (/(?:^|[\s/(_-])H[\s_-]*COT(?:\b|[\s_-])/i.test(combined)) {
    return 'H-COT';
  }
  return 'COT-B';
}

export interface CotRowCalcV2 {
  row: AssemblyCotItem;
  diaCode: string;
  resolvedDia: CotDiaCode;
  cotKind: CotTubeKind;
  lengthMm: number;
  qty: number;
  preFull: number;
  preHalf: number;
  preSpot: number;
  tPre: number;
  tInsert: number;
  tUjung: number;
  postFull: number;
  postHalf: number;
  postSpot: number;
  tPost: number;
  secPerUnit: number;
  totalPreSec: number;
  totalInsertSec: number;
  totalUjungSec: number;
  totalPostSec: number;
  totalSec: number;
  baseUmhHr: number;
  tarikanCot: number;
}

export interface CotTapingV2Summary {
  hasCotV2Rows: boolean;
  rows: CotRowCalcV2[];
  cotV2RowCount: number;
  totalPieces: number;
  totalLengthMm: number;
  totalTarikanCot: number;
  totalPreSec: number;
  totalInsertSec: number;
  cotBQty: number;
  cotBLengthMm: number;
  cotBInsertSec: number;
  hCotQty: number;
  hCotLengthMm: number;
  hCotInsertSec: number;
  totalUjungSec: number;
  totalPostSec: number;
  totalSec: number;
  totalBaseUmhHr: number;
}

export function isCotV2Row(item: AssemblyCotItem): boolean {
  return Boolean(item.tubeName || item.diaCode || item.tubeNo);
}

/**
 * Hitung detik taping COT per baris sesuai rumus Master_COT_V2 + kerja fisik pemasangan selang COT:
 * - Pre-COT  = ((3.5 + L*Pre_Full) + (3.5 + L*Pre_Half) + (MAX(1, FLOOR(L/150))*T_Spot)) / 3
 * - Insert   = COT-B: (3.00 + 0.035*L) | H-COT: (5.00 + 0.065*L)
 * - Ujung    = T_Ujung_Branch
 * - Post-COT = ((3.5 + L*Post_Full) + (3.5 + L*Post_Half) + (MAX(0, FLOOR(L/150)-1)*T_Spot)) / 3
 * - Total Taping = (T_pre + T_ujung + T_post) * Q
 */
export interface CotCalcOptions {
  preTapeBaseSec?: number;
  postTapeBaseSec?: number;
  cotBBaseSec?: number;
  cotBPerMmSec?: number;
  hCotBaseSec?: number;
  hCotPerMmSec?: number;
}

export function calculateCotRowTapingV2(
  item: AssemblyCotItem,
  partList?: PartListItem[],
  cotMatrix?: number[][],
  options?: CotCalcOptions
): CotRowCalcV2 {
  let rawDia = item.diaCode || extractCotDiaCode(item.tubeName || '', item.partName || '');
  let matchedPl: PartListItem | undefined;

  // Cross-reference PART LIST jika tubeName tidak langsung memuat kode D atau jenis H-COT
  if (partList && partList.length > 0) {
    const key = (item.tubeName || item.tubeNo || item.partName || '').trim().toLowerCase();
    if (key) {
      matchedPl = partList.find(
        (p) =>
          p.partNumber.trim().toLowerCase() === key ||
          p.partName.trim().toLowerCase() === key
      );
      if (!rawDia && matchedPl) {
        rawDia = extractCotDiaCode(matchedPl.partNumber, matchedPl.partName);
      }
    }
  }

  const cotKind: CotTubeKind =
    classifyCotTubeKind(item.tubeName, item.partName, item.tubeNo) === 'H-COT' ||
    (matchedPl && classifyCotTubeKind(matchedPl.partNumber, matchedPl.partName) === 'H-COT')
      ? 'H-COT'
      : 'COT-B';

  const factor = resolveCotMasterFactor(rawDia, cotMatrix);
  const L = Math.max(0, Number(item.tl) || 0);
  const Q = item.qty !== undefined ? Math.max(0, Number(item.qty) || 0) : 1;

  if (L <= 0 || Q <= 0) {
    return {
      row: item,
      diaCode: rawDia || factor.dia,
      resolvedDia: factor.dia,
      cotKind,
      lengthMm: L,
      qty: Q,
      preFull: 0,
      preHalf: 0,
      preSpot: 0,
      tPre: 0,
      tInsert: 0,
      tUjung: 0,
      postFull: 0,
      postHalf: 0,
      postSpot: 0,
      tPost: 0,
      secPerUnit: 0,
      totalPreSec: 0,
      totalInsertSec: 0,
      totalUjungSec: 0,
      totalPostSec: 0,
      totalSec: 0,
      baseUmhHr: 0,
      tarikanCot: 0,
    };
  }

  const preBase =
    typeof options?.preTapeBaseSec === 'number' &&
    Number.isFinite(options.preTapeBaseSec) &&
    options.preTapeBaseSec >= 0
      ? options.preTapeBaseSec
      : 3.5;
  const postBase =
    typeof options?.postTapeBaseSec === 'number' &&
    Number.isFinite(options.postTapeBaseSec) &&
    options.postTapeBaseSec >= 0
      ? options.postTapeBaseSec
      : 3.5;
  const cotBBase =
    typeof options?.cotBBaseSec === 'number' &&
    Number.isFinite(options.cotBBaseSec) &&
    options.cotBBaseSec >= 0
      ? options.cotBBaseSec
      : 3.0;
  const cotBPerMm =
    typeof options?.cotBPerMmSec === 'number' &&
    Number.isFinite(options.cotBPerMmSec) &&
    options.cotBPerMmSec >= 0
      ? options.cotBPerMmSec
      : 0.035;
  const hCotBase =
    typeof options?.hCotBaseSec === 'number' &&
    Number.isFinite(options.hCotBaseSec) &&
    options.hCotBaseSec >= 0
      ? options.hCotBaseSec
      : 5.0;
  const hCotPerMm =
    typeof options?.hCotPerMmSec === 'number' &&
    Number.isFinite(options.hCotPerMmSec) &&
    options.hCotPerMmSec >= 0
      ? options.hCotPerMmSec
      : 0.065;

  const floorDiv150 = Math.floor(L / 150);

  // 1. Pre-COT (taping wire bundle sebelum masuk COT)
  const preFull = preBase + L * factor.preFull;
  const preHalf = preBase + L * factor.preHalf;
  const preSpot = Math.max(1, floorDiv150) * factor.tSpot;
  const tPre = (preFull + preHalf + preSpot) / 3;

  // 2. Pemasangan Selang COT (kerja fisik insertion/fitting terpisah: COT-B slit vs H-COT non-slit)
  const tInsert = cotKind === 'H-COT' ? hCotBase + L * hCotPerMm : cotBBase + L * cotBPerMm;

  // 3. Tutup ujung multi-branch per diameter
  const tUjung = factor.tUjungBranch;

  // 4. Post-COT (taping luar setelah COT terpasang)
  const postFull = postBase + L * factor.postFull;
  const postHalf = postBase + L * factor.postHalf;
  const postSpot = Math.max(0, floorDiv150 - 1) * factor.tSpot;
  const tPost = (postFull + postHalf + postSpot) / 3;

  const secPerUnit = tPre + tUjung + tPost;
  const totalPreSec = tPre * Q;
  const totalInsertSec = tInsert * Q;
  const totalUjungSec = tUjung * Q;
  const totalPostSec = tPost * Q;
  const totalSec = secPerUnit * Q;
  const tarikanCot = Math.ceil(L / 1000) * Q;

  return {
    row: item,
    diaCode: rawDia || factor.dia,
    resolvedDia: factor.dia,
    cotKind,
    lengthMm: L,
    qty: Q,
    preFull,
    preHalf,
    preSpot,
    tPre,
    tInsert,
    tUjung,
    postFull,
    postHalf,
    postSpot,
    tPost,
    secPerUnit,
    totalPreSec,
    totalInsertSec,
    totalUjungSec,
    totalPostSec,
    totalSec,
    baseUmhHr: totalSec / 3600,
    tarikanCot,
  };
}

export function calculateCotTapingV2Summary(
  assemblyCotList: AssemblyCotItem[],
  partList?: PartListItem[],
  cotMatrix?: number[][],
  options?: CotCalcOptions
): CotTapingV2Summary {
  const cotItems = assemblyCotList.filter((item) => item.type === 'C');
  const hasCotV2Rows = cotItems.length > 0;

  if (!hasCotV2Rows) {
    return {
      hasCotV2Rows: false,
      rows: [],
      cotV2RowCount: 0,
      totalPieces: 0,
      totalLengthMm: 0,
      totalTarikanCot: 0,
      totalPreSec: 0,
      totalInsertSec: 0,
      cotBQty: 0,
      cotBLengthMm: 0,
      cotBInsertSec: 0,
      hCotQty: 0,
      hCotLengthMm: 0,
      hCotInsertSec: 0,
      totalUjungSec: 0,
      totalPostSec: 0,
      totalSec: 0,
      totalBaseUmhHr: 0,
    };
  }

  const rows = cotItems.map((item) => calculateCotRowTapingV2(item, partList, cotMatrix, options));
  let totalPieces = 0;
  let totalLengthMm = 0;
  let totalTarikanCot = 0;
  let totalPreSec = 0;
  let totalInsertSec = 0;
  let cotBQty = 0;
  let cotBLengthMm = 0;
  let cotBInsertSec = 0;
  let hCotQty = 0;
  let hCotLengthMm = 0;
  let hCotInsertSec = 0;
  let totalUjungSec = 0;
  let totalPostSec = 0;
  let totalSec = 0;

  for (const r of rows) {
    totalPieces += r.qty;
    totalLengthMm += r.lengthMm * r.qty;
    totalTarikanCot += r.tarikanCot;
    totalPreSec += r.totalPreSec;
    totalInsertSec += r.totalInsertSec;
    if (r.cotKind === 'H-COT') {
      hCotQty += r.qty;
      hCotLengthMm += r.lengthMm * r.qty;
      hCotInsertSec += r.totalInsertSec;
    } else {
      cotBQty += r.qty;
      cotBLengthMm += r.lengthMm * r.qty;
      cotBInsertSec += r.totalInsertSec;
    }
    totalUjungSec += r.totalUjungSec;
    totalPostSec += r.totalPostSec;
    totalSec += r.totalSec;
  }

  return {
    hasCotV2Rows: true,
    rows,
    cotV2RowCount: rows.length,
    totalPieces,
    totalLengthMm,
    totalTarikanCot,
    totalPreSec,
    totalInsertSec,
    cotBQty,
    cotBLengthMm,
    cotBInsertSec,
    hCotQty,
    hCotLengthMm,
    hCotInsertSec,
    totalUjungSec,
    totalPostSec,
    totalSec,
    totalBaseUmhHr: totalSec / 3600,
  };
}
