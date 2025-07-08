import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { defaultConfig, getTestTimeout } from '../helpers/test-config.js';
import { globalTestSetup, globalTestTeardown, TestContext } from '../helpers/global-test-setup.js';
import { loadTestAlbum, loadTestPlaylist } from '../helpers/content-loader.js';
import { testLog } from '../helpers/test-logger.js';

// Skip if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Playback Modes Tests', { skip: skipIntegration }, () => {
  let testContext: TestContext;
  let room: string;
  let deviceId: string;
  
  before(async () => {
    testLog.info('🎛️  Testing playback modes...');
    testContext = await globalTestSetup('Playback Modes Tests');
    
    room = testContext.testRoom;
    deviceId = testContext.deviceIdMapping.get(room) || '';
    
    if (!deviceId) {
      throw new Error(`Device ID not found for room ${room}`);
    }
    
    testLog.info(`   Test room: ${room}`);
    testLog.info(`   Device ID: ${deviceId}`);
    
    // Load content to enable playback mode changes
    testLog.info('   Loading content for playback mode tests...');
    
    // Need multiple tracks for shuffle/repeat testing
    try {
      // Try to load an album first (guaranteed multiple tracks)
      await loadTestAlbum(room);
      testLog.info('   ✅ Loaded test album with multiple tracks');
    } catch (error) {
      testLog.info('   ⚠️  Failed to load album, trying playlist...');
      try {
        // Fallback to playlist
        await loadTestPlaylist(room);
        testLog.info('   ✅ Loaded test playlist with multiple tracks');
      } catch (playlistError) {
        testLog.info('   ⚠️  Failed to load multi-track content:', playlistError.message);
        throw new Error('Cannot test playback modes without multi-track content');
      }
    }
    
    // Start playback
    const playResponse = await fetch(`${defaultConfig.apiUrl}/${room}/play`);
    if (!playResponse.ok) {
      throw new Error('Failed to start playback');
    }
    
    await testContext.eventManager.waitForState(deviceId, 'PLAYING', 10000);
    testLog.info('   ✅ Playback started successfully');
  });
  
  after(async () => {
    await globalTestTeardown('Playback Modes Tests', testContext);
  });
  
  describe('Repeat Modes', () => {
    it('should enable repeat mode', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/repeat/on`);
      assert.strictEqual(response.status, 200);
      
      // Verify via state - repeat 'on' sets mode to 'all'
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.playMode.repeat, 'all');
    });
    
    it('should disable repeat mode', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/repeat/off`);
      assert.strictEqual(response.status, 200);
      
      // Verify via state - repeat 'off' sets mode to 'none'
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.playMode.repeat, 'none');
    });
    
    it('should toggle repeat mode', async () => {
      // Turn on
      let response = await fetch(`${defaultConfig.apiUrl}/${room}/repeat/on`);
      assert.strictEqual(response.status, 200);
      
      // Turn off
      response = await fetch(`${defaultConfig.apiUrl}/${room}/repeat/off`);
      assert.strictEqual(response.status, 200);
      
      // Verify it's off
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.playMode.repeat, 'none');
    });
    
    it('should handle invalid repeat mode', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/repeat/invalid`);
      assert.strictEqual(response.status, 400);
    });
  });
  
  describe('Shuffle Mode', () => {
    beforeEach(async () => {
      // Reset to no shuffle, no repeat
      await fetch(`${defaultConfig.apiUrl}/${room}/repeat/none`);
      await fetch(`${defaultConfig.apiUrl}/${room}/shuffle/off`);
    });
    
    it('should enable shuffle', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/shuffle/on`);
      assert.strictEqual(response.status, 200);
      
      // Verify via state
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.playMode.shuffle, true);
    });
    
    it('should disable shuffle', async () => {
      // First enable
      await fetch(`${defaultConfig.apiUrl}/${room}/shuffle/on`);
      
      // Then disable
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/shuffle/off`);
      assert.strictEqual(response.status, 200);
      
      // Verify via state
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.playMode.shuffle, false);
    });
    
    it('should preserve repeat mode when toggling shuffle', async () => {
      // Set repeat all
      await fetch(`${defaultConfig.apiUrl}/${room}/repeat/all`);
      
      // Enable shuffle
      await fetch(`${defaultConfig.apiUrl}/${room}/shuffle/on`);
      
      // Verify both are set
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.playMode.repeat, 'all');
      assert.strictEqual(state.playMode.shuffle, true);
    });
  });
  
  describe('Crossfade Mode', () => {
    it('should enable crossfade', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/crossfade/on`);
      assert.strictEqual(response.status, 200);
      
      // Verify via state
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.playMode.crossfade, true);
    });
    
    it('should disable crossfade', async () => {
      // First enable
      await fetch(`${defaultConfig.apiUrl}/${room}/crossfade/on`);
      
      // Then disable
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/crossfade/off`);
      assert.strictEqual(response.status, 200);
      
      // Verify via state
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.playMode.crossfade, false);
    });
  });
  
  describe('Combined Modes', () => {
    it('should handle all modes together', async () => {
      // Helper function to wait for playMode changes
      const waitForPlayMode = async (expected: { repeat?: string, shuffle?: boolean, crossfade?: boolean }, timeout = 5000) => {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
          const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
          const state = await stateResponse.json();
          
          const matches = Object.keys(expected).every(key => {
            return state.playMode[key] === expected[key];
          });
          
          if (matches) return true;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
      };
      
      // Enable all modes sequentially with proper delays and debug each step
      testLog.info('   Setting repeat mode...');
      const repeatResponse = await fetch(`${defaultConfig.apiUrl}/${room}/repeat/on`);
      assert.strictEqual(repeatResponse.status, 200);
      
      // Wait and check state after repeat
      await new Promise(resolve => setTimeout(resolve, 1000));
      let checkResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      let checkState = await checkResponse.json();
      testLog.info(`   After repeat: repeat=${checkState.playMode.repeat}, shuffle=${checkState.playMode.shuffle}, crossfade=${checkState.playMode.crossfade}`);
      
      testLog.info('   Setting shuffle mode...');
      const shuffleResponse = await fetch(`${defaultConfig.apiUrl}/${room}/shuffle/on`);
      assert.strictEqual(shuffleResponse.status, 200);
      
      // Wait and check state after shuffle
      await new Promise(resolve => setTimeout(resolve, 1000));
      checkResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      checkState = await checkResponse.json();
      testLog.info(`   After shuffle: repeat=${checkState.playMode.repeat}, shuffle=${checkState.playMode.shuffle}, crossfade=${checkState.playMode.crossfade}`);
      
      testLog.info('   Setting crossfade mode...');
      const crossfadeResponse = await fetch(`${defaultConfig.apiUrl}/${room}/crossfade/on`);
      assert.strictEqual(crossfadeResponse.status, 200);
      
      // Wait and check state after crossfade
      await new Promise(resolve => setTimeout(resolve, 1000));
      checkResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      checkState = await checkResponse.json();
      testLog.info(`   After crossfade: repeat=${checkState.playMode.repeat}, shuffle=${checkState.playMode.shuffle}, crossfade=${checkState.playMode.crossfade}`);
      
      // Final verification that all modes are set
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const state = await stateResponse.json();
      testLog.info(`   Final state: repeat=${state.playMode.repeat}, shuffle=${state.playMode.shuffle}, crossfade=${state.playMode.crossfade}`);
      
      assert.strictEqual(state.playMode.repeat, 'all');
      assert.strictEqual(state.playMode.shuffle, true);
      assert.strictEqual(state.playMode.crossfade, true);
    });
    
    it('should reset all modes', async () => {
      // First enable all
      await fetch(`${defaultConfig.apiUrl}/${room}/repeat/on`);
      await fetch(`${defaultConfig.apiUrl}/${room}/shuffle/on`);
      await fetch(`${defaultConfig.apiUrl}/${room}/crossfade/on`);
      
      // Then disable all
      await fetch(`${defaultConfig.apiUrl}/${room}/repeat/off`);
      await fetch(`${defaultConfig.apiUrl}/${room}/shuffle/off`);
      await fetch(`${defaultConfig.apiUrl}/${room}/crossfade/off`);
      
      // Verify all are off
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.playMode.repeat, 'none');
      assert.strictEqual(state.playMode.shuffle, false);
      assert.strictEqual(state.playMode.crossfade, false);
    });
  });
  
  describe('Queue Operations', () => {
    it('should clear queue', async () => {
      // First ensure we have something playing
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const initialState = await stateResponse.json();
      
      // If not playing, add something to queue
      if (initialState.playbackState !== 'PLAYING') {
        const query = encodeURIComponent('track:Yesterday artist:The Beatles');
        const searchResponse = await fetch(`${defaultConfig.apiUrl}/${room}/musicsearch/apple/song/${query}`);
        assert.strictEqual(searchResponse.status, 200);
        await testContext.eventManager.waitForState(deviceId, 'PLAYING', 5000);
      }
      
      // Clear the queue
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/clearqueue`);
      assert.strictEqual(response.status, 200);
      
      // Wait a bit for the clear to take effect
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // After clearing queue, check that queue is empty
      const queueResponse = await fetch(`${defaultConfig.apiUrl}/${room}/queue`);
      assert.strictEqual(queueResponse.status, 200);
      
      const queue = await queueResponse.json();
      testLog.info(`   After clear - queue length: ${queue.length}`);
      
      assert.strictEqual(queue.length, 0, 'Queue should be empty after clearing');
    });
  });
  
  describe('Error Handling', () => {
    it('should handle invalid shuffle value', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/shuffle/maybe`);
      assert.strictEqual(response.status, 400);
    });
    
    it('should handle invalid crossfade value', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/crossfade/perhaps`);
      assert.strictEqual(response.status, 400);
    });
  });
});