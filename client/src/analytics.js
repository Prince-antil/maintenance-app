export const HOURS_PER_MONTH = 720;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const isThisMonth = (value) => value && monthKey(value) === monthKey(new Date());
const isToday = (value) => value && new Date(value).toDateString() === new Date().toDateString();
const energyTotal = (entry) => (entry.source ? (entry.kwh || 0) : (entry.solarGenerationKwh || 0));
const round1 = (value) => Math.round((Number(value) || 0) * 10) / 10;

// ── Power Factor Utilities ────────────────────────────────────────────────────
// Strict PF formatting: never round to 1.00; cap at 0.99 for display.
export function formatPowerFactor(pfVal) {
  const num = Number(pfVal);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (num >= 1.0) return '0.99';
  if (num >= 0.99) return '0.99';
  return num.toFixed(2);
}

/**
 * Dynamic Power Factor calculation for a single row
 * U1 PF = U1_kWh / U1_kVAh
 * U2 PF = U2_kWh / U2_kVAh
 * Combined PF = (U1_kWh + U2_kWh) / (U1_kVAh + U2_kVAh)
 * All capped at 0.99
 */
export function computeDynamicPowerFactors(u1_kwh, u1_kvah, u2_kwh, u2_kvah) {
  const u1 = Number(u1_kwh || 0);
  const u1_kva = Number(u1_kvah || 0);
  const u2 = Number(u2_kwh || 0);
  const u2_kva = Number(u2_kvah || 0);
  
  const u1_pf = u1_kva > 0 ? Math.min(0.99, Number((u1 / u1_kva).toFixed(4))) : 0;
  const u2_pf = u2_kva > 0 ? Math.min(0.99, Number((u2 / u2_kva).toFixed(4))) : 0;
  const combined_pf = (u1_kva + u2_kva) > 0 ? Math.min(0.99, Number(((u1 + u2) / (u1_kva + u2_kva)).toFixed(4))) : 0;
  
  return { u1_pf, u2_pf, combined_pf };
}

/**
 * Compute weighted Power Factor across an array of delta rows.
 * Uses standard electrical formulation:
 *   PF_weighted = Σ(kWh_i) / Σ(kWh_i / PF_i)  for individual units
 *   Combined PF = Total_kWh / sqrt(Total_kWh² + Total_kVARh²)
 * This replaces simple arithmetic averaging with energy-weighted calculation.
 */
export function computeWeightedPf(deltas) {
  let u1KwhSum = 0, u1KvarhSum = 0;
  let u2KwhSum = 0, u2KvarhSum = 0;
  (deltas || []).forEach((d) => {
    const u1Import = Number(d._delta?.u1ImportKwhReading) || 0;
    const u1Pf = Math.min(1, Math.max(0.1, Number(d._delta?.u1Pf) || Number(d.u1Pf) || 0.98));
    if (u1Import > 0) {
      u1KwhSum += u1Import;
      u1KvarhSum += u1Import * Math.tan(Math.acos(u1Pf));
    }
    const u2Import = Number(d._delta?.u2ImportKwhReading) || 0;
    const u2Pf = Math.min(1, Math.max(0.1, Number(d._delta?.u2Pf) || Number(d.u2Pf) || 0.98));
    if (u2Import > 0) {
      u2KwhSum += u2Import;
      u2KvarhSum += u2Import * Math.tan(Math.acos(u2Pf));
    }
  });
  const totalKwh = u1KwhSum + u2KwhSum;
  const totalKvarh = u1KvarhSum + u2KvarhSum;
  if (totalKwh === 0) return 0;
  return totalKwh / Math.sqrt(totalKwh * totalKwh + totalKvarh * totalKvarh);
}

/**
 * Compute energy snapshot from daily utility deltas.
 * Returns { gridKwh, solarKwh, dgKwh, totalKwh, avgPowerFactor, fuelLtr, chartData }
 * Updated to use dynamic PF and fix zero values in summary cards.
 */
export function computeEnergySnapshot(deltas, solarLogs) {
  let totalGrid = 0;
  let totalSolarFromUtil = 0;
  let totalDg = 0;
  let totalFuel = 0;

  (deltas || []).forEach((d) => {
    const u1Grid = Number(d._delta?.u1ImportKwhReading) || 0;
    const u2Grid = Number(d._delta?.u2ImportKwhReading) || 0;
    totalGrid += u1Grid + u2Grid;
    const u1Solar = Number(d._delta?.u1SolarKwhReading) || 0;
    const u2Solar = Number(d._delta?.u2SolarKwhReading) || 0;
    totalSolarFromUtil += u1Solar + u2Solar;
    const dg380 = Number(d._delta?.dg380KwhReading) || 0;
    const dg500 = Number(d._delta?.dg500KwhReading) || 0;
    totalDg += dg380 + dg500;
    totalFuel += Number(d._delta?.dg380HsdAddedLtr) || 0;
    totalFuel += Number(d._delta?.dg500HsdAddedLtr) || 0;
  });

  // Solar: use inverter data from dailySolarGeneration (Solar section), fall back to meter-side utility
  const dedicatedSolarTotal = (solarLogs || []).reduce((acc, curr) => acc + (Number(curr.dailyTotalKwh) || Number(curr.grand_total) || 0), 0);
  const solarKwh = dedicatedSolarTotal > 0 ? dedicatedSolarTotal : totalSolarFromUtil;

  // Use dynamic PF calculation for more accurate results
  const avgPf = computeWeightedPf(deltas);

  const chartData = (deltas || []).map((d) => ({
    date: d.date,
    gridKwh: (Number(d._delta?.u1ImportKwhReading) || 0) + (Number(d._delta?.u2ImportKwhReading) || 0),
    solarKwh: (Number(d._delta?.u1SolarKwhReading) || 0) + (Number(d._delta?.u2SolarKwhReading) || 0),
    dgKwh: (Number(d._delta?.dg380KwhReading) || 0) + (Number(d._delta?.dg500KwhReading) || 0),
    fuelLtr: (Number(d._delta?.dg380HsdAddedLtr) || 0) + (Number(d._delta?.dg500HsdAddedLtr) || 0),
  })).reverse();

  return {
    gridKwh: Math.round(totalGrid),
    solarKwh: Math.round(solarKwh),
    dgKwh: Math.round(totalDg),
    totalKwh: Math.round(totalGrid + solarKwh + totalDg),
    avgPowerFactor: formatPowerFactor(avgPf),
    fuelLtr: Math.round(totalFuel),
    chartData,
  };
}

/**
 * Compute energy summary directly from utility rows (not deltas)
 * Use this for summary cards across all date range filters
 * Fixes zero values in Daily Utility summary cards
 */
