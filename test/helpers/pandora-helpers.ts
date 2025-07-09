import { defaultConfig } from './test-config.js';
import { testLog } from './test-logger.js';

export interface PandoraTestStation {
  name: string;
  type: 'favorite' | 'api';
  flags?: string;
}

/**
 * Get test stations for Pandora switching tests
 * Ensures we have at least one favorite and one API station
 */
export async function getPandoraStationsForSwitchingTest(room: string): Promise<{
  favoriteStations: PandoraTestStation[];
  apiStations: PandoraTestStation[];
  allStations: PandoraTestStation[];
}> {
  try {
    // Get detailed station data to identify favorites vs API stations
    const response = await fetch(`${defaultConfig.apiUrl}/${room}/pandora/stations/detailed`);
    if (!response.ok) {
      throw new Error(`Failed to get Pandora stations: ${response.status}`);
    }
    
    const data = await response.json();
    const stations = data.stations || [];
    
    // Separate favorites from API-only stations
    const favoriteStations: PandoraTestStation[] = [];
    const apiStations: PandoraTestStation[] = [];
    
    for (const station of stations) {
      // Skip special stations
      if (station.stationName === 'QuickMix' || 
          station.stationName === 'Thumbprint Radio' ||
          station.stationName.includes('Thumbprint')) {
        continue;
      }
      
      const testStation: PandoraTestStation = {
        name: station.stationName,
        type: station.isInSonosFavorites ? 'favorite' : 'api'
      };
      
      if (station.isInSonosFavorites) {
        favoriteStations.push(testStation);
      } else {
        apiStations.push(testStation);
      }
    }
    
    // Log what we found
    testLog.info(`📊 Pandora stations for testing:`);
    testLog.info(`   - Favorites: ${favoriteStations.length} stations`);
    testLog.info(`   - API-only: ${apiStations.length} stations`);
    
    // Check if we have enough stations
    if (favoriteStations.length === 0) {
      testLog.warn('⚠️  No Pandora favorites found for testing');
    }
    if (apiStations.length === 0) {
      testLog.warn('⚠️  No API-only stations found for testing');
    }
    
    return {
      favoriteStations,
      apiStations,
      allStations: [...favoriteStations, ...apiStations]
    };
  } catch (error) {
    testLog.error('Failed to get Pandora stations:', error);
    return {
      favoriteStations: [],
      apiStations: [],
      allStations: []
    };
  }
}

/**
 * Get test station pairs for switching tests
 * Returns different combinations of favorite and API stations
 */
export function getStationPairsForTesting(
  favoriteStations: PandoraTestStation[],
  apiStations: PandoraTestStation[]
): {
  apiToApi?: [PandoraTestStation, PandoraTestStation];
  apiToFavorite?: [PandoraTestStation, PandoraTestStation];
  favoriteToApi?: [PandoraTestStation, PandoraTestStation];
  favoriteToFavorite?: [PandoraTestStation, PandoraTestStation];
  thirdStation?: PandoraTestStation;
} {
  const pairs: any = {};
  
  // API to API
  if (apiStations.length >= 2) {
    pairs.apiToApi = [apiStations[0], apiStations[1]];
  }
  
  // API to Favorite
  if (apiStations.length >= 1 && favoriteStations.length >= 1) {
    pairs.apiToFavorite = [apiStations[0], favoriteStations[0]];
  }
  
  // Favorite to API
  if (favoriteStations.length >= 1 && apiStations.length >= 1) {
    pairs.favoriteToApi = [favoriteStations[0], apiStations[0]];
  }
  
  // Favorite to Favorite
  if (favoriteStations.length >= 2) {
    pairs.favoriteToFavorite = [favoriteStations[0], favoriteStations[1]];
  }
  
  // Third station for additional test
  const allStations = [...favoriteStations, ...apiStations];
  if (allStations.length >= 3) {
    // Try to get a different station than the ones already used
    const usedStations = new Set<string>();
    Object.values(pairs).forEach((pair: any) => {
      if (Array.isArray(pair)) {
        usedStations.add(pair[0].name);
        usedStations.add(pair[1].name);
      }
    });
    
    const thirdStation = allStations.find(s => !usedStations.has(s.name));
    if (thirdStation) {
      pairs.thirdStation = thirdStation;
    }
  }
  
  return pairs;
}