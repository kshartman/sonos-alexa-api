#!/usr/bin/env npx tsx
import { initializeDebugManager } from '../../src/utils/debug-manager.js';
import { loadConfiguration } from '../../src/utils/config-loader.js';

/**
 * Test the browse fallback behavior when certain content types are missing from favorites
 */
async function main() {
  // Initialize debug manager
  const config = loadConfiguration();
  initializeDebugManager(config);
  
  const room = 'OfficeSpeakers';
  
  console.log('Testing Spotify browse fallback behavior...\n');
  console.log('Current situation: Only have a track favorite, no album/playlist favorites');
  console.log('Expected: System should browse for missing prefixes when needed\n');
  
  // First, clear the account cache to force fresh extraction
  console.log('1. Clearing Spotify cache to force fresh extraction...');
  const clearResponse = await fetch(`http://localhost:5005/debug/spotify/clear-cache`);
  if (!clearResponse.ok) {
    console.log('Note: Clear cache endpoint not available, continuing...\n');
  }
  
  // Test playing different content types
  const testCases = [
    {
      type: 'track',
      id: '3n3Ppam7vgaVa1iaRUc9Lp',
      name: 'Track',
      expected: 'Should work - we have track in favorites for sn/token extraction'
    },
    {
      type: 'album',
      id: '4aawyAB9vmqN3uQ7FjRGTy',
      name: 'Album',
      expected: 'Should browse for album prefix since none in favorites'
    },
    {
      type: 'playlist',
      id: '37i9dQZF1DXcBWIGoYBM5M',
      name: 'Playlist',
      expected: 'Should browse for playlist prefix since none in favorites'
    },
    {
      type: 'artist',
      id: '4Z8W4fKeB5YxbusRsdQVPb',
      name: 'Artist Radio',
      expected: 'Should work - artist radio doesn\'t need prefix'
    }
  ];
  
  console.log('2. Testing playback of each content type:\n');
  
  for (const test of testCases) {
    console.log(`Testing ${test.name}:`);
    console.log(`  Expected: ${test.expected}`);
    
    const url = `http://localhost:5005/${room}/spotify/play/spotify:${test.type}:${test.id}`;
    
    try {
      const response = await fetch(url);
      const result = await response.json();
      
      if (result.status === 'success') {
        console.log(`  ✅ Success - playback started`);
        
        // Check what's playing
        await new Promise(resolve => setTimeout(resolve, 1000));
        const stateResponse = await fetch(`http://localhost:5005/${room}/state`);
        const state = await stateResponse.json();
        console.log(`  Playing: ${state.playbackState}, Track: ${state.currentTrack?.title || 'Unknown'}`);
      } else {
        console.log(`  ❌ Failed: ${result.error}`);
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error}`);
    }
    
    console.log('');
    
    // Brief pause between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n3. Check server logs for browse activity:');
  console.log('Look for messages like:');
  console.log('  - "Browsing for Spotify album prefix..."');
  console.log('  - "Found album prefix via browse: ..."');
  console.log('  - "Using fallback album prefix - browse failed"');
}

main().catch(console.error);