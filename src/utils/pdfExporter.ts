import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { resolveDifficultyPercentage } from '../data/cotMasterV2';
import {
  buildExportRecordForMode,
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
} from './umhTranslator';

export type PdfLayoutMode = 'summary' | 'detailed';

/**
 * Standard PDF Type1 Helvetica supports WinAnsi (Latin-1) only.
 * Sanitize non-WinAnsi symbols (e.g. ★, —, ×, ≤, ≥) so PDFs never display garbled glyphs.
 */
function sanitizePdfText(input: string): string {
  return input
    .replace(/★/g, '*')
    .replace(/[—–]/g, '-')
    .replace(/·/g, '|')
    .replace(/×/g, 'x')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

function getSafePdfLang(lang: UiLang): 'id' | 'en' {
  // Built-in jsPDF Helvetica cannot render Japanese kanji; gracefully fall back to EN
  return lang === 'id' ? 'id' : 'en';
}

function getModeTitle(mode: AllowanceMode, effPct: number, lang: 'id' | 'en'): string {
  if (mode === 'none') {
    return lang === 'en' ? '0. No Allowance (Base 0%)' : '0. Tanpa Allowance (Base 0%)';
  }
  if (mode === 'by_process') {
    return lang === 'en'
      ? `1. Allowance By Process (+${effPct}%)`
      : `1. Allowance By Proses (+${effPct}%)`;
  }
  return lang === 'en'
    ? `2. Allowance By Final Result (+${effPct}%)`
    : `2. Allowance By Hasil Akhir (+${effPct}%)`;
}

function formatReportDate(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const valid = Number.isNaN(d.getTime()) ? new Date() : d;
  return valid.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function drawFooter(
  doc: jsPDF,
  leftText: string,
  rightText: string
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.25);
  doc.line(9, pageHeight - 9.5, pageWidth - 9, pageHeight - 9.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(100, 116, 139);
  doc.text(sanitizePdfText(leftText), 9, pageHeight - 5.5);
  doc.text(sanitizePdfText(rightText), pageWidth - 9, pageHeight - 5.5, { align: 'right' });
}

/**
 * Renders ONE compact A4 Landscape Daily Summary Report page for a single Assy:
 * - Header Banner (Daily Report Title, Assy No, Customer, CCT, PPCS, LOT, Mode, Difficulty)
 * - 4 KPI Cards (REG Base, REG Standard UMH, SMV Base, SMV Standard UMH)
 * - Full 21-Process Recapitulation Table (REG & SMV Sec/Min/Hour + Share %) + Grand Total
 */
export function renderSummaryAssyPage(
  doc: jsPDF,
  record: AssyRecord,
  mode: AllowanceMode,
  lang: UiLang = 'id',
  difficultyMatrix?: number[][],
  assyIndex = 1,
  totalAssys = 1
): void {
  const pdfLang = getSafePdfLang(lang);
  const { params } = record;
  const effectiveLot = getEffectiveLot(params.lot);
  const effPct = mode === 'none' ? 0 : params.pfdAllowancePct || 0;
  const difficultyRating = params.difficultyRating ?? 0;
  const difficultyPct =
    record.calculation.difficultyPct !== undefined
      ? record.calculation.difficultyPct
      : resolveDifficultyPercentage(difficultyRating, difficultyMatrix);

  const regCalc = getVariantResult(record, 'reg');
  const smvCalc = getVariantResult(record, 'smv');

  const regAllowTotal = getAllowSecForMode(
    mode,
    regCalc.totalBaseSec,
    regCalc.totalAllowByProcessSec,
    regCalc.totalAllowByFinalSec
  );
  const smvAllowTotal = getAllowSecForMode(
    mode,
    smvCalc.totalBaseSec,
    smvCalc.totalAllowByProcessSec,
    smvCalc.totalAllowByFinalSec
  );
  const deltaSmvRegSec = smvAllowTotal - regAllowTotal;

  const pageWidth = doc.internal.pageSize.getWidth(); // 297mm
  const marginX = 9;
  const contentW = pageWidth - marginX * 2; // 279mm

  // 1. HEADER BANNER (y: 8 -> 26)
  doc.setFillColor(15, 23, 42); // slate-900
  doc.roundedRect(marginX, 8, contentW, 18.5, 2, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(147, 197, 253); // blue-300
  doc.text(
    pdfLang === 'en'
      ? 'DAILY CALCULATION SUMMARY REPORT - STD / UMH WIRE HARNESS (21 PROCESSES)'
      : 'LAPORAN HARIAN HASIL KALKULASI STD / UMH WIRE HARNESS (SUMMARY VIEW - 21 PROSES)',
    marginX + 4,
    13
  );

  doc.setFontSize(13.5);
  doc.setTextColor(255, 255, 255);
  doc.text(sanitizePdfText(`ASSY ${params.assyNo}`), marginX + 4, 19.2);

  const diffBadgeStr =
    difficultyRating > 0
      ? ` | Kesulitan: ${difficultyRating.toFixed(1)}/5.0 (+${difficultyPct.toFixed(2)}%)`
      : '';
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.6);
  doc.setTextColor(226, 232, 240);
  doc.text(
    sanitizePdfText(
      `Customer: ${params.customer || '-'} | ${getModeTitle(mode, effPct, pdfLang)} | LOT: ${effectiveLot}${diffBadgeStr}`
    ),
    marginX + 4,
    24
  );

  // Right metadata inside banner
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(226, 232, 240);
  doc.text(
    sanitizePdfText(`Tanggal Cetak: ${formatReportDate()}`),
    pageWidth - marginX - 4,
    13.2,
    { align: 'right' }
  );
  doc.text(
    sanitizePdfText(`Master CCT: ${params.masterCct} CCT | Sirkuit PPCS: ${record.ppcsList.length}`),
    pageWidth - marginX - 4,
    18.3,
    { align: 'right' }
  );
  doc.text(
    sanitizePdfText(`Diperbarui: ${formatReportDate(record.updatedAt)}`),
    pageWidth - marginX - 4,
    23.4,
    { align: 'right' }
  );

  // 2. 4 COMPACT KPI CARDS (y: 28.5 -> 42.5)
  const kpiY = 28.8;
  const kpiH = 13.5;
  const kpiGap = 3;
  const kpiW = (contentW - kpiGap * 3) / 4;

  const kpiCards = [
    {
      label: 'REG Base Cycle (0%)',
      main: `${regCalc.totalBaseSec.toFixed(2)} sec`,
      sub: `${(regCalc.totalBaseSec / 60).toFixed(2)} min | ${(regCalc.totalBaseSec / 3600).toFixed(4)} hr`,
      bg: [248, 250, 252] as [number, number, number],
      border: [203, 213, 225] as [number, number, number],
      titleColor: [71, 85, 105] as [number, number, number],
      valColor: [15, 23, 42] as [number, number, number],
    },
    {
      label: `REG Standard UMH (+${effPct}%)`,
      main: `${regAllowTotal.toFixed(2)} sec`,
      sub: `${(regAllowTotal / 60).toFixed(2)} min | ${(regAllowTotal / 3600).toFixed(4)} hr`,
      bg: [239, 246, 255] as [number, number, number],
      border: [147, 197, 253] as [number, number, number],
      titleColor: [30, 58, 138] as [number, number, number],
      valColor: [30, 58, 138] as [number, number, number],
    },
    {
      label: 'SMV Base Cycle (0% · No AutoCut)',
      main: `${smvCalc.totalBaseSec.toFixed(2)} sec`,
      sub: `${(smvCalc.totalBaseSec / 60).toFixed(2)} min | ${(smvCalc.totalBaseSec / 3600).toFixed(4)} hr`,
      bg: [248, 250, 252] as [number, number, number],
      border: [203, 213, 225] as [number, number, number],
      titleColor: [71, 85, 105] as [number, number, number],
      valColor: [15, 23, 42] as [number, number, number],
    },
    {
      label: `SMV Standard UMH (vs REG ${deltaSmvRegSec >= 0 ? '+' : ''}${deltaSmvRegSec.toFixed(1)}s)`,
      main: `${smvAllowTotal.toFixed(2)} sec`,
      sub: `${(smvAllowTotal / 60).toFixed(2)} min | ${(smvAllowTotal / 3600).toFixed(4)} hr`,
      bg: [236, 253, 245] as [number, number, number],
      border: [110, 231, 183] as [number, number, number],
      titleColor: [6, 95, 70] as [number, number, number],
      valColor: [4, 120, 87] as [number, number, number],
    },
  ];

  kpiCards.forEach((card, idx) => {
    const cx = marginX + idx * (kpiW + kpiGap);
    doc.setFillColor(...card.bg);
    doc.setDrawColor(...card.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, kpiY, kpiW, kpiH, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(...card.titleColor);
    doc.text(sanitizePdfText(card.label), cx + 3, kpiY + 4);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...card.valColor);
    doc.text(sanitizePdfText(card.main), cx + 3, kpiY + 8.9);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(100, 116, 139);
    doc.text(sanitizePdfText(card.sub), cx + 3, kpiY + 12.1);
  });

  // 3. SECTION HEADING
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    pdfLang === 'en'
      ? 'Recapitulation Table - 21 Wire Harness Manufacturing Processes (REG & SMV)'
      : 'Tabel Rekapitulasi 21 Item Proses Manufaktur Wire Harness (REG & SMV)',
    marginX,
    47.2
  );

  // 4. 21-PROCESS RECAP TABLE (fits cleanly on 1 A4 Landscape page)
  const smvById = new Map(smvCalc.processes.map((p) => [p.processId, p]));

  const bodyRows = regCalc.processes.map((regProc) => {
    const smvProc = smvById.get(regProc.processId);
    const regAllow = getAllowSecForMode(
      mode,
      regProc.baseSec,
      regProc.allowByProcessSec,
      regProc.allowByFinalSec
    );
    const smvBase = smvProc ? smvProc.baseSec : 0;
    const smvAllow = smvProc
      ? getAllowSecForMode(
          mode,
          smvProc.baseSec,
          smvProc.allowByProcessSec,
          smvProc.allowByFinalSec
        )
      : 0;
    const sharePct = regAllowTotal > 0 ? (regAllow / regAllowTotal) * 100 : 0;
    const procName = sanitizePdfText(
      translateProcessName(regProc.processId, regProc.processName, regProc.jpName, pdfLang)
    );

    return [
      String(regProc.processId),
      procName,
      regProc.baseSec.toFixed(2),
      regAllow.toFixed(2),
      (regAllow / 60).toFixed(3),
      (regAllow / 3600).toFixed(4),
      smvBase.toFixed(2),
      smvAllow.toFixed(2),
      (smvAllow / 60).toFixed(3),
      (smvAllow / 3600).toFixed(4),
      `${sharePct.toFixed(1)}%`,
    ];
  });

  const footRow = [
    '',
    pdfLang === 'en' ? 'GRAND TOTAL (21 PROCESSES)' : 'GRAND TOTAL (21 PROSES)',
    regCalc.totalBaseSec.toFixed(2),
    regAllowTotal.toFixed(2),
    (regAllowTotal / 60).toFixed(3),
    (regAllowTotal / 3600).toFixed(4),
    smvCalc.totalBaseSec.toFixed(2),
    smvAllowTotal.toFixed(2),
    (smvAllowTotal / 60).toFixed(3),
    (smvAllowTotal / 3600).toFixed(4),
    '100.0%',
  ];

  autoTable(doc, {
    startY: 49.2,
    margin: { left: marginX, right: marginX, bottom: 11 },
    head: [
      [
        'No',
        pdfLang === 'en' ? 'Process Item (21 Processes)' : 'Item Proses (21 Proses)',
        'REG Base (s)',
        'REG Allow (s)',
        'REG Allow (m)',
        'REG Allow (hr)',
        'SMV Base (s)',
        'SMV Allow (s)',
        'SMV Allow (m)',
        'SMV Allow (hr)',
        'Share REG',
      ],
    ],
    body: bodyRows,
    foot: [footRow],
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 7.4,
      cellPadding: { top: 1.35, bottom: 1.35, left: 2, right: 2 },
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      textColor: [15, 23, 42],
      valign: 'middle',
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.3,
      halign: 'right',
      cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
    },
    footStyles: {
      fillColor: [226, 232, 240],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      fontSize: 7.6,
      halign: 'right',
      lineColor: [148, 163, 184],
      lineWidth: 0.35,
      cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 9.5, halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: 66.5, halign: 'left' },
      2: { cellWidth: 21.5, halign: 'right' },
      3: { cellWidth: 22.5, halign: 'right', fontStyle: 'bold', textColor: [30, 58, 138] },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 24, halign: 'right', fontStyle: 'bold', textColor: [30, 58, 138] },
      6: { cellWidth: 21.5, halign: 'right' },
      7: { cellWidth: 22.5, halign: 'right', fontStyle: 'bold', textColor: [4, 120, 87] },
      8: { cellWidth: 22, halign: 'right' },
      9: { cellWidth: 24, halign: 'right', fontStyle: 'bold', textColor: [4, 120, 87] },
      10: { cellWidth: 23, halign: 'right', textColor: [71, 85, 105] },
    },
    didParseCell: (hookData) => {
      if (hookData.section === 'head') {
        if (hookData.column.index === 0) hookData.cell.styles.halign = 'center';
        if (hookData.column.index === 1) hookData.cell.styles.halign = 'left';
        if (hookData.column.index >= 2 && hookData.column.index <= 5) {
          hookData.cell.styles.fillColor = [30, 58, 138]; // REG indigo
        }
        if (hookData.column.index >= 6 && hookData.column.index <= 9) {
          hookData.cell.styles.fillColor = [6, 78, 59]; // SMV emerald
        }
      }
      if (hookData.section === 'foot') {
        if (hookData.column.index === 1) hookData.cell.styles.halign = 'left';
        if (hookData.column.index === 3 || hookData.column.index === 5) {
          hookData.cell.styles.textColor = [30, 58, 138];
        }
        if (hookData.column.index === 7 || hookData.column.index === 9) {
          hookData.cell.styles.textColor = [4, 120, 87];
        }
      }
      if (hookData.section === 'body') {
        const proc = regCalc.processes[hookData.row.index];
        if (proc && proc.baseSec === 0) {
          hookData.cell.styles.textColor = [148, 163, 184];
          hookData.cell.styles.fontStyle = 'normal';
        }
      }
    },
  });

  drawFooter(
    doc,
    `STD / UMH Wire Harness Studio | Laporan Harian Ringkas (Summary View) | Assy ${params.assyNo}`,
    totalAssys > 1
      ? `Assy ${assyIndex} dari ${totalAssys}`
      : `Halaman 1 / 1`
  );
}

