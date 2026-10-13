import mongoose from 'mongoose';
import { config } from './config.js';

export async function connectDb() {
  if (!config.mongodbUri) {
    throw new Error('MONGODB_URI is not set');
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongodbUri);
  console.log('Connected to MongoDB');
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
