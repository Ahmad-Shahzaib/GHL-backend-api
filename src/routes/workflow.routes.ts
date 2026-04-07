import { Router, Request, Response } from 'express';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { workflowRateLimiter } from '../middleware/security';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { ApiResponse, PaginationMeta, GHLWorkflow, WorkflowOptimizationRule, WorkflowSchedulingViolation, WorkflowScheduleBlock } from '../types';
import { logger } from '../utils/logger';

const router = Router();

/**
 * @route   GET /api/workflows
 * @desc    Get all workflows for a location
 * @access  Private
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const locationId = req.query.locationId as string | undefined;
    const status = req.query.status as 'draft' | 'published' | 'archived' | undefined;

    let workflows: GHLWorkflow[] = [];
    let total = 0;

    try {
      logger.info('Fetching workflows with params:', { locationId, limit, page, status });

      const workflowsResponse = await ghlClient.getWorkflows({
        limit,
        page,
        locationId,
        status,
      });

      workflows = workflowsResponse.workflows || [];
      total = workflowsResponse.meta?.total || workflows.length;
    } catch (error: any) {
      logger.warn('Failed to fetch workflows from GHL API, returning empty array:', error?.message);
      // Return empty array instead of erroring - the GHL API may not have this data or scope
    }

    const response: ApiResponse<GHLWorkflow[]> = {
      success: true,
      data: workflows,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasNextPage: false,
        hasPrevPage: page > 1,
      } as PaginationMeta,
    };

    res.setHeader('X-Total-Count', total.toString());
    res.json(response);
  })
);

/**
 * @route   GET /api/workflows/:id
 * @desc    Get single workflow by ID
 * @access  Private
 */
router.get(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const { id } = req.params;
    const locationId = req.query.locationId as string | undefined;

    if (!id) {
      throw Errors.BadRequest('Workflow ID is required');
    }

    const workflow = await ghlClient.getWorkflow(id, locationId);

    const response: ApiResponse<GHLWorkflow> = {
      success: true,
      data: workflow,
    };

    res.json(response);
  })
);

/**
 * @route   POST /api/workflows
 * @desc    Create a new workflow
 * @access  Private
 */
router.post(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const workflowData = req.body;

    if (!workflowData.name) {
      throw Errors.BadRequest('Workflow name is required');
    }

    const workflow = await ghlClient.createWorkflow(workflowData);

    const response: ApiResponse<GHLWorkflow> = {
      success: true,
      data: workflow,
    };

    res.status(201).json(response);
  })
);

/**
 * @route   PUT /api/workflows/:id
 * @desc    Update an existing workflow
 * @access  Private
 */
router.put(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const { id } = req.params;
    const workflowData = req.body;

    if (!id) {
      throw Errors.BadRequest('Workflow ID is required');
    }

    const workflow = await ghlClient.updateWorkflow(id, workflowData);

    const response: ApiResponse<GHLWorkflow> = {
      success: true,
      data: workflow,
    };

    res.json(response);
  })
);

/**
 * @route   DELETE /api/workflows/:id
 * @desc    Delete a workflow
 * @access  Private
 */
router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const { id } = req.params;

    if (!id) {
      throw Errors.BadRequest('Workflow ID is required');
    }

    await ghlClient.deleteWorkflow(id);

    const response: ApiResponse<{ deleted: boolean }> = {
      success: true,
      data: { deleted: true },
    };

    res.json(response);
  })
);

/**
 * @route   GET /api/workflows/rules/optimization
 * @desc    Get workflow optimization rules (Prime-Hour Protection, Buffer Logic, etc.)
 * @access  Private
 */
router.get(
  '/rules/optimization',
  authenticate,
  workflowRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const locationId = req.query.locationId as string | undefined;

    let rules: WorkflowOptimizationRule[] = [];

    try {
      rules = await ghlClient.getWorkflowOptimizationRules(locationId);
    } catch (error: any) {
      logger.warn('Failed to fetch optimization rules:', error?.message);
    }

    const response: ApiResponse<WorkflowOptimizationRule[]> = {
      success: true,
      data: rules,
    };

    res.json(response);
  })
);

