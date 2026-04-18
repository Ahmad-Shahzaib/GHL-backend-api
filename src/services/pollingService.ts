import axios from 'axios';
import { tokenStore } from './tokenStore';
import { emailService } from './emailService';
import { ghlClient } from './ghlClient';
import { logger } from '../utils/logger';
import { User } from '../models/User';

const COMPANY_ID = 'K9bORvG0pKtvt7QO4R9B';
const APP_ID     = '69dd602d6da29047c949de19';

class PollingService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(intervalMinutes = 2): void {
    if (this.intervalId) {
      logger.info('Polling service already running');
      return;
    }

    logger.info(`Polling service started — checking every ${intervalMinutes} minutes`);

    // Run immediately on start
    this.checkNewSubAccounts();

    // Then run every N minutes
    this.intervalId = setInterval(() => {
      this.checkNewSubAccounts();
    }, intervalMinutes * 60 * 1000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Polling service stopped');
    }
  }

  async checkNewSubAccounts(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      logger.info('Polling: checking for new sub-accounts...');

      // Get company token
      const companyTokenData = await tokenStore.getTokens(COMPANY_ID);
      if (!companyTokenData?.accessToken) {
        logger.warn('Polling: no company token found — skipping');
        return;
      }

      // Get all locations for this company
      const response = await axios.get(
        `https://services.leadconnectorhq.com/locations/search?companyId=${COMPANY_ID}&limit=100`,
        {
          headers: {
            'Authorization': `Bearer ${companyTokenData.accessToken}`,
            'Version':       '2021-07-28',
          },
        }
      );

      const locations = response.data?.locations || [];
      logger.info(`Polling: found ${locations.length} sub-accounts`);

      for (const location of locations) {
        await this.processLocation(location, companyTokenData.accessToken);
      }

    } catch (error: any) {
      logger.error('Polling: error checking sub-accounts:', {
        message: error?.message,
        status:  error?.response?.status,
        data:    error?.response?.data,
      });
    } finally {
      this.isRunning = false;
    }
  }

  private async processLocation(location: any, companyToken: string): Promise<void> {
    const locationId = location.id;
    const email      = location.email || location.business?.email || '';
    const name       = location.name  || '';
    const phone      = location.phone || '';

    if (!email) return;

    try {
      // Check if user exists and is active
      const existingUser = await User.findOne({ email: email.toLowerCase() });

      if (existingUser?.isActive && existingUser?.locationId) {
        // Already active — skip
        return;
      }

      if (!existingUser) {
        // New user — not pre-registered, skip (they need to register first)
        logger.info(`Polling: no user found for ${email} — skipping`);
        return;
      }

      if (existingUser && !existingUser.isActive) {
        logger.info(`Polling: found pending user ${email} with locationId ${locationId} — activating`);

        // Try to install app and get location token
        try {
          await this.installAppOnLocation(locationId, companyToken);
          await ghlClient.getLocationToken(COMPANY_ID, locationId);
          logger.info(`Polling: location token cached for ${locationId}`);
        } catch (err: any) {
          logger.warn(`Polling: token setup failed for ${locationId}: ${err?.message}`);
        }

        // Activate user
        const crypto = require('crypto');
        const token  = crypto.randomBytes(32).toString('hex');
        existingUser.locationId             = locationId;
        existingUser.companyId              = COMPANY_ID;
        existingUser.status                 = 'active';
        existingUser.isActive               = true;
        existingUser.passwordSetToken       = token;
        existingUser.passwordSetTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
        if (!existingUser.fullName && name)    existingUser.fullName    = name;
        if (!existingUser.companyName && name) existingUser.companyName = name;
        await existingUser.save();

        // Send welcome email
        try {
          await emailService.sendWelcome(email, token);
          logger.info(`Polling: welcome email sent to ${email}`);
        } catch (emailErr: any) {
          logger.error(`Polling: failed to send welcome email to ${email}:`, emailErr?.message);
        }
      }

    } catch (error: any) {
      logger.error(`Polling: error processing location ${locationId}:`, error?.message);
    }
  }

  private async installAppOnLocation(locationId: string, companyToken: string): Promise<void> {
    await axios.post(
      'https://services.leadconnectorhq.com/oauth/installedLocations',
      {
        customerId:       COMPANY_ID,
        locationId,
        appId:            APP_ID,
        skipInstallation: false,
      },
      {
        headers: {
          'Authorization': `Bearer ${companyToken}`,
          'Content-Type':  'application/json',
          'Version':       '2021-07-28',
        },
      }
    );
    logger.info(`Polling: app installed on ${locationId}`);
  }
}

export const pollingService = new PollingService();
