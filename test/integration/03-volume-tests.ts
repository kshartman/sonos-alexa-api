import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, isServerRunning } from '../helpers/server-manager.js';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom, SystemTopology } from '../helpers/discovery.js';
import { withSavedState } from '../helpers/state-manager.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';
import { loadTestContent } from '../helpers/content-loader.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Volume Control Integration Tests', { skip: skipIntegration, timeout: 60000 }, () => {
  let topology: SystemTopology;
  let testRoom: string;
  let deviceId: string;
  let originalVolume: number = 0;
  let eventManager: EventManager;

  before(async () => {
    console.log('\n🎵 Starting Volume Control Integration Tests...\n');
    eventManager = EventManager.getInstance();
    
    // Start event bridge to receive UPnP events
    await startEventBridge();
    
    topology = await discoverSystem();
    testRoom = await getSafeTestRoom(topology);
    
    // Get device ID for event tracking
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await zonesResponse.json();
    const device = zones.flatMap(z => z.members).find(m => m.roomName === testRoom);
    deviceId = device.id;
    
    // Save original state
    const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    const state = await stateResponse.json();
    originalVolume = state.volume || 50;
    console.log(`📊 Original volume: ${originalVolume}`);
    
    // Load content for volume testing
    console.log('📻 Loading content for volume testing...');
    
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
      console.log('⚠️  Failed to load content, volume tests may fail');
    }
  });

  after(async () => {
    console.log('\n🧹 Cleaning up Volume Control tests...\n');
    
    // Stop playback
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    
    // Restore volume
    if (testRoom && originalVolume > 0) {
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/${originalVolume}`);
      console.log(`✅ Restored volume to ${originalVolume}`);
    }
    
    // Stop event bridge
    stopEventBridge();
  });

  describe('Basic Volume Control', () => {
    // Ensure content is playing before volume tests
    before(async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await response.json();
      if (state.playbackState !== 'PLAYING' || !state.currentTrack) {
        console.log('🔄 Restarting playback for volume tests...');
        // If no content, reload it
        if (!state.currentTrack) {
          await loadTestContent(testRoom);
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
      console.log(`✅ Current volume: ${state.volume}`);
    });

    it('should set volume', async () => {
      const targetVolume = 25;
      
      // Listen for volume change event
      const volumePromise = eventManager.waitForVolume(deviceId, targetVolume, 5000);
      
      // Set volume
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/${targetVolume}`);
      assert.strictEqual(response.status, 200);
      
      // Wait for volume change event
      const volumeChanged = await volumePromise;
      assert(volumeChanged, 'Should receive volume change event');
      
      // Verify
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      assert.equal(state.volume, targetVolume, 'Volume should be set correctly');
      console.log(`✅ Volume set to ${targetVolume}`);
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
      console.log(`✅ Volume increased to ${state.volume}`);
      
      // Test decrease
      const decreasePromise = eventManager.waitForVolume(deviceId, 40, 5000);
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/-20`);
      await decreasePromise;
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      assert.equal(state.volume, 40, 'Volume should decrease by 20');
      console.log(`✅ Volume decreased to ${state.volume}`);
    });

    it('should handle volume boundaries', async () => {
      // Start from a known state
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/50`);
      await eventManager.waitForVolume(deviceId, 50, 3000);
      
      // Test maximum - set to 100 and wait for it
      console.log('   Testing maximum volume...');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/100`);
      const reachedMax = await eventManager.waitForVolume(deviceId, 100, 3000);
      
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      let state = await response.json();
      const maxVolume = state.volume;
      console.log(`   Max volume reached: ${maxVolume}`);
      
      // Some devices may have volume limits
      assert(maxVolume >= 50, 'Device should support volume of at least 50');
      if (!reachedMax && maxVolume < 100) {
        console.log(`   Note: Device appears to have max volume limit of ${maxVolume}`);
      }
      
      // Try to exceed maximum
      console.log('   Testing volume ceiling...');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/+10`);
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for state update
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      console.log(`   After +10 from ${maxVolume}: actual volume = ${state.volume}`);
      assert.equal(state.volume, maxVolume, 'Should not exceed device maximum');
      
      // Test minimum - with proper wait
      console.log('   Testing minimum volume...');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/0`);
      await eventManager.waitForVolume(deviceId, 0, 3000);
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      console.log(`   After setting to 0: actual volume = ${state.volume}`);
      assert.equal(state.volume, 0, 'Should set to minimum volume');
      
      // Try to go below minimum
      console.log('   Testing volume floor...');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/-10`);
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for state update
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      console.log(`   After -10 from 0: actual volume = ${state.volume}`);
      assert.equal(state.volume, 0, 'Should not go below minimum');
      
      console.log('✅ Volume boundaries handled correctly');
    });
  });

  describe('Mute Control', () => {
    // Ensure content is playing before mute tests
    before(async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await response.json();
      if (state.playbackState !== 'PLAYING' || !state.currentTrack) {
        console.log('🔄 Restarting playback for mute tests...');
        // If no content, reload it
        if (!state.currentTrack) {
          await loadTestContent(testRoom);
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
      console.log(`✅ Current mute state: ${state.mute}`);
    });

    it('should handle mute, unmute, and togglemute endpoints correctly', async () => {
      // Step 1: Ensure we start unmuted
      console.log('Step 1: Ensuring device starts unmuted...');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/unmute`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Give time for state to settle
      
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      let state = await response.json();
      assert.equal(state.mute, false, 'Device should start unmuted');
      console.log(`✅ Device is unmuted`);
      
      // Step 2: Test /mute endpoint (should always mute)
      console.log('\nStep 2: Testing /mute endpoint...');
      const mutePromise = eventManager.waitForMute(deviceId, true, 5000);
      
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
      const muteChanged = await mutePromise;
      assert(muteChanged, 'Should receive mute change event');
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      assert.equal(state.mute, true, 'Should be muted after calling /mute');
      console.log(`✅ /mute endpoint works correctly`);
      
      // Step 3: Test /mute again when already muted (should stay muted, no event)
      console.log('\nStep 3: Testing /mute when already muted...');
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      assert.equal(state.mute, true, 'Should remain muted when calling /mute on muted device');
      console.log(`✅ /mute correctly maintains muted state`);
      
      // Step 4: Test /unmute endpoint
      console.log('\nStep 4: Testing /unmute endpoint...');
      const unmutePromise = eventManager.waitForMute(deviceId, false, 5000);
      
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/unmute`);
      const unmuteChanged = await unmutePromise;
      assert(unmuteChanged, 'Should receive unmute event');
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      assert.equal(state.mute, false, 'Should be unmuted after calling /unmute');
      console.log(`✅ /unmute endpoint works correctly`);
      
      // Step 5: Test /togglemute endpoint (should mute from unmuted state)
      console.log('\nStep 5: Testing /togglemute from unmuted state...');
      const toggleMutePromise1 = eventManager.waitForMute(deviceId, true, 5000);
      
      const toggleResponse1 = await fetch(`${defaultConfig.apiUrl}/${testRoom}/togglemute`);
      const toggleResult1 = await toggleResponse1.json();
      assert.equal(toggleResult1.muted, true, 'togglemute response should indicate muted');
      
      const toggleChanged1 = await toggleMutePromise1;
      assert(toggleChanged1, 'Should receive mute event from togglemute');
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      assert.equal(state.mute, true, 'Should be muted after togglemute from unmuted state');
      console.log(`✅ /togglemute correctly mutes from unmuted state`);
      
      // Step 6: Test /togglemute again (should unmute from muted state)
      console.log('\nStep 6: Testing /togglemute from muted state...');
      const toggleMutePromise2 = eventManager.waitForMute(deviceId, false, 5000);
      
      const toggleResponse2 = await fetch(`${defaultConfig.apiUrl}/${testRoom}/togglemute`);
      const toggleResult2 = await toggleResponse2.json();
      assert.equal(toggleResult2.muted, false, 'togglemute response should indicate unmuted');
      
      const toggleChanged2 = await toggleMutePromise2;
      assert(toggleChanged2, 'Should receive unmute event from togglemute');
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      assert.equal(state.mute, false, 'Should be unmuted after togglemute from muted state');
      console.log(`✅ /togglemute correctly unmutes from muted state`);
    });

    it('should handle mute independently of volume', async () => {
      // Set volume and wait for change
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/30`);
      await eventManager.waitForVolume(deviceId, 30, 5000);
      
      // Mute and wait for change
      const mutePromise = eventManager.waitForMute(deviceId, true, 5000);
      
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
      await mutePromise;
      
      // Check volume is preserved
      let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      let state = await response.json();
      assert.equal(state.volume, 30, 'Volume should be preserved when muted');
      
      // Unmute and wait for change
      const unmutePromise = eventManager.waitForMute(deviceId, false, 5000);
      
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/unmute`);
      await unmutePromise;
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      assert.equal(state.volume, 30, 'Volume should be same after unmuting');
      console.log('✅ Mute works independently of volume');
    });
  });

  describe('Group Volume Control', () => {
    it('should control group volume if device is grouped', async () => {
      // Check if device is in a group
      const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
      const zones = await zonesResponse.json();
      
      const zone = zones.find((z: any) => 
        z.members.some((m: any) => m.roomName === testRoom)
      );
      
      // For proper group volume testing, we need to create a group first
      // Let's find another standalone device to group with
      const standaloneZones = zones.filter((z: any) => z.members.length === 1);
      
      if (standaloneZones.length < 2) {
        assert.fail('Need at least 2 standalone devices for group volume test');
      }
      
      // Create a group for testing
      const room1 = standaloneZones[0].coordinator;
      const room2 = standaloneZones[1].coordinator;
      
      console.log(`📊 Creating group for volume test: ${room2} joining ${room1}`);
      await fetch(`${defaultConfig.apiUrl}/${room2}/join/${room1}`);
      await eventManager.waitForTopologyChange(3000);
      
      // Now test group volume
      console.log(`📊 Testing group volume control`);
      
      // Get coordinator device ID
      const coordinatorId = standaloneZones[0].members[0].id;
      
      // Wait for volume change on coordinator
      const volumePromise = eventManager.waitForVolume(coordinatorId, 35, 5000);
      await fetch(`${defaultConfig.apiUrl}/${room1}/groupvolume/35`);
      
      const volumeChanged = await volumePromise;
      assert(volumeChanged, 'Group volume should trigger volume change event');
      console.log('✅ Group volume control tested');
      
      // Clean up - ungroup
      await fetch(`${defaultConfig.apiUrl}/${room2}/leave`);
      await eventManager.waitForTopologyChange(3000);
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
      
      console.log('✅ Invalid volume values handled gracefully');
    });
  });
});