import { MusicLibraryService, MusicSearchResult } from './music-library-service.js';
import logger from '../utils/logger.js';
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
  private reindexTimer?: NodeJS.Timeout;
  private onStatsUpdate?: (stats: any) => void;

  constructor(deviceIP: string, cacheDir: string = './cache', onStatsUpdate?: (stats: any) => void) {
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
    } catch (error) {
      logger.info('No cache found, starting initial index...');
      await this.startBackgroundIndex();
    }
  }

  private isCacheStale(): boolean {
    if (!this.metadata) return true;
    const age = Date.now() - new Date(this.metadata.lastUpdated).getTime();
    return age > 24 * 60 * 60 * 1000; // 24 hours
  }

  async search(keyword: string, field: 'title' | 'artist' | 'album' = 'title', maxResults: number = 50): Promise<MusicSearchResult[]> {
    const searchText = keyword.toLowerCase();
    const results: CachedTrack[] = [];

    if (field === 'title') {
      // Direct search through all tracks
      for (const track of this.tracks.values()) {
        if (track.titleLower.includes(searchText)) {
          results.push(track);
          if (results.length >= maxResults) break;
        }
      }
    } else if (field === 'artist') {
      // Use artist index
      for (const [artist, trackIds] of this.artistIndex.entries()) {
        if (artist.toLowerCase().includes(searchText)) {
          for (const trackId of trackIds) {
            const track = this.tracks.get(trackId);
            if (track) {
              results.push(track);
              if (results.length >= maxResults) break;
            }
          }
          if (results.length >= maxResults) break;
        }
      }
    } else if (field === 'album') {
      // Use album index
      for (const [album, trackIds] of this.albumIndex.entries()) {
        if (album.toLowerCase().includes(searchText)) {
          for (const trackId of trackIds) {
            const track = this.tracks.get(trackId);
            if (track) {
              results.push(track);
              if (results.length >= maxResults) break;
            }
          }
          if (results.length >= maxResults) break;
        }
      }
    }

    return results.slice(0, maxResults);
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
              albumArtURI: track.albumArtURI,
              titleLower: track.title.toLowerCase(),
              artistLower: (track.artist || '').toLowerCase(),
              albumLower: (track.album || '').toLowerCase()
            };

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
    if (this.reindexTimer) {
      clearInterval(this.reindexTimer);
      this.reindexTimer = undefined;
    }

    if (!intervalString) {
      logger.info('No reindex interval configured');
      return;
    }

    const intervalMs = this.parseInterval(intervalString);
    logger.info(`Setting music library reindex interval to ${intervalString} (${intervalMs}ms)`);

    // Set up the timer
    this.reindexTimer = setInterval(async () => {
      logger.info('Starting scheduled music library reindex');
      try {
        await this.startBackgroundIndex();
      } catch (error) {
        logger.error('Failed to perform scheduled reindex:', error);
      }
    }, intervalMs);

    // Don't block on process exit
    if (this.reindexTimer.unref) {
      this.reindexTimer.unref();
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.reindexTimer) {
      clearInterval(this.reindexTimer);
      this.reindexTimer = undefined;
    }
  }
}