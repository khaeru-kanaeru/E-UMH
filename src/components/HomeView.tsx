import { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight, Database, FileSpreadsheet, Layers, Sliders } from 'lucide-react';
import {
  getAllowanceModeLabel,
  getAllowSecForMode,
  getEffectiveLot,
  getVariantResult,
} from '../engine/umhCalculator';
import { AssyRecord, NavTab } from '../types/umh';

interface HomeViewProps {
  records: AssyRecord[];
  onStartWizard: () => void;
  onNavigate: (tab: NavTab) => void;
  onOpenDetail: (record: AssyRecord) => void;
}

type TrendGroupMode = 'by_assy' | 'by_date';
type TrendUnitMode = 'hour' | 'sec';

interface TrendPoint {
  key: string;
  label: string;
  subtitle: string;
  regVal: number;
  smvVal: number;
  runningAvgReg: number;
  cct: number;
  count: number;
  record?: AssyRecord;
}

function getActiveAllowSec(rec: AssyRecord, variant: 'reg' | 'smv'): number {
  const calc = getVariantResult(rec, variant);
  return getAllowSecForMode(
    rec.params.allowanceMode,
    calc.totalBaseSec,
    calc.totalAllowByProcessSec,
    calc.totalAllowByFinalSec
  );
}

export function HomeView({
  records,
  onStartWizard,
  onNavigate,
  onOpenDetail,
}: HomeViewProps) {
  const latestRecord = records[0];
  const [groupMode, setGroupMode] = useState<TrendGroupMode>('by_assy');
  const [unitMode, setUnitMode] = useState<TrendUnitMode>('hour');

  const analytics = useMemo(() => {
    if (records.length === 0) {
      return {
        avgRegSec: 0,
        avgSmvSec: 0,
        minRegRec: null as AssyRecord | null,
        maxRegRec: null as AssyRecord | null,
        minRegSec: 0,
        maxRegSec: 0,
        autoCutGainPct: 0,
        trendData: [] as TrendPoint[],
        topProcesses: [] as { name: string; fullName: string; avgVal: number; sharePct: number }[],
      };
    }

    const chronological = [...records].sort((a, b) =>
      (a.updatedAt || a.createdAt || '').localeCompare(b.updatedAt || b.createdAt || '')
    );

    const factor = unitMode === 'hour' ? 1 / 3600 : 1;
    const digits = unitMode === 'hour' ? 4 : 2;
    const roundVal = (v: number) => Number(v.toFixed(digits));

    let sumRegSec = 0;
    let sumSmvSec = 0;
    let minRegSec = Number.POSITIVE_INFINITY;
    let maxRegSec = Number.NEGATIVE_INFINITY;
    let minRegRec: AssyRecord | null = null;
    let maxRegRec: AssyRecord | null = null;

    const processTotals = new Map<string, { name: string; totalAllowSec: number }>();

    chronological.forEach((rec) => {
      const regSec = getActiveAllowSec(rec, 'reg');
      const smvSec = getActiveAllowSec(rec, 'smv');
      sumRegSec += regSec;
      sumSmvSec += smvSec;

      if (regSec < minRegSec) {
        minRegSec = regSec;
        minRegRec = rec;
      }
      if (regSec > maxRegSec) {
        maxRegSec = regSec;
        maxRegRec = rec;
      }

      const regCalc = getVariantResult(rec, 'reg');
      regCalc.processes.forEach((p) => {
        const allowSec = getAllowSecForMode(
          rec.params.allowanceMode,
          p.baseSec,
          p.allowByProcessSec,
          p.allowByFinalSec
        );
        if (allowSec <= 0) return;
        const key = `${p.processId}_${p.processName}`;
        const prev = processTotals.get(key);
        if (prev) {
          prev.totalAllowSec += allowSec;
        } else {
          processTotals.set(key, { name: p.processName, totalAllowSec: allowSec });
        }
      });
    });

    const avgRegSec = sumRegSec / chronological.length;
    const avgSmvSec = sumSmvSec / chronological.length;
    const autoCutGainPct =
      avgSmvSec > 0 ? Math.max(0, ((avgSmvSec - avgRegSec) / avgSmvSec) * 100) : 0;

    let trendData: TrendPoint[] = [];

    if (groupMode === 'by_assy') {
      let runningSum = 0;
      trendData = chronological.map((rec, idx) => {
        const regSec = getActiveAllowSec(rec, 'reg');
        const smvSec = getActiveAllowSec(rec, 'smv');
        runningSum += regSec;
        const shortAssy =
          rec.params.assyNo.length > 14
            ? `${rec.params.assyNo.slice(0, 12)}…`
            : rec.params.assyNo;
        return {
          key: rec.id,
          label: shortAssy,
          subtitle: `${rec.params.assyNo} · ${rec.params.customer || '-'}`,
          regVal: roundVal(regSec * factor),
          smvVal: roundVal(smvSec * factor),
          runningAvgReg: roundVal((runningSum / (idx + 1)) * factor),
          cct: rec.params.masterCct,
          count: 1,
          record: rec,
        };
      });
    } else {
      const byDate = new Map<
        string,
        { regSum: number; smvSum: number; cctSum: number; count: number; lastRec: AssyRecord }
      >();
      chronological.forEach((rec) => {
        const rawDate = (rec.updatedAt || rec.createdAt || '').slice(0, 10) || 'Tanggal N/A';
        const regSec = getActiveAllowSec(rec, 'reg');
        const smvSec = getActiveAllowSec(rec, 'smv');
        const entry = byDate.get(rawDate);
        if (entry) {
          entry.regSum += regSec;
          entry.smvSum += smvSec;
          entry.cctSum += rec.params.masterCct;
          entry.count += 1;
          entry.lastRec = rec;
        } else {
          byDate.set(rawDate, {
            regSum: regSec,
            smvSum: smvSec,
            cctSum: rec.params.masterCct,
            count: 1,
            lastRec: rec,
          });
        }
      });

      let cumulativeWeightedReg = 0;
      let cumulativeCount = 0;
      trendData = Array.from(byDate.entries()).map(([dateKey, agg]) => {
        cumulativeWeightedReg += agg.regSum;
        cumulativeCount += agg.count;
        const avgDayReg = agg.regSum / agg.count;
        const avgDaySmv = agg.smvSum / agg.count;
        const shortDate = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey.slice(5) : dateKey;
        return {
          key: dateKey,
          label: shortDate,
          subtitle: `${dateKey} · Rata-rata ${agg.count} Assy`,
          regVal: roundVal(avgDayReg * factor),
          smvVal: roundVal(avgDaySmv * factor),
          runningAvgReg: roundVal((cumulativeWeightedReg / cumulativeCount) * factor),
          cct: Math.round(agg.cctSum / agg.count),
          count: agg.count,
          record: agg.count === 1 ? agg.lastRec : undefined,
        };
      });
    }

    const totalProcessSum = Array.from(processTotals.values()).reduce(
      (acc, p) => acc + p.totalAllowSec,
      0
    );
    const topProcesses = Array.from(processTotals.values())
      .map((p) => {
        const avgSec = p.totalAllowSec / chronological.length;
        const shortName = p.name.length > 18 ? `${p.name.slice(0, 16)}…` : p.name;
        return {
          name: shortName,
          fullName: p.name,
          avgVal: roundVal(avgSec * factor),
          sharePct: totalProcessSum > 0 ? Number(((p.totalAllowSec / totalProcessSum) * 100).toFixed(1)) : 0,
        };
      })
      .sort((a, b) => b.avgVal - a.avgVal)
      .slice(0, 6);

    return {
      avgRegSec,
      avgSmvSec,
      minRegRec,
      maxRegRec,
      minRegSec: Number.isFinite(minRegSec) ? minRegSec : 0,
      maxRegSec: Number.isFinite(maxRegSec) ? maxRegSec : 0,
      autoCutGainPct,
      trendData,
      topProcesses,
    };
  }, [records, groupMode, unitMode]);

  const unitSuffix = unitMode === 'hour' ? 'hr' : 's';
  const unitDigits = unitMode === 'hour' ? 4 : 2;
  const overallAvgLine = Number(
    ((unitMode === 'hour' ? analytics.avgRegSec / 3600 : analytics.avgRegSec) || 0).toFixed(
      unitDigits
    )
  );

  const capabilities = [
    {
      num: '01',
      jp: '工程別詳細',
      title: '21 Proses & Sub-Step',
      desc: 'Rincian Dandori, Before, Main, dan After terstruktur dari Wire Printing hingga Finishing.',
      icon: Layers,
    },
    {
      num: '02',
      jp: '二次元マトリクス',
      title: 'Matriks 2D & Union-Find',
      desc: 'Lookup LOT × Panjang kabel otomatis serta pengelompokan bundle Twist menggunakan Disjoint Set.',
      icon: Sliders,
    },
    {
      num: '03',
      jp: '余裕率配分',
      title: 'Dual-Mode Allowance',
      desc: 'Bandingkan distribusi merata By Proses melawan distribusi proporsional bobot kesulitan By Hasil Akhir.',
      icon: Database,
    },
    {
      num: '04',
      jp: '帳票出力',
      title: 'Ekspor Excel & PDF',
      desc: 'Workbook .xlsx multi-sheet dengan styling terstruktur serta laporan cetak PDF Landscape.',
      icon: FileSpreadsheet,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Hero Bento Card */}
      <section className="glass-surface rounded-2xl overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-7 p-8 lg:p-10 flex flex-col justify-between gap-6">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                <span className="text-[#1E3A8A] font-semibold">標準時間・工数計算ワークベンチ</span>
                <span aria-hidden="true">·</span>
                <span>21 Proses Manufaktur</span>
                <span aria-hidden="true">·</span>
                <span>Dual-Mode Allowance</span>
              </div>

              <h1 className="text-3xl lg:text-[34px] font-bold tracking-tight text-slate-900 leading-[1.2] [text-wrap:balance]">
                Kalkulasi Base Cycle Time &amp; Standard UMH Wire Harness
              </h1>

              <p className="text-[15px] leading-relaxed text-slate-600 max-w-xl">
                Sistem standar waktu kerja manufaktur Wire Harness dari pembacaan Part List,
                PPCS, dan Assembly COT hingga kalkulasi matriks 2D, Twist Union-Find, serta
                ekspor laporan standar industri.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onStartWizard}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1E3A8A] text-white text-sm font-semibold hover:bg-[#172E6E] active:scale-[0.99] transition-all whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Mulai Sekarang</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('database')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-slate-800 border border-slate-200 text-sm font-semibold hover:bg-slate-50 transition-all whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Database className="w-4 h-4 text-slate-500" />
                <span>Lihat Database Assy</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 relative min-h-[240px] lg:min-h-[320px] bg-slate-900">
            <img
              src="./src/assets/images/wire_harness_studio_hero_1794972130349.jpg"
              alt="Rakitan Wire Harness otomotif dengan konektor polimer dan terminal kuningan"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover lg:h-full"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/20 to-transparent pointer-events-none" />
            <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between text-white gap-4">
              <div>
                <p className="text-[11px] font-medium text-slate-300">標準工数算出 · Standard Engineering</p>
                <p className="text-sm font-semibold mt-0.5">Base Cycle (0%) &amp; PFD Justified</p>
              </div>
              <span className="font-mono-num text-xs font-semibold text-white/95 bg-slate-950/60 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/15 shrink-0">
                {records.length} Assy Tersimpan
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* UMH Efficiency & Trend Analytics (Recharts) */}
      <section className="glass-surface rounded-2xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-[#1E3A8A]">
              生産効率トレンド · Pemantauan Efisiensi Produksi
            </p>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              Tren Rata-Rata UMH &amp; Kontribusi Proses
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Perbandingan UMH REG, SMV, dan rata-rata kumulatif ·{' '}
              <span className="font-mono-num font-semibold text-slate-700">{records.length}</span>{' '}
              Assy
            </p>
          </div>

          {records.length > 0 && (
            <div className="flex items-center gap-2 shrink-0 self-start">
              <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200">
                <button
                  type="button"
                  onClick={() => setGroupMode('by_assy')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    groupMode === 'by_assy'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Per Assy
                </button>
                <button
                  type="button"
                  onClick={() => setGroupMode('by_date')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    groupMode === 'by_date'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Per Tanggal
                </button>
              </div>

              <span className="hidden sm:block h-5 w-px bg-slate-200" aria-hidden="true" />

              <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200">
                <button
                  type="button"
                  onClick={() => setUnitMode('hour')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    unitMode === 'hour'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Hour
                </button>
                <button
                  type="button"
                  onClick={() => setUnitMode('sec')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    unitMode === 'sec'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sec
                </button>
              </div>
            </div>
          )}
        </div>

        {records.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-slate-300 rounded-xl bg-slate-50/70">
            <p className="text-sm font-semibold text-slate-800">
              Belum ada data Assy untuk ditampilkan pada grafik tren
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Mulai kalkulasi Assy pertama Anda untuk memantau rata-rata UMH REG, SMV, dan distribusi proses.
            </p>
            <button
              type="button"
              onClick={onStartWizard}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1E3A8A] text-white text-xs font-semibold hover:bg-[#172E6E] cursor-pointer"
            >
              <span>Input Assy Pertama</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            {/* Flat Divided KPI Summary Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 pb-5 border-b border-slate-200 lg:divide-x lg:divide-slate-200">
              <div className="lg:pr-4">
                <p className="text-xs text-slate-500">Rata-Rata UMH REG</p>
                <p className="text-2xl font-bold font-mono-num text-[#1E3A8A] mt-1">
                  {unitMode === 'hour'
                    ? (analytics.avgRegSec / 3600).toFixed(4)
                    : analytics.avgRegSec.toFixed(2)}{' '}
                  <span className="text-xs font-medium text-slate-500">{unitSuffix}</span>
                </p>
                <p className="text-[11px] text-slate-500 font-mono-num mt-0.5">
                  {unitMode === 'hour'
                    ? `${analytics.avgRegSec.toFixed(2)} sec/assy`
                    : `${(analytics.avgRegSec / 3600).toFixed(4)} hr/assy`}
                </p>
              </div>

              <div className="lg:px-5">
                <p className="text-xs text-slate-500">Rata-Rata UMH SMV</p>
                <p className="text-2xl font-bold font-mono-num text-[#047857] mt-1">
                  {unitMode === 'hour'
                    ? (analytics.avgSmvSec / 3600).toFixed(4)
                    : analytics.avgSmvSec.toFixed(2)}{' '}
                  <span className="text-xs font-medium text-slate-500">{unitSuffix}</span>
                </p>
                <p className="text-[11px] text-slate-500 font-mono-num mt-0.5">
                  Tanpa Autocutting · {records.length} Assy
                </p>
              </div>

              <div className="lg:px-5">
                <p className="text-xs text-slate-500">Efisiensi Auto-Cut (vs SMV)</p>
                <p className="text-2xl font-bold font-mono-num text-slate-900 mt-1">
                  {analytics.autoCutGainPct.toFixed(1)}
                  <span className="text-xs font-medium text-slate-500">%</span>
                </p>
                <p className="text-[11px] text-slate-500 font-mono-num mt-0.5">
                  Hemat{' '}
                  {unitMode === 'hour'
                    ? `${Math.max(0, (analytics.avgSmvSec - analytics.avgRegSec) / 3600).toFixed(4)} hr`
                    : `${Math.max(0, analytics.avgSmvSec - analytics.avgRegSec).toFixed(2)} s`}{' '}
                  rata-rata
                </p>
              </div>

              <div className="lg:pl-5">
                <p className="text-xs text-slate-500">Rentang UMH REG (Min – Max)</p>
                <p className="text-lg font-bold font-mono-num text-slate-900 mt-1.5">
                  {unitMode === 'hour'
                    ? `${(analytics.minRegSec / 3600).toFixed(4)} – ${(analytics.maxRegSec / 3600).toFixed(4)}`
                    : `${analytics.minRegSec.toFixed(1)} – ${analytics.maxRegSec.toFixed(1)}`}{' '}
                  <span className="text-xs font-medium text-slate-500">{unitSuffix}</span>
                </p>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">
                  {analytics.minRegRec?.params.assyNo || '-'} /{' '}
                  {analytics.maxRegRec?.params.assyNo || '-'}
                </p>
              </div>
            </div>

            {/* Chart Grid: Main Trend Chart + Top Process Contributors */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left: Trend Line/Area Chart */}
              <div className="lg:col-span-8 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-800">
                    {groupMode === 'by_assy'
                      ? 'Tren UMH per Assy & Rata-Rata Kumulatif'
                      : 'Tren Rata-Rata UMH Harian & Rata-Rata Kumulatif'}
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-xs bg-[#1E3A8A]" aria-hidden="true" />
                      UMH REG
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-xs bg-[#047857]" aria-hidden="true" />
                      UMH SMV
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3 border-t-2 border-dashed border-[#D97706]" aria-hidden="true" />
                      Rata-Rata Kumulatif
                    </span>
                  </div>
                </div>

                <div className="h-[290px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={analytics.trendData}
                      margin={{ top: 10, right: 16, left: 4, bottom: 4 }}
                      onClick={(state) => {
                        const idx = typeof state?.activeTooltipIndex === 'number' ? state.activeTooltipIndex : -1;
                        if (idx >= 0) {
                          const pt = analytics.trendData[idx];
                          if (pt?.record) onOpenDetail(pt.record);
                        }
                      }}
                    >
                      <defs>
                        <linearGradient id="umhRegFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#1E3A8A" stopOpacity={0.18} />
                          <stop offset="95%" stopColor="#1E3A8A" stopOpacity={0.01} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: '#64748B' }}
                        axisLine={{ stroke: '#CBD5E1' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#64748B' }}
                        axisLine={false}
                        tickLine={false}
                        width={60}
                        tickFormatter={(val: number) =>
                          unitMode === 'hour' ? val.toFixed(3) : val.toFixed(0)
                        }
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const pt = payload[0].payload as TrendPoint;
                          return (
                            <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs space-y-1.5 min-w-[205px]">
                              <p className="font-bold text-slate-900 font-mono-num">
                                {pt.subtitle}
                              </p>
                              <div className="space-y-1 pt-1 border-t border-slate-100 font-mono-num">
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-slate-500">UMH REG</span>
                                  <span className="font-bold text-[#1E3A8A]">
                                    {pt.regVal.toFixed(unitDigits)} {unitSuffix}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-slate-500">UMH SMV</span>
                                  <span className="font-bold text-[#047857]">
                                    {pt.smvVal.toFixed(unitDigits)} {unitSuffix}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-slate-500">Rata-Rata Kumulatif</span>
                                  <span className="font-semibold text-[#D97706]">
                                    {pt.runningAvgReg.toFixed(unitDigits)} {unitSuffix}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-100 text-[11px] text-slate-500">
                                  <span>Rata-Rata CCT</span>
                                  <span>{pt.cct} CCT</span>
                                </div>
                              </div>
                              {pt.record && (
                                <p className="text-[10px] text-[#1E3A8A] pt-0.5">
                                  Klik titik grafik untuk membuka detail Assy
                                </p>
                              )}
                            </div>
                          );
                        }}
                      />
                      <ReferenceLine
                        y={overallAvgLine}
                        stroke="#94A3B8"
                        strokeDasharray="4 4"
                        label={{
                          value: `Avg ${overallAvgLine.toFixed(unitDigits)} ${unitSuffix}`,
                          position: 'insideTopRight',
                          fill: '#64748B',
                          fontSize: 10,
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="regVal"
                        name="UMH REG"
                        stroke="#1E3A8A"
                        strokeWidth={2.25}
                        fill="url(#umhRegFill)"
                        dot={{ r: 3.5, fill: '#1E3A8A', strokeWidth: 0 }}
                        activeDot={{ r: 5.5, fill: '#1E3A8A', stroke: '#FFFFFF', strokeWidth: 2 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="smvVal"
                        name="UMH SMV"
                        stroke="#047857"
                        strokeWidth={2}
                        dot={{ r: 3, fill: '#047857', strokeWidth: 0 }}
                        activeDot={{ r: 5, fill: '#047857', stroke: '#FFFFFF', strokeWidth: 2 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="runningAvgReg"
                        name="Rata-Rata Kumulatif"
                        stroke="#D97706"
                        strokeWidth={1.75}
                        strokeDasharray="5 4"
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {records.length === 1 && (
                  <p className="text-[11px] text-slate-500">
                    Saat ini baru 1 Assy tersimpan · Tambahkan Assy lain di Database Assy untuk
                    melihat pergerakan tren antar-produk.
                  </p>
                )}
              </div>

              {/* Right: Top 6 Average Process Contributors */}
              <div className="lg:col-span-4 lg:border-l lg:border-slate-200 lg:pl-6 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-slate-800">
                    Top 6 Kontributor Waktu Proses (REG)
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Rata-rata waktu per Assy ({unitSuffix})
                  </p>
                </div>

                <div className="h-[290px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={analytics.topProcesses}
                      layout="vertical"
                      margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10, fill: '#64748B' }}
                        axisLine={{ stroke: '#CBD5E1' }}
                        tickLine={false}
                        tickFormatter={(val: number) =>
                          unitMode === 'hour' ? val.toFixed(3) : val.toFixed(0)
                        }
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={112}
                        tick={{ fontSize: 11, fill: '#334155' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: '#F1F5F9' }}
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const item = payload[0].payload as {
                            fullName: string;
                            avgVal: number;
                            sharePct: number;
                          };
                          return (
                            <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-2.5 text-xs space-y-1">
                              <p className="font-bold text-slate-900">{item.fullName}</p>
                              <p className="font-mono-num text-[#1E3A8A] font-semibold">
                                {item.avgVal.toFixed(unitDigits)} {unitSuffix}{' '}
                                <span className="text-slate-500 font-normal">
                                  ({item.sharePct}%)
                                </span>
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Bar
                        dataKey="avgVal"
                        fill="#1E3A8A"
                        radius={[0, 6, 6, 0]}
                        barSize={18}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Bento Capability Strip (4 columns) */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {capabilities.map((cap) => {
          const Icon = cap.icon;
          return (
            <div
              key={cap.num}
              className="glass-surface rounded-2xl p-5 flex flex-col justify-between gap-4"
            >
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200/70 flex items-center justify-center text-slate-700">
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-[11px] font-medium text-slate-400">
                  <span className="font-mono-num">{cap.num}</span> · {cap.jp}
                </span>
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">{cap.title}</h2>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{cap.desc}</p>
              </div>
            </div>
          );
        })}
      </section>

      {/* Latest Calculation Quick Summary */}
      {latestRecord && (
        <section className="glass-surface rounded-2xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
            <div>
              <p className="text-xs font-medium text-slate-500">
                最新計算結果 · Kalkulasi Terakhir
              </p>
              <h2 className="text-lg font-bold text-slate-900 mt-0.5 font-mono-num">
                {latestRecord.params.assyNo} · {latestRecord.params.customer}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onOpenDetail(latestRecord)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Buka Detail UMH</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 pt-5 lg:divide-x lg:divide-slate-200">
            <div className="lg:pr-4">
              <p className="text-xs text-slate-500">
                Base Cycle (0%) · LOT {getEffectiveLot(latestRecord.params.lot)}
              </p>
              <p className="text-2xl font-bold font-mono-num text-slate-900 mt-1">
                {latestRecord.calculation.totalBaseSec.toFixed(2)}{' '}
                <span className="text-xs font-medium text-slate-500">sec</span>
              </p>
            </div>
            <div className="lg:px-6">
              <p className="text-xs text-slate-500">
                {getAllowanceModeLabel(latestRecord.params.allowanceMode, 'short')}
                {latestRecord.params.allowanceMode !== 'none'
                  ? ` (+${latestRecord.params.pfdAllowancePct}%)`
                  : ' (0%)'}
              </p>
              <p className="text-2xl font-bold font-mono-num text-[#047857] mt-1">
                {getActiveAllowSec(latestRecord, 'reg').toFixed(2)}{' '}
                <span className="text-xs font-medium text-slate-500">sec</span>
              </p>
            </div>
            <div className="lg:px-6">
              <p className="text-xs text-slate-500">Standard UMH REG (Hour)</p>
              <p className="text-2xl font-bold font-mono-num text-slate-900 mt-1">
                {(getActiveAllowSec(latestRecord, 'reg') / 3600).toFixed(4)}{' '}
                <span className="text-xs font-medium text-slate-500">hr</span>
              </p>
            </div>
            <div className="lg:pl-6">
              <p className="text-xs text-slate-500">
                UMH SMV (Hour) · {latestRecord.params.masterCct} CCT
              </p>
              <p className="text-2xl font-bold font-mono-num text-[#1E3A8A] mt-1">
                {(getActiveAllowSec(latestRecord, 'smv') / 3600).toFixed(4)}{' '}
                <span className="text-xs font-medium text-slate-500">hr</span>
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
