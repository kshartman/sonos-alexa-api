#!/usr/bin/env tsx

/**
 * Debug script to test Spotify artist radio with detailed logging
 */

import { SonosDiscovery } from '../../src/discovery.js';
import { SpotifyService } from '../../src/services/spotify-service.js';
import { AccountService } from '../../src/services/account-service.js';
import { ServicesCache } from '../../src/utils/services-cache.js';
import logger from '../../src/utils/logger.js';

const TEST_ROOM = 'OfficeSpeakers';
const ARTIST_NAME = 'The Beatles';
const ARTIST_ID = '3WrFJ7ztbogyGnTHbHJFl2'; // The Beatles

async function testDetailedArtistRadio() {
  console.log('🔍 Detailed Spotify Artist Radio Test\n');

  // Start discovery
  const discovery = new SonosDiscovery();
  await discovery.start();
  
  // Wait for devices
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const devices = discovery.getAllDevices();
  const device = devices.find(d => d.roomName === TEST_ROOM);
  
  if (!device) {
    console.error(`❌ Room ${TEST_ROOM} not found!`);
    process.exit(1);
  }

  const coordinator = discovery.getCoordinator(device.id) || device;
  console.log(`✅ Found device: ${device.roomName} (${device.host})`);
  console.log(`✅ Coordinator: ${coordinator.roomName}\n`);

  // Set up services
  const servicesCache = new ServicesCache(discovery);
  await servicesCache.initialize();
  const accountService = new AccountService(servicesCache);
  const spotifyService = new SpotifyService();

  // Get Spotify account
  const account = await accountService.getServiceAccount(coordinator, 'spotify');
  if (!account) {
    console.error('❌ No Spotify account found!');
    process.exit(1);
  }
  
  console.log('📋 Spotify Account Info:');
  console.log(`   SID: ${account.sid}`);
  console.log(`   Serial Number: ${account.serialNumber}`);
  console.log('');

  spotifyService.setAccount(account);
  spotifyService.setDevice(coordinator);

  // Test 1: Generate URIs for different formats
  console.log('1️⃣  Testing different URI formats:\n');
  
  const formats = [
    { 
      desc: 'Current implementation (x-sonosprog-spotify)', 
      uri: `x-sonosprog-spotify:spotify%3Aartist%3A${ARTIST_ID}?sid=${account.sid}&flags=8232&sn=${account.serialNumber}`
    },
    { 
      desc: 'x-sonos-spotify format', 
      uri: `x-sonos-spotify:spotify%3Aartist%3A${ARTIST_ID}?sid=${account.sid}&flags=8224&sn=${account.serialNumber}`
    },
    { 
      desc: 'x-sonosapi-radio with artistRadio', 
      uri: `x-sonosapi-radio:spotify%3AartistRadio%3A${ARTIST_ID}?sid=${account.sid}&flags=8200&sn=${account.serialNumber}`
    },
    { 
      desc: 'x-sonosapi-radio with artist', 
      uri: `x-sonosapi-radio:spotify%3Aartist%3A${ARTIST_ID}?sid=${account.sid}&flags=8200&sn=${account.serialNumber}`
    }
  ];

  // Generate metadata
  const metadata = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
    <item id="00032020spotify%3Aartist%3A${ARTIST_ID}" parentID="00020000spotify%3auser%3aspotify" restricted="true">
      <dc:title>The Beatles Radio</dc:title>
      <upnp:class>object.item.audioItem.audioBroadcast.#artistRadio</upnp:class>
      <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON${account.sid}_X_#Svc${account.sid}-0-Token</desc>
    </item>
  </DIDL-Lite>`;

  console.log('📋 Metadata:');
  console.log(metadata.replace(/</g, '\n<').trim());
  console.log('');

  // Stop playback first
  await coordinator.stop();
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test each format
  for (const format of formats) {
    console.log(`\n🧪 Testing: ${format.desc}`);
    console.log(`   URI: ${format.uri}`);
    
    try {
      await coordinator.setAVTransportURI(format.uri, metadata);
      await coordinator.play();
      
      // Wait and check state
      await new Promise(resolve => setTimeout(resolve, 2000));
      const state = coordinator.state;
      
      if (state.playbackState === 'PLAYING') {
        console.log(`   ✅ SUCCESS! Playing: ${state.currentTrack?.title} by ${state.currentTrack?.artist}`);
        console.log(`   Track URI: ${state.currentTrack?.uri}`);
        
        // Stop for next test
        await coordinator.stop();
        await new Promise(resolve => setTimeout(resolve, 1000));
        break;
      } else {
        console.log(`   ⚠️  State: ${state.playbackState}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Failed: ${error.message}`);
      if (error.response) {
        console.log(`   SOAP Fault: ${error.response}`);
      }
    }
  }

  // Test 2: Check what happens with search
  console.log('\n\n2️⃣  Testing via search API:');
  try {
    const results = await spotifyService.search('station', ARTIST_NAME);
    if (results.length > 0) {
      const result = results[0];
      console.log(`\n   Found: ${result.title}`);
      console.log(`   ID: ${result.id}`);
      
      const uri = spotifyService.generateURI('station', result);
      const searchMetadata = spotifyService.generateMetadata('station', result);
      
      console.log(`\n   Generated URI: ${uri}`);
      console.log(`   Generated Metadata:`);
      console.log(searchMetadata.replace(/</g, '\n<').trim());
    }
  } catch (error: any) {
    console.log(`   ❌ Search failed: ${error.message}`);
  }

  discovery.stop();
}

testDetailedArtistRadio().catch(console.error);