import { Router, Request, Response } from 'express';
import { authService } from '../services/authService';
import { authenticate } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { authRateLimiter } from '../middleware/security';
import { ApiResponse } from '../types';
import { logger } from '../utils/logger';
import { User } from '../models/User';

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
 * @route   POST /api/auth/register
 * @desc    Register a pending clinic user and save to MongoDB
 * @access  Public
 */
router.post(
  '/register',
  authRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const {
      email,
      fullName,
      companyName,
      phone,
      desiredLocationName,
      plan,
      address,
      city,
      state,
      postalCode,
      country,
    } = req.body;

    if (!email || !fullName || !companyName || !phone || !desiredLocationName || !plan) {
      throw Errors.BadRequest('Missing required registration fields');
    }

    const user = await authService.createPendingUser({
      email,
      fullName,
      companyName,
      phone,
      desiredLocationName,
      plan,
      address,
      city,
      state,
      postalCode,
      country,
    });

    const response: ApiResponse<{ userId: string }> = {
      success: true,
      data: { userId: user._id.toString() },
    };

    res.json(response);
  })
);

/**
 * @route   POST /api/auth/checkout-session
 * @desc    Create a Stripe checkout session for a pending user
 * @access  Public
 */
router.post(
  '/checkout-session',
  authRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.body;
    if (!userId) throw Errors.BadRequest('userId is required');

    const { url, sessionId } = await authService.createCheckoutSession(userId);

    const response: ApiResponse<{ url: string; sessionId: string }> = {
      success: true,
      data: { url, sessionId },
    };

    res.json(response);
  })
);

/**
 * @route   GET /api/auth/payment-success
 * @desc    Complete payment and activate the pending user
 * @access  Public
 */
router.get(
  '/payment-success',
  asyncHandler(async (req: Request, res: Response) => {
    const { session_id } = req.query;
    if (!session_id || typeof session_id !== 'string') {
      throw Errors.BadRequest('Stripe session_id is required');
    }

    const user = await authService.confirmPayment(session_id);

    const response: ApiResponse<{ user: { id: string; email: string; locationId: string | null } }> = {
      success: true,
      data: {
        user: {
          id: user._id.toString(),
          email: user.email,
          locationId: user.locationId,
        },
      },
    };

    res.json(response);
  })
);

/**
 * @route   POST /api/auth/login
 * @desc    Login with email and password
 * @access  Public
 */
router.post(
  '/login',
  authRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) throw Errors.BadRequest('Email and password required');

    const { token, user } = await authService.login(email, password);

    const response: ApiResponse<{ token: string; user: { id: string; email: string; locationId?: string; plan: string } }> = {
      success: true,
      data: {
        token,
        user: {
          id: user._id.toString(),
          email: user.email,
          locationId: user.locationId ?? undefined,
          plan: user.plan,
        },
      },
    };

    res.json(response);
  })
);

/**
 * @route   POST /api/auth/set-password
 * @desc    Set a new password from welcome email token
 * @access  Public
 */
router.post(
  '/set-password',
  asyncHandler(async (req: Request, res: Response) => {
    const { token, password } = req.body;
    if (!token || !password) throw Errors.BadRequest('Token and password required');
    if (password.length < 8) throw Errors.BadRequest('Password must be at least 8 characters');

    const result = await authService.setPassword(token, password);

    const response: ApiResponse<{ token: string; user: { id: string; email: string; locationId: string | null; plan: string } }> = {
      success: true,
      data: result,
    };

    res.json(response);
  })
);

/**
 * @route   POST /api/auth/forgot
 * @desc    Request a password reset email
 * @access  Public
 */
router.post(
  '/forgot',
  authRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) throw Errors.BadRequest('Email required');

    await authService.forgotPassword(email);

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: {
        message: 'If that email exists, a reset link has been sent.',
      },
    };

    res.json(response);
  })
);

/**
 * @route   POST /api/auth/reset
 * @desc    Reset password using a password reset token
 * @access  Public
 */
router.post(
  '/reset',
  asyncHandler(async (req: Request, res: Response) => {
    const { token, password } = req.body;
    if (!token || !password) throw Errors.BadRequest('Token and password required');

    await authService.resetPassword(token, password);

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: {
        message: 'Password reset successfully',
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

/**
 * @route   POST /api/auth/pre-register
 * @desc    Save email before Stripe/GHL SaaS payment redirect
 * @access  Public
 */
router.post(
  '/pre-register',
  asyncHandler(async (req: Request, res: Response) => {
    const { email, plan, fullName, companyName, phone, desiredLocationName } = req.body;
    if (!email) throw Errors.BadRequest('Email is required');

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      // Update their info if they're still pending
      if (existing.status === 'pending') {
        if (fullName)    existing.fullName    = fullName;
        if (companyName) existing.companyName = companyName;
        if (phone)       existing.phone       = phone;
        if (desiredLocationName) existing.desiredLocationName = desiredLocationName;
        await existing.save();
      }
      const response: ApiResponse<{ saved: boolean }> = { success: true, data: { saved: true } };
      return res.json(response);
    }

    const crypto = require('crypto');
    const passwordSetToken = crypto.randomBytes(32).toString('hex');

    await User.create({
      email:                  email.toLowerCase(),
      fullName:               fullName               || '',
      companyName:            companyName            || '',
      phone:                  phone                  || '',
      desiredLocationName:    desiredLocationName    || companyName || '',
      plan:                   'basic',
      status:                 'pending',
      isActive:               false,
      companyId:              'K9bORvG0pKtvt7QO4R9B',
      locationId:             null,
      passwordSetToken,
      passwordSetTokenExpiry: new Date(Date.now() + 48 * 60 * 60 * 1000),
      passwordHash:           null,
    });

    logger.info(`Pre-registered email: ${email}`);
    const response: ApiResponse<{ saved: boolean }> = { success: true, data: { saved: true } };
    res.json(response);
  })
);

export default router;
