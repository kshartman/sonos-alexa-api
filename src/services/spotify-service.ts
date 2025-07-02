import { MusicService, MusicSearchResult, MusicServiceConfig, ServiceAccount } from './music-service.js';
import logger from '../utils/logger.js';
import type { SonosDevice } from '../sonos-device.js';

interface SpotifySearchResponse {
  tracks?: {
    items: SpotifyTrack[];
  };
  albums?: {
    items: SpotifyAlbum[];
  };
  artists?: {
    items: SpotifyArtist[];
  };
}

interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: { name: string };
  duration_ms: number;
  uri: string;
  external_urls: { spotify: string };
  available_markets?: string[];
}

interface SpotifyAlbum {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  uri: string;
  external_urls: { spotify: string };
  available_markets?: string[];
}

interface SpotifyArtist {
  id: string;
  name: string;
  uri: string;
  external_urls: { spotify: string };
}

/**
 * Spotify service implementation using public API (no authentication).
 * Supports search for tracks, albums, and artists.
 * IMPORTANT: Requires Spotify Premium account for API playback control.
 * Free Spotify accounts can play through Sonos app but not via SMAPI/API.
 * Requires Spotify to be configured in the user's Sonos system.
 */
export class SpotifyService extends MusicService {
  private readonly baseUrl = 'https://api.spotify.com/v1';
  private readonly DEFAULT_SPOTIFY_SID = '12';
  private readonly DEFAULT_SPOTIFY_SN = '1';
  private readonly DEFAULT_ALBUM_PREFIX = '1004006c';
  private readonly DEFAULT_PLAYLIST_PREFIX = '1006286c';
  
  /*
   * SMAPI Flags Reference Table (undocumented Sonos behavior)
   * 
   * Flags | Binary          | Used For                           | Notes
   * ------|-----------------|------------------------------------|-----------------------------------------
   * 108   | 000001101100    | Playlists / Albums                 | Queueable containers
   * 8200  | 10000000001000  | Artist Radio                       | Used with x-sonosapi-radio: URIs
   * 8224  | 10000000100000  | Standard Track                     | Most Spotify track URIs
   * 8232  | 10000000111000  | Enhanced Track                     | Seen in curated playlists or context menus
   * 1034  | 00010000001010  | Some playlists / hybrid containers | Used by Spotify editorial / curated playlists
   * 10348 | 10100001101100  | User playlists                     | User-created or followed playlists (seen in favorites)
   * 0     | 00000000000000  | Default                            | No features enabled
   * 8192  | 10000000000000  | Base streamable flag               | Used in all streamable items (e.g. tracks, stations)
   * 16    | 00000010000     | Add to queue                       | Often combined with streamable types
   * 32    | 00000100000     | Immediate playback                 | Used in tracks and artist radio
   * 8     | 00000001000     | Enqueueable                        | Seen in combination with albums / playlists
   * 
   * Common Flag Combinations (by Content Type):
   * 
   * Content Type      | Typical Flags | Description
   * ------------------|---------------|--------------------------------
   * Track             | 8224          | Standard playable stream
   * Track (enhanced)  | 8232          | Stream + enqueue/play now
   * Album / Playlist  | 108           | Queueable container
   * Editorial Playlist| 1034          | Curated playlist / hybrid container
   * Artist Radio      | 8200          | Station-style playback (stream-only)
   * Unknown container | 0             | Used as fallback; typically fails
   * 
   * The difference between 8224 and 8232 is bit 3 (value 8), which might enable:
   * - track actions (e.g., thumbs up/down)
   * - better queue management when inserted from certain contexts
   * - Sonos might use this internally for certain auto-generated playback
   * 
   * We use standard flags (8224 for tracks, 108 for containers) for maximum compatibility.
   * 
   * Practical Rules:
   * • Use 8224 for any track URI (x-sonos-spotify:)
   * • Use 108 for albums/playlists (x-rincon-cpcontainer:)
   * • Use 8200 for artist radio (x-sonosapi-radio:)
   * • If a favorite uses a weird flag like 1034, copy it as-is — Sonos may require it
   */
  private device?: SonosDevice;
  private missingPrefixCache = new Map<string, string>();
  
