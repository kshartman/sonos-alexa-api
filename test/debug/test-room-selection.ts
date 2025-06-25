import { discoverSystem, getSafeTestRoom } from '../helpers/discovery.js';

// Test the new room selection logic
async function testRoomSelection() {
  console.log('\n🔍 Testing Room Selection Logic\n');
  
  try {
    const topology = await discoverSystem();
    console.log(`\nFound ${topology.zones.length} zones, ${topology.rooms.length} rooms`);
    
    console.log('\nTesting getSafeTestRoom...');
    const selectedRoom = await getSafeTestRoom(topology);
    console.log(`\nFinal selected room: ${selectedRoom}`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run test
testRoomSelection().catch(console.error);