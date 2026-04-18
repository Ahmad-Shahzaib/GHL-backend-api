import { Request } from 'express';
import { ghlClient } from '../services/ghlClient';
import { logger } from '../utils/logger';

/**
 * Shared helper used by every authenticated route that calls GHL.
 *
 * 1. Reads locationId + companyId from req.user (set by authenticate middleware)
 * 2. Exchanges the company OAuth token for a location-level token
 * 3. Stores that token in MongoDB under locationId
 * 4. Calls ghlClient.setTokenKey(locationId) so all subsequent GHL calls use it
 *
 * Returns the locationId string (may be undefined if user has none yet).
 */
export const setupLocationToken = async (req: Request): Promise<string | undefined> => {
  const locationId = (req.user?.locationId || req.query.locationId) as string | undefined;
  const companyId  = req.user?.companyId || 'K9bORvG0pKtvt7QO4R9B';

  logger.info('setupLocationToken called', { locationId, companyId });

  if (!locationId) {
    logger.warn('setupLocationToken: no locationId on request — falling back to pit- key');
    return undefined;
  }

  try {
    const locToken = await ghlClient.getLocationToken(companyId, locationId);
    logger.info('Location token obtained', { locationId, tokenStart: locToken.substring(0, 20) });
  } catch (e: any) {
    logger.error('getLocationToken failed:', e?.message || e);
    // Do NOT rethrow — fall through so ghlClient.setTokenKey still runs.
    // If a cached token already exists in MongoDB it will be used.
  }

  ghlClient.setTokenKey(locationId);
  return locationId;
};
