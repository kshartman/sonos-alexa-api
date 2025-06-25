import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom, SystemTopology } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Apple Music Content Integration Tests', { skip: skipIntegration, timeout: 60000 }, () => {
  let topology: SystemTopology;
  let testRoom: string;
  let deviceId: string;
  let eventManager: EventManager;

  before(async () => {
    console.log('\n🎵 Starting Apple Music Content Integration Tests...\n');
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
    console.log('\n🧹 Cleaning up Apple Music tests...\n');
    
    // Stop playback
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    await eventManager.waitForState(deviceId, 'STOPPED', 5000);
    
    // Stop event bridge
    stopEventBridge();
  });

  describe('Music Search', () => {
    it('should search and play songs', async () => {
      const songQuery = 'track:Yesterday artist:The Beatles';
      
      // Listen for track change when song starts
      const trackChangePromise = eventManager.waitForTrackChange(deviceId, 20000);
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/apple/song/${encodeURIComponent(songQuery)}`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Music search should succeed');
      
      // Wait for track change, then wait for stable playing state
      const trackChanged = await trackChangePromise;
      assert(trackChanged, 'Should receive track change event');
      
      // Wait for stable state (handles TRANSITIONING properly)
      const finalState = await eventManager.waitForStableState(deviceId, 20000);
      assert(finalState === 'PLAYING', `Expected PLAYING state, got ${finalState}`);
      
      // Wait a bit for state to stabilize
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify track info
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      console.log(`   Debug: currentTrack = ${JSON.stringify(state.currentTrack, null, 2)}`);
      assert.strictEqual(state.playbackState, 'PLAYING');
      assert(state.currentTrack, 'Should have current track info');
      assert(state.currentTrack.title, 'Track should have title');
      
      console.log(`✅ Song search played: ${state.currentTrack.title} by ${state.currentTrack.artist || 'Unknown'}`);
    });

    it('should search and play albums', async () => {
      // Stop current playback
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      const albumQuery = 'Abbey Road';
      
      // Listen for track change event
      const trackChangePromise = eventManager.waitForTrackChange(deviceId, 20000);
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/apple/album/${encodeURIComponent(albumQuery)}`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Album search should succeed');
      
      // Wait for track change, then wait for stable playing state
      const trackChanged = await trackChangePromise;
      assert(trackChanged, 'Should receive track change event for album');
      
      // Wait for stable state (handles TRANSITIONING properly)
      const finalState = await eventManager.waitForStableState(deviceId, 20000);
      assert(finalState === 'PLAYING', `Expected PLAYING state, got ${finalState}`);
      
      // Wait a bit for state to stabilize
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify album is playing
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.playbackState, 'PLAYING');
      assert(state.currentTrack?.album, 'Should have album info');
      
      console.log(`✅ Album search played: ${state.currentTrack.album || 'Unknown Album'}`);
    });

    it('should handle music search with no results gracefully', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/apple/song/thisSongDefinitelyDoesNotExist12345xyz`);
      
      // Should return 200 with error status or 404
      assert(response.status === 404 || response.status === 200, 'Should handle invalid queries');
      
      if (response.status === 200) {
        const result = await response.json();
        if (result.status === 'error') {
          console.log('✅ Music search returned error for non-existent song');
        } else {
          console.log('✅ Music search handled non-existent query');
        }
      } else {
        console.log('✅ Music search returned 404 for non-existent song');
      }
    });
  });
});