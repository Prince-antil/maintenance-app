// =============================================================================
// File: lib/energyEngine.js (Pure Standalone Functions - No Component Imports)
// =============================================================================
export function formatEnergy(val, decimals = 1) {
  if (val === null || val === undefined || isNaN(val)) return '0';
  const num = Number(val);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
}

export function computeEnergySnapshot(utilityRows = [], solarRows = []) {
  const safeUtility = Array.isArray(utilityRows) ? utilityRows : [];
  const safeSolar = Array.isArray(solarRows) ? solarRows : [];
  // 1. Grid Import Sums - supports snake_case, camelCase, and reading variants
  const unit1GridKwh = safeUtility.reduce((acc, row) => {
    const val = Number(row?.u1_import_kwh_reading ?? row?.u1_import_kwh ?? row?.u1_import ?? row?.u1ImportKwhReading ?? row?.u1ImportKwh ?? row?.u1_grid ?? 0);
    return acc + (Number.isFinite(val) ? val : 0);
  }, 0);
  const unit2GridKwh = safeUtility.reduce((acc, row) => {
    const val = Number(row?.u2_import_kwh_reading ?? row?.u2_import_kwh ?? row?.u2_import ?? row?.u2ImportKwhReading ?? row?.u2ImportKwh ?? row?.u2_grid ?? 0);
    return acc + (Number.isFinite(val) ? val : 0);
  }, 0);
  const totalGridKwh = unit1GridKwh + unit2GridKwh;
  // 2. DG Sums & Hours
  const dg380Kwh = safeUtility.reduce((acc, row) => {
    return acc + Number(row?.dg380_kwh_reading ?? row?.dg380_kwh ?? row?.dg380 ?? row?.dg380KwhReading ?? row?.dg380Kwh ?? 0);
  }, 0);
  const dg500Kwh = safeUtility.reduce((acc, row) => {
    return acc + Number(row?.dg500_kwh_reading ?? row?.dg500_kwh ?? row?.dg500 ?? row?.dg500KwhReading ?? row?.dg500Kwh ?? 0);
  }, 0);
  const dg380Hours = safeUtility.reduce((acc, row) => {
    return acc + Number(row?.dg380_hourmeter_reading ?? row?.dg380_hours ?? row?.dg380Hours ?? row?.dg380_hrs ?? row?.dg380HourmeterReading ?? 0);
  }, 0);
  const dg500Hours = safeUtility.reduce((acc, row) => {
    return acc + Number(row?.dg500_hourmeter_reading ?? row?.dg500_hours ?? row?.dg500Hours ?? row?.dg500_hrs ?? row?.dg500HourmeterReading ?? 0);
  }, 0);
  // 3. Fuel (Ltrs)
  const totalFuelLtrs = safeUtility.reduce((acc, row) => {
    const h380 = Number(row?.dg380_hsd_added_ltr ?? row?.dg380_hsd ?? row?.dg380HsdAddedLtr ?? row?.dg380Hsd ?? 0);
    const h500 = Number(row?.dg500_hsd_added_ltr ?? row?.dg500_hsd ?? row?.dg500HsdAddedLtr ?? row?.dg500Hsd ?? 0);
    const direct = Number(row?.total_fuel ?? row?.fuel_ltrs ?? row?.fuel ?? 0);
    return acc + (Number.isFinite(h380) ? h380 : 0) + (Number.isFinite(h500) ? h500 : 0) + (Number.isFinite(direct) ? direct : 0);
  }, 0);
  // 4. Solar Sums - supports snake_case, camelCase, store keys and reading variants
  const solarKwh = safeSolar.reduce((acc, row) => {
    const u1 = Number(row?.u1_inv1_kwh ?? row?.u1_inv1 ?? row?.u1Inv1Kwh ?? row?.u1Inv1 ?? 0) + Number(row?.u1_inv2_kwh ?? row?.u1_inv2 ?? row?.u1Inv2Kwh ?? row?.u1Inv2 ?? 0) + Number(row?.u1_inv3_kwh ?? row?.u1_inv3 ?? row?.u1Inv3Kwh ?? row?.u1Inv3 ?? 0) + Number(row?.u1_inv4_kwh ?? row?.u1_inv4 ?? row?.u1Inv4Kwh ?? row?.u1Inv4 ?? 0);
    const u2 = Number(row?.u2_inv1_kwh ?? row?.u2_inv1 ?? row?.u2Inv1Kwh ?? row?.u2Inv1 ?? 0) + Number(row?.u2_inv2_kwh ?? row?.u2_inv2 ?? row?.u2Inv2Kwh ?? row?.u2Inv2 ?? 0) + Number(row?.u2_inv3_kwh ?? row?.u2_inv3 ?? row?.u2Inv3Kwh ?? row?.u2Inv3 ?? 0);
    const direct = Number(row?.total_solar_kwh ?? row?.solar_kwh ?? row?.total_generation ?? row?.dailyTotalKwh ?? row?.daily_total_kwh ?? row?.grand_total ?? 0);
    return acc + (u1 + u2 > 0 ? (u1 + u2) : (Number.isFinite(direct) ? direct : 0));
  }, 0);
  // 5. Power Factor — fully dynamic (no hardcoded fallbacks, kWh/kVAh weighted)
  const pfResult = calculateWeightedPF(safeUtility);
  const avgU1Pf = pfResult.u1Pf;
  const avgU2Pf = pfResult.u2Pf;
  const overallPf = pfResult.overallPf;
  const u1Pct = totalGridKwh > 0 ? Math.round((unit1GridKwh / totalGridKwh) * 100) : 50;
  const u2Pct = 100 - u1Pct;
  return {
    unit1GridKwh: Number(unit1GridKwh.toFixed(1)),
    unit2GridKwh: Number(unit2GridKwh.toFixed(1)),
    totalGridKwh: Number(totalGridKwh.toFixed(1)),
    dg380Kwh: Number(dg380Kwh.toFixed(1)),
    dg380Hours: Number(dg380Hours.toFixed(1)),
    dg500Kwh: Number(dg500Kwh.toFixed(1)),
    dg500Hours: Number(dg500Hours.toFixed(1)),
    solarKwh: Number(solarKwh.toFixed(1)),
    totalFuelLtrs: Math.round(totalFuelLtrs),
    avgU1Pf,
    avgU2Pf,
    overallPf,
    u1Pct,
    u2Pct,
    // Expose raw PF engine values for Explore modal (no extra calc needed)
    u1Kwh: pfResult.u1Kwh,
    u1Kvah: pfResult.u1Kvah,
    u2Kwh: pfResult.u2Kwh,
    u2Kvah: pfResult.u2Kvah,
    totalKwh: pfResult.totalKwh,
    totalKvah: pfResult.totalKvah
  };
}

