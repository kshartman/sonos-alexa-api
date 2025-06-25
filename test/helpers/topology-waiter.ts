import { EventEmitter } from 'events';
import { defaultConfig, Zone } from './test-config.js';

export type TopologyCondition = (zones: Zone[]) => boolean;

export class TopologyWaiter extends EventEmitter {
  private static instance?: TopologyWaiter;
  
  static getInstance(): TopologyWaiter {
    if (!TopologyWaiter.instance) {
      TopologyWaiter.instance = new TopologyWaiter();
    }
    return TopologyWaiter.instance;
  }

  /**
   * Wait for a specific topology condition to be met
   * @param condition Function that returns true when desired topology state is reached
   * @param timeout Maximum time to wait in milliseconds (default: 5000)
   * @returns Promise that resolves with the zones when condition is met
   */
  async waitForTopologyCondition(
    condition: TopologyCondition, 
    timeout: number = 5000
  ): Promise<Zone[]> {
    return new Promise(async (resolve, reject) => {
      let timeoutId: NodeJS.Timeout;
      let checkCondition: (() => Promise<void>) | undefined;
      
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (checkCondition) this.off('topology-change', checkCondition);
        this.stopPolling();
      };
      
      // Set up timeout
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Topology condition not met within ${timeout}ms`));
      }, timeout);
      
      // Check current state first
      try {
        const currentZones = await this.getCurrentZones();
        if (condition(currentZones)) {
          cleanup();
          resolve(currentZones);
          return;
        }
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      
      // Listen for topology changes
      checkCondition = async () => {
        try {
          const zones = await this.getCurrentZones();
          if (condition(zones)) {
            cleanup();
            resolve(zones);
          }
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      
      this.on('topology-change', checkCondition);
      
      // Start polling for changes (since we don't have direct access to discovery events in tests)
      this.startPolling();
    });
  }

  private async getCurrentZones(): Promise<Zone[]> {
    const response = await fetch(`${defaultConfig.apiUrl}/zones`);
    if (!response.ok) {
      throw new Error(`Failed to get zones: ${response.statusText}`);
    }
    return response.json();
  }

  private pollingInterval?: NodeJS.Timeout;
  private lastZonesHash?: string;

  private startPolling(): void {
    if (this.pollingInterval) {
      return; // Already polling
    }

    this.pollingInterval = setInterval(async () => {
      try {
        const zones = await this.getCurrentZones();
        const zonesHash = JSON.stringify(zones.map(z => ({
          id: z.id,
          coordinator: z.coordinator,
          memberCount: z.members.length,
          memberNames: z.members.map(m => m.roomName).sort()
        })));
        
        if (zonesHash !== this.lastZonesHash) {
          this.lastZonesHash = zonesHash;
          this.emit('topology-change', zones);
        }
      } catch (error) {
        // Ignore polling errors
      }
    }, 500); // Poll every 500ms
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }
  }
}

// Helper functions for common topology conditions
export const TopologyConditions = {
  /**
   * Check if two rooms are in the same group
   */
  roomsGrouped: (room1: string, room2: string): TopologyCondition => {
    return (zones: Zone[]) => {
      return zones.some(zone => 
        zone.members.some(m => m.roomName === room1) &&
        zone.members.some(m => m.roomName === room2)
      );
    };
  },

  /**
   * Check if two rooms are in different groups (ungrouped)
   */
  roomsUngrouped: (room1: string, room2: string): TopologyCondition => {
    return (zones: Zone[]) => {
      const room1Zone = zones.find(z => z.members.some(m => m.roomName === room1));
      const room2Zone = zones.find(z => z.members.some(m => m.roomName === room2));
      return room1Zone && room2Zone && room1Zone.id !== room2Zone.id;
    };
  },

  /**
   * Check if a room is standalone (only member in its zone, excluding stereo pairs)
   */
  roomStandalone: (roomName: string): TopologyCondition => {
    return (zones: Zone[]) => {
      const zone = zones.find(z => z.members.some(m => m.roomName === roomName));
      if (!zone) return false;
      
      // Check if it's a stereo pair (same room name multiple times)
      const uniqueRoomNames = new Set(zone.members.map(m => m.roomName));
      const isStereoPair = uniqueRoomNames.size === 1 && zone.members.length === 2;
      
      return zone.members.length === 1 || isStereoPair;
    };
  },

  /**
   * Check if a group has a specific number of members
   */
  groupMemberCount: (coordinatorRoom: string, expectedCount: number): TopologyCondition => {
    return (zones: Zone[]) => {
      const zone = zones.find(z => z.coordinator === coordinatorRoom);
      return zone ? zone.members.length === expectedCount : false;
    };
  }
};

// Export singleton instance
export const topologyWaiter = TopologyWaiter.getInstance();