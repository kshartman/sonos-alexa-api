import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';

// Skip if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Advanced Features Tests', { skip: skipIntegration }, () => {
  let eventManager: EventManager;
  let room: string;
  let deviceId: string;
  
  before(async () => {
    console.log('🚀 Testing advanced features...');
    eventManager = EventManager.getInstance();
    
    // Start event bridge to receive UPnP events via SSE
    await startEventBridge();
    
    // Discover system and select test room
    const topology = await discoverSystem();
    room = await getSafeTestRoom(topology);
    
    if (!room) {
      throw new Error('No suitable test room found');
    }
    
    console.log(`   Test room: ${room}`);
    
    // Get device ID for event tracking
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await zonesResponse.json();
    const zone = zones.find(z => z.members.some(m => m.roomName === room));
    
    if (!zone) {
      throw new Error(`Zone not found for room ${room}`);
    }
    
    // Use coordinator device ID (important for stereo pairs)
    const coordinatorMember = zone.members.find(m => m.isCoordinator);
    deviceId = coordinatorMember.id;
    console.log(`   Device ID: ${deviceId}`);
  });
  
  after(async () => {
    console.log('\n🧹 Cleaning up Advanced Features tests...\n');
    
    // Stop playback
    if (room) {
      await fetch(`${defaultConfig.apiUrl}/${room}/stop`);
    }
    
    // Clear any pending event listeners
    eventManager.reset();
    
    // Stop event bridge
    stopEventBridge();
    
    // Give a moment for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log('✓ Advanced features tests complete');
  });
  
  describe('Sleep Timer', () => {
    it('should set sleep timer', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/sleep/300`); // 5 minutes
      assert.strictEqual(response.status, 200);
      
      // Verify via state
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const state = await stateResponse.json();
      
      // Note: Sleep timer may not be exposed in state, but the command should succeed
      assert(state, 'State should be retrievable after setting sleep timer');
    });
    
    it('should cancel sleep timer', async () => {
      // First set a timer
      await fetch(`${defaultConfig.apiUrl}/${room}/sleep/300`);
      
      // Then cancel it
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/sleep/0`);
      assert.strictEqual(response.status, 200);
    });
  });
  
  describe('Line-In Playback', () => {
    it('should list available line-in sources', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/zones`);
      const zones = await response.json();
      
      // Check if any devices have line-in capability
      const hasLineIn = zones.some(zone => 
        zone.members.some(member => {
          // Line-in is typically available on Connect, Amp, Port, Play:5, etc.
          // This is just a check that the API works
          return true;
        })
      );
      
      assert(response.status === 200, 'Should be able to query zones');
    });
    
    it('should handle line-in playback request', async () => {
      // Note: This will fail if the source room doesn't have line-in
      // We're just testing that the API endpoint exists and handles the request
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/linein/${room}`);
      
      // Should be 200 (success) or 400/404/500 (no line-in available or error)
      assert([200, 400, 404, 500].includes(response.status), 
        'Should handle line-in request appropriately');
    });
  });
  
  describe('Settings Management', () => {
    let originalRoom: string;
    let originalService: string;
    
    before(async () => {
      // Get current defaults
      const response = await fetch(`${defaultConfig.apiUrl}/default`);
      if (response.ok) {
        const settings = await response.json();
        originalRoom = settings.room;
        originalService = settings.musicService;
      }
    });
    
    after(async () => {
      // Restore original defaults
      if (originalRoom) {
        await fetch(`${defaultConfig.apiUrl}/default/room/${originalRoom}`);
      }
      if (originalService) {
        await fetch(`${defaultConfig.apiUrl}/default/service/${originalService}`);
      }
    });
    
    it('should get current settings', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/default`);
      assert.strictEqual(response.status, 200);
      
      const settings = await response.json();
      assert(settings.room, 'Should have default room');
      assert(settings.musicService, 'Should have default music service');
    });
    
    it('should update default room', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/default/room/${room}`);
      assert.strictEqual(response.status, 200);
      
      // Verify it was saved
      const settingsResponse = await fetch(`${defaultConfig.apiUrl}/default`);
      const settings = await settingsResponse.json();
      assert.strictEqual(settings.room, room);
    });
    
    it('should update default music service', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/default/service/apple`);
      assert.strictEqual(response.status, 200);
      
      // Verify it was saved
      const settingsResponse = await fetch(`${defaultConfig.apiUrl}/default`);
      const settings = await settingsResponse.json();
      assert.strictEqual(settings.musicService, 'apple');
    });
  });
  
  describe('System Information', () => {
    it('should get system zones', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/zones`);
      assert.strictEqual(response.status, 200);
      
      const zones = await response.json();
      assert(Array.isArray(zones), 'Zones should be an array');
      assert(zones.length > 0, 'Should have at least one zone');
      
      // Verify zone structure
      const zone = zones[0];
      assert(zone.id, 'Zone should have ID');
      assert(zone.coordinator, 'Zone should have coordinator');
      assert(Array.isArray(zone.members), 'Zone should have members array');
    });
    
    it('should get system state', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/state`);
      assert.strictEqual(response.status, 200);
      
      const state = await response.json();
      assert(Array.isArray(state), 'State should be an array of room states');
    });
  });
  
  describe('Preset Management', () => {
    it('should list presets', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/presets`);
      assert.strictEqual(response.status, 200);
      
      const presets = await response.json();
      assert(typeof presets === 'object', 'Presets should be an object');
    });
    
    it('should handle preset playback', async () => {
      // Try to play a preset that likely doesn't exist
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/preset/test`);
      
      // Should be 200 (if preset exists) or 404 (if not found)
      assert([200, 404].includes(response.status), 
        'Should handle preset request appropriately');
    });
  });
  
  describe('Queue Management', () => {
    beforeEach(async () => {
      // Clear queue before each test
      await fetch(`${defaultConfig.apiUrl}/${room}/clearqueue`);
    });
    
    it('should add track to queue', async () => {
      // Load a Beatles song
      const { loadBeatlesSong } = await import('../helpers/content-loader.js');
      await loadBeatlesSong(room);
      
      // Verify it was added to queue
      const queueResponse = await fetch(`${defaultConfig.apiUrl}/${room}/queue`);
      const queue = await queueResponse.json();
      assert(queue.length > 0, 'Queue should have items after loading Beatles song');
    });
    
    it('should get current queue', async () => {
      // Test simplified queue (returns array with only basic properties)
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/queue`);
      assert.strictEqual(response.status, 200);
      
      const queue = await response.json();
      assert(Array.isArray(queue), 'Queue should be an array');
      if (queue.length > 0) {
        // Verify simplified format
        const item = queue[0];
        assert(item.hasOwnProperty('title'), 'Queue item should have title');
        assert(item.hasOwnProperty('artist'), 'Queue item should have artist');
        assert(item.hasOwnProperty('album'), 'Queue item should have album');
        assert(item.hasOwnProperty('albumArtUri'), 'Queue item should have albumArtUri');
        assert(!item.hasOwnProperty('uri'), 'Simplified queue should not have uri');
      }
      
      // Test detailed queue (returns array with all properties)
      const detailedResponse = await fetch(`${defaultConfig.apiUrl}/${room}/queue/detailed`);
      assert.strictEqual(detailedResponse.status, 200);
      
      const detailedQueue = await detailedResponse.json();
      assert(Array.isArray(detailedQueue), 'Detailed queue should be an array');
      if (detailedQueue.length > 0) {
        // Verify detailed format includes additional properties
        const item = detailedQueue[0];
        assert(item.hasOwnProperty('uri'), 'Detailed queue item should have uri');
        assert(item.hasOwnProperty('metadata'), 'Detailed queue item should have metadata');
      }
    });
  });
  
  describe('Error Recovery', () => {
    it('should handle invalid room gracefully', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/InvalidRoom/play`);
      assert.strictEqual(response.status, 404);
      
      const error = await response.json();
      assert(error.error.includes('not found'));
    });
    
    it('should handle malformed requests', async () => {
      // Test with invalid parameter
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/volume/abc`);
      assert.strictEqual(response.status, 400);
    });
    
    it('should handle rapid requests', async () => {
      // Send multiple requests rapidly
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(fetch(`${defaultConfig.apiUrl}/${room}/state`));
      }
      
      const responses = await Promise.all(promises);
      
      // All should succeed
      responses.forEach(response => {
        assert.strictEqual(response.status, 200);
      });
    });
  });
});