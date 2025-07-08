import { MusicLibraryService, MusicSearchResult } from './music-library-service.js';
import logger from '../utils/logger.js';
import { scheduler } from '../utils/scheduler.js';
import fs from 'fs/promises';
import path from 'path';

interface CachedTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  uri: string;
  albumArtURI?: string;
  titleLower: string;
  artistLower: string;
  albumLower: string;
}

interface CacheMetadata {
  lastUpdated: Date;
  totalTracks: number;
  totalAlbums: number;
  totalArtists: number;
  totalArtistEntries: number;
  indexingDuration: number;
  isComplete: boolean;
}

export class MusicLibraryCache {
  private tracks: Map<string, CachedTrack> = new Map();
  private albumIndex: Map<string, Set<string>> = new Map(); // album -> track IDs
  private artistIndex: Map<string, Set<string>> = new Map(); // artist -> track IDs
  private artistList: string[] = []; // Cached list of all artists from A:ALBUMARTIST
  private metadata: CacheMetadata | null = null;
  private isIndexing: boolean = false;
  private indexingProgress: number = 0;
  private cacheFile: string;
  private libraryService: MusicLibraryService;
  private readonly REINDEX_TASK_ID = 'music-library-reindex';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onStatsUpdate?: ((stats: any) => void) | undefined; // ANY IS CORRECT: stats object contains dynamic properties

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(deviceIP: string, cacheDir: string = './cache', onStatsUpdate?: (stats: any) => void) { // ANY IS CORRECT: stats object contains dynamic properties
    this.libraryService = new MusicLibraryService(deviceIP);
    this.cacheFile = path.join(cacheDir, 'music-library.json');
    this.onStatsUpdate = onStatsUpdate;
  }

  async initialize(): Promise<void> {
    // Try to load existing cache
    try {
      await this.loadCache();
      logger.info(`Loaded music library cache with ${this.tracks.size} tracks`);
      
      // Report loaded cache stats
      if (this.onStatsUpdate && this.metadata) {
        this.onStatsUpdate({
          metadata: this.metadata,
          cacheFile: this.cacheFile,
          isComplete: true,
          error: null,
          fromCache: true
        });
      }
      
      // Start background refresh if cache is older than 24 hours
      if (this.metadata && this.isCacheStale()) {
        logger.info('Cache is stale, starting background refresh...');
        this.startBackgroundIndex();
      }
    } catch (_error) {
      logger.info('No cache found, starting initial index...');
      await this.startBackgroundIndex();
    }
  }

  private isCacheStale(): boolean {
    if (!this.metadata) return true;
    const age = Date.now() - new Date(this.metadata.lastUpdated).getTime();
    return age > 24 * 60 * 60 * 1000; // 24 hours
  }

