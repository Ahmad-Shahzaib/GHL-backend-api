  async getLocationToken(companyId: string, locationId: string): Promise<string> {
    const companyTokenData = await tokenStore.getTokens(companyId);

    logger.info('getLocationToken called:', {
      companyId,
      locationId,
      hasCompanyToken: !!companyTokenData?.accessToken,
      companyTokenExpiry: companyTokenData?.expiresAt
        ? new Date(companyTokenData.expiresAt).toISOString()
        : 'none',
    });

    if (!companyTokenData?.accessToken) {
      throw new Error(
        `No company OAuth token found for companyId: ${companyId}. App must be installed first.`
      );
    }

    // FIX #4 — wrap in try/catch so errors are visible, not silent
    try {
      const response = await axios.post(
        'https://services.leadconnectorhq.com/oauth/locationToken',
        { companyId, locationId },
        {
          headers: {
            'Authorization': `Bearer ${companyTokenData.accessToken}`,
            'Content-Type': 'application/json',
            'Accept':        'application/json',
            'Version':       '2021-07-28',
          },
        }
      );

      const locationTokenData = response.data;
      logger.info('Location token received:', {
        locationId,
        userType:   locationTokenData.userType,
        tokenStart: locationTokenData.access_token?.substring(0, 20),
      });

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

      logger.info(`Location token stored for locationId: ${locationId}`);
      return locationTokenData.access_token;

    } catch (error: any) {
      const status  = error?.response?.status;
      const detail  = error?.response?.data;
      const message = error?.message;
      logger.error('getLocationToken FAILED:', {
        companyId,
        locationId,
        status,
        detail,
        message,
      });
      throw new Error(
        `getLocationToken failed for locationId ${locationId}: [${status}] ${JSON.stringify(detail) || message}`
      );
    }
  }
