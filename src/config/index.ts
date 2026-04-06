import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Environment variable schema validation
const envSchema = z.object({
  // GoHighLevel OAuth
  GHL_CLIENT_ID: z.string().min(1, 'GHL_CLIENT_ID is required'),
  GHL_CLIENT_SECRET: z.string().min(1, 'GHL_CLIENT_SECRET is required'),
  GHL_REDIRECT_URI: z.string().url('GHL_REDIRECT_URI must be a valid URL'),
  GHL_BASE_URL: z.string().url().default('https://services.leadconnectorhq.com'),
  
  // Server
  PORT: z.string().transform(Number).default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  
  // Encryption
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),
  
  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),
  
  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

// Parse and validate environment variables
const parseEnv = () => {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n');
      console.error('Environment validation failed:\n', issues);
      process.exit(1);
    }
    throw error;
  }
};

export const config = parseEnv();

// Derived configuration
export const isDevelopment = config.NODE_ENV === 'development';
export const isProduction = config.NODE_ENV === 'production';

// GHL OAuth endpoints
export const GHL_OAUTH_URLS = {
  token: `${config.GHL_BASE_URL}/oauth/token`,
  authorize: 'https://marketplace.leadconnectorhq.com/oauth/chooselocation',
} as const;

// GHL API endpoints
export const GHL_API_ENDPOINTS = {
  // Contacts
  contacts: '/contacts/',
  contactById: (id: string) => `/contacts/${id}`,
  
  // Opportunities
  opportunities: '/opportunities/search',
  opportunityById: (id: string) => `/opportunities/${id}`,
  pipelines: '/opportunities/pipelines',
  
  // Users
  users: '/users/',
  userById: (id: string) => `/users/${id}`,
  
  // Locations
  locations: '/locations/',
  locationById: (id: string) => `/locations/${id}`,
  
  // Calendars
  calendars: '/calendars/',
  calendarById: (id: string) => `/calendars/${id}`,
  appointments: '/calendars/events',
  
  // Search
  search: '/locations/search',
} as const;

// API Version
export const GHL_API_VERSION = '2021-07-28';
