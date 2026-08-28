/**
 * Dashboard Analytics Engine - Canonical calculations for Dashboard widgets
 * Single source of truth for Solar Performance & Renewable Energy metrics
 */

import { 
  getSolarDerived, 
  getUtilityDerived, 
  getCurrentMonthSolarTotal,
  computeSolarSummary,
  getUtilityDerived as getUtilityDerivedFromEngine,
} from '../../lib/energyCalculations.js';
import { formatEnergy } from '../../lib/energyEngine.js';

/**
 * Computes live Dashboard metrics from raw Solar and Utility records
 * Uses canonical derivation functions that work with actual store field names
 */
export const computeDashboardMetrics = (solarRows = [], utilityRows = []) => {
  // 1. Process Solar Rows using Canonical Derivation
  const normalizedSolar = solarRows.map(getSolarDerived);
  const inverterTotalKwh = normalizedSolar.reduce((sum, r) => sum + (r.grandTotal || 0), 0);

  // 2. Process Utility Rows using Canonical Derivation
  const normalizedUtility = utilityRows.map(getUtilityDerived);

  const meterImportKwh = normalizedUtility.reduce(
    (sum, r) => sum + ((r.u1_import_kwh || 0) + (r.u2_import_kwh || 0)),
    0
  );
  const meterExportKwh = normalizedUtility.reduce(
    (sum, r) => sum + ((r.u1_export_kwh || 0) + (r.u2_export_kwh || 0)),
    0
  );
  const meterSolarKwh = normalizedUtility.reduce(
    (sum, r) => sum + ((r.u1_solar_kwh || 0) + (r.u2_solar_kwh || 0)),
    0
  );
  const totalDgKwh = normalizedUtility.reduce(
    (sum, r) => sum + ((r.dg380_kwh || 0) + (r.dg500_kwh || 0)),
    0
  );

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

  const isCrossCheckRequired = crossCheckDeviationPct > 5.0;

  return {
    inverterTotalKwh: Number(inverterTotalKwh.toFixed(1)),
    meterImportKwh: Number(meterImportKwh.toFixed(1)),
    meterExportKwh: Number(meterExportKwh.toFixed(1)),
    meterSolarKwh: Number(meterSolarKwh.toFixed(1)),
    renewableSharePct,
    co2AvoidedKg,
    crossCheckDeviationPct,
    isCrossCheckRequired
  };
};

// Export formatEnergy for component usage
export { formatEnergy } from '../../lib/energyCalculations.js';