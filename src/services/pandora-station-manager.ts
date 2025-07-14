import type { SonosDiscovery } from '../discovery.js';
import { scheduler } from '../utils/scheduler.js';
import logger from '../utils/logger.js';
import { PandoraAPIService } from './pandora-api-service.js';
import type { Config } from '../types/sonos.js';

interface MergedStation {
  stationId: string;
  stationName: string;
  uri?: string;
  metadata?: string;
  source: 'favorite' | 'api' | 'both';
  sessionNumber?: number;
  flags?: string;
}

/**
 * Manages a merged list of Pandora stations from favorites and API cache.
 * This is the single source of truth for station lookups.
 */
export class PandoraStationManager {
  private static instance: PandoraStationManager;
  private mergedStations: Map<string, MergedStation> = new Map();
  private config: Config;
  private discovery?: SonosDiscovery;
  private isInitialized = false;

  private constructor(config: Config) {
    this.config = config;
  }

  static getInstance(config: Config): PandoraStationManager {
    if (!PandoraStationManager.instance) {
      PandoraStationManager.instance = new PandoraStationManager(config);
    }
    return PandoraStationManager.instance;
  }

  /**
   * Initialize the station manager and start background refresh tasks
   */
  async initialize(discovery: SonosDiscovery): Promise<void> {
    if (this.isInitialized) return;
    
    logger.info('[PandoraStationManager] Initializing...');
    this.discovery = discovery;
    
    // Initial load
    await this.refreshAll(discovery);
    
    // Schedule favorites refresh every 5 minutes
    scheduler.scheduleInterval(
      'pandora-favorites-refresh',
      async () => {
        logger.debug('[PandoraStationManager] Running scheduled favorites refresh');
        await this.refreshFavorites(discovery);
      },
      5 * 60 * 1000
    );
    
    // Schedule API cache refresh every 24 hours
    scheduler.scheduleInterval(
      'pandora-api-refresh',
      async () => {
        logger.debug('[PandoraStationManager] Running scheduled API cache refresh');
        await this.refreshApiCache();
      },
      24 * 60 * 60 * 1000
    );
    
    this.isInitialized = true;
    logger.info(`[PandoraStationManager] Initialized with ${this.mergedStations.size} stations`);
  }

  /**
   * Get a station by name (case-insensitive fuzzy search)
   */
  findStation(stationName: string): MergedStation | null {
    const lowerName = stationName.toLowerCase().trim();
    
    // First try exact match
    for (const station of this.mergedStations.values()) {
      if (station.stationName.toLowerCase() === lowerName) {
        logger.debug(`[PandoraStationManager] Found exact match: ${station.stationName}`);
        return station;
      }
    }
    
    // Then try starts with
    for (const station of this.mergedStations.values()) {
      if (station.stationName.toLowerCase().startsWith(lowerName)) {
        logger.debug(`[PandoraStationManager] Found starts-with match: ${station.stationName}`);
        return station;
      }
    }
    
    // Then try contains
    for (const station of this.mergedStations.values()) {
      if (station.stationName.toLowerCase().includes(lowerName)) {
        logger.debug(`[PandoraStationManager] Found contains match: ${station.stationName}`);
        return station;
      }
    }
    
    // Finally try word boundary match
    for (const station of this.mergedStations.values()) {
      const words = station.stationName.toLowerCase().split(/\s+/);
      if (words.some(word => word.startsWith(lowerName))) {
        logger.debug(`[PandoraStationManager] Found word match: ${station.stationName}`);
        return station;
      }
    }
    
    logger.debug(`[PandoraStationManager] No match found for: ${stationName}`);
    return null;
  }

  /**
   * Get all stations (for listing)
   */
  getAllStations(): MergedStation[] {
    return Array.from(this.mergedStations.values()).sort((a, b) => 
      a.stationName.localeCompare(b.stationName)
    );
  }

  /**
   * Refresh everything (favorites + API cache)
   */
  private async refreshAll(discovery: SonosDiscovery): Promise<void> {
    logger.info('[PandoraStationManager] Refreshing all stations...');
    
    // Clear existing stations
    this.mergedStations.clear();
    
    // Load from API cache first
    await this.loadApiCache();
    
    // Then overlay favorites (which take precedence)
    await this.refreshFavorites(discovery);
    
    logger.info(`[PandoraStationManager] Loaded ${this.mergedStations.size} total stations`);
  }

  /**
   * Load stations from API cache file
   */
  private async loadApiCache(): Promise<void> {
    try {
      const pandoraService = PandoraAPIService.getInstance(this.config);
      const api = pandoraService.getAPI();
      
      if (!api) {
        logger.debug('[PandoraStationManager] No Pandora API configured, skipping cache load');
        return;
      }
      
      // Force load from cache file
      await api.getStationList(true, false); // includeArt=true, forceRefresh=false
      
      // Get the cached stations
      const { stations } = await api.getStationList(true, false);
      
      logger.info(`[PandoraStationManager] Loaded ${stations.length} stations from API cache`);
      
      // Add to merged list
      for (const station of stations) {
        this.mergedStations.set(station.stationId, {
          stationId: station.stationId,
          stationName: station.stationName,
          source: 'api'
        });
      }
    } catch (error) {
      logger.error('[PandoraStationManager] Failed to load API cache:', error instanceof Error ? error.message : String(error));
      logger.debug('[PandoraStationManager] Full error:', error);
    }
  }

