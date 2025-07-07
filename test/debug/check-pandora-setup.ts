#!/usr/bin/env tsx
/**
 * Check if Pandora is properly set up on the Sonos system
 */

import { PandoraSessionHelper } from '../../src/services/pandora-session.js';

const API_URL = 'http://localhost:5005';
const ROOM = 'OfficeSpeakers';

async function checkPandoraSetup() {
  console.log('🔍 Checking Pandora Setup on Sonos System\n');
  
  // 1. Check if Pandora service is available
  console.log('1. Checking if Pandora service is available...');
  try {
    const servicesResponse = await fetch(`${API_URL}/services`);
    const services = await servicesResponse.json();
    const pandoraService = services.find((s: any) => s.id === 236 || s.name === 'Pandora');
    
    if (pandoraService) {
      console.log('✅ Pandora service found:', pandoraService);
    } else {
      console.log('❌ Pandora service not found in available services');
    }
  } catch (error) {
    console.error('Failed to check services:', error);
  }
  
  // 2. Try to browse Pandora
  console.log('\n2. Trying to browse Pandora (S:236)...');
  try {
    // Get device coordinator
    const stateResponse = await fetch(`${API_URL}/${ROOM}/state`);
    const state = await stateResponse.json();
    
    // Use debug endpoint to browse
    const browseResponse = await fetch(`${API_URL}/debug/browse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: ROOM,
        objectId: 'S:236',
        browseFlag: 'BrowseDirectChildren',
        startIndex: 0,
        limit: 10
      })
    });
    
    if (browseResponse.ok) {
      const browseResult = await browseResponse.json();
      console.log('✅ Pandora browse successful:');
      console.log('   Total items:', browseResult.totalMatches);
      if (browseResult.items && browseResult.items.length > 0) {
        console.log('   First few items:');
        browseResult.items.slice(0, 3).forEach((item: any) => {
          console.log(`   - ${item.title} (${item.id})`);
        });
      }
    } else {
      const error = await browseResponse.text();
      console.log('❌ Failed to browse Pandora:', error);
    }
  } catch (error) {
    console.error('❌ Browse error:', error);
  }
  
  // 3. Try to get session number
  console.log('\n3. Trying to get Pandora session number...');
  try {
    const deviceResponse = await fetch(`${API_URL}/devices`);
    const devices = await deviceResponse.json();
    const device = devices.find((d: any) => d.name === ROOM);
    
    if (device) {
      // This would need the actual device instance, so we'll check manually
      console.log('   Checking current playback...');
      const stateResponse = await fetch(`${API_URL}/${ROOM}/state`);
      const state = await stateResponse.json();
      
      if (state.currentTrack?.uri?.includes('sid=236')) {
        const snMatch = state.currentTrack.uri.match(/sn=(\d+)/);
        if (snMatch) {
          console.log(`✅ Found session number from current track: ${snMatch[1]}`);
        } else {
          console.log('❌ No session number in current Pandora track');
        }
      } else {
        console.log('   Not currently playing Pandora');
      }
    }
  } catch (error) {
    console.error('Failed to check session number:', error);
  }
  
  // 4. Check Pandora favorites
  console.log('\n4. Checking for Pandora in favorites...');
  try {
    const favoritesResponse = await fetch(`${API_URL}/${ROOM}/favorites`);
    if (favoritesResponse.ok) {
      const favorites = await favoritesResponse.json();
      const pandoraFavorites = favorites.filter((f: any) => 
        f.uri?.includes('sid=236') || 
        f.uri?.includes('x-sonosapi-radio') ||
        f.title?.toLowerCase().includes('pandora')
      );
      
      if (pandoraFavorites.length > 0) {
        console.log(`✅ Found ${pandoraFavorites.length} Pandora favorites:`);
        pandoraFavorites.slice(0, 3).forEach((f: any) => {
          console.log(`   - ${f.title}`);
          if (f.uri?.includes('sn=')) {
            const snMatch = f.uri.match(/sn=(\d+)/);
            if (snMatch) {
              console.log(`     Session number: ${snMatch[1]}`);
            }
          }
        });
      } else {
        console.log('❌ No Pandora favorites found');
      }
    }
  } catch (error) {
    console.error('Failed to check favorites:', error);
  }
  
  console.log('\n✅ Pandora setup check complete');
}

checkPandoraSetup().catch(console.error);