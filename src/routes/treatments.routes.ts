import { Router, Request, Response } from 'express';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { ApiResponse, PaginationMeta, GHLTreatment } from '../types';
import { logger } from '../utils/logger';

const router = Router();

/**
 * @route   GET /api/treatments
 * @desc    Get all treatments with filtering
 * @access  Private
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const locationId = req.query.locationId as string | undefined;
    const category = req.query.category as string | undefined;
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

    let treatments: GHLTreatment[] = [];
    let total = 0;

    try {
      logger.info('Fetching treatments with params:', { locationId, category, limit, page });

      const treatmentsResponse = await ghlClient.getTreatments({
        limit,
        page,
        locationId,
        category,
        isActive,
      });

      treatments = treatmentsResponse.treatments || [];
      total = treatmentsResponse.meta?.total || treatments.length;
    } catch (error: any) {
      logger.warn('Failed to fetch treatments from GHL API, returning empty array:', error?.message);
    }

    const response: ApiResponse<GHLTreatment[]> = {
      success: true,
      data: treatments,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      } as PaginationMeta,
    };

    res.setHeader('X-Total-Count', total.toString());
    res.json(response);
  })
);

/**
 * @route   GET /api/treatments/:id
 * @desc    Get single treatment by ID
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
      throw Errors.BadRequest('Treatment ID is required');
    }

    const treatment = await ghlClient.getTreatment(id, locationId);

    if (!treatment) {
      throw Errors.NotFound('Treatment not found');
    }

    const response: ApiResponse<GHLTreatment> = {
      success: true,
      data: treatment,
    };

    res.json(response);
  })
);

/**
 * @route   POST /api/treatments
 * @desc    Create a new treatment
 * @access  Private
 */
router.post(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const treatmentData = req.body;

    // Validate required fields
    if (!treatmentData.name) {
      throw Errors.BadRequest('Treatment name is required');
    }
    if (!treatmentData.category) {
      throw Errors.BadRequest('Category is required');
    }
    if (treatmentData.price === undefined || treatmentData.price === null) {
      throw Errors.BadRequest('Price is required');
    }
    if (!treatmentData.duration_minutes) {
      throw Errors.BadRequest('Duration is required');
    }

    const treatment = await ghlClient.createTreatment(treatmentData);

    const response: ApiResponse<GHLTreatment> = {
      success: true,
      data: treatment,
    };

    res.status(201).json(response);
  })
);

/**
 * @route   PUT /api/treatments/:id
 * @desc    Update an existing treatment
 * @access  Private
 */
router.put(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const { id } = req.params;
    const treatmentData = req.body;
    const locationId = req.query.locationId as string | undefined;

    if (!id) {
      throw Errors.BadRequest('Treatment ID is required');
    }

    const treatment = await ghlClient.updateTreatment(id, treatmentData, locationId);

    const response: ApiResponse<GHLTreatment> = {
      success: true,
      data: treatment,
    };

    res.json(response);
  })
);

/**
 * @route   DELETE /api/treatments/:id
 * @desc    Delete a treatment
 * @access  Private
 */
router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const { id } = req.params;
    const locationId = req.query.locationId as string | undefined;

    if (!id) {
      throw Errors.BadRequest('Treatment ID is required');
    }

    await ghlClient.deleteTreatment(id, locationId);

    const response: ApiResponse<null> = {
      success: true,
      data: null,
    };

    res.json(response);
  })
);

export default router;
