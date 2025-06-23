import type { SonosDevice } from '../sonos-device.js';
import logger from '../utils/logger.js';
import { ServiceAccount } from './music-service.js';

export class AccountService {
  private accountCache = new Map<string, ServiceAccount>();

  /**
   * Get account information for a music service from Sonos device
   */
  async getServiceAccount(device: SonosDevice, serviceName: string): Promise<ServiceAccount | null> {
    const cacheKey = `${device.id}-${serviceName}`;
    
    // Check cache first
    if (this.accountCache.has(cacheKey)) {
      return this.accountCache.get(cacheKey)!;
    }

    try {
      const accountsUrl = `${device.baseUrl}/status/accounts`;
      logger.info(`Getting accounts from: ${accountsUrl}`);

      const response = await fetch(accountsUrl);
      if (!response.ok) {
        logger.error(`Failed to get accounts: ${response.status}`);
        return null;
      }

      const accountsXml = await response.text();
      logger.info(`Accounts XML length: ${accountsXml.length}`);
      logger.info(`Accounts XML: ${accountsXml}`);

      const account = this.parseServiceAccount(accountsXml, serviceName);
      
      if (account) {
        // Cache the result
        this.accountCache.set(cacheKey, account);
        logger.debug(`Found account for ${serviceName}: ID=${account.id}, SN=${account.serialNumber}`);
      } else {
        logger.warn(`No account found for service: ${serviceName}`);
        
        // For Apple Music, try to create a default account since it may not require explicit credentials
        if (serviceName.toLowerCase() === 'apple') {
          logger.info('Creating default Apple Music account (may work without explicit credentials)');
          const defaultAccount = {
            id: '52231', // Default Apple Music SID
            serialNumber: '1', // Default serial number
            sid: '52231'
          };
          this.accountCache.set(cacheKey, defaultAccount);
          return defaultAccount;
        }
      }

      return account;
    } catch (error) {
      logger.error(`Error getting service account for ${serviceName}:`, error);
      return null;
    }
  }

  /**
   * Parse service account from Sonos accounts XML
   */
  private parseServiceAccount(accountsXml: string, serviceName: string): ServiceAccount | null {
    try {
      // Look for the service type in the XML
      const serviceTypes: Record<string, string> = {
        'apple': 'SA_RINCON52231_',
        'spotify': 'SA_RINCON2311_',
        'amazon': 'SA_RINCON3079_',
        'pandora': 'SA_RINCON2',
        'deezer': 'SA_RINCON2822_',
        'tunein': 'SA_RINCON65031_',
        'siriusxm': 'SA_RINCON3283_'
      };

      const serviceType = serviceTypes[serviceName.toLowerCase()];
      if (!serviceType) {
        logger.warn(`Unknown service type for: ${serviceName}`);
        return null;
      }

      // Find the service in the XML
      const serviceIndex = accountsXml.indexOf(serviceType);
      if (serviceIndex === -1) {
        logger.debug(`Service ${serviceName} not found in accounts`);
        return null;
      }

      // Extract account ID (UN field)
      const unStart = accountsXml.indexOf('<UN>', serviceIndex);
      const unEnd = accountsXml.indexOf('</UN>', unStart);
      if (unStart === -1 || unEnd === -1) {
        logger.warn(`Could not find UN field for ${serviceName}`);
        return null;
      }
      const accountId = accountsXml.substring(unStart + 4, unEnd);

      // Extract serial number
      const snStart = accountsXml.indexOf('SerialNum="', serviceIndex);
      const snValueStart = snStart + 11;
      const snEnd = accountsXml.indexOf('"', snValueStart);
      if (snStart === -1 || snEnd === -1) {
        logger.warn(`Could not find SerialNum for ${serviceName}`);
        return null;
      }
      const serialNumber = accountsXml.substring(snValueStart, snEnd);

      // Extract service ID (SID)
      const sidMatch = serviceType.match(/SA_RINCON(\d+)_/);
      const sid = sidMatch ? sidMatch[1] : '52231'; // Default Apple Music SID

      return {
        id: accountId,
        serialNumber,
        sid: sid || '52231'
      };
    } catch (error) {
      logger.error(`Error parsing service account for ${serviceName}:`, error);
      return null;
    }
  }

  /**
   * Clear account cache
   */
  clearCache(): void {
    this.accountCache.clear();
  }

  /**
   * Get all cached accounts (for debugging)
   */
  getCachedAccounts(): Array<{service: string, account: ServiceAccount}> {
    const results: Array<{service: string, account: ServiceAccount}> = [];
    for (const [key, account] of this.accountCache.entries()) {
      const servicePart = key.split('-')[1];
      if (!servicePart) continue;
      results.push({ service: servicePart, account });
    }
    return results;
  }
}