// ---------------------------------------------------------------------------
// Weighted Power Factor Calculation — Fully Dynamic, Zero Hardcoded Fallbacks
// PF = kWh / kVAh (true weighted: ΣkWh / ΣkVAh)
// If kVAh missing but PF present, derive kVAh = kWh / PF dynamically
// Returns 0.00 when no data — no static 0.98 fallback
// ---------------------------------------------------------------------------

export function calculateWeightedPF(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      overallPf: '0.00',
      u1Pf: '0.00',
      u2Pf: '0.00',
      u1Kwh: 0,
      u1Kvah: 0,
      u2Kwh: 0,
      u2Kvah: 0,
      totalKwh: 0,
      totalKvah: 0
    };
  }
  let u1KwhSum = 0, u1KvahSum = 0;
  let u2KwhSum = 0, u2KvahSum = 0;
  rows.forEach(row => {
    const u1KwhRaw = Number(row.u1_import_kwh ?? row.u1_import ?? row['U1 Import KWh Reading'] ?? row.u1_import_kwh_reading ?? row.u1ImportKwhReading ?? row.u1ImportKwh ?? 0);
    const u1KwhVal = Number.isFinite(u1KwhRaw) ? u1KwhRaw : 0;
    let u1Kvah = Number(row.u1_import_kvah ?? row.u1_kvah ?? row['U1 Import kVAh Reading'] ?? row.u1_import_kvah_reading ?? row.u1ImportKvahReading ?? row.u1_kvah_reading ?? 0);
    if (u1Kvah === 0 && u1KwhVal > 0 && row.u1_pf != null && Number(row.u1_pf) > 0) {
      u1Kvah = u1KwhVal / Number(row.u1_pf);
    } else if (u1Kvah === 0 && u1KwhVal > 0 && row.u1Pf != null && Number(row.u1Pf) > 0) {
      u1Kvah = u1KwhVal / Number(row.u1Pf);
    }
    const u2KwhRaw = Number(row.u2_import_kwh ?? row.u2_import ?? row['U2 Import KWh Reading'] ?? row.u2_import_kwh_reading ?? row.u2ImportKwhReading ?? row.u2ImportKwh ?? 0);
    const u2KwhVal = Number.isFinite(u2KwhRaw) ? u2KwhRaw : 0;
    let u2Kvah = Number(row.u2_import_kvah ?? row.u2_kvah ?? row['U2 Import kVAh Reading'] ?? row.u2_import_kvah_reading ?? row.u2ImportKvahReading ?? row.u2_kvah_reading ?? 0);
    if (u2Kvah === 0 && u2KwhVal > 0 && row.u2_pf != null && Number(row.u2_pf) > 0) {
      u2Kvah = u2KwhVal / Number(row.u2_pf);
    } else if (u2Kvah === 0 && u2KwhVal > 0 && row.u2Pf != null && Number(row.u2Pf) > 0) {
      u2Kvah = u2KwhVal / Number(row.u2Pf);
    }
    u1KwhSum += u1KwhVal;
    u1KvahSum += u1Kvah;
    u2KwhSum += u2KwhVal;
    u2KvahSum += u2Kvah;
  });
  const u1PfVal = u1KvahSum > 0 ? (u1KwhSum / u1KvahSum) : 0;
  const u2PfVal = u2KvahSum > 0 ? (u2KwhSum / u2KvahSum) : 0;
  const totalKwh = u1KwhSum + u2KwhSum;
  const totalKvah = u1KvahSum + u2KvahSum;
  const overallPfVal = totalKvah > 0 ? (totalKwh / totalKvah) : 0;
  return {
    overallPf: overallPfVal > 0 ? overallPfVal.toFixed(2) : '0.00',
    u1Pf: u1PfVal > 0 ? u1PfVal.toFixed(2) : '0.00',
    u2Pf: u2PfVal > 0 ? u2PfVal.toFixed(2) : '0.00',
    u1Kwh: u1KwhSum,
    u1Kvah: u1KvahSum,
    u2Kwh: u2KwhSum,
    u2Kvah: u2KvahSum,
    totalKwh,
    totalKvah,
    // Backwards-compat aliases for previous callers
    u1KwhSum: u1KwhSum,
    u1KvahSum: u1KvahSum,
    u1KvarhSum: u1KvahSum,
    u2KwhSum: u2KwhSum,
    u2KvahSum: u2KvahSum,
    u2KvarhSum: u2KvahSum,
    totalKvarh: totalKvah
  };
}