/**
 * Renders Full Detailed PDF pages (REG 21-process table + active sub-steps, then SMV 21-process table + active sub-steps).
 */
export function renderDetailedAssyPages(
  doc: jsPDF,
  record: AssyRecord,
  mode: AllowanceMode,
  lang: UiLang = 'id',
  difficultyMatrix?: number[][]
): void {
  const pdfLang = getSafePdfLang(lang);
  const { params } = record;
  const effectiveLot = getEffectiveLot(params.lot);
  const effPct = mode === 'none' ? 0 : params.pfdAllowancePct || 0;
  const difficultyRating = params.difficultyRating ?? 0;
  const difficultyPct =
    record.calculation.difficultyPct !== undefined
      ? record.calculation.difficultyPct
      : resolveDifficultyPercentage(difficultyRating, difficultyMatrix);

  const regCalc = getVariantResult(record, 'reg');
  const smvCalc = getVariantResult(record, 'smv');
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 9;
  const contentW = pageWidth - marginX * 2;

  const renderVariant = (
    variantKey: 'reg' | 'smv',
    calc: CalculationVariant,
    isSecond: boolean
  ) => {
    if (isSecond) doc.addPage();

    const totalAllowSec = getAllowSecForMode(
      mode,
      calc.totalBaseSec,
      calc.totalAllowByProcessSec,
      calc.totalAllowByFinalSec
    );
    const headerFill: [number, number, number] =
      variantKey === 'reg' ? [15, 23, 42] : [6, 78, 59];

    doc.setFillColor(...headerFill);
    doc.roundedRect(marginX, 8, contentW, 17, 2, 2, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(203, 213, 225);
    doc.text(
      variantKey === 'reg'
        ? 'BAGIAN 1 - REG (PERHITUNGAN NORMAL | AUTOCUTTING AKTIF)'
        : 'BAGIAN 2 - SMV (TANPA AUTOCUTTING | PROSES LAINNYA TETAP ADA)',
      marginX + 4,
      12.8
    );

    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text(sanitizePdfText(`ASSY ${params.assyNo}`), marginX + 4, 18.8);

    const diffStr =
      difficultyRating > 0
        ? ` | Kesulitan: ${difficultyRating.toFixed(1)}/5.0 (+${difficultyPct.toFixed(2)}%)`
        : '';
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(226, 232, 240);
    doc.text(
      sanitizePdfText(
        `Customer: ${params.customer || '-'} | ${getModeTitle(mode, effPct, pdfLang)} | LOT: ${effectiveLot}${diffStr}`
      ),
      marginX + 4,
      23.2
    );

    doc.text(
      sanitizePdfText(`Tanggal: ${formatReportDate()} | ${params.masterCct} CCT | ${record.ppcsList.length} PPCS`),
      pageWidth - marginX - 4,
      14,
      { align: 'right' }
    );
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(
      sanitizePdfText(
        `Total ${variantKey.toUpperCase()}: ${totalAllowSec.toFixed(2)}s (${(totalAllowSec / 3600).toFixed(4)} hr)`
      ),
      pageWidth - marginX - 4,
      21.5,
      { align: 'right' }
    );

    // 21-process summary table
    autoTable(doc, {
      startY: 28,
      margin: { left: marginX, right: marginX, bottom: 12 },
      head: [
        [
          'No',
          pdfLang === 'en' ? 'Manufacturing Process' : 'Proses Manufaktur',
          'Base Sec',
          'Allow Sec',
          'Base Min',
          'Allow Min',
          'Base Hour',
          'Allow Hour',
        ],
      ],
      body: calc.processes.map((proc) => {
        const allowSec = getAllowSecForMode(
          mode,
          proc.baseSec,
          proc.allowByProcessSec,
          proc.allowByFinalSec
        );
        return [
          String(proc.processId),
          sanitizePdfText(
            translateProcessName(proc.processId, proc.processName, proc.jpName, pdfLang)
          ),
          proc.baseSec.toFixed(3),
          allowSec.toFixed(3),
          (proc.baseSec / 60).toFixed(4),
          (allowSec / 60).toFixed(4),
          (proc.baseSec / 3600).toFixed(6),
          (allowSec / 3600).toFixed(6),
        ];
      }),
      foot: [
        [
          '',
          `GRAND TOTAL UMH (${variantKey.toUpperCase()})`,
          calc.totalBaseSec.toFixed(3),
          totalAllowSec.toFixed(3),
          (calc.totalBaseSec / 60).toFixed(4),
          (totalAllowSec / 60).toFixed(4),
          (calc.totalBaseSec / 3600).toFixed(6),
          (totalAllowSec / 3600).toFixed(6),
        ],
      ],
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 7.5,
        cellPadding: { top: 1.4, bottom: 1.4, left: 2.2, right: 2.2 },
        lineColor: [226, 232, 240],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: variantKey === 'reg' ? [30, 58, 138] : [6, 78, 59],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'right',
      },
      footStyles: {
        fillColor: [226, 232, 240],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
        halign: 'right',
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 11, halign: 'center' },
        1: { cellWidth: 94, halign: 'left' },
        2: { halign: 'right' },
        3: { halign: 'right', fontStyle: 'bold', textColor: [4, 120, 87] },
        4: { halign: 'right' },
        5: { halign: 'right', fontStyle: 'bold', textColor: [4, 120, 87] },
        6: { halign: 'right' },
        7: { halign: 'right', fontStyle: 'bold', textColor: [4, 120, 87] },
      },
      didParseCell: (data) => {
        if (data.section === 'head' || data.section === 'foot') {
          if (data.column.index === 0) data.cell.styles.halign = 'center';
          if (data.column.index === 1) data.cell.styles.halign = 'left';
        }
      },
    });

    // Active sub-steps table on new page
    const activeProcs = calc.processes.filter((p) => p.active && p.subSteps.length > 0);
    if (activeProcs.length > 0) {
      doc.addPage();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text(
        sanitizePdfText(
          `[${variantKey.toUpperCase()}] Rincian Sub-Step Proses Aktif - ASSY ${params.assyNo} (${activeProcs.length} Proses)`
        ),
        marginX,
        13
      );

      const subRows: string[][] = [];
      activeProcs.forEach((proc) => {
        const procName = sanitizePdfText(
          `${proc.processId}. ${translateProcessName(proc.processId, proc.processName, proc.jpName, pdfLang)}`
        );
        proc.subSteps.forEach((sub) => {
          const subAllow = getAllowSecForMode(
            mode,
            sub.baseSec,
            sub.allowByProcessSec,
            sub.allowByFinalSec
          );
          subRows.push([
            procName,
            sanitizePdfText(translateStage(sub.stage, pdfLang)),
            sanitizePdfText(translateSubStepName(sub.name, pdfLang)),
            sanitizePdfText(translateBasis(sub.basis, pdfLang)),
            Number.isInteger(sub.qty) ? String(sub.qty) : sub.qty.toFixed(2),
            sub.rate.toFixed(3),
            sub.baseSec.toFixed(3),
            subAllow.toFixed(3),
            (subAllow / 3600).toFixed(6),
          ]);
        });
      });

      autoTable(doc, {
        startY: 16.5,
        margin: { left: marginX, right: marginX, bottom: 12 },
        head: [
          [
            'Proses',
            'Tahap',
            'Rincian Sub-Step',
            'Basis',
            'Qty',
            'Rate (s)',
            'Base Sec',
            'Allow Sec',
            'Allow Hour',
          ],
        ],
        body: subRows,
        theme: 'grid',
        styles: {
          font: 'helvetica',
          fontSize: 6.9,
          cellPadding: { top: 1.3, bottom: 1.3, left: 1.8, right: 1.8 },
          lineColor: [226, 232, 240],
          lineWidth: 0.2,
        },
        headStyles: {
          fillColor: variantKey === 'reg' ? [30, 58, 138] : [6, 78, 59],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 40, fontStyle: 'bold' },
          1: { cellWidth: 26 },
          2: { cellWidth: 80 },
          3: { cellWidth: 32 },
          4: { cellWidth: 18, halign: 'right' },
          5: { cellWidth: 18, halign: 'right' },
          6: { cellWidth: 20, halign: 'right' },
          7: { cellWidth: 22, halign: 'right', fontStyle: 'bold', textColor: [4, 120, 87] },
          8: { cellWidth: 23, halign: 'right', fontStyle: 'bold', textColor: [4, 120, 87] },
        },
      });
    }
  };

  renderVariant('reg', regCalc, false);
  renderVariant('smv', smvCalc, true);

  // Page numbers across all generated pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(
      doc,
      `STD / UMH Wire Harness Studio | Laporan Lengkap (REG & SMV) | Assy ${params.assyNo}`,
      `Halaman ${i} / ${totalPages}`
    );
  }
}