  async search(keyword: string, field: 'title' | 'artist' | 'album' = 'title', _maxResults: number = 50): Promise<MusicSearchResult[]> {
    const searchText = keyword.toLowerCase();
    const results: CachedTrack[] = [];
    const randomQueueLimit = 100; // Default random queue limit

    // Parse all possible matches
    let trackMatch = searchText.match(/track:\s*([^:]+?)(?:\s+(?:artist|album):|$)/);
    let artistMatch = searchText.match(/artist:\s*([^:]+?)(?:\s+(?:track|album):|$)/);
    let albumMatch = searchText.match(/album:\s*([^:]+?)(?:\s+(?:track|artist):|$)/);
    let titleMatch = searchText.match(/^\s*([^:]+?)(?:\s+(?:track|artist|album):|$)/);
    
    // Extract and trim values - already lowercase since searchText is lowercase
    let trackQuery = trackMatch?.[1]?.trim() || '';
    let artistQuery = artistMatch?.[1]?.trim() || '';
    let albumQuery = albumMatch?.[1]?.trim() || '';
    let titleQuery = titleMatch?.[1]?.trim() || '';
    
    // Field-based prefix handling
    if (field === 'artist' && !artistMatch) {
      artistQuery = titleQuery;
      titleQuery = '';
    } else if (field === 'album' && !albumMatch) {
      albumQuery = titleQuery;
      titleQuery = '';
    } else if (field === 'title') {
      if (trackMatch) {
        titleQuery = '';
      }
      // Otherwise leave titleQuery as is
    }
    
    logger.debug(`Library search - field: ${field}, keyword: "${keyword}"`);
    logger.debug(`Parsed queries - track: "${trackQuery}", artist: "${artistQuery}", album: "${albumQuery}", title: "${titleQuery}"`);
    
    // If no matches at all, return random songs
    if (!trackQuery && !artistQuery && !albumQuery && !titleQuery) {
      const allTracks = Array.from(this.tracks.values());
      const shuffled = allTracks.sort(() => Math.random() - 0.5);
      return shuffled.slice(0, randomQueueLimit).map(track => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        uri: track.uri,
        type: 'track' as const
      }));
    }
    
    // If trackMatch and titleMatch, discard titleMatch
    if (trackQuery && titleQuery) {
      titleQuery = '';
    }
    
    // If titleMatch and artistMatch and albumMatch, set trackMatch = titleMatch, discard titleMatch
    if (titleQuery && artistQuery && albumQuery) {
      trackQuery = titleQuery;
      titleQuery = '';
    }
    
    // Helper function for artist tail matching
    const artistMatches = (trackArtist: string, queryArtist: string): boolean => {
      if (!queryArtist) return true;
      if (trackArtist.includes(queryArtist)) return true;
      // Check for tail match (e.g., "The Rolling Stones" matches "Rolling Stones")
      if (trackArtist.endsWith(queryArtist)) return true;
      // Also check if removing "the " prefix helps
      if (trackArtist.startsWith('the ') && trackArtist.substring(4) === queryArtist) return true;
      return false;
    };
    
    // If trackMatch and artistMatch and albumMatch
    if (trackQuery && artistQuery && albumQuery) {
      for (const track of this.tracks.values()) {
        if (track.titleLower.includes(trackQuery) && 
            artistMatches(track.artistLower, artistQuery) && 
            track.albumLower.includes(albumQuery)) {
          results.push(track);
        }
      }
      return results.map(track => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        uri: track.uri,
        type: 'track' as const
      }));
    }
    
    // If no titleMatch
    if (!titleQuery) {
      if (albumQuery && !trackQuery && !artistQuery) {
        // Return tracks matching album (first album only)
        let foundAlbum = '';
        for (const track of this.tracks.values()) {
          if (track.albumLower.includes(albumQuery)) {
            if (!foundAlbum) foundAlbum = track.album;
            if (track.album === foundAlbum) {
              results.push(track);
            }
          }
        }
        // If no results found, move albumQuery to titleQuery for fuzzy matching
        if (results.length === 0) {
          titleQuery = albumQuery;
          albumQuery = '';
          logger.trace(`No exact album matches for "${titleQuery}", trying fuzzy match`);
          // Fall through to fuzzy matching
        }
      } else if (trackQuery && !albumQuery && !artistQuery) {
        // Return tracks matching track title
        for (const track of this.tracks.values()) {
          if (track.titleLower.includes(trackQuery)) {
            results.push(track);
          }
        }
      } else if (trackQuery && albumQuery && !artistQuery) {
        // Return tracks matching both track and album
        for (const track of this.tracks.values()) {
          if (track.titleLower.includes(trackQuery) && track.albumLower.includes(albumQuery)) {
            results.push(track);
          }
        }
      } else if (artistQuery && !trackQuery && !albumQuery) {
        // Return tracks matching artist
        for (const track of this.tracks.values()) {
          if (artistMatches(track.artistLower, artistQuery)) {
            results.push(track);
          }
        }
        // If no results found, move artistQuery to titleQuery for fuzzy matching
        if (results.length === 0) {
          titleQuery = artistQuery;
          artistQuery = '';
          logger.trace(`No exact artist matches for "${titleQuery}", trying fuzzy match`);
          // Fall through to fuzzy matching
        }
      } else if (artistQuery && trackQuery) {
        // Return tracks matching artist and track
        for (const track of this.tracks.values()) {
          if (track.titleLower.includes(trackQuery) && artistMatches(track.artistLower, artistQuery)) {
            results.push(track);
          }
        }
      } else if (artistQuery && albumQuery) {
        // Return tracks matching artist and album
        for (const track of this.tracks.values()) {
          if (track.albumLower.includes(albumQuery) && artistMatches(track.artistLower, artistQuery)) {
            results.push(track);
          }
        }
      }
    }
    
    // Check if we need to do fuzzy matching (either we had titleQuery from the start or from fallback)
    if (titleQuery && results.length === 0) {
      // Specific match logic when we have both titleQuery and other queries
      if (albumQuery && !artistQuery) {
        // Return tracks matching album AND where title contains titleMatch
        let foundAlbum = '';
        for (const track of this.tracks.values()) {
          if (track.albumLower.includes(albumQuery) && track.titleLower.includes(titleQuery)) {
            if (!foundAlbum) foundAlbum = track.album;
            if (track.album === foundAlbum) {
              results.push(track);
            }
          }
        }
      } else if (artistQuery && !albumQuery) {
        // Return tracks matching artist AND where title contains titleMatch
        for (const track of this.tracks.values()) {
          if (artistMatches(track.artistLower, artistQuery) && track.titleLower.includes(titleQuery)) {
            results.push(track);
          }
        }
      }
      
      // If still no results, do fuzzy matching on titleQuery alone
      if (results.length === 0) {
        // Do fuzzy matching
        logger.trace(`Entering fuzzy match logic - titleQuery: "${titleQuery}", field: ${field}`);
        
        type MatchResult = {
          item: CachedTrack;
          artistMatch: boolean;
          albumMatch: boolean;
          titleMatch: boolean;
        };
        
        const matches: MatchResult[] = [];
        let haveArtistMatch = false;
        let haveAlbumMatch = false;
        let haveTitleMatch = false;
        
        // When field='album' or we came from album fallback, prefer album matches
        const preferAlbum = field === 'album';
        
        // First pass: look for exact matches
        const exactMatches: MatchResult[] = [];
        let haveExactArtistMatch = false;
        let haveExactAlbumMatch = false;
        let haveExactTitleMatch = false;
        
        for (const item of this.tracks.values()) {
          const match: MatchResult = {
            item,
            artistMatch: false,
            albumMatch: false,
            titleMatch: false
          };
          
          let hasAnyMatch = false;
          
          // Check for exact matches
          if (item.artistLower === titleQuery) {
            match.artistMatch = true;
            haveExactArtistMatch = true;
            hasAnyMatch = true;
          }
          
          if (item.albumLower === titleQuery) {
            match.albumMatch = true;
            haveExactAlbumMatch = true;
            hasAnyMatch = true;
          }
          
          if (item.titleLower === titleQuery) {
            match.titleMatch = true;
            haveExactTitleMatch = true;
            hasAnyMatch = true;
          }
          
          if (hasAnyMatch) {
            exactMatches.push(match);
          }
        }
        
        // If we have exact matches, use only those
        if (exactMatches.length > 0) {
          logger.trace(`Found ${exactMatches.length} exact matches`);
          matches.push(...exactMatches);
          haveArtistMatch = haveExactArtistMatch;
          haveAlbumMatch = haveExactAlbumMatch;
          haveTitleMatch = haveExactTitleMatch;
        } else {
          logger.trace('No exact matches, doing fuzzy matching');
          // No exact matches, do fuzzy matching
          for (const item of this.tracks.values()) {
            const match: MatchResult = {
              item,
              artistMatch: false,
              albumMatch: false,
              titleMatch: false
            };
            
            let hasAnyMatch = false;
            
            // Check if artist matches at start of query or query starts with artist
            if (titleQuery.startsWith(item.artistLower) || item.artistLower.startsWith(titleQuery)) {
              match.artistMatch = true;
              haveArtistMatch = true;
              hasAnyMatch = true;
            }
            
            // Check if album matches at start of query or query starts with album
            if (titleQuery.startsWith(item.albumLower) || item.albumLower.startsWith(titleQuery)) {
              match.albumMatch = true;
              haveAlbumMatch = true;
              hasAnyMatch = true;
            }
            
            // Check if title matches at start of query or query starts with title
            if (titleQuery.startsWith(item.titleLower) || item.titleLower.startsWith(titleQuery)) {
              match.titleMatch = true;
              haveTitleMatch = true;
              hasAnyMatch = true;
            }
            
            if (hasAnyMatch) {
              matches.push(match);
            }
          }
        }
        
        logger.trace(`Total matches: ${matches.length}, haveArtist: ${haveArtistMatch}, haveAlbum: ${haveAlbumMatch}, haveTitle: ${haveTitleMatch}`);
        
        // Filter results based on what types of matches we found
        let filteredMatches = matches;
        
        if (preferAlbum && haveAlbumMatch) {
          // When field='album', prioritize album matches
          if (haveArtistMatch) {
            // If we have both album and artist matches, prefer items that match both
            const albumAndArtistMatches = matches.filter(m => m.albumMatch && m.artistMatch);
            if (albumAndArtistMatches.length > 0) {
              // Return all tracks from the first matching album
              const firstAlbum = albumAndArtistMatches[0]!.item.album;
              filteredMatches = albumAndArtistMatches.filter(m => m.item.album === firstAlbum);
            } else {
              // No items match both, just use album matches
              const albumMatches = matches.filter(m => m.albumMatch);
              if (albumMatches.length > 0) {
                const firstAlbum = albumMatches[0]!.item.album;
                filteredMatches = albumMatches.filter(m => m.item.album === firstAlbum);
              }
            }
          } else {
            // Only album matches, return tracks from first matching album
            const albumMatches = matches.filter(m => m.albumMatch);
            if (albumMatches.length > 0) {
              const firstAlbum = albumMatches[0]!.item.album;
              filteredMatches = albumMatches.filter(m => m.item.album === firstAlbum);
            }
          }
        } else {
          // Original filtering logic for non-album searches
          if (haveArtistMatch && haveAlbumMatch && haveTitleMatch) {
            // If we have all three types of matches, only keep items that match all three
            filteredMatches = matches.filter(m => m.artistMatch && m.albumMatch && m.titleMatch);
          } else if (haveAlbumMatch && haveTitleMatch) {
            // If we have album and title matches, keep items that match both
            filteredMatches = matches.filter(m => m.albumMatch && m.titleMatch);
          } else if (haveArtistMatch && haveTitleMatch) {
            // If we have artist and title matches, keep items that match both
            filteredMatches = matches.filter(m => m.artistMatch && m.titleMatch);
          } else if (haveArtistMatch && haveAlbumMatch) {
            // If we have artist and album matches, keep items that match both
            filteredMatches = matches.filter(m => m.artistMatch && m.albumMatch);
          }
          // Otherwise keep all matches as is
          
          // If filtering resulted in no matches but we had some, try album-first strategy
          if (filteredMatches.length === 0 && matches.length > 0 && haveAlbumMatch) {
            // Get tracks from the first matching album
            const albumMatches = matches.filter(m => m.albumMatch);
            if (albumMatches.length > 0) {
              const firstAlbum = albumMatches[0]!.item.album;
              filteredMatches = albumMatches.filter(m => m.item.album === firstAlbum);
            }
          }
        }
        
        logger.trace(`Filtered matches: ${filteredMatches.length}`);
        
        // Add all filtered results (limit will be applied at the end)
        for (const match of filteredMatches) {
          results.push(match.item);
        }
      }
    }
    
    return results.slice(0, randomQueueLimit).map(track => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      uri: track.uri,
      type: 'track' as const
    }));
  }

  async searchArtists(keyword: string): Promise<string[]> {
    const searchText = keyword.toLowerCase();
    return this.artistList.filter(artist => 
      artist.toLowerCase().includes(searchText)
    );
  }

  async getAllArtists(): Promise<string[]> {
    return [...this.artistList];
  }

  async getAlbumsByArtist(artistName: string): Promise<string[]> {
    const albums = new Set<string>();
    const trackIds = this.artistIndex.get(artistName);
    
    if (trackIds) {
      for (const trackId of trackIds) {
        const track = this.tracks.get(trackId);
        if (track) {
          albums.add(track.album);
        }
      }
    }
    
    return Array.from(albums).sort();
  }

  async getTracksByArtist(artistName: string, maxResults: number = 50): Promise<MusicSearchResult[]> {
    const results: CachedTrack[] = [];
    const trackIds = this.artistIndex.get(artistName);
    
    if (trackIds) {
      for (const trackId of trackIds) {
        const track = this.tracks.get(trackId);
        if (track) {
          results.push(track);
          if (results.length >= maxResults) break;
        }
      }
    }
    
    return results.slice(0, maxResults);
  }

  async startBackgroundIndex(): Promise<void> {
    if (this.isIndexing) {
      logger.warn('Indexing already in progress');
      return;
    }

    this.isIndexing = true;
    this.indexingProgress = 0;

    // Run indexing in background
    this.indexMusic().catch(error => {
      logger.error('Music library indexing failed:', error);
      this.isIndexing = false;
    });
  }

  private async indexMusic(): Promise<void> {
    const startTime = Date.now();
    const newTracks = new Map<string, CachedTrack>();
    const newAlbumIndex = new Map<string, Set<string>>();
    const newArtistIndex = new Map<string, Set<string>>();
    const newArtistList: string[] = [];

    try {
      logger.info('Starting music library indexing...');

      // First, get all artists from the artist index
      logger.info('Fetching artist list...');
      const { totalMatches: totalArtists } = await this.libraryService.browse('A:ALBUMARTIST', 0, 1);
      let artistStartIndex = 0;
      
      while (artistStartIndex < totalArtists) {
        const { items: artistBatch } = await this.libraryService.browse('A:ALBUMARTIST', artistStartIndex, 500);
        for (const artist of artistBatch) {
          if (artist.type === 'container' && artist.title) {
            newArtistList.push(artist.title);
          }
        }
        artistStartIndex += 500;
      }
      
      logger.info(`Found ${newArtistList.length} artists`);

      // Get total track count
      const { totalMatches: totalTracks } = await this.libraryService.browse('A:TRACKS', 0, 1);
      logger.info(`Found ${totalTracks} tracks to index`);

      let tracksProcessed = 0;
      let startingIndex = 0;
      const batchSize = 500; // Process 500 tracks at a time

      while (startingIndex < totalTracks) {
        const { items: trackBatch } = await this.libraryService.browse('A:TRACKS', startingIndex, batchSize);
        
        for (const track of trackBatch) {
          if (track.type === 'item' && track.res) {
            const cachedTrack: CachedTrack = {
              id: track.id,
              title: track.title,
              artist: track.artist || 'Unknown Artist',
              album: track.album || 'Unknown Album',
              uri: track.res,
              titleLower: track.title.toLowerCase(),
              artistLower: (track.artist || '').toLowerCase(),
              albumLower: (track.album || '').toLowerCase()
            };
            
            if (track.albumArtURI) {
              cachedTrack.albumArtURI = track.albumArtURI;
            }

            newTracks.set(track.id, cachedTrack);

            // Update album index
            if (!newAlbumIndex.has(cachedTrack.album)) {
              newAlbumIndex.set(cachedTrack.album, new Set());
            }
            newAlbumIndex.get(cachedTrack.album)!.add(track.id);

            // Update artist index
            if (!newArtistIndex.has(cachedTrack.artist)) {
              newArtistIndex.set(cachedTrack.artist, new Set());
            }
            newArtistIndex.get(cachedTrack.artist)!.add(track.id);
          }
        }
        
        tracksProcessed += trackBatch.length;
        startingIndex += batchSize;
        this.indexingProgress = (tracksProcessed / totalTracks) * 100;
        
        if (tracksProcessed % 5000 === 0 || tracksProcessed === totalTracks) {
          logger.info(`Indexing progress: ${this.indexingProgress.toFixed(1)}% (${tracksProcessed}/${totalTracks} tracks)`);
        }
        
        // Small delay every 5000 tracks to avoid hammering the device
        if (tracksProcessed % 5000 === 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Replace old cache with new one
      this.tracks = newTracks;
      this.albumIndex = newAlbumIndex;
      this.artistIndex = newArtistIndex;
      this.artistList = newArtistList;

      const duration = Date.now() - startTime;
      this.metadata = {
        lastUpdated: new Date(),
        totalTracks: newTracks.size,
        totalAlbums: newAlbumIndex.size,
        totalArtists: newArtistIndex.size,
        totalArtistEntries: newArtistList.length,
        indexingDuration: duration,
        isComplete: true
      };

      // Save cache to disk
      await this.saveCache();

      logger.info('Music library indexing complete', {
        totalTracks: this.metadata.totalTracks,
        totalAlbums: this.metadata.totalAlbums,
        totalUniqueArtists: this.metadata.totalArtists,
        totalArtistEntries: this.metadata.totalArtistEntries,
        durationSeconds: Number((duration / 1000).toFixed(1)),
        tracksPerSecond: Number((this.metadata.totalTracks / (duration / 1000)).toFixed(0))
      });

      // Report stats to callback if provided
      if (this.onStatsUpdate) {
        this.onStatsUpdate({
          metadata: this.metadata,
          cacheFile: this.cacheFile,
          isComplete: true,
          error: null
        });
      }

    } catch (error) {
      logger.error('Music library indexing failed:', error);
      
      // Report error to callback if provided
      if (this.onStatsUpdate) {
        this.onStatsUpdate({
          metadata: this.metadata,
          cacheFile: this.cacheFile,
          isComplete: false,
          error: (error as Error).message
        });
      }
      
      throw error;
    } finally {
      this.isIndexing = false;
      this.indexingProgress = 100;
    }
  }

  private async saveCache(): Promise<void> {
    try {
      const cacheData = {
        metadata: this.metadata,
        tracks: Array.from(this.tracks.entries()),
        albumIndex: Array.from(this.albumIndex.entries()).map(([album, trackIds]) => [album, Array.from(trackIds)]),
        artistIndex: Array.from(this.artistIndex.entries()).map(([artist, trackIds]) => [artist, Array.from(trackIds)]),
        artistList: this.artistList
      };

      const dir = path.dirname(this.cacheFile);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify(cacheData), 'utf8');
      logger.debug('Music library cache saved to disk');
    } catch (error) {
      logger.error('Failed to save music library cache:', error);
    }
  }

  private async loadCache(): Promise<void> {
    const data = await fs.readFile(this.cacheFile, 'utf8');
    const cacheData = JSON.parse(data);

    this.metadata = cacheData.metadata;
    this.tracks = new Map(cacheData.tracks);
    this.albumIndex = new Map(cacheData.albumIndex.map(([album, trackIds]: [string, string[]]) => [album, new Set(trackIds)]));
    this.artistIndex = new Map(cacheData.artistIndex.map(([artist, trackIds]: [string, string[]]) => [artist, new Set(trackIds)]));
    this.artistList = cacheData.artistList || [];
  }

  getStatus(): { isIndexing: boolean; progress: number; metadata: CacheMetadata | null } {
    return {
      isIndexing: this.isIndexing,
      progress: this.indexingProgress,
      metadata: this.metadata
    };
  }

  getDetailedData(): { 
    tracks: CachedTrack[]; 
    artists: Array<{ name: string; trackCount: number }>;
    albums: Array<{ name: string; trackCount: number }>;
    artistList: string[];
    } {
    // Convert tracks Map to array
    const tracks = Array.from(this.tracks.values());
    
    // Convert artist index to array with counts
    const artists = Array.from(this.artistIndex.entries()).map(([name, trackIds]) => ({
      name,
      trackCount: trackIds.size
    })).sort((a, b) => b.trackCount - a.trackCount);
    
    // Convert album index to array with counts
    const albums = Array.from(this.albumIndex.entries()).map(([name, trackIds]) => ({
      name,
      trackCount: trackIds.size
    })).sort((a, b) => b.trackCount - a.trackCount);
    
    return {
      tracks,
      artists,
      albums,
      artistList: this.artistList
    };
  }

  getSummary(): {
    totalTracks: number;
    totalArtists: number;
    totalAlbums: number;
    topArtists: Array<{ name: string; trackCount: number }>;
    topAlbums: Array<{ name: string; trackCount: number }>;
    } {
    const artists = Array.from(this.artistIndex.entries()).map(([name, trackIds]) => ({
      name,
      trackCount: trackIds.size
    })).sort((a, b) => b.trackCount - a.trackCount);
    
    const albums = Array.from(this.albumIndex.entries()).map(([name, trackIds]) => ({
      name,
      trackCount: trackIds.size
    })).sort((a, b) => b.trackCount - a.trackCount);
    
    return {
      totalTracks: this.tracks.size,
      totalArtists: this.artistIndex.size,
      totalAlbums: this.albumIndex.size,
      topArtists: artists.slice(0, 20),
      topAlbums: albums.slice(0, 20)
    };
  }

  async refreshCache(): Promise<void> {
    logger.info('Manual cache refresh requested');
    await this.startBackgroundIndex();
  }

  /**
   * Parse interval string (e.g., "1 week", "2 days", "24 hours") to milliseconds
   */
  private parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)\s*(h|hours?|d|days?|w|weeks?)$/i);
    if (!match) {
      logger.warn(`Invalid reindex interval format: ${interval}, using default of 1 week`);
      return 7 * 24 * 60 * 60 * 1000; // 1 week default
    }

    const value = parseInt(match[1]!, 10);
    const unit = match[2]!.toLowerCase();

    let multiplier: number;
    if (unit.startsWith('h')) {
      multiplier = 60 * 60 * 1000; // hours to ms
    } else if (unit.startsWith('d')) {
      multiplier = 24 * 60 * 60 * 1000; // days to ms
    } else if (unit.startsWith('w')) {
      multiplier = 7 * 24 * 60 * 60 * 1000; // weeks to ms
    } else {
      multiplier = 7 * 24 * 60 * 60 * 1000; // default to weeks
    }

    return value * multiplier;
  }

  /**
   * Set up periodic reindexing
   */
  setReindexInterval(intervalString?: string): void {
    // Clear existing timer
    scheduler.clearTask(this.REINDEX_TASK_ID);

    if (!intervalString) {
      logger.info('No reindex interval configured');
      return;
    }

    const intervalMs = this.parseInterval(intervalString);
    logger.info(`Setting music library reindex interval to ${intervalString} (${intervalMs}ms)`);

    // Set up the timer using scheduler
    scheduler.scheduleInterval(
      this.REINDEX_TASK_ID,
      async () => {
        logger.info('Starting scheduled music library reindex');
        try {
          await this.startBackgroundIndex();
        } catch (error) {
          logger.error('Failed to perform scheduled reindex:', error);
        }
      },
      intervalMs,
      { unref: true }
    );
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    scheduler.clearTask(this.REINDEX_TASK_ID);
  }
}