#!/usr/bin/env tsx
import { PandoraAPI } from '../../src/services/pandora-api.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Load settings to get Pandora credentials
async function loadSettings() {
  try {
    const settingsPath = path.join(process.cwd(), 'settings.json');
    const content = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Could not load settings.json:', error);
    return null;
  }
}

async function testPandoraAPI() {
  console.log('🎵 Testing Pandora API...\n');

  // Load settings
  const settings = await loadSettings();
  if (!settings?.pandora?.username || !settings?.pandora?.password) {
    console.error('❌ Pandora credentials not found in settings.json');
    console.log('Please add pandora.username and pandora.password to settings.json');
    return;
  }

  const api = new PandoraAPI(settings.pandora.username, settings.pandora.password);

  try {
    // Test login
    console.log('1. Testing login...');
    await api.login();
    console.log('✅ Login successful!\n');

    // Test getting station list
    console.log('2. Getting station list...');
    const stationList = await api.getStationList();
    console.log(`✅ Found ${stationList.stations.length} stations:`);
    stationList.stations.slice(0, 5).forEach(station => {
      console.log(`   - ${station.stationName} (${station.stationId})`);
    });
    if (stationList.stations.length > 5) {
      console.log(`   ... and ${stationList.stations.length - 5} more`);
    }
    console.log();

    // Test music search
    console.log('3. Testing music search...');
    const searchResult = await api.searchMusic('Beatles');
    console.log('✅ Search results:');
    if (searchResult.artists && searchResult.artists.length > 0) {
      console.log(`   Artists (${searchResult.artists.length}):`);
      searchResult.artists.slice(0, 3).forEach(artist => {
        console.log(`     - ${artist.artistName} (score: ${artist.score})`);
      });
    }
    if (searchResult.songs && searchResult.songs.length > 0) {
      console.log(`   Songs (${searchResult.songs.length}):`);
      searchResult.songs.slice(0, 3).forEach(song => {
        console.log(`     - ${song.songName} (score: ${song.score})`);
      });
    }
    console.log();

    // Test genre stations
    console.log('4. Getting genre stations...');
    const genreStations = await api.getGenreStations();
    console.log(`✅ Found ${genreStations.categories.length} categories:`);
    genreStations.categories.slice(0, 3).forEach(category => {
      console.log(`   - ${category.categoryName} (${category.stations.length} stations)`);
    });
    console.log();

    // Test creating a station (if we found an artist)
    if (searchResult.artists && searchResult.artists.length > 0) {
      const artist = searchResult.artists[0];
      console.log(`5. Creating station for "${artist.artistName}"...`);
      try {
        const newStation = await api.createStation(artist.musicToken, 'artist');
        console.log(`✅ Created station: ${newStation.stationName} (${newStation.stationId})\n`);
      } catch (error) {
        console.log(`⚠️  Could not create station: ${error}\n`);
      }
    }

    // Test feedback (would need a track token from actual playback)
    console.log('6. Testing feedback API...');
    console.log('⚠️  Skipping feedback test (requires active track playback)\n');

    console.log('🎉 All tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testPandoraAPI().catch(console.error);