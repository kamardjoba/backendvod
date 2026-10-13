import { connectDb, disconnectDb } from './db.js';
import { config } from './config.js';
import { bootstrapFirstAdminIfNeeded } from './services/bootstrapAdmin.js';

async function seed() {
  if (!config.seedDev && config.nodeEnv === 'production') {
    console.log('SEED_DEV disabled.');
    return;
  }

  await bootstrapFirstAdminIfNeeded();
}

await connectDb();
seed()
  .then(() => disconnectDb())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
