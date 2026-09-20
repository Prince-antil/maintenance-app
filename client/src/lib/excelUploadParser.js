/**
 * Excel Upload Parser - Auto-Calculation Parser for Energy Data
 * Parses Excel files and auto-computes all derived fields
 */

import * as XLSX from 'xlsx';
import { processUtilityRow, processSolarRow } from './energyEngine.js';

/**
 * Normalizes column headers for flexible matching
 */
function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Maps normalized Excel headers to database field names
 */
const UTILITY_HEADER_MAP = {
  // Date
  'date': 'date',
  'readingdate': 'date',
  'logdate': 'date',
  
  // U1 Import
  'u1importkwhreading': 'u1_import_kwh_reading',
  'u1importkwh': 'u1_import_kwh_reading',
  'unit1importkwh': 'u1_import_kwh_reading',
  'u1kwhimport': 'u1_import_kwh_reading',
  'u1importkvahreading': 'u1_import_kvah_reading',
  'u1importkvah': 'u1_import_kvah_reading',
  'unit1importkvah': 'u1_import_kvah_reading',
  'u1kvahimport': 'u1_import_kvah_reading',
  
  // U1 Export
  'u1exportkwhreading': 'u1_export_kwh_reading',
  'u1exportkwh': 'u1_export_kwh_reading',
  'unit1exportkwh': 'u1_export_kwh_reading',
  'u1kwhexport': 'u1_export_kwh_reading',
  'u1exportkvahreading': 'u1_export_kvah_reading',
  'u1exportkvah': 'u1_export_kvah_reading',
  'unit1exportkvah': 'u1_export_kvah_reading',
  'u1kvahexport': 'u1_export_kvah_reading',
  
  // U1 Solar
  'u1solarkwhreading': 'u1_solar_kwh_reading',
  'u1solarkwh': 'u1_solar_kwh_reading',
  'unit1solarkwh': 'u1_solar_kwh_reading',
  'u1kwhsolar': 'u1_solar_kwh_reading',
  'u1solarkvahreading': 'u1_solar_kvah_reading',
  'u1solarkvah': 'u1_solar_kvah_reading',
  'unit1solarkvah': 'u1_solar_kvah_reading',
  'u1kvahsolar': 'u1_solar_kvah_reading',
  
  // U2 Import
  'u2importkwhreading': 'u2_import_kwh_reading',
  'u2importkwh': 'u2_import_kwh_reading',
  'unit2importkwh': 'u2_import_kwh_reading',
  'u2kwhimport': 'u2_import_kwh_reading',
  'u2importkvahreading': 'u2_import_kvah_reading',
  'u2importkvah': 'u2_import_kvah_reading',
  'unit2importkvah': 'u2_import_kvah_reading',
  'u2kvahimport': 'u2_import_kvah_reading',
  
  // U2 Export
  'u2exportkwhreading': 'u2_export_kwh_reading',
  'u2exportkwh': 'u2_export_kwh_reading',
  'unit2exportkwh': 'u2_export_kwh_reading',
  'u2kwhexport': 'u2_export_kwh_reading',
  'u2exportkvahreading': 'u2_export_kvah_reading',
  'u2exportkvah': 'u2_export_kvah_reading',
  'unit2exportkvah': 'u2_export_kvah_reading',
  'u2kvahexport': 'u2_export_kvah_reading',
  
  // U2 Solar
  'u2solarkwhreading': 'u2_solar_kwh_reading',
  'u2solarkwh': 'u2_solar_kwh_reading',
  'unit2solarkwh': 'u2_solar_kwh_reading',
  'u2kwhsolar': 'u2_solar_kwh_reading',
  'u2solarkvahreading': 'u2_solar_kvah_reading',
  'u2solarkvah': 'u2_solar_kvah_reading',
  'unit2solarkvah': 'u2_solar_kvah_reading',
  'u2kvahsolar': 'u2_solar_kvah_reading',
  
  // PF (optional - will be recalculated)
  'u1pf': 'u1_pf',
  'u1powerfactor': 'u1_pf',
  'unit1pf': 'u1_pf',
  'unit1powerfactor': 'u1_pf',
  'u1 power factor': 'u1_pf',
  'u1 pf': 'u1_pf',
  'u2pf': 'u2_pf',
  'u2powerfactor': 'u2_pf',
  'unit2pf': 'u2_pf',
  'unit2powerfactor': 'u2_pf',
  'u2 power factor': 'u2_pf',
  'u2 pf': 'u2_pf',
  
  // DG 380
  'dg380kwhreading': 'dg380_kwh_reading',
  'dg380kwh': 'dg380_kwh_reading',
  'dg380kwhr': 'dg380_kwh_reading',
  'dg380hourmeterreading': 'dg380_hourmeter_reading',
  'dg380hourmeter': 'dg380_hourmeter_reading',
  'dg380hours': 'dg380_hourmeter_reading',
  'dg380hsdaddedltr': 'dg380_hsd_added_ltr',
  'dg380hsdadded': 'dg380_hsd_added_ltr',
  'dg380hsdadd': 'dg380_hsd_added_ltr',
  'dg380defaddedpct': 'dg380_def_added_pct',
  'dg380defadded': 'dg380_def_added_pct',
  'dg380defadd': 'dg380_def_added_pct',
  'dg380def': 'dg380_def_added_pct',
  'dg380def%': 'dg380_def_added_pct',
  'dg 380 def %': 'dg380_def_added_pct',
  
  // DG 500
  'dg500kwhreading': 'dg500_kwh_reading',
  'dg500kwh': 'dg500_kwh_reading',
  'dg500kwhr': 'dg500_kwh_reading',
  'dg500hourmeterreading': 'dg500_hourmeter_reading',
  'dg500hourmeter': 'dg500_hourmeter_reading',
  'dg500hours': 'dg500_hourmeter_reading',
  'dg500hsdaddedltr': 'dg500_hsd_added_ltr',
  'dg500hsdadded': 'dg500_hsd_added_ltr',
  'dg500hsdadd': 'dg500_hsd_added_ltr',
  'dg500defaddedpct': 'dg500_def_added_pct',
  'dg500defadded': 'dg500_def_added_pct',
  'dg500defadd': 'dg500_def_added_pct',
  'dg500def': 'dg500_def_added_pct',
  'dg500def%': 'dg500_def_added_pct',
  'dg 500 def %': 'dg500_def_added_pct'
};

