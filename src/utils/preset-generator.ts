import { SonosDevice } from '../sonos-device.js';
import logger from './logger.js';
import { debugManager } from './debug-manager.js';
import { promises as fs } from 'fs';
import path from 'path';
import { FavoritesManager } from '../actions/favorites.js';

interface GeneratedPreset {
  uri: string;
  metadata?: string;
  volume?: number;
  roomName?: string;
  generatedBy?: string;
}

export class PresetGenerator {
  private presetsDir = './presets';
  private existingPresetNames: Set<string>;
  private favoritesManager = new FavoritesManager();

  constructor(existingPresets: Record<string, unknown>) {
    // Store all existing preset names (case-insensitive)
    this.existingPresetNames = new Set(
      Object.keys(existingPresets).map(name => name.toLowerCase())
    );
  }

  /**
   * Generate presets for favorites, playlists, and stations
   */
  async generateDefaultPresets(device: SonosDevice, defaultRoom: string): Promise<void> {
    if (!defaultRoom) {
      logger.warn('Cannot generate default presets without a default room configured');
      return;
    }

    logger.info('Generating default presets for favorites, playlists, and stations...');

    try {
      // Ensure presets directory exists
      await fs.mkdir(this.presetsDir, { recursive: true });

      let generatedCount = 0;

      // Generate presets for favorites
      const favoritesGenerated = await this.generateFavoritePresets(device, defaultRoom);
      generatedCount += favoritesGenerated;

      // Generate presets for playlists that aren't already favorites
      const playlistsGenerated = await this.generatePlaylistPresets(device, defaultRoom);
      generatedCount += playlistsGenerated;

      // Generate presets for radio stations that aren't already favorites
      const stationsGenerated = await this.generateStationPresets(device, defaultRoom);
      generatedCount += stationsGenerated;

      if (generatedCount > 0) {
        logger.info(`Generated ${generatedCount} default presets in ${this.presetsDir}`);
      } else {
        logger.info('No new presets generated - all content already has presets');
      }
    } catch (error) {
      logger.error('Failed to generate default presets:', error);
    }
  }

  /**
   * Generate presets for all favorites
   */
  private async generateFavoritePresets(device: SonosDevice, defaultRoom: string): Promise<number> {
    try {
      const favorites = await this.favoritesManager.getFavorites(device);
      let count = 0;

      for (const favorite of favorites) {
        const presetName = this.sanitizePresetName(favorite.title);
        
        // Skip if preset already exists
        if (this.presetExists(presetName)) {
          debugManager.debug('presets', `Skipping favorite "${favorite.title}" - preset already exists`);
          continue;
        }

        const preset: GeneratedPreset = {
          uri: `favorite:${favorite.title}`,
          metadata: '',
          volume: 30,
          roomName: defaultRoom,
          generatedBy: 'auto-generator'
        };

        await this.savePreset(presetName, preset);
        count++;
      }

      logger.info(`Generated ${count} favorite presets`);
      return count;
    } catch (error) {
      logger.error('Failed to generate favorite presets:', error);
      return 0;
    }
  }

  /**
   * Generate presets for music library playlists
   */
  private async generatePlaylistPresets(device: SonosDevice, defaultRoom: string): Promise<number> {
    try {
      // Browse music library playlists
      const playlists = await device.browse('A:PLAYLISTS');
      let count = 0;

      for (const playlist of playlists.items) {
        const presetName = this.sanitizePresetName(playlist.title);
        
        // Skip if preset already exists or if it's a favorite
        if (this.presetExists(presetName)) {
          debugManager.debug('presets', `Skipping playlist "${playlist.title}" - preset already exists`);
          continue;
        }

        const preset: GeneratedPreset = {
          uri: playlist.uri,
          volume: 30,
          roomName: defaultRoom,
          generatedBy: 'auto-generator'
        };
        
        if (playlist.metadata) {
          preset.metadata = playlist.metadata;
        }

        await this.savePreset(presetName, preset);
        count++;
      }

      logger.info(`Generated ${count} playlist presets`);
      return count;
    } catch (error) {
      logger.error('Failed to generate playlist presets:', error);
      return 0;
    }
  }

  /**
   * Generate presets for TuneIn radio stations
   */
  private async generateStationPresets(device: SonosDevice, defaultRoom: string): Promise<number> {
    try {
      // Browse TuneIn root for stations
      const radioRoot = await device.browse('R:0/0');
      let count = 0;

      // Look for "Radio Stations" or similar containers
      for (const item of radioRoot.items) {
        if (item.itemType === 'container' && 
            (item.title.includes('Station') || item.title.includes('Radio'))) {
          
          const stations = await device.browse(item.id);
          
          for (const station of stations.items) {
            if (station.itemType === 'item') {
              const presetName = this.sanitizePresetName(station.title);
              
              // Skip if preset already exists
              if (this.presetExists(presetName)) {
                debugManager.debug('presets', `Skipping station "${station.title}" - preset already exists`);
                continue;
              }

              const preset: GeneratedPreset = {
                uri: station.uri,
                volume: 30,
                roomName: defaultRoom,
                generatedBy: 'auto-generator'
              };
              
              if (station.metadata) {
                preset.metadata = station.metadata;
              }

              await this.savePreset(presetName, preset);
              count++;
            }
          }
        }
      }

      logger.info(`Generated ${count} radio station presets`);
      return count;
    } catch (error) {
      logger.error('Failed to generate station presets:', error);
      return 0;
    }
  }

  /**
   * Check if a preset already exists (case-insensitive)
   */
  private presetExists(name: string): boolean {
    return this.existingPresetNames.has(name.toLowerCase());
  }

  /**
   * Sanitize preset name for filesystem
   */
  private sanitizePresetName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') // Trim underscores
      .substring(0, 50); // Limit length
  }

  /**
   * Save preset to file
   */
  private async savePreset(name: string, preset: GeneratedPreset): Promise<void> {
    const filePath = path.join(this.presetsDir, `${name}.json`);
    await fs.writeFile(filePath, JSON.stringify(preset, null, 2));
    
    // Add to our tracking set
    this.existingPresetNames.add(name.toLowerCase());
    
    debugManager.debug('presets', `Generated preset: ${name}`);
  }
}