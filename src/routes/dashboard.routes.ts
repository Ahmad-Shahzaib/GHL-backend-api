import { Router, Request, Response } from 'express';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { ApiResponse, PaginationMeta, GHLDashboardStats } from '../types';

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

export default router;