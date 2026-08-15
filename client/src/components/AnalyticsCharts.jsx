// ================================================================
// CCPL CMMS — Recharts Analytics Components
// Dark navy + teal themed, fully responsive, auto-updating chart
// wrappers used across Dashboard / Reports / module pages.
// ================================================================
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  ComposedChart, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from 'recharts';
import { BarChart3 } from 'lucide-react';

// Shared theme tokens (match index.css glass design system)
const GRID = 'rgba(148,163,184,0.08)';
const AXIS = { fill: '#64748B', fontSize: 11 };
const TOOLTIP_STYLE = {
  backgroundColor: '#0F172A',
  border: '1px solid rgba(148,163,184,0.2)',
  borderRadius: '10px',
  fontSize: '12px',
  color: '#E2E8F0',
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
};
const PIE_COLORS = ['#06B6D4', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#3B82F6', '#EC4899', '#84CC16', '#F97316', '#14B8A6'];

function ChartTooltip(props) {
  return <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(148,163,184,0.06)' }} {...props} />;
}

/** Card shell with title/subtitle + empty state when no data points exist. */
export function ChartCard({ title, subtitle, empty, emptyHint, height = 260, children, raw = false }) {
  return (
    <div className="glass-card p-5 flex flex-col">
      <h4 className="text-card-title mb-0.5">{title}</h4>
      {subtitle && <p className="text-meta mb-3">{subtitle}</p>}
      {empty ? (
        <div className="flex flex-col items-center justify-center text-center" style={{ height }}>
          <BarChart3 size={26} className="text-slate-600 mb-2" aria-hidden="true" />
          <p className="text-slate-500 text-xs max-w-[220px]">{emptyHint || 'No data yet — this chart updates automatically as records are added.'}</p>
        </div>
      ) : (
        <div style={{ height }} className="mt-1">
          {raw ? children : <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>}
        </div>
      )}
    </div>
  );
}

/** Smooth area/line trend — used for breakdown, energy, availability, MTTR, MTBF trends. */
export function TrendChart({ data, dataKey = 'value', color = '#06B6D4', unit = '', area = true, yDomain }) {
  const Comp = area ? AreaChart : LineChart;
  return (
    <Comp data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
      <defs>
        <linearGradient id={`grad-${dataKey}-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <CartesianGrid stroke={GRID} vertical={false} />
      <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
      <YAxis tick={AXIS} axisLine={false} tickLine={false} domain={yDomain} width={48} />
      <ChartTooltip formatter={(v) => [`${v}${unit}`, null]} />
      {area ? (
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} fill={`url(#grad-${dataKey}-${color})`} dot={{ r: 3, fill: color, strokeWidth: 0 }} activeDot={{ r: 5 }} />
      ) : (
        <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} dot={{ r: 3, fill: color, strokeWidth: 0 }} activeDot={{ r: 5 }} />
      )}
    </Comp>
  );
}

export function DualTrendChart({ data, leftKey = 'count', rightKey = 'downtime' }) {
  return (
    <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
      <CartesianGrid stroke={GRID} vertical={false} />
      <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
      <YAxis yAxisId="left" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} width={40} />
      <YAxis yAxisId="right" orientation="right" tick={AXIS} axisLine={false} tickLine={false} width={48} />
      <ChartTooltip />
      <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} iconType="circle" iconSize={8} />
      <Line yAxisId="left" type="monotone" dataKey={leftKey} name="Breakdowns" stroke="#EF4444" strokeWidth={2.5} dot={{ r: 3, fill: '#EF4444' }} />
      <Line yAxisId="right" type="monotone" dataKey={rightKey} name="Downtime Hrs" stroke="#06B6D4" strokeWidth={2.5} dot={{ r: 3, fill: '#06B6D4' }} />
    </ComposedChart>
  );
}

