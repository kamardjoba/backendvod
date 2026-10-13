import bcrypt from 'bcrypt';
import { config } from '../config.js';
import { User } from '../models/index.js';

/**
 * One-time: if the database has no administrator yet, create the first one
 * from ADMIN_EMAIL / ADMIN_PASSWORD (Render env). After that, only login + role check.
 */
export async function bootstrapFirstAdminIfNeeded() {
  const adminCount = await User.countDocuments({ role: 'administrator' });
  if (adminCount > 0) {
    console.log('[bootstrap] administrators in database:', adminCount, '— skip (use login)');
    return { bootstrapped: false, reason: 'already_has_admin' };
  }

  const adminEmail = config.admin.email.toLowerCase();
  const hash = await bcrypt.hash(config.admin.password, 12);

  await User.create({
    first_name: config.admin.firstName,
    last_name: config.admin.lastName,
    email: adminEmail,
    password_hash: hash,
    role: 'administrator',
    is_active: true,
  });

  console.log('[bootstrap] first administrator created:', adminEmail);
  return { bootstrapped: true, email: adminEmail };
}
