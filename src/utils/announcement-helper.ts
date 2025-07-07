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
  // For stereo pairs and groups, always use the coordinator for consistent volume operations
  const coordinator = discovery.getCoordinator(device.id) || device;
  
  // First, get the current transport info AND volume BEFORE any changes
  let transportInfo;
  let mediaInfo;
  let positionInfo;
  let currentVolume;
  try {
    // Get all current state in parallel
    // Note: Use coordinator for volume to ensure we get the group volume, not individual speaker volume
    const [transport, media, position, volumeResult] = await Promise.all([
      device.getTransportInfo(),
      device.getMediaInfo(),
      device.getPositionInfo(),
      coordinator.getVolume()  // Use coordinator for volume!
    ]);
    
    transportInfo = transport;
    mediaInfo = media;
    positionInfo = position;
    currentVolume = volumeResult.CurrentVolume;
    
    logger.debug(`Transport info for ${device.roomName}:`, {
      CurrentURI: mediaInfo.CurrentURI,
      CurrentTransportState: transportInfo.CurrentTransportState,
      CurrentURIMetaData: mediaInfo.CurrentURIMetaData?.substring(0, 100),
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
    volume: typeof currentVolume === 'string' ? parseInt(currentVolume, 10) : (currentVolume || state.volume), // Ensure it's a number
    // Use transport info for accurate playback state
    playbackState: transportInfo?.CurrentTransportState === 'PAUSED_PLAYBACK' ? 'PAUSED_PLAYBACK' :
      transportInfo?.CurrentTransportState === 'PLAYING' ? 'PLAYING' : 
        'STOPPED',
    wasCoordinator: device.isCoordinator()
  };

  // Save transport details for restoration
  if (mediaInfo?.CurrentURI && !mediaInfo.CurrentURI.includes('/tts/')) {
    // Use media info if it's not a TTS URL
    backup.uri = mediaInfo.CurrentURI;
    backup.metadata = mediaInfo.CurrentURIMetaData;
    
    // Only save position for non-streaming sources
    if (!isStreamingSource(backup.uri) && positionInfo) {
      backup.trackNo = parseInt(positionInfo.Track, 10);
      backup.elapsedTime = parseTime(positionInfo.RelTime);
    }
    logger.debug(`Saved transport URI for ${device.roomName}: ${backup.uri}`);
  } else if (state.currentTrack?.uri && !state.currentTrack.uri.includes('/tts/')) {
    // Fallback to state if transport info is not available
    backup.uri = state.currentTrack.uri;
    backup.metadata = '';
    logger.debug(`Using state URI for ${device.roomName}: ${backup.uri}`);
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

  logger.debug(`Backup state for ${device.roomName}: volume=${backup.volume}, state=${backup.playbackState}, uri=${backup.uri?.substring(0, 50) || 'none'}`);

  try {
    // Set announce volume only if different (use coordinator for stereo pairs/groups)
    if (backup.volume !== announceVolume) {
      logger.debug(`Setting announce volume to ${announceVolume} for ${device.roomName} (was ${backup.volume})`);
      await coordinator.setVolume(announceVolume);
    } else {
      logger.debug(`Volume already at ${announceVolume} for ${device.roomName}, skipping volume change`);
    }
    
    // Play announcement
    logger.info(`Playing announcement on ${device.roomName}: ${ttsUrl}`);
    await device.playUri(ttsUrl, '', discovery);
    
    // Wait for announcement to finish
    logger.info(`Waiting for announcement to finish (estimated ${duration}ms)`);
    await waitForAnnouncementEnd(device, duration);
    
    // Restore state
    logger.info(`Restoring previous state for ${device.roomName}`);
    await restorePlaybackState(device, backup, coordinator);
    
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
      await restorePlaybackState(device, backup, coordinator);
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
  backup: BackupState,
  coordinator: SonosDevice
): Promise<void> {
  logger.debug(`Restoring state for ${device.roomName}: uri=${backup.uri}, state=${backup.playbackState}, volume=${backup.volume}`);
  
  try {
    // Restore volume first - check if it needs changing (use coordinator for stereo pairs/groups)
    const currentVolumeResult = await coordinator.getVolume();
    const currentVolume = typeof currentVolumeResult.CurrentVolume === 'string' 
      ? parseInt(currentVolumeResult.CurrentVolume, 10) 
      : currentVolumeResult.CurrentVolume;
    
    if (currentVolume !== backup.volume) {
      logger.debug(`Restoring volume to ${backup.volume} (was ${currentVolume})`);
      await coordinator.setVolume(backup.volume);
    } else {
      logger.debug(`Volume already at ${backup.volume}, skipping restore`);
    }
    
    // Rejoin group if needed
    if (backup.groupUri) {
      logger.debug(`Rejoining group: ${backup.groupUri}`);
      await device.setAVTransportURI(backup.groupUri);
      return; // Group coordinator will handle playback
    }
    
    // Restore previous content if it was playing standalone
    if (backup.uri && backup.uri !== '') {
      logger.debug(`Restoring URI: ${backup.uri}`);
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
        logger.debug('Resuming playback');
        try {
          await device.play();
          // Wait a bit and check if it's actually playing
          await new Promise(resolve => setTimeout(resolve, 500));
          const newState = await device.getTransportInfo();
          logger.debug(`After play() - transport state: ${newState.CurrentTransportState}`);
          
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
        logger.debug('Restoring paused state');
        // For paused state, we need to ensure it stays paused
        // The setAVTransportURI might have already put it in the right state
        // but let's check and pause if needed
        try {
          await new Promise(resolve => setTimeout(resolve, 500));
          const currentState = await device.getTransportInfo();
          if (currentState.CurrentTransportState === 'STOPPED') {
            // When stopped after restoring content, we need to play then pause
            // to get to PAUSED_PLAYBACK state
            logger.debug('Device is stopped, playing then pausing to restore paused state');
            await device.play();
            await new Promise(resolve => setTimeout(resolve, 300));
            await device.pause();
          } else if (currentState.CurrentTransportState === 'PLAYING') {
            logger.debug('Pausing playback to restore paused state');
            await device.pause();
          }
          // Else already paused, nothing to do
        } catch (pauseError) {
          logger.error('Error restoring paused state:', pauseError);
        }
      } else {
        logger.debug(`Not resuming - previous state was ${backup.playbackState}`);
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
