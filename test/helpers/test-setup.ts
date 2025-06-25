import { EventManager } from '../../src/utils/event-manager.js';
import logger from '../../src/utils/logger.js';

/**
 * Sets up the connection between the server's discovery system and the test EventManager
 * This allows tests to receive actual UPnP events from Sonos devices
 */
export class TestEventSetup {
  private eventManager: EventManager;
  private eventSource?: EventSource;
  private isConnected = false;

  constructor() {
    this.eventManager = EventManager.getInstance();
  }

  /**
   * Connect to the server's event stream to receive state changes
   */
  async connect(apiUrl: string): Promise<void> {
    if (this.isConnected) return;

    logger.info('TestEventSetup: Connecting to server event stream');

    // The server should have an SSE endpoint that forwards discovery events
    // For now, we'll need to add this to the server
    // But first, let's check if there's already a webhook or SSE endpoint
    
    try {
      // Try to use the /webhook endpoint if it exists
      const webhookUrl = `${apiUrl}/webhook`;
      
      this.eventSource = new EventSource(webhookUrl);
      
      this.eventSource.addEventListener('device-state-change', (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Find device ID from room name
          // This is a limitation - we need the device ID for the EventManager
          // but the webhook only provides room name
          
          // For now, emit with room name as device ID
          this.eventManager.emit('state-change', {
            deviceId: data.room, // Using room name as ID for now
            roomName: data.room,
            previousState: 'UNKNOWN', // Webhook doesn't provide previous state
            currentState: data.state.playbackState,
            timestamp: Date.now()
          });
          
          // Also emit volume changes
          if (data.state.volume !== undefined) {
            this.eventManager.emit('volume-change', {
              deviceId: data.room,
              roomName: data.room,
              previousVolume: 0, // Unknown
              currentVolume: data.state.volume,
              timestamp: Date.now()
            });
          }
          
        } catch (error) {
          logger.error('TestEventSetup: Error parsing event:', error);
        }
      });
      
      this.eventSource.addEventListener('error', (error) => {
        logger.error('TestEventSetup: EventSource error:', error);
      });
      
      this.isConnected = true;
      logger.info('TestEventSetup: Connected to event stream');
      
    } catch (error) {
      logger.error('TestEventSetup: Failed to connect:', error);
      throw error;
    }
  }

  /**
   * Disconnect from event stream
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }
    this.isConnected = false;
    logger.info('TestEventSetup: Disconnected from event stream');
  }
}

// For tests that need to map device IDs properly
export async function getDeviceIdMapping(apiUrl: string): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  
  try {
    const response = await fetch(`${apiUrl}/zones`);
    if (response.ok) {
      const zones = await response.json();
      for (const zone of zones) {
        for (const member of zone.members) {
          mapping.set(member.roomName, member.id);
        }
      }
    }
  } catch (error) {
    logger.error('Failed to get device ID mapping:', error);
  }
  
  return mapping;
}