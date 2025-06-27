import logger from './logger.js';
import type { Preset, LegacyPreset } from '../types/sonos.js';

export function isLegacyPreset(preset: any): preset is LegacyPreset {
  return (
    typeof preset === 'object' &&
    preset !== null &&
    Array.isArray(preset.players) &&
    preset.players.length > 0 &&
    typeof preset.players[0]?.roomName === 'string'
  );
}

export function convertLegacyPreset(legacy: LegacyPreset, presetName: string): Preset {
  logger.debug(`Converting legacy preset: ${presetName}`);

  // For the new simple format, we'll create a basic preset
  // The coordinator will be the first player in the list
  const coordinator = legacy.players[0];
  if (!coordinator) {
    throw new Error('Legacy preset must have at least one player');
  }

  let uri = '';
  let metadata = '';

  // Handle favorite vs URI
  if (legacy.favorite) {
    // For favorites, we'll use a special URI that indicates this needs to be resolved
    // at runtime by looking up the favorite in the Sonos system
    uri = `favorite:${legacy.favorite}`;
    metadata = '';
  } else if (legacy.uri) {
    uri = legacy.uri;
  } else {
    // If neither favorite nor URI is specified, create a placeholder
    // This allows loading the preset even if it doesn't have playable content
    uri = 'placeholder:no-content';
    logger.warn(`Legacy preset ${presetName} has no favorite or uri - creating placeholder`);
  }

  const converted: Preset = {
    uri,
    metadata: metadata || '',
    volume: coordinator.volume,
    // Store legacy-specific data for advanced features
    _legacy: {
      players: legacy.players,
      state: legacy.state,
      playMode: legacy.playMode,
      pauseOthers: legacy.pauseOthers,
      sleep: legacy.sleep
    }
  } as Preset & { _legacy?: any };

  logger.debug(`Converted legacy preset ${presetName}:`, {
    originalPlayers: legacy.players.length,
    coordinator: coordinator.roomName,
    hasPlayMode: !!legacy.playMode,
    pauseOthers: legacy.pauseOthers,
    sleep: legacy.sleep
  });

  return converted;
}

export function tryConvertPreset(data: any, presetName: string): Preset {
  // Check if it's already in the new format
  if (typeof data.uri === 'string') {
    logger.debug(`Preset ${presetName} is already in new format`);
    return data as Preset;
  }

  // Check if it's in legacy format
  if (isLegacyPreset(data)) {
    return convertLegacyPreset(data, presetName);
  }

  // Unknown format
  throw new Error(`Preset ${presetName} is in an unknown format`);
}