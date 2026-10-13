import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { connectDb } from './db.js';
import authRoutes from './routes/auth.js';
import driverRoutes from './routes/driver.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import { startNotificationScheduler } from './jobs/notificationScheduler.js';

const app = express();
const server = http.createServer(app);

if (config.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

const io = new Server(server, {
  cors: {
    origin: config.clientOrigin,
    credentials: true,
  },
});

app.set('io', io);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: config.clientOrigin,
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

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

await connectDb();
startNotificationScheduler(io);

server.listen(config.port, () => {
  console.log(`DriverRest API listening on port ${config.port}`);
});
