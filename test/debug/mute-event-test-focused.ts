import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';
import { loadTestSong } from '../helpers/content-loader.js';
import assert from 'node:assert/strict';

// Focused test that mimics the actual test more closely
async function testMuteEvent() {
  console.log('\n🔍 Testing Mute Event (Focused)\n');
  
  const eventManager = EventManager.getInstance();
  let testRoom: string;
  let deviceId: string;
  
  try {
    // Start event bridge
    await startEventBridge();
    
    // Discover and setup
    const topology = await discoverSystem();
    testRoom = await getSafeTestRoom(topology);
    
    // Get device ID
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await zonesResponse.json();
    const device = zones.flatMap(z => z.members).find(m => m.roomName === testRoom);
    deviceId = device.id;
    
    console.log(`Test room: ${testRoom}`);
    console.log(`Device ID: ${deviceId}`);
    
    // Load content and start playing (like the real test does)
    console.log('Loading test content...');
    await loadTestSong(testRoom, true);
    await eventManager.waitForState(deviceId, 'PLAYING', 10000);
    console.log('Content loaded and playing');
    
    // Test 1: Basic mute toggle (exactly like the real test)
    console.log('\n--- Test 1: Basic Mute Toggle ---');
    
    // Get initial state
    let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    let state = await response.json();
    const initialMute = state.mute;
    console.log(`Initial mute state: ${initialMute}`);
    
    // Toggle mute - EXACTLY like the real test
    const mutePromise = eventManager.waitForMute(deviceId, !initialMute, 5000);
    
    console.log('Calling /mute endpoint...');
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
    
    console.log('Waiting for mute event...');
    const muteChanged = await mutePromise;
    
    if (!muteChanged) {
      console.log('❌ Mute event NOT received within timeout!');
      
      // Check if state actually changed
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      console.log(`Current mute state: ${state.mute}`);
      console.log(`State actually changed: ${state.mute !== initialMute}`);
    } else {
      console.log('✅ Mute event received!');
    }
    
    // Test 2: Check event timing
    console.log('\n--- Test 2: Event Timing ---');
    
    // Unmute first
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/unmute`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Now test with timing info
    const startTime = Date.now();
    const timedMutePromise = eventManager.waitForMute(deviceId, true, 5000);
    
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
    
    const timedResult = await timedMutePromise;
    const elapsed = Date.now() - startTime;
    
    console.log(`Event received: ${timedResult}`);
    console.log(`Time elapsed: ${elapsed}ms`);
    
    // Test 3: Check for duplicate events
    console.log('\n--- Test 3: Duplicate Events ---');
    
    let eventCount = 0;
    const duplicateHandler = (event) => {
      if (event.deviceId === deviceId) {
        eventCount++;
        console.log(`Event #${eventCount} at ${Date.now() - testStartTime}ms`);
      }
    };
    
    eventManager.on('mute-change', duplicateHandler);
    
    // Unmute first
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/unmute`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const testStartTime = Date.now();
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
    
    // Wait to collect all events
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    eventManager.off('mute-change', duplicateHandler);
    console.log(`Total events received: ${eventCount}`);
    
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    // Cleanup
    if (testRoom && deviceId) {
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/unmute`);
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    }
    eventManager.reset();
    stopEventBridge();
  }
}

// Run the test
testMuteEvent().catch(console.error);