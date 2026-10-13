import { Router } from 'express';
import { z } from 'zod';
import { RestPeriod, User, restToRow } from '../models/index.js';
import { requireAuth, attachUser, requireRole } from '../middleware/auth.js';
import {
  buildDriverPayload,
  getActiveRestPeriod,
  getRestHistory,
  mapRestPeriodForHistory,
  confirmationMessage,
} from '../services/restPeriod.js';
import { writeAuditLog } from '../services/audit.js';
import { createNotification, notifyAdministrators } from '../services/notifications.js';
import { addDuration, nowUtc, parseInputDateTime, toIso } from '../utils/time.js';

const router = Router();

router.use(requireAuth, attachUser, requireRole('driver'));

const restTypeEnum = z.enum([
  'daily',
  'weekly_reduced_24h',
  'weekly_full_45h',
  'custom',
]);

const startRestSchema = z.object({
  startedAt: z.string(),
  restType: restTypeEnum,
  durationMinutes: z.number().int().positive().max(60 * 24 * 14),
  plannedEndAt: z.string().optional(),
  city: z.string().max(100).optional(),
  comment: z.string().max(500).optional(),
});

function durationForType(restType) {
  switch (restType) {
    case 'daily':
      return 11 * 60;
    case 'weekly_reduced_24h':
      return 24 * 60;
    case 'weekly_full_45h':
      return 45 * 60;
    default:
      return null;
  }
}

function restTypeLabel(restType) {
  const map = {
    daily: 'Ежедневный отдых',
    weekly_reduced_24h: 'Сокращённый еженедельный отдых — 24 часа',
    weekly_full_45h: 'Полный еженедельный отдых — 45 часов',
    custom: 'Другой период',
  };
  return map[restType] || restType;
}

async function emitDriverUpdate(req, driverId) {
  const io = req.app.get('io');
  const payload = await buildDriverPayload(driverId);
  io?.emit('drivers:updated', { driverId, payload });
  io?.to('admin').emit('admin:dashboard', {});
  io?.emit('notifications:updated', { userId: driverId });
}

