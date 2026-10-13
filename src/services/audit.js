import { AuditLog } from '../models/index.js';

export async function writeAuditLog({
  actorUserId,
  targetDriverId,
  action,
  oldValue = null,
  newValue = null,
}) {
  await AuditLog.create({
    actor_user_id: actorUserId || null,
    target_driver_id: targetDriverId || null,
    action,
    old_value: oldValue,
    new_value: newValue,
  });
}
