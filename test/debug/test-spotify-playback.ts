#!/usr/bin/env npx tsx
import logger from '../../src/utils/logger.js';

// Test configuration
const baseUrl = 'http://localhost:5005';
const room = 'OfficeSpeakers';

interface TestCase {
  name: string;
  url: string;
  description: string;
}

const testCases: TestCase[] = [
  {
    name: 'Track: Yesterday by The Beatles',
    url: `${baseUrl}/${room}/spotify/now/track:Yesterday`,
    description: 'Playing a single track'
  },
  {
    name: 'Album: Abbey Road by The Beatles',
    url: `${baseUrl}/${room}/spotify/now/album:Abbey%20Road`,
    description: 'Playing an entire album'
  },
  {
    name: 'Playlist: Today\'s Top Hits',
    url: `${baseUrl}/${room}/spotify/now/playlist:Today's%20Top%20Hits`,
    description: 'Playing a popular Spotify playlist'
  }
];

async function testSpotifyPlayback(testCase: TestCase): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${testCase.name}`);
  console.log(`Description: ${testCase.description}`);
  console.log(`URL: ${testCase.url}`);
  console.log(`${'='.repeat(60)}`);

  try {
    const response = await fetch(testCase.url);
    const responseText = await response.text();

    console.log(`Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      console.log('✅ SUCCESS - Request accepted');
      console.log(`Response: ${responseText}`);
      
      // Wait a moment then check state
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get current state to verify playback
      const stateResponse = await fetch(`${baseUrl}/${room}/state`);
      if (stateResponse.ok) {
        const state = await stateResponse.json();
        console.log('\nCurrent playback state:');
        console.log(`  Playing: ${state.playbackState}`);
        console.log(`  Track: ${state.currentTrack?.title || 'N/A'}`);
        console.log(`  Artist: ${state.currentTrack?.artist || 'N/A'}`);
        console.log(`  Album: ${state.currentTrack?.album || 'N/A'}`);
        
        if (state.currentTrack?.uri) {
          console.log(`  URI: ${state.currentTrack.uri}`);
          
          // Check if it's actually playing Spotify content
          if (state.currentTrack.uri.includes('spotify')) {
            console.log('✅ Confirmed: Playing Spotify content');
          }
        }
      }
    } else {
      console.log('❌ FAILED - Request failed');
      console.log(`Error: ${responseText}`);
    }
  } catch (error) {
    console.log('❌ ERROR - Request failed');
    console.error(error);
  }
}

async function main() {
  console.log('Starting Spotify Playback Tests');
  console.log('==============================');
  console.log(`Target: ${room}`);
  console.log(`Server: ${baseUrl}`);
  
  // First, let's check if the server is running
  try {
    const healthCheck = await fetch(`${baseUrl}/health`);
    if (!healthCheck.ok) {
      console.error('❌ Server is not responding. Please start the server first.');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Cannot connect to server. Please start the server first.');
    process.exit(1);
  }

  // Run each test with a delay between them
  for (const testCase of testCases) {
    await testSpotifyPlayback(testCase);
    
    // Wait 10 seconds between tests to hear the playback
    if (testCase !== testCases[testCases.length - 1]) {
      console.log('\nWaiting 10 seconds before next test...');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  
  console.log('\n✅ All tests completed!');
  console.log('\nNote: If any tests failed with "No such album/playlist", it means:');
  console.log('  - The specific content might not exist on Spotify');
  console.log('  - The search term needs to be more specific');
  console.log('  - Try with different album/playlist names');
}

main().catch(console.error);