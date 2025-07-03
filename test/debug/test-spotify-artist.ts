#!/usr/bin/env tsx

/**
 * Debug script to test Spotify artist radio search
 * Usage: tsx test/debug/test-spotify-artist.ts [artist-name]
 */

import { config } from 'dotenv';
config();

const API_URL = process.env.API_URL || 'http://localhost:5005';
const TEST_ROOM = process.env.TEST_ROOM || 'OfficeSpeakers';
const ARTIST_NAME = process.argv[2] || 'The Beatles';

async function testSpotifyArtist() {
  console.log('🎵 Testing Spotify Artist Radio');
  console.log(`   Room: ${TEST_ROOM}`);
  console.log(`   Artist: ${ARTIST_NAME}`);
  console.log(`   API: ${API_URL}`);
  console.log('');

  try {
    // First check Spotify auth status
    console.log('1️⃣  Checking Spotify authentication...');
    const authResponse = await fetch(`${API_URL}/spotify/status`);
    const authStatus = await authResponse.json();
    console.log(`   Authenticated: ${authStatus.authenticated}`);
    
    if (!authStatus.authenticated) {
      console.error('❌ Spotify not authenticated! Run /spotify/auth first.');
      process.exit(1);
    }

    // Check if Spotify is configured in Sonos
    console.log('\n2️⃣  Checking Spotify in Sonos...');
    const servicesResponse = await fetch(`${API_URL}/services`);
    const servicesData = await servicesResponse.json();
    const services = Array.isArray(servicesData) ? servicesData : Object.values(servicesData);
    const spotify = services.find((s: any) => s.name === 'Spotify');
    
    if (!spotify) {
      console.error('❌ Spotify not found in Sonos services!');
      process.exit(1);
    }
    console.log(`   Found Spotify - SID: ${spotify.id}, SN: ${spotify.serialNumber || '1'}`);

    // Stop current playback
    console.log('\n3️⃣  Stopping current playback...');
    await fetch(`${API_URL}/${TEST_ROOM}/stop`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Try the search
    console.log('\n4️⃣  Searching for artist radio...');
    const searchUrl = `${API_URL}/${TEST_ROOM}/musicsearch/spotify/artist/${encodeURIComponent(ARTIST_NAME)}`;
    console.log(`   URL: ${searchUrl}`);
    
    const searchResponse = await fetch(searchUrl);
    const searchResult = await searchResponse.json();
    
    console.log(`\n📋 Response Status: ${searchResponse.status}`);
    console.log('📋 Response Body:');
    console.log(JSON.stringify(searchResult, null, 2));

    if (searchResponse.ok) {
      // Check if it's playing
      console.log('\n5️⃣  Checking playback state...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const stateResponse = await fetch(`${API_URL}/${TEST_ROOM}/state`);
      const state = await stateResponse.json();
      
      console.log(`\n🎵 Playback State: ${state.playbackState}`);
      if (state.currentTrack) {
        console.log('🎵 Current Track:');
        console.log(`   Title: ${state.currentTrack.title}`);
        console.log(`   Artist: ${state.currentTrack.artist}`);
        console.log(`   URI: ${state.currentTrack.uri}`);
      }
    }

    // Also test direct play with a known artist ID
    if (!searchResponse.ok && ARTIST_NAME.toLowerCase().includes('beatles')) {
      console.log('\n6️⃣  Testing direct play with Beatles artist ID...');
      const directUrl = `${API_URL}/${TEST_ROOM}/spotify/play/spotify:artist:3WrFJ7ztbogyGnTHbHJFl2`;
      console.log(`   URL: ${directUrl}`);
      
      const directResponse = await fetch(directUrl);
      const directResult = await directResponse.json();
      
      console.log(`\n📋 Direct Play Status: ${directResponse.status}`);
      console.log('📋 Direct Play Body:');
      console.log(JSON.stringify(directResult, null, 2));
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Enable debug logging if requested
if (process.env.DEBUG) {
  console.log('\n🔍 Debug mode enabled - check server logs for details');
  console.log('   Run server with: LOG_LEVEL=debug DEBUG_CATEGORIES=all npm start\n');
}

testSpotifyArtist().catch(console.error);