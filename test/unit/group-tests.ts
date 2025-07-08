import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { MockDevice, MockDiscovery, createMockDiscovery, createMockConfig, MockDefaultRoomManager, MockTTSService, MockPresetLoader } from '../helpers/mock-factory.js';
import { ApiRouter } from '../../src/api-router.js';
import type { Config } from '../../src/types/sonos.js';
import { testEndpoint } from '../helpers/test-helpers.js';
import { initializeDebugManager } from '../../src/utils/debug-manager.js';

describe('Group Management Unit Tests', () => {
  let mockDiscovery: MockDiscovery;
  let router: ApiRouter;
  let config: Config;
  let bedroomDevice: MockDevice;
  let kitchenDevice: MockDevice;
  let livingRoomDevice: MockDevice;

  beforeEach(() => {
    mockDiscovery = createMockDiscovery('Bedroom', 'Kitchen', 'Living Room');
    bedroomDevice = mockDiscovery.getDeviceByName('Bedroom')!;
    kitchenDevice = mockDiscovery.getDeviceByName('Kitchen')!;
    livingRoomDevice = mockDiscovery.getDeviceByName('Living Room')!;
    
    config = createMockConfig();
    
    // Initialize debug manager for unit tests
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

  describe('Join Group', () => {
    it('should join bedroom to kitchen group', async () => {
      const response = await testEndpoint(router, '/bedroom/join/kitchen');
      
      assert.strictEqual(response.status, 200);
      assert(bedroomDevice.wasMethodCalled('addPlayerToGroup'));
      const calls = bedroomDevice.getCallsFor('addPlayerToGroup');
      assert(calls[0].args[0].includes(kitchenDevice.id));
    });

    it('should handle case-insensitive room names', async () => {
      const response = await testEndpoint(router, '/bedroom/join/KITCHEN');
      
      assert.strictEqual(response.status, 200);
      assert(bedroomDevice.wasMethodCalled('addPlayerToGroup'));
    });

    it('should handle URL-encoded room names', async () => {
      const response = await testEndpoint(router, '/bedroom/join/Living%20Room');
      
      assert.strictEqual(response.status, 200);
      assert(bedroomDevice.wasMethodCalled('addPlayerToGroup'));
    });

    it('should return 404 if target room not found', async () => {
      const response = await testEndpoint(router, '/bedroom/join/NonExistentRoom');
      
      assert.strictEqual(response.status, 404);
      assert(response.body.includes('not found'));
    });

    it('should return 404 if source room not found', async () => {
      const response = await testEndpoint(router, '/NonExistentRoom/join/kitchen');
      
      assert.strictEqual(response.status, 404);
    });
  });

  describe('Leave Group', () => {
    beforeEach(() => {
      // Set up a group with bedroom and kitchen, with bedroom as coordinator
      mockDiscovery.setZones([{
        id: 'group-1',
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
      }]);
      
      // Also update the coordinator lookup
      mockDiscovery.getCoordinator = (deviceId: string) => {
        // Both bedroom and kitchen should return bedroom as coordinator
        return bedroomDevice;
      };
    });

    it('should leave group using leave endpoint', async () => {
      // Debug: Check zones before test
      // testLog.info('Zones before test:', JSON.stringify(mockDiscovery.getZones(), null, 2));
      
      const response = await testEndpoint(router, '/bedroom/leave');
      
      assert.strictEqual(response.status, 200, `Expected 200 but got ${response.status}: ${response.body}`);
      assert(bedroomDevice.wasMethodCalled('becomeCoordinatorOfStandaloneGroup'));
    });

    it('should leave group using ungroup endpoint', async () => {
      const response = await testEndpoint(router, '/bedroom/ungroup');
      
      assert.strictEqual(response.status, 200);
      assert(bedroomDevice.wasMethodCalled('becomeCoordinatorOfStandaloneGroup'));
    });

    it('should leave group using isolate endpoint', async () => {
      const response = await testEndpoint(router, '/bedroom/isolate');
      
      assert.strictEqual(response.status, 200);
      assert(bedroomDevice.wasMethodCalled('becomeCoordinatorOfStandaloneGroup'));
    });
  });

  describe('Add to Group', () => {
    it('should add kitchen to bedroom group', async () => {
      const response = await testEndpoint(router, '/bedroom/add/kitchen');
      
      assert.strictEqual(response.status, 200);
      assert(kitchenDevice.wasMethodCalled('addPlayerToGroup'));
      const calls = kitchenDevice.getCallsFor('addPlayerToGroup');
      assert(calls[0].args[0].includes(bedroomDevice.id));
    });

    it('should handle multiple rooms added to same group', async () => {
      // Add kitchen to bedroom
      let response = await testEndpoint(router, '/bedroom/add/kitchen');
      assert.strictEqual(response.status, 200);
      assert(kitchenDevice.wasMethodCalled('addPlayerToGroup'));

      // Add living room to bedroom
      response = await testEndpoint(router, '/bedroom/add/living%20room');
      assert.strictEqual(response.status, 200);
      assert(livingRoomDevice.wasMethodCalled('addPlayerToGroup'));
    });

    it('should return 404 if room to add not found', async () => {
      const response = await testEndpoint(router, '/bedroom/add/NonExistentRoom');
      
      assert.strictEqual(response.status, 404);
    });
  });

  describe('Group Volume Control', () => {
    beforeEach(() => {
      // Mock a group structure
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
      
      // Make bedroom the coordinator
      mockDiscovery.getCoordinator = (deviceId: string) => {
        if (deviceId === kitchenDevice.id) {
          return bedroomDevice;
        }
        return mockDiscovery.getDeviceByName(deviceId) || bedroomDevice;
      };
    });

    it('should set group volume on coordinator', async () => {
      const response = await testEndpoint(router, '/bedroom/groupVolume/70');
      
      assert.strictEqual(response.status, 200);
      assert(bedroomDevice.wasMethodCalled('setGroupVolume'));
      const calls = bedroomDevice.getCallsFor('setGroupVolume');
      assert.strictEqual(calls[0].args[0], 70);
    });

    it('should route group volume to coordinator when called on member', async () => {
      const response = await testEndpoint(router, '/kitchen/groupVolume/80');
      
      assert.strictEqual(response.status, 200);
      // Should be called on bedroom (coordinator), not kitchen
      assert(bedroomDevice.wasMethodCalled('setGroupVolume'));
      assert(!kitchenDevice.wasMethodCalled('setGroupVolume'));
    });

    it('should validate group volume range', async () => {
      const response = await testEndpoint(router, '/bedroom/groupVolume/150');
      
      assert.strictEqual(response.status, 400);
      assert(response.body.includes('between 0 and 100'));
    });
  });

  describe('Group Playback Control', () => {
    beforeEach(() => {
      // Set up group with bedroom as coordinator
      mockDiscovery.getCoordinator = (deviceId: string) => {
        if (deviceId === kitchenDevice.id || deviceId === livingRoomDevice.id) {
          return bedroomDevice;
        }
        return mockDiscovery.getDevice(deviceId);
      };
      
      mockDiscovery.isCoordinator = (deviceId: string) => {
        return deviceId === bedroomDevice.id;
      };
    });

    it('should call play on the coordinator when member is targeted', async () => {
      const response = await testEndpoint(router, '/kitchen/play');
      
      assert.strictEqual(response.status, 200);
      // When kitchen is part of a group with bedroom as coordinator,
      // play should be called on the coordinator (bedroom)
      assert(bedroomDevice.wasMethodCalled('play'));
      assert(!kitchenDevice.wasMethodCalled('play'));
    });

    it('should call pause on the coordinator when member is targeted', async () => {
      const response = await testEndpoint(router, '/kitchen/pause');
      
      assert.strictEqual(response.status, 200);
      // When kitchen is part of a group with bedroom as coordinator,
      // pause should be called on the coordinator (bedroom)
      assert(bedroomDevice.wasMethodCalled('pause'));
      assert(!kitchenDevice.wasMethodCalled('pause'));
    });
  });

  describe('Error Handling', () => {
    it('should handle join errors gracefully', async () => {
      // Mock an error in addPlayerToGroup
      bedroomDevice.addPlayerToGroup = async () => {
        throw new Error('Network error');
      };
      
      const response = await testEndpoint(router, '/bedroom/join/kitchen');
      
      assert.strictEqual(response.status, 500);
      assert(response.body.includes('error'));
    });

    it('should handle leave errors gracefully', async () => {
      // Set up a group so the leave operation can proceed to the error
      mockDiscovery.setZones([{
        id: 'group-1',
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
      }]);
      
      // Mock an error in becomeCoordinatorOfStandaloneGroup
      bedroomDevice.becomeCoordinatorOfStandaloneGroup = async () => {
        throw new Error('Cannot leave group');
      };
      
      const response = await testEndpoint(router, '/bedroom/leave');
      
      assert.strictEqual(response.status, 500);
      assert(response.body.includes('error'));
    });
  });
});