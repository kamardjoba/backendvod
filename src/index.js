import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { connectDb, describeMongoUri } from './db.js';
import authRoutes from './routes/auth.js';
import driverRoutes from './routes/driver.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import { startNotificationScheduler } from './jobs/notificationScheduler.js';
import { bootstrapFirstAdminIfNeeded } from './services/bootstrapAdmin.js';

const app = express();
const server = http.createServer(app);

if (config.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return config.clientOrigins.includes(origin.replace(/\/$/, ''));
}

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) callback(null, true);
      else {
        console.warn('[socket.io cors] blocked origin:', origin);
        callback(null, false);
      }
    },
    credentials: true,
  },
});

app.set('io', io);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      console.warn('[cors] blocked origin:', origin, 'allowed:', config.clientOrigins);
      callback(null, false);
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

console.log('[startup] CLIENT_ORIGIN (allowed):', config.clientOrigins.join(', '));
console.log(
  '[startup] session store (connect-mongo):',
  config.mongodbUri
    ? describeMongoUri(config.mongodbUri)
    : 'MONGODB_URI missing — sessions will fail on first use',
);

app.use(
  session({
    store: MongoStore.create({
      mongoUrl: config.mongodbUri,
      collectionName: 'sessions',
      ttl: 7 * 24 * 60 * 60,
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'DriverRest API' });
});

app.use('/api/auth', authRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

io.use((socket, next) => {
  const cookieHeader = socket.request.headers.cookie;
  if (!cookieHeader) return next();
  next();
});

io.on('connection', (socket) => {
  socket.on('join', ({ room }) => {
    if (room === 'admin') socket.join('admin');
  });
});

console.log('[startup] connecting to MongoDB before serving traffic...');
try {
  await connectDb();
} catch (err) {
  console.error(
    '[startup] STOP: could not connect to MongoDB. Fix MONGODB_URI / network / Atlas IP allowlist.',
    err?.message ?? err,
  );
  process.exit(1);
}

if (config.nodeEnv === 'production') {
  try {
    await bootstrapFirstAdminIfNeeded();
  } catch (err) {
    console.error('[startup] STOP: could not bootstrap first administrator.', err?.message ?? err);
    process.exit(1);
  }
}

startNotificationScheduler(io);

server.listen(config.port, () => {
  console.log(`[startup] DriverRest API listening on port ${config.port}`);
});
