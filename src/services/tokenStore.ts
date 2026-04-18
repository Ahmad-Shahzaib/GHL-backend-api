import { StoredTokenData } from '../types';
import { encrypt, decrypt } from '../utils/encryption';
import { logger } from '../utils/logger';
import { Token } from '../models/Token';

class TokenStore {

  async storeTokens(key: string, tokenData: StoredTokenData): Promise<void> {
    try {
      const encryptedData = encrypt(JSON.stringify(tokenData));
      await Token.findOneAndUpdate(
        { key },
        {
          key,
          accessToken:  encryptedData,
          refreshToken: tokenData.refreshToken,
          expiresAt:    tokenData.expiresAt,
          scope:        tokenData.scope        || '',
          userType:     tokenData.userType     || 'Location',
          companyId:    tokenData.companyId,
          locationId:   tokenData.locationId,
          userId:       tokenData.userId,
        },
        { upsert: true, new: true }
      );
      logger.info(`Tokens stored in MongoDB for key: ${key}`);
    } catch (error) {
      logger.error('Failed to store tokens:', error);
      throw new Error('Failed to store tokens');
    }
  }

  async getTokens(key: string): Promise<StoredTokenData | null> {
    try {
      const record = await Token.findOne({ key });
      if (!record) return null;

      const decryptedData = decrypt(record.accessToken);
      return JSON.parse(decryptedData) as StoredTokenData;
    } catch (error) {
      logger.error('Failed to retrieve tokens:', error);
      return null;
    }
  }

  async updateAccessToken(key: string, accessToken: string, expiresAt: number): Promise<void> {
    try {
      const existingTokens = await this.getTokens(key);
      if (!existingTokens) throw new Error('No existing tokens found');

      const updatedTokens: StoredTokenData = { ...existingTokens, accessToken, expiresAt };
      await this.storeTokens(key, updatedTokens);
      logger.info(`Access token updated for key: ${key}`);
    } catch (error) {
      logger.error('Failed to update access token:', error);
      throw new Error('Failed to update access token');
    }
  }

  async deleteTokens(key: string): Promise<void> {
    await Token.deleteOne({ key });
    logger.info(`Tokens deleted for key: ${key}`);
  }

  async hasValidTokens(key: string): Promise<boolean> {
    const tokens = await this.getTokens(key);
    if (!tokens) return false;
    const bufferTime = 5 * 60 * 1000;
    return tokens.expiresAt > Date.now() + bufferTime;
  }

  async getAllKeys(): Promise<string[]> {
    const records = await Token.find({}, { key: 1 });
    return records.map(r => r.key);
  }

  async clearAll(): Promise<void> {
    await Token.deleteMany({});
    logger.info('All tokens cleared from MongoDB');
  }
}

export const tokenStore = new TokenStore();