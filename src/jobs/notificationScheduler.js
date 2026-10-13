import { RestPeriod, User } from '../models/index.js';
import {
  createNotification,
  notificationExists,
  notifyAdministrators,
} from '../services/notifications.js';
import { isPast, msUntil } from '../utils/time.js';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function startNotificationScheduler(io) {
  setInterval(async () => {
    try {
      const rests = await RestPeriod.find({ status: 'active' });

      for (const rest of rests) {
        const driver = await User.findById(rest.driver_id);
        if (!driver) continue;

        const until = msUntil(rest.current_planned_end_at);
        const driverName = `${driver.first_name} ${driver.last_name}`;
        const restId = rest._id.toString();
        const driverId = rest.driver_id.toString();

        if (until > 0 && until <= TWO_HOURS_MS) {
          const exists = await notificationExists('rest_two_hours', restId);
          if (!exists) {
            await notifyAdministrators({
              type: 'rest_two_hours',
              title: 'До выхода водителя 2 часа',
              body: `${driverName} выйдет примерно через 2 часа.`,
              meta: { driverId, restPeriodId: restId },
            });
            await createNotification({
              userId: driverId,
              type: 'rest_two_hours',
              title: 'Скоро планируемый выход',
              body: 'До вашего планируемого времени доступности осталось около 2 часов.',
              meta: { restPeriodId: restId },
            });
            io?.emit('notifications:updated', { userId: driverId });
          }
        }

        if (isPast(rest.current_planned_end_at)) {
          const exists = await notificationExists('availability_time_reached', restId);
          if (!exists) {
            await notifyAdministrators({
              type: 'availability_time_reached',
              title: 'Время доступности наступило',
              body: `${driverName}: запланированное время доступности наступило.`,
              meta: { driverId, restPeriodId: restId },
            });
            await createNotification({
              userId: driverId,
              type: 'availability_time_reached',
              title: 'Запланированное время наступило',
              body: 'Ваше запланированное время доступности наступило. Подтвердите готовность в приложении.',
              meta: { restPeriodId: restId },
            });
            io?.emit('drivers:updated', { driverId });
          }
        }
      }
    } catch (err) {
      console.error('Notification scheduler error:', err);
    }
  }, 60 * 1000);
}