/** Grouped/stacked vertical bars — monthly PM completion (completed vs pending). */
export function PMCompletionChart({ data }) {
  return (
    <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barCategoryGap="28%">
      <CartesianGrid stroke={GRID} vertical={false} />
      <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
      <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} width={44} />
      <ChartTooltip />
      <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} iconType="circle" iconSize={8} />
      <Bar dataKey="completed" name="Completed" stackId="pm" fill="#10B981" radius={[0, 0, 0, 0]} />
      <Bar dataKey="pending" name="Pending" stackId="pm" fill="#F59E0B" radius={[6, 6, 0, 0]} />
    </BarChart>
  );
}

/** Horizontal bars — equipment-wise breakdown counts. */
export function HorizontalBarChart({ data, dataKey = 'count', color = '#06B6D4', unit = '' }) {
  return (
    <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }} barCategoryGap="30%">
      <CartesianGrid stroke={GRID} horizontal={false} />
      <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
      <YAxis type="category" dataKey="label" tick={{ ...AXIS, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={140} />
      <ChartTooltip formatter={(v) => [`${v}${unit}`, null]} />
      <Bar dataKey={dataKey} fill={color} radius={[0, 6, 6, 0]} maxBarSize={18} />
    </BarChart>
  );
}

/** Pareto — top-10 breakdown machines: bars + cumulative % line. */
export function ParetoChart({ data }) {
  return (
    <ComposedChart data={data} margin={{ top: 8, right: 6, left: 4, bottom: 34 }}>
      <CartesianGrid stroke={GRID} vertical={false} />
      <XAxis dataKey="label" tick={{ ...AXIS, fontSize: 10 }} axisLine={false} tickLine={false} angle={-32} textAnchor="end" interval={0} height={58} />
      <YAxis yAxisId="left" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} width={40} />
      <YAxis yAxisId="right" orientation="right" tick={AXIS} axisLine={false} tickLine={false} domain={[0, 100]} unit="%" width={48} />
      <ChartTooltip />
      <Bar yAxisId="left" dataKey="count" name="Breakdowns" fill="#EF4444" fillOpacity={0.85} radius={[5, 5, 0, 0]} maxBarSize={30} />
      <Line yAxisId="right" type="monotone" dataKey="cumulative" name="Cumulative %" stroke="#F59E0B" strokeWidth={2.5} dot={{ r: 3, fill: '#F59E0B' }} />
    </ComposedChart>
  );
}

/** Pie / donut — department split & machine health distribution. */
export function PieDonutChart({ data, donut = false, centerLabel, centerSub }) {
  return (
    <PieChart>
      <ChartTooltip />
      <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} iconType="circle" iconSize={8} layout="vertical" align="right" verticalAlign="middle" />
      <Pie
        data={data}
        dataKey="value"
        nameKey="label"
        cx="42%"
        cy="50%"
        innerRadius={donut ? '55%' : 0}
        outerRadius="82%"
        paddingAngle={data.length > 1 ? 2 : 0}
        strokeWidth={0}
      >
        {data.map((entry, i) => (
          <Cell key={entry.label} fill={entry.color || PIE_COLORS[i % PIE_COLORS.length]} />
        ))}
      </Pie>
      {donut && centerLabel != null && (
        <>
          <text x="42%" y="47%" textAnchor="middle" fill="#FFFFFF" fontSize={22} fontWeight={700}>{centerLabel}</text>
          <text x="42%" y="58%" textAnchor="middle" fill="#64748B" fontSize={11}>{centerSub}</text>
        </>
      )}
    </PieChart>
  );
}

export function GroupedBarChart({ data, bars }) {
  return (
    <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barCategoryGap="24%">
      <CartesianGrid stroke={GRID} vertical={false} />
      <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
      <YAxis tick={AXIS} axisLine={false} tickLine={false} width={48} />
      <ChartTooltip />
      <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} iconType="circle" iconSize={8} />
      {bars.map((bar) => (
        <Bar key={bar.dataKey} dataKey={bar.dataKey} name={bar.name} fill={bar.color} radius={[6, 6, 0, 0]} maxBarSize={22} />
      ))}
    </BarChart>
  );
}
