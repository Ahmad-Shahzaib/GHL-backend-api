import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthUser, JWTPayload } from '../types';
import { ghlClient } from './ghlClient';
import { tokenStore } from './tokenStore';
import { paymentService } from './paymentService';
import { logger } from '../utils/logger';
import { User, IUser } from '../models/User';
import { emailService } from './emailService';
import { Errors } from '../middleware/errorHandler'; // ← single import (duplicate removed)

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

  async createPendingUser(data: {
    email: string;
    fullName: string;
    companyName: string;
    phone: string;
    desiredLocationName: string;
    plan: 'basic' | 'pro' | 'agency';
    address?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }): Promise<IUser> {
    const existing = await User.findOne({ email: data.email });
    if (existing) throw Errors.Conflict('User already exists');

    const passwordSetToken = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await User.create({
      email: data.email,
      fullName: data.fullName,
      companyName: data.companyName,
      phone: data.phone,
      desiredLocationName: data.desiredLocationName,
      address: data.address || undefined,
      city: data.city || undefined,
      state: data.state || undefined,
      postalCode: data.postalCode || undefined,
      country: data.country || undefined,
      plan: data.plan,
      status: 'pending',
      isActive: false,
      companyId: 'K9bORvG0pKtvt7QO4R9B',
      locationId: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      passwordSetToken,
      passwordSetTokenExpiry: expiry,
      passwordHash: null,
    });

    try {
      await emailService.sendWelcome(user.email, passwordSetToken);
    } catch (error: any) {
      logger.error('Failed to send welcome email for pending user', {
        email: user.email,
        error: error?.message || error,
      });
    }

    return user;
  }

  async createCheckoutSession(userId: string): Promise<{ url: string; sessionId: string }> {
    const user = await User.findById(userId);
    if (!user) throw Errors.NotFound('User not found');
    if (user.status !== 'pending') throw Errors.BadRequest('User is not pending payment');

    const customer = user.stripeCustomerId
      ? await paymentService.retrieveCustomer(user.stripeCustomerId)
      : await paymentService.createCustomer({
          email: user.email,
          name: user.fullName,
          phone: user.phone,
        });

    if (!user.stripeCustomerId && customer.id) {
      user.stripeCustomerId = customer.id;
      await user.save();
    }

    const session = await paymentService.createCheckoutSession({
      customerId: customer.id,
      userId: user._id.toString(),
      plan: user.plan,
    });

    return { url: session.url || '', sessionId: session.id };
  }

  async confirmPayment(sessionId: string): Promise<IUser> {
    const session = await paymentService.retrieveSession(sessionId);
    if (session.payment_status !== 'paid') {
      throw new Error('Payment is not complete');
    }

    const userId = session.metadata?.userId || session.client_reference_id;
    if (!userId || typeof userId !== 'string') {
      throw new Error('Session metadata missing userId');
    }

    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    if (user.status !== 'pending') throw new Error('User is not pending payment');

    if (session.customer) {
      user.stripeCustomerId = typeof session.customer === 'string' ? session.customer : session.customer.id;
    }
    user.stripeSubscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id || null;

    const location = await this.createLocationForUser(user);
    if (location?.id) {
      user.locationId = location.id;
    }

    user.status = 'active';
    user.isActive = true;
    await user.save();

    return user;
  }

  private async createLocationForUser(user: IUser) {
    ghlClient.setApiKey(config.GHL_ADMIN_API_KEY);

    const locationPayload = {
      name: user.desiredLocationName || user.companyName,
      email: user.email,
      phone: user.phone,
      address: user.address || undefined,
      city: user.city || undefined,
      state: user.state || undefined,
      postalCode: user.postalCode || undefined,
      country: user.country || undefined,
      timezone: 'America/New_York',
      business: {
        name: user.companyName,
        address: user.address || undefined,
        city: user.city || undefined,
        state: user.state || undefined,
        postalCode: user.postalCode || undefined,
        country: user.country || undefined,
        timezone: 'America/New_York',
      },
    };

    return ghlClient.createLocation(locationPayload);
  }

  async login(email: string, password: string): Promise<{ token: string; user: IUser }> {
    const user = await User.findOne({ email, isActive: true });
    if (!user || !user.passwordHash) throw new Error('Invalid credentials');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new Error('Invalid credentials');

    const token = this.generateToken({
      id: user._id.toString(),
      email: user.email,
      locationId: user.locationId ?? undefined,
      companyId: user.companyId,
      permissions: [],
    });

    return { token, user };
  }

  // FIX #3 — return user object so frontend can store locationId in localStorage
  async setPassword(token: string, password: string): Promise<{ token: string; user: { id: string; email: string; locationId: string | null; plan: string } }> {
    const user = await User.findOne({
      passwordSetToken: token,
      passwordSetTokenExpiry: { $gt: new Date() },
    });
    if (!user) throw new Error('Token invalid or expired');

    user.passwordHash = await bcrypt.hash(password, 12);
    user.passwordSetToken = null;
    user.passwordSetTokenExpiry = null;
    await user.save();

    const jwtToken = this.generateToken({
      id: user._id.toString(),
      email: user.email,
      locationId: user.locationId ?? undefined,
      companyId: user.companyId,
      permissions: [],
    });

    return {
      token: jwtToken,
      user: {
        id: user._id.toString(),
        email: user.email,
        locationId: user.locationId,
        plan: user.plan,
      },
    };
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await User.findOne({ email });
    if (!user) return;

    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = token;
    user.passwordResetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    await emailService.sendPasswordReset(user.email, token);
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetTokenExpiry: { $gt: new Date() },
    });
    if (!user) throw new Error('Token invalid or expired');

    user.passwordHash = await bcrypt.hash(password, 12);
    user.passwordResetToken = null;
    user.passwordResetTokenExpiry = null;
    await user.save();
  }

  async handleOAuthCallback(
    code: string,
    userType: 'Company' | 'Location' = 'Location'
  ): Promise<{ token: string; user: AuthUser }> {
    try {
      const tokenResponse = await ghlClient.exchangeCodeForToken(code, 'Company');

      logger.info('Token exchange successful:', {
        userId: tokenResponse.userId,
        locationId: tokenResponse.locationId,
        companyId: tokenResponse.companyId,
        userType: tokenResponse.userType,
      });

      await ghlClient.storeTokens(tokenResponse);

      if (tokenResponse.companyId) {
        logger.info('Company token stored, location tokens will be fetched on demand');
      }

      const user: AuthUser = {
        id: tokenResponse.userId || tokenResponse.companyId || '',
        email: '',
        locationId: tokenResponse.locationId,
        companyId: tokenResponse.companyId,
        permissions: this.parseScopes(tokenResponse.scope || ''),
      };

      try {
        if (tokenResponse.userId) {
          ghlClient.setTokenKey(tokenResponse.companyId || tokenResponse.userId);
          const userDetails = await ghlClient.getUser(tokenResponse.userId);
          user.email = userDetails.email || '';
          user.firstName = userDetails.firstName;
          user.lastName = userDetails.lastName;
        }
      } catch (error: any) {
        logger.warn('Could not fetch user details:', error?.message);
      }

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
