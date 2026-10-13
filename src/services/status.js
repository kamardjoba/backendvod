import { isPast, msUntil, remainingMs } from '../utils/time.js';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function computeDriverStatus(user, activeRest) {
  if (!user.is_active) {
    return {
      key: 'inactive',
      label: 'Деактивований',
      color: 'gray',
    };
  }

  if (!activeRest) {
    return {
      key: 'working',
      label: 'Доступний',
      color: 'green',
    };
  }

  const endAt = activeRest.current_planned_end_at;
  const past = isPast(endAt);
  const untilMs = msUntil(endAt);

  if (past) {
    return {
      key: 'availability_passed',
      label: 'Час виходу настав',
      color: 'red',
      remainingMs: 0,
      remainingLabel: 'Час вийшов',
    };
  }

  if (untilMs <= SIX_HOURS_MS) {
    return {
      key: 'soon_available',
      label: 'Скоро доступний',
      color: 'orange',
      remainingMs: remainingMs(endAt),
      remainingLabel: formatRemainingLabel(remainingMs(endAt)),
    };
  }

  return {
    key: 'resting',
    label: 'На стоянці',
    color: 'blue',
    remainingMs: remainingMs(endAt),
    remainingLabel: formatRemainingLabel(remainingMs(endAt)),
  };
}

function formatRemainingLabel(ms) {
  if (ms <= 0) return 'Завершено по плану';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}

export function restDurationHours(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} часов`;
  return `${h} ч ${m} мин`;
}

export function shouldNotifyTwoHours(activeRest) {
  if (!activeRest || activeRest.status !== 'active') return false;
  const until = msUntil(activeRest.current_planned_end_at);
  return until > 0 && until <= TWO_HOURS_MS;
}
