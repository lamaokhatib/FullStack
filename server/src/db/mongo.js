// server/src/db/mongo.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env (root first, then server/src/.env)
dotenv.config();
if (!process.env.MONGODB_URI) {
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
}

export async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log('MongoDB connected');

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected');
  });
}