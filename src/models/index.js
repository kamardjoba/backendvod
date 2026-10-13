import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    first_name: { type: String, required: true, maxlength: 100 },
    last_name: { type: String, required: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, maxlength: 255 },
    password_hash: { type: String, required: true },
    phone: { type: String, maxlength: 50, default: null },
    role: { type: String, enum: ['administrator', 'driver'], required: true },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const restPeriodSchema = new mongoose.Schema(
  {
    driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rest_type: { type: String, required: true },
    started_at: { type: Date, required: true },
    planned_duration_minutes: { type: Number, required: true },
    initial_planned_end_at: { type: Date, required: true },
    current_planned_end_at: { type: Date, required: true, index: true },
    actual_availability_at: { type: Date, default: null },
    city: { type: String, maxlength: 100, default: null },
    driver_comment: { type: String, default: null },
    status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active', index: true },
    last_updated_by: { type: String, enum: ['driver', 'administrator'], default: 'driver' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const auditLogSchema = new mongoose.Schema(
  {
    actor_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    target_driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    action: { type: String, required: true },
    old_value: { type: mongoose.Schema.Types.Mixed, default: null },
    new_value: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

const notificationSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
    is_read: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const RestPeriod = mongoose.models.RestPeriod || mongoose.model('RestPeriod', restPeriodSchema);
export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
export const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

export function userToRow(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: o._id.toString(),
    first_name: o.first_name,
    last_name: o.last_name,
    email: o.email,
    password_hash: o.password_hash,
    phone: o.phone,
    role: o.role,
    is_active: o.is_active,
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
}

export function restToRow(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: o._id.toString(),
    driver_id: o.driver_id.toString(),
    rest_type: o.rest_type,
    started_at: o.started_at,
    planned_duration_minutes: o.planned_duration_minutes,
    initial_planned_end_at: o.initial_planned_end_at,
    current_planned_end_at: o.current_planned_end_at,
    actual_availability_at: o.actual_availability_at,
    city: o.city,
    driver_comment: o.driver_comment,
    status: o.status,
    last_updated_by: o.last_updated_by,
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
}

export function notificationToRow(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: o._id.toString(),
    user_id: o.user_id.toString(),
    type: o.type,
    title: o.title,
    body: o.body,
    meta: o.meta,
    is_read: o.is_read,
    created_at: o.created_at,
  };
}
