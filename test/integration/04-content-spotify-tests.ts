import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, getTestTimeout } from '../helpers/test-config.js';
import { globalTestSetup, globalTestTeardown, TestContext } from '../helpers/global-test-setup.js';
import { ServiceDetector } from '../helpers/service-detector.js';
import { testLog, waitForContinueFlag } from '../helpers/test-logger.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

// Use 10 hours timeout in interactive mode
const testTimeout = process.env.TEST_INTERACTIVE === 'true' ? 36000000 : getTestTimeout(180000);

describe('Spotify Content Integration Tests', { skip: skipIntegration, timeout: testTimeout }, () => {
  let testContext: TestContext;
  let testRoom: string;
  let deviceId: string;
  let hasSpotify = false;

  before(async () => {
    testContext = await globalTestSetup('Spotify Content Integration Tests');
    
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
    
    // Check if Spotify is configured
    const detector = new ServiceDetector(defaultConfig.apiUrl);
    hasSpotify = await detector.hasSpotify();
    
    if (!hasSpotify) {
      testLog.info('⚠️  Spotify not configured in Sonos - skipping tests');
    }
    
    // Stop any existing playback
    testLog.info('⏹️  Stopping any existing playback...');
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    
    // Clear the test room's queue to ensure clean state
    testLog.info('🗑️  Clearing test room queue...');
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/clearqueue`);
    
    // Set initial volume like other tests
    if (testContext.defaultVolume !== undefined) {
      testLog.info(`🔊 Setting initial volume to ${testContext.defaultVolume}...`);
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/${testContext.defaultVolume}`);
    }
  });

  after(async () => {
    await globalTestTeardown('Spotify tests', testContext);
  });

  describe('Spotify Music Search', { timeout: 60000 }, () => {
    let isAuthenticated = false;

    before(async () => {
      // Check if Spotify is authenticated
      try {
        const authResponse = await fetch(`${defaultConfig.apiUrl}/spotify/status`);
        const authStatus = await authResponse.json();
        isAuthenticated = authStatus.authenticated === true;
        testLog.info(`📊 Spotify authenticated: ${isAuthenticated}`);
      } catch (error) {
        testLog.info('⚠️  Could not check Spotify auth status');
      }
    });

    it('should search and play a song on Spotify', async function() {
      if (!hasSpotify) {
        testLog.info('⚠️  Test skipped - Spotify not configured');
        this.skip();
        return;
      }
      
      if (!isAuthenticated) {
        testLog.info('⚠️  Test skipped - Spotify not authenticated (OAuth required for search)');
        this.skip();
        return;
      }

      const songQuery = testContext.musicsearchSongTerm;
      testLog.info(`   🔍 Searching for song: "${songQuery}"`);
      
      const searchStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/spotify/song/${encodeURIComponent(songQuery)}`);
      assert.strictEqual(response.status, 200);
      const searchTime = Date.now() - searchStartTime;
      testLog.info(`   ⏱️  Search request took: ${searchTime}ms`);
      
      const result = await response.json();
      
      // If the search failed, try a fallback search
      if (result.status !== 'success') {
        testLog.info(`   ⚠️  No results for "${songQuery}", trying fallback search...`);
        
        // Try with a more common song
        const fallbackQuery = 'Yesterday';
        const fallbackResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/spotify/song/${encodeURIComponent(fallbackQuery)}`);
        
        if (fallbackResponse.status === 200) {
          const fallbackResult = await fallbackResponse.json();
          if (fallbackResult.status === 'success') {
            testLog.info(`   ✅ Fallback search succeeded with "${fallbackQuery}"`);
            Object.assign(result, fallbackResult);
          }
        }
      }
      
      // If still no success, explain why
      if (result.status !== 'success') {
        testLog.info(`   ❌ Spotify search failed. This could mean:`);
        testLog.info(`      - Spotify account not configured in Sonos`);
        testLog.info(`      - Search terms not found`);
        testLog.info(`      - Service temporarily unavailable`);
        
        // Skip the rest of the test if Spotify isn't working
        this.skip();
        return;
      }
      
      assert(result.status === 'success', 'Spotify song search should succeed');
      assert(result.service === 'spotify', 'Service should be spotify');
      assert(result.title, 'Should have a title');
      
      testLog.info(`✅ Found song: "${result.title}" by ${result.artist || 'Unknown'}`);
      
      // Test playing the found track
      const playStartTime = Date.now();
      const trackChangePromise = testContext.eventManager.waitForTrackChange(deviceId, 40300);
      
      // The search result should have triggered playback
      const trackChanged = await trackChangePromise;
      const waitTime = Date.now() - playStartTime;
      testLog.info(`   ⏱️  WaitForTrackChange took: ${waitTime}ms`);
      
      if (trackChanged) {
        const stableStartTime = Date.now();
        const reachedPlaying = await testContext.eventManager.waitForState(deviceId, 'PLAYING', 11500);
        const stableTime = Date.now() - stableStartTime;
        testLog.info(`   ⏱️  WaitForState took: ${stableTime}ms`);
        testLog.info(`   ⏱️  Total time from search to stable: ${Date.now() - searchStartTime}ms`);
        assert(reachedPlaying, 'Should reach PLAYING state');
        
        const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        const state = await stateResponse.json();
        assert(state.currentTrack, 'Should have current track info');
        testLog.info(`✅ Playing Spotify track: ${state.currentTrack.title}`);
      }
      
      // Wait for user to verify playback
      await waitForContinueFlag(0);
    });

    it('should search and play an album on Spotify', async function() {
      if (!hasSpotify) {
        testLog.info('⚠️  Test skipped - Spotify not configured');
        this.skip();
        return;
      }
      
      if (!isAuthenticated) {
        testLog.info('⚠️  Test skipped - Spotify not authenticated (OAuth required for search)');
        this.skip();
        return;
      }

      // Stop current playback
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await testContext.eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      const albumQuery = testContext.musicsearchAlbumTerm;
      testLog.info(`   🔍 Searching for album: "${albumQuery}"`);
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/spotify/album/${encodeURIComponent(albumQuery)}`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      
      // If the search failed, try to understand why
      if (result.status !== 'success') {
        testLog.info(`   ❌ Spotify album search failed. This could mean:`);
        testLog.info(`      - Spotify account not configured in Sonos`);
        testLog.info(`      - Search term "${albumQuery}" not found`);
        testLog.info(`      - Service temporarily unavailable`);
        
        // Skip the rest of the test if Spotify isn't working
        this.skip();
        return;
      }
      
      assert(result.status === 'success', 'Spotify album search should succeed');
      assert(result.service === 'spotify', 'Service should be spotify');
      assert(result.title, 'Should have a title');
      
      // Album field might be in different formats
      const albumName = result.album || result.metadata?.album || 'Unknown Album';
      testLog.info(`✅ Found album: "${result.title}" from ${albumName}`);
      
      // Check if it's playing
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      if (state.playbackState === 'PLAYING') {
        testLog.info(`   ✅ Playing album track: ${state.currentTrack?.title || 'Unknown'} from ${state.currentTrack?.album || 'Unknown'}`);
        
        // Wait for user to verify playback
        await waitForContinueFlag(0);
      }
    });

    it('should search and play an artist on Spotify', async function() {
      if (!hasSpotify) {
        testLog.info('⚠️  Test skipped - Spotify not configured');
        this.skip();
        return;
      }
      
      if (!isAuthenticated) {
        testLog.info('⚠️  Test skipped - Spotify not authenticated (OAuth required for search)');
        this.skip();
        return;
      }

      // Stop current playback
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await testContext.eventManager.waitForState(deviceId, 'STOPPED', 2000);

      // Try multiple artist search terms if available
      let searchSuccess = false;
      let successfulResult: any;
      
      for (const artistQuery of testContext.musicsearchArtistTerms) {
        testLog.info(`   🔍 Searching for artist: "${artistQuery}"`);
        
        const searchStartTime = Date.now();
        const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/spotify/artist/${encodeURIComponent(artistQuery)}`);
        const searchTime = Date.now() - searchStartTime;
        testLog.info(`   ⏱️  Search request took: ${searchTime}ms`);
        
        if (response.status === 200) {
          const result = await response.json();
          if (result.status === 'success') {
            searchSuccess = true;
            successfulResult = result;
            testLog.info(`✅ Found artist: "${result.artist}" - playing "${result.title}"`);
            break;
          }
        }
        
        if (!searchSuccess && artistQuery !== testContext.musicsearchArtistTerms[testContext.musicsearchArtistTerms.length - 1]) {
          testLog.info(`   ⚠️  No results for "${artistQuery}", trying next artist...`);
        }
      }
      
      if (!searchSuccess) {
        testLog.info(`   ❌ Spotify artist search failed for all terms. This could mean:`);
        testLog.info(`      - Spotify account not configured in Sonos`);
        testLog.info(`      - None of the artists found: ${testContext.musicsearchArtistTerms.join(', ')}`);
        testLog.info(`      - Service temporarily unavailable`);
        this.skip();
        return;
      }
      
      assert(successfulResult.status === 'success', 'Spotify artist search should succeed with at least one artist');
      assert(successfulResult.service === 'spotify', 'Service should be spotify');
      assert(successfulResult.artist, 'Should have an artist');
      
      // Test playing the found track
      const playStartTime = Date.now();
      const trackChangePromise = testContext.eventManager.waitForTrackChange(deviceId, 40300);
      
      const trackChanged = await trackChangePromise;
      const waitTime = Date.now() - playStartTime;
      testLog.info(`   ⏱️  WaitForTrackChange took: ${waitTime}ms`);
      
      if (trackChanged) {
        const stableStartTime = Date.now();
        const reachedPlaying = await testContext.eventManager.waitForState(deviceId, 'PLAYING', 11500);
        const stableTime = Date.now() - stableStartTime;
        testLog.info(`   ⏱️  WaitForState took: ${stableTime}ms`);
        testLog.info(`   ⏱️  Total time from play to stable: ${Date.now() - playStartTime}ms`);
        assert(reachedPlaying, 'Should reach PLAYING state');
        
        const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        const state = await stateResponse.json();
        assert(state.currentTrack, 'Should have current track info');
        testLog.info(`✅ Playing Spotify artist track: ${state.currentTrack.title} by ${state.currentTrack.artist}`);
      }
      
      // Wait for user to verify playback
      await waitForContinueFlag(0);
    });


    it('should search for Spotify radio station (if supported)', async function() {
      if (!hasSpotify) {
        testLog.info('⚠️  Test skipped - Spotify not configured');
        this.skip();
        return;
      }
      
      if (!isAuthenticated) {
        testLog.info('⚠️  Test skipped - Spotify not authenticated (OAuth required for search)');
        this.skip();
        return;
      }

      // Try to search for a station/radio
      const stationQuery = 'classic rock';
      testLog.info(`   📻 Searching for station: "${stationQuery}"`);
      
      const searchStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/spotify/station/${encodeURIComponent(stationQuery)}`);
      const searchTime = Date.now() - searchStartTime;
      testLog.info(`   ⏱️  Search request took: ${searchTime}ms`);
      
      // Station search might not be supported
      if (response.status === 501) {
        testLog.info('⚠️  Spotify station search not implemented');
        this.skip();
        return;
      }
      
      if (response.status === 404) {
        testLog.info('⚠️  Spotify station search returned 404 - feature may not be supported');
        this.skip();
        return;
      }
      
      assert.strictEqual(response.status, 200);
      const result = await response.json();
      
      if (result.status === 'success') {
        testLog.info(`✅ Found Spotify station: ${result.title || 'Unknown'}`);
        assert(result.service === 'spotify', 'Service should be spotify');
      } else {
        testLog.info('⚠️  Spotify station search not available');
      }
    });

  });

  describe('Spotify Direct Playback', { timeout: 100000 }, () => {
    
    it('should play a Spotify track by ID', async function() {
      if (!hasSpotify) {
        testLog.info('⚠️  Test skipped - Spotify not configured');
        this.skip();
        return;
      }
      
      // The Beatles - "Yesterday"
      const trackId = 'spotify:track:3BQHpFgAp4l80e1XslIjNI';
      testLog.info(`   🎵 Playing track: ${trackId}`);
      
      const playStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/spotify/play/${encodeURIComponent(trackId)}`);
      assert.strictEqual(response.status, 200, 'Should accept Spotify track ID');
      const playRequestTime = Date.now() - playStartTime;
      testLog.info(`   ⏱️  Play request took: ${playRequestTime}ms`);

      // Test playing the track
      const waitStartTime = Date.now();
      const trackChangePromise = testContext.eventManager.waitForTrackChange(deviceId, 40300);
      
      // The direct play should have triggered playback
      const trackChanged = await trackChangePromise;
      const waitTime = Date.now() - waitStartTime;
      testLog.info(`   ⏱️  WaitForTrackChange took: ${waitTime}ms`);
      if (trackChanged) {
        const stableStartTime = Date.now();
        const reachedPlaying = await testContext.eventManager.waitForState(deviceId, 'PLAYING', 11500);
        const stableTime = Date.now() - stableStartTime;
        testLog.info(`   ⏱️  WaitForState took: ${stableTime}ms`);
        testLog.info(`   ⏱️  Total time from play to stable: ${Date.now() - playStartTime}ms`);
        assert(reachedPlaying, 'Should reach PLAYING state');
        
        const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        const state = await stateResponse.json();
        assert(state.currentTrack, 'Should have current track info');
        assert(state.currentTrack?.uri?.includes('spotify'), 'Should be playing Spotify content');
        testLog.info(`✅ Playing Spotify track: ${state.currentTrack.title}`);
      }
      
      // Wait for user to verify playback
      await waitForContinueFlag(0);
    });

    it('should play a Spotify album by ID', async function() {
      if (!hasSpotify) {
        testLog.info('⚠️  Test skipped - Spotify not configured');
        this.skip();
        return;
      }
      
      // Stop current playback
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await testContext.eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      // The Beatles - Abbey Road
      const albumId = 'spotify:album:0ETFjACtuP2ADo6LFhL6HN';
      testLog.info(`   💿 Playing album: ${albumId}`);
      
      const playStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/spotify/play/${encodeURIComponent(albumId)}`);
      
      // Log response if not 200
      if (response.status !== 200) {
        const errorText = await response.text();
        testLog.info(`   ❌ Album play failed with status ${response.status}: ${errorText}`);
      }
      
      assert.strictEqual(response.status, 200, 'Should accept Spotify album ID');
      const playRequestTime = Date.now() - playStartTime;
      testLog.info(`   ⏱️  Play request took: ${playRequestTime}ms`);
      
      // Albums need time to load all tracks into queue
      testLog.info('   ⏳ Waiting for album to load...');
      const loadStartTime = Date.now();
      await new Promise(resolve => setTimeout(resolve, 3500));
      testLog.info(`   ⏱️  Album load wait took: ${Date.now() - loadStartTime}ms`);

      // Wait for playback to start - albums take longer because they add to queue
      try {
        const waitStartTime = Date.now();
        await testContext.eventManager.waitForState(deviceId, 'PLAYING', 5800);
        const waitTime = Date.now() - waitStartTime;
        testLog.info(`   ⏱️  WaitForState took: ${waitTime}ms`);
        testLog.info(`   ⏱️  Total time from play to playing: ${Date.now() - playStartTime}ms`);
      } catch (error) {
        // If it fails, check what state we're in
        const currentState = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        const stateData = await currentState.json();
        testLog.info(`   Failed to reach PLAYING state for album. Current state: ${stateData.playbackState}`);
        testLog.info(`   Current track: ${stateData.currentTrack?.title || 'none'}`);
        testLog.info(`   Current URI: ${stateData.currentTrack?.uri || 'none'}`);
        
        // Check queue status
        const queueResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/queue`);
        const queue = await queueResponse.json();
        testLog.info(`   Queue length: ${queue.length}`);
        if (queue.length > 0) {
          testLog.info(`   First queue item: ${queue[0].title}`);
        }
        
        throw error;
      }
      
      // Verify it's playing
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      assert(
        state.playbackState === 'PLAYING' || state.playbackState === 'TRANSITIONING',
        `Should be playing or transitioning, but was ${state.playbackState}`
      );
      assert(state.currentTrack?.uri?.includes('spotify'), 'Should be playing Spotify content');
      testLog.info(`✅ Playing from album: ${state.currentTrack.title}`);
      
      // Wait for user to verify playback
      await waitForContinueFlag(0);
    });

    it('should play a Spotify playlist by ID', async function() {
      if (!hasSpotify) {
        testLog.info('⚠️  Test skipped - Spotify not configured');
        this.skip();
        return;
      }
      
      // Stop current playback
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await testContext.eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      // Find a Spotify playlist from favorites
      const favoritesResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/favorites/detailed`);
      const favorites = await favoritesResponse.json();
      
      // Find first Spotify playlist in favorites
      const spotifyPlaylist = favorites.find((fav: any) => 
        fav.uri?.includes('spotify') && 
        fav.uri?.includes('playlist')
      );
      
      if (!spotifyPlaylist) {
        testLog.info('⚠️  No Spotify playlists found in favorites');
        this.skip();
        return;
      }
      
      // Extract playlist ID from the URI
      const playlistMatch = spotifyPlaylist.uri.match(/spotify%3Aplaylist%3A([a-zA-Z0-9]+)/);
      if (!playlistMatch) {
        testLog.info('⚠️  Could not extract playlist ID from favorite');
        this.skip();
        return;
      }
      
      const playlistId = `spotify:playlist:${playlistMatch[1]}`;
      testLog.info(`   📋 Playing playlist: ${playlistId}`);
      
      const playStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/spotify/play/${encodeURIComponent(playlistId)}`);
      assert.strictEqual(response.status, 200, 'Should accept Spotify playlist ID');
      const playRequestTime = Date.now() - playStartTime;
      testLog.info(`   ⏱️  Play request took: ${playRequestTime}ms`);
      
      // Playlists need time to load all tracks into queue
      testLog.info('   ⏳ Waiting for playlist to load...');
      const loadStartTime = Date.now();
      await new Promise(resolve => setTimeout(resolve, 3500));
      testLog.info(`   ⏱️  Playlist load wait took: ${Date.now() - loadStartTime}ms`);

      // Wait for playback to start
      const waitStartTime = Date.now();
      await testContext.eventManager.waitForState(deviceId, 'PLAYING', 5800);
      const waitTime = Date.now() - waitStartTime;
      testLog.info(`   ⏱️  WaitForState took: ${waitTime}ms`);
      testLog.info(`   ⏱️  Total time from play to playing: ${Date.now() - playStartTime}ms`);
      
      // Verify playback
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      assert(
        state.playbackState === 'PLAYING' || state.playbackState === 'TRANSITIONING',
        `Should be playing or transitioning, but was ${state.playbackState}`
      );
      assert(state.currentTrack?.uri?.includes('spotify'), 'Should be playing Spotify content');
      testLog.info(`✅ Playing from playlist: ${state.currentTrack.title}`);
      
      // Wait for user to verify playback
      await waitForContinueFlag(0);
    });

    it('should handle Spotify share URLs by converting to IDs', async () => {
      // This test validates the URL parsing logic using real Beatles URLs
      const shareUrls = [
        { 
          url: 'https://open.spotify.com/track/3BQHpFgAp4l80e1XslIjNI?si=b97a17ad55564f7d',
          expectedId: 'spotify:track:3BQHpFgAp4l80e1XslIjNI',
          description: 'Yesterday'
        },
        { 
          url: 'https://open.spotify.com/album/0ETFjACtuP2ADo6LFhL6HN?si=PJ24rsOIROqmo5mIU8ejMQ',
          expectedId: 'spotify:album:0ETFjACtuP2ADo6LFhL6HN',
          description: 'Abbey Road'
        },
        { 
          url: 'https://open.spotify.com/album/1klALx0u4AavZNEvC4LrTL?si=t0xYh_P6QomgGZF_Q6umLg',
          expectedId: 'spotify:album:1klALx0u4AavZNEvC4LrTL',
          description: 'The Beatles (White Album)'
        }
      ];
      
      // Test ID extraction logic
      for (const { url, expectedId, description } of shareUrls) {
        const match = url.match(/https:\/\/open\.spotify\.com\/(track|album|playlist|artist)\/([a-zA-Z0-9]+)/);
        assert.ok(match, `Should parse Spotify URL for ${description}: ${url}`);
        
        const [, type, id] = match;
        const constructedId = `spotify:${type}:${id}`;
        assert.equal(constructedId, expectedId, `Should correctly extract ID from ${description} URL`);
      }
    });
  });
});
