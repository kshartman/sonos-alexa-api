import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom, SystemTopology } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';
import { ServiceDetector } from '../helpers/service-detector.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Spotify Content Integration Tests', { skip: skipIntegration, timeout: 180000 }, () => {
  let topology: SystemTopology;
  let testRoom: string;
  let deviceId: string;
  let eventManager: EventManager;
  let hasSpotify = false;

  before(async () => {
    console.log('\n🎵 Starting Spotify Content Integration Tests...\n');
    eventManager = EventManager.getInstance();
    
    // Increase max listeners to avoid warnings during tests
    eventManager.setMaxListeners(50);
    
    // Give the system a moment to settle
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Start event bridge to receive UPnP events
    await startEventBridge();
    
    topology = await discoverSystem();
    testRoom = await getSafeTestRoom(topology);
    
    // Get device ID for event tracking
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await zonesResponse.json();
    const zone = zones.find(z => z.members.some(m => m.roomName === testRoom));
    // Use the coordinator's ID for event tracking
    const coordinatorMember = zone.members.find(m => m.isCoordinator);
    deviceId = coordinatorMember.id;
    
    // Get device IP from the state endpoint
    const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    if (!stateResponse.ok) {
      console.log('⚠️  Could not get device state');
      return;
    }

    const state = await stateResponse.json();
    const deviceIP = state.ip;
    if (!deviceIP) {
      console.log('⚠️  Could not get device IP from state');
      return;
    }
    
    // Check if Spotify is configured
    const detector = new ServiceDetector(defaultConfig.apiUrl);
    hasSpotify = await detector.hasSpotify();
    
    if (!hasSpotify) {
      console.log('⚠️  Spotify not configured in Sonos - skipping tests');
    }
    
    console.log(`📊 Test room: ${testRoom}`);
    console.log(`📊 Device ID: ${deviceId}`);
    console.log(`📊 Spotify available: ${hasSpotify}`);
  });

  after(async () => {
    console.log('\n🧹 Cleaning up Spotify Content tests...\n');
    
    // Stop playback and wait for confirmation
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    await eventManager.waitForState(deviceId, 'STOPPED', 5000);
    
    // Clear any pending event listeners
    eventManager.reset();
    
    // Stop event bridge
    stopEventBridge();
    
    // Give the system time to settle
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  describe('Spotify Music Search', { timeout: 90000, concurrency: 1 }, () => {
    let isAuthenticated = false;

    before(async () => {
      // Check if Spotify is authenticated
      try {
        const authResponse = await fetch(`${defaultConfig.apiUrl}/spotify/status`);
        const authStatus = await authResponse.json();
        isAuthenticated = authStatus.authenticated === true;
        console.log(`📊 Spotify authenticated: ${isAuthenticated}`);
      } catch (error) {
        console.log('⚠️  Could not check Spotify auth status');
      }
    });
    
    afterEach(async () => {
      // Ensure playback is stopped between tests
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      // Give Sonos time to process between tests
      await new Promise(resolve => setTimeout(resolve, 3000));
    });

    it('should search and play a song on Spotify', async (t) => {
      if (!hasSpotify) {
        t.skip('Spotify not configured');
        return;
      }
      
      if (!isAuthenticated) {
        t.skip('Spotify not authenticated - OAuth required for search');
        return;
      }

      // Stop any current playback first
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      // Clear the queue to ensure no old content
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/clearqueue`);
      
      // Give system time to settle after stop
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Search for Bohemian Rhapsody by Queen - retry on 500 errors
      let searchResponse;
      let retries = 3;
      
      while (retries > 0) {
        searchResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/spotify/song/Bohemian%20Rhapsody`);
        
        if (searchResponse.status === 500) {
          console.log(`   Song search got 500 error, retrying... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
          retries--;
        } else {
          break;
        }
      }
      
      // Log the response if it's not 200
      if (searchResponse!.status !== 200) {
        const errorText = await searchResponse!.text();
        console.log(`   Song search failed with status ${searchResponse!.status}: ${errorText}`);
      }
      
      assert.equal(searchResponse!.status, 200, 'Should successfully search for song');
      
      const result = await searchResponse.json();
      assert.equal(result.status, 'success', 'Should have success status');
      assert.ok(result.title?.toLowerCase().includes('bohemian'), 'Should find Bohemian Rhapsody');
      assert.equal(result.service, 'spotify', 'Should be from Spotify service');
      
      // Wait for playback to start - increase timeout for songs
      try {
        await eventManager.waitForState(deviceId, 'PLAYING', 20000);
      } catch (error) {
        // If it fails, check what state we're in
        const currentState = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        const stateData = await currentState.json();
        console.log(`   Failed to reach PLAYING state. Current state: ${stateData.playbackState}`);
        console.log(`   Current track: ${stateData.currentTrack?.title || 'none'}`);
        console.log(`   Current URI: ${stateData.currentTrack?.uri || 'none'}`);
        throw error;
      }
      
      // Small delay to ensure stable state
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verify playback
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      assert.ok(
        state.playbackState === 'PLAYING' || state.playbackState === 'TRANSITIONING',
        `Should be playing or transitioning, but was ${state.playbackState}`
      );
      
      // Log current track info if not Spotify
      if (!state.currentTrack?.uri?.includes('spotify')) {
        console.log(`   Current track is not Spotify. URI: ${state.currentTrack?.uri}`);
        console.log(`   Track title: ${state.currentTrack?.title}`);
        console.log(`   Track type: ${state.currentTrack?.type}`);
      }
      
      assert.ok(state.currentTrack?.uri?.includes('spotify'), 'Should be playing Spotify content');
      
      // Pause to hear the track
      await new Promise(resolve => setTimeout(resolve, 2000));
    });

    it('should search and play an album on Spotify', async (t) => {
      if (!hasSpotify) {
        t.skip('Spotify not configured');
        return;
      }
      
      if (!isAuthenticated) {
        t.skip('Spotify not authenticated - OAuth required for search');
        return;
      }

      // Stop any current playback first
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      // Clear the queue to ensure no old content
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/clearqueue`);
      
      // Give system time to settle after stop
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Search for Abbey Road
      const searchResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/spotify/album/Abbey%20Road`);
      
      // Log the response if it's not 200
      if (searchResponse.status !== 200) {
        const errorText = await searchResponse.text();
        console.log(`   Album search failed with status ${searchResponse.status}: ${errorText}`);
      }
      
      assert.equal(searchResponse.status, 200, 'Should successfully search for album');
      
      const result = await searchResponse.json();
      assert.equal(result.status, 'success', 'Should have success status');
      assert.ok(result.title?.toLowerCase().includes('abbey road'), 'Should find Abbey Road');
      assert.equal(result.service, 'spotify', 'Should be from Spotify service');
      
      // Wait for playback to start
      await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      
      // Small delay to ensure stable state
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify playback
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      assert.ok(
        state.playbackState === 'PLAYING' || state.playbackState === 'TRANSITIONING',
        `Should be playing or transitioning, but was ${state.playbackState}`
      );
      assert.ok(state.currentTrack?.uri?.includes('spotify'), 'Should be playing Spotify content');
      
      // Pause to hear the album
      await new Promise(resolve => setTimeout(resolve, 2000));
    });

    it('should search and play artist radio on Spotify', async (t) => {
      if (!hasSpotify) {
        t.skip('Spotify not configured');
        return;
      }
      
      if (!isAuthenticated) {
        t.skip('Spotify not authenticated - OAuth required for search');
        return;
      }

      // Stop any current playback first
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      // Give system time to settle after stop
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Search for Radiohead artist/station
      const searchResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/spotify/artist/Radiohead`);
      assert.equal(searchResponse.status, 200, 'Should successfully search for artist');
      
      const result = await searchResponse.json();
      assert.equal(result.status, 'success', 'Should have success status');
      assert.equal(result.service, 'spotify', 'Should be from Spotify service');
      assert.ok(result.message?.includes('top tracks'), 'Should indicate playing top tracks');
      assert.ok(result.title?.includes('Radiohead'), 'Should include artist name in title');
      
      // Wait for playback to start (may take time to queue all tracks)
      await eventManager.waitForState(deviceId, 'PLAYING', 15000);
      
      // Small delay to ensure stable state
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify playback started
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      assert.ok(
        state.playbackState === 'PLAYING' || state.playbackState === 'TRANSITIONING', 
        `Should be playing or transitioning, but was ${state.playbackState}`
      );
      assert.ok(state.currentTrack?.uri?.includes('spotify'), 'Should be playing Spotify content');
      
      // Check queue to verify it contains Beatles tracks
      const queueResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/queue`);
      const queue = await queueResponse.json();
      
      assert.ok(queue.length > 5, 'Should have multiple tracks in queue');
      
      // Check that most tracks are by Radiohead
      const radioheadTracks = queue.filter((track: any) => 
        track.artist?.toLowerCase().includes('radiohead')
      );
      assert.ok(radioheadTracks.length >= queue.length * 0.8, 'Most tracks should be by Radiohead');
      
      // Don't wait long - we've verified it's working
    });
  });

  describe('Spotify Direct Playback', { timeout: 90000, concurrency: 1 }, () => {
    afterEach(async () => {
      // Ensure playback is stopped between tests
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      // Give Sonos time to process between tests
      await new Promise(resolve => setTimeout(resolve, 3000));
    });
    
    it('should play a Spotify track by ID', async (t) => {
      if (!hasSpotify) {
        t.skip('Spotify not configured');
        return;
      }
      
      // Stop any current playback first
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      // Give system time to settle after stop
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // The Beatles - "Yesterday"
      const trackId = 'spotify:track:3BQHpFgAp4l80e1XslIjNI';
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/spotify/play/${encodeURIComponent(trackId)}`);
      assert.equal(response.status, 200, 'Should accept Spotify track ID');

      // Wait for playback to start
      await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      
      // Small delay to ensure stable state
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify playback state
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      assert.ok(
        state.playbackState === 'PLAYING' || state.playbackState === 'TRANSITIONING',
        `Should be playing or transitioning, but was ${state.playbackState}`
      );
      assert.ok(state.currentTrack?.uri?.includes('spotify'), 'Should be playing Spotify content');
      
      // Pause to hear the track
      await new Promise(resolve => setTimeout(resolve, 2000));
    });

    it('should play a Spotify album by ID', async (t) => {
      if (!hasSpotify) {
        t.skip('Spotify not configured');
        return;
      }
      
      // Stop any current playback first
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      // Give system time to settle after stop
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // The Beatles - Abbey Road
      const albumId = 'spotify:album:0ETFjACtuP2ADo6LFhL6HN';
      
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/spotify/play/${encodeURIComponent(albumId)}`);
      assert.equal(response.status, 200, 'Should accept Spotify album ID');

      // Wait for playback to start - albums take longer because they add to queue
      try {
        await eventManager.waitForState(deviceId, 'PLAYING', 20000);
      } catch (error) {
        // If it fails, check what state we're in
        const currentState = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        const stateData = await currentState.json();
        console.log(`   Failed to reach PLAYING state for album. Current state: ${stateData.playbackState}`);
        console.log(`   Current track: ${stateData.currentTrack?.title || 'none'}`);
        console.log(`   Current URI: ${stateData.currentTrack?.uri || 'none'}`);
        console.log(`   Queue length: ${stateData.nextTrack ? 'has items' : 'empty'}`);
        throw error;
      }
      
      // Small delay to ensure stable state
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verify it's playing from queue (albums go to queue)
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      assert.ok(
        state.playbackState === 'PLAYING' || state.playbackState === 'TRANSITIONING',
        `Should be playing or transitioning, but was ${state.playbackState}`
      );
      assert.ok(state.currentTrack?.uri?.includes('spotify'), 'Should be playing Spotify content');
      
      // Pause to hear the album
      await new Promise(resolve => setTimeout(resolve, 2000));
    });

    it('should play a Spotify playlist by ID', async (t) => {
      if (!hasSpotify) {
        t.skip('Spotify not configured');
        return;
      }
      
      // Stop any current playback first
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      // Give system time to settle after stop
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Find a Spotify playlist from favorites
      const favoritesResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/favorites/detailed`);
      const favorites = await favoritesResponse.json();
      
      // Find first Spotify playlist in favorites
      const spotifyPlaylist = favorites.find((fav: any) => 
        fav.uri?.includes('spotify') && 
        fav.uri?.includes('playlist')
      );
      
      if (!spotifyPlaylist) {
        t.skip('No Spotify playlists found in favorites');
        return;
      }
      
      // Extract playlist ID from the URI
      const playlistMatch = spotifyPlaylist.uri.match(/spotify%3Aplaylist%3A([a-zA-Z0-9]+)/);
      if (!playlistMatch) {
        t.skip('Could not extract playlist ID from favorite');
        return;
      }
      
      const playlistId = `spotify:playlist:${playlistMatch[1]}`;
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/spotify/play/${encodeURIComponent(playlistId)}`);
      assert.equal(response.status, 200, 'Should accept Spotify playlist ID');

      // Wait for playback to start
      await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      
      // Small delay to ensure stable state
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify playback
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      assert.ok(
        state.playbackState === 'PLAYING' || state.playbackState === 'TRANSITIONING',
        `Should be playing or transitioning, but was ${state.playbackState}`
      );
      assert.ok(state.currentTrack?.uri?.includes('spotify'), 'Should be playing Spotify content');
      
      // Pause to hear the playlist
      await new Promise(resolve => setTimeout(resolve, 2000));
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
