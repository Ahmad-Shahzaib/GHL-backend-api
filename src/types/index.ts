export * from './gohighlevel.types';

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: PaginationMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: any;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

// Request Types
export interface PaginationParams {
  page?: number;
  limit?: number;
  startAfter?: string;
  order?: 'asc' | 'desc';
  sortBy?: string;
}

export interface ContactFilterParams extends PaginationParams {
  query?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  assignedTo?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface OpportunityFilterParams extends PaginationParams {
  pipelineId?: string;
  stageId?: string;
  status?: string;
  assignedTo?: string;
  dateFrom?: string;
  dateTo?: string;
}

// Auth Types
export interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  locationId?: string;
  companyId?: string;
  permissions: string[];
}

export interface JWTPayload {
  userId: string;
  email: string;
  locationId?: string;
  companyId?: string;
  iat: number;
  exp: number;
}
