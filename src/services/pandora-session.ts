import type { SonosDevice } from '../sonos-device.js';
import logger from '../utils/logger.js';

/**
 * Helper to extract Pandora session number from various sources
 */
export class PandoraSessionHelper {
  /**
   * Get the current Pandora session number (sn parameter)
   * Tries multiple sources in order:
   * 1. Currently playing Pandora track
   * 2. Pandora favorites (FV:2)
   * 3. Browsing Pandora service (S:236)
   */
  static async getSessionNumber(device: SonosDevice): Promise<string> {
    // Try 1: Check if Pandora is currently playing
    try {
      const state = device.state;
      if (state.currentTrack?.uri?.includes('sid=236')) {
        const snMatch = state.currentTrack.uri.match(/sn=(\d+)/);
        if (snMatch?.[1]) {
          logger.debug(`Found Pandora session number from playing track: ${snMatch[1]}`);
          return snMatch[1];
        }
      }
    } catch (error) {
      logger.debug('Could not get session number from current track:', error);
    }

    // Try 2: Check Pandora favorites (FV:2)
    try {
      const favorites = await device.browse('FV:2');
      if (favorites.items && favorites.items.length > 0) {
        // Look for any Pandora favorite
        for (const fav of favorites.items) {
          if (fav.uri?.includes('sid=236')) {
            const snMatch = fav.uri.match(/sn=(\d+)/);
            if (snMatch?.[1]) {
              logger.debug(`Found Pandora session number from favorites: ${snMatch[1]}`);
              return snMatch[1];
            }
          }
        }
      }
    } catch (error) {
      logger.debug('Could not get session number from favorites:', error);
    }

    // Try 3: Browse Pandora service container (S:236) using raw response
    try {
      const pandoraRoot = await device.browseRaw('S:236', 'BrowseDirectChildren', '*', 0, 1);
      // Check the raw response for session number
      if (pandoraRoot.Result) {
        const snMatch = pandoraRoot.Result.match(/sn=(\d+)/);
        if (snMatch?.[1]) {
          logger.debug(`Found Pandora session number from service browse: ${snMatch[1]}`);
          return snMatch[1];
        }
      }
    } catch (error) {
      logger.debug('Could not get session number from service browse:', error);
    }

    // Default fallback
    logger.warn('Could not find Pandora session number, using default: 1');
    return '1';
  }
}