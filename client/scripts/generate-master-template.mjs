import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const today = new Date().toISOString().slice(0, 10);
const month = new Date().toISOString().slice(0, 7);

// Exact sampleRows — mirrors IMPORT_MODULES in bulkImport.js after fix
const SHEETS = {
  PM_Monthly_Summary: [
    { 'Reporting Period': month, 'Plant Section': 'Herbi EC Packaging', 'Planned PM Count': 24, 'Done PM Count': 21, 'Pending PM Count': 3, 'Compliance %': 87.5, 'Start Time': `${today}T08:00`, 'End Time': `${today}T16:00`, Remarks: '' },
    { 'Reporting Period': month, 'Plant Section': 'EC INSEC Packaging', 'Planned PM Count': 18, 'Done PM Count': 18, 'Pending PM Count': 0, 'Compliance %': 100, 'Start Time': `${today}T09:00`, 'End Time': `${today}T13:00`, Remarks: 'All done' },
  ],
  Breakdown_Monthly_Summary: [
    { 'Reporting Period': month, 'Plant Section': 'EC INSEC Packaging', 'Breakdown Count': 8, 'Downtime Hours': 26.5, 'Operating Hours': 35280, MTTR: '', MTBF: '', Remarks: '(MTTR/MTBF auto if blank)' },
    { 'Reporting Period': month, 'Plant Section': 'Utility Section', 'Breakdown Count': 2, 'Downtime Hours': 4, 'Operating Hours': 720, MTTR: '', MTBF: '', Remarks: '' },
  ],
  Machine_Breakdown_Logs: [
    { 'Machine Code': 'MC-101', 'Machine Name': 'Filling Machine #1', 'Plant Section': 'Herbi EC Packaging', 'Breakdown Start Time': `${today}T08:00`, 'Breakdown End Time': `${today}T12:30`, 'Downtime Hours': '', 'Failure Cause': 'Bearing failure in main shaft', 'Action Taken': 'Bearing replaced, shaft aligned', Status: 'Closed', Remarks: '(Downtime auto from Start/End if blank)' },
  ],
  Machine_Register: [
    { 'Machine ID': 'MC-151', 'Machine Name': 'Example Equipment', 'Plant Section': 'Utility Section', Status: 'Running', Location: 'Block B - Ground Floor', Criticality: 'A - Critical', Manufacturer: '', Model: '', 'Serial Number': '', Remarks: '' },
  ],
  Machine_PM_Records: [
    { 'Machine Code': 'MC-101', 'Machine Name': 'Filling Machine #1', 'Plant Section': 'Herbi EC Packaging', 'PM Date': today, 'PM Type': 'Preventive', Task: 'Lubrication and filter replacement', Status: 'Completed', 'Action Taken': 'Grease applied, filter replaced', Technician: 'Ravi Kumar', Remarks: '' },
    { 'Machine Code': 'MC-102', 'Machine Name': 'Capping Machine', 'Plant Section': 'Herbi EC Packaging', 'PM Date': today, 'PM Type': 'Preventive', Task: 'Belt inspection', Status: 'pending', 'Action Taken': '', Technician: '', Remarks: 'Pending — assign technician' },
  ],
  Energy_Log_Legacy: [
    { Date: today, 'Plant Section': 'Utility Section', 'UHBVNL Unit 1 KWh': 4200, 'UHBVNL Unit 2 KWh': 1850, 'DG 500kVA Run Hrs': 4.5, 'DG 380kVA Run Hrs': 2, 'Fuel Consumed (Ltrs)': 180, 'Solar Generation (kWh)': 620, 'DG KWh': 0, 'Total KWh': '', 'Production MT': 120, 'Plant SEC (kWh/MT)': '', 'Glyphosate (kWh)': 310, 'ACM (kWh)': 820, 'Jet-mill (kWh)': 540, 'Cartap (kWh)': 270, 'Compressors (kWh)': 95, 'Water/STP (kWh)': 65, Remarks: '(Total KWh & SEC auto if blank)' },
  ],
  Energy_Daily_Utility: [
    { Date: today, 'U1 Import KWh Reading': 4200, 'U1 Import kVAh Reading': 4500, 'U1 Export KWh Reading': 0, 'U1 Export kVAh Reading': 0, 'U1 Solar KWh Reading': 620, 'U1 Solar kVAh Reading': 640, 'U1 PF': 0.933, 'U2 Import KWh Reading': 1850, 'U2 Import kVAh Reading': 1950, 'U2 Export KWh Reading': 0, 'U2 Export kVAh Reading': 0, 'U2 Solar KWh Reading': 310, 'U2 Solar kVAh Reading': 320, 'U2 PF': 0.949, 'DG 380 KWh Reading': 800, 'DG 380 Hourmeter Reading': 12500, 'DG 380 HSD Opening (Ltr)': 1500, 'DG 380 HSD Added (Ltr)': 200, 'DG 380 DEF Opening %': 5, 'DG 380 DEF %': 10, 'DG 500 KWh Reading': 1200, 'DG 500 Hourmeter Reading': 8900, 'DG 500 HSD Opening (Ltr)': 2000, 'DG 500 HSD Added (Ltr)': 250, 'DG 500 DEF Opening %': 8, 'DG 500 DEF %': 15 },
  ],
  Energy_Herbicide: [
    { Month: month, 'Glyphosate M1 Meter Reading': 3100, 'Maintenance Topper M2 Meter Reading': 1200, 'ACM Herbicide M3 Meter Reading': 820, 'Topper Herbicide M4 Meter Reading': 450, 'Maintenance Printing Meter Reading': 680 },
  ],
  Energy_Insecticide: [
    { Month: month, 'Feeder 2 SC Electric Room Meter Reading': 540, 'Feeder 3 Waterbath Meter Reading': 320, 'Feeder 4 Jetmill Meter Reading': 780, 'Feeder 5 Cartap Plant Meter Reading': 270, 'Feeder 6 EC Formulation Meter Reading': 410, 'Feeder 7 Spare Meter Reading': 0, 'Feeder 8 EC Packing Meter Reading': 190, 'Feeder 9 Admin Block Meter Reading': 150, 'ACM Insecticide Meter Reading': 890, 'Air Compressor 02 IR Meter Reading': 120, 'Air Compressor 03 Atlas Meter Reading': 95, 'Air Compressor 01 IR Atlas Meter Reading': 110 },
  ],
  Energy_Water_STP: [
    { Month: month, 'STP Outlet Meter Reading': 1500, 'RO Inlet Meter Reading': 2200, 'RO Rejected Meter Reading': 800, 'PIAU Water Meter Reading': 350 },
  ],
  Energy_Air_Compressor: [
    { Month: month, 'Compressor 1 Run Hrs Reading': 720, 'Compressor 1 Load Hrs Reading': 580, 'Compressor 2 Run Hrs Reading': 650, 'Compressor 2 Load Hrs Reading': 520, 'Compressor 3 Run Hrs Reading': 480, 'Compressor 3 Load Hrs Reading': 390 },
  ],
  Energy_Daily_Solar: [
    { Date: today, 'U1 INV1 KWh': 320, 'U1 INV2 KWh': 290, 'U1 INV3 KWh': 310, 'U1 INV4 KWh': 280, 'U2 INV1 KWh': 180, 'U2 INV2 KWh': 170, 'U2 INV3 KWh': 160, 'Daily Total KWh': '', Remarks: '(Daily Total auto = sum of 7 inverters if blank; or enter total alone)' },
    { Date: today, 'U1 INV1 KWh': '', 'U1 INV2 KWh': '', 'U1 INV3 KWh': '', 'U1 INV4 KWh': '', 'U2 INV1 KWh': '', 'U2 INV2 KWh': '', 'U2 INV3 KWh': '', 'Daily Total KWh': 1747, Remarks: 'Example: single-column upload (total only) — also works' },
  ],
};

