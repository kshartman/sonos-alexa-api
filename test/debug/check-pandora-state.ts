#!/usr/bin/env tsx

const API_URL = 'http://localhost:5005';
const testRoom = process.env.TEST_ROOM || 'OfficeSpeakers';

async function main() {
  try {
    // Get current state
    console.log(`\nChecking state for room: ${testRoom}...`);
    const response = await fetch(`${API_URL}/${testRoom}/state`);
    
    if (!response.ok) {
      console.error(`Failed to get state: ${response.status} ${response.statusText}`);
      return;
    }
    
    const state = await response.json();
    
    console.log(`\nPlayback State: ${state.playbackState}`);
    console.log(`Volume: ${state.volume}`);
    console.log(`Mute: ${state.mute}`);
    
    if (state.currentTrack) {
      console.log('\nCurrent Track:');
      console.log(`  Title: ${state.currentTrack.title || 'N/A'}`);
      console.log(`  Artist: ${state.currentTrack.artist || 'N/A'}`);
      console.log(`  Album: ${state.currentTrack.album || 'N/A'}`);
      console.log(`  URI: ${state.currentTrack.uri || 'N/A'}`);
      
      // Check if it's Pandora
      if (state.currentTrack.uri?.includes('pandora') || state.currentTrack.uri?.includes('sid=236')) {
        console.log('\n✅ Pandora is currently playing!');
        
        // Extract station info from URI
        const uriMatch = state.currentTrack.uri.match(/ST[:%]3a([^?&]+)/i);
        if (uriMatch) {
          console.log(`  Station ID: ${decodeURIComponent(uriMatch[1])}`);
        }
        
        const snMatch = state.currentTrack.uri.match(/sn=(\d+)/);
        if (snMatch) {
          console.log(`  Session Number: ${snMatch[1]}`);
        }
        
        const flagsMatch = state.currentTrack.uri.match(/flags=(\d+)/);
        if (flagsMatch) {
          console.log(`  Flags: ${flagsMatch[1]}`);
        }
      } else {
        console.log('\n❌ Pandora is NOT playing');
      }
    } else {
      console.log('\nNo current track information');
    }
    
    // Try to clear Pandora session
    console.log('\n\nAttempting to clear Pandora session...');
    const clearResponse = await fetch(`${API_URL}/${testRoom}/pandora/clear`, { method: 'GET' });
    if (clearResponse.ok) {
      console.log('✅ Pandora session cleared successfully');
    } else {
      console.log(`❌ Failed to clear session: ${clearResponse.status}`);
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main();