/**
 * @route   PUT /api/workflows/rules/optimization
 * @desc    Update workflow optimization rules
 * @access  Private
 */
router.put(
  '/rules/optimization',
  authenticate,
  workflowRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const locationId = req.query.locationId as string | undefined;
    const rules = req.body as WorkflowOptimizationRule[];

    if (!Array.isArray(rules)) {
      throw Errors.BadRequest('Rules must be an array');
    }

    const updatedRules = await ghlClient.updateWorkflowOptimizationRules(rules, locationId);

    const response: ApiResponse<WorkflowOptimizationRule[]> = {
      success: true,
      data: updatedRules,
    };

    res.json(response);
  })
);

/**
 * @route   GET /api/workflows/analysis/violations
 * @desc    Analyze appointments for scheduling violations
 * @access  Private
 */
router.get(
  '/analysis/violations',
  authenticate,
  workflowRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const locationId = req.query.locationId as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    let violations: WorkflowSchedulingViolation[] = [];

    try {
      violations = await ghlClient.analyzeSchedulingViolations({
        locationId,
        startDate,
        endDate,
      });
    } catch (error: any) {
      logger.warn('Failed to analyze scheduling violations:', error?.message);
    }

    const response: ApiResponse<WorkflowSchedulingViolation[]> = {
      success: true,
      data: violations,
    };

    res.json(response);
  })
);

/**
 * @route   GET /api/workflows/schedule/blocks
 * @desc    Get hour-by-hour schedule blocks with analysis
 * @access  Private
 */
router.get(
  '/schedule/blocks',
  authenticate,
  workflowRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const locationId = req.query.locationId as string | undefined;
    const date = req.query.date as string | undefined;

    let blocks: WorkflowScheduleBlock[] = [];

    try {
      blocks = await ghlClient.getScheduleBlocks({
        locationId,
        date,
      });
    } catch (error: any) {
      logger.warn('Failed to get schedule blocks:', error?.message);
    }

    const response: ApiResponse<WorkflowScheduleBlock[]> = {
      success: true,
      data: blocks,
    };

    res.json(response);
  })
);

/**
 * @route   GET /api/workflows/stats/summary
 * @desc    Get workflow engine statistics summary
 * @access  Private
 */
router.get(
  '/stats/summary',
  authenticate,
  workflowRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const locationId = req.query.locationId as string | undefined;

    let stats = {
      totalWorkflows: 0,
      activeWorkflows: 0,
      totalViolations: 0,
      highSeverityViolations: 0,
      primeHourUtilization: 0,
      averageUtilization: 0,
    };

    try {
      // Get workflows count
      const workflowsResponse = await ghlClient.getWorkflows({
        locationId,
        limit: 1,
      });
      stats.totalWorkflows = workflowsResponse.meta?.total || 0;

      // Get active (published) workflows count
      const activeWorkflowsResponse = await ghlClient.getWorkflows({
        locationId,
        status: 'published',
        limit: 1,
      });
      stats.activeWorkflows = activeWorkflowsResponse.meta?.total || 0;

      // Get violations count
      const violations = await ghlClient.analyzeSchedulingViolations({ locationId });
      stats.totalViolations = violations.length;
      stats.highSeverityViolations = violations.filter(v => v.severity === 'high' || v.severity === 'critical').length;

      // Get schedule blocks for utilization
      const blocks = await ghlClient.getScheduleBlocks({ locationId });
      const primeBlocks = blocks.filter(b => b.isPrime);
      stats.primeHourUtilization = primeBlocks.length > 0
        ? Math.round(primeBlocks.reduce((sum, b) => sum + b.utilization, 0) / primeBlocks.length)
        : 0;
      stats.averageUtilization = blocks.length > 0
        ? Math.round(blocks.reduce((sum, b) => sum + b.utilization, 0) / blocks.length)
        : 0;

    } catch (error: any) {
      logger.warn('Failed to get workflow stats:', error?.message);
    }

    const response: ApiResponse<typeof stats> = {
      success: true,
      data: stats,
    };

    res.json(response);
  })
);

export default router;
