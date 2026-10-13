import { RestPeriod, User, restToRow, userToRow } from '../models/index.js';
import { computeDriverStatus, restDurationHours } from './status.js';
import { formatForDisplay } from '../utils/time.js';

export async function getActiveRestPeriod(driverId) {
  const doc = await RestPeriod.findOne({ driver_id: driverId, status: 'active' })
    .sort({ started_at: -1 });
  return restToRow(doc);
}

export async function getRestHistory(driverId, limit = 100) {
  const docs = await RestPeriod.find({ driver_id: driverId })
    .sort({ started_at: -1 })
    .limit(limit);
  return docs.map(restToRow);
}

export function enrichDriverRow(user, activeRest) {
  const status = computeDriverStatus(user, activeRest);
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isActive: user.is_active,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastDriverUpdateAt: activeRest?.updated_at || user.updated_at,
    activeRest: activeRest
      ? {
          id: activeRest.id,
          restType: activeRest.rest_type,
          city: activeRest.city || null,
          startedAt: activeRest.started_at,
          plannedDurationMinutes: activeRest.planned_duration_minutes,
          plannedDurationLabel: restDurationHours(activeRest.planned_duration_minutes),
          initialPlannedEndAt: activeRest.initial_planned_end_at,
          currentPlannedEndAt: activeRest.current_planned_end_at,
          actualAvailabilityAt: activeRest.actual_availability_at,
          driverComment: activeRest.driver_comment,
          status: activeRest.status,
          lastUpdatedBy: activeRest.last_updated_by,
          updatedAt: activeRest.updated_at,
        }
      : null,
    displayStatus: status,
  };
}

export async function buildDriverPayload(driverId) {
  const doc = await User.findById(driverId);
  const user = userToRow(doc);
  if (!user) return null;
  const activeRest = await getActiveRestPeriod(driverId);
  return enrichDriverRow(user, activeRest);
}

export function sortDriversForAdmin(drivers, sortBy = 'planned_exit') {
  const priority = (d) => {
    const key = d.displayStatus?.key;
    if (key === 'soon_available') return 0;
    if (key === 'availability_passed') return 1;
    if (key === 'resting') return 2;
    if (key === 'working') return 3;
    return 4;
  };

  const copy = [...drivers];
  copy.sort((a, b) => {
    if (sortBy === 'last_update') {
      const au = new Date(a.lastDriverUpdateAt || 0).getTime();
      const bu = new Date(b.lastDriverUpdateAt || 0).getTime();
      return bu - au;
    }
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    const ae = a.activeRest?.currentPlannedEndAt
      ? new Date(a.activeRest.currentPlannedEndAt).getTime()
      : Number.MAX_SAFE_INTEGER;
    const be = b.activeRest?.currentPlannedEndAt
      ? new Date(b.activeRest.currentPlannedEndAt).getTime()
      : Number.MAX_SAFE_INTEGER;
    return ae - be;
  });
  return copy;
}

export function adminStats(drivers) {
  const activeDrivers = drivers.filter((d) => d.role === 'driver' && d.isActive);
  const withActiveRest = activeDrivers.filter((d) => d.activeRest);
  return {
    totalDrivers: activeDrivers.length,
    restingNow: withActiveRest.length,
    soonAvailable: activeDrivers.filter((d) => d.displayStatus.key === 'soon_available').length,
    availabilityPassed: activeDrivers.filter((d) => d.displayStatus.key === 'availability_passed').length,
  };
}

export function confirmationMessage(plannedEndUtc) {
  return `Информация сохранена. Ваш планируемый выход: ${formatForDisplay(plannedEndUtc)}.`;
}

export function mapRestPeriodForHistory(row) {
  return {
    id: row.id,
    restType: row.rest_type,
    city: row.city || null,
    startedAt: row.started_at,
    plannedDurationMinutes: row.planned_duration_minutes,
    initialPlannedEndAt: row.initial_planned_end_at,
    currentPlannedEndAt: row.current_planned_end_at,
    actualAvailabilityAt: row.actual_availability_at,
    driverComment: row.driver_comment,
    status: row.status,
    lastUpdatedBy: row.last_updated_by,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}
