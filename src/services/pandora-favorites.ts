import logger from '../utils/logger.js';
import type { SonosDevice } from '../sonos-device.js';
import { parseXML } from '../utils/xml.js';

interface PandoraFavorite {
  id: string;
  title: string;
  uri: string;
  metadata: string;
  stationId: string;
  sessionNumber: string;
}

interface DIDLLite {
  'DIDL-Lite'?: {
    item?: any | any[];
  };
}

// Cache for discovered stations
interface StationCache {
  stations: Map<string, PandoraFavorite>;
  lastRefresh: number;
  sessionNumber: string;
}

export class PandoraFavoritesBrowser {
  private static cache: StationCache | null = null;
  private static readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour
  
  /**
   * Add a discovered station to the cache
   */
  static addToCache(stationId: string, title: string, uri: string, metadata: string = ''): void {
    if (!this.cache) {
      // Initialize cache if not exists
      this.cache = {
        stations: new Map(),
        lastRefresh: Date.now(),
        sessionNumber: '1'
      };
    }
    
    // Extract session number from URI
    const snMatch = uri.match(/sn=(\d+)/);
    const sessionNumber = snMatch ? snMatch[1] : this.cache.sessionNumber;
    
    const favorite: PandoraFavorite = {
      id: `discovered_${stationId}`,
      title,
      uri,
      metadata,
      stationId,
      sessionNumber: sessionNumber || '1'
    };
    
    // Only add if not already in cache or if this has a higher session number
    const existing = this.cache.stations.get(stationId);
    if (!existing || parseInt(sessionNumber || '1') >= parseInt(existing.sessionNumber)) {
      this.cache.stations.set(stationId, favorite);
      logger.info(`Added discovered station to cache: ${title} (${stationId}, SN=${sessionNumber})`);
    }
  }
  /**
   * Browse Pandora favorites in FV:2 container
   */
  static async browsePandoraFavorites(device: SonosDevice, forceRefresh: boolean = false): Promise<PandoraFavorite[]> {
    // Check cache first
    if (!forceRefresh && this.cache && (Date.now() - this.cache.lastRefresh) < this.CACHE_TTL) {
      logger.debug('Using cached Pandora stations');
      return Array.from(this.cache.stations.values());
    }
    
    try {
      logger.debug('Browsing favorites container FV:2 for Pandora stations');
      
      const response = await device.browseRaw('FV:2', 'BrowseDirectChildren', '*', 0, 100, '');
      
      if (!response?.Result) {
        logger.warn('No browse result received');
        return [];
      }
      
      const result = response.Result;
      const didlLite = parseXML<DIDLLite>(result) as DIDLLite;
      if (!didlLite?.['DIDL-Lite']?.item) {
        logger.warn('No items found in favorites');
        return [];
      }
      
      const items = Array.isArray(didlLite['DIDL-Lite'].item) 
        ? didlLite['DIDL-Lite'].item 
        : [didlLite['DIDL-Lite'].item];
      
      const pandoraFavorites: PandoraFavorite[] = [];
      
      for (const item of items) {
        // Check if this is a Pandora favorite
        // Handle both string and object res values
        let res = '';
        if (typeof item.res === 'string') {
          res = item.res;
        } else if (item.res?._text) {
          res = item.res._text;
        }
        
        if (res.includes('sid=236') && res.includes('x-sonosapi-radio:')) {
          // Handle both string and object title values
          let title = 'Unknown';
          if (typeof item['dc:title'] === 'string') {
            title = item['dc:title'];
          } else if (item['dc:title']?._text) {
            title = item['dc:title']._text;
          }
          
          // Handle both string and object resMD values
          let resMD = '';
          if (typeof item['r:resMD'] === 'string') {
            resMD = item['r:resMD'];
          } else if (item['r:resMD']?._text) {
            resMD = item['r:resMD']._text;
          }
          
          // Extract station ID and session number from URI
          const stationMatch = res.match(/ST[:%]3a([^?&]+)/i);
          const snMatch = res.match(/sn=(\d+)/);
          
          if (stationMatch && stationMatch[1]) {
            const stationId = decodeURIComponent(stationMatch[1]);
            const sessionNumber = snMatch ? snMatch[1] : '1';
            
            // Parse the embedded metadata
            let metadata = '';
            if (resMD) {
              const decodedMD = resMD.replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, '\'');
              metadata = decodedMD;
            }
            
            pandoraFavorites.push({
              id: item._attr_id || item.id || '',
              title,
              uri: res.replace(/&amp;/g, '&'),
              metadata,
              stationId,
              sessionNumber: sessionNumber || '1'
            });
          }
        }
      }
      
      // Update cache
      let highestSessionNumber = '1';
      for (const fav of pandoraFavorites) {
        if (parseInt(fav.sessionNumber) > parseInt(highestSessionNumber)) {
          highestSessionNumber = fav.sessionNumber;
        }
      }
      
      this.cache = {
        stations: new Map(pandoraFavorites.map(f => [f.stationId, f])),
        lastRefresh: Date.now(),
        sessionNumber: highestSessionNumber
      };
      
      logger.info(`Found ${pandoraFavorites.length} Pandora favorites, cached with session number ${highestSessionNumber}`);
      return pandoraFavorites;
      
    } catch (error) {
      logger.error('Error browsing Pandora favorites:', error);
      // Return cached data if available
      if (this.cache) {
        logger.warn('Returning cached data due to browse error');
        return Array.from(this.cache.stations.values());
      }
      return [];
    }
  }
  
  /**
   * Find a Pandora station by name in favorites
   */
  static async findStationInFavorites(device: SonosDevice, stationName: string): Promise<PandoraFavorite | null> {
    const favorites = await this.browsePandoraFavorites(device);
    
    if (favorites.length === 0) {
      logger.warn('No Pandora favorites found');
      return null;
    }
    
    // Group favorites by station ID
    const stationGroups = new Map<string, PandoraFavorite[]>();
    for (const favorite of favorites) {
      const existing = stationGroups.get(favorite.stationId) || [];
      existing.push(favorite);
      stationGroups.set(favorite.stationId, existing);
    }
    
    // Log if we find duplicate stations with different session numbers
    for (const [, favs] of stationGroups) {
      if (favs.length > 1) {
        const sessions = [...new Set(favs.map(f => f.sessionNumber))].sort((a, b) => parseInt(b) - parseInt(a));
        logger.debug(`Station "${favs[0]!.title}" found with multiple session numbers: ${sessions.join(', ')}`);
      }
    }
    
    const lowerName = stationName.toLowerCase();
    
    // Find all matching favorites
    const matches: PandoraFavorite[] = [];
    
    // Try exact match first
    matches.push(...favorites.filter(f => f.title.toLowerCase() === lowerName));
    
    // Try starts with
    if (matches.length === 0) {
      matches.push(...favorites.filter(f => f.title.toLowerCase().startsWith(lowerName)));
    }
    
    // Try contains
    if (matches.length === 0) {
      matches.push(...favorites.filter(f => f.title.toLowerCase().includes(lowerName)));
    }
    
    // Try word boundary match
    if (matches.length === 0) {
      matches.push(...favorites.filter(f => 
        f.title.toLowerCase().split(/\s+/).some(word => word.startsWith(lowerName))
      ));
    }
    
    if (matches.length > 0) {
      // If multiple matches with same station ID, prefer the one with highest session number
      const match = matches.reduce((best, current) => {
        const bestSN = parseInt(best.sessionNumber);
        const currentSN = parseInt(current.sessionNumber);
        return currentSN > bestSN ? current : best;
      });
      
      logger.info(`Found Pandora station '${match.title}' in favorites (SN=${match.sessionNumber})`);
      
      // Warn if using an older session number
      const highestSN = Math.max(...favorites.map(f => parseInt(f.sessionNumber)));
      if (parseInt(match.sessionNumber) < highestSN) {
        logger.warn(`Using station from older session (SN=${match.sessionNumber}), current session is SN=${highestSN}`);
      }
      
      return match;
    }
    
    logger.warn(`No Pandora favorite found matching '${stationName}'`);
    return null;
  }
  
  /**
   * Get all unique Pandora stations (deduped by station ID, keeping highest session number)
   */
  static async getUniqueStations(device: SonosDevice): Promise<PandoraFavorite[]> {
    const favorites = await this.browsePandoraFavorites(device);
    
    // Merge with cached stations
    const allStations: PandoraFavorite[] = [...favorites];
    if (this.cache) {
      for (const [stationId, cachedStation] of this.cache.stations) {
        // Only add cached stations that aren't in favorites
        if (!favorites.some(f => f.stationId === stationId)) {
          allStations.push(cachedStation);
        }
      }
    }
    
    if (allStations.length === 0) {
      return [];
    }
    
    // Group by station ID
    const stationGroups = new Map<string, PandoraFavorite[]>();
    for (const favorite of allStations) {
      const existing = stationGroups.get(favorite.stationId) || [];
      existing.push(favorite);
      stationGroups.set(favorite.stationId, existing);
    }
    
    // For each station ID, keep the one with highest session number
    const uniqueStations: PandoraFavorite[] = [];
    for (const [, favs] of stationGroups) {
      const bestFavorite = favs.reduce((best, current) => {
        const bestSN = parseInt(best.sessionNumber);
        const currentSN = parseInt(current.sessionNumber);
        return currentSN > bestSN ? current : best;
      });
      uniqueStations.push(bestFavorite);
    }
    
    // Sort by title for consistent ordering
    uniqueStations.sort((a, b) => a.title.localeCompare(b.title));
    
    return uniqueStations;
  }
}