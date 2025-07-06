import logger from '../utils/logger.js';
import type { SonosDevice } from '../sonos-device.js';
import type { Config } from '../types/sonos.js';
import { PandoraAPI, type PandoraStation } from './pandora-api.js';

interface FuzzySearchResult {
  item: PandoraStation;
  score: number;
}

export class PandoraService {
  private static readonly PANDORA_SID = '236';
  private static readonly PANDORA_SERVICE_TYPE = (236 << 8) + 7; // 60423
  private static pandoraAPI: PandoraAPI | null = null;
  private static lastLoginTime = 0;
  private static readonly LOGIN_CACHE_TIME = 30 * 60 * 1000; // 30 minutes
  
  /**
   * Initialize or get the Pandora API instance
   */
  private static async getPandoraAPI(config: Config): Promise<PandoraAPI> {
    if (!config.pandora?.username || !config.pandora?.password) {
      throw new Error('Pandora credentials not configured in settings.json');
    }

    const now = Date.now();
    
    // Re-login if needed
    if (!this.pandoraAPI || (now - this.lastLoginTime) > this.LOGIN_CACHE_TIME) {
      logger.info('Initializing Pandora API client');
      this.pandoraAPI = new PandoraAPI(
        config.pandora.username,
        config.pandora.password
      );
      
      await this.pandoraAPI.login();
      this.lastLoginTime = now;
    }
    
    return this.pandoraAPI;
  }
  
  /**
   * Generate Pandora station URI
   */
  static generateStationURI(stationId: string, sessionNumber: string = '1'): string {
    const encodedId = encodeURIComponent(stationId);
    // Match Sonos app: use flags=0 instead of flags=8300
    return `x-sonosapi-radio:ST%3a${encodedId}?sid=${this.PANDORA_SID}&flags=0&sn=${sessionNumber}`;
  }

  /**
   * Generate Pandora station metadata
   */
  static generateStationMetadata(stationId: string, stationName: string, accountToken: string = 'b7ca2819-Token'): string {
    // Do NOT encode the station ID for metadata - use raw ID
    const encodedName = stationName
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
    
    // Use encoded station ID in the item id to match Sonos app
    const encodedId = encodeURIComponent(stationId);

    return `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"
      xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
      <item id="000c0000ST%3a${encodedId}" parentID="-1" restricted="true">
        <dc:title>${encodedName}</dc:title>
        <upnp:class>object.item.audioItem.audioBroadcast</upnp:class>
        <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON${this.PANDORA_SERVICE_TYPE}_X_#Svc${this.PANDORA_SERVICE_TYPE}-${accountToken}</desc>
      </item>
    </DIDL-Lite>`;
  }

  /**
   * Simple fuzzy search implementation
   */
  private static fuzzySearch(stations: PandoraStation[], query: string): FuzzySearchResult | null {
    const lowerQuery = query.toLowerCase();
    let bestMatch: FuzzySearchResult | null = null;
    
    for (const station of stations) {
      const lowerName = station.stationName.toLowerCase();
      let score = 0;
      
      // Exact match
      if (lowerName === lowerQuery) {
        score = 100;
      }
      // Starts with query
      else if (lowerName.startsWith(lowerQuery)) {
        score = 90;
      }
      // Contains query
      else if (lowerName.includes(lowerQuery)) {
        score = 80;
      }
      // Word boundary match
      else if (lowerName.split(/\s+/).some(word => word.startsWith(lowerQuery))) {
        score = 70;
      }
      
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { item: station, score };
      }
    }
    
