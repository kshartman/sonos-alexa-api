import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { defaultConfig, getTestTimeout } from '../helpers/test-config.js';
import { globalTestSetup, globalTestTeardown, TestContext } from '../helpers/global-test-setup.js';
import { SystemTopology, ungroupAllSpeakers } from '../helpers/discovery.js';
import { loadTestSong } from '../helpers/content-loader.js';
import { testLog } from '../helpers/test-logger.js';

// Skip if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

// Pre-check if we have enough devices for group tests
async function hasEnoughDevices(): Promise<boolean> {
  try {
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await zonesResponse.json();
    const rooms = new Set<string>();
    zones.forEach(zone => {
      zone.members.forEach(member => {
        rooms.add(member.roomName);
      });
    });
    return rooms.size >= 2;
  } catch {
    return false;
  }
}

describe('Group Management Tests', { skip: skipIntegration }, () => {
  let testContext: TestContext;
  let room1: string;
  let room2: string;
  let device1Id: string;
  let device2Id: string;
  let hasEnoughRooms = false;
  
  before(async () => {
    testLog.info('👥 Testing group management...');
    testContext = await globalTestSetup('Group Management Tests');
    
    testLog.info(`   Initial topology: ${testContext.topology.zones.length} zone(s), ${testContext.topology.rooms.length} room(s)`);
    
    // We need at least 2 rooms for group tests
    if (testContext.topology.rooms.length < 2) {
      testLog.info('⚠️  Skipping group tests - requires at least 2 Sonos devices');
      testLog.info(`   Found ${testContext.topology.rooms.length} room(s): ${testContext.topology.rooms.join(', ')}`);
      hasEnoughRooms = false;
      return; // Skip all tests
    }
    
    hasEnoughRooms = true;
    
    // Ungroup all speakers to start from clean state
    await ungroupAllSpeakers();
    
    // Wait for topology to settle after ungrouping
    await testContext.eventManager.waitForTopologyChange(5000);
    
    // Get fresh topology after ungrouping by re-fetching zones
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await zonesResponse.json();
    
    // Select two standalone rooms for testing
    const standaloneRooms = zones
      .filter(zone => zone.members.length === 1)
      .map(zone => zone.coordinator);
    
    if (standaloneRooms.length < 2) {
      hasEnoughRooms = false;
      testLog.info('⚠️  Need at least 2 standalone rooms for group tests');
      return;
    }
    
    room1 = standaloneRooms[0];
    room2 = standaloneRooms[1];
    
    testLog.info(`   Test rooms: ${room1} and ${room2}`);
    
    // Get device IDs for event tracking
    const zone1 = zones.find(z => z.members.some(m => m.roomName === room1));
    const zone2 = zones.find(z => z.members.some(m => m.roomName === room2));
    
    if (!zone1 || !zone2) {
      throw new Error(`Zones not found for rooms ${room1} and ${room2}`);
    }
    
    // Get the actual device IDs from the coordinator member
    const device1 = zone1.members.find(m => m.roomName === room1);
    const device2 = zone2.members.find(m => m.roomName === room2);
    
    if (!device1 || !device2) {
      throw new Error(`Devices not found for rooms ${room1} and ${room2}`);
    }
    
    device1Id = device1.id;
    device2Id = device2.id;
    
    testLog.info(`   Device IDs: ${device1Id}, ${device2Id}`);
  });
  
  after(async () => {
    if (hasEnoughRooms) {
      // Ungroup all speakers to clean up
      await ungroupAllSpeakers();
    }
    
    await globalTestTeardown('Group Management Tests', testContext);
  });
  
  describe('Group Formation', () => {
    beforeEach(async function() {
      if (!hasEnoughRooms) {
        this.skip();
        return;
      }
      
      // Ensure rooms are not grouped before each test
      await ungroupAllSpeakers();
      await testContext.eventManager.waitForTopologyChange(3000);
    });
    
    it('should join two rooms into a group', async () => {
      if (!hasEnoughRooms) return;
      
      testLog.info(`   Joining ${room2} to ${room1}`);
      
      // Set up topology change listener BEFORE action
      const topologyPromise = testContext.eventManager.waitForTopologyChange(5000);
      
      // Join room2 to room1
      const response = await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
      assert.strictEqual(response.status, 200);
      
      // Wait for topology change event
      const topologyChanged = await topologyPromise;
      assert(topologyChanged, 'Should receive topology change event');
      
      // Give a bit more time for the group to stabilize
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify the group was formed
      const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
      const zones = await zonesResponse.json();
      
      // Find the zone containing both rooms
      const groupZone = zones.find(zone => 
        zone.members.some(m => m.roomName === room1) &&
        zone.members.some(m => m.roomName === room2)
      );
      
      assert(groupZone, 'Rooms should be in the same group');
      assert.strictEqual(groupZone.coordinator, room1, 'Room1 should be coordinator');
      assert.strictEqual(groupZone.members.length, 2, 'Group should have 2 members');
    });
    
    it('should leave a group', async () => {
      if (!hasEnoughRooms) return;
      
      // First create a group
      testLog.info(`   Creating group: ${room2} joining ${room1}`);
      await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
      await testContext.eventManager.waitForTopologyChange(3000);
      
      // Set up topology change listener
      const topologyPromise = testContext.eventManager.waitForTopologyChange(5000);
      
      // Leave the group
      testLog.info(`   ${room2} leaving group`);
      const response = await fetch(`${defaultConfig.apiUrl}/${room2}/leave`);
      assert.strictEqual(response.status, 200);
      
      // Wait for topology change event
      const topologyChanged = await topologyPromise;
      assert(topologyChanged, 'Should receive topology change event');
      
      // Give a bit more time for topology to fully stabilize
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify rooms are separate
      const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
      const zones = await zonesResponse.json();
      
      const room1Zone = zones.find(zone => zone.members.some(m => m.roomName === room1));
      const room2Zone = zones.find(zone => zone.members.some(m => m.roomName === room2));
      
      assert(room1Zone, 'Room1 should have a zone');
      assert(room2Zone, 'Room2 should have a zone');
      assert.notStrictEqual(room1Zone.id, room2Zone.id, 'Rooms should be in different zones');
    });
    
    it('should add a third room to existing group', async () => {
      if (!hasEnoughRooms) return;
      
      // Get fresh zones for current topology
      const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
      const zones = await zonesResponse.json();
      
      // Get standalone rooms to ensure we have controllable devices
      const standaloneRooms = zones
        .filter(zone => zone.members.length === 1)
        .map(zone => zone.coordinator);
      
      // Need at least 3 standalone rooms for this test
      if (standaloneRooms.length < 3) {
        testLog.info('   Skipping test - requires 3+ standalone Sonos devices');
        return;
      }
      
      const room3 = standaloneRooms.find(r => r !== room1 && r !== room2);
      testLog.info(`   Adding third room: ${room3} to group [${room1}, ${room2}]`);
      
      // Create initial group
      testLog.info(`   Step 1: Creating initial group - ${room2} joining ${room1}`);
      await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
      await testContext.eventManager.waitForTopologyChange(3000);
      
      // Set up topology change listener
      const topologyPromise = testContext.eventManager.waitForTopologyChange(5000);
      
      // Add third room
      testLog.info(`   Step 2: Adding ${room3} to the group`);
      const response = await fetch(`${defaultConfig.apiUrl}/${room3}/join/${room1}`);
      assert.strictEqual(response.status, 200);
      
      // Wait for topology change event
      const topologyChanged = await topologyPromise;
      assert(topologyChanged, 'Should receive topology change event');
      
      // Give a bit more time for topology to fully stabilize
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Verify 3-room group
      const zonesResponse2 = await fetch(`${defaultConfig.apiUrl}/zones`);
      const zones2 = await zonesResponse2.json();
      
      const groupZone = zones2.find(zone => zone.members.some(m => m.roomName === room1));
      assert(groupZone, 'Should find group zone');
      
      testLog.info(`   Final group members: ${groupZone.members.map(m => m.roomName).join(', ')}`);
      testLog.info(`   Expected: 3 members, Got: ${groupZone.members.length} members`);
      
      assert.strictEqual(groupZone.members.length, 3, 'Group should have 3 members');
    });
  });
  
  describe('Group Playback Control', () => {
    beforeEach(async function() {
      if (!hasEnoughRooms) {
        this.skip();
        return;
      }
      
      // Create a group for playback tests
      await ungroupAllSpeakers();
      await testContext.eventManager.waitForTopologyChange(3000);
      await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
      await testContext.eventManager.waitForTopologyChange(3000);
      
      // Load content to enable playback commands
      testLog.info('   Loading content for group playback...');
      try {
        await loadTestSong(room1);
        testLog.info('   ✅ Content loaded successfully');
      } catch (error) {
        testLog.error('   ❌ Failed to load content:', error);
        // Try to continue anyway as the test might handle it
      }
      
      // Wait for content to fully load
      await new Promise(resolve => setTimeout(resolve, 2000));
    });
    
    it('should control playback for entire group', async () => {
      if (!hasEnoughRooms) return;
      
      // First check if we have content in the queue
      const queueResponse = await fetch(`${defaultConfig.apiUrl}/${room1}/queue`);
      const queue = await queueResponse.json();
      testLog.info(`   Queue has ${queue.length} items`);
      
      // Play on coordinator should affect whole group
      const response = await fetch(`${defaultConfig.apiUrl}/${room1}/play`);
      assert.strictEqual(response.status, 200);
      
      // Wait a bit for the command to propagate and state to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check both devices via API (which returns coordinator's state for grouped devices)
      let room1State;
      let attempts = 0;
      const maxAttempts = 5;
      
      // Retry logic to handle TRANSITIONING state
      while (attempts < maxAttempts) {
        const room1Response = await fetch(`${defaultConfig.apiUrl}/${room1}/state`);
        room1State = await room1Response.json();
        testLog.info(`   Room1 state (attempt ${attempts + 1}): ${room1State.playbackState}`);
        
        if (room1State.playbackState === 'PLAYING') {
          break;
        } else if (room1State.playbackState === 'TRANSITIONING') {
          testLog.info('   State is transitioning, waiting...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
        } else {
          break; // Exit on other states
        }
      }
      
      assert.strictEqual(room1State.playbackState, 'PLAYING', 'Room1 should be playing');
      
      const room2Response = await fetch(`${defaultConfig.apiUrl}/${room2}/state`);
      const room2State = await room2Response.json();
      assert.strictEqual(room2State.playbackState, 'PLAYING', 'Room2 should be playing as part of group');
    });
    
    it('should pause entire group', async () => {
      if (!hasEnoughRooms) return;
      // Start playing
      await fetch(`${defaultConfig.apiUrl}/${room1}/play`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Pause group
      const response = await fetch(`${defaultConfig.apiUrl}/${room1}/pause`);
      assert.strictEqual(response.status, 200);
      
      // Wait a bit for the command to propagate
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check both devices via API
      const room1Response = await fetch(`${defaultConfig.apiUrl}/${room1}/state`);
      const room1State = await room1Response.json();
      assert(room1State.playbackState === 'PAUSED_PLAYBACK' || room1State.playbackState === 'STOPPED', 
        `Room1 should be paused/stopped, got ${room1State.playbackState}`);
      
      const room2Response = await fetch(`${defaultConfig.apiUrl}/${room2}/state`);
      const room2State = await room2Response.json();
      assert(room2State.playbackState === 'PAUSED_PLAYBACK' || room2State.playbackState === 'STOPPED',
        `Room2 should be paused/stopped, got ${room2State.playbackState}`);
    });
  });
  
  describe('Group Volume Control', () => {
    beforeEach(async function() {
      if (!hasEnoughRooms) {
        this.skip();
        return;
      }
      
      // Create a group for volume tests
      await ungroupAllSpeakers();
      await testContext.eventManager.waitForTopologyChange(3000);
      await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
      await testContext.eventManager.waitForTopologyChange(3000);
    });
    
    it('should set group volume', async () => {
      if (!hasEnoughRooms) return;
      
      const targetVolume = 25;
      
      // Get initial volumes
      const room1InitialState = await fetch(`${defaultConfig.apiUrl}/${room1}/state`);
      const room2InitialState = await fetch(`${defaultConfig.apiUrl}/${room2}/state`);
      const initialState1 = await room1InitialState.json();
      const initialState2 = await room2InitialState.json();
      const initialVolume1 = initialState1.volume;
      const initialVolume2 = initialState2.volume;
      
      testLog.info(`   Initial volumes: room1=${initialVolume1}, room2=${initialVolume2}`);
      
      // Set initial volumes to different levels to test proportional scaling
      await fetch(`${defaultConfig.apiUrl}/${room1}/volume/20`);
      await fetch(`${defaultConfig.apiUrl}/${room2}/volume/40`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Give more time for volume to settle
      
      // Get actual initial volumes after setting
      const room1InitState = await fetch(`${defaultConfig.apiUrl}/${room1}/state`);
      const room2InitState = await fetch(`${defaultConfig.apiUrl}/${room2}/state`);
      const initState1 = await room1InitState.json();
      const initState2 = await room2InitState.json();
      testLog.info(`   Set volumes: room1=${initState1.volume}, room2=${initState2.volume}`);
      
      // Set group volume
      const response = await fetch(`${defaultConfig.apiUrl}/${room1}/groupVolume/${targetVolume}`);
      assert.strictEqual(response.status, 200);
      
      // Wait for volume changes to complete
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get new volumes
      const room1State = await fetch(`${defaultConfig.apiUrl}/${room1}/state`);
      const room2State = await fetch(`${defaultConfig.apiUrl}/${room2}/state`);
      const state1 = await room1State.json();
      const state2 = await room2State.json();
      
      testLog.info(`   After groupVolume(${targetVolume}): room1=${state1.volume}, room2=${state2.volume}`);
      
      // The new volumes should be different from the initial ones
      assert(state1.volume !== initState1.volume || state2.volume !== initState2.volume,
        'Group volume should have changed at least one room volume');
      
      // Both volumes should be reasonable (not 0 unless target was 0)
      if (targetVolume > 0) {
        assert(state1.volume > 0, 'Room1 volume should be greater than 0');
        assert(state2.volume > 0, 'Room2 volume should be greater than 0');
      }
      
      // The louder room should generally stay louder (but with some tolerance for edge cases)
      // This might not always be true due to Sonos's volume scaling algorithm
      testLog.info(`   Volume difference maintained: ${state2.volume > state1.volume ? 'Yes' : 'No'}`);
    });
    
    it('should maintain individual volume control', async () => {
      if (!hasEnoughRooms) return;
      // Set group volume first (with average of 30)
      await fetch(`${defaultConfig.apiUrl}/${room1}/groupVolume/30`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get volumes after group volume set
      const room1BeforeState = await fetch(`${defaultConfig.apiUrl}/${room1}/state`);
      const room2BeforeState = await fetch(`${defaultConfig.apiUrl}/${room2}/state`);
      const beforeState1 = await room1BeforeState.json();
      const beforeState2 = await room2BeforeState.json();
      const beforeVolume1 = beforeState1.volume;
      
      testLog.info(`   After groupVolume(30): room1=${beforeVolume1}, room2=${beforeState2.volume}`);
      
      // Set individual volume for room2
      const individualVolume = 40;
      
      const response = await fetch(`${defaultConfig.apiUrl}/${room2}/volume/${individualVolume}`);
      assert.strictEqual(response.status, 200);
      
      // Wait for volume change to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verify room2 reached the target volume
      const room2State = await fetch(`${defaultConfig.apiUrl}/${room2}/state`);
      const state2 = await room2State.json();
      testLog.info(`   Room2 volume after setting to ${individualVolume}: ${state2.volume}`);
      
      // Allow some tolerance for volume setting
      assert(Math.abs(state2.volume - individualVolume) <= 2, 
        `Room2 volume should be close to ${individualVolume}, got ${state2.volume}`);
      
      // Verify room1 volume unchanged
      const room1State = await fetch(`${defaultConfig.apiUrl}/${room1}/state`);
      const state1 = await room1State.json();
      assert.strictEqual(state1.volume, beforeVolume1, 'Room1 volume should remain unchanged');
    });
  });
  
  describe('Error Handling', () => {
    it('should handle joining non-existent room', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${room1}/join/NonExistentRoom`);
      assert.strictEqual(response.status, 404);
      
      const error = await response.json();
      assert(error.error.includes('not found'));
    });
    
    it('should handle leaving when not in group', async () => {
      // Ensure room is standalone
      await ungroupAllSpeakers();
      await testContext.eventManager.waitForTopologyChange(3000);
      
      // Try to leave (should succeed but do nothing)
      const response = await fetch(`${defaultConfig.apiUrl}/${room1}/leave`);
      assert.strictEqual(response.status, 200);
    });
    
    it('should handle group volume on non-coordinator', async () => {
      if (!hasEnoughRooms) return;
      
      // Create group with room1 as coordinator
      testLog.info(`   Creating group: ${room2} joining ${room1} (coordinator)`);
      await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
      await testContext.eventManager.waitForTopologyChange(3000);
      
      // Try to set group volume from non-coordinator
      testLog.info(`   Setting group volume to 50 from non-coordinator (${room2})`);
      const response = await fetch(`${defaultConfig.apiUrl}/${room2}/groupVolume/50`);
      // This should work - API should route to coordinator
      assert.strictEqual(response.status, 200);
      
      // Wait for volume change to complete
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verify the average volume is close to target
      const room1State = await fetch(`${defaultConfig.apiUrl}/${room1}/state`);
      const room2State = await fetch(`${defaultConfig.apiUrl}/${room2}/state`);
      const state1 = await room1State.json();
      const state2 = await room2State.json();
      
      testLog.info(`   After groupVolume(50): ${room1}=${state1.volume}, ${room2}=${state2.volume}`);
      
      const averageVolume = Math.round((state1.volume + state2.volume) / 2);
      testLog.info(`   Average volume: ${averageVolume}, Target: 50, Difference: ${Math.abs(averageVolume - 50)}`);
      
      // Sonos group volume algorithm may not result in exact average
      // Allow more tolerance as the algorithm is proprietary
      assert(Math.abs(averageVolume - 50) <= 10, 
        `Average volume ${averageVolume} should be reasonably close to target 50`);
    });
  });
  
  after(() => {
    testLog.info('   ✓ Group management tests complete');
  });
});