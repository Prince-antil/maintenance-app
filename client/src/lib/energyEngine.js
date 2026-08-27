/**
 * Energy Engine - Core Math & Dynamic Recalculation Engine
 * Handles all energy calculations with dynamic Power Factor computation
 * and fixes Solar Grand Total computation.
 */

// Utility row data structure (matches Supabase schema)
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

  // Dynamic Power Factor Calculations (capped at 0.99 per requirement)
  const u1_pf = u1_import_kvah > 0 
    ? Math.min(0.99, Number((u1_import_kwh / u1_import_kvah).toFixed(4))) 
    : 0;
  const u2_pf = u2_import_kvah > 0 
    ? Math.min(0.99, Number((u2_import_kwh / u2_import_kvah).toFixed(4))) 
    : 0;

  const total_import_kwh = u1_import_kwh + u2_import_kwh;
  const total_import_kvah = u1_import_kvah + u2_import_kvah;
  const combined_pf = total_import_kvah > 0 
    ? Math.min(0.99, Number((total_import_kwh / total_import_kvah).toFixed(4))) 
    : 0;

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

/**
 * Rebuilds Solar row metrics and fixes zero Grand Total bug
 * The bug was: grand_total was not being computed from individual inverter values
 */
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
    daily_total_kwh: grand_total // for backward compatibility
  };
}

/**
 * Computes summary for a set of utility rows
 * Used for dashboard cards and summary views
 */
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

  // Weighted average PF using import kWh as weights
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
    const total_import = Number(r.u1_import_kwh_reading || r.u1_import_kwh || 0) + 
                         Number(r.u2_import_kwh_reading || r.u2_import_kwh || 0);
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

/**
 * Computes summary for a set of solar rows
 */
export function computeSolarSummary(rows) {
  if (!rows || rows.length === 0) {
    return {
      u1_total: 0,
      u2_total: 0,
      grand_total: 0,
      daily_avg: 0
    };
  }

  const processed = rows.map(processSolarRow);
  
  const u1_total = processed.reduce((sum, r) => sum + r.u1_total, 0);
  const u2_total = processed.reduce((sum, r) => sum + r.u2_total, 0);
  const grand_total = processed.reduce((sum, r) => sum + r.grand_total, 0);
  const daily_avg = processed.length > 0 ? Number((grand_total / processed.length).toFixed(2)) : 0;

  return {
    u1_total: Number(u1_total.toFixed(2)),
    u2_total: Number(u2_total.toFixed(2)),
    grand_total: Number(grand_total.toFixed(2)),
    daily_avg
  };
}

/**
 * Monthly aggregation for utility data
 */
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

/**
 * Monthly aggregation for solar data
 */
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