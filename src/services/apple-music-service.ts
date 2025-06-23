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

  generateMetadata(type: 'album' | 'song' | 'station', result: MusicSearchResult): string {
    const metaId = this.config.metaStart[type] + result.id;
    const parentId = this.config.parent[type] + result.id;
    const objectClass = this.config.objectClass[type];
    
    return `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
      <item id="${metaId}" parentID="${parentId}" restricted="true">
        <dc:title>${this.escapeXml(result.title)}</dc:title>
        <upnp:class>${objectClass}</upnp:class>
        <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON52231_X_#Svc52231-0-Token</desc>
      </item>
    </DIDL-Lite>`;
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
    // Apple Music combines all terms with spaces
    const parts = [artist, album, track].filter(Boolean);
    return encodeURIComponent(parts.join(' '));
  }
}