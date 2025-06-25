import { defaultConfig } from '../helpers/test-config.js';

// Check what the Sonos system actually has
async function checkSonosData() {
  console.log('\n🔍 Checking Sonos System Data\n');
  
  try {
    // Check zones first
    console.log('--- Checking Zones ---');
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await zonesResponse.json();
    console.log(`Found ${zones.length} zones`);
    
    // List all rooms
    const allRooms = new Set<string>();
    zones.forEach((zone: any) => {
      zone.members.forEach((member: any) => {
        allRooms.add(member.roomName);
      });
    });
    console.log(`\nAll rooms: ${Array.from(allRooms).join(', ')}`);
    
    // Try favorites on different rooms
    console.log('\n--- Checking Favorites on Different Rooms ---');
    for (const room of Array.from(allRooms).slice(0, 3)) {
      console.log(`\nChecking ${room}:`);
      
      // Try both detailed and non-detailed
      const favResponse = await fetch(`${defaultConfig.apiUrl}/${room}/favorites`);
      console.log(`  Favorites (simple) status: ${favResponse.status}`);
      
      if (favResponse.ok) {
        const favs = await favResponse.json();
        console.log(`  Found ${favs.length} favorites (simple)`);
        if (favs.length > 0) {
          console.log(`  First few: ${favs.slice(0, 3).join(', ')}`);
        }
      }
      
      // Try detailed
      const favDetailedResponse = await fetch(`${defaultConfig.apiUrl}/${room}/favorites?detailed=true`);
      console.log(`  Favorites (detailed) status: ${favDetailedResponse.status}`);
      
      if (favDetailedResponse.ok) {
        const favsDetailed = await favDetailedResponse.json();
        console.log(`  Found ${favsDetailed.length} favorites (detailed)`);
      }
    }
    
    // Check music service accounts
    console.log('\n--- Checking Music Service Accounts ---');
    const accountsUrl = `${defaultConfig.apiUrl}/${Array.from(allRooms)[0]}/debug/accounts`;
    console.log(`Checking accounts at: ${accountsUrl}`);
    
    const accountsResponse = await fetch(accountsUrl);
    console.log(`Accounts response status: ${accountsResponse.status}`);
    
    if (accountsResponse.ok) {
      const accounts = await accountsResponse.json();
      console.log('Accounts data:', JSON.stringify(accounts, null, 2));
    }
    
    // Try to get state from a coordinator
    console.log('\n--- Checking Coordinator State ---');
    const coordinator = zones.find((z: any) => z.members.length === 1)?.coordinator || zones[0]?.coordinator;
    if (coordinator) {
      console.log(`\nChecking coordinator: ${coordinator}`);
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${coordinator}/state`);
      if (stateResponse.ok) {
        const state = await stateResponse.json();
        console.log('Coordinator state:');
        console.log(`  Playback: ${state.playbackState}`);
        console.log(`  Volume: ${state.volume}`);
        console.log(`  Mute: ${state.mute}`);
        console.log(`  Current track: ${state.currentTrack?.title || 'None'}`);
      }
    }
    
    // Check a specific favorite if we know one exists
    console.log('\n--- Testing Known Favorite ---');
    const testRoom = Array.from(allRooms)[0];
    const knownFavorite = 'All Classical Portland'; // From earlier logs
    console.log(`Trying to play "${knownFavorite}" on ${testRoom}`);
    
    const playFavResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/favorite/${encodeURIComponent(knownFavorite)}`);
    console.log(`Play favorite response: ${playFavResponse.status}`);
    
    if (!playFavResponse.ok) {
      const error = await playFavResponse.text();
      console.log(`Error: ${error}`);
    } else {
      console.log('Successfully played favorite!');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run check
checkSonosData().catch(console.error);