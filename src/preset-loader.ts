import { readdir, readFile, stat } from 'fs/promises';
import { watch as watchFs } from 'fs';
import { join } from 'path';
import logger from './utils/logger.js';
import { debugManager } from './utils/debug-manager.js';
import { tryConvertPreset, type PresetWithLegacy } from './utils/preset-converter.js';
import type { PresetCollection, Preset, Config } from './types/sonos.js';
import type { SonosDiscovery } from './discovery.js';
import { SpotifyService } from './services/spotify-service.js';

interface PresetStats {
  totalFiles: number;
  validPresets: number;
  failedResolution: number;
  invalidFormat: number;
  parseErrors: number;
  legacyConverted: number;
  invalidRooms: number;
}

interface PresetLoadResult {
  stats: PresetStats;
  validPresets: string[];
  failedPresets: string[];
  invalidPresets: string[];
  parseErrors: string[];
  invalidRooms: string[];
  allPresets: PresetCollection;
}

export class PresetLoader {
  private presetDir: string;
  private presets: PresetCollection = {};
  private watchTimeout?: NodeJS.Timeout;
  private watcher?: ReturnType<typeof watchFs>;
  private discovery?: SonosDiscovery;
  private onStatsUpdate?: (stats: PresetLoadResult) => void;
  private config?: Config;

  constructor(presetDir = './presets', discovery?: SonosDiscovery, onStatsUpdate?: (stats: PresetLoadResult) => void, config?: Config) {
    this.presetDir = presetDir;
    this.discovery = discovery;
    this.onStatsUpdate = onStatsUpdate;
    this.config = config;
  }

  async init(): Promise<void> {
    await this.loadPresets();
    await this.startWatching();
  }

