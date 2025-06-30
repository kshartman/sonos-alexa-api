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
    
    // Get device ID for event tracking - must use coordinator for stereo pairs
    const response = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await response.json();
    
    // Find the zone containing our test room
    const zone = zones.find(z => z.members.some(m => m.roomName === testRoom));
    if (!zone) {
      throw new Error(`Test room ${testRoom} not found in zones`);
    }
    
    // Use the coordinator's ID for event tracking
    const coordinator = zone.members.find(m => m.isCoordinator);
    deviceId = coordinator.id;
    
    console.log(`   Test room: ${testRoom}`);
    console.log(`   Device ID: ${deviceId}`);
    
    // Load content using favorites API
    console.log('📻 Loading content for playback testing...');
    
    const contentLoaded = await loadTestContent(testRoom);
    
    if (contentLoaded) {
      // Stop immediately after loading content so we start from a known state
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      // Wait for stabilization
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify we have content loaded
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      if (state.currentTrack) {
        console.log(`✅ Content loaded: ${state.currentTrack.title || 'Stream'}`);
        console.log(`   Initial state: ${state.playbackState}`);
      } else {
        console.log('⚠️  Failed to load content, tests may fail');
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
    console.log('\n🧹 Cleaning up Playback Control tests...\n');
    
    // Stop playback
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    
    // Clear any pending event listeners
    eventManager.reset();
    
    // Stop event bridge
    stopEventBridge();
    
    // Give a moment for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 100));
  });
  
  describe('State Management', () => {
    it('should handle TRANSITIONING state gracefully', async () => {
      // Always start from STOPPED state with content
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      // Wait for stabilization
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if we have content
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      if (!state.currentTrack) {
        console.log('   Loading content first...');
        await loadTestContent(testRoom);
        // Stop again to ensure we're in STOPPED state
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
        await eventManager.waitForState(deviceId, 'STOPPED', 5000);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log(`   Initial state: STOPPED`);
      
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
      // Always start from STOPPED state with content
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      // Wait for stabilization
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if we have content
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      if (!state.currentTrack) {
        await loadTestContent(testRoom);
        // Stop again to ensure we're in STOPPED state
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
        await eventManager.waitForState(deviceId, 'STOPPED', 5000);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log(`   Initial state: STOPPED`);
      
      // Clear history to track only our test changes
      eventManager.reset();
      const initialHistory = 0;
      
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
      // Always start from a known state: STOPPED with content loaded
      
      // First, stop playback completely
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      // Wait for system to stabilize
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if we have content
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      if (!state.currentTrack) {
        // Load content
        await loadTestContent(testRoom);
        // Stop it immediately after loading
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
        await eventManager.waitForState(deviceId, 'STOPPED', 5000);
        
        // Wait for system to stabilize
        await new Promise(resolve => setTimeout(resolve, 1000));
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
      // Always start from PLAYING state
      
      // First ensure we're stopped
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      // Wait for stabilization
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if we have content
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      if (!state.currentTrack) {
        await loadTestContent(testRoom);
        // Content loading might auto-play, so stop again
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
        await eventManager.waitForState(deviceId, 'STOPPED', 5000);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Now start playback
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/play`);
      await eventManager.waitForState(deviceId, 'PLAYING', 5000);
      
      // Wait for system to stabilize in PLAYING state
      await new Promise(resolve => setTimeout(resolve, 1000));
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
      // Always start from PLAYING state with proper setup
      
      // First ensure we're stopped
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      // Wait for stabilization
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if we have content
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      if (!state.currentTrack) {
        await loadTestContent(testRoom);
        // Content loading might auto-play, so stop again
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
        await eventManager.waitForState(deviceId, 'STOPPED', 5000);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Now start playback
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/play`);
      await eventManager.waitForState(deviceId, 'PLAYING', 5000);
      
      // Wait for system to stabilize in PLAYING state
      await new Promise(resolve => setTimeout(resolve, 1000));
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
      // Always start from STOPPED state with content
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
      await eventManager.waitForState(deviceId, 'STOPPED', 5000);
      
      // Wait for stabilization
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if we have content
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      
      if (!state.currentTrack) {
        await loadTestContent(testRoom);
        // Stop again to ensure we're in STOPPED state
        await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
        await eventManager.waitForState(deviceId, 'STOPPED', 5000);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log(`   Initial state for toggle: STOPPED`);
      
      // First toggle - should play
      console.log(`   First toggle: calling playpause (expecting PLAYING)`);
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/playpause`);
      assert.strictEqual(response.status, 200);
      
      let success = await eventManager.waitForState(deviceId, 'PLAYING', 8000);
      assert(success, 'Should start playing after first toggle');
      console.log(`   First toggle successful - now PLAYING`);
      
      // Wait for stabilization
      await new Promise(resolve => setTimeout(resolve, 1000));
      
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