export function computeEnergySummaryFromRows(utilityRows, solarRows = []) {
  if (!utilityRows || utilityRows.length === 0) {
    return {
      total_grid_kwh: 0,
      total_solar_kwh: 0,
      total_dg_kwh: 0,
      total_hsd_litres: 0,
      avg_u1_pf: 0,
      avg_u2_pf: 0,
      avg_combined_pf: 0,
      dg380_kwh: 0,
      dg500_kwh: 0,
      dg380_hours: 0,
      dg500_hours: 0,
      daily_avg_generation: 0
    };
  }

  // Process rows through dynamic PF calculation
  const processed = utilityRows.map(row => {
    const u1_import_kwh = Number(row.u1_import_kwh_reading || row.u1_import_kwh || 0);
    const u1_import_kvah = Number(row.u1_import_kvah_reading || row.u1_import_kvah || 0);
    const u2_import_kwh = Number(row.u2_import_kwh_reading || row.u2_import_kwh || 0);
    const u2_import_kvah = Number(row.u2_import_kvah_reading || row.u2_import_kvah || 0);
    const u1_solar_kwh = Number(row.u1_solar_kwh_reading || row.u1_solar_kwh || 0);
    const u2_solar_kwh = Number(row.u2_solar_kwh_reading || row.u2_solar_kwh || 0);
    const dg380_kwh = Number(row.dg380_kwh_reading || row.dg380_kwh || 0);
    const dg500_kwh = Number(row.dg500_kwh_reading || row.dg500_kwh || 0);
    const dg380_hours = Number(row.dg380_hourmeter_reading || row.dg380_hours || 0);
    const dg500_hours = Number(row.dg500_hourmeter_reading || row.dg500_hours || 0);
    const dg380_hsd = Number(row.dg380_hsd_added_ltr || row.dg380_hsd || 0);
    const dg500_hsd = Number(row.dg500_hsd_added_ltr || row.dg500_hsd || 0);

    const { u1_pf, u2_pf, combined_pf } = computeDynamicPowerFactors(
      u1_import_kwh, u1_import_kvah, u2_import_kwh, u2_import_kvah
    );

    return {
      u1_import_kwh,
      u2_import_kwh,
      u1_solar_kwh,
      u2_solar_kwh,
      dg380_kwh,
      dg500_kwh,
      dg380_hours,
      dg500_hours,
      dg380_hsd,
      dg500_hsd,
      u1_pf,
      u2_pf,
      combined_pf
    };
  });

  // Aggregate totals
  const total_grid_kwh = processed.reduce((sum, r) => sum + r.u1_import_kwh + r.u2_import_kwh, 0);
  const total_solar_kwh = processed.reduce((sum, r) => sum + r.u1_solar_kwh + r.u2_solar_kwh, 0);
  const total_dg_kwh = processed.reduce((sum, r) => sum + r.dg380_kwh + r.dg500_kwh, 0);
  const total_hsd_litres = processed.reduce((sum, r) => sum + r.dg380_hsd + r.dg500_hsd, 0);
  const dg380_kwh = processed.reduce((sum, r) => sum + r.dg380_kwh, 0);
  const dg500_kwh = processed.reduce((sum, r) => sum + r.dg500_kwh, 0);
  const dg380_hours = processed.reduce((sum, r) => sum + r.dg380_hours, 0);
  const dg500_hours = processed.reduce((sum, r) => sum + r.dg500_hours, 0);

  // Solar from inverter logs (Solar section)
  const dedicatedSolarTotal = (solarRows || []).reduce((acc, curr) => 
    acc + (Number(curr.dailyTotalKwh) || Number(curr.grand_total) || 0), 0);
  const final_solar_kwh = dedicatedSolarTotal > 0 ? dedicatedSolarTotal : total_solar_kwh;

  // Weighted average PF using import kWh as weights
  const u1_pf_weighted = processed.reduce((sum, r) => sum + (r.u1_pf * r.u1_import_kwh), 0);
  const u1_import_total = processed.reduce((sum, r) => sum + r.u1_import_kwh, 0);
  const u2_pf_weighted = processed.reduce((sum, r) => sum + (r.u2_pf * r.u2_import_kwh), 0);
  const u2_import_total = processed.reduce((sum, r) => sum + r.u2_import_kwh, 0);
  const combined_pf_weighted = processed.reduce((sum, r) => sum + (r.combined_pf * (r.u1_import_kwh + r.u2_import_kwh)), 0);
  const total_import_total = u1_import_total + u2_import_total;

  // Daily average generation
  const daily_avg_generation = processed.length > 0 
    ? Number((final_solar_kwh / processed.length).toFixed(2)) 
    : 0;

  return {
    total_grid_kwh: Number(total_grid_kwh.toFixed(2)),
    total_solar_kwh: Number(final_solar_kwh.toFixed(2)),
    total_dg_kwh: Number(total_dg_kwh.toFixed(2)),
    total_hsd_litres: Number(total_hsd_litres.toFixed(2)),
    dg380_kwh: Number(dg380_kwh.toFixed(2)),
    dg500_kwh: Number(dg500_kwh.toFixed(2)),
    dg380_hours: Number(dg380_hours.toFixed(2)),
    dg500_hours: Number(dg500_hours.toFixed(2)),
    avg_u1_pf: u1_import_total > 0 ? Number((u1_pf_weighted / u1_import_total).toFixed(4)) : 0,
    avg_u2_pf: u2_import_total > 0 ? Number((u2_pf_weighted / u2_import_total).toFixed(4)) : 0,
    avg_combined_pf: total_import_total > 0 ? Number((combined_pf_weighted / total_import_total).toFixed(4)) : 0,
    daily_avg_generation
  };
}

export const monthKey = (value) => {
  const dt = new Date(value);
  return Number.isNaN(dt.getTime())
    ? ''
    : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
};

export function summaryMonthKey(record) {
  if (record?.period && /^\d{4}-\d{2}$/.test(record.period)) return record.period;
  if (record?.year && record?.month) return `${record.year}-${String(record.month).padStart(2, '0')}`;
  if (record?.createdAt) return monthKey(record.createdAt);
  return '';
}

export function formatPeriodKey(period, long = false) {
  const [year, month] = String(period || '').split('-').map(Number);
  if (!year || !month) return '—';
  return long
    ? `${MONTHS[month - 1]} ${year}`
    : new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

export function lastNMonths(n = 6) {
  const out = [];
  const nowD = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(nowD.getFullYear(), nowD.getMonth() - i, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-GB', { month: 'short' }),
      full: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    });
  }
  return out;
}

function recentPeriodKeys(n = 3) {
  return new Set(lastNMonths(n).map((item) => item.key));
}

export function aggregateBreakdownRecords(breakdowns, mKey = null) {
  const rows = breakdowns.filter((row) => !mKey || summaryMonthKey(row) === mKey);
  const breakdownCount = rows.reduce((sum, row) => sum + (row.breakdownCount || 0), 0);
  const downtimeHours = round1(rows.reduce((sum, row) => sum + (row.downtimeHours || 0), 0));
  const operatingHours = round1(rows.reduce((sum, row) => sum + (row.operatingHours || 0), 0));
  const mttr = breakdownCount ? round1(downtimeHours / breakdownCount) : 0;
  const mtbf = breakdownCount ? round1(Math.max(0, operatingHours - downtimeHours) / breakdownCount) : 0;
  return {
    rows,
    sections: rows.length,
    breakdownCount,
    downtimeHours,
    operatingHours,
    mttr,
    mtbf,
  };
}

export function aggregatePMRecords(pms, mKey = null) {
  const rows = pms.filter((row) => !mKey || summaryMonthKey(row) === mKey);
  const plannedCount = rows.reduce((sum, row) => sum + (row.plannedCount || 0), 0);
  const doneCount = rows.reduce((sum, row) => sum + (row.doneCount || 0), 0);
  const pendingCount = rows.reduce((sum, row) => sum + (row.pendingCount || 0), 0);
  const compliance = plannedCount ? round1((doneCount / plannedCount) * 100) : 0;
  return {
    rows,
    sections: rows.length,
    plannedCount,
    doneCount,
    pendingCount,
    compliance,
  };
}

export function aggregateMachinePmRecords(records, mKey = null) {
  const rows = (records || []).filter((r) => {
    if (!mKey) return true;
    return (r.pmDate || '').slice(0, 7) === mKey;
  });
  const plannedCount = rows.length;
  const doneCount = rows.filter(
    (r) => String(r.status || '').toLowerCase() === 'completed' || r.completed === true
  ).length;
  const pendingCount = plannedCount - doneCount;
  const compliance = plannedCount > 0 ? round1((doneCount / plannedCount) * 100) : 0;
  return { rows, plannedCount, doneCount, pendingCount, compliance };
}

export function machineHealth(machine, breakdowns, pms, machinePmRecords = []) {
  const recentKeys = recentPeriodKeys(3);
  const sectionBreakdowns = breakdowns.filter((row) => row.section === machine.section && recentKeys.has(summaryMonthKey(row)));
  const sectionPMs = pms.filter((row) => row.section === machine.section && recentKeys.has(summaryMonthKey(row)));
  const sectionMachinePm = (machinePmRecords || []).filter(
    (r) => (r.plantSection || '') === machine.section && recentKeys.has((r.pmDate || '').slice(0, 7))
  );
  const bdSummary = aggregateBreakdownRecords(sectionBreakdowns);
  const pmSummaryManual = aggregatePMRecords(sectionPMs);
  const pmSummaryAuto = aggregateMachinePmRecords(sectionMachinePm);
  const pmSummary = pmSummaryAuto.plannedCount > 0 ? pmSummaryAuto : pmSummaryManual;

  let health = 100;
  health -= bdSummary.breakdownCount * 0.8;
  health -= bdSummary.downtimeHours * 0.08;
  health += pmSummary.compliance >= 90 ? 4 : pmSummary.compliance >= 75 ? 0 : -6;
  if (machine.status === 'breakdown') health -= 15;
  if (machine.status === 'maintenance') health -= 8;
  return Math.max(5, Math.min(100, Math.round(health)));
}

export const healthBand = (value) => (value >= 75 ? 'good' : value >= 50 ? 'fair' : 'poor');

export function computeMTTR(breakdowns, mKey = null) {
  return aggregateBreakdownRecords(breakdowns, mKey).mttr;
}

export function computeMTBF(breakdowns, machineCount, mKey = null) {
  const summary = aggregateBreakdownRecords(breakdowns, mKey);
  if (summary.mtbf) return summary.mtbf;
  if (!machineCount) return 0;
  return summary.breakdownCount
    ? round1(Math.max(0, machineCount * HOURS_PER_MONTH - summary.downtimeHours) / summary.breakdownCount)
    : 0;
}

