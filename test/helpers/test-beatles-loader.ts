#!/usr/bin/env tsx
/**
 * Test the loadBeatlesSong helper function in isolation
 */

import { loadBeatlesSong } from './content-loader.js';
import { defaultConfig } from './test-config.js';
import { discoverSystem } from './discovery.js';

async function testBeatlesLoader() {
  console.log('🎵 Testing Beatles song loader...\n');
  
  try {
    // First discover the system to get available rooms
    console.log('Discovering Sonos system...');
    const topology = await discoverSystem();
    console.log(`Found ${topology.rooms.length} rooms: ${topology.rooms.join(', ')}\n`);
    
    if (topology.rooms.length === 0) {
      throw new Error('No Sonos devices found');
    }
    
    // Test with a safe standalone room
    const { getSafeTestRoom } = await import('./discovery.js');
    const testRoom = await getSafeTestRoom(topology);
    console.log(`Testing with safe standalone room: ${testRoom}`);
    await loadBeatlesSong(testRoom);
    console.log('✅ Successfully loaded Beatles song\n');
    
    // Get current state to verify
    const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    if (stateResponse.ok) {
      const state = await stateResponse.json();
      console.log('Current track info:');
      console.log(`  Title: ${state.currentTrack?.title}`);
      console.log(`  Artist: ${state.currentTrack?.artist}`);
      console.log(`  Album: ${state.currentTrack?.album}`);
      console.log(`  Duration: ${state.currentTrack?.duration}`);
      
      // Verify it's actually The Beatles
      const artist = state.currentTrack?.artist?.toLowerCase() || '';
      if (artist.includes('beatles')) {
        console.log('\n✅ Verified: Track is by The Beatles');
      } else {
        console.log(`\n❌ ERROR: Artist is "${state.currentTrack?.artist}" - not The Beatles!`);
        process.exit(1);
      }
    }
    
  } catch (error) {
    console.error('❌ Failed to load Beatles song:', error.message);
    process.exit(1);
  }
}

// Run the test
testBeatlesLoader().catch(console.error);