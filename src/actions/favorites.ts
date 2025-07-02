import type { SonosDevice } from '../sonos-device.js';
import logger from '../utils/logger.js';
import { debugManager } from '../utils/debug-manager.js';

export interface SonosFavorite {
  title: string;
  uri: string;
  metadata: string;
}

export class FavoritesManager {
  private favoritesCache = new Map<string, SonosFavorite[]>();
  private cacheExpiry = new Map<string, number>();
  private readonly CACHE_DURATION = 300000; // 5 minutes

  async getFavorites(device: SonosDevice): Promise<SonosFavorite[]> {
    const deviceId = device.id;
    const now = Date.now();
    
    // Check cache
    const cached = this.favoritesCache.get(deviceId);
    const expiry = this.cacheExpiry.get(deviceId) || 0;
    
    if (cached && now < expiry) {
      return cached;
    }

    try {
      debugManager.debug('favorites', `Fetching favorites for device ${device.roomName}`);
      
      // Get favorites from Sonos device
      const result = await device.browseRaw('FV:2', 'BrowseDirectChildren', '*', 0, 200);

      const favorites = await this.parseFavoritesResponse(result);
      
      // Cache the results
      this.favoritesCache.set(deviceId, favorites);
      this.cacheExpiry.set(deviceId, now + this.CACHE_DURATION);
      
      debugManager.debug('favorites', `Loaded ${favorites.length} favorites for ${device.roomName}`);
      return favorites;
      
    } catch (error) {
      debugManager.error('favorites', `Error fetching favorites for ${device.roomName}:`, error);
      return [];
    }
  }

  async findFavoriteByName(device: SonosDevice, favoriteName: string): Promise<SonosFavorite | null> {
    const favorites = await this.getFavorites(device);
    
    // Exact match only (case-insensitive)
    const found = favorites.find(fav => 
      fav.title.toLowerCase() === favoriteName.toLowerCase()
    );
    
    if (found) {
      debugManager.debug('favorites', `Found favorite: "${favoriteName}" -> "${found.title}"`);
    } else {
      debugManager.warn('favorites', `Favorite not found: "${favoriteName}"`);
      // Log available favorites to help debugging
      const availableFavorites = favorites.map(f => f.title).sort();
      debugManager.debug('favorites', `Available favorites: ${availableFavorites.join(', ')}`);
    }
    
    return found || null;
  }

  private async parseFavoritesResponse(response: { Result?: string }): Promise<SonosFavorite[]> {
    const favorites: SonosFavorite[] = [];
    
    try {
      if (!response.Result) {
        return favorites;
      }

      const { XMLParser } = await import('fast-xml-parser');
      const parser = new XMLParser({
        ignoreAttributes: false,
        parseAttributeValue: false,
        trimValues: true
      });

      const parsed = parser.parse(response.Result);
      const didlLite = parsed['DIDL-Lite'];
      
      if (!didlLite) {
        return favorites;
      }

      const items = Array.isArray(didlLite.item) ? didlLite.item : [didlLite.item].filter(Boolean);

      for (const item of items) {
        if (item && item['dc:title'] && item.res) {
          // Extract individual item metadata instead of storing the entire response
          const itemMetadata = item['r:resMD'] || '';
          
          favorites.push({
            title: item['dc:title'],
            uri: item.res['#text'] || item.res,
            metadata: itemMetadata // Store the specific favorite's metadata, not the entire response
          });
        }
      }
      
    } catch (error) {
      logger.error('Error parsing favorites response:', error);
    }

    return favorites;
  }

  clearCache(): void {
    this.favoritesCache.clear();
    this.cacheExpiry.clear();
  }
}