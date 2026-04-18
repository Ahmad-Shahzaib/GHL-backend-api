import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Errors, APIError } from './errorHandler';
import { AuthUser } from '../types';
import { config } from '../config';
import { User } from '../models/User';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      ghlToken?: string;
    }
  }
}

export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw Errors.Unauthorized('Authorization header missing or invalid');
    }

    const token = authHeader.substring(7);
    if (!token) throw Errors.Unauthorized('Token not provided');

    const payload = jwt.verify(token, config.JWT_SECRET) as {
      userId: string;
    };

    const dbUser = await User.findById(payload.userId);
    if (!dbUser || !dbUser.isActive) {
      throw Errors.Unauthorized('User not found or inactive');
    }

    req.user = {
      id: dbUser._id.toString(),
      email: dbUser.email,
      locationId: dbUser.locationId ?? undefined,
      companyId: dbUser.companyId,
      permissions: ['*'],
    };

    // Pass admin API key as ghlToken for all dashboard routes
    req.ghlToken = config.GHL_ADMIN_API_KEY;

    next();
  } catch (error) {
    if (error instanceof APIError) {
      next(error);
    } else {
      next(Errors.Unauthorized('Invalid or expired token'));
    }
  }
};

export const optionalAuth = (
  _req: Request,
  _res: Response,
  next: NextFunction
): void => next();

export const requirePermission =
  (..._perms: string[]) =>
  (_req: Request, _res: Response, next: NextFunction): void =>
    next();

export const requireRole =
  (..._roles: string[]) =>
  (_req: Request, _res: Response, next: NextFunction): void =>
    next();