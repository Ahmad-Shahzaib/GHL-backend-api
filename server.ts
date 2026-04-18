import express, { Application } from 'express';
import morgan from 'morgan';
import { config } from './src/config';
import { logger, morganStream } from './src/utils/logger';
import {
  helmetMiddleware,
  corsMiddleware,
  rateLimiter,
  sanitizeRequest,
} from './src/middleware/security';
import { errorHandler, notFoundHandler } from './src/middleware/errorHandler';
import apiRoutes from './src/routes';
import { connectDB } from './src/db/connection';
import { ghlClient } from './src/services/ghlClient';
import { pollingService } from './src/services/pollingService';

// Initialize Express app
const app: Application = express();
app.set('trust proxy', 1);

// Security middleware
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(rateLimiter);

// Body parsing middleware
const rawBodySaver = (req: any, _res: any, buf: Buffer) => {
  if (buf && buf.length) {
    req.rawBody = buf;
  }
};
app.use(express.json({ limit: '10mb', verify: rawBodySaver }));
app.use(express.urlencoded({ extended: true, limit: '10mb', verify: rawBodySaver }));

// Request sanitization
app.use(sanitizeRequest);

// HTTP request logging
app.use(morgan('combined', { stream: morganStream }));

// API routes
app.use('/api', apiRoutes);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: config.NODE_ENV,
    },
  });
});

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    success: true,
    data: {
      name: 'GoHighLevel API Integration',
      version: '1.0.0',
      description: 'Production-ready API for GoHighLevel integration',
      documentation: '/api',
      health: '/health',
    },
  });
});

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Start server
const port = config.PORT;

const startServer = async (): Promise<void> => {
  await connectDB();

  // Set GHL Admin API key so all routes can make GHL API calls
  if (config.GHL_ADMIN_API_KEY) {
    ghlClient.setApiKey(config.GHL_ADMIN_API_KEY);
    logger.info('GHL Admin API key set successfully');
  } else {
    logger.warn('GHL_ADMIN_API_KEY not set — GHL API calls may fail');
  }

  app.listen(port, () => {
    logger.info(`Server is running on port ${port}`);
    logger.info(`Environment: ${config.NODE_ENV}`);
    logger.info(`API Documentation: http://localhost:${port}/api`);

    // Start polling for new sub-accounts every 2 minutes
    pollingService.start(2);
  });
};

startServer().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

export default app;