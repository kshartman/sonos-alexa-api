import { defaultConfig } from './test-config.js';

export interface DeviceState {
  room: string;
  playbackState: string;
  volume: number;
  mute: boolean;
  currentTrack?: any;
  transportUri?: string;
  groupMembers?: string[];
}

/**
 * Save the current state of a device
 */
export async function saveDeviceState(room: string): Promise<DeviceState> {
  if (!room) {
    throw new Error('Room name is required to save device state');
  }
  
  const response = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
  if (!response.ok) {
    throw new Error(`Failed to get state for ${room}: ${response.status} ${response.statusText}`);
  }
  
  const state = await response.json();
  
  // Get zone info to check if it's grouped
  const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
  const zones = await zonesResponse.json();
  
  const zone = zones.find((z: any) => 
    z.members.some((m: any) => m.roomName === room)
  );
  
  const groupMembers = zone?.members.map((m: any) => m.roomName) || [room];
  
  return {
    room,
    playbackState: state.playbackState,
    volume: state.volume,
    mute: state.mute,
    currentTrack: state.currentTrack,
    transportUri: state.currentTrack?.uri,
    groupMembers: groupMembers.length > 1 ? groupMembers : undefined
  };
}

/**
 * Restore a device to its previous state
 */
export async function restoreDeviceState(room: string, state: DeviceState): Promise<void> {
  try {
    // Restore volume
    if (state.volume !== undefined) {
      await fetch(`${defaultConfig.apiUrl}/${room}/volume/${state.volume}`);
    }
    
    // Restore mute state
    if (state.mute) {
      await fetch(`${defaultConfig.apiUrl}/${room}/mute`);
    } else {
      await fetch(`${defaultConfig.apiUrl}/${room}/unmute`);
    }
    
    // Restore playback state
    if (state.playbackState === 'PLAYING') {
      await fetch(`${defaultConfig.apiUrl}/${room}/play`);
    } else if (state.playbackState === 'PAUSED_PLAYBACK') {
      await fetch(`${defaultConfig.apiUrl}/${room}/pause`);
    }
    
    // Note: We don't restore groups or tracks as that's more complex
    // and might interfere with other tests
  } catch (error) {
    console.error(`Failed to restore state for ${room}:`, error);
  }
}

/**
 * Run a test with state preservation
 */
export async function withSavedState<T>(
  room: string, 
  testFn: () => Promise<T>
): Promise<T> {
  if (!room) {
    console.warn('withSavedState called with undefined room, skipping state preservation');
    return await testFn();
  }
  
  const state = await saveDeviceState(room);
  try {
    return await testFn();
  } finally {
    if (defaultConfig.mockOnly) {
      await restoreDeviceState(room, state);
    }
  }
}