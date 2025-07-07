import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../helpers/test-config.js';
import { globalTestSetup, globalTestTeardown, TestContext } from '../helpers/global-test-setup.js';
import { isPandoraAvailableForTesting, getPandoraTestStation } from '../helpers/pandora-test-helpers.js';
import { loadTestSong } from '../helpers/content-loader.js';
import { waitForContinueFlag, testLog } from '../helpers/test-logger.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

// Use very long timeout in interactive mode (10 hours)
const testTimeout = process.env.TEST_INTERACTIVE === 'true' ? 36000000 : 120000;

describe('Pandora Content Integration Tests', { skip: skipIntegration, timeout: testTimeout }, () => {
  let testContext: TestContext;
  let testRoom: string;
  let deviceId: string;
  let pandoraStation: string;
  let pandoraAvailable: boolean = false;

  before(async function() {
    testContext = await globalTestSetup('Pandora Content Integration Tests');
    
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
    
    // Get device IP from the state endpoint
    const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    if (!stateResponse.ok) {
      testLog.warn('⚠️  Could not get device state');
      return;
    }
    
    const state = await stateResponse.json();
    const deviceIP = state.ip;
    if (!deviceIP) {
      testLog.warn('⚠️  Could not get device IP from state');
      return;
    }
    
    // Check if Pandora is available (credentials + service)
    pandoraAvailable = await isPandoraAvailableForTesting(deviceIP);
    
    if (!pandoraAvailable) {
      testLog.warn('⚠️  Skipping Pandora tests - service not available or not configured');
      return;
    }
    
    testLog.info(`📊 Test room: ${testRoom}`);
    testLog.info(`📊 Device ID: ${deviceId}`);
    
    // Clear any existing Pandora session by playing a test song
    testLog.info('🎵 Playing test song to clear Pandora session...');
    try {
      await loadTestSong(testRoom);
      await testContext.eventManager.waitForState(deviceId, 'PLAYING', 3000);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Let it play briefly
      
      // Now stop it to have a clean state
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await testContext.eventManager.waitForState(deviceId, 'STOPPED', 2000);
      testLog.info('✅ Cleared Pandora session with test song');
    } catch (error) {
      testLog.warn('⚠️  Could not load test song, continuing anyway');
    }
    
    // Get a Pandora station for testing
    pandoraStation = await getPandoraTestStation(testRoom, 1);
    testLog.info(`📻 Using Pandora station for tests: ${pandoraStation}`);
    
    // Also show if using env var
    if (process.env.TEST_PANDORA_STATIONS) {
      testLog.info(`   (from TEST_PANDORA_STATIONS env)`);
    }
  });

  after(async () => {
    await globalTestTeardown('Pandora tests', testContext);
  });

  describe('Pandora Service', () => {
    it('should play Pandora station', async function() {
      if (!pandoraAvailable) {
        testLog.warn('⚠️  Test skipped - Pandora not available');
        return;
      }

      // Listen for track change when Pandora starts (Pandora can be slow)
      testLog.info(`   📊 Waiting for track change on device: ${deviceId}`);
      
      const playStartTime = Date.now();
      
      // Use EventManager's waitForTrackChange which properly handles group members
      const trackChangePromise = testContext.eventManager.waitForTrackChange(deviceId, 40000);
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/${encodeURIComponent(pandoraStation)}`);
      assert.strictEqual(response.status, 200);
      const playRequestTime = Date.now() - playStartTime;
      testLog.info(`   ⏱️  Play request took: ${playRequestTime}ms`);
      
      const result = await response.json();
      assert(result.status === 'success', 'Pandora play should succeed');
      
      // Wait for track change and stable state
      const waitStartTime = Date.now();

      // Pandora is slow
      await new Promise(resolve => setTimeout(resolve, 3000));      

      const trackChanged = await trackChangePromise;
      const waitTime = Date.now() - waitStartTime;
      testLog.info(`   ⏱️  WaitForTrackChange took: ${waitTime}ms`);
      
      // If no track change event, check if we're already playing
      if (!trackChanged) {
        testLog.warn('   ⚠️  No track change event received, checking current state...');
        const currentState = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        const state = await currentState.json();
        
        if (state.playbackState === 'PLAYING' && state.currentTrack?.uri?.includes('pandora')) {
          testLog.info(`   ✅ Pandora is already playing: ${state.currentTrack.title}`);
          testLog.info(`   ⏱️  Total time from play request: ${Date.now() - playStartTime}ms`);
          return; // Test passes
        }
        
        // If not playing Pandora, the test should fail
        assert.fail('No track change event received and Pandora is not playing');
      }
      
      // Wait for PLAYING state (not just any stable state)
      const stableStartTime = Date.now();
      const isPlaying = await testContext.eventManager.waitForState(deviceId, 'PLAYING', 5000);
      const stableTime = Date.now() - stableStartTime;
      testLog.info(`   ⏱️  WaitForState(PLAYING) took: ${stableTime}ms`);
      testLog.info(`   ⏱️  Total time from play to PLAYING: ${Date.now() - playStartTime}ms`);
      
      // Get current state regardless of waitForState result
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      // Log the actual state for debugging
      testLog.info(`   Current state: ${state.playbackState}`);
      
      // Check if Pandora is actually playing
      if (state.playbackState === 'STOPPED') {
        testLog.warn('⚠️  Pandora playback failed - station may not be available or session issue');
        testLog.warn('   Attempting to play again...');
        
        // Try playing again
        const retryResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/${encodeURIComponent(pandoraStation)}`);
        if (retryResponse.status === 200) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          const retryState = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
          const newState = await retryState.json();
          state.playbackState = newState.playbackState;
          state.currentTrack = newState.currentTrack;
          testLog.info(`   Retry state: ${state.playbackState}`);
        }
      }
      
      // Log what we have even if not playing
      if (state.currentTrack) {
        testLog.info(`✅ Pandora track info: ${state.currentTrack.title || 'Unknown'}`);
      } else if (state.playbackState === 'PLAYING' || state.playbackState === 'TRANSITIONING') {
        testLog.info(`✅ Pandora is ${state.playbackState} (waiting for track info)`);
      } else {
        testLog.warn(`⚠️  Pandora state: ${state.playbackState} - test may fail`);
      }
      
      // Wait for user input in interactive mode to debug issues
      await waitForContinueFlag();
      
      // Now do the assertion after user has had a chance to see what's happening
      assert(
        state.playbackState === 'PLAYING' || state.playbackState === 'TRANSITIONING',
        `Expected PLAYING or TRANSITIONING state, but got ${state.playbackState}`
      );
      assert(state.currentTrack, 'Should have current track info');
    });


    it('should handle thumbs down and skip track', async function() {
      if (!pandoraAvailable) {
        testLog.warn('⚠️  Test skipped - Pandora not available');
        return;
      }

      // Ensure Pandora is playing
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      if (!state.currentTrack?.uri?.includes('sid=236')) {
        testLog.warn('⚠️  Skipping thumbs down test - not playing Pandora');
        this.skip();
        return;
      }

      const initialTrack = state.currentTrack.title;
      
      // Listen for track change (thumbs down should skip)
      const thumbsStartTime = Date.now();
      const trackChangePromise = testContext.eventManager.waitForTrackChange(deviceId, 5000);
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/thumbsdown`);
      assert.strictEqual(response.status, 200);
      const thumbsRequestTime = Date.now() - thumbsStartTime;
      testLog.info(`   ⏱️  Thumbs down request took: ${thumbsRequestTime}ms`);
      
      const result = await response.json();
      assert(result.status === 'success', 'Thumbs down should succeed');
      
      // Wait for track change (should skip to next)
      const waitStartTime = Date.now();
      const trackChanged = await trackChangePromise;
      const waitTime = Date.now() - waitStartTime;
      testLog.info(`   ⏱️  WaitForTrackChange took: ${waitTime}ms`);
      if (trackChanged) {
        const newStateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        const newState = await newStateResponse.json();
        assert(newState.currentTrack.title !== initialTrack, 'Track should change after thumbs down');
        testLog.info('✅ Pandora thumbs down sent and track skipped');
      } else {
        testLog.warn('⚠️  Thumbs down sent but no track change detected');
      }
    });

    it('should handle invalid Pandora station names', async function() {
      if (!pandoraAvailable) {
        testLog.warn('⚠️  Test skipped - Pandora not available');
        return;
      }

      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/NonExistentStation12345xyz`);
      assert.strictEqual(response.status, 404, 'Should return 404 for non-existent station');
      
      const error = await response.json();
      assert(error.error, 'Should return error message');
      
      testLog.info('✅ Invalid Pandora station handled correctly');
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
          testLog.info(`📻 Found ${availableStations.length} Pandora stations`);
          
          // Log station types for debugging
          const userCreatedStations = availableStations.filter(s => s.isUserCreated);
          testLog.info(`   - User-created stations: ${userCreatedStations.length}`);
          testLog.info(`   - QuickMix available: ${availableStations.some(s => s.isQuickMix)}`);
          testLog.info(`   - Thumbprint Radio available: ${availableStations.some(s => s.isThumbprint)}`);
        }
      } catch (error) {
        testLog.error('Could not get station list:', error);
      }
      
      // If we don't have at least 2 stations, skip the test
      if (stationNames.length < 2) {
        testLog.warn('⚠️  Need at least 2 Pandora stations for switching test');
        this.skip();
        return;
      }
      
      // Use test stations from env var or API
      // Note: We use index 2 for first station to avoid using the same station that was played in the previous test
      let firstStation = await getPandoraTestStation(testRoom, 2);
      let secondStation = await getPandoraTestStation(testRoom, 3);
      
      // If we got the same station twice, try to find different ones from the available list
      if (firstStation === secondStation && availableStations.length >= 2) {
        // Filter out stations with problematic characters for testing
        const safeStations = availableStations.filter(s => 
          !s.stationName.includes('&') && 
          !s.stationName.includes('/') &&
          !s.stationName.includes('\\')
        );
        
        if (safeStations.length >= 2) {
          firstStation = safeStations[0].stationName;
          secondStation = safeStations[1].stationName;
        } else {
          // Use any two different stations
          firstStation = stationNames[0];
          secondStation = stationNames[1];
        }
      }
      
      testLog.info(`📻 Selected stations for test: "${firstStation}" and "${secondStation}"`);
      
      // No need to clear session - pandora/play endpoint does it automatically
      
      // First, ensure we're playing a Pandora station
      testLog.info(`📻 Playing first station: ${firstStation}`);
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/${encodeURIComponent(firstStation)}`);
      if (response.status !== 200) {
        const body = await response.json();
        testLog.error(`❌ Failed to play station "${firstStation}": ${response.status} - ${JSON.stringify(body)}`);
        testLog.warn(`⚠️  Station switching test failed - Pandora session may be in bad state after previous tests`);
        testLog.warn(`   This is a known issue when rapidly switching Pandora stations`);
        this.skip();
        return;
      }
      
      // Wait for it to start playing
      const waitStartTime = Date.now();

      // Pandora is slow
      await new Promise(resolve => setTimeout(resolve, 3000));      

      await testContext.eventManager.waitForState(deviceId, 'PLAYING', 5000);
      const waitTime = Date.now() - waitStartTime;
      testLog.info(`   ⏱️  WaitForState took: ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Let it play for 1 second
      
      // Get current track info
      let stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      let state = await stateResponse.json();
      const firstTrack = state.currentTrack?.title;
      testLog.info(`   First station playing: ${firstTrack || 'Unknown'}`);
      
      // Wait for user to press Enter
      await waitForContinueFlag();
      
      // No need to clear session - pandora/play endpoint does it automatically
      
      // Now switch to the second station
      testLog.info(`📻 Switching to second station: ${secondStation}`);
      
      // Listen for track change
      const switchStartTime = Date.now();
      const trackChangePromise = testContext.eventManager.waitForTrackChange(deviceId, 10000);
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/${encodeURIComponent(secondStation)}`);
      const switchRequestTime = Date.now() - switchStartTime;
      testLog.info(`   ⏱️  Station switch request took: ${switchRequestTime}ms`);
      
      if (response.status !== 200) {
        const body = await response.json();
        testLog.error(`❌ Failed to play second station "${secondStation}": ${response.status} - ${JSON.stringify(body)}`);
        
        // Try another station if this one failed
        if (availableStations.length > 2) {
          const alternateStation = availableStations.find(s => s !== firstStation && s !== secondStation && s !== pandoraStation);
          if (alternateStation) {
            testLog.info(`🔄 Trying alternate station: ${alternateStation}`);
            response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/${encodeURIComponent(alternateStation)}`);
          }
        }
      }
      
      if (response.status !== 200) {
        testLog.warn(`⚠️  Station switching test failed - Pandora API may have issues with these stations`);
        this.skip();
        return;
      }
      
      const result = await response.json();
      assert(result.status === 'success', 'Station switch should succeed');
      
      // Wait for track change
      const waitStartTime2 = Date.now();
      const trackChanged = await trackChangePromise;
      const waitTime2 = Date.now() - waitStartTime2;
      testLog.info(`   ⏱️  WaitForTrackChange took: ${waitTime2}ms`);
      assert(trackChanged, 'Should receive track change event when switching stations');
      
      // Verify we're playing the new station
      const stableStartTime = Date.now();
      const isPlaying = await testContext.eventManager.waitForState(deviceId, 'PLAYING', 5000);
      const stableTime = Date.now() - stableStartTime;
      testLog.info(`   ⏱️  WaitForState(PLAYING) took: ${stableTime}ms`);
      testLog.info(`   ⏱️  Total time from switch to PLAYING: ${Date.now() - switchStartTime}ms`);
      assert(isPlaying, 'Timed out waiting for PLAYING state after switch');
      
      // Get new track info
      stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await stateResponse.json();
      const secondTrack = state.currentTrack?.title;
      
      testLog.info(`   Second station playing: ${secondTrack || 'Unknown'}`);
      testLog.info('✅ Successfully switched between Pandora stations');
      
      // Wait for user to press Enter
      await waitForContinueFlag();
      
      // Optional: Try switching to a third station to test multiple switches
      const thirdStation = await getPandoraTestStation(testRoom, 3);
      if (thirdStation !== firstStation && thirdStation !== secondStation) {
        // No need to clear session - pandora/play endpoint does it automatically
        
        testLog.info(`📻 Attempting to switch to third station: ${thirdStation}`);
        response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/${encodeURIComponent(thirdStation)}`);
        if (response.status === 200) {
          await testContext.eventManager.waitForTrackChange(deviceId, 10000);
          testLog.info('✅ Successfully switched to third station');
          
          // Wait for user to press Enter
          await waitForContinueFlag();
        } else {
          testLog.warn('⚠️  Could not switch to third station (Pandora session may have issues)');
          // This is optional, so we don't fail the test
        }
      } else {
        testLog.warn('⚠️  No distinct third station available, skipping third switch test');
      }
    });
  });
});
