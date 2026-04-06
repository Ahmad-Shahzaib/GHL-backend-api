import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { ApiResponse, GHLWebhookPayload } from '../types';
import { logger } from '../utils/logger';

const router = Router();

/**
 * @route   POST /api/webhooks/ghl
 * @desc    Receive GoHighLevel webhook events
 * @access  Public (should be secured with webhook signature verification in production)
 */
router.post(
  '/ghl',
  asyncHandler(async (req: Request, res: Response) => {
    const payload = req.body as GHLWebhookPayload;
    
    logger.info('Received GHL webhook:', {
      type: payload.type,
      appId: payload.appId,
      locationId: payload.locationId,
      companyId: payload.companyId,
    });
    
    // Handle different webhook types
    switch (payload.type) {
      case 'INSTALL':
        await handleAppInstall(payload);
        break;
        
      case 'UNINSTALL':
        await handleAppUninstall(payload);
        break;
        
      case 'LOCATION_CREATE':
        await handleLocationCreate(payload);
        break;
        
      case 'LOCATION_UPDATE':
        await handleLocationUpdate(payload);
        break;
        
      case 'LOCATION_DELETE':
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

/**
 * Handle app installation webhook
 */
async function handleAppInstall(payload: GHLWebhookPayload): Promise<void> {
  logger.info('App installed:', {
    locationId: payload.locationId,
    companyId: payload.companyId,
    companyName: payload.companyName,
  });
  
  // TODO: Initialize user data, send welcome email, etc.
}

/**
 * Handle app uninstallation webhook
 */
async function handleAppUninstall(payload: GHLWebhookPayload): Promise<void> {
  logger.info('App uninstalled:', {
    locationId: payload.locationId,
    companyId: payload.companyId,
  });
  
  // TODO: Clean up user data, revoke tokens, etc.
}

/**
 * Handle location creation webhook
 */
async function handleLocationCreate(payload: GHLWebhookPayload): Promise<void> {
  logger.info('Location created:', {
    locationId: payload.locationId,
    companyId: payload.companyId,
  });
  
  // TODO: Set up new location in your system
}

/**
 * Handle location update webhook
 */
async function handleLocationUpdate(payload: GHLWebhookPayload): Promise<void> {
  logger.info('Location updated:', {
    locationId: payload.locationId,
    companyId: payload.companyId,
  });
  
  // TODO: Update location data in your system
}

/**
 * Handle location deletion webhook
 */
async function handleLocationDelete(payload: GHLWebhookPayload): Promise<void> {
  logger.info('Location deleted:', {
    locationId: payload.locationId,
    companyId: payload.companyId,
  });
  
  // TODO: Clean up location data
}

export default router;
