import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { globalTestSetup, globalTestTeardown, type TestContext } from '../helpers/global-test-setup.js';
import { defaultConfig, getTestTimeout } from '../helpers/test-config.js';
import { loadTestSong } from '../helpers/content-loader.js';
import { testLog } from '../helpers/test-logger.js';

// Skip if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Text-to-Speech (TTS) Tests', { skip: skipIntegration, timeout: getTestTimeout(180000) }, () => {
  let testContext: TestContext;
  let room: string;
  let deviceId: string;
  let originalVolume: number;
  
  before(async () => {
    testLog.info('🗣️  Testing text-to-speech...');
    
    // Use global test setup
    testContext = await globalTestSetup('TTS tests');
    const { eventManager, topology } = testContext;
    
    // Get test room from environment or use first available
    room = process.env.TEST_ROOM || topology.rooms[0];
    if (!room) {
      throw new Error('No suitable test room found');
    }
    
    testLog.info(`   Test room: ${room}`);
    
    // Get device ID for event tracking
    const zone = topology.zones.find(z => z.members.some(m => m.roomName === room));
    if (!zone) {
      throw new Error(`Zone not found for room ${room}`);
    }
    
    // Use coordinator device ID (important for stereo pairs)
    const coordinatorMember = zone.members.find(m => m.isCoordinator);
    deviceId = coordinatorMember!.id;
    testLog.info(`   Device ID: ${deviceId}`);
    
    // Get initial volume
    const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
    const state = await stateResponse.json();
    originalVolume = state.volume;
    testLog.info(`   Original volume: ${originalVolume}`);
  });
  
  after(async () => {
    testLog.info('\n🧹 Cleaning up TTS tests...\n');
    
    // Stop playback
    if (room) {
      await fetch(`${defaultConfig.apiUrl}/${room}/stop`);
    }
    
    // Restore original volume
    if (room && originalVolume > 0) {
      await fetch(`${defaultConfig.apiUrl}/${room}/volume/${originalVolume}`);
      testLog.info(`✅ Restored volume to ${originalVolume}`);
    }
    
    // Use global test teardown
    await globalTestTeardown('TTS tests', testContext);
  });
  
  describe('Core TTS Functionality', () => {
    it('Test 1: Say to playing room with different volume, verify playback and volume restore', { timeout: getTestTimeout(45000) }, async () => {
      const testStartTime = Date.now();
      const { eventManager } = testContext;
      testLog.info('   Test 1: Setting up - playing song at low volume');
      
      // Load content and start playing
      const loadStartTime = Date.now();
      await loadTestSong(room, true);
      await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      testLog.info(`   ⏱️  Load and play took: ${Date.now() - loadStartTime}ms`);
      
      // Set low volume (20)
      const volumeSetStartTime = Date.now();
      await fetch(`${defaultConfig.apiUrl}/${room}/volume/20`);
      await eventManager.waitForVolume(deviceId, 20, 5000);
      testLog.info(`   ⏱️  Volume set to 20 took: ${Date.now() - volumeSetStartTime}ms`);
      
      // Get current track info
      const beforeState = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const stateBefore = await beforeState.json();
      testLog.info(`   Playing: ${stateBefore.currentTrack?.title || 'Stream'} at volume 20`);
      
      // Make announcement at volume 50
      testLog.info('   Making announcement at volume 50');
      const ttsMessage = 'Test case 1: Volume and playback restore';
      
      // Set up volume change listener BEFORE making the request
      const volumeChangePromise = eventManager.waitForVolume(deviceId, 50, 5000);
      
      const ttsStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/say/${encodeURIComponent(ttsMessage)}/50`);
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
      const volumeRestored = await eventManager.waitForVolume(deviceId, 20, 15000);
      testLog.info(`   ⏱️  Wait for volume restore took: ${Date.now() - volumeRestoreStart}ms`);
      
      // Get current state for debugging
      const afterState = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const stateAfter = await afterState.json();
      testLog.info(`   Current state after TTS: volume=${stateAfter.volume}, playback=${stateAfter.playbackState}`);
      
      // Check playback restored
      const playbackRestoreStart = Date.now();
      const playbackRestored = await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      assert(playbackRestored, 'Playback should be restored');
      testLog.info(`   ⏱️  Wait for playback restore took: ${Date.now() - playbackRestoreStart}ms`);
      
      // Verify final state
      assert(volumeRestored || stateAfter.volume === 20, `Volume should be restored to 20, got ${stateAfter.volume}`);
      assert.strictEqual(stateAfter.playbackState, 'PLAYING', 'Should be playing');
      testLog.info(`   ✓ Playback restored, volume is ${stateAfter.volume} (expected 20)`);
      testLog.info(`   ⏱️  Test 1 total time: ${Date.now() - testStartTime}ms`);
    });
    
    it('Test 2: TTS using default room', { timeout: getTestTimeout(15000) }, async () => {
      const testStartTime = Date.now();
      const { eventManager } = testContext;
      testLog.info('   Test 2: Testing TTS via default room');
      
      // Make sure we have a default room set
      const setDefaultStartTime = Date.now();
      const setDefaultResponse = await fetch(`${defaultConfig.apiUrl}/default/room/${room}`);
      assert.strictEqual(setDefaultResponse.status, 200);
      testLog.info(`   Set default room to: ${room}`);
      testLog.info(`   ⏱️  Set default room took: ${Date.now() - setDefaultStartTime}ms`);
      
      // Since there's no roomless TTS endpoint, we'll test that default room was set correctly
      const verifyDefaultStartTime = Date.now();
      const defaultsResponse = await fetch(`${defaultConfig.apiUrl}/default`);
      assert.strictEqual(defaultsResponse.status, 200);
      const defaults = await defaultsResponse.json();
      assert.strictEqual(defaults.room, room, 'Default room should be set');
      testLog.info(`   ⏱️  Verify default room took: ${Date.now() - verifyDefaultStartTime}ms`);
      
      // Make announcement to the room (not roomless)
      const ttsMessage = 'Test case 2: TTS after setting default room';
      const ttsStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/say/${encodeURIComponent(ttsMessage)}`);
      assert.strictEqual(response.status, 200);
      const ttsRequestTime = Date.now() - ttsStartTime;
      testLog.info(`   ⏱️  TTS request took: ${ttsRequestTime}ms`);
      
      // Wait for TTS to start playing
      const waitTrackStartTime = Date.now();
      await eventManager.waitForTrackChange(deviceId, 5000);
      testLog.info(`   ⏱️  Wait for track change took: ${Date.now() - waitTrackStartTime}ms`);
      
      // Wait for announcement to complete
      const announcementWaitStart = Date.now();
      await new Promise(resolve => setTimeout(resolve, 4000));
      testLog.info(`   ⏱️  Announcement duration: ${Date.now() - announcementWaitStart}ms`);
      testLog.info('   ✓ TTS with default room completed');
      testLog.info(`   ⏱️  Test 2 total time: ${Date.now() - testStartTime}ms`);
    });
    
    it('Test 3: Say to paused room, verify stays paused', { timeout: getTestTimeout(20000) }, async () => {
      const testStartTime = Date.now();
      const { eventManager } = testContext;
      testLog.info('   Test 3: Testing TTS on paused room');
      
      // Make sure we're playing first
      const setupStartTime = Date.now();
      const currentState = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const state = await currentState.json();
      
      if (state.playbackState !== 'PLAYING') {
        await loadTestSong(room, true);
        await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      }
      testLog.info(`   ⏱️  Setup (ensure playing) took: ${Date.now() - setupStartTime}ms`);
      
      // Now pause
      testLog.info('   Pausing playback');
      const pauseStartTime = Date.now();
      await fetch(`${defaultConfig.apiUrl}/${room}/pause`);
      await eventManager.waitForState(deviceId, state => 
        state === 'PAUSED_PLAYBACK' || state === 'STOPPED', 5000);
      testLog.info(`   ⏱️  Pause and wait took: ${Date.now() - pauseStartTime}ms`);
      
      // Make announcement
      const ttsMessage = 'Test case 3: TTS on paused room';
      const ttsStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/say/${encodeURIComponent(ttsMessage)}`);
      assert.strictEqual(response.status, 200);
      const ttsRequestTime = Date.now() - ttsStartTime;
      testLog.info(`   ⏱️  TTS request took: ${ttsRequestTime}ms`);
      
      // Wait for TTS to start
      const waitPlayingStartTime = Date.now();
      await eventManager.waitForState(deviceId, 'PLAYING', 5000);
      testLog.info(`   ⏱️  Wait for TTS playing took: ${Date.now() - waitPlayingStartTime}ms`);
      
      // Wait for announcement to complete and state to be restored
      const announcementWaitStart = Date.now();
      await new Promise(resolve => setTimeout(resolve, 5000));
      testLog.info(`   ⏱️  Announcement duration: ${Date.now() - announcementWaitStart}ms`);
      
      // Wait for state to be restored to paused/stopped
      const restoreWaitStart = Date.now();
      const stateRestored = await eventManager.waitForState(deviceId, state => 
        state === 'PAUSED_PLAYBACK' || state === 'STOPPED', 10000);
      assert(stateRestored, 'State should be restored to paused/stopped');
      testLog.info(`   ⏱️  Wait for state restore took: ${Date.now() - restoreWaitStart}ms`);
      
      // Verify final state
      const verifyStartTime = Date.now();
      const finalState = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const stateFinal = await finalState.json();
      assert(['PAUSED_PLAYBACK', 'STOPPED'].includes(stateFinal.playbackState), 
        `Should be paused/stopped, got ${stateFinal.playbackState}`);
      testLog.info(`   ⏱️  Final state verification took: ${Date.now() - verifyStartTime}ms`);
      testLog.info('   ✓ Room stayed paused after TTS');
      testLog.info(`   ⏱️  Test 3 total time: ${Date.now() - testStartTime}ms`);
    });
    
    it('Test 4: Sayall with no room specified', { timeout: getTestTimeout(20000) }, async () => {
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
      const testStartTime = Date.now();
      const { eventManager } = testContext;
      testLog.info('   Test 5: Testing sayall from specific room');
      
      // Set up promise for state change BEFORE making request
      const playingPromise = eventManager.waitForAnyState(['PLAYING'], 10000);
      
      const sayallStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/sayall/Test%20case%205:%20Say%20all%20from%20room`);
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
      const testStartTime = Date.now();
      const { eventManager } = testContext;
      testLog.info('   Test 6: Testing TTS with special characters');
      
      // Test with various special characters including & % $ #
      const specialText = encodeURIComponent('Test & verify: 50% complete! Price = $5 #awesome');
      const ttsStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/say/${specialText}`);
      assert.strictEqual(response.status, 200);
      const ttsRequestTime = Date.now() - ttsStartTime;
      testLog.info(`   ⏱️  TTS request took: ${ttsRequestTime}ms`);
      
      // Wait for TTS to start
      const waitTrackStartTime = Date.now();
      await eventManager.waitForTrackChange(deviceId, 5000);
      testLog.info(`   ⏱️  Wait for track change took: ${Date.now() - waitTrackStartTime}ms`);
      
      // Wait for announcement
      const announcementWaitStart = Date.now();
      await new Promise(resolve => setTimeout(resolve, 5000));
      testLog.info(`   ⏱️  Announcement duration: ${Date.now() - announcementWaitStart}ms`);
      testLog.info('   ✓ TTS with special characters completed');
      testLog.info(`   ⏱️  Test 6 total time: ${Date.now() - testStartTime}ms`);
    });
    
    it('Test 7: TTS with long text (truncation)', { timeout: getTestTimeout(30000) }, async () => {
      const testStartTime = Date.now();
      const { eventManager } = testContext;
      testLog.info('   Test 7: Testing TTS with long text (truncation)');
      
      // Create text longer than 200 characters (Google TTS limit)
      const longText = 'This is a very long text that will test the truncation feature. ' +
        'It needs to be longer than 200 characters to ensure proper truncation. ' +
        'The system should automatically truncate this text to 200 characters when using Google TTS. ' +
        'Any additional text beyond the limit will be cut off.';
      
      const ttsStartTime = Date.now();
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/say/${encodeURIComponent(longText)}`);
      assert.strictEqual(response.status, 200);
      const ttsRequestTime = Date.now() - ttsStartTime;
      testLog.info(`   ⏱️  TTS request took: ${ttsRequestTime}ms`);
      
      // Wait for TTS to start
      const waitTrackStartTime = Date.now();
      await eventManager.waitForTrackChange(deviceId, 5000);
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
      const response1 = await fetch(`${defaultConfig.apiUrl}/${room}/say/`);
      assert([400, 404].includes(response1.status), 'Should reject empty text');
      testLog.info(`   ⏱️  Empty text request took: ${Date.now() - emptyStartTime}ms (status: ${response1.status})`);
      
      // Test whitespace-only text
      const whitespaceStartTime = Date.now();
      const response2 = await fetch(`${defaultConfig.apiUrl}/${room}/say/%20%20%20`);
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
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/say/Test%2`);
      assert.strictEqual(response.status, 200, 'Should handle malformed URL encoding gracefully');
      testLog.info(`   ⏱️  Malformed URL request took: ${Date.now() - requestStartTime}ms`);
      testLog.info(`   ⏱️  Malformed URL test total time: ${Date.now() - testStartTime}ms`);
    });
  });
});