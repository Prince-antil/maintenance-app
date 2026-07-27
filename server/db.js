import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'maintenance.db');

let db;

export async function getDB() {
  if (db) return db;
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','viewer')),
      full_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS report_files (
      id TEXT PRIMARY KEY,
      category_name TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_format TEXT NOT NULL,
      reporting_month TEXT NOT NULL,
      reporting_year INTEGER NOT NULL,
      plant_section TEXT NOT NULL,
      uploaded_at TEXT DEFAULT (datetime('now')),
      uploaded_by TEXT NOT NULL,
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_reports_category ON report_files(category_name)');
  db.run('CREATE INDEX IF NOT EXISTS idx_reports_month_year ON report_files(reporting_month, reporting_year)');
  db.run('CREATE INDEX IF NOT EXISTS idx_reports_plant ON report_files(plant_section)');

  // Seed admin
  const adminResult = db.exec("SELECT id FROM users WHERE role = 'admin'");
  if (!adminResult.length || !adminResult[0].values.length) {
    const hash = bcrypt.hashSync('Prince123', 10);
    db.run(
      'INSERT INTO users (id, username, password, role, full_name) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), 'Prince', hash, 'admin', 'Prince']
    );
    console.log('Seeded admin user');
  }

  // Seed viewer
  const viewerResult = db.exec("SELECT id FROM users WHERE role = 'viewer'");
  if (!viewerResult.length || !viewerResult[0].values.length) {
    const hash = bcrypt.hashSync('viewer123', 10);
    db.run(
      'INSERT INTO users (id, username, password, role, full_name) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), 'viewer', hash, 'viewer', 'Read-Only Viewer']
    );
    console.log('Seeded viewer user (username: viewer, password: viewer123)');
  }

  saveDB();
  return db;
}

export function saveDB() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

// Helper: run SELECT and return array of objects
export function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: run SELECT and return first row as object or null
export function queryOne(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

// Helper: run INSERT/UPDATE/DELETE
export function runSql(sql, params = []) {
  db.run(sql, params);
  saveDB();
}

export default { getDB, saveDB, queryAll, queryOne, runSql };

