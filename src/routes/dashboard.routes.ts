import { Router, Request, Response } from 'express';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { ApiResponse, PaginationMeta, GHLDashboardStats, KpiDashboardData } from '../types';
import { logger } from '../utils/logger';
import { setupLocationToken } from '../utils/setupLocationToken'; // shared helper

const router = Router();

router.get(
  '/stats',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const stats = await ghlClient.getDashboardStats(locationId);
    const response: ApiResponse<GHLDashboardStats> = { success: true, data: stats };
    res.json(response);
  })
);

router.get(
  '/summary',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const stats      = await ghlClient.getDashboardStats(locationId);
    const summary    = {
      totalContacts:         stats.totalContacts,
      totalOpportunities:    stats.totalOpportunities,
      totalOpportunityValue: stats.totalOpportunityValue,
      totalAppointments:     stats.totalAppointments,
    };
    const response: ApiResponse<typeof summary> = { success: true, data: summary };
    res.json(response);
  })
);

router.get(
  '/recent-contacts',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId     = await setupLocationToken(req);
    const limit          = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const contactsResponse = await ghlClient.getContacts({ limit, locationId });
    const recentContacts = (contactsResponse.contacts || [])
      .sort((a, b) => new Date(b.dateAdded || 0).getTime() - new Date(a.dateAdded || 0).getTime())
      .slice(0, limit);
    const response: ApiResponse<typeof recentContacts> = {
      success: true,
      data: recentContacts,
      meta: { total: contactsResponse.meta?.total || recentContacts.length } as PaginationMeta,
    };
    res.json(response);
  })
);

router.get(
  '/recent-opportunities',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId            = await setupLocationToken(req);
    const limit                 = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const opportunitiesResponse = await ghlClient.getOpportunities({ limit, locationId });
    const recentOpportunities   = (opportunitiesResponse.opportunities || [])
      .sort((a, b) => new Date(b.dateAdded || 0).getTime() - new Date(a.dateAdded || 0).getTime())
      .slice(0, limit);
    const response: ApiResponse<typeof recentOpportunities> = {
      success: true,
      data: recentOpportunities,
      meta: { total: opportunitiesResponse.meta?.total || recentOpportunities.length } as PaginationMeta,
    };
    res.json(response);
  })
);

router.get(
  '/pipeline-summary',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const stats      = await ghlClient.getDashboardStats(locationId);
    const response: ApiResponse<typeof stats.pipelineSummary> = { success: true, data: stats.pipelineSummary };
    res.json(response);
  })
);

router.get(
  '/kpi',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const startDate  = req.query.startDate as string | undefined;
    const endDate    = req.query.endDate   as string | undefined;
    const kpiData    = await ghlClient.getKpiMetrics(locationId, { startDate, endDate });
    const response: ApiResponse<KpiDashboardData> = { success: true, data: kpiData };
    res.json(response);
  })
);

router.get(
  '/revenue-by-hour',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId   = await setupLocationToken(req);
    const startDate    = req.query.startDate as string | undefined;
    const endDate      = req.query.endDate   as string | undefined;
    const revenueByHour = await ghlClient.getRevenueByHour({ locationId, startDate, endDate });
    const response: ApiResponse<typeof revenueByHour> = { success: true, data: revenueByHour };
    res.json(response);
  })
);

router.get(
  '/daily-revenue',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId  = await setupLocationToken(req);
    const days        = parseInt(req.query.days as string) || 30;
    const dailyRevenue = await ghlClient.getDailyRevenue({ locationId, days });
    const response: ApiResponse<typeof dailyRevenue> = { success: true, data: dailyRevenue };
    res.json(response);
  })
);

// ── NEW DETAIL ENDPOINTS ──────────────────────────────────────────────────

/**
 * Contact-conversion detail: funnel stages + trend data
 */
router.get(
  '/contact-conversion-detail',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const kpiData    = await ghlClient.getKpiMetrics(locationId);

    const detail = {
      totalContacts:        kpiData.totalContacts,
      totalOpportunities:   kpiData.totalOpportunities,
      conversionRate:       kpiData.conversionRate,
      avgTimeToClose:       kpiData.avgTimeToClose,
      leadVelocity:         kpiData.leadVelocity,
      opportunityVelocity:  kpiData.opportunityVelocity,
      contactsTrend:        kpiData.contactsTrend,
      opportunitiesTrend:   kpiData.opportunitiesTrend,
      pipelineStats:        kpiData.pipelineStats,
      dateRange:            kpiData.dateRange,
    };

    res.json({ success: true, data: detail });
  })
);

/**
 * Opportunity-value distribution: buckets + pipeline breakdown
 */
router.get(
  '/opportunity-value-distribution',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const kpiData    = await ghlClient.getKpiMetrics(locationId);

    const detail = {
      avgOpportunityValue: kpiData.avgOpportunityValue,
      totalPipelineValue:  kpiData.totalPipelineValue,
      totalOpportunities:  kpiData.totalOpportunities,
      pipelineStats:       kpiData.pipelineStats,
      opportunitiesTrend:  kpiData.opportunitiesTrend,
      revenueTrend:        kpiData.revenueTrend,
      dateRange:           kpiData.dateRange,
    };

    res.json({ success: true, data: detail });
  })
);

/**
 * Pipeline-stages detail: full stage breakdown per pipeline
 */
router.get(
  '/pipeline-stages-detail',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId    = await setupLocationToken(req);
    const stats         = await ghlClient.getDashboardStats(locationId);
    const kpiData       = await ghlClient.getKpiMetrics(locationId);

    const detail = {
      pipelineSummary: stats.pipelineSummary,
      pipelineStats:   kpiData.pipelineStats,
      totalPipelines:  stats.pipelineSummary.length,
      totalStages:     stats.pipelineSummary.reduce(
        (acc, p) => acc + Object.keys(p.stageCounts || {}).length, 0
      ),
    };

    res.json({ success: true, data: detail });
  })
);

/**
 * Daily-revenue trend with statistics
 */
router.get(
  '/revenue-detail',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId  = await setupLocationToken(req);
    const days        = parseInt(req.query.days as string) || 30;
    const dailyRevenue = await ghlClient.getDailyRevenue({ locationId, days });
    const kpiData      = await ghlClient.getKpiMetrics(locationId);

    const detail = {
      dailyRevenue,
      totalRevenue:      kpiData.totalRevenue,
      avgRevenuePerHour: kpiData.avgRevenuePerHour,
      profitDensity:     kpiData.profitDensity,
      revenueTrend:      kpiData.revenueTrend,
      dateRange:         kpiData.dateRange,
    };

    res.json({ success: true, data: detail });
  })
);

export default router;
