import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { defaultConfig, getTestTimeout } from '../helpers/test-config.js';
import { testLog } from '../helpers/test-logger.js';

// Skip if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Core Infrastructure Tests', { skip: skipIntegration }, () => {
  before(() => {
    testLog.info('🏗️  Testing core infrastructure...');
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
      assert(devices.length > 0, 'Should have discovered devices');
      
      // Verify device structure
      const firstDevice = devices[0];
      assert(firstDevice.id, 'Device should have ID');
      assert(firstDevice.room, 'Device should have room name');
      assert(firstDevice.name, 'Device should have name');
      assert(firstDevice.model, 'Device should have model name');
      assert(firstDevice.ip, 'Device should have IP address');
    });
    
    it('should get device by ID', async () => {
      // First get list of devices
      const listResponse = await fetch(`${defaultConfig.apiUrl}/devices`);
      const devices = await listResponse.json();
      const firstDevice = devices[0];
      
      // Get device by ID
      const response = await fetch(`${defaultConfig.apiUrl}/devices/id/${firstDevice.id}`);
      assert.strictEqual(response.status, 200);
      
      const device = await response.json();
      assert.strictEqual(device.id, firstDevice.id);
      assert.strictEqual(device.room, firstDevice.room);
    });
    
    it('should handle invalid device ID', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/devices/id/invalid-device-id`);
      assert.strictEqual(response.status, 404);
      
      const error = await response.json();
      assert.strictEqual(error.status, 'error');
      assert(error.error.includes('not found'));
    });
    
    it('should get devices by room', async () => {
      // First get list of devices
      const listResponse = await fetch(`${defaultConfig.apiUrl}/devices`);
      const devices = await listResponse.json();
      const firstDevice = devices[0];
      
      // Get devices by room
      const response = await fetch(`${defaultConfig.apiUrl}/devices/room/${encodeURIComponent(firstDevice.room)}`);
      assert.strictEqual(response.status, 200);
      
      const roomDevices = await response.json();
      assert(Array.isArray(roomDevices), 'Should return array of devices');
      assert(roomDevices.length > 0, 'Should have at least one device');
      assert(roomDevices.some(d => d.room === firstDevice.room), 'Should include the requested room');
    });
    
    it('should handle invalid room name', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/devices/room/InvalidRoomName`);
      assert.strictEqual(response.status, 404);
      
      const error = await response.json();
      assert.strictEqual(error.status, 'error');
      assert(error.error.includes('not found'));
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
        assert(state.hasOwnProperty('playbackState'), 'Each state should be valid');
      });
    });
    
    after(() => {
      testLog.info('   ✓ Core infrastructure tests complete');
    });
  });
});