const README = [
  { Sheet: 'PM_Monthly_Summary', Purpose: 'Monthly PM compliance per Plant Section', Required: 'Plant Section, Reporting Period, Planned PM Count', Notes: 'Compliance% & duration auto' },
  { Sheet: 'Breakdown_Monthly_Summary', Purpose: 'Monthly breakdown stats', Required: 'Plant Section, Reporting Period, Breakdown Count', Notes: 'MTTR/MTBF auto if blank' },
  { Sheet: 'Machine_Breakdown_Logs', Purpose: 'Per-machine breakdown incidents', Required: 'Machine Name + Start Time', Notes: 'Downtime auto from Start/End' },
  { Sheet: 'Machine_Register', Purpose: 'Machine asset master', Required: 'Machine Name', Notes: 'Machine Code auto if blank' },
  { Sheet: 'Machine_PM_Records', Purpose: 'Per-machine PM history', Required: 'Machine Name', Notes: 'Status defaults to pending' },
  { Sheet: 'Energy_Log_Legacy', Purpose: 'Legacy aggregate energy', Required: 'Date', Notes: 'Total KWh/SEC auto if blank' },
  { Sheet: 'Energy_Daily_Utility', Purpose: 'Daily grid/DG/HSD/DEF + PF', Required: 'Date', Notes: 'PF auto if kVAh missing' },
  { Sheet: 'Energy_Herbicide', Purpose: 'Monthly Herbicide (5 meters)', Required: 'Month YYYY-MM', Notes: 'Delta vs prior month' },
  { Sheet: 'Energy_Insecticide', Purpose: 'Monthly Insecticide (12 feeders)', Required: 'Month YYYY-MM', Notes: 'Delta vs prior month' },
  { Sheet: 'Energy_Water_STP', Purpose: 'Monthly Water/STP/RO/PIAU', Required: 'Month YYYY-MM', Notes: 'Delta vs prior month' },
  { Sheet: 'Energy_Air_Compressor', Purpose: 'Monthly Air Compressor run/load', Required: 'Month YYYY-MM', Notes: 'Unload & Load% auto' },
  { Sheet: 'Energy_Daily_Solar', Purpose: 'Daily solar inverter (7 inv) ', Required: 'Date', Notes: 'Daily Total = sum if blank; or total alone' },
  { Sheet: 'README', Purpose: 'This index', Required: '-', Notes: 'Keep headers exactly as row 1 — aliases handle variants' },
];