export function computeAvailability(breakdowns, machineCount, mKey = null) {
  if (!machineCount) return 100;

  // If every row for this month carries an override, use the weighted average
  // of overrides instead of the dynamic formula. If even one row is missing an
  // override we fall back to the standard downtime-based calculation so the
  // result is always deterministic.
  const rows = breakdowns.filter((row) => !mKey || summaryMonthKey(row) === mKey);
  const overrideRows = rows.filter((row) => row.availability_override != null);
  if (overrideRows.length > 0 && overrideRows.length === rows.length) {
    // Weighted average by section count (equal weight per row — same as a
    // simple mean since we aggregate across sections).
    const avg = overrideRows.reduce((sum, row) => sum + row.availability_override, 0) / overrideRows.length;
    return round1(avg);
  }

  // Standard formula: (planned hours – downtime) / planned hours
  const summary = aggregateBreakdownRecords(breakdowns, mKey);
  const planned = machineCount * HOURS_PER_MONTH;
  return Math.max(0, round1(((planned - summary.downtimeHours) / planned) * 100));
}

export function pmStats(pms) {
  const currentMonth = aggregatePMRecords(pms, monthKey(new Date()));
  const totalPlanned = pms.reduce((sum, row) => sum + (row.plannedCount || 0), 0);
  const totalDone = pms.reduce((sum, row) => sum + (row.doneCount || 0), 0);
  const totalPending = pms.reduce((sum, row) => sum + (row.pendingCount || 0), 0);
  const overdue = pms.filter((row) => (row.pendingCount || 0) > 0);
  return {
    totalLogs: pms.length,
    totalPlanned,
    totalDone,
    totalPending,
    compliance: currentMonth.compliance,
    currentMonth,
    overdue,
    upcoming: [],
  };
}

export function computeKPIs(state, totalDocuments = 0, periodFilter = 'all') {
  const { machines, breakdowns, pms } = state;
  const machinePmRecords = state.machinePmRecords || [];
  const running = machines.filter((machine) => machine.status === 'running').length;
  const maint = machines.filter((machine) => machine.status === 'maintenance').length;
  const manualDown = machines.filter((machine) => machine.status === 'breakdown').length;
  const mKey = periodFilter === 'all' ? null : periodFilter;
  const bd = aggregateBreakdownRecords(breakdowns, mKey);
  const pmSummary = aggregatePMRecords(pms, mKey);
  const pmFromRecords = aggregateMachinePmRecords(machinePmRecords, mKey);
  const machineDocs = machines.reduce((sum, machine) => sum + (machine.docs?.length || 0), 0);

  // Auto-calculate from per-machine records; fall back to manual summary if no records exist
  const plannedCount = pmFromRecords.plannedCount > 0 ? pmFromRecords.plannedCount : pmSummary.plannedCount;
  const doneCount = pmFromRecords.plannedCount > 0 ? pmFromRecords.doneCount : pmSummary.doneCount;
  const pendingCount = pmFromRecords.plannedCount > 0 ? pmFromRecords.pendingCount : pmSummary.pendingCount;
  const compliance = pmFromRecords.plannedCount > 0 ? pmFromRecords.compliance : pmSummary.compliance;

  return {
    machineCount: machines.length,
    running,
    underMaintenance: maint,
    breakdown: bd.breakdownCount,
    manualBreakdownMachines: manualDown,
    pmDue: plannedCount,
    pmCompleted: doneCount,
    pmPending: pendingCount,
    pmOverdue: pendingCount,
    pmCompliance: compliance,
    availability: computeAvailability(breakdowns, machines.length, mKey),
    mttr: bd.mttr,
    mtbf: bd.mtbf,
    totalDocuments: totalDocuments + machineDocs,
    openWorkOrders: pendingCount,
    breakdownsThisMonth: bd.breakdownCount,
    downtimeThisMonth: bd.downtimeHours,
    breakdownSectionLogs: bd.sections,
    pmSectionLogs: pmSummary.sections,
  };
}

export function monthlyBreakdownTrend(breakdowns, n = 6) {
  return lastNMonths(n).map((month) => {
    const summary = aggregateBreakdownRecords(breakdowns, month.key);
    return {
      label: month.label,
      count: summary.breakdownCount,
      downtime: summary.downtimeHours,
      mttr: summary.mttr,
      mtbf: summary.mtbf,
    };
  });
}

export function monthlyPMCompletion(pms, n = 6) {
  return lastNMonths(n).map((month) => {
    const summary = aggregatePMRecords(pms, month.key);
    return {
      label: month.label,
      planned: summary.plannedCount,
      completed: summary.doneCount,
      pending: summary.pendingCount,
      compliance: summary.compliance,
    };
  });
}

export function monthlyPMCompletionFromRecords(machinePmRecords, n = 6) {
  return lastNMonths(n).map((month) => {
    const rows = (machinePmRecords || []).filter((r) => (r.pmDate || '').slice(0, 7) === month.key);
    const planned = rows.length;
    const completed = rows.filter((r) => String(r.status || '').toLowerCase() === 'completed' || r.completed === true).length;
    const pending = planned - completed;
    const compliance = planned > 0 ? round1((completed / planned) * 100) : 0;
    return {
      label: month.label,
      planned,
      completed,
      pending,
      compliance,
    };
  });
}

export function equipmentWiseBreakdown(breakdowns) {
  const counts = {};
  breakdowns.forEach((row) => {
    if (!counts[row.section]) counts[row.section] = { label: row.section, count: 0, downtime: 0 };
    counts[row.section].count += row.breakdownCount || 0;
    counts[row.section].downtime += row.downtimeHours || 0;
  });
  return Object.values(counts)
    .map((row) => ({ ...row, downtime: round1(row.downtime) }))
    .sort((a, b) => b.count - a.count);
}

export function paretoTop10(breakdowns) {
  const rows = equipmentWiseBreakdown(breakdowns).slice(0, 10);
  const total = rows.reduce((sum, row) => sum + row.count, 0) || 1;
  let cumulative = 0;
  return rows.map((row) => {
    cumulative += row.count;
    return { ...row, cumulative: Math.round((cumulative / total) * 100) };
  });
}

export function machineWiseBreakdown(machineBreakdownLogs) {
  const counts = {};
  (machineBreakdownLogs || []).forEach((row) => {
    const key = row.machineName || row.machineCode || row.machineId || 'Unknown';
    if (!counts[key]) counts[key] = { label: key, count: 0, downtime: 0 };
    counts[key].count += 1;
    counts[key].downtime += row.downtimeHours || 0;
  });
  return Object.values(counts)
    .map((row) => ({ ...row, downtime: round1(row.downtime) }))
    .sort((a, b) => b.count - a.count);
}

export function paretoTop10Machines(machineBreakdownLogs) {
  const rows = machineWiseBreakdown(machineBreakdownLogs).slice(0, 10);
  const total = rows.reduce((sum, row) => sum + row.count, 0) || 1;
  let cumulative = 0;
  return rows.map((row) => {
    cumulative += row.count;
    return { ...row, cumulative: Math.round((cumulative / total) * 100) };
  });
}

export function breakdownByDepartment(breakdowns) {
  return equipmentWiseBreakdown(breakdowns).map((row) => ({ label: row.label, value: row.count }));
}

export function monthlyEnergy(energy, n = 6) {
  return lastNMonths(n).map((month) => ({
    label: month.label,
    kwh: Math.round(
      energy
        .filter((entry) => monthKey(entry.date || entry.createdAt) === month.key)
        .reduce((sum, entry) => sum + energyTotal(entry), 0)
    ),
  }));
}

export function monthlyEnergyOverview(energy, n = 6) {
  return lastNMonths(n).map((month) => {
    const rows = energy.filter((entry) => monthKey(entry.date || entry.createdAt) === month.key);
    return {
      label: month.label,
      fuelLitres:      Math.round(rows.reduce((sum, e) => sum + (e.fuelConsumedLitres || 0), 0)),
      solarKwh:        Math.round(rows.reduce((sum, e) => sum + (e.solarGenerationKwh || 0), 0)),
      dg500RunHours:   round1(rows.reduce((sum, e) => sum + (e.dg500RunHours || 0), 0)),
      dg380RunHours:   round1(rows.reduce((sum, e) => sum + (e.dg380RunHours || 0), 0)),
      // backward-compat key used by existing Dashboard chart
      dgRunHours:      round1(rows.reduce((sum, e) => sum + (e.dg500RunHours || 0) + (e.dg380RunHours || 0), 0)),
      unit1Kwh:        Math.round(rows.reduce((sum, e) => sum + (e.uhbvnlUnit1Kwh || 0), 0)),
      unit2Kwh:        Math.round(rows.reduce((sum, e) => sum + (e.uhbvnlUnit2Kwh || 0), 0)),
      totalGridKwh:    Math.round(rows.reduce((sum, e) => sum + (e.totalGridKwh || 0), 0)),
      totalKwh:        Math.round(rows.reduce((sum, e) => sum + (e.totalKwh || e.kwh || 0), 0)),
    };
  });
}

