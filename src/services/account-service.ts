import type { SonosDevice } from '../sonos-device.js';
import logger from '../utils/logger.js';
import { ServiceAccount } from './music-service.js';
import type { ServicesCache } from '../utils/services-cache.js';

interface SpotifyExtractedValues {
  sn: string;
  sid: string;
  albumPrefix: string;
  playlistPrefix: string;
  accountId: string;
}

export class AccountService {
  private accountCache = new Map<string, ServiceAccount>();
  private servicesCache?: ServicesCache;
  // Per-account Spotify cache - keyed by accountId
  private spotifyPrefixCache = new Map<string, SpotifyExtractedValues>();
  
  // Default values for services when not found via S2 methods
  private readonly DEFAULT_APPLE_SID = '52231';
  private readonly DEFAULT_SPOTIFY_ALBUM_PREFIX = '1004006c';
  private readonly DEFAULT_SPOTIFY_PLAYLIST_PREFIX = '1006286c';
  private readonly DEFAULT_SERIAL_NUMBER = '1';

  constructor(servicesCache?: ServicesCache) {
    this.servicesCache = servicesCache;
  }
  
  /**
   * Clear the Spotify cache to force re-extraction
   * @param accountId - Optional specific account to clear
   */
  clearSpotifyCache(accountId?: string): void {
    if (accountId) {
      this.spotifyPrefixCache.delete(accountId);
      logger.debug(`Cleared Spotify cache for account: ${accountId}`);
    } else {
      this.spotifyPrefixCache.clear();
      logger.debug('Cleared all Spotify extraction cache');
    }
  }

