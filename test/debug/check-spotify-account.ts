#!/usr/bin/env npx tsx
import { SonosDiscovery } from '../../src/discovery.js';
import { AccountService } from '../../src/services/account-service.js';
import { ServicesCache } from '../../src/utils/services-cache.js';
import { SpotifyService } from '../../src/services/spotify-service.js';
import { loadConfiguration } from '../../src/utils/config-loader.js';
import { initializeDebugManager } from '../../src/utils/debug-manager.js';

async function main() {
  const config = loadConfiguration();
  initializeDebugManager(config);
  
  console.log('Testing Spotify account extraction...\n');
  
  // Initialize discovery
  const discovery = new SonosDiscovery();
  await discovery.start();
  
  // Wait for devices
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const devices = discovery.getAllDevices();
  if (devices.length === 0) {
    console.error('No devices found!');
    return;
  }
  
  const device = devices.find(d => d.roomName === 'OfficeSpeakers') || devices[0];
  console.log(`Using device: ${device.roomName}\n`);
  
  // Initialize services
  const servicesCache = new ServicesCache(discovery);
  await servicesCache.initialize();
  
  const accountService = new AccountService(servicesCache);
  
  // Get Spotify account
  console.log('Getting Spotify account...');
  const account = await accountService.getServiceAccount(device, 'spotify');
  
  if (account) {
    console.log('\nSpotify account details:');
    console.log(`  ID: ${account.id}`);
    console.log(`  Serial Number: ${account.serialNumber}`);
    console.log(`  SID: ${account.sid}`);
    
    const extAccount = account as any;
    if (extAccount.spotifyAlbumPrefix) {
      console.log(`  Album Prefix: ${extAccount.spotifyAlbumPrefix}`);
    }
    if (extAccount.spotifyPlaylistPrefix) {
      console.log(`  Playlist Prefix: ${extAccount.spotifyPlaylistPrefix}`);
    }
    if (extAccount.spotifyAccountId) {
      console.log(`  Account ID: ${extAccount.spotifyAccountId}`);
    }
    
    // Test URI generation
    console.log('\nTesting URI generation...');
    const spotifyService = new SpotifyService();
    spotifyService.setAccount(account);
    
    const trackUri = await spotifyService.generateDirectURI('track', '3n3Ppam7vgaVa1iaRUc9Lp');
    console.log(`\nTrack URI: ${trackUri}`);
    
    const albumUri = await spotifyService.generateDirectURI('album', '7ycBtnsMtyVbbwTfJwRjSP');
    console.log(`Album URI: ${albumUri}`);
    
    // Test metadata generation
    console.log('\nTesting metadata generation...');
    const metadata = spotifyService.generateDirectMetadata('track', '3n3Ppam7vgaVa1iaRUc9Lp', 'Test Track');
    console.log(`\nTrack metadata token check:`);
    const tokenMatch = metadata.match(/SA_RINCON(\d+)_X_#Svc(\d+)-([^<]+)-Token/);
    if (tokenMatch) {
      console.log(`  Service ID in token: ${tokenMatch[1]}`);
      console.log(`  Full token: SA_RINCON${tokenMatch[1]}_X_#Svc${tokenMatch[2]}-${tokenMatch[3]}-Token`);
    }
  } else {
    console.log('No Spotify account found!');
  }
  
  discovery.stop();
  process.exit(0);
}

main().catch(console.error);