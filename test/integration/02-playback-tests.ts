import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom, SystemTopology } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';
import { loadTestContent } from '../helpers/content-loader.js';

// Skip if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Basic Playback Control Tests', { skip: skipIntegration }, () => {
  let eventManager: EventManager;
  let topology: SystemTopology;
  let testRoom: string;
  let deviceId: string;
  
  before(async () => {
    console.log('🎵 Testing playback controls...');
    eventManager = EventManager.getInstance();
    
    // Start event bridge to receive UPnP events via SSE
    await startEventBridge();
    
    // Discover system and get test room
    topology = await discoverSystem();
    testRoom = await getSafeTestRoom(topology);
    
    // Get device ID for event tracking
    const response = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await response.json();
    const device = zones.flatMap(z => z.members).find(m => m.roomName === testRoom);
    deviceId = device.id;
    
    console.log(`   Test room: ${testRoom}`);
    console.log(`   Device ID: ${deviceId}`);
    
    // Load content using favorites API
    console.log('📻 Loading content for playback testing...');
    
    const contentLoaded = await loadTestContent(testRoom);
    
    if (contentLoaded) {
      // Wait for playback to start
      const started = await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      if (started) {
        console.log('✅ Content loaded and playing');
        
        // Verify we have track info
        const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        const state = await stateResponse.json();
        if (state.currentTrack) {
          console.log(`   Playing: ${state.currentTrack.title || 'Stream'}`);
        }
      } else {
        console.log('⚠️  Content loaded but playback not confirmed');
      }
    } else {
      console.log('⚠️  Failed to load content, playback tests may fail');
    }
  });
  
  afterEach(() => {
    // Clean up event listeners after each test
    eventManager.reset();
  });
  
  after(async () => {
    // Stop playback
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    
    // Stop event bridge
    stopEventBridge();
  });
  
  describe('State Management', () => {
    it('should handle TRANSITIONING state gracefully', async () => {
      // Get current state
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const initialState = await stateResponse.json();
      console.log(`   Initial state: ${initialState.playbackState}`);
      
      // Ensure we have content loaded
      if (!initialState.currentTrack) {
        console.log('   Loading content first...');
        await loadTestContent(testRoom);
        await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      }
      
      // If already playing, pause first
      if (initialState.playbackState === 'PLAYING') {
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/pause`);
        await eventManager.waitForStableState(deviceId, 5000);
      }
      
      // Start playback
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/play`);
      assert.strictEqual(response.status, 200);
      
      // Wait for stable state (not TRANSITIONING)
      const stableState = await eventManager.waitForStableState(deviceId, 10000);
      assert(stableState !== null, 'Device should reach stable state');
      assert(stableState !== 'TRANSITIONING', 'Device should not be stuck in TRANSITIONING');
      console.log(`   Stable state reached: ${stableState}`);
    });
    
    it('should track state history', async () => {
      // Don't clear history - we want to see all state changes
      
      // Make sure we have content loaded
      const currentState = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await currentState.json();
      
      console.log(`   Initial state before play: ${state.playbackState}`);
      
      if (!state.currentTrack) {
        // Load content
        await loadTestContent(testRoom);
        await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      }
      
      // Now trigger state changes
      const initialHistory = eventManager.getStateHistory(deviceId).length;
      
      // If already playing, pause first to ensure we get state changes
      if (state.playbackState === 'PLAYING') {
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/pause`);
        await eventManager.waitForState(deviceId, state => 
          state === 'PAUSED_PLAYBACK' || state === 'STOPPED', 5000);
      }
      
      // Now play
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/play`);
      await eventManager.waitForState(deviceId, 'PLAYING', 5000);
      
      // And pause again
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/pause`);
      await eventManager.waitForState(deviceId, state => 
        state === 'PAUSED_PLAYBACK' || state === 'STOPPED', 5000);
      
      // Check history
      const history = eventManager.getStateHistory(deviceId);
      const newStates = history.slice(initialHistory);
      console.log(`   State history: ${newStates.map(h => h.currentState).join(' -> ')}`);
      assert(newStates.length >= 2, `Should have at least 2 new state changes, got ${newStates.length}`);
    });
  });
  
  describe('Play Command', () => {
    beforeEach(async () => {
      // Ensure device is paused (not stopped) to preserve content
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      if (state.playbackState === 'PLAYING') {
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/pause`);
        await eventManager.waitForState(deviceId, 
          state => state === 'PAUSED_PLAYBACK' || state === 'STOPPED', 5000);
      }
      
      // If device went to STOPPED, ensure we have content for the test
      const finalStateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const finalState = await finalStateResponse.json();
      
      if (finalState.playbackState === 'STOPPED' && !finalState.currentTrack) {
        // Need to load content again
        await loadTestContent(testRoom);
        // Wait for content to load but not start playing
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/pause`);
        await eventManager.waitForState(deviceId, 
          state => state === 'PAUSED_PLAYBACK' || state === 'STOPPED', 5000);
      }
    });
    
    it('should start playback and emit state change event', async () => {
      // Check initial state
      const initialResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const initialState = await initialResponse.json();
      console.log(`   Initial state before play: ${initialState.playbackState}`);
      
      // Set up event listener BEFORE triggering action
      const stateChangePromise = eventManager.waitForState(deviceId, 'PLAYING', 8000);
      
      // Send play command
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/play`);
      assert.strictEqual(response.status, 200);
      
      // Wait for PLAYING state via event
      const success = await stateChangePromise;
      assert(success, 'Should receive PLAYING state event');
      
      // Verify final state
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.playbackState, 'PLAYING');
    });
    
    it('should handle play when already playing', async () => {
      // Start playback first
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/play`);
      await eventManager.waitForState(deviceId, 'PLAYING', 5000);
      
      // Try to play again
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/play`);
      assert.strictEqual(response.status, 200);
      
      // Should still be playing
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.playbackState, 'PLAYING');
    });
  });
  
  describe('Pause Command', () => {
    beforeEach(async () => {
      // Ensure device is playing before pause tests
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/play`);
      await eventManager.waitForState(deviceId, 'PLAYING', 5000);
    });
    
    it('should pause playback and emit state change event', async () => {
      // Check initial state
      const initialResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const initialState = await initialResponse.json();
      console.log(`   Initial state before pause: ${initialState.playbackState}`);
      
      // Set up event listener
      const stateChangePromise = eventManager.waitForState(deviceId, 
        state => state === 'PAUSED_PLAYBACK' || state === 'STOPPED', 8000);
      
      // Send pause command
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pause`);
      assert.strictEqual(response.status, 200);
      
      // Wait for pause state via event
      const success = await stateChangePromise;
      assert(success, 'Should receive PAUSED_PLAYBACK or STOPPED state event');
      
      // Verify final state
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      assert(['PAUSED_PLAYBACK', 'STOPPED'].includes(state.playbackState),
        `Expected PAUSED_PLAYBACK or STOPPED, got ${state.playbackState}`);
    });
    
    it('should handle pause when already paused', async () => {
      // Pause first
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/pause`);
      await eventManager.waitForState(deviceId, 
        state => state === 'PAUSED_PLAYBACK' || state === 'STOPPED', 8000);
      
      // Try to pause again
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/pause`);
      assert.strictEqual(response.status, 200);
      
      // Should still be paused/stopped
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      assert(['PAUSED_PLAYBACK', 'STOPPED'].includes(state.playbackState));
    });
  });
  
  describe('Stop Command', () => {
    beforeEach(async () => {
      // Ensure device is playing before stop tests
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      if (state.playbackState !== 'PLAYING') {
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/play`);
        await eventManager.waitForState(deviceId, 'PLAYING', 5000);
      }
    });
    
    it('should stop playback and emit state change event', async () => {
      // Check initial state
      const initialResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const initialState = await initialResponse.json();
      console.log(`   Initial state before stop: ${initialState.playbackState}`);
      
      // Set up event listener
      const stateChangePromise = eventManager.waitForState(deviceId, 'STOPPED', 8000);
      
      // Send stop command
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      assert.strictEqual(response.status, 200);
      
      // Wait for STOPPED state via event
      const success = await stateChangePromise;
      assert(success, 'Should receive STOPPED state event');
      
      // Verify final state
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.playbackState, 'STOPPED');
    });
  });
  
  describe('PlayPause Toggle', () => {
    it('should toggle between play and pause states', async () => {
      // Start from paused state (preserves content)
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      console.log(`   Initial state for toggle: ${state.playbackState}`);
      
      // If stopped and no content, load content first
      if (state.playbackState === 'STOPPED' && !state.currentTrack) {
        console.log(`   Device is STOPPED with no content, loading content first`);
        await loadTestContent(testRoom);
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/pause`);
        await eventManager.waitForState(deviceId, 
          state => state === 'PAUSED_PLAYBACK' || state === 'STOPPED', 8000);
      } else if (state.playbackState === 'PLAYING') {
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/pause`);
        await eventManager.waitForState(deviceId, 
          state => state === 'PAUSED_PLAYBACK' || state === 'STOPPED', 8000);
      }
      
      // First toggle - should play
      console.log(`   First toggle: calling playpause (expecting PLAYING)`);
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/playpause`);
      assert.strictEqual(response.status, 200);
      
      let success = await eventManager.waitForState(deviceId, 'PLAYING', 8000);
      assert(success, 'Should start playing after first toggle');
      console.log(`   First toggle successful - now PLAYING`);
      
      // Second toggle - should pause
      console.log(`   Second toggle: calling playpause (expecting PAUSED/STOPPED)`);
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/playpause`);
      assert.strictEqual(response.status, 200);
      
      success = await eventManager.waitForState(deviceId, 
        state => state === 'PAUSED_PLAYBACK' || state === 'STOPPED', 8000);
      assert(success, 'Should pause after second toggle');
      console.log(`   Second toggle successful - now PAUSED/STOPPED`);
      
      // Check if we still have content after pausing
      const pausedStateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const pausedState = await pausedStateResponse.json();
      console.log(`   After pause: state=${pausedState.playbackState}, hasTrack=${!!pausedState.currentTrack}`);
      
      // If we lost content, reload it
      if (!pausedState.currentTrack) {
        console.log(`   Content lost after pause, reloading...`);
        await loadTestContent(testRoom);
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/pause`);
        await eventManager.waitForState(deviceId, 
          state => state === 'PAUSED_PLAYBACK' || state === 'STOPPED', 8000);
      }
      
      // Third toggle - should play again
      console.log(`   Third toggle: calling playpause (expecting PLAYING again)`);
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/playpause`);
      assert.strictEqual(response.status, 200);
      
      success = await eventManager.waitForState(deviceId, 'PLAYING', 8000);
      assert(success, 'Should play again after third toggle');
      console.log(`   Third toggle successful - now PLAYING again`);
    });
  });
  
  describe('Error Handling', () => {
    it('should handle commands to non-existent room', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/NonExistentRoom/play`);
      assert.strictEqual(response.status, 404);
      
      const error = await response.json();
      assert(error.error.includes('not found'));
    });
    
    it('should not get stuck in TRANSITIONING on error', async () => {
      // This test verifies that even if something goes wrong,
      // the device doesn't get stuck in TRANSITIONING state
      
      // Trigger a potentially problematic sequence
      const promises = [
        fetch(`${defaultConfig.apiUrl}/${testRoom}/play`),
        fetch(`${defaultConfig.apiUrl}/${testRoom}/pause`),
        fetch(`${defaultConfig.apiUrl}/${testRoom}/play`)
      ];
      
      await Promise.all(promises);
      
      // Wait for stable state
      const stableState = await eventManager.waitForStableState(deviceId, 10000);
      assert(stableState !== null, 'Should reach stable state after rapid commands');
      assert(stableState !== 'TRANSITIONING', 'Should not be stuck in TRANSITIONING');
    });
  });
  
  after(() => {
    console.log('   ✓ Playback control tests complete');
    
    // Show final state history
    const history = eventManager.getStateHistory(deviceId);
    if (history.length > 0) {
      console.log(`   Final state history (last 5):`);
      history.slice(-5).forEach(h => {
        console.log(`     ${new Date(h.timestamp).toISOString()}: ${h.previousState} -> ${h.currentState}`);
      });
    }
  });
});