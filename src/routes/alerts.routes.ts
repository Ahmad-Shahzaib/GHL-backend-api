import { Router, Request, Response } from 'express';
import { ApiResponse } from '../types';
import { ghlClient } from '../services/ghlClient';
import { logger } from '../utils/logger';
import { Alert } from '../models/Alert';
import {
  AlertCreateRequest,
  AlertUpdateRequest,
  AlertStats,
} from '../types';

const router = Router();

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

    const filter: Record<string, any> = {};
    if (locationId)              filter.locationId  = locationId;
    if (isResolved !== undefined) filter.is_resolved = isResolved === 'true';
    if (severity)                filter.severity    = severity;
    if (alertType)               filter.alert_type  = alertType;

    const pageNum  = parseInt(page  as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip     = (pageNum - 1) * limitNum;

    const [alerts, total] = await Promise.all([
      Alert.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Alert.countDocuments(filter),
    ]);

    const activeCount   = await Alert.countDocuments({ ...filter, is_resolved: false });
    const resolvedCount = await Alert.countDocuments({ ...filter, is_resolved: true });

    const normalised = alerts.map(a => ({ ...a, id: (a._id as any).toString() }));

    res.json({
      success: true,
      data: {
        alerts: normalised,
        meta: {
          total,
          active:      activeCount,
          resolved:    resolvedCount,
          currentPage: pageNum,
          nextPage:    skip + limitNum < total ? pageNum + 1 : undefined,
          prevPage:    pageNum > 1 ? pageNum - 1 : undefined,
        },
      },
    });
  } catch (error) {
    logger.error('Error fetching alerts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch alerts' });
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
    const base: Record<string, any> = {};
    if (locationId) base.locationId = locationId;

    const [total, active, resolved] = await Promise.all([
      Alert.countDocuments(base),
      Alert.countDocuments({ ...base, is_resolved: false }),
      Alert.countDocuments({ ...base, is_resolved: true }),
    ]);

    const activeAlerts = await Alert.find({ ...base, is_resolved: false }).lean();

    const bySeverity = {
      critical: activeAlerts.filter(a => a.severity === 'critical').length,
      warning:  activeAlerts.filter(a => a.severity === 'warning').length,
      info:     activeAlerts.filter(a => a.severity === 'info').length,
    };

    const byType: Record<string, number> = {};
    activeAlerts.forEach(a => { byType[a.alert_type] = (byType[a.alert_type] || 0) + 1; });

    const totalRevenueImpact = activeAlerts.reduce((s, a) => s + (a.revenue_impact || 0), 0);

    res.json({
      success: true,
      data: { total, active, resolved, bySeverity, byType, totalRevenueImpact } as AlertStats,
    });
  } catch (error) {
    logger.error('Error fetching alert stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch alert statistics' });
  }
});

/**
 * @route   GET /api/alerts/:id
 * @desc    Get a single alert by ID
 * @access  Private
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const alert = await Alert.findById(req.params.id).lean();
    if (!alert) {
      res.status(404).json({ success: false, error: 'Alert not found' });
      return;
    }
    res.json({ success: true, data: { ...alert, id: (alert._id as any).toString() } });
  } catch (error) {
    logger.error('Error fetching alert:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch alert' });
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

    const newAlert = await Alert.create({
      locationId,
      alert_type:         alertData.alert_type,
      severity:           alertData.severity,
      title:              alertData.title,
      description:        alertData.description        || '',
      affected_resource:  alertData.affected_resource  || '',
      recommended_action: alertData.recommended_action || '',
      date:               alertData.date               || new Date().toISOString().split('T')[0],
      revenue_impact:     alertData.revenue_impact     || 0,
      triggered_by:       alertData.triggered_by       || 'manual',
      metadata:           alertData.metadata           || {},
    });

    logger.info(`Created alert: ${newAlert._id} - ${newAlert.title}`);
    res.status(201).json({
      success: true,
      data: { ...newAlert.toObject(), id: newAlert._id.toString() },
    });
  } catch (error) {
    logger.error('Error creating alert:', error);
    res.status(500).json({ success: false, error: 'Failed to create alert' });
  }
});

/**
 * @route   PUT /api/alerts/:id
 * @desc    Update an existing alert
 * @access  Private
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const alertData: AlertUpdateRequest = req.body;
    const update: Record<string, any> = { ...alertData };
    if (alertData.is_resolved === true)  update.resolved_at = new Date();
    if (alertData.is_resolved === false) update.resolved_at = null;

    const updated = await Alert.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!updated) {
      res.status(404).json({ success: false, error: 'Alert not found' });
      return;
    }
    res.json({ success: true, data: { ...updated, id: (updated._id as any).toString() } });
  } catch (error) {
    logger.error('Error updating alert:', error);
    res.status(500).json({ success: false, error: 'Failed to update alert' });
  }
});

/**
 * @route   PUT /api/alerts/:id/resolve
 * @desc    Resolve an alert
 * @access  Private
 */
