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

export const COT_DIA_WEIGHTS: Record<string, number> = {
  D7: 0.70,
  D10: 0.85,
  D13: 1.00,
  D15: 1.15,
  D19: 1.35,
  D22: 1.55,
  D25: 1.80,
  D28: 2.05,
  D32: 2.30,
  D36: 2.60,
};

export function getCotDiaWeight(diaCode: string): number {
  const norm = diaCode.trim().toUpperCase();
  return COT_DIA_WEIGHTS[norm] ?? 1.00;
}

export interface CotRowCalcV2 {
  row: AssemblyCotItem;
  diaCode: string;
  resolvedDia: CotDiaCode;
  cotKind: CotTubeKind;
  lengthMm: number;
  qty: number;
  diaWeight: number;
  weightedLengthMm: number;
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
  weightedLengthMm: number;
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

/**
 * Hitung detik taping COT per baris sesuai rumus Master_COT_V2 + kerja fisik pemasangan selang COT:
 * - Pre-COT  = ((3.5 + L*Pre_Full) + (3.5 + L*Pre_Half) + (3.5 + MAX(1, FLOOR(L/150))*T_Spot)) / 3
 * - Insert   = COT-B: (3.00 + 0.035*L) | H-COT: (5.00 + 0.065*L)
 * - Ujung    = T_Ujung_Branch
 * - Post-COT = ((3.5 + L*Post_Full) + (3.5 + L*Post_Half) + (FLOOR(L/150) > 0 ? 3.5 + FLOOR(L/150)*T_Spot : 0)) / 3
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
  const diaWeight = getCotDiaWeight(factor.dia);
  const L = Math.max(0, Number(item.tl) || 0);
  const Q = item.qty !== undefined ? Math.max(0, Number(item.qty) || 0) : 1;
  const weightedLengthMm = L * Q * diaWeight;

  if (L <= 0 || Q <= 0) {
    return {
      row: item,
      diaCode: rawDia || factor.dia,
      resolvedDia: factor.dia,
      cotKind,
      lengthMm: L,
      qty: Q,
      diaWeight,
      weightedLengthMm: 0,
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
  // 1. Pre-COT (taping wire bundle sebelum masuk COT)
  const preFull = preBase + L * factor.preFull;
  const preHalf = preBase + L * factor.preHalf;
  const preSpotCount = Math.max(1, Math.floor(L / 150));
  const preSpot = preBase + preSpotCount * factor.tSpot;
  const tPre = (preFull + preHalf + preSpot) / 3;

  // 2. Pemasangan Selang COT (semua COT & H-COT disetarakan Slit)
  const tInsert = cotBBase + L * cotBPerMm;

  // 3. Tutup ujung multi-branch per diameter
  const tUjung = factor.tUjungBranch;

  // 4. Post-COT (taping luar setelah COT terpasang)
  const postFull = postBase + L * factor.postFull;
  const postHalf = postBase + L * factor.postHalf;
  const postSpotPoints = Math.floor(L / 150);
  const postSpot = postSpotPoints > 0 ? postBase + postSpotPoints * factor.tSpot : 0;
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
    diaWeight,
    weightedLengthMm,
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
      weightedLengthMm: 0,
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
  let weightedLengthMm = 0;
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
    weightedLengthMm += r.weightedLengthMm;
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
    weightedLengthMm,
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

export const DEFAULT_DIFFICULTY_MATRIX: number[][] = [
  [0.00],
  [5.68],
  [9.70],
  [12.83],
  [15.38],
  [17.54],
  [19.41],
  [21.06],
  [22.53],
  [23.87],
  [25.08],
];

export const DIFFICULTY_ROW_LABELS = [
  '0.0 Bintang (Normal)',
  '0.5 Bintang (Sangat Ringan - Bawah)',
  '1.0 Bintang (Sangat Ringan)',
  '1.5 Bintang (Ringan - Menengah)',
  '2.0 Bintang (Menengah)',
  '2.5 Bintang (Menengah - Atas)',
  '3.0 Bintang (Sulit)',
  '3.5 Bintang (Sulit - Atas)',
  '4.0 Bintang (Sangat Sulit)',
  '4.5 Bintang (Sangat Sulit - Ekstrem)',
  '5.0 Bintang (Ekstrem / Treatment Khusus)',
];

export function upgradeDifficultyMatrix(matrix?: number[][]): number[][] {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return structuredClone(DEFAULT_DIFFICULTY_MATRIX);
  }
  const cloned = structuredClone(DEFAULT_DIFFICULTY_MATRIX);
  for (let i = 0; i < Math.min(matrix.length, cloned.length); i++) {
    const val = Number(matrix[i]?.[0]);
    if (Number.isFinite(val) && val >= 0) {
      cloned[i][0] = val;
    }
  }
  return cloned;
}

export function resolveDifficultyPercentage(rating: number, difficultyMatrix?: number[][]): number {
  const matrix = upgradeDifficultyMatrix(difficultyMatrix);
  const starIdx = Math.round(Math.max(0, Math.min(5.0, rating)) / 0.5);
  return matrix[Math.min(starIdx, matrix.length - 1)]?.[0] ?? 0;
}
