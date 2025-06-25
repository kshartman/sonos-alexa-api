import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom, SystemTopology } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Default Service Content Integration Tests', { skip: skipIntegration, timeout: 60000 }, () => {
  let topology: SystemTopology;
  let testRoom: string;
  let deviceId: string;
  let eventManager: EventManager;
  let originalDefaults: any;
  let libraryAvailable: boolean = false;

  before(async () => {
    console.log('\n🎵 Starting Default Service Content Integration Tests...\n');
    eventManager = EventManager.getInstance();
    
    // Start event bridge to receive UPnP events
    await startEventBridge();
    
    topology = await discoverSystem();
    testRoom = await getSafeTestRoom(topology);
    
    // Get device ID for event tracking - use coordinator ID for groups/stereo pairs
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await zonesResponse.json();
    const zone = zones.find(z => z.members.some(m => m.roomName === testRoom));
    // Use the coordinator's ID for event tracking
    const coordinatorMember = zone.members.find(m => m.isCoordinator);
    deviceId = coordinatorMember.id;
    
    console.log(`📊 Test room: ${testRoom}`);
    console.log(`📊 Device ID: ${deviceId}`);
    
    // Store original defaults to restore later
    const defaultsResponse = await fetch(`${defaultConfig.apiUrl}/default`);
    originalDefaults = await defaultsResponse.json();
    console.log(`📊 Original defaults: room=${originalDefaults.room}, service=${originalDefaults.musicService}`);
    
    // Set test room as default
    await fetch(`${defaultConfig.apiUrl}/default/room/${testRoom}`);
    
    // Check if music library is available
    const libraryStatusResponse = await fetch(`${defaultConfig.apiUrl}/library/index`);
    if (libraryStatusResponse.ok) {
      const status = await libraryStatusResponse.json();
      if (status.status === 'not initialized') {
        console.log('📚 Music library not initialized, triggering refresh...');
        const refreshResponse = await fetch(`${defaultConfig.apiUrl}/library/refresh`);
        if (refreshResponse.ok) {
          // Wait for indexing to complete (up to 20 seconds)
          let indexed = false;
          for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const checkResponse = await fetch(`${defaultConfig.apiUrl}/library/index`);
            if (checkResponse.ok) {
              const checkStatus = await checkResponse.json();
              if (!checkStatus.isIndexing && checkStatus.metadata) {
                indexed = true;
                console.log(`✅ Music library indexed: ${checkStatus.metadata.totalTracks} tracks`);
                break;
              }
            }
          }
          libraryAvailable = indexed;
        }
      } else if (status.metadata) {
        libraryAvailable = true;
        console.log(`✅ Music library already indexed: ${status.metadata.totalTracks} tracks`);
      }
    }
  });

  after(async () => {
    console.log('\n🧹 Cleaning up Default Service tests...\n');
    
    // Restore original defaults
    if (originalDefaults.room) {
      await fetch(`${defaultConfig.apiUrl}/default/room/${originalDefaults.room}`);
    }
    if (originalDefaults.musicService) {
      await fetch(`${defaultConfig.apiUrl}/default/service/${originalDefaults.musicService}`);
    }
    
    // Stop playback
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    await eventManager.waitForState(deviceId, 'STOPPED', 5000);
    
    // Stop event bridge
    stopEventBridge();
  });

  describe('Default Settings Management', () => {
    it('should get current default settings', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/default`);
      assert.strictEqual(response.status, 200);
      
      const defaults = await response.json();
      assert(defaults.room, 'Should have default room');
      assert(defaults.musicService, 'Should have default music service');
      assert(defaults.lastUpdated, 'Should have last updated timestamp');
      
      console.log(`✅ Current defaults: room=${defaults.room}, service=${defaults.musicService}`);
    });

    it('should set default music service to library', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/default/service/library`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert.strictEqual(result.status, 'success');
      assert.strictEqual(result.defaultMusicService, 'library');
      
      // Verify it was saved
      const checkResponse = await fetch(`${defaultConfig.apiUrl}/default`);
      const defaults = await checkResponse.json();
      assert.strictEqual(defaults.musicService, 'library');
      
      console.log('✅ Default service set to library');
    });

    it('should set default music service to apple', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/default/service/apple`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert.strictEqual(result.status, 'success');
      assert.strictEqual(result.defaultMusicService, 'apple');
      
      // Verify it was saved
      const checkResponse = await fetch(`${defaultConfig.apiUrl}/default`);
      const defaults = await checkResponse.json();
      assert.strictEqual(defaults.musicService, 'apple');
      
      console.log('✅ Default service set to apple');
    });

    it('should handle invalid service names', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/default/service/invalidservice`);
      assert.strictEqual(response.status, 200); // API accepts any service name
      
      // But when we try to use it, it should fail gracefully
      const searchResponse = await fetch(`${defaultConfig.apiUrl}/song/test`);
      assert(searchResponse.status === 501 || searchResponse.status === 400);
      
      console.log('✅ Invalid service handled correctly');
    });
  });

  describe('Default Song Search', () => {
    it('should search songs using library service', async function() {
      if (!libraryAvailable) {
        console.log('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }
      
      // Set default to library
      await fetch(`${defaultConfig.apiUrl}/default/service/library`);
      
      const response = await fetch(`${defaultConfig.apiUrl}/song/love`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert.strictEqual(result.status, 'success');
      assert.strictEqual(result.service, 'library');
      assert(result.title, 'Should have song title');
      assert(result.artist, 'Should have artist');
      
      console.log(`✅ Found library song: "${result.title}" by ${result.artist}`);
      
      // Wait for track change
      const trackChanged = await eventManager.waitForTrackChange(deviceId, 10000);
      if (trackChanged) {
        console.log('✅ Default song search triggered playback');
      }
    });

    it('should search songs using apple service', async () => {
      // Set default to apple
      await fetch(`${defaultConfig.apiUrl}/default/service/apple`);
      
      const response = await fetch(`${defaultConfig.apiUrl}/song/hello%20adele`);
      
      if (response.status === 200) {
        const result = await response.json();
        assert.strictEqual(result.status, 'success');
        assert.strictEqual(result.service, 'apple');
        assert(result.title, 'Should have song title');
        console.log(`✅ Found Apple Music song: "${result.title}"`);
      } else {
        // Apple Music search might fail due to account issues
        console.log('⚠️  Apple Music search failed (likely account configuration)');
      }
    });

    it('should handle no results gracefully', async function() {
      if (!libraryAvailable) {
        console.log('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }
      
      // Set default to library for predictable testing
      await fetch(`${defaultConfig.apiUrl}/default/service/library`);
      
      const response = await fetch(`${defaultConfig.apiUrl}/song/xyzzy12345nonexistent`);
      assert.strictEqual(response.status, 404);
      
      const error = await response.json();
      assert(error.error, 'Should have error message');
      assert(error.error.includes('No songs found'), 'Should indicate no results found');
      
      console.log('✅ No results handled correctly');
    });
  });

  describe('Default Album Search', () => {
    it('should search albums using library service', async function() {
      if (!libraryAvailable) {
        console.log('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }
      
      // Set default to library
      await fetch(`${defaultConfig.apiUrl}/default/service/library`);
      
      const response = await fetch(`${defaultConfig.apiUrl}/album/greatest`);
      
      if (response.status === 200) {
        const result = await response.json();
        assert.strictEqual(result.status, 'success');
        assert.strictEqual(result.service, 'library');
        assert(result.album, 'Should have album name');
        console.log(`✅ Found library album: "${result.album}"`);
      } else if (response.status === 404) {
        console.log('⚠️  No albums found with "greatest" in library (this is normal)');
      }
    });

    it('should search albums using apple service', async () => {
      // Set default to apple
      await fetch(`${defaultConfig.apiUrl}/default/service/apple`);
      
      const response = await fetch(`${defaultConfig.apiUrl}/album/abbey%20road`);
      
      if (response.status === 200) {
        const result = await response.json();
        assert.strictEqual(result.status, 'success');
        assert.strictEqual(result.service, 'apple');
        assert(result.album, 'Should have album name');
        console.log(`✅ Found Apple Music album: "${result.album}"`);
      } else {
        console.log('⚠️  Apple Music album search failed (likely account configuration)');
      }
    });
  });

  describe('Default Station Search', () => {
    it('should handle station search with library service (should fail)', async () => {
      // Set default to library
      await fetch(`${defaultConfig.apiUrl}/default/service/library`);
      
      const response = await fetch(`${defaultConfig.apiUrl}/station/test`);
      assert.strictEqual(response.status, 400);
      
      const error = await response.json();
      assert(error.error, 'Should have error message');
      assert(error.error.includes('Library does not support station search'), 'Should indicate library limitation');
      
      console.log('✅ Library station search limitation handled correctly');
    });

    it('should handle station search with pandora service', async () => {
      // Set default to pandora
      await fetch(`${defaultConfig.apiUrl}/default/service/pandora`);
      
      const response = await fetch(`${defaultConfig.apiUrl}/station/quickmix`);
      
      // Pandora might not be configured, so we expect either success or 503/404
      if (response.status === 200) {
        const result = await response.json();
        assert.strictEqual(result.status, 'success');
        assert.strictEqual(result.service, 'pandora');
        console.log('✅ Pandora station search succeeded');
      } else if (response.status === 404 || response.status === 503) {
        console.log('⚠️  Pandora not configured or station not found (expected)');
      } else {
        console.log(`⚠️  Unexpected response: ${response.status}`);
      }
    });
  });

  describe('Service Switching', () => {
    it('should switch between library and apple services', async function() {
      if (!libraryAvailable) {
        console.log('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }
      
      // Test library first
      await fetch(`${defaultConfig.apiUrl}/default/service/library`);
      let response = await fetch(`${defaultConfig.apiUrl}/song/music`);
      
      if (response.status === 200) {
        let result = await response.json();
        assert.strictEqual(result.service, 'library');
        console.log(`✅ Library search: "${result.title}"`);
      }
      
      // Switch to Apple Music
      await fetch(`${defaultConfig.apiUrl}/default/service/apple`);
      response = await fetch(`${defaultConfig.apiUrl}/album/greatest%20hits`);
      
      if (response.status === 200) {
        let result = await response.json();
        assert.strictEqual(result.service, 'apple');
        console.log(`✅ Apple Music search: "${result.album || result.title}"`);
      } else {
        console.log('⚠️  Apple Music search failed (account configuration)');
      }
      
      console.log('✅ Service switching test completed');
    });

    it('should persist service changes across requests', async () => {
      // Set to library
      await fetch(`${defaultConfig.apiUrl}/default/service/library`);
      
      // Check it persisted
      let checkResponse = await fetch(`${defaultConfig.apiUrl}/default`);
      let defaults = await checkResponse.json();
      assert.strictEqual(defaults.musicService, 'library');
      
      // Set to apple
      await fetch(`${defaultConfig.apiUrl}/default/service/apple`);
      
      // Check it persisted
      checkResponse = await fetch(`${defaultConfig.apiUrl}/default`);
      defaults = await checkResponse.json();
      assert.strictEqual(defaults.musicService, 'apple');
      
      console.log('✅ Service changes persist correctly');
    });
  });

  describe('Error Handling', () => {
    it('should handle unsupported service gracefully', async () => {
      // Set to unsupported service
      await fetch(`${defaultConfig.apiUrl}/default/service/spotify`);
      
      const response = await fetch(`${defaultConfig.apiUrl}/song/test`);
      assert.strictEqual(response.status, 501);
      
      const error = await response.json();
      assert(error.error, 'Should have error message');
      assert(error.error.includes('not yet implemented'), 'Should indicate service not supported');
      
      console.log('✅ Unsupported service handled correctly');
    });

    it('should handle library not indexed', async () => {
      // This test is mainly for documentation - if library is not indexed,
      // the song search should return a 503 error
      await fetch(`${defaultConfig.apiUrl}/default/service/library`);
      
      // The library should be indexed by now, but if it wasn't, we'd get 503
      const response = await fetch(`${defaultConfig.apiUrl}/song/test`);
      
      if (response.status === 503) {
        const error = await response.json();
        assert(error.error.includes('not yet indexed'), 'Should indicate indexing needed');
        console.log('✅ Library not indexed error handled correctly');
      } else if (response.status === 404) {
        console.log('✅ Library indexed but no results found (normal)');
      } else if (response.status === 200) {
        console.log('✅ Library search succeeded');
      }
    });
  });
});