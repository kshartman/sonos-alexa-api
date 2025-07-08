import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, getTestTimeout } from '../helpers/test-config.js';
import { globalTestSetup, globalTestTeardown, TestContext } from '../helpers/global-test-setup.js';
import { testLog } from '../helpers/test-logger.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Group Management Quick Tests', { skip: skipIntegration, timeout: getTestTimeout(30000) }, () => {
  let testContext: TestContext;
  let room1: string;
  let room2: string;
  let device1Id: string;
  let device2Id: string;

  before(async () => {
    testContext = await globalTestSetup('Group Management Quick Tests');
    
    // Need at least 2 rooms for group tests
    if (testContext.topology.rooms.length < 2) {
      testLog.info('⚠️  Skipping group tests - requires at least 2 Sonos devices');
      return;
    }
    
    // Get two standalone rooms for testing
    const standaloneZones = testContext.topology.zones.filter(zone => zone.members.length === 1);
    if (standaloneZones.length >= 2) {
      room1 = standaloneZones[0].coordinator;
      room2 = standaloneZones[1].coordinator;
    } else {
      // Just use first two rooms we can find
      room1 = testContext.topology.rooms[0];
      room2 = testContext.topology.rooms[1];
    }
    
    testLog.info(`👥 Test rooms: ${room1} and ${room2}`);
    
    // Get device IDs from the mapping
    device1Id = testContext.deviceIdMapping.get(room1) || '';
    device2Id = testContext.deviceIdMapping.get(room2) || '';
    
    if (!device1Id || !device2Id) {
      testLog.error('Failed to get device IDs for test rooms');
      return;
    }
    
    testLog.info(`📱 Device IDs: ${device1Id}, ${device2Id}`);
  });

  after(async () => {
    // Try to ungroup test rooms before global teardown
    if (room2) {
      try {
        await fetch(`${defaultConfig.apiUrl}/${room2}/leave`);
      } catch (error) {
        // Ignore errors
      }
    }
    
    await globalTestTeardown('Group Management Quick Tests', testContext);
  });

  it('should join and leave a group', async () => {
    if (!device1Id || !device2Id) {
      testLog.info('⚠️  Test skipped - not enough devices');
      return;
    }
    
    testLog.info('   Testing join...');
    
    // Debug: listen for any events  
    testContext.eventManager.on('topology-change', (event) => {
      testLog.info('   📡 Received topology-change event with', event.zones?.length, 'zones');
    });
    
    // Set up topology change listener BEFORE action
    const topologyPromise = testContext.eventManager.waitForTopologyChange(10000);
    
    // Join room2 to room1
    testLog.info(`   Joining ${room2} to ${room1}: ${defaultConfig.apiUrl}/${room2}/join/${room1}`);
    const joinResponse = await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
    testLog.info(`   Join response status: ${joinResponse.status}`);
    if (joinResponse.status !== 200) {
      const error = await joinResponse.text();
      testLog.info(`   Join error: ${error}`);
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
    testLog.info('   ✅ Group formed successfully');
    
    // Now test leave
    testLog.info('   Testing leave...');
    
    // Set up topology change listener for leave
    const leaveTopologyPromise = testContext.eventManager.waitForTopologyChange(5000);
    
    const leaveResponse = await fetch(`${defaultConfig.apiUrl}/${room2}/leave`);
    assert.strictEqual(leaveResponse.status, 200);
    
    // Wait for topology change event
    const leaveTopologyChanged = await leaveTopologyPromise;
    assert(leaveTopologyChanged, 'Should receive topology change event for leave');
    
    // Give the system a moment to fully stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify ungrouped
    const zonesResponse2 = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones2 = await zonesResponse2.json();
    
    const stillGrouped = zones2.find(zone => 
      zone.members.some(m => m.roomName === room1) &&
      zone.members.some(m => m.roomName === room2)
    );
    
    assert(!stillGrouped, 'Rooms should no longer be grouped');
    testLog.info('   ✅ Leave group successful');
  });

  it('should control group playback', async () => {
    if (!device1Id || !device2Id) {
      testLog.info('⚠️  Test skipped - not enough devices');
      return;
    }
    
    // First form a group
    const joinTopologyPromise = testContext.eventManager.waitForTopologyChange(5000);
    await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
    await joinTopologyPromise;
    
    testLog.info('   Testing group playback control...');
    
    // Load some content first (using TTS for simplicity)
    await fetch(`${defaultConfig.apiUrl}/${room1}/say/Testing group playback`);
    
    // Play on coordinator
    const playResponse = await fetch(`${defaultConfig.apiUrl}/${room1}/play`);
    assert.strictEqual(playResponse.status, 200);
    
    // Pause the group
    const pauseResponse = await fetch(`${defaultConfig.apiUrl}/${room1}/pause`);
    assert.strictEqual(pauseResponse.status, 200);
    
    testLog.info('   ✅ Group playback control working');
    
    // Clean up
    const leaveTopologyPromise = testContext.eventManager.waitForTopologyChange(5000);
    await fetch(`${defaultConfig.apiUrl}/${room2}/leave`);
    await leaveTopologyPromise;
  });
});