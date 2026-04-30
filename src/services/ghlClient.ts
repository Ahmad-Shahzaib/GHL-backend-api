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
  private apiKey: string | null = null;

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

    if (config.GHL_ADMIN_API_KEY) {
      this.apiKey = config.GHL_ADMIN_API_KEY;
    }

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

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  getAuthorizationUrl(): string {
    const params = new URLSearchParams({
      client_id:     config.GHL_CLIENT_ID,
      redirect_uri:  config.GHL_REDIRECT_URI,
      response_type: 'code',
      user_type:     'Company',
    });
    return `${GHL_OAUTH_URLS.authorize}?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string, userType: 'Company' | 'Location' = 'Location'): Promise<GHLTokenResponse> {
    try {
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
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
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
    const params = new URLSearchParams({
      client_id:     config.GHL_CLIENT_ID,
      client_secret: config.GHL_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      user_type:     'Location',
      redirect_uri:  config.GHL_REDIRECT_URI,
    });
    const response = await axios.post<GHLTokenResponse>(
      GHL_OAUTH_URLS.token,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
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
      accessToken:  tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt:    Date.now() + (tokenData.expires_in * 1000),
      scope:        tokenData.scope,
      userType:     tokenData.userType,
      companyId:    tokenData.companyId,
      locationId:   tokenData.locationId,
      userId:       tokenData.userId,
    };
    await tokenStore.storeTokens(key, storedData);
    this.tokenKey = key;
    logger.info(`Tokens stored for key: ${key}`);
  }

  async getLocationToken(companyId: string, locationId: string): Promise<string> {
    const companyTokenData = await tokenStore.getTokens(companyId);

    logger.info('getLocationToken called:', {
      companyId,
      locationId,
      hasCompanyToken: !!companyTokenData?.accessToken,
      companyTokenExpiry: companyTokenData?.expiresAt
        ? new Date(companyTokenData.expiresAt).toISOString()
        : 'none',
    });

    if (!companyTokenData?.accessToken) {
      throw new Error(
        `No company OAuth token found for companyId: ${companyId}. App must be installed first.`
      );
    }

    const response = await axios.post(
      'https://services.leadconnectorhq.com/oauth/locationToken',
      { companyId, locationId },
      {
        headers: {
          'Authorization': `Bearer ${companyTokenData.accessToken}`,
          'Content-Type': 'application/json',
          'Accept':        'application/json',
          'Version':       '2021-07-28',
        },
      }
    );

    const locationTokenData = response.data;
    logger.info('Location token received:', {
      locationId,
      userType:   locationTokenData.userType,
      tokenStart: locationTokenData.access_token?.substring(0, 20),
    });

    await tokenStore.storeTokens(locationId, {
      accessToken:  locationTokenData.access_token,
      refreshToken: locationTokenData.refresh_token,
      expiresAt:    Date.now() + (locationTokenData.expires_in * 1000),
      scope:        locationTokenData.scope || '',
      userType:     'Location',
      companyId,
      locationId,
      userId:       locationTokenData.userId || '',
    });

    logger.info(`Location token stored for locationId: ${locationId}`);
    return locationTokenData.access_token;
  }

  async getValidAccessToken(): Promise<string> {
    logger.info('getValidAccessToken called:', {
      tokenKey:  this.tokenKey,
      hasApiKey: !!this.apiKey,
    });

    // If tokenKey is set, always use tokenStore first
    if (this.tokenKey) {
      const tokens = await tokenStore.getTokens(this.tokenKey);
      if (tokens) {
        const bufferTime = 5 * 60 * 1000;
        if (tokens.expiresAt <= Date.now() + bufferTime) {
          logger.info('Token expired, refreshing...');
          const newTokenData = await this.refreshAccessToken(tokens.refreshToken);
          const updatedTokens: StoredTokenData = {
            ...tokens,
            accessToken: newTokenData.access_token,
            expiresAt:   Date.now() + (newTokenData.expires_in * 1000),
          };
          await tokenStore.storeTokens(this.tokenKey, updatedTokens);
          return newTokenData.access_token;
        }
        logger.info('Using token from tokenStore:', {
          tokenKey:   this.tokenKey,
          tokenStart: tokens.accessToken.substring(0, 20),
        });
        return tokens.accessToken;
      }
      logger.warn('No token in tokenStore for key:', this.tokenKey);
    }

    // Fall back to pit- key only if no tokenKey set
    if (this.apiKey) {
      logger.info('Falling back to pit- API key');
      return this.apiKey;
    }

    throw new Error('No token key set and no API key available.');
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
        url:     requestConfig.url,
        method:  requestConfig.method,
        status:  axiosError.response?.status,
        data:    axiosError.response?.data,
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
    if (params?.limit)      queryParams.append('limit',      params.limit.toString());
    if (params?.page)       queryParams.append('page',       params.page.toString());
    if (params?.query)      queryParams.append('query',      params.query);
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
    if (params?.limit)      queryParams.append('limit',       params.limit.toString());
    if (params?.page)       queryParams.append('page',        params.page.toString());
    if (params?.pipelineId) queryParams.append('pipelineId',  params.pipelineId);
    if (params?.stageId)    queryParams.append('stageId',     params.stageId);
    // GHL opportunities/search requires location_id (underscore) not locationId
    if (params?.locationId) queryParams.append('location_id', params.locationId);
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
    const companyId  = process.env.GHL_COMPANY_ID  || locationId;

    const requestBody: any = {
      companyId,
      firstName:   userData.firstName,
      lastName:    userData.lastName,
      email:       userData.email,
      password:    userData.password,
      type:        userData.type || 'account',
      role:        userData.role || 'user',
      locationIds: userData.locationIds || (locationId ? [locationId] : []),
    };

    if (userData.phone)  requestBody.phone  = userData.phone;
    if (userData.scopes) requestBody.scopes = userData.scopes;

    try {
      const res = await axios.post(
        'https://services.leadconnectorhq.com/users/',
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Version':       '2021-07-28',
          },
        }
      );
      return res.data;
    } catch (error: any) {
      logger.error('GHL Users API Error:', {
        status:  error.response?.status,
        data:    error.response?.data,
        message: error.message,
      });
      throw error;
    }
  }

  async createLocation(locationData: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    timezone?: string;
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
  }): Promise<GHLLocation> {
    const token = this.apiKey;
    if (!token) throw new Error('GHL API key is not configured');

    const requestBody: any = {
      name:       locationData.name,
      email:      locationData.email,
      phone:      locationData.phone,
      address:    locationData.address,
      city:       locationData.city,
      state:      locationData.state,
      postalCode: locationData.postalCode,
      country:    locationData.country,
      timezone:   locationData.timezone,
    };

    if (locationData.business) requestBody.business = locationData.business;

    try {
      const res = await axios.post(
        'https://services.leadconnectorhq.com/locations/',
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Version':       '2021-07-28',
          },
        }
      );
      return res.data;
    } catch (error: any) {
      logger.error('GHL Create Location Error:', {
        status:  error.response?.status,
        data:    error.response?.data,
        message: error.message,
      });
      throw error;
    }
  }

  async getCalendars(locationId?: string): Promise<{ calendars: GHLCalendar[] }> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const queryParams = new URLSearchParams();
    if (effectiveLocationId) queryParams.append('locationId', effectiveLocationId);
    const url = `${GHL_API_ENDPOINTS.calendars}?${queryParams.toString()}`;
    return this.makeRequest<{ calendars: GHLCalendar[] }>({ method: 'GET', url });
  }

  async getCalendar(calendarId: string): Promise<GHLCalendar> {
    return this.makeRequest<GHLCalendar>({
      method: 'GET',
      url: GHL_API_ENDPOINTS.calendarById(calendarId),
    });
  }
  
  async getFreeSlots(calendarId: string, params: { startDate: string; endDate: string; userId?: string; }): Promise<any> {
    const queryParams = new URLSearchParams({
      startDate: params.startDate,
      endDate: params.endDate,
    });
    if (params.userId) queryParams.append('userId', params.userId);
    
    const url = `${GHL_API_ENDPOINTS.freeSlots(calendarId)}?${queryParams.toString()}`;
    return this.makeRequest<any>({ method: 'GET', url });
  }

  async getAppointments(params?: {
    locationId?: string;
    limit?: number;
    calendarId?: string;
    startTime?: string;
    endTime?: string;
    userId?: string;
    page?: number;
  }): Promise<any> {
    const locationId = params?.locationId || '';

    // Use location token if available, fall back to pit- key
    const token = await this.getValidAccessToken();

    const contactsRes = await axios.get(
      `https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&limit=100`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Version': '2021-07-28' } }
    );

    const contacts = contactsRes.data.contacts || [];

    const allAppointments = (await Promise.all(
      contacts.map((contact: any) =>
        axios.get(
          `https://services.leadconnectorhq.com/contacts/${contact.id}/appointments`,
          { headers: { 'Authorization': `Bearer ${token}`, 'Version': '2021-07-28' } }
        ).then(res => (res.data.events || []).map((appt: any) => ({
          ...appt,
          contactName:  `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
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
    const token      = await this.getValidAccessToken();
    const locationId = appointmentData.locationId || process.env.GHL_LOCATION_ID || '';

    const res = await axios.post(
      'https://services.leadconnectorhq.com/calendars/events/appointments',
      { ...appointmentData, locationId },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Version':       '2021-07-28',
        },
      }
    );
    return res.data;
  }

  async getResources(locationId?: string): Promise<any> {
    const token = await this.getValidAccessToken();
    try {
      // Fetch calendar rooms from GHL
      const res = await axios.get(
        `https://services.leadconnectorhq.com/calendars/resources/rooms?locationId=${locationId}`,
        { headers: { 'Authorization': `Bearer ${token}`, 'Version': '2021-07-28' } }
      );
      const rooms = (res.data.rooms || res.data.resources || []).map((r: any) => ({
        id:            r.id,
        name:          r.name,
        capacity_type: r.resourceType || 'room',
        equipment:     r.description || '',
        quantity:      r.quantity || 1,
      }));
      return { resources: rooms, meta: { total: rooms.length } };
    } catch (error: any) {
      logger.warn('Could not fetch calendar rooms:', error?.message);
      return { resources: [], meta: { total: 0 } };
    }
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
    const token        = this.apiKey;
    const resourceType = resourceData.resourceType || 'rooms';
    const locationId   = resourceData.locationId || process.env.GHL_LOCATION_ID || '';

    const res = await axios.post(
      `https://services.leadconnectorhq.com/calendars/resources/${resourceType}`,
      {
        locationId,
        name:         resourceData.name,
        description:  resourceData.description || '',
        quantity:     resourceData.quantity    || 1,
        outOfService: resourceData.outOfService || 0,
        capacity:     resourceData.capacity    || 1,
        calendarIds:  resourceData.calendarIds || [],
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Version':       '2021-04-15',
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

    let contacts: any[]      = [];
    let opportunities: any[] = [];

    try {
      const contactsResponse = await this.getContacts({ limit: 100, locationId: effectiveLocationId });
      contacts = contactsResponse.contacts || [];
    } catch (error) {
      logger.warn('Could not fetch contacts:', error);
    }

    try {
      const opportunitiesResponse = await this.getOpportunities({ limit: 100, locationId: effectiveLocationId });
      opportunities = opportunitiesResponse.opportunities || [];
      logger.info(`Dashboard Stats: Fetched ${opportunities.length} opportunities`);
      if (opportunities.length > 0) {
        logger.info(`First opportunity: ${JSON.stringify(opportunities[0], null, 2)}`);
      }
    } catch (error) {
      logger.warn('Could not fetch opportunities:', error);
    }

    const totalOpportunityValue = opportunities.reduce((sum, opp) => {
      const val = opp.monetaryValue || 0;
      return sum + val;
    }, 0);
    
    logger.info(`Dashboard Stats: totalOpportunityValue = ${totalOpportunityValue}`);

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
          name:   opp.pipelineId || 'Unknown',
          stages: new Map(),
          value:  0,
        });
      }
      const pipeline   = pipelineMap.get(opp.pipelineId || '')!;
      const stageCount = pipeline.stages.get(opp.stageId || '') || 0;
      pipeline.stages.set(opp.stageId || '', stageCount + 1);
      
      // Try multiple field names for monetary value
      const oppValue = (opp as any).monetaryValue || (opp as any).value || (opp as any).amount || 0;
      pipeline.value += oppValue;
      
      logger.info(`Opp ${opp.id}: monetaryValue=${(opp as any).monetaryValue}, value=${(opp as any).value}, amount=${(opp as any).amount}, customFields=${JSON.stringify((opp as any).customFields)}`);
    });

    const pipelineSummary = Array.from(pipelineMap.entries()).map(([id, data]) => ({
      pipelineId:   id,
      pipelineName: data.name,
      stageCounts:  Object.fromEntries(data.stages),
      totalValue:   data.value,
    }));

    return {
      totalContacts:        contacts.length,
      totalOpportunities:   opportunities.length,
      totalOpportunityValue,
      totalAppointments:    0,
      recentContacts,
      recentOpportunities,
      pipelineSummary,
    };
  }

  async getPipelines(locationId?: string): Promise<any> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const queryParams = new URLSearchParams();
    if (effectiveLocationId) queryParams.append('locationId', effectiveLocationId);
    const url = `${GHL_API_ENDPOINTS.pipelines}?${queryParams.toString()}`;
    return this.makeRequest<any>({ method: 'GET', url });
  }

  async getKpiMetrics(locationId?: string, dateRange?: { startDate?: string; endDate?: string }): Promise<KpiDashboardData> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const now          = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate    = dateRange?.startDate || thirtyDaysAgo.toISOString();
    const endDate      = dateRange?.endDate   || now.toISOString();

    const [contactsResponse, opportunitiesResponse, pipelinesResponse, appointmentsResponse] = await Promise.all([
      this.getContacts({ limit: 100, locationId: effectiveLocationId }).catch(() => ({ contacts: [], meta: { total: 0 } })),
      this.getOpportunities({ limit: 100, locationId: effectiveLocationId }).catch(() => ({ opportunities: [], meta: { total: 0 } })),
      this.getPipelines(effectiveLocationId).catch(() => ({ pipelines: [] })),
      this.getAppointments({ locationId: effectiveLocationId, limit: 100 }).catch(() => ({ events: [], meta: { total: 0 } })),
    ]);

    const contacts      = contactsResponse.contacts      || [];
    const opportunities = opportunitiesResponse.opportunities || [];
    const pipelines     = pipelinesResponse.pipelines    || [];
    const appointments  = appointmentsResponse.events    || [];

    const totalContacts      = contacts.length;
    const totalOpportunities = opportunities.length;
    const totalPipelineValue = opportunities.reduce((sum: number, opp: GHLOpportunity) => sum + (opp.monetaryValue || 0), 0);
    const totalAppointments  = appointments.length;

    const conversionRate      = totalContacts > 0 ? Math.round((totalOpportunities / totalContacts) * 100) : 0;
    const avgOpportunityValue = totalOpportunities > 0 ? Math.round(totalPipelineValue / totalOpportunities) : 0;
    const pipelineGap         = Math.max(0, 100 - Math.min(100, conversionRate + 10));
    const workingHoursPerMonth = 8 * 22;
    const avgRevenuePerHour   = Math.round(totalPipelineValue / workingHoursPerMonth);
    const profitDensity       = Math.round(avgRevenuePerHour * 0.7);

    const pipelineStats      = this.calculatePipelineStats(opportunities, pipelines);
    const contactsTrend      = this.calculateTrendData(contacts, 'dateAdded', startDate, endDate);
    const opportunitiesTrend = this.calculateOpportunityTrend(opportunities, startDate, endDate);
    const revenueTrend       = this.calculateRevenueTrend(opportunities, startDate, endDate);

    const daysInPeriod       = Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)));
    const leadVelocity       = Math.round((totalContacts / daysInPeriod) * 10) / 10;
    const opportunityVelocity = Math.round((totalOpportunities / daysInPeriod) * 10) / 10;

    const wonOpportunities = opportunities.filter((o: GHLOpportunity) => o.status === 'won' || o.status === 'closed');
    const avgTimeToClose   = this.calculateAvgTimeToClose(wonOpportunities);

    const metrics     = this.calculateKpiMetrics(conversionRate, avgOpportunityValue, pipelineGap, avgRevenuePerHour, profitDensity);
    const systemScore = this.calculateSystemScore(metrics);
    const healthStatus = systemScore >= 80 ? 'excellent' : systemScore >= 60 ? 'good' : systemScore >= 40 ? 'needs_attention' : 'critical';

    return {
      conversionRate, avgOpportunityValue, pipelineGap, avgRevenuePerHour, profitDensity,
      totalContacts, totalOpportunities, totalPipelineValue, totalAppointments,
      totalRevenue: totalPipelineValue, metrics, pipelineStats,
      contactsTrend, opportunitiesTrend, revenueTrend,
      systemScore, healthStatus, avgTimeToClose, leadVelocity, opportunityVelocity,
      dateRange: { startDate, endDate },
    };
  }

  private calculatePipelineStats(opportunities: GHLOpportunity[], pipelines: any[]): PipelineKpiData[] {
    const pipelineMap    = new Map<string, any>();
    const pipelineLookup = new Map(pipelines.map((p: any) => [p.id, p]));

    opportunities.forEach(opp => {
      const pipelineId = opp.pipelineId || 'unknown';
      const stageId    = opp.stageId    || 'unknown';

      if (!pipelineMap.has(pipelineId)) {
        const pipeline = pipelineLookup.get(pipelineId);
        pipelineMap.set(pipelineId, {
          name:      pipeline?.name || opp.pipelineId || 'Unknown Pipeline',
          stages:    new Map(),
          wonCount:  0, wonValue:  0,
          lostCount: 0, lostValue: 0,
          openCount: 0, openValue: 0,
        });
      }

      const pipeline = pipelineMap.get(pipelineId)!;

      if (opp.status === 'won' || opp.status === 'closed') {
        pipeline.wonCount++; pipeline.wonValue += opp.monetaryValue || 0;
      } else if (opp.status === 'lost' || opp.status === 'abandoned') {
        pipeline.lostCount++; pipeline.lostValue += opp.monetaryValue || 0;
      } else {
        pipeline.openCount++; pipeline.openValue += opp.monetaryValue || 0;
      }

      if (!pipeline.stages.has(stageId)) {
        const pipelineData = pipelineLookup.get(pipelineId);
        const stage        = pipelineData?.stages?.find((s: any) => s.id === stageId);
        pipeline.stages.set(stageId, { name: stage?.name || `Stage ${stageId}`, count: 0, value: 0 });
      }

      const stageData = pipeline.stages.get(stageId)!;
      stageData.count++;
      stageData.value += opp.monetaryValue || 0;
    });

    return Array.from(pipelineMap.entries()).map(([pipelineId, data]) => {
      const totalItems = data.wonCount + data.lostCount + data.openCount;
      const totalValue = data.wonValue + data.lostValue + data.openValue;
      const stages: PipelineStageMetric[] = Array.from(data.stages.entries()).map(([stageId, stageData]: any) => ({
        stageId,
        stageName:  stageData.name,
        count:      stageData.count,
        totalValue: stageData.value,
        avgValue:   stageData.count > 0 ? Math.round(stageData.value / stageData.count) : 0,
      }));

      return {
        pipelineId, pipelineName: data.name, totalItems, totalValue,
        avgValue:   totalItems > 0 ? Math.round(totalValue / totalItems) : 0,
        stages,
        wonCount:   data.wonCount,  wonValue:  data.wonValue,
        lostCount:  data.lostCount, lostValue: data.lostValue,
        openCount:  data.openCount, openValue: data.openValue,
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
        const dateKey = this.toLocalDateString(new Date(date));
        dailyCounts.set(dateKey, (dailyCounts.get(dateKey) || 0) + 1);
      }
    });

    const result: { date: string; count: number }[] = [];
    const current = new Date(startDate);
    const end     = new Date(endDate);
    while (current <= end) {
      const dateKey = this.toLocalDateString(current);
      result.push({ date: dateKey, count: dailyCounts.get(dateKey) || 0 });
      current.setDate(current.getDate() + 1);
    }
    return result.slice(-30);
  }

  private calculateOpportunityTrend(opportunities: GHLOpportunity[], startDate: string, endDate: string): { date: string; count: number; value: number }[] {
    const dailyData = new Map<string, { count: number; value: number }>();
    opportunities.forEach(opp => {
      const date = opp.dateAdded;
      if (date) {
        const dateKey  = this.toLocalDateString(new Date(date));
        const existing = dailyData.get(dateKey) || { count: 0, value: 0 };
        dailyData.set(dateKey, { count: existing.count + 1, value: existing.value + (opp.monetaryValue || 0) });
      }
    });

    const result: { date: string; count: number; value: number }[] = [];
    const current = new Date(startDate);
    const end     = new Date(endDate);
    while (current <= end) {
      const dateKey = this.toLocalDateString(current);
      const data    = dailyData.get(dateKey) || { count: 0, value: 0 };
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
        const dateKey = this.toLocalDateString(new Date(date));
        dailyRevenue.set(dateKey, (dailyRevenue.get(dateKey) || 0) + (opp.monetaryValue || 0));
      }
    });

    const result: { date: string; revenue: number }[] = [];
    const current = new Date(startDate);
    const end     = new Date(endDate);
    while (current <= end) {
      const dateKey = this.toLocalDateString(current);
      result.push({ date: dateKey, revenue: dailyRevenue.get(dateKey) || 0 });
      current.setDate(current.getDate() + 1);
    }
    return result.slice(-30);
  }

  private calculateAvgTimeToClose(wonOpportunities: GHLOpportunity[]): number {
    if (wonOpportunities.length === 0) return 0;
    const totalDays = wonOpportunities.reduce((sum, opp) => {
      if (opp.dateAdded && opp.dateStatusChanged) {
        const added  = new Date(opp.dateAdded).getTime();
        const closed = new Date(opp.dateStatusChanged).getTime();
        return sum + Math.ceil((closed - added) / (1000 * 60 * 60 * 24));
      }
      return sum;
    }, 0);
    return Math.round(totalDays / wonOpportunities.length);
  }

  private calculateKpiMetrics(conversionRate: number, avgOpportunityValue: number, pipelineGap: number, avgRevenuePerHour: number, profitDensity: number): KpiMetric[] {
    const thresholds = {
      occupancy:     { green: 75,  yellow: 55  },
      revenuePerHour:{ green: 300, yellow: 200 },
      idlePct:       { green: 20,  yellow: 35  },
      profitDensity: { green: 70,  yellow: 50  },
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
      { label: 'Conversion Rate',      value: conversionRate,      unit: '%',    status: getStatus(conversionRate, 'occupancy'),      statusLabel: statusLabel[getStatus(conversionRate, 'occupancy')],      description: '% of contacts converted to opportunities', target: '≥75% Green',  kpiKey: 'occupancy'      },
      { label: 'Avg Opportunity Value', value: avgOpportunityValue, unit: '$',    status: getStatus(avgOpportunityValue, 'revenuePerHour'), statusLabel: statusLabel[getStatus(avgOpportunityValue, 'revenuePerHour')], description: 'Average value per opportunity',               target: '≥$300 Green', kpiKey: 'revenuePerHour' },
      { label: 'Pipeline Gap',          value: pipelineGap,         unit: '%',    status: getStatus(pipelineGap, 'idlePct', true),     statusLabel: statusLabel[getStatus(pipelineGap, 'idlePct', true)],     description: 'Room for pipeline growth',                   target: '≤20% Green',  kpiKey: 'idlePct'        },
      { label: 'Avg Revenue / Hour',    value: avgRevenuePerHour,   unit: '$/hr', status: getStatus(avgRevenuePerHour, 'revenuePerHour'),   statusLabel: statusLabel[getStatus(avgRevenuePerHour, 'revenuePerHour')],   description: 'Estimated revenue per hour',                 target: '≥$300 Green', kpiKey: 'revenuePerHour' },
      { label: 'Profit Density',        value: profitDensity,       unit: '$/hr', status: getStatus(profitDensity, 'profitDensity'),    statusLabel: statusLabel[getStatus(profitDensity, 'profitDensity')],    description: 'Estimated profit per hour',                  target: '≥$70 Green',  kpiKey: 'profitDensity'  },
    ];
  }

  private calculateSystemScore(metrics: KpiMetric[]): number {
    return Math.round(metrics.reduce((sum, m) => sum + (m.status === 'green' ? 100 : m.status === 'yellow' ? 60 : 20), 0) / metrics.length);
  }

  async getWorkflows(params?: { locationId?: string; limit?: number; page?: number; status?: 'draft' | 'published' | 'archived'; }): Promise<GHLWorkflowsResponse> {
    const locationId = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const queryParams = new URLSearchParams();
    if (locationId)     queryParams.append('locationId', locationId);
    if (params?.limit)  queryParams.append('limit',      params.limit.toString());
    if (params?.page)   queryParams.append('page',       params.page.toString());
    if (params?.status) queryParams.append('status',     params.status);
    return this.makeRequest<GHLWorkflowsResponse>({ method: 'GET', url: `/workflows/?${queryParams.toString()}` });
  }

  async getWorkflow(workflowId: string, locationId?: string): Promise<GHLWorkflow> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const queryParams = new URLSearchParams();
    if (effectiveLocationId) queryParams.append('locationId', effectiveLocationId);
    return this.makeRequest<GHLWorkflow>({ method: 'GET', url: `/workflows/${workflowId}?${queryParams.toString()}` });
  }

  async createWorkflow(workflowData: Partial<GHLWorkflow>): Promise<GHLWorkflow> {
    return this.makeRequest<GHLWorkflow>({ method: 'POST', url: '/workflows/', data: workflowData });
  }

  async updateWorkflow(workflowId: string, workflowData: Partial<GHLWorkflow>): Promise<GHLWorkflow> {
    return this.makeRequest<GHLWorkflow>({ method: 'PUT', url: `/workflows/${workflowId}`, data: workflowData });
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    return this.makeRequest<void>({ method: 'DELETE', url: `/workflows/${workflowId}` });
  }

  async getWorkflowOptimizationRules(locationId?: string): Promise<WorkflowOptimizationRule[]> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const apiKey = this.apiKey || '';
    if (!effectiveLocationId || !apiKey) {
      logger.warn('Missing locationId or apiKey for workflow rules, returning defaults');
      return workflowRulesService['DEFAULT_RULES'];
    }
    try {
      return await workflowRulesService.getRules(effectiveLocationId, apiKey);
    } catch (error) {
      logger.error('Failed to get workflow optimization rules:', error);
      return workflowRulesService['DEFAULT_RULES'];
    }
  }

  async updateWorkflowOptimizationRules(rules: WorkflowOptimizationRule[], locationId?: string): Promise<WorkflowOptimizationRule[]> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const apiKey = this.apiKey || '';
    if (!effectiveLocationId || !apiKey) throw new Error('Missing locationId or apiKey for updating workflow rules');
    return await workflowRulesService.updateRules(effectiveLocationId, apiKey, rules);
  }

  async analyzeSchedulingViolations(params?: { locationId?: string; startDate?: string; endDate?: string; }): Promise<WorkflowSchedulingViolation[]> {
    const locationId = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const cacheKey   = `violations:${locationId}:${params?.startDate || 'all'}:${params?.endDate || 'all'}`;

    const cached = await cacheService.get<WorkflowSchedulingViolation[]>(cacheKey);
    if (cached) return cached;

    const violations: WorkflowSchedulingViolation[] = [];
    const PRIME_HOURS = [10, 11, 12, 13, 14, 15, 16, 17];

    try {
      const rules         = await this.getWorkflowOptimizationRules(locationId);
      const primeHourRule = rules.find(r => r.type === 'prime_hour_protection' && r.isActive);
      if (!primeHourRule) return [];

      const appointmentsResponse = await this.getAppointments({ locationId, startTime: params?.startDate, endTime: params?.endDate, limit: 500 });
      const appointments         = appointmentsResponse.events || [];
      const effectivePrimeHours  = primeHourRule.config.primeHours || PRIME_HOURS;

      appointments.forEach((appt: any) => {
        if (!appt.startTime) return;
        const startTime        = new Date(appt.startTime);
        const hour             = startTime.getHours();
        const isPrime          = effectivePrimeHours.includes(hour);
        const category         = appt.treatment_category || (appt as any).customFields?.treatment_category;
        const blockedCategories = primeHourRule.config.blockedCategories || ['low_ticket'];
        if (isPrime && blockedCategories.includes(category)) {
          violations.push({
            id:            `violation-${appt.id}`,
            type:          'prime_hour_violation',
            detail:        `${appt.title || 'Unknown'} (${category}) booked at ${startTime.toLocaleTimeString()} on ${startTime.toLocaleDateString()}`,
            room:          appt.appointmentLocation || (appt as any).address1,
            revenue:       (appt as any).monetaryValue || 0,
            appointmentId: appt.id,
            severity:      'medium',
            detectedAt:    new Date().toISOString(),
          });
        }
      });

      await cacheService.set(cacheKey, violations, 2 * 60 * 1000);
      return violations;
    } catch (error) {
      logger.warn('Failed to analyze scheduling violations:', error);
      return [];
    }
  }

  async getScheduleBlocks(params?: { locationId?: string; date?: string; }): Promise<WorkflowScheduleBlock[]> {
    const locationId  = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const cacheKey    = `schedule_blocks:${locationId}:${params?.date || 'today'}`;
    const cached      = await cacheService.get<WorkflowScheduleBlock[]>(cacheKey);
    if (cached) return cached;

    const PRIME_HOURS  = [10, 11, 12, 13, 14, 15, 16, 17];
    const HOUR_LABELS  = Array.from({ length: 13 }, (_, i) => `${i + 8}:00`);

    try {
      const rules            = await this.getWorkflowOptimizationRules(locationId);
      const primeHourRule    = rules.find(r => r.type === 'prime_hour_protection');
      const effectivePrimeHours = primeHourRule?.config?.primeHours || PRIME_HOURS;

      const appointmentsResponse = await this.getAppointments({ locationId, startTime: params?.date ? new Date(params.date).toISOString() : undefined, limit: 500 });
      const appointments         = appointmentsResponse.events || [];

      const blocks = HOUR_LABELS.map(label => {
        const hour    = parseInt(label.split(':')[0], 10);
        const isPrime = effectivePrimeHours.includes(hour);
        const appts   = appointments.filter((a: any) => a.startTime && new Date(a.startTime).getHours() === hour);

        const highTicket  = appts.filter((a: any) => (a.treatment_category || (a as any).customFields?.treatment_category) === 'high_ticket').length;
        const lowTicket   = appts.filter((a: any) => (a.treatment_category || (a as any).customFields?.treatment_category) === 'low_ticket').length;
        const utilization = Math.min(100, (appts.length / 4) * 100);

        return { hour, label, isPrime, total: appts.length, highTicket, lowTicket, utilization };
      });

      await cacheService.set(cacheKey, blocks, 5 * 60 * 1000);
      return blocks;
    } catch (error) {
      logger.warn('Failed to get schedule blocks:', error);
      return HOUR_LABELS.map(label => {
        const hour = parseInt(label.split(':')[0], 10);
        return { hour, label, isPrime: PRIME_HOURS.includes(hour), total: 0, highTicket: 0, lowTicket: 0, utilization: 0 };
      });
    }
  }

  async getRoomUtilizationHeatmap(params?: RoomHeatmapQueryParams): Promise<RoomUtilizationHeatmap> {
    const locationId = params?.locationId || process.env.GHL_LOCATION_ID || '';
    // Default: last 30 days + next 30 days to include upcoming appointments
    const now = new Date();
    const thirtyDaysAgo   = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const startDate  = params?.startDate || thirtyDaysAgo.toISOString();
    const endDate    = params?.endDate   || thirtyDaysAhead.toISOString();
    const hours      = params?.hours || Array.from({ length: 12 }, (_, i) => i + 8);

    const [appointmentsResponse, calendarsResponse] = await Promise.all([
      this.getAppointments({ locationId, startTime: startDate, endTime: endDate, limit: 1000 }),
      this.getCalendars(locationId).catch(() => ({ calendars: [] })),
    ]);

    const appointments = appointmentsResponse.events || [];
    const calendars    = calendarsResponse.calendars || [];

    // Build calendar ID → name map
    const calendarMap: Record<string, string> = {};
    calendars.forEach((c: any) => { calendarMap[c.id] = c.name; });

    // Get room names from calendars
    const roomNames = calendars.length > 0
      ? calendars.map((c: any) => c.name)
      : [...new Set(appointments.map((a: any) => a.appointmentLocation || a.address1).filter(Boolean))];

    if (roomNames.length === 0) return { rooms: [], hours, data: [], uniqueDays: 0, startDate, endDate };

    const uniqueDaysSet = new Set(appointments.map((a: GHLAppointment) => this.toLocalDateString(new Date(a.startTime))));
    const uniqueDays    = uniqueDaysSet.size || 1;

    const heatmapData: RoomUtilizationHeatmap['data'] = roomNames.map((room: string) => ({
      room, hours: {} as Record<string, { booked: number; revenue: number }>, totalBooked: 0, totalRevenue: 0, utilPct: 0,
    }));

    heatmapData.forEach(roomData => { hours.forEach(h => { roomData.hours[h] = { booked: 0, revenue: 0 }; }); });

    appointments.forEach((appointment: any) => {
      // Resolve calendarId to room name
      const roomName = calendarMap[appointment.calendarId] || appointment.appointmentLocation || appointment.address1;
      if (!roomName) return;
      const roomData = heatmapData.find(r => r.room === roomName);
      if (!roomData) return;
      const hour = new Date(appointment.startTime).getHours();
      if (hours.includes(hour)) {
        roomData.hours[hour].booked++;
        roomData.hours[hour].revenue += (appointment as any).monetaryValue || 0;
      }
    });

    heatmapData.forEach(roomData => {
      roomData.totalBooked  = hours.reduce((sum, h) => sum + (roomData.hours[h]?.booked  || 0), 0);
      roomData.totalRevenue = hours.reduce((sum, h) => sum + (roomData.hours[h]?.revenue || 0), 0);
      const maxPossible     = hours.length * uniqueDays;
      roomData.utilPct      = maxPossible > 0 ? Math.round((roomData.totalBooked / maxPossible) * 100) : 0;
    });

    heatmapData.sort((a, b) => b.utilPct - a.utilPct);
    return { rooms: roomNames, hours, data: heatmapData, uniqueDays, startDate, endDate };
  }

  async getReportsData(params?: { locationId?: string; startDate?: string; endDate?: string; }): Promise<import('../types').ReportsData> {
    const locationId  = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const now         = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate   = params?.startDate || thirtyDaysAgo.toISOString();
    const endDate     = params?.endDate   || now.toISOString();

    const [appointmentsResponse, opportunitiesResponse, heatmapData] = await Promise.all([
      this.getAppointments({ locationId, startTime: startDate, endTime: endDate, limit: 1000 }).catch(() => ({ events: [], meta: { total: 0 } })),
      this.getOpportunities({ limit: 100, locationId }).catch(() => ({ opportunities: [], meta: { total: 0 } })),
      this.getRoomUtilizationHeatmap({ locationId, startDate, endDate }).catch(() => ({ rooms: [], hours: [], data: [], uniqueDays: 1 })),
    ]);

    const appointments  = appointmentsResponse.events    || [];
    const opportunities = opportunitiesResponse.opportunities || [];

    const uniqueDaysSet = new Set(appointments.map((a: any) => a.startTime ? this.toLocalDateString(new Date(a.startTime)) : null).filter(Boolean));
    const uniqueDays    = uniqueDaysSet.size || 1;

    const completedAppointments  = appointments.filter((a: any) => a.status !== 'cancelled' && a.status !== 'no_show' && a.status !== 'canceled');
    const cancelledAppointments  = appointments.filter((a: any) => a.status === 'cancelled'  || a.status === 'no_show' || a.status === 'canceled');
    const totalOpportunityValue  = opportunities.reduce((sum: number, opp: import('../types').GHLOpportunity) => sum + (opp.monetaryValue || 0), 0);
    const totalRevenue           = completedAppointments.reduce((sum: number, appt: any) => sum + (appt.monetaryValue || appt.revenue || 0), 0) || totalOpportunityValue;

    const dailyRevenue          = totalRevenue / uniqueDays;
    const annualBase            = dailyRevenue * 250;
    const avgUtilization        = heatmapData.data && heatmapData.data.length > 0
      ? Math.round(heatmapData.data.reduce((sum, r) => sum + r.utilPct, 0) / heatmapData.data.length) : 0;

    const PRIME_HOURS = [10, 11, 12, 13, 14, 15, 16, 17];
    let primeHourBookings = 0;
    heatmapData.data.forEach(room => { PRIME_HOURS.forEach(hour => { if (room.hours[hour]) primeHourBookings += room.hours[hour].booked; }); });

    const numRooms              = heatmapData.rooms.length || 4;
    const totalPrimeSlots       = numRooms * PRIME_HOURS.length * uniqueDays;
    const primeHourUtilization  = totalPrimeSlots > 0 ? Math.round((primeHourBookings / totalPrimeSlots) * 100) : 0;
    const idleTimePercentage    = Math.max(0, 100 - avgUtilization);
    const avgRevenuePerAppointment = completedAppointments.length > 0 ? Math.round(totalRevenue / completedAppointments.length) : 0;
    const avgRevenuePerHour     = Math.round(totalRevenue / (uniqueDays * 8));
    const avgRevenuePerDay      = Math.round(dailyRevenue);
    const utilIncrease          = Math.round(annualBase * 0.22);
    const primeIncrease         = Math.round(annualBase * 0.18);
    const combinedLift          = Math.round(annualBase * 0.35);

    const successMetrics = [
      { metric: 'Room Utilization',          target: '+15–30% increase',    current: `${avgUtilization}% current`,       status: avgUtilization >= 65        ? 'on_track' as const : avgUtilization >= 45        ? 'needs_attention' as const : 'critical' as const },
      { metric: 'Prime-Hour High-Ticket',    target: '+20% occupancy',      current: `${primeHourUtilization}% current`, status: primeHourUtilization >= 60  ? 'on_track' as const : primeHourUtilization >= 40  ? 'needs_attention' as const : 'critical' as const },
      { metric: 'Idle Room Time',            target: '-25% reduction',      current: `${idleTimePercentage}% current`,   status: idleTimePercentage <= 25    ? 'on_track' as const : idleTimePercentage <= 40    ? 'needs_attention' as const : 'critical' as const },
      { metric: 'Revenue per Provider Hour', target: 'Measurable increase', current: `$${avgRevenuePerHour}/hr current`, status: avgRevenuePerHour >= 200    ? 'on_track' as const : avgRevenuePerHour >= 100    ? 'needs_attention' as const : 'critical' as const },
    ];

    return {
      currentAnnual: Math.round(annualBase), totalRevenue: Math.round(totalRevenue),
      totalAppointments: appointments.length, completedAppointments: completedAppointments.length, cancelledAppointments: cancelledAppointments.length,
      avgUtilization, primeHourUtilization, idleTimePercentage, avgRevenuePerAppointment, avgRevenuePerHour, avgRevenuePerDay,
      projections: { utilIncrease, primeIncrease, combinedLift, capacityIncrease: 22, idleReduction: 28, primeHQIncrease: 20, totalUpside: combinedLift },
      successMetrics, dateRange: { startDate, endDate }, uniqueDays,
    };
  }

  async getRevenueByHour(params?: { locationId?: string; startDate?: string; endDate?: string; }): Promise<any> {
    const locationId    = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const now           = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate     = params?.startDate || thirtyDaysAgo.toISOString();
    const endDate       = params?.endDate   || now.toISOString();
    const PRIME_HOURS   = [10, 11, 12, 13, 14, 15, 16, 17];

    try {
      const [appointmentsResponse, opportunitiesResponse] = await Promise.all([
        this.getAppointments({ locationId, startTime: startDate, endTime: endDate, limit: 1000 }),
        this.getOpportunities({ limit: 100, locationId }), // Fixed: GHL limit is 100
      ]);

      const appointments  = appointmentsResponse.events    || [];
      const opportunities = opportunitiesResponse.opportunities || [];

      logger.info(`Revenue By Hour: ${appointments.length} appointments, ${opportunities.length} opportunities`);

      const contactRevenueMap = new Map<string, number>();
      opportunities.forEach(opp => {
        const value = (opp as any).monetaryValue || (opp as any).value || (opp as any).amount || 0;
        if (opp.contactId && value) {
          contactRevenueMap.set(opp.contactId, (contactRevenueMap.get(opp.contactId) || 0) + value);
        }
      });

      const hourlyRevenue = new Map<number, number>();
      for (let h = 8; h <= 19; h++) hourlyRevenue.set(h, 0);

      // Process Appointments
      appointments.forEach((appt: any) => {
        if (!appt.startTime) return;
        const hour = new Date(appt.startTime).getHours();
        if (hour < 8 || hour > 19) return;
        let revenue = appt.monetaryValue || appt.revenue || appt.value || appt.amount || 0;
        if (!revenue && appt.contactId && contactRevenueMap.has(appt.contactId)) {
          revenue = contactRevenueMap.get(appt.contactId) || 0;
        }
        hourlyRevenue.set(hour, (hourlyRevenue.get(hour) || 0) + revenue);
      });

      // Always process opportunities to capture revenue (not just as fallback)
      opportunities.forEach(opp => {
        const monetaryValue = (opp as any).monetaryValue || (opp as any).value || (opp as any).amount || 0;
        if (!monetaryValue || monetaryValue === 0) return;
        
        // Use createdAt if dateAdded doesn't exist
        const dateStr = opp.dateAdded || (opp as any).createdAt || opp.dateUpdated || now.toISOString();
        const date = new Date(dateStr);
        const hour = date.getHours();
        if (hour >= 8 && hour <= 19) {
          hourlyRevenue.set(hour, (hourlyRevenue.get(hour) || 0) + monetaryValue);
        }
      });

      const hours = Array.from(hourlyRevenue.entries()).map(([hour, revenue]) => ({
        hour,
        label: `${hour}:00`,
        revenue: Math.round(revenue),
        isPrime: PRIME_HOURS.includes(hour)
      }));
      const primeHoursTotal = hours.filter(h => h.isPrime).reduce((sum, h) => sum + h.revenue, 0);
      const offPeakHoursTotal = hours.filter(h => !h.isPrime).reduce((sum, h) => sum + h.revenue, 0);

      logger.info(`Revenue By Hour Result: primeHoursTotal=${primeHoursTotal}, offPeakHoursTotal=${offPeakHoursTotal}`);

      return { hours, primeHoursTotal, offPeakHoursTotal, primeHours: PRIME_HOURS };
    } catch (error) {
      logger.warn('Failed to get revenue by hour:', error);
      return { hours: Array.from({ length: 12 }, (_, i) => ({ hour: i + 8, label: `${i + 8}:00`, revenue: 0, isPrime: PRIME_HOURS.includes(i + 8) })), primeHoursTotal: 0, offPeakHoursTotal: 0, primeHours: PRIME_HOURS };
    }
  }

  private toLocalDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async getDailyRevenue(params?: { locationId?: string; days?: number; }): Promise<any> {
    const locationId = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const days       = params?.days || 30;
    const now        = new Date();
    const startDate  = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    try {
      const [appointmentsResponse, opportunitiesResponse] = await Promise.all([
        this.getAppointments({ locationId, startTime: startDate.toISOString(), endTime: now.toISOString(), limit: 1000 }),
        this.getOpportunities({ limit: 100, locationId }), // Fixed: GHL limit is 100, not 500
      ]);

      const appointments  = appointmentsResponse.events    || [];
      const opportunities = opportunitiesResponse.opportunities || [];

      logger.info(`=== DAILY REVENUE DEBUG ===`);
      logger.info(`Appointments: ${appointments.length}, Opportunities: ${opportunities.length}`);
      
      if (opportunities.length > 0) {
        logger.info(`First opportunity keys: ${Object.keys(opportunities[0])}`);
        logger.info(`First opportunity data: ${JSON.stringify(opportunities[0], null, 2)}`);
        
        // Check all opportunities for any monetary value fields
        opportunities.forEach((opp, idx) => {
          const monetaryValue = (opp as any).monetaryValue || (opp as any).value || (opp as any).amount || 0;
          logger.info(`Opp ${idx}: id=${opp.id}, name=${opp.name}, monetaryValue=${(opp as any).monetaryValue}, value=${(opp as any).value}, amount=${(opp as any).amount}, dateAdded=${opp.dateAdded}, createdAt=${(opp as any).createdAt}`);
          
          // Check custom fields for value
          if ((opp as any).customFields && (opp as any).customFields.length > 0) {
            logger.info(`  Custom fields: ${JSON.stringify((opp as any).customFields)}`);
          }
        });
      }

      // Map contactId -> total monetary value from opportunities
      const contactRevenueMap = new Map<string, number>();
      opportunities.forEach(opp => {
        // Try multiple field names
        const value = (opp as any).monetaryValue || (opp as any).value || (opp as any).amount || 0;
        if (opp.contactId && value) {
          contactRevenueMap.set(opp.contactId, (contactRevenueMap.get(opp.contactId) || 0) + value);
        }
      });

      // Build dailyData with local date keys
      const dailyData = new Map<string, { revenue: number; appointmentCount: number }>();
      for (let d = 0; d < days; d++) {
        const date = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
        const dateKey = this.toLocalDateString(date);
        dailyData.set(dateKey, { revenue: 0, appointmentCount: 0 });
      }

      // Process appointments – use local date
      appointments.forEach((appt: any) => {
        if (!appt.startTime) return;
        const apptDate = new Date(appt.startTime);
        const dateKey = this.toLocalDateString(apptDate);
        const dayData = dailyData.get(dateKey);
        if (!dayData) return;

        let revenue = appt.monetaryValue || appt.revenue || appt.value || appt.amount || 0;
        if (!revenue && appt.contactId && contactRevenueMap.has(appt.contactId)) {
          revenue = contactRevenueMap.get(appt.contactId) || 0;
        }
        dayData.revenue += revenue;
        dayData.appointmentCount++;
      });

      // Process opportunities – use local date
      opportunities.forEach(opp => {
        // Try multiple field names for monetary value
        const monetaryValue = (opp as any).monetaryValue || (opp as any).value || (opp as any).amount || 0;
        if (!monetaryValue || monetaryValue === 0) {
          logger.debug(`Skipping opportunity ${opp.id} - no monetary value`);
          return;
        }
        
        // Use createdAt if dateAdded doesn't exist
        const dateStr = opp.dateAdded || (opp as any).createdAt || opp.dateUpdated || now.toISOString();
        const oppDate = new Date(dateStr);
        const dateKey = this.toLocalDateString(oppDate);
        const dayData = dailyData.get(dateKey);
        
        logger.info(`Processing opportunity ${opp.id}: value=${monetaryValue}, dateStr=${dateStr}, dateKey=${dateKey}, inRange=${!!dayData}`);
        
        if (dayData) {
          dayData.revenue += monetaryValue;
          // Only increment appointment count if this opportunity is not already linked to an appointment
          if (!appointments.find((a: any) => a.contactId === opp.contactId)) {
            dayData.appointmentCount++;
          }
        }
      });

      const dailyRevenue = Array.from(dailyData.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({
          date,
          revenue: Math.round(data.revenue),
          appointmentCount: data.appointmentCount
        }));

      const totalRevenue = dailyRevenue.reduce((sum, d) => sum + d.revenue, 0);
      const avgDailyRevenue = dailyRevenue.length > 0 ? Math.round(totalRevenue / dailyRevenue.length) : 0;
      const bestDay = dailyRevenue.length > 0 
        ? dailyRevenue.reduce((best, current) => current.revenue > best.revenue ? current : best, dailyRevenue[0]) 
        : null;

      logger.info(`=== RESULT: totalRevenue=${totalRevenue}, avgDailyRevenue=${avgDailyRevenue} ===`);

      return { dailyRevenue, totalRevenue, avgDailyRevenue, bestDay: bestDay ? { date: bestDay.date, revenue: bestDay.revenue } : null };
    } catch (error) {
      logger.warn('Failed to get daily revenue:', error);
      const emptyDaily = Array.from({ length: days }, (_, i) => ({
        date: this.toLocalDateString(new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000)),
        revenue: 0,
        appointmentCount: 0
      }));
      return { dailyRevenue: emptyDaily, totalRevenue: 0, avgDailyRevenue: 0, bestDay: null };
    }
  }

  async getAlerts(params?: { locationId?: string; limit?: number; page?: number; isResolved?: boolean; severity?: string; alertType?: string; }): Promise<GHLOptimizationAlertsResponse> {
    const locationId  = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const queryParams = new URLSearchParams();
    if (locationId)                        queryParams.append('locationId', locationId);
    if (params?.limit)                     queryParams.append('limit',      params.limit.toString());
    if (params?.page)                      queryParams.append('page',       params.page.toString());
    if (params?.isResolved !== undefined)  queryParams.append('isResolved', params.isResolved.toString());
    if (params?.severity)                  queryParams.append('severity',   params.severity);
    if (params?.alertType)                 queryParams.append('alertType',  params.alertType);
    return this.makeRequest<GHLOptimizationAlertsResponse>({ method: 'GET', url: `/alerts?${queryParams.toString()}` });
  }

  async getAlert(alertId: string, locationId?: string): Promise<GHLOptimizationAlert> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const queryParams = new URLSearchParams();
    if (effectiveLocationId) queryParams.append('locationId', effectiveLocationId);
    return this.makeRequest<GHLOptimizationAlert>({ method: 'GET', url: `/alerts/${alertId}?${queryParams.toString()}` });
  }

  async createAlert(alertData: AlertCreateRequest): Promise<GHLOptimizationAlert> {
    const locationId = alertData.locationId || process.env.GHL_LOCATION_ID || '';
    return this.makeRequest<GHLOptimizationAlert>({ method: 'POST', url: '/alerts', data: { ...alertData, locationId, date: alertData.date || new Date().toISOString().split('T')[0], revenue_impact: alertData.revenue_impact || 0 } });
  }

  async updateAlert(alertId: string, alertData: AlertUpdateRequest): Promise<GHLOptimizationAlert> {
    return this.makeRequest<GHLOptimizationAlert>({ method: 'PUT', url: `/alerts/${alertId}`, data: alertData });
  }

  async resolveAlert(alertId: string): Promise<GHLOptimizationAlert> {
    return this.makeRequest<GHLOptimizationAlert>({ method: 'PUT', url: `/alerts/${alertId}/resolve` });
  }

  async deleteAlert(alertId: string): Promise<void> {
    return this.makeRequest<void>({ method: 'DELETE', url: `/alerts/${alertId}` });
  }

  async getAlertStats(locationId?: string): Promise<AlertStats> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const queryParams = new URLSearchParams();
    if (effectiveLocationId) queryParams.append('locationId', effectiveLocationId);
    return this.makeRequest<AlertStats>({ method: 'GET', url: `/alerts/stats/summary?${queryParams.toString()}` });
  }

  async triggerAutomatedAlerts(locationId?: string): Promise<GHLOptimizationAlert[]> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const createdAlerts: GHLOptimizationAlert[] = [];

    try {
      const [appointmentsResponse, resourcesResponse, heatmapData] = await Promise.all([
        this.getAppointments({ locationId: effectiveLocationId, limit: 500 }).catch(() => ({ events: [], meta: { total: 0 } })),
        this.getResources(effectiveLocationId).catch(() => ({ resources: [], meta: { total: 0 } })),
        this.getRoomUtilizationHeatmap({ locationId: effectiveLocationId }).catch(() => ({ rooms: [], hours: [], data: [], uniqueDays: 1 })),
      ]);

      const appointments = appointmentsResponse.events   || [];
      const resources    = resourcesResponse.resources   || [];
      const roomData     = heatmapData.data              || [];

      roomData.forEach((room: any) => {
        if (room.utilPct < 30) {
          createdAlerts.push({ id: `alert-low-util-${room.room}-${Date.now()}`, alert_type: 'low_utilization', severity: 'warning', title: `Low Utilization: ${room.room}`, description: `${room.room} is only ${room.utilPct}% utilized.`, affected_resource: room.room, recommended_action: 'Review booking patterns.', date: new Date().toISOString().split('T')[0], revenue_impact: Math.round((30 - room.utilPct) * 100), is_resolved: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), locationId: effectiveLocationId, triggered_by: 'system_analysis' });
        }
      });

      resources.forEach((resource: any) => {
        const resourceAppointments = appointments.filter((a: any) => a.appointmentLocation === resource.name || a.address1 === resource.name);
        if (resourceAppointments.length < 5) {
          createdAlerts.push({ id: `alert-equip-${resource.id}-${Date.now()}`, alert_type: 'equipment_underuse', severity: 'info', title: `Equipment Underuse: ${resource.name}`, description: `${resource.name} has only ${resourceAppointments.length} bookings.`, affected_resource: resource.name, recommended_action: 'Review equipment scheduling.', date: new Date().toISOString().split('T')[0], revenue_impact: 0, is_resolved: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), locationId: effectiveLocationId, triggered_by: 'system_analysis' });
        }
      });

      return createdAlerts;
    } catch (error) {
      logger.error('Failed to trigger automated alerts:', error);
      return [];
    }
  }

  async getTreatments(params?: { locationId?: string; limit?: number; page?: number; category?: string; isActive?: boolean; }): Promise<GHLTreatmentsResponse> {
    const locationId = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const apiKey     = this.apiKey || '';
    if (!locationId || !apiKey) { logger.warn('Missing locationId or apiKey for treatments'); return { treatments: [], meta: { total: 0 } }; }

    try {
      const res          = await axios.get(`https://services.leadconnectorhq.com/locations/${locationId}/customFields`, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Version': '2021-07-28' } });
      const customFields = res.data.customFields || [];
      const treatmentsField = customFields.find((f: any) => f.key === 'treatments' || f.name === 'Treatments');
      if (!treatmentsField || !treatmentsField.value) return { treatments: [], meta: { total: 0 } };

      let treatments: GHLTreatment[] = [];
      try { treatments = typeof treatmentsField.value === 'string' ? JSON.parse(treatmentsField.value) : treatmentsField.value; }
      catch { return { treatments: [], meta: { total: 0 } }; }

      if (params?.category)                treatments = treatments.filter(t => t.category === params.category);
      if (params?.isActive !== undefined)  treatments = treatments.filter(t => t.isActive === params.isActive);

      const total = treatments.length;
      const limit = params?.limit || 100;
      const page  = params?.page  || 1;
      const start = (page - 1) * limit;

      return { treatments: treatments.slice(start, start + limit), meta: { total, currentPage: page, nextPage: start + limit < total ? page + 1 : undefined, prevPage: page > 1 ? page - 1 : undefined } };
    } catch (error) {
      logger.error('Failed to get treatments:', error);
      return { treatments: [], meta: { total: 0 } };
    }
  }

  async getTreatment(treatmentId: string, locationId?: string): Promise<GHLTreatment | null> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const treatmentsResponse  = await this.getTreatments({ locationId: effectiveLocationId });
    return treatmentsResponse.treatments.find(t => t.id === treatmentId) || null;
  }

  async createTreatment(treatmentData: TreatmentCreateRequest): Promise<GHLTreatment> {
    const locationId = treatmentData.locationId || process.env.GHL_LOCATION_ID || '';
    const apiKey     = this.apiKey || '';
    if (!locationId || !apiKey) throw new Error('Missing locationId or apiKey for creating treatment');

    const res          = await axios.get(`https://services.leadconnectorhq.com/locations/${locationId}/customFields`, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Version': '2021-07-28' } });
    const customFields = res.data.customFields || [];
    let treatmentsField = customFields.find((f: any) => f.key === 'treatments' || f.name === 'Treatments');
    let treatments: GHLTreatment[] = [];
    if (treatmentsField?.value) { try { treatments = typeof treatmentsField.value === 'string' ? JSON.parse(treatmentsField.value) : treatmentsField.value; } catch { treatments = []; } }

    const now            = new Date().toISOString();
    const revenuePerHour = treatmentData.duration_minutes > 0 ? Math.round(treatmentData.price / (treatmentData.duration_minutes / 60)) : 0;

    const newTreatment: GHLTreatment = {
      id: `treatment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: treatmentData.name, category: treatmentData.category, price: treatmentData.price,
      duration_minutes: treatmentData.duration_minutes, required_equipment: treatmentData.required_equipment || [],
      required_room_type: treatmentData.required_room_type, required_qualification: treatmentData.required_qualification,
      prime_hour_eligible: treatmentData.prime_hour_eligible ?? true, revenue_per_hour: revenuePerHour,
      description: treatmentData.description, locationId, isActive: true, createdAt: now, updatedAt: now,
    };

    treatments.push(newTreatment);

    if (treatmentsField) {
      await axios.put(`https://services.leadconnectorhq.com/locations/${locationId}/customFields/${treatmentsField.id}`, { value: JSON.stringify(treatments) }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Version': '2021-07-28' } });
    } else {
      await axios.post(`https://services.leadconnectorhq.com/locations/${locationId}/customFields`, { name: 'Treatments', key: 'treatments', dataType: 'text', value: JSON.stringify(treatments) }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Version': '2021-07-28' } });
    }

    logger.info(`Created treatment: ${newTreatment.name}`);
    return newTreatment;
  }

  async updateTreatment(treatmentId: string, treatmentData: TreatmentUpdateRequest, locationId?: string): Promise<GHLTreatment> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const apiKey              = this.apiKey || '';
    if (!effectiveLocationId || !apiKey) throw new Error('Missing locationId or apiKey for updating treatment');

    const res             = await axios.get(`https://services.leadconnectorhq.com/locations/${effectiveLocationId}/customFields`, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Version': '2021-07-28' } });
    const customFields    = res.data.customFields || [];
    const treatmentsField = customFields.find((f: any) => f.key === 'treatments' || f.name === 'Treatments');
    if (!treatmentsField?.value) throw new Error('Treatments not found');

    let treatments: GHLTreatment[] = [];
    try { treatments = typeof treatmentsField.value === 'string' ? JSON.parse(treatmentsField.value) : treatmentsField.value; }
    catch { throw new Error('Failed to parse treatments'); }

    const treatmentIndex = treatments.findIndex(t => t.id === treatmentId);
    if (treatmentIndex === -1) throw new Error('Treatment not found');

    const existingTreatment = treatments[treatmentIndex];
    const newPrice          = treatmentData.price ?? existingTreatment.price;
    const newDuration       = treatmentData.duration_minutes ?? existingTreatment.duration_minutes;
    const revenuePerHour    = newDuration > 0 ? Math.round(newPrice / (newDuration / 60)) : 0;

    const updatedTreatment: GHLTreatment = { ...existingTreatment, ...treatmentData, revenue_per_hour: revenuePerHour, updatedAt: new Date().toISOString() };
    treatments[treatmentIndex] = updatedTreatment;

    await axios.put(`https://services.leadconnectorhq.com/locations/${effectiveLocationId}/customFields/${treatmentsField.id}`, { value: JSON.stringify(treatments) }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Version': '2021-07-28' } });

    logger.info(`Updated treatment: ${updatedTreatment.name}`);
    return updatedTreatment;
  }

  async deleteTreatment(treatmentId: string, locationId?: string): Promise<void> {
    const effectiveLocationId = locationId || process.env.GHL_LOCATION_ID || '';
    const apiKey              = this.apiKey || '';
    if (!effectiveLocationId || !apiKey) throw new Error('Missing locationId or apiKey for deleting treatment');

    const res             = await axios.get(`https://services.leadconnectorhq.com/locations/${effectiveLocationId}/customFields`, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Version': '2021-07-28' } });
    const customFields    = res.data.customFields || [];
    const treatmentsField = customFields.find((f: any) => f.key === 'treatments' || f.name === 'Treatments');
    if (!treatmentsField?.value) return;

    let treatments: GHLTreatment[] = [];
    try { treatments = typeof treatmentsField.value === 'string' ? JSON.parse(treatmentsField.value) : treatmentsField.value; }
    catch { return; }

    const filteredTreatments = treatments.filter(t => t.id !== treatmentId);
    await axios.put(`https://services.leadconnectorhq.com/locations/${effectiveLocationId}/customFields/${treatmentsField.id}`, { value: JSON.stringify(filteredTreatments) }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Version': '2021-07-28' } });
    logger.info(`Deleted treatment: ${treatmentId}`);
  }

  private handleError(error: AxiosError): GHLApiError {
    if (error.response) {
      const status = error.response.status;
      const data   = error.response.data as any;
      return { status, message: data?.message || data?.error || 'API request failed', error: data?.error, details: data };
    }
    if (error.request) return { status: 0, message: 'No response received from API', error: 'NETWORK_ERROR' };
    return { status: 500, message: error.message || 'Unknown error occurred', error: 'INTERNAL_ERROR' };
  }

  
}

export const ghlClient = new GHLClient();