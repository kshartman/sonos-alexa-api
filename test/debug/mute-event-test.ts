import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';

// Simple debug test for mute events
async function debugMuteEvents() {
  console.log('\n🔍 Debugging Mute Event Test\n');
  
  const eventManager = EventManager.getInstance();
  
  try {
    // Start event bridge
    console.log('1. Starting event bridge...');
    await startEventBridge();
    
    // Discover system
    console.log('2. Discovering system...');
    const topology = await discoverSystem();
    const testRoom = await getSafeTestRoom(topology);
    
    console.log(`3. Using test room: ${testRoom}`);
    
    // Get device ID
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await zonesResponse.json();
    const device = zones.flatMap(z => z.members).find(m => m.roomName === testRoom);
    const deviceId = device.id;
    
    console.log(`4. Device ID: ${deviceId}`);
    
    // Get initial state
    console.log('5. Getting initial state...');
    const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    const state = await stateResponse.json();
    console.log(`   Initial mute state: ${state.mute}`);
    
    // Listen for any mute-change events
    console.log('6. Setting up event listeners...');
    let eventReceived = false;
    
    eventManager.on('mute-change', (event) => {
      console.log('\n🎉 MUTE EVENT RECEIVED:');
      console.log(`   Device: ${event.deviceId}`);
      console.log(`   Room: ${event.roomName}`);
      console.log(`   Previous: ${event.previousMute}`);
      console.log(`   Current: ${event.currentMute}`);
      console.log(`   Timestamp: ${new Date(event.timestamp).toISOString()}`);
      eventReceived = true;
    });
    
    // Also listen for state changes to see if they're happening
    eventManager.on('state-change', (event) => {
      console.log('\n📊 STATE CHANGE EVENT:');
      console.log(`   Device: ${event.deviceId}`);
      console.log(`   State: ${event.previousState} -> ${event.currentState}`);
    });
    
    // Also monitor raw SSE events
    console.log('7. Testing mute toggle...');
    
    // Toggle mute
    console.log(`\n8. Calling ${defaultConfig.apiUrl}/${testRoom}/mute`);
    const muteResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
    console.log(`   Response status: ${muteResponse.status}`);
    if (!muteResponse.ok) {
      const text = await muteResponse.text();
      console.log(`   Response body: ${text}`);
    }
    
    // Wait a bit for events
    console.log('\n9. Waiting for events (5 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check final state
    console.log('\n10. Checking final state...');
    const finalStateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    const finalState = await finalStateResponse.json();
    console.log(`    Final mute state: ${finalState.mute}`);
    console.log(`    State changed: ${finalState.mute !== state.mute}`);
    console.log(`    Event received: ${eventReceived}`);
    
    // Try unmute to see if that works
    console.log('\n11. Testing unmute...');
    const unmuteResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/unmute`);
    console.log(`    Response status: ${unmuteResponse.status}`);
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Print mute history
    const muteHistory = eventManager['muteHistory'].get(deviceId);
    console.log('\n12. Mute event history:');
    if (muteHistory && muteHistory.length > 0) {
      muteHistory.forEach((event, i) => {
        console.log(`    ${i + 1}. ${event.previousMute} -> ${event.currentMute} at ${new Date(event.timestamp).toISOString()}`);
      });
    } else {
      console.log('    No mute events recorded');
    }
    
  } catch (error) {
    console.error('\n❌ Error during test:', error);
  } finally {
    // Clean up
    eventManager.reset();
    stopEventBridge();
    console.log('\n✅ Test complete\n');
  }
}

// Run the debug test
debugMuteEvents().catch(console.error);