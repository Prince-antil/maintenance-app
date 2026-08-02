import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import initSqlJs from 'sql.js';
import path from 'path';
import {
  ALLOWED_EXTENSIONS,
  createReportFromUpload,
  deleteReportRecord,
  getCategoryStats,
  getRecentReports,
  getReportById,
  getReportMeta,
  listReports,
  updateReportRecord,
} from '../server/lib/reportRepository.js';

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

function queryOne(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
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

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTENSIONS.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${ext} not allowed`), false);
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});
const uploadSingle = upload.single('file');
const REPORT_VALIDATION_ERRORS = new Set([
  'No file uploaded',
  'All fields are required',
  'Invalid category',
  'Invalid reporting month',
  'Invalid reporting year',
  'Report not found',
]);

function reportErrorStatus(error) {
  if (REPORT_VALIDATION_ERRORS.has(error?.message)) {
    return error.message === 'Report not found' ? 404 : 400;
  }
  return 500;
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
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
app.get('/api/reports', verifyToken, async (req, res) => {
  try {
    res.json(await listReports(req.query));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch reports' });
  }
});

app.get('/api/reports/categories', verifyToken, async (req, res) => {
  try {
    res.json(await getCategoryStats());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch category stats' });
  }
});

app.get('/api/reports/recent', verifyToken, async (req, res) => {
  try {
    res.json(await getRecentReports());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch recent reports' });
  }
});

app.get('/api/reports/meta', verifyToken, (req, res) => {
  res.json(getReportMeta());
});

app.get('/api/reports/:id', verifyToken, async (req, res) => {
  try {
    const row = await getReportById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Report not found' });
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch report' });
  }
});

app.post('/api/reports', verifyToken, requireAdmin, (req, res, next) => {
  uploadSingle(req, res, (uploadErr) => {
    if (uploadErr) {
      const status = uploadErr instanceof multer.MulterError && uploadErr.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: uploadErr.message || 'Upload failed' });
    }
    return next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const newReport = await createReportFromUpload({
      file: req.file,
      body: req.body,
      userName: req.user?.full_name || req.user?.username || 'System',
    });
    return res.status(201).json(newReport);
  } catch (error) {
    return res.status(reportErrorStatus(error)).json({ error: error.message || 'Failed to upload report' });
  }
});

app.put('/api/reports/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const updated = await updateReportRecord(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Report not found' });
    res.json(updated);
  } catch (error) {
    res.status(reportErrorStatus(error)).json({ error: error.message || 'Failed to update report metadata' });
  }
});

app.delete('/api/reports/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    await deleteReportRecord(req.params.id);
    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    res.status(reportErrorStatus(error)).json({ error: error.message || 'Failed to delete report' });
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled serverless API error:', err);
  if (res.headersSent) {
    return next(err);
  }
  return res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Vercel serverless handler
let initialized = false;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb'
    }
  }
};

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
