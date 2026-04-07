import { Router, Request, Response } from 'express';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { ApiResponse, ReportsData } from '../types';
import { logger } from '../utils/logger';

const router = Router();

/**
 * @route   GET /api/reports/optimization
 * @desc    Get optimization report data for Reports page
 * @access  Private
 */
router.get(
  '/optimization',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const locationId = req.query.locationId as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    logger.info('Fetching optimization report data', { locationId, startDate, endDate });

    try {
      const reportsData = await ghlClient.getReportsData({
        locationId,
        startDate,
        endDate,
      });

      const response: ApiResponse<ReportsData> = {
        success: true,
        data: reportsData,
      };

      res.json(response);
    } catch (error: any) {
      logger.error('Failed to fetch optimization report:', error?.message);
      // Return error response with details
      const response: ApiResponse<null> = {
        success: false,
        error: {
          message: error?.message || 'Failed to fetch optimization report',
          code: 'REPORT_FETCH_ERROR',
        },
      };
      res.status(500).json(response);
    }
  })
);

/**
 * @route   GET /api/reports/summary
 * @desc    Get summary statistics for quick dashboard view
 * @access  Private
 */
router.get(
  '/summary',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const locationId = req.query.locationId as string | undefined;

    try {
      const reportsData = await ghlClient.getReportsData({ locationId });
      
      const summary = {
        currentAnnual: reportsData.currentAnnual,
        totalRevenue: reportsData.totalRevenue,
        totalAppointments: reportsData.totalAppointments,
        avgUtilization: reportsData.avgUtilization,
        primeHourUtilization: reportsData.primeHourUtilization,
        totalUpside: reportsData.projections.totalUpside,
        healthStatus: reportsData.successMetrics.filter(m => m.status === 'on_track').length >= 3 
          ? 'excellent' 
          : reportsData.successMetrics.filter(m => m.status === 'critical').length >= 2 
            ? 'critical' 
            : 'needs_attention',
      };

      const response: ApiResponse<typeof summary> = {
        success: true,
        data: summary,
      };

      res.json(response);
    } catch (error: any) {
      logger.error('Failed to fetch report summary:', error?.message);
      const response: ApiResponse<null> = {
        success: false,
        error: {
          message: error?.message || 'Failed to fetch report summary',
          code: 'REPORT_SUMMARY_ERROR',
        },
      };
      res.status(500).json(response);
    }
  })
);

/**
 * @route   GET /api/reports/projections
 * @desc    Get projection metrics for optimization planning
 * @access  Private
 */
router.get(
  '/projections',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const locationId = req.query.locationId as string | undefined;

    try {
      const reportsData = await ghlClient.getReportsData({ locationId });

      const projections = {
        currentAnnual: reportsData.currentAnnual,
        projections: reportsData.projections,
        dateRange: reportsData.dateRange,
        uniqueDays: reportsData.uniqueDays,
      };

      const response: ApiResponse<typeof projections> = {
        success: true,
        data: projections,
      };

      res.json(response);
    } catch (error: any) {
      logger.error('Failed to fetch projections:', error?.message);
      const response: ApiResponse<null> = {
        success: false,
        error: {
          message: error?.message || 'Failed to fetch projections',
          code: 'PROJECTIONS_ERROR',
        },
      };
      res.status(500).json(response);
    }
  })
);

/**
 * @route   GET /api/reports/success-metrics
 * @desc    Get success metrics tracking data
 * @access  Private
 */
router.get(
  '/success-metrics',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const locationId = req.query.locationId as string | undefined;

    try {
      const reportsData = await ghlClient.getReportsData({ locationId });

      const response: ApiResponse<typeof reportsData.successMetrics> = {
        success: true,
        data: reportsData.successMetrics,
      };

      res.json(response);
    } catch (error: any) {
      logger.error('Failed to fetch success metrics:', error?.message);
      const response: ApiResponse<null> = {
        success: false,
        error: {
          message: error?.message || 'Failed to fetch success metrics',
          code: 'SUCCESS_METRICS_ERROR',
        },
      };
      res.status(500).json(response);
    }
  })
);

export default router;
