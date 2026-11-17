/**
 * Dashboard Analytics Engine - Canonical calculations for Dashboard widgets
 * Single source of truth for Solar Performance & Renewable Energy metrics
 */

import { getSolarDerived } from '../../lib/energyCalculations.js';
import { formatEnergy } from '../../lib/energyCalculations.js';
import { computeDailyDeltas } from '../../analytics.js';

/**
 * Computes live Dashboard metrics from raw Solar and Utility records
 * Uses canonical derivation functions that work with actual store field names
 */
export const computeDashboardMetrics = (solarRows = [], utilityRows = []) => {
  // 1. Process Solar Rows using Canonical Derivation
  const normalizedSolar = solarRows.map(getSolarDerived);
  const inverterTotalKwh = normalizedSolar.reduce((sum, r) => sum + (r.grandTotal || 0), 0);

  // 2. Process Utility Rows via daily deltas (stored values are cumulative
  //    meter registers — they must be diffed per day before summing).
  const deltas = computeDailyDeltas(utilityRows || []);
  const deltaSum = (key) => deltas.reduce((sum, row) => {
    const value = row._delta?.[key];
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  const totalU1Import = deltaSum('u1ImportKwhReading');
  const totalU2Import = deltaSum('u2ImportKwhReading');
  const totalU1Export = deltaSum('u1ExportKwhReading');
  const totalU2Export = deltaSum('u2ExportKwhReading');

  const meterImportKwh = totalU1Import + totalU2Import;
  const meterExportKwh = totalU1Export + totalU2Export;

  const meterSolarKwh = deltaSum('u1SolarKwhReading') + deltaSum('u2SolarKwhReading');
  const totalDgKwh = deltaSum('dg380KwhReading') + deltaSum('dg500KwhReading');

  // 3. Total Plant Consumption Calculation
  const netGridKwh = Math.max(0, meterImportKwh - meterExportKwh);
  const totalPlantConsumptionKwh = netGridKwh + inverterTotalKwh + totalDgKwh;

  // 4. Renewable Share (%)
  const renewableSharePct = totalPlantConsumptionKwh > 0
    ? Math.min(100, Number(((inverterTotalKwh / totalPlantConsumptionKwh) * 100).toFixed(1)))
    : 0;

  // 5. CO2 Avoided (kg) using Indian CEA Grid Emission Factor (0.82 kg/kWh)
  const co2AvoidedKg = Math.round(inverterTotalKwh * 0.82);

  // 6. Cross-Check Deviation between Inverters and Utility Solar Meter
  let crossCheckDeviationPct = 0;
  if (meterSolarKwh > 0 && inverterTotalKwh > 0) {
    crossCheckDeviationPct = Number(
      (Math.abs(inverterTotalKwh - meterSolarKwh) / inverterTotalKwh * 100).toFixed(1)
    );
  } else if (inverterTotalKwh > 0 && meterSolarKwh === 0) {
    crossCheckDeviationPct = 100;
  }

  const isCrossCheckRequired = crossCheckDeviationPct > 5.0 || meterImportKwh === 0;

  return {
    inverterTotalKwh: Number(inverterTotalKwh.toFixed(1)),
    meterImportKwh: Number(meterImportKwh.toFixed(1)),
    meterExportKwh: Number(meterExportKwh.toFixed(1)),
    totalU1Import: Number(totalU1Import.toFixed(1)),
    totalU2Import: Number(totalU2Import.toFixed(1)),
    totalU1Export: Number(totalU1Export.toFixed(1)),
    totalU2Export: Number(totalU2Export.toFixed(1)),
    meterSolarKwh: Number(meterSolarKwh.toFixed(1)),
    totalUtilitySolar: Number(meterSolarKwh.toFixed(1)),
    totalDg: Number(totalDgKwh.toFixed(1)),
    netGridKwh: Number(netGridKwh.toFixed(1)),
    totalPlantConsumptionKwh: Number(totalPlantConsumptionKwh.toFixed(1)),
    renewableSharePct,
    co2AvoidedKg,
    crossCheckDeviationPct,
    isCrossCheckRequired
  };
};

// Export formatEnergy for component usage
export { formatEnergy } from '../../lib/energyCalculations.js';