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

// Initialize Express app
const app: Application = express();

// Security middleware
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(rateLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request sanitization
app.use(sanitizeRequest);

// HTTP request logging
app.use(morgan('combined', { stream: morganStream }));

// API routes
app.use('/api', apiRoutes);

// Health check endpoint (also at root for load balancers)
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

app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
  logger.info(`Environment: ${config.NODE_ENV}`);
  logger.info(`API Documentation: http://localhost:${port}/api`);
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
