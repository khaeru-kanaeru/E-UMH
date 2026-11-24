import XLSX from 'xlsx-js-style';
import {
  MasterChangeDiffItem,
  MasterChangeHistoryEntry,
  StdDatabase,
} from '../types/umh';
import {
  MASTER_CATEGORY_LABELS,
  MASTER_SOURCE_LABELS,
  MATRIX_CONFIGS,
  computeStdMatricesDiff,
  computeStdParamsDiff,
} from './masterDiffEngine';

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 },
  fill: { fgColor: { rgb: '1E3A8A' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: {
    top: { style: 'thin', color: { rgb: '1E3A8A' } },
    bottom: { style: 'thin', color: { rgb: '1E3A8A' } },
    left: { style: 'thin', color: { rgb: '3B5998' } },
    right: { style: 'thin', color: { rgb: '3B5998' } },
  },
};

const CELL_BORDER = {
  top: { style: 'thin', color: { rgb: 'E2E8F0' } },
  bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
  left: { style: 'thin', color: { rgb: 'E2E8F0' } },
  right: { style: 'thin', color: { rgb: 'E2E8F0' } },
};

const EDITABLE_NUM_STYLE = {
  font: { bold: true, color: { rgb: '1E3A8A' }, sz: 10 },
  fill: { fgColor: { rgb: 'EFF6FF' } },
  alignment: { horizontal: 'right', vertical: 'center' },
  border: CELL_BORDER,
};

function styleSheetHeader(ws: Record<string, any>, colCount: number, headerRowIdx = 0) {
  for (let c = 0; c < colCount; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRowIdx, c });
    if (ws[addr]) {
      ws[addr].s = HEADER_STYLE;
    }
  }
}

/**
 * Downloads a multi-sheet editable XLSX template containing all Sub-Step STD Parameters
 * and all 4 2D Lookup Matrices (Autocutting, Semi-Auto, Manual, COT Master_COT_V2) pre-filled with current values.
 */
