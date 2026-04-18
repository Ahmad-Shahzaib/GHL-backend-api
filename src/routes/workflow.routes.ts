import { Router, Request, Response } from 'express';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { workflowRateLimiter } from '../middleware/security';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { ApiResponse, PaginationMeta, GHLWorkflow, WorkflowOptimizationRule, WorkflowSchedulingViolation, WorkflowScheduleBlock } from '../types';
import { logger } from '../utils/logger';
import { setupLocationToken } from '../utils/setupLocationToken';

const router = Router();

// ── Named sub-routes BEFORE /:id ──────────────────────────────────────────────

router.get(
  '/rules/optimization',
  authenticate,
  workflowRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    let rules: WorkflowOptimizationRule[] = [];
    try {
      rules = await ghlClient.getWorkflowOptimizationRules(locationId);
    } catch (error: any) {
      logger.warn('Failed to fetch optimization rules:', error?.message);
    }
    const response: ApiResponse<WorkflowOptimizationRule[]> = { success: true, data: rules };
    res.json(response);
  })
);

router.put(
  '/rules/optimization',
  authenticate,
  workflowRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const rules = req.body as WorkflowOptimizationRule[];
    if (!Array.isArray(rules)) throw Errors.BadRequest('Rules must be an array');

    const updatedRules = await ghlClient.updateWorkflowOptimizationRules(rules, locationId);
    const response: ApiResponse<WorkflowOptimizationRule[]> = { success: true, data: updatedRules };
    res.json(response);
  })
);

router.get(
  '/analysis/violations',
  authenticate,
  workflowRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const startDate  = req.query.startDate as string | undefined;
    const endDate    = req.query.endDate   as string | undefined;

    let violations: WorkflowSchedulingViolation[] = [];
    try {
      violations = await ghlClient.analyzeSchedulingViolations({ locationId, startDate, endDate });
    } catch (error: any) {
      logger.warn('Failed to analyze scheduling violations:', error?.message);
    }
    const response: ApiResponse<WorkflowSchedulingViolation[]> = { success: true, data: violations };
    res.json(response);
  })
);

router.get(
  '/schedule/blocks',
  authenticate,
  workflowRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const date       = req.query.date as string | undefined;

    let blocks: WorkflowScheduleBlock[] = [];
    try {
      blocks = await ghlClient.getScheduleBlocks({ locationId, date });
    } catch (error: any) {
      logger.warn('Failed to get schedule blocks:', error?.message);
    }
    const response: ApiResponse<WorkflowScheduleBlock[]> = { success: true, data: blocks };
    res.json(response);
  })
);

router.get(
  '/stats/summary',
  authenticate,
  workflowRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    let stats = { totalWorkflows: 0, activeWorkflows: 0, totalViolations: 0, highSeverityViolations: 0, primeHourUtilization: 0, averageUtilization: 0 };

    try {
      const [wfAll, wfActive, violations, blocks] = await Promise.allSettled([
        ghlClient.getWorkflows({ locationId, limit: 1 }),
        ghlClient.getWorkflows({ locationId, status: 'published', limit: 1 }),
        ghlClient.analyzeSchedulingViolations({ locationId }),
        ghlClient.getScheduleBlocks({ locationId }),
      ]);

      if (wfAll.status === 'fulfilled')    stats.totalWorkflows  = wfAll.value.meta?.total || 0;
      if (wfActive.status === 'fulfilled') stats.activeWorkflows = wfActive.value.meta?.total || 0;

      if (violations.status === 'fulfilled') {
        stats.totalViolations        = violations.value.length;
        stats.highSeverityViolations = violations.value.filter(v => v.severity === 'high' || v.severity === 'critical').length;
      }
      if (blocks.status === 'fulfilled') {
        const primeBlocks = blocks.value.filter(b => b.isPrime);
        stats.primeHourUtilization = primeBlocks.length > 0 ? Math.round(primeBlocks.reduce((s, b) => s + b.utilization, 0) / primeBlocks.length) : 0;
        stats.averageUtilization   = blocks.value.length  > 0 ? Math.round(blocks.value.reduce((s, b) => s + b.utilization, 0) / blocks.value.length) : 0;
      }
    } catch (error: any) {
      logger.warn('Failed to get workflow stats:', error?.message);
    }

    const response: ApiResponse<typeof stats> = { success: true, data: stats };
    res.json(response);
  })
);

// ── CRUD ──────────────────────────────────────────────────────────────────────

router.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const page       = parseInt(req.query.page   as string) || 1;
    const limit      = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const status     = req.query.status as 'draft' | 'published' | 'archived' | undefined;

    let workflows: GHLWorkflow[] = [];
    let total = 0;

    try {
      const workflowsResponse = await ghlClient.getWorkflows({ limit, page, locationId, status });
      workflows = workflowsResponse.workflows || [];
      total     = workflowsResponse.meta?.total || workflows.length;
    } catch (error: any) {
      logger.warn('Failed to fetch workflows from GHL API:', error?.message);
    }

    const response: ApiResponse<GHLWorkflow[]> = {
      success: true,
      data: workflows,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1, hasNextPage: false, hasPrevPage: page > 1 } as PaginationMeta,
    };

    res.setHeader('X-Total-Count', total.toString());
    res.json(response);
  })
);

router.post(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    await setupLocationToken(req);
    const workflowData = req.body;
    if (!workflowData.name) throw Errors.BadRequest('Workflow name is required');

    const workflow = await ghlClient.createWorkflow(workflowData);
    const response: ApiResponse<GHLWorkflow> = { success: true, data: workflow };
    res.status(201).json(response);
  })
);

router.get(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const locationId = await setupLocationToken(req);
    const { id }     = req.params;
    if (!id) throw Errors.BadRequest('Workflow ID is required');

    const workflow = await ghlClient.getWorkflow(id, locationId);
    const response: ApiResponse<GHLWorkflow> = { success: true, data: workflow };
    res.json(response);
  })
);

router.put(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    await setupLocationToken(req);
    const { id } = req.params;
    if (!id) throw Errors.BadRequest('Workflow ID is required');

    const workflow = await ghlClient.updateWorkflow(id, req.body);
    const response: ApiResponse<GHLWorkflow> = { success: true, data: workflow };
    res.json(response);
  })
);

router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    await setupLocationToken(req);
    const { id } = req.params;
    if (!id) throw Errors.BadRequest('Workflow ID is required');

    await ghlClient.deleteWorkflow(id);
    const response: ApiResponse<{ deleted: boolean }> = { success: true, data: { deleted: true } };
    res.json(response);
  })
);

export default router;
