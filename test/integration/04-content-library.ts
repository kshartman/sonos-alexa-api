import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom, SystemTopology } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Music Library Content Integration Tests', { skip: skipIntegration, timeout: 60000 }, () => {
  let topology: SystemTopology;
  let testRoom: string;
  let deviceId: string;
  let eventManager: EventManager;
  let libraryAvailable: boolean = false;

  before(async () => {
    console.log('\n🎵 Starting Music Library Content Integration Tests...\n');
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
    
    // Check if music library is available and indexed
    const libraryStatusResponse = await fetch(`${defaultConfig.apiUrl}/library/index`);
    if (libraryStatusResponse.ok) {
      const status = await libraryStatusResponse.json();
      if (status.status === 'not initialized') {
        console.log('📚 Music library not initialized, triggering refresh...');
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
    
    if (!libraryAvailable) {
      console.log('⚠️  Music library not available for testing');
    }
  });

  after(async () => {
    console.log('\n🧹 Cleaning up Music Library tests...\n');
    
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

  describe('Library Status', () => {
    it('should get library indexing status', async function() {
      const response = await fetch(`${defaultConfig.apiUrl}/library/index`);
      assert.strictEqual(response.status, 200);
      
      const status = await response.json();
      
      if (status.status === 'not initialized') {
        console.log('⚠️  Music library not initialized');
        this.skip();
        return;
      }
      
      assert(typeof status.isIndexing === 'boolean', 'Should have indexing status');
      assert(typeof status.progress === 'number', 'Should have progress');
      
      if (status.metadata) {
        assert(typeof status.metadata.totalTracks === 'number', 'Should have track count');
        assert(typeof status.metadata.totalAlbums === 'number', 'Should have album count');
        assert(typeof status.metadata.totalArtists === 'number', 'Should have artist count');
        console.log(`✅ Library status: ${status.metadata.totalTracks} tracks, ${status.metadata.totalAlbums} albums, ${status.metadata.totalArtists} artists`);
      }
    });
  });

  describe('Music Library Search', () => {
    it('should search library by song title', async function() {
      if (!libraryAvailable) {
        console.log('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }

      const songQuery = 'love'; // Common word likely to have results
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/library/song/${encodeURIComponent(songQuery)}`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Library song search should succeed');
      assert(result.service === 'library', 'Service should be library');
      assert(result.title, 'Should have a title');
      assert(result.artist, 'Should have an artist');
      
      console.log(`✅ Found song: "${result.title}" by ${result.artist}`);
      
      // Test playing the found track
      const trackChangePromise = eventManager.waitForTrackChange(deviceId, 20000);
      
      // The search result should have triggered playback
      const trackChanged = await trackChangePromise;
      if (trackChanged) {
        const finalState = await eventManager.waitForStableState(deviceId, 20000);
        assert(finalState === 'PLAYING', `Expected PLAYING state, got ${finalState}`);
        
        const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        const state = await stateResponse.json();
        assert(state.currentTrack, 'Should have current track info');
        console.log(`✅ Playing library track: ${state.currentTrack.title}`);
      }
    });

    it('should search library by artist', async function() {
      if (!libraryAvailable) {
        console.log('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }

      // Stop current playback
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);

      const artistQuery = 'the'; // Common word in many artist names
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/library/artist/${encodeURIComponent(artistQuery)}`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Library artist search should succeed');
      assert(result.service === 'library', 'Service should be library');
      assert(result.artist, 'Should have an artist');
      
      console.log(`✅ Found track by artist: "${result.title}" by ${result.artist}`);
    });

    it('should search library by album', async function() {
      if (!libraryAvailable) {
        console.log('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }

      const albumQuery = 'greatest'; // Common word in compilation albums
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/library/album/${encodeURIComponent(albumQuery)}`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      
      if (result.status === 'error' && result.error === 'No albums found matching "greatest"') {
        console.log('⚠️  No albums found with "greatest" in the title');
        // Try another common album word
        const altResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/library/album/best`);
        if (altResponse.ok) {
          const altResult = await altResponse.json();
          if (altResult.status === 'success') {
            console.log(`✅ Found track from album: "${altResult.title}" from ${altResult.album}`);
            return;
          }
        }
        this.skip();
        return;
      }
      
      assert(result.status === 'success', 'Library album search should succeed');
      assert(result.service === 'library', 'Service should be library');
      assert(result.album, 'Should have an album');
      
      console.log(`✅ Found track from album: "${result.title}" from ${result.album}`);
    });

    it('should handle library search with no results', async function() {
      if (!libraryAvailable) {
        console.log('⚠️  Test skipped - music library not available');
        this.skip();
        return;
      }

      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/library/song/xyzzy12345nonexistent`);
      
      // Should return 404 or error status
      if (response.status === 404) {
        const error = await response.json();
        assert(error.error, 'Should have error message');
        console.log('✅ Library search returned 404 for non-existent song');
      } else if (response.status === 200) {
        const result = await response.json();
        assert(result.status === 'error', 'Should have error status');
        console.log('✅ Library search returned error for non-existent song');
      } else {
        assert.fail(`Unexpected status code: ${response.status}`);
      }
    });

    it('should handle library search when cache is stale', async function() {
      if (!libraryAvailable) {
        console.log('⚠️  Test skipped - music library not available');
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
        
        console.log(`📚 Library cache age: ${ageHours.toFixed(1)} hours`);
        
        // Search should still work even with stale cache
        const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/library/song/music`);
        assert.strictEqual(response.status, 200);
        
        const result = await response.json();
        assert(result.status === 'success', 'Should still search with stale cache');
        console.log('✅ Library search works with potentially stale cache');
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
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const statusResponse = await fetch(`${defaultConfig.apiUrl}/library/index`);
      const status = await statusResponse.json();
      
      // It might already be complete if the library is small or was recently indexed
      if (status.isIndexing) {
        console.log(`✅ Library refresh started, progress: ${status.progress}%`);
      } else if (status.metadata) {
        console.log('✅ Library refresh completed (or was already fresh)');
      }
    });
  });
});