    return bestMatch;
  }

  /**
   * Play a Pandora station by name using the Pandora API
   */
  static async playStation(device: SonosDevice, stationName: string, config: Config): Promise<void> {
    try {
      const api = await this.getPandoraAPI(config);
      
      // Get user's station list
      logger.debug(`Getting Pandora station list for search: ${stationName}`);
      const stationList = await api.getStationList(true);
      const allStations: PandoraStation[] = [...stationList.stations];
      
      // Search for artists and songs to create stations
      logger.debug('Searching Pandora music catalog');
      const searchResult = await api.searchMusic(stationName);
      
      // Add high-scoring artists as potential stations
      if (searchResult.artists) {
        for (const artist of searchResult.artists) {
          if (artist.score > 90) {
            allStations.push({
              stationId: artist.musicToken,
              stationName: artist.artistName,
              type: 'artist' as const
            });
          }
        }
      }
      
      // Add high-scoring songs as potential stations
      if (searchResult.songs) {
        for (const song of searchResult.songs) {
          if (song.score > 90) {
            allStations.push({
              stationId: song.musicToken,
              stationName: song.songName,
              type: 'song' as const
            });
          }
        }
      }
      
      // Get genre stations
      logger.debug('Getting Pandora genre stations');
      const genreResult = await api.getGenreStations();
      for (const category of genreResult.categories) {
        for (const genreStation of category.stations) {
          allStations.push({
            stationId: genreStation.stationToken,
            stationName: genreStation.stationName,
            stationToken: genreStation.stationToken
          });
        }
      }
      
      // Find the best matching station
      logger.debug(`Searching through ${allStations.length} stations for: ${stationName}`);
      const match = this.fuzzySearch(allStations, stationName);
      
      if (!match) {
        throw new Error(`No Pandora station found matching '${stationName}'`);
      }
      
      logger.info(`Found Pandora station: ${match.item.stationName} (score: ${match.score})`);
      
      // Get session number dynamically
      const { PandoraSessionHelper } = await import('./pandora-session.js');
      const sessionNumber = await PandoraSessionHelper.getSessionNumber(device);
      logger.debug(`Using Pandora session number: ${sessionNumber}`);
      
      let uri: string;
      let metadata: string;
      
      // If it's a new station (artist/song), create it first
      if (match.item.type && match.item.type !== 'genre') {
        logger.debug(`Creating new station from ${match.item.type}: ${match.item.stationName}`);
        const newStation = await api.createStation(match.item.stationId, match.item.type as 'artist' | 'song');
        uri = this.generateStationURI(newStation.stationId, sessionNumber);
        metadata = this.generateStationMetadata(newStation.stationId, newStation.stationName);
      } else {
        // Use existing station
        const stationId = match.item.stationToken || match.item.stationId;
        uri = this.generateStationURI(stationId, sessionNumber);
        metadata = this.generateStationMetadata(stationId, match.item.stationName);
      }
      
      logger.debug(`Playing Pandora station with URI: ${uri}`);
      
      // Set and play the station
      await device.setAVTransportURI(uri, metadata);
      await device.play();
      
      logger.info(`Successfully started playing Pandora station: ${match.item.stationName}`);
      
    } catch (error) {
      logger.error('Error playing Pandora station:', error);
      throw new Error(`Failed to play Pandora station '${stationName}': ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get current track info to extract tokens for thumbs up/down
   */
  static extractTrackTokens(trackUri: string): { trackToken: string | null; stationToken: string | null } {
    try {
      // Check if this is a Pandora track
      if (!trackUri || !trackUri.includes('x-sonos-http:')) {
        return { trackToken: null, stationToken: null };
      }

      logger.debug(`Extracting tokens from URI: ${trackUri}`);

      // Decode the URI first
      const decodedUri = decodeURIComponent(trackUri);
      logger.debug(`Decoded URI: ${decodedUri}`);

      // URI format variations:
      // 1. x-sonos-http:VC1::ST::ST:{stationToken}::TR:{trackToken}::...
      // 2. x-sonos-http:TR:{trackToken}?sn=...
      // 3. x-sonos-http:...TR%3a{trackToken}...
      
      let trackToken: string | null = null;
      let stationToken: string | null = null;

      // Try decoded format first (with ::TR: and ::ST:)
      let trackMatch = decodedUri.match(/::TR:([^:]+)::/);
      if (trackMatch) {
        trackToken = trackMatch[1] || null;
      } else {
        // Try encoded format (%3a%3aTR%3a)
        trackMatch = trackUri.match(/%3a%3aTR%3a([^%]+)%3a%3a/);
        trackToken = trackMatch ? trackMatch[1] || null : null;
      }

      // Extract station token - try decoded format first
      let stationMatch = decodedUri.match(/::ST:([^:]+)::/);
      if (stationMatch) {
        stationToken = stationMatch[1] || null;
      } else {
        // Try encoded format
        stationMatch = trackUri.match(/%3a%3aST%3a([^%]+)%3a%3a/);
        stationToken = stationMatch ? stationMatch[1] || null : null;
      }
      
      // If we didn't find station token with ST::, try looking between TR markers
      if (!stationToken && trackToken) {
        // Sometimes station token comes before track token
        const beforeTrackMatch = decodedUri.match(/::([^:]+)::TR:/);
        if (beforeTrackMatch) {
          stationToken = beforeTrackMatch[1] || null;
        }
      }
      
      logger.debug(`Extracted tokens - track: ${trackToken}, station: ${stationToken}`);

      return { trackToken, stationToken };
    } catch (error) {
      logger.error('Error extracting Pandora tokens:', error);
      return { trackToken: null, stationToken: null };
    }
  }

  /**
   * Search for a Pandora station and return its URI and title
   */
  static async searchForStation(api: PandoraAPI, stationName: string): Promise<{ uri: string; title: string } | null> {
    try {
      // Get user's station list
      logger.debug(`Getting Pandora station list for search: ${stationName}`);
      const stationList = await api.getStationList(true);
      const allStations: PandoraStation[] = [...stationList.stations];
      
      // Search for artists and songs to create stations
      logger.debug('Searching Pandora music catalog');
      const searchResult = await api.searchMusic(stationName);
      
      // Add high-scoring artists as potential stations
      if (searchResult.artists) {
        for (const artist of searchResult.artists) {
          if (artist.score > 90) {
            allStations.push({
              stationId: artist.musicToken,
              stationName: artist.artistName,
              type: 'artist' as const
            });
          }
        }
      }
      
      // Add high-scoring songs as potential stations
      if (searchResult.songs) {
        for (const song of searchResult.songs) {
          if (song.score > 90) {
            allStations.push({
              stationId: song.musicToken,
              stationName: song.songName,
              type: 'song' as const
            });
          }
        }
      }
      
      // Get genre stations
      logger.debug('Getting Pandora genre stations');
      const genreResult = await api.getGenreStations();
      for (const category of genreResult.categories) {
        for (const genreStation of category.stations) {
          allStations.push({
            stationId: genreStation.stationToken,
            stationName: genreStation.stationName,
            stationToken: genreStation.stationToken
          });
        }
      }
      
      // Find the best matching station
      logger.debug(`Searching through ${allStations.length} stations for: ${stationName}`);
      const match = this.fuzzySearch(allStations, stationName);
      
      if (!match) {
        return null;
      }
      
      logger.info(`Found Pandora station: ${match.item.stationName} (score: ${match.score})`);
      
      let uri: string;
      let title: string;
      
      // If it's a new station (artist/song), create it first
      if (match.item.type && match.item.type !== 'genre') {
        logger.debug(`Creating new station from ${match.item.type}: ${match.item.stationName}`);
        const newStation = await api.createStation(match.item.stationId, match.item.type as 'artist' | 'song');
        uri = this.generateStationURI(newStation.stationId);
        title = newStation.stationName;
      } else {
        // Use existing station
        const stationId = match.item.stationToken || match.item.stationId;
        uri = this.generateStationURI(stationId);
        title = match.item.stationName;
      }
      
      return { uri, title };
    } catch (error) {
      logger.error('Error searching for Pandora station:', error);
      return null;
    }
  }

  /**
   * Send thumbs up/down feedback using the Pandora API
   */
  static async sendFeedback(device: SonosDevice, isPositive: boolean, config: Config): Promise<void> {
    try {
      const currentTrack = device.state.currentTrack;
      if (!currentTrack || !currentTrack.uri) {
        throw new Error('No track currently playing');
      }

      // Check if it's a Pandora track
      const positionInfo = await device.getPositionInfo();
      const trackUri = positionInfo.TrackURI || currentTrack.uri || '';
      
      logger.debug(`Checking Pandora track - positionInfo.TrackURI: ${positionInfo.TrackURI}`);
      logger.debug(`Current track URI: ${currentTrack.uri}`);
      logger.debug(`Using trackUri: ${trackUri}`);
      
      // Pandora tracks have URIs like: x-sonos-http:TRACKTOKEN%3a%3aST%3aSTATIONTOKEN%3a%3aRINCON...
      // The URI contains the sid=236 parameter
      if (!trackUri.includes('x-sonos-http:') || !trackUri.includes('sid=236')) {
        throw new Error('Current track is not from Pandora');
      }

      // Extract tokens from the track URI
      const { trackToken, stationToken } = this.extractTrackTokens(trackUri);
      
      if (!trackToken || !stationToken) {
        throw new Error('Could not extract Pandora track tokens');
      }

      logger.info(`Pandora ${isPositive ? 'thumbs up' : 'thumbs down'} for: ${currentTrack.title || 'current track'}`);
      logger.debug(`Track token: ${trackToken}, Station token: ${stationToken}`);
      
      // Send feedback to Pandora
      const api = await this.getPandoraAPI(config);
      await api.addFeedback(stationToken, trackToken, isPositive);
      
      logger.info(`Successfully sent ${isPositive ? 'thumbs up' : 'thumbs down'} to Pandora`);
      
      // For thumbs down, also skip to next track
      if (!isPositive) {
        logger.info('Skipping to next track after thumbs down');
        await device.next();
      }
      
    } catch (error) {
      logger.error('Error sending Pandora feedback:', error);
      throw error;
    }
  }
}