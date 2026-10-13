import mongoose from 'mongoose';
import { config } from './config.js';

const LOG_PREFIX = '[db]';

function log(step, detail) {
  if (detail !== undefined) {
    console.log(`${LOG_PREFIX} ${step}`, detail);
  } else {
    console.log(`${LOG_PREFIX} ${step}`);
  }
}

function logError(step, err) {
  const payload = {
    name: err?.name,
    message: err?.message,
    code: err?.code,
  };
  if (err?.reason) {
    payload.reason = err.reason;
  }
  if (err?.cause) {
    payload.cause = err.cause?.message ?? err.cause;
  }
  console.error(`${LOG_PREFIX} ${step}`, payload);
  if (err?.stack) {
    console.error(`${LOG_PREFIX} stack:`, err.stack);
  }
}

/** Safe URI summary for logs (no credentials). */
export function describeMongoUri(uri) {
  if (!uri || typeof uri !== 'string') {
    return 'missing or invalid';
  }
  const srv = uri.startsWith('mongodb+srv://');
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]+@)?([^/?]+)(?:\/([^?]*))?/);
  if (!match) {
    return srv ? 'mongodb+srv (parse failed)' : 'mongodb (parse failed)';
  }
  const hosts = match[1];
  const dbName = match[2]?.trim() || '(default)';
  return `scheme=${srv ? 'mongodb+srv' : 'mongodb'}, hosts=${hosts}, database=${dbName}`;
}

let connectionEventsBound = false;

function bindConnectionEvents() {
  if (connectionEventsBound) return;
  connectionEventsBound = true;

  mongoose.connection.on('connected', () => {
    log('mongoose connection event: connected');
  });
  mongoose.connection.on('error', (err) => {
    logError('mongoose connection event: error', err);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn(`${LOG_PREFIX} mongoose connection event: disconnected`);
  });
  mongoose.connection.on('reconnected', () => {
    log('mongoose connection event: reconnected');
  });
}

export async function connectDb() {
  log('step 1/4: checking MONGODB_URI');

  if (!config.mongodbUri) {
    console.error(`${LOG_PREFIX} FAIL at step 1: MONGODB_URI is not set (env empty or missing)`);
    throw new Error('MONGODB_URI is not set');
  }

  log('step 2/4: URI present', describeMongoUri(config.mongodbUri));

  bindConnectionEvents();

  log('step 3/4: calling mongoose.connect (server selection / TCP / auth)...');
  mongoose.set('strictQuery', true);

  const startedAt = Date.now();
  try {
    await mongoose.connect(config.mongodbUri);
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    logError(`FAIL at step 3 after ${elapsedMs}ms: mongoose.connect`, err);
    throw err;
  }

  const elapsedMs = Date.now() - startedAt;
  log(`step 4/4: connected successfully in ${elapsedMs}ms`, {
    readyState: mongoose.connection.readyState,
    host: mongoose.connection.host,
    port: mongoose.connection.port,
    name: mongoose.connection.name,
  });
}

export async function disconnectDb() {
  log('disconnecting mongoose...');
  await mongoose.disconnect();
  log('mongoose disconnected');
}
