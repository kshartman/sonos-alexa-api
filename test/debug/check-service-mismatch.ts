#!/usr/bin/env npx tsx
import { promises as fs } from 'fs';
import path from 'path';

async function main() {
  console.log('Checking service ID mismatch...\n');
  
  // Read services cache
  const cacheFile = path.join(process.cwd(), 'data', 'services-cache.json');
  const cacheData = JSON.parse(await fs.readFile(cacheFile, 'utf-8'));
  
  // Find Spotify service
  const spotifyService = Object.values(cacheData.services).find((s: any) => 
    s.name.toLowerCase() === 'spotify'
  ) as any;
  
  if (spotifyService) {
    console.log('Spotify service from cache:');
    console.log(`  ID: ${spotifyService.id}`);
    console.log(`  Name: ${spotifyService.name}`);
    console.log(`  URI: ${spotifyService.uri}`);
  }
  
  // Check favorites
  console.log('\nChecking Spotify favorites...');
  const favResponse = await fetch('http://localhost:5005/OfficeSpeakers/favorites/detailed');
  const favorites = await favResponse.json();
  
  const spotifyFavorites = favorites.filter((f: any) => f.uri?.includes('spotify'));
  
  for (const fav of spotifyFavorites) {
    console.log(`\nFavorite: ${fav.title}`);
    console.log(`  URI: ${fav.uri}`);
    
    // Extract service ID from URI
    const uriSidMatch = fav.uri.match(/sid=(\d+)/);
    if (uriSidMatch) {
      console.log(`  Service ID in URI: ${uriSidMatch[1]}`);
    }
    
    // Extract service ID from metadata token
    const tokenMatch = fav.metadata?.match(/SA_RINCON(\d+)_X_#Svc(\d+)-/);
    if (tokenMatch) {
      console.log(`  Service ID in token: ${tokenMatch[1]} (Svc${tokenMatch[2]})`);
      
      // Check for mismatch
      if (spotifyService && tokenMatch[1] !== spotifyService.id.toString()) {
        console.log(`  ⚠️  MISMATCH: Token has service ID ${tokenMatch[1]}, but current Spotify service is ID ${spotifyService.id}`);
      }
    }
  }
  
  console.log('\nPossible causes:');
  console.log('1. The Spotify favorite was created when Spotify had a different service ID');
  console.log('2. Sonos reassigned service IDs after a system update or reconfiguration');
  console.log('3. The favorite needs to be recreated with the current service configuration');
}

main().catch(console.error);