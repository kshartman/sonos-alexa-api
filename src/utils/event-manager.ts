import { EventEmitter } from 'events';
import logger from './logger.js';
import type { SonosDevice } from '../sonos-device.js';
import type { ZoneGroup } from '../topology-manager.js';
import type { SonosTrack } from '../types/sonos.js';

export interface StateChangeEvent {
  deviceId: string;
  roomName: string;
  previousState: string;
  currentState: string;
  timestamp: number;
}

export interface VolumeChangeEvent {
  deviceId: string;
  roomName: string;
  previousVolume: number;
  currentVolume: number;
  timestamp: number;
}

export interface GroupChangeEvent {
  zones: ZoneGroup[];
  timestamp: number;
}

export interface MuteChangeEvent {
  deviceId: string;
  roomName: string;
  previousMute: boolean;
  currentMute: boolean;
  timestamp: number;
}

export interface ContentUpdateEvent {
  deviceId: string;
  containerUpdateIDs: string;
  timestamp: number;
}

export interface TopologyChangeEvent {
  zones: ZoneGroup[];
  timestamp: number;
}

export interface TrackChangeEvent {
  deviceId: string;
  roomName: string;
  previousTrack: SonosTrack | null;
  currentTrack: SonosTrack | null;
  timestamp: number;
}

export class EventManager extends EventEmitter {
  private static instance: EventManager;
  private stateHistory: Map<string, StateChangeEvent[]> = new Map();
  private muteHistory: Map<string, MuteChangeEvent[]> = new Map();
  
  private constructor() {
    super();
    this.setMaxListeners(100); // Support many concurrent tests
    
    // Track mute change events for history
    this.on('mute-change', (event: MuteChangeEvent) => {
      if (!this.muteHistory.has(event.deviceId)) {
        this.muteHistory.set(event.deviceId, []);
      }
      
      const history = this.muteHistory.get(event.deviceId)!;
      history.push(event);
      
      // Keep only last 50 events
      if (history.length > 50) {
        history.shift();
      }
    });
  }
  
  static getInstance(): EventManager {
    if (!EventManager.instance) {
      EventManager.instance = new EventManager();
    }
    return EventManager.instance;
  }
  
