import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthUser, JWTPayload } from '../types';
import { ghlClient } from './ghlClient';
import { tokenStore } from './tokenStore';
import { logger } from '../utils/logger';

/**
 * Authentication Service
 * Handles JWT generation/verification and OAuth integration
 */
export class AuthService {
  /**
   * Generate JWT token for authenticated user
   */
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
  
  /**
   * Verify and decode JWT token
   */
  verifyToken(token: string): JWTPayload {
    try {
      return jwt.verify(token, config.JWT_SECRET) as JWTPayload;
    } catch (error) {
      logger.error('JWT verification failed:', error);
      throw new Error('Invalid or expired token');
    }
  }
  
  /**
   * Handle OAuth callback and token exchange
   */
  async handleOAuthCallback(code: string, userType: 'Company' | 'Location' = 'Location'): Promise<{
    token: string;
    user: AuthUser;
  }> {
    try {
      // Exchange code for tokens
      const tokenResponse = await ghlClient.exchangeCodeForToken(code, userType);
      
      // Store tokens securely
      await ghlClient.storeTokens(tokenResponse);
      
      // Create user object
      const user: AuthUser = {
        id: tokenResponse.userId || tokenResponse.locationId || '',
        email: '', // Will be populated from user profile if available
        locationId: tokenResponse.locationId,
        companyId: tokenResponse.companyId,
        permissions: this.parseScopes(tokenResponse.scope),
      };
      
      // Try to fetch user details
      try {
        if (tokenResponse.userId) {
          ghlClient.setTokenKey(tokenResponse.locationId || tokenResponse.userId);
          const userDetails = await ghlClient.getUser(tokenResponse.userId);
          user.email = userDetails.email;
          user.firstName = userDetails.firstName;
          user.lastName = userDetails.lastName;
        }
      } catch (error) {
        logger.warn('Could not fetch user details:', error);
      }
      
      // Generate JWT
      const jwtToken = this.generateToken(user);
      
      logger.info(`User authenticated: ${user.id}`);
      
      return {
        token: jwtToken,
        user,
      };
    } catch (error) {
      logger.error('OAuth callback handling failed:', error);
      throw error;
    }
  }
  
  /**
   * Get authorization URL for OAuth flow
   */
  getAuthorizationUrl(): string {
    return ghlClient.getAuthorizationUrl();
  }
  
  /**
   * Logout user and revoke tokens
   */
  async logout(tokenKey: string): Promise<void> {
    await tokenStore.deleteTokens(tokenKey);
    logger.info(`User logged out: ${tokenKey}`);
  }
  
  /**
   * Parse OAuth scopes into permissions array
   */
  private parseScopes(scope: string): string[] {
    return scope.split(' ').map(s => s.trim()).filter(Boolean);
  }
  
  /**
   * Check if user has required permission
   */
  hasPermission(userPermissions: string[], requiredPermission: string): boolean {
    // Support wildcard permissions like 'contacts.*'
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
  
  /**
   * Refresh GHL access token if needed
   */
  async ensureValidGHLToken(tokenKey: string): Promise<boolean> {
    try {
      ghlClient.setTokenKey(tokenKey);
      await ghlClient.getValidAccessToken();
      return true;
    } catch (error) {
      logger.error('Failed to ensure valid GHL token:', error);
      return false;
    }
  }
}

// Export singleton instance
export const authService = new AuthService();
