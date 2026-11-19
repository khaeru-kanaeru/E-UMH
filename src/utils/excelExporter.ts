import XLSX from 'xlsx-js-style';
import {
  getAllowanceModeLabel,
  getAllowSecForMode,
  getEffectiveLot,
  getVariantResult,
} from '../engine/umhCalculator';
import { AllowanceMode, AssyRecord, CalculationVariant, UiLang } from '../types/umh';
import {
  translateBasis,
  translateProcessName,
  translateStage,
  translateSubStepName,
  translateSummaryNote,
} from './umhTranslator';

const BORDER_THIN = {
  top: { style: 'thin', color: { rgb: 'CBD5E1' } },
  bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
  left: { style: 'thin', color: { rgb: 'CBD5E1' } },
  right: { style: 'thin', color: { rgb: 'CBD5E1' } },
};

const sBanner = {
  font: { name: 'Inter', sz: 14, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '0F172A' } },
  alignment: { vertical: 'center', horizontal: 'left' },
};

const sSubBanner = {
  font: { name: 'Inter', sz: 10, color: { rgb: 'E2E8F0' } },
  fill: { fgColor: { rgb: '1E3A8A' } },
  alignment: { vertical: 'center', horizontal: 'left' },
};

const sSectionReg = {
  font: { name: 'Inter', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '1E3A8A' } },
  alignment: { vertical: 'center', horizontal: 'left' },
};

const sSectionSmv = {
  font: { name: 'Inter', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '047857' } },
  alignment: { vertical: 'center', horizontal: 'left' },
};

const sMetaLbl = {
  font: { name: 'Inter', sz: 9, bold: true, color: { rgb: '475569' } },
  fill: { fgColor: { rgb: 'F1F5F9' } },
  border: BORDER_THIN,
  alignment: { vertical: 'center', horizontal: 'left' },
};

const sMetaVal = {
  font: { name: 'Inter', sz: 10, bold: true, color: { rgb: '007AFF' } },
  fill: { fgColor: { rgb: 'F8FAFC' } },
  border: BORDER_THIN,
  alignment: { vertical: 'center', horizontal: 'left' },
};

const sTh = {
  font: { name: 'Inter', sz: 10, bold: true, color: { rgb: '1E293B' } },
  fill: { fgColor: { rgb: 'E2E8F0' } },
  border: { ...BORDER_THIN, bottom: { style: 'medium', color: { rgb: '94A3B8' } } },
  alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
};

const sCellText = (zebra = false, muted = false) => ({
  font: { name: 'Inter', sz: 10, color: { rgb: muted ? '94A3B8' : '0F172A' } },
  fill: { fgColor: { rgb: zebra ? 'F8FAFC' : 'FFFFFF' } },
  border: BORDER_THIN,
  alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
});

const sCellCenter = (zebra = false, muted = false) => ({
  font: { name: 'Inter', sz: 10, color: { rgb: muted ? '94A3B8' : '475569' } },
  fill: { fgColor: { rgb: zebra ? 'F8FAFC' : 'FFFFFF' } },
  border: BORDER_THIN,
  alignment: { vertical: 'center', horizontal: 'center' },
});

const sCellNum = (fmt = '0.00', zebra = false, isAllow = false, muted = false) => ({
  font: {
    name: 'Inter',
    sz: 10,
    bold: isAllow && !muted,
    color: { rgb: muted ? '94A3B8' : isAllow ? '059669' : '0F172A' },
  },
  fill: {
    fgColor: { rgb: isAllow && !muted ? 'F0FDF4' : zebra ? 'F8FAFC' : 'FFFFFF' },
  },
  border: BORDER_THIN,
  alignment: { vertical: 'center', horizontal: 'right' },
  numFmt: fmt,
});

const sTotalCell = (fmt: string | null = null, isAllow = false) => ({
  font: {
    name: 'Inter',
    sz: 10,
    bold: true,
    color: { rgb: isAllow ? '047857' : '1D4ED8' },
  },
  fill: { fgColor: { rgb: isAllow ? 'DCFCE7' : 'DBEAFE' } },
  border: {
    top: { style: 'medium', color: { rgb: '3B82F6' } },
    bottom: { style: 'double', color: { rgb: '1D4ED8' } },
    left: BORDER_THIN.left,
    right: BORDER_THIN.right,
  },
  alignment: { vertical: 'center', horizontal: fmt ? 'right' : 'left' },
  ...(fmt ? { numFmt: fmt } : {}),
});

function applyRowStyle(ws: any, rowIdx: number, stylesArr: any[]) {
  stylesArr.forEach((st, colIdx) => {
    const ref = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
    if (!ws[ref]) ws[ref] = { t: 's', v: '' };
    ws[ref].s = st;
  });
}

