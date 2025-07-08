import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import { globalTestSetup, globalTestTeardown, type TestContext } from '../helpers/global-test-setup.js';
import { defaultConfig, getTestTimeout } from '../helpers/test-config.js';
import { loadTestSong } from '../helpers/content-loader.js';
import { testLog } from '../helpers/test-logger.js';

// Skip if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Text-to-Speech (TTS) Tests', { skip: skipIntegration, timeout: getTestTimeout(210000) }, () => {
  let testContext: TestContext;
  let originalVolume: number;
  
  before(async () => {
    testLog.info('🗣️  Testing text-to-speech...');
    
    // Use global test setup with ensurePlaying option
    testContext = await globalTestSetup('TTS tests', {
      ensurePlaying: true,
      playbackVolume: parseInt(process.env.TEST_VOLUME_DEFAULT || '20', 10)
    });
    
    // Get initial volume
    const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/state`);
    const state = await stateResponse.json();
    originalVolume = state.volume;
    testLog.info(`   Original volume: ${originalVolume}`);
    
    // Global setup already ensured music is playing, just verify
    if (state.playbackState !== 'PLAYING') {
      throw new Error(`Expected music to be playing from global setup, but state is: ${state.playbackState}`);
    }
    testLog.info(`   ✅ Music already playing: ${state.currentTrack?.title || 'Unknown'}`);
    
    // Add a pause so you can hear the music before tests start
    testLog.info('   Pausing 2 seconds before starting tests...');
    await new Promise(resolve => setTimeout(resolve, 2000));
  });
  
  after(async () => {
    testLog.info('\n🧹 Cleaning up TTS tests...\n');
    
    // Stop playback
    if (testContext.testRoom) {
      await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/stop`);
    }
    
    // Restore original volume
    if (testContext.testRoom && originalVolume > 0) {
      await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/volume/${originalVolume}`);
      testLog.info(`✅ Restored volume to ${originalVolume}`);
    }
    
    // Use global test teardown
    await globalTestTeardown('TTS tests', testContext);
  });
  
  describe('Core TTS Functionality', () => {
    let testNumber = 0;
    
    // Add settling time between tests to ensure restoration completes
    afterEach(async () => {
      // Wait longer after sayall tests (Tests 4 & 5) for multi-room restoration
      const isSayallTest = testNumber === 4 || testNumber === 5;
      const settleTime = isSayallTest ? 5000 : 2000;
      
      testLog.info(`   ⏳ Waiting ${settleTime}ms for system to settle after Test ${testNumber}...`);
      testLog.flush();
      await new Promise(resolve => setTimeout(resolve, settleTime));
    });
    
    it('Test 1: Say to playing room with different volume, verify playback and volume restore', { timeout: getTestTimeout(45000) }, async () => {
      testNumber = 1;
      const testStartTime = Date.now();
      const { eventManager } = testContext;
      testLog.info('   Test 1: Testing TTS with volume change');
      
      // Music should already be playing from global setup
      // Just verify it's playing
      const verifyStartTime = Date.now();
      const currentState = await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/state`);
      const state = await currentState.json();
      if (state.playbackState !== 'PLAYING') {
        throw new Error(`Expected music to be playing, but state is: ${state.playbackState}`);
      }
      testLog.info(`   ✅ Music is playing: ${state.currentTrack?.title || 'Unknown'}`);
      testLog.info(`   ⏱️  Verify playing took: ${Date.now() - verifyStartTime}ms`);
      
      // Set low volume (20)
      const volumeSetStartTime = Date.now();
      await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/volume/20`);
      await eventManager.waitForVolume(testContext.testDeviceId, 20, 5000);
      testLog.info(`   ⏱️  Volume set to 20 took: ${Date.now() - volumeSetStartTime}ms`);
      
      // Get current track info
      const beforeState = await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/state`);
      const stateBefore = await beforeState.json();
      testLog.info(`   Playing: ${stateBefore.currentTrack?.title || 'Stream'} at volume 20`);
      
      // Make announcement at volume 50
      testLog.info('   Making announcement at volume 50');
      const ttsMessage = 'Test case 1: Volume and playback restore';
      
      // Set up volume change listener BEFORE making the request
      const volumeChangePromise = eventManager.waitForVolume(testContext.testDeviceId, 50, 5000);
      
      const ttsStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/say/${encodeURIComponent(ttsMessage)}/50`);
      assert.strictEqual(response.status, 200);
      const ttsRequestTime = Date.now() - ttsStartTime;
      testLog.info(`   ⏱️  TTS request took: ${ttsRequestTime}ms`);
      
      // Check if volume changed to announcement level (may have already happened)
      const volumeWaitStartTime = Date.now();
      const volumeChanged = await volumeChangePromise;
      assert(volumeChanged, 'Volume should change to announcement level');
      testLog.info(`   ⏱️  Wait for volume 50 took: ${Date.now() - volumeWaitStartTime}ms`);
      
      // Wait for announcement to complete
      const announcementWaitStart = Date.now();
      await new Promise(resolve => setTimeout(resolve, 5000));
      testLog.info(`   ⏱️  Announcement duration: ${Date.now() - announcementWaitStart}ms`);
      
      // Check volume restored
      const volumeRestoreStart = Date.now();
      const volumeRestored = await eventManager.waitForVolume(testContext.testDeviceId, 20, 15000);
      testLog.info(`   ⏱️  Wait for volume restore took: ${Date.now() - volumeRestoreStart}ms`);
      
      // Get current state for debugging
      const afterState = await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/state`);
      const stateAfter = await afterState.json();
      testLog.info(`   Current state after TTS: volume=${stateAfter.volume}, playback=${stateAfter.playbackState}`);
      
      // Check playback restored
      const playbackRestoreStart = Date.now();
      const playbackRestored = await eventManager.waitForState(testContext.testDeviceId, 'PLAYING', 10000);
      assert(playbackRestored, 'Playback should be restored');
      testLog.info(`   ⏱️  Wait for playback restore took: ${Date.now() - playbackRestoreStart}ms`);
      
      // Verify final state
      assert(volumeRestored || stateAfter.volume === 20, `Volume should be restored to 20, got ${stateAfter.volume}`);
      assert.strictEqual(stateAfter.playbackState, 'PLAYING', 'Should be playing');
      testLog.info(`   ✓ Playback restored, volume is ${stateAfter.volume} (expected 20)`);
      testLog.info(`   ⏱️  Test 1 total time: ${Date.now() - testStartTime}ms`);
    });
    
    it('Test 2: TTS using default room', { timeout: getTestTimeout(15000) }, async () => {
      testNumber = 2;
      const testStartTime = Date.now();
      const { eventManager } = testContext;
      testLog.info('   Test 2: Testing TTS via default room');
      
      // Make sure we have a default room set
      const setDefaultStartTime = Date.now();
      const setDefaultResponse = await fetch(`${defaultConfig.apiUrl}/default/room/${testContext.testRoom}`);
      assert.strictEqual(setDefaultResponse.status, 200);
      testLog.info(`   Set default room to: ${testContext.testRoom}`);
      testLog.info(`   ⏱️  Set default room took: ${Date.now() - setDefaultStartTime}ms`);
      
      // Since there's no roomless TTS endpoint, we'll test that default room was set correctly
      const verifyDefaultStartTime = Date.now();
      const defaultsResponse = await fetch(`${defaultConfig.apiUrl}/default`);
      assert.strictEqual(defaultsResponse.status, 200);
      const defaults = await defaultsResponse.json();
      assert.strictEqual(defaults.room, testContext.testRoom, 'Default room should be set');
      testLog.info(`   ⏱️  Verify default room took: ${Date.now() - verifyDefaultStartTime}ms`);
      
      // Make announcement to the room (not roomless)
      const ttsMessage = 'Test case 2: TTS after setting default room';
      const ttsStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/say/${encodeURIComponent(ttsMessage)}`);
      assert.strictEqual(response.status, 200);
      const ttsRequestTime = Date.now() - ttsStartTime;
      testLog.info(`   ⏱️  TTS request took: ${ttsRequestTime}ms`);
      
      // Wait for TTS to start playing
      const waitTrackStartTime = Date.now();
      await eventManager.waitForTrackChange(testContext.testDeviceId, 5000);
      testLog.info(`   ⏱️  Wait for track change took: ${Date.now() - waitTrackStartTime}ms`);
      
      // Wait for announcement to complete
      const announcementWaitStart = Date.now();
      await new Promise(resolve => setTimeout(resolve, 4000));
      testLog.info(`   ⏱️  Announcement duration: ${Date.now() - announcementWaitStart}ms`);
      testLog.info('   ✓ TTS with default room completed');
      testLog.info(`   ⏱️  Test 2 total time: ${Date.now() - testStartTime}ms`);
    });
    
    it('Test 3: Say to paused room, verify stays paused', { timeout: getTestTimeout(20000) }, async () => {
      testNumber = 3;
      const testStartTime = Date.now();
      const { eventManager } = testContext;
      testLog.info('   Test 3: Testing TTS on paused room');
      
      // Make sure we're playing first
      const setupStartTime = Date.now();
      const currentState = await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/state`);
      const state = await currentState.json();
      
      if (state.playbackState !== 'PLAYING') {
        // Resume playback instead of loading new content
        testLog.info('   Music not playing, resuming...');
        await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/play`);
        await eventManager.waitForState(testContext.testDeviceId, 'PLAYING', 10000);
      }
      testLog.info(`   ⏱️  Setup (ensure playing) took: ${Date.now() - setupStartTime}ms`);
      
      // Now pause
      testLog.info('   Pausing playback');
      const pauseStartTime = Date.now();
      await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/pause`);
      await eventManager.waitForState(testContext.testDeviceId, state => 
        state === 'PAUSED_PLAYBACK' || state === 'STOPPED', 5000);
      testLog.info(`   ⏱️  Pause and wait took: ${Date.now() - pauseStartTime}ms`);
      
      // Make announcement
      const ttsMessage = 'Test case 3: TTS on paused room';
      const ttsStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/say/${encodeURIComponent(ttsMessage)}`);
      assert.strictEqual(response.status, 200);
      const ttsRequestTime = Date.now() - ttsStartTime;
      testLog.info(`   ⏱️  TTS request took: ${ttsRequestTime}ms`);
      
      // Wait for TTS to start
      const waitPlayingStartTime = Date.now();
      await eventManager.waitForState(testContext.testDeviceId, 'PLAYING', 5000);
      testLog.info(`   ⏱️  Wait for TTS playing took: ${Date.now() - waitPlayingStartTime}ms`);
      
      // Wait for announcement to complete and state to be restored
      const announcementWaitStart = Date.now();
      await new Promise(resolve => setTimeout(resolve, 5000));
      testLog.info(`   ⏱️  Announcement duration: ${Date.now() - announcementWaitStart}ms`);
      
      // Wait for state to be restored to paused/stopped
      const restoreWaitStart = Date.now();
      const stateRestored = await eventManager.waitForState(testContext.testDeviceId, state => 
        state === 'PAUSED_PLAYBACK' || state === 'STOPPED', 10000);
      assert(stateRestored, 'State should be restored to paused/stopped');
      testLog.info(`   ⏱️  Wait for state restore took: ${Date.now() - restoreWaitStart}ms`);
      
      // Verify final state
      const verifyStartTime = Date.now();
      const finalState = await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/state`);
      const stateFinal = await finalState.json();
      assert(['PAUSED_PLAYBACK', 'STOPPED'].includes(stateFinal.playbackState), 
        `Should be paused/stopped, got ${stateFinal.playbackState}`);
      testLog.info(`   ⏱️  Final state verification took: ${Date.now() - verifyStartTime}ms`);
      testLog.info('   ✓ Room stayed paused after TTS');
      
      // Resume playback for subsequent tests
      testLog.info('   Resuming playback for next tests...');
      await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/play`);
      await eventManager.waitForState(testContext.testDeviceId, 'PLAYING', 5000);
      
      testLog.info(`   ⏱️  Test 3 total time: ${Date.now() - testStartTime}ms`);
    });
    
    it('Test 4: Sayall with no room specified', { timeout: getTestTimeout(20000) }, async () => {
      testNumber = 4;
      const testStartTime = Date.now();
      const { eventManager } = testContext;
      testLog.info('   Test 4: Testing sayall without room');
      
      // Set up promise for state change BEFORE making request
      const playingPromise = eventManager.waitForAnyState(['PLAYING'], 10000);
      
      const sayallStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/sayall/Test%20case%204:%20Say%20all%20no%20room`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Sayall should succeed');
      const sayallRequestTime = Date.now() - sayallStartTime;
      testLog.info(`   ⏱️  Sayall request took: ${sayallRequestTime}ms`);
      
      // Wait for at least one device to start playing TTS
      const waitAnyStateStartTime = Date.now();
      const playingDetected = await playingPromise;
      assert(playingDetected, 'At least one device should start playing');
      testLog.info(`   ⏱️  Wait for any device playing took: ${Date.now() - waitAnyStateStartTime}ms`);
      
      // Wait for announcement to complete
      const announcementWaitStart = Date.now();
      await new Promise(resolve => setTimeout(resolve, 4000));
      testLog.info(`   ⏱️  Announcement duration: ${Date.now() - announcementWaitStart}ms`);
      testLog.info('   ✓ Sayall completed');
      testLog.info(`   ⏱️  Test 4 total time: ${Date.now() - testStartTime}ms`);
    });
    
    it('Test 5: Sayall from specific room', { timeout: getTestTimeout(15000) }, async () => {
      testNumber = 5;
      const testStartTime = Date.now();
      const { eventManager } = testContext;
      testLog.info('   Test 5: Testing sayall from specific room');
      
      // Set up promise for state change BEFORE making request
      const playingPromise = eventManager.waitForAnyState(['PLAYING'], 10000);
      
      const sayallStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/sayall/Test%20case%205:%20Say%20all%20from%20room`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Room sayall should succeed');
      const sayallRequestTime = Date.now() - sayallStartTime;
      testLog.info(`   ⏱️  Room sayall request took: ${sayallRequestTime}ms`);
      
      // Wait for at least one device to start playing TTS
      const waitAnyStateStartTime = Date.now();
      const playingDetected = await playingPromise;
      assert(playingDetected, 'At least one device should start playing');
      testLog.info(`   ⏱️  Wait for any device playing took: ${Date.now() - waitAnyStateStartTime}ms`);
      
      // Wait for announcement to complete
      const announcementWaitStart = Date.now();
      await new Promise(resolve => setTimeout(resolve, 4000));
      testLog.info(`   ⏱️  Announcement duration: ${Date.now() - announcementWaitStart}ms`);
      testLog.info('   ✓ Room sayall completed');
      testLog.info(`   ⏱️  Test 5 total time: ${Date.now() - testStartTime}ms`);
    });
    
    it('Test 6: TTS with special characters', { timeout: getTestTimeout(15000) }, async () => {
      testNumber = 6;
      const testStartTime = Date.now();
      const { eventManager } = testContext;
      testLog.info('   Test 6: Testing TTS with special characters');
      
      // Test with various special characters including & % $ #
      const specialText = encodeURIComponent('Test & verify: 50% complete! Price = $5 #awesome');
      const ttsStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/say/${specialText}`);
      assert.strictEqual(response.status, 200);
      const ttsRequestTime = Date.now() - ttsStartTime;
      testLog.info(`   ⏱️  TTS request took: ${ttsRequestTime}ms`);
      
      // Wait for TTS to start
      const waitTrackStartTime = Date.now();
      await eventManager.waitForTrackChange(testContext.testDeviceId, 5000);
      testLog.info(`   ⏱️  Wait for track change took: ${Date.now() - waitTrackStartTime}ms`);
      
      // Wait for announcement
      const announcementWaitStart = Date.now();
      await new Promise(resolve => setTimeout(resolve, 5000));
      testLog.info(`   ⏱️  Announcement duration: ${Date.now() - announcementWaitStart}ms`);
      testLog.info('   ✓ TTS with special characters completed');
      testLog.info(`   ⏱️  Test 6 total time: ${Date.now() - testStartTime}ms`);
    });
    
    it('Test 7: TTS with long text (truncation)', { timeout: getTestTimeout(30000) }, async () => {
      testNumber = 7;
      const testStartTime = Date.now();
      const { eventManager } = testContext;
      testLog.info('   Test 7: Testing TTS with long text (truncation)');
      
      // Create text longer than 200 characters (Google TTS limit)
      const longText = 'This is a very long text that will test the truncation feature. ' +
        'It needs to be longer than 200 characters to ensure proper truncation. ' +
        'The system should automatically truncate this text to 200 characters when using Google TTS. ' +
        'Any additional text beyond the limit will be cut off.';
      
      const ttsStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/say/${encodeURIComponent(longText)}`);
      assert.strictEqual(response.status, 200);
      const ttsRequestTime = Date.now() - ttsStartTime;
      testLog.info(`   ⏱️  TTS request took: ${ttsRequestTime}ms`);
      
      // Wait for TTS to start
      const waitTrackStartTime = Date.now();
      await eventManager.waitForTrackChange(testContext.testDeviceId, 5000);
      testLog.info(`   ⏱️  Wait for track change took: ${Date.now() - waitTrackStartTime}ms`);
      
      // Wait for announcement
      const announcementWaitStart = Date.now();
      await new Promise(resolve => setTimeout(resolve, 5000));
      testLog.info(`   ⏱️  Announcement duration: ${Date.now() - announcementWaitStart}ms`);
      testLog.info('   ✓ TTS with long text completed (truncated to 200 chars)');
      testLog.info(`   ⏱️  Test 7 total time: ${Date.now() - testStartTime}ms`);
    });
  });
  
  describe('Error Handling', () => {
    it('should handle empty text', async () => {
      const testStartTime = Date.now();
      testLog.info('   Testing empty text handling');
      
      // Test truly empty text
      const emptyStartTime = Date.now();
      const response1 = await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/say/`);
      assert([400, 404].includes(response1.status), 'Should reject empty text');
      testLog.info(`   ⏱️  Empty text request took: ${Date.now() - emptyStartTime}ms (status: ${response1.status})`);
      
      // Test whitespace-only text
      const whitespaceStartTime = Date.now();
      const response2 = await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/say/%20%20%20`);
      assert.strictEqual(response2.status, 400, 'Should reject whitespace-only text');
      testLog.info(`   ⏱️  Whitespace-only request took: ${Date.now() - whitespaceStartTime}ms`);
      testLog.info(`   ⏱️  Empty text test total time: ${Date.now() - testStartTime}ms`);
    });
    
    it('should handle invalid room for TTS', async () => {
      const testStartTime = Date.now();
      testLog.info('   Testing invalid room handling');
      
      const requestStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/InvalidRoom/say/Test`);
      assert.strictEqual(response.status, 404);
      testLog.info(`   ⏱️  Invalid room request took: ${Date.now() - requestStartTime}ms`);
      testLog.info(`   ⏱️  Invalid room test total time: ${Date.now() - testStartTime}ms`);
    });
    
    it('should handle malformed URL encoding', async () => {
      const testStartTime = Date.now();
      testLog.info('   Testing malformed URL encoding handling');
      
      // Test with incomplete percent encoding
      const requestStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${testContext.testRoom}/say/Test%2`);
      assert.strictEqual(response.status, 200, 'Should handle malformed URL encoding gracefully');
      testLog.info(`   ⏱️  Malformed URL request took: ${Date.now() - requestStartTime}ms`);
      testLog.info(`   ⏱️  Malformed URL test total time: ${Date.now() - testStartTime}ms`);
    });
  });
});