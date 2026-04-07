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
  appointmentLocation?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Appointments Response
export interface GHLAppointmentsResponse {
  events: GHLAppointment[];
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

// Calendar Resource (Room/Equipment)
export interface GHLResource {
  id: string;
  name: string;
  locationId?: string;
  resourceType?: 'room' | 'equipment';
  capacity?: number;
  description?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Resources Response
export interface GHLResourcesResponse {
  resources: GHLResource[];
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

// Room Utilization Heatmap Types
export interface RoomHeatmapCell {
  booked: number;
  revenue: number;
}

export interface RoomHeatmapData {
  room: string;
  hours: Record<string, RoomHeatmapCell>; // hour (8-19) -> cell data
  totalBooked: number;
  totalRevenue: number;
  utilPct: number;
}

export interface RoomUtilizationHeatmap {
  rooms: string[];
  hours: number[]; // 8am-7pm (8-19)
  data: RoomHeatmapData[];
  uniqueDays: number;
  startDate?: string;
  endDate?: string;
}

export interface RoomHeatmapQueryParams {
  locationId?: string;
  startDate?: string; // ISO date string
  endDate?: string; // ISO date string
  hours?: number[]; // Optional: filter specific hours
}

// Workflow Types
export interface GHLWorkflow {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  locationId?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  version?: number;
  steps?: GHLWorkflowStep[];
  triggers?: GHLWorkflowTrigger[];
  description?: string;
  folderId?: string;
  isActive?: boolean;
}

export interface GHLWorkflowStep {
  id: string;
  type: string;
  name: string;
  config?: Record<string, any>;
  nextStepId?: string | null;
  prevStepId?: string | null;
  branchConditions?: GHLWorkflowBranchCondition[];
  isStart?: boolean;
}

export interface GHLWorkflowTrigger {
  id: string;
  type: string;
  name: string;
  config?: Record<string, any>;
  eventType?: string;
  filters?: Record<string, any>;
}

export interface GHLWorkflowBranchCondition {
  id: string;
  condition: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'exists';
  value?: any;
  field?: string;
  nextStepId?: string;
}

export interface GHLWorkflowsResponse {
  workflows: GHLWorkflow[];
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

export interface WorkflowOptimizationRule {
  id: string;
  type: 'prime_hour_protection' | 'buffer_logic' | 'capacity_routing' | 'provider_stability';
  name: string;
  description: string;
  isActive: boolean;
  priority: number;
  config: Record<string, any>;
}

export interface WorkflowSchedulingViolation {
  id: string;
  type: 'prime_hour_violation' | 'buffer_violation' | 'capacity_conflict' | 'provider_switch_exceeded';
  detail: string;
  room?: string;
  revenue?: number;
  appointmentId?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detectedAt: string;
}

export interface WorkflowScheduleBlock {
  hour: number;
  label: string;
  isPrime: boolean;
  total: number;
  highTicket: number;
  lowTicket: number;
  utilization: number;
}

// KPI Dashboard Types
export interface KpiThresholds {
  green: number;
  yellow: number;
}

export interface KpiMetric {
  label: string;
  value: number;
  unit: string;
  status: 'green' | 'yellow' | 'red';
  statusLabel: string;
  description: string;
  target: string;
  kpiKey: string;
}

export interface PipelineStageMetric {
  stageId: string;
  stageName: string;
  count: number;
  totalValue: number;
  avgValue: number;
}

export interface PipelineKpiData {
  pipelineId: string;
  pipelineName: string;
  totalItems: number;
  totalValue: number;
  avgValue: number;
  stages: PipelineStageMetric[];
  wonCount: number;
  wonValue: number;
  lostCount: number;
  lostValue: number;
  openCount: number;
  openValue: number;
  winRate: number;
}

export interface KpiDashboardData {
  // Core KPIs
  conversionRate: number;
  avgOpportunityValue: number;
  pipelineGap: number;
  avgRevenuePerHour: number;
  profitDensity: number;
  
  // Summary Stats
  totalContacts: number;
  totalOpportunities: number;
  totalPipelineValue: number;
  totalAppointments: number;
  totalRevenue: number;
  
  // Computed Metrics with Status
  metrics: KpiMetric[];
  
  // Pipeline Analytics
  pipelineStats: PipelineKpiData[];
  
  // Trend Data (for charts)
  contactsTrend: { date: string; count: number }[];
  opportunitiesTrend: { date: string; count: number; value: number }[];
  revenueTrend: { date: string; revenue: number }[];
  
