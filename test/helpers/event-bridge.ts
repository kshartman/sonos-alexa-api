import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from './test-config.js';
import { testLog } from './test-logger.js';
import http from 'http';

/**
 * Bridges Server-Sent Events from the API to the test EventManager
 * This allows tests to receive actual UPnP events from Sonos devices
 */
export class EventBridge {
  private eventManager: EventManager;
  private sseConnection?: http.IncomingMessage;
  private deviceIdMap: Map<string, string> = new Map();
  private coordinatorMap: Map<string, boolean> = new Map(); // deviceId -> isCoordinator
  private recentVolumeChanges: Map<string, number> = new Map(); // volumeChangeKey -> timestamp

  constructor() {
    this.eventManager = EventManager.getInstance();
  }

  /**
   * Connect to the server's SSE endpoint to receive UPnP events
   */
  async connect(): Promise<void> {
    testLog.info('EventBridge: Connecting to server SSE endpoint');
    
    // First, get device ID mapping and group members
    await this.updateDeviceIdMap();
    await this.updateGroupMembersCache();
    
    // Connect to SSE endpoint
    const url = new URL(`${defaultConfig.apiUrl}/events`);
    
    return new Promise((resolve, reject) => {
      const req = http.get({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        headers: {
          'Accept': 'text/event-stream'
        }
      }, (res) => {
        if (res.statusCode !== 200) {
          const error = new Error(`SSE connection failed: ${res.statusCode}`);
          testLog.error('EventBridge:', error);
          reject(error);
          return;
        }
        
        this.sseConnection = res;
        testLog.info('EventBridge: Connected to SSE endpoint');
        resolve();
        
        // Handle SSE data
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          
          // Process complete events
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6));
                this.processEvent(data);
              } catch (error) {
                testLog.error('EventBridge: Error parsing SSE data:', error);
              }
            }
          }
        });
        
        res.on('error', (error) => {
          testLog.error('EventBridge: SSE connection error:', error);
        });
        
        res.on('end', () => {
          testLog.info('EventBridge: SSE connection closed');
          this.sseConnection = undefined;
        });
      });
      
      req.on('error', (error) => {
        testLog.error('EventBridge: Failed to connect to SSE:', error);
        reject(error);
      });
    });
  }
  
  private processEvent(data: any): void {
    testLog.trace(`EventBridge: Processing event type: ${data.type}`);
    
    if (data.type === 'device-state-change') {
      const roomName = data.data.room;
      const eventDeviceId = data.data.deviceId;
      const mappedDeviceId = this.deviceIdMap.get(roomName);
      
      const deviceId = eventDeviceId || mappedDeviceId || roomName;
      const newState = data.data.state.playbackState;
      const previousState = data.data.previousState?.playbackState || 'UNKNOWN';
      
      testLog.trace(`EventBridge: device-state-change for ${roomName} (${deviceId}), state: ${previousState} -> ${newState}`);
      
      // Create state change event
      const stateChangeEvent = {
        deviceId,
        roomName,
        previousState,
        currentState: newState,
        timestamp: Date.now()
      };
      
      // Track history manually since we're not going through emitStateChange
      const history = (this.eventManager as any).stateHistory;
      if (!history.has(deviceId)) {
        history.set(deviceId, []);
      }
      history.get(deviceId).push(stateChangeEvent);
      
      // Keep only last 50 events
      const deviceHistory = history.get(deviceId);
      if (deviceHistory.length > 50) {
        deviceHistory.shift();
      }
      
      // Emit to EventManager
      this.eventManager.emit('state-change', stateChangeEvent);
      
      // Also emit volume/mute changes if present
      if (data.data.state.volume !== undefined && 
          data.data.previousState?.volume !== data.data.state.volume) {
        // In debug mode, only log volume changes from coordinators to reduce noise
        const isCoordinator = this.coordinatorMap.get(deviceId);
        
        // Create a unique key for this volume change to detect duplicates
        const volumeChangeKey = `${roomName}-${data.data.previousState?.volume}-${data.data.state.volume}`;
        const now = Date.now();
        
        // Track recent volume changes to filter duplicates
        if (!this.recentVolumeChanges) {
          this.recentVolumeChanges = new Map();
        }
        
        // Check if we've seen this exact change recently (within 100ms)
        const lastSeen = this.recentVolumeChanges.get(volumeChangeKey);
        if (lastSeen && (now - lastSeen) < 100) {
          // Skip duplicate volume change
          testLog.trace(`EventBridge: Skipping duplicate volume change for ${roomName}`);
        } else {
          // Record this volume change
          this.recentVolumeChanges.set(volumeChangeKey, now);
          
          // Clean up old entries (older than 1 second)
          for (const [key, time] of this.recentVolumeChanges.entries()) {
            if (now - time > 1000) {
              this.recentVolumeChanges.delete(key);
            }
          }
          
          // Log the volume change
          if (process.env.LOG_LEVEL === 'trace' || isCoordinator !== false) {
            testLog.debug(`EventBridge: Volume change detected for ${roomName}: ${data.data.previousState?.volume} -> ${data.data.state.volume}`);
          }
        }
        const volumeEvent = {
          deviceId,
          roomName,
          previousVolume: data.data.previousState?.volume || 0,
          currentVolume: data.data.state.volume,
          timestamp: Date.now()
        };
        testLog.trace(`EventBridge: Emitting volume-change event:`, volumeEvent);
        this.eventManager.emit('volume-change', volumeEvent);
      }
      
      if (data.data.state.mute !== undefined && 
          data.data.previousState?.mute !== data.data.state.mute) {
        const muteEvent = {
          deviceId,
          roomName,
          previousMute: data.data.previousState?.mute || false,
          currentMute: data.data.state.mute,
          timestamp: Date.now()
        };
        
        // Track mute history manually
        const muteHistory = (this.eventManager as any).muteHistory;
        if (!muteHistory.has(deviceId)) {
          muteHistory.set(deviceId, []);
        }
        muteHistory.get(deviceId).push(muteEvent);
        
        // Keep only last 50 events
        const deviceMuteHistory = muteHistory.get(deviceId);
        if (deviceMuteHistory.length > 50) {
          deviceMuteHistory.shift();
        }
        
        this.eventManager.emit('mute-change', muteEvent);
      }
    } else if (data.type === 'content-update') {
      // Forward content update events
      this.eventManager.emit('content-update', {
        deviceId: data.data.deviceId,
        containerUpdateIDs: data.data.containerUpdateIDs,
        timestamp: Date.now()
      });
    } else if (data.type === 'topology-change') {
      // Forward topology change events
      this.eventManager.emit('topology-change', {
        zones: data.data.zones,
        timestamp: Date.now()
      });
    } else if (data.type === 'track-change') {
      // Forward track change events
      testLog.trace(`EventBridge: Received track-change event for ${data.data.roomName} (${data.data.deviceId})`);
      this.eventManager.emit('track-change', {
        deviceId: data.data.deviceId,
        roomName: data.data.roomName,
        previousTrack: data.data.previousTrack,
        currentTrack: data.data.currentTrack,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Update the room name to device ID mapping
   */
  private async updateDeviceIdMap(): Promise<void> {
    try {
      const response = await fetch(`${defaultConfig.apiUrl}/zones`);
      if (response.ok) {
        const zones = await response.json();
        
        // Clear existing maps
        this.deviceIdMap.clear();
        this.coordinatorMap.clear();
        
        // Build new maps
        for (const zone of zones) {
          for (const member of zone.members) {
            this.deviceIdMap.set(member.roomName, member.id);
            this.coordinatorMap.set(member.id, member.isCoordinator);
          }
        }
        
      }
    } catch (error) {
      testLog.error('EventBridge: Failed to update device ID map:', error);
    }
  }

  /**
   * Update the group members cache in EventManager
   */
  private async updateGroupMembersCache(): Promise<void> {
    try {
      const response = await fetch(`${defaultConfig.apiUrl}/zones`);
      if (response.ok) {
        const zones = await response.json();
        
        // Get the groupMembersCache from EventManager (using any to access private member)
        const groupMembersCache = (this.eventManager as any).groupMembersCache as Map<string, string[]>;
        
        // Clear existing cache
        groupMembersCache.clear();
        
        // Build cache from topology
        for (const zone of zones) {
          const memberIds = zone.members.map((m: any) => m.id);
          
          // For each member in the zone, store all member IDs
          for (const member of zone.members) {
            groupMembersCache.set(member.id, memberIds);
          }
        }
        
        testLog.debug(`EventBridge: Updated group members cache with ${groupMembersCache.size} entries`);
      }
    } catch (error) {
      testLog.error('EventBridge: Failed to update group members cache:', error);
    }
  }

  /**
   * Disconnect from SSE endpoint
   */
  disconnect(): void {
    if (this.sseConnection) {
      this.sseConnection.destroy();
      this.sseConnection = undefined;
    }
    testLog.info('EventBridge: Disconnected from SSE endpoint');
  }
}

// Singleton instance
let bridgeInstance: EventBridge | null = null;

export async function startEventBridge(): Promise<void> {
  if (!bridgeInstance) {
    bridgeInstance = new EventBridge();
  }
  await bridgeInstance.connect();
  
  // Wait for the event bridge to be fully ready and for any initial events to settle
  testLog.info('⏳ Waiting for event bridge to establish...');
  await new Promise(resolve => setTimeout(resolve, 2000));
}

export function stopEventBridge(): void {
  if (bridgeInstance) {
    bridgeInstance.disconnect();
    bridgeInstance = null;
  }
}