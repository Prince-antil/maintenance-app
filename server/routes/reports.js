import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { queryAll, queryOne, runSql } from '../db.js';
import { verifyToken, requireAdmin } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const ALLOWED_EXTENSIONS = ['.doc', '.docx', '.xlsx', '.xls', '.csv', '.ppt', '.pptx', '.pdf'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const id = uuidv4();
    cb(null, `${id}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTENSIONS.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${ext} not allowed`), false);
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();

const CATEGORIES = [
  'Monthly PM Report',
  'Plantwise Breakdown Report',
  'FAT (Factory Acceptance Test)',
  'Energy Report (DG 500 & 380KVA)',
  'Energy Report (Solar)',
  'Plantwise Energy Consumption',
  'Kaizen',
  'Improvement',
  'ORM Data (Operational Risk Management)'
];

const PLANT_SECTIONS = [
  'Utility Block', 'SC Line', 'EC Line', 'WP Line',
  'WDG Line', 'Packaging', 'Solar Grid', 'DG Room',
  'Raw Material Section', 'Formulation Lines'
];

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

// GET /api/reports - list all reports with filters
router.get('/', verifyToken, (req, res) => {
  const { category, month, year, plant_section, file_format, search, page = 1, limit = 20 } = req.query;
  let conditions = [];
  let params = [];

  if (category) { conditions.push('r.category_name = ?'); params.push(category); }
  if (month) { conditions.push('r.reporting_month = ?'); params.push(month); }
  if (year) { conditions.push('r.reporting_year = ?'); params.push(parseInt(year)); }
  if (plant_section) { conditions.push('r.plant_section = ?'); params.push(plant_section); }
  if (file_format) { conditions.push('r.file_format = ?'); params.push(file_format); }
  if (search) {
    conditions.push("(r.filename LIKE ? OR r.category_name LIKE ? OR r.plant_section LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const countRow = queryOne(
    `SELECT COUNT(*) as total FROM report_files r ${whereClause}`, params
  );

  const rows = queryAll(
    `SELECT r.*, u.full_name as uploader_name
     FROM report_files r
     LEFT JOIN users u ON r.uploaded_by = u.id
     ${whereClause}
     ORDER BY r.uploaded_at DESC
     LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), offset]
  );

  res.json({
    data: rows,
    total: countRow?.total || 0,
    page: parseInt(page),
    totalPages: Math.ceil((countRow?.total || 0) / parseInt(limit))
  });
});

// GET /api/reports/categories - category stats for dashboard
router.get('/categories', verifyToken, (req, res) => {
  const stats = CATEGORIES.map(cat => {
    const row = queryOne(
      'SELECT COUNT(*) as file_count, MAX(uploaded_at) as last_uploaded FROM report_files WHERE category_name = ?',
      [cat]
    );
    return {
      category_name: cat,
      file_count: row?.file_count || 0,
      last_uploaded: row?.last_uploaded || null
    };
  });
  res.json(stats);
});

// GET /api/reports/recent - recent uploads
router.get('/recent', verifyToken, (req, res) => {
  const rows = queryAll(
    `SELECT r.*, u.full_name as uploader_name
     FROM report_files r
     LEFT JOIN users u ON r.uploaded_by = u.id
     ORDER BY r.uploaded_at DESC
     LIMIT 10`
  );
  res.json(rows);
});

// GET /api/reports/meta - dropdown options
router.get('/meta', verifyToken, (req, res) => {
  res.json({ categories: CATEGORIES, plant_sections: PLANT_SECTIONS, months: MONTHS });
});

// GET /api/reports/:id - single report
router.get('/:id', verifyToken, (req, res) => {
  const row = queryOne(
    `SELECT r.*, u.full_name as uploader_name
     FROM report_files r
     LEFT JOIN users u ON r.uploaded_by = u.id
     WHERE r.id = ?`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Report not found' });
  res.json(row);
});

// POST /api/reports - upload (admin only)
router.post('/', verifyToken, requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { category_name, reporting_month, reporting_year, plant_section } = req.body;
  if (!category_name || !reporting_month || !reporting_year || !plant_section) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (!CATEGORIES.includes(category_name)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Invalid category' });
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  const id = path.parse(req.file.filename).name;
  const file_url = `/api/files/${req.file.filename}`;

  runSql(
    `INSERT INTO report_files (id, category_name, filename, file_url, file_format, reporting_month, reporting_year, plant_section, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, category_name, req.file.originalname, file_url, ext, reporting_month, parseInt(reporting_year), plant_section, req.user.id]
  );

  const newReport = queryOne('SELECT * FROM report_files WHERE id = ?', [id]);
  res.status(201).json(newReport);
});

// PUT /api/reports/:id - update tags (admin only)
router.put('/:id', verifyToken, requireAdmin, (req, res) => {
  const { category_name, reporting_month, reporting_year, plant_section } = req.body;
  const existing = queryOne('SELECT * FROM report_files WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Report not found' });

  runSql(
    `UPDATE report_files SET
       category_name = COALESCE(?, category_name),
       reporting_month = COALESCE(?, reporting_month),
       reporting_year = COALESCE(?, reporting_year),
       plant_section = COALESCE(?, plant_section)
     WHERE id = ?`,
    [
      category_name || null,
      reporting_month || null,
      reporting_year ? parseInt(reporting_year) : null,
      plant_section || null,
      req.params.id
    ]
  );

  const updated = queryOne('SELECT * FROM report_files WHERE id = ?', [req.params.id]);
  res.json(updated);
});

// DELETE /api/reports/:id (admin only)
router.delete('/:id', verifyToken, requireAdmin, (req, res) => {
  const existing = queryOne('SELECT * FROM report_files WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Report not found' });

  const filePath = path.join(UPLOADS_DIR, path.basename(existing.file_url));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  runSql('DELETE FROM report_files WHERE id = ?', [req.params.id]);
  res.json({ message: 'Report deleted successfully' });
});

export default router;
