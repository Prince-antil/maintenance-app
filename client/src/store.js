import { useSyncExternalStore } from 'react';
import { loadLS, saveLS } from './utils.js';
import { normalizeMachineStatus } from './bulkImport.js';
import { SEED_MACHINES } from './equipmentData.js';
import { MASTER_PLANT_SECTION } from './constants.js';
import { isSupabaseConfigured, supabase } from './lib/supabaseClient.js';

const KEYS = {
  machines: 'PLANT_EQUIPMENT_MASTER',
  breakdowns: 'BREAKDOWN_MONTHLY_LOGS',
  pms: 'PM_MONTHLY_LOGS',
  energy: 'ccpl_energy_v1',
  amc: 'CCPL_AMC_RECORDS_V1',
  machineBreakdownLogs: 'CCPL_MACHINE_BD_LOGS_V1',
  machinePmRecords: 'CCPL_MACHINE_PM_RECORDS_V1',
  plantSections: 'CCPL_PLANT_SECTIONS_V1',
  activity: 'ccpl_activity_v1',
  settings: 'ccpl_settings_v1',
  dailyUtilityLog: 'CCPL_DAILY_UTILITY_LOG_V1',
  monthlyHerbicide: 'CCPL_MONTHLY_HERBICIDE_V1',
  monthlyInsecticide: 'CCPL_MONTHLY_INSECTICIDE_V1',
  monthlyWater: 'CCPL_MONTHLY_WATER_V1',
  monthlyAirCompressor: 'CCPL_MONTHLY_AIR_COMPRESSOR_V1',
  dailySolarGeneration: 'CCPL_DAILY_SOLAR_GENERATION_V1',
  energySettings: 'CCPL_ENERGY_SETTINGS_V1',
  testingCertificates: 'CCPL_TESTING_CERTIFICATES_V1',
};

const LEGACY_KEYS = {
  machines: ['ccpl_machines_v2'],
  breakdowns: ['ccpl_breakdowns_v2'],
  pms: ['ccpl_pms_v2'],
  energy: ['ccpl_energy_v1'],
  amc: [],
  machineBreakdownLogs: [],
  machinePmRecords: [],
  plantSections: [],
  activity: ['ccpl_activity_v1'],
  settings: ['ccpl_settings_v1'],
  dailyUtilityLog: [],
  monthlyHerbicide: [],
  monthlyInsecticide: [],
  monthlyWater: [],
  monthlyAirCompressor: [],
  dailySolarGeneration: [],
  energySettings: [],
  testingCertificates: [],
};

const CLOUD_SYNC_QUEUE_KEY = 'CCPL_CLOUD_SYNC_QUEUE';

const MACHINE_DEFAULTS = {
  machineCode: '',
  department: '',
  area: '',
  manufacturer: '',
  model: '',
  serialNumber: '',
  installDate: '',
  powerRating: '',
  voltage: '',
  current: '',
  runningHours: 0,
  criticality: '',
  status: 'running',
  docs: [],
  spares: [],
  photos: [],
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const HOURS_PER_MONTH = 720;
const MASTER_SECTION = MASTER_PLANT_SECTION;
const SYNCED_ENTITIES = ['machines', 'breakdowns', 'pms', 'energy', 'amc', 'machineBreakdownLogs', 'machinePmRecords', 'plantSections', 'dailyUtilityLog', 'monthlyHerbicide', 'monthlyInsecticide', 'monthlyWater', 'monthlyAirCompressor', 'dailySolarGeneration', 'energySettings', 'testingCertificates'];

const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();
const normalizeText = (value) => String(value || '').trim().toLowerCase();
const isPresent = (value) => value !== null && value !== undefined && String(value).trim() !== '';
const isBrowserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};
const round1 = (value) => Math.round(toNumber(value) * 10) / 10;
const asPlainObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

function normalizeMachineDoc(doc) {
  return {
    id: doc.id || uid('d'),
    tab: doc.tab || 'sop',
    filename: doc.filename || doc.file_name || 'Untitled document',
    file_format: doc.file_format || '',
    file_url: doc.file_url || doc.public_url || '',
    public_url: doc.public_url || doc.file_url || '',
    storage_path: doc.storage_path || '',
    uploadedAt: doc.uploadedAt || doc.uploaded_at || now(),
    uploaded_at: doc.uploaded_at || doc.uploadedAt || now(),
    uploadedBy: doc.uploadedBy || doc.uploaded_by || 'System',
    uploaded_by: doc.uploaded_by || doc.uploadedBy || 'System',
    machine_id: doc.machine_id || '',
    plant_section: doc.plant_section || '',
  };
}

const monthKey = (value) => {
  const dt = new Date(value);
  return Number.isNaN(dt.getTime())
    ? ''
    : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
};

const periodLabel = (period) => {
  const [year, month] = String(period || '').split('-').map(Number);
  if (!year || !month) return '';
  return `${MONTHS[month - 1]} ${year}`;
};

function normalizeEnergyRecord(fields) {
  const dg500RunHours = toNumber(fields.dg500RunHours ?? fields.dg500RunHrs);
  const dg380RunHours = toNumber(fields.dg380RunHours ?? fields.dg380RunHrs);
  const fuelConsumedLitres = toNumber(fields.fuelConsumedLitres ?? fields.fuelLtrs);
  const solarGenerationKwh = toNumber(fields.solarGenerationKwh ?? fields.solarKwh);
  const uhbvnlUnit1Kwh = toNumber(fields.uhbvnlUnit1Kwh);
  const uhbvnlUnit2Kwh = toNumber(fields.uhbvnlUnit2Kwh);
  const totalGridKwh = toNumber(fields.totalGridKwh) || (uhbvnlUnit1Kwh + uhbvnlUnit2Kwh);
  // totalKwh = grid + solar + DG-generated (if separate DG kWh provided; else omit)
  const dgKwh = toNumber(fields.dgKwh);
  const totalKwh = toNumber(fields.totalKwh) ||
    (totalGridKwh + solarGenerationKwh + dgKwh) ||
    toNumber(fields.kwh || fields.solarGenerationKwh);
  const plantSec = toNumber(fields.plantSec);

  // Section sub-meter consumption dict — preserve as plain object
  const raw = fields.sectionConsumption;
  const sectionConsumption = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? { ...raw }
    : {};

  return {
    id: fields.id || uid('e'),
    createdAt: fields.createdAt || now(),
    date: fields.date || new Date().toISOString().slice(0, 10),
    source: fields.source || '',
    remarks: fields.remarks || '',
    plantSection: fields.plantSection || fields.section || '',
    // ── Dual-unit grid ─────────────────────────────────────────────────────
    uhbvnlUnit1Kwh,
    uhbvnlUnit2Kwh,
    totalGridKwh,
    // ── DG generators ──────────────────────────────────────────────────────
    dg500RunHours,      // kept for backward compat
    dg380RunHours,      // kept for backward compat
    // ── Fuel & solar ───────────────────────────────────────────────────────
    fuelConsumedLitres, // kept for backward compat
    solarGenerationKwh, // kept for backward compat
    // ── Totals ─────────────────────────────────────────────────────────────
    dgKwh,
    totalKwh,
    plantSec,
    // legacy single-value kwh (used by Reports.jsx / analytics energyTotal)
    kwh: totalKwh || toNumber(fields.kwh || fields.solarGenerationKwh),
    // ── Section sub-meters ─────────────────────────────────────────────────
    sectionConsumption,
  };
}

// ── Daily Utility Log normalizer ──────────────────────────────────────────
function normalizeDailyUtilityLog(fields) {
  return {
    id: fields.id || uid('dul'),
    date: fields.date || new Date().toISOString().slice(0, 10),
    u1ImportKwhReading: toNumber(fields.u1ImportKwhReading),
    u1ImportKvahReading: toNumber(fields.u1ImportKvahReading),
    u1ExportKwhReading: toNumber(fields.u1ExportKwhReading),
    u1ExportKvahReading: toNumber(fields.u1ExportKvahReading),
    u1SolarKwhReading: toNumber(fields.u1SolarKwhReading),
    u1SolarKvahReading: toNumber(fields.u1SolarKvahReading),
    u1Pf: toNumber(fields.u1Pf),
    u2ImportKwhReading: toNumber(fields.u2ImportKwhReading),
    u2ImportKvahReading: toNumber(fields.u2ImportKvahReading),
    u2ExportKwhReading: toNumber(fields.u2ExportKwhReading),
    u2ExportKvahReading: toNumber(fields.u2ExportKvahReading),
    u2SolarKwhReading: toNumber(fields.u2SolarKwhReading),
    u2SolarKvahReading: toNumber(fields.u2SolarKvahReading),
    u2Pf: toNumber(fields.u2Pf),
    dg380KwhReading: toNumber(fields.dg380KwhReading),
    dg380HourmeterReading: toNumber(fields.dg380HourmeterReading),
    dg380HsdOpeningLtr: toNumber(fields.dg380HsdOpeningLtr),
    dg380HsdAddedLtr: toNumber(fields.dg380HsdAddedLtr),
    dg380DefOpeningPct: toNumber(fields.dg380DefOpeningPct),
    dg380DefAddedPct: toNumber(fields.dg380DefAddedPct),
    dg500KwhReading: toNumber(fields.dg500KwhReading),
    dg500HourmeterReading: toNumber(fields.dg500HourmeterReading),
    dg500HsdOpeningLtr: toNumber(fields.dg500HsdOpeningLtr),
    dg500HsdAddedLtr: toNumber(fields.dg500HsdAddedLtr),
    dg500DefOpeningPct: toNumber(fields.dg500DefOpeningPct),
    dg500DefAddedPct: toNumber(fields.dg500DefAddedPct),
    createdAt: fields.createdAt || now(),
    updatedAt: fields.updatedAt || now(),
  };
}

