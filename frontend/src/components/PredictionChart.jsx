import React, { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { motion } from 'framer-motion';
import { Activity, BrainCircuit, CalendarRange, Loader2, TrendingUp, Info } from 'lucide-react';

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: '2-digit',
});

const MONTH_DAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  month: 'short',
});

const LONG_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const YEAR_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
});

const toFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const parseDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const raw = String(value).trim();
  if (!raw) return null;

  const isoDayMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDayMatch) {
    const [, yyyy, mm, dd] = isoDayMatch;
    const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const isoMonthMatch = raw.match(/^(\d{4})-(\d{2})$/);
  if (isoMonthMatch) {
    const [, yyyy, mm] = isoMonthMatch;
    const parsed = new Date(Number(yyyy), Number(mm) - 1, 1);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isHourLabel = (value) => /^\d{2}:\d{2}$/.test(String(value || '').trim());

const formatShortDate = (value, horizon = 'month') => {
  if (horizon === 'day' && isHourLabel(value)) return String(value);
  const parsed = parseDate(value);
  if (!parsed) return String(value || '');
  if (horizon === 'month') return MONTH_DAY_FORMATTER.format(parsed);
  if (horizon === 'year') return SHORT_DATE_FORMATTER.format(parsed);
  return LONG_DATE_FORMATTER.format(parsed);
};

const formatLongDate = (value, horizon = 'month') => {
  if (horizon === 'day' && isHourLabel(value)) return `${String(value)} block`;
  const parsed = parseDate(value);
  if (!parsed) return String(value || '');
  if (horizon === 'year') return YEAR_LABEL_FORMATTER.format(parsed);
  return LONG_DATE_FORMATTER.format(parsed);
};

const getHorizonLimit = (horizon) => {
  if (horizon === 'day') return 24;
  if (horizon === 'month') return 62;
  return 12;
};

const buildChartData = ({ pastData = [], forecastData = [], mode = 'combined', horizon = 'month' }) => {
  const showPast = mode !== 'future';
  const showForecast = mode !== 'past';
  const limitedForecast = showForecast ? forecastData.slice(0, getHorizonLimit(horizon)) : [];

  const pastRows = (showPast ? pastData : []).map((row) => ({
    period: row.period || row.name || row.date,
    actual: toFiniteNumber(row.actual ?? row.value),
    predicted: null,
    lower: null,
    upper: null,
    segment: 'past',
  }));

  const forecastRows = limitedForecast.map((row) => ({
    period: row.period || row.name || row.date,
    actual: null,
    predicted: toFiniteNumber(row.predicted ?? row.predicted_demand ?? row.value),
    lower: toFiniteNumber(row.lower),
    upper: toFiniteNumber(row.upper),
    segment: 'forecast',
  }));

  return [...pastRows, ...forecastRows].filter((row) => row.period);
};

const getSummaryCards = (rows = []) => {
  const historical = rows.filter((row) => row.actual != null);
  const forecast = rows.filter((row) => row.predicted != null);

  const lastActual = historical[historical.length - 1]?.actual ?? null;
  const avgForecast = forecast.length
    ? Math.round(forecast.reduce((sum, row) => sum + Number(row.predicted || 0), 0) / forecast.length)
    : null;
  const peakForecast = forecast.length
    ? Math.max(...forecast.map((row) => Number(row.predicted || 0)))
    : null;

  return [
    { 
      label: 'Last Period', 
      value: lastActual != null ? `${Math.round(lastActual).toLocaleString()}` : '0', 
      subValue: 'Total sold in last month',
      icon: Activity, 
      color: 'from-blue-500 to-indigo-600',
      bg: 'bg-blue-50 dark:bg-blue-500/10'
    },
    { 
      label: 'Predicted Avg', 
      value: avgForecast != null ? `${avgForecast.toLocaleString()}` : '0', 
      subValue: 'Expected monthly sales',
      icon: TrendingUp, 
      color: 'from-emerald-500 to-teal-600',
      bg: 'bg-emerald-50 dark:bg-emerald-500/10'
    },
    { 
      label: 'Highest Peak', 
      value: peakForecast != null ? `${peakForecast.toLocaleString()}` : '0', 
      subValue: 'Highest expected sales',
      icon: CalendarRange, 
      color: 'from-violet-500 to-purple-600',
      bg: 'bg-violet-50 dark:bg-violet-500/10'
    },
  ];
};

const CustomTooltip = ({ active, payload, label, horizon = 'month' }) => {
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload || {};
  const isHistorical = row.actual != null;
  const value = isHistorical ? row.actual : row.predicted;

  return (
    <div className="rounded-3xl border border-white/40 bg-white/80 dark:bg-slate-900/90 backdrop-blur-xl px-5 py-4 shadow-[0_20px_50px_rgba(0,0,0,0.12)] min-w-[200px]">
      <div className="flex items-center justify-between mb-3 border-b border-slate-100 dark:border-white/10 pb-2">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{formatLongDate(label, horizon)}</p>
        <div className={`w-2 h-2 rounded-full ${isHistorical ? 'bg-blue-500 shadow-[0_0_8px_#3b82f6]' : 'bg-emerald-500 shadow-[0_0_8px_#10b981]'}`} />
      </div>
      
      <div className="space-y-1">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{isHistorical ? 'Past Sales' : 'Predicted Sales'}</p>
        <p className={`text-3xl font-black tracking-tight ${isHistorical ? 'text-blue-600' : 'text-emerald-600'}`}>
          {value != null ? Math.round(value).toLocaleString() : '0'}
          <span className="text-sm font-bold text-slate-400 ml-1.5 uppercase">Units</span>
        </p>
      </div>

      {!isHistorical && row.lower != null && row.upper != null && (
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-white/10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Low</p>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{Math.round(row.lower).toLocaleString()}</p>
            </div>
            <div className="flex-1 h-1 bg-slate-100 dark:bg-white/10 rounded-full relative overflow-hidden">
               <div className="absolute inset-0 bg-emerald-500/20" />
            </div>
            <div className="text-right">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">High</p>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{Math.round(row.upper).toLocaleString()}</p>
            </div>
          </div>
          <p className="mt-2 text-[9px] font-semibold text-center text-slate-400 uppercase tracking-[0.1em]">Confidence Range</p>
        </div>
      )}
    </div>
  );
};

const SummaryCard = ({ label, value, subValue, icon: Icon, color, bg }) => (
  <motion.div 
    whileHover={{ y: -4, scale: 1.02 }}
    className={`relative group overflow-hidden rounded-[2rem] border border-white/60 dark:border-white/10 bg-white/70 dark:bg-slate-900/40 p-5 shadow-sm backdrop-blur-md transition-all hover:shadow-xl`}
  >
    <div className={`absolute top-0 right-0 w-32 h-32 -mr-8 -mt-8 rounded-full bg-gradient-to-br ${color} opacity-[0.03] group-hover:opacity-[0.08] transition-opacity`} />
    
    <div className="flex items-start justify-between gap-4 relative z-10">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 group-hover:text-slate-500 transition-colors">{label}</p>
        <div className="flex items-baseline gap-1.5 mt-2">
          <h4 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">{value}</h4>
          <span className="text-[10px] font-bold text-slate-400 uppercase">Units</span>
        </div>
        <p className="mt-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 line-clamp-1">{subValue}</p>
      </div>
      
      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${color} text-white shadow-lg shadow-black/5`}>
        <Icon size={20} strokeWidth={2.5} />
      </div>
    </div>
  </motion.div>
);

const PredictionChart = ({
  pastData = [],
  forecastData = [],
  mode = 'combined',
  showLegend = true,
  height = 420,
  fullScreen = false,
  isAnalyzing = false,
  horizon = 'month',
}) => {
  const chartData = useMemo(
    () => buildChartData({ pastData, forecastData, mode, horizon }),
    [pastData, forecastData, mode, horizon],
  );

  const summaryCards = useMemo(() => getSummaryCards(chartData), [chartData]);
  const hasData = chartData.length > 0;
  const chartHeight = Number.isFinite(Number(height)) ? Math.max(340, Number(height)) : 420;

  if (!hasData || isAnalyzing) {
    return (
      <div className="flex h-full min-h-[420px] flex-col justify-between rounded-[2.5rem] border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-8 shadow-sm">


        <div className="grid gap-4 md:grid-cols-3">
          {summaryCards.map((card) => (
             <div key={card.label} className="h-28 rounded-[1.5rem] bg-slate-50/50 dark:bg-white/[0.02] border border-dashed border-slate-200 dark:border-white/10" />
          ))}
        </div>

        <div className="flex flex-1 flex-col items-center justify-center rounded-[2rem] border border-dashed border-slate-200 dark:border-white/10 bg-slate-50/30 dark:bg-white/[0.01] px-8 py-10 text-center mt-6">
          {isAnalyzing ? (
            <>
              <div className="relative">
                <Loader2 size={42} className="animate-spin text-emerald-500 opacity-20" />
                <BrainCircuit size={24} className="absolute inset-0 m-auto text-emerald-500" />
              </div>
              <p className="mt-5 text-lg font-black text-slate-900 dark:text-white tracking-tight">Preparing Insights</p>
              <p className="mt-2 max-w-sm text-sm font-medium text-slate-500 dark:text-slate-400">
                AI is analyzing your sales history to predict future demand. This takes just a moment.
              </p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-3xl bg-slate-100 dark:bg-white/5 flex items-center justify-center mb-6">
                <BrainCircuit size={32} className="text-slate-400" />
              </div>
              <p className="mt-2 text-lg font-black text-slate-900 dark:text-white tracking-tight">No intelligence data yet</p>
              <p className="mt-2 max-w-sm text-sm font-medium text-slate-500 dark:text-slate-400">
                Please upload a transaction history sheet to unlock predictive sales analytics.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex h-full flex-col rounded-[2.5rem] border border-slate-200/80 dark:border-white/10 bg-gradient-to-b from-white to-slate-50/50 dark:from-slate-900 dark:to-slate-900/80 p-8 shadow-sm"
      style={{ minHeight: chartHeight }}
    >


        {showLegend && (
          <div className="flex flex-wrap items-center gap-3 bg-white/50 dark:bg-white/5 p-1.5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-50/80 dark:bg-blue-500/10 text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-400 transition-colors">
              <span className="h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]" />
              Past
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-500/10 text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400 transition-colors">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
              Future
            </div>
          </div>
        )}


      <div className="flex-1 overflow-hidden rounded-[2rem] border border-white/60 dark:border-white/10 bg-white/40 dark:bg-slate-800/20 p-6 backdrop-blur-sm">
        <ResponsiveContainer width="100%" height={fullScreen ? '100%' : Math.max(300, chartHeight - 240)} minWidth={280} minHeight={220}>
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.01} />
              </linearGradient>
              <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity={0.12} />
                <stop offset="100%" stopColor="#2563eb" stopOpacity={0.01} />
              </linearGradient>
            </defs>

            <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 4" opacity={0.5} />
            <XAxis
              dataKey="period"
              tickFormatter={(value) => formatShortDate(value, horizon)}
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
              minTickGap={30}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
              tickFormatter={(value) => {
                if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
                return `${Math.round(value)}`;
              }}
              width={45}
            />
            <Tooltip 
              content={<CustomTooltip horizon={horizon} />} 
              cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }}
              animationDuration={200}
            />

            <Area 
              type="monotone" 
              dataKey="actual" 
              stroke="none" 
              fill="url(#actualFill)" 
              connectNulls 
              animationDuration={1500}
            />
            <Line
              type="monotone"
              dataKey="actual"
              stroke="#2563eb"
              strokeWidth={4}
              dot={false}
              activeDot={{ r: 6, fill: '#2563eb', stroke: '#fff', strokeWidth: 3, shadow: '0 4px 10px rgba(37,99,235,0.4)' }}
              connectNulls
              animationDuration={1500}
            />

            <Area 
              type="monotone" 
              dataKey="predicted" 
              stroke="none" 
              fill="url(#forecastFill)" 
              connectNulls 
              animationDuration={2000}
            />
            <Line
              type="monotone"
              dataKey="predicted"
              stroke="#10b981"
              strokeWidth={4}
              strokeDasharray="8 6"
              dot={false}
              activeDot={{ r: 6, fill: '#10b981', stroke: '#fff', strokeWidth: 3, shadow: '0 4px 10px rgba(16,185,129,0.4)' }}
              connectNulls
              animationDuration={2000}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      
      <div className="mt-6 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 border-t border-slate-100 dark:border-white/5 pt-5">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-slate-300" />
            <span>Horizon: {horizon}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-slate-300" />
            <span>Confidence: 95%</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity cursor-help">
          <Info size={12} />
          <span>Algorithm: AI Prophet V4</span>
        </div>
      </div>
    </motion.div>
  );
};

export default PredictionChart;

