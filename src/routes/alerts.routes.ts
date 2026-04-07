import { Router, Request, Response } from 'express';
import { ApiResponse } from '../types';
import { ghlClient } from '../services/ghlClient';
import { logger } from '../utils/logger';
import {
  GHLOptimizationAlert,
  GHLOptimizationAlertsResponse,
  AlertCreateRequest,
  AlertUpdateRequest,
  AlertStats,
  AlertType,
  AlertSeverity,
} from '../types';

const router = Router();

// In-memory storage for alerts (in production, use a database)
const alertsStore: Map<string, GHLOptimizationAlert> = new Map();

/**
 * @route   GET /api/alerts
 * @desc    Get all optimization alerts
 * @access  Private
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      locationId,
      limit = '100',
      page = '1',
      isResolved,
      severity,
      alertType,
    } = req.query;

    let alerts = Array.from(alertsStore.values());

    // Filter by location
    if (locationId) {
      alerts = alerts.filter(a => a.locationId === locationId);
    }

    // Filter by resolved status
    if (isResolved !== undefined) {
      const resolved = isResolved === 'true';
      alerts = alerts.filter(a => a.is_resolved === resolved);
    }

    // Filter by severity
    if (severity) {
      alerts = alerts.filter(a => a.severity === severity);
    }

    // Filter by alert type
    if (alertType) {
      alerts = alerts.filter(a => a.alert_type === alertType);
    }

    // Sort by created date (newest first)
    alerts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Pagination
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const start = (pageNum - 1) * limitNum;
    const end = start + limitNum;
    const paginatedAlerts = alerts.slice(start, end);

    const active = alerts.filter(a => !a.is_resolved).length;
    const resolved = alerts.filter(a => a.is_resolved).length;

    const response: ApiResponse<GHLOptimizationAlertsResponse> = {
      success: true,
      data: {
        alerts: paginatedAlerts,
        meta: {
          total: alerts.length,
          active,
          resolved,
          currentPage: pageNum,
          nextPage: end < alerts.length ? pageNum + 1 : undefined,
          prevPage: pageNum > 1 ? pageNum - 1 : undefined,
        },
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Error fetching alerts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alerts',
    });
  }
});

/**
 * @route   GET /api/alerts/:id
 * @desc    Get a single alert by ID
 * @access  Private
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const alert = alertsStore.get(id);

    if (!alert) {
      res.status(404).json({
        success: false,
        error: 'Alert not found',
      });
      return;
    }

    const response: ApiResponse<GHLOptimizationAlert> = {
      success: true,
      data: alert,
    };

    res.json(response);
  } catch (error) {
    logger.error('Error fetching alert:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alert',
    });
  }
});

/**
 * @route   POST /api/alerts
 * @desc    Create a new optimization alert
 * @access  Private
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const alertData: AlertCreateRequest = req.body;
    const locationId = (req.query.locationId as string) || alertData.locationId || 'default';

    const now = new Date().toISOString();
    const newAlert: GHLOptimizationAlert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      alert_type: alertData.alert_type,
      severity: alertData.severity,
      title: alertData.title,
      description: alertData.description || '',
      affected_resource: alertData.affected_resource || '',
      recommended_action: alertData.recommended_action || '',
      date: alertData.date || now.split('T')[0],
      revenue_impact: alertData.revenue_impact || 0,
      is_resolved: false,
      created_at: now,
      updated_at: now,
      locationId,
      triggered_by: alertData.triggered_by || 'manual',
      metadata: alertData.metadata || {},
    };

    alertsStore.set(newAlert.id, newAlert);

    logger.info(`Created alert: ${newAlert.id} - ${newAlert.title}`);

    const response: ApiResponse<GHLOptimizationAlert> = {
      success: true,
      data: newAlert,
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error('Error creating alert:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create alert',
    });
  }
});

/**
 * @route   PUT /api/alerts/:id
 * @desc    Update an existing alert
 * @access  Private
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const alertData: AlertUpdateRequest = req.body;

    const existingAlert = alertsStore.get(id);
    if (!existingAlert) {
      res.status(404).json({
        success: false,
        error: 'Alert not found',
      });
      return;
    }

    const now = new Date().toISOString();
    const updatedAlert: GHLOptimizationAlert = {
      ...existingAlert,
      ...alertData,
      id: existingAlert.id,
      updated_at: now,
    };

    // Handle resolve status change
    if (alertData.is_resolved && !existingAlert.is_resolved) {
      updatedAlert.resolved_at = now;
    } else if (!alertData.is_resolved && existingAlert.is_resolved) {
      updatedAlert.resolved_at = undefined;
    }

    alertsStore.set(id, updatedAlert);

    logger.info(`Updated alert: ${id}`);

    const response: ApiResponse<GHLOptimizationAlert> = {
      success: true,
      data: updatedAlert,
    };

    res.json(response);
  } catch (error) {
    logger.error('Error updating alert:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update alert',
    });
  }
});

/**
 * @route   PUT /api/alerts/:id/resolve
 * @desc    Resolve an alert
 * @access  Private
 */
