import logger from './logger.js';
import type { SonosDevice } from '../sonos-device.js';
import type { SonosDiscovery } from '../discovery.js';

interface BackupState {
  volume: number;
  playbackState: 'PLAYING' | 'PAUSED_PLAYBACK' | 'STOPPED';
  uri?: string;
  metadata?: string;
  trackNo?: number;
  elapsedTime?: number;
  groupUri?: string;
  wasCoordinator: boolean;
}

export async function playAnnouncement(
  device: SonosDevice,
  ttsUrl: string,
  announceVolume: number,
  duration: number,
  discovery: SonosDiscovery
): Promise<void> {
  // First, get the current transport info AND volume BEFORE any changes
  let transportInfo;
  let positionInfo;
  let currentVolume;
  try {
    // Get all current state in parallel
    const [transport, position, volumeResult] = await Promise.all([
      device.getTransportInfo(),
      device.getPositionInfo(),
      device.getVolume()
    ]);
    
    transportInfo = transport;
    positionInfo = position;
    currentVolume = volumeResult.CurrentVolume;
    
    logger.debug(`Transport info for ${device.roomName}:`, {
      CurrentURI: transportInfo.CurrentURI,
      CurrentTransportState: transportInfo.CurrentTransportState,
      CurrentURIMetaData: transportInfo.CurrentURIMetaData?.substring(0, 100),
      CurrentVolume: currentVolume
    });
  } catch (error) {
    logger.error('Error getting device info:', error);
    // Fallback to state if direct query fails
    currentVolume = device.state.volume;
  }

  // Save current state
  const state = device.state;
  const backup: BackupState = {
    volume: currentVolume || state.volume, // Use fetched volume, fallback to state
    // Use transport info for accurate playback state
    playbackState: transportInfo?.CurrentTransportState === 'PAUSED_PLAYBACK' ? 'PAUSED_PLAYBACK' :
      transportInfo?.CurrentTransportState === 'PLAYING' ? 'PLAYING' : 
        'STOPPED',
    wasCoordinator: device.isCoordinator()
  };

  // Save transport details for restoration
  if (transportInfo?.CurrentURI && !transportInfo.CurrentURI.includes('/tts/')) {
    // Use transport info if it's not a TTS URL
    backup.uri = transportInfo.CurrentURI;
    backup.metadata = transportInfo.CurrentURIMetaData;
    
    // Only save position for non-streaming sources
    if (!isStreamingSource(backup.uri) && positionInfo) {
      backup.trackNo = parseInt(positionInfo.Track, 10);
      backup.elapsedTime = parseTime(positionInfo.RelTime);
    }
    logger.info(`Saved transport URI for ${device.roomName}: ${backup.uri}`);
  } else if (state.currentTrack?.uri && !state.currentTrack.uri.includes('/tts/')) {
    // Fallback to state if transport info is not available
    backup.uri = state.currentTrack.uri;
    backup.metadata = '';
    logger.info(`Using state URI for ${device.roomName}: ${backup.uri}`);
  } else {
    logger.warn(`No valid URI to save for ${device.roomName}`);
  }

  // Check if we're in a group
  const zone = discovery.getZones().find(z => 
    z.members.some(m => m.id === device.id)
  );
  
  if (zone && zone.members.length > 1 && !device.isCoordinator()) {
    // Save group coordinator URI for rejoining
    backup.groupUri = `x-rincon:${zone.coordinator}`;
  }

  logger.info(`Backup state for ${device.roomName}: volume=${backup.volume}, state=${backup.playbackState}, uri=${backup.uri?.substring(0, 50) || 'none'}`);

  try {
    // Set announce volume
    logger.info(`Setting announce volume to ${announceVolume} for ${device.roomName} (was ${backup.volume})`);
    await device.setVolume(announceVolume);
    
    // Play announcement
    logger.info(`Playing announcement on ${device.roomName}: ${ttsUrl}`);
    await device.playUri(ttsUrl, '', discovery);
    
    // Wait for announcement to finish
    logger.info(`Waiting for announcement to finish (estimated ${duration}ms)`);
    await waitForAnnouncementEnd(device, duration);
    
    // Restore state
    logger.info(`Restoring previous state for ${device.roomName}`);
    await restorePlaybackState(device, backup);
    
    logger.info(`Announcement completed successfully on ${device.roomName}`);
  } catch (error) {
    logger.error('Error during announcement:', error);
    logger.error('Announcement error details:', {
      roomName: device.roomName,
      ttsUrl,
      announceVolume,
      error: error instanceof Error ? error.message : String(error)
    });
    // Try to restore state even if announcement failed
    try {
      await restorePlaybackState(device, backup);
    } catch (restoreError) {
      logger.error('Error restoring state:', restoreError);
    }
    throw error;
  }
}

