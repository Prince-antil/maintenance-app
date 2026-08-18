export const HOURS_PER_MONTH = 720;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const isThisMonth = (value) => value && monthKey(value) === monthKey(new Date());
const isToday = (value) => value && new Date(value).toDateString() === new Date().toDateString();
const energyTotal = (entry) => (entry.source ? (entry.kwh || 0) : (entry.solarGenerationKwh || 0));
const round1 = (value) => Math.round((Number(value) || 0) * 10) / 10;

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

export function machineHealth(machine, breakdowns, pms) {
  const recentKeys = recentPeriodKeys(3);
  const sectionBreakdowns = breakdowns.filter((row) => row.section === machine.section && recentKeys.has(summaryMonthKey(row)));
  const sectionPMs = pms.filter((row) => row.section === machine.section && recentKeys.has(summaryMonthKey(row)));
  const bdSummary = aggregateBreakdownRecords(sectionBreakdowns);
  const pmSummary = aggregatePMRecords(sectionPMs);

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

export function computeKPIs(state, totalDocuments = 0) {
  const { machines, breakdowns, pms, energy } = state;
  const running = machines.filter((machine) => machine.status === 'running').length;
  const maint = machines.filter((machine) => machine.status === 'maintenance').length;
  const manualDown = machines.filter((machine) => machine.status === 'breakdown').length;
  const currentKey = monthKey(new Date());
  const bd = aggregateBreakdownRecords(breakdowns, currentKey);
  const pm = aggregatePMRecords(pms, currentKey);
  const energyToday = energy
    .filter((entry) => isToday(entry.date || entry.createdAt))
    .reduce((sum, entry) => sum + energyTotal(entry), 0);
  const energyThisMonth = energy.filter((entry) => monthKey(entry.date || entry.createdAt) === currentKey);
  const unit1KwhMonth  = Math.round(energyThisMonth.reduce((s, e) => s + (e.uhbvnlUnit1Kwh || 0), 0));
  const unit2KwhMonth  = Math.round(energyThisMonth.reduce((s, e) => s + (e.uhbvnlUnit2Kwh || 0), 0));
  const totalGridMonth = Math.round(energyThisMonth.reduce((s, e) => s + (e.totalGridKwh || 0), 0)) || (unit1KwhMonth + unit2KwhMonth);
  const solarMonth     = Math.round(energyThisMonth.reduce((s, e) => s + (e.solarGenerationKwh || 0), 0));
  const dg500HrsMonth  = round1(energyThisMonth.reduce((s, e) => s + (e.dg500RunHours || 0), 0));
  const dg380HrsMonth  = round1(energyThisMonth.reduce((s, e) => s + (e.dg380RunHours || 0), 0));
  const fuelMonth      = Math.round(energyThisMonth.reduce((s, e) => s + (e.fuelConsumedLitres || 0), 0));
  const machineDocs = machines.reduce((sum, machine) => sum + (machine.docs?.length || 0), 0);

  return {
    machineCount: machines.length,
    running,
    underMaintenance: maint,
    breakdown: bd.breakdownCount,
    manualBreakdownMachines: manualDown,
    pmDue: pm.plannedCount,
    pmCompleted: pm.doneCount,
    pmPending: pm.pendingCount,
    pmOverdue: pm.pendingCount,
    pmCompliance: pm.compliance,
    availability: computeAvailability(breakdowns, machines.length, currentKey),
    mttr: bd.mttr,
    mtbf: bd.mtbf,
    totalDocuments: totalDocuments + machineDocs,
    energyToday: Math.round(energyToday),
    // ── Energy detail ──────────────────────────────────────────────────────
    unit1KwhMonth,
    unit2KwhMonth,
    totalGridMonth,
    solarMonth,
    dg500HrsMonth,
    dg380HrsMonth,
    fuelMonth,
    openWorkOrders: pm.pendingCount,
    breakdownsThisMonth: bd.breakdownCount,
    downtimeThisMonth: bd.downtimeHours,
    breakdownSectionLogs: bd.sections,
    pmSectionLogs: pm.sections,
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

export function healthDistribution(machines, breakdowns, pms) {
  const bands = { good: 0, fair: 0, poor: 0 };
  machines.forEach((machine) => {
    bands[healthBand(machineHealth(machine, breakdowns, pms))] += 1;
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
      label: month.label,
      value: computeAvailability(breakdowns, machineCount, month.key),
      overridden: isOverridden,
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
  const currentKey = monthKey(new Date());
  const notifications = [];
  const currentBreakdowns = breakdowns.filter((row) => summaryMonthKey(row) === currentKey && (row.breakdownCount || 0) > 0);
  const currentPMs = pms.filter((row) => summaryMonthKey(row) === currentKey && (row.pendingCount || 0) > 0);

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
  const currentKey = monthKey(new Date());
  const insights = [];
  if (!machines.length) return insights;

  const currentBreakdown = aggregateBreakdownRecords(breakdowns, currentKey);
  const currentPm = aggregatePMRecords(pms, currentKey);
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