  /**
   * Get account information for a music service from Sonos device
   * @param device - The Sonos device to query
   * @param serviceName - The service name (e.g., 'spotify', 'apple')
   * @param accountId - Optional account ID for services with multiple accounts
   * @param forceRefresh - Force refresh the cache
   */
  async getServiceAccount(device: SonosDevice, serviceName: string, accountId?: string, forceRefresh = false): Promise<ServiceAccount | null> {
    const cacheKey = accountId ? `${device.id}-${serviceName}-${accountId}` : `${device.id}-${serviceName}`;
    
    // Check cache first unless force refresh
    if (!forceRefresh && this.accountCache.has(cacheKey)) {
      return this.accountCache.get(cacheKey)!;
    }

    try {
      // Note: /status/accounts and Status:ListAccounts are not supported on S2 systems
      // We extract account info from favorites instead
      logger.debug(`Account extraction from /status/accounts not supported on S2 - using favorites`);
      
      // Always use fallback logic for S2 systems
      logger.debug(`Using fallback logic for service: ${serviceName}`);
      
      // For known services, try to create a default account
      if (serviceName.toLowerCase() === 'apple') {
        logger.info('Creating default Apple Music account (may work without explicit credentials)');
        const defaultAccount = {
          id: this.DEFAULT_APPLE_SID,
          serialNumber: this.DEFAULT_SERIAL_NUMBER,
          sid: this.DEFAULT_APPLE_SID
        };
        this.accountCache.set(cacheKey, defaultAccount);
        return defaultAccount;
      }
      
      if (serviceName.toLowerCase() === 'spotify') {
        // For Spotify, we need to use values from the services list since accounts XML is empty
        if (!this.servicesCache) {
          throw new Error('Services cache not available for Spotify account creation');
        }
        
        // Get the actual service info from the services list
        const services = await this.servicesCache.getServices();
        const spotifyService = Object.values(services).find(s => s.name.toLowerCase() === 'spotify');
        
        if (!spotifyService) {
          throw new Error('Spotify service not found in Sonos system. Please add Spotify in the Sonos app.');
        }
        
        // Try to extract values from Spotify favorites if available
        let extractedAccounts: Record<string, SpotifyExtractedValues> = {};
        logger.debug('Getting Spotify account info...');
        extractedAccounts = await this.getSpotifyAccountInfo(device);
        
        // If accountId specified, try to find that specific account
        let selectedAccount: SpotifyExtractedValues | null = null;
        logger.debug(`Extracted accounts: ${JSON.stringify(Object.keys(extractedAccounts))}`);
        if (accountId && extractedAccounts[accountId]) {
          selectedAccount = extractedAccounts[accountId];
          logger.info(`Using specific Spotify account: ${accountId}`);
        } else if (Object.keys(extractedAccounts).length > 0) {
          // Otherwise use the first account found (or 'default' if that's all we have)
          const firstKey = Object.keys(extractedAccounts)[0];
          if (firstKey && extractedAccounts[firstKey]) {
            selectedAccount = extractedAccounts[firstKey];
          }
          logger.info(`Using Spotify account: ${selectedAccount?.accountId || 'unknown'}`);
        }
        
        // Validate selected account or create with proper defaults
        if (!selectedAccount || !this.validateSpotifyAccountInfo(selectedAccount)) {
          logger.warn('Invalid or incomplete Spotify account info, using defaults');
        }
        
        const defaultAccount = {
          id: selectedAccount?.sid || spotifyService.id.toString(),
          serialNumber: selectedAccount?.sn || this.DEFAULT_SERIAL_NUMBER,
          sid: selectedAccount?.sid || spotifyService.id.toString(),
          // Store additional Spotify-specific values (but NOT the token)
          spotifyAlbumPrefix: selectedAccount?.albumPrefix || this.DEFAULT_SPOTIFY_ALBUM_PREFIX,
          spotifyPlaylistPrefix: selectedAccount?.playlistPrefix || this.DEFAULT_SPOTIFY_PLAYLIST_PREFIX,
          spotifyAccountId: selectedAccount?.accountId || 'default'
        } as ServiceAccount & { 
          spotifyAlbumPrefix?: string; 
          spotifyPlaylistPrefix?: string;
          spotifyAccountId?: string;
        };
        this.accountCache.set(cacheKey, defaultAccount);
        return defaultAccount;
      }

      return null;
    } catch (error) {
      logger.error(`Error getting service account for ${serviceName}:`, error);
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

  /**
   * Get Spotify values for a specific account ID
   * @param accountId - The Spotify account ID
   * @returns The cached values for this account or null
   */
  getSpotifyAccountValues(accountId: string): SpotifyExtractedValues | null {
    return this.spotifyPrefixCache.get(accountId) || null;
  }

  /**
   * Get all discovered Spotify accounts
   * @returns Map of account IDs to their extracted values
   */
  getAllSpotifyAccounts(): Map<string, SpotifyExtractedValues> {
    return new Map(this.spotifyPrefixCache);
  }

  /**
   * Get Spotify service info directly from device's available services
   */
  private async getSpotifyServiceFromDevice(device: SonosDevice): Promise<{ sid: string } | null> {
    try {
      // First try the services cache
      if (this.servicesCache) {
        const services = await this.servicesCache.getServices();
        const spotifyService = Object.values(services).find(
          service => service.name.toLowerCase() === 'spotify'
        );
        
        if (spotifyService) {
          logger.info(`Found Spotify service from cache with SID: ${spotifyService.id}`);
          return { sid: spotifyService.id.toString() };
        }
      }
      
      // If not in cache, query device directly using SOAP
      logger.debug('Spotify not found in cache, querying device directly...');
      
      // Use device's soap method to get available services
      const response = await device.soap('MusicServices', 'ListAvailableServices', {});
      
      if (response && response.AvailableServiceDescriptorList) {
        // Parse the service list to find Spotify
        const serviceList = response.AvailableServiceDescriptorList;
        const match = serviceList.match(/Service Id="(\d+)"[^>]*>\s*<Name>Spotify<\/Name>/);
        
        if (match && match[1]) {
          logger.info(`Found Spotify service from device with SID: ${match[1]}`);
          return { sid: match[1] };
        }
      }
    } catch (error) {
      logger.error('Failed to get Spotify service info from device:', error);
    }
    return null;
  }

  /**
   * Validate that Spotify account info has all required fields
   */
  private validateSpotifyAccountInfo(info: SpotifyExtractedValues): boolean {
    return !!(info && info.sn && info.sid && info.albumPrefix && info.playlistPrefix);
  }

  /**
   * Get Spotify account info with caching - checks cache first
   * @param device - Sonos device to extract from
   * @param accountId - Optional specific account ID to get
   * @returns Cached or newly extracted account info
   */
  async getSpotifyAccountInfo(device: SonosDevice, accountId?: string): Promise<Record<string, SpotifyExtractedValues>> {
    // Check cache first
    if (accountId && this.spotifyPrefixCache.has(accountId)) {
      return { [accountId]: this.spotifyPrefixCache.get(accountId)! };
    }
    
    // If we have any cached data and no specific account requested, return all
    if (!accountId && this.spotifyPrefixCache.size > 0) {
      return Object.fromEntries(this.spotifyPrefixCache);
    }
    
    // Otherwise extract
    return this.extractSpotifyAccountInfo(device);
  }

  /**
   * Force extract all Spotify account info from device - ignores cache
   * Updates the cache with any found values
   * @param device - Sonos device to extract from
   * @returns All accounts found, including a 'default' if no favorites exist
   */
  async extractSpotifyAccountInfo(device: SonosDevice): Promise<Record<string, SpotifyExtractedValues>> {
    const result: Record<string, SpotifyExtractedValues> = {};

    try {
      logger.debug(`Browsing favorites on device ${device.roomName}...`);
      const browseResult = await device.browse('FV:2');
      logger.debug(`Browse result: ${browseResult?.items?.length || 0} items found`);

      if (browseResult?.items?.length) {
        for (const item of browseResult.items) {
          if (!item.uri?.includes('spotify')) continue;
          
          logger.debug(`Found Spotify favorite: ${item.title}, URI: ${item.uri}`);
          if ((item as any).desc) {
            logger.debug(`  desc field: ${(item as any).desc}`);
          }

          const snMatch = item.uri.match(/sn=(\d+)/);
          const sidMatch = item.uri.match(/sid=(\d+)/);
          
          // Token is in the r:resMD field within the metadata
          let tokenMatch: RegExpMatchArray | null = null;
          
          // Need to parse the metadata DIDL-Lite to extract r:resMD
          if (item.metadata) {
            try {
              const { XMLParser } = await import('fast-xml-parser');
              const parser = new XMLParser({
                ignoreAttributes: false,
                parseAttributeValue: false,
                trimValues: true
              });
              
              const parsed = parser.parse(item.metadata);
              const didlLite = parsed['DIDL-Lite'];
              
              if (didlLite && didlLite.item) {
                const items = Array.isArray(didlLite.item) ? didlLite.item : [didlLite.item];
                
                // Find THIS specific favorite by ID
                interface DIDLItem {
                  '@_id': string;
                  'r:resMD'?: string;
                  [key: string]: unknown;
                }
                const thisItem = items.find((i: DIDLItem) => i['@_id'] === item.id);
                
                if (thisItem && thisItem['r:resMD']) {
                  // The r:resMD contains escaped DIDL-Lite, need to unescape and parse
                  const unescaped = thisItem['r:resMD']
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&amp;/g, '&');
                  
                  // Parse the inner DIDL-Lite
                  const innerParsed = parser.parse(unescaped);
                  const innerDidl = innerParsed['DIDL-Lite'];
                  
                  if (innerDidl && innerDidl.item && innerDidl.item.desc) {
                    // desc might be an object with attributes or a string
                    let descText = '';
                    if (typeof innerDidl.item.desc === 'string') {
                      descText = innerDidl.item.desc;
                    } else if (innerDidl.item.desc['#text']) {
                      descText = innerDidl.item.desc['#text'];
                    }
                    
                    // Extract token info
                    tokenMatch = descText.match(/SA_RINCON(\d+)_X_#Svc\d+-([a-zA-Z0-9]+)-Token/);
                  }
                }
              }
            } catch (err) {
              logger.warn(`Failed to parse metadata for ${item.title}:`, err);
            }
          }
          const prefixMatch = item.uri.match(/x-rincon-cpcontainer:([0-9a-f]+)spotify/);

          // Extract account ID from token, but don't store the token itself
          const accountId = tokenMatch?.[2];
          if (!accountId) continue;

          if (!result[accountId]) {
            // IMPORTANT: Use the SID from the metadata token, not the URI
            // The URI may have been updated but the token contains the actual working SID
            const tokenSid = tokenMatch?.[1];
            const uriSid = sidMatch?.[1];
            
            result[accountId] = {
              sn: snMatch?.[1] || '1',
              sid: tokenSid || uriSid || '12', // Prefer token SID over URI SID
              albumPrefix: '',
              playlistPrefix: '',
              accountId: accountId
            };
            logger.debug(`Extracted Spotify account ${accountId}: sn=${result[accountId].sn}, sid=${result[accountId].sid} (from ${tokenSid ? 'token' : 'URI'})`);
            
            // If we found a different SID, add it to the services cache
            const discoveredSid = tokenSid || uriSid;
            if (discoveredSid && this.servicesCache) {
              try {
                // Get the current Spotify service ID from cache
                const services = await this.servicesCache.getServices();
                const serviceValues = Object.values(services || {});
                const spotifyService = serviceValues.find(s => s?.name === 'Spotify');
                
                // Only add if it's different from the canonical ID
                if (spotifyService && discoveredSid !== spotifyService.id.toString()) {
                  await this.servicesCache.addDiscoveredServiceId(discoveredSid, 'Spotify');
                }
              } catch (error) {
                logger.warn(`Failed to add discovered Spotify service ID ${discoveredSid}:`, error);
              }
            }
          }

          // Use logical OR assignment to set prefix if not already set
          if (item.uri.includes('spotify%3Aalbum') && prefixMatch?.[1]) {
            result[accountId].albumPrefix ||= prefixMatch[1];
          } else if (item.uri.includes('spotify%3Aplaylist') && prefixMatch?.[1]) {
            result[accountId].playlistPrefix ||= prefixMatch[1];
          }
        }
      }

      // Get service info for browsing
      const serviceInfo = await this.getSpotifyServiceFromDevice(device);
      const sid = serviceInfo?.sid;
      
      // For any accounts without prefixes, try to get them from Spotify root
      for (const [accountId, data] of Object.entries(result)) {
        if (!data.albumPrefix) {
          const albumPrefix = await this.browseForPrefix(device, 'album', sid);
          if (albumPrefix) {
            data.albumPrefix = albumPrefix;
            logger.info(`Found album prefix for account ${accountId}: ${albumPrefix}`);
          }
        }
        if (!data.playlistPrefix) {
          const playlistPrefix = await this.browseForPrefix(device, 'playlist', sid);
          if (playlistPrefix) {
            data.playlistPrefix = playlistPrefix;
            logger.info(`Found playlist prefix for account ${accountId}: ${playlistPrefix}`);
          }
        }
        
        // Update cache with the complete data
        this.spotifyPrefixCache.set(accountId, data);
      }
      
      // If no accounts found from favorites, create default using service info
      if (Object.keys(result).length === 0 && serviceInfo) {
        const albumPrefix = await this.browseForPrefix(device, 'album', sid);
        const playlistPrefix = await this.browseForPrefix(device, 'playlist', sid);

        result['default'] = {
          sn: this.DEFAULT_SERIAL_NUMBER,
          sid: serviceInfo.sid,
          albumPrefix: albumPrefix || this.DEFAULT_SPOTIFY_ALBUM_PREFIX,
          playlistPrefix: playlistPrefix || this.DEFAULT_SPOTIFY_PLAYLIST_PREFIX,
          accountId: 'default'
        };
        
        // Cache the default account
        this.spotifyPrefixCache.set('default', result['default']);
      }
    } catch (error) {
      logger.error('Failed to extract Spotify account info:', error);
    }

    return result;
  }


  /**
   * Browse for a specific Spotify content type prefix
   */
  private async browseForPrefix(device: SonosDevice, type: 'album' | 'playlist', sid?: string): Promise<string | null> {
    try {
      // First try favorites
      const browseResult = await device.browse('FV:2');
      const searchPattern = type === 'album' ? 'spotify%3Aalbum' : 'spotify%3Aplaylist';
      
      for (const item of browseResult.items || []) {
        if (!item.uri || !item.uri.includes('spotify')) continue;
        
        if (item.uri.includes('x-rincon-cpcontainer:') && item.uri.includes(searchPattern)) {
          const prefixMatch = item.uri.match(/x-rincon-cpcontainer:([0-9a-f]+)spotify/);
          if (prefixMatch && prefixMatch[1]) {
            logger.debug(`Found ${type} prefix from favorites: ${prefixMatch[1]}`);
            return prefixMatch[1];
          }
        }
      }
      
      // If not found in favorites, we can't browse SP:${sid} without proper auth
      // Just log that we're using defaults
      if (!sid) {
        logger.debug(`No ${type} prefix in favorites, will use defaults`);
      } else {
        logger.debug(`No ${type} prefix in favorites, unable to browse SP:${sid} (requires Spotify auth), will use defaults`);
      }
    } catch (error) {
      logger.warn(`Failed to browse for ${type} prefix:`, error);
    }
    return null;
  }
}