// ---------------------------------------------------------------------------
// Additional pure helpers retained for backwards compatibility (no component imports)
// These are pure and do not introduce circular dependencies.
// ---------------------------------------------------------------------------

export function processUtilityRow(row) {
  const u1_import_kwh = Number(row.u1_import_kwh_reading || row.u1_import_kwh || 0);
  const u1_import_kvah = Number(row.u1_import_kvah_reading || row.u1_import_kvah || 0);
  const u1_export_kwh = Number(row.u1_export_kwh_reading || row.u1_export_kwh || 0);
  const u1_export_kvah = Number(row.u1_export_kvah_reading || row.u1_export_kvah || 0);
  const u1_solar_kwh = Number(row.u1_solar_kwh_reading || row.u1_solar_kwh || 0);
  const u1_solar_kvah = Number(row.u1_solar_kvah_reading || row.u1_solar_kvah || 0);
  const u2_import_kwh = Number(row.u2_import_kwh_reading || row.u2_import_kwh || 0);
  const u2_import_kvah = Number(row.u2_import_kvah_reading || row.u2_import_kvah || 0);
  const u2_export_kwh = Number(row.u2_export_kwh_reading || row.u2_export_kwh || 0);
  const u2_export_kvah = Number(row.u2_export_kvah_reading || row.u2_export_kvah || 0);
  const u2_solar_kwh = Number(row.u2_solar_kwh_reading || row.u2_solar_kwh || 0);
  const u2_solar_kvah = Number(row.u2_solar_kvah_reading || row.u2_solar_kvah || 0);
  const u1_pf = u1_import_kvah > 0 ? Math.min(0.99, Number((u1_import_kwh / u1_import_kvah).toFixed(4))) : 0;
  const u2_pf = u2_import_kvah > 0 ? Math.min(0.99, Number((u2_import_kwh / u2_import_kvah).toFixed(4))) : 0;
  const total_import_kwh = u1_import_kwh + u2_import_kwh;
  const total_import_kvah = u1_import_kvah + u2_import_kvah;
  const combined_pf = total_import_kvah > 0 ? Math.min(0.99, Number((total_import_kwh / total_import_kvah).toFixed(4))) : 0;
  const total_solar_kwh = u1_solar_kwh + u2_solar_kwh;
  const dg380_kwh = Number(row.dg380_kwh_reading || row.dg380_kwh || 0);
  const dg500_kwh = Number(row.dg500_kwh_reading || row.dg500_kwh || 0);
  const total_dg_kwh = dg380_kwh + dg500_kwh;
  const dg380_hsd = Number(row.dg380_hsd_added_ltr || row.dg380_hsd || 0);
  const dg500_hsd = Number(row.dg500_hsd_added_ltr || row.dg500_hsd || 0);
  const total_hsd_litres = dg380_hsd + dg500_hsd;
  const dg380_hours = Number(row.dg380_hourmeter_reading || row.dg380_hours || 0);
  const dg500_hours = Number(row.dg500_hourmeter_reading || row.dg500_hours || 0);
  return {
    ...row,
    u1_pf,
    u2_pf,
    combined_pf,
    total_grid_kwh: total_import_kwh,
    total_solar_kwh,
    total_dg_kwh,
    total_hsd_litres,
    dg380_kwh,
    dg500_kwh,
    dg380_hours,
    dg500_hours,
    dg380_hsd,
    dg500_hsd
  };
}

