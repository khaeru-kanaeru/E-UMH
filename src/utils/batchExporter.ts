import JSZip from 'jszip';
import { buildExportRecordForMode } from '../engine/umhCalculator';
import { AllowanceMode, AssyRecord, UiLang } from '../types/umh';
import { buildUmhExcelBuffer } from './excelExporter';
import { buildSingleAssyPdfBuffer, PdfLayoutMode } from './pdfExporter';

export type BatchExportFormat = 'excel' | 'pdf' | 'both';

export interface BatchExportProgress {
  phase: 'generating' | 'zipping' | 'done';
  completed: number;
  total: number;
  currentAssyNo: string;
}

export interface BatchExportOptions {
  records: AssyRecord[];
  format: BatchExportFormat;
  pdfLayout: PdfLayoutMode;
  allowanceStrategy: 'per_assy' | AllowanceMode;
  overridePct?: number;
  lang: UiLang;
  difficultyMatrix?: number[][];
  onProgress?: (progress: BatchExportProgress) => void;
}

export interface BatchExportResult {
  zipFileName: string;
  assyCount: number;
  excelCount: number;
  pdfCount: number;
}

function sanitizeFilenameSegment(raw: string): string {
  const cleaned = (raw || 'Assy')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'Assy';
}

function getUniqueFileName(
  usedNames: Set<string>,
  baseName: string,
  ext: string
): string {
  let candidate = `${baseName}.${ext}`;
  let idx = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${baseName}_${idx}.${ext}`;
    idx += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Batch exports selected or all Assys into a single .ZIP archive:
 * - Excel files placed inside subfolder `Excel/` (1 .xlsx file per Assy)
 * - PDF files placed inside subfolder `PDF/` (1 .pdf file per Assy)
 */
export async function exportBatchAssyZip(
  options: BatchExportOptions
): Promise<BatchExportResult> {
  const {
    records,
    format,
    pdfLayout,
    allowanceStrategy,
    overridePct,
    lang,
    difficultyMatrix,
    onProgress,
  } = options;

  if (records.length === 0) {
    throw new Error('Tidak ada Assy yang dipilih untuk diekspor.');
  }

  const zip = new JSZip();
  const includeExcel = format === 'excel' || format === 'both';
  const includePdf = format === 'pdf' || format === 'both';

  const excelFolder = includeExcel ? zip.folder('Excel') : null;
  const pdfFolder = includePdf ? zip.folder('PDF') : null;

  const usedExcelNames = new Set<string>();
  const usedPdfNames = new Set<string>();

  let excelCount = 0;
  let pdfCount = 0;

  const pdfSuffix = pdfLayout === 'summary' ? '_Summary' : '_Lengkap';

  for (let i = 0; i < records.length; i++) {
    const rawRec = records[i];
    const assyLabel = rawRec.params.assyNo || `Assy_${i + 1}`;
    onProgress?.({
      phase: 'generating',
      completed: i,
      total: records.length,
      currentAssyNo: assyLabel,
    });

    // Yield to browser paint loop so UI progress bar updates smoothly
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    const effectiveMode: AllowanceMode =
      allowanceStrategy === 'per_assy' ? rawRec.params.allowanceMode : allowanceStrategy;

    const preparedRec =
      allowanceStrategy === 'per_assy'
        ? rawRec
        : buildExportRecordForMode(rawRec, effectiveMode, overridePct);

    const safeAssy = sanitizeFilenameSegment(rawRec.params.assyNo);

    if (excelFolder) {
      const excelBytes = buildUmhExcelBuffer(
        preparedRec,
        effectiveMode,
        lang,
        difficultyMatrix
      );
      const excelName = getUniqueFileName(usedExcelNames, `STD_UMH_${safeAssy}`, 'xlsx');
      excelFolder.file(excelName, excelBytes);
      excelCount += 1;
    }

    if (pdfFolder) {
      const pdfBytes = buildSingleAssyPdfBuffer(
        preparedRec,
        effectiveMode,
        pdfLayout,
        lang,
        difficultyMatrix
      );
      const pdfName = getUniqueFileName(
        usedPdfNames,
        `STD_UMH_${safeAssy}${pdfSuffix}`,
        'pdf'
      );
      pdfFolder.file(pdfName, pdfBytes);
      pdfCount += 1;
    }
  }

  onProgress?.({
    phase: 'zipping',
    completed: records.length,
    total: records.length,
    currentAssyNo: 'Mengompres arsip ZIP...',
  });

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const dateStamp = new Date().toISOString().slice(0, 10);
  const formatTag =
    format === 'both' ? 'Excel_PDF' : format === 'excel' ? 'Excel' : 'PDF';
  const zipFileName = `Batch_Export_UMH_${formatTag}_${records.length}Assy_${dateStamp}.zip`;

  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipFileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  onProgress?.({
    phase: 'done',
    completed: records.length,
    total: records.length,
    currentAssyNo: zipFileName,
  });

  return {
    zipFileName,
    assyCount: records.length,
    excelCount,
    pdfCount,
  };
}
