import { Router, Request, Response } from 'express';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { ApiResponse, PaginationMeta, GHLOpportunity } from '../types';
import { setupLocationToken } from '../utils/setupLocationToken';

const router = Router();

router.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId  = await setupLocationToken(req);
    const page        = parseInt(req.query.page       as string) || 1;
    const limit       = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const pipelineId  = req.query.pipelineId as string | undefined;
    const stageId     = req.query.stageId    as string | undefined;

    const opportunitiesResponse = await ghlClient.getOpportunities({ limit, page, pipelineId, stageId, locationId });
    const opportunities = opportunitiesResponse.opportunities || [];
    const total         = opportunitiesResponse.meta?.total || opportunities.length;

    const response: ApiResponse<GHLOpportunity[]> = {
      success: true,
      data: opportunities,
      meta: {
        page, limit, total,
        totalPages:  Math.ceil(total / limit),
        hasNextPage: !!opportunitiesResponse.meta?.nextPageUrl,
        hasPrevPage: page > 1,
      } as PaginationMeta,
    };

    res.setHeader('X-Total-Count', total.toString());
    res.setHeader('X-Page-Count', Math.ceil(total / limit).toString());
    res.json(response);
  })
);

// /pipeline/:pipelineId and /stage/:stageId BEFORE /:id
router.get(
  '/pipeline/:pipelineId',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const { pipelineId } = req.params;
    const page  = parseInt(req.query.page  as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    if (!pipelineId) throw Errors.BadRequest('Pipeline ID is required');

    const opportunitiesResponse = await ghlClient.getOpportunities({ limit, page, pipelineId, locationId });
    const opportunities = opportunitiesResponse.opportunities || [];
    const total         = opportunitiesResponse.meta?.total || opportunities.length;

    const response: ApiResponse<GHLOpportunity[]> = {
      success: true,
      data: opportunities,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasNextPage: !!opportunitiesResponse.meta?.nextPageUrl, hasPrevPage: page > 1 } as PaginationMeta,
    };
    res.json(response);
  })
);

router.get(
  '/stage/:stageId',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const { stageId } = req.params;
    const page  = parseInt(req.query.page  as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    if (!stageId) throw Errors.BadRequest('Stage ID is required');

    const opportunitiesResponse = await ghlClient.getOpportunities({ limit, page, stageId, locationId });
    const opportunities = opportunitiesResponse.opportunities || [];
    const total         = opportunitiesResponse.meta?.total || opportunities.length;

    const response: ApiResponse<GHLOpportunity[]> = {
      success: true,
      data: opportunities,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasNextPage: !!opportunitiesResponse.meta?.nextPageUrl, hasPrevPage: page > 1 } as PaginationMeta,
    };
    res.json(response);
  })
);

router.get(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    await setupLocationToken(req);
    const { id } = req.params;
    if (!id) throw Errors.BadRequest('Opportunity ID is required');

    const opportunity = await ghlClient.getOpportunity(id);
    const response: ApiResponse<GHLOpportunity> = { success: true, data: opportunity };
    res.json(response);
  })
);

export default router;
