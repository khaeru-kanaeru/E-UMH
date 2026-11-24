import { PartListItem } from '../types/umh';

/** Panjang standar 1 titik Spot Tape = 200 mm = 0.2 meter */
export const SPOT_TAPE_LENGTH_M = 0.2;

/**
 * Daftar inisial / kode warna kabel & vinyl tape standar (JASO / Sumitomo / Yazaki / Hitachi)
 * selain warna Hitam (Black).
 *
 * Catatan penting:
 * - Hitam (Black) ditandai dengan huruf tunggal "B" (atau BK / BLK / BLACK) -> DIKECUALIKAN.
 * - Kode 2 huruf seperti "BL" (Blue) dan "BR" (Brown) tetap termasuk warna non-Black.
 * - Satuan / kode non-warna seperti "M", "MM", "CM", "MTR", "PCS", "ROLL", "OK" TIDAK termasuk warna.
 */
const BLACK_COLOR_CODES = new Set(['B', 'BK', 'BLK', 'BLACK']);

const NON_BLACK_COLOR_CODES = new Set([
  // Kode 1 huruf (JASO / Wire Harness standard)
  'R', // Red
  'W', // White
  'Y', // Yellow
  'G', // Green
  'L', // Blue
  'O', // Orange
  'P', // Pink
  'V', // Violet / Purple
  'S', // Sky Blue
  'N', // Brown / Natural
  'C', // Clear / Cream
  // Kode 2 huruf
  'LG', // Light Green
  'BR', // Brown
  'BL', // Blue (bukan B tunggal)
  'BU', // Blue
  'GY', // Gray
  'GR', // Gray / Green
  'SB', // Sky Blue
  'LB', // Light Blue
  'DG', // Dark Green
  'OR', // Orange
  'YL', // Yellow
  'YE', // Yellow
  'RD', // Red
  'WH', // White
  'GN', // Green
  'PK', // Pink
  'PU', // Purple
  'VL', // Violet
  'VI', // Violet
  'CH', // Chocolate
  'CL', // Clear
  'TR', // Transparent
  'GL', // Gold
  'SL', // Silver
  'SV', // Silver
  'CR', // Cream
  'IV', // Ivory
  'BE', // Beige
  // Nama warna lengkap (non-Black)
  'RED',
  'WHITE',
  'YELLOW',
  'GREEN',
  'BLUE',
  'ORANGE',
  'PINK',
  'GRAY',
  'GREY',
  'BROWN',
  'PURPLE',
  'VIOLET',
  'CLEAR',
  'CREAM',
  'GOLD',
  'SILVER',
  'LIGHT GREEN',
  'SKY BLUE',
  'LIGHT BLUE',
  'DARK GREEN',
  'DARK BLUE',
]);

const MULTI_WORD_COLORS = [
  'LIGHT GREEN',
  'SKY BLUE',
  'LIGHT BLUE',
  'DARK GREEN',
  'DARK BLUE',
] as const;

export interface SpotTapeMatchedItem {
  partNumber: string;
  partName: string;
  colorCode: string;
  qty: number;
  unit: string;
  meters: number;
}

export interface SpotTapeExcludedItem {
  partNumber: string;
  partName: string;
  colorCode: string | null;
  qty: number;
  unit: string;
  reason: string;
}

export interface SpotTapeCalculationSummary {
  totalMeters: number;
  spotCount: number;
  matchedItems: SpotTapeMatchedItem[];
  excludedTapeItems: SpotTapeExcludedItem[];
}

function isKnownColorToken(tokenUpper: string): boolean {
  if (BLACK_COLOR_CODES.has(tokenUpper) || NON_BLACK_COLOR_CODES.has(tokenUpper)) {
    return true;
  }
  // Mendukung kombinasi 2 warna seperti "Y/G", "R/W", "W/L"
  if (tokenUpper.includes('/')) {
    const parts = tokenUpper.split('/').filter(Boolean);
    return (
      parts.length === 2 &&
      parts.every((p) => BLACK_COLOR_CODES.has(p) || NON_BLACK_COLOR_CODES.has(p))
    );
  }
  return false;
}

/**
 * Mengekstrak inisial/kode warna di ujung belakang Part No tape.
 * Contoh:
 * - "WHVTA 19*20 Lg"     -> "Lg"
 * - "WHVTA 19*20 P"      -> "P"
 * - "WHVTA 19*20 R"      -> "R"
 * - "WHVTA 19*20 W"      -> "W"
 * - "NITTO 223S 19*20 B" -> "B"
 * - "0.2 x 38 x 20"      -> null (tidak punya inisial warna)
 */
