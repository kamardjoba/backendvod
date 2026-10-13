import { connectDb, disconnectDb } from './db.js';
import { AuditLog, Notification, RestPeriod, User } from './models/index.js';

async function migrate() {
  await connectDb();
  await Promise.all([
    User.syncIndexes(),
    RestPeriod.syncIndexes(),
    AuditLog.syncIndexes(),
    Notification.syncIndexes(),
  ]);
  console.log('MongoDB indexes synced successfully.');
  await disconnectDb();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
