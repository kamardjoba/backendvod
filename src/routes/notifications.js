import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, attachUser } from '../middleware/auth.js';
import { listNotifications, markNotificationsRead } from '../services/notifications.js';

const router = Router();

router.use(requireAuth, attachUser);

router.get('/', async (req, res, next) => {
  try {
    const items = await listNotifications(req.user.id);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post('/read', async (req, res, next) => {
  try {
    const schema = z.object({ ids: z.array(z.string().min(1)) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Некорректные данные' });
    await markNotificationsRead(req.user.id, parsed.data.ids);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
