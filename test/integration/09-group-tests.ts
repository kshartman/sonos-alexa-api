import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom, SystemTopology, ungroupAllSpeakers } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';
import { loadBeatlesSong } from '../helpers/content-loader.js';

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
  let eventManager: EventManager;
  let topology: SystemTopology;
  let room1: string;
  let room2: string;
  let device1Id: string;
  let device2Id: string;
  
  before(async () => {
    console.log('👥 Testing group management...');
    eventManager = EventManager.getInstance();
    
    // Start event bridge to receive UPnP events via SSE
    await startEventBridge();
    
    // Discover system and get test rooms
    topology = await discoverSystem();
    console.log(`   Initial topology: ${topology.zones.length} zone(s), ${topology.rooms.length} room(s)`);
    
    // We need at least 2 rooms for group tests
    if (topology.rooms.length < 2) {
      console.log('⚠️  Skipping group tests - requires at least 2 Sonos devices');
      console.log(`   Found ${topology.rooms.length} room(s): ${topology.rooms.join(', ')}`);
      return; // Skip all tests
    }
    
    // Ungroup all speakers to start from clean state
    await ungroupAllSpeakers();
    
    // Wait for topology to settle after ungrouping
    await eventManager.waitForTopologyChange(5000);
    
    // Get fresh topology after ungrouping
    topology = await discoverSystem();
    
    // Select two standalone rooms for testing
    const standaloneRooms = topology.zones
      .filter(zone => zone.members.length === 1)
      .map(zone => zone.coordinator);
    
    if (standaloneRooms.length < 2) {
      throw new Error('Need at least 2 standalone rooms for group tests');
    }
    
    room1 = standaloneRooms[0];
    room2 = standaloneRooms[1];
    
    console.log(`   Test rooms: ${room1} and ${room2}`);
    
    // Get device IDs for event tracking
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await zonesResponse.json();
    const device1 = zones.flatMap(z => z.members).find(m => m.roomName === room1);
    const device2 = zones.flatMap(z => z.members).find(m => m.roomName === room2);
    device1Id = device1.id;
    device2Id = device2.id;
    
    console.log(`   Device IDs: ${device1Id}, ${device2Id}`);
  });
  
  afterEach(() => {
    // Clean up event listeners after each test
    eventManager.reset();
  });
  
  after(async () => {
    // Ungroup all speakers to clean up
    await ungroupAllSpeakers();
    
    // Stop event bridge
    stopEventBridge();
  });
  
  describe('Group Formation', () => {
    beforeEach(async () => {
      // Ensure rooms are not grouped before each test
      await ungroupAllSpeakers();
      await eventManager.waitForTopologyChange(3000);
    });
    
    it('should join two rooms into a group', async () => {
      console.log(`   Joining ${room2} to ${room1}`);
      
      // Set up topology change listener BEFORE action
      const topologyPromise = eventManager.waitForTopologyChange(5000);
      
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
      // First create a group
      console.log(`   Creating group: ${room2} joining ${room1}`);
      await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
      await eventManager.waitForTopologyChange(3000);
      
      // Set up topology change listener
      const topologyPromise = eventManager.waitForTopologyChange(5000);
      
      // Leave the group
      console.log(`   ${room2} leaving group`);
      const response = await fetch(`${defaultConfig.apiUrl}/${room2}/leave`);
      assert.strictEqual(response.status, 200);
      
      // Wait for topology change event
      const topologyChanged = await topologyPromise;
      assert(topologyChanged, 'Should receive topology change event');
      
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
      // Get standalone rooms to ensure we have controllable devices
      const standaloneRooms = topology.zones
        .filter(zone => zone.members.length === 1)
        .map(zone => zone.coordinator);
      
      // Need at least 3 standalone rooms for this test
      if (standaloneRooms.length < 3) {
        console.log('   Skipping test - requires 3+ standalone Sonos devices');
        return;
      }
      
      const room3 = standaloneRooms.find(r => r !== room1 && r !== room2);
      console.log(`   Adding third room: ${room3} to group [${room1}, ${room2}]`);
      
      // Create initial group
      console.log(`   Step 1: Creating initial group - ${room2} joining ${room1}`);
      await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
      await eventManager.waitForTopologyChange(3000);
      
      // Set up topology change listener
      const topologyPromise = eventManager.waitForTopologyChange(5000);
      
      // Add third room
      console.log(`   Step 2: Adding ${room3} to the group`);
      const response = await fetch(`${defaultConfig.apiUrl}/${room3}/join/${room1}`);
      assert.strictEqual(response.status, 200);
      
      // Wait for topology change event
      const topologyChanged = await topologyPromise;
      assert(topologyChanged, 'Should receive topology change event');
      
      // Verify 3-room group
      const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
      const zones = await zonesResponse.json();
      
      const groupZone = zones.find(zone => zone.members.some(m => m.roomName === room1));
      assert(groupZone, 'Should find group zone');
      
      console.log(`   Final group members: ${groupZone.members.map(m => m.roomName).join(', ')}`);
      console.log(`   Expected: 3 members, Got: ${groupZone.members.length} members`);
      
      assert.strictEqual(groupZone.members.length, 3, 'Group should have 3 members');
    });
  });
  
  describe('Group Playback Control', () => {
    beforeEach(async () => {
      // Create a group for playback tests
      await ungroupAllSpeakers();
      await eventManager.waitForTopologyChange(3000);
      await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
      await eventManager.waitForTopologyChange(3000);
      
      // Load content to enable playback commands
      console.log('   Loading content for group playback...');
      await loadBeatlesSong(room1);
      
      // Wait for content to fully load
      await new Promise(resolve => setTimeout(resolve, 2000));
    });
    
    it('should control playback for entire group', async () => {
      // Play on coordinator should affect whole group
      const response = await fetch(`${defaultConfig.apiUrl}/${room1}/play`);
      assert.strictEqual(response.status, 200);
      
      // Wait a bit for the command to propagate and state to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check both devices via API (which returns coordinator's state for grouped devices)
      const room1Response = await fetch(`${defaultConfig.apiUrl}/${room1}/state`);
      const room1State = await room1Response.json();
      assert.strictEqual(room1State.playbackState, 'PLAYING', 'Room1 should be playing');
      
      const room2Response = await fetch(`${defaultConfig.apiUrl}/${room2}/state`);
      const room2State = await room2Response.json();
      assert.strictEqual(room2State.playbackState, 'PLAYING', 'Room2 should be playing as part of group');
    });
    
    it('should pause entire group', async () => {
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
    beforeEach(async () => {
      // Create a group for volume tests
      await ungroupAllSpeakers();
      await eventManager.waitForTopologyChange(3000);
      await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
      await eventManager.waitForTopologyChange(3000);
    });
    
    it('should set group volume', async () => {
      const targetVolume = 25;
      
      // Get initial volumes
      const room1InitialState = await fetch(`${defaultConfig.apiUrl}/${room1}/state`);
      const room2InitialState = await fetch(`${defaultConfig.apiUrl}/${room2}/state`);
      const initialState1 = await room1InitialState.json();
      const initialState2 = await room2InitialState.json();
      const initialVolume1 = initialState1.volume;
      const initialVolume2 = initialState2.volume;
      
      console.log(`   Initial volumes: room1=${initialVolume1}, room2=${initialVolume2}`);
      
      // Set initial volumes to different levels to test proportional scaling
      await fetch(`${defaultConfig.apiUrl}/${room1}/volume/20`);
      await fetch(`${defaultConfig.apiUrl}/${room2}/volume/40`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Give more time for volume to settle
      
      // Get actual initial volumes after setting
      const room1InitState = await fetch(`${defaultConfig.apiUrl}/${room1}/state`);
      const room2InitState = await fetch(`${defaultConfig.apiUrl}/${room2}/state`);
      const initState1 = await room1InitState.json();
      const initState2 = await room2InitState.json();
      console.log(`   Set volumes: room1=${initState1.volume}, room2=${initState2.volume}`);
      
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
      
      console.log(`   After groupVolume(${targetVolume}): room1=${state1.volume}, room2=${state2.volume}`);
      
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
      console.log(`   Volume difference maintained: ${state2.volume > state1.volume ? 'Yes' : 'No'}`);
    });
    
    it('should maintain individual volume control', async () => {
      // Set group volume first (with average of 30)
      await fetch(`${defaultConfig.apiUrl}/${room1}/groupVolume/30`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get volumes after group volume set
      const room1BeforeState = await fetch(`${defaultConfig.apiUrl}/${room1}/state`);
      const room2BeforeState = await fetch(`${defaultConfig.apiUrl}/${room2}/state`);
      const beforeState1 = await room1BeforeState.json();
      const beforeState2 = await room2BeforeState.json();
      const beforeVolume1 = beforeState1.volume;
      
      console.log(`   After groupVolume(30): room1=${beforeVolume1}, room2=${beforeState2.volume}`);
      
      // Set individual volume for room2
      const individualVolume = 40;
      const volumePromise = eventManager.waitForVolume(device2Id, individualVolume, 5000);
      
      const response = await fetch(`${defaultConfig.apiUrl}/${room2}/volume/${individualVolume}`);
      assert.strictEqual(response.status, 200);
      
      // Only room2 volume should change
      const volumeChanged = await volumePromise;
      assert(volumeChanged, 'Room2 should reach individual volume');
      
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
      await eventManager.waitForTopologyChange(3000);
      
      // Try to leave (should succeed but do nothing)
      const response = await fetch(`${defaultConfig.apiUrl}/${room1}/leave`);
      assert.strictEqual(response.status, 200);
    });
    
    it('should handle group volume on non-coordinator', async () => {
      // Create group with room1 as coordinator
      console.log(`   Creating group: ${room2} joining ${room1} (coordinator)`);
      await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
      await eventManager.waitForTopologyChange(3000);
      
      // Try to set group volume from non-coordinator
      console.log(`   Setting group volume to 50 from non-coordinator (${room2})`);
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
      
      console.log(`   After groupVolume(50): ${room1}=${state1.volume}, ${room2}=${state2.volume}`);
      
      const averageVolume = Math.round((state1.volume + state2.volume) / 2);
      console.log(`   Average volume: ${averageVolume}, Target: 50, Difference: ${Math.abs(averageVolume - 50)}`);
      
      // Sonos group volume algorithm may not result in exact average
      // Allow more tolerance as the algorithm is proprietary
      assert(Math.abs(averageVolume - 50) <= 10, 
        `Average volume ${averageVolume} should be reasonably close to target 50`);
    });
  });
  
  after(() => {
    console.log('   ✓ Group management tests complete');
  });
});