import mongoose from 'mongoose';
import { config } from '../config';
import { logger } from '../utils/logger';

export const connectDB = async (): Promise<void> => {
  try {
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      retryWrites: true,
    });
    logger.info('MongoDB connected successfully');
  } catch (error) {
    logger.error('MongoDB connection failed:', error);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected. Attempting reconnect...');
});
