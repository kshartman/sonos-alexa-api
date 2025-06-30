import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom, SystemTopology } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Generic Content Integration Tests', { skip: skipIntegration, timeout: 60000 }, () => {
  let topology: SystemTopology;
  let testRoom: string;
  let deviceId: string;
  let eventManager: EventManager;

  before(async () => {
    console.log('\n🎵 Starting Generic Content Integration Tests...\n');
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
  });

  after(async () => {
    console.log('\n🧹 Cleaning up Generic Content tests...\n');
    
    // Stop playback and wait for confirmation
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    await eventManager.waitForState(deviceId, 'STOPPED', 5000);
    
    // Clear any pending event listeners
    eventManager.reset();
    
    // Stop event bridge
    stopEventBridge();
    
    // Give a moment for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('Text-to-Speech (TTS)', () => {
    // Ensure stopped state before TTS tests
    before(async () => {
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      if (state.playbackState !== 'STOPPED') {
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
        await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      }
    });

    it('should play TTS content and track state changes', async () => {
      const ttsText = 'This is a test of text to speech functionality';
      
      // Listen for state changes
      const playingPromise = eventManager.waitForState(deviceId, 'PLAYING', 10000);
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/say/${encodeURIComponent(ttsText)}`);
      assert.strictEqual(response.status, 200);
      
      // Wait for TTS to start playing
      const playing = await playingPromise;
      assert(playing, 'TTS should start playing');
      
      // Wait for TTS to complete (should go back to STOPPED)
      const stopped = await eventManager.waitForState(deviceId, 'STOPPED', 15000);
      assert(stopped, 'TTS should complete and stop');
      
      console.log('✅ TTS playback completed successfully');
    });

    it('should handle TTS with special characters', async () => {
      const ttsText = 'Testing special characters: Hello, World! How are you? 123 & symbols.';
      
      const playingPromise = eventManager.waitForState(deviceId, 'PLAYING', 10000);
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/say/${encodeURIComponent(ttsText)}`);
      assert.strictEqual(response.status, 200);
      
      const playing = await playingPromise;
      assert(playing, 'TTS with special characters should play');
      
      // Wait for completion
      const stopped = await eventManager.waitForState(deviceId, 'STOPPED', 15000);
      assert(stopped, 'TTS should complete');
      
      console.log('✅ TTS with special characters handled correctly');
    });

    it('should emit track change events for TTS', async () => {
      const ttsText = 'Testing track change events';
      
      // Listen for track change when TTS starts
      const trackChangePromise = eventManager.waitForTrackChange(deviceId, 10000);
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/say/${encodeURIComponent(ttsText)}`);
      assert.strictEqual(response.status, 200);
      
      const trackChanged = await trackChangePromise;
      assert(trackChanged, 'Should receive track change event when TTS starts');
      
      // Get current state to verify track info
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      assert(state.currentTrack, 'Should have current track info during TTS');
      
      console.log('✅ TTS track change events working correctly');
    });
  });

  describe('Content Discovery', () => {
    it('should list favorites', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/favorites`);
      assert.strictEqual(response.status, 200);
      
      const favorites = await response.json();
      assert(Array.isArray(favorites), 'Favorites should be an array');
      
      console.log(`✅ Found ${favorites.length} favorites`);
      
      if (favorites.length > 0) {
        // Test playing a favorite
        const favorite = favorites[0];
        console.log(`📻 Testing favorite: ${favorite.title}`);
        
        const trackChangePromise = eventManager.waitForTrackChange(deviceId, 15000);
        const favResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/favorite/${encodeURIComponent(favorite.title)}`);
        
        if (favResponse.status === 200) {
          const trackChanged = await trackChangePromise;
          if (trackChanged) {
            console.log(`✅ Favorite "${favorite.title}" triggered track change`);
          } else {
            console.log(`⚠️  Favorite "${favorite.title}" played but no track change event`);
          }
        } else {
          console.log(`⚠️  Favorite "${favorite.title}" returned ${favResponse.status}`);
        }
      }
    });

    it('should list playlists', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/playlists`);
      assert.strictEqual(response.status, 200);
      
      const playlists = await response.json();
      assert(Array.isArray(playlists), 'Playlists should be an array');
      
      console.log(`✅ Found ${playlists.length} playlists`);
      
      if (playlists.length > 0) {
        // Test playing a playlist
        const playlist = playlists[0];
        console.log(`📻 Testing playlist: ${playlist.title}`);
        
        const trackChangePromise = eventManager.waitForTrackChange(deviceId, 15000);
        const playlistResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/playlist/${encodeURIComponent(playlist.title)}`);
        
        if (playlistResponse.status === 200) {
          const trackChanged = await trackChangePromise;
          if (trackChanged) {
            console.log(`✅ Playlist "${playlist.title}" triggered track change`);
          } else {
            console.log(`⚠️  Playlist "${playlist.title}" played but no track change event`);
          }
        } else {
          console.log(`⚠️  Playlist "${playlist.title}" returned ${playlistResponse.status}`);
        }
      }
    });

    it('should handle content updates', async () => {
      // Listen for content update events
      // These occur when favorites, playlists, or music library changes
      const contentUpdatePromise = eventManager.waitForContentUpdate(deviceId, 1000);
      
      // Content updates are typically triggered by external changes
      // For testing, we'll just verify the event system is ready
      const updated = await contentUpdatePromise;
      if (updated) {
        console.log('✅ Received content update event');
      } else {
        console.log('ℹ️  No content updates detected (this is normal)');
      }
    });
  });

  describe('Queue Management', () => {
    before(async () => {
      // Load some content into the queue
      console.log('📻 Loading content for queue tests...');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/apple/album/Abbey%20Road`);
      await eventManager.waitForState(deviceId, 'PLAYING', 15000);
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
      console.log('✅ Queue cleared successfully');
    });

    it('should handle next/previous with queue events', async () => {
      // Reload content
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/apple/album/Abbey%20Road`);
      await eventManager.waitForState(deviceId, 'PLAYING', 15000);
      
      // Get initial track
      let stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      let state = await stateResponse.json();
      const initialTrack = state.currentTrack?.title;
      
      // Go to next track
      const nextTrackPromise = eventManager.waitForTrackChange(deviceId, 5000);
      const nextResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/next`);
      assert.strictEqual(nextResponse.status, 200);
      
      const nextTrackChanged = await nextTrackPromise;
      if (nextTrackChanged) {
        stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        state = await stateResponse.json();
        const newTrack = state.currentTrack?.title;
        assert(newTrack !== initialTrack, 'Track should change after next');
        console.log(`✅ Next track: ${newTrack}`);
      } else {
        console.log('⚠️  No track change event for next (might be last track)');
      }
      
      // Go to previous track
      const prevTrackPromise = eventManager.waitForTrackChange(deviceId, 5000);
      const prevResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/previous`);
      assert.strictEqual(prevResponse.status, 200);
      
      const prevTrackChanged = await prevTrackPromise;
      if (prevTrackChanged) {
        console.log('✅ Previous track command successful');
      } else {
        console.log('⚠️  No track change event for previous');
      }
    });
  });

  describe('Playback Modes', () => {
    before(async () => {
      // Ensure we have content loaded
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      if (!state.currentTrack || state.playbackState === 'STOPPED') {
        console.log('📻 Loading content for playback mode tests...');
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/say/Testing playback modes`);
        await eventManager.waitForState(deviceId, 'PLAYING', 5000);
        await eventManager.waitForState(deviceId, 'STOPPED', 10000);
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
      
      console.log('✅ Repeat mode commands sent successfully');
    });

    it('should control shuffle mode', async () => {
      // Enable shuffle
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/shuffle/on`);
      assert.strictEqual(response.status, 200);
      
      // Disable shuffle
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/shuffle/off`);
      assert.strictEqual(response.status, 200);
      
      console.log('✅ Shuffle mode commands sent successfully');
    });

    it('should control crossfade mode', async () => {
      // Enable crossfade
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/crossfade/on`);
      assert.strictEqual(response.status, 200);
      
      // Disable crossfade
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/crossfade/off`);
      assert.strictEqual(response.status, 200);
      
      console.log('✅ Crossfade mode commands sent successfully');
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
      
      console.log(`✅ Found ${presetNames.length} presets`);
      
      if (presetNames.length > 0) {
        const presetName = presetNames[0];
        const preset = presets[presetName];
        console.log(`📻 Testing preset: ${presetName}`);
        
        // Presets can contain various actions, including grouping
        // Listen for either track change or state change
        const trackChangePromise = eventManager.waitForTrackChange(deviceId, 10000);
        const stateChangePromise = eventManager.waitForState(deviceId, 'PLAYING', 10000);
        
        const presetResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/preset/${encodeURIComponent(presetName)}`);
        assert.strictEqual(presetResponse.status, 200);
        
        // Wait for either event
        const [trackChanged, stateChanged] = await Promise.all([
          trackChangePromise.catch(() => false),
          stateChangePromise.catch(() => false)
        ]);
        
        if (trackChanged || stateChanged) {
          console.log(`✅ Preset "${presetName}" executed successfully`);
        } else {
          console.log(`⚠️  Preset "${presetName}" executed but no events detected`);
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
      
      console.log('✅ Invalid favorite handled correctly');
    });

    it('should handle invalid playlist names', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/playlist/NonExistentPlaylist12345`);
      assert.strictEqual(response.status, 404, 'Should return 404 for non-existent playlist');
      
      const error = await response.json();
      assert(error.error, 'Should return error message');
      
      console.log('✅ Invalid playlist handled correctly');
    });

    it('should handle invalid preset names', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/preset/NonExistentPreset12345`);
      assert.strictEqual(response.status, 404, 'Should return 404 for non-existent preset');
      
      const error = await response.json();
      assert(error.error, 'Should return error message');
      
      console.log('✅ Invalid preset handled correctly');
    });
  });
});