export function exportUmhExcel(
  record: AssyRecord,
  activeMode: AllowanceMode,
  lang: UiLang = 'id'
): void {
  const wb = XLSX.utils.book_new();
  const { params } = record;
  const regCalc = getVariantResult(record, 'reg');
  const smvCalc = getVariantResult(record, 'smv');

  const effectiveLot = getEffectiveLot(params.lot);
  const effPct = activeMode === 'none' ? 0 : params.pfdAllowancePct || 0;
  const modeLabel =
    activeMode === 'none'
      ? '0. Tanpa Allowance (Base 0%)'
      : activeMode === 'by_final'
      ? `2. Allowance By Hasil Akhir (+${effPct}% Justified)`
      : `1. Allowance By Proses (+${effPct}% Tiap Proses)`;

  const sumHeaders = [
    'No',
    lang === 'jp' ? '工程名' : lang === 'en' ? 'Process Item' : 'Item Proses',
    'Base/STD Sec',
    'Allow Sec (Total)',
    '+Add Sec',
    'Eff. Allow (%)',
    'Base/STD Min',
    'Allow Min (Total)',
    'Base/STD Hour',
    'Allow Hour (Total)',
  ];

  // SHEET 1: SUMMARY UMH (REG ON TOP, SMV DIRECTLY BELOW ON SAME SHEET)
  const sumAoa: any[][] = [
    [
      'STD / UMH WIRE HARNESS REPORT — SUMMARY PER PROSES (REG & SMV)',
      '', '', '', '', '', '', '', '', '',
    ],
    [
      `Assy No: ${params.assyNo}  |  Customer: ${params.customer || '-'}  |  LOT: ${effectiveLot}  |  Metode: ${modeLabel}`,
      '', '', '', '', '', '', '', '', '',
    ],
    [],
    [
      'Assy No',
      params.assyNo,
      'Customer',
      params.customer || '-',
      'Master CCT / LOT',
      `${params.masterCct} CCT / LOT ${effectiveLot}`,
      'Allowance (%)',
      `${effPct}%`,
      'Sirkuit PPCS',
      record.ppcsList.length,
    ],
    [],
  ];

  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
  ];
  const rowStylesToApply: { rowIdx: number; styles: any[] }[] = [
    { rowIdx: 0, styles: Array(10).fill(sBanner) },
    { rowIdx: 1, styles: Array(10).fill(sSubBanner) },
    {
      rowIdx: 3,
      styles: [
        sMetaLbl,
        sMetaVal,
        sMetaLbl,
        sMetaVal,
        sMetaLbl,
        sMetaVal,
        sMetaLbl,
        sMetaVal,
        sMetaLbl,
        sMetaVal,
      ],
    },
  ];
  const rowHeights: Record<number, number> = {
    0: 28,
    1: 20,
    2: 8,
    3: 22,
    4: 10,
  };

  const appendSummaryBlock = (
    variantTitle: string,
    totalLabel: string,
    bannerStyle: any,
    calc: CalculationVariant
  ) => {
    const totalStdSec = getAllowSecForMode(
      activeMode,
      calc.totalBaseSec,
      calc.totalAllowByProcessSec,
      calc.totalAllowByFinalSec
    );
    const totAllow = totalStdSec - calc.totalBaseSec;

    const sectionRowIdx = sumAoa.length;
    sumAoa.push([variantTitle, '', '', '', '', '', '', '', '', '']);
    merges.push({ s: { r: sectionRowIdx, c: 0 }, e: { r: sectionRowIdx, c: 9 } });
    rowStylesToApply.push({ rowIdx: sectionRowIdx, styles: Array(10).fill(bannerStyle) });
    rowHeights[sectionRowIdx] = 24;

    const headerRowIdx = sumAoa.length;
    sumAoa.push([...sumHeaders]);
    rowStylesToApply.push({ rowIdx: headerRowIdx, styles: Array(10).fill(sTh) });
    rowHeights[headerRowIdx] = 26;

    calc.processes.forEach((it, idx) => {
      const stdVal = getAllowSecForMode(
        activeMode,
        it.baseSec,
        it.allowByProcessSec,
        it.allowByFinalSec
      );
      const allowSec = stdVal - it.baseSec;
      const effAllowPct = it.baseSec > 0 ? (allowSec / it.baseSec) * 100 : 0;
      const pName = translateProcessName(it.processId, it.processName, it.jpName, lang);

      const rIdx = sumAoa.length;
      sumAoa.push([
        idx + 1,
        pName,
        Number(it.baseSec.toFixed(2)),
        Number(stdVal.toFixed(2)),
        Number(allowSec.toFixed(2)),
        Number(effAllowPct.toFixed(1)),
        Number((it.baseSec / 60).toFixed(2)),
        Number((stdVal / 60).toFixed(2)),
        Number((it.baseSec / 3600).toFixed(4)),
        Number((stdVal / 3600).toFixed(4)),
      ]);

      const z = idx % 2 === 1;
      const m = it.baseSec === 0;
      rowStylesToApply.push({
        rowIdx: rIdx,
        styles: [
          sCellCenter(z, m),
          {
            ...sCellText(z, m),
            font: { name: 'Inter', sz: 10, bold: !m, color: { rgb: m ? '94A3B8' : '0F172A' } },
          },
          sCellNum('0.00', z, false, m),
          sCellNum('0.00', z, true, m),
          sCellNum('+0.00;-0.00;0.00', z, true, m),
          sCellNum('0.0"%"', z, false, m),
          sCellNum('0.00', z, false, m),
          sCellNum('0.00', z, true, m),
          sCellNum('0.0000', z, false, m),
          sCellNum('0.0000', z, true, m),
        ],
      });
    });

    const totRowIdx = sumAoa.length;
    sumAoa.push([
      '',
      totalLabel,
      Number(calc.totalBaseSec.toFixed(2)),
      Number(totalStdSec.toFixed(2)),
      Number(totAllow.toFixed(2)),
      Number(effPct.toFixed(1)),
      Number((calc.totalBaseSec / 60).toFixed(2)),
      Number((totalStdSec / 60).toFixed(2)),
      Number((calc.totalBaseSec / 3600).toFixed(4)),
      Number((totalStdSec / 3600).toFixed(4)),
    ]);
    rowStylesToApply.push({
      rowIdx: totRowIdx,
      styles: [
        sTotalCell(),
        sTotalCell(),
        sTotalCell('0.00', false),
        sTotalCell('0.00', true),
        sTotalCell('+0.00;-0.00;0.00', true),
        sTotalCell('0.0"%"', true),
        sTotalCell('0.00', false),
        sTotalCell('0.00', true),
        sTotalCell('0.0000', false),
        sTotalCell('0.0000', true),
      ],
    });
    rowHeights[totRowIdx] = 24;
  };

  // 1. REG ABOVE
  appendSummaryBlock(
    'BAGIAN 1 — HASIL PERHITUNGAN REG (NORMAL · AUTOCUTTING AKTIF)',
    'TOTAL KESELURUHAN (REG)',
    sSectionReg,
    regCalc
  );

  // Spacer rows between REG and SMV on the same sheet
  const spacer1 = sumAoa.length;
  sumAoa.push([]);
  sumAoa.push([]);
  rowHeights[spacer1] = 14;
  rowHeights[spacer1 + 1] = 14;

  // 2. SMV BELOW
  appendSummaryBlock(
    'BAGIAN 2 — HASIL PERHITUNGAN SMV (TANPA AUTOCUTTING · PROSES LAINNYA TETAP ADA)',
    'TOTAL KESELURUHAN (SMV)',
    sSectionSmv,
    smvCalc
  );

  const wsSummary = XLSX.utils.aoa_to_sheet(sumAoa);
  wsSummary['!merges'] = merges;
  wsSummary['!rows'] = sumAoa.map((_, rIdx) => (rowHeights[rIdx] ? { hpt: rowHeights[rIdx] } : {}));
  wsSummary['!cols'] = [
    { wch: 6 },
    { wch: 42 },
    { wch: 15 },
    { wch: 17 },
    { wch: 13 },
    { wch: 14 },
    { wch: 15 },
    { wch: 17 },
    { wch: 16 },
    { wch: 18 },
  ];

  rowStylesToApply.forEach(({ rowIdx, styles }) => {
    applyRowStyle(wsSummary, rowIdx, styles);
  });

  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary UMH');

  // DETAIL SUB-STEP SHEETS (REG & SMV)
  const usedSheetNames = new Set(['Summary UMH']);
  const appendDetailSheets = (variantTag: 'REG' | 'SMV', calc: CalculationVariant) => {
    calc.processes.forEach((it, procIdx) => {
      if (!it.subSteps || it.subSteps.length === 0) return;

      const stdVal = getAllowSecForMode(
        activeMode,
        it.baseSec,
        it.allowByProcessSec,
        it.allowByFinalSec
      );
      const procAllowSec = stdVal - it.baseSec;
      const effPctProc = it.baseSec > 0 ? (procAllowSec / it.baseSec) * 100 : 0;
      const procLabel = translateProcessName(it.processId, it.processName, it.jpName, lang);

      const prefix = variantTag === 'REG' ? `R${procIdx + 1}` : `S${procIdx + 1}`;
      const rawTab = `${prefix}.${procLabel
        .replace(/[\\/?*[\]:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()}`;
      let tabName = rawTab.slice(0, 31);
      let suffix = 2;
      while (usedSheetNames.has(tabName)) {
        const sfx = `_${suffix++}`;
        tabName = rawTab.slice(0, 31 - sfx.length) + sfx;
      }
      usedSheetNames.add(tabName);

      const subAoa: any[][] = [
        [
          `[${variantTag}] DETAIL SUB-STEP PROSES: ${procLabel.toUpperCase()}`,
          '', '', '', '', '', '', '', '', '', '', '', '',
        ],
        [
          `Assy: ${params.assyNo}  |  Master CCT: ${params.masterCct}  |  LOT: ${effectiveLot}  |  Base: ${it.baseSec.toFixed(2)}s  |  Allow Total: ${stdVal.toFixed(2)}s (+${procAllowSec.toFixed(2)}s / ${effPctProc.toFixed(1)}%)`,
          '', '', '', '', '', '', '', '', '', '', '', '',
        ],
        [],
        [
          'No',
          'Tahapan',
          'Rincian Sub-Step',
          'Basis Konversi',
          'Qty',
          'Rate (s)',
          'Base/STD Sec',
          'Allow Sec (Total)',
          '+Add Sec',
          'Base/STD Min',
          'Allow Min (Total)',
          'Base/STD Hour',
          'Allow Hour (Total)',
        ],
      ];

      it.subSteps.forEach((st, sIdx) => {
        const subStd = getAllowSecForMode(
          activeMode,
          st.baseSec,
          st.allowByProcessSec,
          st.allowByFinalSec
        );
        const subAllow = subStd - st.baseSec;

        subAoa.push([
          sIdx + 1,
          translateStage(st.stage, lang),
          translateSubStepName(st.name, lang),
          translateBasis(st.basis, lang),
          Number(Number(st.qty).toFixed(2)),
          Number(Number(st.rate).toFixed(4)),
          Number(st.baseSec.toFixed(3)),
          Number(subStd.toFixed(3)),
          Number(subAllow.toFixed(3)),
          Number((st.baseSec / 60).toFixed(4)),
          Number((subStd / 60).toFixed(4)),
          Number((st.baseSec / 3600).toFixed(6)),
          Number((subStd / 3600).toFixed(6)),
        ]);
      });

      subAoa.push([
        '',
        'SUBTOTAL PROSES',
        translateSummaryNote(it.summaryNote, lang),
        '',
        '',
        '',
        Number(it.baseSec.toFixed(3)),
        Number(stdVal.toFixed(3)),
        Number(procAllowSec.toFixed(3)),
        Number((it.baseSec / 60).toFixed(4)),
        Number((stdVal / 60).toFixed(4)),
        Number((it.baseSec / 3600).toFixed(6)),
        Number((stdVal / 3600).toFixed(6)),
      ]);

      const wsSub = XLSX.utils.aoa_to_sheet(subAoa);
      wsSub['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 12 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 12 } },
      ];
      wsSub['!rows'] = [{ hpt: 26 }, { hpt: 20 }, { hpt: 8 }, { hpt: 25 }];
      wsSub['!cols'] = [
        { wch: 5 },
        { wch: 20 },
        { wch: 44 },
        { wch: 22 },
        { wch: 10 },
        { wch: 11 },
        { wch: 14 },
        { wch: 17 },
        { wch: 12 },
        { wch: 14 },
        { wch: 17 },
        { wch: 15 },
        { wch: 18 },
      ];

      applyRowStyle(wsSub, 0, Array(13).fill(sBanner));
      applyRowStyle(
        wsSub,
        1,
        Array(13).fill(variantTag === 'REG' ? sSectionReg : sSectionSmv)
      );
      applyRowStyle(wsSub, 3, Array(13).fill(sTh));

      it.subSteps.forEach((_, sIdx) => {
        const rIdx = 4 + sIdx;
        const z = sIdx % 2 === 1;
        applyRowStyle(wsSub, rIdx, [
          sCellCenter(z),
          {
            ...sCellCenter(z),
            font: { name: 'Inter', sz: 9, bold: true, color: { rgb: '0062CC' } },
          },
          sCellText(z),
          sCellText(z, true),
          sCellNum('0.00', z),
          sCellNum('0.0000', z),
          sCellNum('0.000', z),
          sCellNum('0.000', z, true),
          sCellNum('+0.000;-0.000;0.000', z, true),
          sCellNum('0.0000', z),
          sCellNum('0.0000', z, true),
          sCellNum('0.000000', z),
          sCellNum('0.000000', z, true),
        ]);
      });

      const subTotIdx = 4 + it.subSteps.length;
      applyRowStyle(wsSub, subTotIdx, [
        sTotalCell(),
        sTotalCell(),
        sTotalCell(),
        sTotalCell(),
        sTotalCell(),
        sTotalCell(),
        sTotalCell('0.000', false),
        sTotalCell('0.000', true),
        sTotalCell('+0.000;-0.000;0.000', true),
        sTotalCell('0.0000', false),
        sTotalCell('0.0000', true),
        sTotalCell('0.000000', false),
        sTotalCell('0.000000', true),
      ]);

      XLSX.utils.book_append_sheet(wb, wsSub, tabName);
    });
  };

  appendDetailSheets('REG', regCalc);
  appendDetailSheets('SMV', smvCalc);

  const safeAssy = (params.assyNo || 'Assy').replace(/[^a-zA-Z0-9_-]/g, '_');
  XLSX.writeFile(wb, `STD_UMH_${safeAssy}.xlsx`);
}