router.put('/:id/resolve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existingAlert = alertsStore.get(id);
    if (!existingAlert) {
      res.status(404).json({
        success: false,
        error: 'Alert not found',
      });
      return;
    }

    const now = new Date().toISOString();
    const updatedAlert: GHLOptimizationAlert = {
      ...existingAlert,
      is_resolved: true,
      resolved_at: now,
      updated_at: now,
    };

    alertsStore.set(id, updatedAlert);

    logger.info(`Resolved alert: ${id}`);

    const response: ApiResponse<GHLOptimizationAlert> = {
      success: true,
      data: updatedAlert,
    };

    res.json(response);
  } catch (error) {
    logger.error('Error resolving alert:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resolve alert',
    });
  }
});

/**
 * @route   DELETE /api/alerts/:id
 * @desc    Delete an alert
 * @access  Private
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!alertsStore.has(id)) {
      res.status(404).json({
        success: false,
        error: 'Alert not found',
      });
      return;
    }

    alertsStore.delete(id);

    logger.info(`Deleted alert: ${id}`);

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Alert deleted successfully' },
    };

    res.json(response);
  } catch (error) {
    logger.error('Error deleting alert:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete alert',
    });
  }
});

/**
 * @route   GET /api/alerts/stats/summary
 * @desc    Get alert statistics
 * @access  Private
 */
router.get('/stats/summary', async (req: Request, res: Response) => {
  try {
    const { locationId } = req.query;

    let alerts = Array.from(alertsStore.values());

    // Filter by location
    if (locationId) {
      alerts = alerts.filter(a => a.locationId === locationId);
    }

    const active = alerts.filter(a => !a.is_resolved);
    const resolved = alerts.filter(a => a.is_resolved);

    const bySeverity = {
      critical: active.filter(a => a.severity === 'critical').length,
      warning: active.filter(a => a.severity === 'warning').length,
      info: active.filter(a => a.severity === 'info').length,
    };

    const byType: Record<AlertType, number> = {
      low_utilization: active.filter(a => a.alert_type === 'low_utilization').length,
      prime_hour_low_ticket: active.filter(a => a.alert_type === 'prime_hour_low_ticket').length,
      provider_idle: active.filter(a => a.alert_type === 'provider_idle').length,
      high_demand_overflow: active.filter(a => a.alert_type === 'high_demand_overflow').length,
      equipment_underuse: active.filter(a => a.alert_type === 'equipment_underuse').length,
    };

    const totalRevenueImpact = active.reduce((sum, a) => sum + (a.revenue_impact || 0), 0);

    const stats: AlertStats = {
      total: alerts.length,
      active: active.length,
      resolved: resolved.length,
      bySeverity,
      byType,
      totalRevenueImpact,
    };

    const response: ApiResponse<AlertStats> = {
      success: true,
      data: stats,
    };

    res.json(response);
  } catch (error) {
    logger.error('Error fetching alert stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alert statistics',
    });
  }
});

/**
 * @route   POST /api/alerts/trigger-analysis
 * @desc    Trigger automated alert analysis based on current data
 * @access  Private
 */
router.post('/trigger-analysis', async (req: Request, res: Response) => {
  try {
    const { locationId } = req.query;
    const effectiveLocationId = (locationId as string) || process.env.GHL_LOCATION_ID || '';

    // Set API key for GHL client
    const apiKey = req.headers.authorization?.replace('Bearer ', '') || process.env.GHL_API_KEY || '';
    ghlClient.setApiKey(apiKey);

    // Trigger automated analysis
    const createdAlerts = await ghlClient.triggerAutomatedAlerts(effectiveLocationId);

    // Store created alerts
    createdAlerts.forEach(alert => {
      alertsStore.set(alert.id, alert);
    });

    logger.info(`Triggered analysis created ${createdAlerts.length} alerts`);

    const response: ApiResponse<{
      created: number;
      alerts: GHLOptimizationAlert[];
    }> = {
      success: true,
      data: {
        created: createdAlerts.length,
        alerts: createdAlerts,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Error triggering alert analysis:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger alert analysis',
    });
  }
});

/**
 * @route   POST /api/alerts/webhook
 * @desc    Receive webhook from GHL workflows to create alerts
 * @access  Public (with validation)
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const {
      alert_type,
      severity,
      title,
      description,
      affected_resource,
      recommended_action,
      revenue_impact,
      locationId,
      triggered_by,
      metadata,
    } = req.body;

    // Validate required fields
    if (!alert_type || !severity || !title) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: alert_type, severity, title',
      });
      return;
    }

    const now = new Date().toISOString();
    const newAlert: GHLOptimizationAlert = {
      id: `alert-webhook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      alert_type: alert_type as AlertType,
      severity: severity as AlertSeverity,
      title,
      description: description || '',
      affected_resource: affected_resource || '',
      recommended_action: recommended_action || '',
      date: now.split('T')[0],
      revenue_impact: revenue_impact || 0,
      is_resolved: false,
      created_at: now,
      updated_at: now,
      locationId: locationId || 'default',
      triggered_by: triggered_by || 'webhook',
      metadata: metadata || {},
    };

    alertsStore.set(newAlert.id, newAlert);

    logger.info(`Created alert from webhook: ${newAlert.id} - ${newAlert.title}`);

    const response: ApiResponse<GHLOptimizationAlert> = {
      success: true,
      data: newAlert,
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error('Error processing webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process webhook',
    });
  }
});

export default router;