export function processSolarRow(row) {
  const u1_inv1 = Number(row.u1_inv1_kwh || row.u1_inv1 || 0);
  const u1_inv2 = Number(row.u1_inv2_kwh || row.u1_inv2 || 0);
  const u1_inv3 = Number(row.u1_inv3_kwh || row.u1_inv3 || 0);
  const u1_inv4 = Number(row.u1_inv4_kwh || row.u1_inv4 || 0);
  const u2_inv1 = Number(row.u2_inv1_kwh || row.u2_inv1 || 0);
  const u2_inv2 = Number(row.u2_inv2_kwh || row.u2_inv2 || 0);
  const u2_inv3 = Number(row.u2_inv3_kwh || row.u2_inv3 || 0);
  const u1_total = Number((u1_inv1 + u1_inv2 + u1_inv3 + u1_inv4).toFixed(2));
  const u2_total = Number((u2_inv1 + u2_inv2 + u2_inv3).toFixed(2));
  const grand_total = Number((u1_total + u2_total).toFixed(2));
  return {
    ...row,
    u1_inv1_kwh: u1_inv1,
    u1_inv2_kwh: u1_inv2,
    u1_inv3_kwh: u1_inv3,
    u1_inv4_kwh: u1_inv4,
    u2_inv1_kwh: u2_inv1,
    u2_inv2_kwh: u2_inv2,
    u2_inv3_kwh: u2_inv3,
    u1_total,
    u2_total,
    grand_total,
    daily_total_kwh: grand_total
  };
}

