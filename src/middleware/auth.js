import { User, userToRow } from '../models/index.js';

export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  next();
}

export async function attachUser(req, res, next) {
  if (!req.session?.userId) {
    req.user = null;
    return next();
  }
  try {
    const doc = await User.findById(req.session.userId);
    const user = userToRow(doc);
    if (!user || !user.is_active) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Сессия недействительна' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    next();
  };
}

export function requireSelfDriver(req, res, next) {
  const paramId = req.params.driverId || req.params.id;
  if (req.user.role === 'administrator') return next();
  if (req.user.role === 'driver' && req.user.id === paramId) return next();
  return res.status(403).json({ error: 'Доступ запрещён' });
}
