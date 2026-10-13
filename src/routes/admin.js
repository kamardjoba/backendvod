import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { AuditLog, RestPeriod, User, userToRow } from '../models/index.js';
import { requireAuth, attachUser, requireRole, requireSelfDriver } from '../middleware/auth.js';
import {
  adminStats,
  buildDriverPayload,
  enrichDriverRow,
  getActiveRestPeriod,
  getRestHistory,
  mapRestPeriodForHistory,
  sortDriversForAdmin,
} from '../services/restPeriod.js';
import { writeAuditLog } from '../services/audit.js';
import { createNotification } from '../services/notifications.js';
import { parseInputDateTime, toIso } from '../utils/time.js';
const router = Router();

router.use(requireAuth, attachUser, requireRole('administrator'));

async function emitUpdates(req, driverId) {
  const io = req.app.get('io');
  const payload = await buildDriverPayload(driverId);
  io?.emit('drivers:updated', { driverId, payload });
  io?.to('admin').emit('admin:dashboard', {});
  io?.emit('notifications:updated', { userId: driverId });
  io?.emit('notifications:updated', { userId: req.user.id });
}

async function auditLogsForDriver(driverId, limit = 100) {
  const logs = await AuditLog.find({ target_driver_id: driverId })
    .sort({ created_at: -1 })
    .limit(limit);
  const actorIds = [...new Set(logs.map((l) => l.actor_user_id?.toString()).filter(Boolean))];
  const actors = await User.find({ _id: { $in: actorIds } });
  const actorMap = new Map(actors.map((a) => [a._id.toString(), a]));

  return logs.map((a) => {
    const actor = actorMap.get(a.actor_user_id?.toString());
    return {
      id: a._id.toString(),
      actor_user_id: a.actor_user_id?.toString() || null,
      target_driver_id: a.target_driver_id?.toString() || null,
      action: a.action,
      old_value: a.old_value,
      new_value: a.new_value,
      created_at: a.created_at,
      first_name: actor?.first_name || null,
      last_name: actor?.last_name || null,
    };
  });
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const sortBy = req.query.sortBy === 'last_update' ? 'last_update' : 'planned_exit';
    const statusFilter = req.query.status || 'all';
    const search = (req.query.search || '').trim().toLowerCase();

    const userDocs = await User.find({ role: 'driver' }).sort({ last_name: 1, first_name: 1 });

    const drivers = [];
    for (const doc of userDocs) {
      const user = userToRow(doc);
      const activeRest = await getActiveRestPeriod(user.id);
      drivers.push(enrichDriverRow(user, activeRest));
    }

    let filtered = drivers;
    if (search) {
      filtered = filtered.filter((d) =>
        `${d.firstName} ${d.lastName}`.toLowerCase().includes(search)
      );
    }
    if (statusFilter !== 'all') {
      filtered = filtered.filter((d) => d.displayStatus.key === statusFilter);
    }

    filtered = sortDriversForAdmin(filtered, sortBy);

    res.json({
      stats: adminStats(drivers),
      drivers: filtered,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/drivers/:id', requireSelfDriver, async (req, res, next) => {
  try {
    const driverId = req.params.id;
    const payload = await buildDriverPayload(driverId);
    if (!payload || payload.role !== 'driver') {
      return res.status(404).json({ error: 'Водитель не найден' });
    }
    const history = await getRestHistory(driverId);
    const auditLogs = await auditLogsForDriver(driverId);
    res.json({
      driver: payload,
      history: history.map(mapRestPeriodForHistory),
      auditLogs,
    });
  } catch (err) {
    next(err);
  }
});

const createDriverSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().max(50).optional(),
});

router.post('/drivers', async (req, res, next) => {
  try {
    const parsed = createDriverSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Проверьте данные водителя' });
    const { firstName, lastName, email, password, phone } = parsed.data;
    const hash = await bcrypt.hash(password, 12);
    const doc = await User.create({
      first_name: firstName,
      last_name: lastName,
      email: email.toLowerCase(),
      password_hash: hash,
      phone: phone || null,
      role: 'driver',
      is_active: true,
    });
    const driver = userToRow(doc);
    await writeAuditLog({
      actorUserId: req.user.id,
      targetDriverId: driver.id,
      action: 'driver_created',
      newValue: { email },
    });
    res.status(201).json({
      driver: {
        id: driver.id,
        first_name: driver.first_name,
        last_name: driver.last_name,
        email: driver.email,
        phone: driver.phone,
        role: driver.role,
        is_active: driver.is_active,
        created_at: driver.created_at,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Email уже используется' });
    }
    next(err);
  }
});

const updateDriverSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(50).optional(),
  isActive: z.boolean().optional(),
});