  // System Health
  systemScore: number;
  healthStatus: 'excellent' | 'good' | 'needs_attention' | 'critical';
  
  // Time-based metrics
  avgTimeToClose: number; // in days
  leadVelocity: number; // leads per day
  opportunityVelocity: number; // opportunities created per day
  
  // Date range for data
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

// Reports Types
export interface ReportsData {
  // Current Performance Metrics
  currentAnnual: number;
  totalRevenue: number;
  totalAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  
  // Utilization Metrics
  avgUtilization: number;
  primeHourUtilization: number;
  idleTimePercentage: number;
  
  // Revenue Metrics
  avgRevenuePerAppointment: number;
  avgRevenuePerHour: number;
  avgRevenuePerDay: number;
  
  // Projection Metrics (based on optimization analysis)
  projections: {
    utilIncrease: number;       // Annual revenue increase from utilization improvement
    primeIncrease: number;      // Annual revenue increase from prime-hour optimization
    combinedLift: number;       // Total projected annual increase
    capacityIncrease: number;   // % increase in capacity
    idleReduction: number;      // % reduction in idle time
    primeHQIncrease: number;    // % increase in prime-hour high-ticket occupancy
    totalUpside: number;        // Total annual upside projection
  };
  
  // Success Metrics for tracking
  successMetrics: {
    metric: string;
    target: string;
    current: string;
    status: 'on_track' | 'needs_attention' | 'critical';
  }[];
  
  // Date range for the report
  dateRange: {
    startDate: string;
    endDate: string;
  };
  
  // Unique days analyzed
  uniqueDays: number;
}

export interface ReportsQueryParams {
  locationId?: string;
  startDate?: string;
  endDate?: string;
}

// Alert Types
export type AlertType = 'low_utilization' | 'prime_hour_low_ticket' | 'provider_idle' | 'high_demand_overflow' | 'equipment_underuse';
export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface GHLOptimizationAlert {
  id: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  title: string;
  description?: string;
  affected_resource?: string;
  recommended_action?: string;
  date: string;
  revenue_impact: number;
  is_resolved: boolean;
  resolved_at?: string;
  created_at: string;
  updated_at: string;
  locationId?: string;
  triggered_by?: string; // workflow_id, webhook, or manual
  metadata?: Record<string, any>;
}

export interface GHLOptimizationAlertsResponse {
  alerts: GHLOptimizationAlert[];
  meta?: {
    total: number;
    active: number;
    resolved: number;
    currentPage?: number;
    nextPage?: number;
    prevPage?: number;
  };
}

export interface AlertCreateRequest {
  alert_type: AlertType;
  severity: AlertSeverity;
  title: string;
  description?: string;
  affected_resource?: string;
  recommended_action?: string;
  date?: string;
  revenue_impact?: number;
  locationId?: string;
  triggered_by?: string;
  metadata?: Record<string, any>;
}

export interface AlertUpdateRequest {
  is_resolved?: boolean;
  severity?: AlertSeverity;
  title?: string;
  description?: string;
  affected_resource?: string;
  recommended_action?: string;
  revenue_impact?: number;
  metadata?: Record<string, any>;
}

export interface AlertStats {
  total: number;
  active: number;
  resolved: number;
  bySeverity: {
    critical: number;
    warning: number;
    info: number;
  };
  byType: Record<AlertType, number>;
  totalRevenueImpact: number;
}

// Treatment Types
export type TreatmentCategory = 'high_ticket' | 'mid_ticket' | 'low_ticket';

export interface GHLTreatment {
  id: string;
  name: string;
  category: TreatmentCategory;
  price: number;
  duration_minutes: number;
  required_equipment?: string[];
  required_room_type?: string;
  required_qualification?: string;
  prime_hour_eligible: boolean;
  revenue_per_hour?: number;
  description?: string;
  locationId?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface GHLTreatmentsResponse {
  treatments: GHLTreatment[];
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

export interface TreatmentCreateRequest {
  name: string;
  category: TreatmentCategory;
  price: number;
  duration_minutes: number;
  required_equipment?: string[];
  required_room_type?: string;
  required_qualification?: string;
  prime_hour_eligible?: boolean;
  description?: string;
  locationId?: string;
}

export interface TreatmentUpdateRequest {
  name?: string;
  category?: TreatmentCategory;
  price?: number;
  duration_minutes?: number;
  required_equipment?: string[];
  required_room_type?: string;
  required_qualification?: string;
  prime_hour_eligible?: boolean;
  description?: string;
  isActive?: boolean;
}
