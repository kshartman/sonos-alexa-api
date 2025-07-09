#!/usr/bin/env tsx

import { PandoraFavoritesBrowser } from '../../src/services/pandora-favorites.js';

// Access the private cache via reflection
const cache = (PandoraFavoritesBrowser as any).cache;

console.log('\nChecking PandoraFavoritesBrowser cache...\n');

if (!cache) {
  console.log('No cache found');
} else {
  console.log(`Cache has ${cache.stations.size} stations`);
  console.log(`Last refresh: ${new Date(cache.lastRefresh).toISOString()}`);
  console.log(`Session number: ${cache.sessionNumber}`);
  
  console.log('\nCached stations:');
  let index = 1;
  for (const [stationId, station] of cache.stations) {
    console.log(`\n${index}. ${station.title}`);
    console.log(`   Station ID: ${stationId}`);
    console.log(`   Session: ${station.sessionNumber}`);
    console.log(`   URI: ${station.uri}`);
    
    // Check if this is The Beatles Radio
    if (station.title.toLowerCase().includes('beatles')) {
      console.log('   ⚠️  FOUND BEATLES STATION IN CACHE!');
    }
    index++;
  }
}

// Now let's clear the cache and force a refresh
console.log('\n\nClearing cache to force fresh data...');
(PandoraFavoritesBrowser as any).cache = null;
console.log('Cache cleared.');