  constructor() {
    const config: MusicServiceConfig = {
      country: 'US',
      search: {
        album: '/search?type=album&limit=50',
        song: '/search?type=track&limit=50',
        station: '/search?type=artist&limit=50'
      },
      metaStart: {
        album: '00032020',
        song: '00032020',
        station: '00032020'
      },
      parent: {
        album: '00020000spotify%3auser%3aspotify',
        song: '00020000spotify%3auser%3aspotify',
        station: '00020000spotify%3auser%3aspotify'
      },
      objectClass: {
        album: 'object.container.album.musicAlbum',
        song: 'object.item.audioItem.musicTrack',
        station: 'object.item.audioItem.audioBroadcast.#artistRadio'
      }
    };
    
    super(config);
  }

  /**
   * Searches Spotify for content using the public Web API.
   * No authentication required for basic search operations.
   * @param type - Type of content to search for
   * @param term - Search query
   * @param country - Country code for filtering results (default: 'US')
   * @returns Array of search results
   */
  async search(type: 'album' | 'song' | 'station', term: string, country = 'US'): Promise<MusicSearchResult[]> {
    try {
      const searchTerm = this.processSearchTerm(type, term);
      const encodedTerm = encodeURIComponent(searchTerm);
      
      // Build search URL
      const url = `${this.baseUrl}${this.config.search[type]}&q=${encodedTerm}&market=${country}`;
      
      logger.debug(`Spotify search: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        // Check if it's a 401 (requires auth) - this means we need to use token
        if (response.status === 401) {
          logger.warn('Spotify API requires authentication. Search not available without auth token.');
          return [];
        }
        
        const errorText = await response.text();
        logger.error(`Spotify API error ${response.status}: ${errorText}`);
        throw new Error(`Spotify API error: ${response.status}`);
      }
      
      const data: SpotifySearchResponse = await response.json();
      
      // Extract results based on type
      if (type === 'album' && data.albums) {
        logger.debug(`Spotify found ${data.albums.items.length} albums`);
        return data.albums.items
          .filter(album => this.isAvailableInMarket(album, country))
          .map(album => this.mapAlbum(album));
      } else if (type === 'song' && data.tracks) {
        logger.debug(`Spotify found ${data.tracks.items.length} tracks`);
        return data.tracks.items
          .filter(track => this.isAvailableInMarket(track, country))
          .map(track => this.mapTrack(track));
      } else if (type === 'station' && data.artists) {
        logger.debug(`Spotify found ${data.artists.items.length} artists`);
        return data.artists.items.map(artist => this.mapArtist(artist));
      }
      
      return [];
    } catch (error) {
      logger.error('Spotify search failed:', error);
      throw new Error(`Spotify search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private isAvailableInMarket(item: { available_markets?: string[] }, country: string): boolean {
    // If no markets specified, assume it's available everywhere
    if (!item.available_markets) return true;
    
    // Check if the country is in the available markets
    return item.available_markets.includes(country);
  }

  private mapTrack(track: SpotifyTrack): MusicSearchResult {
    return {
      id: track.id,
      title: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      duration: track.duration_ms,
      uri: track.uri
    };
  }

  private mapAlbum(album: SpotifyAlbum): MusicSearchResult {
    return {
      id: album.id,
      title: album.name,
      artist: album.artists.map(a => a.name).join(', '),
      uri: album.uri
    };
  }

  private mapArtist(artist: SpotifyArtist): MusicSearchResult {
    return {
      id: artist.id,
      title: artist.name,
      uri: artist.uri
    };
  }

  /**
   * Generates a Sonos-compatible URI for Spotify content.
   * @param type - Type of content
   * @param result - Search result to generate URI for
   * @returns Sonos URI string
   */
  generateURI(type: 'album' | 'song' | 'station', result: MusicSearchResult): string {
    if (!this.account) {
      throw new Error('Spotify account not configured in Sonos');
    }
    
    // Using simplified format from reference implementation
    const spotifyUri = type === 'song' ? `spotify:track:${result.id}` : 
      type === 'album' ? `spotify:album:${result.id}` :
        `spotify:artist:${result.id}`;
    
    const encodedUri = encodeURIComponent(spotifyUri);
    
    // Use the actual service ID from the account
    const sid = this.account.sid; // This comes from services list (e.g., 12 for your system)
    const sn = this.account.serialNumber || this.DEFAULT_SPOTIFY_SN; // Usually 1, but use account value if available
    
    // All types use x-sonos-spotify
    return `x-sonos-spotify:${encodedUri}?sid=${sid}&flags=8224&sn=${sn}`;
  }

  /**
   * Generates DIDL-Lite metadata for Spotify content.
   * @param type - Type of content
   * @param result - Search result to generate metadata for
   * @returns DIDL-Lite XML string
   */
  generateMetadata(type: 'album' | 'song' | 'station', result: MusicSearchResult): string {
    // Determine the appropriate Spotify URI based on type
    let spotifyUri: string;
    let upnpClass: string;
    let titleHint: string;
    
    switch (type) {
    case 'song':
      spotifyUri = `spotify:track:${result.id}`;
      upnpClass = 'object.item.audioItem.musicTrack';
      titleHint = result.title || 'Spotify Track';
      break;
    case 'album':
      spotifyUri = `spotify:album:${result.id}`;
      upnpClass = 'object.container.album.musicAlbum';
      titleHint = result.title || 'Spotify Album';
      break;
    case 'station':
      spotifyUri = `spotify:artist:${result.id}`;
      upnpClass = 'object.item.audioItem.audioBroadcast';
      titleHint = result.title || 'Spotify Artist Radio';
      break;
    default:
      throw new Error(`Unsupported type: ${type}`);
    }
    
    const encodedUri = encodeURIComponent(spotifyUri);
    const metaId = `00032020${encodedUri}`;
    const parentId = '00020000spotify%3auser%3aspotify';
    
    // Build metadata using the format from ChatGPT's example
    let metadata = '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">';
    metadata += `<item id="${metaId}" parentID="${parentId}" restricted="true">`;
    metadata += `<dc:title>${this.escapeXml(titleHint)}</dc:title>`;
    metadata += `<upnp:class>${upnpClass}</upnp:class>`;
    
    // Account is extended with Spotify-specific fields by AccountService
    const accountInfo = this.account as ServiceAccount & {
      spotifyMetadataToken?: string;
      spotifyAlbumPrefix?: string;
      spotifyPlaylistPrefix?: string;
      spotifyAccountId?: string;
    };
    
    // Use the SID from the account (which comes from favorites metadata if available)
    const sid = this.account?.sid || this.DEFAULT_SPOTIFY_SID;
    const sn = this.account?.serialNumber || this.DEFAULT_SPOTIFY_SN;
    // Use actual account ID if available, otherwise use 0 as fallback
    const accountId = (accountInfo?.spotifyAccountId && accountInfo.spotifyAccountId !== 'default') 
      ? accountInfo.spotifyAccountId 
      : '0';
    const serviceToken = `SA_RINCON${sid}_X_#Svc${sid}-${accountId}-Token`;
    
    metadata += `<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">${serviceToken}</desc>`;
    
    // Add res tag for tracks as shown in ChatGPT's example
    if (type === 'song') {
      const flags = this.getSpotifyFlags('track');
      const trackUri = `x-sonos-spotify:${encodedUri}?sid=${sid}&flags=${flags}&sn=${sn}`;
      metadata += `<res protocolInfo="x-sonos-spotify:*:*:*">${this.escapeXml(trackUri)}</res>`;
    }
    
    metadata += '</item></DIDL-Lite>';
    
    return metadata;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Parses Spotify URLs and URIs to extract content type and ID.
   * Supports:
   * - URLs: https://open.spotify.com/track/xyz, /album/xyz, /playlist/xyz
   * - URIs: spotify:track:xyz, spotify:album:xyz, spotify:playlist:xyz
   * @param input - Spotify URL or URI
   * @returns Parsed content info or null if invalid
   */
  static parseSpotifyInput(input: string): { type: 'track' | 'album' | 'playlist' | 'artist'; id: string } | null {
    // Parse Spotify URLs: https://open.spotify.com/track/xyz
    if (input.includes('open.spotify.com')) {
      const matches = input.match(/\/(track|album|playlist|artist)\/([a-zA-Z0-9]+)/);
      if (matches && matches[1] && matches[2]) {
        return {
          type: matches[1] as 'track' | 'album' | 'playlist' | 'artist',
          id: matches[2]
        };
      }
    }
    
    // Parse Spotify URIs: spotify:track:xyz
    if (input.startsWith('spotify:')) {
      const parts = input.split(':');
      if (parts.length === 3 && parts[1] && parts[2] && ['track', 'album', 'playlist', 'artist'].includes(parts[1])) {
        return {
          type: parts[1] as 'track' | 'album' | 'playlist' | 'artist',
          id: parts[2]
        };
      }
    }
    
    return null;
  }

  /**
   * Parse a Spotify share URL and generate a Sonos URI
   * @param spotifyUrl - Spotify share URL like https://open.spotify.com/track/123
   * @param sid - Service ID (defaults to 12)
   * @param sn - Serial number (defaults to 1)
   * @returns Sonos-compatible URI or null if URL is invalid
   */
  static parseSpotifyUrlToUri(spotifyUrl: string, sid: string = '12', sn: string = '1'): string | null {
    // Use existing parseSpotifyInput to extract type and ID
    const parsed = SpotifyService.parseSpotifyInput(spotifyUrl);
    
    if (!parsed) {
      return null;
    }
    
    const { type, id } = parsed;
    const spotifyUri = `spotify:${type}:${id}`;
    
    // Generate Sonos URI based on content type
    let sonosUri: string;
    if (type === 'track') {
      // Simple track URI
      sonosUri = `x-sonos-spotify:${encodeURIComponent(spotifyUri)}?sid=${sid}&flags=8224&sn=${sn}`;
    } else {
      // For albums, playlists, and artists, we need prefixes
      // Use hardcoded defaults if we don't have account info
      const prefixes: Record<string, string> = {
        album: '1006006c',
        playlist: '1004206c',
        artist: '1003206c' // Guessed default for artist
      };
      
      const prefix = prefixes[type] || '1000006c';
      sonosUri = `x-rincon-cpcontainer:${prefix}${encodeURIComponent(spotifyUri)}?sid=${sid}&flags=108&sn=${sn}`;
    }
    
    return sonosUri;
  }

  /**
   * Set the device for browsing operations
   * @param device - The Sonos device to use for browsing
   */
  setDevice(device: SonosDevice): void {
    this.device = device;
  }

  /**
   * Browse for a specific Spotify content type to extract prefix
   * @param type - The content type to search for
   * @returns The extracted prefix or null
   */
  private async browseForPrefix(type: 'album' | 'playlist'): Promise<string | null> {
    if (!this.device) {
      logger.warn('No device set for browsing');
      return null;
    }

    // Check cache first
    const cacheKey = `${type}-${this.account?.id || 'default'}`;
    if (this.missingPrefixCache.has(cacheKey)) {
      return this.missingPrefixCache.get(cacheKey)!;
    }

    try {
      logger.info(`Browsing for Spotify ${type} prefix...`);
      const browseResult = await this.device.browse('FV:2');
      
      if (!browseResult || !browseResult.items || browseResult.items.length === 0) {
        return null;
      }

      // Look for the specific content type
      const searchPattern = type === 'album' ? 'spotify%3Aalbum' : 'spotify%3Aplaylist';
      
      for (const item of browseResult.items) {
        if (!item.uri || !item.uri.includes('spotify')) {
          continue;
        }
        
        if (item.uri.includes('x-rincon-cpcontainer:') && item.uri.includes(searchPattern)) {
          const prefixMatch = item.uri.match(/x-rincon-cpcontainer:([0-9a-f]+)spotify/);
          if (prefixMatch && prefixMatch[1]) {
            const prefix = prefixMatch[1];
            logger.info(`Found ${type} prefix via browse: ${prefix}`);
            // Cache the result
            this.missingPrefixCache.set(cacheKey, prefix);
            return prefix;
          }
        }
      }
      
      return null;
    } catch (error) {
      logger.error(`Failed to browse for ${type} prefix:`, error);
      return null;
    }
  }

  /**
   * Generates a direct play URI for a known Spotify ID without search.
   * Useful for playing content when we already have the Spotify ID.
   * @param type - Content type
   * @param id - Spotify ID
   * @returns Sonos-compatible URI
   */
  async generateDirectURI(type: 'track' | 'album' | 'playlist' | 'artist', id: string): Promise<string> {
    if (!this.account) {
      throw new Error('Spotify account not configured in Sonos');
    }
    
    const baseSpotifyUri = `spotify:${type}:${id}`;
    const encodedUri = encodeURIComponent(baseSpotifyUri);
    
    // Use the actual service ID from the account
    const sid = this.account.sid; // This comes from services list (e.g., 12 for your system)
    const sn = this.account.serialNumber || this.DEFAULT_SPOTIFY_SN; // Usually 1, but use account value if available
    
    // Tracks use x-sonos-spotify
    if (type === 'track') {
      const flags = this.getSpotifyFlags(type);
      return `x-sonos-spotify:${encodedUri}?sid=${sid}&flags=${flags}&sn=${sn}`;
    } 
    
    // Artist radio uses x-sonosapi-radio (streaming, not container)
    if (type === 'artist') {
      // Artist radio format: x-sonosapi-radio:spotify%3AartistRadio%3A{artistId}
      const artistRadioUri = `spotify:artistRadio:${id}`;
      const encodedRadioUri = encodeURIComponent(artistRadioUri);
      const flags = this.getSpotifyFlags(type);
      return `x-sonosapi-radio:${encodedRadioUri}?sid=${sid}&flags=${flags}&sn=${sn}`;
    }
    
    // Albums and playlists use container format
    // Account is extended with Spotify-specific fields by AccountService
    const accountInfo = this.account as ServiceAccount & {
      spotifyMetadataToken?: string;
      spotifyAlbumPrefix?: string;
      spotifyPlaylistPrefix?: string;
      spotifyAccountId?: string;
    };
    let prefix: string | null = null;
    
    if (type === 'album') {
      prefix = accountInfo.spotifyAlbumPrefix || null;
      if (!prefix) {
        // Try to browse for it
        prefix = await this.browseForPrefix('album');
      }
      if (!prefix) {
        // Last resort fallback
        prefix = this.DEFAULT_ALBUM_PREFIX;
        logger.warn('Using fallback album prefix - browse failed');
      }
    } else if (type === 'playlist') {
      prefix = accountInfo.spotifyPlaylistPrefix || null;
      if (!prefix) {
        // Try to browse for it
        prefix = await this.browseForPrefix('playlist');
      }
      if (!prefix) {
        // Last resort fallback
        prefix = this.DEFAULT_PLAYLIST_PREFIX;
        logger.warn('Using fallback playlist prefix - browse failed');
      }
    } else {
      throw new Error(`Unexpected type for container: ${type}`);
    }
    
    const spotifyUri = `spotify:${type}:${id}`;
    const encodedContainerUri = encodeURIComponent(spotifyUri);
    const flags = this.getSpotifyFlags(type);
    const finalUri = `x-rincon-cpcontainer:${prefix}${encodedContainerUri}?sid=${sid}&flags=${flags}&sn=${sn}`;
    return finalUri;
  }

  /**
   * Returns Sonos SMAPI flags based on Spotify content type and source context.
   * 
   * @param type - The Spotify content type: 'track', 'album', 'playlist', or 'artist'
   * @param source - Optional context for how the item was found (e.g., from a favorite or search result)
   * @param enhanced - Optionally force enhanced behavior (e.g. enqueue + autoplay)
   * @returns Numeric flags value
   */
  private getSpotifyFlags(
    type: 'track' | 'album' | 'playlist' | 'artist',
    source: 'favorite' | 'search' | 'manual' = 'manual',
    enhanced = false
  ): number {
    switch (type) {
      case 'track':
        // 8224 = streamable + queueable
        // 8232 = same + some favorites include bit 3 (enhanced actions)
        return enhanced ? 8232 : 8224;

      case 'album':
        // 108 = standard for container (album/playlist)
        return 108;

      case 'playlist':
        // If observed from favorite with 10348, respect that
        if (source === 'favorite' && enhanced) return 10348;
        // 1034 = curated playlists
        if (source === 'search') return 1034;
        // Default to common user playlist flag
        return 108;

      case 'artist':
        // 8200 = artist radio (non-seekable stream)
        return 8200;

      default:
        throw new Error(`Unknown Spotify type: ${type}`);
    }
  }

  /**
   * Generates DIDL-Lite metadata for direct play without a search result.
   * @param type - Content type
   * @param id - Spotify ID
   * @param title - Optional title hint
   * @returns DIDL-Lite XML string
   */
  generateDirectMetadata(type: 'track' | 'album' | 'playlist' | 'artist', id: string, title?: string): string {
    // Determine the appropriate Spotify URI and class based on type
    const spotifyUri = `spotify:${type}:${id}`;
    let upnpClass: string;
    let titleHint: string;
    
    switch (type) {
    case 'track':
      upnpClass = 'object.item.audioItem.musicTrack';
      titleHint = title || 'Spotify Track';
      break;
    case 'album':
      upnpClass = 'object.container.album.musicAlbum';
      titleHint = title || 'Spotify Album';
      break;
    case 'playlist':
      upnpClass = 'object.container.playlistContainer';
      titleHint = title || 'Spotify Playlist';
      break;
    case 'artist':
      upnpClass = 'object.item.audioItem.audioBroadcast';
      titleHint = title || 'Spotify Artist Radio';
      break;
    default:
      throw new Error(`Unsupported type: ${type}`);
    }
    
    const encodedUri = encodeURIComponent(spotifyUri);
    const metaId = `00032020${encodedUri}`;
    const parentId = '00020000spotify%3auser%3aspotify';
    
    // Build metadata using the format from ChatGPT's example
    let metadata = '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">';
    metadata += `<item id="${metaId}" parentID="${parentId}" restricted="true">`;
    metadata += `<dc:title>${this.escapeXml(titleHint)}</dc:title>`;
    metadata += `<upnp:class>${upnpClass}</upnp:class>`;
    
    // Account is extended with Spotify-specific fields by AccountService
    const accountInfo = this.account as ServiceAccount & {
      spotifyMetadataToken?: string;
      spotifyAlbumPrefix?: string;
      spotifyPlaylistPrefix?: string;
      spotifyAccountId?: string;
    };
    
    // Use the SID from the account (which comes from favorites metadata if available)
    const sid = this.account?.sid || this.DEFAULT_SPOTIFY_SID;
    const sn = this.account?.serialNumber || this.DEFAULT_SPOTIFY_SN;
    // Use actual account ID if available, otherwise use 0 as fallback
    const accountId = (accountInfo?.spotifyAccountId && accountInfo.spotifyAccountId !== 'default') 
      ? accountInfo.spotifyAccountId 
      : '0';
    const serviceToken = `SA_RINCON${sid}_X_#Svc${sid}-${accountId}-Token`;
    
    metadata += `<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">${serviceToken}</desc>`;
    
    // Add res tag for tracks as shown in ChatGPT's example
    if (type === 'track') {
      const flags = this.getSpotifyFlags(type);
      const trackUri = `x-sonos-spotify:${encodedUri}?sid=${sid}&flags=${flags}&sn=${sn}`;
      metadata += `<res protocolInfo="x-sonos-spotify:*:*:*">${this.escapeXml(trackUri)}</res>`;
    }
    
    metadata += '</item></DIDL-Lite>';
    
    return metadata;
  }
}