export function computeUtilitySummary(rows) {
  if (!rows || rows.length === 0) {
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
      dg500_hours: 0
    };
  }
  const processed = rows.map(processUtilityRow);
  const total_grid_kwh = processed.reduce((sum, r) => sum + r.total_grid_kwh, 0);
  const total_solar_kwh = processed.reduce((sum, r) => sum + r.total_solar_kwh, 0);
  const total_dg_kwh = processed.reduce((sum, r) => sum + r.total_dg_kwh, 0);
  const total_hsd_litres = processed.reduce((sum, r) => sum + r.total_hsd_litres, 0);
  const dg380_kwh = processed.reduce((sum, r) => sum + r.dg380_kwh, 0);
  const dg500_kwh = processed.reduce((sum, r) => sum + r.dg500_kwh, 0);
  const dg380_hours = processed.reduce((sum, r) => sum + r.dg380_hours, 0);
  const dg500_hours = processed.reduce((sum, r) => sum + r.dg500_hours, 0);
  const u1_pf_weighted = processed.reduce((sum, r) => {
    const u1_import = Number(r.u1_import_kwh_reading || r.u1_import_kwh || 0);
    return sum + (r.u1_pf * u1_import);
  }, 0);
  const u1_import_total = processed.reduce((sum, r) => sum + Number(r.u1_import_kwh_reading || r.u1_import_kwh || 0), 0);
  const u2_pf_weighted = processed.reduce((sum, r) => {
    const u2_import = Number(r.u2_import_kwh_reading || r.u2_import_kwh || 0);
    return sum + (r.u2_pf * u2_import);
  }, 0);
  const u2_import_total = processed.reduce((sum, r) => sum + Number(r.u2_import_kwh_reading || r.u2_import_kwh || 0), 0);
  const combined_pf_weighted = processed.reduce((sum, r) => {
    const total_import = Number(r.u1_import_kwh_reading || r.u1_import_kwh || 0) + Number(r.u2_import_kwh_reading || r.u2_import_kwh || 0);
    return sum + (r.combined_pf * total_import);
  }, 0);
  const total_import_total = u1_import_total + u2_import_total;
  return {
    total_grid_kwh: Number(total_grid_kwh.toFixed(2)),
    total_solar_kwh: Number(total_solar_kwh.toFixed(2)),
    total_dg_kwh: Number(total_dg_kwh.toFixed(2)),
    total_hsd_litres: Number(total_hsd_litres.toFixed(2)),
    dg380_kwh: Number(dg380_kwh.toFixed(2)),
    dg500_kwh: Number(dg500_kwh.toFixed(2)),
    dg380_hours: Number(dg380_hours.toFixed(2)),
    dg500_hours: Number(dg500_hours.toFixed(2)),
    avg_u1_pf: u1_import_total > 0 ? Number((u1_pf_weighted / u1_import_total).toFixed(4)) : 0,
    avg_u2_pf: u2_import_total > 0 ? Number((u2_pf_weighted / u2_import_total).toFixed(4)) : 0,
    avg_combined_pf: total_import_total > 0 ? Number((combined_pf_weighted / total_import_total).toFixed(4)) : 0
  };
}

