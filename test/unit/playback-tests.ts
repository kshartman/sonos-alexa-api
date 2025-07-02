import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { 
  MockDevice, 
  MockDiscovery, 
  createMockDevice, 
  createMockDiscovery,
  createMockConfig,
  MockDefaultRoomManager,
  MockTTSService,
  MockPresetLoader
} from '../helpers/mock-factory.js';
import { ApiRouter } from '../../src/api-router.js';
import type { Config } from '../../src/types/sonos.js';
import { testEndpoint } from '../helpers/test-helpers.js';
import { initializeDebugManager } from '../../src/utils/debug-manager.js';

describe('Playback Control Unit Tests', () => {
  let mockDiscovery: MockDiscovery;
  let mockDevice: MockDevice;
  let router: ApiRouter;
  let config: Config;

  beforeEach(() => {
    mockDiscovery = createMockDiscovery('Bedroom', 'Kitchen', 'Living Room');
    mockDevice = mockDiscovery.getDeviceByName('Bedroom')!;
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

  describe('Play/Pause Controls', () => {
    it('should handle play command', async () => {
      const response = await testEndpoint(router, '/bedroom/play');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('play'));
      assert.strictEqual(mockDevice.state.playbackState, 'PLAYING');
    });

    it('should handle pause command', async () => {
      mockDevice.state.playbackState = 'PLAYING';
      const response = await testEndpoint(router, '/bedroom/pause');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('pause'));
      assert.strictEqual(mockDevice.state.playbackState, 'PAUSED_PLAYBACK');
    });

    it('should handle playpause toggle when playing', async () => {
      mockDevice.state.playbackState = 'PLAYING';
      const response = await testEndpoint(router, '/bedroom/playpause');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('pause'));
      assert.strictEqual(mockDevice.state.playbackState, 'PAUSED_PLAYBACK');
    });

    it('should handle playpause toggle when paused', async () => {
      mockDevice.state.playbackState = 'PAUSED_PLAYBACK';
      const response = await testEndpoint(router, '/bedroom/playpause');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('play'));
      assert.strictEqual(mockDevice.state.playbackState, 'PLAYING');
    });

    it('should handle stop command', async () => {
      mockDevice.state.playbackState = 'PLAYING';
      const response = await testEndpoint(router, '/bedroom/stop');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('stop'));
      assert.strictEqual(mockDevice.state.playbackState, 'STOPPED');
    });
  });

  describe('Track Navigation', () => {
    it('should handle next track', async () => {
      const response = await testEndpoint(router, '/bedroom/next');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('next'));
    });

    it('should handle previous track', async () => {
      const response = await testEndpoint(router, '/bedroom/previous');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('previous'));
    });
  });

  describe('Queue Management', () => {
    it('should handle clear queue', async () => {
      const response = await testEndpoint(router, '/bedroom/clearqueue');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('clearQueue'));
    });
  });

  describe('Playback Modes', () => {
    it('should enable repeat', async () => {
      const response = await testEndpoint(router, '/bedroom/repeat/on');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setRepeat'));
      const calls = mockDevice.getCallsFor('setRepeat');
      assert.strictEqual(calls[0].args[0], 'all');
      assert.strictEqual(mockDevice.state.playMode.repeat, 'all');
    });

    it('should disable repeat', async () => {
      mockDevice.state.playMode.repeat = 'all';
      const response = await testEndpoint(router, '/bedroom/repeat/off');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setRepeat'));
      const calls = mockDevice.getCallsFor('setRepeat');
      assert.strictEqual(calls[0].args[0], 'none');
      assert.strictEqual(mockDevice.state.playMode.repeat, 'none');
    });

    it('should enable shuffle', async () => {
      const response = await testEndpoint(router, '/bedroom/shuffle/on');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setShuffle'));
      assert.strictEqual(mockDevice.state.playMode.shuffle, true);
    });

    it('should disable shuffle', async () => {
      mockDevice.state.playMode.shuffle = true;
      const response = await testEndpoint(router, '/bedroom/shuffle/off');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setShuffle'));
      assert.strictEqual(mockDevice.state.playMode.shuffle, false);
    });

    it('should enable crossfade', async () => {
      const response = await testEndpoint(router, '/bedroom/crossfade/on');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setCrossfade'));
      assert.strictEqual(mockDevice.state.playMode.crossfade, true);
    });

    it('should disable crossfade', async () => {
      mockDevice.state.playMode.crossfade = true;
      const response = await testEndpoint(router, '/bedroom/crossfade/off');
      
      assert.strictEqual(response.status, 200);
      assert(mockDevice.wasMethodCalled('setCrossfade'));
      assert.strictEqual(mockDevice.state.playMode.crossfade, false);
    });
  });

  describe('Global Commands', () => {
    it('should pause all devices', async () => {
      // Set all devices to playing
      mockDiscovery.getAllDevices().forEach(device => {
        device.state.playbackState = 'PLAYING';
      });

      const response = await testEndpoint(router, '/pauseall');
      
      assert.strictEqual(response.status, 200);
      mockDiscovery.getAllDevices().forEach(device => {
        assert(device.wasMethodCalled('pause'));
        assert.strictEqual(device.state.playbackState, 'PAUSED_PLAYBACK');
      });
    });

    it('should resume all devices', async () => {
      // Set all devices to paused
      mockDiscovery.getAllDevices().forEach(device => {
        device.state.playbackState = 'PAUSED_PLAYBACK';
      });

      const response = await testEndpoint(router, '/resumeAll');
      
      assert.strictEqual(response.status, 200);
      mockDiscovery.getAllDevices().forEach(device => {
        assert(device.wasMethodCalled('play'));
        assert.strictEqual(device.state.playbackState, 'PLAYING');
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for invalid room', async () => {
      const response = await testEndpoint(router, '/invalidroom/play');
      assert.strictEqual(response.status, 404);
    });

    it('should handle invalid toggle values', async () => {
      const response = await testEndpoint(router, '/bedroom/repeat/invalid');
      assert.strictEqual(response.status, 400);
    });
  });
});