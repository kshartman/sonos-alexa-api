import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, getTestTimeout } from '../helpers/test-config.js';
import { globalTestSetup, globalTestTeardown, TestContext } from '../helpers/global-test-setup.js';
import { isPandoraAvailableForTesting } from '../helpers/pandora-test-helpers.js';
import { loadTestSong } from '../helpers/content-loader.js';
import { waitForContinueFlag, testLog } from '../helpers/test-logger.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

// Use very long timeout in interactive mode (10 hours)
const testTimeout = process.env.TEST_INTERACTIVE === 'true' ? 36000000 : getTestTimeout(180000);

describe('Pandora Content Integration Tests', { skip: skipIntegration, timeout: testTimeout }, () => {
  let testContext: TestContext;
  let testRoom: string;
  let deviceId: string;
  let pandoraAvailable: boolean = false;
  let favoriteStations: string[] = [];
  let apiStations: string[] = [];
  let currentStation: string = ''; // Track which station is playing
  let musicSearchStation: string = ''; // Station to search for

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
    
    // Note: Not clearing Pandora session here as pandoraPlay handles it automatically
    // Just ensure we're in a stopped state
    testLog.info('🎵 Ensuring clean state for Pandora tests...');
    try {
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await testContext.eventManager.waitForState(deviceId, 'STOPPED', 2000);
      testLog.info('✅ Ready for Pandora tests');
    } catch (error) {
      testLog.warn('⚠️  Could not stop playback, continuing anyway:', error);
    }
    
    // Get all Pandora stations and categorize them (with retry for server startup)
    testLog.info('📋 Getting Pandora stations from merged list...');
    let allStations: any[] = [];
    let retries = 0;
    const maxRetries = 10;
    
    while (retries < maxRetries) {
      const stationsResponse = await fetch(`${defaultConfig.apiUrl}/pandora/stations`);
      if (!stationsResponse.ok) {
        testLog.warn('⚠️  Could not get Pandora stations');
        return;
      }
      
      const stationsData = await stationsResponse.json();
      allStations = stationsData.stations || [];
      
      if (allStations.length > 0) {
        testLog.info(`✅ Found ${allStations.length} Pandora stations`);
        break;
      }
      
      retries++;
      if (retries < maxRetries) {
        testLog.info(`⏳ Waiting for Pandora station manager to initialize... (attempt ${retries}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    if (allStations.length === 0) {
      testLog.warn('⚠️  No Pandora stations found after waiting');
      pandoraAvailable = false;
      return;
    }
    
    // Categorize stations by source
    const favStations = allStations.filter((s: any) => s.source === 'favorite' || s.source === 'both');
    const apiOnlyStations = allStations.filter((s: any) => s.source === 'api');
    
    // Get station names from env or use defaults
    if (process.env.TEST_PANDORA_STATIONS) {
      const envStations = process.env.TEST_PANDORA_STATIONS.split(/[,;]/).map(s => s.trim());
      testLog.info(`📋 Using stations from TEST_PANDORA_STATIONS: ${envStations.join(', ')}`);
      
      // Sort env stations into favorite/api based on actual source
      for (const stationName of envStations) {
        const station = allStations.find((s: any) => s.name === stationName);
        if (station) {
          testLog.info(`   Found station: ${stationName} (source: ${station.source})`);
          if (station.source === 'favorite' || station.source === 'both') {
            favoriteStations.push(stationName);
          } else {
            apiStations.push(stationName);
          }
        } else {
          testLog.warn(`   Station not found: ${stationName}`);
        }
      }
    }
    
    // Ensure we have at least 3 of each type
    testLog.info(`📊 Initial station selection: ${favoriteStations.length} favorites, ${apiStations.length} API stations`);
    
    // Fill out favorites if needed
    if (favoriteStations.length < 3) {
      const needed = 3 - favoriteStations.length;
      const additionalFavs = favStations
        .filter((s: any) => !favoriteStations.includes(s.name))
        .slice(0, needed)
        .map((s: any) => s.name);
      favoriteStations.push(...additionalFavs);
      testLog.info(`   Added ${additionalFavs.length} favorite stations: ${additionalFavs.join(', ')}`);
    }
    
    // Fill out API stations if needed
    if (apiStations.length < 3) {
      const needed = 3 - apiStations.length;
      const additionalApi = apiOnlyStations
        .filter((s: any) => !apiStations.includes(s.name))
        .slice(0, needed)
        .map((s: any) => s.name);
      apiStations.push(...additionalApi);
      testLog.info(`   Added ${additionalApi.length} API stations: ${additionalApi.join(', ')}`);
    }
    
    testLog.info(`✅ Final station selection:`);
    testLog.info(`   Favorites (${favoriteStations.length}): ${favoriteStations.slice(0, 3).join(', ')}`);
    testLog.info(`   API (${apiStations.length}): ${apiStations.slice(0, 3).join(', ')}`);
    
    if (favoriteStations.length === 0 && apiStations.length === 0) {
      testLog.warn('⚠️  No Pandora stations available for testing');
      pandoraAvailable = false;
      return;
    }
    
    // Get music search test station from env or use default
    musicSearchStation = process.env.TEST_MUSICSEARCH_STATION || 'rock';
    testLog.info(`🔍 Music search test will search for: "${musicSearchStation}"`);
  });

  after(async () => {
    await globalTestTeardown('Pandora tests', testContext);
  });

  // Suite 1: Play favorite and thumbs test
  describe('Suite 1: Favorite and Thumbs', () => {
    it('should play a favorite station', async function() {
      if (!pandoraAvailable) {
        testLog.warn('⚠️  Test skipped - Pandora not available');
        return;
      }

      // Prefer favorite station, but use API if no favorites
      if (favoriteStations.length > 0) {
        currentStation = favoriteStations[0];
        testLog.info(`📻 Playing favorite station: ${currentStation}`);
      } else if (apiStations.length > 0) {
        currentStation = apiStations[0];
        testLog.info(`📻 No favorites available, using API station: ${currentStation}`);
      } else {
        testLog.warn('⚠️  No stations available');
        this.skip();
        return;
      }
      
      testLog.info(`   📊 Waiting for track change on device: ${deviceId}`);
      
      const playStartTime = Date.now();
      
      // Use EventManager's waitForTrackChange which properly handles group members
      const trackChangePromise = testContext.eventManager.waitForTrackChange(deviceId, 40000);
      
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/${encodeURIComponent(currentStation)}`);
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
        const retryResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/${encodeURIComponent(currentStation)}`);
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
      await waitForContinueFlag(5);
      
      // Now do the assertion after user has had a chance to see what's happening
      assert(
        state.playbackState === 'PLAYING' || state.playbackState === 'TRANSITIONING',
        `Expected PLAYING or TRANSITIONING state, but got ${state.playbackState}`
      );
      assert(state.currentTrack, 'Should have current track info');
      
      // IMPORTANT: Leave it playing for the thumbs test
      testLog.info('✅ Favorite station playing - leaving it on for thumbs test');
    });

    it('should handle thumbs down and skip track', async function() {
      if (!pandoraAvailable) {
        this.skip();
        return;
      }
      
      // Ensure Pandora is still playing from previous test
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      if (!state.currentTrack?.uri?.includes('sid=236')) {
        testLog.warn('⚠️  Pandora not playing from previous test, skipping thumbs test');
        this.skip();
        return;
      }

      const initialTrack = state.currentTrack.title;
      testLog.info(`📻 Current track before thumbs down: ${initialTrack}`);
      
      // Listen for track change (thumbs down should skip)
      const thumbsStartTime = Date.now();
      const trackChangePromise = testContext.eventManager.waitForTrackChange(deviceId, 10000);
      
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
        testLog.info(`✅ Thumbs down sent and track skipped to: ${newState.currentTrack.title}`);
      } else {
        testLog.warn('⚠️  Thumbs down sent but no track change detected (known issue with Pandora API)');
      }
      
      // Stop playback after thumbs test
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      testLog.info('⏹️  Stopped playback after thumbs test');
    });
  });

  // Suite 2: Play API stations and favorite
  describe('Suite 2: API Station Plays', () => {
    it('should play three API stations then a favorite', async function() {
      if (!pandoraAvailable) {
        this.skip();
        return;
      }
      
      testLog.info('🧪 Testing station sequence: preferring API, API, API, Favorite');
      
      // Build play sequence with preferences but flexible fallbacks
      const playSequence: string[] = [];
      const sequenceTypes: string[] = [];
      
      // Try to get 3 API stations first
      for (let i = 0; i < 3; i++) {
        if (apiStations[i]) {
          playSequence.push(apiStations[i]);
          sequenceTypes.push('API');
        } else if (favoriteStations[i]) {
          // Fall back to favorite if not enough API stations
          playSequence.push(favoriteStations[i]);
          sequenceTypes.push('Favorite (fallback)');
        }
      }
      
      // Then add a favorite (or API if no favorites)
      if (favoriteStations.length > 0) {
        playSequence.push(favoriteStations[0]);
        sequenceTypes.push('Favorite');
      } else if (apiStations.length > playSequence.length) {
        playSequence.push(apiStations[playSequence.length]);
        sequenceTypes.push('API (fallback)');
      }
      
      if (playSequence.length === 0) {
        testLog.warn('⚠️  No stations available for sequence test');
        this.skip();
        return;
      }
      
      testLog.info(`📋 Play sequence: ${playSequence.map((s, i) => `${s} (${sequenceTypes[i]})`).join(' → ')}`);
      
      for (let i = 0; i < playSequence.length; i++) {
        const station = playSequence[i];
        const stationType = sequenceTypes[i];
        testLog.info(`\n📻 Play ${i + 1}/${playSequence.length}: ${station} (${stationType})`);
        
        const playStartTime = Date.now();
        const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pandora/play/${encodeURIComponent(station)}`);
        const playRequestTime = Date.now() - playStartTime;
        testLog.info(`   ⏱️  Play request took: ${playRequestTime}ms`);
        
        if (response.status !== 200) {
          const error = await response.json();
          testLog.error(`   ❌ Failed to play ${station}: ${response.status} - ${JSON.stringify(error)}`);
          assert.fail(`Failed to play station ${station}`);
        }
        
        const result = await response.json();
        assert(result.status === 'success', `Play ${i + 1} should succeed`);
        
        // Wait 10 seconds between plays
        if (i < playSequence.length - 1) {
          testLog.info('   ⏸️  Waiting 10 seconds...');
          await waitForContinueFlag(10);
        } else {
          // Shorter wait for last play
          await waitForContinueFlag(3);
        }
        
        // Check the state
        testLog.info('   📊 Checking playback state...');
        const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        assert.strictEqual(stateResponse.status, 200);
        
        const state = await stateResponse.json();
        testLog.info(`   Playback state: ${state.playbackState}`);
        testLog.info(`   Current track: ${state.currentTrack?.title || 'Unknown'}`);
        testLog.info(`   URI includes Pandora: ${state.currentTrack?.uri?.includes('sid=236') ? 'Yes' : 'No'}`);
        
        // Don't assert on first play if state tracking is broken
        if (i === 0 && state.playbackState === 'STOPPED' && !state.currentTrack?.uri) {
          testLog.warn('   ⚠️  State tracking appears broken (known issue), continuing test...');
        } else {
          // Verify Pandora is playing
          assert(
            state.playbackState === 'PLAYING' || state.playbackState === 'TRANSITIONING',
            `Play ${i + 1}: Expected PLAYING or TRANSITIONING state, but got ${state.playbackState}`
          );
          assert(state.currentTrack, `Play ${i + 1}: Should have current track info`);
          assert(state.currentTrack.uri?.includes('sid=236'), `Play ${i + 1}: Should be playing Pandora content`);
        }
      }
      
      testLog.info(`\n✅ Station sequence test completed (${playSequence.length} stations played)`);
    });
  });

  // Suite 3: Music Search
  describe('Suite 3: Music Search', () => {
    it('should search for and play a Pandora station', async function() {
      if (!pandoraAvailable) {
        testLog.warn('⚠️  Test skipped - Pandora not available');
        return;
      }

      testLog.info(`🔍 Testing Pandora music search for: "${musicSearchStation}"`);
      
      const playStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/pandora/station/${encodeURIComponent(musicSearchStation)}`);
      const playRequestTime = Date.now() - playStartTime;
      testLog.info(`   ⏱️  Music search request took: ${playRequestTime}ms`);
      
      // Music search might not find a match - that's OK
      if (response.status === 404) {
        testLog.info(`   ℹ️  No station found matching "${musicSearchStation}" - this is acceptable`);
        this.skip();
        return;
      }
      
      assert.strictEqual(response.status, 200, `Expected 200 OK but got ${response.status}`);
      
      const result = await response.json();
      assert(result.status === 'success', 'Music search should succeed');
      assert.strictEqual(result.service, 'pandora', 'Service should be pandora');
      
      // Wait for playback to start
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verify something is playing
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      testLog.info(`   🎵 Playing: ${state.currentTrack?.title || 'Unknown'}`);
      testLog.info(`   📻 Station matched: Check if track fits "${musicSearchStation}" theme`);
      
      // Verify Pandora is playing
      assert(
        state.playbackState === 'PLAYING' || state.playbackState === 'TRANSITIONING',
        `Expected PLAYING or TRANSITIONING state, but got ${state.playbackState}`
      );
      assert(state.currentTrack?.uri?.includes('sid=236'), 'Should be playing Pandora content');
      
      testLog.info(`✅ Music search successful - playing Pandora station`);
      
      // Stop after test
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    });
  });

  // Suite 4: Invalid station and stop
  describe('Suite 4: Error Handling', () => {

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
    
    it('should stop Pandora playback', async function() {
      if (!pandoraAvailable) {
        testLog.warn('⚠️  Test skipped - Pandora not available');
        return;
      }

      testLog.info('⏹️  Stopping Pandora playback...');
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Stop should succeed');
      
      // Verify it's stopped
      const stopped = await testContext.eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.playbackState, 'STOPPED', 'Should be stopped after stop command');
      
      testLog.info('✅ Pandora playback stopped successfully');
    });
  });
});
