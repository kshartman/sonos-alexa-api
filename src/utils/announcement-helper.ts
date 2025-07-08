import logger from './logger.js';
import type { SonosDevice } from '../sonos-device.js';
import type { SonosDiscovery } from '../discovery.js';

interface BackupState {
  // Transport state
  transportURI?: string;
  transportMetadata?: string;
  
  // Queue state
  hasQueue: boolean;
  queueWasEmpty: boolean;
  
  // Position state
  trackNo?: number;
  elapsedTime?: number;
  
  // Playback state
  playbackState: 'PLAYING' | 'PAUSED_PLAYBACK' | 'STOPPED';
  
  // Volume state
  volume: number;
  
  // Group state
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

  // Check queue state FIRST
  let queueInfo;
  try {
    queueInfo = await device.getQueue(0, 1);
  } catch (error) {
    logger.warn(`Failed to get queue info for ${device.roomName}:`, error);
    queueInfo = { items: [] };
  }
  
  // Determine if we're playing from queue or direct URI
  const isPlayingFromQueue = mediaInfo?.CurrentURI?.startsWith('x-rincon-queue:');
  const queueIsEmpty = queueInfo.items.length === 0;
  
  // Save complete state snapshot
  const backup: BackupState = {
    // Volume state
    volume: typeof currentVolume === 'string' ? parseInt(currentVolume, 10) : (currentVolume || device.state.volume),
    
    // Playback state
    playbackState: transportInfo?.CurrentTransportState === 'PAUSED_PLAYBACK' ? 'PAUSED_PLAYBACK' :
      transportInfo?.CurrentTransportState === 'PLAYING' ? 'PLAYING' : 
        'STOPPED',
    
    // Queue state
    hasQueue: isPlayingFromQueue || false,
    queueWasEmpty: queueIsEmpty,
    
    // Coordinator state
    wasCoordinator: device.isCoordinator()
  };

  // Save transport URI - this could be a queue URI or direct URI
  if (mediaInfo?.CurrentURI && !mediaInfo.CurrentURI.includes('/tts/')) {
    backup.transportURI = mediaInfo.CurrentURI;
    backup.transportMetadata = mediaInfo.CurrentURIMetaData;
    
    // Only save position for non-streaming sources
    if (!isStreamingSource(backup.transportURI) && positionInfo) {
      backup.trackNo = parseInt(positionInfo.Track, 10);
      backup.elapsedTime = parseTime(positionInfo.RelTime);
    }
    logger.debug(`Saved transport URI for ${device.roomName}: ${backup.transportURI}`);
  } else if (!queueIsEmpty) {
    // No current URI but queue has content - we should restore to queue
    backup.hasQueue = true;
    backup.transportURI = `x-rincon-queue:${device.id.replace('uuid:', '')}#0`;
    logger.debug(`No current URI but queue has content for ${device.roomName}`);
  } else {
    logger.debug(`No URI and empty queue for ${device.roomName} - will clear after TTS`);
  }

  // Check if we're in a group
  const zone = discovery.getZones().find(z => 
    z.members.some(m => m.id === device.id)
  );
  
  if (zone && zone.members.length > 1 && !device.isCoordinator()) {
    // Save group coordinator URI for rejoining
    backup.groupUri = `x-rincon:${zone.coordinator}`;
  }

  logger.debug(`Backup state for ${device.roomName}: volume=${backup.volume}, state=${backup.playbackState}, ` +
    `hasQueue=${backup.hasQueue}, queueWasEmpty=${backup.queueWasEmpty}, ` +
    `uri=${backup.transportURI?.substring(0, 50) || 'none'}`);

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
  logger.debug(`Restoring state for ${device.roomName}: ` +
    `hasQueue=${backup.hasQueue}, queueWasEmpty=${backup.queueWasEmpty}, ` +
    `state=${backup.playbackState}, volume=${backup.volume}`);
  
