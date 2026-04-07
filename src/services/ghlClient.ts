import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { 
  GHLTokenResponse, 
  GHLTokenRequest, 
  GHLContactsResponse,
  GHLContact,
  GHLOpportunitiesResponse,
  GHLOpportunity,
  GHLUsersResponse,
  GHLUser,
  GHLLocation,
  StoredTokenData,
  GHLApiError,
  GHLDashboardStats,
  GHLAppointmentsResponse,
  GHLAppointment,
  GHLResource,
  GHLCalendar,
  RoomUtilizationHeatmap,
  RoomHeatmapQueryParams,
  KpiDashboardData,
  KpiMetric,
  PipelineKpiData,
  PipelineStageMetric,
  GHLWorkflow,
  GHLWorkflowsResponse,
  WorkflowOptimizationRule,
  WorkflowSchedulingViolation,
  WorkflowScheduleBlock,
  GHLOptimizationAlert,
  GHLOptimizationAlertsResponse,
  AlertCreateRequest,
  AlertUpdateRequest,
  AlertStats,
  GHLTreatment,
  GHLTreatmentsResponse,
  TreatmentCreateRequest,
  TreatmentUpdateRequest,
} from '../types';
import { config, GHL_OAUTH_URLS, GHL_API_ENDPOINTS, GHL_API_VERSION } from '../config';
import { tokenStore } from './tokenStore';
import { cacheService } from './cacheService';
import { workflowRulesService } from './workflowRulesService';
import { rateLimiterService } from './rateLimiterService';
import { logger } from '../utils/logger';

