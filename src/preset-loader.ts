import { readdir, readFile, stat } from 'fs/promises';
import { watch as watchFs } from 'fs';
import { join } from 'path';
import logger from './utils/logger.js';
import { debugManager } from './utils/debug-manager.js';
import { scheduler } from './utils/scheduler.js';
import { tryConvertPreset, type PresetWithLegacy } from './utils/preset-converter.js';
import type { PresetCollection, Preset } from './types/sonos.js';
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
  private rawPresets: PresetCollection = {}; // Store unvalidated presets
  private presetsValidated = false; // Track if validation has been done
  private requiredRooms = new Set<string>(); // Rooms referenced by presets
  private validationStats?: PresetLoadResult; // Store stats for later reporting
  private readonly WATCH_TASK_ID = 'preset-loader-watch';
  private watcher?: ReturnType<typeof watchFs> | undefined;
  private discovery?: SonosDiscovery | undefined;
  private onStatsUpdate?: ((stats: PresetLoadResult) => void) | undefined;
  // private config?: Config | undefined;

  constructor(presetDir = './presets', discovery?: SonosDiscovery, onStatsUpdate?: (stats: PresetLoadResult) => void) {
    this.presetDir = presetDir;
    this.discovery = discovery;
    this.onStatsUpdate = onStatsUpdate;
  }

  async init(): Promise<void> {
    await this.loadPresets();
    await this.startWatching();
  }

  private async loadPresets(): Promise<void> {
    const newRawPresets: PresetCollection = {};
    const stats = {
      totalFiles: 0,
      validPresets: 0,
      failedResolution: 0,
      invalidFormat: 0,
      parseErrors: 0,
      legacyConverted: 0,
      invalidRooms: 0
    };
    const invalidFormatNames: string[] = [];
    const parseErrorNames: string[] = [];
    this.requiredRooms.clear();
    
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
          
          // Collect rooms from raw preset (before conversion)
          if (rawPreset.players && Array.isArray(rawPreset.players)) {
            for (const player of rawPreset.players) {
              if (player.roomName) {
                this.requiredRooms.add(player.roomName);
              }
            }
          }
          
          try {
            // Try to convert the preset (handles both new and legacy formats)
            const convertedPreset = tryConvertPreset(rawPreset, presetName);
            
            // Check if this was a legacy preset conversion
            if ('_legacy' in convertedPreset) {
              stats.legacyConverted++;
              
              // Collect required rooms from legacy presets
              if (convertedPreset._legacy && convertedPreset._legacy.players) {
                for (const player of convertedPreset._legacy.players) {
                  if (player.roomName) {
                    this.requiredRooms.add(player.roomName);
                  }
                }
              }
            }
            
            // Store the raw preset without validation
            newRawPresets[presetName] = convertedPreset;
            stats.totalFiles++; // Count parsed files
            debugManager.trace('presets', `Parsed preset: ${presetName}`);
            
          } catch (conversionError) {
            stats.invalidFormat++;
            invalidFormatNames.push(presetName);
            debugManager.warn('presets', `Invalid preset format ${file}:`, (conversionError as Error).message);
          }
        } catch (parseError) {
          const presetName = file.replace(/\.json$/i, '');
          stats.parseErrors++;
          parseErrorNames.push(presetName);
          debugManager.warn('presets', `Failed to parse preset file ${file}:`, (parseError as Error).message);
        }
      }
      
      this.rawPresets = newRawPresets;
      this.presetsValidated = false; // Mark as not validated
      
      // Simple summary - no validation details yet
      logger.info(`Preset loading: ${Object.keys(newRawPresets).length} presets parsed (validation deferred)`);
      if (stats.legacyConverted > 0) {
        logger.info(`  Legacy presets converted: ${stats.legacyConverted}`);
      }
      if (this.requiredRooms.size > 0) {
        logger.info(`  Waiting for rooms: ${Array.from(this.requiredRooms).join(', ')}`);
        logger.info('  Validation will occur when all rooms are discovered or on first preset use');
      } else {
        logger.info('  No room requirements - validation will occur on first preset use');
      }
      
      // Report initial stats (parsing only)
      if (this.onStatsUpdate) {
        this.onStatsUpdate({
          stats: {
            totalFiles: Object.keys(newRawPresets).length,
            validPresets: 0, // Not validated yet
            failedResolution: 0,
            invalidFormat: stats.invalidFormat,
            parseErrors: stats.parseErrors,
            legacyConverted: stats.legacyConverted,
            invalidRooms: 0
          },
          validPresets: [],
          failedPresets: [],
          invalidPresets: invalidFormatNames,
          parseErrors: parseErrorNames,
          invalidRooms: [],
          allPresets: {} // Empty until validated
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
        scheduler.clearTask(this.WATCH_TASK_ID);
        scheduler.scheduleTimeout(this.WATCH_TASK_ID, () => this.loadPresets(), 200, { unref: true });
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
    
    scheduler.clearTask(this.WATCH_TASK_ID);
  }

  private async validatePresets(): Promise<void> {
    if (this.presetsValidated) return; // Already validated
    
    logger.info('Validating presets...');
    const validatedPresets: PresetCollection = {};
    const stats = {
      totalFiles: Object.keys(this.rawPresets).length,
      validPresets: 0,
      failedResolution: 0,
      invalidFormat: 0,
      parseErrors: 0,
      legacyConverted: 0,
      invalidRooms: 0
    };
    const validPresetNames: string[] = [];
    const failedResolutionNames: string[] = [];
    const invalidRoomNames: string[] = [];
    
    for (const [presetName, preset] of Object.entries(this.rawPresets)) {
      let validatedPreset = preset;
      
      // Validate and filter rooms for legacy presets
      if ('_legacy' in preset) {
        stats.legacyConverted++;
        const presetWithLegacy = preset as PresetWithLegacy;
        const roomValidation = this.validateAndFilterRooms(presetWithLegacy, presetName);
        if (roomValidation.hasInvalidRooms) {
          stats.invalidRooms++;
          invalidRoomNames.push(presetName);
          logger.warn(`Preset ${presetName}: Removed invalid rooms - ${roomValidation.invalidRooms?.join(', ')}`);
        }
      }
      
      // Resolve favorites to actual URIs
      validatedPreset = await this.resolveFavorites(validatedPreset, presetName);
      
      // Check resolution status
      if (validatedPreset.uri.startsWith('favorite:') || validatedPreset.uri.startsWith('spotifyUrl:')) {
        stats.failedResolution++;
        failedResolutionNames.push(presetName);
      } else if (!validatedPreset.uri.startsWith('placeholder:')) {
        stats.validPresets++;
        validPresetNames.push(presetName);
      }
      
      validatedPresets[presetName] = validatedPreset;
    }
    
    this.presets = validatedPresets;
    this.presetsValidated = true;
    this.validationStats = {
      stats,
      validPresets: validPresetNames,
      failedPresets: failedResolutionNames,
      invalidPresets: [],
      parseErrors: [],
      invalidRooms: invalidRoomNames,
      allPresets: validatedPresets
    };
    
    // Log validation results
    logger.info('Preset validation complete:');
    logger.info(`  Valid presets: ${stats.validPresets}`);
    logger.info(`  Failed favorite resolution: ${stats.failedResolution}`);
    logger.info(`  Invalid rooms: ${stats.invalidRooms}`);
    
    // Report updated stats
    if (this.onStatsUpdate && this.validationStats) {
      this.onStatsUpdate(this.validationStats);
    }
  }

  async getPreset(name: string): Promise<Preset | undefined> {
    await this.validatePresets();
    return this.presets[name];
  }

  async getAllPresets(): Promise<PresetCollection> {
    await this.validatePresets();
    return { ...this.presets };
  }

  // Get raw presets without triggering validation (for stats)
  getRawPresets(): PresetCollection {
    return { ...this.rawPresets };
  }

  // Get validation state
  isValidated(): boolean {
    return this.presetsValidated;
  }

  // Get required rooms for validation check
  getRequiredRooms(): Set<string> {
    return new Set(this.requiredRooms);
  }

  // Trigger validation if all required rooms are discovered
  async checkAndValidate(): Promise<boolean> {
    if (this.presetsValidated) return true;
    
    if (this.areAllRequiredRoomsDiscovered()) {
      logger.info('All required rooms discovered, validating presets');
      await this.validatePresets();
      return true;
    }
    return false;
  }

  // Check if all required rooms have been discovered
  areAllRequiredRoomsDiscovered(): boolean {
    if (!this.discovery || this.requiredRooms.size === 0) return true;
    
    const discoveredRooms = new Set(
      this.discovery.getAllDevices().map(d => d.roomName)
    );
    
    for (const room of this.requiredRooms) {
      if (!discoveredRooms.has(room)) {
        return false;
      }
    }
    return true;
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
      debugManager.trace('favorites', `Resolving favorite for preset ${presetName}: ${favoriteName}`);

      try {
        // Get devices and find one capable of browsing favorites
        const devices = this.discovery.getAllDevices();
        if (devices.length === 0) {
          debugManager.debug('favorites', `No devices available to resolve favorite: ${favoriteName}`);
          return preset;
        }

        // Try to find a capable device
        let device = devices.find(d => this.discovery!.isCapableDevice(d));
        
        if (!device) {
          // No capable device found, keep the favorite: URI for runtime resolution
          debugManager.debug('favorites', `No capable devices available to resolve favorite: ${favoriteName} - will retry at runtime`);
          return preset;
        }
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
      debugManager.trace('presets', `Resolving Spotify URL for preset ${presetName}: ${spotifyUrl}`);

      try {
        // Use SpotifyService to parse the URL and generate URI
        const sonosUri = SpotifyService.parseSpotifyUrlToUri(spotifyUrl);
        
        if (!sonosUri) {
          logger.warn(`Failed to parse Spotify URL for preset ${presetName}: ${spotifyUrl}`);
          return preset;
        }
        
        debugManager.trace('presets', `Resolved Spotify URL to URI: ${sonosUri}`);
        
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
