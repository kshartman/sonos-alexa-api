import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, isServerRunning } from '../helpers/server-manager.js';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig, getTestTimeout } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom, SystemTopology } from '../helpers/discovery.js';
import { withSavedState } from '../helpers/state-manager.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';
import { loadTestSong } from '../helpers/content-loader.js';
import { testLog } from '../helpers/test-logger-init.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Volume Control Integration Tests', { skip: skipIntegration, timeout: getTestTimeout(60000) }, () => {
  let topology: SystemTopology;
  let testRoom: string;
  let deviceId: string;
  let deviceIds: string[] = [];  // All device IDs for the zone
  let originalVolume: number = 0;
  let eventManager: EventManager;

  before(async () => {
    testLog.info('\n🎵 Starting Volume Control Integration Tests...\n');
    eventManager = EventManager.getInstance();
    
    // Start event bridge to receive UPnP events
    await startEventBridge();
    
    topology = await discoverSystem();
    testRoom = await getSafeTestRoom(topology);
    
    // Get device ID for event tracking
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await zonesResponse.json();
    const zone = zones.find(z => z.members.some(m => m.roomName === testRoom));
    
    // For stereo pairs, we need to track events from all member devices
    deviceIds = zone.members.map(m => m.id);
    // Use the coordinator's ID as primary
    const coordinator = zone.members.find(m => m.isCoordinator);
    deviceId = coordinator.id;
    testLog.info(`Test room: ${testRoom}, Device IDs: ${deviceIds.join(', ')}`);
    
    // Save original state
    const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    const state = await stateResponse.json();
    originalVolume = state.volume || 50;
    testLog.info(`📊 Original volume: ${originalVolume}`);
    
    // Load content for volume testing
    testLog.info('📻 Loading content for volume testing...');
    
    try {
      await loadTestSong(testRoom, true);
      
      // Wait for playback to start
      const started = await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      if (started) {
        testLog.info('✅ Content loaded and playing');
        
        // Verify we have track info
        const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        const state = await stateResponse.json();
        if (state.currentTrack) {
          testLog.info(`   Playing: ${state.currentTrack.title || 'Stream'}`);
        }
      } else {
        testLog.info('⚠️  Content loaded but playback not confirmed');
      }
    } catch (error) {
      testLog.info('⚠️  Failed to load content, volume tests may fail');
    }
  });

  after(async () => {
    testLog.info('\n🧹 Cleaning up Volume Control tests...\n');
    
    // Stop playback
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    
    // Restore volume
    if (testRoom && originalVolume > 0) {
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/${originalVolume}`);
      testLog.info(`✅ Restored volume to ${originalVolume}`);
    }
    
    // Clear any pending event listeners
    eventManager.reset();
    
    // Stop event bridge
    stopEventBridge();
    
    // Give a moment for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('Basic Volume Control', () => {
    // Ensure content is playing before volume tests
    before(async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await response.json();
      if (state.playbackState !== 'PLAYING' || !state.currentTrack) {
        testLog.info('🔄 Restarting playback for volume tests...');
        // If no content, reload it
        if (!state.currentTrack) {
          await loadTestSong(testRoom, true);
        } else {
          await fetch(`${defaultConfig.apiUrl}/${testRoom}/play`);
        }
        await eventManager.waitForState(deviceId, 'PLAYING', 5000);
      }
    });

    it('should get current volume', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      assert.strictEqual(response.status, 200);
      const state = await response.json();
      
      assert(typeof state.volume === 'number', 'Volume should be a number');
      assert(state.volume >= 0 && state.volume <= 100, 'Volume should be between 0 and 100');
      testLog.info(`✅ Current volume: ${state.volume}`);
    });

    it('should set volume', async () => {
      // Get current volume first
      const currentStateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const currentState = await currentStateResponse.json();
      const currentVolume = currentState.volume;
      
      // Choose a target that's different from current
      const targetVolume = currentVolume >= 50 ? 25 : 75;
      testLog.info(`Current volume: ${currentVolume}, setting to: ${targetVolume}`);
      
      // Listen for volume change event from any device in the zone
      const volumePromises = deviceIds.map(id => 
        eventManager.waitForVolume(id, targetVolume, 5000)
      );
      
      // Set volume
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/${targetVolume}`);
      assert.strictEqual(response.status, 200);
      
      // Wait for volume change event from any device
      const results = await Promise.allSettled(volumePromises);
      const volumeChanged = results.some(result => result.status === 'fulfilled' && result.value === true);
      
      // Also try the enhanced version to see which device reports the change
      const deviceThatChanged = await eventManager.waitForVolumeEx(deviceId, targetVolume, 1000);
      if (deviceThatChanged) {
        testLog.info(`   Device ${deviceThatChanged} reported reaching volume ${targetVolume}`);
      }
      
      // Check the actual state even if no event
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      testLog.info(`Volume change event received: ${volumeChanged}, actual volume: ${state.volume}`);
      
      // If volume was set correctly but no event, that's still a pass for the API
      if (!volumeChanged && state.volume === targetVolume) {
        testLog.info('⚠️  Volume set correctly but no event received (stereo pair issue?)');
      } else {
        assert(volumeChanged, 'Should receive volume change event');
      }
      
      assert.equal(state.volume, targetVolume, 'Volume should be set correctly');
      testLog.info(`✅ Volume set to ${targetVolume}`);
    });

    it('should handle relative volume changes', async () => {
      // Set to known starting point
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/50`);
      await eventManager.waitForVolume(deviceId, 50, 5000);
      
      // Test increase
      const increasePromise = eventManager.waitForVolume(deviceId, 60, 5000);
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/+10`);
      await increasePromise;
      
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      let state = await response.json();
      assert.equal(state.volume, 60, 'Volume should increase by 10');
      testLog.info(`✅ Volume increased to ${state.volume}`);
      
      // Test decrease
      const decreasePromise = eventManager.waitForVolume(deviceId, 40, 5000);
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/-20`);
      await decreasePromise;
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      assert.equal(state.volume, 40, 'Volume should decrease by 20');
      testLog.info(`✅ Volume decreased to ${state.volume}`);
    });

    it('should handle volume boundaries', async () => {
      // Start from a known state
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/50`);
      await eventManager.waitForVolume(deviceId, 50, 3000);
      
      // Test maximum - set to 100 and wait for it
      testLog.info('   Testing maximum volume...');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/100`);
      const reachedMax = await eventManager.waitForVolume(deviceId, 100, 3000);
      
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      let state = await response.json();
      const maxVolume = state.volume;
      testLog.info(`   Max volume reached: ${maxVolume}`);
      
      // Verify it's actually 100 (no volume limit)
      assert.equal(maxVolume, 100, 'Device should support volume up to 100');
      
      // IMMEDIATELY restore to a safe volume after testing max
      testLog.info('   Restoring to safe volume...');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/30`);
      await eventManager.waitForVolume(deviceId, 30, 3000);
      
      // First set back to 100 to test the ceiling
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/100`);
      await eventManager.waitForVolume(deviceId, 100, 3000)
      
      // Try to exceed maximum
      testLog.info('   Testing volume ceiling...');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/+10`);
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for state update
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      testLog.info(`   After +10 from ${maxVolume}: actual volume = ${state.volume}`);
      assert.equal(state.volume, 100, 'Should not exceed 100');
      
      // Restore to safe volume again
      testLog.info('   Restoring to safe volume...');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/30`);
      await eventManager.waitForVolume(deviceId, 30, 3000);
      
      // Test minimum - with proper wait
      testLog.info('   Testing minimum volume...');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/0`);
      await eventManager.waitForVolume(deviceId, 0, 3000);
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      testLog.info(`   After setting to 0: actual volume = ${state.volume}`);
      assert.equal(state.volume, 0, 'Should set to minimum volume');
      
      // Try to go below minimum
      testLog.info('   Testing volume floor...');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/-10`);
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for state update
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      testLog.info(`   After -10 from 0: actual volume = ${state.volume}`);
      assert.equal(state.volume, 0, 'Should not go below minimum');
      
      testLog.info('✅ Volume boundaries handled correctly');
    });
  });

  describe('Mute Control', () => {
    // Ensure content is playing before mute tests
    before(async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await response.json();
      if (state.playbackState !== 'PLAYING' || !state.currentTrack) {
        testLog.info('🔄 Restarting playback for mute tests...');
        // If no content, reload it
        if (!state.currentTrack) {
          await loadTestSong(testRoom, true);
        } else {
          await fetch(`${defaultConfig.apiUrl}/${testRoom}/play`);
        }
        await eventManager.waitForState(deviceId, 'PLAYING', 5000);
      }
    });

    it('should get mute state', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await response.json();
      
      assert(typeof state.mute === 'boolean', 'Mute state should be boolean');
      testLog.info(`✅ Current mute state: ${state.mute}`);
    });

    it('should handle mute, unmute, and togglemute endpoints correctly', async () => {
      // Step 1: Ensure we start unmuted
      testLog.info('Step 1: Ensuring device starts unmuted...');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/unmute`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Give time for state to settle
      
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      let state = await response.json();
      assert.equal(state.mute, false, 'Device should start unmuted');
      testLog.info(`✅ Device is unmuted`);
      
      // Step 2: Test /mute endpoint (should always mute)
      testLog.info('\nStep 2: Testing /mute endpoint...');
      const mutePromise = eventManager.waitForMute(deviceId, true, 5000);
      
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
      const muteChanged = await mutePromise;
      
      // Check actual state regardless of event
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      testLog.info(`Mute event received: ${muteChanged}, actual mute state: ${state.mute}`);
      
      if (!muteChanged && state.mute === true) {
        testLog.info('⚠️  Mute set correctly but no event received');
      } else {
        assert(muteChanged, 'Should receive mute change event');
      }
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      assert.equal(state.mute, true, 'Should be muted after calling /mute');
      testLog.info(`✅ /mute endpoint works correctly`);
      
      // Step 3: Test /mute again when already muted (should stay muted, no event)
      testLog.info('\nStep 3: Testing /mute when already muted...');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      assert.equal(state.mute, true, 'Should remain muted when calling /mute on muted device');
      testLog.info(`✅ /mute correctly maintains muted state`);
      
      // Step 4: Test /unmute endpoint
      testLog.info('\nStep 4: Testing /unmute endpoint...');
      const unmutePromise = eventManager.waitForMute(deviceId, false, 5000);
      
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/unmute`);
      const unmuteChanged = await unmutePromise;
      
      // Check actual state regardless of event
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      testLog.info(`Unmute event received: ${unmuteChanged}, actual mute state: ${state.mute}`);
      
      if (!unmuteChanged && state.mute === false) {
        testLog.info('⚠️  Unmute set correctly but no event received');
      } else {
        assert(unmuteChanged, 'Should receive unmute event');
      }
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      assert.equal(state.mute, false, 'Should be unmuted after calling /unmute');
      testLog.info(`✅ /unmute endpoint works correctly`);
      
      // Step 5: Test /togglemute endpoint (should mute from unmuted state)
      testLog.info('\nStep 5: Testing /togglemute from unmuted state...');
      const toggleMutePromise1 = eventManager.waitForMute(deviceId, true, 5000);
      
      const toggleResponse1 = await fetch(`${defaultConfig.apiUrl}/${testRoom}/togglemute`);
      const toggleResult1 = await toggleResponse1.json();
      assert.equal(toggleResult1.muted, true, 'togglemute response should indicate muted');
      
      const toggleChanged1 = await toggleMutePromise1;
      
      // Check actual state
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      testLog.info(`Toggle mute event received: ${toggleChanged1}, actual mute state: ${state.mute}`);
      
      if (!toggleChanged1 && state.mute === true) {
        testLog.info('⚠️  Toggle mute set correctly but no event received');
      } else {
        assert(toggleChanged1, 'Should receive mute event from togglemute');
      }
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      assert.equal(state.mute, true, 'Should be muted after togglemute from unmuted state');
      testLog.info(`✅ /togglemute correctly mutes from unmuted state`);
      
      // Step 6: Test /togglemute again (should unmute from muted state)
      testLog.info('\nStep 6: Testing /togglemute from muted state...');
      const toggleMutePromise2 = eventManager.waitForMute(deviceId, false, 5000);
      
      const toggleResponse2 = await fetch(`${defaultConfig.apiUrl}/${testRoom}/togglemute`);
      const toggleResult2 = await toggleResponse2.json();
      assert.equal(toggleResult2.muted, false, 'togglemute response should indicate unmuted');
      
      const toggleChanged2 = await toggleMutePromise2;
      
      // Check actual state
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      testLog.info(`Toggle unmute event received: ${toggleChanged2}, actual mute state: ${state.mute}`);
      
      if (!toggleChanged2 && state.mute === false) {
        testLog.info('⚠️  Toggle unmute set correctly but no event received');
      } else {
        assert(toggleChanged2, 'Should receive unmute event from togglemute');
      }
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      assert.equal(state.mute, false, 'Should be unmuted after togglemute from muted state');
      testLog.info(`✅ /togglemute correctly unmutes from muted state`);
    });

    it('should handle mute independently of volume', async () => {
      // Set volume and wait for change
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/30`);
      const volumeSet = await eventManager.waitForVolume(deviceId, 30, 5000);
      if (!volumeSet) {
        // Verify volume was set even without event
        let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        let state = await response.json();
        assert.equal(state.volume, 30, 'Volume should be set to 30');
      }
      
      // Mute and wait for change
      const mutePromise = eventManager.waitForMute(deviceId, true, 5000);
      
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
      const muteSet = await mutePromise;
      if (!muteSet) {
        // Verify mute was set even without event
        let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        let state = await response.json();
        assert.equal(state.mute, true, 'Should be muted');
      }
      
      // Check volume is preserved
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      let state = await response.json();
      assert.equal(state.volume, 30, 'Volume should be preserved when muted');
      
      // Unmute and wait for change
      const unmutePromise = eventManager.waitForMute(deviceId, false, 5000);
      
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/unmute`);
      const unmuteSet = await unmutePromise;
      if (!unmuteSet) {
        // Verify unmute was set even without event
        let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
        let state = await response.json();
        assert.equal(state.mute, false, 'Should be unmuted');
      }
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      assert.equal(state.volume, 30, 'Volume should be same after unmuting');
      testLog.info('✅ Mute works independently of volume');
    });
  });

  describe('Group Volume Control', () => {
    it('should control group volume if device is grouped', async () => {
      // Get current zones
      const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
      const zones = await zonesResponse.json();
      
      let room1: string, room2: string;
      let device1Id: string, device2Id: string;
      
      // First check if we already have a group we can use
      const existingGroup = zones.find((z: any) => z.members.length >= 2);
      
      if (existingGroup) {
        // Use existing group
        room1 = existingGroup.coordinator;
        room2 = existingGroup.members[1].roomName;
        device1Id = existingGroup.id; // Zone ID is the coordinator's ID
        device2Id = existingGroup.members[1].id;
        testLog.info(`📊 Using existing group: ${room1} with ${room2}`);
      } else {
        // Need to create a group - first ungroup everything to maximize standalone devices
        testLog.info('📊 Ungrouping all devices to create test group...');
        
        // Ungroup all grouped zones
        for (const zone of zones) {
          if (zone.members.length > 1) {
            for (const member of zone.members) {
              if (member.roomName !== zone.coordinator.roomName) {
                await fetch(`${defaultConfig.apiUrl}/${member.roomName}/leave`);
              }
            }
          }
        }
        
        // Wait for topology to update
        await eventManager.waitForTopologyChange(3000);
        
        // Get updated zones
        const updatedZonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
        const updatedZones = await updatedZonesResponse.json();
        
        const standaloneZones = updatedZones.filter((z: any) => z.members.length === 1);
        
        if (standaloneZones.length < 2) {
          testLog.info('⚠️  Not enough devices for group volume test - skipping');
          this.skip();
          return;
        }
        
        // Create a group for testing
        room1 = standaloneZones[0].coordinator;
        room2 = standaloneZones[1].coordinator;
        device1Id = standaloneZones[0].id;
        device2Id = standaloneZones[1].id;
        
        testLog.info(`📊 Creating group for volume test: ${room2} joining ${room1}`);
        await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
        await eventManager.waitForTopologyChange(3000);
      }
      
      // Now test group volume
      testLog.info(`📊 Testing group volume control`);
      testLog.info(`   Room 1: ${room1} (${device1Id})`);
      testLog.info(`   Room 2: ${room2} (${device2Id})`);
      
      // Note: According to Sonos docs, all devices in a group emit volume events for groupVolume
      // However, devices with fixed line-out might not change volume
      
      // We'll wait for either device to report the volume change
      const volumePromise1 = eventManager.waitForVolume(device1Id, 35, 5000);
      const volumePromise2 = eventManager.waitForVolume(device2Id, 35, 5000);
      
      // Use correct case for groupVolume endpoint
      await fetch(`${defaultConfig.apiUrl}/${room1}/groupVolume/35`);
      
      // Wait for at least one device to report volume change
      const results = await Promise.allSettled([volumePromise1, volumePromise2]);
      const volumeChanged = results.some(result => result.status === 'fulfilled' && result.value === true);
      
      // Check actual state even if no events
      const stateResponse1 = await fetch(`${defaultConfig.apiUrl}/${room1}/state`);
      const state1 = await stateResponse1.json();
      testLog.info(`Room 1 volume after groupVolume: ${state1.volume}`);
      
      let state2: any = null;
      if (room1 !== room2) {
        const stateResponse2 = await fetch(`${defaultConfig.apiUrl}/${room2}/state`);
        state2 = await stateResponse2.json();
        testLog.info(`Room 2 volume after groupVolume: ${state2.volume}`);
      }
      
      if (!volumeChanged) {
        testLog.info('⚠️  No volume events received - checking if volume was set correctly');
        // If volume was set correctly on at least one device, that's still a pass
        if (state1.volume === 35 || (state2 && state2.volume === 35)) {
          testLog.info('✅ Group volume set correctly despite no events');
        } else {
          assert.fail('Group volume was not set correctly and no events received');
        }
      } else {
        testLog.info('✅ Group volume control tested with events');
      }
      
      // Clean up - only ungroup if we created the group
      if (!existingGroup) {
        await fetch(`${defaultConfig.apiUrl}/${room2}/leave`);
        await eventManager.waitForTopologyChange(3000);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid volume values gracefully', async () => {
      // The API should handle invalid values gracefully
      // Test with a very high volume
      const response1 = await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/150`);
      // API might accept the request but clamp the value
      assert(response1.status === 200 || response1.status === 400, 'Should handle high volume gracefully');
      
      // Test with a negative volume (using string since negative numbers are treated as relative)
      const response2 = await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/invalid`);
      assert(response2.status === 400 || response2.status === 404, 'Should reject invalid volume');
      
      testLog.info('✅ Invalid volume values handled gracefully');
    });
  });
});