import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom, SystemTopology } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';
import { ServiceDetector } from '../helpers/service-detector.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Spotify Content Integration Tests', { skip: skipIntegration, timeout: 60000 }, () => {
  let topology: SystemTopology;
  let testRoom: string;
  let deviceId: string;
  let eventManager: EventManager;
  let hasSpotify = false;

  before(async () => {
    console.log('\n🎵 Starting Spotify Content Integration Tests...\n');
    eventManager = EventManager.getInstance();
    
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
  });

  describe('Spotify Direct Playback', () => {
    it('should play a Spotify track by ID', async (t) => {
      if (!hasSpotify) {
        t.skip('Spotify not configured');
        return;
      }
      
      // The Beatles - "Yesterday"
      const trackId = 'spotify:track:3BQHpFgAp4l80e1XslIjNI';
      
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/spotify/play/${encodeURIComponent(trackId)}`);
      assert.equal(response.status, 200, 'Should accept Spotify track ID');

      // Small delay to let the command process
      await new Promise(resolve => setTimeout(resolve, 500));

      // Wait for playback to start
      try {
        await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      } catch (error) {
        // If it fails, check what state we're in
        const currentState = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        const stateData = await currentState.json();
        console.log(`   Failed to reach PLAYING state. Current state: ${stateData.playbackState}`);
        console.log(`   Current track URI: ${stateData.currentTrack?.uri}`);
        throw error;
      }
      
      // Verify playback state
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      assert.equal(state.playbackState, 'PLAYING', 'Should be playing');
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
      
      // The Beatles - Abbey Road
      const albumId = 'spotify:album:0ETFjACtuP2ADo6LFhL6HN';
      
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/spotify/play/${encodeURIComponent(albumId)}`);
      assert.equal(response.status, 200, 'Should accept Spotify album ID');

      // Wait for playback to start
      await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      
      // Verify it's playing from queue (albums go to queue)
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      assert.equal(state.playbackState, 'PLAYING', 'Should be playing');
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
      
      // Verify playback
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      assert.equal(state.playbackState, 'PLAYING', 'Should be playing');
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
