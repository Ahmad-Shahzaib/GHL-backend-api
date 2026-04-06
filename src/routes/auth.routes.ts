import { Router, Request, Response } from 'express';
import { authService } from '../services/authService';
import { authenticate } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { authRateLimiter } from '../middleware/security';
import { ApiResponse } from '../types';
import { logger } from '../utils/logger';

const router = Router();

/**
 * @route   GET /api/auth/ghl
 * @desc    Get GoHighLevel OAuth authorization URL
 * @access  Public
 */
router.get(
  '/ghl',
  asyncHandler(async (_req: Request, res: Response) => {
    const authUrl = authService.getAuthorizationUrl();
    
    const response: ApiResponse<{ authUrl: string }> = {
      success: true,
      data: { authUrl },
    };
    
    res.json(response);
  })
);

/**
 * @route   GET /api/auth/callback
 * @desc    Handle OAuth callback from GoHighLevel
 * @access  Public
 */
router.get(
  '/callback',
  authRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { code, error: oauthError, error_description } = req.query;
    
    // Handle OAuth errors
    if (oauthError) {
      logger.error('OAuth error:', { error: oauthError, description: error_description });
      throw Errors.BadRequest(
        `OAuth error: ${oauthError}`,
        { description: error_description }
      );
    }
    
    if (!code || typeof code !== 'string') {
      throw Errors.BadRequest('Authorization code is required');
    }
    
    // Exchange code for tokens
    const result = await authService.handleOAuthCallback(code, 'Location');
    
    const response: ApiResponse<{
      token: string;
      user: {
        id: string;
        email: string;
        firstName?: string;
        lastName?: string;
        locationId?: string;
        companyId?: string;
      };
    }> = {
      success: true,
      data: {
        token: result.token,
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          locationId: result.user.locationId,
          companyId: result.user.companyId,
        },
      },
    };
    
    res.json(response);
  })
);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user and revoke tokens
 * @access  Private
 */
router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const tokenKey = req.user?.locationId || req.user?.id;
    
    if (tokenKey) {
      await authService.logout(tokenKey);
    }
    
    const response: ApiResponse<null> = {
      success: true,
      data: null,
      meta: {
        message: 'Logged out successfully',
      } as any,
    };
    
    res.json(response);
  })
);

/**
 * @route   GET /api/auth/me
 * @desc    Get current authenticated user info
 * @access  Private
 */
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const response: ApiResponse<{
      id: string;
      email: string;
      locationId?: string;
      companyId?: string;
    }> = {
      success: true,
      data: {
        id: req.user!.id,
        email: req.user!.email,
        locationId: req.user!.locationId,
        companyId: req.user!.companyId,
      },
    };
    
    res.json(response);
  })
);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh GHL access token
 * @access  Private
 */
router.post(
  '/refresh',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const tokenKey = req.user?.locationId || req.user?.id;
    
    if (!tokenKey) {
      throw Errors.BadRequest('Unable to refresh token');
    }
    
    const refreshed = await authService.ensureValidGHLToken(tokenKey);
    
    if (!refreshed) {
      throw Errors.Unauthorized('Failed to refresh token. Please reconnect your account.');
    }
    
    const response: ApiResponse<{ refreshed: boolean }> = {
      success: true,
      data: { refreshed: true },
    };
    
    res.json(response);
  })
);

export default router;