export function computeSolarSummary(rows) {
  if (!rows || rows.length === 0) {
    return {
      u1_total: 0,
      u2_total: 0,
      grand_total: 0,
      daily_avg: 0,
      monthly_avg: 0
    };
  }
  const processed = rows.map(processSolarRow);
  const u1_total = processed.reduce((sum, r) => sum + r.u1_total, 0);
  const u2_total = processed.reduce((sum, r) => sum + r.u2_total, 0);
  const grand_total = processed.reduce((sum, r) => sum + r.grand_total, 0);
  const daily_avg = processed.length > 0 ? Number((grand_total / processed.length).toFixed(2)) : 0;
  const months = new Set(processed.map(r => r.date?.slice(0, 7)).filter(Boolean));
  const monthly_avg = months.size > 0 ? Number((grand_total / months.size).toFixed(2)) : 0;
  return {
    u1_total: Number(u1_total.toFixed(2)),
    u2_total: Number(u2_total.toFixed(2)),
    grand_total: Number(grand_total.toFixed(2)),
    daily_avg,
    monthly_avg
  };
}

export function aggregateUtilityByMonth(rows) {
  const monthly = {};
  rows.forEach(row => {
    const processed = processUtilityRow(row);
    const monthKey = row.date?.slice(0, 7) || 'unknown';
    if (!monthly[monthKey]) {
      monthly[monthKey] = {
        month: monthKey,
        rows: [],
        total_grid_kwh: 0,
        total_solar_kwh: 0,
        total_dg_kwh: 0,
        total_hsd_litres: 0,
        dg380_kwh: 0,
        dg500_kwh: 0,
        dg380_hours: 0,
        dg500_hours: 0
      };
    }
    monthly[monthKey].rows.push(processed);
    monthly[monthKey].total_grid_kwh += processed.total_grid_kwh;
    monthly[monthKey].total_solar_kwh += processed.total_solar_kwh;
    monthly[monthKey].total_dg_kwh += processed.total_dg_kwh;
    monthly[monthKey].total_hsd_litres += processed.total_hsd_litres;
    monthly[monthKey].dg380_kwh += processed.dg380_kwh;
    monthly[monthKey].dg500_kwh += processed.dg500_kwh;
    monthly[monthKey].dg380_hours += processed.dg380_hours;
    monthly[monthKey].dg500_hours += processed.dg500_hours;
  });
  return Object.values(monthly).map(m => ({
    ...m,
    total_grid_kwh: Number(m.total_grid_kwh.toFixed(2)),
    total_solar_kwh: Number(m.total_solar_kwh.toFixed(2)),
    total_dg_kwh: Number(m.total_dg_kwh.toFixed(2)),
    total_hsd_litres: Number(m.total_hsd_litres.toFixed(2)),
    dg380_kwh: Number(m.dg380_kwh.toFixed(2)),
    dg500_kwh: Number(m.dg500_kwh.toFixed(2)),
    dg380_hours: Number(m.dg380_hours.toFixed(2)),
    dg500_hours: Number(m.dg500_hours.toFixed(2))
  }));
}

export function aggregateSolarByMonth(rows) {
  const monthly = {};
  rows.forEach(row => {
    const processed = processSolarRow(row);
    const monthKey = row.date?.slice(0, 7) || 'unknown';
    if (!monthly[monthKey]) {
      monthly[monthKey] = {
        month: monthKey,
        rows: [],
        u1_total: 0,
        u2_total: 0,
        grand_total: 0
      };
    }
    monthly[monthKey].rows.push(processed);
    monthly[monthKey].u1_total += processed.u1_total;
    monthly[monthKey].u2_total += processed.u2_total;
    monthly[monthKey].grand_total += processed.grand_total;
  });
  return Object.values(monthly).map(m => ({
    ...m,
    u1_total: Number(m.u1_total.toFixed(2)),
    u2_total: Number(m.u2_total.toFixed(2)),
    grand_total: Number(m.grand_total.toFixed(2))
  }));
}
