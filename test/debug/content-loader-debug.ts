import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom } from '../helpers/discovery.js';
import { loadTestSong } from '../helpers/content-loader.js';

// Debug content loading issues
async function debugContentLoading() {
  console.log('\n🔍 Debugging Content Loading\n');
  
  try {
    // Discover system
    const topology = await discoverSystem();
    const testRoom = await getSafeTestRoom(topology);
    console.log(`Test room: ${testRoom}`);
    
    // Test 1: Check favorites endpoint
    console.log('\n--- Test 1: Checking favorites endpoint ---');
    const favResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/favorites/detailed`);
    console.log(`Favorites response status: ${favResponse.status}`);
    
    if (favResponse.ok) {
      const favorites = await favResponse.json();
      console.log(`Found ${favorites.length} favorites`);
      
      if (favorites.length > 0) {
        console.log('\nFirst 5 favorites:');
        favorites.slice(0, 5).forEach((fav: any, i: number) => {
          if (typeof fav === 'object') {
            console.log(`${i + 1}. ${fav.title} (${fav.uri?.substring(0, 50)}...)`);
          } else {
            console.log(`${i + 1}. ${fav}`);
          }
        });
        
        // Look for radio stations
        const radioFavs = favorites.filter((fav: any) => {
          const uri = fav.uri || '';
          const title = (fav.title || fav || '').toLowerCase();
          return uri.includes('radio') || uri.includes('stream') || 
                 title.includes('radio') || title.includes('fm') || title.includes('classical');
        });
        
        console.log(`\nFound ${radioFavs.length} radio stations`);
        if (radioFavs.length > 0) {
          console.log('Radio stations:');
          radioFavs.slice(0, 3).forEach((fav: any, i: number) => {
            console.log(`${i + 1}. ${fav.title || fav}`);
          });
        }
      }
    } else {
      const error = await favResponse.text();
      console.log(`Failed to get favorites: ${error}`);
    }
    
    // Test 2: Check playlists endpoint
    console.log('\n--- Test 2: Checking playlists endpoint ---');
    const playlistResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/playlists/detailed`);
    console.log(`Playlists response status: ${playlistResponse.status}`);
    
    if (playlistResponse.ok) {
      const playlists = await playlistResponse.json();
      console.log(`Found ${playlists.length} playlists`);
      
      if (playlists.length > 0) {
        console.log('\nFirst 3 playlists:');
        playlists.slice(0, 3).forEach((pl: any, i: number) => {
          if (typeof pl === 'object') {
            console.log(`${i + 1}. ${pl.title} (${pl.uri?.substring(0, 50)}...)`);
          } else {
            console.log(`${i + 1}. ${pl}`);
          }
        });
      }
    } else {
      const error = await playlistResponse.text();
      console.log(`Failed to get playlists: ${error}`);
    }
    
    // Test 3: Try loading content
    console.log('\n--- Test 3: Testing loadTestSong ---');
    console.log('Calling loadTestSong...');
    const startTime = Date.now();
    try {
      await loadTestSong(testRoom, true);
      const elapsed = Date.now() - startTime;
      
      console.log(`Success!`);
      console.log(`Time taken: ${elapsed}ms`);
      // Check state
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      console.log('\nCurrent state after loading:');
      console.log(`  Playback state: ${state.playbackState}`);
      console.log(`  Track: ${state.currentTrack?.title || 'None'}`);
      console.log(`  Artist: ${state.currentTrack?.artist || 'None'}`);
    } catch (error) {
      console.log(`Failed to load content: ${error}`);
    }
    
    // Test 4: Try direct music search
    console.log('\n--- Test 4: Testing direct music search ---');
    const searchQuery = encodeURIComponent('track:Yesterday artist:The Beatles');
    const searchUrl = `${defaultConfig.apiUrl}/${testRoom}/musicsearch/apple/song/${searchQuery}`;
    console.log(`Search URL: ${searchUrl}`);
    
    const searchResponse = await fetch(searchUrl);
    console.log(`Search response status: ${searchResponse.status}`);
    
    if (searchResponse.ok) {
      const searchResult = await searchResponse.json();
      console.log('Search successful:', searchResult);
    } else {
      const error = await searchResponse.text();
      console.log(`Search failed: ${error}`);
    }
    
  } catch (error) {
    console.error('Error during debug:', error);
  }
}

// Run debug
debugContentLoading().catch(console.error);