function getActiveAllowSec(
  mode: AllowanceMode,
  baseSec: number,
  allowByProcessSec: number,
  allowByFinalSec: number
): number {
  return getAllowSecForMode(mode, baseSec, allowByProcessSec, allowByFinalSec);
}

function formatDateCompact(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || '-';
    return d.toLocaleString('id-ID', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso || '-';
  }
}

/**
 * Export all (or filtered) Database Assy records into a multi-sheet styled Excel workbook:
 *  - Sheet 1: Ringkasan Database Assy (final REG & SMV metrics + Average & Total rows)
 *  - Sheet 2: Breakdown Proses (REG) (consolidated 21-process table across all Assys)
 *  - Sheet 3: Breakdown Proses (SMV) (consolidated 21-process table across all Assys)
 *  - Per-Assy Sheets: Dedicated breakdown sheet per Assy (REG, SMV, and active sub-steps)
 */
export function exportDatabaseAssyExcel(
  records: AssyRecord[],
  lang: UiLang = 'id'
): void {
  if (records.length === 0) return;

  const wb = XLSX.utils.book_new();
  const exportDateStr = new Date().toLocaleString('id-ID', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  // =========================================================================
  // SHEET 1: RINGKASAN DATABASE ASSY (FINAL VALUES + AVERAGE / TOTAL)
  // =========================================================================
  const sumHeaders = [
    'No',
    'Assy Number',
    'Customer',
    'Metode Allowance',
    'PFD (%)',
    'Master CCT',
    'Sirkuit PPCS',
    'REG Std Sec (s)',
    'REG Allow Sec (s)',
    'REG Std Hour (hr)',
    'REG Allow Hour (hr)',
    'SMV Std Sec (s)',
    'SMV Allow Sec (s)',
    'SMV Std Hour (hr)',
    'SMV Allow Hour (hr)',
    'Selisih SMV-REG (hr)',
    'Diperbarui',
  ];

  const sumAoa: any[][] = [
    [
      'DATABASE ASSY — RINGKASAN STD / UMH WIRE HARNESS (REG & SMV)',
      ...Array(sumHeaders.length - 1).fill(''),
    ],
    [
      `Diekspor: ${exportDateStr}  |  Total Assy: ${records.length}  |  Mencakup Ringkasan Nilai Akhir + Breakdown Proses & Sub-Step`,
      ...Array(sumHeaders.length - 1).fill(''),
    ],
    [],
    sumHeaders,
  ];

  let totCct = 0;
  let totPpcs = 0;
  let totRegStdSec = 0;
  let totRegAllowSec = 0;
  let totSmvStdSec = 0;
  let totSmvAllowSec = 0;

  records.forEach((rec, idx) => {
    const regCalc = getVariantResult(rec, 'reg');
    const smvCalc = getVariantResult(rec, 'smv');
    const mode = rec.params.allowanceMode;

    const regStdSec = regCalc.totalBaseSec;
    const regAllowSec = getActiveAllowSec(
      mode,
      regCalc.totalBaseSec,
      regCalc.totalAllowByProcessSec,
      regCalc.totalAllowByFinalSec
    );
    const smvStdSec = smvCalc.totalBaseSec;
    const smvAllowSec = getActiveAllowSec(
      mode,
      smvCalc.totalBaseSec,
      smvCalc.totalAllowByProcessSec,
      smvCalc.totalAllowByFinalSec
    );

    const regStdHr = regStdSec / 3600;
    const regAllowHr = regAllowSec / 3600;
    const smvStdHr = smvStdSec / 3600;
    const smvAllowHr = smvAllowSec / 3600;
    const deltaHr = smvAllowHr - regAllowHr;

    totCct += rec.params.masterCct || 0;
    totPpcs += rec.ppcsList.length;
    totRegStdSec += regStdSec;
    totRegAllowSec += regAllowSec;
    totSmvStdSec += smvStdSec;
    totSmvAllowSec += smvAllowSec;

    sumAoa.push([
      idx + 1,
      rec.params.assyNo,
      rec.params.customer || '-',
      getAllowanceModeLabel(mode, 'short'),
      Number((mode === 'none' ? 0 : rec.params.pfdAllowancePct || 0).toFixed(1)),
      rec.params.masterCct || 0,
      rec.ppcsList.length,
      Number(regStdSec.toFixed(2)),
      Number(regAllowSec.toFixed(2)),
      Number(regStdHr.toFixed(4)),
      Number(regAllowHr.toFixed(4)),
      Number(smvStdSec.toFixed(2)),
      Number(smvAllowSec.toFixed(2)),
      Number(smvStdHr.toFixed(4)),
      Number(smvAllowHr.toFixed(4)),
      Number(deltaHr.toFixed(4)),
      formatDateCompact(rec.updatedAt),
    ]);
  });

  const count = records.length;
  const avgRowIdx = sumAoa.length;
  sumAoa.push([
    '',
    'RATA-RATA (AVERAGE)',
    `${count} Assy`,
    '',
    '',
    Number((totCct / count).toFixed(1)),
    Number((totPpcs / count).toFixed(1)),
    Number((totRegStdSec / count).toFixed(2)),
    Number((totRegAllowSec / count).toFixed(2)),
    Number((totRegStdSec / count / 3600).toFixed(4)),
    Number((totRegAllowSec / count / 3600).toFixed(4)),
    Number((totSmvStdSec / count).toFixed(2)),
    Number((totSmvAllowSec / count).toFixed(2)),
    Number((totSmvStdSec / count / 3600).toFixed(4)),
    Number((totSmvAllowSec / count / 3600).toFixed(4)),
    Number(((totSmvAllowSec - totRegAllowSec) / count / 3600).toFixed(4)),
    '',
  ]);

  const totRowIdx = sumAoa.length;
  sumAoa.push([
    '',
    'TOTAL KESELURUHAN',
    `${count} Assy`,
    '',
    '',
    totCct,
    totPpcs,
    Number(totRegStdSec.toFixed(2)),
    Number(totRegAllowSec.toFixed(2)),
    Number((totRegStdSec / 3600).toFixed(4)),
    Number((totRegAllowSec / 3600).toFixed(4)),
    Number(totSmvStdSec.toFixed(2)),
    Number(totSmvAllowSec.toFixed(2)),
    Number((totSmvStdSec / 3600).toFixed(4)),
    Number((totSmvAllowSec / 3600).toFixed(4)),
    Number(((totSmvAllowSec - totRegAllowSec) / 3600).toFixed(4)),
    '',
  ]);

  const wsSummary = XLSX.utils.aoa_to_sheet(sumAoa);
  wsSummary['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: sumHeaders.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: sumHeaders.length - 1 } },
  ];
  wsSummary['!rows'] = [
    { hpt: 28 },
    { hpt: 20 },
    { hpt: 8 },
    { hpt: 28 },
  ];
  wsSummary['!cols'] = [
    { wch: 5 },
    { wch: 22 },
    { wch: 16 },
    { wch: 16 },
    { wch: 9 },
    { wch: 11 },
    { wch: 12 },
    { wch: 15 },
    { wch: 16 },
    { wch: 16 },
    { wch: 17 },
    { wch: 15 },
    { wch: 16 },
    { wch: 16 },
    { wch: 17 },
    { wch: 18 },
    { wch: 18 },
  ];

  applyRowStyle(wsSummary, 0, Array(sumHeaders.length).fill(sBanner));
  applyRowStyle(wsSummary, 1, Array(sumHeaders.length).fill(sSubBanner));
  applyRowStyle(wsSummary, 3, Array(sumHeaders.length).fill(sTh));

  for (let i = 0; i < records.length; i++) {
    const rIdx = 4 + i;
    const z = i % 2 === 1;
    applyRowStyle(wsSummary, rIdx, [
      sCellCenter(z),
      { ...sCellText(z), font: { name: 'Inter', sz: 10, bold: true, color: { rgb: '0F172A' } } },
      sCellText(z),
      sCellCenter(z),
      sCellNum('0.0"%"', z),
      sCellNum('#,##0', z),
      sCellNum('#,##0', z),
      sCellNum('0.00', z),
      sCellNum('0.00', z, true),
      sCellNum('0.0000', z),
      sCellNum('0.0000', z, true),
      sCellNum('0.00', z),
      sCellNum('0.00', z, true),
      sCellNum('0.0000', z),
      sCellNum('0.0000', z, true),
      sCellNum('+0.0000;-0.0000;0.0000', z),
      sCellCenter(z, true),
    ]);
  }

  const summaryFooterStyles = (isAllowHighlight: boolean) => [
    sTotalCell(null, isAllowHighlight),
    sTotalCell(null, isAllowHighlight),
    sTotalCell(null, isAllowHighlight),
    sTotalCell(null, isAllowHighlight),
    sTotalCell(null, isAllowHighlight),
    sTotalCell('#,##0.0', isAllowHighlight),
    sTotalCell('#,##0.0', isAllowHighlight),
    sTotalCell('0.00', false),
    sTotalCell('0.00', true),
    sTotalCell('0.0000', false),
    sTotalCell('0.0000', true),
    sTotalCell('0.00', false),
    sTotalCell('0.00', true),
    sTotalCell('0.0000', false),
    sTotalCell('0.0000', true),
    sTotalCell('+0.0000;-0.0000;0.0000', isAllowHighlight),
    sTotalCell(null, isAllowHighlight),
  ];

  applyRowStyle(wsSummary, avgRowIdx, summaryFooterStyles(false));
  applyRowStyle(wsSummary, totRowIdx, summaryFooterStyles(true));
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Database Assy');

  // =========================================================================
  // SHEET 2 & 3: CONSOLIDATED PROCESS BREAKDOWN (REG & SMV) ACROSS ALL ASSYS
  // =========================================================================
  const buildConsolidatedBreakdownSheet = (variant: 'reg' | 'smv') => {
    const tag = variant === 'reg' ? 'REG' : 'SMV';
    const headers = [
      'Assy Number',
      'Customer',
      'Metode Allowance',
      'No Proses',
      'Item Proses',
      'Status',
      'Base/STD Sec (s)',
      'Allow Sec (s)',
      '+Add Sec (s)',
      'Base/STD Hour (hr)',
      'Allow Hour (hr)',
      'Kontribusi (%)',
      'Catatan Ringkas',
    ];

    const aoa: any[][] = [
      [
        `DETAIL BREAKDOWN PROSES SEMUA ASSY — VARIAN ${tag} (${
          variant === 'reg' ? 'NORMAL · AUTOCUTTING AKTIF' : 'TANPA AUTOCUTTING'
        })`,
        ...Array(headers.length - 1).fill(''),
      ],
      [
        `Total ${records.length} Assy  |  Diekspor: ${exportDateStr}`,
        ...Array(headers.length - 1).fill(''),
      ],
      [],
      headers,
    ];

    const rowStyles: { rowIdx: number; styles: any[] }[] = [
      { rowIdx: 0, styles: Array(headers.length).fill(sBanner) },
      {
        rowIdx: 1,
        styles: Array(headers.length).fill(variant === 'reg' ? sSectionReg : sSectionSmv),
      },
      { rowIdx: 3, styles: Array(headers.length).fill(sTh) },
    ];

    records.forEach((rec) => {
      const calc = getVariantResult(rec, variant);
      const mode = rec.params.allowanceMode;
      const totalAllowSec = getActiveAllowSec(
        mode,
        calc.totalBaseSec,
        calc.totalAllowByProcessSec,
        calc.totalAllowByFinalSec
      );
      const modeText = getAllowanceModeLabel(mode, 'short');

      calc.processes.forEach((proc, pIdx) => {
        const allowSec = getActiveAllowSec(
          mode,
          proc.baseSec,
          proc.allowByProcessSec,
          proc.allowByFinalSec
        );
        const addSec = allowSec - proc.baseSec;
        const sharePct = totalAllowSec > 0 ? (allowSec / totalAllowSec) * 100 : 0;
        const pName = translateProcessName(proc.processId, proc.processName, proc.jpName, lang);
        const rIdx = aoa.length;
        const muted = proc.baseSec === 0;
        const z = pIdx % 2 === 1;

        aoa.push([
          rec.params.assyNo,
          rec.params.customer || '-',
          modeText,
          proc.processId,
          pName,
          proc.active && proc.baseSec > 0 ? 'Aktif' : 'Nonaktif',
          Number(proc.baseSec.toFixed(2)),
          Number(allowSec.toFixed(2)),
          Number(addSec.toFixed(2)),
          Number((proc.baseSec / 3600).toFixed(4)),
          Number((allowSec / 3600).toFixed(4)),
          Number(sharePct.toFixed(1)),
          translateSummaryNote(proc.summaryNote, lang) || '-',
        ]);

        rowStyles.push({
          rowIdx: rIdx,
          styles: [
            {
              ...sCellText(z, muted),
              font: { name: 'Inter', sz: 10, bold: !muted, color: { rgb: muted ? '94A3B8' : '0F172A' } },
            },
            sCellText(z, muted),
            sCellCenter(z, muted),
            sCellCenter(z, muted),
            {
              ...sCellText(z, muted),
              font: { name: 'Inter', sz: 10, bold: !muted, color: { rgb: muted ? '94A3B8' : '0F172A' } },
            },
            sCellCenter(z, muted),
            sCellNum('0.00', z, false, muted),
            sCellNum('0.00', z, true, muted),
            sCellNum('+0.00;-0.00;0.00', z, true, muted),
            sCellNum('0.0000', z, false, muted),
            sCellNum('0.0000', z, true, muted),
            sCellNum('0.0"%"', z, false, muted),
            sCellText(z, muted),
          ],
        });
      });

      const subRowIdx = aoa.length;
      aoa.push([
        rec.params.assyNo,
        rec.params.customer || '-',
        modeText,
        '',
        `SUBTOTAL ${rec.params.assyNo} (${tag})`,
        `${rec.params.masterCct} CCT`,
        Number(calc.totalBaseSec.toFixed(2)),
        Number(totalAllowSec.toFixed(2)),
        Number((totalAllowSec - calc.totalBaseSec).toFixed(2)),
        Number((calc.totalBaseSec / 3600).toFixed(4)),
        Number((totalAllowSec / 3600).toFixed(4)),
        100,
        `PFD +${mode === 'none' ? 0 : rec.params.pfdAllowancePct || 0}%`,
      ]);
      rowStyles.push({
        rowIdx: subRowIdx,
        styles: [
          sTotalCell(),
          sTotalCell(),
          sTotalCell(),
          sTotalCell(),
          sTotalCell(),
          sTotalCell(),
          sTotalCell('0.00', false),
          sTotalCell('0.00', true),
          sTotalCell('+0.00;-0.00;0.00', true),
          sTotalCell('0.0000', false),
          sTotalCell('0.0000', true),
          sTotalCell('0.0"%"', true),
          sTotalCell(),
        ],
      });
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
    ];
    ws['!rows'] = [{ hpt: 26 }, { hpt: 20 }, { hpt: 8 }, { hpt: 26 }];
    ws['!cols'] = [
      { wch: 20 },
      { wch: 15 },
      { wch: 15 },
      { wch: 10 },
      { wch: 36 },
      { wch: 11 },
      { wch: 15 },
      { wch: 15 },
      { wch: 13 },
      { wch: 16 },
      { wch: 16 },
      { wch: 14 },
      { wch: 38 },
    ];
    rowStyles.forEach(({ rowIdx, styles }) => applyRowStyle(ws, rowIdx, styles));
    XLSX.utils.book_append_sheet(wb, ws, `Breakdown Proses (${tag})`);
  };

  buildConsolidatedBreakdownSheet('reg');
  buildConsolidatedBreakdownSheet('smv');

  // =========================================================================
  // PER-ASSY SHEETS: DEDICATED REG + SMV BREAKDOWN & ACTIVE SUB-STEPS
  // =========================================================================
  const usedSheetNames = new Set([
    'Ringkasan Database Assy',
    'Breakdown Proses (REG)',
    'Breakdown Proses (SMV)',
  ]);

  records.forEach((rec, recIdx) => {
    const mode = rec.params.allowanceMode;
    const regCalc = getVariantResult(rec, 'reg');
    const smvCalc = getVariantResult(rec, 'smv');

    const rawName = `${String(recIdx + 1).padStart(2, '0')}_${(rec.params.assyNo || 'Assy')
      .replace(/[\\/?*[\]:]/g, '_')
      .trim()}`;
    let tabName = rawName.slice(0, 31);
    let dupIdx = 2;
    while (usedSheetNames.has(tabName)) {
      const sfx = `_${dupIdx++}`;
      tabName = rawName.slice(0, 31 - sfx.length) + sfx;
    }
    usedSheetNames.add(tabName);

    const aoa: any[][] = [
      [`DETAIL PROSES ASSY: ${rec.params.assyNo}`, ...Array(9).fill('')],
      [
        `Customer: ${rec.params.customer || '-'}  |  CCT: ${rec.params.masterCct}  |  LOT: ${getEffectiveLot(rec.params.lot)}  |  PFD: +${
          mode === 'none' ? 0 : rec.params.pfdAllowancePct || 0
        }%  |  Metode: ${getAllowanceModeLabel(mode, 'short')}`,
        ...Array(9).fill(''),
      ],
      [],
    ];

    const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
    ];
    const stylesQueue: { rowIdx: number; styles: any[] }[] = [
      { rowIdx: 0, styles: Array(10).fill(sBanner) },
      { rowIdx: 1, styles: Array(10).fill(sSubBanner) },
    ];

    const appendAssyVariantTable = (
      title: string,
      totalLabel: string,
      bannerStyle: any,
      calc: CalculationVariant
    ) => {
      const secIdx = aoa.length;
      aoa.push([title, ...Array(9).fill('')]);
      merges.push({ s: { r: secIdx, c: 0 }, e: { r: secIdx, c: 9 } });
      stylesQueue.push({ rowIdx: secIdx, styles: Array(10).fill(bannerStyle) });

      const thIdx = aoa.length;
      aoa.push([
        'No',
        'Item Proses',
        'Base/STD Sec',
        'Allow Sec',
        '+Add Sec',
        'Eff. Allow (%)',
        'Base/STD Min',
        'Allow Min',
        'Base/STD Hour',
        'Allow Hour',
      ]);
      stylesQueue.push({ rowIdx: thIdx, styles: Array(10).fill(sTh) });

      calc.processes.forEach((it, pIdx) => {
        const allowSec = getActiveAllowSec(
          mode,
          it.baseSec,
          it.allowByProcessSec,
          it.allowByFinalSec
        );
        const addSec = allowSec - it.baseSec;
        const effPct = it.baseSec > 0 ? (addSec / it.baseSec) * 100 : 0;
        const pName = translateProcessName(it.processId, it.processName, it.jpName, lang);
        const rIdx = aoa.length;
        const z = pIdx % 2 === 1;
        const m = it.baseSec === 0;

        aoa.push([
          pIdx + 1,
          pName,
          Number(it.baseSec.toFixed(2)),
          Number(allowSec.toFixed(2)),
          Number(addSec.toFixed(2)),
          Number(effPct.toFixed(1)),
          Number((it.baseSec / 60).toFixed(2)),
          Number((allowSec / 60).toFixed(2)),
          Number((it.baseSec / 3600).toFixed(4)),
          Number((allowSec / 3600).toFixed(4)),
        ]);

        stylesQueue.push({
          rowIdx: rIdx,
          styles: [
            sCellCenter(z, m),
            {
              ...sCellText(z, m),
              font: { name: 'Inter', sz: 10, bold: !m, color: { rgb: m ? '94A3B8' : '0F172A' } },
            },
            sCellNum('0.00', z, false, m),
            sCellNum('0.00', z, true, m),
            sCellNum('+0.00;-0.00;0.00', z, true, m),
            sCellNum('0.0"%"', z, false, m),
            sCellNum('0.00', z, false, m),
            sCellNum('0.00', z, true, m),
            sCellNum('0.0000', z, false, m),
            sCellNum('0.0000', z, true, m),
          ],
        });
      });

      const totAllow = getActiveAllowSec(
        mode,
        calc.totalBaseSec,
        calc.totalAllowByProcessSec,
        calc.totalAllowByFinalSec
      );
      const tIdx = aoa.length;
      aoa.push([
        '',
        totalLabel,
        Number(calc.totalBaseSec.toFixed(2)),
        Number(totAllow.toFixed(2)),
        Number((totAllow - calc.totalBaseSec).toFixed(2)),
        Number((mode === 'none' ? 0 : rec.params.pfdAllowancePct || 0).toFixed(1)),
        Number((calc.totalBaseSec / 60).toFixed(2)),
        Number((totAllow / 60).toFixed(2)),
        Number((calc.totalBaseSec / 3600).toFixed(4)),
        Number((totAllow / 3600).toFixed(4)),
      ]);
      stylesQueue.push({
        rowIdx: tIdx,
        styles: [
          sTotalCell(),
          sTotalCell(),
          sTotalCell('0.00', false),
          sTotalCell('0.00', true),
          sTotalCell('+0.00;-0.00;0.00', true),
          sTotalCell('0.0"%"', true),
          sTotalCell('0.00', false),
          sTotalCell('0.00', true),
          sTotalCell('0.0000', false),
          sTotalCell('0.0000', true),
        ],
      });
    };

    appendAssyVariantTable(
      'BAGIAN 1 — BREAKDOWN 21 PROSES (REG · NORMAL)',
      'TOTAL KESELURUHAN (REG)',
      sSectionReg,
      regCalc
    );
    aoa.push([]);
    appendAssyVariantTable(
      'BAGIAN 2 — BREAKDOWN 21 PROSES (SMV · TANPA AUTOCUTTING)',
      'TOTAL KESELURUHAN (SMV)',
      sSectionSmv,
      smvCalc
    );

    // BAGIAN 3 — ACTIVE SUB-STEPS DETAIL (REG)
    const activeSubRows: any[][] = [];
    regCalc.processes.forEach((proc) => {
      if (!proc.subSteps || proc.subSteps.length === 0) return;
      const pName = translateProcessName(proc.processId, proc.processName, proc.jpName, lang);
      proc.subSteps.forEach((st) => {
        if (st.baseSec <= 0 && st.qty <= 0) return;
        const allowSec = getActiveAllowSec(
          mode,
          st.baseSec,
          st.allowByProcessSec,
          st.allowByFinalSec
        );
        activeSubRows.push([
          proc.processId,
          pName,
          translateStage(st.stage, lang),
          translateSubStepName(st.name, lang),
          translateBasis(st.basis, lang),
          Number(Number(st.qty).toFixed(2)),
          Number(Number(st.rate).toFixed(4)),
          Number(st.baseSec.toFixed(3)),
          Number(allowSec.toFixed(3)),
          Number((allowSec / 3600).toFixed(6)),
        ]);
      });
    });

    if (activeSubRows.length > 0) {
      aoa.push([]);
      const subBannerIdx = aoa.length;
      aoa.push(['BAGIAN 3 — RINCIAN SUB-STEP AKTIF (REG)', ...Array(9).fill('')]);
      merges.push({ s: { r: subBannerIdx, c: 0 }, e: { r: subBannerIdx, c: 9 } });
      stylesQueue.push({ rowIdx: subBannerIdx, styles: Array(10).fill(sBanner) });

      const subThIdx = aoa.length;
      aoa.push([
        'ID',
        'Proses',
        'Tahapan',
        'Rincian Sub-Step',
        'Basis',
        'Qty',
        'Rate (s)',
        'Base Sec',
        'Allow Sec',
        'Allow Hour',
      ]);
      stylesQueue.push({ rowIdx: subThIdx, styles: Array(10).fill(sTh) });

      activeSubRows.forEach((rowVals, idx) => {
        const rIdx = aoa.length;
        const z = idx % 2 === 1;
        aoa.push(rowVals);
        stylesQueue.push({
          rowIdx: rIdx,
          styles: [
            sCellCenter(z),
            sCellText(z),
            sCellCenter(z),
            sCellText(z),
            sCellText(z, true),
            sCellNum('0.00', z),
            sCellNum('0.0000', z),
            sCellNum('0.000', z),
            sCellNum('0.000', z, true),
            sCellNum('0.000000', z, true),
          ],
        });
      });
    }

    const wsAssy = XLSX.utils.aoa_to_sheet(aoa);
    wsAssy['!merges'] = merges;
    wsAssy['!cols'] = [
      { wch: 6 },
      { wch: 36 },
      { wch: 15 },
      { wch: 34 },
      { wch: 18 },
      { wch: 12 },
      { wch: 14 },
      { wch: 14 },
      { wch: 15 },
      { wch: 16 },
    ];
    stylesQueue.forEach(({ rowIdx, styles }) => applyRowStyle(wsAssy, rowIdx, styles));
    XLSX.utils.book_append_sheet(wb, wsAssy, tabName);
  });

  const dateStamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Database_Assy_UMH_Lengkap_${dateStamp}.xlsx`);
}