export function machineStatusDistribution(machines) {
  const counts = {
    running: machines.filter((machine) => machine.status === 'running').length,
    maintenance: machines.filter((machine) => machine.status === 'maintenance').length,
    breakdown: machines.filter((machine) => machine.status === 'breakdown').length,
  };
  return [
    { label: 'Running', value: counts.running, color: '#10B981' },
    { label: 'Maintenance', value: counts.maintenance, color: '#F59E0B' },
    { label: 'Breakdown', value: counts.breakdown, color: '#EF4444' },
  ].filter((item) => item.value > 0);
}

export function healthDistribution(machines, breakdowns, pms, machinePmRecords = []) {
  const bands = { good: 0, fair: 0, poor: 0 };
  machines.forEach((machine) => {
    bands[healthBand(machineHealth(machine, breakdowns, pms, machinePmRecords))] += 1;
  });
  return [
    { label: 'Healthy (75-100%)', value: bands.good, color: '#10B981' },
    { label: 'Fair (50-74%)', value: bands.fair, color: '#F59E0B' },
    { label: 'Poor (<50%)', value: bands.poor, color: '#EF4444' },
  ];
}

export function availabilityTrend(breakdowns, machineCount, n = 6) {
  return lastNMonths(n).map((month) => {
    // Per-month override: if any breakdown row for this month has a single
    // override value, surface it as a distinct marker so charts can annotate it.
    const monthRows = breakdowns.filter((row) => summaryMonthKey(row) === month.key);
    const overrideRows = monthRows.filter((row) => row.availability_override != null);
    const isOverridden = overrideRows.length > 0 && overrideRows.length === monthRows.length;
    return {
      id: month.key,
      label: month.label,
      value: computeAvailability(breakdowns, machineCount, month.key),
      overridden: isOverridden,
      monthKey: month.key,
    };
  });
}

export function mttrTrend(breakdowns, n = 6) {
  return lastNMonths(n).map((month) => ({ label: month.label, value: computeMTTR(breakdowns, month.key) }));
}

export function mtbfTrend(breakdowns, machineCount, n = 6) {
  return lastNMonths(n).map((month) => ({
    label: month.label,
    value: computeMTBF(breakdowns, machineCount, month.key),
  }));
}

export function buildNotifications(state) {
  const { machines, breakdowns, pms } = state;
  const machinePmRecords = state.machinePmRecords || [];
  const currentKey = monthKey(new Date());
  const notifications = [];
  const currentBreakdowns = breakdowns.filter((row) => summaryMonthKey(row) === currentKey && (row.breakdownCount || 0) > 0);
  const currentPMs = pms.filter((row) => summaryMonthKey(row) === currentKey && (row.pendingCount || 0) > 0);

  const pmAuto = aggregateMachinePmRecords(machinePmRecords, currentKey);
  if (pmAuto.plannedCount > 0 && pmAuto.pendingCount > 0) {
    notifications.push({
      id: 'pm-auto-pending',
      type: 'warning',
      title: 'PM Pending (Auto)',
      detail: `${pmAuto.pendingCount} pending against ${pmAuto.plannedCount} planned from machine records for ${formatPeriodKey(currentKey, true)}`,
      ts: new Date().toISOString(),
    });
  }

  currentPMs.forEach((row) => {
    notifications.push({
      id: `pm-${row.id}`,
      type: 'warning',
      title: 'PM Pending',
      detail: `${row.section} · ${row.pendingCount} pending against ${row.plannedCount || 0} planned for ${formatPeriodKey(currentKey, true)}`,
      ts: row.updatedAt || row.createdAt,
    });
  });

  currentBreakdowns.forEach((row) => {
    notifications.push({
      id: `bd-${row.id}`,
      type: 'danger',
      title: 'Breakdown Summary Logged',
      detail: `${row.section} · ${row.breakdownCount} breakdowns · ${row.downtimeHours} downtime hrs`,
      ts: row.updatedAt || row.createdAt,
    });
  });

  machines.forEach((machine) => {
    const health = machineHealth(machine, breakdowns, pms);
    if (health < 50) {
      notifications.push({
        id: `health-${machine.id}`,
        type: 'warning',
        title: 'Low Machine Health',
        detail: `${machine.name} health is ${health}% based on section reliability trends`,
        ts: new Date().toISOString(),
      });
    }
  });

  const availability = computeAvailability(breakdowns, machines.length, currentKey);
  if (availability < 90 && machines.length) {
    notifications.push({
      id: 'availability',
      type: 'warning',
      title: 'Low Plant Availability',
      detail: `Plant availability is ${availability}% for ${formatPeriodKey(currentKey, true)}`,
      ts: new Date().toISOString(),
    });
  }

  return notifications.sort((a, b) => new Date(b.ts) - new Date(a.ts));
}

export function buildInsights(state) {
  const { machines, breakdowns, pms } = state;
  const machinePmRecords = state.machinePmRecords || [];
  const currentKey = monthKey(new Date());
  const insights = [];
  if (!machines.length) return insights;

  const currentBreakdown = aggregateBreakdownRecords(breakdowns, currentKey);
  const currentPmManual = aggregatePMRecords(pms, currentKey);
  const currentPmAuto = aggregateMachinePmRecords(machinePmRecords, currentKey);
  const currentPm = currentPmAuto.plannedCount > 0 ? currentPmAuto : currentPmManual;
  const sections = equipmentWiseBreakdown(breakdowns);
  const worstSection = sections[0];

  if (worstSection && worstSection.count > 0) {
    insights.push({
      id: 'ai-worst-section',
      severity: worstSection.count >= 5 ? 'high' : 'medium',
      title: 'Most Affected Section',
      text: `${worstSection.label} has logged ${worstSection.count} breakdowns and ${worstSection.downtime} downtime hours across the captured summaries.`,
    });
  }

  if (currentPm.pendingCount > 0) {
    const topPending = [...pms]
      .sort((a, b) => (b.pendingCount || 0) - (a.pendingCount || 0))
      .find((row) => (row.pendingCount || 0) > 0);
    insights.push({
      id: 'ai-pm-backlog',
      severity: currentPm.pendingCount >= 10 ? 'high' : 'medium',
      title: 'PM Backlog',
      text: `${currentPm.pendingCount} PM activities remain pending this month${topPending ? `, led by ${topPending.section}` : ''}. Clearing the backlog will lift compliance faster than adding new schedules.`,
    });
  }

  const weakest = [...machines]
    .map((machine) => ({ machine, health: machineHealth(machine, breakdowns, pms) }))
    .sort((a, b) => a.health - b.health)[0];
  if (weakest && weakest.health < 65) {
    insights.push({
      id: 'ai-watchlist',
      severity: weakest.health < 50 ? 'high' : 'medium',
      title: 'Machine Watchlist',
      text: `${weakest.machine.name} is trending at ${weakest.health}% health because its section is carrying higher downtime and weaker PM compliance.`,
    });
  }

  insights.push({
    id: 'ai-summary',
    severity: 'info',
    title: 'Monthly Performance Summary',
    text: `${currentBreakdown.breakdownCount} breakdowns, ${currentBreakdown.downtimeHours} downtime hrs, MTTR ${currentBreakdown.mttr} hrs, MTBF ${currentBreakdown.mtbf} hrs, and PM compliance ${currentPm.compliance}% captured for ${formatPeriodKey(currentKey, true)}.`,
  });

  return insights;
}

export function failureCausePareto(machineBreakdownLogs, monthFilter = null) {
  const causeCounts = {};
  const logs = monthFilter
    ? (machineBreakdownLogs || []).filter((l) => (l.date || '').slice(0, 7) === monthFilter)
    : (machineBreakdownLogs || []);

  logs.forEach((log) => {
    const raw = String(log.failureCause || '').trim();
    if (!raw) return;
    const normalized = normalizeCauseCategory(raw);
    if (!causeCounts[normalized]) {
      causeCounts[normalized] = { label: normalized, count: 0, downtime: 0 };
    }
    causeCounts[normalized].count += 1;
    causeCounts[normalized].downtime += log.downtimeHours || 0;
  });

  const rows = Object.values(causeCounts)
    .map((r) => ({ ...r, downtime: round1(r.downtime) }))
    .sort((a, b) => b.count - a.count);

  const total = rows.reduce((sum, r) => sum + r.count, 0) || 1;
  let cumulative = 0;
  return rows.map((r) => {
    cumulative += r.count;
    return {
      ...r,
      percent: round1((r.count / total) * 100),
      cumulative: Math.round((cumulative / total) * 100),
    };
  });
}