const SOLAR_HEADER_MAP = {
  'date': 'date',
  'readingdate': 'date',
  'logdate': 'date',
  
  // U1 Inverters
  'u1inv1kwh': 'u1_inv1_kwh',
  'unit1inv1kwh': 'u1_inv1_kwh',
  'u1inv1': 'u1_inv1_kwh',
  'u1inv2kwh': 'u1_inv2_kwh',
  'unit1inv2kwh': 'u1_inv2_kwh',
  'u1inv2': 'u1_inv2_kwh',
  'u1inv3kwh': 'u1_inv3_kwh',
  'unit1inv3kwh': 'u1_inv3_kwh',
  'u1inv3': 'u1_inv3_kwh',
  'u1inv4kwh': 'u1_inv4_kwh',
  'unit1inv4kwh': 'u1_inv4_kwh',
  'u1inv4': 'u1_inv4_kwh',
  
  // U2 Inverters
  'u2inv1kwh': 'u2_inv1_kwh',
  'unit2inv1kwh': 'u2_inv1_kwh',
  'u2inv1': 'u2_inv1_kwh',
  'u2inv2kwh': 'u2_inv2_kwh',
  'unit2inv2kwh': 'u2_inv2_kwh',
  'u2inv2': 'u2_inv2_kwh',
  'u2inv3kwh': 'u2_inv3_kwh',
  'unit2inv3kwh': 'u2_inv3_kwh',
  'u2inv3': 'u2_inv3_kwh',
  
  // Daily total (optional - will be recalculated)
  'dailytotalkwh': 'daily_total_kwh',
  'daily total kwh': 'daily_total_kwh'
};

/**
 * Maps Excel row to database field using header mapping
 */