function buildWorkbook() {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(SHEETS)) {
    const ws = XLSX.utils.json_to_sheet(rows);
    // Auto width
    const headers = Object.keys(rows[0] || {});
    ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 2, 14) }));
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  }
  const rws = XLSX.utils.json_to_sheet(README);
  rws['!cols'] = [{ wch: 24 }, { wch: 32 }, { wch: 40 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, rws, 'README');
  return wb;
}

const wb = buildWorkbook();
const pubDir = path.resolve(__dirname, '../public');
const distDir = path.resolve(__dirname, '../dist');
fs.mkdirSync(pubDir, { recursive: true });
fs.mkdirSync(distDir, { recursive: true });
const filename = 'CCPL_Master_Import_Template.xlsx';
const legacy = 'Master_Import_Template.xlsx';
XLSX.writeFile(wb, path.join(pubDir, filename));
XLSX.writeFile(wb, path.join(pubDir, legacy));
XLSX.writeFile(wb, path.join(distDir, filename));
XLSX.writeFile(wb, path.join(distDir, legacy));
console.log(`Generated ${filename} + ${legacy} in public/ and dist/`);
console.log(`Sheets: ${wb.SheetNames.join(', ')}`);
console.log(`Workbook sheets count: ${wb.SheetNames.length} (expected 13 inc README)`);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  console.log(`  ${name}: ${rows.length - 1} data rows, ${rows[0]?.length || 0} cols`);
}
