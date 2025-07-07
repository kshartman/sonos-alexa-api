import { EventEmitter } from 'events';
import logger from './logger.js';
import type { SonosDevice } from '../sonos-device.js';
import type { ZoneGroup } from '../topology-manager.js';
import type { SonosTrack, SonosState } from '../types/sonos.js';

// Helper function to compare device IDs, handling uuid: prefix
function compareDeviceIds(id1: string, id2: string): boolean {
  const stripUuid = (id: string) => id.startsWith('uuid:') ? id.substring(5) : id;
  return stripUuid(id1) === stripUuid(id2);
}

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
  private deviceListeners: Map<string, (state: SonosState, previousState?: Partial<SonosState>) => void> = new Map();
  
  // Device lifecycle tracking
  private registeredDevices: Set<string> = new Set(); // Devices that should have listeners
  private lastEventTime: Map<string, number> = new Map(); // Track last event per device
  private deviceHealthTimeout = 3600000; // 1 hour - if no events, consider unhealthy
  private staleNotifyTimeout = 90000; // 90 seconds - if no NOTIFY events, subscription may be stale
  private healthCheckInterval?: NodeJS.Timeout;
  private healthCheckIntervalMs = 60000; // Check every minute
  
  // Group/stereo pair tracking for event handling
  private groupMembersCache: Map<string, string[]> = new Map(); // device ID -> all IDs in group
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private discovery?: any; // Reference to discovery for topology info (circular dep prevents proper typing)
  
  private constructor() {
    super();
    this.setMaxListeners(100); // Support many concurrent tests
    
    // Start periodic health checks
    this.startHealthCheck();
    
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
    logger.trace(`EventManager: waitForState called for device ${deviceId}, target: ${typeof targetState === 'function' ? 'function' : targetState}, timeout: ${timeout}ms`);
    
    // Get all group members for this device
    const groupMembers = this.getGroupMembers(deviceId);
    logger.trace(`EventManager: waitForState - group members: ${groupMembers.join(', ')}`);
    
    // First check if we're already in the target state (check all group members)
    for (const memberId of groupMembers) {
      const currentState = this.getCurrentState(memberId);
      logger.trace(`EventManager: waitForState - checking member ${memberId}, current state: ${currentState}`);
      
      if (currentState) {
        const matches = typeof targetState === 'function' 
          ? targetState(currentState)
          : currentState === targetState;
        if (matches) {
          logger.trace(`EventManager: waitForState - device ${memberId} (group member of ${deviceId}) already in target state: ${currentState}`);
          return true; // Already in target state
        }
      }
    }
    
    logger.trace('EventManager: waitForState - no group members in target state, setting up listener');
    
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        logger.trace(`EventManager: waitForState - timeout reached for ${deviceId}`);
        this.off('state-change', stateHandler);
        resolve(false);
      }, timeout);
      
      const stateHandler = (event: StateChangeEvent) => {
        logger.trace(`EventManager: waitForState - state-change event received from ${event.deviceId}: ${event.previousState} -> ${event.currentState}`);
        
        // Check if the event is from any device in the group
        const isGroupMember = groupMembers.some(memberId => compareDeviceIds(event.deviceId, memberId));
        
        if (isGroupMember) {
          const matches = typeof targetState === 'function' 
            ? targetState(event.currentState)
            : event.currentState === targetState;
            
          logger.trace(`EventManager: waitForState - group member ${event.deviceId}, matches target: ${matches}`);
            
          if (matches) {
            logger.trace(`EventManager: waitForState - received state change from ${event.deviceId} (group member of ${deviceId})`);
            clearTimeout(timeoutId);
            this.off('state-change', stateHandler);
            resolve(true);
          }
        } else {
          logger.trace(`EventManager: waitForState - ignoring state change from ${event.deviceId} (not in group)`);
        }
      };
      
      logger.trace('EventManager: waitForState - registered handler, waiting for state-change events');
      this.on('state-change', stateHandler);
    });
  }
  
  // Wait for device to exit TRANSITIONING state
  async waitForStableState(deviceId: string, timeout = 10000): Promise<string | null> {
    // Get all group members for this device
    const groupMembers = this.getGroupMembers(deviceId);
    
    // First check if we're already in a stable state (check all group members)
    for (const memberId of groupMembers) {
      const currentState = this.getCurrentState(memberId);
      if (currentState && currentState !== 'TRANSITIONING') {
        logger.trace(`EventManager: waitForStableState - device ${memberId} (group member of ${deviceId}) already in stable state: ${currentState}`);
        return currentState; // Already in stable state
      }
    }
    
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.off('state-change', stateHandler);
        resolve(null);
      }, timeout);
      
      const stateHandler = (event: StateChangeEvent) => {
        // Check if the event is from any device in the group
        const isGroupMember = groupMembers.some(memberId => compareDeviceIds(event.deviceId, memberId));
        
        if (isGroupMember && event.currentState !== 'TRANSITIONING') {
          logger.trace(`EventManager: waitForStableState - received stable state from ${event.deviceId} (group member of ${deviceId})`);
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
    // Get all group members for this device
    const groupMembers = this.getGroupMembers(deviceId);
    logger.trace(`EventManager: waitForVolume called for device ${deviceId}, target: ${targetVolume}, group members: ${groupMembers.join(', ')}`);
    
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        logger.trace(`EventManager: waitForVolume - timeout reached for device ${deviceId}`);
        this.off('volume-change', volumeHandler);
        resolve(false);
      }, timeout);
      
      const volumeHandler = (event: VolumeChangeEvent) => {
        logger.trace(`EventManager: waitForVolume - received volume event from ${event.deviceId}: ${event.previousVolume} -> ${event.currentVolume}`);
        // Check if the event is from any device in the group
        const isGroupMember = groupMembers.some(memberId => compareDeviceIds(event.deviceId, memberId));
        logger.trace(`EventManager: waitForVolume - isGroupMember: ${isGroupMember}, targetMatch: ${event.currentVolume === targetVolume}`);
        
        if (isGroupMember && event.currentVolume === targetVolume) {
          logger.trace(`EventManager: waitForVolume - received volume change from ${event.deviceId} (group member of ${deviceId})`);
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
    // Get all group members for this device
    const groupMembers = this.getGroupMembers(deviceId);
    
    // First check if we're already in the target mute state (check all group members)
    for (const memberId of groupMembers) {
      const currentMute = this.getCurrentMute(memberId);
      if (currentMute !== null && currentMute === targetMute) {
        logger.trace(`EventManager: waitForMute - device ${memberId} (group member of ${deviceId}) already in target mute state: ${currentMute}`);
        return true; // Already in target mute state
      }
    }
    
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.off('mute-change', muteHandler);
        resolve(false);
      }, timeout);
      
      const muteHandler = (event: MuteChangeEvent) => {
        // Check if the event is from any device in the group
        const isGroupMember = groupMembers.some(memberId => compareDeviceIds(event.deviceId, memberId));
        
        if (isGroupMember && event.currentMute === targetMute) {
          logger.trace(`EventManager: waitForMute - received mute change from ${event.deviceId} (group member of ${deviceId})`);
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
    // Get all group members for this device
    const groupMembers = this.getGroupMembers(deviceId);
    
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.off('content-update', contentHandler);
        resolve(null);
      }, timeout);
      
      const contentHandler = (event: ContentUpdateEvent) => {
        // Check if the event is from any device in the group
        const isGroupMember = groupMembers.some(memberId => compareDeviceIds(event.deviceId, memberId));
        
        if (isGroupMember) {
          logger.trace(`EventManager: waitForContentUpdate - received content update from ${event.deviceId} (group member of ${deviceId})`);
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
    logger.trace(`EventManager: waitForTrackChange called for device ${deviceId} with timeout ${timeout}ms`);
    
    // Get all group members for this device
    const groupMembers = this.getGroupMembers(deviceId);
    logger.trace(`EventManager: waitForTrackChange - group members: ${groupMembers.join(', ')}`);
    
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        logger.trace(`EventManager: waitForTrackChange - timeout reached for ${deviceId}`);
        this.off('track-change', trackHandler);
        resolve(false);
      }, timeout);
      
      const trackHandler = (event: TrackChangeEvent) => {
        logger.trace(`EventManager: waitForTrackChange - track-change event received from ${event.deviceId}`);
        
        // Check if the event is from any device in the group
        const isGroupMember = groupMembers.some(memberId => compareDeviceIds(event.deviceId, memberId));
        
        if (isGroupMember) {
          logger.trace(`EventManager: waitForTrackChange - received track change from ${event.deviceId} (group member of ${deviceId})`);
          clearTimeout(timeoutId);
          this.off('track-change', trackHandler);
          resolve(true);
        } else {
          logger.trace(`EventManager: waitForTrackChange - ignoring track change from ${event.deviceId} (not in group)`);
        }
      };
      
      logger.trace('EventManager: waitForTrackChange - registered handler, waiting for track-change events');
      this.on('track-change', trackHandler);
    });
  }
  
  // Emit state change and track history
  emitStateChange(device: SonosDevice, previousState: string, currentState: string) {
    logger.trace(`EventManager: emitStateChange called for ${device.roomName} (${device.id}): ${previousState} -> ${currentState}`);
    
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
  
  // Wait for any device to reach one of the specified states
  async waitForAnyState(targetStates: string[], timeout = 5000): Promise<boolean> {
    logger.trace(`EventManager: waitForAnyState called for states ${targetStates.join(', ')} with timeout ${timeout}ms`);
    
    return new Promise((resolve) => {
      let resolved = false;
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          logger.trace('EventManager: waitForAnyState - timeout reached');
          this.off('state-change', stateHandler);
          resolve(false);
        }
      }, timeout);
      
      const stateHandler = (event: StateChangeEvent) => {
        if (targetStates.includes(event.currentState) && !resolved) {
          resolved = true;
          logger.trace(`EventManager: waitForAnyState - device ${event.deviceId} reached state ${event.currentState}`);
          clearTimeout(timeoutId);
          this.off('state-change', stateHandler);
          resolve(true);
        }
      };
      
      this.on('state-change', stateHandler);
    });
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
    // Remove all device listeners
    for (const [deviceId, listener] of this.deviceListeners) {
      const device = global.discovery?.getDeviceById(deviceId);
      if (device) {
        device.off('state-change', listener);
      }
    }
    this.deviceListeners.clear();
    this.registeredDevices.clear();
    this.lastEventTime.clear();
    this.stopHealthCheck();
  }
  
  // Register a device with the EventManager
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerDevice(device: any): void { // device type would create circular dependency
    // Track that we want to listen to this device
    this.registeredDevices.add(device.id);
    
    // Check if already has an active listener
    if (this.deviceListeners.has(device.id)) {
      logger.debug(`EventManager: Device ${device.roomName} (${device.id}) already has active listener`);
      return;
    }
    
    // Create a new listener for this device
    const listener = (state: SonosState, previousState?: Partial<SonosState>) => {
      logger.trace(`EventManager: Received state change for ${device.roomName} (${device.id}) - playback: ${previousState?.playbackState} -> ${state.playbackState}`);
      
      // Update last event time for health tracking
      this.lastEventTime.set(device.id, Date.now());
      // Emit state change event
      if (state.playbackState !== previousState?.playbackState) {
        this.emitStateChange(device, previousState?.playbackState || 'UNKNOWN', state.playbackState);
      }
      
      // Emit volume change event  
      if (state.volume !== previousState?.volume && previousState?.volume !== undefined) {
        const volumeEvent: VolumeChangeEvent = {
          deviceId: device.id,
          roomName: device.roomName,
          previousVolume: previousState.volume,
          currentVolume: state.volume,
          timestamp: Date.now()
        };
        this.emit('volume-change', volumeEvent);
      }
      
      // Emit mute change event
      if (state.mute !== previousState?.mute && previousState?.mute !== undefined) {
        const muteEvent: MuteChangeEvent = {
          deviceId: device.id,
          roomName: device.roomName,
          previousMute: previousState.mute,
          currentMute: state.mute,
          timestamp: Date.now()
        };
        this.emit('mute-change', muteEvent);
      }
      
      // Emit track change event
      if (state.currentTrack !== previousState?.currentTrack) {
        logger.trace(`EventManager: Track change detected for ${device.roomName} (${device.id})`);
        logger.trace(`  Previous track: ${JSON.stringify(previousState?.currentTrack)}`);
        logger.trace(`  Current track: ${JSON.stringify(state.currentTrack)}`);
        
        const trackEvent: TrackChangeEvent = {
          deviceId: device.id,
          roomName: device.roomName,
          previousTrack: previousState?.currentTrack || null,
          currentTrack: state.currentTrack,
          timestamp: Date.now()
        };
        
        logger.trace(`EventManager: Emitting track-change event for ${device.roomName}`);
        this.emit('track-change', trackEvent);
      } else {
        logger.trace(`EventManager: No track change for ${device.roomName} - tracks are the same`);
      }
    };
    
    // Store the listener reference so we can remove it later
    this.deviceListeners.set(device.id, listener);
    
    // Add the listener to the device
    device.on('state-change', listener);
    
    logger.debug(`EventManager: Registered device ${device.roomName} (${device.id})`);
  }
  
  // Unregister a device from the EventManager  
  unregisterDevice(deviceId: string, permanent: boolean = true): void {
    // Remove from registered devices if permanent
    if (permanent) {
      this.registeredDevices.delete(deviceId);
      this.lastEventTime.delete(deviceId);
    }
    
    const listener = this.deviceListeners.get(deviceId);
    if (listener) {
      const device = global.discovery?.getDeviceById(deviceId);
      if (device) {
        device.off('state-change', listener);
        logger.debug(`EventManager: Unregistered device ${device.roomName} (${deviceId})`);
      }
      this.deviceListeners.delete(deviceId);
    }
  }
  
  // Handle device going offline
  handleDeviceOffline(deviceId: string): void {
    logger.debug(`EventManager: Device ${deviceId} went offline`);
    // Remove active listener but keep registration
    this.unregisterDevice(deviceId, false);
  }
  
  // Handle device coming back online
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleDeviceOnline(device: any): void { // device type would create circular dependency
    logger.debug(`EventManager: Device ${device.roomName} (${device.id}) came online`);
    // If we should be listening to this device, re-register
    if (this.registeredDevices.has(device.id)) {
      logger.debug(`EventManager: Re-registering listener for ${device.roomName}`);
      this.registerDevice(device);
    }
  }
  
  // Check if a device is healthy based on last event time
  isDeviceHealthy(deviceId: string): boolean {
    const lastEvent = this.lastEventTime.get(deviceId);
    if (!lastEvent) return false;
    return (Date.now() - lastEvent) < this.deviceHealthTimeout;
  }
  
  // Get devices that haven't sent events recently
  getUnhealthyDevices(): string[] {
    const unhealthy: string[] = [];
    for (const [deviceId, lastEvent] of this.lastEventTime) {
      if ((Date.now() - lastEvent) >= this.deviceHealthTimeout) {
        unhealthy.push(deviceId);
      }
    }
    return unhealthy;
  }
  
  // Get device health status
  getDeviceHealth(): Map<string, {registered: boolean, hasListener: boolean, lastEventMs: number | null, healthy: boolean, staleNotify: boolean}> {
    const health = new Map();
    
    // Check all registered devices
    for (const deviceId of this.registeredDevices) {
      const lastEvent = this.lastEventTime.get(deviceId);
      const hasListener = this.deviceListeners.has(deviceId);
      const lastEventMs = lastEvent ? Date.now() - lastEvent : null;
      health.set(deviceId, {
        registered: true,
        hasListener,
        lastEventMs,
        healthy: lastEvent ? (Date.now() - lastEvent) < this.deviceHealthTimeout : false,
        staleNotify: lastEvent ? (Date.now() - lastEvent) > this.staleNotifyTimeout : true
      });
    }
    
    return health;
  }
  
  // Check if device has stale NOTIFY (no events for 90+ seconds)
  hasStaleNotify(deviceId: string): boolean {
    const lastEvent = this.lastEventTime.get(deviceId);
    if (!lastEvent) return true; // No events ever = stale
    return (Date.now() - lastEvent) > this.staleNotifyTimeout;
  }
  
  // Get all devices with stale NOTIFY subscriptions
  getStaleNotifyDevices(): string[] {
    const stale: string[] = [];
    for (const deviceId of this.registeredDevices) {
      if (this.hasStaleNotify(deviceId)) {
        stale.push(deviceId);
      }
    }
    return stale;
  }
  
  // Handle subscription renewal failure - device is likely offline
  handleSubscriptionFailure(deviceId: string): void {
    logger.warn(`EventManager: Device ${deviceId} subscription failed - marking as offline`);
    this.handleDeviceOffline(deviceId);
    this.emit('device-offline', { deviceId, timestamp: Date.now() });
  }
  
  // Handle successful subscription renewal
  handleSubscriptionRenewal(deviceId: string): void {
    // Update last event time to prevent false positives
    this.lastEventTime.set(deviceId, Date.now());
    logger.debug(`EventManager: Device ${deviceId} subscription renewed`);
  }
  
  // Start periodic health checks
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      const staleDevices = this.getStaleNotifyDevices();
      if (staleDevices.length > 0) {
        logger.debug(`EventManager: Found ${staleDevices.length} devices with stale NOTIFY subscriptions`);
        // Emit event so discovery can attempt to resubscribe
        this.emit('devices-need-resubscribe', staleDevices);
      }
    }, this.healthCheckIntervalMs);
  }
  
  // Stop health checks (for cleanup)
  stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }
  
  // Set discovery reference for group tracking
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setDiscovery(discovery: any): void { // discovery type would create circular dependency
    this.discovery = discovery;
    // Update group cache when discovery is set
    this.updateGroupMembersCache();
  }
  
  // Update group members cache from current topology
  updateGroupMembersCache(): void {
    if (!this.discovery) return;
    
    const topology = this.discovery.getTopology();
    if (!topology?.zones) return;
    
    // Clear existing cache
    this.groupMembersCache.clear();
    
    // Build cache from topology
    for (const zone of topology.zones) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const memberIds = zone.members.map((m: any) => m.id); // member type would create circular dependency
      
      // For each member in the zone, store all member IDs
      for (const member of zone.members) {
        this.groupMembersCache.set(member.id, memberIds);
      }
    }
    
    logger.debug(`EventManager: Updated group members cache with ${this.groupMembersCache.size} entries`);
  }
  
  // Get all device IDs in the same group as the given device
  getGroupMembers(deviceId: string): string[] {
    // Strip uuid: prefix for consistency
    const cleanId = deviceId.startsWith('uuid:') ? deviceId : `uuid:${deviceId}`;
    const members = this.groupMembersCache.get(cleanId);
    
    if (members) {
      logger.trace(`EventManager: Device ${deviceId} is in group with ${members.length} members`);
      return members;
    }
    
    // If not in cache, return just the device itself
    return [cleanId];
  }
}