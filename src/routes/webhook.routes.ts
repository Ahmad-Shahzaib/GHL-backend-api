import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { ApiResponse, GHLWebhookPayload } from '../types';
import { logger } from '../utils/logger';
import { emailService } from '../services/emailService';
import { ghlClient } from '../services/ghlClient';

const router = Router();

router.post(
  '/ghl',
  asyncHandler(async (req: Request, res: Response) => {
    const payload = req.body as GHLWebhookPayload;

    logger.info('Received GHL webhook:', {
      type:       payload.type,
      appId:      payload.appId,
      locationId: payload.locationId,
      companyId:  payload.companyId,
    });

    switch (payload.type) {
      case 'INSTALL':
      case 'Install':
        await handleAppInstall(payload);
        break;
      case 'SaasPlansCreate':
        await handleSaasPlansCreate(payload);
        break;
      case 'UNINSTALL':
      case 'Uninstall':
        await handleAppUninstall(payload);
        break;
      case 'LOCATION_CREATE':
      case 'LocationCreate':
        await handleLocationCreate(payload);
        break;
      case 'LOCATION_UPDATE':
      case 'LocationUpdate':
        await handleLocationUpdate(payload);
        break;
      case 'LOCATION_DELETE':
      case 'LocationDelete':
        await handleLocationDelete(payload);
        break;
      default:
        logger.info(`Unhandled webhook type: ${payload.type}`);
    }

    const response: ApiResponse<{ received: boolean }> = {
      success: true,
      data: { received: true },
    };

    res.json(response);
  })
);

// ── INSTALL ───────────────────────────────────────────────────────────────────
// Fires when the app is installed on a sub-account via the SaaS plan
// This is the main entry point for new paying clients with private apps
async function handleAppInstall(payload: any): Promise<void> {
  logger.info('App INSTALL webhook received:', {
    locationId:  payload.locationId,
    companyId:   payload.companyId,
    companyName: payload.companyName,
  });

  const locationId = payload.locationId;
  const companyId  = payload.companyId || 'K9bORvG0pKtvt7QO4R9B';

  if (!locationId) {
    logger.warn('INSTALL webhook: missing locationId — skipping user creation');
    return;
  }

  // Pre-cache the location token immediately
  try {
    logger.info(`INSTALL: pre-caching location token for ${locationId}`);
    await ghlClient.getLocationToken(companyId, locationId);
    logger.info(`INSTALL: location token cached for ${locationId}`);
  } catch (tokenError: any) {
    logger.error('INSTALL: failed to pre-cache location token:', {
      locationId,
      companyId,
      message: tokenError?.message,
    });
  }

  // Try to get location details from GHL to get the email
  let email    = payload.email    || '';
  let name     = payload.name     || payload.companyName || '';

  if (!email && locationId) {
    try {
      ghlClient.setTokenKey(locationId);
      const location = await ghlClient.getLocation(locationId);
      email = location.email || '';
      name  = location.name  || name;
      logger.info(`INSTALL: fetched location details — email: ${email}, name: ${name}`);
    } catch (err: any) {
      logger.warn(`INSTALL: could not fetch location details: ${err?.message}`);
    }
  }

  if (!email) {
    logger.warn(`INSTALL: no email found for locationId ${locationId} — cannot create user`);
    return;
  }

  await createOrActivateUser({ email, name, locationId, companyId, phone: payload.phone || '' });
}

// ── UNINSTALL ─────────────────────────────────────────────────────────────────
async function handleAppUninstall(payload: GHLWebhookPayload): Promise<void> {
  logger.info('App uninstalled:', {
    locationId: payload.locationId,
    companyId:  payload.companyId,
  });

  // Optionally deactivate the user
  if (payload.locationId) {
    const { User } = require('../models/User');
    await User.findOneAndUpdate(
      { locationId: payload.locationId },
      { isActive: false, status: 'pending' }
    );
    logger.info(`User deactivated for locationId: ${payload.locationId}`);
  }
}