  private async loadPresets(): Promise<void> {
    const newPresets: PresetCollection = {};
    const stats = {
      totalFiles: 0,
      validPresets: 0,
      failedResolution: 0,
      invalidFormat: 0,
      parseErrors: 0,
      legacyConverted: 0,
      invalidRooms: 0
    };
    const validPresetNames: string[] = [];
    const failedResolutionNames: string[] = [];
    const invalidFormatNames: string[] = [];
    const parseErrorNames: string[] = [];
    const invalidRoomNames: string[] = [];
    
    try {
      const files = await readdir(this.presetDir);
      
      for (const file of files) {
        if (file.startsWith('.') || !file.endsWith('.json')) {
          continue;
        }
        
        stats.totalFiles++;
        const fullPath = join(this.presetDir, file);
        const stats_file = await stat(fullPath);
        
        if (!stats_file.isFile()) {
          continue;
        }
        
        try {
          const content = await readFile(fullPath, 'utf-8');
          const rawPreset = JSON.parse(content);
          // Always use the filename (which could be a symlink name) as the preset name
          const presetName = file.replace(/\.json$/i, '');
          
          try {
            // Try to convert the preset (handles both new and legacy formats)
            const convertedPreset = tryConvertPreset(rawPreset, presetName);
            
            // Check if this was a legacy preset conversion
            if ('_legacy' in convertedPreset) {
              stats.legacyConverted++;
              
              // Validate and filter room names in legacy presets
              const roomValidation = this.validateAndFilterRooms(convertedPreset, presetName);
              if (roomValidation.hasInvalidRooms) {
                stats.invalidRooms++;
                invalidRoomNames.push(presetName);
                logger.warn(`Preset ${presetName}: Removed invalid rooms - ${roomValidation.invalidRooms?.join(', ')}`);
                debugManager.debug('presets', `Preset ${presetName}: Invalid rooms removed - ${roomValidation.message}`);
              }
            }
            
            // Resolve favorites to actual URIs if discovery is available
            const resolvedPreset = await this.resolveFavorites(convertedPreset, presetName);
            
            // Check if resolution was successful
            if (resolvedPreset.uri.startsWith('favorite:')) {
              // Favorite was not resolved
              stats.failedResolution++;
              failedResolutionNames.push(presetName);
              debugManager.debug('presets', `Preset ${presetName}: Failed to resolve favorite ${resolvedPreset.uri}`);
            } else if (resolvedPreset.uri.startsWith('spotifyUrl:')) {
              // Spotify URL was not resolved
              stats.failedResolution++;
              failedResolutionNames.push(presetName);
              debugManager.debug('presets', `Preset ${presetName}: Failed to resolve Spotify URL ${resolvedPreset.uri}`);
            } else if (resolvedPreset.uri.startsWith('placeholder:')) {
              // Invalid preset (no content)
              stats.invalidFormat++;
              invalidFormatNames.push(presetName);
              debugManager.debug('presets', `Preset ${presetName}: No playable content`);
            } else {
              // Valid preset
              stats.validPresets++;
              validPresetNames.push(presetName);
              debugManager.debug('presets', `Loaded preset: ${presetName} -> ${resolvedPreset.uri.substring(0, 50)}...`);
            }
            
            newPresets[presetName] = resolvedPreset;
            
          } catch (conversionError) {
            stats.invalidFormat++;
            invalidFormatNames.push(presetName);
            debugManager.debug('presets', `Invalid preset format ${file}:`, (conversionError as Error).message);
          }
        } catch (parseError) {
          const presetName = file.replace(/\.json$/i, '');
          stats.parseErrors++;
          parseErrorNames.push(presetName);
          debugManager.debug('presets', `Failed to parse preset file ${file}:`, (parseError as Error).message);
        }
      }
      
      this.presets = newPresets;
      
      // Always log comprehensive summary with colors
      logger.info('Preset loading summary:');
      logger.info(`  Total files processed: ${stats.totalFiles}`);
      logger.info(`  Valid presets: ${stats.validPresets}`);
      logger.info(`  Legacy presets converted: ${stats.legacyConverted}`);
      logger.info(`  Failed favorite resolution: ${stats.failedResolution}`);
      logger.info(`  Invalid format: ${stats.invalidFormat}`);
      logger.info(`  Parse errors: ${stats.parseErrors}`);
      logger.info(`  Invalid rooms: ${stats.invalidRooms}`);
      
      // Only use colors if we're in development and not using Pino
      const useColors = this.config?.isDevelopment && this.config?.logger !== 'pino';
      
      if (validPresetNames.length > 0) {
        const presets = validPresetNames.sort().map(name => 
          useColors ? `\x1b[32m${name}\x1b[0m` : name
        ).join(', ');
        logger.info(`Working presets: ${presets}`);
      }
      
      if (failedResolutionNames.length > 0) {
        const presets = failedResolutionNames.sort().map(name => 
          useColors ? `\x1b[33m${name}\x1b[0m` : name
        ).join(', ');
        logger.info(`Failed resolution: ${presets}`);
      }
      
      if (invalidFormatNames.length > 0) {
        const presets = invalidFormatNames.sort().map(name => 
          useColors ? `\x1b[31m${name}\x1b[0m` : name
        ).join(', ');
        logger.info(`Invalid format: ${presets}`);
      }
      
      if (parseErrorNames.length > 0) {
        const presets = parseErrorNames.sort().map(name => 
          useColors ? `\x1b[31m${name}\x1b[0m` : name
        ).join(', ');
        logger.info(`Parse errors: ${presets}`);
      }
      
      if (invalidRoomNames.length > 0) {
        const presets = invalidRoomNames.sort().map(name => 
          useColors ? `\x1b[33m${name}\x1b[0m` : name
        ).join(', ');
        logger.info(`Presets with invalid rooms (loaded with valid rooms only): ${presets}`);
      }
      
      // Report stats to callback if provided
      if (this.onStatsUpdate) {
        this.onStatsUpdate({
          stats,
          validPresets: validPresetNames,
          failedPresets: failedResolutionNames,
          invalidPresets: invalidFormatNames,
          parseErrors: parseErrorNames,
          invalidRooms: invalidRoomNames,
          allPresets: newPresets
        });
      }
      
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info(`Preset directory ${this.presetDir} not found, using config presets only`);
      } else {
        logger.error('Error loading presets:', error);
      }
    }
  }

  private async startWatching(): Promise<void> {
    try {
      const stats = await stat(this.presetDir);
      if (!stats.isDirectory()) {
        return;
      }

      this.watcher = watchFs(this.presetDir, { persistent: false }, () => {
        if (this.watchTimeout) {
          clearTimeout(this.watchTimeout);
        }
        this.watchTimeout = setTimeout(() => this.loadPresets(), 200);
      });
      
      logger.info(`Watching preset directory for changes: ${this.presetDir}`);
    } catch (error) {
      debugManager.debug('presets', `Not watching preset directory: ${(error as Error).message}`);
    }
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    
    if (this.watchTimeout) {
      clearTimeout(this.watchTimeout);
      this.watchTimeout = undefined;
    }
  }

  getPreset(name: string): Preset | undefined {
    return this.presets[name];
  }

  getAllPresets(): PresetCollection {
    return { ...this.presets };
  }

  private validateAndFilterRooms(preset: PresetWithLegacy, presetName: string): { 
    hasInvalidRooms: boolean; 
    invalidRooms?: string[]; 
    message?: string 
  } {
    // Only validate legacy presets that have room information
    if (!preset._legacy || !preset._legacy.players) {
      return { hasInvalidRooms: false };
    }
    
    // If discovery is not available, we can't validate
    if (!this.discovery) {
      return { hasInvalidRooms: false };
    }
    
    const availableRooms = this.discovery.getAllDevices().map(d => d.roomName.toLowerCase());
    const invalidRooms: string[] = [];
    const validPlayers: Array<{ roomName: string; volume: number }> = [];
    
    for (const player of preset._legacy.players) {
      if (player.roomName) {
        if (availableRooms.includes(player.roomName.toLowerCase())) {
          validPlayers.push(player);
        } else {
          invalidRooms.push(player.roomName);
        }
      }
    }
    
    if (invalidRooms.length > 0) {
      // Update the preset to only include valid players
      preset._legacy.players = validPlayers;
      
      // If no valid players remain, the preset becomes unusable for grouping
      if (validPlayers.length === 0) {
        debugManager.debug('presets', `Preset ${presetName}: All rooms invalid, preset will have no room assignments`);
      }
      
      return { 
        hasInvalidRooms: true,
        invalidRooms,
        message: `Removed ${invalidRooms.length} invalid room(s): ${invalidRooms.join(', ')}. Kept ${validPlayers.length} valid room(s).`
      };
    }
    
    return { hasInvalidRooms: false };
  }

  private async resolveFavorites(preset: Preset, presetName: string): Promise<Preset> {
    // Handle different URI types that need resolution
    if (!this.discovery) {
      return preset;
    }

    // Handle favorite: URIs
    if (preset.uri.startsWith('favorite:')) {
      const favoriteName = preset.uri.substring(9); // Remove 'favorite:' prefix
      debugManager.debug('favorites', `Resolving favorite for preset ${presetName}: ${favoriteName}`);

      try {
        // Get any device to query favorites (they should be system-wide)
        const devices = this.discovery.getAllDevices();
        if (devices.length === 0) {
          debugManager.debug('favorites', `No devices available to resolve favorite: ${favoriteName}`);
          return preset;
        }

        const device = devices[0]; // Use first available device
        const { FavoritesManager } = await import('./actions/favorites.js');
        const favoritesManager = new FavoritesManager();
        const favorite = await favoritesManager.findFavoriteByName(device!, favoriteName);

        if (favorite) {
          debugManager.debug('favorites', `Resolved favorite "${favoriteName}" to URI: ${favorite.uri}`);
          return {
            ...preset,
            uri: favorite.uri,
            metadata: favorite.metadata || preset.metadata,
            _originalFavorite: favoriteName // Keep track of original for debugging
          } as Preset & { _originalFavorite?: string };
        } else {
          debugManager.debug('favorites', `Could not resolve favorite "${favoriteName}" for preset ${presetName}`);
          return preset; // Return unchanged if we can't resolve
        }
      } catch (error) {
        debugManager.debug('favorites', `Error resolving favorite "${favoriteName}" for preset ${presetName}:`, error);
        return preset; // Return unchanged if there's an error
      }
    }
    
    // Handle spotifyUrl: URIs
    if (preset.uri.startsWith('spotifyUrl:')) {
      const spotifyUrl = preset.uri.substring(11); // Remove 'spotifyUrl:' prefix
      debugManager.debug('presets', `Resolving Spotify URL for preset ${presetName}: ${spotifyUrl}`);

      try {
        // Use SpotifyService to parse the URL and generate URI
        const sonosUri = SpotifyService.parseSpotifyUrlToUri(spotifyUrl);
        
        if (!sonosUri) {
          logger.warn(`Failed to parse Spotify URL for preset ${presetName}: ${spotifyUrl}`);
          return preset;
        }
        
        debugManager.debug('presets', `Resolved Spotify URL to URI: ${sonosUri}`);
        
        return {
          ...preset,
          uri: sonosUri,
          metadata: '', // Spotify doesn't need metadata
          _originalSpotifyUrl: spotifyUrl // Keep track of original for debugging
        } as Preset & { _originalSpotifyUrl?: string };
      } catch (error) {
        logger.error(`Error resolving Spotify URL for preset ${presetName}:`, error);
        return preset; // Return unchanged if there's an error
      }
    }

    // No resolution needed
    return preset;
  }
}