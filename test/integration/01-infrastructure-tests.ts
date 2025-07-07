import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig, getTestTimeout } from '../helpers/test-config.js';
import { testLog } from '../helpers/test-logger.js';

// Skip if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Core Infrastructure Tests', { skip: skipIntegration }, () => {
  let eventManager: EventManager;
  
  before(() => {
    testLog.info('🏗️  Testing core infrastructure...');
    eventManager = EventManager.getInstance();
  });
  
  afterEach(() => {
    // Clean up listeners after each test
    eventManager.reset();
  });
  
  describe('Server Health', () => {
    it('should respond to health check', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/health`);
      assert.strictEqual(response.status, 200);
      
      const health = await response.json();
      assert.strictEqual(health.status, 'healthy');
      assert(health.devices > 0, 'Should have discovered devices');
      assert(health.uptime > 0, 'Should have uptime');
    });
    
    it('should discover zones', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/zones`);
      assert.strictEqual(response.status, 200);
      
      const zones = await response.json();
      assert(Array.isArray(zones), 'Zones should be an array');
      assert(zones.length > 0, 'Should have at least one zone');
      
      // Verify zone structure
      const firstZone = zones[0];
      assert(firstZone.coordinator, 'Zone should have coordinator');
      assert(Array.isArray(firstZone.members), 'Zone should have members array');
      assert(firstZone.members.length > 0, 'Zone should have at least one member');
    });
    
    it('should get system state', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/state`);
      assert.strictEqual(response.status, 200);
      
      const states = await response.json();
      assert(Array.isArray(states), 'States should be an array');
      assert(states.length > 0, 'Should have device states');
      
      // Verify state structure
      const firstState = states[0];
      assert(firstState.room, 'State should have room name');
      assert(firstState.state, 'State should have state object');
      assert(firstState.state.hasOwnProperty('playbackState'), 'Should have playbackState');
      assert(firstState.state.hasOwnProperty('volume'), 'Should have volume');
      assert(firstState.state.hasOwnProperty('mute'), 'Should have mute');
    });
    
    it('should list all devices', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/devices`);
      assert.strictEqual(response.status, 200);
      
      const devices = await response.json();
      assert(Array.isArray(devices), 'Devices should be an array');
      assert(devices.length > 0, 'Should have at least one device');
      
      // Verify device structure
      const firstDevice = devices[0];
      assert(firstDevice.room, 'Device should have room name');
      assert(firstDevice.name, 'Device should have name');
      assert(firstDevice.id, 'Device should have id');
      assert(firstDevice.model, 'Device should have model');
      assert(firstDevice.ip, 'Device should have IP address');
      
      // Check if any devices have pairing info
      const pairedDevices = devices.filter((d: any) => d.paired);
      if (pairedDevices.length > 0) {
        const pairedDevice = pairedDevices[0];
        assert(pairedDevice.paired.role, 'Paired device should have role');
        assert(pairedDevice.paired.groupId, 'Paired device should have groupId');
      }
    });
    
    it('should get device by ID', async () => {
      // First get all devices to find a valid ID
      const devicesResponse = await fetch(`${defaultConfig.apiUrl}/devices`);
      const devices = await devicesResponse.json();
      assert(devices.length > 0, 'Need at least one device for this test');
      
      const testDevice = devices[0];
      const deviceId = testDevice.id.replace('uuid:', '');
      
      // Test with ID (without uuid: prefix)
      const response = await fetch(`${defaultConfig.apiUrl}/devices/id/${deviceId}`);
      assert.strictEqual(response.status, 200);
      
      const device = await response.json();
      assert.strictEqual(device.id, testDevice.id);
      assert.strictEqual(device.room, testDevice.room);
      assert.strictEqual(device.model, testDevice.model);
    });
    
    it('should handle invalid device ID', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/devices/id/INVALID_ID`);
      assert.strictEqual(response.status, 404);
      
      const error = await response.json();
      assert.strictEqual(error.status, 'error');
      assert(error.error.includes('not found'));
    });
    
    it('should get devices by room', async () => {
      // First get a valid room name
      const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
      const zones = await zonesResponse.json();
      assert(zones.length > 0, 'Need at least one zone for this test');
      
      const testRoom = zones[0].members[0].roomName;
      
      const response = await fetch(`${defaultConfig.apiUrl}/devices/room/${encodeURIComponent(testRoom)}`);
      assert.strictEqual(response.status, 200);
      
      const devices = await response.json();
      assert(Array.isArray(devices), 'Should return array of devices');
      assert(devices.length > 0, 'Should have at least one device in room');
      
      // All devices should be from the requested room
      devices.forEach((device: any) => {
        assert.strictEqual(device.room, testRoom);
      });
    });
    
    it('should handle invalid room name', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/devices/room/InvalidRoomName`);
      assert.strictEqual(response.status, 404);
      
      const error = await response.json();
      assert.strictEqual(error.status, 'error');
      assert(error.error.includes('not found'));
    });
  });
  
  describe('Event Manager', () => {
    it('should handle state change events', async () => {
      // Create a mock state change event
      const mockDevice = {
        id: 'TEST_DEVICE_001',
        roomName: 'Test Room',
        state: { playbackState: 'STOPPED' }
      } as any;
      
      // Set up event listener
      let eventReceived = false;
      eventManager.once('state-change', (event) => {
        eventReceived = true;
        assert.strictEqual(event.deviceId, 'TEST_DEVICE_001');
        assert.strictEqual(event.roomName, 'Test Room');
        assert.strictEqual(event.previousState, 'STOPPED');
        assert.strictEqual(event.currentState, 'PLAYING');
      });
      
      // Emit state change
      eventManager.emitStateChange(mockDevice, 'STOPPED', 'PLAYING');
      
      // Verify event was received
      assert(eventReceived, 'State change event should be received');
    });
    
    it('should wait for specific state with timeout', async () => {
      const mockDevice = {
        id: 'TEST_DEVICE_002',
        roomName: 'Test Room 2',
        state: { playbackState: 'STOPPED' }
      } as any;
      
      // Start waiting for PLAYING state
      const waitPromise = eventManager.waitForState('TEST_DEVICE_002', 'PLAYING', 1000);
      
      // Emit state change after 100ms
      setTimeout(() => {
        eventManager.emitStateChange(mockDevice, 'STOPPED', 'PLAYING');
      }, 100);
      
      // Should resolve to true
      const result = await waitPromise;
      assert.strictEqual(result, true, 'Should successfully wait for state');
    });
    
    it('should timeout when state is not reached', async () => {
      // Wait for a state that will never come
      const result = await eventManager.waitForState('TEST_DEVICE_003', 'PLAYING', 500);
      assert.strictEqual(result, false, 'Should timeout and return false');
    });
    
    it('should wait for stable state (not TRANSITIONING)', async () => {
      const mockDevice = {
        id: 'TEST_DEVICE_004',
        roomName: 'Test Room 4',
        state: { playbackState: 'STOPPED' }
      } as any;
      
      // Start waiting for stable state
      const waitPromise = eventManager.waitForStableState('TEST_DEVICE_004', 2000);
      
      // Emit TRANSITIONING first
      setTimeout(() => {
        eventManager.emitStateChange(mockDevice, 'STOPPED', 'TRANSITIONING');
      }, 100);
      
      // Then emit PLAYING
      setTimeout(() => {
        eventManager.emitStateChange(mockDevice, 'TRANSITIONING', 'PLAYING');
      }, 300);
      
      // Should resolve to PLAYING
      const result = await waitPromise;
      assert.strictEqual(result, 'PLAYING', 'Should wait for stable state');
    });
    
    it('should track state history', () => {
      const mockDevice = {
        id: 'TEST_DEVICE_005',
        roomName: 'Test Room 5',
        state: { playbackState: 'STOPPED' }
      } as any;
      
      // Emit several state changes
      eventManager.emitStateChange(mockDevice, 'STOPPED', 'TRANSITIONING');
      eventManager.emitStateChange(mockDevice, 'TRANSITIONING', 'PLAYING');
      eventManager.emitStateChange(mockDevice, 'PLAYING', 'PAUSED_PLAYBACK');
      
      // Get history
      const history = eventManager.getStateHistory('TEST_DEVICE_005');
      assert.strictEqual(history.length, 3, 'Should have 3 state changes in history');
      assert.strictEqual(history[0].currentState, 'TRANSITIONING');
      assert.strictEqual(history[1].currentState, 'PLAYING');
      assert.strictEqual(history[2].currentState, 'PAUSED_PLAYBACK');
    });
  });
  
  describe('Device State Tracking', () => {
    let testRoom: string;
    
    before(async () => {
      // Get first available room for testing
      const response = await fetch(`${defaultConfig.apiUrl}/zones`);
      const zones = await response.json();
      testRoom = zones[0].members[0].roomName;
      testLog.info(`   Using test room: ${testRoom}`);
    });
    
    it('should get room state with proper structure', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      assert.strictEqual(response.status, 200);
      
      const state = await response.json();
      
      // Verify all expected properties
      assert(state.hasOwnProperty('playbackState'), 'Should have playbackState');
      assert(state.hasOwnProperty('volume'), 'Should have volume');
      assert(state.hasOwnProperty('mute'), 'Should have mute');
      assert(state.hasOwnProperty('currentTrack'), 'Should have currentTrack');
      assert(state.hasOwnProperty('playMode'), 'Should have playMode');
      
      // Verify playMode structure
      assert(state.playMode.hasOwnProperty('repeat'), 'PlayMode should have repeat');
      assert(state.playMode.hasOwnProperty('shuffle'), 'PlayMode should have shuffle');
      assert(state.playMode.hasOwnProperty('crossfade'), 'PlayMode should have crossfade');
      
      // Verify data types
      assert(typeof state.playbackState === 'string', 'playbackState should be string');
      assert(typeof state.volume === 'number', 'volume should be number');
      assert(typeof state.mute === 'boolean', 'mute should be boolean');
      assert(state.volume >= 0 && state.volume <= 100, 'volume should be 0-100');
    });
    
    it('should handle concurrent state requests', async () => {
      // Make multiple concurrent requests
      const promises = Array(5).fill(null).map(() => 
        fetch(`${defaultConfig.apiUrl}/${testRoom}/state`)
      );
      
      const responses = await Promise.all(promises);
      
      // All should succeed
      responses.forEach(response => {
        assert.strictEqual(response.status, 200, 'All concurrent requests should succeed');
      });
      
      // All should return valid state
      const states = await Promise.all(responses.map(r => r.json()));
      states.forEach(state => {
        assert(state.hasOwnProperty('playbackState'), 'All states should be valid');
      });
    });
  });
  
  after(() => {
    testLog.info('   ✓ Core infrastructure tests complete');
  });
});