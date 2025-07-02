#!/usr/bin/env npx tsx
import { initializeDebugManager } from '../../src/utils/debug-manager.js';
import { loadConfiguration } from '../../src/utils/config-loader.js';

async function main() {
  const config = loadConfiguration();
  initializeDebugManager(config);
  
  console.log('Checking Spotify extraction...\n');
  
  // Check what favorites we have
  const favResponse = await fetch('http://localhost:5005/OfficeSpeakers/favorites/detailed');
  const favorites = await favResponse.json();
  
  const spotifyFavorites = favorites.filter((f: any) => f.uri?.includes('spotify'));
  console.log(`Found ${spotifyFavorites.length} Spotify favorites:`);
  
  spotifyFavorites.forEach((fav: any) => {
    console.log(`\n- ${fav.title}`);
    console.log(`  URI: ${fav.uri}`);
    
    // Extract values from URI
    const snMatch = fav.uri.match(/sn=(\d+)/);
    const sidMatch = fav.uri.match(/sid=(\d+)/);
    
    console.log(`  Extracted: sn=${snMatch?.[1] || 'none'}, sid=${sidMatch?.[1] || 'none'}`);
  });
  
  // Try to play something to see what gets logged
  console.log('\n\nTrying to play a track...');
  const playResponse = await fetch('http://localhost:5005/OfficeSpeakers/spotify/play/spotify:track:3n3Ppam7vgaVa1iaRUc9Lp');
  const result = await playResponse.json();
  console.log('Result:', result);
  
  // Check what services are available
  console.log('\n\nChecking available services...');
  const servicesResponse = await fetch('http://localhost:5005/services');
  const services = await servicesResponse.json();
  
  const spotify = Object.values(services).find((s: any) => s.name?.toLowerCase() === 'spotify');
  if (spotify) {
    console.log('Spotify service found:', spotify);
  } else {
    console.log('No Spotify service found in available services');
  }
}

main().catch(console.error);