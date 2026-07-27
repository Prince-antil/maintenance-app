import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';

const JWT_SECRET = process.env.JWT_SECRET || 'agro-maint-secret-key-2026';
let db;

async function getDB() {
  if (db) return db;
  const SQL = await initSqlJs();
  db = new SQL.Database();

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
  }

  const viewerResult = db.exec("SELECT id FROM users WHERE role = 'viewer'");
  if (!viewerResult.length || !viewerResult[0].values.length) {
    const hash = bcrypt.hashSync('viewer123', 10);
    db.run(
      'INSERT INTO users (id, username, password, role, full_name) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), 'viewer', hash, 'viewer', 'Read-Only Viewer']
    );
  }

  return db;
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

function runSql(sql, params = []) {
  db.run(sql, params);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function verifyToken(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) { req.user = null; return next(); }
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { req.user = null; next(); }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

const CATEGORIES = [
  'Monthly PM Report', 'Plantwise Breakdown Report', 'FAT (Factory Acceptance Test)',
  'Energy Report (DG 500 & 380KVA)', 'Energy Report (Solar)', 'Plantwise Energy Consumption',
  'Kaizen', 'Improvement', 'ORM Data (Operational Risk Management)'
];
const PLANT_SECTIONS = [
  'Utility Block', 'SC Line', 'EC Line', 'WP Line', 'WDG Line', 'Packaging',
  'Solar Grid', 'DG Room', 'Raw Material Section', 'Formulation Lines'
];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Auth
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = generateToken(user);
  res.cookie('token', token, { httpOnly: true, maxAge: 86400000, sameSite: 'none', secure: true });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name } });
});

app.post('/api/auth/logout', (req, res) => { res.clearCookie('token'); res.json({ message: 'Logged out' }); });
app.get('/api/auth/me', verifyToken, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.user });
});

// Reports
app.get('/api/reports', verifyToken, (req, res) => {
  const { category, month, year, plant_section, file_format, search, page = 1, limit = 20 } = req.query;
  let conditions = [], params = [];
  if (category) { conditions.push('r.category_name = ?'); params.push(category); }
  if (month) { conditions.push('r.reporting_month = ?'); params.push(month); }
  if (year) { conditions.push('r.reporting_year = ?'); params.push(parseInt(year)); }
  if (plant_section) { conditions.push('r.plant_section = ?'); params.push(plant_section); }
  if (file_format) { conditions.push('r.file_format = ?'); params.push(file_format); }
  if (search) { conditions.push("(r.filename LIKE ? OR r.category_name LIKE ? OR r.plant_section LIKE ?)"); params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const countRow = queryOne(`SELECT COUNT(*) as total FROM report_files r ${whereClause}`, params);
  const rows = queryAll(`SELECT r.*, u.full_name as uploader_name FROM report_files r LEFT JOIN users u ON r.uploaded_by = u.id ${whereClause} ORDER BY r.uploaded_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);
  res.json({ data: rows, total: countRow?.total || 0, page: parseInt(page), totalPages: Math.ceil((countRow?.total || 0) / parseInt(limit)) });
});

app.get('/api/reports/categories', verifyToken, (req, res) => {
  const stats = CATEGORIES.map(cat => {
    const row = queryOne('SELECT COUNT(*) as file_count, MAX(uploaded_at) as last_uploaded FROM report_files WHERE category_name = ?', [cat]);
    return { category_name: cat, file_count: row?.file_count || 0, last_uploaded: row?.last_uploaded || null };
  });
  res.json(stats);
});

app.get('/api/reports/recent', verifyToken, (req, res) => {
  res.json(queryAll(`SELECT r.*, u.full_name as uploader_name FROM report_files r LEFT JOIN users u ON r.uploaded_by = u.id ORDER BY r.uploaded_at DESC LIMIT 10`));
});

app.get('/api/reports/meta', verifyToken, (req, res) => {
  res.json({ categories: CATEGORIES, plant_sections: PLANT_SECTIONS, months: MONTHS });
});

app.get('/api/reports/:id', verifyToken, (req, res) => {
  const row = queryOne(`SELECT r.*, u.full_name as uploader_name FROM report_files r LEFT JOIN users u ON r.uploaded_by = u.id WHERE r.id = ?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Report not found' });
  res.json(row);
});

app.delete('/api/reports/:id', verifyToken, requireAdmin, (req, res) => {
  const existing = queryOne('SELECT * FROM report_files WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Report not found' });
  runSql('DELETE FROM report_files WHERE id = ?', [req.params.id]);
  res.json({ message: 'Report deleted successfully' });
});

// Vercel serverless handler
let initialized = false;

export default async function handler(req, res) {
  if (!initialized) {
    await getDB();
    initialized = true;
  }
  return new Promise((resolve, reject) => {
    app(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