router.put('/:id/resolve', async (req: Request, res: Response) => {
  try {
    const updated = await Alert.findByIdAndUpdate(
      req.params.id,
      { is_resolved: true, resolved_at: new Date() },
      { new: true }
    ).lean();

    if (!updated) {
      res.status(404).json({ success: false, error: 'Alert not found' });
      return;
    }

    logger.info(`Resolved alert: ${req.params.id}`);
    res.json({ success: true, data: { ...updated, id: (updated._id as any).toString() } });
  } catch (error) {
    logger.error('Error resolving alert:', error);
    res.status(500).json({ success: false, error: 'Failed to resolve alert' });
  }
});

/**
 * @route   DELETE /api/alerts/:id
 * @desc    Delete an alert
 * @access  Private
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await Alert.findByIdAndDelete(req.params.id);
    if (!deleted) {
      res.status(404).json({ success: false, error: 'Alert not found' });
      return;
    }
    logger.info(`Deleted alert: ${req.params.id}`);
    res.json({ success: true, data: { message: 'Alert deleted successfully' } });
  } catch (error) {
    logger.error('Error deleting alert:', error);
    res.status(500).json({ success: false, error: 'Failed to delete alert' });
  }
});

/**
 * @route   POST /api/alerts/trigger-analysis
 * @desc    Trigger automated alert analysis
 * @access  Private
 */
router.post('/trigger-analysis', async (req: Request, res: Response) => {
  try {
    const locationId = (req.query.locationId as string) || process.env.GHL_LOCATION_ID || '';
    const apiKey     = req.headers.authorization?.replace('Bearer ', '') || process.env.GHL_API_KEY || '';
    ghlClient.setApiKey(apiKey);

    const createdAlerts = await ghlClient.triggerAutomatedAlerts(locationId);

    const saved = await Promise.all(
      createdAlerts.map(a =>
        Alert.create({
          locationId:         locationId || 'default',
          alert_type:         a.alert_type,
          severity:           a.severity,
          title:              a.title,
          description:        a.description        || '',
          affected_resource:  a.affected_resource  || '',
          recommended_action: a.recommended_action || '',
          date:               a.date               || new Date().toISOString().split('T')[0],
          revenue_impact:     a.revenue_impact      || 0,
          triggered_by:       'automated',
          metadata:           a.metadata           || {},
        }).catch(() => null)
      )
    );

    const created = saved.filter(Boolean);
    logger.info(`Trigger analysis created ${created.length} alerts`);

    res.json({
      success: true,
      data: {
        created: created.length,
        alerts:  created.map(a => ({ ...a!.toObject(), id: a!._id.toString() })),
      },
    });
  } catch (error) {
    logger.error('Error triggering alert analysis:', error);
    res.status(500).json({ success: false, error: 'Failed to trigger alert analysis' });
  }
});

/**
 * @route   POST /api/alerts/webhook
 * @desc    Receive webhook from GHL to create alerts
 * @access  Public
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const {
      alert_type, severity, title, description,
      affected_resource, recommended_action,
      revenue_impact, locationId, triggered_by, metadata,
    } = req.body;

    if (!alert_type || !severity || !title) {
      res.status(400).json({ success: false, error: 'Missing required fields: alert_type, severity, title' });
      return;
    }

    const newAlert = await Alert.create({
      locationId:         locationId         || 'default',
      alert_type,
      severity,
      title,
      description:        description        || '',
      affected_resource:  affected_resource  || '',
      recommended_action: recommended_action || '',
      date:               new Date().toISOString().split('T')[0],
      revenue_impact:     revenue_impact     || 0,
      triggered_by:       triggered_by       || 'webhook',
      metadata:           metadata           || {},
    });

    logger.info(`Created alert from webhook: ${newAlert._id} - ${newAlert.title}`);
    res.status(201).json({
      success: true,
      data: { ...newAlert.toObject(), id: newAlert._id.toString() },
    });
  } catch (error) {
    logger.error('Error processing webhook:', error);
    res.status(500).json({ success: false, error: 'Failed to process webhook' });
  }
});

export default router;