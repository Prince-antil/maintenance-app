/**
 * Canonical Energy Calculations - Single Source of Truth
 * Works with actual store field names (camelCase from Supabase)
 * All Solar and Daily Utility calculations go through this layer.
 */

// ============================================================
// ENERGY FORMATTER
// ============================================================
export function formatEnergy(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

export function formatEnergyPrecise(value, decimals = 1) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

// ============================================================
// SOLAR CALCULATIONS (Canonical)
// ============================================================

/**
 * Get solar derived values from a raw store row (camelCase field names)
 * @param {Object} row - Raw solar row from store
 * @returns {Object} { u1Total, u2Total, grandTotal, u1Inv1, u1Inv2, u1Inv3, u1Inv4, u2Inv1, u2Inv2, u2Inv3 }
 */
export function getSolarDerived(row) {
  const u1Inv1 = Number(row.u1Inv1Kwh ?? row.u1_inv1_kwh ?? row.u1Inv1 ?? 0);
  const u1Inv2 = Number(row.u1Inv2Kwh ?? row.u1_inv2_kwh ?? row.u1Inv2 ?? 0);
  const u1Inv3 = Number(row.u1Inv3Kwh ?? row.u1_inv3_kwh ?? row.u1Inv3 ?? 0);
  const u1Inv4 = Number(row.u1Inv4Kwh ?? row.u1_inv4_kwh ?? row.u1Inv4 ?? 0);
  const u2Inv1 = Number(row.u2Inv1Kwh ?? row.u2_inv1_kwh ?? row.u2Inv1 ?? 0);
  const u2Inv2 = Number(row.u2Inv2Kwh ?? row.u2_inv2_kwh ?? row.u2Inv2 ?? 0);
  const u2Inv3 = Number(row.u2Inv3Kwh ?? row.u2_inv3_kwh ?? row.u2Inv3 ?? 0);
  // Direct total fallback — handles single-column uploads (Daily Total / Grand Total) where inverter breakdown is absent
  const directTotal = Number(row.dailyTotalKwh ?? row.daily_total_kwh ?? row.grandTotal ?? row.grand_total ?? row.daily_total ?? row.total_solar_kwh ?? row.solar_kwh ?? 0);
  const u1TotalRaw = Number((u1Inv1 + u1Inv2 + u1Inv3 + u1Inv4).toFixed(2));
  const u2TotalRaw = Number((u2Inv1 + u2Inv2 + u2Inv3).toFixed(2));
  const invTotal = Number((u1TotalRaw + u2TotalRaw).toFixed(2));
  const grandTotal = invTotal > 0 ? invTotal : Number((Number.isFinite(directTotal) ? directTotal : 0).toFixed(2));
  // When only direct total exists, distribute 60/40 to U1/U2 for breakdown charts (mirrors engine)
  const u1Total = u1TotalRaw > 0 ? u1TotalRaw : (invTotal === 0 && directTotal > 0 ? Number((directTotal * 0.6).toFixed(2)) : u1TotalRaw);
  const u2Total = u2TotalRaw > 0 ? u2TotalRaw : (invTotal === 0 && directTotal > 0 ? Number((directTotal - u1Total).toFixed(2)) : u2TotalRaw);
  return {
    u1Inv1,
    u1Inv2,
    u1Inv3,
    u1Inv4,
    u2Inv1,
    u2Inv2,
    u2Inv3,
    u1Total,
    u2Total,
    grandTotal,
  };
}

/**
 * Process a raw solar row for storage (adds derived fields)
 * @param {Object} row - Raw form values (camelCase)
 * @returns {Object} Row with derived fields added
 */
export function processSolarRowForSave(row) {
  const derived = getSolarDerived(row);
  return {
    ...row,
    ...derived,
    dailyTotalKwh: derived.grandTotal, // for backward compat
  };
}

/**
 * Compute solar summary from array of rows
 * @param {Array} rows - Array of solar rows (with derived fields or raw)
 * @returns {Object} Summary with u1Total, u2Total, grandTotal, dailyAvg, monthlyAvg, bestDay, latestDay
 */
export function computeSolarSummary(rows) {
  if (!rows || rows.length === 0) {
    return {
      u1Total: 0,
      u2Total: 0,
      grandTotal: 0,
      dailyAvg: 0,
      monthlyAvg: 0,
      bestDay: 0,
      latestDay: 0,
    };
  }

  // Canonical: always derive via getSolarDerived (handles direct Total fallback); prefer stored totals only when derived would be 0
  const withDerived = rows.map(row => {
    const derived = getSolarDerived(row);
    // If row already has explicit stored totals that non-zero, keep the max to avoid double-zero edge
    const u1Total = derived.u1Total > 0 ? derived.u1Total : Number(row.u1Total || 0);
    const u2Total = derived.u2Total > 0 ? derived.u2Total : Number(row.u2Total || 0);
    const grandTotal = derived.grandTotal > 0 ? derived.grandTotal : Number(row.grandTotal || row._sum || row.dailyTotalKwh || 0);
    return { ...row, u1Total, u2Total, grandTotal, ...derived, u1Total, u2Total, grandTotal };
  });

  // Sort by date descending for "latest"
  const sorted = [...withDerived].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const u1Total = withDerived.reduce((sum, r) => sum + (r.u1Total || 0), 0);
  const u2Total = withDerived.reduce((sum, r) => sum + (r.u2Total || 0), 0);
  const grandTotal = withDerived.reduce((sum, r) => sum + (r.grandTotal || 0), 0);
  const dailyAvg = withDerived.length > 0 ? Number((grandTotal / withDerived.length).toFixed(2)) : 0;
  const bestDay = withDerived.length > 0 ? Math.max(...withDerived.map(r => r.grandTotal || 0)) : 0;
  const latestDay = sorted.length > 0 ? (sorted[0].grandTotal || 0) : 0;

  // Monthly average (distinct months)
  const months = new Set(withDerived.map(r => r.date?.slice(0, 7)).filter(Boolean));
  const monthlyAvg = months.size > 0 ? Number((grandTotal / months.size).toFixed(2)) : 0;

  // Current month total (from all rows, not filtered)
  // This is handled by the caller passing appropriate rows

  return {
    u1Total: Number(u1Total.toFixed(2)),
    u2Total: Number(u2Total.toFixed(2)),
    grandTotal: Number(grandTotal.toFixed(2)),
    dailyAvg: Number(dailyAvg.toFixed(2)),
    monthlyAvg: Number(monthlyAvg.toFixed(2)),
    bestDay: Number(bestDay.toFixed(2)),
    latestDay: Number(latestDay.toFixed(2)),
  };
}

/**
 * Get current month solar generation from all rows (for Month Generation card)
 * @param {Array} allRows - All solar rows (unfiltered)
 * @returns {Number} Current month total
 */
export function getCurrentMonthSolarTotal(allRows) {
  if (!allRows || allRows.length === 0) return 0;
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return allRows
    .filter(r => r.date?.slice(0, 7) === currentMonthKey)
    .reduce((sum, r) => sum + Number(getSolarDerived(r).grandTotal || r.grandTotal || r._sum || r.dailyTotalKwh || 0), 0);
}

/**
 * Monthly aggregation for solar
 */
export function aggregateSolarByMonth(rows) {
  const monthly = {};
  
  rows.forEach(row => {
    const derived = getSolarDerived(row);
    const monthKey = row.date?.slice(0, 7) || 'unknown';
    
    if (!monthly[monthKey]) {
      monthly[monthKey] = { month: monthKey, u1Total: 0, u2Total: 0, grandTotal: 0 };
    }
    
    monthly[monthKey].u1Total += derived.u1Total;
    monthly[monthKey].u2Total += derived.u2Total;
    monthly[monthKey].grandTotal += derived.grandTotal;
  });

  return Object.values(monthly).map(m => ({
    ...m,
    u1Total: Number(m.u1Total.toFixed(2)),
    u2Total: Number(m.u2Total.toFixed(2)),
    grandTotal: Number(m.grandTotal.toFixed(2)),
  }));
}

// ============================================================
// DAILY UTILITY CALCULATIONS (Canonical)
// ============================================================

/**
 * Get utility derived values from a raw store row (camelCase field names)
 * @param {Object} row - Raw utility row from store
 * @returns {Object} All derived values
 */
export function getUtilityDerived(row) {
  const u1ImportKwh = Number(row.u1ImportKwhReading || 0);
  const u1ImportKvah = Number(row.u1ImportKvahReading || 0);
  const u1ExportKwh = Number(row.u1ExportKwhReading || 0);
  const u1ExportKvah = Number(row.u1ExportKvahReading || 0);
  const u1SolarKwh = Number(row.u1SolarKwhReading || 0);
  const u1SolarKvah = Number(row.u1SolarKvahReading || 0);
  
  const u2ImportKwh = Number(row.u2ImportKwhReading || 0);
  const u2ImportKvah = Number(row.u2ImportKvahReading || 0);
  const u2ExportKwh = Number(row.u2ExportKwhReading || 0);
  const u2ExportKvah = Number(row.u2ExportKvahReading || 0);
  const u2SolarKwh = Number(row.u2SolarKwhReading || 0);
  const u2SolarKvah = Number(row.u2SolarKvahReading || 0);
  
  const dg380Kwh = Number(row.dg380KwhReading || 0);
  const dg380Hours = Number(row.dg380HourmeterReading || 0);
  const dg380Hsd = Number(row.dg380HsdAddedLtr || 0);
  const dg380Def = Number(row.dg380DefAddedPct || 0);
  
  const dg500Kwh = Number(row.dg500KwhReading || 0);
  const dg500Hours = Number(row.dg500HourmeterReading || 0);
  const dg500Hsd = Number(row.dg500HsdAddedLtr || 0);
  const dg500Def = Number(row.dg500DefAddedPct || 0);

  // PF calculations — fully dynamic (kWh/kVAh), no hardcoded fallback
  // If kVAh missing but PF present in raw row, derive kVAh = kWh / PF
  let _u1Kvah = u1ImportKvah;
  if (_u1Kvah === 0 && u1ImportKwh > 0) {
    const pf = Number(row.u1Pf ?? row.u1_pf ?? row['U1 PF'] ?? 0);
    if (pf > 0) _u1Kvah = u1ImportKwh / pf;
  }
  let _u2Kvah = u2ImportKvah;
  if (_u2Kvah === 0 && u2ImportKwh > 0) {
    const pf2 = Number(row.u2Pf ?? row.u2_pf ?? row['U2 PF'] ?? 0);
    if (pf2 > 0) _u2Kvah = u2ImportKwh / pf2;
  }
  const u1Pf = _u1Kvah > 0 ? Number((u1ImportKwh / _u1Kvah).toFixed(4)) : 0;
  const u2Pf = _u2Kvah > 0 ? Number((u2ImportKwh / _u2Kvah).toFixed(4)) : 0;
  const totalImportKwh = u1ImportKwh + u2ImportKwh;
  const totalImportKvah = _u1Kvah + _u2Kvah;
  const combinedPf = totalImportKvah > 0 ? Number((totalImportKwh / totalImportKvah).toFixed(4)) : 0;

  const u1Net = u1ImportKwh - u1ExportKwh;
  const u2Net = u2ImportKwh - u2ExportKwh;
  const gridNet = u1Net + u2Net;
  const solarTotal = u1SolarKwh + u2SolarKwh;
  const dgTotal = dg380Kwh + dg500Kwh;
  const totalHsd = dg380Hsd + dg500Hsd;
  const totalPlant = gridNet + solarTotal + dgTotal;

  return {
    // Raw readings (kVAh dynamically derived if missing but PF present)
    u1ImportKwh, u1ImportKvah: _u1Kvah, u1ExportKwh, u1ExportKvah, u1SolarKwh, u1SolarKvah,
    u2ImportKwh, u2ImportKvah: _u2Kvah, u2ExportKwh, u2ExportKvah, u2SolarKwh, u2SolarKvah,
    dg380Kwh, dg380Hours, dg380Hsd, dg380Def: Number(row.dg380DefAddedPct || 0),
    dg500Kwh, dg500Hours, dg500Hsd, dg500Def: Number(row.dg500DefAddedPct || 0),
    // PF — fully dynamic
    u1Pf, u2Pf, combinedPf,
    // Derived
    u1Net, u2Net, gridNet, solarTotal, dgTotal, totalHsd, totalPlant,
    u1ExportKwh, u2ExportKwh,
  };
}

/**
 * Process utility row for save (adds derived fields)
 */
export function processUtilityRowForSave(row) {
  const derived = getUtilityDerived(row);
  return { ...row, ...derived };
}

/**
 * Compute utility summary from array of rows
 */
export function computeUtilitySummary(rows) {
  if (!rows || rows.length === 0) {
    return {
      totalGridKwh: 0,
      totalSolarKwh: 0,
      totalDgKwh: 0,
      totalHsdLitres: 0,
      totalPlantKwh: 0,
      avgU1Pf: 0,
      avgU2Pf: 0,
      avgCombinedPf: 0,
      dg380Kwh: 0,
      dg500Kwh: 0,
      dg380Hours: 0,
      dg500Hours: 0,
      dg380Hsd: 0,
      dg500Hsd: 0,
      latestGrid: 0,
      latestDg: 0,
      latestSolar: 0,
      latestPf: null,
    };
  }

  const withDerived = rows.map(row => ({ ...row, ...getUtilityDerived(row) }));
  const sorted = [...withDerived].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const totalGridKwh = withDerived.reduce((sum, r) => sum + (r.gridNet || 0), 0);
  const totalSolarKwh = withDerived.reduce((sum, r) => sum + (r.solarTotal || 0), 0);
  const totalDgKwh = withDerived.reduce((sum, r) => sum + (r.dgTotal || 0), 0);
  const totalHsdLitres = withDerived.reduce((sum, r) => sum + (r.totalHsd || 0), 0);
  const totalPlantKwh = withDerived.reduce((sum, r) => sum + (r.totalPlant || 0), 0);
  
  const dg380Kwh = withDerived.reduce((sum, r) => sum + (r.dg380Kwh || 0), 0);
  const dg500Kwh = withDerived.reduce((sum, r) => sum + (r.dg500Kwh || 0), 0);
  const dg380Hours = withDerived.reduce((sum, r) => sum + (r.dg380Hours || 0), 0);
  const dg500Hours = withDerived.reduce((sum, r) => sum + (r.dg500Hours || 0), 0);
  const dg380Hsd = withDerived.reduce((sum, r) => sum + (r.dg380Hsd || 0), 0);
  const dg500Hsd = withDerived.reduce((sum, r) => sum + (r.dg500Hsd || 0), 0);

  // Weighted PF — fully dynamic (ΣkWh / ΣkVAh)
  let u1KwhSum = 0, u1KvahSum = 0;
  let u2KwhSum = 0, u2KvahSum = 0;
  withDerived.forEach(r => {
    u1KwhSum += Number(r.u1ImportKwh || 0);
    u1KvahSum += Number(r.u1ImportKvah || 0);
    u2KwhSum += Number(r.u2ImportKwh || 0);
    u2KvahSum += Number(r.u2ImportKvah || 0);
  });
  const _u1Pf = u1KvahSum > 0 ? u1KwhSum / u1KvahSum : 0;
  const _u2Pf = u2KvahSum > 0 ? u2KwhSum / u2KvahSum : 0;
  const _totalKwh = u1KwhSum + u2KwhSum;
  const _totalKvah = u1KvahSum + u2KvahSum;
  const _combinedPf = _totalKvah > 0 ? _totalKwh / _totalKvah : 0;

  const latest = sorted[0];
  const latestGrid = latest ? latest.gridNet : 0;
  const latestDg = latest ? latest.dgTotal : 0;
  const latestSolar = latest ? latest.solarTotal : 0;
  const latestPf = latest ? latest.combinedPf : null;

  return {
    totalGridKwh: Number(totalGridKwh.toFixed(2)),
    totalSolarKwh: Number(totalSolarKwh.toFixed(2)),
    totalDgKwh: Number(totalDgKwh.toFixed(2)),
    totalHsdLitres: Number(totalHsdLitres.toFixed(2)),
    totalPlantKwh: Number(totalPlantKwh.toFixed(2)),
    dg380Kwh: Number(dg380Kwh.toFixed(2)),
    dg500Kwh: Number(dg500Kwh.toFixed(2)),
    dg380Hours: Number(dg380Hours.toFixed(2)),
    dg500Hours: Number(dg500Hours.toFixed(2)),
    dg380Hsd: Number(dg380Hsd.toFixed(2)),
    dg500Hsd: Number(dg500Hsd.toFixed(2)),
    avgU1Pf: _u1Pf > 0 ? Number(_u1Pf.toFixed(4)) : 0,
    avgU2Pf: _u2Pf > 0 ? Number(_u2Pf.toFixed(4)) : 0,
    avgCombinedPf: _combinedPf > 0 ? Number(_combinedPf.toFixed(4)) : 0,
    latestGrid,
    latestDg,
    latestSolar,
    latestPf: latestPf > 0 ? Number(latestPf.toFixed(4)) : null,
  };
}

/**
 * Get current month utility totals from all rows
 */
export function getCurrentMonthUtilityTotals(allRows) {
  if (!allRows || allRows.length === 0) return { grid: 0, solar: 0, dg: 0, dg380: 0, dg500: 0, hsd: 0 };
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  const monthRows = allRows.filter(r => r.date?.slice(0, 7) === currentMonthKey);
  return computeUtilitySummary(monthRows);
}

/**
 * Monthly aggregation for utility
 */
export function aggregateUtilityByMonth(rows) {
  const monthly = {};
  
  rows.forEach(row => {
    const derived = getUtilityDerived(row);
    const monthKey = row.date?.slice(0, 7) || 'unknown';
    
    if (!monthly[monthKey]) {
      monthly[monthKey] = { 
        month: monthKey, 
        totalGridKwh: 0, totalSolarKwh: 0, totalDgKwh: 0, totalHsdLitres: 0,
        dg380Kwh: 0, dg500Kwh: 0, dg380Hours: 0, dg500Hours: 0
      };
    }
    
    monthly[monthKey].totalGridKwh += derived.gridNet;
    monthly[monthKey].totalSolarKwh += derived.solarTotal;
    monthly[monthKey].totalDgKwh += derived.dgTotal;
    monthly[monthKey].totalHsdLitres += derived.totalHsd;
    monthly[monthKey].dg380Kwh += derived.dg380Kwh;
    monthly[monthKey].dg500Kwh += derived.dg500Kwh;
    monthly[monthKey].dg380Hours += derived.dg380Hours;
    monthly[monthKey].dg500Hours += derived.dg500Hours;
  });

  return Object.values(monthly).map(m => ({
    ...m,
    totalGridKwh: Number(m.totalGridKwh.toFixed(2)),
    totalSolarKwh: Number(m.totalSolarKwh.toFixed(2)),
    totalDgKwh: Number(m.totalDgKwh.toFixed(2)),
    totalHsdLitres: Number(m.totalHsdLitres.toFixed(2)),
    dg380Kwh: Number(m.dg380Kwh.toFixed(2)),
    dg500Kwh: Number(m.dg500Kwh.toFixed(2)),
    dg380Hours: Number(m.dg380Hours.toFixed(2)),
    dg500Hours: Number(m.dg500Hours.toFixed(2)),
  }));
}

// ============================================================
// PF FORMATTER (Shared)
// ============================================================
export function formatPowerFactor(pfVal) {
  const num = Number(pfVal);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (num > 1) return '1.00';
  return num.toFixed(2);
}

// ============================================================
// MONTHLY AGGREGATION HELPERS
// ============================================================
export function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ============================================================
// SOLAR SPECIFIC YIELD — Units per kW per day
// ============================================================
export function computeSpecificYield(totalSolarKwh, capacityKw, days) {
  const solar = Number(totalSolarKwh) || 0;
  const cap = Number(capacityKw) || 0;
  const d = Number(days) || 0;
  if (!cap || !d) return 0;
  return Number((solar / (cap * d)).toFixed(2));
}

export function getUniqueDaysCount(rows, dateKey = 'date') {
  const days = new Set((rows || []).map((r) => (r[dateKey] || '').slice(0, 10)).filter(Boolean));
  return days.size;
}

export function getDaysInRange(dateFrom, dateTo, rows) {
  const unique = getUniqueDaysCount(rows);
  if (unique > 0) return unique;
  if (dateFrom && dateTo) {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    if (!isNaN(from) && !isNaN(to) && to >= from) {
      return Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
    }
  }
  if (dateFrom && !dateTo) {
    const from = new Date(dateFrom);
    const to = new Date();
    if (!isNaN(from) && to >= from) {
      return Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
    }
  }
  return rows?.length || 1;
}

export function getSolarCapacity(energySettings) {
  const v = Number(energySettings?.installedSolarCapacityKwp);
  return Number.isFinite(v) && v > 0 ? v : 540;
}