/**
 * Generates a standalone single-Assy PDF binary Uint8Array (for direct download or ZIP batch export).
 */
export function buildSingleAssyPdfBuffer(
  record: AssyRecord,
  mode: AllowanceMode,
  layout: PdfLayoutMode = 'summary',
  lang: UiLang = 'id',
  difficultyMatrix?: number[][]
): Uint8Array {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  if (layout === 'summary') {
    renderSummaryAssyPage(doc, record, mode, lang, difficultyMatrix, 1, 1);
  } else {
    renderDetailedAssyPages(doc, record, mode, lang, difficultyMatrix);
  }

  const arrayBuffer = doc.output('arraybuffer');
  return new Uint8Array(arrayBuffer);
}

/**
 * Directly downloads a single Assy PDF file (.pdf).
 */
export function exportSingleAssyPdf(
  record: AssyRecord,
  mode: AllowanceMode,
  layout: PdfLayoutMode = 'summary',
  lang: UiLang = 'id',
  difficultyMatrix?: number[][]
): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  if (layout === 'summary') {
    renderSummaryAssyPage(doc, record, mode, lang, difficultyMatrix, 1, 1);
  } else {
    renderDetailedAssyPages(doc, record, mode, lang, difficultyMatrix);
  }

  const safeAssy = (record.params.assyNo || 'Assy').replace(/[^a-zA-Z0-9_-]/g, '_');
  const suffix = layout === 'summary' ? 'Summary_21Proses' : 'Lengkap';
  doc.save(`STD_UMH_${safeAssy}_${suffix}.pdf`);
}

/**
 * Directly downloads a consolidated Daily Summary PDF (1 compact page of 21 processes per Assy).
 */
export function exportDailySummaryPdf(
  records: AssyRecord[],
  lang: UiLang = 'id',
  difficultyMatrix?: number[][],
  allowanceStrategy: 'per_assy' | AllowanceMode = 'per_assy',
  overridePct?: number
): void {
  if (records.length === 0) return;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  records.forEach((rawRec, idx) => {
    if (idx > 0) doc.addPage();
    const effectiveMode =
      allowanceStrategy === 'per_assy' ? rawRec.params.allowanceMode : allowanceStrategy;
    const preparedRec =
      allowanceStrategy === 'per_assy'
        ? rawRec
        : buildExportRecordForMode(rawRec, effectiveMode, overridePct);

    renderSummaryAssyPage(
      doc,
      preparedRec,
      effectiveMode,
      lang,
      difficultyMatrix,
      idx + 1,
      records.length
    );
  });

  const dateStamp = new Date().toISOString().slice(0, 10);
  doc.save(`Laporan_Harian_UMH_Summary_${records.length}Assy_${dateStamp}.pdf`);
}
