// GoHighLevel API Types

// OAuth Token Response
export interface GHLTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  userType: string;
  companyId?: string;
  locationId?: string;
  userId?: string;
}

// OAuth Token Request
export interface GHLTokenRequest {
  client_id: string;
  client_secret: string;
  grant_type: 'authorization_code' | 'refresh_token';
  code?: string;
  refresh_token?: string;
  user_type: 'Company' | 'Location';
  redirect_uri: string;
}

// Location/User Info
export interface GHLLocation {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  website?: string;
  timezone?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  business?: {
    name: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    website?: string;
    timezone?: string;
  };
}

// Contact
export interface GHLContact {
  id: string;
  locationId: string;
  contactName?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  dnd?: boolean;
  type?: string;
  source?: string;
  assignedTo?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  address1?: string;
  dateAdded?: string;
  dateUpdated?: string;
  tags?: string[];
  customFields?: Record<string, any>;
}

// Contacts Response
export interface GHLContactsResponse {
  contacts: GHLContact[];
  meta?: {
    total: number;
    nextPageUrl?: string;
    startAfterId?: string;
    startAfter?: number;
    currentPage?: number;
    nextPage?: number;
    prevPage?: number;
  };
}

// Opportunity/Pipeline
export interface GHLOpportunity {
  id: string;
  name: string;
  monetaryValue?: number;
  pipelineId?: string;
  stageId?: string;
  status?: string;
  source?: string;
  locationId?: string;
  contactId?: string;
  assignedTo?: string;
  dateAdded?: string;
  dateUpdated?: string;
  dateStatusChanged?: string;
}

// Opportunities Response
export interface GHLOpportunitiesResponse {
  opportunities: GHLOpportunity[];
  meta?: {
    total: number;
    nextPageUrl?: string;
    startAfterId?: string;
    startAfter?: number;
    currentPage?: number;
    nextPage?: number;
    prevPage?: number;
  };
}

// Calendar
export interface GHLCalendar {
  id: string;
  name: string;
  description?: string;
  locationId?: string;
  teamMembers?: string[];
  eventType?: string;
  slotDuration?: number;
  slotInterval?: number;
  preBuffer?: number;
  postBuffer?: number;
}

// Appointment
export interface GHLAppointment {
  id: string;
  calendarId: string;
  locationId: string;
  contactId?: string;
  status: string;
  title: string;
  startTime: string;
  endTime: string;
  assignedUserId?: string;
  notes?: string;
}

// User
export interface GHLUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  permissions?: string[];
  roles?: {
    type: string;
    role?: string;
    locationIds?: string[];
  };
  dateAdded?: string;
  dateUpdated?: string;
}

// Users Response
export interface GHLUsersResponse {
  users: GHLUser[];
  meta?: {
    total: number;
    nextPageUrl?: string;
    startAfterId?: string;
    startAfter?: number;
    currentPage?: number;
    nextPage?: number;
    prevPage?: number;
  };
}

// Dashboard Stats
export interface GHLDashboardStats {
  totalContacts: number;
  totalOpportunities: number;
  totalOpportunityValue: number;
  totalAppointments: number;
  recentContacts: GHLContact[];
  recentOpportunities: GHLOpportunity[];
  pipelineSummary: {
    pipelineId: string;
    pipelineName: string;
    stageCounts: Record<string, number>;
    totalValue: number;
  }[];
}

// API Error Response
export interface GHLApiError {
  status: number;
  message: string;
  error?: string;
  details?: any;
}

// Webhook Payload
export interface GHLWebhookPayload {
  type: string;
  appId: string;
  versionId: string;
  installType: string;
  locationId: string;
  companyId: string;
  userId: string;
  companyName: string;
  isWhitelabelCompany: boolean;
  whitelabelDetails?: {
    logoUrl: string;
    domain: string;
  };
  timestamp: string;
  webhookId: string;
}

// Stored Token Data
export interface StoredTokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  userType: string;
  companyId?: string;
  locationId?: string;
  userId?: string;
}
