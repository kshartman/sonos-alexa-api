import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { EventManager } from '../../src/utils/event-manager.js';

describe('Event Manager Unit Tests', () => {
  let eventManager: EventManager;
  
  beforeEach(() => {
    eventManager = EventManager.getInstance();
  });
  
  afterEach(() => {
    // Clean up listeners after each test
    eventManager.reset();
  });
  
  it('should handle state change events', async () => {
    // Create a mock state change event
    const mockDevice = {
      id: 'TEST_DEVICE_001',
      roomName: 'Test Room',
      state: { playbackState: 'STOPPED' }
    } as any;
    
    // Set up event listener
    let eventReceived = false;
    eventManager.once('state-change', (event) => {
      eventReceived = true;
      assert.strictEqual(event.deviceId, 'TEST_DEVICE_001');
      assert.strictEqual(event.roomName, 'Test Room');
      assert.strictEqual(event.previousState, 'STOPPED');
      assert.strictEqual(event.currentState, 'PLAYING');
    });
    
    // Emit state change
    eventManager.emitStateChange(mockDevice, 'STOPPED', 'PLAYING');
    
    // Verify event was received
    assert(eventReceived, 'State change event should be received');
  });
  
  it('should wait for specific state with timeout', async () => {
    const mockDevice = {
      id: 'TEST_DEVICE_002',
      roomName: 'Test Room 2',
      state: { playbackState: 'STOPPED' }
    } as any;
    
    // Start waiting for PLAYING state
    const waitPromise = eventManager.waitForState('TEST_DEVICE_002', 'PLAYING', 1000);
    
    // Emit state change after 100ms
    setTimeout(() => {
      eventManager.emitStateChange(mockDevice, 'STOPPED', 'PLAYING');
    }, 100);
    
    // Should resolve to true
    const result = await waitPromise;
    assert.strictEqual(result, true, 'Should successfully wait for state');
  });
  
  it('should timeout when state is not reached', async () => {
    // Wait for a state that will never come
    const result = await eventManager.waitForState('TEST_DEVICE_003', 'PLAYING', 500);
    assert.strictEqual(result, false, 'Should timeout and return false');
  });
  
  it('should wait for stable state (not TRANSITIONING)', async () => {
    const mockDevice = {
      id: 'TEST_DEVICE_004',
      roomName: 'Test Room 4',
      state: { playbackState: 'STOPPED' }
    } as any;
    
    // Mock discovery for this test
    const mockDiscovery = {
      getCoordinator: (deviceId: string) => {
        if (deviceId === 'TEST_DEVICE_004' || deviceId === 'uuid:TEST_DEVICE_004') {
          return mockDevice;
        }
        return null;
      },
      getTopology: () => {
        return { zones: [] }; // Empty topology for unit test
      }
    };
    
    // Set mock discovery
    eventManager.setDiscovery(mockDiscovery);
    
    // Start waiting for stable state
    const waitPromise = eventManager.waitForStableState('TEST_DEVICE_004', 2000);
    
    // Emit TRANSITIONING first
    setTimeout(() => {
      eventManager.emitStateChange(mockDevice, 'STOPPED', 'TRANSITIONING');
    }, 100);
    
    // Then emit PLAYING
    setTimeout(() => {
      eventManager.emitStateChange(mockDevice, 'TRANSITIONING', 'PLAYING');
    }, 300);
    
    // Should resolve to PLAYING
    const result = await waitPromise;
    assert.strictEqual(result, 'PLAYING', 'Should wait for stable state');
  });
  
  it('should track state history', () => {
    const mockDevice = {
      id: 'TEST_DEVICE_005',
      roomName: 'Test Room 5',
      state: { playbackState: 'STOPPED' }
    } as any;
    
    // Emit several state changes
    eventManager.emitStateChange(mockDevice, 'STOPPED', 'TRANSITIONING');
    eventManager.emitStateChange(mockDevice, 'TRANSITIONING', 'PLAYING');
    eventManager.emitStateChange(mockDevice, 'PLAYING', 'PAUSED_PLAYBACK');
    
    // Get history
    const history = eventManager.getStateHistory('TEST_DEVICE_005');
    assert.strictEqual(history.length, 3, 'Should have 3 state changes in history');
    assert.strictEqual(history[0].previousState, 'STOPPED');
    assert.strictEqual(history[0].currentState, 'TRANSITIONING');
    assert.strictEqual(history[2].currentState, 'PAUSED_PLAYBACK');
  });
});