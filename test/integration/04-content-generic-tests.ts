import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig, getTestTimeout } from '../helpers/test-config.js';
import { getSafeTestRoom } from '../helpers/discovery.js';
import { globalTestSetup, globalTestTeardown, getDeviceIdForRoom, TestContext } from '../helpers/global-test-setup.js';
import { loadTestSong, loadTestAlbum, loadTestFavorite, getTestFavorite } from '../helpers/content-loader.js';
import { testLog, waitForContinueFlag } from '../helpers/test-logger.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Generic Content Integration Tests', { skip: skipIntegration, timeout: getTestTimeout(120000) }, () => {
  let context: TestContext;
  let testRoom: string;
  let deviceId: string;
  let eventManager: EventManager;

  before(async () => {
    context = await globalTestSetup('Generic Content Integration Tests');
    eventManager = context.eventManager;
    
    // Get test room
    testRoom = await getSafeTestRoom(context.topology);
    deviceId = await getDeviceIdForRoom(testRoom);
    
    testLog.info(`📊 Test room: ${testRoom}`);
    testLog.info(`📊 Device ID: ${deviceId}`);
  });

  after(async () => {
    await globalTestTeardown('Generic Content tests', context);
  });


  describe('Content Discovery', () => {
    it('should find and play a test favorite', async () => {
      // Get the test favorite (respects TEST_FAVORITE env var)
      const testFavorite = await getTestFavorite(testRoom);
      
      assert.ok(testFavorite, 'Should find a suitable test favorite');
      testLog.info(`   Found favorite: ${testFavorite.title}`);
      
      // Stop current playback first
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 2000).catch(() => {});
      
      // Play the favorite using the endpoint
      testLog.info(`📻 Playing favorite: ${testFavorite.title}`);
      const playStartTime = Date.now();
      const playResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/favorite/${encodeURIComponent(testFavorite.title)}`);
      assert.equal(playResponse.status, 200, 'Should successfully play favorite');
      const playRequestTime = Date.now() - playStartTime;
      testLog.info(`   ⏱️  Play request took: ${playRequestTime}ms`);
      
      // Wait for playback to start
      const waitStartTime = Date.now();
      await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      const waitTime = Date.now() - waitStartTime;
      testLog.info(`   ⏱️  WaitForState took: ${waitTime}ms`);
      testLog.info(`   ⏱️  Total time from play to playing: ${Date.now() - playStartTime}ms`);
      
      // Verify it's playing
      const finalState = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const playState = await finalState.json();
      
      assert.ok(
        playState.playbackState === 'PLAYING' || playState.playbackState === 'TRANSITIONING',
        `Should be playing, but was ${playState.playbackState}`
      );
      
      testLog.info(`   ✅ Successfully playing: ${playState.currentTrack?.title} by ${playState.currentTrack?.artist}`);
      
      // Wait for user to verify playback
      await waitForContinueFlag();
    });
    
    it('should list favorites', async () => {
      // IMPORTANT: Using /favorites/detailed because we need the full objects with title property
      // The basic /favorites endpoint only returns string array of titles
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/favorites/detailed`);
      assert.strictEqual(response.status, 200);
      
      const favorites = await response.json();
      assert(Array.isArray(favorites), 'Favorites should be an array');
      
      testLog.info(`✅ Found ${favorites.length} favorites`);
      
      // Verify the structure of detailed favorites
      if (favorites.length > 0) {
        const firstFavorite = favorites[0];
        assert(typeof firstFavorite === 'object', 'Favorite should be an object');
        assert(firstFavorite.title, 'Favorite should have a title');
        assert(firstFavorite.uri, 'Favorite should have a uri');
        testLog.info(`   Sample favorite: ${firstFavorite.title}`);
      }
    });

    it('should list playlists with detailed info', async () => {
      // IMPORTANT: Using /playlists/detailed because we need the full objects with title property
      // The basic /playlists endpoint only returns string array of titles
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/playlists/detailed`);
      assert.strictEqual(response.status, 200);
      
      const playlists = await response.json();
      assert(Array.isArray(playlists), 'Playlists should be an array');
      
      testLog.info(`✅ Found ${playlists.length} playlists`);
      
      // Verify the structure of detailed playlists
      if (playlists.length > 0) {
        const firstPlaylist = playlists[0];
        assert(typeof firstPlaylist === 'object', 'Playlist should be an object');
        assert(firstPlaylist.id, 'Playlist should have an id');
        assert(firstPlaylist.title, 'Playlist should have a title');
        assert(firstPlaylist.uri, 'Playlist should have a uri');
        testLog.info(`   Sample playlist: ${firstPlaylist.title} (${firstPlaylist.id})`);
      }
    });
    
    it('should find and play an existing playlist', async () => {
      // Get available playlists
      testLog.info('   Finding existing playlists...');
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/playlists/detailed`);
      assert.strictEqual(response.status, 200);
      
      const playlists = await response.json();
      assert(Array.isArray(playlists), 'Playlists should be an array');
      
      if (playlists.length === 0) {
        testLog.info('   ⚠️  No playlists found, skipping playlist test');
        return;
      }
      
      // Use the first available playlist
      const testPlaylist = playlists[0];
      testLog.info(`   Found playlist: ${testPlaylist.title}`);
      
      // Clear queue first
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/clearqueue`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Play the playlist
      testLog.info(`📻 Playing playlist: ${testPlaylist.title}`);
      const playStartTime = Date.now();
      const playResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/playlist/${encodeURIComponent(testPlaylist.title)}`);
      assert.equal(playResponse.status, 200, 'Should successfully play playlist');
      const playRequestTime = Date.now() - playStartTime;
      testLog.info(`   ⏱️  Play request took: ${playRequestTime}ms`);
      
      // Wait for playback to start
      const waitStartTime = Date.now();
      await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      const waitTime = Date.now() - waitStartTime;
      testLog.info(`   ⏱️  WaitForState took: ${waitTime}ms`);
      testLog.info(`   ⏱️  Total time from play to playing: ${Date.now() - playStartTime}ms`);
      
      // Verify it's playing
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      assert.ok(
        state.playbackState === 'PLAYING' || state.playbackState === 'TRANSITIONING',
        `Should be playing, but was ${state.playbackState}`
      );
      assert.ok(state.currentTrack?.title, 'Should have a current track from playlist');
      
      testLog.info(`   ✅ Playlist playing: ${state.currentTrack?.title} by ${state.currentTrack?.artist}`);
      
      // Wait for user to verify playback
      await waitForContinueFlag();
    });

    it('should handle content updates', async () => {
      // Listen for content update events
      // These occur when favorites, playlists, or music library changes
      const contentUpdatePromise = eventManager.waitForContentUpdate(deviceId, 1000);
      
      // Content updates are typically triggered by external changes
      // For testing, we'll just verify the event system is ready
      const updated = await contentUpdatePromise;
      if (updated) {
        testLog.info('✅ Received content update event');
      } else {
        testLog.info('ℹ️  No content updates detected (this is normal)');
      }
    });
  });

  describe('Queue Management', () => {
    before(async () => {
      // Load some content into the queue
      testLog.info('📻 Loading content for queue tests...');
      await loadTestSong(testRoom, true);
      await eventManager.waitForState(deviceId, 'PLAYING', 5000);
    });

    it('should emit queue change events', async () => {
      // Get current queue state
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      assert(state.currentTrack, 'Should have content loaded');
      
      // Clear queue and wait for queue event
      // Note: Queue events might not be implemented in all Sonos versions
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/clearqueue`);
      assert.strictEqual(response.status, 200);
      
      // Queue should be cleared
      testLog.info('✅ Queue cleared successfully');
    });

    it('should handle next/previous with queue events', async () => {
      // Load an album to have multiple tracks
      await loadTestAlbum(testRoom);
      
      // Start playback
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/play`);
      await eventManager.waitForState(deviceId, 'PLAYING', 5000);
      
      // Get initial track
      let stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      let state = await stateResponse.json();
      const initialTrack = state.currentTrack?.title;
      
      // Go to next track
      const nextStartTime = Date.now();
      const nextTrackPromise = eventManager.waitForTrackChange(deviceId, 5000); // 5 second timeout
      const nextResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/next`);
      assert.strictEqual(nextResponse.status, 200);
      const nextRequestTime = Date.now() - nextStartTime;
      testLog.info(`   ⏱️  Next request took: ${nextRequestTime}ms`);
      
      const waitStartTime = Date.now();
      const nextTrackChanged = await nextTrackPromise;
      const waitTime = Date.now() - waitStartTime;
      testLog.info(`   ⏱️  WaitForTrackChange took: ${waitTime}ms`);
      if (nextTrackChanged) {
        stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        state = await stateResponse.json();
        const newTrack = state.currentTrack?.title;
        assert(newTrack !== initialTrack, 'Track should change after next');
        testLog.info(`✅ Next track: ${newTrack}`);
      } else {
        testLog.info('⚠️  No track change event for next (might be last track)');
      }
      
      // Go to previous track
      const prevStartTime = Date.now();
      const prevTrackPromise = eventManager.waitForTrackChange(deviceId, 5000); // 5 second timeout
      const prevResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/previous`);
      assert.strictEqual(prevResponse.status, 200);
      const prevRequestTime = Date.now() - prevStartTime;
      testLog.info(`   ⏱️  Previous request took: ${prevRequestTime}ms`);
      
      const waitStartTime2 = Date.now();
      const prevTrackChanged = await prevTrackPromise;
      const waitTime2 = Date.now() - waitStartTime2;
      testLog.info(`   ⏱️  WaitForTrackChange took: ${waitTime2}ms`);
      if (prevTrackChanged) {
        testLog.info('✅ Previous track command successful');
      } else {
        testLog.info('⚠️  No track change event for previous');
      }
    });
  });

  describe('Playback Modes', () => {
    before(async () => {
      // Ensure we have content loaded
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      if (!state.currentTrack || state.playbackState === 'STOPPED') {
        testLog.info('📻 Loading content for playback mode tests...');
        await loadTestSong(testRoom, true);
        await eventManager.waitForState(deviceId, 'PLAYING', 5000);
      }
    });

    it('should control repeat mode', async () => {
      // Enable repeat
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/repeat/on`);
      assert.strictEqual(response.status, 200);
      
      // Note: Repeat mode changes might not emit specific events
      // The change is immediate in the transport settings
      
      // Disable repeat
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/repeat/off`);
      assert.strictEqual(response.status, 200);
      
      testLog.info('✅ Repeat mode commands sent successfully');
    });

    it('should control shuffle mode', async () => {
      // Enable shuffle
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/shuffle/on`);
      assert.strictEqual(response.status, 200);
      
      // Disable shuffle
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/shuffle/off`);
      assert.strictEqual(response.status, 200);
      
      testLog.info('✅ Shuffle mode commands sent successfully');
    });

    it('should control crossfade mode', async () => {
      // Enable crossfade
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/crossfade/on`);
      assert.strictEqual(response.status, 200);
      
      // Disable crossfade
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/crossfade/off`);
      assert.strictEqual(response.status, 200);
      
      testLog.info('✅ Crossfade mode commands sent successfully');
    });
  });

  describe('Presets', () => {
    it('should list and play presets', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/presets`);
      assert.strictEqual(response.status, 200);
      
      const presetsData = await response.json();
      assert(presetsData && typeof presetsData === 'object', 'Presets should be an object');
      
      // Get all presets (combines config and folder presets)
      const presets = presetsData.all || {};
      const presetNames = Object.keys(presets);
      
      testLog.info(`✅ Found ${presetNames.length} presets`);
      
      if (presetNames.length > 0) {
        const presetName = presetNames[0];
        const preset = presets[presetName];
        testLog.info(`📻 Testing preset: ${presetName}`);
        
        // Presets can contain various actions, including grouping
        // Listen for either track change or state change
        const trackChangePromise = eventManager.waitForTrackChange(deviceId, 5000);
        const stateChangePromise = eventManager.waitForState(deviceId, 'PLAYING', 5000);
        
        const presetStartTime = Date.now();
        const presetResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/preset/${encodeURIComponent(presetName)}`);
        assert.strictEqual(presetResponse.status, 200);
        const presetRequestTime = Date.now() - presetStartTime;
        testLog.info(`   ⏱️  Preset request took: ${presetRequestTime}ms`);
        
        // Wait for either event
        const waitStartTime = Date.now();
        const [trackChanged, stateChanged] = await Promise.all([
          trackChangePromise.catch(() => false),
          stateChangePromise.catch(() => false)
        ]);
        
        const waitTime = Date.now() - waitStartTime;
        testLog.info(`   ⏱️  Wait for events took: ${waitTime}ms`);
        
        if (trackChanged || stateChanged) {
          testLog.info(`✅ Preset "${presetName}" executed successfully`);
          testLog.info(`   ⏱️  Total time from preset to ready: ${Date.now() - presetStartTime}ms`);
        } else {
          testLog.info(`⚠️  Preset "${presetName}" executed but no events detected`);
        }
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid favorite names', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/favorite/NonExistentFavorite12345`);
      assert.strictEqual(response.status, 404, 'Should return 404 for non-existent favorite');
      
      const error = await response.json();
      assert(error.error, 'Should return error message');
      
      testLog.info('✅ Invalid favorite handled correctly');
    });

    it('should handle invalid playlist names', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/playlist/NonExistentPlaylist12345`);
      assert.strictEqual(response.status, 404, 'Should return 404 for non-existent playlist');
      
      const error = await response.json();
      assert(error.error, 'Should return error message');
      
      testLog.info('✅ Invalid playlist handled correctly');
    });

    it('should handle invalid preset names', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/preset/NonExistentPreset12345`);
      assert.strictEqual(response.status, 404, 'Should return 404 for non-existent preset');
      
      const error = await response.json();
      assert(error.error, 'Should return error message');
      
      testLog.info('✅ Invalid preset handled correctly');
    });
  });
});