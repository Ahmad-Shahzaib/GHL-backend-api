import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { 
  GHLTokenResponse, 
  // GHLTokenRequest,
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
  // RoomUtilizationHeatmap,
  // RoomHeatmapQueryParams,
  KpiDashboardData,
  KpiMetric,
  PipelineKpiData,
  PipelineStageMetric,
  GHLWorkflow,
  GHLWorkflowsResponse,
  WorkflowOptimizationRule,
  // WorkflowSchedulingViolation,
  // WorkflowScheduleBlock,
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
// import { cacheService } from './cacheService';
import { workflowRulesService } from './workflowRulesService';
import { logger } from '../utils/logger';

export class GHLClient {
  private axiosInstance: AxiosInstance;
  private tokenKey: string | null = null;
  private apiKey: string | null = null;

  private isRetriableError(error: any): boolean {
    const status = error?.status || error?.response?.status;
    const code = error?.code;
    const apiError = error?.error;

    if ([429, 500, 502, 503, 504].includes(status)) return true;
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNRESET') return true;
    if (apiError === 'NETWORK_ERROR') return true;

    return false;
  }

  private async withRetry<T>(operation: () => Promise<T>, context: string, maxAttempts = 2): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        const shouldRetry = this.isRetriableError(error);
        const isLastAttempt = attempt >= maxAttempts;

        logger.warn(`${context} failed (attempt ${attempt}/${maxAttempts})`, {
          status: error?.status || error?.response?.status,
          code: error?.code,
          message: error?.message,
          retriable: shouldRetry,
        });

        if (!shouldRetry || isLastAttempt) break;

        const retryAfterHeader = error?.response?.headers?.['retry-after'];
        const retryAfterSeconds = Number.parseInt(retryAfterHeader, 10);
        const backoffMs = Number.isFinite(retryAfterSeconds)
          ? Math.max(250, retryAfterSeconds * 1000)
          : 250 * attempt;
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError;
  }

  private async withRetryFallback<T>(
    operation: () => Promise<T>,
    context: string,
    fallback: T,
    maxAttempts = 2
  ): Promise<T> {
    try {
      return await this.withRetry(operation, context, maxAttempts);
    } catch (error: any) {
      logger.warn(`${context} exhausted retries, using fallback`, {
        status: error?.status || error?.response?.status,
        code: error?.code,
        message: error?.message,
      });
      return fallback;
    }
  }

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
      logger.debug(`Rate limiter bypassed for key: ${rateLimitKey}`);
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
    companyId?: string;
  }): Promise<GHLUsersResponse> {
    // GHL /users/ endpoint does NOT accept limit, page, or location_id params
    // Only locationId (camelCase) is accepted
    const queryParams = new URLSearchParams();
    if (params?.locationId) queryParams.append('locationId', params.locationId);
    const url = `/users/?${queryParams.toString()}`;

    // Strategy 1: Use Private Integration token (pit-) for the location — has users scope
    if (params?.locationId) {
      const pitTokenData = await tokenStore.getTokens(params.locationId);
      if (pitTokenData?.accessToken) {
        try {
          const pitResponse = await this.axiosInstance.request<GHLUsersResponse>({
            method: 'GET',
            url,
            headers: { Authorization: `Bearer ${pitTokenData.accessToken}` },
          });
          const pitUsers = pitResponse.data;
          logger.info('getUsers via pit- token', {
            locationId: params.locationId,
            usersLength: Array.isArray(pitUsers.users) ? pitUsers.users.length : 0,
          });
          if ((pitUsers.users || []).length > 0) return pitUsers;
        } catch (err: any) {
          logger.warn('getUsers pit- token failed, trying fallbacks', {
            locationId: params.locationId,
            status: err?.response?.status,
          });
        }
      }
    }

    // Strategy 2: Use current token (Company OAuth) — may 401 if scope missing
    try {
      const locationUsers = await this.makeRequest<GHLUsersResponse>({ method: 'GET', url });
      logger.info('getUsers company-token response', {
        locationId: params?.locationId,
        usersLength: Array.isArray(locationUsers.users) ? locationUsers.users.length : 0,
      });
      if ((locationUsers.users || []).length > 0) return locationUsers;
    } catch (err: any) {
      logger.warn('getUsers company-token failed', { status: err?.response?.status });
    }

    // Strategy 3: Search endpoint with company token
    if (params?.locationId && params?.companyId) {
      const companyTokenData = await tokenStore.getTokens(params.companyId);
      if (companyTokenData?.accessToken) {
        try {
          const searchParams = new URLSearchParams();
          searchParams.append('companyId', params.companyId);
          searchParams.append('locationId', params.locationId);

          const response = await this.axiosInstance.request<GHLUsersResponse>({
            method: 'GET',
            url: `/users/search?${searchParams.toString()}`,
            headers: { Authorization: `Bearer ${companyTokenData.accessToken}` },
          });
          logger.info('getUsers company search-endpoint response', {
            usersLength: Array.isArray(response.data.users) ? response.data.users.length : 0,
          });
          if ((response.data.users || []).length > 0) return response.data;
        } catch (err: any) {
          logger.warn('getUsers company search-endpoint failed', { status: err?.response?.status });
        }
      }
    }

    logger.warn('getUsers — all strategies exhausted, returning empty', { locationId: params?.locationId });
    return { users: [], meta: { total: 0, currentPage: 1 } } as unknown as GHLUsersResponse;
  }

  async getLocationStaffTeam(locationId: string): Promise<any> {
    const url = `https://app.gohighlevel.com/v2/location/${locationId}/settings/staff/team`;
    logger.info('Calling GHL location staff/team endpoint', { url, locationId });
    const response = await this.makeRequest<any>({ method: 'GET', url });
    logger.info('GHL location staff/team response received', { locationId, response });
    return response;
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
    const locationId = process.env.GHL_LOCATION_ID || '';
    const companyId  = userData.companyId || process.env.GHL_COMPANY_ID || 'K9bORvG0pKtvt7QO4R9B';
    // Use company token for user creation
    const companyTokenData = await tokenStore.getTokens(companyId);
    const token = companyTokenData?.accessToken || this.apiKey || '';

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
    const now        = new Date();
    const startTime  = params?.startTime
      ? String(new Date(params.startTime).getTime())
      : String(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).getTime());
    const endTime    = params?.endTime
      ? String(new Date(params.endTime).getTime())
      : String(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).getTime());

    if (params?.calendarId || params?.userId) {
      const queryParams = new URLSearchParams();
      if (params?.calendarId) queryParams.append('calendarId', params.calendarId!);
      if (params?.userId)     queryParams.append('userId',     params.userId!);
      if (locationId)         queryParams.append('locationId', locationId);
      queryParams.append('startTime', startTime);
      queryParams.append('endTime',   endTime);
      const url = `${GHL_API_ENDPOINTS.appointments}?${queryParams.toString()}`;
      return this.makeRequest<any>({ method: 'GET', url });
    }

    try {
      const calendarsRes = await this.getCalendars(locationId);
      const calendars    = Array.isArray(calendarsRes) ? calendarsRes : (calendarsRes?.calendars ?? []);
      if (calendars.length === 0) return { events: [], appointments: [], meta: { total: 0 } };

      const chunkSize = 5;
      const allEvents: any[] = [];
      for (let i = 0; i < calendars.length; i += chunkSize) {
        const chunk = calendars.slice(i, i + chunkSize);
        const results = await Promise.allSettled(
          chunk.map((cal: any) => {
            const qp = new URLSearchParams();
            qp.append('calendarId', cal.id);
            qp.append('locationId', locationId);
            qp.append('startTime',  startTime);
            qp.append('endTime',    endTime);
            const url = `${GHL_API_ENDPOINTS.appointments}?${qp.toString()}`;
            return this.makeRequest<any>({ method: 'GET', url });
          })
        );
        results.forEach(r => {
          if (r.status === 'fulfilled') {
            const events = r.value?.events || r.value?.appointments || [];
            allEvents.push(...events);
          }
        });
      }
      return { events: allEvents, appointments: allEvents, meta: { total: allEvents.length } };
    } catch (error: any) {
      logger.warn('Failed to fetch appointments from GHL API:', error?.response?.data || error?.message);
      return { events: [], appointments: [], meta: { total: 0 } };
    }
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
      // Fetch calendar rooms from GHL — pass a high limit so GHL doesn't silently cap results
      const url = `https://services.leadconnectorhq.com/calendars/resources/rooms?locationId=${locationId}&limit=100&skip=0`;
      logger.info('getResources: fetching from GHL', { url, locationId });
      const res = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${token}`, 'Version': '2021-07-28' },
      });
      logger.info('getResources: raw GHL response', {
        status: res.status,
        dataKeys: Object.keys(res.data || {}),
        roomsCount: (res.data.rooms || []).length,
        resourcesCount: (res.data.resources || []).length,
        totalField: res.data.total,
        metaField: res.data.meta,
        rawData: res.data,
      });
      // GHL returns the array directly (no wrapper key), but handle both shapes
      const rawList: any[] = Array.isArray(res.data)
        ? res.data
        : (res.data.rooms || res.data.resources || []);
      const rooms = rawList.map((r: any) => ({
        id:            r._id || r.id,
        name:          r.name,
        capacity_type: r.resourceType || 'room',
        equipment:     r.description || '',
        quantity:      r.quantity || 1,
      }));
      logger.info('getResources: mapped rooms', { count: rooms.length, rooms });
      return { resources: rooms, meta: { total: rooms.length } };
    } catch (error: any) {
      logger.warn('Could not fetch calendar rooms:', {
        message: error?.message,
        status: error?.response?.status,
        responseData: error?.response?.data,
        locationId,
      });
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
    const token        = await this.getValidAccessToken();
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
  let pipelineNameMap: Record<string, string> = {};

  // Fetch pipeline names first so we can resolve IDs to display names
  try {
    const pipelinesResponse = await this.getPipelines(effectiveLocationId);
    const pipelines = pipelinesResponse?.pipelines || pipelinesResponse?.data || [];
    pipelines.forEach((p: any) => {
      if (p.id && p.name) pipelineNameMap[p.id] = p.name;
    });
    logger.info(`Fetched ${pipelines.length} pipelines for name resolution`);
  } catch (error) {
    logger.warn('Could not fetch pipelines:', error);
  }

  const [contactsResponse, opportunitiesResponse] = await Promise.all([
    this.withRetryFallback(
      () => this.getContacts({ limit: 100, locationId: effectiveLocationId }),
      'getDashboardStats contacts',
      { contacts: [], meta: { total: 0 } } as GHLContactsResponse
    ),
    this.withRetryFallback(
      () => this.getOpportunities({ limit: 100, locationId: effectiveLocationId }),
      'getDashboardStats opportunities',
      { opportunities: [], meta: { total: 0 } } as GHLOpportunitiesResponse
    ),
  ]);

  contacts = contactsResponse.contacts || [];
  opportunities = opportunitiesResponse.opportunities || [];
  const totalContacts = contactsResponse.meta?.total ?? contacts.length;
  const totalOpportunities = opportunitiesResponse.meta?.total ?? opportunities.length;
  logger.info(`Dashboard Stats: Fetched ${opportunities.length} opportunities`);

  const totalOpportunityValue = opportunities.reduce((sum, opp) => {
    return sum + (opp.monetaryValue || 0);
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
    const pid = opp.pipelineId || '';
    if (!pipelineMap.has(pid)) {
      pipelineMap.set(pid, {
        // Resolve ID to display name — fall back to "Pipeline 1", "Pipeline 2" etc.
        name:   pipelineNameMap[pid] || `Pipeline ${pipelineMap.size + 1}`,
        stages: new Map(),
        value:  0,
      });
    }
    const pipeline   = pipelineMap.get(pid)!;
    const stageCount = pipeline.stages.get(opp.stageId || '') || 0;
    pipeline.stages.set(opp.stageId || '', stageCount + 1);
    pipeline.value  += (opp as any).monetaryValue || (opp as any).value || (opp as any).amount || 0;
  });

  const pipelineSummary = Array.from(pipelineMap.entries()).map(([id, data]) => ({
    pipelineId:   id,
    pipelineName: data.name,
    stageCounts:  Object.fromEntries(data.stages),
    totalValue:   data.value,
  }));

  return {
    totalContacts,
    totalOpportunities,
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
      this.withRetryFallback(
        () => this.getContacts({ limit: 100, locationId: effectiveLocationId }),
        'getKpiMetrics contacts',
        { contacts: [], meta: { total: 0 } } as GHLContactsResponse
      ),
      this.withRetryFallback(
        () => this.getOpportunities({ limit: 100, locationId: effectiveLocationId }),
        'getKpiMetrics opportunities',
        { opportunities: [], meta: { total: 0 } } as GHLOpportunitiesResponse
      ),
      this.withRetryFallback(
        () => this.getPipelines(effectiveLocationId),
        'getKpiMetrics pipelines',
        { pipelines: [] }
      ),
      this.withRetryFallback(
        () => this.getAppointments({ locationId: effectiveLocationId, limit: 100 }),
        'getKpiMetrics appointments',
        { events: [], meta: { total: 0 } }
      ),
    ]);
    const contacts      = contactsResponse.contacts      || [];
    const opportunities = opportunitiesResponse.opportunities || [];
    const pipelines     = pipelinesResponse.pipelines    || [];
    const allAppointments = appointmentsResponse.events || [];
    const appointments = allAppointments.filter((a: any) => {
      if (!a.startTime) return false;
      const t = new Date(a.startTime).getTime();
      return t >= new Date(startDate).getTime() && t <= new Date(endDate).getTime();
    });
    const totalContacts      = contactsResponse.meta?.total ?? contacts.length;
    const totalOpportunities = opportunitiesResponse.meta?.total ?? opportunities.length;
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

    // Calculate uniqueDays from actual appointment dates
    const uniqueDates = new Set(
      appointments
        .filter((a: any) => a.startTime)
        .map((a: any) => new Date(a.startTime).toISOString().split('T')[0])
    );
    const uniqueDays = uniqueDates.size;

    // Calculate total booked hours from actual appointment durations
    const totalHours = appointments.reduce((sum: number, a: any) => {
      if (!a.startTime || !a.endTime) return sum;
      const hrs = (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 3600000;
      return sum + (hrs > 0 ? hrs : 0);
    }, 0);

    return ({
      conversionRate, avgOpportunityValue, pipelineGap, avgRevenuePerHour, profitDensity,
      totalContacts, totalOpportunities, totalPipelineValue, totalAppointments,
      totalRevenue: totalPipelineValue, metrics, pipelineStats,
      contactsTrend, opportunitiesTrend, revenueTrend,
      systemScore, healthStatus, avgTimeToClose, leadVelocity, opportunityVelocity,
      uniqueDays,
      totalHours: Math.round(totalHours * 10) / 10,
      dateRange: { startDate, endDate },
    } as any);
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

    const allAppointments = appointmentsResponse.events || [];
    const appointments = allAppointments.filter((a: any) => {
      if (!a.startTime) return false;
      const t = new Date(a.startTime).getTime();
      return t >= new Date(startDate).getTime() && t <= new Date(endDate).getTime();
    });
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
      ? Math.round(heatmapData.data.reduce((sum: number, r: any) => sum + r.utilPct, 0) / heatmapData.data.length) : 0;

    const PRIME_HOURS = [10, 11, 12, 13, 14, 15, 16, 17];
    let primeHourBookings = 0;
    heatmapData.data.forEach((room: any) => { PRIME_HOURS.forEach(hour => { if (room.hours[hour]) primeHourBookings += room.hours[hour].booked; }); });

    const numRooms              = heatmapData.rooms.length || 4;
    const totalPrimeSlots       = numRooms * PRIME_HOURS.length * uniqueDays;
    const primeHourUtilization  = totalPrimeSlots > 0 ? Math.round((primeHourBookings / totalPrimeSlots) * 100) : 0;
    const idleTimePercentage    = Math.max(0, 100 - avgUtilization);
    const avgRevenuePerAppointment = completedAppointments.length > 0 ? Math.round(totalRevenue / completedAppointments.length) : 0;
    const avgRevenuePerHour     = Math.round(totalRevenue / (uniqueDays * 8));
    const avgRevenuePerDay      = Math.round(dailyRevenue);
    const hasEnoughData = appointments.length >= 5 && uniqueDays >= 2;
    const utilIncrease  = hasEnoughData ? Math.round(annualBase * 0.22) : 0;
    const primeIncrease = hasEnoughData ? Math.round(annualBase * 0.18) : 0;
    const combinedLift  = hasEnoughData ? Math.round(annualBase * 0.35) : 0;

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
      projections: { utilIncrease, primeIncrease, combinedLift, capacityIncrease: hasEnoughData ? 22 : 0, idleReduction: hasEnoughData ? 28 : 0, primeHQIncrease: hasEnoughData ? 20 : 0, totalUpside: combinedLift },
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
        this.withRetryFallback(
          () => this.getAppointments({ locationId, startTime: startDate, endTime: endDate, limit: 1000 }),
          'getRevenueByHour appointments',
          { events: [], meta: { total: 0 } }
        ),
        this.withRetryFallback(
          () => this.getOpportunities({ limit: 100, locationId }),
          'getRevenueByHour opportunities',
          { opportunities: [], meta: { total: 0 } } as GHLOpportunitiesResponse
        ),
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
      logger.error('Failed to get revenue by hour, returning safe fallback:', error);
      const hours = Array.from({ length: 12 }, (_, i) => {
        const hour = i + 8;
        return {
          hour,
          label: `${hour}:00`,
          revenue: 0,
          isPrime: PRIME_HOURS.includes(hour),
        };
      });
      return { hours, primeHoursTotal: 0, offPeakHoursTotal: 0, primeHours: PRIME_HOURS };
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
        this.withRetryFallback(
          () => this.getAppointments({ locationId, startTime: startDate.toISOString(), endTime: now.toISOString(), limit: 1000 }),
          'getDailyRevenue appointments',
          { events: [], meta: { total: 0 } }
        ),
        this.withRetryFallback(
          () => this.getOpportunities({ limit: 100, locationId }),
          'getDailyRevenue opportunities',
          { opportunities: [], meta: { total: 0 } } as GHLOpportunitiesResponse
        ),
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
      logger.error('Failed to get daily revenue, returning safe fallback:', error);
      const dailyRevenue = Array.from({ length: days }, (_, d) => {
        const date = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
        return {
          date: this.toLocalDateString(date),
          revenue: 0,
          appointmentCount: 0,
        };
      });
      return { dailyRevenue, totalRevenue: 0, avgDailyRevenue: 0, bestDay: null };
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

// ─────────────────────────────────────────────────────────────────────────────
// ADD THESE 3 METHODS TO ghlClient.ts inside the GHLClient class
// Place them just before the closing brace of the class
// ─────────────────────────────────────────────────────────────────────────────

  // ── Room Utilization Heatmap ───────────────────────────────────────────────
  async getRoomUtilizationHeatmap(params?: {
    locationId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<any> {
    const locationId    = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const now           = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate     = params?.startDate || thirtyDaysAgo.toISOString();
    const endDate       = params?.endDate   || now.toISOString();
    const PRIME_HOURS   = [10, 11, 12, 13, 14, 15, 16, 17];

    try {
      // Fetch appointments and opportunities in parallel
      const [appointmentsResponse, opportunitiesResponse, calendarsResponse] = await Promise.all([
        this.getAppointments({ locationId, startTime: startDate, endTime: endDate, limit: 500 }).catch(() => ({ events: [] })),
        this.getOpportunities({ limit: 100, locationId }).catch(() => ({ opportunities: [] })),
        this.getCalendars(locationId).catch(() => ({ calendars: [] })),
      ]);

      const appointments  = appointmentsResponse.events        || [];
      const opportunities = opportunitiesResponse.opportunities || [];
      const calendars     = calendarsResponse.calendars         || [];

      // Build contactId → revenue map from opportunities
      const contactRevenueMap = new Map<string, number>();
      opportunities.forEach((opp: any) => {
        const value = opp.monetaryValue || opp.value || opp.amount || 0;
        if (opp.contactId && value > 0) {
          contactRevenueMap.set(opp.contactId, (contactRevenueMap.get(opp.contactId) || 0) + value);
        }
      });

      // Build calendarId → name map for room names
      const calendarNameMap = new Map<string, string>();
      calendars.forEach((c: any) => { if (c.id && c.name) calendarNameMap.set(c.id, c.name); });

      // Group appointments by room (calendar) and hour
      const roomHourMap = new Map<string, Map<number, { booked: number; revenue: number }>>();
      const uniqueDates  = new Set<string>();

      appointments.forEach((appt: any) => {
      if (!appt.startTime) return;

      // Filter by selected date range
      const apptTime  = new Date(appt.startTime).getTime();
      const rangeStart = new Date(startDate).getTime();
      const rangeEnd   = new Date(endDate).getTime();
      if (apptTime < rangeStart || apptTime > rangeEnd) return;

      let hour: number;
      const timeMatch = String(appt.startTime).match(/T(\d{2}):/);
      if (timeMatch) {
        hour = parseInt(timeMatch[1], 10);
      } else {
        hour = new Date(appt.startTime).getHours();
      }
      const dateStr = new Date(appt.startTime).toISOString().split('T')[0];

        if (hour < 8 || hour > 19) return;
        uniqueDates.add(dateStr);

        // Resolve room name from calendarId
        const roomName = calendarNameMap.get(appt.calendarId) || appt.calendarId || 'Unknown Room';

        // Get revenue — from appointment directly or from opportunity via contactId
        let revenue = appt.monetaryValue || appt.revenue || appt.value || 0;
        if (!revenue && appt.contactId) {
          revenue = contactRevenueMap.get(appt.contactId) || 0;
        }

        if (!roomHourMap.has(roomName)) roomHourMap.set(roomName, new Map());
        const hourMap = roomHourMap.get(roomName)!;
        const existing = hourMap.get(hour) || { booked: 0, revenue: 0 };
        hourMap.set(hour, { booked: existing.booked + 1, revenue: existing.revenue + revenue });
      });

      const uniqueDays = Math.max(1, uniqueDates.size);
      const rooms      = Array.from(roomHourMap.keys());

      // Build structured data per room
      const data = rooms.map(room => {
        const hourMap    = roomHourMap.get(room)!;
        const hours: Record<string, { booked: number; revenue: number }> = {};
        let totalBooked  = 0;
        let totalRevenue = 0;

        for (let h = 8; h <= 19; h++) {
          const hData = hourMap.get(h) || { booked: 0, revenue: 0 };
          hours[h]     = hData;
          totalBooked  += hData.booked;
          totalRevenue += hData.revenue;
        }

        const totalSlots = uniqueDays * 12; // 12 working hours per day
        const utilPct    = totalSlots > 0 ? Math.min(100, Math.round((totalBooked / totalSlots) * 100)) : 0;

        return { room, hours, totalBooked, totalRevenue: Math.round(totalRevenue), utilPct };
      });

      logger.info(`RoomHeatmap: ${rooms.length} rooms, ${appointments.length} appointments, ${uniqueDays} days`);

      return {
        rooms,
        uniqueDays,
        data,
        primeHours: PRIME_HOURS,
        dateRange:  { startDate, endDate },
      };

    } catch (error: any) {
      logger.error('getRoomUtilizationHeatmap failed:', error?.message);
      return { rooms: [], uniqueDays: 0, data: [], primeHours: PRIME_HOURS, dateRange: { startDate, endDate } };
    }
  }

  // ── Scheduling Violations ─────────────────────────────────────────────────
  async analyzeSchedulingViolations(params?: {
    locationId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<any[]> {
    const locationId    = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const now           = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate     = params?.startDate || thirtyDaysAgo.toISOString();
    const endDate       = params?.endDate   || now.toISOString();
    const PRIME_HOURS   = [10, 11, 12, 13, 14, 15, 16, 17];

    try {
      const [appointmentsResponse, opportunitiesResponse] = await Promise.all([
        this.getAppointments({ locationId, startTime: startDate, endTime: endDate, limit: 500 }).catch(() => ({ events: [] })),
        this.getOpportunities({ limit: 100, locationId }).catch(() => ({ opportunities: [] })),
      ]);

      const appointments  = appointmentsResponse.events        || [];
      const opportunities = opportunitiesResponse.opportunities || [];

      // Build revenue map
      const contactRevenueMap = new Map<string, number>();
      opportunities.forEach((opp: any) => {
        const value = opp.monetaryValue || opp.value || 0;
        if (opp.contactId && value > 0) contactRevenueMap.set(opp.contactId, value);
      });

      const violations: any[] = [];

      appointments.forEach((appt: any) => {
        if (!appt.startTime) return;
        const start    = new Date(appt.startTime);
        const hour     = start.getHours();
        const isPrime  = PRIME_HOURS.includes(hour);
        const title    = appt.title || 'Appointment';
        const revenue  = appt.monetaryValue || (appt.contactId ? contactRevenueMap.get(appt.contactId) || 0 : 0);
        const rph      = revenue > 0 && appt.startTime && appt.endTime
          ? Math.round((revenue / ((new Date(appt.endTime).getTime() - new Date(appt.startTime).getTime()) / 3600000)))
          : 0;

        // Violation: low-value appointment in prime hour
        if (isPrime && rph > 0 && rph < 300) {
          violations.push({
            id:            `violation-${appt.id}`,
            violationType: 'Prime-Hour Low-Value',
            type:          'Prime-Hour Low-Value',
            description:   `"${title}" is in a prime slot (${hour}:00) but generates only $${rph}/hr RPH`,
            detail:        `"${title}" is in a prime slot (${hour}:00) but generates only $${rph}/hr RPH`,
            severity:      rph < 200 ? 'critical' : 'warning',
            room:          appt.calendarId || 'Unknown',
            hour,
            revenue,
            revenueImpact: revenue,
            date:          start.toISOString().split('T')[0],
          });
        }
      });

      logger.info(`analyzeSchedulingViolations: ${violations.length} violations found from ${appointments.length} appointments`);
      return violations;

    } catch (error: any) {
      logger.error('analyzeSchedulingViolations failed:', error?.message);
      return [];
    }
  }

  // ── Schedule Blocks ───────────────────────────────────────────────────────
  async getScheduleBlocks(params?: {
    locationId?: string;
    date?: string;
  }): Promise<any[]> {
    const locationId = params?.locationId || process.env.GHL_LOCATION_ID || '';
    const PRIME_HOURS = [10, 11, 12, 13, 14, 15, 16, 17];

    try {
      const now           = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [appointmentsResponse, opportunitiesResponse] = await Promise.all([
        this.getAppointments({ locationId, startTime: thirtyDaysAgo.toISOString(), endTime: now.toISOString(), limit: 500 }).catch(() => ({ events: [] })),
        this.getOpportunities({ limit: 100, locationId }).catch(() => ({ opportunities: [] })),
      ]);

      const appointments  = appointmentsResponse.events        || [];
      const opportunities = opportunitiesResponse.opportunities || [];

      // Build revenue map
      const contactRevenueMap = new Map<string, number>();
      opportunities.forEach((opp: any) => {
        const value = opp.monetaryValue || opp.value || 0;
        if (opp.contactId && value > 0) contactRevenueMap.set(opp.contactId, value);
      });

      // Aggregate appointments by hour
      const hourMap = new Map<number, { total: number; highTicket: number; lowTicket: number; revenue: number }>();
      for (let h = 8; h <= 20; h++) hourMap.set(h, { total: 0, highTicket: 0, lowTicket: 0, revenue: 0 });

      appointments.forEach((appt: any) => {
        if (!appt.startTime) return;
        const hour    = new Date(appt.startTime).getHours();
        if (hour < 8 || hour > 20) return;
        const revenue = appt.monetaryValue || (appt.contactId ? contactRevenueMap.get(appt.contactId) || 0 : 0);
        const rph     = revenue > 0 && appt.startTime && appt.endTime
          ? revenue / ((new Date(appt.endTime).getTime() - new Date(appt.startTime).getTime()) / 3600000)
          : 0;

        const existing = hourMap.get(hour)!;
        hourMap.set(hour, {
          total:      existing.total + 1,
          highTicket: existing.highTicket + (rph >= 500 ? 1 : 0),
          lowTicket:  existing.lowTicket  + (rph > 0 && rph < 300 ? 1 : 0),
          revenue:    existing.revenue + revenue,
        });
      });

      const blocks = Array.from(hourMap.entries()).map(([hour, data]) => ({
        hour,
        label:      `${hour}:00`,
        isPrime:    PRIME_HOURS.includes(hour),
        total:      data.total,
        highTicket: data.highTicket,
        lowTicket:  data.lowTicket,
        revenue:    Math.round(data.revenue),
        utilization: Math.min(100, data.total * 20), // rough utilization estimate
      }));

      logger.info(`getScheduleBlocks: ${blocks.length} hour blocks built from ${appointments.length} appointments`);
      return blocks;

    } catch (error: any) {
      logger.error('getScheduleBlocks failed:', error?.message);
      return [];
    }
  }

  
  
}

export const ghlClient = new GHLClient();