// ── AUTO INSTALL APP ─────────────────────────────────────────────────────────
// Installs the Clinic Engine app on a new sub-account using the company token
// This is required before getLocationToken can exchange for a location token
async function autoInstallApp(companyId: string, locationId: string): Promise<void> {
  const axios = require('axios');
  const { tokenStore } = require('../services/tokenStore');
  const { decrypt } = require('../utils/encryption');

  // Get company token
  const companyTokenData = await tokenStore.getTokens(companyId);
  if (!companyTokenData?.accessToken) {
    throw new Error('No company token found — cannot auto-install app');
  }

  const APP_ID = '69dd602d6da29047c949de19';

  const response = await axios.post(
    'https://services.leadconnectorhq.com/oauth/installedLocations',
    {
      customerId: companyId,
      locationId,
      appId:      APP_ID,
      skipInstallation: false,
    },
    {
      headers: {
        'Authorization': `Bearer ${companyTokenData.accessToken}`,
        'Content-Type':  'application/json',
        'Version':       '2021-07-28',
      },
    }
  );

  logger.info(`App installed on location ${locationId}:`, response.data);
}

// ── LOCATION CREATE ───────────────────────────────────────────────────────────
// Fires when a new sub-account is created
async function handleLocationCreate(payload: any): Promise<void> {
  logger.info('LocationCreate webhook received:', payload);

  const locationId = payload.locationId || payload.id;
  const companyId  = payload.companyId || 'K9bORvG0pKtvt7QO4R9B';

  if (!locationId) {
    logger.warn('LocationCreate: missing locationId — skipping');
    return;
  }

  // Auto-install the app on this new sub-account
  // This allows getLocationToken to work for this location
  try {
    logger.info(`LocationCreate: auto-installing app on ${locationId}`);
    await autoInstallApp(companyId, locationId);
    logger.info(`LocationCreate: app installed on ${locationId}`);
  } catch (installError: any) {
    logger.warn(`LocationCreate: auto-install failed (non-fatal): ${installError?.message}`);
  }

  // Pre-cache the location token
  try {
    logger.info(`LocationCreate: pre-caching location token for ${locationId}`);
    await ghlClient.getLocationToken(companyId, locationId);
    logger.info(`LocationCreate: location token cached for ${locationId}`);
  } catch (tokenError: any) {
    logger.error('LocationCreate: failed to pre-cache location token:', {
      locationId,
      companyId,
      message: tokenError?.message,
    });
    // Don't return — still try to fetch location details
  }

  // Fetch location details from GHL to get email and name
  // LocationCreate payload doesn't always include email
  let email = payload.email || '';
  let name  = payload.name || payload.companyName || '';
  let phone = payload.phone || '';

  if (!email) {
    try {
      logger.info(`LocationCreate: fetching location details from GHL for ${locationId}`);
      ghlClient.setTokenKey(locationId);
      const locationResponse = await ghlClient.getLocation(locationId);
      // GHL returns { location: { email, name, ... } } wrapper
      const loc = (locationResponse as any).location || locationResponse;
      email = loc.email || loc.business?.email || '';
      name  = loc.name  || name;
      phone = loc.phone || phone;
      logger.info(`LocationCreate: fetched — email: ${email}, name: ${name}`);
    } catch (err: any) {
      logger.warn(`LocationCreate: could not fetch location details: ${err?.message}`);
    }
  }

  if (!email) {
    logger.warn(`LocationCreate: no email found for locationId ${locationId} — cannot create user`);
    return;
  }

  await createOrActivateUser({ email, name, locationId, companyId, phone });
}

