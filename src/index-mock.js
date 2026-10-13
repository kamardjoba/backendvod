/**
 * index-mock.js — Full Express server using in-memory data instead of PostgreSQL.
 * Run with:  npm run dev:mock
 * All original logic is preserved; only the DB layer is replaced.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import session from 'express-session';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { DateTime } from 'luxon';

import {
  findUser, findUsers, insertUser, updateUser,
  getActiveRest, getHistory, insertRest, updateRest,
  insertAudit, getAuditForDriver, getAllAudit,
  insertNotification, listNotifications, markRead,
  adminList,
} from './mock-db.js';

import { computeDriverStatus, restDurationHours } from './services/status.js';
import {
  formatForDisplay, parseInputDateTime, addDuration,
  nowUtc, toIso, isPast, msUntil,
} from './utils/time.js';

// ─── App setup ────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const PORT = 3001;
const CLIENT_ORIGIN = 'http://localhost:5173';

const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, credentials: true },
});
app.set('io', io);

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Simple in-memory session (no Postgres session store)
app.use(session({
  secret: 'dev-mock-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// ─── Middleware helpers ────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  next();
}

function attachUser(req, res, next) {
  if (!req.session?.userId) { req.user = null; return next(); }
  const user = findUser(u => u.id === req.session.userId);
  if (!user || !user.is_active) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Сессия недействительна' });
  }
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Недостаточно прав' });
    next();
  };
}

// ─── Shared helpers ───────────────────────────────────────────────────────────
function userShape(u) {
  return {
    id: u.id, firstName: u.first_name, lastName: u.last_name,
    email: u.email, phone: u.phone, role: u.role,
    isActive: u.is_active, createdAt: u.created_at, updatedAt: u.updated_at,
  };
}

function mapRest(r) {
  return {
    id: r.id,
    restType: r.rest_type,
    city: r.city || null,
    startedAt: r.started_at,
    plannedDurationMinutes: r.planned_duration_minutes,
    plannedDurationLabel: restDurationHours(r.planned_duration_minutes),
    initialPlannedEndAt: r.initial_planned_end_at,
    currentPlannedEndAt: r.current_planned_end_at,
    actualAvailabilityAt: r.actual_availability_at,
    driverComment: r.driver_comment,
    status: r.status,
    lastUpdatedBy: r.last_updated_by,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
  };
}

function buildPayload(driverId) {
  const user = findUser(u => u.id === driverId);
  if (!user) return null;
  const activeRest = getActiveRest(driverId);
  const status = computeDriverStatus(user, activeRest);
  return {
    ...userShape(user),
    lastDriverUpdateAt: activeRest?.updated_at || user.updated_at,
    activeRest: activeRest ? mapRest(activeRest) : null,
    displayStatus: status,
  };
}

function notifyAdmins({ type, title, body, meta = null }) {
  for (const admin of adminList()) {
    insertNotification({ user_id: admin.id, type, title, body, meta });
  }
}

function emitUpdates(io, driverId, adminUserId = null) {
  const payload = buildPayload(driverId);
  io?.emit('drivers:updated', { driverId, payload });
  io?.to('admin').emit('admin:dashboard', {});
  io?.emit('notifications:updated', { userId: driverId });
  if (adminUserId) io?.emit('notifications:updated', { userId: adminUserId });
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

function confirmationMessage(plannedEndUtc) {
  return `Информация сохранена. Ваш планируемый выход: ${formatForDisplay(plannedEndUtc)}.`;
}

function adminStats(drivers) {
  const active = drivers.filter(d => d.role === 'driver' && d.isActive);
  return {
    totalDrivers: active.length,
    restingNow: active.filter(d => d.activeRest).length,
    soonAvailable: active.filter(d => d.displayStatus.key === 'soon_available').length,
    availabilityPassed: active.filter(d => d.displayStatus.key === 'availability_passed').length,
  };
}

function sortDrivers(drivers, sortBy = 'planned_exit') {
  const priority = d => {
    const k = d.displayStatus?.key;
    if (k === 'soon_available') return 0;
    if (k === 'availability_passed') return 1;
    if (k === 'resting') return 2;
    if (k === 'working') return 3;
    return 4;
  };
  return [...drivers].sort((a, b) => {
    if (sortBy === 'last_update') {
      return new Date(b.lastDriverUpdateAt || 0) - new Date(a.lastDriverUpdateAt || 0);
    }
    const pa = priority(a), pb = priority(b);
    if (pa !== pb) return pa - pb;
    const ae = a.activeRest?.currentPlannedEndAt ? new Date(a.activeRest.currentPlannedEndAt).getTime() : Number.MAX_SAFE_INTEGER;
    const be = b.activeRest?.currentPlannedEndAt ? new Date(b.activeRest.currentPlannedEndAt).getTime() : Number.MAX_SAFE_INTEGER;
    return ae - be;
  });
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'DriverRest API (mock mode)' }));

// ─── Auth routes ──────────────────────────────────────────────────────────────
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(6) });

app.post('/api/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Неверные данные для входа' });
  const { email, password } = parsed.data;
  const user = findUser(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user || !user.is_active) return res.status(401).json({ error: 'Неверный email или пароль' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });
  req.session.userId = user.id;
  req.session.role = user.role;
  res.json({ user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email, phone: user.phone, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Не удалось завершить сессию' });
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', attachUser, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Не авторизован' });
  res.json({ user: { id: req.user.id, firstName: req.user.first_name, lastName: req.user.last_name, email: req.user.email, phone: req.user.phone, role: req.user.role } });
});

// ─── Driver routes ────────────────────────────────────────────────────────────
const driverMw = [requireAuth, attachUser, requireRole('driver')];

app.get('/api/driver/me', ...driverMw, (req, res) => {
  res.json(buildPayload(req.user.id));
});

app.get('/api/driver/me/history', ...driverMw, (req, res) => {
  res.json(getHistory(req.user.id).map(mapRest));
});

const startRestSchema = z.object({
  startedAt: z.string(),
  restType: z.enum(['daily', 'weekly_reduced_24h', 'weekly_full_45h', 'custom']),
  durationMinutes: z.number().int().positive().max(60 * 24 * 14),
  plannedEndAt: z.string().optional(),
  city: z.string().max(100).optional(),
  comment: z.string().max(500).optional(),
});

function durationForType(restType) {
  if (restType === 'daily') return 11 * 60;
  if (restType === 'weekly_reduced_24h') return 24 * 60;
  if (restType === 'weekly_full_45h') return 45 * 60;
  return null;
}

app.post('/api/driver/me/rest/start', ...driverMw, (req, res) => {
  const parsed = startRestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Проверьте данные формы отдыха' });
  const data = parsed.data;
  if (getActiveRest(req.user.id)) return res.status(409).json({ error: 'У вас уже есть активный период отдыха' });
  const startedAt = parseInputDateTime(data.startedAt);
  if (!startedAt) return res.status(400).json({ error: 'Некорректное время начала' });
  let durationMinutes = data.durationMinutes;
  const preset = durationForType(data.restType);
  if (preset) durationMinutes = preset;
  const plannedEnd = data.plannedEndAt ? parseInputDateTime(data.plannedEndAt) : addDuration(startedAt, durationMinutes);
  if (!plannedEnd) return res.status(400).json({ error: 'Некорректное время окончания' });
  const rest = insertRest({
    driver_id: req.user.id, rest_type: data.restType,
    started_at: toIso(startedAt), planned_duration_minutes: durationMinutes,
    initial_planned_end_at: toIso(plannedEnd), current_planned_end_at: toIso(plannedEnd),
    actual_availability_at: null, city: data.city || null,
    driver_comment: data.comment || null,
    status: 'active', last_updated_by: 'driver',
  });
  insertAudit({ actor_user_id: req.user.id, target_driver_id: req.user.id, action: 'rest_started', old_value: null, new_value: { restPeriodId: rest.id, restType: data.restType } });
  notifyAdmins({ type: 'driver_rest_started', title: 'Водитель начал отдых', body: `${req.user.first_name} ${req.user.last_name} начал отдых (${restTypeLabel(data.restType)}).`, meta: { driverId: req.user.id, restPeriodId: rest.id } });
  insertNotification({ user_id: req.user.id, type: 'rest_saved', title: 'Отдых сохранён', body: confirmationMessage(rest.current_planned_end_at), meta: { restPeriodId: rest.id } });
  emitUpdates(io, req.user.id);
  res.status(201).json({ message: confirmationMessage(rest.current_planned_end_at), rest: mapRest(rest) });
});

app.patch('/api/driver/me/rest/planned-end', ...driverMw, (req, res) => {
  const parsed = z.object({ plannedEndAt: z.string(), comment: z.string().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Некорректные данные' });
  const active = getActiveRest(req.user.id);
  if (!active) return res.status(404).json({ error: 'Активный отдых не найден' });
  const newEnd = parseInputDateTime(parsed.data.plannedEndAt);
  if (!newEnd) return res.status(400).json({ error: 'Некорректное время окончания' });
  const updated = updateRest(active.id, { current_planned_end_at: toIso(newEnd), driver_comment: parsed.data.comment ?? active.driver_comment, last_updated_by: 'driver' });
  insertAudit({ actor_user_id: req.user.id, target_driver_id: req.user.id, action: 'planned_end_updated', old_value: { currentPlannedEndAt: active.current_planned_end_at }, new_value: { currentPlannedEndAt: toIso(newEnd) } });
  notifyAdmins({ type: 'driver_planned_end_changed', title: 'Изменено время доступности', body: `${req.user.first_name} ${req.user.last_name} изменил планируемое время выхода.`, meta: { driverId: req.user.id, restPeriodId: active.id } });
  emitUpdates(io, req.user.id);
  res.json({ rest: mapRest(updated) });
});

app.post('/api/driver/me/rest/confirm-available', ...driverMw, (req, res) => {
  const active = getActiveRest(req.user.id);
  if (!active) return res.status(404).json({ error: 'Активный отдых не найден' });
  const updated = updateRest(active.id, { status: 'completed', actual_availability_at: new Date().toISOString(), last_updated_by: 'driver' });
  updateUser(req.user.id, {});
  insertAudit({ actor_user_id: req.user.id, target_driver_id: req.user.id, action: 'availability_confirmed', old_value: null, new_value: { restPeriodId: active.id } });
  emitUpdates(io, req.user.id);
  res.json({ rest: mapRest(updated) });
});

app.post('/api/driver/me/rest/continue', ...driverMw, (req, res) => {
  const parsed = z.object({ plannedEndAt: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Укажите новое время доступности' });
  const active = getActiveRest(req.user.id);
  if (!active) return res.status(404).json({ error: 'Активный отдых не найден' });
  const newEnd = parseInputDateTime(parsed.data.plannedEndAt);
  if (!newEnd) return res.status(400).json({ error: 'Некорректное время' });
  const updated = updateRest(active.id, { current_planned_end_at: toIso(newEnd), last_updated_by: 'driver' });
  notifyAdmins({ type: 'driver_not_ready', title: 'Водитель продолжает отдых', body: `${req.user.first_name} ${req.user.last_name} сообщил, что не готов к работе.`, meta: { driverId: req.user.id } });
  emitUpdates(io, req.user.id);
  res.json({ rest: mapRest(updated) });
});

app.post('/api/driver/me/rest/end-early', ...driverMw, (req, res) => {
  const active = getActiveRest(req.user.id);
  if (!active) return res.status(404).json({ error: 'Активный отдых не найден' });
  const updated = updateRest(active.id, { status: 'completed', actual_availability_at: new Date().toISOString(), last_updated_by: 'driver' });
  emitUpdates(io, req.user.id);
  res.json({ rest: mapRest(updated) });
});

// ─── Admin routes ─────────────────────────────────────────────────────────────
const adminMw = [requireAuth, attachUser, requireRole('administrator')];

app.get('/api/admin/dashboard', ...adminMw, (req, res) => {
  const sortBy = req.query.sortBy === 'last_update' ? 'last_update' : 'planned_exit';
  const statusFilter = req.query.status || 'all';
  const search = (req.query.search || '').trim().toLowerCase();
  let drivers = findUsers(u => u.role === 'driver').map(u => buildPayload(u.id));
  if (search) drivers = drivers.filter(d => `${d.firstName} ${d.lastName}`.toLowerCase().includes(search));
  if (statusFilter !== 'all') drivers = drivers.filter(d => d.displayStatus.key === statusFilter);
  drivers = sortDrivers(drivers, sortBy);
  res.json({ stats: adminStats(findUsers(u => u.role === 'driver').map(u => buildPayload(u.id))), drivers });
});

app.get('/api/admin/drivers/:id', ...adminMw, (req, res) => {
  const driverId = Number(req.params.id);
  const payload = buildPayload(driverId);
  if (!payload || payload.role !== 'driver') return res.status(404).json({ error: 'Водитель не найден' });
  res.json({
    driver: payload,
    history: getHistory(driverId).map(mapRest),
    auditLogs: getAuditForDriver(driverId),
  });
});

const createDriverSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().max(50).optional(),
});

app.post('/api/admin/drivers', ...adminMw, async (req, res) => {
  const parsed = createDriverSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Проверьте данные водителя' });
  const { firstName, lastName, email, password, phone } = parsed.data;
  if (findUser(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'Email уже используется' });
  }
  const hash = await bcrypt.hash(password, 12);
  const driver = insertUser({ first_name: firstName, last_name: lastName, email: email.toLowerCase(), password_hash: hash, phone: phone || null, role: 'driver', is_active: true });
  insertAudit({ actor_user_id: req.user.id, target_driver_id: driver.id, action: 'driver_created', old_value: null, new_value: { email } });
  res.status(201).json({ driver });
});

app.patch('/api/admin/drivers/:id', ...adminMw, (req, res) => {
  const driverId = Number(req.params.id);
  const parsed = z.object({ firstName: z.string().min(1).max(100).optional(), lastName: z.string().min(1).max(100).optional(), phone: z.string().max(50).optional(), isActive: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Некорректные данные' });
  const existing = findUser(u => u.id === driverId && u.role === 'driver');
  if (!existing) return res.status(404).json({ error: 'Водитель не найден' });
  const d = parsed.data;
  const updated = updateUser(driverId, {
    first_name: d.firstName ?? existing.first_name,
    last_name: d.lastName ?? existing.last_name,
    phone: d.phone ?? existing.phone,
    is_active: d.isActive ?? existing.is_active,
  });
  insertAudit({ actor_user_id: req.user.id, target_driver_id: driverId, action: 'driver_updated', old_value: existing, new_value: updated });
  if (d.isActive === false) {
    insertNotification({ user_id: driverId, type: 'account_deactivated', title: 'Аккаунт деактивирован', body: 'Администратор деактивировал ваш аккаунт.', meta: null });
  }
  emitUpdates(io, driverId, req.user.id);
  res.json({ driver: buildPayload(driverId) });
});

app.patch('/api/admin/drivers/:id/rest', ...adminMw, (req, res) => {
  const driverId = Number(req.params.id);
  const parsed = z.object({ plannedEndAt: z.string().optional(), manualStatus: z.enum(['working', 'resting']).optional(), comment: z.string().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Некорректные данные' });
  const active = getActiveRest(driverId);
  if (parsed.data.manualStatus === 'working') {
    if (active) updateRest(active.id, { status: 'completed', actual_availability_at: new Date().toISOString(), last_updated_by: 'administrator' });
    insertAudit({ actor_user_id: req.user.id, target_driver_id: driverId, action: 'admin_set_working', old_value: null, new_value: { restPeriodId: active?.id || null } });
  } else if (parsed.data.manualStatus === 'resting' && !active) {
    return res.status(400).json({ error: 'Нет активного отдыха для изменения статуса' });
  }
  if (parsed.data.plannedEndAt && active) {
    const newEnd = parseInputDateTime(parsed.data.plannedEndAt);
    if (!newEnd) return res.status(400).json({ error: 'Некорректное время' });
    updateRest(active.id, { current_planned_end_at: toIso(newEnd), driver_comment: parsed.data.comment ?? active.driver_comment, last_updated_by: 'administrator' });
    insertAudit({ actor_user_id: req.user.id, target_driver_id: driverId, action: 'admin_planned_end_updated', old_value: null, new_value: { currentPlannedEndAt: toIso(newEnd) } });
  }
  insertNotification({ user_id: driverId, type: 'admin_updated_driver', title: 'Данные обновлены администратором', body: 'Администратор изменил информацию о вашем отдыхе или статусе.', meta: null });
  emitUpdates(io, driverId, req.user.id);
  res.json({ driver: buildPayload(driverId) });
});

app.get('/api/admin/audit', ...adminMw, (_req, res) => {
  res.json(getAllAudit());
});

// ─── Notifications routes ─────────────────────────────────────────────────────
const notifMw = [requireAuth, attachUser];

app.get('/api/notifications', ...notifMw, (req, res) => {
  res.json(listNotifications(req.user.id));
});

app.post('/api/notifications/read', ...notifMw, (req, res) => {
  const parsed = z.object({ ids: z.array(z.number().int()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Некорректные данные' });
  markRead(req.user.id, parsed.data.ids);
  res.json({ ok: true });
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  socket.on('join', ({ room }) => {
    if (room === 'admin') socket.join('admin');
  });
});

// ─── Notification scheduler (in-memory version) ───────────────────────────────
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

import { db } from './mock-db.js';

setInterval(() => {
  try {
    const activeRests = db.rest_periods.filter(r => r.status === 'active');
    for (const rest of activeRests) {
      const until = msUntil(rest.current_planned_end_at);
      const driver = db.users.find(u => u.id === rest.driver_id);
      if (!driver) continue;
      const driverName = `${driver.first_name} ${driver.last_name}`;

      // 2-hour notification
      if (until > 0 && until <= TWO_HOURS_MS) {
        const exists = db.notifications.some(n => n.type === 'rest_two_hours' && n.meta?.restPeriodId === rest.id);
        if (!exists) {
          notifyAdmins({ type: 'rest_two_hours', title: 'До выхода водителя 2 часа', body: `${driverName} выйдет примерно через 2 часа.`, meta: { driverId: rest.driver_id, restPeriodId: rest.id } });
          insertNotification({ user_id: rest.driver_id, type: 'rest_two_hours', title: 'Скоро планируемый выход', body: 'До вашего планируемого времени доступности осталось около 2 часов.', meta: { restPeriodId: rest.id } });
          io?.emit('notifications:updated', { userId: rest.driver_id });
        }
      }

      // Availability passed notification
      if (isPast(rest.current_planned_end_at)) {
        const exists = db.notifications.some(n => n.type === 'availability_time_reached' && n.meta?.restPeriodId === rest.id);
        if (!exists) {
          notifyAdmins({ type: 'availability_time_reached', title: 'Время доступности наступило', body: `${driverName}: запланированное время доступности наступило.`, meta: { driverId: rest.driver_id, restPeriodId: rest.id } });
          insertNotification({ user_id: rest.driver_id, type: 'availability_time_reached', title: 'Запланированное время наступило', body: 'Ваше запланированное время доступности наступило. Подтвердите готовность в приложении.', meta: { restPeriodId: rest.id } });
          io?.emit('drivers:updated', { driverId: rest.driver_id });
        }
      }
    }
  } catch (err) {
    console.error('Mock scheduler error:', err);
  }
}, 60 * 1000);


// ─── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 DriverRest API (MOCK MODE) listening on port ${PORT}`);
  console.log(`\n📋 Test accounts:`);
  console.log(`   Admin:   admin@driverrest.local  /  Admin123!`);
  console.log(`   Driver1: ivan@driver.local       /  Driver123!`);
  console.log(`   Driver2: oleg@driver.local       /  Driver123!`);
  console.log(`   Driver3: petro@driver.local      /  Driver123!\n`);
});
