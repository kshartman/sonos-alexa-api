import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';

// Test mute events when device starts in different states
async function testMuteWithInitialState() {
  console.log('\n🔍 Testing Mute Events with Different Initial States\n');
  
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
    
    // Test 1: Starting from unmuted state
    console.log('\n--- Test 1: Starting from UNMUTED ---');
    
    // Ensure we start unmuted
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/unmute`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    let state = await response.json();
    console.log(`Initial state: mute=${state.mute}`);
    
    // Try to mute (using /mute endpoint like the test)
    const mutePromise1 = eventManager.waitForMute(deviceId, true, 5000);
    console.log('Calling /mute...');
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
    
    const result1 = await mutePromise1;
    console.log(`Event received: ${result1}`);
    
    response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    state = await response.json();
    console.log(`Final state: mute=${state.mute}`);
    
    // Test 2: Starting from muted state
    console.log('\n--- Test 2: Starting from MUTED ---');
    
    // Ensure we start muted
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    state = await response.json();
    console.log(`Initial state: mute=${state.mute}`);
    
    // Try to toggle using /mute endpoint (should unmute if already muted)
    const mutePromise2 = eventManager.waitForMute(deviceId, false, 5000);
    console.log('Calling /mute again (should toggle)...');
    const muteResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
    console.log(`Response status: ${muteResponse.status}`);
    
    const result2 = await mutePromise2;
    console.log(`Event received: ${result2}`);
    
    response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    state = await response.json();
    console.log(`Final state: mute=${state.mute}`);
    
    // Test 3: Check what /mute actually does
    console.log('\n--- Test 3: /mute Endpoint Behavior ---');
    
    // Start unmuted
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/unmute`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    for (let i = 0; i < 3; i++) {
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      console.log(`\nBefore call ${i+1}: mute=${state.mute}`);
      
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      state = await response.json();
      console.log(`After call ${i+1}: mute=${state.mute}`);
    }
    
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    // Cleanup
    if (testRoom) {
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/unmute`);
    }
    eventManager.reset();
    stopEventBridge();
  }
}

// Run the test
testMuteWithInitialState().catch(console.error);