const CAUSE_CATEGORY_MAP = {
  mechanical: 'Mechanical',
  electrical: 'Electrical',
  instrumentation: 'Instrumentation',
  pneumatic: 'Pneumatic',
  process: 'Process',
  utility: 'Utility',
  other: 'Other',
};

const CAUSE_KEYWORDS = [
  { keywords: ['bearing', 'gear', 'shaft', 'coupling', 'alignment', 'vibration', 'lubrication', 'seal', 'gasket', 'valve', 'pump', 'impeller', 'spring', 'mechanical', 'wear', 'breakage', 'crack', 'bolt', 'nut', 'weld', 'hydraulic', 'filter', 'belt', 'chain', 'sprocket', 'roller', 'motor mount', 'structural'], category: 'Mechanical' },
  { keywords: ['electrical', 'wire', 'cable', 'relay', 'contactor', 'fuse', 'circuit', 'switch', 'panel', 'motor', 'inverter', 'vfd', 'plc', 'sensor', 'thermocouple', 'thermostat', 'overload', 'short circuit', 'earth fault', 'power supply', 'transformer', 'capacitor', 'breaker', 'mccb', 'mcb'], category: 'Electrical' },
  { keywords: ['instrument', 'transmitter', 'controller', 'indicator', 'calibration', 'drift', 'display', 'hmi', 'scada', 'signal', 'communication', 'profibus', 'modbus', 'analog', 'digital'], category: 'Instrumentation' },
  { keywords: ['pneumatic', 'air', 'compressor', 'solenoid', 'cylinder', 'air valve', 'air filter', 'regulator', 'fRL', 'actuator'], category: 'Pneumatic' },
  { keywords: ['process', 'temperature', 'pressure', 'flow', 'level', 'viscosity', 'concentration', 'ph', 'reaction', 'batch', 'recipe', 'mixing', 'heating', 'cooling', 'drying', 'screening'], category: 'Process' },
  { keywords: ['utility', 'water', 'steam', 'chilled', 'cooling tower', 'boiler', 'compressor air', 'plant air', 'vacuum', 'drain', 'sewage'], category: 'Utility' },
];

