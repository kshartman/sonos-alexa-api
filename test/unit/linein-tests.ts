import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { MockDevice, MockDiscovery, createMockDiscovery, createMockConfig, MockDefaultRoomManager, MockTTSService, MockPresetLoader } from '../helpers/mock-factory.js';
import { ApiRouter } from '../../src/api-router.js';
import type { Config } from '../../src/types/sonos.js';
import { testEndpoint } from '../helpers/test-helpers.js';
import { initializeDebugManager } from '../../src/utils/debug-manager.js';

describe('Line-In Unit Tests', () => {
  let mockDiscovery: MockDiscovery;
  let bedroomDevice: MockDevice;
  let kitchenDevice: MockDevice;
  let router: ApiRouter;
  let config: Config;

  beforeEach(() => {
    mockDiscovery = createMockDiscovery('Bedroom', 'Kitchen', 'Living Room');
    bedroomDevice = mockDiscovery.getDeviceByName('Bedroom')!;
    kitchenDevice = mockDiscovery.getDeviceByName('Kitchen')!;
    config = createMockConfig();
    
    // Initialize debug manager before creating router
    initializeDebugManager(config);
    
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

  describe('Line-In Playback', () => {
    it('should play line-in from the same room', async () => {
      const response = await testEndpoint(router, '/bedroom/linein');
      
      assert.strictEqual(response.status, 200);
      assert(bedroomDevice.wasMethodCalled('playLineIn'));
      assert(bedroomDevice.wasMethodCalled('setAVTransportURI'));
      assert(bedroomDevice.wasMethodCalled('play'));
      assert.strictEqual(bedroomDevice.state.playbackState, 'PLAYING');
    });

    it('should play line-in from a different room', async () => {
      const response = await testEndpoint(router, '/bedroom/linein/kitchen');
      
      assert.strictEqual(response.status, 200);
      assert(bedroomDevice.wasMethodCalled('playLineIn'));
      assert(bedroomDevice.wasMethodCalled('setAVTransportURI'));
      assert(bedroomDevice.wasMethodCalled('play'));
      assert.strictEqual(bedroomDevice.state.playbackState, 'PLAYING');
      
      // Check the playLineIn was called with Kitchen as the source
      const calls = bedroomDevice.getCallsFor('playLineIn');
      assert.strictEqual(calls[0].args[0], 'Kitchen');
    });

    it('should handle URL-encoded room names', async () => {
      const response = await testEndpoint(router, '/bedroom/linein/Living%20Room');
      
      assert.strictEqual(response.status, 200);
      assert(bedroomDevice.wasMethodCalled('playLineIn'));
    });

    it('should return 404 for non-existent source room', async () => {
      const response = await testEndpoint(router, '/bedroom/linein/NonExistentRoom');
      
      assert.strictEqual(response.status, 404);
      assert(response.body.includes('Could not find player'));
    });

    it('should route to coordinator for grouped devices', async () => {
      // Set up a group with bedroom as coordinator
      mockDiscovery.getCoordinator = (deviceId: string) => {
        if (deviceId === kitchenDevice.id) {
          return bedroomDevice;
        }
        return mockDiscovery.getDevice(deviceId);
      };
      
      const response = await testEndpoint(router, '/kitchen/linein');
      
      assert.strictEqual(response.status, 200);
      // Should be called on bedroom (coordinator), not kitchen
      assert(bedroomDevice.wasMethodCalled('playLineIn'));
      assert(!kitchenDevice.wasMethodCalled('playLineIn'));
    });
  });
});