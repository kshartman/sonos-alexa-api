import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, getTestTimeout } from '../helpers/test-config.js';
import { globalTestSetup, globalTestTeardown, TestContext } from '../helpers/global-test-setup.js';
import { testLog } from '../helpers/test-logger.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Music Library Content Integration Tests', { skip: skipIntegration, timeout: getTestTimeout(100000) }, () => {
  let testContext: TestContext;
  let testRoom: string;
  let deviceId: string;
  let libraryAvailable: boolean = false;

  before(async () => {
    testContext = await globalTestSetup('Music Library Content Integration Tests');
    
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
    
    // Check if music library is available and indexed
    const libraryStatusResponse = await fetch(`${defaultConfig.apiUrl}/library/index`);
    if (libraryStatusResponse.ok) {
      const status = await libraryStatusResponse.json();
      if (status.status === 'not initialized') {
        testLog.info('📚 Music library not initialized, triggering refresh...');
        const refreshResponse = await fetch(`${defaultConfig.apiUrl}/library/refresh`);
        if (refreshResponse.ok) {
          // Wait for indexing to complete (up to 30 seconds)
          let indexed = false;
          for (let i = 0; i < 30; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
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
    
    if (!libraryAvailable) {
      testLog.info('⚠️  Music library not available for testing');
    }
  });

  after(async () => {
    await globalTestTeardown('Music Library tests', testContext);
  });

  describe('Library Status', () => {
    it('should get library indexing status', async function() {
      const response = await fetch(`${defaultConfig.apiUrl}/library/index`);
      assert.strictEqual(response.status, 200);
      
      const status = await response.json();
      
      if (status.status === 'not initialized') {
        testLog.info('⚠️  Music library not initialized');
        this.skip();
        return;
      }
      
      assert(typeof status.isIndexing === 'boolean', 'Should have indexing status');
      assert(typeof status.progress === 'number', 'Should have progress');
      
      if (status.metadata) {
        assert(typeof status.metadata.totalTracks === 'number', 'Should have track count');
        assert(typeof status.metadata.totalAlbums === 'number', 'Should have album count');
        assert(typeof status.metadata.totalArtists === 'number', 'Should have artist count');
        testLog.info(`✅ Library status: ${status.metadata.totalTracks} tracks, ${status.metadata.totalAlbums} albums, ${status.metadata.totalArtists} artists`);
      }
    });
  });

  describe('Music Library Search', () => {
    it('should search library by song title', async function() {
      if (!libraryAvailable) {
        testLog.info('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }

      const songQuery = testContext.musicsearchSongTerm;
      testLog.info(`   🔍 Searching for song: "${songQuery}"`);
      
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/library/song/${encodeURIComponent(songQuery)}`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Library song search should succeed');
      assert(result.service === 'library', 'Service should be library');
      assert(result.title, 'Should have a title');
      assert(result.artist, 'Should have an artist');
      
      testLog.info(`✅ Found song: "${result.title}" by ${result.artist}`);
      
      // Test playing the found track
      const trackChangePromise = testContext.eventManager.waitForTrackChange(deviceId, 5000);
      
      // The search result should have triggered playback
      const trackChanged = await trackChangePromise;
      if (trackChanged) {
        const finalState = await testContext.eventManager.waitForStableState(deviceId, 5000);
        assert(finalState === 'PLAYING', `Expected PLAYING state, got ${finalState}`);
        
        const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        const state = await stateResponse.json();
        assert(state.currentTrack, 'Should have current track info');
        testLog.info(`✅ Playing library track: ${state.currentTrack.title}`);
        
        // Pause to hear the track
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    });

    it('should search library by artist', async function() {
      if (!libraryAvailable) {
        testLog.info('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }

      // Stop current playback
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await testContext.eventManager.waitForState(deviceId, 'STOPPED', 2000);

      const artistQuery = 'the'; // Common word in many artist names
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/library/artist/${encodeURIComponent(artistQuery)}`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Library artist search should succeed');
      assert(result.service === 'library', 'Service should be library');
      assert(result.artist, 'Should have an artist');
      
      testLog.info(`✅ Found track by artist: "${result.title}" by ${result.artist}`);
    });

    it('should search library by album', async function() {
      if (!libraryAvailable) {
        testLog.info('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }

      const albumQuery = testContext.musicsearchAlbumTerm;
      testLog.info(`   🔍 Searching for album: "${albumQuery}"`);
      
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/library/album/${encodeURIComponent(albumQuery)}`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      
      if (result.status === 'error' && result.error === 'No albums found matching "greatest"') {
        testLog.info('⚠️  No albums found with "greatest" in the title');
        // Try another common album word
        const altResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/library/album/best`);
        if (altResponse.ok) {
          const altResult = await altResponse.json();
          if (altResult.status === 'success') {
            testLog.info(`✅ Found track from album: "${altResult.title}" from ${altResult.album}`);
            return;
          }
        }
        this.skip();
        return;
      }
      
      assert(result.status === 'success', 'Library album search should succeed');
      assert(result.service === 'library', 'Service should be library');
      assert(result.album, 'Should have an album');
      
      testLog.info(`✅ Found track from album: "${result.title}" from ${result.album}`);
    });

    it('should handle library search with no results', async function() {
      if (!libraryAvailable) {
        testLog.info('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }

      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/library/song/xyzzy12345nonexistent`);
      
      // Should return 404 or error status
      if (response.status === 404) {
        const error = await response.json();
        assert(error.error, 'Should have error message');
        testLog.info('✅ Library search returned 404 for non-existent song');
      } else if (response.status === 200) {
        const result = await response.json();
        assert(result.status === 'error', 'Should have error status');
        testLog.info('✅ Library search returned error for non-existent song');
      } else {
        assert.fail(`Unexpected status code: ${response.status}`);
      }
    });

    it('should handle library search when cache is stale', async function() {
      if (!libraryAvailable) {
        testLog.info('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }

      // Get current status
      const statusResponse = await fetch(`${defaultConfig.apiUrl}/library/index`);
      const status = await statusResponse.json();
      
      if (status.metadata) {
        const lastUpdated = new Date(status.metadata.lastUpdated);
        const age = Date.now() - lastUpdated.getTime();
        const ageHours = age / (1000 * 60 * 60);
        
        testLog.info(`📚 Library cache age: ${ageHours.toFixed(1)} hours`);
        
        // Search should still work even with stale cache
        const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/library/song/music`);
        assert.strictEqual(response.status, 200);
        
        const result = await response.json();
        assert(result.status === 'success', 'Should still search with stale cache');
        testLog.info('✅ Library search works with potentially stale cache');
      }
    });
  });

  describe('Library Refresh', () => {
    it('should handle library refresh request', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/library/refresh`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Refresh request should succeed');
      
      // Check if indexing started
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const statusResponse = await fetch(`${defaultConfig.apiUrl}/library/index`);
      const status = await statusResponse.json();
      
      // It might already be complete if the library is small or was recently indexed
      if (status.isIndexing) {
        testLog.info(`✅ Library refresh started, progress: ${status.progress}%`);
      } else if (status.metadata) {
        testLog.info('✅ Library refresh completed (or was already fresh)');
      }
    });
  });
});