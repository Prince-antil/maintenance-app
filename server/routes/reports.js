import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { verifyToken, requireAdmin } from '../middleware/auth.js';
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
} from '../lib/reportRepository.js';

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

const router = Router();
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

// GET /api/reports - list all reports with filters
router.get('/', verifyToken, async (req, res) => {
  try {
    res.json(await listReports(req.query));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch reports' });
  }
});

// GET /api/reports/categories - category stats for dashboard
router.get('/categories', verifyToken, async (req, res) => {
  try {
    res.json(await getCategoryStats());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch category stats' });
  }
});

// GET /api/reports/recent - recent uploads
router.get('/recent', verifyToken, async (req, res) => {
  try {
    res.json(await getRecentReports());
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch recent reports' });
  }
});

// GET /api/reports/meta - dropdown options
router.get('/meta', verifyToken, (req, res) => {
  res.json(getReportMeta());
});

// GET /api/reports/:id - single report
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const row = await getReportById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Report not found' });
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch report' });
  }
});

// POST /api/reports - upload (admin only)
router.post('/', verifyToken, requireAdmin, (req, res, next) => {
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

// PUT /api/reports/:id - update tags (admin only)
router.put('/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const updated = await updateReportRecord(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Report not found' });
    res.json(updated);
  } catch (error) {
    res.status(reportErrorStatus(error)).json({ error: error.message || 'Failed to update report metadata' });
  }
});

// DELETE /api/reports/:id (admin only)
router.delete('/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    await deleteReportRecord(req.params.id);
    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    res.status(reportErrorStatus(error)).json({ error: error.message || 'Failed to delete report' });
  }
});

export default router;
