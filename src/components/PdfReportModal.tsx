import { useState } from 'react';
import { Download, FileText, Languages, Layers, Printer, X } from 'lucide-react';
import { resolveDifficultyPercentage } from '../data/cotMasterV2';
import {
  getAllowSecForMode,
  getEffectiveLot,
  getVariantResult,
} from '../engine/umhCalculator';
import { AllowanceMode, AssyRecord, CalculationVariant, UiLang } from '../types/umh';
import {
  exportDailySummaryPdf,
  exportSingleAssyPdf,
  PdfLayoutMode,
} from '../utils/pdfExporter';
import {
  translateBasis,
  translateProcessName,
  translateStage,
  translateSubStepName,
  UI_LANG_OPTIONS,
} from '../utils/umhTranslator';

interface PdfReportModalProps {
  /** Single Assy record (used from AssyDetailModal) */
  record?: AssyRecord;
  /** Multiple Assy records (used for Daily Summary Report from DatabaseAssyView) */
  records?: AssyRecord[];
  mode?: AllowanceMode;
  lang?: UiLang;
  initialLayout?: PdfLayoutMode;
  difficultyMatrix?: number[][];
  onClose: () => void;
}

export function PdfReportModal({
  record,
  records,
  mode,
  lang = 'id',
  initialLayout = 'summary',
  difficultyMatrix,
  onClose,
}: PdfReportModalProps) {
  const targetRecords: AssyRecord[] =
    records && records.length > 0 ? records : record ? [record] : [];
  const isMultiAssy = targetRecords.length > 1;

  const [uiLang, setUiLang] = useState<UiLang>(lang);
  const [layout, setLayout] = useState<PdfLayoutMode>(
    isMultiAssy ? 'summary' : initialLayout
  );

  if (targetRecords.length === 0) return null;

  const getModeTitle = (m: AllowanceMode) =>
    m === 'none'
      ? '0. Tanpa Allowance (Base 0%)'
      : m === 'by_process'
      ? '1. Allowance By Proses (Merata)'
      : '2. Allowance By Hasil Akhir (Justified Bobot)';

  const handleDirectDownloadPdf = () => {
    if (isMultiAssy) {
      exportDailySummaryPdf(targetRecords, uiLang, difficultyMatrix, 'per_assy');
    } else {
      const single = targetRecords[0];
      const activeMode = mode ?? single.params.allowanceMode;
      exportSingleAssyPdf(single, activeMode, layout, uiLang, difficultyMatrix);
    }
  };

  /**
   * COMPACT DAILY SUMMARY VIEW (1 Landscape Page per Assy: 21 Processes REG + SMV)
   */
  const renderSummarySheet = (rec: AssyRecord, idx: number) => {
    const activeMode = mode ?? rec.params.allowanceMode;
    const { params } = rec;
    const effectiveLot = getEffectiveLot(params.lot);
    const effPct = activeMode === 'none' ? 0 : params.pfdAllowancePct || 0;
    const difficultyRating = params.difficultyRating ?? 0;
    const difficultyPct =
      rec.calculation.difficultyPct !== undefined
        ? rec.calculation.difficultyPct
        : resolveDifficultyPercentage(difficultyRating, difficultyMatrix);

    const regCalc = getVariantResult(rec, 'reg');
    const smvCalc = getVariantResult(rec, 'smv');

    const regAllowTotal = getAllowSecForMode(
      activeMode,
      regCalc.totalBaseSec,
      regCalc.totalAllowByProcessSec,
      regCalc.totalAllowByFinalSec
    );
    const smvAllowTotal = getAllowSecForMode(
      activeMode,
      smvCalc.totalBaseSec,
      smvCalc.totalAllowByProcessSec,
      smvCalc.totalAllowByFinalSec
    );
    const deltaSmvReg = smvAllowTotal - regAllowTotal;
    const smvById = new Map(smvCalc.processes.map((p) => [p.processId, p]));

    return (
      <div
        key={rec.id}
        className={`space-y-4 ${
          idx > 0
            ? 'pt-8 border-t-4 border-dashed border-slate-300 print:border-t-0 print:pt-0 print:break-before-page'
            : ''
        }`}
      >
        {/* Daily Summary Banner */}
        <div className="bg-slate-900 text-white rounded-xl px-5 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-wider text-blue-300 uppercase">
              Laporan Harian Hasil Kalkulasi STD / UMH · Summary View (21 Item Proses)
            </p>
            <h1 className="text-xl font-bold font-mono-num mt-0.5">
              ASSY {params.assyNo}
            </h1>
            <p className="text-[11px] text-slate-200 mt-0.5">
              Customer: {params.customer || '-'} · {getModeTitle(activeMode)} · PFD: {effPct}% · LOT:{' '}
              {effectiveLot}
              {difficultyRating > 0
                ? ` · Kesulitan: ${difficultyRating.toFixed(1)} ★ (+${difficultyPct.toFixed(2)}%)`
                : ''}
            </p>
          </div>
          <div className="text-right text-[11px] text-slate-200 font-mono-num space-y-0.5 shrink-0">
            <div>Tanggal Cetak: {new Date().toLocaleDateString('id-ID')}</div>
            <div>
              Master CCT: {params.masterCct} CCT · PPCS: {rec.ppcsList.length}
            </div>
            {isMultiAssy && (
              <div className="text-blue-300 font-semibold">
                Assy {idx + 1} / {targetRecords.length}
              </div>
            )}
          </div>
        </div>

        {/* 4 Compact KPI Cards */}
        <div className="grid grid-cols-4 gap-3">
          <div className="border border-slate-200 rounded-xl px-3.5 py-2.5 bg-slate-50/70">
            <p className="text-[10px] font-semibold text-slate-500">REG Base Cycle (0%)</p>
            <p className="text-base font-bold font-mono-num text-slate-900 mt-0.5">
              {regCalc.totalBaseSec.toFixed(2)} sec
            </p>
            <p className="text-[10px] font-mono-num text-slate-500">
              {(regCalc.totalBaseSec / 60).toFixed(2)} min · {(regCalc.totalBaseSec / 3600).toFixed(4)} hr
            </p>
          </div>
          <div className="border border-blue-200 rounded-xl px-3.5 py-2.5 bg-blue-50/60">
            <p className="text-[10px] font-semibold text-[#1E3A8A]">
              REG Standard UMH (+{effPct}%)
            </p>
            <p className="text-base font-bold font-mono-num text-[#1E3A8A] mt-0.5">
              {regAllowTotal.toFixed(2)} sec
            </p>
            <p className="text-[10px] font-mono-num text-blue-800">
              {(regAllowTotal / 60).toFixed(2)} min · {(regAllowTotal / 3600).toFixed(4)} hr
            </p>
          </div>
          <div className="border border-slate-200 rounded-xl px-3.5 py-2.5 bg-slate-50/70">
            <p className="text-[10px] font-semibold text-slate-500">SMV Base Cycle (0%)</p>
            <p className="text-base font-bold font-mono-num text-slate-900 mt-0.5">
              {smvCalc.totalBaseSec.toFixed(2)} sec
            </p>
            <p className="text-[10px] font-mono-num text-slate-500">
              {(smvCalc.totalBaseSec / 60).toFixed(2)} min · {(smvCalc.totalBaseSec / 3600).toFixed(4)} hr
            </p>
          </div>
          <div className="border border-emerald-200 rounded-xl px-3.5 py-2.5 bg-emerald-50/60">
            <p className="text-[10px] font-semibold text-[#047857]">
              SMV Standard UMH (Δ {deltaSmvReg >= 0 ? '+' : ''}{deltaSmvReg.toFixed(1)}s)
            </p>
            <p className="text-base font-bold font-mono-num text-[#047857] mt-0.5">
              {smvAllowTotal.toFixed(2)} sec
            </p>
            <p className="text-[10px] font-mono-num text-emerald-800">
              {(smvAllowTotal / 60).toFixed(2)} min · {(smvAllowTotal / 3600).toFixed(4)} hr
            </p>
          </div>
        </div>

        {/* Unified 21-Process Recapitulation Table (REG & SMV) */}
        <div>
          <h2 className="text-xs font-bold text-slate-900 mb-1.5">
            Tabel Rekapitulasi 21 Item Proses Manufaktur Wire Harness (REG &amp; SMV)
          </h2>
          <table className="w-full text-left border-collapse text-[10.5px]">
            <thead>
              <tr className="text-white">
                <th className="py-1.5 px-2 w-8 text-center bg-slate-800 border border-slate-700">No</th>
                <th className="py-1.5 px-2 bg-slate-800 border border-slate-700">
                  Item Proses (21 Proses)
                </th>
                <th className="py-1.5 px-2 text-right bg-[#1E3A8A] border border-blue-900">
                  REG Base (s)
                </th>
                <th className="py-1.5 px-2 text-right bg-[#1E3A8A] border border-blue-900">
                  REG Allow (s)
                </th>
                <th className="py-1.5 px-2 text-right bg-[#1E3A8A] border border-blue-900">
                  REG Allow (m)
                </th>
                <th className="py-1.5 px-2 text-right bg-[#1E3A8A] border border-blue-900">
                  REG Allow (hr)
                </th>
                <th className="py-1.5 px-2 text-right bg-[#064E3B] border border-emerald-900">
                  SMV Base (s)
                </th>
                <th className="py-1.5 px-2 text-right bg-[#064E3B] border border-emerald-900">
                  SMV Allow (s)
                </th>
                <th className="py-1.5 px-2 text-right bg-[#064E3B] border border-emerald-900">
                  SMV Allow (m)
                </th>
                <th className="py-1.5 px-2 text-right bg-[#064E3B] border border-emerald-900">
                  SMV Allow (hr)
                </th>
                <th className="py-1.5 px-2 text-right bg-slate-800 border border-slate-700">
                  Share REG
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {regCalc.processes.map((proc, pIdx) => {
                const smvProc = smvById.get(proc.processId);
                const regAllow = getAllowSecForMode(
                  activeMode,
                  proc.baseSec,
                  proc.allowByProcessSec,
                  proc.allowByFinalSec
                );
                const smvBase = smvProc ? smvProc.baseSec : 0;
                const smvAllow = smvProc
                  ? getAllowSecForMode(
                      activeMode,
                      smvProc.baseSec,
                      smvProc.allowByProcessSec,
                      smvProc.allowByFinalSec
                    )
                  : 0;
                const sharePct = regAllowTotal > 0 ? (regAllow / regAllowTotal) * 100 : 0;
                const procName = translateProcessName(
                  proc.processId,
                  proc.processName,
                  proc.jpName,
                  uiLang
                );
                const isInactive = proc.baseSec === 0;
                return (
                  <tr
                    key={proc.processId}
                    className={`${pIdx % 2 === 1 ? 'bg-slate-50/80' : 'bg-white'} ${
                      isInactive ? 'text-slate-400' : 'text-slate-900'
                    }`}
                  >
                    <td className="py-1 px-2 text-center font-mono-num font-semibold border-x border-slate-200">
                      {proc.processId}
                    </td>
                    <td className="py-1 px-2 font-medium border-r border-slate-200">
                      {procName}
                    </td>
                    <td className="py-1 px-2 text-right font-mono-num border-r border-slate-200">
                      {proc.baseSec.toFixed(2)}
                    </td>
                    <td
                      className={`py-1 px-2 text-right font-mono-num border-r border-slate-200 ${
                        isInactive ? '' : 'font-bold text-[#1E3A8A]'
                      }`}
                    >
                      {regAllow.toFixed(2)}
                    </td>
                    <td className="py-1 px-2 text-right font-mono-num border-r border-slate-200">
                      {(regAllow / 60).toFixed(3)}
                    </td>
                    <td
                      className={`py-1 px-2 text-right font-mono-num border-r border-slate-200 ${
                        isInactive ? '' : 'font-bold text-[#1E3A8A]'
                      }`}
                    >
                      {(regAllow / 3600).toFixed(4)}
                    </td>
                    <td className="py-1 px-2 text-right font-mono-num border-r border-slate-200">
                      {smvBase.toFixed(2)}
                    </td>
                    <td
                      className={`py-1 px-2 text-right font-mono-num border-r border-slate-200 ${
                        isInactive ? '' : 'font-bold text-[#047857]'
                      }`}
                    >
                      {smvAllow.toFixed(2)}
                    </td>
                    <td className="py-1 px-2 text-right font-mono-num border-r border-slate-200">
                      {(smvAllow / 60).toFixed(3)}
                    </td>
                    <td
                      className={`py-1 px-2 text-right font-mono-num border-r border-slate-200 ${
                        isInactive ? '' : 'font-bold text-[#047857]'
                      }`}
                    >
                      {(smvAllow / 3600).toFixed(4)}
                    </td>
                    <td className="py-1 px-2 text-right font-mono-num border-r border-slate-200 text-slate-600">
                      {sharePct.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-200/80 border-y-2 border-slate-400 font-bold text-[11px]">
                <td className="py-1.5 px-2 border-x border-slate-300" />
                <td className="py-1.5 px-2 text-slate-900 border-r border-slate-300">
                  GRAND TOTAL (21 PROSES)
                </td>
                <td className="py-1.5 px-2 text-right font-mono-num border-r border-slate-300">
                  {regCalc.totalBaseSec.toFixed(2)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono-num text-[#1E3A8A] border-r border-slate-300">
                  {regAllowTotal.toFixed(2)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono-num border-r border-slate-300">
                  {(regAllowTotal / 60).toFixed(3)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono-num text-[#1E3A8A] border-r border-slate-300">
                  {(regAllowTotal / 3600).toFixed(4)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono-num border-r border-slate-300">
                  {smvCalc.totalBaseSec.toFixed(2)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono-num text-[#047857] border-r border-slate-300">
                  {smvAllowTotal.toFixed(2)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono-num border-r border-slate-300">
                  {(smvAllowTotal / 60).toFixed(3)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono-num text-[#047857] border-r border-slate-300">
                  {(smvAllowTotal / 3600).toFixed(4)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono-num border-r border-slate-300">
                  100.0%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  /**
   * DETAILED VIEW (Single Assy: REG Summary + Active Sub-Steps, SMV Summary + Active Sub-Steps)
   */
  const renderDetailedSection = (
    singleRecord: AssyRecord,
    variantKey: 'reg' | 'smv',
    calc: CalculationVariant,
    compareCalc: CalculationVariant,
    isSecondSection: boolean
  ) => {
    const activeMode = mode ?? singleRecord.params.allowanceMode;
    const { params } = singleRecord;
    const effectiveLot = getEffectiveLot(params.lot);
    const effPct = activeMode === 'none' ? 0 : params.pfdAllowancePct || 0;
    const difficultyRating = params.difficultyRating ?? 0;
    const difficultyPct =
      singleRecord.calculation.difficultyPct !== undefined
        ? singleRecord.calculation.difficultyPct
        : resolveDifficultyPercentage(difficultyRating, difficultyMatrix);

    const totalAllowSec = getAllowSecForMode(
      activeMode,
      calc.totalBaseSec,
      calc.totalAllowByProcessSec,
      calc.totalAllowByFinalSec
    );
    const compareAllowSec = getAllowSecForMode(
      activeMode,
      compareCalc.totalBaseSec,
      compareCalc.totalAllowByProcessSec,
      compareCalc.totalAllowByFinalSec
    );
    const activeProcesses = calc.processes.filter((p) => p.active);

    const badgeText =
      variantKey === 'reg'
        ? 'BAGIAN 1 — REG (PERHITUNGAN NORMAL · AUTOCUTTING AKTIF)'
        : 'BAGIAN 2 — SMV (TANPA AUTOCUTTING · PROSES LAINNYA TETAP ADA)';

    const headerBg = variantKey === 'reg' ? 'bg-slate-900' : 'bg-[#064E3B]';

    return (
      <div
        className={`space-y-6 ${
          isSecondSection
            ? 'pt-8 border-t-4 border-dashed border-slate-300 print:border-t-0 print:pt-0 print:break-before-page'
            : ''
        }`}
      >
        <div className={`${headerBg} text-white rounded-xl p-5 flex items-center justify-between`}>
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-slate-200">{badgeText}</p>
            <h1 className="text-2xl font-bold font-mono-num mt-1">ASSY {params.assyNo}</h1>
            <p className="text-xs text-slate-200 mt-1">
              Customer: {params.customer || '-'} · Metode: {getModeTitle(activeMode)} · PFD: {effPct}% · LOT:{' '}
              {effectiveLot}
              {difficultyRating > 0
                ? ` · Kesulitan: ${difficultyRating.toFixed(1)} ★ (+${difficultyPct.toFixed(2)}%)`
                : ''}
            </p>
          </div>
          <div className="text-right text-xs text-slate-200 font-mono-num space-y-0.5">
            <div>Tanggal: {new Date().toLocaleDateString('id-ID')}</div>
            <div>
              Master CCT: {params.masterCct} CCT · LOT {effectiveLot}
            </div>
            <div>Sirkuit PPCS: {singleRecord.ppcsList.length}</div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div className="border border-slate-200 rounded-xl p-3.5">
            <p className="text-[11px] text-slate-500">
              Base Cycle (0%) · {variantKey.toUpperCase()}
            </p>
            <p className="text-lg font-bold font-mono-num text-slate-900 mt-1">
              {calc.totalBaseSec.toFixed(2)} sec
            </p>
            <p className="text-[11px] font-mono-num text-slate-500">
              {(calc.totalBaseSec / 3600).toFixed(4)} hr
            </p>
          </div>
          <div className="border border-emerald-300 bg-emerald-50/50 rounded-xl p-3.5">
            <p className="text-[11px] text-emerald-800">
              Standard UMH {variantKey.toUpperCase()}
            </p>
            <p className="text-lg font-bold font-mono-num text-emerald-900 mt-1">
              {totalAllowSec.toFixed(2)} sec
            </p>
            <p className="text-[11px] font-mono-num text-emerald-700">
              {(totalAllowSec / 3600).toFixed(4)} hr
            </p>
          </div>
          <div className="border border-slate-200 rounded-xl p-3.5">
            <p className="text-[11px] text-slate-500">Master CCT &amp; Wire</p>
            <p className="text-lg font-bold font-mono-num text-slate-900 mt-1">
              {params.masterCct} CCT
            </p>
            <p className="text-[11px] font-mono-num text-slate-500">
              {singleRecord.ppcsList.length} sirkuit PPCS
            </p>
          </div>
          <div className="border border-slate-200 rounded-xl p-3.5">
            <p className="text-[11px] text-slate-500">
              {variantKey === 'reg' ? 'Pembanding SMV' : 'Selisih vs REG'}
            </p>
            <p className="text-lg font-bold font-mono-num text-slate-900 mt-1">
              {variantKey === 'reg'
                ? `${compareAllowSec.toFixed(2)} sec`
                : `${totalAllowSec - compareAllowSec >= 0 ? '+' : ''}${(
                    totalAllowSec - compareAllowSec
                  ).toFixed(2)} sec`}
            </p>
            <p className="text-[11px] font-mono-num text-slate-500">
              {variantKey === 'reg'
                ? `${(compareAllowSec / 3600).toFixed(4)} hr`
                : `${(totalAllowSec - compareAllowSec) / 3600 >= 0 ? '+' : ''}${(
                    (totalAllowSec - compareAllowSec) /
                    3600
                  ).toFixed(4)} hr`}
            </p>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-bold text-slate-900 mb-2">
            Ringkasan 21 Proses Manufaktur Wire Harness — {variantKey.toUpperCase()}
          </h2>
          <table className="w-full text-left border-collapse text-[11px]">
            <thead>
              <tr className="bg-slate-100 border-y border-slate-300 text-slate-700">
                <th className="py-2 px-2 w-8 text-center">No</th>
                <th className="py-2 px-2">Proses Manufaktur</th>
                <th className="py-2 px-2 text-right">Base Sec</th>
                <th className="py-2 px-2 text-right text-emerald-900">Allow Sec</th>
                <th className="py-2 px-2 text-right">Base Min</th>
                <th className="py-2 px-2 text-right text-emerald-900">Allow Min</th>
                <th className="py-2 px-2 text-right">Base Hour</th>
                <th className="py-2 px-2 text-right text-emerald-900">Allow Hour</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {calc.processes.map((proc) => {
                const allowSec = getAllowSecForMode(
                  activeMode,
                  proc.baseSec,
                  proc.allowByProcessSec,
                  proc.allowByFinalSec
                );
                const procName = translateProcessName(
                  proc.processId,
                  proc.processName,
                  proc.jpName,
                  uiLang
                );
                return (
                  <tr key={proc.processId}>
                    <td className="py-1.5 px-2 text-center font-mono-num">{proc.processId}</td>
                    <td className="py-1.5 px-2 font-medium text-slate-900">{procName}</td>
                    <td className="py-1.5 px-2 text-right font-mono-num">{proc.baseSec.toFixed(3)}</td>
                    <td className="py-1.5 px-2 text-right font-mono-num font-bold text-emerald-800">
                      {allowSec.toFixed(3)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono-num">
                      {(proc.baseSec / 60).toFixed(4)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono-num font-bold text-emerald-800">
                      {(allowSec / 60).toFixed(4)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono-num">
                      {(proc.baseSec / 3600).toFixed(6)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono-num font-bold text-emerald-800">
                      {(allowSec / 3600).toFixed(6)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 border-t-2 border-slate-400 font-bold">
                <td className="py-2 px-2" />
                <td className="py-2 px-2">GRAND TOTAL UMH ({variantKey.toUpperCase()})</td>
                <td className="py-2 px-2 text-right font-mono-num">{calc.totalBaseSec.toFixed(3)}</td>
                <td className="py-2 px-2 text-right font-mono-num text-emerald-900">
                  {totalAllowSec.toFixed(3)}
                </td>
                <td className="py-2 px-2 text-right font-mono-num">
                  {(calc.totalBaseSec / 60).toFixed(4)}
                </td>
                <td className="py-2 px-2 text-right font-mono-num text-emerald-900">
                  {(totalAllowSec / 60).toFixed(4)}
                </td>
                <td className="py-2 px-2 text-right font-mono-num">
                  {(calc.totalBaseSec / 3600).toFixed(6)}
                </td>
                <td className="py-2 px-2 text-right font-mono-num text-emerald-900">
                  {(totalAllowSec / 3600).toFixed(6)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="pt-4 border-t border-slate-300 space-y-5 print:break-before-page">
          <h2 className="text-sm font-bold text-slate-900">
            [{variantKey.toUpperCase()}] Rincian Sub-Step per Proses Aktif ({activeProcesses.length} Proses)
          </h2>

          <div className="grid grid-cols-1 gap-4">
            {activeProcesses.map((proc) => {
              const procAllowSec = getAllowSecForMode(
                activeMode,
                proc.baseSec,
                proc.allowByProcessSec,
                proc.allowByFinalSec
              );
              const procName = translateProcessName(
                proc.processId,
                proc.processName,
                proc.jpName,
                uiLang
              );
              return (
                <div
                  key={proc.processId}
                  className="border border-slate-200 rounded-xl p-3.5 break-inside-avoid"
                >
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200">
                    <h3 className="text-xs font-bold text-slate-900">
                      {proc.processId}. {procName}
                    </h3>
                    <span className="text-[11px] font-mono-num text-slate-600">
                      Base: {proc.baseSec.toFixed(3)}s · Allow: {procAllowSec.toFixed(3)}s
                    </span>
                  </div>
                  <table className="w-full text-left text-[10px] border-collapse">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-200">
                        <th className="py-1 px-1.5 w-24">Tahap</th>
                        <th className="py-1 px-1.5">Sub-Step</th>
                        <th className="py-1 px-1.5">Basis</th>
                        <th className="py-1 px-1.5 text-right w-14">Qty</th>
                        <th className="py-1 px-1.5 text-right w-16">Rate (s)</th>
                        <th className="py-1 px-1.5 text-right">Base Sec</th>
                        <th className="py-1 px-1.5 text-right">Allow Sec</th>
                        <th className="py-1 px-1.5 text-right">Allow Min</th>
                        <th className="py-1 px-1.5 text-right">Allow Hour</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {proc.subSteps.map((sub) => {
                        const subAllow = getAllowSecForMode(
                          activeMode,
                          sub.baseSec,
                          sub.allowByProcessSec,
                          sub.allowByFinalSec
                        );
                        return (
                          <tr key={sub.id}>
                            <td className="py-1 px-1.5 font-medium text-slate-600">
                              {translateStage(sub.stage, uiLang)}
                            </td>
                            <td className="py-1 px-1.5 text-slate-800">
                              {translateSubStepName(sub.name, uiLang)}
                            </td>
                            <td className="py-1 px-1.5 text-slate-500">
                              {translateBasis(sub.basis, uiLang)}
                            </td>
                            <td className="py-1 px-1.5 text-right font-mono-num">
                              {Number.isInteger(sub.qty) ? sub.qty : sub.qty.toFixed(2)}
                            </td>
                            <td className="py-1 px-1.5 text-right font-mono-num">
                              {sub.rate.toFixed(3)}
                            </td>
                            <td className="py-1 px-1.5 text-right font-mono-num">
                              {sub.baseSec.toFixed(3)}
                            </td>
                            <td className="py-1 px-1.5 text-right font-mono-num font-bold text-emerald-800">
                              {subAllow.toFixed(3)}
                            </td>
                            <td className="py-1 px-1.5 text-right font-mono-num">
                              {(subAllow / 60).toFixed(4)}
                            </td>
                            <td className="py-1 px-1.5 text-right font-mono-num">
                              {(subAllow / 3600).toFixed(6)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const singleRecord = targetRecords[0];
  const regCalcSingle = getVariantResult(singleRecord, 'reg');
  const smvCalcSingle = getVariantResult(singleRecord, 'smv');

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm overflow-auto p-4 sm:p-6 print:static print:bg-white print:p-0 print:overflow-visible">
      {/* Screen-only toolbar */}
      <div className="max-w-[1120px] mx-auto mb-4 flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl px-5 py-3 shadow-lg border border-slate-200 print:hidden">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900 truncate">
            {isMultiAssy
              ? `Pratinjau Laporan Harian PDF Ringkas (${targetRecords.length} Assy · 21 Proses/Assy)`
              : layout === 'summary'
              ? `PDF Ringkas (Summary View · 21 Proses) — Assy ${singleRecord.params.assyNo}`
              : `PDF Lengkap (REG + SMV + Sub-Step) — Assy ${singleRecord.params.assyNo}`}
          </h3>
          <p className="text-xs text-slate-500">
            {layout === 'summary'
              ? 'Format ringkas khusus laporan harian: 1 halaman A4 Landscape padat per Assy memuat rekap 21 item proses.'
              : 'Lembar SMV otomatis dicetak pada halaman baru setelah lembar rincian REG selesai.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Layout Switcher (Single Assy only) */}
          {!isMultiAssy && (
            <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200">
              <button
                type="button"
                onClick={() => setLayout('summary')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  layout === 'summary'
                    ? 'bg-[#047857] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="w-3 h-3" />
                <span>Ringkas (21 Proses)</span>
              </button>
              <button
                type="button"
                onClick={() => setLayout('detailed')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  layout === 'detailed'
                    ? 'bg-[#1E3A8A] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>Lengkap (+ Sub-Step)</span>
              </button>
            </div>
          )}

          {/* Language Switcher */}
          <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200">
            <Languages className="w-3.5 h-3.5 text-slate-500 ml-1.5 mr-1 shrink-0" />
            {UI_LANG_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setUiLang(opt.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  uiLang === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.short}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleDirectDownloadPdf}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#047857] text-white text-xs font-semibold hover:bg-[#065F46] cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Unduh File .PDF</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Cetak</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
            aria-label="Tutup Pratinjau PDF"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Landscape Printable Sheet */}
      <div className="max-w-[1120px] mx-auto bg-white rounded-2xl shadow-xl border border-slate-200 p-8 space-y-10 print:max-w-none print:shadow-none print:border-0 print:rounded-none print:p-0 print:space-y-0">
        {layout === 'summary' ? (
          targetRecords.map((rec, idx) => renderSummarySheet(rec, idx))
        ) : (
          <>
            {renderDetailedSection(singleRecord, 'reg', regCalcSingle, smvCalcSingle, false)}
            {renderDetailedSection(singleRecord, 'smv', smvCalcSingle, regCalcSingle, true)}
          </>
        )}
      </div>
    </div>
  );
}
