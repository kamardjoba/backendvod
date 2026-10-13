import { Router } from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User } from '../models/index.js';
import { attachUser } from '../middleware/auth.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа. Попробуйте позже.' },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Неверные данные для входа' });
    }
    const { email, password } = parsed.data;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    req.session.userId = user._id.toString();
    req.session.role = user.role;
    res.json({
      user: {
        id: user._id.toString(),
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Не удалось завершить сессию' });
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', attachUser, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Не авторизован' });
  }
  res.json({
    user: {
      id: req.user.id,
      firstName: req.user.first_name,
      lastName: req.user.last_name,
      email: req.user.email,
      phone: req.user.phone,
      role: req.user.role,
    },
  });
});

export default router;
