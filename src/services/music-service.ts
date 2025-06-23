
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

export abstract class MusicService {
  protected config: MusicServiceConfig;
  protected account?: ServiceAccount;

  constructor(config: MusicServiceConfig) {
    this.config = config;
  }

  setAccount(account: ServiceAccount): void {
    this.account = account;
  }

  abstract search(type: 'album' | 'song' | 'station', term: string, country?: string): Promise<MusicSearchResult[]>;
  
  abstract generateURI(type: 'album' | 'song' | 'station', result: MusicSearchResult): string;
  
  abstract generateMetadata(type: 'album' | 'song' | 'station', result: MusicSearchResult): string;

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
    
    return encodeURIComponent(term);
  }

  protected formatSearchTerm(artist: string, album: string, track: string): string {
    // Default implementation - services can override
    const parts = [artist, album, track].filter(Boolean);
    return encodeURIComponent(parts.join(' '));
  }
}