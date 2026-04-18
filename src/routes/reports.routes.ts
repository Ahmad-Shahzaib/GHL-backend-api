import { Router, Request, Response } from 'express';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { ApiResponse, ReportsData } from '../types';
import { logger } from '../utils/logger';
import { setupLocationToken } from '../utils/setupLocationToken';

const router = Router();

router.get(
  '/optimization',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const startDate  = req.query.startDate as string | undefined;
    const endDate    = req.query.endDate   as string | undefined;

    logger.info('Fetching optimization report data', { locationId, startDate, endDate });

    try {
      const reportsData = await ghlClient.getReportsData({ locationId, startDate, endDate });
      const response: ApiResponse<ReportsData> = { success: true, data: reportsData };
      res.json(response);
    } catch (error: any) {
      logger.error('Failed to fetch optimization report:', error?.message);
      res.status(500).json({ success: false, error: { message: error?.message || 'Failed to fetch optimization report', code: 'REPORT_FETCH_ERROR' } });
    }
  })
);

router.get(
  '/summary',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);

    try {
      const reportsData = await ghlClient.getReportsData({ locationId });
      const summary = {
        currentAnnual:        reportsData.currentAnnual,
        totalRevenue:         reportsData.totalRevenue,
        totalAppointments:    reportsData.totalAppointments,
        avgUtilization:       reportsData.avgUtilization,
        primeHourUtilization: reportsData.primeHourUtilization,
        totalUpside:          reportsData.projections.totalUpside,
        healthStatus: reportsData.successMetrics.filter(m => m.status === 'on_track').length >= 3
          ? 'excellent'
          : reportsData.successMetrics.filter(m => m.status === 'critical').length >= 2
            ? 'critical'
            : 'needs_attention',
      };
      const response: ApiResponse<typeof summary> = { success: true, data: summary };
      res.json(response);
    } catch (error: any) {
      logger.error('Failed to fetch report summary:', error?.message);
      res.status(500).json({ success: false, error: { message: error?.message || 'Failed to fetch report summary', code: 'REPORT_SUMMARY_ERROR' } });
    }
  })
);

router.get(
  '/projections',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);

    try {
      const reportsData  = await ghlClient.getReportsData({ locationId });
      const projections  = { currentAnnual: reportsData.currentAnnual, projections: reportsData.projections, dateRange: reportsData.dateRange, uniqueDays: reportsData.uniqueDays };
      const response: ApiResponse<typeof projections> = { success: true, data: projections };
      res.json(response);
    } catch (error: any) {
      logger.error('Failed to fetch projections:', error?.message);
      res.status(500).json({ success: false, error: { message: error?.message || 'Failed to fetch projections', code: 'PROJECTIONS_ERROR' } });
    }
  })
);

router.get(
  '/success-metrics',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);

    try {
      const reportsData = await ghlClient.getReportsData({ locationId });
      const response: ApiResponse<typeof reportsData.successMetrics> = { success: true, data: reportsData.successMetrics };
      res.json(response);
    } catch (error: any) {
      logger.error('Failed to fetch success metrics:', error?.message);
      res.status(500).json({ success: false, error: { message: error?.message || 'Failed to fetch success metrics', code: 'SUCCESS_METRICS_ERROR' } });
    }
  })
);

export default router;