function mapRowToFields(row, headerMap) {
  const mapped = {};
  
  Object.entries(row).forEach(([header, value]) => {
    const normHeader = normalizeHeader(header);
    const dbField = headerMap[normHeader];
    
    if (dbField) {
      // Handle numbers properly
      if (typeof value === 'number') {
        mapped[dbField] = value;
      } else if (typeof value === 'string') {
        const num = Number(value.replace(/[^0-9.-]/g, ''));
        mapped[dbField] = isNaN(num) ? value : num;
      } else {
        mapped[dbField] = value;
      }
    }
  });
  
  return mapped;
}

/**
 * Parses Utility Excel file and auto-computes all derived fields
 * @param {File} file - Excel file
 * @returns {Promise<Array>} Processed rows ready for database insert
 */
export async function parseUtilityExcelFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: 0 });
  
  return rawData.map((item) => {
    // Map headers to database fields
    const mapped = mapRowToFields(item, UTILITY_HEADER_MAP);
    
    // Ensure date is in YYYY-MM-DD format
    if (mapped.date) {
      const d = new Date(mapped.date);
      if (!isNaN(d.getTime())) {
        mapped.date = d.toISOString().split('T')[0];
      }
    }
    
    // Process row to auto-compute PF, totals, etc.
    return processUtilityRow(mapped);
  });
}

/**
 * Parses Solar Excel file and auto-computes all derived fields
 * Fixes the Grand Total = 0 bug by computing from inverter values
 * @param {File} file - Excel file
 * @returns {Promise<Array>} Processed rows ready for database insert
 */
export async function parseSolarExcelFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: 0 });
  
  return rawData.map((item) => {
    // Map headers to database fields
    const mapped = mapRowToFields(item, SOLAR_HEADER_MAP);
    
    // Ensure date is in YYYY-MM-DD format
    if (mapped.date) {
      const d = new Date(mapped.date);
      if (!isNaN(d.getTime())) {
        mapped.date = d.toISOString().split('T')[0];
      }
    }
    
    // Process row to auto-compute totals
    return processSolarRow(mapped);
  });
}

/**
 * Generates Excel template for Utility data
 * @returns {ArrayBuffer} Excel file buffer
 */
export function generateUtilityTemplate() {
  const template = [{
    Date: new Date().toISOString().split('T')[0],
    'U1 Import KWh Reading': 4200,
    'U1 Import kVAh Reading': 4500,
    'U1 Export KWh Reading': 0,
    'U1 Export kVAh Reading': 0,
    'U1 Solar KWh Reading': 620,
    'U1 Solar kVAh Reading': 640,
    'U1 PF': 0.933,
    'U2 Import KWh Reading': 1850,
    'U2 Import kVAh Reading': 1950,
    'U2 Export KWh Reading': 0,
    'U2 Export kVAh Reading': 0,
    'U2 Solar KWh Reading': 310,
    'U2 Solar kVAh Reading': 320,
    'U2 PF': 0.949,
    'DG 380 KWh Reading': 800,
    'DG 380 Hourmeter Reading': 12500,
    'DG 380 HSD Added (Ltr)': 200,
    'DG 380 DEF %': 10,
    'DG 500 KWh Reading': 1200,
    'DG 500 Hourmeter Reading': 8900,
    'DG 500 HSD Added (Ltr)': 250,
    'DG 500 DEF %': 15
  }];
  
  const worksheet = XLSX.utils.json_to_sheet(template);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Daily Utility');
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
}

/**
 * Generates Excel template for Solar data
 * @returns {ArrayBuffer} Excel file buffer
 */
export function generateSolarTemplate() {
  const template = [{
    Date: new Date().toISOString().split('T')[0],
    'U1 Inv1 kWh': 1500,
    'U1 Inv2 kWh': 1200,
    'U1 Inv3 kWh': 1100,
    'U1 Inv4 kWh': 1000,
    'U2 Inv1 kWh': 800,
    'U2 Inv2 kWh': 700,
    'U2 Inv3 kWh': 600
  }];
  
  const worksheet = XLSX.utils.json_to_sheet(template);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Daily Solar');
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
}