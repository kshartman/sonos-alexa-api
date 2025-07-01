
export interface MusicSearchResult {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  uri?: string;
  metadata?: string;
}

export interface MusicServiceConfig {
  country: string;
  search: {
    album: string;
    song: string;
    station: string;
  };
  metaStart: {
    album: string;
    song: string;
    station: string;
  };
  parent: {
    album: string;
    song: string;
    station: string;
  };
  objectClass: {
    album: string;
    song: string;
    station: string;
  };
}

export interface ServiceAccount {
  id: string;
  serialNumber: string;
  sid: string;
}

/**
 * Base class for music service implementations.
 * Provides common functionality for searching and generating URIs/metadata.
 * Subclasses must implement search, generateURI, and generateMetadata.
 */
export abstract class MusicService {
  protected config: MusicServiceConfig;
  protected account?: ServiceAccount;

  constructor(config: MusicServiceConfig) {
    this.config = config;
  }

  /**
   * Sets the service account for authenticated requests.
   * @param account - Service account with ID and credentials
   */
  setAccount(account: ServiceAccount): void {
    this.account = account;
  }

  /**
   * Searches the music service for content.
   * @param type - Type of content to search for
   * @param term - Search query
   * @param country - Optional country code for localized results
   * @returns Array of search results
   */
  abstract search(type: 'album' | 'song' | 'station', term: string, country?: string): Promise<MusicSearchResult[]>;
  
  /**
   * Generates a Sonos-compatible URI for the content.
   * @param type - Type of content
   * @param result - Search result to generate URI for
   * @returns Sonos URI string
   */
  abstract generateURI(type: 'album' | 'song' | 'station', result: MusicSearchResult): string;
  
  /**
   * Generates DIDL-Lite metadata for the content.
   * @param type - Type of content
   * @param result - Search result to generate metadata for
   * @returns DIDL-Lite XML string
   */
  abstract generateMetadata(type: 'album' | 'song' | 'station', result: MusicSearchResult): string;

  /**
   * Processes search terms with special prefixes.
   * Extracts artist:, album:, and track: prefixes from search query.
   * @param _type - Content type (unused in base implementation)
   * @param term - Raw search term
   * @returns Processed search term
   */
  protected processSearchTerm(_type: string, term: string): string {
    // Handle search prefixes like "artist:", "track:", "album:"
    if (term.indexOf(':') > -1) {
      const artistPos = term.indexOf('artist:');
      const albumPos = term.indexOf('album:');
      const trackPos = term.indexOf('track:');
      
      let artist = '';
      let album = '';
      let track = '';
      
      if (artistPos > -1) {
        const nextPos = Math.min(
          ...[albumPos, trackPos].filter(pos => pos > artistPos && pos !== -1)
        );
        artist = term.substring(artistPos + 7, nextPos === Infinity ? term.length : nextPos).trim();
      }
      
      if (albumPos > -1) {
        const nextPos = Math.min(
          ...[artistPos, trackPos].filter(pos => pos > albumPos && pos !== -1)
        );
        album = term.substring(albumPos + 6, nextPos === Infinity ? term.length : nextPos).trim();
      }
      
      if (trackPos > -1) {
        const nextPos = Math.min(
          ...[artistPos, albumPos].filter(pos => pos > trackPos && pos !== -1)
        );
        track = term.substring(trackPos + 6, nextPos === Infinity ? term.length : nextPos).trim();
      }
      
      return this.formatSearchTerm(artist, album, track);
    }
    
    return term;
  }

  /**
   * Formats extracted search components into a single search string.
   * Subclasses can override for service-specific formatting.
   * @param artist - Artist name
   * @param album - Album name
   * @param track - Track name
   * @returns Formatted search term
   */
  protected formatSearchTerm(artist: string, album: string, track: string): string {
    // Default implementation - services can override
    const parts = [artist, album, track].filter(Boolean);
    return parts.join(' ');
  }
}