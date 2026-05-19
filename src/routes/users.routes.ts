import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { ghlClient } from '../services/ghlClient';
import { authenticate } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { ApiResponse, GHLUser } from '../types';
import { logger } from '../utils/logger';
import { User } from '../models/User';

const router = Router();

/**
 * @route   GET /api/users (LOCAL DB - for superadmin user management)
 * @desc    Get all users from local database (superadmin only)
 * @access  Private - Superadmin only
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    // Check if user is superadmin
    if (req.user?.role !== 'superadmin') {
      throw Errors.Forbidden('Only superadmin can access this endpoint');
    }

    const users = await User.find().lean();

    const response: ApiResponse<any[]> = {
      success: true,
      data: users || [],
    };

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
    const userData = { ...req.body };

    // Some clients provide a single display name. Keep creation resilient.
    userData.firstName = String(userData.firstName || '').trim();
    userData.lastName = String(userData.lastName || '').trim() || userData.firstName || 'Provider';

    // Validate required fields
    if (!userData.firstName) {
      throw Errors.BadRequest('First name is required');
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

/**
 * @route   POST /api/users (LOCAL DB - for superadmin user creation)
 * @desc    Create a new local user (superadmin only)
 * @access  Private - Superadmin only
 */
router.post(
  '/admin/create',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    if (req.user?.role !== 'superadmin') {
      throw Errors.Forbidden('Only superadmin can create users');
    }

    const {
      email,
      fullName,
      companyName,
      phone,
      desiredLocationName,
      siteName,
      address,
      city,
      state,
      postalCode,
      country,
      locationId,
      companyId,
      plan,
      status,
      isActive,
      password,
    } = req.body;

    if (!email || !fullName) {
      throw Errors.BadRequest('Email and Full Name are required');
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw Errors.BadRequest('User with this email already exists');
    }

    const user = new User({
      email,
      fullName,
      companyName,
      phone,
      desiredLocationName: (desiredLocationName ?? siteName ?? companyName ?? '').toString().trim(),
      address: address ?? null,
      city: city ?? null,
      state: state ?? null,
      postalCode: postalCode ?? null,
      country: country ?? null,
      locationId: locationId ?? null,
      companyId: companyId ?? 'K9bORvG0pKtvt7QO4R9B',
      plan,
      status: status ?? 'active',
      role: 'user',
      isActive: isActive ?? true,
    });

    if (password) {
      if (String(password).length < 8) {
        throw Errors.BadRequest('Password must be at least 8 characters');
      }
      user.passwordHash = await bcrypt.hash(String(password), 12);
    }

    await user.save();

    const response: ApiResponse<any> = {
      success: true,
      data: user.toObject(),
    };

    res.status(201).json(response);
  })
);

/**
 * @route   PUT /api/users/:id (LOCAL DB - for superadmin user update)
 * @desc    Update local user (superadmin only)
 * @access  Private - Superadmin only
 */
router.put(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    if (req.user?.role !== 'superadmin') {
      throw Errors.Forbidden('Only superadmin can update users');
    }

    const { id } = req.params;
    const {
      email,
      fullName,
      companyName,
      phone,
      desiredLocationName,
      siteName,
      address,
      city,
      state,
      postalCode,
      country,
      locationId,
      companyId,
      plan,
      status,
      isActive,
      role,
      password,
    } = req.body;

    const user = await User.findById(id);
    if (!user) {
      throw Errors.NotFound('User not found');
    }

    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser && existingUser._id.toString() !== id) {
        throw Errors.BadRequest('User with this email already exists');
      }
      user.email = email;
    }

    if (fullName !== undefined) user.fullName = fullName;
    if (companyName !== undefined) user.companyName = companyName;
    if (phone !== undefined) user.phone = phone;
    if (desiredLocationName !== undefined || siteName !== undefined) {
      user.desiredLocationName = (desiredLocationName ?? siteName ?? '').toString().trim();
    }
    if (address !== undefined) user.address = address;
    if (city !== undefined) user.city = city;
    if (state !== undefined) user.state = state;
    if (postalCode !== undefined) user.postalCode = postalCode;
    if (country !== undefined) user.country = country;
    if (locationId !== undefined) user.locationId = locationId;
    if (companyId !== undefined) user.companyId = companyId;
    if (plan !== undefined) user.plan = plan;
    if (status !== undefined) user.status = status;
    if (isActive !== undefined) user.isActive = isActive;
    if (role !== undefined) user.role = role;

    if (password !== undefined && String(password).trim() !== '') {
      if (String(password).length < 8) {
        throw Errors.BadRequest('Password must be at least 8 characters');
      }
      user.passwordHash = await bcrypt.hash(String(password), 12);
      user.passwordSetToken = null;
      user.passwordSetTokenExpiry = null;
      user.passwordResetToken = null;
      user.passwordResetTokenExpiry = null;
    }

    await user.save();

    const response: ApiResponse<any> = {
      success: true,
      data: user.toObject(),
    };

    res.json(response);
  })
);

/**
 * @route   DELETE /api/users/:id (LOCAL DB - for superadmin user deletion)
 * @desc    Delete a local user (superadmin only)
 * @access  Private - Superadmin only
 */
router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    if (req.user?.role !== 'superadmin') {
      throw Errors.Forbidden('Only superadmin can delete users');
    }

    const { id } = req.params;

    const result = await User.findByIdAndDelete(id);
    if (!result) {
      throw Errors.NotFound('User not found');
    }

    const response: ApiResponse<any> = {
      success: true,
      data: { message: 'User deleted successfully' },
    };

    res.json(response);
  })
);

export default router;
