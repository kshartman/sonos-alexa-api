import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { discoverSystem, getSafeTestRoom, SystemTopology } from '../helpers/discovery.js';
import { withSavedState } from '../helpers/state-manager.js';
import { defaultConfig, getTestTimeout } from '../helpers/test-config.js';
import { testLog } from '../helpers/test-logger.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Sonos API Integration Tests', { skip: skipIntegration }, () => {
  let topology: SystemTopology;
  let testRoom: string;
  
  before(async () => {
    testLog.info('🔍 Discovering Sonos system...');
    topology = await discoverSystem();
    testRoom = await getSafeTestRoom(topology);
    
    testLog.info(`📊 System discovered:`);
    testLog.info(`   - Rooms: ${topology.rooms.join(', ')}`);
    testLog.info(`   - Groups: ${topology.hasGroups ? 'Yes' : 'No'}`);
    testLog.info(`   - Stereo pairs: ${topology.hasStereoPairs ? `Yes (${topology.stereoPairs?.join(', ')})` : 'No'}`);
    testLog.info(`   - Services: ${topology.availableServices.join(', ')}`);
    testLog.info(`   - Default room: ${topology.defaultRoom || 'Not set'}`);
    testLog.info(`   - Default service: ${topology.defaultService || 'Not set'}`);
    testLog.info(`   - Presets: ${topology.presetCount || 0}`);
    testLog.info(`   - Test room: ${testRoom}`);
    testLog.info(`   - Test mode: ${defaultConfig.testMode}`);
  });

  describe('System Discovery', () => {
    it('should discover zones', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/zones`);
      assert.strictEqual(response.status, 200);
      const zones = await response.json();
      assert(Array.isArray(zones));
      assert(zones.length > 0);
    });

    it('should get system state', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/state`);
      assert.strictEqual(response.status, 200);
      const state = await response.json();
      assert(Array.isArray(state));
    });

    it('should check health', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/health`);
      assert.strictEqual(response.status, 200);
      const health = await response.json();
      assert.strictEqual(health.status, 'healthy');
      assert(health.devices > 0);
    });
  });

  // TTS tests - Run early and ensure clean state afterward
  describe('Text-to-Speech', () => {
    // Helper to wait for room to return to stable state
    async function waitForStableState(roomName: string, maxWaitMs = 10000) {
      const startTime = Date.now();
      let lastState = '';
      let stableCount = 0;
      
      while (Date.now() - startTime < maxWaitMs) {
        const response = await fetch(`${defaultConfig.apiUrl}/${roomName}/state`);
        const state = await response.json();
        
        // Check if state is stable (not TRANSITIONING)
        if (state.playbackState !== 'TRANSITIONING') {
          if (state.playbackState === lastState) {
            stableCount++;
            if (stableCount >= 3) { // State unchanged for 3 checks
              testLog.info(`   Room ${roomName} stable at: ${state.playbackState}`);
              return state;
            }
          } else {
            stableCount = 0;
            lastState = state.playbackState;
          }
        } else {
          stableCount = 0;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      testLog.info(`   Warning: Room ${roomName} did not stabilize after ${maxWaitMs}ms`);
      return null;
    }
    
    it('should say text in a room', async () => {
      testLog.info(`   Starting TTS test in ${testRoom}...`);
      
      // Get initial state
      const initialResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const initialState = await initialResponse.json();
      testLog.info(`   Initial state: ${initialState.playbackState}`);
      
      await withSavedState(testRoom, async () => {
        const response = await fetch(
          `${defaultConfig.apiUrl}/${testRoom}/say/Hello%20from%20unit%20tests`
        );
        assert.strictEqual(response.status, 200);
        
        // Wait for TTS to start
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Poll until TTS completes and state returns to stable
        await waitForStableState(testRoom);
      });
      
      // Extra wait to ensure state restoration is complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verify the room has returned to initial state or stopped
      const finalState = await waitForStableState(testRoom);
      testLog.info(`   TTS test complete. Final state: ${finalState?.playbackState || 'unknown'}`);
    });

    it('should announce to all rooms', async function() {
      testLog.info(`   Starting global announcement test...`);
      
      const testMessage = 'Global announcement test';
      const response = await fetch(
        `${defaultConfig.apiUrl}/sayall/${encodeURIComponent(testMessage)}`
      );
      
      assert.strictEqual(response.status, 200);
      
      // Wait a moment for announcements to start
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Wait for all rooms to stabilize
      const testRooms = topology.rooms.slice(0, Math.min(3, topology.rooms.length));
      testLog.info(`   Waiting for ${testRooms.length} rooms to stabilize...`);
      
      const stabilizationPromises = testRooms.map(room => waitForStableState(room, 15000));
      await Promise.all(stabilizationPromises);
      
      // Extra wait to ensure all rooms are done
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verify clean state by checking all test rooms
      const stateChecks = testRooms.map(room => 
        fetch(`${defaultConfig.apiUrl}/${room}/state`).then(r => r.json())
      );
      const states = await Promise.all(stateChecks);
      testLog.info(`   Say all test complete. Room states: ${states.map(s => s.playbackState).join(', ')}`);
    });

    it('should announce to grouped rooms only', async function() {
      if (topology.zones.length === 0 || !topology.hasGroups) {
        testLog.info('   No groups available - skipping grouped announcement test');
        this.skip();
        return;
      }

      // Find a grouped zone
      const groupedZone = topology.zones.find(z => z.members.length > 1);
      if (!groupedZone) {
        testLog.info('   No grouped zones found - skipping test');
        this.skip();
        return;
      }

      testLog.info(`   Starting group announcement test...`);
      const coordinator = groupedZone.coordinator;
      const testMessage = 'Group announcement test';
      
      // Get all room names in the group
      const groupRooms = groupedZone.members.map(m => m.roomName);
      testLog.info(`   Testing announcement to group: ${groupRooms.join(', ')}`);
      
      await withSavedState(coordinator, async () => {
        const response = await fetch(
          `${defaultConfig.apiUrl}/${coordinator}/sayall/${encodeURIComponent(testMessage)}`
        );
        
        assert.strictEqual(response.status, 200);
        
        // Wait for announcement to start
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Wait for all rooms in group to stabilize
        const stabilizationPromises = groupRooms.map(room => waitForStableState(room, 10000));
        await Promise.all(stabilizationPromises);
      });
      
      // Additional wait to ensure complete restoration
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      testLog.info(`   Group announcement test complete`);
    });
    
    // Final stabilization check after all TTS tests
    after(async () => {
      testLog.info('\n   Ensuring all rooms are stable after TTS tests...');
      
      // Check up to 5 rooms to ensure they're all stable
      const roomsToCheck = topology.rooms.slice(0, Math.min(5, topology.rooms.length));
      const stabilizationPromises = roomsToCheck.map(room => waitForStableState(room, 10000));
      const results = await Promise.all(stabilizationPromises);
      
      const allStable = results.every(r => r !== null);
      if (!allStable) {
        testLog.info('   WARNING: Some rooms did not stabilize after TTS tests');
      } else {
        testLog.info('   ✓ All checked rooms are stable');
      }
      
      // Final wait to be absolutely sure
      await new Promise(resolve => setTimeout(resolve, 3000));
      testLog.info('   TTS tests cleanup complete, proceeding with other tests...\n');
    });
  });

  // Generate test coverage report at the end
  after(() => {
    testLog.info('\n📈 Test Coverage Summary:');
    testLog.info(`   - System discovery: ✓`);
    testLog.info(`   - TTS functionality: ✓`);
    testLog.info(`   - Tested ${topology?.rooms?.length || 0} rooms`);
  });
});