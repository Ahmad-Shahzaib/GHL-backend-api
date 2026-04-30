import { Router, Request, Response } from 'express';
import { ApiResponse } from '../types';
import { config } from '../config';

// Import route modules
import authRoutes from './auth.routes';
import dashboardRoutes from './dashboard.routes';
import usersRoutes from './users.routes';
import contactsRoutes from './contacts.routes';
import opportunitiesRoutes from './opportunities.routes';
import webhookRoutes from './webhook.routes';
import calendarRoutes from './calendar.routes';
import roomHeatmapRoutes from './room-heatmap.routes';
import workflowRoutes from './workflow.routes';
import reportsRoutes from './reports.routes';
import alertsRoutes from './alerts.routes';
import treatmentsRoutes from './treatments.routes';
import providerOverridesRoutes from './providerOverrides.routes';


const router = Router();

/**
 * @route   GET /api/health
 * @desc    Health check endpoint
 * @access  Public
 */
router.get('/health', (_req: Request, res: Response) => {
  const response: ApiResponse<{
    status: string;
    timestamp: string;
    environment: string;
    version: string;
  }> = {
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: config.NODE_ENV,
      version: process.env.npm_package_version || '1.0.0',
    },
  };
  
  res.json(response);
});

/**
 * @route   GET /api
 * @desc    API info endpoint
 * @access  Public
 */
router.get('/', (_req: Request, res: Response) => {
  const response: ApiResponse<{
    name: string;
    version: string;
    description: string;
    endpoints: string[];
  }> = {
    success: true,
    data: {
      name: 'GoHighLevel API Integration',
      version: process.env.npm_package_version || '1.0.0',
      description: 'Production-ready API for GoHighLevel integration',
      endpoints: [
        '/api/health - Health check',
        '/api/auth - Authentication routes',
        '/api/dashboard - Dashboard data routes',
        '/api/users - Users management routes',
        '/api/contacts - Contacts management routes',
        '/api/opportunities - Opportunities management routes',
        '/api/webhooks - Webhook handlers',
        '/api/calendar - Calendar, appointments, resources routes',
        '/api/room-heatmap - Room utilization heatmap routes',
        '/api/workflows - Workflow management and optimization routes',
        '/api/reports - Optimization reports and projections routes',
        '/api/alerts - Automation alerts and notifications routes',
        '/api/treatments - Treatment management routes',
        '/api/provider-overrides - Provider RPH override management',
      ],
    },
  };
  
  res.json(response);
});

// Mount route modules
router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/users', usersRoutes);
router.use('/contacts', contactsRoutes);
router.use('/opportunities', opportunitiesRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/calendar', calendarRoutes);
router.use('/room-heatmap', roomHeatmapRoutes);
router.use('/workflows', workflowRoutes);
router.use('/reports', reportsRoutes);
router.use('/alerts', alertsRoutes);
router.use('/treatments', treatmentsRoutes);
router.use('/provider-overrides', providerOverridesRoutes);

export default router;
