import { DateTime } from 'luxon';
import { config } from '../config.js';

export function getTimezone() {
  return config.defaultTimezone;
}

function asIsoUtc(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function nowUtc() {
  return DateTime.utc();
}

export function parseInputDateTime(value, timezone = getTimezone()) {
  if (!value) return null;
  const dt = DateTime.fromISO(value, { zone: timezone });
  if (!dt.isValid) return null;
  return dt.toUTC();
}

export function addDuration(startUtc, minutes) {
  return startUtc.plus({ minutes });
}

export function formatForDisplay(isoUtc, timezone = getTimezone(), locale = 'ru') {
  const iso = asIsoUtc(isoUtc);
  if (!iso) return '—';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone).setLocale(locale);
  return dt.toFormat('d LLLL, HH:mm');
}

export function formatShort(isoUtc, timezone = getTimezone()) {
  const iso = asIsoUtc(isoUtc);
  if (!iso) return '—';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone);
  return dt.toFormat('dd.MM, HH:mm');
}

export function remainingMs(endUtcIso) {
  const end = DateTime.fromISO(asIsoUtc(endUtcIso), { zone: 'utc' });
  const diff = end.diff(nowUtc()).as('milliseconds');
  return Math.max(0, diff);
}

export function isPast(isoUtc) {
  const end = DateTime.fromISO(asIsoUtc(isoUtc), { zone: 'utc' });
  return end <= nowUtc();
}

export function msUntil(isoUtc) {
  const end = DateTime.fromISO(asIsoUtc(isoUtc), { zone: 'utc' });
  return end.diff(nowUtc()).as('milliseconds');
}

export function formatRemaining(ms) {
  if (ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}

export function toIso(dt) {
  return dt.toUTC().toISO();
}
