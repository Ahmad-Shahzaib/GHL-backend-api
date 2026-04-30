import axios from 'axios';
import { tokenStore } from './tokenStore';
import { logger } from '../utils/logger';
import { config, GHL_OAUTH_URLS } from '../config';

const COMPANY_ID = 'K9bORvG0pKtvt7QO4R9B';

const REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
const CRON_INTERVAL_MS  =  6 * 60 * 60 * 1000;

class TokenRefreshService {
  private intervalId: NodeJS.Timeout | null = null;

  start(): void {
    if (this.intervalId) {
      logger.info('TokenRefreshService already running');
      return;
    }

    logger.info('TokenRefreshService started — checking every 6 hours');

    this.refreshExpiringTokens();

    this.intervalId = setInterval(() => {
      this.refreshExpiringTokens();
    }, CRON_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('TokenRefreshService stopped');
    }
  }

  async refreshExpiringTokens(): Promise<void> {
    try {
      logger.info('TokenRefreshService: scanning for expiring tokens...');

      const allKeys = await tokenStore.getAllKeys();
      if (allKeys.length === 0) {
        logger.info('TokenRefreshService: no tokens in store — nothing to refresh');
        return;
      }

      logger.info(`TokenRefreshService: checking ${allKeys.length} token(s)`);

      for (const key of allKeys) {
        await this.refreshTokenIfNeeded(key);
      }

    } catch (error: any) {
      logger.error('TokenRefreshService: error during refresh scan:', error?.message);
    }
  }

  private async refreshTokenIfNeeded(key: string): Promise<void> {
    try {
      const tokenData = await tokenStore.getTokens(key);
      if (!tokenData) {
        logger.warn(`TokenRefreshService: no data for key ${key} — skipping`);
        return;
      }

      const expiresIn      = tokenData.expiresAt - Date.now();
      const expiresInHours = Math.round(expiresIn / (1000 * 60 * 60));

      if (expiresIn > REFRESH_WINDOW_MS) {
        logger.info(`TokenRefreshService: key=${key} is healthy (expires in ~${expiresInHours}h) — skipping`);
        return;
      }

      if (expiresIn <= 0) {
        logger.warn(`TokenRefreshService: key=${key} already EXPIRED — attempting refresh`);
      } else {
        logger.info(`TokenRefreshService: key=${key} expires in ~${expiresInHours}h — refreshing proactively`);
      }

      if (!tokenData.refreshToken) {
        logger.error(`TokenRefreshService: key=${key} has no refreshToken — manual re-auth required`);
        return;
      }

      if (key === COMPANY_ID || tokenData.userType === 'Company') {
        await this.refreshCompanyToken(key, tokenData.refreshToken);
        return;
      }

      if (tokenData.locationId && tokenData.companyId) {
        await this.refreshLocationToken(tokenData.companyId, tokenData.locationId);
        return;
      }

      await this.refreshViaOAuth(key, tokenData);

    } catch (error: any) {
      logger.error(`TokenRefreshService: failed to refresh key=${key}:`, {
        message: error?.message,
        status:  error?.response?.status,
        data:    error?.response?.data,
      });
    }
  }

  private async refreshCompanyToken(key: string, refreshToken: string): Promise<void> {
    const params = new URLSearchParams({
      client_id:     config.GHL_CLIENT_ID,
      client_secret: config.GHL_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      user_type:     'Company',
      redirect_uri:  config.GHL_REDIRECT_URI,
    });

    const response = await axios.post(
      GHL_OAUTH_URLS.token,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const newTokenData = response.data;
    const existing     = await tokenStore.getTokens(key);

    await tokenStore.storeTokens(key, {
      ...existing!,
      accessToken:  newTokenData.access_token,
      refreshToken: newTokenData.refresh_token || refreshToken,
      expiresAt:    Date.now() + (newTokenData.expires_in * 1000),
    });

    const newExpiresInDays = Math.round(newTokenData.expires_in / 86400);
    logger.info(`TokenRefreshService: company token refreshed for key=${key} — new expiry in ~${newExpiresInDays}d`);
  }

  private async refreshLocationToken(companyId: string, locationId: string): Promise<void> {
    const companyTokenData = await tokenStore.getTokens(companyId);
    if (!companyTokenData?.accessToken) {
      throw new Error(`No company token found for companyId=${companyId} — cannot refresh location token`);
    }

    const companyExpiresIn = companyTokenData.expiresAt - Date.now();
    if (companyExpiresIn <= 0) {
      logger.warn('TokenRefreshService: company token also expired — refreshing company token first');
      await this.refreshCompanyToken(companyId, companyTokenData.refreshToken);
      const refreshedCompany = await tokenStore.getTokens(companyId);
      if (!refreshedCompany?.accessToken) throw new Error('Company token refresh failed');
      companyTokenData.accessToken = refreshedCompany.accessToken;
    }

    const response = await axios.post(
      'https://services.leadconnectorhq.com/oauth/locationToken',
      { companyId, locationId },
      {
        headers: {
          'Authorization': `Bearer ${companyTokenData.accessToken}`,
          'Content-Type':  'application/json',
          'Accept':        'application/json',
          'Version':       '2021-07-28',
        },
      }
    );

    const locationTokenData = response.data;
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

    logger.info(`TokenRefreshService: location token refreshed for locationId=${locationId}`);
  }

  private async refreshViaOAuth(key: string, tokenData: any): Promise<void> {
    const userType = tokenData.userType || 'Location';

    const params = new URLSearchParams({
      client_id:     config.GHL_CLIENT_ID,
      client_secret: config.GHL_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: tokenData.refreshToken,
      user_type:     userType,
      redirect_uri:  config.GHL_REDIRECT_URI,
    });

    const response = await axios.post(
      GHL_OAUTH_URLS.token,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const newTokenData = response.data;
    await tokenStore.storeTokens(key, {
      ...tokenData,
      accessToken:  newTokenData.access_token,
      refreshToken: newTokenData.refresh_token || tokenData.refreshToken,
      expiresAt:    Date.now() + (newTokenData.expires_in * 1000),
    });

    logger.info(`TokenRefreshService: token refreshed via OAuth for key=${key}`);
  }

  async forceRefreshAll(): Promise<{ refreshed: number; failed: number }> {
    const allKeys = await tokenStore.getAllKeys();
    let refreshed = 0;
    let failed    = 0;

    for (const key of allKeys) {
      try {
        const tokenData = await tokenStore.getTokens(key);
        if (!tokenData) continue;

        if (key === COMPANY_ID || tokenData.userType === 'Company') {
          await this.refreshCompanyToken(key, tokenData.refreshToken);
        } else if (tokenData.locationId && tokenData.companyId) {
          await this.refreshLocationToken(tokenData.companyId, tokenData.locationId);
        } else {
          await this.refreshViaOAuth(key, tokenData);
        }
        refreshed++;
      } catch {
        failed++;
      }
    }

    return { refreshed, failed };
  }
}

export const tokenRefreshService = new TokenRefreshService();