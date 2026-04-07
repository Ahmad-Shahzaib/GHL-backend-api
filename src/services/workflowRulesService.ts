import { WorkflowOptimizationRule } from '../types';
import { cacheService } from './cacheService';
import { logger } from '../utils/logger';
import axios from 'axios';

/**
 * Service for managing workflow optimization rules
 * Stores rules in GHL Custom Fields for production use
 */
class WorkflowRulesService {
  private readonly CACHE_KEY_PREFIX = 'workflow_rules:';
  private readonly CACHE_TTL = 10 * 60 * 1000; // 10 minutes
  private readonly DEFAULT_RULES: WorkflowOptimizationRule[] = [
    {
      id: 'prime-hour-protection',
      type: 'prime_hour_protection',
      name: 'Prime-Hour Protection',
      description: '10:00–18:00 reserved for high-ticket treatments. Low-ticket services blocked from prime slots unless high-ticket unavailable.',
      isActive: true,
      priority: 1,
      config: {
        primeHours: [10, 11, 12, 13, 14, 15, 16, 17],
        blockedCategories: ['low_ticket'],
        requiresApproval: true,
      },
    },
    {
      id: 'buffer-logic',
      type: 'buffer_logic',
      name: 'Buffer Logic',
      description: '15-min buffer after procedures >60 mins. 30-min buffer after injectable or laser treatments.',
      isActive: true,
      priority: 2,
      config: {
        standardBuffer: 15,
        extendedBuffer: 30,
        extendedBufferTypes: ['injectable', 'laser'],
        minDurationForBuffer: 60,
      },
    },
    {
      id: 'capacity-routing',
      type: 'capacity_routing',
      name: 'Capacity Routing',
      description: 'Route new bookings to lowest-utilization room matching treatment requirements.',
      isActive: true,
      priority: 3,
      config: {
        strategy: 'lowest_utilization',
        clusterSimilar: true,
        escalateHighDemand: true,
      },
    },
    {
      id: 'provider-stability',
      type: 'provider_stability',
      name: 'Provider-Room Stability',
      description: 'Minimize provider room switches per shift. Flag >3 room switches per provider per day.',
      isActive: true,
      priority: 4,
      config: {
        maxRoomSwitches: 3,
        groupContiguous: true,
        flagThreshold: 3,
      },
    },
  ];

  /**
   * Get workflow optimization rules
   * First tries to fetch from GHL Custom Fields, falls back to defaults
   */
  async getRules(locationId: string, apiKey: string): Promise<WorkflowOptimizationRule[]> {
    const cacheKey = `${this.CACHE_KEY_PREFIX}${locationId}`;
    
    return cacheService.getOrFetch(
      cacheKey,
      async () => this.fetchRulesFromGHL(locationId, apiKey),
      this.CACHE_TTL
    );
  }

  /**
   * Fetch rules from GHL Custom Fields
   * Rules are stored as JSON in a custom field named 'workflow_optimization_rules'
   */
  private async fetchRulesFromGHL(locationId: string, apiKey: string): Promise<WorkflowOptimizationRule[]> {
    try {
      // Try to fetch custom fields from GHL
      const response = await axios.get(
        `https://services.leadconnectorhq.com/locations/${locationId}/customFields`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Version': '2021-07-28',
          },
        }
      );

      const customFields = response.data?.customFields || [];
      
      // Look for workflow rules custom field
      const rulesField = customFields.find(
        (field: any) => field.key === 'workflow_optimization_rules' || field.name === 'Workflow Optimization Rules'
      );

      if (rulesField?.value) {
        try {
          const parsedRules = JSON.parse(rulesField.value);
          if (Array.isArray(parsedRules) && parsedRules.length > 0) {
            logger.info(`Loaded ${parsedRules.length} workflow rules from GHL custom fields`);
            return this.validateAndMergeRules(parsedRules);
          }
        } catch (parseError) {
          logger.warn('Failed to parse workflow rules from custom field:', parseError);
        }
      }

      // If no custom field found, try to create it with default rules
      logger.info('No workflow rules custom field found, using defaults');
      await this.createRulesCustomField(locationId, apiKey);
      
