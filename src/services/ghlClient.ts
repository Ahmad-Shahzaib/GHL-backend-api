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
} from '../types';
import { config, GHL_OAUTH_URLS, GHL_API_ENDPOINTS, GHL_API_VERSION } from '../config';
import { tokenStore } from './tokenStore';
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
      client_id: config.GHL_CLIENT_ID,
      redirect_uri: config.GHL_REDIRECT_URI,
      response_type: 'code',
    });
    return `${GHL_OAUTH_URLS.authorize}?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string, userType: 'Company' | 'Location' = 'Location'): Promise<GHLTokenResponse> {
    try {
      const requestData: GHLTokenRequest = {
        client_id: config.GHL_CLIENT_ID,
        client_secret: config.GHL_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        user_type: userType,
        redirect_uri: config.GHL_REDIRECT_URI,
      };
      const response = await axios.post<GHLTokenResponse>(GHL_OAUTH_URLS.token, requestData);
      logger.info('Successfully exchanged code for token');
      return response.data;
    } catch (error) {
      logger.error('Token exchange failed:', error);
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

  private async makeRequest<T>(config: AxiosRequestConfig): Promise<T> {
    const accessToken = await this.getValidAccessToken();

    const requestConfig: AxiosRequestConfig = {
      ...config,
      headers: {
        ...config.headers,
        'Authorization': `Bearer ${accessToken}`,
      },
    };

    try {
      const response = await this.axiosInstance.request<T>(requestConfig);
      return response.data;
    } catch (error) {
      throw this.handleError(error as AxiosError);
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
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.locationId) queryParams.append('locationId', params.locationId);
    const url = `${GHL_API_ENDPOINTS.users}?${queryParams.toString()}`;
    return this.makeRequest<GHLUsersResponse>({ method: 'GET', url });
  }

  async getUser(userId: string): Promise<GHLUser> {
    return this.makeRequest<GHLUser>({
      method: 'GET',
      url: GHL_API_ENDPOINTS.userById(userId),
    });
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