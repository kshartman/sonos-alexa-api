import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig, getTestTimeout } from '../helpers/test-config.js';
import { getSafeTestRoom } from '../helpers/discovery.js';
import { globalTestSetup, globalTestTeardown, getDeviceIdForRoom, TestContext } from '../helpers/global-test-setup.js';
import { testLog } from '../helpers/test-logger.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Text-to-Speech (TTS) Integration Tests', { skip: skipIntegration, timeout: getTestTimeout(120000) }, () => {
  let context: TestContext;
  let testRoom: string;
  let deviceId: string;
  let eventManager: EventManager;

  before(async () => {
    context = await globalTestSetup('Text-to-Speech (TTS) Integration Tests');
    eventManager = context.eventManager;
    
    // Get test room
    testRoom = await getSafeTestRoom(context.topology);
    deviceId = await getDeviceIdForRoom(testRoom);
    
    testLog.info(`📊 Test room: ${testRoom}`);
    testLog.info(`📊 Device ID: ${deviceId}`);
    
    // Query the device state to ensure EventManager knows about it
    const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    const state = await stateResponse.json();
    testLog.info(`   Current device state: ${state.playbackState}`);
    
    // If not already stopped, stop playback
    if (state.playbackState !== 'STOPPED') {
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      
      // Wait for STOPPED state
      const stopped = await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      if (!stopped) {
        testLog.info('⚠️  Failed to reach STOPPED state before TTS tests');
        // Not fatal - tests can still run
      }
    }
  });

  after(async () => {
    await globalTestTeardown('TTS tests', context);
    
    // Give a moment for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('should play TTS content and track state changes', async () => {
    const testStartTime = Date.now();
    // Use a long message to ensure TTS is still playing when we check
    const ttsText = 'This is a test of text to speech functionality. ' +
      'We are making this message extra long to ensure that the text to speech engine ' +
      'has enough content to process and play back. This will help us reliably detect ' +
      'state changes and track changes during playback. The quick brown fox jumps over ' +
      'the lazy dog. One two three four five six seven eight nine ten.';
    
    // Set up promise for state change BEFORE making request
    const stateChangePromise = eventManager.waitForState(deviceId, 'PLAYING', 5000);
    
    // Make the TTS request
    const ttsStartTime = Date.now();
    const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/say/${encodeURIComponent(ttsText)}`);
    assert.strictEqual(response.status, 200);
    const ttsRequestTime = Date.now() - ttsStartTime;
    testLog.info(`   ⏱️  TTS request took: ${ttsRequestTime}ms`);
    
    // Wait for PLAYING state
    const waitPlayingStartTime = Date.now();
    const playing = await stateChangePromise;
    assert(playing, 'TTS should reach PLAYING state');
    testLog.info(`   ⏱️  Wait for PLAYING state took: ${Date.now() - waitPlayingStartTime}ms`);
    
    testLog.info('   TTS is playing, stopping it now...');
    
    // Stop the TTS playback
    const stopStartTime = Date.now();
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    testLog.info(`   ⏱️  Stop request took: ${Date.now() - stopStartTime}ms`);
    
    // Wait for it to stop
    const waitStopStartTime = Date.now();
    await eventManager.waitForState(deviceId, 'STOPPED', 3000);
    testLog.info(`   ⏱️  Wait for STOPPED state took: ${Date.now() - waitStopStartTime}ms`);
    
    testLog.info('✅ TTS playback and state changes verified successfully');
    testLog.info(`   ⏱️  Total test time: ${Date.now() - testStartTime}ms`);
  });

  it('should handle TTS with special characters', async () => {
    const testStartTime = Date.now();
    // Long message with special characters
    const ttsText = 'Testing special characters: Hello, World! How are you? ' +
      'One hundred & twenty-three dollars ($123). Testing quotes "like this" and \'like this\'. ' +
      'Math symbols: 2 + 2 = 4, 10 - 5 = 5. Percentages like 50% off! ' +
      'Questions? Yes! Exclamations! Various punctuation: comma, semicolon; colon: done.';
    
    // Set up state tracking before request
    const playingPromise = eventManager.waitForState(deviceId, 'PLAYING', 5000);
    
    const ttsStartTime = Date.now();
    const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/say/${encodeURIComponent(ttsText)}`);
    assert.strictEqual(response.status, 200);
    const ttsRequestTime = Date.now() - ttsStartTime;
    testLog.info(`   ⏱️  TTS request took: ${ttsRequestTime}ms`);
    
    // Wait for it to start playing
    const waitPlayingStartTime = Date.now();
    const playing = await playingPromise;
    assert(playing, 'TTS with special characters should play');
    testLog.info(`   ⏱️  Wait for PLAYING state took: ${Date.now() - waitPlayingStartTime}ms`);
    
    testLog.info('   TTS with special characters is playing, stopping it...');
    
    // Stop playback
    const stopStartTime = Date.now();
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    testLog.info(`   ⏱️  Stop request took: ${Date.now() - stopStartTime}ms`);
    
    testLog.info('✅ TTS with special characters handled correctly');
    testLog.info(`   ⏱️  Total test time: ${Date.now() - testStartTime}ms`);
  });

  it('should emit track change events for TTS', async () => {
    const testStartTime = Date.now();
    // Very long message to ensure it's still playing when we check
    const ttsText = 'Testing track change events. ' + 
      'This is a very long message that will take several seconds to read aloud. ' +
      'We want to make absolutely sure that the text to speech system is still actively ' +
      'playing when we check for track change events. The purpose of this extended message ' +
      'is to eliminate any timing issues that might cause us to miss the track change event. ' +
      'By the time you hear this sentence, the track change event should definitely have fired. ' +
      'We will now count slowly: one, two, three, four, five, six, seven, eight, nine, ten.';
    
    // Set up promise BEFORE making request
    const trackChangePromise = eventManager.waitForTrackChange(deviceId, 10000);
    
    // Make the TTS request
    const ttsStartTime = Date.now();
    const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/say/${encodeURIComponent(ttsText)}`);
    assert.strictEqual(response.status, 200);
    const ttsRequestTime = Date.now() - ttsStartTime;
    testLog.info(`   ⏱️  TTS request took: ${ttsRequestTime}ms`);
    
    // Wait for track change
    const waitTrackStartTime = Date.now();
    const trackChanged = await trackChangePromise;
    assert(trackChanged, 'Should receive track change event when TTS starts');
    testLog.info(`   ⏱️  Wait for track change took: ${Date.now() - waitTrackStartTime}ms`);
    
    testLog.info('   Track change detected, stopping TTS...');
    
    // Stop the long TTS playback
    const stopStartTime = Date.now();
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    testLog.info(`   ⏱️  Stop request took: ${Date.now() - stopStartTime}ms`);
    
    testLog.info('✅ TTS track change events working correctly');
    testLog.info(`   ⏱️  Total test time: ${Date.now() - testStartTime}ms`);
  });

  it('should handle TTS with volume parameter', async () => {
    const testStartTime = Date.now();
    const ttsText = 'Testing text to speech with volume control';
    const volume = 30;
    
    // Get original volume first
    const getVolumeStartTime = Date.now();
    const originalStateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    const originalState = await originalStateResponse.json();
    const originalVolume = originalState.volume;
    testLog.info(`   ⏱️  Get original volume took: ${Date.now() - getVolumeStartTime}ms (volume: ${originalVolume})`);
    
    // Set up state and volume tracking
    const playingPromise = eventManager.waitForState(deviceId, 'PLAYING', 5000);
    const volumeChangePromise = eventManager.waitForVolume(deviceId, volume, 5000);
    
    // Make TTS request with volume
    const ttsStartTime = Date.now();
    const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/say/${encodeURIComponent(ttsText)}/${volume}`);
    assert.strictEqual(response.status, 200);
    const ttsRequestTime = Date.now() - ttsStartTime;
    testLog.info(`   ⏱️  TTS request took: ${ttsRequestTime}ms`);
    
    // Wait for playback and volume change
    const waitStartTime = Date.now();
    const [playing, volumeChanged] = await Promise.all([playingPromise, volumeChangePromise]);
    assert(playing, 'TTS with volume should play');
    assert(volumeChanged, 'Volume should change to requested level');
    testLog.info(`   ⏱️  Wait for playing & volume change took: ${Date.now() - waitStartTime}ms`);
    
    testLog.info(`   TTS playing at volume ${volume}, waiting for completion...`);
    
    // Wait for TTS to complete and state to change
    const waitStopStartTime = Date.now();
    await eventManager.waitForState(deviceId, 'STOPPED', 10000);
    testLog.info(`   ⏱️  Wait for TTS completion took: ${Date.now() - waitStopStartTime}ms`);
    
    // Wait for volume to be restored to original
    const waitRestoreStartTime = Date.now();
    const volumeRestored = await eventManager.waitForVolume(deviceId, originalVolume, 5000);
    assert(volumeRestored, `Volume should be restored to original level ${originalVolume}`);
    testLog.info(`   ⏱️  Wait for volume restore took: ${Date.now() - waitRestoreStartTime}ms`);
    
    testLog.info('✅ TTS with volume parameter handled correctly - volume was set during playback and restored after');
    testLog.info(`   ⏱️  Total test time: ${Date.now() - testStartTime}ms`);
  });

  it('should handle empty TTS text gracefully', async () => {
    const testStartTime = Date.now();
    const requestStartTime = Date.now();
    const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/say/%20`); // URL encoded space
    assert.strictEqual(response.status, 400, 'Should reject empty TTS text');
    const requestTime = Date.now() - requestStartTime;
    testLog.info(`   ⏱️  Empty text request took: ${requestTime}ms`);
    
    const error = await response.json();
    assert(error.error, 'Should return error message');
    
    testLog.info('✅ Empty TTS text rejected correctly');
    testLog.info(`   ⏱️  Total test time: ${Date.now() - testStartTime}ms`);
  });
});