export function extractTapeColorCode(partNumber: string): string | null {
  const cleaned = String(partNumber || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (!cleaned) return null;

  const upper = cleaned.toUpperCase();
  for (const phrase of MULTI_WORD_COLORS) {
    if (
      upper.endsWith(` ${phrase}`) ||
      upper.endsWith(`-${phrase}`) ||
      upper.endsWith(`_${phrase}`)
    ) {
      return cleaned.slice(cleaned.length - phrase.length).trim();
    }
  }

  // Ambil token terakhir yang dipisahkan oleh spasi, '-', atau '_'
  const match = cleaned.match(/(?:^|[\s_-])([A-Za-z]+(?:\/[A-Za-z]+)?)$/);
  if (!match) return null;

  const rawToken = match[1];
  const tokenUpper = rawToken.toUpperCase();
  if (!isKnownColorToken(tokenUpper)) return null;

  return rawToken;
}

/**
 * Mengecek apakah kode warna merupakan warna Hitam (Black) — huruf B tunggal (atau BK/BLK/BLACK).
 */
export function isBlackTapeColor(colorCode: string): boolean {
  const u = String(colorCode || '').trim().toUpperCase();
  return BLACK_COLOR_CODES.has(u);
}

/**
 * Mengecek apakah baris Part List adalah material Tape standar (bukan "Tape OK" / "OK Tape" / non-tape).
 */
export function isStandardTapePart(partName: string, partNumber: string): boolean {
  const pn = String(partName || '').trim().toLowerCase();
  const num = String(partNumber || '').trim().toLowerCase();
  if (!pn) return false;

  // Kecualikan Tape OK (inspeksi), double tape, foam/sponge tape, corrugated/tube
  if (
    pn.includes('tape ok') ||
    pn.includes('ok tape') ||
    num.includes('ok tape') ||
    num.includes('tape ok') ||
    pn.includes('double') ||
    pn.includes('foam') ||
    pn.includes('sponge') ||
    pn.includes('corrugated') ||
    pn.includes('tube')
  ) {
    return false;
  }

  return (
    pn === 'tape' ||
    /^(vinyl|pvc|vta|harness|insulation|isolasi)\s+tape$/i.test(pn) ||
    /^tape\s+(vinyl|pvc|vta|warna|color)$/i.test(pn)
  );
}

/**
 * Konversi Qty ke satuan meter berdasarkan Unit Part List (default sudah dalam Meter / Mtr).
 */
export function normalizeTapeQtyToMeters(qty: number, unit?: string): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  const u = String(unit || '').trim().toUpperCase();
  if (u === 'MM' || u === 'MILLIMETER' || u === 'MILIMETER') {
    return qty / 1000;
  }
  if (u === 'CM' || u === 'CENTIMETER') {
    return qty / 100;
  }
  return qty;
}

/**
 * Evaluasi satu baris Part List apakah memenuhi syarat Spot Tape (Tape berwarna selain Black).
 */
export function evaluateSpotTapePartItem(
  item: Pick<PartListItem, 'partNumber' | 'partName' | 'qty' | 'unit'>
): {
  isTape: boolean;
  qualified: boolean;
  colorCode: string | null;
  meters: number;
  reason?: string;
} {
  const partName = String(item.partName || '').trim();
  const partNumber = String(item.partNumber || '').trim();
  const isTape = isStandardTapePart(partName, partNumber);
  if (!isTape) {
    return { isTape: false, qualified: false, colorCode: null, meters: 0 };
  }

  const colorCode = extractTapeColorCode(partNumber);
  const meters = normalizeTapeQtyToMeters(item.qty, item.unit);

  if (!colorCode) {
    return {
      isTape: true,
      qualified: false,
      colorCode: null,
      meters,
      reason: 'Tidak memiliki inisial warna di ujung Part No',
    };
  }

  if (isBlackTapeColor(colorCode)) {
    return {
      isTape: true,
      qualified: false,
      colorCode,
      meters,
      reason: 'Tape Black (inisial B tunggal — dikecualikan)',
    };
  }

  if (meters <= 0) {
    return {
      isTape: true,
      qualified: false,
      colorCode,
      meters: 0,
      reason: 'Qty = 0',
    };
  }

  return {
    isTape: true,
    qualified: true,
    colorCode,
    meters,
  };
}

/**
 * Menghitung estimasi jumlah titik Spot Tape dari PART LIST:
 * 1. Jumlahkan total Qty (meter) seluruh baris Tape yang memiliki inisial warna di belakang Part No selain Black (B).
 *    (Baris tanpa inisial warna seperti "0.2 x 38 x 20" dan "Tape OK" tidak dimasukkan.)
 * 2. Bagi total meter dengan 0.2 m (panjang 1 spot = 200 mm), lalu bulatkan ke atas (Math.ceil).
 */
export function calculateSpotTapeFromPartList(
  partList: PartListItem[] = []
): SpotTapeCalculationSummary {
  const matchedItems: SpotTapeMatchedItem[] = [];
  const excludedTapeItems: SpotTapeExcludedItem[] = [];
  let sumMeters = 0;

  for (const item of partList) {
    const evalRes = evaluateSpotTapePartItem(item);
    if (!evalRes.isTape) continue;

    if (evalRes.qualified && evalRes.colorCode) {
      sumMeters += evalRes.meters;
      matchedItems.push({
        partNumber: item.partNumber,
        partName: item.partName,
        colorCode: evalRes.colorCode,
        qty: item.qty,
        unit: item.unit || 'Mtr',
        meters: evalRes.meters,
      });
    } else {
      excludedTapeItems.push({
        partNumber: item.partNumber,
        partName: item.partName,
        colorCode: evalRes.colorCode,
        qty: item.qty,
        unit: item.unit || 'Mtr',
        reason: evalRes.reason || 'Dikecualikan',
      });
    }
  }

  const totalMeters = Number(sumMeters.toFixed(6));
  const spotCount =
    totalMeters > 0
      ? Math.ceil(Number((totalMeters / SPOT_TAPE_LENGTH_M).toFixed(6)))
      : 0;

  return {
    totalMeters,
    spotCount,
    matchedItems,
    excludedTapeItems,
  };
}
