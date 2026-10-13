import bcrypt from 'bcrypt';
import { connectDb, disconnectDb } from './db.js';
import { config } from './config.js';
import { User } from './models/index.js';

async function seed() {
  if (!config.seedDev && config.nodeEnv === 'production') {
    console.log('SEED_DEV disabled.');
    return;
  }

  const adminEmail = config.admin.email.toLowerCase();
  const existing = await User.findOne({ email: adminEmail });
  if (!existing) {
    const hash = await bcrypt.hash(config.admin.password, 12);
    await User.create({
      first_name: config.admin.firstName,
      last_name: config.admin.lastName,
      email: adminEmail,
      password_hash: hash,
      role: 'administrator',
      is_active: true,
    });
    console.log(`Admin created: ${adminEmail}`);
  } else {
    console.log('Admin already exists.');
  }
}

await connectDb();
seed()
  .then(() => disconnectDb())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
