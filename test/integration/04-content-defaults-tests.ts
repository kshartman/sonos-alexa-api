import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../helpers/test-config.js';
import { globalTestSetup, globalTestTeardown, TestContext } from '../helpers/global-test-setup.js';
import { getSearchTerm, getSafeSearchQuery } from '../helpers/test-search-terms.js';
import { testLog } from '../helpers/test-logger.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Default Service Content Integration Tests', { skip: skipIntegration, timeout: 210000 }, () => {
  let testContext: TestContext;
  let testRoom: string;
  let deviceId: string;
  let originalDefaults: any;
  let libraryAvailable: boolean = false;

  before(async () => {
    testContext = await globalTestSetup('Default Service Content Integration Tests');
    
    // Get test room from env or use first available room
    if (process.env.TEST_ROOM) {
      testRoom = process.env.TEST_ROOM;
      testLog.info(`✅ Using configured test room: ${testRoom} (from TEST_ROOM env)`);
    } else {
      testRoom = testContext.topology.rooms[0];
      testLog.info(`📊 Using first available room: ${testRoom}`);
    }
    
    // Get device ID from mapping
    deviceId = testContext.deviceIdMapping.get(testRoom) || '';
    testLog.info(`📊 Test room: ${testRoom}`);
    testLog.info(`📊 Device ID: ${deviceId}`);
    
    // Store original defaults to restore later
    const defaultsResponse = await fetch(`${defaultConfig.apiUrl}/default`);
    originalDefaults = await defaultsResponse.json();
    testLog.info(`📊 Original defaults: room=${originalDefaults.room}, service=${originalDefaults.musicService}`);
    
    // Set test room as default
    await fetch(`${defaultConfig.apiUrl}/default/room/${testRoom}`);
    
    // Check if music library is available
    const libraryStatusResponse = await fetch(`${defaultConfig.apiUrl}/library/index`);
    if (libraryStatusResponse.ok) {
      const status = await libraryStatusResponse.json();
      if (status.status === 'not initialized') {
        testLog.info('📚 Music library not initialized, triggering refresh...');
        const refreshResponse = await fetch(`${defaultConfig.apiUrl}/library/refresh`);
        if (refreshResponse.ok) {
          // Wait for indexing to complete (up to 20 seconds)
          let indexed = false;
          for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const checkResponse = await fetch(`${defaultConfig.apiUrl}/library/index`);
            if (checkResponse.ok) {
              const checkStatus = await checkResponse.json();
              if (!checkStatus.isIndexing && checkStatus.metadata) {
                indexed = true;
                testLog.info(`✅ Music library indexed: ${checkStatus.metadata.totalTracks} tracks`);
                break;
              }
            }
          }
          libraryAvailable = indexed;
        }
      } else if (status.metadata) {
        libraryAvailable = true;
        testLog.info(`✅ Music library already indexed: ${status.metadata.totalTracks} tracks`);
      }
    }
  });

  after(async () => {
    testLog.info('\n🧹 Cleaning up Default Service tests...\n');
    
    // Restore original defaults
    if (originalDefaults?.room) {
      await fetch(`${defaultConfig.apiUrl}/default/room/${originalDefaults.room}`);
    }
    if (originalDefaults?.musicService) {
      await fetch(`${defaultConfig.apiUrl}/default/service/${originalDefaults.musicService}`);
    }
    
    // Use global teardown
    await globalTestTeardown('Default Service Content', testContext);
  });
  
  afterEach(async () => {
    // Stop any playback after each test to prevent music from continuing
    // Only do this if we have a valid test room
    if (testRoom) {
      try {
        const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pause`);
        // Don't wait for response processing
      } catch (error) {
        // Ignore errors if already stopped
      }
    }
  });

  describe('Default Settings Management', () => {
    it('should get current default settings', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/default`);
      assert.strictEqual(response.status, 200);
      
      const defaults = await response.json();
      assert(defaults.room, 'Should have default room');
      assert(defaults.musicService, 'Should have default music service');
      assert(defaults.lastUpdated, 'Should have last updated timestamp');
      
      testLog.info(`✅ Current defaults: room=${defaults.room}, service=${defaults.musicService}`);
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
      
      testLog.info('✅ Default service set to library');
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
      
      testLog.info('✅ Default service set to apple');
    });

    it('should handle invalid service names', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/default/service/invalidservice`);
      // API now validates service names and returns 400 for invalid ones
      assert.strictEqual(response.status, 400);
      
      const error = await response.json();
      assert(error.error, 'Should have error message');
      
      testLog.info('✅ Invalid service handled correctly');
    });
  });

  describe('Default Song Search', () => {
    it('should search songs using library service', async function() {
      if (!libraryAvailable) {
        testLog.info('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }
      
      // Set default to library
      await fetch(`${defaultConfig.apiUrl}/default/service/library`);
      
      // Get a safe search term for library
      const searchTerm = await getSafeSearchQuery('song', 'library');
      const response = await fetch(`${defaultConfig.apiUrl}/song/${encodeURIComponent(searchTerm)}`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert.strictEqual(result.status, 'success');
      assert.strictEqual(result.service, 'library');
      assert(result.title, 'Should have song title');
      assert(result.artist, 'Should have artist');
      
      testLog.info(`✅ Found library song: "${result.title}" by ${result.artist}`);
      
      // Wait for track change
      const trackChanged = await testContext.eventManager.waitForTrackChange(deviceId, 10000);
      if (trackChanged) {
        testLog.info('✅ Default song search triggered playback');
      }
    });

    it('should search songs using apple service', async () => {
      // Set default to apple
      await fetch(`${defaultConfig.apiUrl}/default/service/apple`);
      
      // Get a safe search term for apple
      const searchTerm = await getSafeSearchQuery('song', 'apple');
      const response = await fetch(`${defaultConfig.apiUrl}/song/${encodeURIComponent(searchTerm)}`);
      
      if (response.status === 200) {
        const result = await response.json();
        assert.strictEqual(result.status, 'success');
        assert.strictEqual(result.service, 'apple');
        assert(result.title, 'Should have song title');
        testLog.info(`✅ Found Apple Music song: "${result.title}"`);
      } else {
        // Apple Music search might fail due to account issues
        testLog.info('⚠️  Apple Music search failed (likely account configuration)');
      }
    });

    it('should handle no results gracefully', async function() {
      if (!libraryAvailable) {
        testLog.info('⚠️  Test skipped - music library not available');
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
      
      testLog.info('✅ No results handled correctly');
    });
  });

  describe('Default Album Search', () => {
    it('should search albums using library service', async function() {
      if (!libraryAvailable) {
        testLog.info('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }
      
      // Set default to library
      await fetch(`${defaultConfig.apiUrl}/default/service/library`);
      
      // Get a safe search term for library albums
      const searchTerm = await getSafeSearchQuery('album', 'library');
      const response = await fetch(`${defaultConfig.apiUrl}/album/${encodeURIComponent(searchTerm)}`);
      
      if (response.status === 200) {
        const result = await response.json();
        assert.strictEqual(result.status, 'success');
        assert.strictEqual(result.service, 'library');
        assert(result.album, 'Should have album name');
        testLog.info(`✅ Found library album: "${result.album}"`);
      } else if (response.status === 404) {
        testLog.info('⚠️  No albums found with "greatest" in library (this is normal)');
      }
    });

    it('should search albums using apple service', async () => {
      // Set default to apple
      await fetch(`${defaultConfig.apiUrl}/default/service/apple`);
      
      // Get a safe search term for apple albums
      const searchTerm = await getSafeSearchQuery('album', 'apple');
      const response = await fetch(`${defaultConfig.apiUrl}/album/${encodeURIComponent(searchTerm)}`);
      
      if (response.status === 200) {
        const result = await response.json();
        assert.strictEqual(result.status, 'success');
        assert.strictEqual(result.service, 'apple');
        assert(result.album, 'Should have album name');
        testLog.info(`✅ Found Apple Music album: "${result.album}"`);
      } else {
        testLog.info('⚠️  Apple Music album search failed (likely account configuration)');
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
      
      testLog.info('✅ Library station search limitation handled correctly');
    });

    it('should handle station search with pandora service', { timeout: 40000 }, async () => {
      // Set default to pandora
      await fetch(`${defaultConfig.apiUrl}/default/service/pandora`);
      
      // Use TEST_PANDORA_STATION if set, otherwise default to quickmix
      const stationName = process.env.TEST_PANDORA_STATION || 'quickmix';
      const response = await fetch(`${defaultConfig.apiUrl}/station/${encodeURIComponent(stationName)}`);
      
      // Pandora might not be configured, so we expect either success or 503/404
      if (response.status === 200) {
        const result = await response.json();
        assert.strictEqual(result.status, 'success');
        assert.strictEqual(result.service, 'pandora');
        testLog.info(`✅ Pandora station search succeeded: "${stationName}"`);
      } else if (response.status === 404 || response.status === 503) {
        testLog.info(`⚠️  Pandora not configured or station "${stationName}" not found (expected)`);
      } else {
        testLog.info(`⚠️  Unexpected response for station "${stationName}": ${response.status}`);
      }
    });
  });

  describe('Service Switching', () => {
    it('should switch between library and apple services', async function() {
      if (!libraryAvailable) {
        testLog.info('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }
      
      // Test library first
      await fetch(`${defaultConfig.apiUrl}/default/service/library`);
      const librarySongTerm = await getSearchTerm('song', 'library');
      let response = await fetch(`${defaultConfig.apiUrl}/song/${encodeURIComponent(librarySongTerm)}`);
      
      if (response.status === 200) {
        let result = await response.json();
        assert.strictEqual(result.service, 'library');
        testLog.info(`✅ Library search: "${result.title}"`);
      }
      
      // Switch to Apple Music
      await fetch(`${defaultConfig.apiUrl}/default/service/apple`);
      const appleAlbumTerm = await getSearchTerm('album', 'apple');
      response = await fetch(`${defaultConfig.apiUrl}/album/${encodeURIComponent(appleAlbumTerm)}`);
      
      if (response.status === 200) {
        let result = await response.json();
        assert.strictEqual(result.service, 'apple');
        testLog.info(`✅ Apple Music search: "${result.album || result.title}"`);
      } else {
        testLog.info('⚠️  Apple Music search failed (account configuration)');
      }
      
      testLog.info('✅ Service switching test completed');
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
      
      testLog.info('✅ Service changes persist correctly');
    });
  });

  describe('Error Handling', () => {
    it('should handle unsupported service gracefully', async () => {
      // Use a truly unsupported service (SiriusXM is not implemented)
      await fetch(`${defaultConfig.apiUrl}/default/service/siriusxm`);
      
      const response = await fetch(`${defaultConfig.apiUrl}/song/test`);
      assert.strictEqual(response.status, 501);
      
      const error = await response.json();
      assert(error.error, 'Should have error message');
      assert(error.error.includes('not yet implemented'), 'Should indicate service not supported');
      
      testLog.info('✅ Unsupported service handled correctly');
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
        testLog.info('✅ Library not indexed error handled correctly');
      } else if (response.status === 404) {
        testLog.info('✅ Library indexed but no results found (normal)');
      } else if (response.status === 200) {
        testLog.info('✅ Library search succeeded');
      }
    });
  });
});