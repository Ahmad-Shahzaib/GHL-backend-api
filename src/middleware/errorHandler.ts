import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';

/**
 * Custom API Error class
 */
export class APIError extends Error {
  public statusCode: number;
  public code: string;
  public details?: any;
  
  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR', details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = 'APIError';
    
    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Common error types
 */
export const Errors = {
  BadRequest: (message: string = 'Bad Request', details?: any) => 
    new APIError(message, 400, 'BAD_REQUEST', details),
    
  Unauthorized: (message: string = 'Unauthorized') => 
    new APIError(message, 401, 'UNAUTHORIZED'),
    
  Forbidden: (message: string = 'Forbidden') => 
    new APIError(message, 403, 'FORBIDDEN'),
    
  NotFound: (message: string = 'Resource not found') => 
    new APIError(message, 404, 'NOT_FOUND'),
    
  Conflict: (message: string = 'Conflict') => 
    new APIError(message, 409, 'CONFLICT'),
    
  ValidationError: (message: string = 'Validation failed', details?: any) => 
    new APIError(message, 422, 'VALIDATION_ERROR', details),
    
  TooManyRequests: (message: string = 'Too many requests') => 
    new APIError(message, 429, 'TOO_MANY_REQUESTS'),
    
  InternalError: (message: string = 'Internal server error') => 
    new APIError(message, 500, 'INTERNAL_ERROR'),
    
  ServiceUnavailable: (message: string = 'Service unavailable') => 
    new APIError(message, 503, 'SERVICE_UNAVAILABLE'),
};

/**
 * Global error handler middleware
 */
export const errorHandler = (
  err: Error | APIError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Default error values
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details: any = undefined;
  
  // Handle APIError instances
  if (err instanceof APIError) {
    statusCode = err.statusCode;
    errorCode = err.code;
    message = err.message;
    details = err.details;
  } 
  // Handle JWT errors
  else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorCode = 'INVALID_TOKEN';
    message = 'Invalid authentication token';
  } 
  else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    errorCode = 'TOKEN_EXPIRED';
    message = 'Authentication token has expired';
  }
  // Handle Axios errors (from GHL API)
  else if (err.name === 'AxiosError' || (err as any).isAxiosError) {
    const axiosError = err as any;
    statusCode = axiosError.response?.status || 500;
    errorCode = 'EXTERNAL_API_ERROR';
    message = axiosError.response?.data?.message || 'External API request failed';
    details = axiosError.response?.data;
  }
  
  // Log error
  if (statusCode >= 500) {
    logger.error('Server error:', {
      error: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
    });
  } else {
    logger.warn('Client error:', {
      statusCode,
      errorCode,
      message,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
    });
  }
  
  // Send response
  const response: ApiResponse<never> = {
    success: false,
    error: {
      code: errorCode,
      message,
      details,
    },
  };
  
  res.status(statusCode).json(response);
};

/**
 * Async handler wrapper to catch errors in async route handlers
 */
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * 404 Not Found handler
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  const response: ApiResponse<never> = {
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.originalUrl} not found`,
    },
  };
  
  res.status(404).json(response);
};