function normalizeCauseCategory(raw) {
  const lower = raw.toLowerCase().trim();
  if (!lower) return 'Other';
  for (const rule of CAUSE_KEYWORDS) {
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule.category;
  }
  const direct = CAUSE_CATEGORY_MAP[lower];
  if (direct) return direct;
  for (const [, canonical] of Object.entries(CAUSE_CATEGORY_MAP)) {
    if (lower.startsWith(canonical.toLowerCase())) return canonical;
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function machineBreakdownRegister(machineBreakdownLogs, monthFilter = null) {
  const logs = monthFilter
    ? (machineBreakdownLogs || []).filter((l) => (l.date || '').slice(0, 7) === monthFilter)
    : (machineBreakdownLogs || []);

  const grouped = {};
  logs.forEach((log) => {
    const period = (log.date || '').slice(0, 7);
    if (!period) return;
    const machineKey = log.machineId || log.machineCode || log.machineName || 'Unknown';
    const key = `${period}::${machineKey}`;
    if (!grouped[key]) {
      grouped[key] = {
        period,
        machineId: log.machineId || '',
        machineCode: log.machineCode || '',
        machineName: log.machineName || '',
        plantSection: log.plantSection || '',
        breakdownCount: 0,
        downtimeHours: 0,
        mainFailureCause: '',
        causes: {},
        hasOpen: false,
      };
    }
    grouped[key].breakdownCount += 1;
    grouped[key].downtimeHours += log.downtimeHours || 0;
    const cause = String(log.failureCause || '').trim();
    if (cause) {
      grouped[key].causes[cause] = (grouped[key].causes[cause] || 0) + 1;
    }
    if (log.status !== 'closed') grouped[key].hasOpen = true;
  });

  return Object.values(grouped)
    .map((g) => {
      const mainCause = Object.entries(g.causes).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      return {
        ...g,
        downtimeHours: round1(g.downtimeHours),
        mainFailureCause: mainCause,
        status: g.hasOpen ? 'ACTIVE' : 'CLOSED',
      };
    })
    .sort((a, b) => b.period.localeCompare(a.period) || b.breakdownCount - a.breakdownCount);
}

export function currentlyUnderBreakdown(machineBreakdownLogs) {
  return (machineBreakdownLogs || [])
    .filter((log) => log.status && log.status !== 'closed')
    .sort((a, b) => (b.startTime || b.date || '').localeCompare(a.startTime || a.date || ''));
}

export function amcOverallStats(amcRecords, machines) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const records = (amcRecords || []).map((r) => {
    const endDate = r.contractEndDate ? new Date(r.contractEndDate) : null;
    const startDate = r.contractStartDate ? new Date(r.contractStartDate) : null;
    const daysRemaining = endDate
      ? Math.ceil((endDate.setHours(0,0,0,0) - today.getTime()) / (1000*60*60*24))
      : null;
    const exp = r.totalVisitsAgreed > 0
      ? Math.round(((elapsedPct(r.contractStartDate, r.contractEndDate)) / 100) * r.totalVisitsAgreed)
      : 0;
    const visitOverdue = r.totalVisitsAgreed > 0 && r.completedVisits < exp;
    let status = 'ACTIVE';
    if (daysRemaining !== null) {
      if (daysRemaining < 0) status = 'EXPIRED';
      else if (daysRemaining <= 30) status = 'EXPIRING SOON';
    }
    if (visitOverdue) status = 'VISIT OVERDUE';

    const machine = (machines || []).find((m) => m.id === r.machineId);
    return {
      ...r,
      machineName: machine?.name || r.machineId,
      machineCode: machine?.machineCode || r.machineId,
      machineSection: machine?.section || '',
      daysRemaining,
      expectedVisits: exp,
      visitOverdue,
      calculatedStatus: status,
    };
  });

  const stats = {
    total: records.length,
    active: records.filter((r) => r.calculatedStatus === 'ACTIVE').length,
    expiringSoon: records.filter((r) => r.calculatedStatus === 'EXPIRING SOON').length,
    expired: records.filter((r) => r.calculatedStatus === 'EXPIRED').length,
    visitOverdue: records.filter((r) => r.calculatedStatus === 'VISIT OVERDUE').length,
  };

  return { records, stats };
}

function elapsedPct(startStr, endStr) {
  if (!startStr || !endStr) return 0;
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  const now = Date.now();
  if (end <= start) return 0;
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
}

export function buildAMCNotifications(amcRecords, machines) {
  const notifications = [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  (amcRecords || []).forEach((r) => {
    const machine = (machines || []).find((m) => m.id === r.machineId);
    const machineName = machine?.name || r.machineId;
    const endDate = r.contractEndDate ? new Date(r.contractEndDate) : null;
    const daysRemaining = endDate
      ? Math.ceil((new Date(endDate).setHours(0,0,0,0) - today.getTime()) / (1000*60*60*24))
      : null;
    const exp = r.totalVisitsAgreed > 0
      ? Math.round((elapsedPct(r.contractStartDate, r.contractEndDate) / 100) * r.totalVisitsAgreed)
      : 0;

    if (daysRemaining !== null) {
      if (daysRemaining < 0) {
        notifications.push({
          id: `amc-expired-${r.id}`,
          type: 'danger',
          title: 'AMC Expired',
          detail: `AMC for ${machineName} expired ${Math.abs(daysRemaining)} days ago`,
          ts: r.updatedAt || r.createdAt,
        });
      } else if (daysRemaining === 0) {
        notifications.push({
          id: `amc-today-${r.id}`,
          type: 'danger',
          title: 'AMC Expires Today',
          detail: `AMC for ${machineName} expires today`,
          ts: r.updatedAt || r.createdAt,
        });
      } else if (daysRemaining <= 7) {
        notifications.push({
          id: `amc-7d-${r.id}`,
          type: 'warning',
          title: 'AMC Due in 7 Days',
          detail: `AMC for ${machineName} expires in ${daysRemaining} days`,
          ts: r.updatedAt || r.createdAt,
        });
      } else if (daysRemaining <= 15) {
        notifications.push({
          id: `amc-15d-${r.id}`,
          type: 'warning',
          title: 'AMC Due in 15 Days',
          detail: `AMC for ${machineName} expires in ${daysRemaining} days`,
          ts: r.updatedAt || r.createdAt,
        });
      } else if (daysRemaining <= 30) {
        notifications.push({
          id: `amc-30d-${r.id}`,
          type: 'info',
          title: 'AMC Due in 30 Days',
          detail: `AMC for ${machineName} expires in ${daysRemaining} days`,
          ts: r.updatedAt || r.createdAt,
        });
      }
    }

    if (r.totalVisitsAgreed > 0) {
      const expected = exp;
      if (r.completedVisits < expected) {
        notifications.push({
          id: `amc-visit-overdue-${r.id}`,
          type: 'warning',
          title: 'Service Visit Overdue',
          detail: `AMC for ${machineName}: ${r.completedVisits}/${expected} visits completed`,
          ts: r.updatedAt || r.createdAt,
        });
      }
    }
  });

  return notifications.sort((a, b) => new Date(b.ts) - new Date(a.ts));
}

// ── PM Machine-Level Analytics ──────────────────────────────────────────────

export function machineWisePM(machinePmRecords) {
  const counts = {};
  (machinePmRecords || []).forEach((row) => {
    const key = row.machineName || row.machineCode || row.machineId || 'Unknown';
    if (!counts[key]) counts[key] = { label: key, count: 0, duration: 0, sections: new Set() };
    counts[key].count += 1;
    counts[key].duration += row.durationHours || 0;
    if (row.plantSection) counts[key].sections.add(row.plantSection);
  });
  return Object.values(counts)
    .map((row) => ({ ...row, duration: round1(row.duration), sections: undefined, section: [...(row.sections || [])][0] || '' }))
    .sort((a, b) => b.count - a.count);
}

export function pmTypePareto(machinePmRecords) {
  const counts = {};
  (machinePmRecords || []).forEach((row) => {
    const type = row.pmType || row.pm_type || 'Preventive';
    if (!counts[type]) counts[type] = { label: type, count: 0 };
    counts[type].count += 1;
  });
  const sorted = Object.values(counts).sort((a, b) => b.count - a.count);
  const total = sorted.reduce((sum, row) => sum + row.count, 0) || 1;
  let cumulative = 0;
  return sorted.map((row) => {
    cumulative += row.count;
    return { ...row, cumulative: Math.round((cumulative / total) * 100) };
  });
}

export function machinePMRegister(machinePmRecords, monthFilter = null) {
  const logs = monthFilter
    ? (machinePmRecords || []).filter((l) => (l.pmDate || '').slice(0, 7) === monthFilter)
    : (machinePmRecords || []);

  const grouped = {};
  logs.forEach((log) => {
    const period = (log.pmDate || '').slice(0, 7);
    if (!period) return;
    const machineKey = log.machineId || log.machineCode || log.machineName || 'Unknown';
    const key = `${period}::${machineKey}`;
    if (!grouped[key]) {
      grouped[key] = {
        period,
        latestPmDate: log.pmDate || '',
        machineId: log.machineId || '',
        machineCode: log.machineCode || '',
        machineName: log.machineName || '',
        plantSection: log.plantSection || '',
        pmCount: 0,
        completedCount: 0,
        pendingCount: 0,
        overdueCount: 0,
        totalDuration: 0,
        mainTask: '',
        tasks: {},
        hasPending: false,
      };
    }
    grouped[key].pmCount += 1;
    grouped[key].totalDuration += log.durationHours || 0;
    if ((log.pmDate || '') > grouped[key].latestPmDate) grouped[key].latestPmDate = log.pmDate || '';
    const st = String(log.status || '').toLowerCase();
    if (st === 'completed' || log.completed === true) {
      grouped[key].completedCount += 1;
    } else if (st === 'overdue') {
      grouped[key].overdueCount += 1;
      grouped[key].hasPending = true;
    } else {
      grouped[key].pendingCount += 1;
      grouped[key].hasPending = true;
    }
    const task = String(log.task || log.pmType || '').trim();
    if (task) grouped[key].tasks[task] = (grouped[key].tasks[task] || 0) + 1;
  });

  return Object.values(grouped)
    .map((g) => {
      const mainTask = Object.entries(g.tasks).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      return {
        ...g,
        totalDuration: round1(g.totalDuration),
        mainTask,
        status: g.hasPending ? 'PENDING' : 'COMPLETED',
      };
    })
    .sort((a, b) => b.period.localeCompare(a.period) || b.pmCount - a.pmCount);
}

export function monthlyPMComplianceTrend(pms, n = 6) {
  return lastNMonths(n).map((month) => {
    const summary = aggregatePMRecords(pms, month.key);
    return {
      label: month.label,
      compliance: summary.compliance,
      planned: summary.plannedCount,
      done: summary.doneCount,
      pending: summary.pendingCount,
    };
  });
}

export function monthlyPMDurationTrend(machinePmRecords, n = 6) {
  return lastNMonths(n).map((month) => {
    const rows = (machinePmRecords || []).filter((r) => (r.pmDate || '').slice(0, 7) === month.key);
    const totalDuration = rows.reduce((sum, r) => sum + (r.durationHours || 0), 0);
    const completedRows = rows.filter((r) => r.status === 'completed' || r.completed === true);
    const avgDuration = completedRows.length > 0 ? totalDuration / completedRows.length : 0;
    return {
      label: month.label,
      totalDuration: round1(totalDuration),
      avgDuration: round1(avgDuration),
      recordCount: rows.length,
    };
  });
}

export function monthlyPMComplianceTrendFromRecords(machinePmRecords, n = 12) {
  return lastNMonths(n).map((month) => {
    const rows = (machinePmRecords || []).filter(
      (r) => (r.pmDate || '').slice(0, 7) === month.key
    );
    const planned = rows.length;
    const completed = rows.filter(
      (r) => String(r.status || '').toLowerCase() === 'completed' || r.completed === true
    ).length;
    const compliance = planned > 0 ? Math.round((completed / planned) * 100) : 0;
    return {
      label: month.label,
      compliance,
      planned,
      done: completed,
      pending: planned - completed,
    };
  });
}

// ── Shared Daily-Delta Calculator ─────────────────────────────────────────────
// Cumulative meter readings must be diffed per-unit, sorted ascending by date,
// with negative deltas (meter resets) clamped to null.

const READING_KEYS = [
  'u1ImportKwhReading', 'u1ImportKvahReading', 'u1ExportKwhReading', 'u1ExportKvahReading',
  'u1SolarKwhReading', 'u1SolarKvahReading',
  'u2ImportKwhReading', 'u2ImportKvahReading', 'u2ExportKwhReading', 'u2ExportKvahReading',
  'u2SolarKwhReading', 'u2SolarKvahReading',
  'dg380KwhReading', 'dg380HourmeterReading', 'dg500KwhReading', 'dg500HourmeterReading',
];

function safeNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/**
 * Compute daily deltas from cumulative readings.
 * @param {Array} logs – array of daily utility log records (raw, unsorted)
 * @returns {Array} sorted descending, each row augmented with _delta object
 */
export function computeDailyDeltas(logs) {
  if (!logs || logs.length === 0) return [];
  const sorted = [...logs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return sorted.map((row, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    const delta = {};
    READING_KEYS.forEach((k) => {
      const cur = safeNum(row[k]);
      const prv = safeNum(prev?.[k]);
      const d = cur - prv;
      delta[k] = (prev && d < 0) ? null : (prev ? d : null);
    });
    // Direct values (not cumulative — use as-is)
    delta.dg380HsdAddedLtr = safeNum(row.dg380HsdAddedLtr);
    delta.dg380DefAddedPct = safeNum(row.dg380DefAddedPct);
    delta.dg500HsdAddedLtr = safeNum(row.dg500HsdAddedLtr);
    delta.dg500DefAddedPct = safeNum(row.dg500DefAddedPct);
    delta.u1Pf = safeNum(row.u1Pf);
    delta.u2Pf = safeNum(row.u2Pf);
    return { ...row, _delta: delta };
  }).reverse(); // most-recent first
}

// ── Domain A: Daily Utility Calculations ─────────────────────────────────────

export function computeDailyUtilityDerived(current, previous, settings) {
  const s = settings || {};
  const u1SolarCt = Number(s.u1SolarCt) || 0;
  const u2SolarCt = Number(s.u2SolarCt) || 0;
  const pfWarningThreshold = Number(s.pfWarningThreshold) || 0.9;
  const gridCo2EmissionFactor = Number(s.gridCo2EmissionFactor) || 0;
  const installedCapacity = Number(s.installedSolarCapacityKwp) || 0;
  const peakSunHours = Number(s.avgPeakSunHoursPerDay) || 0;

  const c = current || {};
  const p = previous || {};
  const warnings = [];

  const diffCheck = (label, cur, prev) => {
    if (Number(cur) < Number(prev) && Number(prev) > 0) {
      warnings.push(`${label} meter appears to have reset (current ${cur} < previous ${prev})`);
    }
  };

  // U1 grid
  diffCheck('U1 Import kWh', c.u1ImportKwh, p.u1ImportKwh);
  const u1ImportKwh = round1((Number(c.u1ImportKwh) || 0) - (Number(p.u1ImportKwh) || 0));
  const u1ImportKvah = round1((Number(c.u1ImportKvah) || 0) - (Number(p.u1ImportKvah) || 0));
  const u1Pf = u1ImportKvah > 0 ? round1(u1ImportKwh / u1ImportKvah) : 0;

  // U1 export
  diffCheck('U1 Export kWh', c.u1ExportKwh, p.u1ExportKwh);
  const u1ExportKwh = round1((Number(c.u1ExportKwh) || 0) - (Number(p.u1ExportKwh) || 0));
  const u1ExportKvah = round1((Number(c.u1ExportKvah) || 0) - (Number(p.u1ExportKvah) || 0));

  // U1 solar
  const u1SolarKwh = round1(((Number(c.u1SolarKwh) || 0) - (Number(p.u1SolarKwh) || 0)) * u1SolarCt);

  // U2 grid
  diffCheck('U2 Import kWh', c.u2ImportKwh, p.u2ImportKwh);
  const u2ImportKwh = round1((Number(c.u2ImportKwh) || 0) - (Number(p.u2ImportKwh) || 0));
  const u2ImportKvah = round1((Number(c.u2ImportKvah) || 0) - (Number(p.u2ImportKvah) || 0));
  const u2Pf = u2ImportKvah > 0 ? round1(u2ImportKwh / u2ImportKvah) : 0;

  // U2 export
  diffCheck('U2 Export kWh', c.u2ExportKwh, p.u2ExportKwh);
  const u2ExportKwh = round1((Number(c.u2ExportKwh) || 0) - (Number(p.u2ExportKwh) || 0));
  const u2ExportKvah = round1((Number(c.u2ExportKvah) || 0) - (Number(p.u2ExportKvah) || 0));

  // U2 solar
  const u2SolarKwh = round1(((Number(c.u2SolarKwh) || 0) - (Number(p.u2SolarKwh) || 0)) * u2SolarCt);

  // DG 380
  diffCheck('DG380 kWh', c.dg380Kwh, p.dg380Kwh);
  const dg380Generation = round1((Number(c.dg380Kwh) || 0) - (Number(p.dg380Kwh) || 0));
  diffCheck('DG380 hourmeter', c.dg380Hourmeter, p.dg380Hourmeter);
  const dg380RunHours = round1((Number(c.dg380Hourmeter) || 0) - (Number(p.dg380Hourmeter) || 0));
  const dg380Opening = Number(p.dg380FuelAdded) != null ? Number(p.dg380FuelAdded) : (Number(c.dg380Opening) || 0);
  const dg380FuelConsumed = round1(dg380Opening + (Number(c.dg380FuelAdded) || 0) - (Number(c.dg380Closing) || 0));
  const dg380KwhPerLitre = dg380FuelConsumed > 0 ? round1(dg380Generation / dg380FuelConsumed) : 0;

  // DG 500
  diffCheck('DG500 kWh', c.dg500Kwh, p.dg500Kwh);
  const dg500Generation = round1((Number(c.dg500Kwh) || 0) - (Number(p.dg500Kwh) || 0));
  diffCheck('DG500 hourmeter', c.dg500Hourmeter, p.dg500Hourmeter);
  const dg500RunHours = round1((Number(c.dg500Hourmeter) || 0) - (Number(p.dg500Hourmeter) || 0));
  const dg500Opening = Number(p.dg500FuelAdded) != null ? Number(p.dg500FuelAdded) : (Number(c.dg500Opening) || 0);
  const dg500FuelConsumed = round1(dg500Opening + (Number(c.dg500FuelAdded) || 0) - (Number(c.dg500Closing) || 0));
  const dg500KwhPerLitre = dg500FuelConsumed > 0 ? round1(dg500Generation / dg500FuelConsumed) : 0;

  // Totals
  const totalGridKwh = round1(u1ImportKwh + u2ImportKwh);
  const totalDgKwh = round1(dg380Generation + dg500Generation);
  const totalSolarKwh = round1(u1SolarKwh + u2SolarKwh);
  const totalEnergyKwh = round1(totalGridKwh + totalDgKwh + totalSolarKwh);

  const gridSharePct = totalEnergyKwh > 0 ? round1((totalGridKwh / totalEnergyKwh) * 100) : 0;
  const dgSharePct = totalEnergyKwh > 0 ? round1((totalDgKwh / totalEnergyKwh) * 100) : 0;
  const solarSharePct = totalEnergyKwh > 0 ? round1((totalSolarKwh / totalEnergyKwh) * 100) : 0;

  // PF warnings
  if (u1Pf > 0 && u1Pf < pfWarningThreshold) {
    warnings.push(`U1 Power Factor (${u1Pf}) is below threshold (${pfWarningThreshold})`);
  }
  if (u2Pf > 0 && u2Pf < pfWarningThreshold) {
    warnings.push(`U2 Power Factor (${u2Pf}) is below threshold (${pfWarningThreshold})`);
  }

  return {
    u1ImportKwh, u1ImportKvah, u1Pf,
    u1ExportKwh, u1ExportKvah, u1SolarKwh,
    u2ImportKwh, u2ImportKvah, u2Pf,
    u2ExportKwh, u2ExportKvah, u2SolarKwh,
    dg380Generation, dg380RunHours, dg380FuelConsumed, dg380KwhPerLitre,
    dg500Generation, dg500RunHours, dg500FuelConsumed, dg500KwhPerLitre,
    totalGridKwh, totalDgKwh, totalSolarKwh, totalEnergyKwh,
    gridSharePct, dgSharePct, solarSharePct,
    warnings,
  };
}

// ── Domain B: Monthly Section Consumption (Herbicide) ────────────────────────

const HERBICIDE_FEEDERS = [
  'glyphosateM1', 'glyphosateM2', 'glufosinateM1', 'glufosinateM2',
  '24dM1', '24dM2', 'metribuzinM1', 'metribuzinM2',
  'oxyfluorfenM1', 'oxyfluorfenM2', 'pendimethalinM1', 'pendimethalinM2',
];

export function computeHerbicideConsumption(current, previous) {
  const warnings = [];
  const feeders = {};
  let totalKwh = 0;

  HERBICIDE_FEEDERS.forEach((key) => {
    const cur = Number(current?.[key]) || 0;
    const prev = Number(previous?.[key]) || 0;
    let consumption = cur - prev;
    if (consumption < 0 && prev > 0) {
      warnings.push(`${key} meter appears to have reset (current ${cur} < previous ${prev})`);
      consumption = 0;
    }
    feeders[key] = round1(consumption);
    totalKwh += consumption;
  });

  return { feeders, totalKwh: round1(totalKwh), warnings };
}

// ── Domain B: Monthly Section Consumption (Insecticide) ──────────────────────

const INSECTICIDE_FEEDERS = [
  'chlorpyrifosM1', 'chlorpyrifosM2', 'cypermethrinM1', 'cypermethrinM2',
  'imidaclopridM1', 'imidaclopridM2', 'thiamethoxamM1', 'thiamethoxamM2',
  'lambdaCyalothrinM1', 'lambdaCyalothrinM2', 'acetamipridM1', 'acetamipridM2',
  'profenofosM1',
];

export function computeInsecticideConsumption(current, previous) {
  const warnings = [];
  const feeders = {};
  let totalKwh = 0;

  INSECTICIDE_FEEDERS.forEach((key) => {
    const cur = Number(current?.[key]) || 0;
    const prev = Number(previous?.[key]) || 0;
    let consumption = cur - prev;
    if (consumption < 0 && prev > 0) {
      warnings.push(`${key} meter appears to have reset (current ${cur} < previous ${prev})`);
      consumption = 0;
    }
    feeders[key] = round1(consumption);
    totalKwh += consumption;
  });

  return { feeders, totalKwh: round1(totalKwh), warnings };
}

// ── Domain C: Monthly Water Consumption ──────────────────────────────────────

export function computeWaterConsumption(current, previous) {
  const warnings = [];
  const keys = ['stpOutletKl', 'roInletKl', 'roRejectedKl', 'piauWaterKl'];
  const result = {};

  keys.forEach((key) => {
    const cur = Number(current?.[key]) || 0;
    const prev = Number(previous?.[key]) || 0;
    let consumption = cur - prev;
    if (consumption < 0 && prev > 0) {
      warnings.push(`${key} meter appears to have reset (current ${cur} < previous ${prev})`);
      consumption = 0;
    }
    result[key] = round1(consumption);
  });

  result.totalWaterKl = round1(
    result.stpOutletKl + result.roInletKl + result.roRejectedKl + result.piauWaterKl
  );
  result.warnings = warnings;
  return result;
}

// ── Domain D: Air Compressor Performance ─────────────────────────────────────

export function computeAirCompressorPerformance(current, previous) {
  const compressors = [1, 2, 3];
  return compressors.map((id) => {
    const c = current || {};
    const p = previous || {};
    const runHours = round1((Number(c[`compressor${id}RunHours`]) || 0) - (Number(p[`compressor${id}RunHours`]) || 0));
    const loadHours = round1((Number(c[`compressor${id}LoadHours`]) || 0) - (Number(p[`compressor${id}LoadHours`]) || 0));
    const unloadHours = round1(Math.max(0, runHours - loadHours));
    const loadPct = runHours > 0 ? round1((loadHours / runHours) * 100) : 0;
    return { compressor: id, runHours, loadHours, unloadHours, loadPct };
  });
}

// ── Domain D: Renewable Energy Summary ───────────────────────────────────────

export function computeRenewableSummary(dailyUtilityLogs, dailySolarLogs, energySettings, monthKey_) {
  const deltas = computeDailyDeltas(dailyUtilityLogs || []).filter((d) => !monthKey_ || (d.date || '').slice(0, 7) === monthKey_);
  const solarLogs = (dailySolarLogs || []).filter((l) => !monthKey_ || (l.date || '').slice(0, 7) === monthKey_);
  const s = energySettings || {};

  // Process solar logs through energy engine to fix grand total = 0 bug
  const processedSolarLogs = solarLogs.map(l => {
    const u1_inv1 = Number(l.u1_inv1_kwh || l.u1_inv1 || 0);
    const u1_inv2 = Number(l.u1_inv2_kwh || l.u1_inv2 || 0);
    const u1_inv3 = Number(l.u1_inv3_kwh || l.u1_inv3 || 0);
    const u1_inv4 = Number(l.u1_inv4_kwh || l.u1_inv4 || 0);
    const u2_inv1 = Number(l.u2_inv1_kwh || l.u2_inv1 || 0);
    const u2_inv2 = Number(l.u2_inv2_kwh || l.u2_inv2 || 0);
    const u2_inv3 = Number(l.u2_inv3_kwh || l.u2_inv3 || 0);
    
    const u1_total = Number((u1_inv1 + u1_inv2 + u1_inv3 + u1_inv4).toFixed(2));
    const u2_total = Number((u2_inv1 + u2_inv2 + u2_inv3).toFixed(2));
    const grand_total = Number((u1_total + u2_total).toFixed(2));
    
    return { ...l, u1_total, u2_total, grand_total, daily_total_kwh: grand_total };
  });

  // Solar from inverter logs - use grand_total (fixed)
  const solarFromInverters = round1(
    processedSolarLogs.reduce((sum, l) => sum + (Number(l.grand_total) || 0), 0)
  );

  // Meter-side solar from daily utility (using deltas) - import and export
  const meterSideSolarImport = round1(
    deltas.reduce((sum, d) => sum + (Number(d._delta?.u1SolarKwhReading) || 0) + (Number(d._delta?.u2SolarKwhReading) || 0), 0)
  );
  const meterSideSolarExport = round1(
    deltas.reduce((sum, d) => sum + (Number(d._delta?.u1ExportKwhReading) || 0) + (Number(d._delta?.u2ExportKwhReading) || 0), 0)
  );

  // Total plant consumption from utility (using deltas)
  const totalPlantConsumption = round1(
    deltas.reduce((sum, d) => {
      const grid = (Number(d._delta?.u1ImportKwhReading) || 0) + (Number(d._delta?.u2ImportKwhReading) || 0);
      const dg = (Number(d._delta?.dg380KwhReading) || 0) + (Number(d._delta?.dg500KwhReading) || 0);
      const solar = (Number(d._delta?.u1SolarKwhReading) || 0) + (Number(d._delta?.u2SolarKwhReading) || 0);
      return sum + grid + dg + solar;
    }, 0)
  );

  const renewableSharePct = totalPlantConsumption > 0
    ? round1((solarFromInverters / totalPlantConsumption) * 100)
    : 0;

  // Performance ratio
  const installedCapacity = Number(s.installedSolarCapacityKwp) || 0;
  const peakSunHours = Number(s.avgPeakSunHoursPerDay) || 0;
  const daysInMonth = monthKey_ ? (new Date(Number(monthKey_.split('-')[0]), Number(monthKey_.split('-')[1]), 0).getDate() || 30) : 30;
  const expectedSolar = installedCapacity * peakSunHours * daysInMonth;
  const performanceRatio = expectedSolar > 0 ? round1((solarFromInverters / expectedSolar) * 100) : 0;

  // CO2 avoided
  const gridCo2EmissionFactor = Number(s.gridCo2EmissionFactor) || 0;
  const co2AvoidedKg = round1(solarFromInverters * gridCo2EmissionFactor);

  // Cross-check
  const solarCrossCheck = meterSideSolarImport > 0
    ? round1(Math.abs(solarFromInverters - meterSideSolarImport) / meterSideSolarImport * 100)
    : 0;
  const warnings = [];
  if (solarCrossCheck > 10) {
    warnings.push('Solar Metering Cross-Check Required');
  }

  return {
    solarFromInverters,
    meterSideSolarImport,
    meterSideSolarExport,
    totalPlantConsumption,
    renewableSharePct,
    performanceRatio,
    co2AvoidedKg,
    solarCrossCheck,
    warnings,
  };
}

// ── Domain D: Power Factor Trend ─────────────────────────────────────────────

export function computePfTrend(dailyUtilityLogs, n = 12, periodFilter = 'all') {
  const deltas = computeDailyDeltas(dailyUtilityLogs || []);
  const filtered = periodFilter === 'all' ? deltas : deltas.filter((d) => String(d.date || '').slice(0, 7) === periodFilter);
  const last = filtered.slice(-n);

  return last.map((d) => {
    const u1ImportKwh = Number(d._delta?.u1ImportKwhReading) || 0;
    const u1ImportKvah = Number(d._delta?.u1ImportKvahReading) || 0;
    const u2ImportKwh = Number(d._delta?.u2ImportKwhReading) || 0;
    const u2ImportKvah = Number(d._delta?.u2ImportKvahReading) || 0;
    
    // Use dynamic PF calculation
    const { u1_pf, u2_pf, combined_pf } = computeDynamicPowerFactors(
      u1ImportKwh, u1ImportKvah, u2ImportKwh, u2ImportKvah
    );
    
    return {
      date: d.date || '',
      u1Pf: u1_pf > 0 ? Number(formatPowerFactor(u1_pf)) : null,
      u2Pf: u2_pf > 0 ? Number(formatPowerFactor(u2_pf)) : null,
      avgPf: combined_pf > 0 ? Number(formatPowerFactor(combined_pf)) : null,
      label: (d.date || '').slice(5),
    };
  });
}

// ── Domain D: DG Fuel Efficiency Trend ───────────────────────────────────────

export function computeDgFuelEfficiency(dailyUtilityLogs, n = 6, periodFilter = 'all') {
  const months = lastNMonths(n);
  const deltas = computeDailyDeltas(dailyUtilityLogs || []);
  const filtered = periodFilter === 'all' ? deltas : deltas.filter((d) => String(d.date || '').slice(0, 7) === periodFilter);

  return months.map((month) => {
    const monthDeltas = filtered.filter((d) => (d.date || '').slice(0, 7) === month.key);

    let dg380Generation = 0;
    let dg380Fuel = 0;
    let dg500Generation = 0;
    let dg500Fuel = 0;

    monthDeltas.forEach((d) => {
      dg380Generation += Number(d._delta?.dg380KwhReading) || 0;
      dg380Fuel += Number(d._delta?.dg380HsdAddedLtr) || 0;
      dg500Generation += Number(d._delta?.dg500KwhReading) || 0;
      dg500Fuel += Number(d._delta?.dg500HsdAddedLtr) || 0;
    });

    return {
      label: month.label,
      dg380KwhPerLitre: dg380Fuel > 0 ? round1(dg380Generation / dg380Fuel) : 0,
      dg500KwhPerLitre: dg500Fuel > 0 ? round1(dg500Generation / dg500Fuel) : 0,
    };
  });
}
