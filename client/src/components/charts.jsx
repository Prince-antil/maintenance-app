// ================================================================
// CCPL CMMS — Lightweight SVG Chart Suite (dark theme, zero deps)
// ================================================================
import { useState } from 'react';

const GRID = 'rgba(255,255,255,0.06)';
const TEXT = '#64748B';

/* ---------------- Line Chart — Monthly Breakdown Trend ---------------- */
export function LineChart({ data, height = 220, color = '#EF4444', unit = 'hrs' }) {
  const [hover, setHover] = useState(null);
  const w = 560, h = height, padX = 40, padY = 28;
  const max = Math.max(...data.map((d) => d.value)) * 1.25 || 1;
  const stepX = (w - padX * 2) / (data.length - 1 || 1);
  const pts = data.map((d, i) => ({
    x: padX + i * stepX,
    y: h - padY - (d.value / max) * (h - padY * 2),
    ...d,
  }));
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const area = `${path} L${pts[pts.length - 1].x},${h - padY} L${pts[0].x},${h - padY} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Monthly breakdown downtime trend">
      <defs>
        <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={padX} x2={w - padX} y1={h - padY - f * (h - padY * 2)} y2={h - padY - f * (h - padY * 2)} stroke={GRID} strokeDasharray="4 4" />
      ))}
      <path d={area} fill="url(#lineFill)" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <circle cx={p.x} cy={p.y} r="10" fill="transparent" />
          <circle cx={p.x} cy={p.y} r={hover === i ? 5 : 3.5} fill="#0F172A" stroke={color} strokeWidth="2" />
          <text x={p.x} y={h - 8} textAnchor="middle" fontSize="11" fill={TEXT}>{p.label}</text>
          {hover === i && (
            <g>
              <rect x={p.x - 34} y={p.y - 34} width="68" height="22" rx="6" fill="#0B1220" stroke="rgba(255,255,255,0.12)" />
              <text x={p.x} y={p.y - 19} textAnchor="middle" fontSize="11" fontWeight="600" fill="#F8FAFC">
                {p.value} {unit}
              </text>
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}

/* ---------------- Donut Chart — Machine Running Status ---------------- */
export function DonutChart({ segments, size = 190, thickness = 22, centerLabel, centerSub }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  let acc = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Machine running status distribution">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={GRID} strokeWidth={thickness} />
        {segments.map((seg, i) => {
          const frac = seg.value / total;
          const dash = `${frac * C} ${C}`;
          const offset = -acc * C;
          acc += frac;
          return (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={dash}
              strokeDashoffset={offset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
        })}
        <text x="50%" y="47%" textAnchor="middle" fontSize="26" fontWeight="700" fill="#F8FAFC">{centerLabel}</text>
        <text x="50%" y="59%" textAnchor="middle" fontSize="11" fill={TEXT}>{centerSub}</text>
      </svg>
      <ul className="space-y-2.5" aria-hidden="false">
        {segments.map((seg) => (
          <li key={seg.label} className="flex items-center gap-2.5 text-sm">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: seg.color }} />
            <span className="text-slate-400">{seg.label}</span>
            <span className="text-white font-semibold ml-auto pl-4">{seg.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Progress Gauge — PM Completion Rate ---------------- */
export function ProgressGauge({ value = 0, size = 190, label = 'PM Compliance' }) {
  const r = size / 2 - 16;
  const C = Math.PI * r; // semicircle
  const filled = (value / 100) * C;
  const color = value >= 90 ? '#10B981' : value >= 70 ? '#F59E0B' : '#EF4444';

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 2 + 34} viewBox={`0 0 ${size} ${size / 2 + 34}`} role="img" aria-label={`${label}: ${value}%`}>
        <path
          d={`M 16 ${size / 2 + 8} A ${r} ${r} 0 0 1 ${size - 16} ${size / 2 + 8}`}
          fill="none" stroke={GRID} strokeWidth="16" strokeLinecap="round"
        />
        <path
          d={`M 16 ${size / 2 + 8} A ${r} ${r} 0 0 1 ${size - 16} ${size / 2 + 8}`}
          fill="none" stroke={color} strokeWidth="16" strokeLinecap="round"
          strokeDasharray={`${filled} ${C}`}
          className="gauge-arc"
          style={{ '--gauge-circumference': C }}
        />
        <text x="50%" y={size / 2 - 4} textAnchor="middle" fontSize="30" fontWeight="700" fill="#F8FAFC">{value}%</text>
        <text x="50%" y={size / 2 + 20} textAnchor="middle" fontSize="11" fill={TEXT}>{label}</text>
      </svg>
    </div>
  );
}

/* ---------------- Bar Chart — Energy Consumption Overview ---------------- */
export function BarChart({ data, height = 220, unit = 'kWh' }) {
  const [hover, setHover] = useState(null);
  const w = 560, h = height, padX = 34, padY = 30;
  const max = Math.max(...data.map((d) => d.value)) * 1.2 || 1;
  const bw = Math.min(52, ((w - padX * 2) / data.length) * 0.55);
  const stepX = (w - padX * 2) / data.length;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Energy consumption overview">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={padX} x2={w - padX} y1={h - padY - f * (h - padY * 2)} y2={h - padY - f * (h - padY * 2)} stroke={GRID} strokeDasharray="4 4" />
      ))}
      {data.map((d, i) => {
        const bh = (d.value / max) * (h - padY * 2);
        const x = padX + i * stepX + (stepX - bw) / 2;
        const y = h - padY - bh;
        return (
          <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={x} y={y} width={bw} height={bh} rx="6" fill={d.color} opacity={hover === i ? 1 : 0.85} className="chart-bar" />
            <text x={x + bw / 2} y={h - 10} textAnchor="middle" fontSize="10.5" fill={TEXT}>{d.label}</text>
            <text x={x + bw / 2} y={y - 8} textAnchor="middle" fontSize="11" fontWeight="600" fill={hover === i ? '#F8FAFC' : '#94A3B8'}>
              {d.value.toLocaleString()}{hover === i ? ` ${d.unit || unit}` : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
