import winston from 'winston';
import { config } from '../config';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom format for logs
// Safe stringify that handles circular references
const safeStringify = (obj: any): string => {
  const seen = new Set();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  });
};

// Custom format for logs
const customFormat = printf(({ level, message, timestamp, stack, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  
  if (Object.keys(metadata).length > 0) {
    try {
      msg += ` ${safeStringify(metadata)}`;
    } catch (e) {
      msg += ` [Unserializable metadata]`;
    }
  }
  
  if (stack) {
    msg += `\n${stack}`;
  }
  
  return msg;
});

// Create logger instance
export const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  defaultMeta: { service: 'ghl-api' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        customFormat
      ),
    }),
  ],
});

// Add file transports in production
if (config.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: combine(timestamp(), errors({ stack: true }), customFormat),
    })
  );
  
  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: combine(timestamp(), customFormat),
    })
  );
}

// Stream for Morgan HTTP logging
export const morganStream = {
  write: (message: string): void => {
    logger.info(message.trim());
  },
};
