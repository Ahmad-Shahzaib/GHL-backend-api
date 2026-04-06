import { StoredTokenData } from '../types';
import { encrypt, decrypt } from '../utils/encryption';
import { logger } from '../utils/logger';

/**
 * In-memory token store for development/testing.
 * In production, use Redis, database, or secure external storage.
 */
class TokenStore {
  private tokens: Map<string, string> = new Map();
  
  /**
   * Store tokens for a user/location
   */
  async storeTokens(key: string, tokenData: StoredTokenData): Promise<void> {
    try {
      const encryptedData = encrypt(JSON.stringify(tokenData));
      this.tokens.set(key, encryptedData);
      logger.info(`Tokens stored for key: ${key}`);
    } catch (error) {
      logger.error('Failed to store tokens:', error);
      throw new Error('Failed to store tokens');
    }
  }
  
  /**
   * Retrieve tokens for a user/location
   */
  async getTokens(key: string): Promise<StoredTokenData | null> {
    try {
      const encryptedData = this.tokens.get(key);
      
      if (!encryptedData) {
        return null;
      }
      
      const decryptedData = decrypt(encryptedData);
      return JSON.parse(decryptedData) as StoredTokenData;
    } catch (error) {
      logger.error('Failed to retrieve tokens:', error);
      return null;
    }
  }
  
  /**
   * Update access token after refresh
   */
  async updateAccessToken(
    key: string, 
    accessToken: string, 
    expiresAt: number
  ): Promise<void> {
    try {
      const existingTokens = await this.getTokens(key);
      
      if (!existingTokens) {
        throw new Error('No existing tokens found');
      }
      
      const updatedTokens: StoredTokenData = {
        ...existingTokens,
        accessToken,
        expiresAt,
      };
      
      await this.storeTokens(key, updatedTokens);
      logger.info(`Access token updated for key: ${key}`);
    } catch (error) {
      logger.error('Failed to update access token:', error);
      throw new Error('Failed to update access token');
    }
  }
  
  /**
   * Delete tokens for a user/location
   */
  async deleteTokens(key: string): Promise<void> {
    this.tokens.delete(key);
    logger.info(`Tokens deleted for key: ${key}`);
  }
  
  /**
   * Check if tokens exist and are valid
   */
  async hasValidTokens(key: string): Promise<boolean> {
    const tokens = await this.getTokens(key);
    
    if (!tokens) {
      return false;
    }
    
    // Check if token is expired (with 5 minute buffer)
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    return tokens.expiresAt > Date.now() + bufferTime;
  }
  
  /**
   * Get all stored keys (for admin/debugging)
   */
  async getAllKeys(): Promise<string[]> {
    return Array.from(this.tokens.keys());
  }
  
  /**
   * Clear all tokens
   */
  async clearAll(): Promise<void> {
    this.tokens.clear();
    logger.info('All tokens cleared');
  }
}

// Export singleton instance
export const tokenStore = new TokenStore();
