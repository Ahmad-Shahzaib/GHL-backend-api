import { Router, Request, Response } from 'express';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { ApiResponse, PaginationMeta, GHLUser } from '../types';
import { logger } from '../utils/logger';

const router = Router();

/**
 * @route   GET /api/users
 * @desc    Get all users with pagination
 * @access  Private
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const locationId = req.query.locationId as string | undefined;
    
    const usersResponse = await ghlClient.getUsers({
      limit,
      page,
      locationId,
    });
    
    const users = usersResponse.users || [];
    const total = usersResponse.meta?.total || users.length;
    
    const response: ApiResponse<GHLUser[]> = {
      success: true,
      data: users,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: !!usersResponse.meta?.nextPageUrl,
        hasPrevPage: page > 1,
      } as PaginationMeta,
    };
    
    // Add pagination headers
    res.setHeader('X-Total-Count', total.toString());
    res.setHeader('X-Page-Count', Math.ceil(total / limit).toString());
    
    res.json(response);
  })
);

/**
 * @route   GET /api/users/:id
 * @desc    Get user by ID
 * @access  Private
 */
router.get(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    
    if (!id) {
      throw Errors.BadRequest('User ID is required');
    }
    
    const user = await ghlClient.getUser(id);
    
    const response: ApiResponse<GHLUser> = {
      success: true,
      data: user,
    };
    
    res.json(response);
  })
);

/**
 * @route   GET /api/users/me/details
 * @desc    Get detailed info about current user from GHL
 * @access  Private
 */
router.get(
  '/me/details',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;

    if (!userId) {
      throw Errors.BadRequest('User ID not available');
    }

    const user = await ghlClient.getUser(userId);

    const response: ApiResponse<GHLUser> = {
      success: true,
      data: user,
    };

    res.json(response);
  })
);

/**
 * @route   POST /api/users
 * @desc    Create a new user
 * @access  Private
 */
router.post(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    ghlClient.setApiKey(req.ghlToken!);
    const userData = req.body;

    // Validate required fields
    if (!userData.firstName) {
      throw Errors.BadRequest('First name is required');
    }
    if (!userData.lastName) {
      throw Errors.BadRequest('Last name is required');
    }
    if (!userData.email) {
      throw Errors.BadRequest('Email is required');
    }
    if (!userData.password) {
      throw Errors.BadRequest('Password is required');
    }

    try {
      const user = await ghlClient.createUser(userData);

      const response: ApiResponse<GHLUser> = {
        success: true,
        data: user,
      };

      res.status(201).json(response);
    } catch (error: any) {
      logger.error('Failed to create user in GHL:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      
      // Return the actual GHL error message
      const ghlError = error.response?.data?.message || error.message;
      throw Errors.BadRequest(`Failed to create user: ${ghlError}`);
    }
  })
);

export default router;
