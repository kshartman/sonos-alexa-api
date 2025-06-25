import { SystemTopology, defaultConfig } from './test-config.js';

export interface ExtendedTopology extends SystemTopology {
  hasFavorites: boolean;
  hasPlaylists: boolean;
  hasLineIn: boolean;
  hasMultipleGroups: boolean;
  presetNames: string[];
  favoriteNames: string[];
  playlistNames: string[];
  lineInSources: string[];
}

export async function getExtendedTopology(baseTopology: SystemTopology): Promise<ExtendedTopology> {
  const extended: ExtendedTopology = {
    ...baseTopology,
    hasFavorites: false,
    hasPlaylists: false,
    hasLineIn: false,
    hasMultipleGroups: false,
    presetNames: [],
    favoriteNames: [],
    playlistNames: [],
    lineInSources: []
  };

  try {
    // Check for presets
    const presetsResponse = await fetch(`${defaultConfig.apiUrl}/presets`);
    if (presetsResponse.ok) {
      const presets = await presetsResponse.json();
      extended.presetNames = Object.keys(presets.all || {});
    }

    // Check favorites and playlists on first room
    if (baseTopology.rooms.length > 0) {
      const testRoom = encodeURIComponent(baseTopology.rooms[0]);
      
      // Check favorites
      try {
        const favResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/favorites`);
        if (favResponse.ok) {
          const favorites = await favResponse.json();
          if (Array.isArray(favorites) && favorites.length > 0) {
            extended.hasFavorites = true;
            extended.favoriteNames = favorites.slice(0, 5).map(f => f.title || f.name);
          }
        }
      } catch (e) {
        // Favorites might not be available
      }

      // Check playlists
      try {
        const playlistResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/playlists`);
        if (playlistResponse.ok) {
          const playlists = await playlistResponse.json();
          if (Array.isArray(playlists) && playlists.length > 0) {
            extended.hasPlaylists = true;
            extended.playlistNames = playlists.slice(0, 5).map(p => p.title || p.name);
          }
        }
      } catch (e) {
        // Playlists might not be available
      }
    }

    // Check for line-in capable devices
    for (const zone of baseTopology.zones) {
      // Devices with line-in typically have specific models
      // This is a heuristic - you might need to adjust based on your devices
      const lineInModels = ['PLAY:5', 'FIVE', 'PORT', 'CONNECT', 'CONNECT:AMP', 'AMP'];
      
      for (const member of zone.members) {
        // Try to get device info
        try {
          const stateResponse = await fetch(
            `${defaultConfig.apiUrl}/${encodeURIComponent(member.roomName)}/state`
          );
          if (stateResponse.ok) {
            const state = await stateResponse.json();
            // Check if device model supports line-in
            if (state.model && lineInModels.some(model => state.model.includes(model))) {
              extended.hasLineIn = true;
              extended.lineInSources.push(member.roomName);
            }
          }
        } catch (e) {
          // Continue checking other devices
        }
      }
    }

    // Check for multiple active groups
    const activeGroups = baseTopology.zones.filter(zone => zone.members.length > 1);
    extended.hasMultipleGroups = activeGroups.length > 1;

  } catch (error) {
    console.warn('Error detecting extended features:', error);
  }

  return extended;
}

export function shouldRunServiceTest(topology: ExtendedTopology, service: string): boolean {
  // Check if service is available
  if (!topology.availableServices.includes(service)) {
    return false;
  }

  // Additional checks for specific services
  switch (service) {
    case 'pandora':
      // Only run if Pandora credentials are configured
      return process.env.PANDORA_USERNAME !== undefined;
    
    case 'apple':
      // Apple Music doesn't require auth, always available
      return true;
    
    case 'spotify':
      // Would need Spotify credentials
      return false; // Not implemented yet
    
    default:
      return false;
  }
}

export function getTestablePresets(topology: ExtendedTopology, maxCount: number = 3): string[] {
  // Return a subset of presets for testing
  return topology.presetNames.slice(0, maxCount);
}

export function getTestableFavorites(topology: ExtendedTopology, maxCount: number = 3): string[] {
  // Return a subset of favorites for testing
  return topology.favoriteNames.slice(0, maxCount);
}

export function getTestableRoomPairs(topology: SystemTopology): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  
  // All rooms should be standalone after ungroupAllSpeakers
  const rooms = topology.rooms;
  
  // Create pairs for testing join/leave operations
  for (let i = 0; i < rooms.length - 1; i += 2) {
    pairs.push([rooms[i], rooms[i + 1]]);
  }
  
  return pairs;
}