// ── SAAS PLANS CREATE ────────────────────────────────────────────────────────
// Fires when a new SaaS subscription is created after payment
// Contains locationId, companyId — we fetch email from GHL location API
async function handleSaasPlansCreate(payload: any): Promise<void> {
  logger.info('SaasPlansCreate webhook received:', {
    locationId: payload.locationId,
    companyId:  payload.companyId,
  });

  const locationId = payload.locationId;
  const companyId  = payload.companyId || 'K9bORvG0pKtvt7QO4R9B';

  if (!locationId) {
    logger.warn('SaasPlansCreate: missing locationId — skipping');
    return;
  }

  // Pre-cache the location token
  try {
    await ghlClient.getLocationToken(companyId, locationId);
    logger.info(`SaasPlansCreate: location token cached for ${locationId}`);
  } catch (tokenError: any) {
    logger.error('SaasPlansCreate: failed to pre-cache location token:', {
      locationId,
      message: tokenError?.message,
    });
  }

  // Get email from payload or fetch from GHL
  let email = payload.email || '';
  let name  = payload.name  || payload.companyName || '';
  let phone = payload.phone || '';

  if (!email) {
    try {
      logger.info(`SaasPlansCreate: fetching location details from GHL for ${locationId}`);
      ghlClient.setTokenKey(locationId);
      const locationResponse = await ghlClient.getLocation(locationId);
      const loc = (locationResponse as any).location || locationResponse;
      email = loc.email || loc.business?.email || '';
      name  = loc.name  || name;
      phone = loc.phone || phone;
      logger.info(`SaasPlansCreate: fetched — email: ${email}, name: ${name}`);
    } catch (err: any) {
      logger.warn(`SaasPlansCreate: could not fetch location details: ${err?.message}`);
    }
  }

  if (!email) {
    logger.warn(`SaasPlansCreate: no email found for locationId ${locationId} — cannot create user`);
    return;
  }

  await createOrActivateUser({ email, name, locationId, companyId, phone });
}

// ── SHARED USER CREATION LOGIC ────────────────────────────────────────────────
async function createOrActivateUser(data: {
  email:      string;
  name:       string;
  locationId: string;
  companyId:  string;
  phone:      string;
}): Promise<void> {
  const { User } = require('../models/User');
  const crypto   = require('crypto');

  const { email, name, locationId, companyId, phone } = data;

  const token  = crypto.randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const existingUser = await User.findOne({ email: email.toLowerCase() });

  if (existingUser) {
    // Update existing user (may have been pre-registered from pricing page)
    existingUser.locationId             = locationId;
    existingUser.companyId              = companyId;
    existingUser.status                 = 'active';
    existingUser.isActive               = true;
    existingUser.passwordSetToken       = token;
    existingUser.passwordSetTokenExpiry = expiry;
    if (!existingUser.fullName && name)    existingUser.fullName    = name;
    if (!existingUser.companyName && name) existingUser.companyName = name;
    await existingUser.save();
    logger.info(`Existing user activated: ${email} → locationId: ${locationId}`);
  } else {
    // Create new user
    await User.create({
      email:                  email.toLowerCase(),
      fullName:               name,
      companyName:            name,
      phone:                  phone,
      desiredLocationName:    name,
      locationId,
      companyId,
      plan:                   'basic',
      status:                 'active',
      isActive:               true,
      passwordSetToken:       token,
      passwordSetTokenExpiry: expiry,
      passwordHash:           null,
    });
    logger.info(`New user created: ${email} → locationId: ${locationId}`);
  }

  // Send welcome email
  try {
    await emailService.sendWelcome(email, token);
    logger.info(`Welcome email sent to: ${email}`);
  } catch (emailError: any) {
    logger.error('Failed to send welcome email:', {
      email,
      message:  emailError?.message,
      code:     emailError?.code,
    });
  }
}

async function handleLocationUpdate(payload: GHLWebhookPayload): Promise<void> {
  logger.info('Location updated:', {
    locationId: payload.locationId,
    companyId:  payload.companyId,
  });
}

async function handleLocationDelete(payload: GHLWebhookPayload): Promise<void> {
  logger.info('Location deleted:', {
    locationId: payload.locationId,
    companyId:  payload.companyId,
  });
}

export default router;
