import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { MockDevice, MockDiscovery, createMockDiscovery } from '../helpers/mock-factory.js';
import { ApiRouter } from '../../src/api-router.js';
import type { Config } from '../../src/types/sonos.js';
import { testEndpoint } from '../helpers/test-helpers.js';
import { createMockConfig, MockDefaultRoomManager, MockTTSService, MockPresetLoader } from '../helpers/mock-factory.js';

describe('Volume Control Unit Tests', () => {
  let mockDiscovery: MockDiscovery;
  let mockDevice: MockDevice;
  let router: ApiRouter;
  let config: Config;

  beforeEach(() => {
    mockDiscovery = createMockDiscovery('Bedroom', 'Kitchen', 'Living Room');
    mockDevice = mockDiscovery.getDeviceByName('Bedroom')!;
    config = createMockConfig();
    const mockDefaultRoomManager = new MockDefaultRoomManager(config);
    const mockTTSService = new MockTTSService();
    const mockPresetLoader = new MockPresetLoader();
    
    router = new ApiRouter(
      mockDiscovery as any, 
      config,
      mockPresetLoader as any,
      mockDefaultRoomManager as any,
      mockTTSService as any
    );
  });

  describe('Absolute Volume', () => {
    it('should set volume to specific level', async () => {
      const response = await testEndpoint(router, '/bedroom/volume/75');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setVolume'));
      assert.strictEqual(mockDevice.state.volume, 75);
    });

    it('should handle volume at minimum (0)', async () => {
      const response = await testEndpoint(router, '/bedroom/volume/0');
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(mockDevice.state.volume, 0);
    });

    it('should handle volume at maximum (100)', async () => {
      const response = await testEndpoint(router, '/bedroom/volume/100');
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(mockDevice.state.volume, 100);
    });

    it('should reject volume above 100', async () => {
      const response = await testEndpoint(router, '/bedroom/volume/150');
      
      assert.strictEqual(response.status, 400);
    });

    it('should treat negative values as relative volume decrease', async () => {
      mockDevice.state.volume = 50;
      const response = await testEndpoint(router, '/bedroom/volume/-10');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setVolume'));
      const calls = mockDevice.getCallsFor('setVolume');
      assert.strictEqual(calls[0].args[0], 40);
      assert.strictEqual(mockDevice.state.volume, 40);
    });

    it('should reject non-numeric volume', async () => {
      const response = await testEndpoint(router, '/bedroom/volume/loud');
      
      assert.strictEqual(response.status, 400);
    });
  });

  describe('Relative Volume', () => {
    it('should increase volume', async () => {
      mockDevice.state.volume = 50;
      const response = await testEndpoint(router, '/bedroom/volume/+10');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setVolume'));
      const calls = mockDevice.getCallsFor('setVolume');
      assert.strictEqual(calls[0].args[0], 60);
      assert.strictEqual(mockDevice.state.volume, 60);
    });

    it('should decrease volume', async () => {
      mockDevice.state.volume = 50;
      const response = await testEndpoint(router, '/bedroom/volume/-10');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setVolume'));
      const calls = mockDevice.getCallsFor('setVolume');
      assert.strictEqual(calls[0].args[0], 40);
      assert.strictEqual(mockDevice.state.volume, 40);
    });

    it('should not exceed 100 when increasing', async () => {
      mockDevice.state.volume = 95;
      const response = await testEndpoint(router, '/bedroom/volume/+20');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setVolume'));
      const calls = mockDevice.getCallsFor('setVolume');
      assert.strictEqual(calls[0].args[0], 115); // API sends 115, device should clamp
      assert.strictEqual(mockDevice.state.volume, 100);
    });

    it('should not go below 0 when decreasing', async () => {
      mockDevice.state.volume = 5;
      const response = await testEndpoint(router, '/bedroom/volume/-20');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setVolume'));
      const calls = mockDevice.getCallsFor('setVolume');
      assert.strictEqual(calls[0].args[0], -15); // API sends -15, device should clamp
      assert.strictEqual(mockDevice.state.volume, 0);
    });
  });

  describe('Group Volume', () => {
    beforeEach(() => {
      // Create a group with Bedroom as coordinator
      const bedroomDevice = mockDiscovery.getDeviceByName('Bedroom')!;
      const kitchenDevice = mockDiscovery.getDeviceByName('Kitchen')!;
      
      // Mock the group structure
      mockDiscovery.getZones = () => [{
        id: bedroomDevice.id,
        coordinator: {
          id: bedroomDevice.id,
          roomName: 'Bedroom',
          uuid: bedroomDevice.id
        },
        members: [
          {
            id: bedroomDevice.id,
            roomName: 'Bedroom',
            uuid: bedroomDevice.id
          },
          {
            id: kitchenDevice.id,
            roomName: 'Kitchen',
            uuid: kitchenDevice.id
          }
        ]
      }];
    });

    it('should set group volume', async () => {
      const response = await testEndpoint(router, '/bedroom/groupVolume/60');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setGroupVolume'));
      const calls = mockDevice.getCallsFor('setGroupVolume');
      assert.strictEqual(calls[0].args[0], 60);
    });

    it('should validate group volume range', async () => {
      const response = await testEndpoint(router, '/bedroom/groupVolume/150');
      
      assert.strictEqual(response.status, 400);
    });
  });

  describe('Mute Controls', () => {
    it('should mute device', async () => {
      mockDevice.state.mute = false;
      const response = await testEndpoint(router, '/bedroom/mute');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setMute'));
      const calls = mockDevice.getCallsFor('setMute');
      assert.strictEqual(calls[0].args[0], true);
      assert.strictEqual(mockDevice.state.mute, true);
    });

    it('should unmute device', async () => {
      mockDevice.state.mute = true;
      const response = await testEndpoint(router, '/bedroom/unmute');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setMute'));
      const calls = mockDevice.getCallsFor('setMute');
      assert.strictEqual(calls[0].args[0], false);
      assert.strictEqual(mockDevice.state.mute, false);
    });
  });

  describe.skip('Room-less Volume Commands', () => {
    beforeEach(() => {
      const mockDefaultRoomManager = router['defaultRoomManager'] as MockDefaultRoomManager;
      mockDefaultRoomManager.setDefaultRoom('Bedroom');
    });

    it('should use default room for volume', async () => {
      const response = await testEndpoint(router, '/volume/80');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setVolume'));
      assert.strictEqual(mockDevice.state.volume, 80);
    });

    it('should use default room for relative volume', async () => {
      mockDevice.state.volume = 50;
      const response = await testEndpoint(router, '/volume/+15');
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(mockDevice.state.volume, 65);
    });
  });
});