  // Wait for a specific device to reach a specific state
  async waitForState(
    deviceId: string, 
    targetState: string | ((state: string) => boolean),
    timeout = 5000
  ): Promise<boolean> {
    // First check if we're already in the target state
    const currentState = this.getCurrentState(deviceId);
    if (currentState) {
      const matches = typeof targetState === 'function' 
        ? targetState(currentState)
        : currentState === targetState;
      if (matches) {
        return true; // Already in target state
      }
    }
    
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.off('state-change', stateHandler);
        resolve(false);
      }, timeout);
      
      const stateHandler = (event: StateChangeEvent) => {
        if (event.deviceId === deviceId) {
          const matches = typeof targetState === 'function' 
            ? targetState(event.currentState)
            : event.currentState === targetState;
            
          if (matches) {
            clearTimeout(timeoutId);
            this.off('state-change', stateHandler);
            resolve(true);
          }
        }
      };
      
      this.on('state-change', stateHandler);
    });
  }
  
  // Wait for device to exit TRANSITIONING state
  async waitForStableState(deviceId: string, timeout = 10000): Promise<string | null> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.off('state-change', stateHandler);
        resolve(null);
      }, timeout);
      
      const stateHandler = (event: StateChangeEvent) => {
        if (event.deviceId === deviceId && event.currentState !== 'TRANSITIONING') {
          clearTimeout(timeoutId);
          this.off('state-change', stateHandler);
          resolve(event.currentState);
        }
      };
      
      this.on('state-change', stateHandler);
    });
  }
  
  // Wait for volume to reach target
  async waitForVolume(deviceId: string, targetVolume: number, timeout = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.off('volume-change', volumeHandler);
        resolve(false);
      }, timeout);
      
      const volumeHandler = (event: VolumeChangeEvent) => {
        if (event.deviceId === deviceId && event.currentVolume === targetVolume) {
          clearTimeout(timeoutId);
          this.off('volume-change', volumeHandler);
          resolve(true);
        }
      };
      
      this.on('volume-change', volumeHandler);
    });
  }
  
  // Wait for group formation
  async waitForGroupChange(timeout = 5000): Promise<ZoneGroup[] | null> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.off('group-change', groupHandler);
        resolve(null);
      }, timeout);
      
      const groupHandler = (event: GroupChangeEvent) => {
        clearTimeout(timeoutId);
        this.off('group-change', groupHandler);
        resolve(event.zones);
      };
      
      this.on('group-change', groupHandler);
    });
  }
  
  // Wait for mute change
  async waitForMute(deviceId: string, targetMute: boolean, timeout = 5000): Promise<boolean> {
    // First check if we're already in the target mute state
    const currentMute = this.getCurrentMute(deviceId);
    if (currentMute !== null && currentMute === targetMute) {
      return true; // Already in target mute state
    }
    
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.off('mute-change', muteHandler);
        resolve(false);
      }, timeout);
      
      const muteHandler = (event: MuteChangeEvent) => {
        if (event.deviceId === deviceId && event.currentMute === targetMute) {
          clearTimeout(timeoutId);
          this.off('mute-change', muteHandler);
          resolve(true);
        }
      };
      
      this.on('mute-change', muteHandler);
    });
  }
  
  // Wait for content update
  async waitForContentUpdate(deviceId: string, timeout = 5000): Promise<string | null> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.off('content-update', contentHandler);
        resolve(null);
      }, timeout);
      
      const contentHandler = (event: ContentUpdateEvent) => {
        if (event.deviceId === deviceId) {
          clearTimeout(timeoutId);
          this.off('content-update', contentHandler);
          resolve(event.containerUpdateIDs);
        }
      };
      
      this.on('content-update', contentHandler);
    });
  }
  
  // Wait for topology change
  async waitForTopologyChange(timeout = 5000): Promise<ZoneGroup[] | null> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.off('topology-change', topologyHandler);
        resolve(null);
      }, timeout);
      
      const topologyHandler = (event: TopologyChangeEvent) => {
        clearTimeout(timeoutId);
        this.off('topology-change', topologyHandler);
        resolve(event.zones);
      };
      
      this.on('topology-change', topologyHandler);
    });
  }
  
  // Wait for track change
  async waitForTrackChange(deviceId: string, timeout = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.off('track-change', trackHandler);
        resolve(false);
      }, timeout);
      
      const trackHandler = (event: TrackChangeEvent) => {
        if (event.deviceId === deviceId) {
          clearTimeout(timeoutId);
          this.off('track-change', trackHandler);
          resolve(true);
        }
      };
      
      this.on('track-change', trackHandler);
    });
  }
  
  // Emit state change and track history
  emitStateChange(device: SonosDevice, previousState: string, currentState: string) {
    const event: StateChangeEvent = {
      deviceId: device.id,
      roomName: device.roomName,
      previousState,
      currentState,
      timestamp: Date.now()
    };
    
    // Track history for debugging
    if (!this.stateHistory.has(device.id)) {
      this.stateHistory.set(device.id, []);
    }
    this.stateHistory.get(device.id)!.push(event);
    
    // Keep only last 50 events per device
    const history = this.stateHistory.get(device.id)!;
    if (history.length > 50) {
      history.shift();
    }
    
    logger.debug(`State change: ${device.roomName} ${previousState} -> ${currentState}`);
    this.emit('state-change', event);
  }
  
  // Get current state from latest history entry
  getCurrentState(deviceId: string): string | null {
    const history = this.stateHistory.get(deviceId);
    if (!history || history.length === 0) {
      return null;
    }
    return history[history.length - 1]!.currentState;
  }
  
  // Get current mute state from latest history entry
  getCurrentMute(deviceId: string): boolean | null {
    const history = this.muteHistory.get(deviceId);
    if (!history || history.length === 0) {
      return null;
    }
    return history[history.length - 1]!.currentMute;
  }
  
  // Get state history for debugging
  getStateHistory(deviceId: string): StateChangeEvent[] {
    return this.stateHistory.get(deviceId) || [];
  }
  
  // Clear all listeners and history (for test cleanup)
  reset() {
    this.removeAllListeners();
    this.stateHistory.clear();
    this.muteHistory.clear();
  }
}