import { Router, Request, Response } from 'express';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { ApiResponse, PaginationMeta, GHLDashboardStats, KpiDashboardData } from '../types';

const router = Router();

router.get(
  '/stats',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!); // ← ADDED
    const locationId = req.query.locationId as string | undefined;
    const stats = await ghlClient.getDashboardStats(locationId);
    const response: ApiResponse<GHLDashboardStats> = { success: true, data: stats };
    res.json(response);
  })
);

router.get(
  '/summary',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!); // ← ADDED
    const locationId = req.query.locationId as string | undefined;
    const stats = await ghlClient.getDashboardStats(locationId);
    const summary = {
      totalContacts: stats.totalContacts,
      totalOpportunities: stats.totalOpportunities,
      totalOpportunityValue: stats.totalOpportunityValue,
      totalAppointments: stats.totalAppointments,
    };
    const response: ApiResponse<typeof summary> = { success: true, data: summary };
    res.json(response);
  })
);

router.get(
  '/recent-contacts',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!); // ← ADDED
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const locationId = req.query.locationId as string | undefined;
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
    ghlClient.setApiKey(req.ghlToken!); // ← ADDED
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const locationId = req.query.locationId as string | undefined;
    const opportunitiesResponse = await ghlClient.getOpportunities({ limit, locationId });
    const recentOpportunities = (opportunitiesResponse.opportunities || [])
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
    ghlClient.setApiKey(req.ghlToken!); // ← ADDED
    const locationId = req.query.locationId as string | undefined;
    const stats = await ghlClient.getDashboardStats(locationId);
    const response: ApiResponse<typeof stats.pipelineSummary> = {
      success: true,
      data: stats.pipelineSummary,
    };
    res.json(response);
  })
);

// KPI Dashboard Metrics
router.get(
  '/kpi',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const locationId = req.query.locationId as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    
    const kpiData = await ghlClient.getKpiMetrics(locationId, { startDate, endDate });
    const response: ApiResponse<KpiDashboardData> = {
      success: true,
      data: kpiData,
    };
    res.json(response);
  })
);

// Revenue by Hour - Prime vs Off-peak distribution
router.get(
  '/revenue-by-hour',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const locationId = req.query.locationId as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    
    const revenueByHour = await ghlClient.getRevenueByHour({ locationId, startDate, endDate });
    const response: ApiResponse<typeof revenueByHour> = {
      success: true,
      data: revenueByHour,
    };
    res.json(response);
  })
);

// Daily Revenue - Last 30 days
router.get(
  '/daily-revenue',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const locationId = req.query.locationId as string | undefined;
    const days = parseInt(req.query.days as string) || 30;
    
    const dailyRevenue = await ghlClient.getDailyRevenue({ locationId, days });
    const response: ApiResponse<typeof dailyRevenue> = {
      success: true,
      data: dailyRevenue,
    };
    res.json(response);
  })
);

export default router;