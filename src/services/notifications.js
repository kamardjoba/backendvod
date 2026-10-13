import { Notification, User, notificationToRow } from '../models/index.js';

export async function createNotification({ userId, type, title, body, meta = null }) {
  const doc = await Notification.create({
    user_id: userId,
    type,
    title,
    body,
    meta,
  });
  return notificationToRow(doc);
}

export async function notifyAdministrators({ type, title, body, meta = null }) {
  const admins = await User.find({ role: 'administrator', is_active: true }).select('_id');
  const created = [];
  for (const admin of admins) {
    const n = await createNotification({
      userId: admin._id.toString(),
      type,
      title,
      body,
      meta,
    });
    created.push(n);
  }
  return created;
}

export async function listNotifications(userId, limit = 50) {
  const docs = await Notification.find({ user_id: userId })
    .sort({ created_at: -1 })
    .limit(limit);
  return docs.map(notificationToRow);
}

export async function markNotificationsRead(userId, ids) {
  if (!ids?.length) return;
  await Notification.updateMany(
    { user_id: userId, _id: { $in: ids } },
    { $set: { is_read: true } }
  );
}

export async function notificationExists(type, restPeriodId) {
  const doc = await Notification.findOne({
    type,
    'meta.restPeriodId': String(restPeriodId),
  }).select('_id');
  return Boolean(doc);
}
