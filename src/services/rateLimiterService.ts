import { logger } from '../utils/logger';

/**
 * Token bucket rate limiter for GHL API
 * GHL API limit: 100 requests per 10 seconds per location
 */
class RateLimiterService {
  private buckets: Map<string, TokenBucket> = new Map();
  private readonly DEFAULT_LIMIT = 100; // requests
  private readonly DEFAULT_WINDOW = 10 * 1000; // 10 seconds in ms

  /**
   * Get or create a token bucket for a location
   */
  private getBucket(key: string, limit: number = this.DEFAULT_LIMIT, windowMs: number = this.DEFAULT_WINDOW): TokenBucket {
    if (!this.buckets.has(key)) {
      this.buckets.set(key, new TokenBucket(limit, windowMs));
    }
    return this.buckets.get(key)!;
  }

  /**
   * Check if a request can be made
   * Returns true if allowed, false if rate limited
   */
  canMakeRequest(key: string): boolean {
    const bucket = this.getBucket(key);
    return bucket.consume(1);
  }

  /**
   * Wait until a request can be made
   * Returns a promise that resolves when the request can proceed
   */
  async waitForSlot(key: string, maxWaitMs: number = 5000): Promise<boolean> {
    const bucket = this.getBucket(key);
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      if (bucket.consume(1)) {
        return true;
      }
      // Wait a bit before trying again
      await this.delay(100);
    }

    logger.warn(`Rate limiter timeout for key: ${key}`);
    return false;
  }

  /**
   * Execute a function with rate limiting
   */
  async executeWithRateLimit<T>(
    key: string,
    fn: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Wait for a slot
      const canProceed = await this.waitForSlot(key);
      
      if (!canProceed) {
        throw new Error(`Rate limit exceeded for ${key}`);
      }

      try {
        return await fn();
      } catch (error: any) {
        // If it's a rate limit error from GHL, wait and retry
        if (error.response?.status === 429) {
          const retryAfter = parseInt(error.response.headers['retry-after']) || 1;
          logger.warn(`GHL rate limit hit, waiting ${retryAfter}s before retry ${attempt}/${maxRetries}`);
          await this.delay(retryAfter * 1000);
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Max retries exceeded for ${key}`);
  }

  /**
   * Get current bucket status
   */
  getStatus(key: string): { tokens: number; limit: number; resetTime: number } | null {
    const bucket = this.buckets.get(key);
    if (!bucket) return null;
    return bucket.getStatus();
  }

  /**
   * Reset bucket for a key
   */
  reset(key: string): void {
    this.buckets.delete(key);
    logger.info(`Rate limiter reset for key: ${key}`);
  }

  /**
   * Clear all buckets
   */
  clearAll(): void {
    this.buckets.clear();
    logger.info('All rate limiter buckets cleared');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Token bucket implementation
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.tokens = limit;
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume tokens
   * Returns true if consumed, false if not enough tokens
   */
  consume(tokens: number): boolean {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    
    return false;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor((elapsed / this.windowMs) * this.limit);
    
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.limit, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * Get current bucket status
   */
  getStatus(): { tokens: number; limit: number; resetTime: number } {
    this.refill();
    return {
      tokens: this.tokens,
      limit: this.limit,
      resetTime: this.lastRefill + this.windowMs,
    };
  }
}

// Export singleton instance
export const rateLimiterService = new RateLimiterService();
