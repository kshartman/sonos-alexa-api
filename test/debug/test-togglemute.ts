import { defaultConfig } from '../helpers/test-config.js';

// Quick test for toggleMute endpoint
async function testToggleMute() {
  console.log('\n🔍 Testing toggleMute endpoint\n');
  
  const testRoom = 'DockSpeakers';
  
  try {
    // Get initial state
    let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    let state = await response.json();
    console.log(`Initial mute state: ${state.mute}`);
    
    // Test toggleMute
    console.log('\nCalling /togglemute...');
    response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/togglemute`);
    const toggleResult = await response.json();
    console.log(`Response:`, toggleResult);
    
    // Verify state changed
    response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    state = await response.json();
    console.log(`New mute state: ${state.mute}`);
    
    // Toggle again
    console.log('\nCalling /togglemute again...');
    response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/togglemute`);
    const toggleResult2 = await response.json();
    console.log(`Response:`, toggleResult2);
    
    // Verify state changed back
    response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    state = await response.json();
    console.log(`Final mute state: ${state.mute}`);
    
  } catch (error) {
    console.error('Test error:', error);
  }
}

// Run the test
testToggleMute().catch(console.error);