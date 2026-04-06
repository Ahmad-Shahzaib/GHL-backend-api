import { Request, Response, NextFunction } from 'express';
import { Errors, APIError } from './errorHandler';
import { AuthUser } from '../types';

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

    // Store token on request for use in routes
    req.ghlToken = token;

    req.user = {
      id: 'api-key-user',
      email: 'api@clinic-engine.com',
      locationId: process.env.GHL_LOCATION_ID || '',
      companyId: '',
      permissions: ['*'],
    };

    next();
  } catch (error) {
    if (error instanceof APIError) {
      next(error);
    } else {
      next(Errors.Unauthorized('Authentication failed'));
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