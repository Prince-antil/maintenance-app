import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'agro-maint-secret-key-2026';

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

export function verifyToken(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    req.user = null;
    next();
  }
}

const ADMIN_ROLES = new Set(['admin','super_admin','plant_admin']);
const CORPORATE_ROLES = new Set(['admin','super_admin','corporate_head']);

export function requireAdmin(req, res, next) {
  if (!req.user || !ADMIN_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export function requireCorporate(req, res, next) {
  if (!req.user || !CORPORATE_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'Corporate access required' });
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient role' });
    }
    next();
  };
}

export { JWT_SECRET };
