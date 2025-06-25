import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom, SystemTopology } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Group Management Quick Tests', { skip: skipIntegration, timeout: 30000 }, () => {
  let topology: SystemTopology;
  let room1: string;
  let room2: string;
  let device1Id: string;
  let device2Id: string;
  let eventManager: EventManager;

  before(async () => {
    console.log('\n👥 Running quick group management tests...\n');
    eventManager = EventManager.getInstance();
    
    // Start event bridge
    await startEventBridge();
    
    topology = await discoverSystem();
    
    // Need at least 2 rooms for group tests
    if (topology.rooms.length < 2) {
      console.log('⚠️  Skipping group tests - requires at least 2 Sonos devices');
      return;
    }
    
    // Get two standalone rooms for testing
    const standaloneZones = topology.zones.filter(zone => zone.members.length === 1);
    if (standaloneZones.length >= 2) {
      room1 = standaloneZones[0].coordinator;
      room2 = standaloneZones[1].coordinator;
    } else {
      // Just use first two rooms we can find
      room1 = topology.rooms[0];
      room2 = topology.rooms[1];
    }
    
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

  after(async () => {
    console.log('\n🧹 Cleaning up quick group tests...\n');
    
    // Try to ungroup test rooms
    try {
      await fetch(`${defaultConfig.apiUrl}/${room2}/leave`);
    } catch (error) {
      // Ignore errors
    }
    
    stopEventBridge();
  });

  it('should join and leave a group', async () => {
    console.log('   Testing join...');
    
    // Reset event manager for clean test
    eventManager.reset();
    
    // Debug: listen for any events  
    eventManager.on('topology-change', (event) => {
      console.log('   📡 Received topology-change event with', event.zones?.length, 'zones');
    });
    
    // Set up topology change listener BEFORE action
    const topologyPromise = eventManager.waitForTopologyChange(10000);
    
    // Join room2 to room1
    console.log(`   Joining ${room2} to ${room1}: ${defaultConfig.apiUrl}/${room2}/join/${room1}`);
    const joinResponse = await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
    console.log(`   Join response status: ${joinResponse.status}`);
    if (joinResponse.status !== 200) {
      const error = await joinResponse.text();
      console.log(`   Join error: ${error}`);
    }
    assert.strictEqual(joinResponse.status, 200);
    
    // Wait for topology change event
    const topologyChanged = await topologyPromise;
    assert(topologyChanged, 'Should receive topology change event');
    
    // Verify group formed
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await zonesResponse.json();
    
    const groupZone = zones.find(zone => 
      zone.members.some(m => m.roomName === room1) &&
      zone.members.some(m => m.roomName === room2)
    );
    
    assert(groupZone, 'Rooms should be in the same group');
    console.log('   ✅ Group formed successfully');
    
    // Now test leave
    console.log('   Testing leave...');
    
    // Set up topology change listener for leave
    const leaveTopologyPromise = eventManager.waitForTopologyChange(5000);
    
    const leaveResponse = await fetch(`${defaultConfig.apiUrl}/${room2}/leave`);
    assert.strictEqual(leaveResponse.status, 200);
    
    // Wait for topology change event
    const leaveTopologyChanged = await leaveTopologyPromise;
    assert(leaveTopologyChanged, 'Should receive topology change event for leave');
    
    // Verify ungrouped
    const zonesResponse2 = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones2 = await zonesResponse2.json();
    
    const stillGrouped = zones2.find(zone => 
      zone.members.some(m => m.roomName === room1) &&
      zone.members.some(m => m.roomName === room2)
    );
    
    assert(!stillGrouped, 'Rooms should no longer be grouped');
    console.log('   ✅ Leave group successful');
  });

  it('should control group playback', async () => {
    // Reset event manager for clean test
    eventManager.reset();
    
    // First form a group
    const joinTopologyPromise = eventManager.waitForTopologyChange(5000);
    await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
    await joinTopologyPromise;
    
    console.log('   Testing group playback control...');
    
    // Load some content first (using TTS for simplicity)
    await fetch(`${defaultConfig.apiUrl}/${room1}/say/Testing group playback`);
    
    // Play on coordinator
    const playResponse = await fetch(`${defaultConfig.apiUrl}/${room1}/play`);
    assert.strictEqual(playResponse.status, 200);
    
    // Pause the group
    const pauseResponse = await fetch(`${defaultConfig.apiUrl}/${room1}/pause`);
    assert.strictEqual(pauseResponse.status, 200);
    
    console.log('   ✅ Group playback control working');
    
    // Clean up
    const leaveTopologyPromise = eventManager.waitForTopologyChange(5000);
    await fetch(`${defaultConfig.apiUrl}/${room2}/leave`);
    await leaveTopologyPromise;
  });
});