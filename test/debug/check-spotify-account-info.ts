#!/usr/bin/env npx tsx
import { SonosDiscovery } from '../../src/discovery.js';
import { AccountService } from '../../src/services/account-service.js';
import { ServicesCache } from '../../src/utils/services-cache.js';
import { loadConfiguration } from '../../src/utils/config-loader.js';
import { initializeDebugManager } from '../../src/utils/debug-manager.js';

async function main() {
  const config = loadConfiguration();
  initializeDebugManager(config);
  
  console.log('Checking Spotify account configuration...\n');
  
  // Initialize discovery
  const discovery = new SonosDiscovery();
  await discovery.start();
  
  // Wait for devices
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const devices = discovery.getAllDevices();
  const device = devices.find(d => d.roomName === 'OfficeSpeakers') || devices[0];
  console.log(`Using device: ${device.roomName}\n`);
  
  // Initialize services
  const servicesCache = new ServicesCache(discovery);
  await servicesCache.initialize();
  
  const accountService = new AccountService(servicesCache);
  
  // Get Spotify account
  console.log('Getting Spotify account info...');
  const account = await accountService.getServiceAccount(device, 'spotify');
  
  if (account) {
    console.log('\nSpotify Account Info:');
    console.log(`  ID: ${account.id}`);
    console.log(`  Serial Number: ${account.serialNumber}`);
    console.log(`  Service ID: ${account.sid}`);
    
    // Check extended properties
    const extendedAccount = account as any;
    console.log(`  Album Prefix: ${extendedAccount.spotifyAlbumPrefix || 'NOT FOUND'}`);
    console.log(`  Playlist Prefix: ${extendedAccount.spotifyPlaylistPrefix || 'NOT FOUND'}`);
    console.log(`  Account ID: ${extendedAccount.spotifyAccountId || 'NOT FOUND'}`);
    
    // Force re-extraction to update cache
    console.log('\nForcing re-extraction of Spotify account info...');
    const extracted = await accountService.extractSpotifyAccountInfo(device);
    
    console.log(`\nExtracted ${Object.keys(extracted).length} accounts:`);
    for (const [id, data] of Object.entries(extracted)) {
      console.log(`\n  Account ${id}:`);
      console.log(`    sn: ${data.sn}`);
      console.log(`    sid: ${data.sid}`);
      console.log(`    albumPrefix: ${data.albumPrefix || 'MISSING'}`);
      console.log(`    playlistPrefix: ${data.playlistPrefix || 'MISSING'}`);
    }
    
    // Get all cached Spotify accounts
    const allAccounts = accountService.getAllSpotifyAccounts();
    console.log(`\nCached Spotify Accounts: ${allAccounts.size}`);
    for (const [id, data] of allAccounts) {
      console.log(`\n  Account ${id}:`);
      console.log(`    sn: ${data.sn}`);
      console.log(`    sid: ${data.sid}`);
      console.log(`    albumPrefix: ${data.albumPrefix || 'MISSING'}`);
      console.log(`    playlistPrefix: ${data.playlistPrefix || 'MISSING'}`);
    }
  } else {
    console.log('No Spotify account found!');
  }
  
  discovery.stop();
  process.exit(0);
}

main().catch(console.error);