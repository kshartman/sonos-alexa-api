import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../helpers/test-config.js';
import { globalTestSetup, globalTestTeardown, TestContext } from '../helpers/global-test-setup.js';
import { testLog, waitForContinueFlag } from '../helpers/test-logger.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

// Use 10 hours timeout in interactive mode
const testTimeout = process.env.TEST_INTERACTIVE === 'true' ? 36000000 : 100000;

describe('Apple Music Content Integration Tests', { skip: skipIntegration, timeout: testTimeout }, () => {
  let testContext: TestContext;
  let testRoom: string;
  let deviceId: string;

  before(async () => {
    testContext = await globalTestSetup('Apple Music Content Integration Tests');
    
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
    
    // Clear the test room's queue to ensure clean state
    testLog.info('🗑️  Clearing test room queue...');
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/clearqueue`);
  });

  after(async () => {
    await globalTestTeardown('Apple Music tests', testContext);
  });

  describe('Apple Music Search', () => {
    it('should search Apple Music by song title', async () => {
      const songQuery = testContext.musicsearchSongTerm;
      testLog.info(`   🔍 Searching for song: "${songQuery}"`);
      
      const searchStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/apple/song/${encodeURIComponent(songQuery)}`);
      assert.strictEqual(response.status, 200);
      const searchTime = Date.now() - searchStartTime;
      testLog.info(`   ⏱️  Search request took: ${searchTime}ms`);
      
      const result = await response.json();
      
      // If the search failed, try to understand why
      if (result.status !== 'success') {
        testLog.info(`   ❌ Apple Music search failed. This could mean:`);
        testLog.info(`      - Apple Music account not configured in Sonos`);
        testLog.info(`      - Search term "${songQuery}" not found`);
        testLog.info(`      - Service temporarily unavailable`);
        
        // Skip the rest of the test if Apple Music isn't working
        this.skip();
        return;
      }
      
      assert(result.status === 'success', 'Apple Music song search should succeed');
      assert(result.service === 'apple', 'Service should be apple');
      assert(result.title, 'Should have a title');
      
      testLog.info(`✅ Found song: "${result.title}" by ${result.artist || 'Unknown'}`);
      
      // Test playing the found track
      const playStartTime = Date.now();
      const trackChangePromise = testContext.eventManager.waitForTrackChange(deviceId, 5000);
      
      // The search result should have triggered playback
      const trackChanged = await trackChangePromise;
      const waitTime = Date.now() - playStartTime;
      testLog.info(`   ⏱️  WaitForTrackChange took: ${waitTime}ms`);
      
      if (trackChanged) {
        const stableStartTime = Date.now();
        const finalState = await testContext.eventManager.waitForStableState(deviceId, 5000);
        const stableTime = Date.now() - stableStartTime;
        testLog.info(`   ⏱️  WaitForStableState took: ${stableTime}ms`);
        testLog.info(`   ⏱️  Total time from search to stable: ${Date.now() - searchStartTime}ms`);
        assert(finalState === 'PLAYING', `Expected PLAYING state, got ${finalState}`);
        
        const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        const state = await stateResponse.json();
        assert(state.currentTrack, 'Should have current track info');
        testLog.info(`✅ Playing Apple Music track: ${state.currentTrack.title}`);
      }
      
      // Wait for user to verify playback
      await waitForContinueFlag();
    });

    it('should search Apple Music by album', async () => {
      // Stop current playback
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await testContext.eventManager.waitForState(deviceId, 'STOPPED', 2000);
      
      const albumQuery = testContext.musicsearchAlbumTerm;
      testLog.info(`   🔍 Searching for album: "${albumQuery}"`);
      
      const searchStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/apple/album/${encodeURIComponent(albumQuery)}`);
      assert.strictEqual(response.status, 200);
      const searchTime = Date.now() - searchStartTime;
      testLog.info(`   ⏱️  Search request took: ${searchTime}ms`);
      
      const result = await response.json();
      
      // If the search failed, try to understand why
      if (result.status !== 'success') {
        testLog.info(`   ❌ Apple Music album search failed. This could mean:`);
        testLog.info(`      - Apple Music account not configured in Sonos`);
        testLog.info(`      - Search term "${albumQuery}" not found`);
        testLog.info(`      - Service temporarily unavailable`);
        
        // Skip the rest of the test if Apple Music isn't working
        this.skip();
        return;
      }
      
      assert(result.status === 'success', 'Apple Music album search should succeed');
      assert(result.service === 'apple', 'Service should be apple');
      assert(result.album, 'Should have an album');
      
      testLog.info(`✅ Found album: "${result.title}" from ${result.album}`);
      
      // Check if it's playing
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      if (state.playbackState === 'PLAYING') {
        testLog.info(`   ✅ Playing album track: ${state.currentTrack?.title || 'Unknown'} from ${state.currentTrack?.album || 'Unknown'}`);
        
        // Wait for user to verify playback
        await waitForContinueFlag();
      }
    });

    it('should handle Apple Music search with no results', async () => {
      const searchStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/apple/song/xyzzy12345nonexistent`);
      const searchTime = Date.now() - searchStartTime;
      testLog.info(`   ⏱️  Search request took: ${searchTime}ms`);
      
      // Should return 404 or error status
      if (response.status === 404) {
        const error = await response.json();
        assert(error.error, 'Should have error message');
        testLog.info('✅ Apple Music search returned 404 for non-existent song');
      } else if (response.status === 200) {
        const result = await response.json();
        assert(result.status === 'error', 'Should have error status');
        testLog.info('✅ Apple Music search returned error for non-existent song');
      } else {
        assert.fail(`Unexpected status code: ${response.status}`);
      }
    });
  });
});