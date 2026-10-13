/**
 * One-time CLI: create first admin in MongoDB when none exist (same as production startup).
 * Usage on Render Shell: node src/bootstrap-admin.js
 */
import { connectDb, disconnectDb } from './db.js';
import { bootstrapFirstAdminIfNeeded } from './services/bootstrapAdmin.js';

await connectDb();
try {
  const result = await bootstrapFirstAdminIfNeeded();
  console.log(result);
} finally {
  await disconnectDb();
}
