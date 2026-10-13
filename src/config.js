import dotenv from 'dotenv';

dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3001),
  mongodbUri: process.env.MONGODB_URI,
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Europe/Warsaw',
  seedDev: process.env.SEED_DEV === 'true',
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@driverrest.local',
    password: process.env.ADMIN_PASSWORD || 'Admin123!',
    firstName: process.env.ADMIN_FIRST_NAME || 'Главный',
    lastName: process.env.ADMIN_LAST_NAME || 'Администратор',
  },
};

if (!config.mongodbUri) {
  console.warn('[config] MONGODB_URI is not set — connectDb will fail at step 1.');
}