router.patch('/drivers/:id', async (req, res, next) => {
  try {
    const driverId = req.params.id;
    const parsed = updateDriverSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Некорректные данные' });

    const existingDoc = await User.findOne({ _id: driverId, role: 'driver' });
    const existing = userToRow(existingDoc);
    if (!existing) return res.status(404).json({ error: 'Водитель не найден' });

    const d = parsed.data;
    const updatedDoc = await User.findByIdAndUpdate(
      driverId,
      {
        ...(d.firstName !== undefined ? { first_name: d.firstName } : {}),
        ...(d.lastName !== undefined ? { last_name: d.lastName } : {}),
        ...(d.phone !== undefined ? { phone: d.phone } : {}),
        ...(d.isActive !== undefined ? { is_active: d.isActive } : {}),
      },
      { new: true }
    );
    const updated = userToRow(updatedDoc);

    await writeAuditLog({
      actorUserId: req.user.id,
      targetDriverId: driverId,
      action: 'driver_updated',
      oldValue: existing,
      newValue: updated,
    });

    if (d.isActive === false) {
      await createNotification({
        userId: driverId,
        type: 'account_deactivated',
        title: 'Аккаунт деактивирован',
        body: 'Администратор деактивировал ваш аккаунт.',
      });
    }

    await emitUpdates(req, driverId);
    res.json({ driver: await buildDriverPayload(driverId) });
  } catch (err) {
    next(err);
  }
});

const adminRestUpdateSchema = z.object({
  plannedEndAt: z.string().optional(),
  manualStatus: z.enum(['working', 'resting']).optional(),
  comment: z.string().max(500).optional(),
});

router.patch('/drivers/:id/rest', async (req, res, next) => {
  try {
    const driverId = req.params.id;
    const parsed = adminRestUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Некорректные данные' });

    const active = await getActiveRestPeriod(driverId);

    if (parsed.data.manualStatus === 'working') {
      if (active) {
        await RestPeriod.findByIdAndUpdate(active.id, {
          status: 'completed',
          actual_availability_at: new Date(),
          last_updated_by: 'administrator',
        });
      }
      await writeAuditLog({
        actorUserId: req.user.id,
        targetDriverId: driverId,
        action: 'admin_set_working',
        newValue: { restPeriodId: active?.id || null },
      });
    } else if (parsed.data.manualStatus === 'resting' && !active) {
      return res.status(400).json({ error: 'Нет активного отдыха для изменения статуса' });
    }

    if (parsed.data.plannedEndAt && active) {
      const newEnd = parseInputDateTime(parsed.data.plannedEndAt);
      if (!newEnd) return res.status(400).json({ error: 'Некорректное время' });
      await RestPeriod.findByIdAndUpdate(active.id, {
        current_planned_end_at: new Date(toIso(newEnd)),
        ...(parsed.data.comment !== undefined ? { driver_comment: parsed.data.comment } : {}),
        last_updated_by: 'administrator',
      });
      await writeAuditLog({
        actorUserId: req.user.id,
        targetDriverId: driverId,
        action: 'admin_planned_end_updated',
        newValue: { currentPlannedEndAt: toIso(newEnd) },
      });
    }

    await createNotification({
      userId: driverId,
      type: 'admin_updated_driver',
      title: 'Данные обновлены администратором',
      body: 'Администратор изменил информацию о вашем отдыхе или статусе.',
    });

    await emitUpdates(req, driverId);
    res.json({ driver: await buildDriverPayload(driverId) });
  } catch (err) {
    next(err);
  }
});

router.get('/audit', async (req, res, next) => {
  try {
    const logs = await AuditLog.find().sort({ created_at: -1 }).limit(200);
    const actorIds = [...new Set(logs.map((l) => l.actor_user_id?.toString()).filter(Boolean))];
    const actors = await User.find({ _id: { $in: actorIds } });
    const actorMap = new Map(actors.map((a) => [a._id.toString(), a]));

    res.json(
      logs.map((a) => {
        const actor = actorMap.get(a.actor_user_id?.toString());
        return {
          id: a._id.toString(),
          actor_user_id: a.actor_user_id?.toString() || null,
          target_driver_id: a.target_driver_id?.toString() || null,
          action: a.action,
          old_value: a.old_value,
          new_value: a.new_value,
          created_at: a.created_at,
          first_name: actor?.first_name || null,
          last_name: actor?.last_name || null,
        };
      })
    );
  } catch (err) {
    next(err);
  }
});

export default router;