  try {
    // Step 1: Restore volume (use coordinator for stereo pairs/groups)
    const currentVolumeResult = await coordinator.getVolume();
    const currentVolume = typeof currentVolumeResult.CurrentVolume === 'string' 
      ? parseInt(currentVolumeResult.CurrentVolume, 10) 
      : currentVolumeResult.CurrentVolume;
    
    if (currentVolume !== backup.volume) {
      logger.debug(`Restoring volume to ${backup.volume} (was ${currentVolume})`);
      await coordinator.setVolume(backup.volume);
    }
    
    // Step 2: Rejoin group if needed
    if (backup.groupUri) {
      logger.debug(`Rejoining group: ${backup.groupUri}`);
      await device.setAVTransportURI(backup.groupUri);
      return; // Group coordinator will handle playback
    }
    
    // Step 3: Restore content based on original state
    
    // Case 1: Queue was empty AND no saved transport URI - clear everything
    if (backup.queueWasEmpty && !backup.transportURI) {
      logger.debug('Queue was empty and no transport URI before TTS, clearing queue and transport');
      
      // Stop playback first to ensure we're in a clean state
      await device.stop();
      
      // Small delay to ensure stop completes
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Clear the queue
      await device.clearQueue();
      
      // Another small delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Clear the transport URI by setting it to the device's own empty queue
      // This removes the TTS file from being the current track
      const emptyQueueURI = `x-rincon-queue:${device.id.replace('uuid:', '')}#0`;
      logger.debug(`Setting transport to empty queue: ${emptyQueueURI}`);
      
      try {
        await device.setAVTransportURI(emptyQueueURI, '');
        logger.debug('Successfully set transport to empty queue');
      } catch (error) {
        logger.error('Failed to set empty queue URI:', error);
        // Try alternative approach - set to empty string
        try {
          await device.setAVTransportURI('', '');
          logger.debug('Set transport to empty string as fallback');
        } catch (fallbackError) {
          logger.error('Fallback also failed:', fallbackError);
        }
      }
      
      return;
    }
    
    // Case 2: Had a transport URI (queue or direct)
    if (backup.transportURI) {
      // For queue URIs, the queue should still be intact
      if (backup.transportURI.startsWith('x-rincon-queue:')) {
        logger.debug(`Restoring queue playback: ${backup.transportURI}`);
        
        // Set transport back to queue
        await device.setAVTransportURI(backup.transportURI, '');
        
        // Seek to saved position if needed
        if (backup.trackNo && backup.elapsedTime) {
          try {
            logger.debug(`Seeking to track ${backup.trackNo} at ${backup.elapsedTime}s`);
            await device.seek(backup.trackNo, backup.elapsedTime);
          } catch (error) {
            logger.error('Error seeking to previous position:', error);
          }
        }
      } else {
        // Direct URI (not queue)
        logger.debug(`Restoring direct URI: ${backup.transportURI}`);
        await device.setAVTransportURI(backup.transportURI, backup.transportMetadata || '');
        
        // Seek if needed
        if (backup.trackNo && backup.elapsedTime && !isStreamingSource(backup.transportURI)) {
          try {
            logger.debug(`Seeking to track ${backup.trackNo} at ${backup.elapsedTime}s`);
            await device.seek(backup.trackNo, backup.elapsedTime);
          } catch (error) {
            logger.error('Error seeking to previous position:', error);
          }
        }
      }
      
      // Step 4: Restore playback state
      if (backup.playbackState === 'PLAYING') {
        logger.debug('Resuming playback');
        await device.play();
        
        // Verify it's actually playing
        await new Promise(resolve => setTimeout(resolve, 500));
        const state = await device.getTransportInfo();
        if (state.CurrentTransportState !== 'PLAYING') {
          logger.warn(`Play failed, transport state is ${state.CurrentTransportState}`);
        }
      } else if (backup.playbackState === 'PAUSED_PLAYBACK') {
        logger.debug('Restoring paused state');
        
        // Check current state after URI restore
        await new Promise(resolve => setTimeout(resolve, 500));
        const state = await device.getTransportInfo();
        
        if (state.CurrentTransportState === 'STOPPED') {
          // Need to play then pause to get to PAUSED_PLAYBACK
          logger.debug('Playing then pausing to restore paused state');
          await device.play();
          await new Promise(resolve => setTimeout(resolve, 300));
          await device.pause();
        } else if (state.CurrentTransportState === 'PLAYING') {
          // Just pause it
          await device.pause();
        }
        // Already paused - nothing to do
      }
      // STOPPED - nothing to do, already stopped after URI set
    } else {
      logger.debug('No transport URI to restore');
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