export class GHLClient {
  private axiosInstance: AxiosInstance;
  private tokenKey: string | null = null;
  private apiKey: string | null = null; // ← ADDED

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: config.GHL_BASE_URL,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Version': GHL_API_VERSION,
      },
    });

    this.axiosInstance.interceptors.request.use(
      (config) => {
        logger.debug(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('Request error:', error);
        return Promise.reject(error);
      }
    );

    this.axiosInstance.interceptors.response.use(
      (response) => {
        logger.debug(`API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      async (error: AxiosError) => {
        logger.error('API Error:', {
          status: error.response?.status,
          url: error.config?.url,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  setTokenKey(key: string): void {
    this.tokenKey = key;
  }

  // ← ADDED
  setApiKey(key: string): void {
    this.apiKey = key;
  }

getAuthorizationUrl(): string {
  const params = new URLSearchParams({
    client_id:     config.GHL_CLIENT_ID,
    redirect_uri:  config.GHL_REDIRECT_URI,
    response_type: 'code',
    user_type:     'Company',  // ← ADD THIS
  });
  return `${GHL_OAUTH_URLS.authorize}?${params.toString()}`;
}

 async exchangeCodeForToken(code: string, userType: 'Company' | 'Location' = 'Location'): Promise<GHLTokenResponse> {
  try {
    // GHL requires form-encoded data, not JSON
    const params = new URLSearchParams({
      client_id:     config.GHL_CLIENT_ID,
      client_secret: config.GHL_CLIENT_SECRET,
      grant_type:    'authorization_code',
      code:          code,
      user_type:     userType,
      redirect_uri:  config.GHL_REDIRECT_URI,
    });

    const response = await axios.post<GHLTokenResponse>(
      GHL_OAUTH_URLS.token,
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        }
      }
    );

    logger.info('Successfully exchanged code for token');
    return response.data;
  } catch (error: any) {
    logger.error('Token exchange failed:', error?.response?.data?.error_description || error?.message || 'Unknown error');
    throw this.handleError(error as AxiosError);
  }
}

  async refreshAccessToken(refreshToken: string): Promise<GHLTokenResponse> {
    try {
      const requestData: GHLTokenRequest = {
        client_id: config.GHL_CLIENT_ID,
        client_secret: config.GHL_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        user_type: 'Location',
        redirect_uri: config.GHL_REDIRECT_URI,
      };
      const response = await axios.post<GHLTokenResponse>(GHL_OAUTH_URLS.token, requestData);
      logger.info('Successfully refreshed access token');
      return response.data;
    } catch (error) {
      logger.error('Token refresh failed:', error);
      throw this.handleError(error as AxiosError);
    }
  }

  async storeTokens(tokenData: GHLTokenResponse): Promise<void> {
    const key = tokenData.locationId || tokenData.companyId || tokenData.userId || 'default';
    const storedData: StoredTokenData = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      scope: tokenData.scope,
      userType: tokenData.userType,
      companyId: tokenData.companyId,
      locationId: tokenData.locationId,
      userId: tokenData.userId,
    };
    await tokenStore.storeTokens(key, storedData);
    this.tokenKey = key;
  }

  async getValidAccessToken(): Promise<string> {
    // ← UPDATED — use API key directly if set
    if (this.apiKey) {
      return this.apiKey;
    }

    if (!this.tokenKey) {
      throw new Error('No token key set. Call setTokenKey() first.');
    }

    const tokens = await tokenStore.getTokens(this.tokenKey);

    if (!tokens) {
      throw new Error('No tokens found for the specified key');
    }

    const bufferTime = 5 * 60 * 1000;
    if (tokens.expiresAt <= Date.now() + bufferTime) {
      logger.info('Access token expired, refreshing...');
      const newTokenData = await this.refreshAccessToken(tokens.refreshToken);
      const updatedTokens: StoredTokenData = {
        ...tokens,
        accessToken: newTokenData.access_token,
        expiresAt: Date.now() + (newTokenData.expires_in * 1000),
      };
      await tokenStore.storeTokens(this.tokenKey, updatedTokens);
      return newTokenData.access_token;
    }

    return tokens.accessToken;
  }

  private async makeRequest<T>(config: AxiosRequestConfig, rateLimitKey?: string): Promise<T> {
    const accessToken = await this.getValidAccessToken();

    const requestConfig: AxiosRequestConfig = {
      ...config,
      headers: {
        ...config.headers,
        'Authorization': `Bearer ${accessToken}`,
      },
    };

    // Use rate limiting if key provided
    if (rateLimitKey) {
      return rateLimiterService.executeWithRateLimit(
        rateLimitKey,
        async () => this.executeRequest<T>(requestConfig),
        3
      );
    }

    return this.executeRequest<T>(requestConfig);
  }

  private async executeRequest<T>(requestConfig: AxiosRequestConfig): Promise<T> {
    try {
      logger.debug(`Making request to: ${requestConfig.url}`);
      const response = await this.axiosInstance.request<T>(requestConfig);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('GHL API request failed:', {
        url: requestConfig.url,
        method: requestConfig.method,
        status: axiosError.response?.status,
        data: axiosError.response?.data,
        message: axiosError.message,
      });
      throw this.handleError(axiosError);
    }
  }

  async getContacts(params?: {
    limit?: number;
    page?: number;
    query?: string;
    locationId?: string;
  }): Promise<GHLContactsResponse> {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.query) queryParams.append('query', params.query);
    if (params?.locationId) queryParams.append('locationId', params.locationId);
    const url = `${GHL_API_ENDPOINTS.contacts}?${queryParams.toString()}`;
    return this.makeRequest<GHLContactsResponse>({ method: 'GET', url });
  }

  async getContact(contactId: string): Promise<GHLContact> {
    return this.makeRequest<GHLContact>({
      method: 'GET',
      url: GHL_API_ENDPOINTS.contactById(contactId),
    });
  }

  async getOpportunities(params?: {
    limit?: number;
    page?: number;
    pipelineId?: string;
    stageId?: string;
    locationId?: string;
  }): Promise<GHLOpportunitiesResponse> {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.pipelineId) queryParams.append('pipelineId', params.pipelineId);
    if (params?.stageId) queryParams.append('stageId', params.stageId);
    if (params?.locationId) queryParams.append('locationId', params.locationId);
    const url = `${GHL_API_ENDPOINTS.opportunities}?${queryParams.toString()}`;
    return this.makeRequest<GHLOpportunitiesResponse>({ method: 'GET', url });
  }

  async getOpportunity(opportunityId: string): Promise<GHLOpportunity> {
    return this.makeRequest<GHLOpportunity>({
      method: 'GET',
      url: GHL_API_ENDPOINTS.opportunityById(opportunityId),
    });
  }

async getUsers(params?: {
  limit?: number;
  page?: number;
  locationId?: string;
}): Promise<GHLUsersResponse> {
  const queryParams = new URLSearchParams();
  // Only locationId is accepted by GHL users endpoint
  if (params?.locationId) queryParams.append('locationId', params.locationId);
  const url = `/users/?${queryParams.toString()}`;
  return this.makeRequest<GHLUsersResponse>({ method: 'GET', url });
}

  async getUser(userId: string): Promise<GHLUser> {
    return this.makeRequest<GHLUser>({
      method: 'GET',
      url: GHL_API_ENDPOINTS.userById(userId),
    });
  }

  async createUser(userData: {
    companyId?: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    type?: string;
    role?: string;
    locationIds?: string[];
    phone?: string;
    scopes?: string[];
  }): Promise<GHLUser> {
    const token = this.apiKey;
    const locationId = process.env.GHL_LOCATION_ID || '';
    const companyId = process.env.GHL_COMPANY_ID || locationId;

    const requestBody: any = {
      companyId,
      firstName: userData.firstName,
      lastName: userData.lastName,
      email: userData.email,
      password: userData.password,
      type: userData.type || 'account',
      role: userData.role || 'user',
      locationIds: userData.locationIds || (locationId ? [locationId] : []),
    };

    if (userData.phone) requestBody.phone = userData.phone;
    if (userData.scopes) requestBody.scopes = userData.scopes;

    console.log('Creating user with request:', JSON.stringify(requestBody, null, 2));

    try {
      const res = await axios.post(
        'https://services.leadconnectorhq.com/users/',
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28',
          },
        }
      );
      return res.data;
    } catch (error: any) {
      console.error('GHL Users API Error:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
      });
      throw error;
    }
  }

  // Calendars
  async getCalendars(locationId?: string): Promise<{ calendars: GHLCalendar[] }> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const queryParams = new URLSearchParams();
    if (effectiveLocationId) queryParams.append('locationId', effectiveLocationId);
    const url = `${GHL_API_ENDPOINTS.calendars}?${queryParams.toString()}`;
    logger.info(`Fetching calendars with locationId: ${effectiveLocationId || 'none'}`);
    return this.makeRequest<{ calendars: GHLCalendar[] }>({ method: 'GET', url });
  }

  async getCalendar(calendarId: string): Promise<GHLCalendar> {
    return this.makeRequest<GHLCalendar>({
      method: 'GET',
      url: GHL_API_ENDPOINTS.calendarById(calendarId),
    });
  }

  // Appointments
 async getAppointments(params?: {
  locationId?: string;
  limit?: number;
  calendarId?: string;
  startTime?: string;
  endTime?: string;
  userId?: string;
  page?: number;
}): Promise<any> {
  const token = this.apiKey;
  const locationId = params?.locationId || '';

  // Get all contacts first
  const contactsRes = await axios.get(
    `https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&limit=100`,
    { headers: { 'Authorization': `Bearer ${token}`, 'Version': '2021-07-28' } }
  );

  const contacts = contactsRes.data.contacts || [];

  // Get appointments per contact
  const allAppointments = (await Promise.all(
    contacts.map((contact: any) =>
      axios.get(
        `https://services.leadconnectorhq.com/contacts/${contact.id}/appointments`,
        { headers: { 'Authorization': `Bearer ${token}`, 'Version': '2021-07-28' } }
      ).then(res => (res.data.events || []).map((appt: any) => ({
        ...appt,
        contactName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
        contactEmail: contact.email,
      }))).catch(() => [])
    )
  )).flat();

  allAppointments.sort((a: any, b: any) =>
    new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  );

  return { events: allAppointments, meta: { total: allAppointments.length } };
}

  async getAppointment(appointmentId: string): Promise<GHLAppointment> {
    return this.makeRequest<GHLAppointment>({
      method: 'GET',
      url: GHL_API_ENDPOINTS.appointmentById(appointmentId),
    });
  }

  async getContactAppointments(contactId: string): Promise<GHLAppointmentsResponse> {
    return this.makeRequest<GHLAppointmentsResponse>({
      method: 'GET',
      url: GHL_API_ENDPOINTS.contactAppointments(contactId),
    });
  }

  async createAppointment(appointmentData: Partial<GHLAppointment>): Promise<GHLAppointment> {
    const token = this.apiKey;
    const locationId = appointmentData.locationId || process.env.GHL_LOCATION_ID || '';
    
    // Include locationId in the request body for GHL API
    const dataWithLocation = {
      ...appointmentData,
      locationId,
    };

    const res = await axios.post(
      'https://services.leadconnectorhq.com/calendars/events/appointments',
      dataWithLocation,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
        },
      }
    );

    return res.data;
  }

  // Calendar Resources (Rooms/Equipment)
 async getResources(locationId?: string): Promise<any> {
  const token = this.apiKey;
  const res = await axios.get(
    `https://services.leadconnectorhq.com/locations/${locationId}/customFields`,
    { headers: { 'Authorization': `Bearer ${token}`, 'Version': '2021-07-28' } }
  );

  const fields = res.data.customFields || [];

  // Map custom fields to room format
  const rooms = fields.map((f: any) => ({
    id: f.id,
    name: f.name,
    capacity_type: f.dataType || 'procedure',
    equipment: f.placeholder || '',
  }));

  return { resources: rooms, meta: { total: rooms.length } };
}

  async getResource(resourceId: string): Promise<GHLResource> {
    return this.makeRequest<GHLResource>({
      method: 'GET',
      url: GHL_API_ENDPOINTS.resourceById(resourceId),
    });
  }

  async createResource(resourceData: {
    locationId: string;
    name: string;
    description?: string;
    quantity?: number;
    outOfService?: number;
    capacity?: number;
    calendarIds?: string[];
    resourceType?: 'rooms' | 'equipments';
  }): Promise<GHLResource> {
    const token = this.apiKey;
    const resourceType = resourceData.resourceType || 'rooms';
    const locationId = resourceData.locationId || process.env.GHL_LOCATION_ID || '';

    const res = await axios.post(
      `https://services.leadconnectorhq.com/calendars/resources/${resourceType}`,
      {
        locationId,
        name: resourceData.name,
        description: resourceData.description || '',
        quantity: resourceData.quantity || 1,
        outOfService: resourceData.outOfService || 0,
        capacity: resourceData.capacity || 1,
        calendarIds: resourceData.calendarIds || [],
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Version': '2021-04-15',
        },
      }
    );

    return res.data;
  }

  async getLocation(locationId: string): Promise<GHLLocation> {
    return this.makeRequest<GHLLocation>({
      method: 'GET',
      url: GHL_API_ENDPOINTS.locationById(locationId),
    });
  }

 async getDashboardStats(locationId?: string): Promise<GHLDashboardStats> {
  const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';

  // Run requests separately to handle individual failures
  let contacts: any[] = [];
  let opportunities: any[] = [];

  try {
    const contactsResponse = await this.getContacts({ 
      limit: 100, 
      locationId: effectiveLocationId 
    });
    contacts = contactsResponse.contacts || [];
  } catch (error) {
    logger.warn('Could not fetch contacts:', error);
  }

  try {
    const opportunitiesResponse = await this.getOpportunities({ 
      limit: 100, 
      locationId: effectiveLocationId 
    });
    opportunities = opportunitiesResponse.opportunities || [];
  } catch (error) {
    logger.warn('Could not fetch opportunities:', error);
  }

  const totalOpportunityValue = opportunities.reduce(
    (sum, opp) => sum + (opp.monetaryValue || 0), 0
  );

  const recentContacts = contacts
    .sort((a, b) => new Date(b.dateAdded || 0).getTime() - new Date(a.dateAdded || 0).getTime())
    .slice(0, 10);

  const recentOpportunities = opportunities
    .sort((a, b) => new Date(b.dateAdded || 0).getTime() - new Date(a.dateAdded || 0).getTime())
    .slice(0, 10);

  const pipelineMap = new Map<string, { name: string; stages: Map<string, number>; value: number }>();

  opportunities.forEach(opp => {
    if (!pipelineMap.has(opp.pipelineId || '')) {
      pipelineMap.set(opp.pipelineId || '', {
        name: opp.pipelineId || 'Unknown',
        stages: new Map(),
        value: 0,
      });
    }
    const pipeline = pipelineMap.get(opp.pipelineId || '')!;
    const stageCount = pipeline.stages.get(opp.stageId || '') || 0;
    pipeline.stages.set(opp.stageId || '', stageCount + 1);
    pipeline.value += opp.monetaryValue || 0;
  });

  const pipelineSummary = Array.from(pipelineMap.entries()).map(([id, data]) => ({
    pipelineId: id,
    pipelineName: data.name,
    stageCounts: Object.fromEntries(data.stages),
    totalValue: data.value,
  }));

  return {
    totalContacts: contacts.length,
    totalOpportunities: opportunities.length,
    totalOpportunityValue,
    totalAppointments: 0,
    recentContacts,
    recentOpportunities,
    pipelineSummary,
  };
}

  // Get Pipelines
  async getPipelines(locationId?: string): Promise<any> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const queryParams = new URLSearchParams();
    if (effectiveLocationId) queryParams.append('locationId', effectiveLocationId);
    const url = `${GHL_API_ENDPOINTS.pipelines}?${queryParams.toString()}`;
    return this.makeRequest<any>({ method: 'GET', url });
  }

  // KPI Dashboard Metrics
  async getKpiMetrics(locationId?: string, dateRange?: { startDate?: string; endDate?: string }): Promise<KpiDashboardData> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate = dateRange?.startDate || thirtyDaysAgo.toISOString();
    const endDate = dateRange?.endDate || now.toISOString();

    // Fetch all required data in parallel
    const [contactsResponse, opportunitiesResponse, pipelinesResponse, appointmentsResponse] = await Promise.all([
      this.getContacts({ limit: 500, locationId: effectiveLocationId }).catch(() => ({ contacts: [], meta: { total: 0 } })),
      this.getOpportunities({ limit: 500, locationId: effectiveLocationId }).catch(() => ({ opportunities: [], meta: { total: 0 } })),
      this.getPipelines(effectiveLocationId).catch(() => ({ pipelines: [] })),
      this.getAppointments({ locationId: effectiveLocationId, limit: 200 }).catch(() => ({ events: [], meta: { total: 0 } })),
    ]);

    const contacts = contactsResponse.contacts || [];
    const opportunities = opportunitiesResponse.opportunities || [];
    const pipelines = pipelinesResponse.pipelines || [];
    const appointments = appointmentsResponse.events || [];

    // Calculate basic metrics
    const totalContacts = contacts.length;
    const totalOpportunities = opportunities.length;
    const totalPipelineValue = opportunities.reduce((sum: number, opp: GHLOpportunity) => sum + (opp.monetaryValue || 0), 0);
    const totalAppointments = appointments.length;

    // Conversion rate
    const conversionRate = totalContacts > 0 ? Math.round((totalOpportunities / totalContacts) * 100) : 0;

    // Average opportunity value
    const avgOpportunityValue = totalOpportunities > 0 ? Math.round(totalPipelineValue / totalOpportunities) : 0;

    // Pipeline gap (inverse of occupancy - room for growth)
    const pipelineGap = Math.max(0, 100 - Math.min(100, conversionRate + 10));

    // Estimated revenue per hour (based on 8-hour workday, 22 working days)
    const workingHoursPerMonth = 8 * 22;
    const avgRevenuePerHour = Math.round(totalPipelineValue / workingHoursPerMonth);

    // Profit density (assuming 70% margin)
    const profitDensity = Math.round(avgRevenuePerHour * 0.7);

    // Process pipeline statistics
    const pipelineStats = this.calculatePipelineStats(opportunities, pipelines);

    // Calculate trend data
    const contactsTrend = this.calculateTrendData(contacts, 'dateAdded', startDate, endDate);
    const opportunitiesTrend = this.calculateOpportunityTrend(opportunities, startDate, endDate);
    const revenueTrend = this.calculateRevenueTrend(opportunities, startDate, endDate);

    // Calculate velocities
    const daysInPeriod = Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)));
    const leadVelocity = Math.round((totalContacts / daysInPeriod) * 10) / 10;
    const opportunityVelocity = Math.round((totalOpportunities / daysInPeriod) * 10) / 10;

    // Calculate average time to close (for won opportunities)
    const wonOpportunities = opportunities.filter((o: GHLOpportunity) => o.status === 'won' || o.status === 'closed');
    const avgTimeToClose = this.calculateAvgTimeToClose(wonOpportunities);

    // Calculate metrics with status
    const metrics = this.calculateKpiMetrics(conversionRate, avgOpportunityValue, pipelineGap, avgRevenuePerHour, profitDensity);

    // Calculate system score
    const systemScore = this.calculateSystemScore(metrics);

    // Determine health status
    const healthStatus = systemScore >= 80 ? 'excellent' : systemScore >= 60 ? 'good' : systemScore >= 40 ? 'needs_attention' : 'critical';

    return {
      conversionRate,
      avgOpportunityValue,
      pipelineGap,
      avgRevenuePerHour,
      profitDensity,
      totalContacts,
      totalOpportunities,
      totalPipelineValue,
      totalAppointments,
      totalRevenue: totalPipelineValue,
      metrics,
      pipelineStats,
      contactsTrend,
      opportunitiesTrend,
      revenueTrend,
      systemScore,
      healthStatus,
      avgTimeToClose,
      leadVelocity,
      opportunityVelocity,
      dateRange: { startDate, endDate },
    };
  }

  private calculatePipelineStats(opportunities: GHLOpportunity[], pipelines: any[]): PipelineKpiData[] {
    const pipelineMap = new Map<string, { 
      name: string; 
      stages: Map<string, { name: string; count: number; value: number }>;
      wonCount: number;
      wonValue: number;
      lostCount: number;
      lostValue: number;
      openCount: number;
      openValue: number;
    }>();

    // Create pipeline lookup
    const pipelineLookup = new Map(pipelines.map((p: any) => [p.id, p]));

    opportunities.forEach(opp => {
      const pipelineId = opp.pipelineId || 'unknown';
      const stageId = opp.stageId || 'unknown';
      
      if (!pipelineMap.has(pipelineId)) {
        const pipeline = pipelineLookup.get(pipelineId);
        pipelineMap.set(pipelineId, {
          name: pipeline?.name || opp.pipelineId || 'Unknown Pipeline',
          stages: new Map(),
          wonCount: 0,
          wonValue: 0,
          lostCount: 0,
          lostValue: 0,
          openCount: 0,
          openValue: 0,
        });
      }

      const pipeline = pipelineMap.get(pipelineId)!;
      
      // Track by status
      if (opp.status === 'won' || opp.status === 'closed') {
        pipeline.wonCount++;
        pipeline.wonValue += opp.monetaryValue || 0;
      } else if (opp.status === 'lost' || opp.status === 'abandoned') {
        pipeline.lostCount++;
        pipeline.lostValue += opp.monetaryValue || 0;
      } else {
        pipeline.openCount++;
        pipeline.openValue += opp.monetaryValue || 0;
      }

      // Track by stage
      if (!pipeline.stages.has(stageId)) {
        const pipelineData = pipelineLookup.get(pipelineId);
        const stage = pipelineData?.stages?.find((s: any) => s.id === stageId);
        pipeline.stages.set(stageId, { 
          name: stage?.name || `Stage ${stageId}`, 
          count: 0, 
          value: 0 
        });
      }
      
      const stageData = pipeline.stages.get(stageId)!;
      stageData.count++;
      stageData.value += opp.monetaryValue || 0;
    });

    return Array.from(pipelineMap.entries()).map(([pipelineId, data]) => {
      const totalItems = data.wonCount + data.lostCount + data.openCount;
      const totalValue = data.wonValue + data.lostValue + data.openValue;
      const stages: PipelineStageMetric[] = Array.from(data.stages.entries()).map(([stageId, stageData]) => ({
        stageId,
        stageName: stageData.name,
        count: stageData.count,
        totalValue: stageData.value,
        avgValue: stageData.count > 0 ? Math.round(stageData.value / stageData.count) : 0,
      }));

      return {
        pipelineId,
        pipelineName: data.name,
        totalItems,
        totalValue,
        avgValue: totalItems > 0 ? Math.round(totalValue / totalItems) : 0,
        stages,
        wonCount: data.wonCount,
        wonValue: data.wonValue,
        lostCount: data.lostCount,
        lostValue: data.lostValue,
        openCount: data.openCount,
        openValue: data.openValue,
        winRate: (data.wonCount + data.lostCount) > 0 
          ? Math.round((data.wonCount / (data.wonCount + data.lostCount)) * 100) 
          : 0,
      };
    });
  }

  private calculateTrendData(items: any[], dateField: string, startDate: string, endDate: string): { date: string; count: number }[] {
    const dailyCounts = new Map<string, number>();
    
    items.forEach(item => {
      const date = item[dateField];
      if (date) {
        const dateKey = new Date(date).toISOString().split('T')[0];
        dailyCounts.set(dateKey, (dailyCounts.get(dateKey) || 0) + 1);
      }
    });

    // Generate all dates in range
    const result: { date: string; count: number }[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    
    while (current <= end) {
      const dateKey = current.toISOString().split('T')[0];
      result.push({ date: dateKey, count: dailyCounts.get(dateKey) || 0 });
      current.setDate(current.getDate() + 1);
    }

    return result.slice(-30); // Last 30 days
  }

  private calculateOpportunityTrend(opportunities: GHLOpportunity[], startDate: string, endDate: string): { date: string; count: number; value: number }[] {
    const dailyData = new Map<string, { count: number; value: number }>();
    
    opportunities.forEach(opp => {
      const date = opp.dateAdded;
      if (date) {
        const dateKey = new Date(date).toISOString().split('T')[0];
        const existing = dailyData.get(dateKey) || { count: 0, value: 0 };
        dailyData.set(dateKey, {
          count: existing.count + 1,
          value: existing.value + (opp.monetaryValue || 0),
        });
      }
    });

    const result: { date: string; count: number; value: number }[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    
    while (current <= end) {
      const dateKey = current.toISOString().split('T')[0];
      const data = dailyData.get(dateKey) || { count: 0, value: 0 };
      result.push({ date: dateKey, ...data });
      current.setDate(current.getDate() + 1);
    }

    return result.slice(-30);
  }

  private calculateRevenueTrend(opportunities: GHLOpportunity[], startDate: string, endDate: string): { date: string; revenue: number }[] {
    const dailyRevenue = new Map<string, number>();
    
    opportunities.forEach(opp => {
      const date = opp.dateStatusChanged || opp.dateAdded;
      if (date && (opp.status === 'won' || opp.status === 'closed')) {
        const dateKey = new Date(date).toISOString().split('T')[0];
        dailyRevenue.set(dateKey, (dailyRevenue.get(dateKey) || 0) + (opp.monetaryValue || 0));
      }
    });

    const result: { date: string; revenue: number }[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    
    while (current <= end) {
      const dateKey = current.toISOString().split('T')[0];
      result.push({ date: dateKey, revenue: dailyRevenue.get(dateKey) || 0 });
      current.setDate(current.getDate() + 1);
    }

    return result.slice(-30);
  }

  private calculateAvgTimeToClose(wonOpportunities: GHLOpportunity[]): number {
    if (wonOpportunities.length === 0) return 0;
    
    const totalDays = wonOpportunities.reduce((sum, opp) => {
      if (opp.dateAdded && opp.dateStatusChanged) {
        const added = new Date(opp.dateAdded).getTime();
        const closed = new Date(opp.dateStatusChanged).getTime();
        return sum + Math.ceil((closed - added) / (1000 * 60 * 60 * 24));
      }
      return sum;
    }, 0);

    return Math.round(totalDays / wonOpportunities.length);
  }

  private calculateKpiMetrics(
    conversionRate: number, 
    avgOpportunityValue: number, 
    pipelineGap: number, 
    avgRevenuePerHour: number, 
    profitDensity: number
  ): KpiMetric[] {
    const thresholds = {
      occupancy: { green: 75, yellow: 55 },
      revenuePerHour: { green: 300, yellow: 200 },
      idlePct: { green: 20, yellow: 35 },
      profitDensity: { green: 70, yellow: 50 },
    };

    const getStatus = (value: number, key: keyof typeof thresholds, invert = false): 'green' | 'yellow' | 'red' => {
      const t = thresholds[key];
      if (!t) return 'yellow';
      if (invert) {
        if (value <= t.green) return 'green';
        if (value <= t.yellow) return 'yellow';
        return 'red';
      }
      if (value >= t.green) return 'green';
      if (value >= t.yellow) return 'yellow';
      return 'red';
    };

    const statusLabel = { green: 'Optimized', yellow: 'Needs Attention', red: 'Critical' };

    return [
      {
        label: 'Conversion Rate',
        value: conversionRate,
        unit: '%',
        status: getStatus(conversionRate, 'occupancy'),
        statusLabel: statusLabel[getStatus(conversionRate, 'occupancy')],
        description: '% of contacts converted to opportunities',
        target: '≥75% Green',
        kpiKey: 'occupancy',
      },
      {
        label: 'Avg Opportunity Value',
        value: avgOpportunityValue,
        unit: '$',
        status: getStatus(avgOpportunityValue, 'revenuePerHour'),
        statusLabel: statusLabel[getStatus(avgOpportunityValue, 'revenuePerHour')],
        description: 'Average value per opportunity',
        target: '≥$300 Green',
        kpiKey: 'revenuePerHour',
      },
      {
        label: 'Pipeline Gap',
        value: pipelineGap,
        unit: '%',
        status: getStatus(pipelineGap, 'idlePct', true),
        statusLabel: statusLabel[getStatus(pipelineGap, 'idlePct', true)],
        description: 'Room for pipeline growth',
        target: '≤20% Green',
        kpiKey: 'idlePct',
      },
      {
        label: 'Avg Revenue / Hour',
        value: avgRevenuePerHour,
        unit: '$/hr',
        status: getStatus(avgRevenuePerHour, 'revenuePerHour'),
        statusLabel: statusLabel[getStatus(avgRevenuePerHour, 'revenuePerHour')],
        description: 'Estimated revenue per hour',
        target: '≥$300 Green',
        kpiKey: 'revenuePerHour',
      },
      {
        label: 'Profit Density',
        value: profitDensity,
        unit: '$/hr',
        status: getStatus(profitDensity, 'profitDensity'),
        statusLabel: statusLabel[getStatus(profitDensity, 'profitDensity')],
        description: 'Estimated profit per hour',
        target: '≥$70 Green',
        kpiKey: 'profitDensity',
      },
    ];
  }

  private calculateSystemScore(metrics: KpiMetric[]): number {
    return Math.round(metrics.reduce((sum, m) => {
      return sum + (m.status === 'green' ? 100 : m.status === 'yellow' ? 60 : 20);
    }, 0) / metrics.length);
  }

  // ==================== WORKFLOW API METHODS ====================

  /**
   * Get all workflows for a location
   * GET /workflows/
   */
  async getWorkflows(params?: {
    locationId?: string;
    limit?: number;
    page?: number;
    status?: 'draft' | 'published' | 'archived';
  }): Promise<GHLWorkflowsResponse> {
    const locationId = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const queryParams = new URLSearchParams();
    if (locationId) queryParams.append('locationId', locationId);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.status) queryParams.append('status', params.status);
    
    const url = `/workflows/?${queryParams.toString()}`;
    return this.makeRequest<GHLWorkflowsResponse>({ method: 'GET', url });
  }

  /**
   * Get a single workflow by ID
   * GET /workflows/{workflowId}
   */
  async getWorkflow(workflowId: string, locationId?: string): Promise<GHLWorkflow> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const queryParams = new URLSearchParams();
    if (effectiveLocationId) queryParams.append('locationId', effectiveLocationId);
    
    const url = `/workflows/${workflowId}?${queryParams.toString()}`;
    return this.makeRequest<GHLWorkflow>({ method: 'GET', url });
  }

  /**
   * Create a new workflow
   * POST /workflows/
   */
  async createWorkflow(workflowData: Partial<GHLWorkflow>): Promise<GHLWorkflow> {
    return this.makeRequest<GHLWorkflow>({
      method: 'POST',
      url: '/workflows/',
      data: workflowData,
    });
  }

  /**
   * Update an existing workflow
   * PUT /workflows/{workflowId}
   */
  async updateWorkflow(workflowId: string, workflowData: Partial<GHLWorkflow>): Promise<GHLWorkflow> {
    return this.makeRequest<GHLWorkflow>({
      method: 'PUT',
      url: `/workflows/${workflowId}`,
      data: workflowData,
    });
  }

  /**
   * Delete a workflow
   * DELETE /workflows/{workflowId}
   */
  async deleteWorkflow(workflowId: string): Promise<void> {
    return this.makeRequest<void>({
      method: 'DELETE',
      url: `/workflows/${workflowId}`,
    });
  }

  /**
   * Get workflow optimization rules from GHL Custom Fields
   * Returns scheduling rules like Prime-Hour Protection, Buffer Logic, etc.
   */
  async getWorkflowOptimizationRules(locationId?: string): Promise<WorkflowOptimizationRule[]> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const apiKey = this.apiKey || '';
    
    if (!effectiveLocationId || !apiKey) {
      logger.warn('Missing locationId or apiKey for workflow rules, returning defaults');
      // Return default rules if credentials missing
      return workflowRulesService['DEFAULT_RULES'];
    }

    try {
      return await workflowRulesService.getRules(effectiveLocationId, apiKey);
    } catch (error) {
      logger.error('Failed to get workflow optimization rules:', error);
      // Return default rules on error
      return workflowRulesService['DEFAULT_RULES'];
    }
  }

  /**
   * Update workflow optimization rules in GHL Custom Fields
   */
  async updateWorkflowOptimizationRules(
    rules: WorkflowOptimizationRule[],
    locationId?: string
  ): Promise<WorkflowOptimizationRule[]> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const apiKey = this.apiKey || '';
    
    if (!effectiveLocationId || !apiKey) {
      throw new Error('Missing locationId or apiKey for updating workflow rules');
    }

    return await workflowRulesService.updateRules(effectiveLocationId, apiKey, rules);
  }

  /**
   * Analyze appointments for scheduling violations
   * Based on Prime-Hour Protection rules from WorkflowEngine
   * Uses caching to reduce API calls
   */
  async analyzeSchedulingViolations(params?: {
    locationId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<WorkflowSchedulingViolation[]> {
    const locationId = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const cacheKey = `violations:${locationId}:${params?.startDate || 'all'}:${params?.endDate || 'all'}`;
    
    // Check cache first (short TTL for violations - 2 minutes)
    const cached = await cacheService.get<WorkflowSchedulingViolation[]>(cacheKey);
    if (cached) {
      logger.debug('Returning cached violations');
      return cached;
    }

    const violations: WorkflowSchedulingViolation[] = [];
    const PRIME_HOURS = [10, 11, 12, 13, 14, 15, 16, 17];

    try {
      // Fetch active rules to determine what to check
      const rules = await this.getWorkflowOptimizationRules(locationId);
      const primeHourRule = rules.find(r => r.type === 'prime_hour_protection' && r.isActive);
      
      if (!primeHourRule) {
        logger.debug('Prime-hour protection rule not active, skipping violation analysis');
        return [];
      }

      // Fetch appointments for analysis
      const appointmentsResponse = await this.getAppointments({
        locationId,
        startTime: params?.startDate,
        endTime: params?.endDate,
        limit: 500,
      });

      const appointments = appointmentsResponse.events || [];
      const effectivePrimeHours = primeHourRule.config.primeHours || PRIME_HOURS;

      appointments.forEach((appt: any) => {
        if (!appt.startTime) return;
        
        const startTime = new Date(appt.startTime);
        const hour = startTime.getHours();
        const isPrime = effectivePrimeHours.includes(hour);
        
        // Check for prime-hour violations (low-ticket in prime hours)
        const category = appt.treatment_category || (appt as any).customFields?.treatment_category;
        const blockedCategories = primeHourRule.config.blockedCategories || ['low_ticket'];
        
        if (isPrime && blockedCategories.includes(category)) {
          violations.push({
            id: `violation-${appt.id}`,
            type: 'prime_hour_violation',
            detail: `${appt.title || 'Unknown'} (${category}) booked at ${startTime.toLocaleTimeString()} on ${startTime.toLocaleDateString()}`,
            room: appt.appointmentLocation || (appt as any).address1,
            revenue: (appt as any).monetaryValue || 0,
            appointmentId: appt.id,
            severity: 'medium',
            detectedAt: new Date().toISOString(),
          });
        }
      });

      // Cache results
      await cacheService.set(cacheKey, violations, 2 * 60 * 1000); // 2 minutes TTL

      return violations;
    } catch (error) {
      logger.warn('Failed to analyze scheduling violations:', error);
      return [];
    }
  }

  /**
   * Get schedule blocks with hour-by-hour analysis
   * Returns data formatted for the WorkflowEngine schedule architecture view
   * Uses caching to reduce API calls
   */
  async getScheduleBlocks(params?: {
    locationId?: string;
    date?: string;
  }): Promise<WorkflowScheduleBlock[]> {
    const locationId = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const cacheKey = `schedule_blocks:${locationId}:${params?.date || 'today'}`;
    
    // Check cache first (5 minutes TTL for schedule blocks)
    const cached = await cacheService.get<WorkflowScheduleBlock[]>(cacheKey);
    if (cached) {
      logger.debug('Returning cached schedule blocks');
      return cached;
    }

    const PRIME_HOURS = [10, 11, 12, 13, 14, 15, 16, 17];
    const HOUR_LABELS = Array.from({ length: 13 }, (_, i) => `${i + 8}:00`);

    try {
      // Fetch rules to get configured prime hours
      const rules = await this.getWorkflowOptimizationRules(locationId);
      const primeHourRule = rules.find(r => r.type === 'prime_hour_protection');
      const effectivePrimeHours = primeHourRule?.config?.primeHours || PRIME_HOURS;

      const appointmentsResponse = await this.getAppointments({
        locationId,
        startTime: params?.date ? new Date(params.date).toISOString() : undefined,
        limit: 500,
      });

      const appointments = appointmentsResponse.events || [];

      const blocks = HOUR_LABELS.map(label => {
        const hour = parseInt(label.split(':')[0], 10);
        const isPrime = effectivePrimeHours.includes(hour);
        
        const appts = appointments.filter((a: any) => {
          if (!a.startTime) return false;
          const apptHour = new Date(a.startTime).getHours();
          return apptHour === hour;
        });

        const highTicket = appts.filter((a: any) => 
          (a.treatment_category || (a as any).customFields?.treatment_category) === 'high_ticket'
        ).length;
        
        const lowTicket = appts.filter((a: any) => 
          (a.treatment_category || (a as any).customFields?.treatment_category) === 'low_ticket'
        ).length;

        // Calculate utilization (assuming 4 rooms max)
        const utilization = Math.min(100, (appts.length / 4) * 100);

        return {
          hour,
          label,
          isPrime,
          total: appts.length,
          highTicket,
          lowTicket,
          utilization,
        };
      });

      // Cache results
      await cacheService.set(cacheKey, blocks, 5 * 60 * 1000); // 5 minutes TTL

      return blocks;
    } catch (error) {
      logger.warn('Failed to get schedule blocks:', error);
      // Return empty blocks
      return HOUR_LABELS.map(label => {
        const hour = parseInt(label.split(':')[0], 10);
        return {
          hour,
          label,
          isPrime: PRIME_HOURS.includes(hour),
          total: 0,
          highTicket: 0,
          lowTicket: 0,
          utilization: 0,
        };
      });
    }
  }

  // Room Utilization Heatmap
  async getRoomUtilizationHeatmap(params?: RoomHeatmapQueryParams): Promise<RoomUtilizationHeatmap> {
    const locationId = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const startDate = params?.startDate;
    const endDate = params?.endDate;
    const hours = params?.hours || Array.from({ length: 12 }, (_, i) => i + 8); // 8am-7pm

    // Fetch appointments and resources in parallel
    const [appointmentsResponse, resourcesResponse] = await Promise.all([
      this.getAppointments({ locationId, startTime: startDate, endTime: endDate, limit: 1000 }),
      this.getResources(locationId),
    ]);

    const appointments = appointmentsResponse.events || [];
    const resources = resourcesResponse.resources || [];

    // Extract room names from resources and appointments
    const roomNamesFromResources = resources.map((r: GHLResource) => r.name);
    const roomNamesFromAppointments = [...new Set(
      appointments
        .map((a: GHLAppointment) => a.appointmentLocation || a.address1)
        .filter(Boolean)
    )];

    // Merge room names, preferring resources
    const roomNames = roomNamesFromResources.length > 0 
      ? roomNamesFromResources 
      : roomNamesFromAppointments;

    if (roomNames.length === 0) {
      return {
        rooms: [],
        hours,
        data: [],
        uniqueDays: 0,
        startDate,
        endDate,
      };
    }

    // Calculate unique days from appointments
    const uniqueDaysSet = new Set(appointments.map((a: GHLAppointment) => {
      const date = new Date(a.startTime);
      return date.toISOString().split('T')[0];
    }));
    const uniqueDays = uniqueDaysSet.size || 1;

    // Initialize heatmap data structure
    const heatmapData: RoomUtilizationHeatmap['data'] = roomNames.map((room: string) => ({
      room,
      hours: {} as Record<string, { booked: number; revenue: number }>,
      totalBooked: 0,
      totalRevenue: 0,
      utilPct: 0,
    }));

    // Initialize all hours for each room
    heatmapData.forEach(roomData => {
      hours.forEach(h => {
        roomData.hours[h] = { booked: 0, revenue: 0 };
      });
    });

    // Process appointments into heatmap
    appointments.forEach((appointment: GHLAppointment) => {
      const roomName = appointment.appointmentLocation || appointment.address1;
      if (!roomName) return;

      const roomData = heatmapData.find(r => r.room === roomName);
      if (!roomData) return;

      const startTime = new Date(appointment.startTime);
      const hour = startTime.getHours();

      // Only count if hour is in our range
      if (hours.includes(hour)) {
        roomData.hours[hour].booked++;
        // Estimate revenue from opportunity value or use default
        const revenue = (appointment as any).monetaryValue || 0;
        roomData.hours[hour].revenue += revenue;
      }
    });

    // Calculate room stats
    heatmapData.forEach(roomData => {
      roomData.totalBooked = hours.reduce((sum, h) => sum + (roomData.hours[h]?.booked || 0), 0);
      roomData.totalRevenue = hours.reduce((sum, h) => sum + (roomData.hours[h]?.revenue || 0), 0);
      const maxPossible = hours.length * uniqueDays;
      roomData.utilPct = maxPossible > 0 ? Math.round((roomData.totalBooked / maxPossible) * 100) : 0;
    });

    // Sort by utilization percentage (highest first)
    heatmapData.sort((a, b) => b.utilPct - a.utilPct);

    return {
      rooms: roomNames,
      hours,
      data: heatmapData,
      uniqueDays,
      startDate,
      endDate,
    };
  }

  // Reports Data - Optimization Report Metrics
  async getReportsData(params?: {
    locationId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<import('../types').ReportsData> {
    const locationId = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate = params?.startDate || thirtyDaysAgo.toISOString();
    const endDate = params?.endDate || now.toISOString();

    // Fetch appointments and opportunities in parallel
    const [appointmentsResponse, opportunitiesResponse, heatmapData] = await Promise.all([
      this.getAppointments({ locationId, startTime: startDate, endTime: endDate, limit: 1000 }).catch(() => ({ events: [], meta: { total: 0 } })),
      this.getOpportunities({ limit: 500, locationId }).catch(() => ({ opportunities: [], meta: { total: 0 } })),
      this.getRoomUtilizationHeatmap({ locationId, startDate, endDate }).catch(() => ({ 
        rooms: [], hours: [], data: [], uniqueDays: 1 
      })),
    ]);

    const appointments = appointmentsResponse.events || [];
    const opportunities = opportunitiesResponse.opportunities || [];

    // Calculate unique days from appointments
    const uniqueDaysSet = new Set(appointments.map((a: any) => {
      if (a.startTime) {
        return new Date(a.startTime).toISOString().split('T')[0];
      }
      return null;
    }).filter(Boolean));
    const uniqueDays = uniqueDaysSet.size || 1;

    // Filter completed vs cancelled appointments
    const completedAppointments = appointments.filter((a: any) => 
      a.status !== 'cancelled' && a.status !== 'no_show' && a.status !== 'canceled'
    );
    const cancelledAppointments = appointments.filter((a: any) => 
      a.status === 'cancelled' || a.status === 'no_show' || a.status === 'canceled'
    );

    // Calculate total revenue from opportunities and appointments
    const totalOpportunityValue = opportunities.reduce((sum: number, opp: import('../types').GHLOpportunity) => 
      sum + (opp.monetaryValue || 0), 0
    );
    
    // Estimate revenue from appointments (use opportunity value or estimate)
    const totalRevenue = completedAppointments.reduce((sum: number, appt: any) => {
      // Try to get revenue from appointment custom fields or related opportunity
      const revenue = appt.monetaryValue || appt.revenue || 0;
      return sum + revenue;
    }, 0) || totalOpportunityValue; // Fallback to opportunity value

    // Calculate daily/annual projections
    const dailyRevenue = totalRevenue / uniqueDays;
    const annualBase = dailyRevenue * 250; // ~250 operating days/year

    // Calculate utilization from heatmap
    const avgUtilization = heatmapData.data && heatmapData.data.length > 0
      ? Math.round(heatmapData.data.reduce((sum, r) => sum + r.utilPct, 0) / heatmapData.data.length)
      : 0;

    // Prime hours utilization (10am-6pm = hours 10-17)
    const PRIME_HOURS = [10, 11, 12, 13, 14, 15, 16, 17];
    let primeHourBookings = 0;
    let totalPrimeSlots = 0;

    heatmapData.data.forEach(room => {
      PRIME_HOURS.forEach(hour => {
        const hourData = room.hours[hour];
        if (hourData) {
          primeHourBookings += hourData.booked;
        }
      });
    });

    // Estimate total prime slots (rooms * prime hours * unique days)
    const numRooms = heatmapData.rooms.length || 4;
    totalPrimeSlots = numRooms * PRIME_HOURS.length * uniqueDays;
    const primeHourUtilization = totalPrimeSlots > 0 
      ? Math.round((primeHourBookings / totalPrimeSlots) * 100) 
      : 0;

    // Calculate idle time percentage
    const idleTimePercentage = Math.max(0, 100 - avgUtilization);

    // Revenue metrics
    const avgRevenuePerAppointment = completedAppointments.length > 0 
      ? Math.round(totalRevenue / completedAppointments.length) 
      : 0;
    const avgRevenuePerHour = Math.round(totalRevenue / (uniqueDays * 8)); // Assuming 8-hour days
    const avgRevenuePerDay = Math.round(dailyRevenue);

    // Projection calculations (based on optimization potential)
    // These are conservative estimates based on industry benchmarks
    const utilIncrease = Math.round(annualBase * 0.22); // 22% utilization gain
    const primeIncrease = Math.round(annualBase * 0.18); // 18% prime-hour lift
    const combinedLift = Math.round(annualBase * 0.35); // combined conservative

    // Success metrics based on current data
    const successMetrics = [
      {
        metric: 'Room Utilization',
        target: '+15–30% increase',
        current: `${avgUtilization}% current`,
        status: avgUtilization >= 65 ? 'on_track' as const : avgUtilization >= 45 ? 'needs_attention' as const : 'critical' as const,
      },
      {
        metric: 'Prime-Hour High-Ticket',
        target: '+20% occupancy',
        current: `${primeHourUtilization}% current`,
        status: primeHourUtilization >= 60 ? 'on_track' as const : primeHourUtilization >= 40 ? 'needs_attention' as const : 'critical' as const,
      },
      {
        metric: 'Idle Room Time',
        target: '-25% reduction',
        current: `${idleTimePercentage}% current`,
        status: idleTimePercentage <= 25 ? 'on_track' as const : idleTimePercentage <= 40 ? 'needs_attention' as const : 'critical' as const,
      },
      {
        metric: 'Revenue per Provider Hour',
        target: 'Measurable increase',
        current: `$${avgRevenuePerHour}/hr current`,
        status: avgRevenuePerHour >= 200 ? 'on_track' as const : avgRevenuePerHour >= 100 ? 'needs_attention' as const : 'critical' as const,
      },
    ];

    return {
      currentAnnual: Math.round(annualBase),
      totalRevenue: Math.round(totalRevenue),
      totalAppointments: appointments.length,
      completedAppointments: completedAppointments.length,
      cancelledAppointments: cancelledAppointments.length,
      avgUtilization,
      primeHourUtilization,
      idleTimePercentage,
      avgRevenuePerAppointment,
      avgRevenuePerHour,
      avgRevenuePerDay,
      projections: {
        utilIncrease,
        primeIncrease,
        combinedLift,
        capacityIncrease: 22,
        idleReduction: 28,
        primeHQIncrease: 20,
        totalUpside: combinedLift,
      },
      successMetrics,
      dateRange: { startDate, endDate },
      uniqueDays,
    };
  }

  // ==================== REVENUE ANALYTICS API METHODS ====================

  /**
   * Get revenue by hour - prime vs off-peak distribution
   * Analyzes appointments from last 30 days and groups revenue by hour
   */
  async getRevenueByHour(params?: {
    locationId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    hours: { hour: number; label: string; revenue: number; isPrime: boolean }[];
    primeHoursTotal: number;
    offPeakHoursTotal: number;
    primeHours: number[];
  }> {
    const locationId = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate = params?.startDate || thirtyDaysAgo.toISOString();
    const endDate = params?.endDate || now.toISOString();

    const PRIME_HOURS = [10, 11, 12, 13, 14, 15, 16, 17]; // 10am-6pm

    try {
      // Fetch appointments with their associated opportunities for revenue data
      const [appointmentsResponse, opportunitiesResponse] = await Promise.all([
        this.getAppointments({ locationId, startTime: startDate, endTime: endDate, limit: 1000 }),
        this.getOpportunities({ limit: 500, locationId }),
      ]);

      const appointments = appointmentsResponse.events || [];
      const opportunities = opportunitiesResponse.opportunities || [];

      // Create a map of contactId to opportunity value for quick lookup
      const contactRevenueMap = new Map<string, number>();
      opportunities.forEach(opp => {
        if (opp.contactId) {
          const current = contactRevenueMap.get(opp.contactId) || 0;
          contactRevenueMap.set(opp.contactId, current + (opp.monetaryValue || 0));
        }
      });

      // Initialize hourly revenue tracking
      const hourlyRevenue = new Map<number, number>();
      for (let h = 8; h <= 19; h++) {
        hourlyRevenue.set(h, 0);
      }

      // Process appointments and assign revenue
      appointments.forEach((appt: any) => {
        if (!appt.startTime) return;
        
        const startTime = new Date(appt.startTime);
        const hour = startTime.getHours();
        
        // Only count hours in our range (8am-7pm)
        if (hour < 8 || hour > 19) return;

        // Get revenue from appointment or associated opportunity
        let revenue = 0;
        if (appt.monetaryValue || appt.revenue) {
          revenue = appt.monetaryValue || appt.revenue;
        } else if (appt.contactId && contactRevenueMap.has(appt.contactId)) {
          // Estimate: divide contact's total opportunity value by their appointment count
          revenue = contactRevenueMap.get(appt.contactId) || 0;
        }

        hourlyRevenue.set(hour, (hourlyRevenue.get(hour) || 0) + revenue);
      });

      // Build response data
      const hours = Array.from(hourlyRevenue.entries()).map(([hour, revenue]) => ({
        hour,
        label: `${hour}:00`,
        revenue: Math.round(revenue),
        isPrime: PRIME_HOURS.includes(hour),
      }));

      const primeHoursTotal = hours
        .filter(h => h.isPrime)
        .reduce((sum, h) => sum + h.revenue, 0);
      
      const offPeakHoursTotal = hours
        .filter(h => !h.isPrime)
        .reduce((sum, h) => sum + h.revenue, 0);

      return {
        hours,
        primeHoursTotal,
        offPeakHoursTotal,
        primeHours: PRIME_HOURS,
      };
    } catch (error) {
      logger.warn('Failed to get revenue by hour:', error);
      // Return empty data structure
      return {
        hours: Array.from({ length: 12 }, (_, i) => ({
          hour: i + 8,
          label: `${i + 8}:00`,
          revenue: 0,
          isPrime: PRIME_HOURS.includes(i + 8),
        })),
        primeHoursTotal: 0,
        offPeakHoursTotal: 0,
        primeHours: PRIME_HOURS,
      };
    }
  }

  /**
   * Get daily revenue for the last 30 days
   * Returns revenue data per day for charting
   */
  async getDailyRevenue(params?: {
    locationId?: string;
    days?: number;
  }): Promise<{
    dailyRevenue: { date: string; revenue: number; appointmentCount: number }[];
    totalRevenue: number;
    avgDailyRevenue: number;
    bestDay: { date: string; revenue: number } | null;
  }> {
    const locationId = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const days = params?.days || 30;
    
    const now = new Date();
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    try {
      // Fetch appointments and opportunities
      const [appointmentsResponse, opportunitiesResponse] = await Promise.all([
        this.getAppointments({ locationId, startTime: startDate.toISOString(), endTime: now.toISOString(), limit: 1000 }),
        this.getOpportunities({ limit: 500, locationId }),
      ]);

      const appointments = appointmentsResponse.events || [];
      const opportunities = opportunitiesResponse.opportunities || [];

      // Create a map of contactId to opportunity value
      const contactRevenueMap = new Map<string, number>();
      opportunities.forEach(opp => {
        if (opp.contactId) {
          const current = contactRevenueMap.get(opp.contactId) || 0;
          contactRevenueMap.set(opp.contactId, current + (opp.monetaryValue || 0));
        }
      });

      // Initialize daily revenue tracking
      const dailyData = new Map<string, { revenue: number; appointmentCount: number }>();
      
      // Initialize all days in range
      for (let d = 0; d < days; d++) {
        const date = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
        const dateKey = date.toISOString().split('T')[0];
        dailyData.set(dateKey, { revenue: 0, appointmentCount: 0 });
      }

      // Process appointments
      appointments.forEach((appt: any) => {
        if (!appt.startTime) return;
        
        const dateKey = new Date(appt.startTime).toISOString().split('T')[0];
        const dayData = dailyData.get(dateKey);
        
        if (!dayData) return; // Outside our date range

        // Get revenue
        let revenue = 0;
        if (appt.monetaryValue || appt.revenue) {
          revenue = appt.monetaryValue || appt.revenue;
        } else if (appt.contactId && contactRevenueMap.has(appt.contactId)) {
          revenue = contactRevenueMap.get(appt.contactId) || 0;
        }

        dayData.revenue += revenue;
        dayData.appointmentCount++;
      });

      // Convert to array and sort by date
      const dailyRevenue = Array.from(dailyData.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({
          date,
          revenue: Math.round(data.revenue),
          appointmentCount: data.appointmentCount,
        }));

      const totalRevenue = dailyRevenue.reduce((sum, d) => sum + d.revenue, 0);
      const avgDailyRevenue = dailyRevenue.length > 0 ? Math.round(totalRevenue / dailyRevenue.length) : 0;
      
      // Find best day
      const bestDay = dailyRevenue.length > 0
        ? dailyRevenue.reduce((best, current) => current.revenue > best.revenue ? current : best, dailyRevenue[0])
        : null;

      return {
        dailyRevenue,
        totalRevenue,
        avgDailyRevenue,
        bestDay: bestDay ? { date: bestDay.date, revenue: bestDay.revenue } : null,
      };
    } catch (error) {
      logger.warn('Failed to get daily revenue:', error);
      // Return empty data structure
      const emptyDaily = Array.from({ length: days }, (_, i) => {
        const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
        return {
          date: date.toISOString().split('T')[0],
          revenue: 0,
          appointmentCount: 0,
        };
      });
      
      return {
        dailyRevenue: emptyDaily,
        totalRevenue: 0,
        avgDailyRevenue: 0,
        bestDay: null,
      };
    }
  }

  // ==================== ALERTS API METHODS ====================

  /**
   * Get all optimization alerts
   * GET /alerts
   */
  async getAlerts(params?: {
    locationId?: string;
    limit?: number;
    page?: number;
    isResolved?: boolean;
    severity?: string;
    alertType?: string;
  }): Promise<GHLOptimizationAlertsResponse> {
    const locationId = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const queryParams = new URLSearchParams();
    if (locationId) queryParams.append('locationId', locationId);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.isResolved !== undefined) queryParams.append('isResolved', params.isResolved.toString());
    if (params?.severity) queryParams.append('severity', params.severity);
    if (params?.alertType) queryParams.append('alertType', params.alertType);
    
    const url = `/alerts?${queryParams.toString()}`;
    return this.makeRequest<GHLOptimizationAlertsResponse>({ method: 'GET', url });
  }

  /**
   * Get a single alert by ID
   * GET /alerts/{alertId}
   */
  async getAlert(alertId: string, locationId?: string): Promise<GHLOptimizationAlert> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const queryParams = new URLSearchParams();
    if (effectiveLocationId) queryParams.append('locationId', effectiveLocationId);
    
    const url = `/alerts/${alertId}?${queryParams.toString()}`;
    return this.makeRequest<GHLOptimizationAlert>({ method: 'GET', url });
  }

  /**
   * Create a new optimization alert
   * POST /alerts
   */
  async createAlert(alertData: AlertCreateRequest): Promise<GHLOptimizationAlert> {
    const locationId = alertData.locationId || process.env.GHL_LOCATION_ID || '';
    const data = {
      ...alertData,
      locationId,
      date: alertData.date || new Date().toISOString().split('T')[0],
      revenue_impact: alertData.revenue_impact || 0,
    };
    
    return this.makeRequest<GHLOptimizationAlert>({
      method: 'POST',
      url: '/alerts',
      data,
    });
  }

  /**
   * Update an existing alert
   * PUT /alerts/{alertId}
   */
  async updateAlert(alertId: string, alertData: AlertUpdateRequest): Promise<GHLOptimizationAlert> {
    return this.makeRequest<GHLOptimizationAlert>({
      method: 'PUT',
      url: `/alerts/${alertId}`,
      data: alertData,
    });
  }

  /**
   * Resolve an alert
   * PUT /alerts/{alertId}/resolve
   */
  async resolveAlert(alertId: string): Promise<GHLOptimizationAlert> {
    return this.makeRequest<GHLOptimizationAlert>({
      method: 'PUT',
      url: `/alerts/${alertId}/resolve`,
    });
  }

  /**
   * Delete an alert
   * DELETE /alerts/{alertId}
   */
  async deleteAlert(alertId: string): Promise<void> {
    return this.makeRequest<void>({
      method: 'DELETE',
      url: `/alerts/${alertId}`,
    });
  }

  /**
   * Get alert statistics
   * GET /alerts/stats/summary
   */
  async getAlertStats(locationId?: string): Promise<AlertStats> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const queryParams = new URLSearchParams();
    if (effectiveLocationId) queryParams.append('locationId', effectiveLocationId);
    
    const url = `/alerts/stats/summary?${queryParams.toString()}`;
    return this.makeRequest<AlertStats>({ method: 'GET', url });
  }

  /**
   * Trigger automated alerts based on system analysis
   * This analyzes current data and creates alerts for detected issues
   */
  async triggerAutomatedAlerts(locationId?: string): Promise<GHLOptimizationAlert[]> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const createdAlerts: GHLOptimizationAlert[] = [];

    try {
      // Get current data for analysis
      const [appointmentsResponse, resourcesResponse, heatmapData] = await Promise.all([
        this.getAppointments({ locationId: effectiveLocationId, limit: 500 }).catch(() => ({ events: [], meta: { total: 0 } })),
        this.getResources(effectiveLocationId).catch(() => ({ resources: [], meta: { total: 0 } })),
        this.getRoomUtilizationHeatmap({ locationId: effectiveLocationId }).catch(() => ({ 
          rooms: [], hours: [], data: [], uniqueDays: 1 
        })),
      ]);

      const appointments = appointmentsResponse.events || [];
      const resources = resourcesResponse.resources || [];
      const roomData = heatmapData.data || [];

      // Check for low utilization alerts
      roomData.forEach((room: any) => {
        if (room.utilPct < 30) {
          createdAlerts.push({
            id: `alert-low-util-${room.room}-${Date.now()}`,
            alert_type: 'low_utilization',
            severity: 'warning',
            title: `Low Utilization: ${room.room}`,
            description: `${room.room} is only ${room.utilPct}% utilized. Consider promoting this room for bookings.`,
            affected_resource: room.room,
            recommended_action: 'Review booking patterns and consider promotional pricing for this room.',
            date: new Date().toISOString().split('T')[0],
            revenue_impact: Math.round((30 - room.utilPct) * 100),
            is_resolved: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            locationId: effectiveLocationId,
            triggered_by: 'system_analysis',
          });
        }
      });

      // Check for equipment underuse
      resources.forEach((resource: any) => {
        const resourceAppointments = appointments.filter((a: any) => 
          a.appointmentLocation === resource.name || a.address1 === resource.name
        );
        if (resourceAppointments.length < 5) {
          createdAlerts.push({
            id: `alert-equip-${resource.id}-${Date.now()}`,
            alert_type: 'equipment_underuse',
            severity: 'info',
            title: `Equipment Underuse: ${resource.name}`,
            description: `${resource.name} has only ${resourceAppointments.length} bookings.`,
            affected_resource: resource.name,
            recommended_action: 'Review equipment scheduling and availability.',
            date: new Date().toISOString().split('T')[0],
            revenue_impact: 0,
            is_resolved: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            locationId: effectiveLocationId,
            triggered_by: 'system_analysis',
          });
        }
      });

      return createdAlerts;
    } catch (error) {
      logger.error('Failed to trigger automated alerts:', error);
      return [];
    }
  }

  // ==================== TREATMENTS API METHODS ====================
  // Treatments are stored as Custom Objects in GHL

  /**
   * Get all treatments for a location
   * Uses GHL Custom Objects or Custom Fields to store treatment data
   */
  async getTreatments(params?: {
    locationId?: string;
    limit?: number;
    page?: number;
    category?: string;
    isActive?: boolean;
  }): Promise<GHLTreatmentsResponse> {
    const locationId = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const apiKey = this.apiKey || '';

    if (!locationId || !apiKey) {
      logger.warn('Missing locationId or apiKey for treatments, returning empty');
      return { treatments: [], meta: { total: 0 } };
    }

    try {
      // Fetch treatments from custom fields (stored as JSON in a custom field)
      const res = await axios.get(
        `https://services.leadconnectorhq.com/locations/${locationId}/customFields`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Version': '2021-07-28',
          },
        }
      );

      const customFields = res.data.customFields || [];
      
      // Find the treatments custom field (by key or name)
      const treatmentsField = customFields.find(
        (f: any) => f.key === 'treatments' || f.name === 'Treatments'
      );

      if (!treatmentsField || !treatmentsField.value) {
        return { treatments: [], meta: { total: 0 } };
      }

      // Parse treatments from the custom field value
      let treatments: GHLTreatment[] = [];
      try {
        treatments = typeof treatmentsField.value === 'string'
          ? JSON.parse(treatmentsField.value)
          : treatmentsField.value;
      } catch (parseError) {
        logger.warn('Failed to parse treatments from custom field');
        return { treatments: [], meta: { total: 0 } };
      }

      // Apply filters
      if (params?.category) {
        treatments = treatments.filter(t => t.category === params.category);
      }
      if (params?.isActive !== undefined) {
        treatments = treatments.filter(t => t.isActive === params.isActive);
      }

      const total = treatments.length;
      
      // Apply pagination
      const limit = params?.limit || 100;
      const page = params?.page || 1;
      const start = (page - 1) * limit;
      const paginatedTreatments = treatments.slice(start, start + limit);

      return {
        treatments: paginatedTreatments,
        meta: {
          total,
          currentPage: page,
          nextPage: start + limit < total ? page + 1 : undefined,
          prevPage: page > 1 ? page - 1 : undefined,
        },
      };
    } catch (error) {
      logger.error('Failed to get treatments:', error);
      return { treatments: [], meta: { total: 0 } };
    }
  }

  /**
   * Get a single treatment by ID
   */
  async getTreatment(treatmentId: string, locationId?: string): Promise<GHLTreatment | null> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    
    const treatmentsResponse = await this.getTreatments({ locationId: effectiveLocationId });
    const treatment = treatmentsResponse.treatments.find(t => t.id === treatmentId);
    
    return treatment || null;
  }

  /**
   * Create a new treatment
   * Stores treatment in GHL Custom Field as JSON
   */
  async createTreatment(treatmentData: TreatmentCreateRequest): Promise<GHLTreatment> {
    const locationId = treatmentData.locationId || process.env.GHL_LOCATION_ID || '';
    const apiKey = this.apiKey || '';

    if (!locationId || !apiKey) {
      throw new Error('Missing locationId or apiKey for creating treatment');
    }

    try {
      // Get existing custom fields
      const res = await axios.get(
        `https://services.leadconnectorhq.com/locations/${locationId}/customFields`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Version': '2021-07-28',
          },
        }
      );

      const customFields = res.data.customFields || [];
      
      // Find or create treatments custom field
      let treatmentsField = customFields.find(
        (f: any) => f.key === 'treatments' || f.name === 'Treatments'
      );

      // Get existing treatments
      let treatments: GHLTreatment[] = [];
      if (treatmentsField && treatmentsField.value) {
        try {
          treatments = typeof treatmentsField.value === 'string'
            ? JSON.parse(treatmentsField.value)
            : treatmentsField.value;
        } catch (e) {
          treatments = [];
        }
      }

      // Create new treatment
      const now = new Date().toISOString();
      const revenuePerHour = treatmentData.duration_minutes > 0
        ? Math.round((treatmentData.price / (treatmentData.duration_minutes / 60)))
        : 0;

      const newTreatment: GHLTreatment = {
        id: `treatment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: treatmentData.name,
        category: treatmentData.category,
        price: treatmentData.price,
        duration_minutes: treatmentData.duration_minutes,
        required_equipment: treatmentData.required_equipment || [],
        required_room_type: treatmentData.required_room_type,
        required_qualification: treatmentData.required_qualification,
        prime_hour_eligible: treatmentData.prime_hour_eligible ?? true,
        revenue_per_hour: revenuePerHour,
        description: treatmentData.description,
        locationId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };

      // Add to treatments array
      treatments.push(newTreatment);

      // Update or create the custom field
      const fieldData = {
        name: 'Treatments',
        key: 'treatments',
        dataType: 'text',
        value: JSON.stringify(treatments),
      };

      if (treatmentsField) {
        // Update existing field
        await axios.put(
          `https://services.leadconnectorhq.com/locations/${locationId}/customFields/${treatmentsField.id}`,
          { value: JSON.stringify(treatments) },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Version': '2021-07-28',
            },
          }
        );
      } else {
        // Create new field
        await axios.post(
          `https://services.leadconnectorhq.com/locations/${locationId}/customFields`,
          fieldData,
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Version': '2021-07-28',
            },
          }
        );
      }

      logger.info(`Created treatment: ${newTreatment.name}`);
      return newTreatment;
    } catch (error) {
      logger.error('Failed to create treatment:', error);
      throw error;
    }
  }

  /**
   * Update an existing treatment
   */
  async updateTreatment(treatmentId: string, treatmentData: TreatmentUpdateRequest, locationId?: string): Promise<GHLTreatment> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const apiKey = this.apiKey || '';

    if (!effectiveLocationId || !apiKey) {
      throw new Error('Missing locationId or apiKey for updating treatment');
    }

    try {
      // Get existing custom fields
      const res = await axios.get(
        `https://services.leadconnectorhq.com/locations/${effectiveLocationId}/customFields`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Version': '2021-07-28',
          },
        }
      );

      const customFields = res.data.customFields || [];
      
      // Find treatments custom field
      const treatmentsField = customFields.find(
        (f: any) => f.key === 'treatments' || f.name === 'Treatments'
      );

      if (!treatmentsField || !treatmentsField.value) {
        throw new Error('Treatments not found');
      }

      // Parse existing treatments
      let treatments: GHLTreatment[] = [];
      try {
        treatments = typeof treatmentsField.value === 'string'
          ? JSON.parse(treatmentsField.value)
          : treatmentsField.value;
      } catch (e) {
        throw new Error('Failed to parse treatments');
      }

      // Find and update the treatment
      const treatmentIndex = treatments.findIndex(t => t.id === treatmentId);
      if (treatmentIndex === -1) {
        throw new Error('Treatment not found');
      }

      const existingTreatment = treatments[treatmentIndex];
      const now = new Date().toISOString();

      // Calculate revenue per hour if price or duration changed
      const newPrice = treatmentData.price ?? existingTreatment.price;
      const newDuration = treatmentData.duration_minutes ?? existingTreatment.duration_minutes;
      const revenuePerHour = newDuration > 0
        ? Math.round((newPrice / (newDuration / 60)))
        : 0;

      // Update the treatment
      const updatedTreatment: GHLTreatment = {
        ...existingTreatment,
        ...treatmentData,
        revenue_per_hour: revenuePerHour,
        updatedAt: now,
      };

      treatments[treatmentIndex] = updatedTreatment;

      // Update the custom field
      await axios.put(
        `https://services.leadconnectorhq.com/locations/${effectiveLocationId}/customFields/${treatmentsField.id}`,
        { value: JSON.stringify(treatments) },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Version': '2021-07-28',
          },
        }
      );

      logger.info(`Updated treatment: ${updatedTreatment.name}`);
      return updatedTreatment;
    } catch (error) {
      logger.error('Failed to update treatment:', error);
      throw error;
    }
  }

  /**
   * Delete a treatment
   */
  async deleteTreatment(treatmentId: string, locationId?: string): Promise<void> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const apiKey = this.apiKey || '';

    if (!effectiveLocationId || !apiKey) {
      throw new Error('Missing locationId or apiKey for deleting treatment');
    }

    try {
      // Get existing custom fields
      const res = await axios.get(
        `https://services.leadconnectorhq.com/locations/${effectiveLocationId}/customFields`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Version': '2021-07-28',
          },
        }
      );

      const customFields = res.data.customFields || [];
      
      // Find treatments custom field
      const treatmentsField = customFields.find(
        (f: any) => f.key === 'treatments' || f.name === 'Treatments'
      );

      if (!treatmentsField || !treatmentsField.value) {
        return; // Nothing to delete
      }

      // Parse existing treatments
      let treatments: GHLTreatment[] = [];
      try {
        treatments = typeof treatmentsField.value === 'string'
          ? JSON.parse(treatmentsField.value)
          : treatmentsField.value;
      } catch (e) {
        return; // Nothing to delete
      }

      // Remove the treatment
      const filteredTreatments = treatments.filter(t => t.id !== treatmentId);

      // Update the custom field
      await axios.put(
        `https://services.leadconnectorhq.com/locations/${effectiveLocationId}/customFields/${treatmentsField.id}`,
        { value: JSON.stringify(filteredTreatments) },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Version': '2021-07-28',
          },
        }
      );

      logger.info(`Deleted treatment: ${treatmentId}`);
    } catch (error) {
      logger.error('Failed to delete treatment:', error);
      throw error;
    }
  }

  // ← UPDATED — also set apiKey on request
  private handleError(error: AxiosError): GHLApiError {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data as any;
      return {
        status,
        message: data?.message || data?.error || 'API request failed',
        error: data?.error,
        details: data,
      };
    }
    if (error.request) {
      return {
        status: 0,
        message: 'No response received from API',
        error: 'NETWORK_ERROR',
      };
    }
    return {
      status: 500,
      message: error.message || 'Unknown error occurred',
      error: 'INTERNAL_ERROR',
    };
  }
}

export const ghlClient = new GHLClient();