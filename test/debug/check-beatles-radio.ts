#!/usr/bin/env tsx

import logger from '../../src/utils/logger.js';

const API_URL = 'http://localhost:5005';
const testRoom = process.env.TEST_ROOM || 'OfficeSpeakers';

async function main() {
  try {
    // Get detailed station list
    console.log(`\nFetching detailed Pandora stations for room: ${testRoom}...`);
    const response = await fetch(`${API_URL}/${testRoom}/pandora/stations/detailed`);
    
    if (!response.ok) {
      console.error(`Failed to get stations: ${response.status} ${response.statusText}`);
      const body = await response.text();
      console.error(body);
      return;
    }
    
    const data = await response.json();
    const stations = data.stations || [];
    
    console.log(`\nTotal stations: ${stations.length}`);
    
    // Look for Beatles Radio
    const beatlesStations = stations.filter(s => 
      s.stationName.toLowerCase().includes('beatles')
    );
    
    if (beatlesStations.length === 0) {
      console.log('\nNo Beatles stations found');
    } else {
      console.log(`\nFound ${beatlesStations.length} Beatles station(s):`);
      for (const station of beatlesStations) {
        console.log('\n---');
        console.log(`Name: ${station.stationName}`);
        console.log(`Station ID: ${station.stationId}`);
        console.log(`Is in Sonos Favorites: ${station.isInSonosFavorites}`);
        console.log(`Is QuickMix: ${station.isQuickMix}`);
        console.log(`Is Thumbprint: ${station.isThumbprint}`);
        console.log(`Is User Created: ${station.isUserCreated}`);
        
        if (station.favoriteProperties) {
          console.log('Favorite Properties:');
          console.log(`  URI: ${station.favoriteProperties.uri}`);
          console.log(`  Session Number: ${station.favoriteProperties.sessionNumber}`);
        }
        
        if (station.apiProperties) {
          console.log('API Properties:');
          console.log(`  Token: ${station.apiProperties.stationToken}`);
          console.log(`  Art URL: ${station.apiProperties.artUrl}`);
          console.log(`  Type: ${station.apiProperties.type}`);
        }
      }
    }
    
    // Also check favorites vs API stations
    const favoriteStations = stations.filter(s => s.isInSonosFavorites);
    const apiOnlyStations = stations.filter(s => !s.isInSonosFavorites);
    
    console.log(`\n\nSummary:`);
    console.log(`- Favorite stations: ${favoriteStations.length}`);
    console.log(`- API-only stations: ${apiOnlyStations.length}`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main();