async function waitForAnnouncementEnd(device: SonosDevice, estimatedDuration: number): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    
    // Set a timeout based on estimated duration + buffer
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, estimatedDuration + 2000);
    
    // Also listen for transport state changes
    const checkTransportState = () => {
      device.getTransportInfo()
        .then(info => {
          if (info.CurrentTransportState === 'STOPPED' && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve();
          } else if (!resolved) {
            // Check again in 500ms
            setTimeout(checkTransportState, 500);
          }
        })
        .catch(err => {
          logger.error('Error checking transport state:', err);
        });
    };
    
    // Start checking after half the estimated duration
    setTimeout(checkTransportState, estimatedDuration / 2);
  });
}

async function restorePlaybackState(
  device: SonosDevice, 
  backup: BackupState
): Promise<void> {
  logger.info(`Restoring state for ${device.roomName}: uri=${backup.uri}, state=${backup.playbackState}, volume=${backup.volume}`);
  
  try {
    // Restore volume first
    logger.debug(`Restoring volume to ${backup.volume}`);
    await device.setVolume(backup.volume);
    
    // Rejoin group if needed
    if (backup.groupUri) {
      logger.info(`Rejoining group: ${backup.groupUri}`);
      await device.setAVTransportURI(backup.groupUri);
      return; // Group coordinator will handle playback
    }
    
    // Restore previous content if it was playing standalone
    if (backup.uri && backup.uri !== '') {
      logger.info(`Restoring URI: ${backup.uri}`);
      await device.setAVTransportURI(backup.uri, backup.metadata || '');
      
      // Seek to previous position if applicable
      if (backup.trackNo && backup.elapsedTime && !isStreamingSource(backup.uri)) {
        try {
          logger.debug(`Seeking to track ${backup.trackNo} at ${backup.elapsedTime}s`);
          await device.seek(backup.trackNo, backup.elapsedTime);
        } catch (error) {
          logger.error('Error seeking to previous position:', error);
        }
      }
      
      // Resume playback if it was playing
      if (backup.playbackState === 'PLAYING') {
        logger.info('Resuming playback');
        try {
          await device.play();
          // Wait a bit and check if it's actually playing
          await new Promise(resolve => setTimeout(resolve, 500));
          const newState = await device.getTransportInfo();
          logger.info(`After play() - transport state: ${newState.CurrentTransportState}`);
          
          if (newState.CurrentTransportState !== 'PLAYING') {
            logger.warn('Play command didn\'t work, trying alternative approach');
            // Try stopping first then playing
            await device.stop();
            await device.setAVTransportURI(backup.uri, backup.metadata || '');
            await device.play();
          }
        } catch (playError) {
          logger.error('Error resuming playback:', playError);
        }
      } else if (backup.playbackState === 'PAUSED_PLAYBACK') {
        logger.info('Restoring paused state');
        // For paused state, we need to ensure it stays paused
        // The setAVTransportURI might have already put it in the right state
        // but let's check and pause if needed
        try {
          await new Promise(resolve => setTimeout(resolve, 500));
          const currentState = await device.getTransportInfo();
          if (currentState.CurrentTransportState === 'STOPPED') {
            // When stopped after restoring content, we need to play then pause
            // to get to PAUSED_PLAYBACK state
            logger.info('Device is stopped, playing then pausing to restore paused state');
            await device.play();
            await new Promise(resolve => setTimeout(resolve, 300));
            await device.pause();
          } else if (currentState.CurrentTransportState === 'PLAYING') {
            logger.info('Pausing playback to restore paused state');
            await device.pause();
          }
          // Else already paused, nothing to do
        } catch (pauseError) {
          logger.error('Error restoring paused state:', pauseError);
        }
      } else {
        logger.info(`Not resuming - previous state was ${backup.playbackState}`);
      }
    } else {
      logger.warn(`No URI to restore (uri: ${backup.uri})`);
    }
  } catch (error) {
    logger.error('Error restoring playback state:', error);
  }
}

function isStreamingSource(uri: string | undefined): boolean {
  if (!uri) return false;
  return uri.startsWith('x-sonosapi-stream:') || 
         uri.startsWith('x-sonosapi-radio:') ||
         uri.startsWith('x-rincon-stream:') ||
         uri.includes('spotify:') ||
         uri.includes('pandora:');
}

function parseTime(time: string): number {
  // Parse time format "0:00:00" to seconds
  const parts = time.split(':');
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(parts[2], 10);
    if (!isNaN(hours) && !isNaN(minutes) && !isNaN(seconds)) {
      return hours * 3600 + minutes * 60 + seconds;
    }
  }
  return 0;
}