export function exportStdParamsTemplateXlsx(stdDb: StdDatabase): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Parameter Sub-Step
  const paramRows: (string | number)[][] = [
    ['ID', 'Sheet Proses', 'Tahapan', 'Sub-Step / Keterangan', 'Basis Pembagi', 'Time / Coeff'],
  ];
  stdDb.params.forEach((p) => {
    paramRows.push([p.id, p.sheet, p.stage, p.name, p.basis, p.val]);
  });

  const wsParams = XLSX.utils.aoa_to_sheet(paramRows);
  wsParams['!cols'] = [
    { wch: 24 },
    { wch: 26 },
    { wch: 16 },
    { wch: 46 },
    { wch: 22 },
    { wch: 16 },
  ];
  styleSheetHeader(wsParams, 6, 0);
  for (let r = 1; r < paramRows.length; r++) {
    for (let c = 0; c < 6; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!wsParams[addr]) continue;
      wsParams[addr].s =
        c === 5
          ? EDITABLE_NUM_STYLE
          : {
              font: { sz: 10, color: { rgb: c === 0 ? '64748B' : '0F172A' } },
              alignment: { horizontal: 'left', vertical: 'center' },
              border: CELL_BORDER,
            };
    }
  }
  XLSX.utils.book_append_sheet(wb, wsParams, 'Parameter Sub-Step');

  // Sheets 2-5: 2D Matrices (Autocutting, Semi-Auto, Manual, COT V2)
  MATRIX_CONFIGS.forEach((cfg) => {
    const data = stdDb[cfg.key] || [];
    const rows: (string | number)[][] = [
      [cfg.rowHeaderLabel, ...cfg.colLabels.map((c) => `${c}${cfg.colSuffix}`)],
    ];
    cfg.rowLabels.forEach((rowLbl, rIdx) => {
      rows.push([
        rowLbl,
        ...cfg.colLabels.map((_, cIdx) => Number(data[rIdx]?.[cIdx] ?? 0)),
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const firstColWch = cfg.key === 'settingWireMatrix' ? 32 : 16;
    const colWch =
      cfg.key === 'cotMatrix' ? 20 : cfg.key === 'settingWireMatrix' ? 24 : 14;
    ws['!cols'] = [{ wch: firstColWch }, ...cfg.colLabels.map(() => ({ wch: colWch }))];
    styleSheetHeader(ws, cfg.colLabels.length + 1, 0);

    for (let r = 1; r < rows.length; r++) {
      const lblAddr = XLSX.utils.encode_cell({ r, c: 0 });
      if (ws[lblAddr]) {
        ws[lblAddr].s = {
          font: { bold: true, sz: 10, color: { rgb: '1E293B' } },
          fill: { fgColor: { rgb: 'F8FAFC' } },
          alignment: { horizontal: 'left', vertical: 'center' },
          border: CELL_BORDER,
        };
      }
      for (let c = 1; c <= cfg.colLabels.length; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (ws[addr]) {
          ws[addr].s = EDITABLE_NUM_STYLE;
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, cfg.sheetName);
  });

  XLSX.writeFile(
    wb,
    `Template_Parameter_STD_UMH_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}

function normStr(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseNumCell(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw ?? '')
    .trim()
    .replace(/,/g, '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface ParsedStdExcelResult {
  nextDb: StdDatabase;
  detectedSheets: string[];
  paramChanges: MasterChangeDiffItem[];
  matrixChanges: MasterChangeDiffItem[];
  matchedParamsRows: number;
  matchedMatricesCount: number;
}

/**
 * Parses an uploaded Excel (.xlsx / .xls / .csv) containing Parameter Sub-Step and/or
 * 2D Matrices and merges values onto currentDb without losing unmatched parameters.
 */
export async function parseStdParamsExcelFile(
  file: File,
  currentDb: StdDatabase
): Promise<ParsedStdExcelResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });

  const nextDb: StdDatabase = structuredClone(currentDb);
  const detectedSheets: string[] = [];
  let matchedParamsRows = 0;
  let matchedMatricesCount = 0;

  // Lookup maps for Sub-Step params
  const byId = new Map(nextDb.params.map((p, idx) => [normStr(p.id), idx]));
  const byComposite = new Map(
    nextDb.params.map((p, idx) => [`${normStr(p.sheet)}||${normStr(p.name)}`, idx])
  );
  const byNameOnly = new Map(nextDb.params.map((p, idx) => [normStr(p.name), idx]));

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
      raw: true,
    }) as unknown[][];
    if (!grid || grid.length < 2) continue;

    const normSheet = normStr(sheetName);

    // 1. Check if sheet matches one of the 5 2D Matrices (Autocutting, Semi-Auto, Manual, COT V2, Setting Wire)
    const matchedMatrixCfg = MATRIX_CONFIGS.find((cfg) => {
      if (normSheet === normStr(cfg.sheetName)) return true;
      if (cfg.key === 'acMatrix' && /auto\s*cut/i.test(normSheet) && !/semi/i.test(normSheet)) {
        return true;
      }
      if (cfg.key === 'saMatrix' && /semi/i.test(normSheet)) return true;
      if (cfg.key === 'mcMatrix' && /manual|air/i.test(normSheet)) return true;
      if (cfg.key === 'cotMatrix' && /\bcot\b|master[\s_-]*cot/i.test(normSheet)) return true;
      if (
        cfg.key === 'settingWireMatrix' &&
        /setting[\s_-]*wire|matrix[\s_-]*setting|setting[\s_-]*cct/i.test(normSheet)
      ) {
        return true;
      }
      return false;
    });

    if (matchedMatrixCfg) {
      let headerRow = -1;
      for (let r = 0; r < Math.min(grid.length, 10); r++) {
        const firstCell = normStr(grid[r]?.[0]);
        if (matchedMatrixCfg.key === 'cotMatrix') {
          if (firstCell === 'dia' || firstCell.includes('diameter') || firstCell === 'kode dia') {
            headerRow = r;
            break;
          }
        } else if (matchedMatrixCfg.key === 'settingWireMatrix') {
          if (
            firstCell.includes('jenjang') ||
            firstCell.includes('cct') ||
            firstCell.includes('tier') ||
            firstCell.includes('kode')
          ) {
            headerRow = r;
            break;
          }
        } else if (firstCell.includes('lot') || firstCell.includes('rentang')) {
          headerRow = r;
          break;
        }
      }
      if (headerRow >= 0) {
        let updatedAnyCell = false;
        const targetMat = nextDb[matchedMatrixCfg.key];
        if (matchedMatrixCfg.key === 'cotMatrix') {
          const diaToIdx = new Map(
            matchedMatrixCfg.rowLabels.map((lbl, idx) => [lbl.toUpperCase(), idx])
          );
          for (let r = headerRow + 1; r < grid.length; r++) {
            const row = grid[r];
            if (!row) continue;
            const rawLbl = String(row[0] ?? '').trim().toUpperCase();
            const fallbackIdx = r - (headerRow + 1);
            const targetIdx =
              diaToIdx.get(rawLbl) ??
              (fallbackIdx >= 0 && fallbackIdx < matchedMatrixCfg.rowLabels.length
                ? fallbackIdx
                : -1);
            if (targetIdx < 0 || !targetMat[targetIdx]) continue;
            for (let cIdx = 0; cIdx < matchedMatrixCfg.colLabels.length; cIdx++) {
              const parsed = parseNumCell(row[cIdx + 1]);
              if (parsed !== null) {
                targetMat[targetIdx][cIdx] = parsed;
                updatedAnyCell = true;
              }
            }
          }
        } else if (matchedMatrixCfg.key === 'settingWireMatrix') {
          for (let r = headerRow + 1; r < grid.length; r++) {
            const row = grid[r];
            if (!row) continue;
            const rawLbl = String(row[0] ?? '').trim().toUpperCase();
            const tierMatch = rawLbl.match(/^T([1-7])\b/);
            const fallbackIdx = r - (headerRow + 1);
            const targetIdx = tierMatch
              ? parseInt(tierMatch[1], 10) - 1
              : fallbackIdx >= 0 && fallbackIdx < matchedMatrixCfg.rowLabels.length
              ? fallbackIdx
              : -1;
            if (targetIdx < 0 || !targetMat[targetIdx]) continue;
            const parsed = parseNumCell(row[1]);
            if (parsed !== null) {
              targetMat[targetIdx][0] = parsed;
              updatedAnyCell = true;
            }
          }
        } else {
          for (let rIdx = 0; rIdx < matchedMatrixCfg.rowLabels.length; rIdx++) {
            const row = grid[headerRow + 1 + rIdx];
            if (!row) continue;
            for (let cIdx = 0; cIdx < matchedMatrixCfg.colLabels.length; cIdx++) {
              const parsed = parseNumCell(row[cIdx + 1]);
              if (parsed !== null && targetMat[rIdx]) {
                targetMat[rIdx][cIdx] = parsed;
                updatedAnyCell = true;
              }
            }
          }
        }
        if (updatedAnyCell) {
          detectedSheets.push(sheetName);
          matchedMatricesCount += 1;
        }
        continue;
      }
    }

    // 2. Check if sheet contains Sub-Step Parameter columns
    let headerRow = -1;
    let idCol = -1;
    let sheetCol = -1;
    let nameCol = -1;
    let valCol = -1;

    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const row = grid[r] || [];
      let fId = -1;
      let fSheet = -1;
      let fName = -1;
      let fVal = -1;
      for (let c = 0; c < row.length; c++) {
        const h = normStr(row[c]);
        if (!h) continue;
        if (fId < 0 && (h === 'id' || h === 'param id' || h === 'kode')) fId = c;
        else if (fSheet < 0 && (h.includes('sheet') || h === 'proses')) fSheet = c;
        else if (
          fName < 0 &&
          (h.includes('sub-step') || h.includes('substep') || h.includes('keterangan') || h === 'name' || h === 'parameter')
        ) {
          fName = c;
        } else if (
          fVal < 0 &&
          (h.includes('time') || h.includes('coeff') || h === 'val' || h === 'value' || h === 'nilai' || h === 'detik')
        ) {
          fVal = c;
        }
      }

      if (fVal >= 0 && (fId >= 0 || fName >= 0)) {
        headerRow = r;
        idCol = fId;
        sheetCol = fSheet;
        nameCol = fName;
        valCol = fVal;
        break;
      }
    }

    if (headerRow >= 0 && valCol >= 0) {
      let sheetMatched = 0;
      for (let r = headerRow + 1; r < grid.length; r++) {
        const row = grid[r] || [];
        const parsedVal = parseNumCell(row[valCol]);
        if (parsedVal === null) continue;

        let targetIdx: number | undefined;
        if (idCol >= 0) {
          const idKey = normStr(row[idCol]);
          if (idKey) targetIdx = byId.get(idKey);
        }
        if (targetIdx === undefined && sheetCol >= 0 && nameCol >= 0) {
          const compKey = `${normStr(row[sheetCol])}||${normStr(row[nameCol])}`;
          targetIdx = byComposite.get(compKey);
        }
        if (targetIdx === undefined && nameCol >= 0) {
          const nKey = normStr(row[nameCol]);
          if (nKey) targetIdx = byNameOnly.get(nKey);
        }

        if (targetIdx !== undefined) {
          nextDb.params[targetIdx].val = parsedVal;
          sheetMatched += 1;
        }
      }

      if (sheetMatched > 0) {
        detectedSheets.push(sheetName);
        matchedParamsRows += sheetMatched;
      }
    }
  }

  const paramChanges = computeStdParamsDiff(currentDb.params, nextDb.params);
  const matrixChanges = computeStdMatricesDiff(currentDb, nextDb);

  return {
    nextDb,
    detectedSheets,
    paramChanges,
    matrixChanges,
    matchedParamsRows,
    matchedMatricesCount,
  };
}

/**
 * Exports a single Master Data Change History audit entry into a formatted Excel report.
 */
export function exportMasterChangeHistoryExcel(entry: MasterChangeHistoryEntry): void {
  const wb = XLSX.utils.book_new();

  const summaryRows: (string | number)[][] = [
    ['LAPORAN RIWAYAT PERUBAHAN MASTER DATA'],
    ['ID Log', entry.id],
    ['Waktu Perubahan', new Date(entry.changedAt).toLocaleString('id-ID')],
    ['Penanggung Jawab (PIC)', entry.responsibleName],
    ['Kategori Master', MASTER_CATEGORY_LABELS[entry.category]],
    ['Metode Perubahan', MASTER_SOURCE_LABELS[entry.source]],
    ['File Sumber', entry.sourceFileName || '-'],
    ['Catatan', entry.note || '-'],
    ['Total Ditambah', entry.addedCount],
    ['Total Diubah', entry.modifiedCount],
    ['Total Dihapus', entry.removedCount],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 24 }, { wch: 48 }];
  if (wsSummary['A1']) {
    wsSummary['A1'].s = {
      font: { bold: true, sz: 13, color: { rgb: '1E3A8A' } },
    };
  }
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan');

  const detailRows: (string | number)[][] = [
    ['No', 'Status', 'Grup / Sheet', 'Item / Sel', 'Keterangan', 'Nilai Sebelum', 'Nilai Sesudah', 'Selisih'],
  ];

  entry.changes.forEach((c, idx) => {
    const statusLabel =
      c.action === 'added' ? 'DITAMBAH' : c.action === 'removed' ? 'DIHAPUS' : 'DIUBAH';
    const deltaStr =
      typeof c.deltaNumeric === 'number'
        ? `${c.deltaNumeric > 0 ? '+' : ''}${c.deltaNumeric}`
        : '-';
    detailRows.push([
      idx + 1,
      statusLabel,
      c.group,
      c.label,
      c.subLabel || '-',
      c.beforeValue,
      c.afterValue,
      deltaStr,
    ]);
  });

  const wsDetail = XLSX.utils.aoa_to_sheet(detailRows);
  wsDetail['!cols'] = [
    { wch: 6 },
    { wch: 12 },
    { wch: 24 },
    { wch: 36 },
    { wch: 24 },
    { wch: 22 },
    { wch: 22 },
    { wch: 14 },
  ];
  styleSheetHeader(wsDetail, 8, 0);
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Detail Perubahan');

  const datePart = entry.changedAt.slice(0, 10);
  XLSX.writeFile(wb, `Riwayat_Master_${entry.category}_${datePart}_${entry.id}.xlsx`);
}
