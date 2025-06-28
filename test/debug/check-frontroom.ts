import { defaultConfig } from '../helpers/test-config.js';

// Check FrontRoomSpeakers specifically
async function checkFrontRoom() {
  console.log('\n🔍 Checking FrontRoomSpeakers\n');
  
  try {
    // Check if it's part of a stereo pair
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await zonesResponse.json();
    
    const frontRoomZone = zones.find((z: any) => 
      z.members.some((m: any) => m.roomName === 'FrontRoomSpeakers')
    );
    
    if (frontRoomZone) {
      console.log('Zone info:');
      console.log(`  Coordinator: ${frontRoomZone.coordinator}`);
      console.log(`  Members: ${frontRoomZone.members.length}`);
      frontRoomZone.members.forEach((m: any) => {
        console.log(`    - ${m.roomName} (${m.id}) - Coordinator: ${m.isCoordinator}`);
      });
    }
    
    // Check favorites on coordinator vs member
    console.log('\n--- Checking favorites ---');
    const favResponse = await fetch(`${defaultConfig.apiUrl}/FrontRoomSpeakers/favorites/detailed`);
    console.log(`FrontRoomSpeakers favorites status: ${favResponse.status}`);
    
    if (favResponse.ok) {
      const favs = await favResponse.json();
      console.log(`Found ${favs.length} favorites`);
    } else {
      const error = await favResponse.text();
      console.log(`Error: ${error}`);
    }
    
    // Try the coordinator directly
    if (frontRoomZone && frontRoomZone.coordinator !== 'FrontRoomSpeakers') {
      console.log(`\nTrying coordinator (${frontRoomZone.coordinator}) instead:`);
      const coordFavResponse = await fetch(`${defaultConfig.apiUrl}/${frontRoomZone.coordinator}/favorites/detailed`);
      console.log(`Coordinator favorites status: ${coordFavResponse.status}`);
      
      if (coordFavResponse.ok) {
        const coordFavs = await coordFavResponse.json();
        console.log(`Found ${coordFavs.length} favorites on coordinator`);
      }
    }
    
    // Check device capabilities
    console.log('\n--- Checking device info ---');
    const stateResponse = await fetch(`${defaultConfig.apiUrl}/FrontRoomSpeakers/state`);
    if (stateResponse.ok) {
      const state = await stateResponse.json();
      console.log('Device state:');
      console.log(`  Playback: ${state.playbackState}`);
      console.log(`  Volume: ${state.volume}`);
      console.log(`  Mute: ${state.mute}`);
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run check
checkFrontRoom().catch(console.error);