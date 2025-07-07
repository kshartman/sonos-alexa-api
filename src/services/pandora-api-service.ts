import { PandoraAPI } from './pandora-api.js';
import type { Config } from '../types/sonos.js';
import logger from '../utils/logger.js';

/**
 * Singleton service for managing PandoraAPI instances
 * Ensures API results are cached properly across requests
 */
export class PandoraAPIService {
  private static instance: PandoraAPIService;
  private apiInstance: PandoraAPI | null = null;
  private config: Config;
  
  private constructor(config: Config) {
    this.config = config;
  }
  
  static getInstance(config: Config): PandoraAPIService {
    if (!PandoraAPIService.instance) {
      PandoraAPIService.instance = new PandoraAPIService(config);
    }
    return PandoraAPIService.instance;
  }
  
  /**
   * Get or create the PandoraAPI instance
   * Returns null if credentials are not configured
   */
  getAPI(): PandoraAPI | null {
    if (!this.config.pandora?.username || !this.config.pandora?.password) {
      return null;
    }
    
    if (!this.apiInstance) {
      logger.debug('Creating new PandoraAPI instance');
      this.apiInstance = new PandoraAPI(
        this.config.pandora.username, 
        this.config.pandora.password
      );
    }
    
    return this.apiInstance;
  }
  
  /**
   * Clear the cached API instance (useful if credentials change)
   */
  clearCache(): void {
    logger.debug('Clearing PandoraAPI instance cache');
    this.apiInstance = null;
  }
}