  /**
   * Refresh favorites from Sonos devices
   */
  private async refreshFavorites(discovery: SonosDiscovery): Promise<void> {
    try {
      logger.debug('[PandoraStationManager] Refreshing favorites...');
      
      // Get any available device
      const topology = discovery.getTopology();
      if (!topology || topology.zones.length === 0) {
        logger.warn('[PandoraStationManager] No devices available for favorites refresh');
        return;
      }
      
      // Get first available device
      const firstZone = topology.zones[0];
      if (!firstZone) {
        logger.warn('[PandoraStationManager] No zones found in topology');
        return;
      }
      
      const device = discovery.getDevice(firstZone.coordinator.roomName);
      if (!device) {
        logger.warn('[PandoraStationManager] Could not get device for favorites refresh');
        return;
      }
      
      // Browse for Pandora favorites using browseRaw
      const response = await device.browseRaw('FV:2', 'BrowseDirectChildren', '*', 0, 100, '');
      
      if (!response?.Result) {
        logger.warn('[PandoraStationManager] No browse result received');
        return;
      }
      
      // Parse the DIDL-Lite XML
      const { parseXML } = await import('../utils/xml.js');
      
      interface DIDLItem {
        id?: string;
        res?: string;
        'dc:title'?: string;
        'r:resMD'?: string;
      }
      
      interface DIDLLite {
        'DIDL-Lite'?: {
          item?: DIDLItem | DIDLItem[];
        };
      }
      
      const didlLite = parseXML(response.Result) as DIDLLite;
      if (!didlLite?.['DIDL-Lite']?.item) {
        logger.warn('[PandoraStationManager] No items found in favorites');
        return;
      }
      
      const items = Array.isArray(didlLite['DIDL-Lite'].item) 
        ? didlLite['DIDL-Lite'].item 
        : [didlLite['DIDL-Lite'].item];
      
      let pandoraCount = 0;
      for (const item of items) {
        // res might be an object with _text property
        const uri = typeof item.res === 'string' ? item.res : item.res?.['_text'];
        const title = typeof item['dc:title'] === 'string' ? item['dc:title'] : item['dc:title']?.['_text'];
        
        // Only process Pandora stations
        if (!uri || typeof uri !== 'string' || !uri.includes('sid=236')) continue;
        
        // Extract station ID from URI
        const stationMatch = uri.match(/ST%3a([^?]+)/i);
        if (!stationMatch) continue;
        
        const stationId = decodeURIComponent(stationMatch[1]!);
        const existing = this.mergedStations.get(stationId);
        
        // Extract session number and flags from URI
        let sessionNumber: number | undefined;
        let flags: string | undefined;
        
        const snMatch = uri.match(/sn=(\d+)/);
        if (snMatch && snMatch[1]) sessionNumber = parseInt(snMatch[1]);
        
        const flagsMatch = uri.match(/flags=(\d+)/);
        if (flagsMatch && flagsMatch[1]) flags = flagsMatch[1];
        
        this.mergedStations.set(stationId, {
          stationId,
          stationName: title || 'Unknown Station',
          uri,
          metadata: item['r:resMD'],
          source: existing ? 'both' : 'favorite',
          sessionNumber,
          flags
        });
        
        pandoraCount++;
      }
      
      logger.info(`[PandoraStationManager] Found ${pandoraCount} Pandora favorites, merged list now has ${this.mergedStations.size} total stations`);
      
    } catch (error) {
      logger.error('[PandoraStationManager] Failed to refresh favorites:', error);
    }
  }

  /**
   * Refresh API cache (if not in backoff)
   */
  private async refreshApiCache(): Promise<void> {
    try {
      const pandoraService = PandoraAPIService.getInstance(this.config);
      const api = pandoraService.getAPI();
      
      if (!api) {
        logger.debug('[PandoraStationManager] No Pandora API configured');
        return;
      }
      
      // Check if in backoff
      if (api.isInBackoff()) {
        const remaining = api.getBackoffRemaining();
        logger.info(`[PandoraStationManager] API in backoff for ${remaining} more hours`);
        return;
      }
      
      logger.info('[PandoraStationManager] Refreshing API station cache...');
      
      // Force refresh from API
      await api.login();
      const { stations } = await api.getStationList(true, true); // includeArt=true, forceRefresh=true
      
      logger.info(`[PandoraStationManager] Refreshed ${stations.length} stations from API`);
      
      // Reload everything to merge properly
      if (this.discovery) {
        await this.refreshAll(this.discovery);
      }
      
    } catch (error) {
      logger.error('[PandoraStationManager] Failed to refresh API cache:', error);
    }
  }

  /**
   * Get station statistics
   */
  getStats(): { total: number; favorites: number; apiOnly: number; both: number } {
    let favorites = 0;
    let apiOnly = 0;
    let both = 0;
    
    for (const station of this.mergedStations.values()) {
      switch (station.source) {
      case 'favorite': favorites++; break;
      case 'api': apiOnly++; break;
      case 'both': both++; break;
      }
    }
    
    return {
      total: this.mergedStations.size,
      favorites,
      apiOnly,
      both
    };
  }
}