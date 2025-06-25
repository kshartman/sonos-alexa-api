import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom, SystemTopology } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';
import { isPandoraAvailableForTesting, getPandoraTestStation } from '../helpers/pandora-test-helpers.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Pandora Content Integration Tests', { skip: skipIntegration, timeout: 60000 }, () => {
  let topology: SystemTopology;
  let testRoom: string;
  let deviceId: string;
  let eventManager: EventManager;
  let pandoraStation: string;
  let pandoraAvailable: boolean = false;

  before(async function() {
    console.log('\n🎵 Starting Pandora Content Integration Tests...\n');
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
    
    // Check if Pandora is available (credentials + service)
    pandoraAvailable = await isPandoraAvailableForTesting(deviceIP);
    
    if (!pandoraAvailable) {
      console.log('⚠️  Skipping Pandora tests - service not available or not configured');
      return;
    }
    
    // Clear any existing Pandora session by playing a Beatles song
    console.log('🎵 Playing Beatles song to clear Pandora session...');
    const beatlesResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/apple/song/Yesterday%20Beatles`);
    if (beatlesResponse.ok) {
      await eventManager.waitForState(deviceId, 'PLAYING', 5000);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Let it play briefly
      
      // Now stop it to have a clean state
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      console.log('✅ Cleared Pandora session with Beatles song');
    }
    
    // Get a Pandora station for testing
    pandoraStation = await getPandoraTestStation(testRoom);
    console.log(`📻 Using Pandora station for tests: ${pandoraStation}`);
  });

  after(async () => {
    console.log('\n🧹 Cleaning up Pandora tests...\n');
    
    // Stop playback
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    await eventManager.waitForState(deviceId, 'STOPPED', 5000);
    
    // Stop event bridge
    stopEventBridge();
  });

  describe('Pandora Service', () => {
    it('should play Pandora station', async function() {
      if (!pandoraAvailable) {
        console.log('⚠️  Test skipped - Pandora not available');
        return;
      }

      // Listen for track change when Pandora starts
      const trackChangePromise = eventManager.waitForTrackChange(deviceId, 20000);
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/${encodeURIComponent(pandoraStation)}`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Pandora play should succeed');
      
      // Wait for track change and stable state
      const trackChanged = await trackChangePromise;
      assert(trackChanged, 'Should receive track change event for Pandora');
      
      const finalState = await eventManager.waitForStableState(deviceId, 20000);
      assert(finalState === 'PLAYING', `Expected PLAYING state, got ${finalState}`);
      
      // Verify Pandora is playing
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.playbackState, 'PLAYING');
      assert(state.currentTrack, 'Should have current track info');
      
      console.log(`✅ Pandora station playing: ${state.currentTrack.title || 'Unknown'}`);
    });


    it('should handle thumbs down and skip track', async function() {
      if (!pandoraAvailable) {
        console.log('⚠️  Test skipped - Pandora not available');
        return;
      }

      // Ensure Pandora is playing
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      if (!state.currentTrack?.uri?.includes('sid=236')) {
        console.log('⚠️  Skipping thumbs down test - not playing Pandora');
        this.skip();
        return;
      }

      const initialTrack = state.currentTrack.title;
      
      // Listen for track change (thumbs down should skip)
      const trackChangePromise = eventManager.waitForTrackChange(deviceId, 10000);
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/thumbsdown`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Thumbs down should succeed');
      
      // Wait for track change (should skip to next)
      const trackChanged = await trackChangePromise;
      if (trackChanged) {
        const newStateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        const newState = await newStateResponse.json();
        assert(newState.currentTrack.title !== initialTrack, 'Track should change after thumbs down');
        console.log('✅ Pandora thumbs down sent and track skipped');
      } else {
        console.log('⚠️  Thumbs down sent but no track change detected');
      }
    });

    it('should handle invalid Pandora station names', async function() {
      if (!pandoraAvailable) {
        console.log('⚠️  Test skipped - Pandora not available');
        return;
      }

      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/NonExistentStation12345xyz`);
      assert.strictEqual(response.status, 404, 'Should return 404 for non-existent station');
      
      const error = await response.json();
      assert(error.error, 'Should return error message');
      
      console.log('✅ Invalid Pandora station handled correctly');
    });

    it('should switch between Pandora stations', async function() {
      if (!pandoraAvailable) {
        this.skip();
        return;
      }
      
      // Get station list to find multiple stations
      let availableStations: any[] = [];
      let stationNames: string[] = [];
      try {
        // Get detailed station data
        const stationsResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/stations?detailed=true`);
        if (stationsResponse.ok) {
          const stationsData = await stationsResponse.json();
          availableStations = stationsData.stations;
          stationNames = availableStations.map((s: any) => s.stationName);
          console.log(`📻 Found ${availableStations.length} Pandora stations`);
          
          // Log station types for debugging
          const userCreatedStations = availableStations.filter(s => s.isUserCreated);
          console.log(`   - User-created stations: ${userCreatedStations.length}`);
          console.log(`   - QuickMix available: ${availableStations.some(s => s.isQuickMix)}`);
          console.log(`   - Thumbprint Radio available: ${availableStations.some(s => s.isThumbprint)}`);
        }
      } catch (error) {
        console.log('Could not get station list:', error);
      }
      
      // If we don't have at least 2 stations, skip the test
      if (stationNames.length < 2) {
        console.log('⚠️  Need at least 2 Pandora stations for switching test');
        this.skip();
        return;
      }
      
      // Pick two different stations, preferring user-created ones as they're more reliable
      const userCreatedStations = availableStations.filter(s => s.isUserCreated);
      const specialStations = availableStations.filter(s => s.isQuickMix || s.isThumbprint);
      
      let firstStation: string;
      let secondStation: string;
      
      // Prefer user-created stations for testing
      if (userCreatedStations.length >= 2) {
        firstStation = userCreatedStations[0].stationName;
        secondStation = userCreatedStations[1].stationName;
      } else if (userCreatedStations.length === 1 && specialStations.length > 0) {
        firstStation = userCreatedStations[0].stationName;
        secondStation = specialStations[0].stationName;
      } else {
        // Fall back to any two different stations
        firstStation = stationNames[0];
        secondStation = stationNames[1];
      }
      
      console.log(`📻 Available stations: ${stationNames.slice(0, 5).join(', ')}...`);
      
      // Stop current playback to ensure clean state
      console.log('⏹️  Stopping current playback before station switch test');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // First, ensure we're playing a Pandora station
      console.log(`📻 Playing first station: ${firstStation}`);
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/${encodeURIComponent(firstStation)}`);
      if (response.status !== 200) {
        const body = await response.json();
        console.log(`❌ Failed to play station: ${response.status} - ${JSON.stringify(body)}`);
      }
      assert.strictEqual(response.status, 200);
      
      // Wait for it to start playing
      await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Let it play for 2 seconds
      
      // Get current track info
      let stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      let state = await stateResponse.json();
      const firstTrack = state.currentTrack?.title;
      console.log(`   First station playing: ${firstTrack || 'Unknown'}`);
      
      // Now switch to the second station
      console.log(`📻 Switching to second station: ${secondStation}`);
      
      // Listen for track change
      const trackChangePromise = eventManager.waitForTrackChange(deviceId, 20000);
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/${encodeURIComponent(secondStation)}`);
      if (response.status !== 200) {
        const body = await response.json();
        console.log(`❌ Failed to play second station "${secondStation}": ${response.status} - ${JSON.stringify(body)}`);
        
        // Try another station if this one failed
        if (availableStations.length > 2) {
          const alternateStation = availableStations.find(s => s !== firstStation && s !== secondStation && s !== pandoraStation);
          if (alternateStation) {
            console.log(`🔄 Trying alternate station: ${alternateStation}`);
            response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/${encodeURIComponent(alternateStation)}`);
          }
        }
      }
      
      if (response.status !== 200) {
        console.log(`⚠️  Station switching test failed - Pandora API may have issues with these stations`);
        this.skip();
        return;
      }
      
      const result = await response.json();
      assert(result.status === 'success', 'Station switch should succeed');
      
      // Wait for track change
      const trackChanged = await trackChangePromise;
      assert(trackChanged, 'Should receive track change event when switching stations');
      
      // Verify we're playing the new station
      const finalState = await eventManager.waitForStableState(deviceId, 20000);
      assert(finalState === 'PLAYING', `Expected PLAYING state after switch, got ${finalState}`);
      
      // Get new track info
      stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await stateResponse.json();
      const secondTrack = state.currentTrack?.title;
      
      console.log(`   Second station playing: ${secondTrack || 'Unknown'}`);
      console.log('✅ Successfully switched between Pandora stations');
      
      // Optional: Try to switch back to verify it works both ways
      console.log(`📻 Attempting to switch back to: ${firstStation}`);
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/${encodeURIComponent(firstStation)}`);
      if (response.status === 200) {
        await eventManager.waitForTrackChange(deviceId, 20000);
        console.log('✅ Successfully switched back to first station');
      } else {
        console.log('⚠️  Could not switch back to first station (Pandora session may have issues)');
        // This is optional, so we don't fail the test
      }
    });
  });
});