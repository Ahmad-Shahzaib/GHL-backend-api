import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  // GoHighLevel OAuth
  GHL_CLIENT_ID:     z.string().min(1, 'GHL_CLIENT_ID is required'),
  GHL_CLIENT_SECRET: z.string().min(1, 'GHL_CLIENT_SECRET is required'),
  GHL_REDIRECT_URI:  z.string().url('GHL_REDIRECT_URI must be a valid URL'),
  GHL_BASE_URL:      z.string().url().default('https://services.leadconnectorhq.com'),

  // GHL Admin API Key
  GHL_ADMIN_API_KEY: z.string().optional(),

  // Server
  PORT:     z.string().transform(Number).default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // JWT
  JWT_SECRET:     z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Encryption
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS:   z.string().transform(Number).default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),

  // MongoDB
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  // Stripe (optional)
  STRIPE_SECRET_KEY:  z.string().optional(),
  STRIPE_PRICE_BASIC: z.string().optional(),
  STRIPE_PRICE_PRO:   z.string().optional(),
  STRIPE_PRICE_AGENCY: z.string().optional(),
  STRIPE_SUCCESS_URL: z.string().url().optional(),
  STRIPE_CANCEL_URL:  z.string().url().optional(),

  // Email
  SMTP_HOST:  z.string().min(1),
  SMTP_PORT:  z.string().transform(Number).default('587'),
  SMTP_USER:  z.string().email(),
  SMTP_PASS:  z.string().min(1),
  EMAIL_FROM: z.string().min(1),

  // Frontend
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

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

export const config = (() => {
  const parsed = parseEnv();
  return {
    ...parsed,
    STRIPE_SUCCESS_URL:
      parsed.STRIPE_SUCCESS_URL ||
      `${parsed.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    STRIPE_CANCEL_URL:
      parsed.STRIPE_CANCEL_URL ||
      `${parsed.FRONTEND_URL}/register?canceled=true`,
  };
})();

export const isDevelopment = config.NODE_ENV === 'development';
export const isProduction  = config.NODE_ENV === 'production';

export const GHL_OAUTH_URLS = {
  token:     `${config.GHL_BASE_URL}/oauth/token`,
  authorize: 'https://marketplace.leadconnectorhq.com/oauth/chooselocation',
} as const;

export const GHL_API_ENDPOINTS = {
  contacts:            '/contacts/',
  contactById:         (id: string) => `/contacts/${id}`,
  contactAppointments: (id: string) => `/contacts/${id}/appointments`,
  opportunities:       '/opportunities/search',
  opportunityById:     (id: string) => `/opportunities/${id}`,
  pipelines:           '/opportunities/pipelines',
  users:               '/users/',
  userById:            (id: string) => `/users/${id}`,
  locations:           '/locations/',
  locationById:        (id: string) => `/locations/${id}`,
  calendars:           '/calendars/',
  calendarById:        (id: string) => `/calendars/${id}`,
  appointments:        '/calendars/events/appointments',
  appointmentById:     (id: string) => `/calendars/events/appointments/${id}`,
  resources:           '/calendars/resources',
  resourceById:        (id: string) => `/calendars/resources/${id}`,
  search:              '/locations/search',
} as const;

export const GHL_API_VERSION = '2021-07-28';