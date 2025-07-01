import { MusicService, MusicSearchResult, MusicServiceConfig } from './music-service.js';
import logger from '../utils/logger.js';

interface iTunesSearchResponse {
  resultCount: number;
  results: iTunesTrack[];
}

interface iTunesTrack {
  trackId?: number;
  collectionId?: number;
  artistId?: number;
  trackName?: string;
  collectionName?: string;
  artistName?: string;
  trackTimeMillis?: number;
  previewUrl?: string;
  kind?: string;
  wrapperType?: string;
}

/**
 * Apple Music service implementation.
 * Uses iTunes Search API to find music content.
 * No authentication required - uses public iTunes API.
 */
export class AppleMusicService extends MusicService {
  constructor() {
    const config: MusicServiceConfig = {
      country: '&country=',
      search: {
        album: 'https://itunes.apple.com/search?media=music&limit=1&entity=album&attribute=albumTerm&term=',
        song: 'https://itunes.apple.com/search?media=music&limit=50&entity=song&term=',
        station: 'https://itunes.apple.com/search?media=music&limit=50&entity=musicArtist&term='
      },
      metaStart: {
        album: '0004206calbum%3a',
        song: '00032020song%3a',
        station: '000c206cradio%3ara.'
      },
      parent: {
        album: '00020000album:',
        song: '00020000song:',
        station: '00020000radio:'
      },
      objectClass: {
        album: 'object.container.album.musicAlbum',
        song: 'object.item.audioItem.musicTrack',
        station: 'object.item.audioItem.audioBroadcast'
      }
    };
    
    super(config);
  }

  /**
   * Searches Apple Music/iTunes for content.
   * @param type - Type of content to search for (album, song, or station)
   * @param term - Search query (supports prefixes like artist:, album:, track:)
   * @param country - Country code for localized results (default: 'US')
   * @returns Array of search results
   */
  async search(type: 'album' | 'song' | 'station', term: string, country = 'US'): Promise<MusicSearchResult[]> {
    try {
      const searchTerm = this.processSearchTerm(type, term);
      const encodedTerm = encodeURIComponent(searchTerm);
      let url = this.config.search[type] + encodedTerm;
      
      if (country) {
        url += this.config.country + country;
      }
      
      logger.debug(`Apple Music search: ${url}`);
      
      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`iTunes API error ${response.status}: ${errorText}`);
        throw new Error(`iTunes API error: ${response.status}`);
      }
      
      const data: iTunesSearchResponse = await response.json();
      logger.debug(`Apple Music found ${data.resultCount} results`);
      
      return data.results.map(track => this.mapResult(type, track));
    } catch (error) {
      logger.error('Apple Music search failed:', error);
      throw new Error(`Apple Music search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private mapResult(type: 'album' | 'song' | 'station', track: iTunesTrack): MusicSearchResult {
    let id: string;
    let title: string;
    
    if (type === 'album') {
      id = track.collectionId?.toString() || '';
      title = track.collectionName || '';
    } else if (type === 'song') {
      id = track.trackId?.toString() || '';
      title = track.trackName || '';
    } else { // station
      id = track.artistId?.toString() || '';
      title = track.artistName || '';
    }
    
    return {
      id,
      title,
      artist: track.artistName,
      album: track.collectionName,
      duration: track.trackTimeMillis,
    };
  }

  /**
   * Generates a Sonos-compatible URI for Apple Music content.
   * @param type - Type of content (album, song, or station)
   * @param result - Search result to generate URI for
   * @returns Sonos URI string
   */
  generateURI(type: 'album' | 'song' | 'station', result: MusicSearchResult): string {
    if (!this.account) {
      throw new Error('Apple Music account not configured');
    }
    
    if (type === 'album') {
      return `x-rincon-cpcontainer:0004206calbum%3a${result.id}`;
    } else if (type === 'song') {
      return `x-sonos-http:song%3a${result.id}.mp4?sid=${this.account.sid}&flags=8224&sn=${this.account.serialNumber}`;
    } else { // station
      return `x-sonosapi-radio:ra.${result.id}?sid=${this.account.sid}&flags=32&sn=${this.account.serialNumber}`;
    }
  }

  /**
   * Generates DIDL-Lite metadata for Apple Music content.
   * @param type - Type of content (album, song, or station)
   * @param result - Search result to generate metadata for
   * @returns DIDL-Lite XML string
   */
  generateMetadata(type: 'album' | 'song' | 'station', result: MusicSearchResult): string {
    const metaId = this.config.metaStart[type] + result.id;
    const parentId = this.config.parent[type] + result.id;
    const objectClass = this.config.objectClass[type];
    
    // Build metadata based on type
    let metadata = '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">';
    metadata += `<item id="${metaId}" parentID="${parentId}" restricted="true">`;
    metadata += `<dc:title>${this.escapeXml(result.title)}</dc:title>`;
    
    // Add artist info for songs and albums
    if (result.artist && (type === 'song' || type === 'album')) {
      metadata += `<dc:creator>${this.escapeXml(result.artist)}</dc:creator>`;
      metadata += `<upnp:artist>${this.escapeXml(result.artist)}</upnp:artist>`;
    }
    
    // Add album info for songs
    if (result.album && type === 'song') {
      metadata += `<upnp:album>${this.escapeXml(result.album)}</upnp:album>`;
    }
    
    metadata += `<upnp:class>${objectClass}</upnp:class>`;
    
    // Add the resource URI for playback
    if (this.account) {
      const uri = this.generateURI(type, result);
      metadata += `<res protocolInfo="http-get:*:audio/mpeg:*">${this.escapeXml(uri)}</res>`;
    }
    
    metadata += '<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON52231_X_#Svc52231-0-Token</desc>';
    metadata += '</item></DIDL-Lite>';
    
    // Log the important parts of DIDL-Lite
    const startIdx = metadata.indexOf('<item');
    const endIdx = metadata.indexOf('</item>') + 7;
    logger.debug(`Generated DIDL-Lite content: ${metadata.substring(startIdx, endIdx)}`);
    
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

  protected override formatSearchTerm(artist: string, album: string, track: string): string {
    // For iTunes API, put track first, then artist, then album for better results
    const parts: string[] = [];
    
    if (track) parts.push(track);
    if (artist) parts.push(artist);
    if (album) parts.push(album);
    
    return parts.join(' ');
  }
}