router.get('/me', async (req, res, next) => {
  try {
    const payload = await buildDriverPayload(req.user.id);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get('/me/history', async (req, res, next) => {
  try {
    const rows = await getRestHistory(req.user.id);
    res.json(rows.map(mapRestPeriodForHistory));
  } catch (err) {
    next(err);
  }
});

router.post('/me/rest/start', async (req, res, next) => {
  try {
    const parsed = startRestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Проверьте данные формы отдыха' });
    }
    const data = parsed.data;
    const existing = await getActiveRestPeriod(req.user.id);
    if (existing) {
      return res.status(409).json({ error: 'У вас уже есть активный период отдыха' });
    }

    const startedAt = parseInputDateTime(data.startedAt);
    if (!startedAt) return res.status(400).json({ error: 'Некорректное время начала' });

    let durationMinutes = data.durationMinutes;
    const preset = durationForType(data.restType);
    if (preset) durationMinutes = preset;

    const plannedEnd = data.plannedEndAt
      ? parseInputDateTime(data.plannedEndAt)
      : addDuration(startedAt, durationMinutes);
    if (!plannedEnd) return res.status(400).json({ error: 'Некорректное время окончания' });

    const doc = await RestPeriod.create({
      driver_id: req.user.id,
      rest_type: data.restType,
      started_at: new Date(toIso(startedAt)),
      planned_duration_minutes: durationMinutes,
      initial_planned_end_at: new Date(toIso(plannedEnd)),
      current_planned_end_at: new Date(toIso(plannedEnd)),
      city: data.city || null,
      driver_comment: data.comment || null,
      status: 'active',
      last_updated_by: 'driver',
    });

    await User.findByIdAndUpdate(req.user.id, { updated_at: new Date() });

    const rest = restToRow(doc);
    await writeAuditLog({
      actorUserId: req.user.id,
      targetDriverId: req.user.id,
      action: 'rest_started',
      newValue: { restPeriodId: rest.id, restType: data.restType },
    });

    const driverName = `${req.user.first_name} ${req.user.last_name}`;
    await notifyAdministrators({
      type: 'driver_rest_started',
      title: 'Водитель начал отдых',
      body: `${driverName} начал отдых (${restTypeLabel(data.restType)}).`,
      meta: { driverId: req.user.id, restPeriodId: rest.id },
    });

    await createNotification({
      userId: req.user.id,
      type: 'rest_saved',
      title: 'Отдых сохранён',
      body: confirmationMessage(rest.current_planned_end_at),
      meta: { restPeriodId: rest.id },
    });

    await emitDriverUpdate(req, req.user.id);

    res.status(201).json({
      message: confirmationMessage(rest.current_planned_end_at),
      rest: mapRestPeriodForHistory(rest),
    });
  } catch (err) {
    next(err);
  }
});

const updateEndSchema = z.object({
  plannedEndAt: z.string(),
  comment: z.string().max(500).optional(),
});

router.patch('/me/rest/planned-end', async (req, res, next) => {
  try {
    const parsed = updateEndSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Некорректные данные' });

    const active = await getActiveRestPeriod(req.user.id);
    if (!active) return res.status(404).json({ error: 'Активный отдых не найден' });

    const newEnd = parseInputDateTime(parsed.data.plannedEndAt);
    if (!newEnd) return res.status(400).json({ error: 'Некорректное время окончания' });

    const oldValue = { currentPlannedEndAt: active.current_planned_end_at };
    const doc = await RestPeriod.findByIdAndUpdate(
      active.id,
      {
        current_planned_end_at: new Date(toIso(newEnd)),
        ...(parsed.data.comment !== undefined ? { driver_comment: parsed.data.comment } : {}),
        last_updated_by: 'driver',
      },
      { new: true }
    );

    await writeAuditLog({
      actorUserId: req.user.id,
      targetDriverId: req.user.id,
      action: 'planned_end_updated',
      oldValue,
      newValue: { currentPlannedEndAt: toIso(newEnd) },
    });

    await notifyAdministrators({
      type: 'driver_planned_end_changed',
      title: 'Изменено время доступности',
      body: `${req.user.first_name} ${req.user.last_name} изменил планируемое время выхода.`,
      meta: { driverId: req.user.id, restPeriodId: active.id },
    });

    await emitDriverUpdate(req, req.user.id);
    res.json({ rest: mapRestPeriodForHistory(restToRow(doc)) });
  } catch (err) {
    next(err);
  }
});

router.post('/me/rest/confirm-available', async (req, res, next) => {
  try {
    const active = await getActiveRestPeriod(req.user.id);
    if (!active) return res.status(404).json({ error: 'Активный отдых не найден' });

    const nowIso = toIso(nowUtc());
    const doc = await RestPeriod.findByIdAndUpdate(
      active.id,
      {
        status: 'completed',
        actual_availability_at: new Date(),
        last_updated_by: 'driver',
      },
      { new: true }
    );

    await User.findByIdAndUpdate(req.user.id, { updated_at: new Date() });

    await writeAuditLog({
      actorUserId: req.user.id,
      targetDriverId: req.user.id,
      action: 'availability_confirmed',
      newValue: { restPeriodId: active.id, actualAvailabilityAt: nowIso },
    });

    await emitDriverUpdate(req, req.user.id);
    res.json({ rest: mapRestPeriodForHistory(restToRow(doc)) });
  } catch (err) {
    next(err);
  }
});

router.post('/me/rest/continue', async (req, res, next) => {
  try {
    const schema = z.object({ plannedEndAt: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Укажите новое время доступности' });

    const active = await getActiveRestPeriod(req.user.id);
    if (!active) return res.status(404).json({ error: 'Активный отдых не найден' });

    const newEnd = parseInputDateTime(parsed.data.plannedEndAt);
    if (!newEnd) return res.status(400).json({ error: 'Некорректное время' });

    const doc = await RestPeriod.findByIdAndUpdate(
      active.id,
      {
        current_planned_end_at: new Date(toIso(newEnd)),
        last_updated_by: 'driver',
      },
      { new: true }
    );

    await notifyAdministrators({
      type: 'driver_not_ready',
      title: 'Водитель продолжает отдых',
      body: `${req.user.first_name} ${req.user.last_name} сообщил, что не готов к работе.`,
      meta: { driverId: req.user.id, restPeriodId: active.id },
    });

    await emitDriverUpdate(req, req.user.id);
    res.json({ rest: mapRestPeriodForHistory(restToRow(doc)) });
  } catch (err) {
    next(err);
  }
});

router.post('/me/rest/end-early', async (req, res, next) => {
  try {
    const active = await getActiveRestPeriod(req.user.id);
    if (!active) return res.status(404).json({ error: 'Активный отдых не найден' });

    const doc = await RestPeriod.findByIdAndUpdate(
      active.id,
      {
        status: 'completed',
        actual_availability_at: new Date(),
        last_updated_by: 'driver',
      },
      { new: true }
    );

    await emitDriverUpdate(req, req.user.id);
    res.json({ rest: mapRestPeriodForHistory(restToRow(doc)) });
  } catch (err) {
    next(err);
  }
});

export default router;