function normalizeDailyUtilityLogCloudRow(row) {
  return normalizeDailyUtilityLog({
    id: row.id,
    date: row.date,
    u1ImportKwhReading: row.u1_import_kwh_reading,
    u1ImportKvahReading: row.u1_import_kvah_reading,
    u1ExportKwhReading: row.u1_export_kwh_reading,
    u1ExportKvahReading: row.u1_export_kvah_reading,
    u1SolarKwhReading: row.u1_solar_kwh_reading,
    u1SolarKvahReading: row.u1_solar_kvah_reading,
    u1Pf: row.u1_pf,
    u2ImportKwhReading: row.u2_import_kwh_reading,
    u2ImportKvahReading: row.u2_import_kvah_reading,
    u2ExportKwhReading: row.u2_export_kwh_reading,
    u2ExportKvahReading: row.u2_export_kvah_reading,
    u2SolarKwhReading: row.u2_solar_kwh_reading,
    u2SolarKvahReading: row.u2_solar_kvah_reading,
    u2Pf: row.u2_pf,
    dg380KwhReading: row.dg380_kwh_reading,
    dg380HourmeterReading: row.dg380_hourmeter_reading,
    dg380HsdOpeningLtr: row.dg380_hsd_opening_ltr,
    dg380HsdAddedLtr: row.dg380_hsd_added_ltr,
    dg380DefOpeningPct: row.dg380_def_opening_pct,
    dg380DefAddedPct: row.dg380_def_added_pct,
    dg500KwhReading: row.dg500_kwh_reading,
    dg500HourmeterReading: row.dg500_hourmeter_reading,
    dg500HsdOpeningLtr: row.dg500_hsd_opening_ltr,
    dg500HsdAddedLtr: row.dg500_hsd_added_ltr,
    dg500DefOpeningPct: row.dg500_def_opening_pct,
    dg500DefAddedPct: row.dg500_def_added_pct,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function dailyUtilityLogToCloudRow(record) {
  return {
    id: record.id,
    date: record.date,
    u1_import_kwh_reading: record.u1ImportKwhReading,
    u1_import_kvah_reading: record.u1ImportKvahReading,
    u1_export_kwh_reading: record.u1ExportKwhReading,
    u1_export_kvah_reading: record.u1ExportKvahReading,
    u1_solar_kwh_reading: record.u1SolarKwhReading,
    u1_solar_kvah_reading: record.u1SolarKvahReading,
    u1_pf: record.u1Pf,
    u2_import_kwh_reading: record.u2ImportKwhReading,
    u2_import_kvah_reading: record.u2ImportKvahReading,
    u2_export_kwh_reading: record.u2ExportKwhReading,
    u2_export_kvah_reading: record.u2ExportKvahReading,
    u2_solar_kwh_reading: record.u2SolarKwhReading,
    u2_solar_kvah_reading: record.u2SolarKvahReading,
    u2_pf: record.u2Pf,
    dg380_kwh_reading: record.dg380KwhReading,
    dg380_hourmeter_reading: record.dg380HourmeterReading,
    dg380_hsd_opening_ltr: record.dg380HsdOpeningLtr,
    dg380_hsd_added_ltr: record.dg380HsdAddedLtr,
    dg380_def_opening_pct: record.dg380DefOpeningPct,
    dg380_def_added_pct: record.dg380DefAddedPct,
    dg500_kwh_reading: record.dg500KwhReading,
    dg500_hourmeter_reading: record.dg500HourmeterReading,
    dg500_hsd_opening_ltr: record.dg500HsdOpeningLtr,
    dg500_hsd_added_ltr: record.dg500HsdAddedLtr,
    dg500_def_opening_pct: record.dg500DefOpeningPct,
    dg500_def_added_pct: record.dg500DefAddedPct,
    updated_at: record.updatedAt,
  };
}

// ── Monthly Herbicide normalizer ─────────────────────────────────────────
function normalizeMonthlyHerbicide(fields) {
  return {
    id: fields.id || uid('mherb'),
    month: fields.month || '',
    glyphosateM1MeterReading: toNumber(fields.glyphosateM1MeterReading),
    maintenanceTopperM2MeterReading: toNumber(fields.maintenanceTopperM2MeterReading),
    acmHerbicideM3MeterReading: toNumber(fields.acmHerbicideM3MeterReading),
    topperHerbicideM4MeterReading: toNumber(fields.topperHerbicideM4MeterReading),
    maintenancePrintingMeterReading: toNumber(fields.maintenancePrintingMeterReading),
    createdAt: fields.createdAt || now(),
    updatedAt: fields.updatedAt || now(),
  };
}

function normalizeMonthlyHerbicideCloudRow(row) {
  return normalizeMonthlyHerbicide({
    id: row.id,
    month: row.month,
    glyphosateM1MeterReading: row.glyphosate_m1_meter_reading,
    maintenanceTopperM2MeterReading: row.maintenance_topper_m2_meter_reading,
    acmHerbicideM3MeterReading: row.acm_herbicide_m3_meter_reading,
    topperHerbicideM4MeterReading: row.topper_herbicide_m4_meter_reading,
    maintenancePrintingMeterReading: row.maintenance_printing_meter_reading,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function monthlyHerbicideToCloudRow(record) {
  return {
    id: record.id,
    month: record.month,
    glyphosate_m1_meter_reading: record.glyphosateM1MeterReading,
    maintenance_topper_m2_meter_reading: record.maintenanceTopperM2MeterReading,
    acm_herbicide_m3_meter_reading: record.acmHerbicideM3MeterReading,
    topper_herbicide_m4_meter_reading: record.topperHerbicideM4MeterReading,
    maintenance_printing_meter_reading: record.maintenancePrintingMeterReading,
    updated_at: record.updatedAt,
  };
}

// ── Monthly Insecticide normalizer ───────────────────────────────────────
function normalizeMonthlyInsecticide(fields) {
  return {
    id: fields.id || uid('mins'),
    month: fields.month || '',
    feeder2ScElectricRoomMeterReading: toNumber(fields.feeder2ScElectricRoomMeterReading),
    feeder3WaterbathMeterReading: toNumber(fields.feeder3WaterbathMeterReading),
    feeder4JetmillMeterReading: toNumber(fields.feeder4JetmillMeterReading),
    feeder5CartapPlantMeterReading: toNumber(fields.feeder5CartapPlantMeterReading),
    feeder6EcFormulationMeterReading: toNumber(fields.feeder6EcFormulationMeterReading),
    feeder7SpareMeterReading: toNumber(fields.feeder7SpareMeterReading),
    feeder8EcPackingMeterReading: toNumber(fields.feeder8EcPackingMeterReading),
    feeder9AdminBlockMeterReading: toNumber(fields.feeder9AdminBlockMeterReading),
    acmInsecticideMeterReading: toNumber(fields.acmInsecticideMeterReading),
    airCompressor02IrMeterReading: toNumber(fields.airCompressor02IrMeterReading),
    airCompressor03AtlasMeterReading: toNumber(fields.airCompressor03AtlasMeterReading),
    airCompressor01IrAtlasMeterReading: toNumber(fields.airCompressor01IrAtlasMeterReading),
    createdAt: fields.createdAt || now(),
    updatedAt: fields.updatedAt || now(),
  };
}

function normalizeMonthlyInsecticideCloudRow(row) {
  return normalizeMonthlyInsecticide({
    id: row.id,
    month: row.month,
    feeder2ScElectricRoomMeterReading: row.feeder2_sc_electric_room_meter_reading,
    feeder3WaterbathMeterReading: row.feeder3_waterbath_meter_reading,
    feeder4JetmillMeterReading: row.feeder4_jetmill_meter_reading,
    feeder5CartapPlantMeterReading: row.feeder5_cartap_plant_meter_reading,
    feeder6EcFormulationMeterReading: row.feeder6_ec_formulation_meter_reading,
    feeder7SpareMeterReading: row.feeder7_spare_meter_reading,
    feeder8EcPackingMeterReading: row.feeder8_ec_packing_meter_reading,
    feeder9AdminBlockMeterReading: row.feeder9_admin_block_meter_reading,
    acmInsecticideMeterReading: row.acm_insecticide_meter_reading,
    airCompressor02IrMeterReading: row.air_compressor02_ir_meter_reading,
    airCompressor03AtlasMeterReading: row.air_compressor03_atlas_meter_reading,
    airCompressor01IrAtlasMeterReading: row.air_compressor01_ir_atlas_meter_reading,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function monthlyInsecticideToCloudRow(record) {
  return {
    id: record.id,
    month: record.month,
    feeder2_sc_electric_room_meter_reading: record.feeder2ScElectricRoomMeterReading,
    feeder3_waterbath_meter_reading: record.feeder3WaterbathMeterReading,
    feeder4_jetmill_meter_reading: record.feeder4JetmillMeterReading,
    feeder5_cartap_plant_meter_reading: record.feeder5CartapPlantMeterReading,
    feeder6_ec_formulation_meter_reading: record.feeder6EcFormulationMeterReading,
    feeder7_spare_meter_reading: record.feeder7SpareMeterReading,
    feeder8_ec_packing_meter_reading: record.feeder8EcPackingMeterReading,
    feeder9_admin_block_meter_reading: record.feeder9AdminBlockMeterReading,
    acm_insecticide_meter_reading: record.acmInsecticideMeterReading,
    air_compressor02_ir_meter_reading: record.airCompressor02IrMeterReading,
    air_compressor03_atlas_meter_reading: record.airCompressor03AtlasMeterReading,
    air_compressor01_ir_atlas_meter_reading: record.airCompressor01IrAtlasMeterReading,
    updated_at: record.updatedAt,
  };
}

// ── Monthly Water normalizer ─────────────────────────────────────────────
function normalizeMonthlyWater(fields) {
  return {
    id: fields.id || uid('mwat'),
    month: fields.month || '',
    stpOutletMeterReading: toNumber(fields.stpOutletMeterReading),
    roInletMeterReading: toNumber(fields.roInletMeterReading),
    roRejectedMeterReading: toNumber(fields.roRejectedMeterReading),
    piauWaterMeterReading: toNumber(fields.piauWaterMeterReading),
    createdAt: fields.createdAt || now(),
    updatedAt: fields.updatedAt || now(),
  };
}

function normalizeMonthlyWaterCloudRow(row) {
  return normalizeMonthlyWater({
    id: row.id,
    month: row.month,
    stpOutletMeterReading: row.stp_outlet_meter_reading,
    roInletMeterReading: row.ro_inlet_meter_reading,
    roRejectedMeterReading: row.ro_rejected_meter_reading,
    piauWaterMeterReading: row.piau_water_meter_reading,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function monthlyWaterToCloudRow(record) {
  return {
    id: record.id,
    month: record.month,
    stp_outlet_meter_reading: record.stpOutletMeterReading,
    ro_inlet_meter_reading: record.roInletMeterReading,
    ro_rejected_meter_reading: record.roRejectedMeterReading,
    piau_water_meter_reading: record.piauWaterMeterReading,
    updated_at: record.updatedAt,
  };
}

// ── Monthly Air Compressor normalizer ────────────────────────────────────
function normalizeMonthlyAirCompressor(fields) {
  return {
    id: fields.id || uid('macmp'),
    month: fields.month || '',
    compressor1RunHrsReading: toNumber(fields.compressor1RunHrsReading),
    compressor1LoadHrsReading: toNumber(fields.compressor1LoadHrsReading),
    compressor2RunHrsReading: toNumber(fields.compressor2RunHrsReading),
    compressor2LoadHrsReading: toNumber(fields.compressor2LoadHrsReading),
    compressor3RunHrsReading: toNumber(fields.compressor3RunHrsReading),
    compressor3LoadHrsReading: toNumber(fields.compressor3LoadHrsReading),
    createdAt: fields.createdAt || now(),
    updatedAt: fields.updatedAt || now(),
  };
}

function normalizeMonthlyAirCompressorCloudRow(row) {
  return normalizeMonthlyAirCompressor({
    id: row.id,
    month: row.month,
    compressor1RunHrsReading: row.compressor1_run_hrs_reading,
    compressor1LoadHrsReading: row.compressor1_load_hrs_reading,
    compressor2RunHrsReading: row.compressor2_run_hrs_reading,
    compressor2LoadHrsReading: row.compressor2_load_hrs_reading,
    compressor3RunHrsReading: row.compressor3_run_hrs_reading,
    compressor3LoadHrsReading: row.compressor3_load_hrs_reading,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function monthlyAirCompressorToCloudRow(record) {
  return {
    id: record.id,
    month: record.month,
    compressor1_run_hrs_reading: record.compressor1RunHrsReading,
    compressor1_load_hrs_reading: record.compressor1LoadHrsReading,
    compressor2_run_hrs_reading: record.compressor2RunHrsReading,
    compressor2_load_hrs_reading: record.compressor2LoadHrsReading,
    compressor3_run_hrs_reading: record.compressor3RunHrsReading,
    compressor3_load_hrs_reading: record.compressor3LoadHrsReading,
    updated_at: record.updatedAt,
  };
}

// ── Daily Solar Generation normalizer ────────────────────────────────────
function normalizeDailySolarGeneration(fields) {
  return {
    id: fields.id || uid('dsg'),
    date: fields.date || new Date().toISOString().slice(0, 10),
    u1Inv1Kwh: toNumber(fields.u1Inv1Kwh),
    u1Inv2Kwh: toNumber(fields.u1Inv2Kwh),
    u1Inv3Kwh: toNumber(fields.u1Inv3Kwh),
    u1Inv4Kwh: toNumber(fields.u1Inv4Kwh),
    u2Inv1Kwh: toNumber(fields.u2Inv1Kwh),
    u2Inv2Kwh: toNumber(fields.u2Inv2Kwh),
    u2Inv3Kwh: toNumber(fields.u2Inv3Kwh),
    dailyTotalKwh: toNumber(fields.dailyTotalKwh),
    createdAt: fields.createdAt || now(),
    updatedAt: fields.updatedAt || now(),
  };
}

function normalizeDailySolarGenerationCloudRow(row) {
  return normalizeDailySolarGeneration({
    id: row.id,
    date: row.date,
    u1Inv1Kwh: row.u1_inv1_kwh,
    u1Inv2Kwh: row.u1_inv2_kwh,
    u1Inv3Kwh: row.u1_inv3_kwh,
    u1Inv4Kwh: row.u1_inv4_kwh,
    u2Inv1Kwh: row.u2_inv1_kwh,
    u2Inv2Kwh: row.u2_inv2_kwh,
    u2Inv3Kwh: row.u2_inv3_kwh,
    dailyTotalKwh: row.daily_total_kwh,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function dailySolarGenerationToCloudRow(record) {
  return {
    id: record.id,
    date: record.date,
    u1_inv1_kwh: record.u1Inv1Kwh,
    u1_inv2_kwh: record.u1Inv2Kwh,
    u1_inv3_kwh: record.u1Inv3Kwh,
    u1_inv4_kwh: record.u1Inv4Kwh,
    u2_inv1_kwh: record.u2Inv1Kwh,
    u2_inv2_kwh: record.u2Inv2Kwh,
    u2_inv3_kwh: record.u2Inv3Kwh,
    daily_total_kwh: record.dailyTotalKwh,
    updated_at: record.updatedAt,
  };
}

// ── Energy Settings normalizer ───────────────────────────────────────────
function normalizeEnergySettings(fields) {
  const capRaw = fields.installedSolarCapacityKwp;
  const cap = capRaw != null && capRaw !== '' ? toNumber(capRaw) : 540;
  const capFinal = cap > 0 ? cap : 540;
  return {
    id: fields.id || 'default',
    u1ImportExportCt: toNumber(fields.u1ImportExportCt),
    u1SolarCt: toNumber(fields.u1SolarCt),
    u2ImportExportCt: toNumber(fields.u2ImportExportCt),
    u2SolarCt: toNumber(fields.u2SolarCt),
    pfWarningThreshold: toNumber(fields.pfWarningThreshold),
    installedSolarCapacityKwp: capFinal,
    gridCo2EmissionFactor: toNumber(fields.gridCo2EmissionFactor),
    avgPeakSunHoursPerDay: toNumber(fields.avgPeakSunHoursPerDay),
    createdAt: fields.createdAt || now(),
    updatedAt: fields.updatedAt || now(),
  };
}

function normalizeEnergySettingsCloudRow(row) {
  return normalizeEnergySettings({
    id: row.id,
    u1ImportExportCt: row.u1_import_export_ct,
    u1SolarCt: row.u1_solar_ct,
    u2ImportExportCt: row.u2_import_export_ct,
    u2SolarCt: row.u2_solar_ct,
    pfWarningThreshold: row.pf_warning_threshold,
    installedSolarCapacityKwp: row.installed_solar_capacity_kwp,
    gridCo2EmissionFactor: row.grid_co2_emission_factor,
    avgPeakSunHoursPerDay: row.avg_peak_sun_hours_per_day,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function energySettingsToCloudRow(record) {
  return {
    id: record.id,
    u1_import_export_ct: record.u1ImportExportCt,
    u1_solar_ct: record.u1SolarCt,
    u2_import_export_ct: record.u2ImportExportCt,
    u2_solar_ct: record.u2SolarCt,
    pf_warning_threshold: record.pfWarningThreshold,
    installed_solar_capacity_kwp: record.installedSolarCapacityKwp,
    grid_co2_emission_factor: record.gridCo2EmissionFactor,
    avg_peak_sun_hours_per_day: record.avgPeakSunHoursPerDay,
    updated_at: record.updatedAt,
  };
}

function normalizeMachineRecord(machine) {
  const payload = asPlainObject(machine.payload);
  const source = { ...payload, ...machine };
  const id = source.id || source.machineCode || uid('m');
  const docs = Array.isArray(source.attachments)
    ? source.attachments
    : Array.isArray(source.docs)
      ? source.docs
      : Array.isArray(payload.attachments)
        ? payload.attachments
        : Array.isArray(payload.docs)
          ? payload.docs
          : [];
  return {
    ...MACHINE_DEFAULTS,
    ...payload,
    ...machine,
    id,
    machineCode: source.machineCode || id,
    name: String(source.name || '').trim(),
    section: source.section || '',
    department: source.department || source.section || '',
    status: normalizeMachineStatus(source.status || 'running'),
    docs: docs.map((doc) => normalizeMachineDoc({ ...doc, machine_id: doc.machine_id || id, plant_section: doc.plant_section || source.section || '' })),
    spares: Array.isArray(source.spares) ? source.spares : [],
    photos: Array.isArray(source.photos) ? source.photos : [],
    createdAt: source.createdAt || source.created_at || now(),
  };
}

function machineMatches(left, right) {
  const leftCode = normalizeText(left.machineCode || left.id);
  const rightCode = normalizeText(right.machineCode || right.id);
  const leftName = normalizeText(left.name);
  const rightName = normalizeText(right.name);

  return (
    (left.id && right.id && left.id === right.id) ||
    (leftCode && rightCode && leftCode === rightCode) ||
    (leftName && rightName && leftName === rightName)
  );
}

function mergeSeedMachines(storedMachines, seedMachines) {
  const merged = Array.isArray(storedMachines)
    ? storedMachines.map(normalizeMachineRecord)
    : [];

  if (!merged.length) {
    return seedMachines.map(normalizeMachineRecord);
  }

  seedMachines
    .map(normalizeMachineRecord)
    .forEach((seedMachine) => {
      const matchIndex = merged.findIndex((machine) => machineMatches(machine, seedMachine));
      if (matchIndex === -1) {
        merged.push(seedMachine);
        return;
      }

      const current = merged[matchIndex];
      merged[matchIndex] = normalizeMachineRecord({
        ...seedMachine,
        ...current,
        id: current.id || seedMachine.id,
        machineCode: current.machineCode || seedMachine.machineCode,
        createdAt: current.createdAt || seedMachine.createdAt,
        department: current.department || current.section || seedMachine.section,
      });
    });

  return merged;
}

function resolvePeriod(fields = {}) {
  const direct = fields.period || fields.monthKey;
  if (/^\d{4}-\d{2}$/.test(String(direct || ''))) {
    const [year, month] = String(direct).split('-').map(Number);
    return { period: direct, year, month, monthName: MONTHS[month - 1] };
  }

  if (isPresent(fields.month) && isPresent(fields.year)) {
    const numericMonth = Number(fields.month);
    const monthIndex = Number.isInteger(numericMonth) && numericMonth > 0
      ? numericMonth - 1
      : MONTHS.findIndex((item) => normalizeText(item) === normalizeText(fields.month));
    const year = Number(fields.year);
    if (monthIndex >= 0 && year) {
      const period = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
      return { period, year, month: monthIndex + 1, monthName: MONTHS[monthIndex] };
    }
  }

  const fallback = new Date(fields.createdAt || fields.breakdownDate || fields.pmDate || fields.date || now());
  const year = fallback.getFullYear();
  const month = fallback.getMonth() + 1;
  const period = `${year}-${String(month).padStart(2, '0')}`;
  return { period, year, month, monthName: MONTHS[month - 1] };
}

function normalizeBreakdownSummary(fields) {
  const { period, year, monthName } = resolvePeriod(fields);
  const section = fields.section || fields.plantSection || MASTER_SECTION;
  const breakdownCount = Math.max(0, Math.round(toNumber(fields.breakdownCount ?? fields.totalBreakdowns)));
  const downtimeHours = Math.max(0, round1(fields.downtimeHours ?? fields.totalDowntimeHours));
  const autoOperatingHours = sectionMachineCount(section) * HOURS_PER_MONTH;
  const operatingHours = Math.max(0, round1(isPresent(fields.operatingHours) ? fields.operatingHours : autoOperatingHours));
  const mttr = isPresent(fields.mttr)
    ? round1(fields.mttr)
    : breakdownCount > 0 ? round1(downtimeHours / breakdownCount) : 0;
  const mtbf = isPresent(fields.mtbf)
    ? round1(fields.mtbf)
    : breakdownCount > 0 ? round1(Math.max(0, operatingHours - downtimeHours) / breakdownCount) : 0;

  // availability_override: explicit percentage (0-100) set by admin to bypass
  // the dynamic formula. null / undefined means use auto-calculation.
  const rawOverride = fields.availability_override ?? fields.availabilityOverride;
  const availability_override = isPresent(rawOverride)
    ? Math.max(0, Math.min(100, round1(rawOverride)))
    : null;

  return {
    id: fields.id || uid('bdm'),
    period,
    month: monthName,
    year,
    section,
    breakdownCount,
    downtimeHours,
    operatingHours,
    mttr,
    mtbf,
    availability_override,
    remarks: fields.remarks || fields.notes || '',
    createdAt: fields.createdAt || now(),
    updatedAt: fields.updatedAt || now(),
  };
}

function normalizePMSummary(fields) {
  const { period, year, monthName } = resolvePeriod(fields);
  const section = fields.section || fields.plantSection || MASTER_SECTION;
  const plannedCount = Math.max(0, Math.round(toNumber(fields.plannedCount ?? fields.actualPlannedPMCount)));
  const doneCount = Math.max(0, Math.round(toNumber(fields.doneCount ?? fields.actualDonePMCount)));
  const pendingCount = Math.max(0, Math.round(toNumber(fields.pendingCount ?? fields.overdueCount ?? fields.pendingPMCount)));
  const compliancePct = isPresent(fields.compliancePct)
    ? round1(fields.compliancePct)
    : plannedCount > 0 ? round1((doneCount / plannedCount) * 100) : 0;

  const startTime = fields.startTime || fields.start_time || '';
  const endTime = fields.endTime || fields.end_time || '';
  let durationHours = toNumber(fields.durationHours ?? fields.duration_hours);
  if (!durationHours && startTime && endTime) {
    const diff = (new Date(endTime) - new Date(startTime)) / 3_600_000;
    durationHours = diff > 0 ? round1(diff) : 0;
  }

  return {
    id: fields.id || uid('pmm'),
    period,
    month: monthName,
    year,
    section,
    machineId: fields.machineId || '',
    plannedCount,
    doneCount,
    pendingCount,
    compliancePct,
    startTime,
    endTime,
    durationHours,
    remarks: fields.remarks || fields.notes || '',
    createdAt: fields.createdAt || now(),
    updatedAt: fields.updatedAt || now(),
  };
}

function normalizeMachineCloudRow(row) {
  const payload = asPlainObject(row.payload);
  return normalizeMachineRecord({
    ...payload,
    id: row.id,
    name: row.name || payload.name || '',
    section: row.section || payload.section || '',
    attachments: Array.isArray(row.attachments)
      ? row.attachments
      : Array.isArray(payload.attachments)
        ? payload.attachments
        : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function machineToCloudRow(machine) {
  const attachments = (machine.docs || []).map((doc) => ({
    id: doc.id,
    tab: doc.tab,
    file_name: doc.filename,
    file_format: doc.file_format,
    public_url: doc.public_url || doc.file_url || '',
    storage_path: doc.storage_path || '',
    uploaded_at: doc.uploaded_at || doc.uploadedAt || now(),
    uploaded_by: doc.uploaded_by || doc.uploadedBy || 'System',
    machine_id: machine.id,
    plant_section: machine.section || MASTER_SECTION,
  }));

  return {
    id: machine.id,
    name: machine.name,
    section: machine.section || MASTER_SECTION,
    attachments,
    payload: {
      machineCode: machine.machineCode || machine.id,
      department: machine.department || machine.section || '',
      area: machine.area || '',
      manufacturer: machine.manufacturer || '',
      model: machine.model || '',
      serialNumber: machine.serialNumber || '',
      installDate: machine.installDate || '',
      powerRating: machine.powerRating || '',
      voltage: machine.voltage || '',
      current: machine.current || '',
      runningHours: machine.runningHours || 0,
      criticality: machine.criticality || '',
      status: machine.status || 'running',
      spares: Array.isArray(machine.spares) ? machine.spares : [],
      photos: Array.isArray(machine.photos) ? machine.photos : [],
      createdAt: machine.createdAt || now(),
    },
  };
}

function normalizeBreakdownCloudRow(row) {
  return normalizeBreakdownSummary({
    id: row.id,
    period: row.period,
    month: row.month,
    year: row.year,
    section: row.section || MASTER_SECTION,
    breakdownCount: row.total_breakdowns,
    downtimeHours: row.downtime_hours,
    mttr: row.mttr,
    mtbf: row.mtbf,
    availability_override: row.availability_override ?? null,
    remarks: row.remarks || '',
  });
}

function breakdownToCloudRow(record) {
  const { year, month } = resolvePeriod(record);
  return {
    id: record.id,
    month,
    year,
    period: record.period,
    section: record.section || MASTER_SECTION,
    total_breakdowns: record.breakdownCount,
    downtime_hours: record.downtimeHours,
    mttr: record.mttr,
    mtbf: record.mtbf,
    availability_override: record.availability_override ?? null,
    remarks: record.remarks || '',
  };
}

function normalizePMCloudRow(row) {
  return normalizePMSummary({
    id: row.id,
    period: row.period,
    month: row.month,
    year: row.year,
    section: row.section || MASTER_SECTION,
    plannedCount: row.planned_count,
    doneCount: row.done_count,
    pendingCount: row.overdue_count,
    startTime: row.start_time || '',
    endTime: row.end_time || '',
    durationHours: row.duration_hours || 0,
  });
}

function pmToCloudRow(record) {
  const { year, month } = resolvePeriod(record);
  return {
    id: record.id,
    month,
    year,
    period: record.period,
    section: record.section || MASTER_SECTION,
    planned_count: record.plannedCount,
    done_count: record.doneCount,
    overdue_count: record.pendingCount,
    start_time: record.startTime || null,
    end_time: record.endTime || null,
    duration_hours: record.durationHours || 0,
  };
}

function normalizeEnergyCloudRow(row) {
  return normalizeEnergyRecord({
    id: row.id,
    date: row.date,
    source: row.source || '',
    remarks: row.remarks || '',
    plantSection: row.plant_section || '',
    dg500RunHours: row.dg500_run_hours,
    dg380RunHours: row.dg380_run_hours,
    fuelConsumedLitres: row.fuel_consumed_litres,
    solarGenerationKwh: row.solar_generation_kwh,
    uhbvnlUnit1Kwh: row.uhbvnl_unit1_kwh,
    uhbvnlUnit2Kwh: row.uhbvnl_unit2_kwh,
    totalGridKwh: row.total_grid_kwh,
    dgKwh: row.dg_kwh,
    totalKwh: row.total_kwh,
    plantSec: row.plant_sec,
    kwh: row.kwh,
    sectionConsumption: row.section_consumption || {},
    createdAt: row.created_at || row.date,
  });
}

function energyToCloudRow(record) {
  return {
    id: record.id,
    date: record.date,
    source: record.source || '',
    remarks: record.remarks || '',
    plant_section: record.plantSection || '',
    dg500_run_hours: record.dg500RunHours || 0,
    dg380_run_hours: record.dg380RunHours || 0,
    fuel_consumed_litres: record.fuelConsumedLitres || 0,
    solar_generation_kwh: record.solarGenerationKwh || 0,
    uhbvnl_unit1_kwh: record.uhbvnlUnit1Kwh || 0,
    uhbvnl_unit2_kwh: record.uhbvnlUnit2Kwh || 0,
    total_grid_kwh: record.totalGridKwh || 0,
    dg_kwh: record.dgKwh || 0,
    total_kwh: record.totalKwh || 0,
    plant_sec: record.plantSec || 0,
    kwh: record.kwh || 0,
    section_consumption: record.sectionConsumption || {},
  };
}

// ── AMC (Annual Maintenance Contract) records ─────────────────────────────
function normalizeAmcRecord(fields) {
  return {
    id: fields.id || uid('amc'),
    machineId: fields.machineId || '',
    vendorName: String(fields.vendorName || '').trim(),
    contractStartDate: fields.contractStartDate || '',
    contractEndDate: fields.contractEndDate || '',
    totalVisitsAgreed: toNumber(fields.totalVisitsAgreed),
    completedVisits: toNumber(fields.completedVisits),
    // Document references stored as array of { id, filename, storagePath, publicUrl, uploadedAt, uploadedBy, docType }
    documents: Array.isArray(fields.documents) ? fields.documents : [],
    remarks: fields.remarks || '',
    createdAt: fields.createdAt || now(),
    updatedAt: fields.updatedAt || now(),
  };
}

function normalizeAmcCloudRow(row) {
  return normalizeAmcRecord({
    id: row.id,
    machineId: row.machine_id || '',
    vendorName: row.vendor_name || '',
    contractStartDate: row.contract_start_date || '',
    contractEndDate: row.contract_end_date || '',
    totalVisitsAgreed: row.total_visits_agreed,
    completedVisits: row.completed_visits,
    documents: row.documents || [],
    remarks: row.remarks || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function amcToCloudRow(record) {
  return {
    id: record.id,
    machine_id: record.machineId,
    vendor_name: record.vendorName,
    contract_start_date: record.contractStartDate,
    contract_end_date: record.contractEndDate,
    total_visits_agreed: record.totalVisitsAgreed || 0,
    completed_visits: record.completedVisits || 0,
    documents: record.documents || [],
    remarks: record.remarks || '',
    updated_at: now(),
  };
}

// ── Per-machine breakdown log records ─────────────────────────────────────

/**
 * Compute downtime hours from startTime / endTime ISO strings.
 * Returns null when either value is missing or the range is invalid.
 */
function calcDowntimeFromTimes(startTime, endTime) {
  if (!startTime || !endTime) return null;
  const start = new Date(startTime).getTime();
  const end   = new Date(endTime).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round(((end - start) / 3_600_000) * 100) / 100; // hours, 2 dp
}

function normalizeMachineBreakdownLog(fields) {
  const startTime = fields.startTime || fields.start_time || '';
  const endTime   = fields.endTime   || fields.end_time   || '';

  // Derive date from startTime when date is absent
  let date = fields.date || '';
  if (!date && startTime) {
    date = new Date(startTime).toISOString().slice(0, 10);
  }
  if (!date) date = new Date().toISOString().slice(0, 10);

  // Downtime: auto-calculate from times when not explicitly provided
  const autoDowntime = calcDowntimeFromTimes(startTime, endTime);
  const downtimeHours = isPresent(fields.downtimeHours) && toNumber(fields.downtimeHours) > 0
    ? toNumber(fields.downtimeHours)
    : (autoDowntime !== null ? autoDowntime : 0);

  return {
    id: fields.id || uid('bdl'),
    machineId: fields.machineId || '',
    machineCode: fields.machineCode || '',
    machineName: fields.machineName || '',
    plantSection: fields.plantSection || '',
    date,
    startTime,
    endTime,
    downtimeHours,
    failureCause: String(fields.failureCause || '').trim(),
    actionTaken: String(fields.actionTaken || '').trim(),
    status: String(fields.status || 'closed').toLowerCase(),
    remarks: String(fields.remarks || '').trim(),
    createdAt: fields.createdAt || now(),
  };
}

function normalizeMachineBreakdownLogCloudRow(row) {
  return normalizeMachineBreakdownLog({
    id: row.id,
    machineId: row.machine_id || '',
    machineCode: row.machine_code || '',
    machineName: row.machine_name || '',
    plantSection: row.plant_section || '',
    date: row.date,
    startTime: row.start_time || '',
    endTime: row.end_time || '',
    downtimeHours: row.downtime_hours,
    failureCause: row.failure_cause || '',
    actionTaken: row.action_taken || '',
    status: row.status || 'closed',
    remarks: row.remarks || '',
    createdAt: row.created_at,
  });
}

function machineBreakdownLogToCloudRow(record) {
  return {
    id: record.id,
    machine_id: record.machineId,
    machine_code: record.machineCode,
    machine_name: record.machineName,
    plant_section: record.plantSection,
    date: record.date,
    start_time: record.startTime || null,
    end_time: record.endTime || null,
    downtime_hours: record.downtimeHours || 0,
    failure_cause: record.failureCause,
    action_taken: record.actionTaken,
    status: record.status,
    remarks: record.remarks,
  };
}

// ── Per-machine PM records ──────────────────────────────────────────────────
function normalizeMachinePmRecord(fields) {
  const pmDate = fields.pmDate || fields.pm_date || new Date().toISOString().slice(0, 10);
  return {
    id: fields.id || uid('mpm'),
    machineId: fields.machineId || '',
    machineCode: fields.machineCode || '',
    machineName: fields.machineName || '',
    plantSection: fields.plantSection || '',
    pmDate,
    pmType: String(fields.pmType || fields.pm_type || 'Preventive').trim(),
    task: String(fields.task || '').trim(),
    status: String(fields.status || 'completed').toLowerCase(),
    completed: fields.completed !== false && fields.completed !== 'false',
    action: String(fields.action || '').trim(),
    technician: String(fields.technician || '').trim(),
    remarks: String(fields.remarks || '').trim(),
    createdAt: fields.createdAt || now(),
    updatedAt: fields.updatedAt || now(),
  };
}

function normalizeMachinePmCloudRow(row) {
  return normalizeMachinePmRecord({
    id: row.id,
    machineId: row.machine_id || '',
    machineCode: row.machine_code || '',
    machineName: row.machine_name || '',
    plantSection: row.plant_section || '',
    pmDate: row.pm_date,
    pmType: row.pm_type || '',
    task: row.task || '',
    status: row.status || 'completed',
    completed: row.completed,
    action: row.action || '',
    technician: row.technician || '',
    remarks: row.remarks || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function machinePmRecordToCloudRow(record) {
  return {
    id: record.id,
    machine_id: record.machineId,
    machine_code: record.machineCode,
    machine_name: record.machineName,
    plant_section: record.plantSection,
    pm_date: record.pmDate,
    pm_type: record.pmType,
    task: record.task,
    status: record.status,
    completed: record.completed,
    action: record.action,
    technician: record.technician,
    remarks: record.remarks,
  };
}

function normalizePlantSectionCloudRow(row) {
  return {
    id: row.id,
    name: row.name || '',
    createdBy: row.created_by || '',
    createdAt: row.created_at || '',
  };
}

function plantSectionToCloudRow(record) {
  return {
    id: record.id,
    name: record.name,
    created_by: record.createdBy || '',
  };
}

// ── Testing Certificates (Safety & Statutory) ───────────────────────────────
function frequencyToMonths(freq) {
  if (typeof freq === 'number' && Number.isFinite(freq)) return freq;
  const s = String(freq || '').toLowerCase();
  if (s.includes('6 month')) return 6;
  if (s.includes('1 year') || s === '12' || s.includes('12 month')) return 12;
  if (s.includes('2 year')) return 24;
  if (s.includes('3 year')) return 36;
  if (s.includes('5 year')) return 60;
  if (s.includes('custom')) return 12;
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return n;
  return 12;
}
function normalizeTestingCertificate(fields) {
  return {
    id: fields.id || uid('tcert'),
    machineId: fields.machineId || fields.machine_id || '',
    machineCode: fields.machineCode || fields.machine_code || '',
    machineName: fields.machineName || fields.machine_name || '',
    plantSection: fields.plantSection || fields.plant_section || '',
    certificateType: String(fields.certificateType || fields.certificate_type || fields.cert_type || '').trim(),
    certificateNumber: String(fields.certificateNumber || fields.certificate_number || fields.cert_number || fields.licenseNumber || '').trim(),
    agencyName: String(fields.agencyName || fields.agency_name || fields.inspectorName || '').trim(),
    issueDate: fields.issueDate || fields.issue_date || '',
    expiryDate: fields.expiryDate || fields.expiry_date || '',
    frequency: String(fields.frequency || '').trim(),
    frequencyMonths: fields.frequencyMonths || fields.frequency_months || frequencyToMonths(fields.frequency),
    document: fields.document && typeof fields.document === 'object' ? fields.document : (fields.documentUrl || fields.document_url ? { filename: fields.documentName || 'certificate.pdf', publicUrl: fields.documentUrl || fields.document_url, storagePath: fields.documentPath || fields.document_path || '' } : null),
    documentName: fields.documentName || fields.document_name || fields.document?.filename || '',
    documentUrl: fields.documentUrl || fields.document_url || fields.document?.publicUrl || '',
    documentPath: fields.documentPath || fields.document_path || fields.document?.storagePath || '',
    remarks: String(fields.remarks || fields.notes || '').trim(),
    notes: String(fields.notes || fields.remarks || '').trim(),
    createdAt: fields.createdAt || fields.created_at || now(),
    updatedAt: fields.updatedAt || fields.updated_at || now(),
  };
}

function normalizeTestingCertificateCloudRow(row) {
  return normalizeTestingCertificate({
    id: row.id,
    machineId: row.machine_id,
    machineCode: row.machine_code,
    machineName: row.machine_name,
    plantSection: row.plant_section,
    certificateType: row.certificate_type || row.cert_type,
    certificateNumber: row.certificate_number || row.cert_number,
    agencyName: row.agency_name,
    issueDate: row.issue_date,
    expiryDate: row.expiry_date,
    frequency: row.frequency,
    frequencyMonths: row.frequency_months,
    document: row.document || (row.document_url ? { filename: row.document_name, publicUrl: row.document_url, storagePath: row.document_path } : null),
    documentName: row.document_name,
    documentUrl: row.document_url,
    documentPath: row.document_path,
    remarks: row.remarks || row.notes,
    notes: row.notes || row.remarks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function testingCertificateToCloudRow(record) {
  return {
    id: record.id,
    machine_id: record.machineId,
    machine_code: record.machineCode,
    machine_name: record.machineName,
    plant_section: record.plantSection,
    // Spec columns
    cert_type: record.certificateType,
    cert_number: record.certificateNumber,
    agency_name: record.agencyName,
    issue_date: record.issueDate || null,
    expiry_date: record.expiryDate || null,
    frequency_months: frequencyToMonths(record.frequency),
    document_url: record.documentUrl || record.document?.publicUrl || null,
    notes: record.remarks || record.notes || '',
    // Extended columns for backward compat
    certificate_type: record.certificateType,
    certificate_number: record.certificateNumber,
    frequency: record.frequency,
    document: record.document || null,
    document_name: record.documentName || record.document?.filename || null,
    document_path: record.documentPath || record.document?.storagePath || null,
    remarks: record.remarks,
    created_at: record.createdAt,
    updated_at: now(),
  };
}

function getTestingCertificateStatus(expiryDate) {
  if (!expiryDate) return { status: 'UNKNOWN', daysLeft: null, tone: 'info' };
  const today = new Date(); today.setHours(0,0,0,0);
  const expiry = new Date(expiryDate); expiry.setHours(0,0,0,0);
  const diff = Math.ceil((expiry - today) / (1000*60*60*24));
  if (diff <= 0) return { status: 'EXPIRED', daysLeft: diff, tone: 'danger' };
  if (diff >= 1 && diff <= 30) return { status: 'EXPIRING SOON', daysLeft: diff, tone: 'warning' };
  return { status: 'VALID', daysLeft: diff, tone: 'success' };
}

const CLOUD_ENTITY_CONFIG = {
  machines: {
    table: 'machines',
    fromRow: normalizeMachineCloudRow,
    toRow: machineToCloudRow,
    orderBy: [{ column: 'name', ascending: true }, { column: 'id', ascending: true }],
  },
  breakdowns: {
    table: 'breakdown_logs',
    fromRow: normalizeBreakdownCloudRow,
    toRow: breakdownToCloudRow,
    orderBy: [{ column: 'year', ascending: false }, { column: 'month', ascending: false }, { column: 'section', ascending: true }],
  },
  pms: {
    table: 'pm_logs',
    fromRow: normalizePMCloudRow,
    toRow: pmToCloudRow,
    orderBy: [{ column: 'year', ascending: false }, { column: 'month', ascending: false }, { column: 'section', ascending: true }],
  },
  energy: {
    table: 'energy_logs',
    fromRow: normalizeEnergyCloudRow,
    toRow: energyToCloudRow,
    orderBy: [{ column: 'date', ascending: false }],
  },
  amc: {
    table: 'amc_records',
    fromRow: normalizeAmcCloudRow,
    toRow: amcToCloudRow,
    orderBy: [{ column: 'created_at', ascending: false }],
  },
  machineBreakdownLogs: {
    table: 'machine_breakdown_logs',
    fromRow: normalizeMachineBreakdownLogCloudRow,
    toRow: machineBreakdownLogToCloudRow,
    orderBy: [{ column: 'date', ascending: false }],
  },
  machinePmRecords: {
    table: 'machine_pm_records',
    fromRow: normalizeMachinePmCloudRow,
    toRow: machinePmRecordToCloudRow,
    orderBy: [{ column: 'pm_date', ascending: false }],
  },
  plantSections: {
    table: 'plant_sections',
    fromRow: normalizePlantSectionCloudRow,
    toRow: plantSectionToCloudRow,
    orderBy: [{ column: 'name', ascending: true }],
  },
  dailyUtilityLog: {
    table: 'daily_utility_log',
    fromRow: normalizeDailyUtilityLogCloudRow,
    toRow: dailyUtilityLogToCloudRow,
    orderBy: [{ column: 'date', ascending: false }],
  },
  monthlyHerbicide: {
    table: 'monthly_herbicide_section',
    fromRow: normalizeMonthlyHerbicideCloudRow,
    toRow: monthlyHerbicideToCloudRow,
    orderBy: [{ column: 'month', ascending: false }],
  },
  monthlyInsecticide: {
    table: 'monthly_insecticide_section',
    fromRow: normalizeMonthlyInsecticideCloudRow,
    toRow: monthlyInsecticideToCloudRow,
    orderBy: [{ column: 'month', ascending: false }],
  },
  monthlyWater: {
    table: 'monthly_water_stp',
    fromRow: normalizeMonthlyWaterCloudRow,
    toRow: monthlyWaterToCloudRow,
    orderBy: [{ column: 'month', ascending: false }],
  },
  monthlyAirCompressor: {
    table: 'monthly_air_compressor',
    fromRow: normalizeMonthlyAirCompressorCloudRow,
    toRow: monthlyAirCompressorToCloudRow,
    orderBy: [{ column: 'month', ascending: false }],
  },
  dailySolarGeneration: {
    table: 'daily_solar_generation',
    fromRow: normalizeDailySolarGenerationCloudRow,
    toRow: dailySolarGenerationToCloudRow,
    orderBy: [{ column: 'date', ascending: false }],
  },
  energySettings: {
    table: 'energy_settings',
    fromRow: normalizeEnergySettingsCloudRow,
    toRow: energySettingsToCloudRow,
    orderBy: [{ column: 'id', ascending: true }],
  },
  testingCertificates: {
    table: 'testing_certificates',
    fromRow: normalizeTestingCertificateCloudRow,
    toRow: testingCertificateToCloudRow,
    orderBy: [{ column: 'expiry_date', ascending: true }],
  },
};

let version = 0;
const listeners = new Set();
let cloudSubscriptions = null;
let cloudInitStarted = false;
let cloudSyncChain = Promise.resolve();
const refreshTimers = {};
// Tracks reconnect attempt count for exponential back-off
let realtimeReconnectAttempts = 0;

// After a bulk import, suppress Realtime overwrite for 3 seconds per entity
const localImportSuppressUntil = {};

// ── Diagnostic logger ──────────────────────────────────────────────────────
// Set VITE_REALTIME_DEBUG=true in your .env to enable verbose Realtime logs.
// All log calls go through this helper so they're easy to strip later.
const RT_DEBUG = import.meta.env.VITE_REALTIME_DEBUG === 'true';
function rtLog(level, ...args) {
  if (!RT_DEBUG && level === 'debug') return;
  const tag = '[Realtime]';
  if (level === 'error') console.error(tag, ...args);
  else if (level === 'warn') console.warn(tag, ...args);
  else console.log(tag, ...args);
}

function loadPersistedValue(entity, fallback) {
  const primary = loadLS(KEYS[entity], undefined);
  if (primary !== undefined && primary !== null) {
    return primary;
  }

  for (const legacyKey of LEGACY_KEYS[entity] || []) {
    const legacy = loadLS(legacyKey, undefined);
    if (legacy !== undefined && legacy !== null) {
      return legacy;
    }
  }

  return fallback;
}

function removePersistedKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage cleanup failures and keep the in-memory reset path working.
  }
}

function loadPendingCloudOps() {
  const pending = loadLS(CLOUD_SYNC_QUEUE_KEY, []);
  return Array.isArray(pending) ? pending : [];
}

function savePendingCloudOps(queue) {
  saveLS(CLOUD_SYNC_QUEUE_KEY, queue);
}

function dropPendingCloudOpsForRecord(entity, recordId) {
  const nextQueue = loadPendingCloudOps().filter((item) => !(item.entity === entity && item.recordId === recordId));
  savePendingCloudOps(nextQueue);
  return nextQueue;
}

let state = {
  machines: mergeSeedMachines(loadPersistedValue('machines', null), SEED_MACHINES),
  breakdowns: loadPersistedValue('breakdowns', []).map((row) => row),
  pms: loadPersistedValue('pms', []).map((row) => row),
  energy: loadPersistedValue('energy', []).map(normalizeEnergyRecord),
  dailyUtilityLog: loadPersistedValue('dailyUtilityLog', []).map(normalizeDailyUtilityLog),
  monthlyHerbicide: loadPersistedValue('monthlyHerbicide', []).map(normalizeMonthlyHerbicide),
  monthlyInsecticide: loadPersistedValue('monthlyInsecticide', []).map(normalizeMonthlyInsecticide),
  monthlyWater: loadPersistedValue('monthlyWater', []).map(normalizeMonthlyWater),
  monthlyAirCompressor: loadPersistedValue('monthlyAirCompressor', []).map(normalizeMonthlyAirCompressor),
  dailySolarGeneration: loadPersistedValue('dailySolarGeneration', []).map(normalizeDailySolarGeneration),
  energySettings: loadPersistedValue('energySettings', normalizeEnergySettings({})),
  amc: loadPersistedValue('amc', []).map(normalizeAmcRecord),
  machineBreakdownLogs: loadPersistedValue('machineBreakdownLogs', []).map(normalizeMachineBreakdownLog),
  machinePmRecords: loadPersistedValue('machinePmRecords', []).map(normalizeMachinePmRecord),
  testingCertificates: loadPersistedValue('testingCertificates', []).map(normalizeTestingCertificate),
  plantSections: loadPersistedValue('plantSections', []).map((s) =>
    typeof s === 'string' ? { id: `ps_${s.toLowerCase().replace(/\s+/g, '_')}`, name: s, createdBy: '' } : s
  ),
  activity: loadPersistedValue('activity', []),
  settings: loadPersistedValue('settings', { plantName: 'Nathupur Formulation Plant', notifSeenAt: 0 }),
  sync: {
    cloudEnabled: isSupabaseConfigured,
    phase: isSupabaseConfigured ? 'booting' : 'local-only',
    pending: loadPendingCloudOps().length,
    lastSyncedAt: '',
    lastError: '',
  },
};

function persistEntity(entity) {
  saveLS(KEYS[entity], state[entity]);
}

function persistWholeState() {
  Object.keys(KEYS).forEach((entity) => persistEntity(entity));
}

function notifyStoreUpdate() {
  version += 1;
  listeners.forEach((fn) => fn());
}

function updateSyncState(patch, notify = true) {
  state = {
    ...state,
    sync: {
      ...state.sync,
      ...patch,
    },
  };
  if (notify) notifyStoreUpdate();
}

function commit(entity) {
  persistEntity(entity);
  notifyStoreUpdate();
}

/**
 * Persist locally + notify UI + write directly to Supabase immediately.
 * Direct write is critical for cross-PC / cross-device Realtime broadcast:
 * Supabase fires a postgres_changes event the moment the DB row changes,
 * which every subscribed client receives within ~100-300 ms.
 */
function commitAndQueue(entity, action, payload) {
  commit(entity);
  // Fire-and-forget direct write — queues to localStorage only if offline/error
  writeToCloudNow(entity, action, payload).catch(() => {
    // Error already handled inside writeToCloudNow; retry is queued
  });
}

function replaceEntityState(entity, records, notify = true) {
  const nextValue = entity === 'machines'
    ? mergeSeedMachines(records, SEED_MACHINES)
    : records.map((row) => row);
  state = { ...state, [entity]: nextValue };
  persistEntity(entity);
  if (notify) notifyStoreUpdate();
}

function sectionMachineCount(section) {
  if (!section || section === MASTER_SECTION) return state.machines.length || 1;
  return state.machines.filter((machine) => machine.section === section).length || 1;
}

function summaryIdentity(record) {
  return `${record.section}::${record.period}`;
}

function buildPendingOp(entity, action, payload) {
  const recordId = typeof payload === 'string' ? payload : payload?.id;
  if (!recordId) return null;
  return {
    id: uid('sync'),
    entity,
    action,
    recordId,
    payload: action === 'delete' ? null : payload,
    queuedAt: now(),
  };
}

function queueCloudMutation(entity, action, payload, options = {}) {
  if (!SYNCED_ENTITIES.includes(entity)) return;

  const op = buildPendingOp(entity, action, payload);
  if (!op) return;

  const queue = loadPendingCloudOps();
  const withoutSameRecord = queue.filter((item) => !(item.entity === op.entity && item.recordId === op.recordId));
  const nextQueue = [...withoutSameRecord, op];
  savePendingCloudOps(nextQueue);
  updateSyncState({ pending: nextQueue.length, phase: isSupabaseConfigured ? state.sync.phase : 'local-only' });

  if (options.schedule !== false) {
    scheduleCloudFlush();
  }
}

function queueEntityReplacement(entity, nextRecords, previousRecords = []) {
  const nextIds = new Set(nextRecords.map((record) => record.id));
  previousRecords
    .filter((record) => !nextIds.has(record.id))
    .forEach((record) => queueCloudMutation(entity, 'delete', record.id, { schedule: false }));
  nextRecords.forEach((record) => queueCloudMutation(entity, 'upsert', record, { schedule: false }));
  scheduleCloudFlush();
}

async function pushCloudOp(op) {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error('Supabase is not configured');
  }

  const config = CLOUD_ENTITY_CONFIG[op.entity];
  if (!config) return;

  if (op.action === 'delete') {
    const { error } = await supabase.from(config.table).delete().eq('id', op.recordId);
    if (error) {
      rtLog('error', `DELETE failed on ${config.table} id=${op.recordId}:`, error.message, error.details || '');
      throw error;
    }
    rtLog('debug', `DELETE ok: ${config.table} id=${op.recordId}`);
    return;
  }

  const row = config.toRow(op.payload);
  const { error } = await supabase
    .from(config.table)
    .upsert(row, { onConflict: 'id' });
  if (error) {
    rtLog('error', `UPSERT failed on ${config.table} id=${op.recordId}:`, error.message, error.details || '', 'row keys:', Object.keys(row).join(', '));
    throw error;
  }
  rtLog('debug', `UPSERT ok: ${config.table} id=${op.recordId}`);
}

/**
 * Write a single record directly to Supabase right now — no queue, no delay.
 * Falls back to queueing if Supabase is offline or not configured.
 * This is the key path for instant multi-PC propagation: the DB write fires
 * Realtime postgres_changes immediately, which every connected client receives.
 */
async function writeToCloudNow(entity, action, payload) {
  if (!supabase || !isSupabaseConfigured || !isBrowserOnline()) {
    // Offline or not configured — queue for later
    queueCloudMutation(entity, action, payload);
    return;
  }

  const op = buildPendingOp(entity, action, payload);
  if (!op) return;

  try {
    await pushCloudOp(op);
    // Success — remove from queue in case it was previously queued
    dropPendingCloudOpsForRecord(entity, op.recordId);
    updateSyncState({ phase: 'synced', lastSyncedAt: now(), lastError: '' }, false);
  } catch (err) {
    // Write failed — queue it for retry
    queueCloudMutation(entity, action, payload);
    updateSyncState({
      phase: isBrowserOnline() ? 'degraded' : 'offline',
      lastError: err.message || 'Write failed',
    }, false);
  }
}

async function fetchCloudEntity(entity) {
  const config = CLOUD_ENTITY_CONFIG[entity];
  if (!config) {
    rtLog('warn', `FETCH: no config for entity ${entity}`);
    return [];
  }
  let query = supabase
    .from(config.table)
    .select('*');

  (config.orderBy || []).forEach(({ column, ascending }) => {
    query = query.order(column, { ascending });
  });

  const { data, error } = await query;
  if (error) {
    // For optional tables (testingCertificates) return empty rather than crashing sync
    if (entity === 'testingCertificates') {
      rtLog('warn', `FETCH failed on ${config.table} (optional, returning empty):`, error.message);
      return [];
    }
    rtLog('error', `FETCH failed on ${config.table}:`, error.message, error.details || '', error.hint || '');
    throw error;
  }
  return (data || []).map(config.fromRow);
}

async function refreshCloudEntity(entity, notify = true) {
  if (!supabase || !isSupabaseConfigured) return state[entity];
  const records = await fetchCloudEntity(entity);
  replaceEntityState(entity, records, notify);
  return records;
}

function scheduleRemoteRefresh(entity) {
  if (!SYNCED_ENTITIES.includes(entity)) return;
  clearTimeout(refreshTimers[entity]);
  refreshTimers[entity] = setTimeout(() => {
    refreshCloudEntity(entity)
      .then(() => updateSyncState({ phase: 'synced', lastSyncedAt: now(), lastError: '' }))
      .catch((error) => updateSyncState({
        phase: isBrowserOnline() ? 'degraded' : 'offline',
        lastError: error.message || 'Realtime refresh failed',
      }));
  }, 250);
}

async function flushPendingCloudOps() {
  if (!supabase || !isSupabaseConfigured) {
    updateSyncState({ phase: 'local-only' });
    return;
  }

  if (!isBrowserOnline()) {
    updateSyncState({ phase: 'offline' });
    return;
  }

  const pending = loadPendingCloudOps();
  if (!pending.length) {
    updateSyncState({ pending: 0, phase: 'synced', lastError: '' }, false);
    return;
  }

  updateSyncState({ phase: 'syncing', pending: pending.length, lastError: '' });

  let remaining = [...pending];
  for (const op of pending) {
    try {
      await pushCloudOp(op);
      remaining = remaining.filter((item) => item.id !== op.id);
      savePendingCloudOps(remaining);
      updateSyncState({ pending: remaining.length, lastSyncedAt: now(), lastError: '' }, false);
    } catch (err) {
      // Keep this op in the queue and log — continue flushing the rest
      rtLog('error', `Queue flush: op ${op.id} (${op.entity}/${op.action}) failed — kept in queue:`, err.message);
      updateSyncState({ lastError: err.message || 'Flush error' }, false);
    }
  }

  const stillPending = loadPendingCloudOps().length;
  updateSyncState({
    phase: stillPending ? 'degraded' : 'synced',
    pending: stillPending,
    lastSyncedAt: now(),
    ...(stillPending ? {} : { lastError: '' }),
  });
}

function scheduleCloudFlush() {
  if (!isSupabaseConfigured || !supabase) return;
  if (!isBrowserOnline()) {
    updateSyncState({ phase: 'offline' });
    return;
  }

  cloudSyncChain = cloudSyncChain
    .then(() => flushPendingCloudOps())
    .catch((error) => updateSyncState({
      phase: isBrowserOnline() ? 'degraded' : 'offline',
      lastError: error.message || 'Cloud sync failed',
      pending: loadPendingCloudOps().length,
    }));
}

/**
 * Apply a single Realtime payload record directly to the in-memory state
 * without performing a full round-trip fetch.  Falls back to a full refresh
 * when the payload row is unavailable (e.g. DELETE events on Postgres that
 * don't include the old record).
 */
function applyRealtimePayload(entity, payload) {
  const { eventType, new: newRow, old: oldRow } = payload;
  const config = CLOUD_ENTITY_CONFIG[entity];
  if (!config) return;

  // Skip Realtime overwrite within 3s of a local bulk import
  if (localImportSuppressUntil[entity] && Date.now() < localImportSuppressUntil[entity]) {
    rtLog('debug', `Suppressed Realtime ${eventType} on ${config.table} (local import in progress)`);
    return;
  }

  rtLog('info',
    `← ${eventType} on ${config.table}`,
    `id=${newRow?.id || oldRow?.id || '?'}`,
  );

  // DELETE — remove by id
  if (eventType === 'DELETE') {
    const deletedId = oldRow?.id;
    if (!deletedId) {
      rtLog('warn', `DELETE on ${config.table} had no old.id — falling back to full refresh`);
      scheduleRemoteRefresh(entity);
      return;
    }
    if (entity === 'machines') {
      state = { ...state, machines: state.machines.filter((m) => m.id !== deletedId) };
    } else {
      state = { ...state, [entity]: state[entity].filter((r) => r.id !== deletedId) };
    }
    persistEntity(entity);
    notifyStoreUpdate();
    rtLog('debug', `Applied DELETE ${config.table} id=${deletedId}`);
    return;
  }

  // INSERT / UPDATE — normalize and upsert into local state
  if (!newRow?.id) {
    rtLog('warn', `${eventType} on ${config.table} had no new.id — falling back to full refresh`);
    scheduleRemoteRefresh(entity);
    return;
  }

  const normalized = config.fromRow(newRow);

  if (entity === 'machines') {
    const exists = state.machines.some((m) => m.id === normalized.id);
    state = {
      ...state,
      machines: exists
        ? state.machines.map((m) => (m.id === normalized.id ? normalized : m))
        : [normalized, ...state.machines],
    };
  } else {
    const exists = state[entity].some((r) => r.id === normalized.id);
    state = {
      ...state,
      [entity]: exists
        ? state[entity].map((r) => (r.id === normalized.id ? normalized : r))
        : [normalized, ...state[entity]],
    };
  }

  persistEntity(entity);
  notifyStoreUpdate();
  updateSyncState({ phase: 'synced', lastSyncedAt: now(), lastError: '' }, false);
  rtLog('debug', `Applied ${eventType} ${config.table} id=${normalized.id}`);
}

function teardownRealtimeSubscriptions() {
  if (cloudSubscriptions && supabase) {
    try { supabase.removeChannel(cloudSubscriptions); } catch { /* ignore */ }
    cloudSubscriptions = null;
  }
}

function startRealtimeSubscriptions() {
  if (!supabase || !isSupabaseConfigured) return;

  // Tear down any stale channel before creating a fresh one
  teardownRealtimeSubscriptions();

  rtLog('info', `Starting Realtime channel (attempt ${realtimeReconnectAttempts + 1})`);

  cloudSubscriptions = supabase.channel('ccpl-maintenance-sync', {
    config: { broadcast: { self: false } },
  });

  Object.entries(CLOUD_ENTITY_CONFIG).forEach(([entity, config]) => {
    cloudSubscriptions.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: config.table },
      (payload) => {
        // Optimistically apply the payload directly for instant multi-PC broadcast.
        // If the payload row is missing or malformed, fall back to a full refresh.
        try {
          applyRealtimePayload(entity, payload);
        } catch (err) {
          rtLog('error', `applyRealtimePayload threw for ${entity}:`, err);
          scheduleRemoteRefresh(entity);
        }
      }
    );
  });

  cloudSubscriptions.subscribe((status, err) => {
    rtLog('info', `Channel status: ${status}${err ? ' — ' + (err.message || err) : ''}`);

    if (status === 'SUBSCRIBED') {
      realtimeReconnectAttempts = 0; // reset back-off counter on clean connect
      updateSyncState({ phase: 'synced', lastError: '' });
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      // Channel lost — do a full refresh so we don't drift, then reconnect
      updateSyncState({
        phase: isBrowserOnline() ? 'degraded' : 'offline',
        lastError: `Realtime: ${status}${err ? ' – ' + (err.message || err) : ''}`,
      });

      SYNCED_ENTITIES.forEach((entity) => scheduleRemoteRefresh(entity));

      // Exponential back-off: 2s, 4s, 8s … capped at 60s, plus ±500 ms jitter
      realtimeReconnectAttempts += 1;
      const baseDelay = Math.min(2_000 * Math.pow(2, realtimeReconnectAttempts - 1), 60_000);
      const jitter = Math.random() * 500;
      const delay = Math.round(baseDelay + jitter);

      rtLog('warn', `Reconnecting in ${delay} ms (attempt ${realtimeReconnectAttempts})`);
      setTimeout(() => {
        if (isBrowserOnline() && isSupabaseConfigured) {
          startRealtimeSubscriptions();
        }
      }, delay);
    }
  });
}

function startOnlineListener() {
  if (typeof window === 'undefined' || window.__ccplCloudSyncBound) return;
  window.__ccplCloudSyncBound = true;

  window.addEventListener('online', () => {
    updateSyncState({ phase: 'syncing', lastError: '' });
    scheduleCloudFlush();
    SYNCED_ENTITIES.forEach((entity) => scheduleRemoteRefresh(entity));
    // Re-establish Realtime channel after coming back online
    if (!cloudSubscriptions) startRealtimeSubscriptions();
  });

  window.addEventListener('offline', () => {
    updateSyncState({ phase: 'offline' });
  });

  // Re-subscribe when app returns from background (critical for mobile)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isBrowserOnline() && isSupabaseConfigured) {
      // Refresh all entities to catch up on missed events
      SYNCED_ENTITIES.forEach((entity) => scheduleRemoteRefresh(entity));
      // Re-subscribe if the channel was lost while in background
      if (!cloudSubscriptions) startRealtimeSubscriptions();
    }
  });
}

async function initializeCloudSync() {
  if (cloudInitStarted) return;
  cloudInitStarted = true;
  startOnlineListener();

  if (!supabase || !isSupabaseConfigured) {
    updateSyncState({ phase: 'local-only', cloudEnabled: false, pending: loadPendingCloudOps().length });
    rtLog('info', 'Supabase not configured — running in local-only mode');
    return;
  }

  rtLog('info', 'Initializing cloud sync…');
  updateSyncState({ phase: isBrowserOnline() ? 'syncing' : 'offline', cloudEnabled: true });

  // Start Realtime subscriptions FIRST so we don't miss any events that arrive
  // while the initial data fetch is in-flight.
  startRealtimeSubscriptions();

  try {
    await flushPendingCloudOps();

    const [remoteMachines, remoteBreakdowns, remotePMs, remoteEnergy, remoteAmc, remoteBreakdownLogs, remotePmRecords, remotePlantSections, remoteDailyUtilityLog, remoteMonthlyHerbicide, remoteMonthlyInsecticide, remoteMonthlyWater, remoteMonthlyAirCompressor, remoteDailySolarGeneration, remoteEnergySettings, remoteTestingCertificates] = await Promise.all([
      fetchCloudEntity('machines'),
      fetchCloudEntity('breakdowns'),
      fetchCloudEntity('pms'),
      fetchCloudEntity('energy'),
      fetchCloudEntity('amc'),
      fetchCloudEntity('machineBreakdownLogs'),
      fetchCloudEntity('machinePmRecords'),
      fetchCloudEntity('plantSections'),
      fetchCloudEntity('dailyUtilityLog'),
      fetchCloudEntity('monthlyHerbicide'),
      fetchCloudEntity('monthlyInsecticide'),
      fetchCloudEntity('monthlyWater'),
      fetchCloudEntity('monthlyAirCompressor'),
      fetchCloudEntity('dailySolarGeneration'),
      fetchCloudEntity('energySettings'),
      fetchCloudEntity('testingCertificates'),
    ]);

    const remoteSnapshots = {
      machines: remoteMachines,
      breakdowns: remoteBreakdowns,
      pms: remotePMs,
      energy: remoteEnergy,
      amc: remoteAmc,
      machineBreakdownLogs: remoteBreakdownLogs,
      machinePmRecords: remotePmRecords,
      plantSections: remotePlantSections,
      dailyUtilityLog: remoteDailyUtilityLog,
      monthlyHerbicide: remoteMonthlyHerbicide,
      monthlyInsecticide: remoteMonthlyInsecticide,
      monthlyWater: remoteMonthlyWater,
      monthlyAirCompressor: remoteMonthlyAirCompressor,
      dailySolarGeneration: remoteDailySolarGeneration,
      energySettings: remoteEnergySettings,
      testingCertificates: remoteTestingCertificates,
    };

    // Merge cloud machines with local state (instead of replacing)
    // This preserves local-only machines that haven't been synced to Supabase yet
    if (remoteMachines.length) {
      const localMachines = state.machines || [];
      const merged = [...remoteMachines];
      const mergedIds = new Set(merged.map((m) => m.id));
      const mergedCodes = new Set(merged.map((m) => normalizeText(m.machineCode || '')));
      const mergedNames = new Set(merged.map((m) => normalizeText(m.name || '')));

      localMachines.forEach((local) => {
        const lid = local.id || '';
        const lCode = normalizeText(local.machineCode || '');
        const lName = normalizeText(local.name || '');
        if (mergedIds.has(lid) || mergedCodes.has(lCode) || mergedNames.has(lName)) return;
        merged.push(local);
        mergedIds.add(lid);
        if (lCode) mergedCodes.add(lCode);
        if (lName) mergedNames.add(lName);
      });

      const finalMachines = mergeSeedMachines(merged, SEED_MACHINES);
      state = { ...state, machines: finalMachines };
      persistEntity('machines');
    }
    if (remoteBreakdowns.length) replaceEntityState('breakdowns', remoteBreakdowns, false);
    if (remotePMs.length) replaceEntityState('pms', remotePMs, false);
    if (remoteEnergy.length) replaceEntityState('energy', remoteEnergy, false);
    if (remoteAmc.length) replaceEntityState('amc', remoteAmc, false);
    if (remoteBreakdownLogs.length) replaceEntityState('machineBreakdownLogs', remoteBreakdownLogs, false);
    if (remotePmRecords.length) replaceEntityState('machinePmRecords', remotePmRecords, false);
    if (remotePlantSections.length) replaceEntityState('plantSections', remotePlantSections, false);
    if (remoteDailyUtilityLog.length) replaceEntityState('dailyUtilityLog', remoteDailyUtilityLog, false);
    if (remoteMonthlyHerbicide.length) replaceEntityState('monthlyHerbicide', remoteMonthlyHerbicide, false);
    if (remoteMonthlyInsecticide.length) replaceEntityState('monthlyInsecticide', remoteMonthlyInsecticide, false);
    if (remoteMonthlyWater.length) replaceEntityState('monthlyWater', remoteMonthlyWater, false);
    if (remoteMonthlyAirCompressor.length) replaceEntityState('monthlyAirCompressor', remoteMonthlyAirCompressor, false);
    if (remoteDailySolarGeneration.length) replaceEntityState('dailySolarGeneration', remoteDailySolarGeneration, false);
    if (remoteEnergySettings?.length) {
      state = { ...state, energySettings: normalizeEnergySettings(remoteEnergySettings[0] || {}) };
      persistEntity('energySettings');
    }
    if (remoteTestingCertificates?.length) replaceEntityState('testingCertificates', remoteTestingCertificates, false);
    notifyStoreUpdate();

    // Push any local-only records that aren't in Supabase yet
    SYNCED_ENTITIES.forEach((entity) => {
      if (!remoteSnapshots[entity].length && state[entity].length) {
        state[entity].forEach((record) => queueCloudMutation(entity, 'upsert', record, { schedule: false }));
      }
    });

    if (loadPendingCloudOps().length) {
      await flushPendingCloudOps();
      await Promise.all(SYNCED_ENTITIES.map((entity) => refreshCloudEntity(entity, false)));
      notifyStoreUpdate();
    }

    updateSyncState({ phase: 'synced', lastSyncedAt: now(), lastError: '', pending: loadPendingCloudOps().length });
  } catch (error) {
    updateSyncState({
      phase: isBrowserOnline() ? 'degraded' : 'offline',
      lastError: error.message || 'Failed to initialize cloud sync',
      pending: loadPendingCloudOps().length,
    });
  }
}

function upsertSummary(entity, record, matchKey, userName, activityLabel, activityType) {
  const existing = state[entity].find((item) => item[matchKey] === record[matchKey] && item.section === record.section);
  if (existing) {
    const mergedRecord = { ...existing, ...record, id: existing.id };
    state = {
      ...state,
      [entity]: state[entity].map((item) => (item.id === existing.id ? mergedRecord : item)),
    };
    commitAndQueue(entity, 'upsert', mergedRecord);
    logActivity(userName, `updated ${activityLabel}`, `${record.section} · ${periodLabel(record.period)}`, activityType);
    return { ...mergedRecord, mode: 'updated' };
  }

  state = { ...state, [entity]: [record, ...state[entity]] };
  commitAndQueue(entity, 'upsert', record);
  logActivity(userName, `logged ${activityLabel}`, `${record.section} · ${periodLabel(record.period)}`, activityType);
  return { ...record, mode: 'created' };
}

persistWholeState();
initializeCloudSync();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getVersion = () => version;
export const getData = () => state;

export function useStore() {
  useSyncExternalStore(subscribe, getVersion);
  return state;
}

/**
 * Call this whenever the Supabase auth session changes (login, token refresh,
 * logout).  It updates the Realtime WebSocket JWT so postgres_changes events
 * continue to arrive after the access token rotates, and re-subscribes the
 * channel if it was previously disconnected.
 *
 * @param {string|null} accessToken  The new JWT, or null on logout.
 */
export function notifyRealtimeAuthChange(accessToken) {
  if (!supabase || !isSupabaseConfigured) return;
  if (accessToken) {
    // Update the JWT on the live WebSocket connection
    supabase.realtime.setAuth(accessToken);
    rtLog('info', 'Realtime JWT updated after auth change');
    // Re-subscribe if the channel was torn down while we had no session
    if (!cloudSubscriptions) startRealtimeSubscriptions();
  } else {
    // Logged out — tear down the authenticated channel gracefully
    rtLog('info', 'Auth cleared — tearing down Realtime channel');
    teardownRealtimeSubscriptions();
  }
}

export function logActivity(userName, action, detail = '', type = 'info') {
  state = {
    ...state,
    activity: [{ id: uid('a'), ts: now(), user: userName || 'System', action, detail, type }, ...state.activity].slice(0, 120),
  };
  commit('activity');
}

export function updateSettings(patch) {
  state = { ...state, settings: { ...state.settings, ...patch } };
  commit('settings');
}

export const getMachines = () => state.machines;
export const getMachine = (id) => state.machines.find((m) => m.id === id) || null;
export const getBreakdowns = () => state.breakdowns;
export const getPMs = () => state.pms;
export const getEnergyLogs = () => state.energy;

export function addMachine(fields, userName) {
  const machine = normalizeMachineRecord({
    ...fields,
    id: fields.id || fields.machineCode || uid('m'),
    createdAt: now(),
  });
  state = { ...state, machines: [machine, ...state.machines] };
  commitAndQueue('machines', 'upsert', machine);
  logActivity(userName, 'added machine', machine.name, 'machine');
  return machine;
}

export function updateMachine(id, patch, userName, silent = false) {
  let updatedMachine = null;
  state = {
    ...state,
    machines: state.machines.map((machine) => {
      if (machine.id !== id) return machine;
      updatedMachine = normalizeMachineRecord({ ...machine, ...patch, id: machine.id });
      return updatedMachine;
    }),
  };
  if (!updatedMachine) return null;
  commitAndQueue('machines', 'upsert', updatedMachine);
  if (!silent && userName) logActivity(userName, 'updated machine', updatedMachine.name || '', 'machine');
  return updatedMachine;
}

export function deleteMachine(id, userName) {
  const name = getMachine(id)?.name || '';
  state = { ...state, machines: state.machines.filter((machine) => machine.id !== id) };
  commitAndQueue('machines', 'delete', id);
  logActivity(userName, 'deleted machine', name, 'machine');
}

export function addMachineDoc(machineId, doc, userName) {
  let updatedMachine = null;
  state = {
    ...state,
    machines: state.machines.map((machine) => {
      if (machine.id !== machineId) return machine;
      const nextDoc = normalizeMachineDoc({
        ...doc,
        machine_id: machineId,
        plant_section: machine.section || MASTER_SECTION,
      });
      updatedMachine = normalizeMachineRecord({
        ...machine,
        docs: [nextDoc, ...(machine.docs || [])],
      });
      return updatedMachine;
    }),
  };
  if (!updatedMachine) return null;
  commitAndQueue('machines', 'upsert', updatedMachine);
  logActivity(userName, `uploaded ${doc.tab?.toUpperCase() || 'document'}`, `${doc.filename} → ${getMachine(machineId)?.name}`, 'upload');
  return getMachine(machineId);
}

export function removeMachineDoc(machineId, docId) {
  let updatedMachine = null;
  state = {
    ...state,
    machines: state.machines.map((machine) => {
      if (machine.id !== machineId) return machine;
      updatedMachine = normalizeMachineRecord({
        ...machine,
        docs: (machine.docs || []).filter((doc) => doc.id !== docId),
      });
      return updatedMachine;
    }),
  };
  if (updatedMachine) commitAndQueue('machines', 'upsert', updatedMachine);
  return getMachine(machineId);
}

export function addSparePart(machineId, spare) {
  let updatedMachine = null;
  state = {
    ...state,
    machines: state.machines.map((machine) => {
      if (machine.id !== machineId) return machine;
      updatedMachine = {
        ...machine,
        spares: [{ id: uid('s'), ...spare }, ...(machine.spares || [])],
      };
      return updatedMachine;
    }),
  };
  if (updatedMachine) commitAndQueue('machines', 'upsert', updatedMachine);
}

export function removeSparePart(machineId, spareId) {
  let updatedMachine = null;
  state = {
    ...state,
    machines: state.machines.map((machine) => {
      if (machine.id !== machineId) return machine;
      updatedMachine = {
        ...machine,
        spares: (machine.spares || []).filter((spare) => spare.id !== spareId),
      };
      return updatedMachine;
    }),
  };
  if (updatedMachine) commitAndQueue('machines', 'upsert', updatedMachine);
}

export function addMachinePhoto(machineId, photo) {
  let updatedMachine = null;
  state = {
    ...state,
    machines: state.machines.map((machine) => {
      if (machine.id !== machineId) return machine;
      updatedMachine = {
        ...machine,
        photos: [{ id: uid('p'), addedAt: now(), ...photo }, ...(machine.photos || [])],
      };
      return updatedMachine;
    }),
  };
  if (updatedMachine) commitAndQueue('machines', 'upsert', updatedMachine);
}

export function removeMachinePhoto(machineId, photoId) {
  let updatedMachine = null;
  state = {
    ...state,
    machines: state.machines.map((machine) => {
      if (machine.id !== machineId) return machine;
      updatedMachine = {
        ...machine,
        photos: (machine.photos || []).filter((photo) => photo.id !== photoId),
      };
      return updatedMachine;
    }),
  };
  if (updatedMachine) commitAndQueue('machines', 'upsert', updatedMachine);
}

export function addBreakdown(fields, userName) {
  return upsertSummary(
    'breakdowns',
    normalizeBreakdownSummary(fields),
    'period',
    userName,
    'breakdown summary',
    'breakdown'
  );
}

export function updateBreakdown(id, patch, userName) {
  const existing = state.breakdowns.find((item) => item.id === id);
  if (!existing) return null;
  return addBreakdown({ ...existing, ...patch, id }, userName);
}

export function closeBreakdown(id, closure, userName) {
  return updateBreakdown(id, closure, userName);
}

export function deleteBreakdown(id, userName) {
  const record = state.breakdowns.find((item) => item.id === id);
  state = { ...state, breakdowns: state.breakdowns.filter((item) => item.id !== id) };
  commitAndQueue('breakdowns', 'delete', id);
  logActivity(userName, 'deleted breakdown summary', record ? `${record.section} · ${periodLabel(record.period)}` : '', 'breakdown');
}

export function addPM(fields, userName) {
  return upsertSummary(
    'pms',
    normalizePMSummary(fields),
    'period',
    userName,
    'PM summary',
    'pm'
  );
}

export function updatePM(id, patch, userName) {
  const existing = state.pms.find((item) => item.id === id);
  if (!existing) return null;
  return addPM({ ...existing, ...patch, id }, userName);
}

export function completePM(id, closure, userName) {
  return updatePM(id, closure, userName);
}

export function deletePM(id, userName) {
  const record = state.pms.find((item) => item.id === id);
  state = { ...state, pms: state.pms.filter((item) => item.id !== id) };
  commitAndQueue('pms', 'delete', id);
  logActivity(userName, 'deleted PM summary', record ? `${record.section} · ${periodLabel(record.period)}` : '', 'pm');
}

export function addEnergyLog(fields, userName) {
  const log = normalizeEnergyRecord(fields);
  state = { ...state, energy: [log, ...state.energy] };
  commitAndQueue('energy', 'upsert', log);
  const detail = log.source
    ? `${log.source} · ${log.kwh} kWh`
    : `${log.plantSection || 'Plant'} · Solar ${log.solarGenerationKwh} kWh · Fuel ${log.fuelConsumedLitres} L`;
  logActivity(userName, 'added energy log', detail, 'energy');
  return log;
}

export function updateEnergyLog(id, patch, userName) {
  const existing = state.energy.find((entry) => entry.id === id);
  if (!existing) return null;
  const updated = normalizeEnergyRecord({ ...existing, ...patch, id: existing.id });
  state = {
    ...state,
    energy: state.energy.map((entry) => (entry.id === id ? updated : entry)),
  };
  commitAndQueue('energy', 'upsert', updated);
  logActivity(userName, 'updated energy log', updated.source || updated.plantSection || '', 'energy');
  return updated;
}

export function deleteEnergyLog(id, userName) {
  state = { ...state, energy: state.energy.filter((entry) => entry.id !== id) };
  commitAndQueue('energy', 'delete', id);
  logActivity(userName, 'deleted energy log', '', 'energy');
}

// ── Daily Utility Log CRUD ───────────────────────────────────────────────
export const getDailyUtilityLogs = () => state.dailyUtilityLog;

export function addDailyUtilityLog(fields, userName) {
  const log = normalizeDailyUtilityLog({ ...fields, createdAt: now(), updatedAt: now() });
  state = { ...state, dailyUtilityLog: [log, ...state.dailyUtilityLog] };
  commitAndQueue('dailyUtilityLog', 'upsert', log);
  logActivity(userName, 'added daily utility log', log.date, 'energy');
  return log;
}

export function updateDailyUtilityLog(id, patch, userName) {
  const existing = state.dailyUtilityLog.find((e) => e.id === id);
  if (!existing) return null;
  const updated = normalizeDailyUtilityLog({ ...existing, ...patch, id: existing.id, updatedAt: now() });
  state = { ...state, dailyUtilityLog: state.dailyUtilityLog.map((e) => (e.id === id ? updated : e)) };
  commitAndQueue('dailyUtilityLog', 'upsert', updated);
  logActivity(userName, 'updated daily utility log', updated.date, 'energy');
  return updated;
}

export function deleteDailyUtilityLog(id, userName) {
  state = { ...state, dailyUtilityLog: state.dailyUtilityLog.filter((e) => e.id !== id) };
  commitAndQueue('dailyUtilityLog', 'delete', id);
  logActivity(userName, 'deleted daily utility log', '', 'energy');
}

// ── Monthly Herbicide CRUD ──────────────────────────────────────────────
export const getMonthlyHerbicides = () => state.monthlyHerbicide;

export function addMonthlyHerbicide(fields, userName) {
  const record = normalizeMonthlyHerbicide({ ...fields, createdAt: now(), updatedAt: now() });
  state = { ...state, monthlyHerbicide: [record, ...state.monthlyHerbicide] };
  commitAndQueue('monthlyHerbicide', 'upsert', record);
  logActivity(userName, 'added monthly herbicide', record.month, 'energy');
  return record;
}

export function updateMonthlyHerbicide(id, patch, userName) {
  const existing = state.monthlyHerbicide.find((e) => e.id === id);
  if (!existing) return null;
  const updated = normalizeMonthlyHerbicide({ ...existing, ...patch, id: existing.id, updatedAt: now() });
  state = { ...state, monthlyHerbicide: state.monthlyHerbicide.map((e) => (e.id === id ? updated : e)) };
  commitAndQueue('monthlyHerbicide', 'upsert', updated);
  logActivity(userName, 'updated monthly herbicide', updated.month, 'energy');
  return updated;
}

export function deleteMonthlyHerbicide(id, userName) {
  state = { ...state, monthlyHerbicide: state.monthlyHerbicide.filter((e) => e.id !== id) };
  commitAndQueue('monthlyHerbicide', 'delete', id);
  logActivity(userName, 'deleted monthly herbicide', '', 'energy');
}

// ── Monthly Insecticide CRUD ────────────────────────────────────────────
export const getMonthlyInsecticides = () => state.monthlyInsecticide;

export function addMonthlyInsecticide(fields, userName) {
  const record = normalizeMonthlyInsecticide({ ...fields, createdAt: now(), updatedAt: now() });
  state = { ...state, monthlyInsecticide: [record, ...state.monthlyInsecticide] };
  commitAndQueue('monthlyInsecticide', 'upsert', record);
  logActivity(userName, 'added monthly insecticide', record.month, 'energy');
  return record;
}

export function updateMonthlyInsecticide(id, patch, userName) {
  const existing = state.monthlyInsecticide.find((e) => e.id === id);
  if (!existing) return null;
  const updated = normalizeMonthlyInsecticide({ ...existing, ...patch, id: existing.id, updatedAt: now() });
  state = { ...state, monthlyInsecticide: state.monthlyInsecticide.map((e) => (e.id === id ? updated : e)) };
  commitAndQueue('monthlyInsecticide', 'upsert', updated);
  logActivity(userName, 'updated monthly insecticide', updated.month, 'energy');
  return updated;
}

export function deleteMonthlyInsecticide(id, userName) {
  state = { ...state, monthlyInsecticide: state.monthlyInsecticide.filter((e) => e.id !== id) };
  commitAndQueue('monthlyInsecticide', 'delete', id);
  logActivity(userName, 'deleted monthly insecticide', '', 'energy');
}

// ── Monthly Water CRUD ──────────────────────────────────────────────────
export const getMonthlyWaters = () => state.monthlyWater;

export function addMonthlyWater(fields, userName) {
  const record = normalizeMonthlyWater({ ...fields, createdAt: now(), updatedAt: now() });
  state = { ...state, monthlyWater: [record, ...state.monthlyWater] };
  commitAndQueue('monthlyWater', 'upsert', record);
  logActivity(userName, 'added monthly water', record.month, 'energy');
  return record;
}

export function updateMonthlyWater(id, patch, userName) {
  const existing = state.monthlyWater.find((e) => e.id === id);
  if (!existing) return null;
  const updated = normalizeMonthlyWater({ ...existing, ...patch, id: existing.id, updatedAt: now() });
  state = { ...state, monthlyWater: state.monthlyWater.map((e) => (e.id === id ? updated : e)) };
  commitAndQueue('monthlyWater', 'upsert', updated);
  logActivity(userName, 'updated monthly water', updated.month, 'energy');
  return updated;
}

export function deleteMonthlyWater(id, userName) {
  state = { ...state, monthlyWater: state.monthlyWater.filter((e) => e.id !== id) };
  commitAndQueue('monthlyWater', 'delete', id);
  logActivity(userName, 'deleted monthly water', '', 'energy');
}

// ── Monthly Air Compressor CRUD ─────────────────────────────────────────
export const getMonthlyAirCompressors = () => state.monthlyAirCompressor;

export function addMonthlyAirCompressor(fields, userName) {
  const record = normalizeMonthlyAirCompressor({ ...fields, createdAt: now(), updatedAt: now() });
  state = { ...state, monthlyAirCompressor: [record, ...state.monthlyAirCompressor] };
  commitAndQueue('monthlyAirCompressor', 'upsert', record);
  logActivity(userName, 'added monthly air compressor', record.month, 'energy');
  return record;
}

export function updateMonthlyAirCompressor(id, patch, userName) {
  const existing = state.monthlyAirCompressor.find((e) => e.id === id);
  if (!existing) return null;
  const updated = normalizeMonthlyAirCompressor({ ...existing, ...patch, id: existing.id, updatedAt: now() });
  state = { ...state, monthlyAirCompressor: state.monthlyAirCompressor.map((e) => (e.id === id ? updated : e)) };
  commitAndQueue('monthlyAirCompressor', 'upsert', updated);
  logActivity(userName, 'updated monthly air compressor', updated.month, 'energy');
  return updated;
}

export function deleteMonthlyAirCompressor(id, userName) {
  state = { ...state, monthlyAirCompressor: state.monthlyAirCompressor.filter((e) => e.id !== id) };
  commitAndQueue('monthlyAirCompressor', 'delete', id);
  logActivity(userName, 'deleted monthly air compressor', '', 'energy');
}

// ── Daily Solar Generation CRUD ─────────────────────────────────────────
export const getDailySolarGenerations = () => state.dailySolarGeneration;

export function addDailySolarGeneration(fields, userName) {
  const record = normalizeDailySolarGeneration({ ...fields, createdAt: now(), updatedAt: now() });
  state = { ...state, dailySolarGeneration: [record, ...state.dailySolarGeneration] };
  commitAndQueue('dailySolarGeneration', 'upsert', record);
  logActivity(userName, 'added daily solar generation', record.date, 'energy');
  return record;
}

export function updateDailySolarGeneration(id, patch, userName) {
  const existing = state.dailySolarGeneration.find((e) => e.id === id);
  if (!existing) return null;
  const updated = normalizeDailySolarGeneration({ ...existing, ...patch, id: existing.id, updatedAt: now() });
  state = { ...state, dailySolarGeneration: state.dailySolarGeneration.map((e) => (e.id === id ? updated : e)) };
  commitAndQueue('dailySolarGeneration', 'upsert', updated);
  logActivity(userName, 'updated daily solar generation', updated.date, 'energy');
  return updated;
}

export function deleteDailySolarGeneration(id, userName) {
  state = { ...state, dailySolarGeneration: state.dailySolarGeneration.filter((e) => e.id !== id) };
  commitAndQueue('dailySolarGeneration', 'delete', id);
  logActivity(userName, 'deleted daily solar generation', '', 'energy');
}

// ── Energy Settings CRUD (upsert single row) ────────────────────────────
export const getEnergySettings = () => state.energySettings;

export function upsertEnergySettings(fields, userName) {
  const existing = state.energySettings;
  const updated = normalizeEnergySettings({ ...existing, ...fields, id: 'default', updatedAt: now() });
  state = { ...state, energySettings: updated };
  commit('energySettings');
  queueCloudMutation('energySettings', 'upsert', updated);
  logActivity(userName, 'updated energy settings', '', 'energy');
  return updated;
}

// ── AMC exports ───────────────────────────────────────────────────────────
export const getAmcRecords = () => state.amc;
export const getAmcForMachine = (machineId) => state.amc.filter((r) => r.machineId === machineId);

export function addAmcRecord(fields, userName) {
  const record = normalizeAmcRecord({ ...fields, createdAt: now(), updatedAt: now() });
  state = { ...state, amc: [record, ...state.amc] };
  commitAndQueue('amc', 'upsert', record);
  logActivity(userName, 'added AMC record', `${record.vendorName} → ${getMachine(record.machineId)?.name || record.machineId}`, 'amc');
  return record;
}

export function updateAmcRecord(id, patch, userName) {
  const existing = state.amc.find((r) => r.id === id);
  if (!existing) return null;
  const updated = normalizeAmcRecord({ ...existing, ...patch, id, updatedAt: now() });
  state = { ...state, amc: state.amc.map((r) => (r.id === id ? updated : r)) };
  commitAndQueue('amc', 'upsert', updated);
  logActivity(userName, 'updated AMC record', `${updated.vendorName} → ${getMachine(updated.machineId)?.name || updated.machineId}`, 'amc');
  return updated;
}

export function deleteAmcRecord(id, userName) {
  const record = state.amc.find((r) => r.id === id);
  state = { ...state, amc: state.amc.filter((r) => r.id !== id) };
  commitAndQueue('amc', 'delete', id);
  logActivity(userName, 'deleted AMC record', record ? `${record.vendorName}` : '', 'amc');
}

// ── Per-machine PM record exports ──────────────────────────────────────────
export const getMachinePmRecords = () => state.machinePmRecords;
export const getMachinePmRecordsForMachine = (machineId) =>
  state.machinePmRecords.filter((r) => r.machineId === machineId);

export function addMachinePmRecord(fields, userName) {
  const record = normalizeMachinePmRecord({ ...fields, createdAt: now(), updatedAt: now() });
  state = { ...state, machinePmRecords: [record, ...state.machinePmRecords] };
  commitAndQueue('machinePmRecords', 'upsert', record);
  logActivity(userName, 'logged machine PM', `${record.machineName} · ${record.pmDate} · ${record.task || record.pmType}`, 'pm');
  return record;
}

export function deleteMachinePmRecord(id, userName) {
  state = { ...state, machinePmRecords: state.machinePmRecords.filter((r) => r.id !== id) };
  commitAndQueue('machinePmRecords', 'delete', id);
  logActivity(userName, 'deleted machine PM record', '', 'pm');
}

// ── Testing Certificates (Safety & Statutory) ─────────────────────────────────
export const getTestingCertificates = () => state.testingCertificates || [];
export const getTestingCertificatesForMachine = (machineId) =>
  (state.testingCertificates || []).filter((r) => r.machineId === machineId);

export function addTestingCertificate(fields, userName) {
  const record = normalizeTestingCertificate({ ...fields, createdAt: now(), updatedAt: now() });
  state = { ...state, testingCertificates: [record, ...(state.testingCertificates || [])] };
  commitAndQueue('testingCertificates', 'upsert', record);
  logActivity(userName, 'added testing certificate', `${record.machineName || record.machineId} · ${record.certificateType} · ${record.certificateNumber}`, 'machine');
  return record;
}

export function updateTestingCertificate(id, patch, userName) {
  const existing = (state.testingCertificates || []).find((r) => r.id === id);
  if (!existing) return null;
  const updated = normalizeTestingCertificate({ ...existing, ...patch, id, updatedAt: now() });
  state = { ...state, testingCertificates: (state.testingCertificates || []).map((r) => (r.id === id ? updated : r)) };
  commitAndQueue('testingCertificates', 'upsert', updated);
  logActivity(userName, 'updated testing certificate', `${updated.certificateType} · ${updated.certificateNumber}`, 'machine');
  return updated;
}

export function deleteTestingCertificate(id, userName) {
  const rec = (state.testingCertificates || []).find((r) => r.id === id);
  state = { ...state, testingCertificates: (state.testingCertificates || []).filter((r) => r.id !== id) };
  commitAndQueue('testingCertificates', 'delete', id);
  logActivity(userName, 'deleted testing certificate', rec ? `${rec.certificateType} · ${rec.certificateNumber}` : '', 'machine');
}

export async function purgeTestingCertificates(machineId, userName) {
  let before;
  if (!machineId) {
    before = [...(state.testingCertificates || [])];
    state = { ...state, testingCertificates: [] };
  } else {
    before = (state.testingCertificates || []).filter((r) => r.machineId === machineId);
    state = { ...state, testingCertificates: (state.testingCertificates || []).filter((r) => r.machineId !== machineId) };
  }
  commit('testingCertificates');
  if (supabase && isSupabaseConfigured) {
    try {
      let q = supabase.from('testing_certificates').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (machineId) q = q.eq('machine_id', machineId);
      await q;
    } catch {}
  }
  logActivity(userName, 'purged testing certificates', `${before.length} removed`, 'machine');
  return before.length;
}

export async function purgeTestingCertificatesByMachine(machineId, userName) {
  return purgeTestingCertificates(machineId, userName);
}

export function getTestingCertificateAlertCount(certificates, machineId) {
  const list = machineId ? (certificates || []).filter((r) => r.machineId === machineId) : (certificates || []);
  return list.filter((r) => {
    const { status } = getTestingCertificateStatus(r.expiryDate);
    return status === 'EXPIRED' || status === 'EXPIRING SOON';
  }).length;
}

export { getTestingCertificateStatus };

export async function purgePmRecords(userName) {
  const previousPmCount = state.machinePmRecords.length;
  const previousSummaryCount = state.pms.length;

  // 1. Clear local state immediately
  state = { ...state, machinePmRecords: [], pms: [] };
  commit('machinePmRecords');
  commit('pms');
  notifyStoreUpdate();

  // 2. Delete all rows from Supabase tables
  if (supabase && isSupabaseConfigured) {
    const { error: pmErr } = await supabase
      .from('machine_pm_records')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (pmErr) {
      rtLog('error', 'PURGE failed on machine_pm_records:', pmErr.message);
      throw pmErr;
    }

    const { error: summaryErr } = await supabase
      .from('pm_logs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (summaryErr) {
      rtLog('error', 'PURGE failed on pm_logs:', summaryErr.message);
    }
  }

  // 3. Clear the cloud sync queue for these entities so stale upserts don't reappear
  const queue = loadPendingCloudOps().filter(
    (op) => op.entity !== 'machinePmRecords' && op.entity !== 'pms'
  );
  savePendingCloudOps(queue);
  updateSyncState({ pending: queue.length });

  logActivity(userName, 'purged all PM records', `${previousPmCount} records + ${previousSummaryCount} summaries removed`, 'pm');
  return { purged: previousPmCount, summariesPurged: previousSummaryCount };
}

// Helper: purge energy domain by date range or all
function _purgeDomain(entityKey, tableName, records, dateFrom, dateTo, isMonthly) {
  const isRange = Boolean(dateFrom || dateTo);
  let targets = records;
  if (isRange) {
    targets = targets.filter((r) => {
      const key = isMonthly ? (r.month || '') : (r.date || '');
      const from = isMonthly ? (dateFrom || '').slice(0, 7) : (dateFrom || '');
      const to = isMonthly ? (dateTo || '').slice(0, 7) : (dateTo || '');
      if (from && key < from) return false;
      if (to && key > to) return false;
      return true;
    });
  }
  return { isRange, targets, count: targets.length };
}

export async function purgeDailyUtilityLog(userName, dateFrom, dateTo) {
  const { isRange, targets, count } = _purgeDomain('dailyUtilityLog', 'daily_utility_log', state.dailyUtilityLog, dateFrom, dateTo, false);
  if (count === 0) return { purged: 0 };
  // Clear local state FIRST to prevent Realtime from re-adding
  if (isRange) { const rm = new Set(targets.map((r) => r.id)); state = { ...state, dailyUtilityLog: state.dailyUtilityLog.filter((r) => !rm.has(r.id)) }; }
  else { state = { ...state, dailyUtilityLog: [] }; }
  commit('dailyUtilityLog'); notifyStoreUpdate();
  const queue = loadPendingCloudOps().filter((op) => op.entity !== 'dailyUtilityLog'); savePendingCloudOps(queue); updateSyncState({ pending: queue.length });
  localImportSuppressUntil.dailyUtilityLog = Date.now() + 5000;
  // Then delete from Supabase
  if (supabase && isSupabaseConfigured) {
    let q = supabase.from('daily_utility_log').delete();
    q = isRange ? q.in('id', targets.map((r) => r.id)) : q.neq('id', '00000000-0000-0000-0000-000000000000');
    const { error } = await q;
    if (error) { rtLog('error', 'PURGE failed on daily_utility_log:', error.message); throw error; }
  }
  logActivity(userName, isRange ? 'purged Daily Utility (period)' : 'purged all Daily Utility', count + ' records removed', 'energy');
  return { purged: count };
}

export async function purgeMonthlyHerbicide(userName, dateFrom, dateTo) {
  const { isRange, targets, count } = _purgeDomain('monthlyHerbicide', 'monthly_herbicide_section', state.monthlyHerbicide, dateFrom, dateTo, true);
  if (count === 0) return { purged: 0 };
  if (isRange) { const rm = new Set(targets.map((r) => r.id)); state = { ...state, monthlyHerbicide: state.monthlyHerbicide.filter((r) => !rm.has(r.id)) }; }
  else { state = { ...state, monthlyHerbicide: [] }; }
  commit('monthlyHerbicide'); notifyStoreUpdate();
  const queue = loadPendingCloudOps().filter((op) => op.entity !== 'monthlyHerbicide'); savePendingCloudOps(queue); updateSyncState({ pending: queue.length });
  localImportSuppressUntil.monthlyHerbicide = Date.now() + 5000;
  if (supabase && isSupabaseConfigured) {
    let q = supabase.from('monthly_herbicide_section').delete();
    q = isRange ? q.in('id', targets.map((r) => r.id)) : q.neq('id', '00000000-0000-0000-0000-000000000000');
    const { error } = await q;
    if (error) { rtLog('error', 'PURGE failed on monthly_herbicide_section:', error.message); throw error; }
  }
  logActivity(userName, isRange ? 'purged Herbicide (period)' : 'purged all Herbicide', count + ' records removed', 'energy');
  return { purged: count };
}

export async function purgeMonthlyInsecticide(userName, dateFrom, dateTo) {
  const { isRange, targets, count } = _purgeDomain('monthlyInsecticide', 'monthly_insecticide_section', state.monthlyInsecticide, dateFrom, dateTo, true);
  if (count === 0) return { purged: 0 };
  if (isRange) { const rm = new Set(targets.map((r) => r.id)); state = { ...state, monthlyInsecticide: state.monthlyInsecticide.filter((r) => !rm.has(r.id)) }; }
  else { state = { ...state, monthlyInsecticide: [] }; }
  commit('monthlyInsecticide'); notifyStoreUpdate();
  const queue = loadPendingCloudOps().filter((op) => op.entity !== 'monthlyInsecticide'); savePendingCloudOps(queue); updateSyncState({ pending: queue.length });
  localImportSuppressUntil.monthlyInsecticide = Date.now() + 5000;
  if (supabase && isSupabaseConfigured) {
    let q = supabase.from('monthly_insecticide_section').delete();
    q = isRange ? q.in('id', targets.map((r) => r.id)) : q.neq('id', '00000000-0000-0000-0000-000000000000');
    const { error } = await q;
    if (error) { rtLog('error', 'PURGE failed on monthly_insecticide_section:', error.message); throw error; }
  }
  logActivity(userName, isRange ? 'purged Insecticide (period)' : 'purged all Insecticide', count + ' records removed', 'energy');
  return { purged: count };
}

export async function purgeMonthlyWater(userName, dateFrom, dateTo) {
  const { isRange, targets, count } = _purgeDomain('monthlyWater', 'monthly_water_stp', state.monthlyWater, dateFrom, dateTo, true);
  if (count === 0) return { purged: 0 };
  if (isRange) { const rm = new Set(targets.map((r) => r.id)); state = { ...state, monthlyWater: state.monthlyWater.filter((r) => !rm.has(r.id)) }; }
  else { state = { ...state, monthlyWater: [] }; }
  commit('monthlyWater'); notifyStoreUpdate();
  const queue = loadPendingCloudOps().filter((op) => op.entity !== 'monthlyWater'); savePendingCloudOps(queue); updateSyncState({ pending: queue.length });
  localImportSuppressUntil.monthlyWater = Date.now() + 5000;
  if (supabase && isSupabaseConfigured) {
    let q = supabase.from('monthly_water_stp').delete();
    q = isRange ? q.in('id', targets.map((r) => r.id)) : q.neq('id', '00000000-0000-0000-0000-000000000000');
    const { error } = await q;
    if (error) { rtLog('error', 'PURGE failed on monthly_water_stp:', error.message); throw error; }
  }
  logActivity(userName, isRange ? 'purged Water (period)' : 'purged all Water', count + ' records removed', 'energy');
  return { purged: count };
}

export async function purgeMonthlyAirCompressor(userName, dateFrom, dateTo) {
  const { isRange, targets, count } = _purgeDomain('monthlyAirCompressor', 'monthly_air_compressor', state.monthlyAirCompressor, dateFrom, dateTo, true);
  if (count === 0) return { purged: 0 };
  if (isRange) { const rm = new Set(targets.map((r) => r.id)); state = { ...state, monthlyAirCompressor: state.monthlyAirCompressor.filter((r) => !rm.has(r.id)) }; }
  else { state = { ...state, monthlyAirCompressor: [] }; }
  commit('monthlyAirCompressor'); notifyStoreUpdate();
  const queue = loadPendingCloudOps().filter((op) => op.entity !== 'monthlyAirCompressor'); savePendingCloudOps(queue); updateSyncState({ pending: queue.length });
  localImportSuppressUntil.monthlyAirCompressor = Date.now() + 5000;
  if (supabase && isSupabaseConfigured) {
    let q = supabase.from('monthly_air_compressor').delete();
    q = isRange ? q.in('id', targets.map((r) => r.id)) : q.neq('id', '00000000-0000-0000-0000-000000000000');
    const { error } = await q;
    if (error) { rtLog('error', 'PURGE failed on monthly_air_compressor:', error.message); throw error; }
  }
  logActivity(userName, isRange ? 'purged Air Compressor (period)' : 'purged all Air Compressor', count + ' records removed', 'energy');
  return { purged: count };
}

export async function purgeDailySolarGeneration(userName, dateFrom, dateTo) {
  const { isRange, targets, count } = _purgeDomain('dailySolarGeneration', 'daily_solar_generation', state.dailySolarGeneration, dateFrom, dateTo, false);
  if (count === 0) return { purged: 0 };
  if (isRange) { const rm = new Set(targets.map((r) => r.id)); state = { ...state, dailySolarGeneration: state.dailySolarGeneration.filter((r) => !rm.has(r.id)) }; }
  else { state = { ...state, dailySolarGeneration: [] }; }
  commit('dailySolarGeneration'); notifyStoreUpdate();
  const queue = loadPendingCloudOps().filter((op) => op.entity !== 'dailySolarGeneration'); savePendingCloudOps(queue); updateSyncState({ pending: queue.length });
  localImportSuppressUntil.dailySolarGeneration = Date.now() + 5000;
  if (supabase && isSupabaseConfigured) {
    let q = supabase.from('daily_solar_generation').delete();
    q = isRange ? q.in('id', targets.map((r) => r.id)) : q.neq('id', '00000000-0000-0000-0000-000000000000');
    const { error } = await q;
    if (error) { rtLog('error', 'PURGE failed on daily_solar_generation:', error.message); throw error; }
  }
  logActivity(userName, isRange ? 'purged Solar (period)' : 'purged all Solar', count + ' records removed', 'energy');
  return { purged: count };
}


export function importMachinePmRecordsBulk(rows, userName) {
  const logs = [];
  const unmatchedRows = [];
  const autoMapped = [];
  const autoCreated = [];

  rows.forEach((row, idx) => {
    // ── Robust case-insensitive matching with trim + double-space cleanup ──
    const cleanName = (str) => String(str || '').trim().replace(/\s{2,}/g, ' ').toLowerCase();
    const cleanCode = (str) => String(str || '').trim().toLowerCase();

    let matched = null;

    // 1. Try exact match by machineCode (case-insensitive, trimmed)
    if (row.machineCode) {
      const codeKey = cleanCode(row.machineCode);
      matched = state.machines.find((m) => {
        const mCode = cleanCode(m.machineCode || m.id);
        return mCode === codeKey;
      }) || null;
    }

    // 2. Try exact match by name (case-insensitive, trimmed, double-space cleaned)
    if (!matched && row.machineName) {
      const nameKey = cleanName(row.machineName);
      matched = state.machines.find((m) => {
        const mName = cleanName(m.name);
        return mName && mName === nameKey;
      }) || null;
    }

    // 3. Substring/partial match as fallback
    if (!matched && row.machineName) {
      const nameKey = cleanName(row.machineName);
      matched = state.machines.find((m) => {
        const mName = cleanName(m.name);
        return mName && (mName.includes(nameKey) || nameKey.includes(mName));
      }) || null;
    }

    const autoFilled = {};
    const record = normalizeMachinePmRecord({
      ...row,
      machineId: matched ? matched.id : (row.machineId || ''),
      machineCode: matched ? (matched.machineCode || matched.id) : (row.machineCode || ''),
      machineName: matched ? matched.name : (row.machineName || ''),
      plantSection: matched ? (matched.section || row.plantSection || '') : (row.plantSection || ''),
      pmDate: row.pmDate || row.pm_date || row.date || new Date().toISOString().slice(0, 10),
      pmType: row.pmType || row.pm_type || 'Preventive',
      task: row.task || row.description || '',
      status: (row.status && String(row.status).trim()) ? String(row.status).toLowerCase() : 'pending',
      completed: (() => {
        if (row.completed === true || row.completed === 'true' || String(row.completed).toLowerCase() === 'true') return true;
        if (row.completed === false || row.completed === 'false') return false;
        const s = String(row.status || '').toLowerCase().trim();
        if (s === 'pending' || s === 'overdue' || s === 'skipped') return false;
        if (s === 'completed') return true;
        return false;
      })(),
      action: row.action || row.actionTaken || '',
      technician: row.technician || '',
      remarks: row.remarks || '',
      startTime: row.startTime || row.start_time || '',
      endTime: row.endTime || row.end_time || '',
    });

    if (matched) {
      if (!row.machineCode && matched.machineCode) autoFilled.machineCode = matched.machineCode;
      if (!row.machineName && matched.name) autoFilled.machineName = matched.name;
      if (!row.plantSection && matched.section) autoFilled.plantSection = matched.section;
      if (Object.keys(autoFilled).length > 0) {
        autoMapped.push({ row: idx + 2, machine: matched.name || matched.machineCode, fields: autoFilled });
      }
    } else {
      // Auto-create the machine under UNASSIGNED / PENDING SECTION so 0% data loss
      const pendingSection = 'UNASSIGNED / PENDING SECTION';
      const newMachine = normalizeMachineRecord({
        id: row.machineCode || uid('m'),
        machineCode: row.machineCode || '',
        name: row.machineName || '',
        section: row.plantSection || pendingSection,
        status: 'running',
        createdAt: now(),
      });
      state = { ...state, machines: [...state.machines, newMachine] };
      autoCreated.push({ name: row.machineName, code: row.machineCode });
      record.machineId = newMachine.id;
      record.machineCode = newMachine.machineCode || newMachine.id;
      record.machineName = newMachine.name;
      record.plantSection = newMachine.section;
    }

    logs.push(record);
  });

  // Dedup on machineId + pmDate + task within Excel
  const seenInFile = new Map();
  logs.forEach((r) => {
    const key = `${r.machineId}:${r.pmDate}:${r.task}`;
    seenInFile.set(key, r);
  });
  const deduped = [...seenInFile.values()];

  state = { ...state, machinePmRecords: [...deduped, ...state.machinePmRecords] };
  commit('machinePmRecords');
  deduped.forEach((r) => queueCloudMutation('machinePmRecords', 'upsert', r, { schedule: false }));
  scheduleCloudFlush();

  if (autoCreated.length) {
    commit('machines');
    autoCreated.forEach((m) => queueCloudMutation('machines', 'upsert', state.machines.find((mc) => mc.name === m.name), { schedule: false }));
    scheduleCloudFlush();
  }

  // ── Auto-aggregate section-level PM summaries ────────────────────────────
  const aggMap = {};
  deduped.forEach((r) => {
    const period = (r.pmDate || '').slice(0, 7);
    if (!period) return;
    const section = r.plantSection || MASTER_SECTION;
    const key = `${period}::${section}`;
    if (!aggMap[key]) aggMap[key] = { period, section, plannedCount: 0, doneCount: 0, pendingCount: 0 };
    aggMap[key].plannedCount += 1;
    const st = String(r.status || '').toLowerCase();
    if (st === 'completed' || r.completed === true) {
      aggMap[key].doneCount += 1;
    } else {
      aggMap[key].pendingCount += 1;
    }
  });

  Object.values(aggMap).forEach((agg) => {
    const compliancePct = agg.plannedCount > 0 ? Math.round((agg.doneCount / agg.plannedCount) * 1000) / 10 : 0;
    const existingSummary = state.pms.find((p) => p.period === agg.period && p.section === agg.section);
    if (existingSummary) {
      const merged = {
        ...existingSummary,
        plannedCount: agg.plannedCount,
        doneCount: agg.doneCount,
        pendingCount: agg.pendingCount,
        compliancePct,
        updatedAt: now(),
      };
      state = { ...state, pms: state.pms.map((p) => (p.id === existingSummary.id ? merged : p)) };
      commitAndQueue('pms', 'upsert', merged);
    } else {
      const newSummary = normalizePMSummary({
        period: agg.period,
        section: agg.section,
        plannedCount: agg.plannedCount,
        doneCount: agg.doneCount,
        pendingCount: agg.pendingCount,
        compliancePct,
      });
      state = { ...state, pms: [newSummary, ...state.pms] };
      commitAndQueue('pms', 'upsert', newSummary);
    }
  });

  const detail = [
    `${deduped.length} PM records imported`,
    autoCreated.length ? `${autoCreated.length} new machines auto-created` : '',
    unmatchedRows.length ? `${unmatchedRows.length} unmatched` : '',
  ].filter(Boolean).join(' · ');
  logActivity(userName, 'bulk imported machine PM records', detail, 'pm');
  return { created: deduped.length, total: rows.length, unmatched: unmatchedRows, autoMapped, autoCreated };
}

export function dryRunImportMachinePmRecords(rows) {
  const cleanName = (str) => String(str || '').trim().replace(/\s{2,}/g, ' ').toLowerCase();
  const cleanCode = (str) => String(str || '').trim().toLowerCase();

  let matched = 0;
  let unmatched = 0;
  const unmatchedNames = [];
  const autoCreateNames = [];
  let totalCompleted = 0;
  let totalPending = 0;
  const periodSet = new Set();
  const sectionsDetected = new Set();

  rows.forEach((row) => {
    let machine = null;

    if (row.machineCode) {
      const codeKey = cleanCode(row.machineCode);
      machine = state.machines.find((m) => cleanCode(m.machineCode || m.id) === codeKey) || null;
    }
    if (!machine && row.machineName) {
      const nameKey = cleanName(row.machineName);
      machine = state.machines.find((m) => cleanName(m.name) === nameKey) || null;
    }
    if (!machine && row.machineName) {
      const nameKey = cleanName(row.machineName);
      machine = state.machines.find((m) => {
        const mName = cleanName(m.name);
        return mName && (mName.includes(nameKey) || nameKey.includes(mName));
      }) || null;
    }

    if (machine) {
      matched += 1;
    } else {
      unmatched += 1;
      const label = row.machineName || row.machineCode || `Row`;
      unmatchedNames.push(label);
      autoCreateNames.push(label);
    }

    const st = String(row.status || 'completed').toLowerCase();
    if (st === 'completed' || row.completed === true || row.completed === 'true') {
      totalCompleted += 1;
    } else {
      totalPending += 1;
    }

    const period = (row.pmDate || '').slice(0, 7);
    if (period) periodSet.add(period);
    if (row.plantSection) sectionsDetected.add(row.plantSection);
  });

  const totalRows = rows.length;
  return {
    totalRows,
    matched,
    unmatched,
    unmatchedNames: unmatchedNames.slice(0, 20),
    autoCreateCount: autoCreateNames.length,
    totalCompleted,
    totalPending,
    totalPlanned: totalRows,
    compliance: totalRows > 0 ? Math.round((totalCompleted / totalRows) * 1000) / 10 : 0,
    targetMonths: [...periodSet].sort(),
    sectionsDetected: [...sectionsDetected],
  };
}

// ── Dynamic Plant Sections ──────────────────────────────────────────────────
// User-added sections are persisted in localStorage and merged with the
// hardcoded PLANT_SECTIONS constant from constants.js at runtime.
export const getPlantSections = () => state.plantSections;

export function addPlantSection(name, userName) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  const exists = state.plantSections.some(
    (s) => (typeof s === 'string' ? s : s.name || '').toLowerCase() === trimmed.toLowerCase()
  );
  if (exists) return false;
  const record = { id: `ps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name: trimmed, createdBy: userName || '' };
  state = { ...state, plantSections: [...state.plantSections, record] };
  commit('plantSections');
  queueCloudMutation('plantSections', 'upsert', record);
  logActivity(userName, 'added plant section', trimmed, 'info');
  return true;
}

export function removePlantSection(name, userName) {
  const record = state.plantSections.find((s) => (typeof s === 'string' ? s : s.name) === name);
  state = { ...state, plantSections: state.plantSections.filter((s) => (typeof s === 'string' ? s : s.name) !== name) };
  commit('plantSections');
  if (record && record.id) {
    queueCloudMutation('plantSections', 'delete', record.id);
  }
  logActivity(userName, 'removed plant section', name, 'info');
}

// ── Per-machine breakdown log exports ─────────────────────────────────────
export const getMachineBreakdownLogs = () => state.machineBreakdownLogs;
export const getMachineBreakdownLogsForMachine = (machineId) =>
  state.machineBreakdownLogs.filter((r) => r.machineId === machineId);

export function addMachineBreakdownLog(fields, userName) {
  const log = normalizeMachineBreakdownLog({ ...fields, createdAt: now() });
  state = { ...state, machineBreakdownLogs: [log, ...state.machineBreakdownLogs] };
  commitAndQueue('machineBreakdownLogs', 'upsert', log);
  logActivity(userName, 'logged machine breakdown', `${log.machineName} · ${log.downtimeHours}h · ${log.failureCause}`, 'breakdown');

  // ── Auto-sync into section-level breakdown summary ──────────────────────
  // Aggregate all per-machine logs for this machine's section + period so
  // that Dashboard, Machine Register, and Machine Profile all show identical
  // MTTR / MTBF / downtime figures derived from the same source of truth.
  if (log.plantSection && log.date) {
    const period = log.date.slice(0, 7); // YYYY-MM
    const section = log.plantSection;

    const sectionLogs = state.machineBreakdownLogs.filter(
      (l) => l.plantSection === section && l.date.slice(0, 7) === period
    );

    const totalBreakdowns = sectionLogs.length;
    const totalDowntime   = sectionLogs.reduce((sum, l) => sum + (l.downtimeHours || 0), 0);

    const existingSummary = state.breakdowns.find(
      (b) => b.section === section && b.period === period
    );

    addBreakdown({
      ...(existingSummary || {}),
      period,
      section,
      breakdownCount: totalBreakdowns,
      downtimeHours: Math.round(totalDowntime * 100) / 100,
      // Preserve operating hours and manual overrides from the existing summary
      operatingHours: existingSummary?.operatingHours,
      availability_override: existingSummary?.availability_override ?? null,
      id: existingSummary?.id,
    }, userName || 'System');
  }

  return log;
}

export function updateMachineBreakdownLog(id, patch, userName) {
  const existing = state.machineBreakdownLogs.find((r) => r.id === id);
  if (!existing) return null;
  const updated = normalizeMachineBreakdownLog({ ...existing, ...patch, id });
  state = { ...state, machineBreakdownLogs: state.machineBreakdownLogs.map((r) => (r.id === id ? updated : r)) };
  commitAndQueue('machineBreakdownLogs', 'upsert', updated);
  logActivity(userName, 'updated machine breakdown log', `${updated.machineName}`, 'breakdown');
  return updated;
}

export function deleteMachineBreakdownLog(id, userName) {
  const log = state.machineBreakdownLogs.find((r) => r.id === id);
  state = { ...state, machineBreakdownLogs: state.machineBreakdownLogs.filter((r) => r.id !== id) };
  commitAndQueue('machineBreakdownLogs', 'delete', id);
  logActivity(userName, 'deleted machine breakdown log', '', 'breakdown');

  // Recalculate the section-level summary for the affected period after deletion
  if (log?.plantSection && log?.date) {
    const period = log.date.slice(0, 7);
    const section = log.plantSection;
    const sectionLogs = state.machineBreakdownLogs.filter(
      (l) => l.plantSection === section && l.date.slice(0, 7) === period
    );
    const existingSummary = state.breakdowns.find((b) => b.section === section && b.period === period);
    if (existingSummary) {
      const totalBreakdowns = sectionLogs.length;
      const totalDowntime = sectionLogs.reduce((sum, l) => sum + (l.downtimeHours || 0), 0);
      addBreakdown({
        ...existingSummary,
        breakdownCount: totalBreakdowns,
        downtimeHours: Math.round(totalDowntime * 100) / 100,
      }, userName || 'System');
    }
  }
}

/**
 * Bulk import per-machine breakdown logs from a parsed Excel sheet.
 * Matches each row against the machine store by machineCode or machineName,
 * attaches the machineId, and recalculates the section-level breakdown summary
 * (MTTR/MTBF) for every affected section automatically.
 *
 * Columns supported: Machine Code, Machine Name, Plant Section, Breakdown Start
 * Time, Breakdown End Time, Downtime Hours (auto-calculated when blank),
 * Failure Cause, Action Taken, Status, Remarks.
 */
export function importMachineBreakdownLogsBulk(rows, userName) {
  const logs = [];
  const unmatchedRows = [];
  const autoMapped = [];

  rows.forEach((row, idx) => {
    // ── Smart Data Enrichment (Feature 2) ──────────────────────────────────
    // Try to match by code first, then by name, then by fuzzy name match
    let matched = findMachineByIdentity(row.machineCode, row.machineName, row.plantSection);

    // If no exact match by name, try case-insensitive substring match
    if (!matched && row.machineName) {
      const nameLower = row.machineName.toLowerCase().trim();
      matched = state.machines.find((m) => {
        const mName = (m.name || '').toLowerCase().trim();
        return mName && (mName.includes(nameLower) || nameLower.includes(mName));
      }) || null;
    }

    const autoFilled = {};
    const log = normalizeMachineBreakdownLog({
      ...row,
      machineId: matched ? matched.id : '',
      machineCode: matched ? (matched.machineCode || matched.id) : (row.machineCode || ''),
      machineName: matched ? matched.name : row.machineName,
      plantSection: matched ? (matched.section || row.plantSection || '') : (row.plantSection || ''),
      startTime: row.startTime || '',
      endTime:   row.endTime   || '',
    });

    if (matched) {
      if (!row.machineCode && matched.machineCode) autoFilled.machineCode = matched.machineCode;
      if (!row.machineName && matched.name) autoFilled.machineName = matched.name;
      if (!row.plantSection && matched.section) autoFilled.plantSection = matched.section;
      if (Object.keys(autoFilled).length > 0) {
        autoMapped.push({ row: idx + 2, machine: matched.name || matched.machineCode, fields: autoFilled });
      }
    }

    if (!log.date) return;
    if (!log.machineId) {
      unmatchedRows.push(row.machineName || row.machineCode || `Row ${idx + 2}`);
      return;
    }
    logs.push(log);
    if (!matched) unmatchedRows.push(row.machineName || row.machineCode);
  });

  // Dedup on machineId + startTime or machineId + date + cause
  const existingKeys = new Set(
    state.machineBreakdownLogs.map((r) =>
      r.startTime
        ? `${r.machineId}:st:${r.startTime}`
        : `${r.machineId}:${r.date}:${r.failureCause}`
    )
  );

  const newLogs = logs.filter((l) => {
    const key = l.startTime
      ? `${l.machineId}:st:${l.startTime}`
      : `${l.machineId}:${l.date}:${l.failureCause}`;
    return !existingKeys.has(key);
  });

  state = { ...state, machineBreakdownLogs: [...newLogs, ...state.machineBreakdownLogs] };
  commit('machineBreakdownLogs');
  newLogs.forEach((l) => queueCloudMutation('machineBreakdownLogs', 'upsert', l, { schedule: false }));
  scheduleCloudFlush();

  // Recalculate section-level breakdown summaries for affected sections
  const affectedSections = [...new Set(newLogs.map((l) => l.plantSection).filter(Boolean))];
  affectedSections.forEach((section) => {
    const sectionLogs = state.machineBreakdownLogs.filter((l) => l.plantSection === section);
    const byPeriod = {};
    sectionLogs.forEach((l) => {
      const period = (l.startTime || l.date || '').slice(0, 7);
      if (!period) return;
      if (!byPeriod[period]) byPeriod[period] = { period, section, breakdownCount: 0, downtimeHours: 0 };
      byPeriod[period].breakdownCount += 1;
      byPeriod[period].downtimeHours = Math.round((byPeriod[period].downtimeHours + (l.downtimeHours || 0)) * 100) / 100;
    });
    Object.values(byPeriod).forEach((aggRow) => {
      const existingSummary = state.breakdowns.find((b) => b.section === aggRow.section && b.period === aggRow.period);
      addBreakdown({
        ...(existingSummary || {}),
        ...aggRow,
        id: existingSummary?.id,
        operatingHours: existingSummary?.operatingHours,
        availability_override: existingSummary?.availability_override ?? null,
      }, userName);
    });
  });

  const detail = unmatchedRows.length
    ? `${newLogs.length} imported · ${unmatchedRows.length} unmatched machines`
    : `${newLogs.length} breakdown logs imported`;

  logActivity(userName, 'bulk imported machine breakdown logs', detail, 'breakdown');
  return { created: newLogs.length, total: rows.length, unmatched: unmatchedRows, autoMapped };
}

export function exportBackup() {
  return JSON.stringify(
    {
      exportedAt: now(),
      machines: state.machines,
      breakdowns: state.breakdowns,
      pms: state.pms,
      energy: state.energy,
      dailyUtilityLog: state.dailyUtilityLog,
      monthlyHerbicide: state.monthlyHerbicide,
      monthlyInsecticide: state.monthlyInsecticide,
      monthlyWater: state.monthlyWater,
      monthlyAirCompressor: state.monthlyAirCompressor,
      dailySolarGeneration: state.dailySolarGeneration,
      energySettings: state.energySettings,
      machinePmRecords: state.machinePmRecords,
      testingCertificates: state.testingCertificates,
      activity: state.activity,
      settings: state.settings,
    },
    null,
    2
  );
}

export function importBackup(json) {
  const parsed = JSON.parse(json);

  if (Array.isArray(parsed.machines)) {
    const previousMachines = state.machines;
    state = { ...state, machines: mergeSeedMachines(parsed.machines, SEED_MACHINES) };
    commit('machines');
    queueEntityReplacement('machines', state.machines, previousMachines);
  }

  if (Array.isArray(parsed.breakdowns)) {
    const previousBreakdowns = state.breakdowns;
    state = { ...state, breakdowns: parsed.breakdowns.map(normalizeBreakdownSummary) };
    commit('breakdowns');
    queueEntityReplacement('breakdowns', state.breakdowns, previousBreakdowns);
  }

  if (Array.isArray(parsed.pms)) {
    const previousPMs = state.pms;
    state = { ...state, pms: parsed.pms.map(normalizePMSummary) };
    commit('pms');
    queueEntityReplacement('pms', state.pms, previousPMs);
  }

  if (Array.isArray(parsed.energy)) {
    state = { ...state, energy: parsed.energy.map(normalizeEnergyRecord) };
    commit('energy');
  }

  if (Array.isArray(parsed.amc)) {
    parsed.amc.forEach((r) => addAmcRecord(r, 'Backup Restore'));
  }
  if (Array.isArray(parsed.machineBreakdownLogs)) {
    state = { ...state, machineBreakdownLogs: parsed.machineBreakdownLogs.map(normalizeMachineBreakdownLog) };
    commit('machineBreakdownLogs');
  }
  if (Array.isArray(parsed.machinePmRecords)) {
    state = { ...state, machinePmRecords: parsed.machinePmRecords.map(normalizeMachinePmRecord) };
    commit('machinePmRecords');
  }
  if (Array.isArray(parsed.dailyUtilityLog)) {
    state = { ...state, dailyUtilityLog: parsed.dailyUtilityLog.map(normalizeDailyUtilityLog) };
    commit('dailyUtilityLog');
  }
  if (Array.isArray(parsed.monthlyHerbicide)) {
    state = { ...state, monthlyHerbicide: parsed.monthlyHerbicide.map(normalizeMonthlyHerbicide) };
    commit('monthlyHerbicide');
  }
  if (Array.isArray(parsed.monthlyInsecticide)) {
    state = { ...state, monthlyInsecticide: parsed.monthlyInsecticide.map(normalizeMonthlyInsecticide) };
    commit('monthlyInsecticide');
  }
  if (Array.isArray(parsed.monthlyWater)) {
    state = { ...state, monthlyWater: parsed.monthlyWater.map(normalizeMonthlyWater) };
    commit('monthlyWater');
  }
  if (Array.isArray(parsed.monthlyAirCompressor)) {
    state = { ...state, monthlyAirCompressor: parsed.monthlyAirCompressor.map(normalizeMonthlyAirCompressor) };
    commit('monthlyAirCompressor');
  }
  if (Array.isArray(parsed.dailySolarGeneration)) {
    state = { ...state, dailySolarGeneration: parsed.dailySolarGeneration.map(normalizeDailySolarGeneration) };
    commit('dailySolarGeneration');
  }
  if (parsed.energySettings) {
    state = { ...state, energySettings: normalizeEnergySettings(parsed.energySettings) };
    commit('energySettings');
  }
  if (Array.isArray(parsed.activity)) {
    state = { ...state, activity: parsed.activity };
    commit('activity');
  }

  if (parsed.settings) {
    updateSettings(parsed.settings);
  }
}

export function resetPersistentData() {
  const previous = {
    machines: state.machines,
    breakdowns: state.breakdowns,
    pms: state.pms,
    energy: state.energy,
    dailyUtilityLog: state.dailyUtilityLog,
    monthlyHerbicide: state.monthlyHerbicide,
    monthlyInsecticide: state.monthlyInsecticide,
    monthlyWater: state.monthlyWater,
    monthlyAirCompressor: state.monthlyAirCompressor,
    dailySolarGeneration: state.dailySolarGeneration,
    energySettings: state.energySettings,
    machineBreakdownLogs: state.machineBreakdownLogs,
    machinePmRecords: state.machinePmRecords,
    testingCertificates: state.testingCertificates,
    amc: state.amc,
    plantSections: state.plantSections,
  };

  state = {
    machines: SEED_MACHINES.map(normalizeMachineRecord),
    breakdowns: [],
    pms: [],
    energy: [],
    dailyUtilityLog: [],
    monthlyHerbicide: [],
    monthlyInsecticide: [],
    monthlyWater: [],
    monthlyAirCompressor: [],
    dailySolarGeneration: [],
    energySettings: normalizeEnergySettings({}),
    amc: [],
    machineBreakdownLogs: [],
    machinePmRecords: [],
    testingCertificates: [],
    plantSections: [],
    activity: [],
    settings: { plantName: 'Nathupur Formulation Plant', notifSeenAt: 0 },
    sync: state.sync,
  };

  Object.entries(LEGACY_KEYS).forEach(([, keys]) => {
    keys.forEach((key) => removePersistedKey(key));
  });

  persistWholeState();
  notifyStoreUpdate();

  queueEntityReplacement('machines', state.machines, previous.machines);
  queueEntityReplacement('breakdowns', state.breakdowns, previous.breakdowns);
  queueEntityReplacement('pms', state.pms, previous.pms);
  queueEntityReplacement('energy', state.energy, previous.energy);
  queueEntityReplacement('dailyUtilityLog', state.dailyUtilityLog, previous.dailyUtilityLog);
  queueEntityReplacement('monthlyHerbicide', state.monthlyHerbicide, previous.monthlyHerbicide);
  queueEntityReplacement('monthlyInsecticide', state.monthlyInsecticide, previous.monthlyInsecticide);
  queueEntityReplacement('monthlyWater', state.monthlyWater, previous.monthlyWater);
  queueEntityReplacement('monthlyAirCompressor', state.monthlyAirCompressor, previous.monthlyAirCompressor);
  queueEntityReplacement('dailySolarGeneration', state.dailySolarGeneration, previous.dailySolarGeneration);
  queueEntityReplacement('machineBreakdownLogs', state.machineBreakdownLogs, previous.machineBreakdownLogs);
  queueEntityReplacement('machinePmRecords', state.machinePmRecords, previous.machinePmRecords);
  queueEntityReplacement('testingCertificates', state.testingCertificates, previous.testingCertificates);
  queueEntityReplacement('amc', state.amc, previous.amc);
  queueEntityReplacement('plantSections', state.plantSections, previous.plantSections);
}

function findMachineByIdentity(machineCode, name, section) {
  const codeKey = normalizeText(machineCode);
  const nameKey = normalizeText(name).replace(/\s{2,}/g, ' ');
  const sectionKey = normalizeText(section);
  return state.machines.find((machine) => {
    const mCode = normalizeText(machine.machineCode || machine.id);
    const mName = normalizeText(machine.name).replace(/\s{2,}/g, ' ');
    return (
      (codeKey && mCode === codeKey) ||
      (nameKey && mName === nameKey && (!sectionKey || normalizeText(machine.section) === sectionKey))
    );
  }) || null;
}

function ensureMachine(fields) {
  const existing = findMachineByIdentity(fields.machineCode, fields.name, fields.section);
  if (existing) {
    return existing;
  }

  const machine = normalizeMachineRecord({
    ...fields,
    id: fields.machineCode || fields.id || uid('m'),
    machineCode: fields.machineCode || fields.id || '',
    createdAt: now(),
  });
  state = { ...state, machines: [machine, ...state.machines] };
  return machine;
}

export function importMachinesBulk(rows, userName) {
  let created = 0;
  let updated = 0;
  const touchedMachines = [];

  rows.forEach((row) => {
    const incoming = normalizeMachineRecord({
      id: row.id || row.machineCode,
      machineCode: row.machineCode || row.id,
      name: row.name || row.machineName,
      section: row.section || row.plantSection,
      area: row.area || row.location || '',
      criticality: row.criticality || '',
      status: row.status || 'running',
    });
    const existing = findMachineByIdentity(incoming.machineCode, incoming.name, incoming.section);
    if (existing) {
      const merged = { ...existing, ...incoming, id: existing.id };
      state = {
        ...state,
        machines: state.machines.map((machine) => (machine.id === existing.id ? merged : machine)),
      };
      touchedMachines.push(merged);
      updated += 1;
      return;
    }
    state = { ...state, machines: [incoming, ...state.machines] };
    touchedMachines.push(incoming);
    created += 1;
  });

  commit('machines');
  touchedMachines.forEach((machine) => queueCloudMutation('machines', 'upsert', machine, { schedule: false }));
  scheduleCloudFlush();
  logActivity(userName, 'bulk imported machines', `${created} created · ${updated} updated`, 'machine');
  return { created, updated, total: rows.length };
}

export function importPMBulk(rows, userName) {
  let created = 0;
  let updated = 0;

  rows.forEach((row) => {
    const record = normalizePMSummary(row);
    const existing = state.pms.find((item) => summaryIdentity(item) === summaryIdentity(record));
    if (existing) updated += 1;
    else created += 1;
    addPM(record, userName);
  });

  return { created, updated, total: rows.length };
}

export function importBreakdownsBulk(rows, userName) {
  let created = 0;
  let updated = 0;

  rows.forEach((row) => {
    const record = normalizeBreakdownSummary(row);
    const existing = state.breakdowns.find((item) => summaryIdentity(item) === summaryIdentity(record));
    if (existing) updated += 1;
    else created += 1;
    addBreakdown(record, userName);
  });

  localImportSuppressUntil.breakdowns = Date.now() + 3000;
  return { created, updated, total: rows.length };
}

export function importEnergyBulk(rows, userName) {
  const imports = rows.map((row) => normalizeEnergyRecord({
    date: String(row.date || '').slice(0, 10),
    plantSection: row.plantSection || '',
    uhbvnlUnit1Kwh: row.uhbvnlUnit1Kwh,
    uhbvnlUnit2Kwh: row.uhbvnlUnit2Kwh,
    totalGridKwh: row.totalGridKwh,
    dg500RunHours: row.dg500RunHours,
    dg380RunHours: row.dg380RunHours,
    fuelConsumedLitres: row.fuelConsumedLitres,
    solarGenerationKwh: row.solarGenerationKwh,
    dgKwh: row.dgKwh,
    totalKwh: row.totalKwh,
    plantSec: row.plantSec,
    sectionConsumption: row.sectionConsumption || {},
    kwh: row.kwh,
    remarks: 'Imported from bulk file',
  }));

  state = { ...state, energy: [...imports, ...state.energy] };
  commit('energy');
  localImportSuppressUntil.energy = Date.now() + 3000;
  imports.forEach((record) => queueCloudMutation('energy', 'upsert', record, { schedule: false }));
  scheduleCloudFlush();
  logActivity(userName, 'bulk imported energy logs', `${imports.length} rows added`, 'energy');
  return { created: imports.length, total: imports.length };
}

export function importDailyUtilityLogBulk(rows, userName) {
  const imports = rows.map((row) => normalizeDailyUtilityLog({ ...row, createdAt: row.createdAt || now(), updatedAt: now() }));
  state = { ...state, dailyUtilityLog: [...imports, ...state.dailyUtilityLog] };
  commit('dailyUtilityLog');
  localImportSuppressUntil.dailyUtilityLog = Date.now() + 3000;
  imports.forEach((record) => queueCloudMutation('dailyUtilityLog', 'upsert', record, { schedule: false }));
  scheduleCloudFlush();
  logActivity(userName, 'bulk imported daily utility logs', `${imports.length} rows added`, 'energy');
  return { created: imports.length, total: imports.length };
}

export function importMonthlyHerbicideBulk(rows, userName) {
  const imports = rows.map((row) => normalizeMonthlyHerbicide({ ...row, createdAt: row.createdAt || now(), updatedAt: now() }));
  state = { ...state, monthlyHerbicide: [...imports, ...state.monthlyHerbicide] };
  commit('monthlyHerbicide');
  imports.forEach((record) => queueCloudMutation('monthlyHerbicide', 'upsert', record, { schedule: false }));
  scheduleCloudFlush();
  logActivity(userName, 'bulk imported monthly herbicide records', `${imports.length} rows added`, 'energy');
  return { created: imports.length, total: imports.length };
}

export function importMonthlyInsecticideBulk(rows, userName) {
  const imports = rows.map((row) => normalizeMonthlyInsecticide({ ...row, createdAt: row.createdAt || now(), updatedAt: now() }));
  state = { ...state, monthlyInsecticide: [...imports, ...state.monthlyInsecticide] };
  commit('monthlyInsecticide');
  imports.forEach((record) => queueCloudMutation('monthlyInsecticide', 'upsert', record, { schedule: false }));
  scheduleCloudFlush();
  logActivity(userName, 'bulk imported monthly insecticide records', `${imports.length} rows added`, 'energy');
  return { created: imports.length, total: imports.length };
}

export function importMonthlyWaterBulk(rows, userName) {
  const imports = rows.map((row) => normalizeMonthlyWater({ ...row, createdAt: row.createdAt || now(), updatedAt: now() }));
  state = { ...state, monthlyWater: [...imports, ...state.monthlyWater] };
  commit('monthlyWater');
  imports.forEach((record) => queueCloudMutation('monthlyWater', 'upsert', record, { schedule: false }));
  scheduleCloudFlush();
  logActivity(userName, 'bulk imported monthly water records', `${imports.length} rows added`, 'energy');
  return { created: imports.length, total: imports.length };
}

export function importMonthlyAirCompressorBulk(rows, userName) {
  const imports = rows.map((row) => normalizeMonthlyAirCompressor({ ...row, createdAt: row.createdAt || now(), updatedAt: now() }));
  state = { ...state, monthlyAirCompressor: [...imports, ...state.monthlyAirCompressor] };
  commit('monthlyAirCompressor');
  imports.forEach((record) => queueCloudMutation('monthlyAirCompressor', 'upsert', record, { schedule: false }));
  scheduleCloudFlush();
  logActivity(userName, 'bulk imported monthly air compressor records', `${imports.length} rows added`, 'energy');
  return { created: imports.length, total: imports.length };
}

export function importDailySolarGenerationBulk(rows, userName) {
  const imports = rows.map((row) => normalizeDailySolarGeneration({ ...row, createdAt: row.createdAt || now(), updatedAt: now() }));
  state = { ...state, dailySolarGeneration: [...imports, ...state.dailySolarGeneration] };
  commit('dailySolarGeneration');
  localImportSuppressUntil.dailySolarGeneration = Date.now() + 3000;
  imports.forEach((record) => queueCloudMutation('dailySolarGeneration', 'upsert', record, { schedule: false }));
  scheduleCloudFlush();
  logActivity(userName, 'bulk imported daily solar generation records', `${imports.length} rows added`, 'energy');
  return { created: imports.length, total: imports.length };
}

export async function syncCloudDataNow() {
  await flushPendingCloudOps();
  if (supabase && isSupabaseConfigured) {
    await Promise.all([...SYNCED_ENTITIES].map((entity) => refreshCloudEntity(entity, false)));
    notifyStoreUpdate();
  }
}

export async function syncMachineRecordNow(machineId) {
  const machine = getMachine(machineId);
  if (!machine) {
    throw new Error('Machine not found');
  }

  if (!supabase || !isSupabaseConfigured) {
    return machine;
  }

  updateSyncState({ phase: isBrowserOnline() ? 'syncing' : 'offline', lastError: '' });

  try {
    await pushCloudOp({
      entity: 'machines',
      action: 'upsert',
      recordId: machine.id,
      payload: machine,
    });
    const remaining = dropPendingCloudOpsForRecord('machines', machine.id);
    await refreshCloudEntity('machines', false);
    updateSyncState({
      phase: 'synced',
      pending: remaining.length,
      lastSyncedAt: now(),
      lastError: '',
    }, false);
    notifyStoreUpdate();
    return getMachine(machineId);
  } catch (error) {
    updateSyncState({
      phase: isBrowserOnline() ? 'degraded' : 'offline',
      pending: loadPendingCloudOps().length,
      lastError: error.message || 'Failed to sync machine record',
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Master Excel bulk import — runs PM, Breakdown, and Energy imports in one
// call from the result of parseMasterImportFile(). Every upsert goes through
// the standard commitAndQueue path so changes reach Supabase Realtime and
// every connected client PC immediately.
// ---------------------------------------------------------------------------

/**
 * @param {import('./bulkImport.js').MasterImportResult} masterResult
 * @param {string} userName
 * @returns {{ pm: object, breakdowns: object, energy: object, total: number }}
 */
export function importMasterExcelBulk(masterResult, userName) {
  const pmResult = masterResult?.pm?.parsedRows?.length
    ? importPMBulk(masterResult.pm.parsedRows, userName)
    : { created: 0, updated: 0, total: 0 };

  const bdResult = masterResult?.breakdowns?.parsedRows?.length
    ? importBreakdownsBulk(masterResult.breakdowns.parsedRows, userName)
    : { created: 0, updated: 0, total: 0 };

  const energyResult = masterResult?.energy?.parsedRows?.length
    ? importEnergyBulk(masterResult.energy.parsedRows, userName)
    : { created: 0, updated: 0, total: 0 };

  const total = pmResult.total + bdResult.total + energyResult.total;

  logActivity(
    userName,
    'master Excel import',
    `PM ${pmResult.total} · Breakdowns ${bdResult.total} · Energy ${energyResult.total} rows — syncing to all connected PCs`,
    'upload'
  );

  return { pm: pmResult, breakdowns: bdResult, energy: energyResult, total };
}

// ---------------------------------------------------------------------------
// Live Sheet API / URL polling sync (Option B)
//
// Consumers can configure a remote JSON endpoint in app settings:
//   updateSettings({ masterSheetEndpoint: 'https://script.google.com/...' })
//
// The endpoint must return JSON in the shape:
//   { pm?: Row[], breakdowns?: Row[], energy?: Row[] }
// where each array uses the same column keys accepted by the bulk importers.
//
// Call syncFromMasterSheet() on-demand or on a polling interval.
// ---------------------------------------------------------------------------

let masterSheetPollingTimer = null;

/**
 * Pull data from the configured remote sheet endpoint and apply it to the
 * store, syncing all three entities to Supabase.
 *
 * @returns {Promise<{ pm: object, breakdowns: object, energy: object, total: number, endpoint: string }>}
 */
export async function syncFromMasterSheet() {
  const endpoint = state.settings?.masterSheetEndpoint;
  if (!endpoint) {
    throw new Error('No masterSheetEndpoint configured. Add it via Settings → Master Sheet Sync.');
  }

  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Master sheet fetch failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const userName = 'Master Sheet Sync';

  const pmRows = Array.isArray(json.pm) ? json.pm : [];
  const bdRows = Array.isArray(json.breakdowns) ? json.breakdowns : [];
  const energyRows = Array.isArray(json.energy) ? json.energy : [];

  const pmResult = pmRows.length ? importPMBulk(pmRows, userName) : { created: 0, updated: 0, total: 0 };
  const bdResult = bdRows.length ? importBreakdownsBulk(bdRows, userName) : { created: 0, updated: 0, total: 0 };
  const energyResult = energyRows.length ? importEnergyBulk(energyRows, userName) : { created: 0, updated: 0, total: 0 };

  const total = pmResult.total + bdResult.total + energyResult.total;

  logActivity(
    userName,
    'live sheet sync',
    `PM ${pmResult.total} · Breakdowns ${bdResult.total} · Energy ${energyResult.total} rows pulled from remote endpoint`,
    'upload'
  );

  return { pm: pmResult, breakdowns: bdResult, energy: energyResult, total, endpoint };
}

/**
 * Start polling the configured master sheet endpoint at a given interval.
 * Calling again with a new interval replaces the existing timer.
 *
 * @param {number} intervalMs  Default: 5 minutes (300_000 ms)
 */
export function startMasterSheetPolling(intervalMs = 300_000) {
  stopMasterSheetPolling();
  masterSheetPollingTimer = setInterval(() => {
    syncFromMasterSheet().catch((err) => {
      updateSyncState({ lastError: `Master sheet poll: ${err.message}` }, false);
    });
  }, intervalMs);
}

/** Cancel any active master sheet polling timer. */
export function stopMasterSheetPolling() {
  if (masterSheetPollingTimer !== null) {
    clearInterval(masterSheetPollingTimer);
    masterSheetPollingTimer = null;
  }
}