      return this.DEFAULT_RULES;
    } catch (error) {
      logger.warn('Failed to fetch rules from GHL, using defaults:', error);
      return this.DEFAULT_RULES;
    }
  }

  /**
   * Create the workflow rules custom field in GHL if it doesn't exist
   */
  private async createRulesCustomField(locationId: string, apiKey: string): Promise<void> {
    try {
      await axios.post(
        `https://services.leadconnectorhq.com/locations/${locationId}/customFields`,
        {
          name: 'Workflow Optimization Rules',
          key: 'workflow_optimization_rules',
          dataType: 'TEXT',
          placeholder: 'JSON configuration for workflow optimization rules',
          value: JSON.stringify(this.DEFAULT_RULES),
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Version': '2021-07-28',
            'Content-Type': 'application/json',
          },
        }
      );
      logger.info('Created workflow rules custom field in GHL');
    } catch (error) {
      logger.warn('Failed to create workflow rules custom field:', error);
    }
  }

  /**
   * Update workflow rules in GHL Custom Fields
   */
  async updateRules(
    locationId: string,
    apiKey: string,
    rules: WorkflowOptimizationRule[]
  ): Promise<WorkflowOptimizationRule[]> {
    try {
      // Validate rules before saving
      const validatedRules = this.validateAndMergeRules(rules);
      
      // Update in GHL
      await axios.put(
        `https://services.leadconnectorhq.com/locations/${locationId}/customFields/workflow_optimization_rules`,
        {
          value: JSON.stringify(validatedRules),
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Version': '2021-07-28',
            'Content-Type': 'application/json',
          },
        }
      );

      // Invalidate cache
      const cacheKey = `${this.CACHE_KEY_PREFIX}${locationId}`;
      await cacheService.delete(cacheKey);

      logger.info(`Updated ${validatedRules.length} workflow rules in GHL`);
      return validatedRules;
    } catch (error) {
      logger.error('Failed to update workflow rules:', error);
      throw new Error('Failed to update workflow rules');
    }
  }

  /**
   * Validate and merge rules with defaults
   * Ensures all required fields are present
   */
  private validateAndMergeRules(rules: any[]): WorkflowOptimizationRule[] {
    const validRules: WorkflowOptimizationRule[] = [];
    const seenIds = new Set<string>();

    for (const rule of rules) {
      // Skip duplicates
      if (seenIds.has(rule.id)) continue;
      seenIds.add(rule.id);

      // Find default rule for merging
      const defaultRule = this.DEFAULT_RULES.find(r => r.id === rule.id);
      
      if (defaultRule) {
        validRules.push({
          ...defaultRule,
          ...rule,
          config: {
            ...defaultRule.config,
            ...(rule.config || {}),
          },
        });
      } else {
        // Validate custom rule has required fields
        if (rule.id && rule.type && rule.name) {
          validRules.push({
            id: rule.id,
            type: rule.type,
            name: rule.name,
            description: rule.description || '',
            isActive: rule.isActive ?? true,
            priority: rule.priority || 99,
            config: rule.config || {},
          });
        }
      }
    }

    // Sort by priority
    return validRules.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get active rules only
   */
  async getActiveRules(locationId: string, apiKey: string): Promise<WorkflowOptimizationRule[]> {
    const rules = await this.getRules(locationId, apiKey);
    return rules.filter(r => r.isActive);
  }

  /**
   * Get rule by ID
   */
  async getRuleById(locationId: string, apiKey: string, ruleId: string): Promise<WorkflowOptimizationRule | null> {
    const rules = await this.getRules(locationId, apiKey);
    return rules.find(r => r.id === ruleId) || null;
  }

  /**
   * Toggle rule active state
   */
  async toggleRule(locationId: string, apiKey: string, ruleId: string): Promise<WorkflowOptimizationRule> {
    const rules = await this.getRules(locationId, apiKey);
    const ruleIndex = rules.findIndex(r => r.id === ruleId);
    
    if (ruleIndex === -1) {
      throw new Error(`Rule not found: ${ruleId}`);
    }

    rules[ruleIndex].isActive = !rules[ruleIndex].isActive;
    await this.updateRules(locationId, apiKey, rules);
    
    return rules[ruleIndex];
  }

  /**
   * Clear cache for a location
   */
  async clearCache(locationId: string): Promise<void> {
    const cacheKey = `${this.CACHE_KEY_PREFIX}${locationId}`;
    await cacheService.delete(cacheKey);
    logger.info(`Cleared workflow rules cache for location: ${locationId}`);
  }
}

// Export singleton instance
export const workflowRulesService = new WorkflowRulesService();
