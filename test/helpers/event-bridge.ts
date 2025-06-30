import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from './test-config.js';
import logger from '../../src/utils/logger.js';
import http from 'http';

/**
 * Bridges Server-Sent Events from the API to the test EventManager
 * This allows tests to receive actual UPnP events from Sonos devices
 */
export class EventBridge {
  private eventManager: EventManager;
  private sseConnection?: http.IncomingMessage;
  private deviceIdMap: Map<string, string> = new Map();

  constructor() {
    this.eventManager = EventManager.getInstance();
  }

  /**
   * Connect to the server's SSE endpoint to receive UPnP events
   */
  async connect(): Promise<void> {
    logger.info('EventBridge: Connecting to server SSE endpoint');
    
    // First, get device ID mapping
    await this.updateDeviceIdMap();
    
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
          reject(new Error(`SSE connection failed: ${res.statusCode}`));
          return;
        }
        
        this.sseConnection = res;
        logger.info('EventBridge: Connected to SSE endpoint');
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
                logger.debug(`EventBridge: Received SSE data: ${line.substring(6)}`);
                this.processEvent(data);
              } catch (error) {
                logger.error('EventBridge: Error parsing SSE data:', error);
              }
            }
          }
        });
        
        res.on('error', (error) => {
          logger.error('EventBridge: SSE connection error:', error);
        });
        
        res.on('end', () => {
          logger.info('EventBridge: SSE connection closed');
          this.sseConnection = undefined;
        });
      });
      
      req.on('error', (error) => {
        logger.error('EventBridge: Failed to connect to SSE:', error);
        reject(error);
      });
    });
  }
  
  private processEvent(data: any): void {
    logger.debug(`EventBridge: Processing SSE event - type: ${data.type}`);
    
    if (data.type === 'device-state-change') {
      logger.debug(`EventBridge: State change for ${data.data.room} - volume: ${data.data.state?.volume}, mute: ${data.data.state?.mute}`);
      const roomName = data.data.room;
      const eventDeviceId = data.data.deviceId;
      const mappedDeviceId = this.deviceIdMap.get(roomName);
      
      const deviceId = eventDeviceId || mappedDeviceId || roomName;
      const newState = data.data.state.playbackState;
      const previousState = data.data.previousState?.playbackState || 'UNKNOWN';
      
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
        this.eventManager.emit('volume-change', {
          deviceId,
          roomName,
          previousVolume: data.data.previousState?.volume || 0,
          currentVolume: data.data.state.volume,
          timestamp: Date.now()
        });
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
        
        // Clear existing map
        this.deviceIdMap.clear();
        
        // Build new map
        for (const zone of zones) {
          for (const member of zone.members) {
            this.deviceIdMap.set(member.roomName, member.id);
          }
        }
        
        logger.debug(`EventBridge: Updated device ID map with ${this.deviceIdMap.size} devices`);
      }
    } catch (error) {
      logger.error('EventBridge: Failed to update device ID map:', error);
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
    logger.info('EventBridge: Disconnected from SSE endpoint');
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
  console.log('⏳ Waiting for event bridge to establish...');
  await new Promise(resolve => setTimeout(resolve, 2000));
}

export function stopEventBridge(): void {
  if (bridgeInstance) {
    bridgeInstance.disconnect();
    bridgeInstance = null;
  }
}