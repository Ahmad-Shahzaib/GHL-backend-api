import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthUser, JWTPayload } from '../types';
import { ghlClient } from './ghlClient';
import { tokenStore } from './tokenStore';
import { logger } from '../utils/logger';

export class AuthService {
  generateToken(user: AuthUser): string {
    const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId: user.id,
      email: user.email,
      locationId: user.locationId,
      companyId: user.companyId,
    };
    return jwt.sign(payload, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });
  }

  verifyToken(token: string): JWTPayload {
    try {
      return jwt.verify(token, config.JWT_SECRET) as JWTPayload;
    } catch (error: any) {
      logger.error('JWT verification failed:', error?.message || 'Unknown error');
      throw new Error('Invalid or expired token');
    }
  }

  async handleOAuthCallback(code: string, userType: 'Company' | 'Location' = 'Location'): Promise<{
    token: string;
    user: AuthUser;
  }> {
    try {
      // Exchange code for tokens
      const tokenResponse = await ghlClient.exchangeCodeForToken(code, userType);

      logger.info('Token exchange successful:', {
        userId: tokenResponse.userId,
        locationId: tokenResponse.locationId,
        companyId: tokenResponse.companyId,
        userType: tokenResponse.userType,
      });

      // Store tokens securely
      await ghlClient.storeTokens(tokenResponse);

      // Create user object
      const user: AuthUser = {
        id: tokenResponse.userId || tokenResponse.companyId || tokenResponse.locationId || '',
        email: '',
        locationId: tokenResponse.locationId,
        companyId: tokenResponse.companyId,
        permissions: this.parseScopes(tokenResponse.scope || ''),
      };

      // Try to fetch user details
      try {
        if (tokenResponse.userId) {
          ghlClient.setTokenKey(tokenResponse.locationId || tokenResponse.userId);
          const userDetails = await ghlClient.getUser(tokenResponse.userId);
          user.email = userDetails.email || '';
          user.firstName = userDetails.firstName;
          user.lastName = userDetails.lastName;
        }
      } catch (error: any) {
        logger.warn('Could not fetch user details:', error?.message || 'Unknown error');
      }

      // Generate JWT
      const jwtToken = this.generateToken(user);

      logger.info(`User authenticated successfully: ${user.id}`);

      return { token: jwtToken, user };

    } catch (error: any) {
      logger.error('OAuth callback handling failed:', error?.message || 'Unknown error');
      throw error;
    }
  }

  getAuthorizationUrl(): string {
    return ghlClient.getAuthorizationUrl();
  }

  async logout(tokenKey: string): Promise<void> {
    await tokenStore.deleteTokens(tokenKey);
    logger.info(`User logged out: ${tokenKey}`);
  }

  private parseScopes(scope: string): string[] {
    if (!scope) return [];
    return scope.split(' ').map(s => s.trim()).filter(Boolean);
  }

  hasPermission(userPermissions: string[], requiredPermission: string): boolean {
    return userPermissions.some(permission => {
      if (permission === requiredPermission) return true;
      if (permission === '*') return true;
      const wildcardMatch = requiredPermission.match(/^(.+)\.\w+$/);
      if (wildcardMatch) {
        return permission === `${wildcardMatch[1]}.*`;
      }
      return false;
    });
  }

  async ensureValidGHLToken(tokenKey: string): Promise<boolean> {
    try {
      ghlClient.setTokenKey(tokenKey);
      await ghlClient.getValidAccessToken();
      return true;
    } catch (error: any) {
      logger.error('Failed to ensure valid GHL token:', error?.message || 'Unknown error');
      return false;
    }
  }
}

export const authService = new AuthService();