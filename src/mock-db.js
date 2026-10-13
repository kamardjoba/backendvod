/**
 * mock-db.js — In-memory database replacement for local testing (no PostgreSQL needed).
 * Pre-seeds with one admin and three drivers plus some sample rest periods.
 */
import bcrypt from 'bcrypt';
import { DateTime } from 'luxon';

// ─── Tables ───────────────────────────────────────────────────────────────────
export const db = {
  users: [],
  rest_periods: [],
  audit_logs: [],
  notifications: [],
};

let _seq = { users: 0, rest_periods: 0, audit_logs: 0, notifications: 0 };
function nextId(table) { return ++_seq[table]; }

// ─── Seed ─────────────────────────────────────────────────────────────────────
async function seed() {
  const now = () => new Date().toISOString();
  const adminHash = await bcrypt.hash('Admin123!', 12);
  const dHash = await bcrypt.hash('Driver123!', 12);

  db.users.push(
    {
      id: nextId('users'),
      first_name: 'Главный',
      last_name: 'Администратор',
      email: 'admin@driverrest.local',
      password_hash: adminHash,
      phone: '+380 50 000 00 00',
      role: 'administrator',
      is_active: true,
      created_at: now(),
      updated_at: now(),
    },
    {
      id: nextId('users'),
      first_name: 'Іван',
      last_name: 'Коваленко',
      email: 'ivan@driver.local',
      password_hash: dHash,
      phone: '+380 67 111 22 33',
      role: 'driver',
      is_active: true,
      created_at: now(),
      updated_at: now(),
    },
    {
      id: nextId('users'),
      first_name: 'Олег',
      last_name: 'Бондаренко',
      email: 'oleg@driver.local',
      password_hash: dHash,
      phone: '+380 66 444 55 66',
      role: 'driver',
      is_active: true,
      created_at: now(),
      updated_at: now(),
    },
    {
      id: nextId('users'),
      first_name: 'Петро',
      last_name: 'Мельник',
      email: 'petro@driver.local',
      password_hash: dHash,
      phone: '+380 63 777 88 99',
      role: 'driver',
      is_active: true,
      created_at: now(),
      updated_at: now(),
    },
  );

  // Ivan is currently resting (planned end = 5 hours from now)
  const ivan = db.users[1];
  const startedAt = DateTime.utc().minus({ hours: 6 }).toISO();
  const plannedEnd = DateTime.utc().plus({ hours: 5 }).toISO();
  db.rest_periods.push({
    id: nextId('rest_periods'),
    driver_id: ivan.id,
    rest_type: 'daily',
    started_at: startedAt,
    planned_duration_minutes: 11 * 60,
    initial_planned_end_at: plannedEnd,
    current_planned_end_at: plannedEnd,
    actual_availability_at: null,
    city: 'Варшава',
    driver_comment: null,
    status: 'active',
    last_updated_by: 'driver',
    created_at: startedAt,
    updated_at: startedAt,
  });

  // Oleg's rest ended 30 min ago (availability_passed)
  const oleg = db.users[2];
  const olegStart = DateTime.utc().minus({ hours: 12 }).toISO();
  const olegEnd = DateTime.utc().minus({ minutes: 30 }).toISO();
  db.rest_periods.push({
    id: nextId('rest_periods'),
    driver_id: oleg.id,
    rest_type: 'weekly_full_45h',
    started_at: olegStart,
    planned_duration_minutes: 45 * 60,
    initial_planned_end_at: olegEnd,
    current_planned_end_at: olegEnd,
    actual_availability_at: null,
    city: 'Берлін',
    driver_comment: null,
    status: 'active',
    last_updated_by: 'driver',
    created_at: olegStart,
    updated_at: olegStart,
  });

  // Historical rest for Ivan
  const pastEnd = DateTime.utc().minus({ days: 2 }).toISO();
  const pastStart = DateTime.utc().minus({ days: 2, hours: 11 }).toISO();
  db.rest_periods.push({
    id: nextId('rest_periods'),
    driver_id: ivan.id,
    rest_type: 'daily',
    started_at: pastStart,
    planned_duration_minutes: 11 * 60,
    initial_planned_end_at: pastEnd,
    current_planned_end_at: pastEnd,
    actual_availability_at: pastEnd,
    city: 'Варшава',
    driver_comment: null,
    status: 'completed',
    last_updated_by: 'driver',
    created_at: pastStart,
    updated_at: pastEnd,
  });
}

await seed();

// ─── Query Helpers ────────────────────────────────────────────────────────────
export function findUser(predicate) { return db.users.find(predicate) || null; }
export function findUsers(predicate) { return db.users.filter(predicate); }

export function insertUser(data) {
  const row = { id: nextId('users'), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...data };
  db.users.push(row);
  return row;
}

export function updateUser(id, data) {
  const idx = db.users.findIndex(u => u.id === id);
  if (idx === -1) return null;
  db.users[idx] = { ...db.users[idx], ...data, updated_at: new Date().toISOString() };
  return db.users[idx];
}

export function getActiveRest(driverId) {
  return db.rest_periods
    .filter(r => r.driver_id === driverId && r.status === 'active')
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0] || null;
}

export function getHistory(driverId, limit = 100) {
  return db.rest_periods
    .filter(r => r.driver_id === driverId)
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
    .slice(0, limit);
}

export function insertRest(data) {
  const row = { id: nextId('rest_periods'), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...data };
  db.rest_periods.push(row);
  return row;
}

export function updateRest(id, data) {
  const idx = db.rest_periods.findIndex(r => r.id === id);
  if (idx === -1) return null;
  db.rest_periods[idx] = { ...db.rest_periods[idx], ...data, updated_at: new Date().toISOString() };
  return db.rest_periods[idx];
}

export function insertAudit(data) {
  const row = { id: nextId('audit_logs'), created_at: new Date().toISOString(), ...data };
  db.audit_logs.push(row);
  return row;
}

export function getAuditForDriver(driverId, limit = 100) {
  return db.audit_logs
    .filter(a => a.target_driver_id === driverId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit)
    .map(a => {
      const actor = db.users.find(u => u.id === a.actor_user_id);
      return { ...a, first_name: actor?.first_name || null, last_name: actor?.last_name || null };
    });
}

export function getAllAudit(limit = 200) {
  return db.audit_logs
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit)
    .map(a => {
      const actor = db.users.find(u => u.id === a.actor_user_id);
      return { ...a, first_name: actor?.first_name || null, last_name: actor?.last_name || null };
    });
}

export function insertNotification(data) {
  const row = { id: nextId('notifications'), is_read: false, created_at: new Date().toISOString(), ...data };
  db.notifications.push(row);
  return row;
}

export function listNotifications(userId, limit = 50) {
  return db.notifications
    .filter(n => n.user_id === userId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}

export function markRead(userId, ids) {
  db.notifications.forEach(n => {
    if (n.user_id === userId && ids.includes(n.id)) n.is_read = true;
  });
}

export function adminList() {
  return db.users.filter(u => u.role === 'administrator' && u.is_active);
}
