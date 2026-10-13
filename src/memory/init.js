import bcrypt from 'bcrypt';
import { config } from '../config.js';
import { memoryQuery } from './query.js';
import { state } from './state.js';

export async function initMemoryStore() {
  if (state.users.length > 0) return;

  const adminEmail = config.admin.email.toLowerCase();
  const hash = await bcrypt.hash(config.admin.password, 12);
  await memoryQuery(
    `INSERT INTO users (first_name, last_name, email, password_hash, role)
     VALUES ($1,$2,$3,$4,'administrator')`,
    [config.admin.firstName, config.admin.lastName, adminEmail, hash]
  );

  const driverHash = await bcrypt.hash('Driver123!', 12);
  await memoryQuery(
    `INSERT INTO users (first_name, last_name, email, password_hash, phone, role)
     VALUES ($1,$2,$3,$4,$5,'driver')`,
    ['Иван', 'Петров', 'driver@driverrest.local', driverHash, '+48 600 000 001']
  );

  console.log('Memory store ready (данные только в RAM, после перезапуска сбросятся).');
  console.log(`Admin: ${adminEmail} / ${config.admin.password}`);
  console.log('Demo driver: driver@driverrest.local / Driver123!');
}

export { memoryQuery as query };
