import logger from './logger.js';
import { debugManager } from './debug-manager.js';
import type { Preset, LegacyPreset } from '../types/sonos.js';

// Type for converted preset with legacy data attached
export type PresetWithLegacy = Preset & {
  _legacy?: {
    players: LegacyPreset['players'];
    state?: LegacyPreset['state'];
    playMode?: LegacyPreset['playMode'];
    pauseOthers?: LegacyPreset['pauseOthers'];
    sleep?: LegacyPreset['sleep'];
  };
};

export function isLegacyPreset(preset: unknown): preset is LegacyPreset {
  if (typeof preset !== 'object' || preset === null) {
    return false;
  }
  
  const obj = preset as Record<string, unknown>;
  
  if (!('players' in obj) || !Array.isArray(obj.players) || obj.players.length === 0) {
    return false;
  }
  
  const firstPlayer = obj.players[0];
  if (typeof firstPlayer !== 'object' || firstPlayer === null) {
    return false;
  }
  
  return 'roomName' in firstPlayer && typeof (firstPlayer as Record<string, unknown>).roomName === 'string';
}

export function convertLegacyPreset(legacy: LegacyPreset, presetName: string): PresetWithLegacy {
  debugManager.debug('presets', `Converting legacy preset: ${presetName}`);

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

  const converted: PresetWithLegacy = {
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
  };

  debugManager.debug('presets', `Converted legacy preset ${presetName}:`, {
    originalPlayers: legacy.players.length,
    coordinator: coordinator.roomName,
    hasPlayMode: !!legacy.playMode,
    pauseOthers: legacy.pauseOthers,
    sleep: legacy.sleep
  });

  return converted;
}

export function tryConvertPreset(data: unknown, presetName: string): Preset | PresetWithLegacy {
  // First ensure data is an object
  if (!data || typeof data !== 'object') {
    throw new Error(`Preset ${presetName} is not an object`);
  }
  
  const presetData = data as Record<string, unknown>;
  
  // Check if it's already in the new format
  if (typeof presetData.uri === 'string') {
    debugManager.debug('presets', `Preset ${presetName} is already in new format`);
    return presetData as unknown as Preset;
  }

  // Check if it's in legacy format
  if (isLegacyPreset(data)) {
    return convertLegacyPreset(data, presetName);
  }

  // Unknown format
  throw new Error(`Preset ${presetName} is in an unknown format`);
}