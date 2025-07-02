#!/usr/bin/env npx tsx
import { SonosDiscovery } from '../../src/discovery.js';
import { AccountService } from '../../src/services/account-service.js';
import { ServicesCache } from '../../src/utils/services-cache.js';
import { loadConfiguration } from '../../src/utils/config-loader.js';
import { initializeDebugManager } from '../../src/utils/debug-manager.js';

async function main() {
  const config = loadConfiguration();
  initializeDebugManager(config);
  
  console.log('Testing Spotify extraction directly...\n');
  
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
  
  // Extract Spotify accounts directly
  console.log('Extracting Spotify accounts...');
  
  // Show the Spotify service from cache
  const services = await servicesCache.getServices();
  const spotifyService = Object.values(services).find((s: any) => 
    s.name.toLowerCase() === 'spotify'
  );
  
  console.log('\nSpotify service from cache:');
  if (spotifyService) {
    console.log(JSON.stringify(spotifyService, null, 2));
  } else {
    console.log('No Spotify service found!');
  }
  
  // Also browse favorites directly to see what we get
  console.log('\nBrowsing favorites directly...');
  try {
    const browseResult = await device.browse('FV:2');
    console.log(`Found ${browseResult?.items?.length || 0} favorites total`);
    
    const spotifyFavorites = browseResult?.items?.filter(item => 
      item.uri?.includes('spotify')
    ) || [];
    
    console.log(`Found ${spotifyFavorites.length} Spotify favorites:`);
    for (const fav of spotifyFavorites) {
      console.log(`  - ${fav.title}`);
      console.log(`    URI: ${fav.uri}`);
      console.log(`    Has metadata: ${!!fav.metadata}`);
      console.log(`    Has desc: ${!!(fav as any).desc}`);
      console.log(`    Desc value: ${(fav as any).desc}`);
      console.log(`    Full item:`, JSON.stringify(fav, null, 2));
      if (fav.metadata) {
        const tokenMatch = fav.metadata.match(/SA_RINCON(\d+)_X_#Svc(\d+)-([a-zA-Z0-9]+)-Token/);
        if (tokenMatch) {
          console.log(`    Token service ID: ${tokenMatch[1]}, Account ID: ${tokenMatch[3]}`);
        }
      }
    }
  } catch (error) {
    console.error('Error browsing favorites:', error);
  }
  
  const extractedAccounts = await accountService.extractSpotifyAccountInfo(device);
  
  console.log('\nExtracted accounts:');
  for (const [accountId, data] of Object.entries(extractedAccounts)) {
    console.log(`\nAccount ID: ${accountId}`);
    console.log(`  sn: ${data.sn}`);
    console.log(`  sid: ${data.sid}`);
    console.log(`  albumPrefix: ${data.albumPrefix}`);
    console.log(`  playlistPrefix: ${data.playlistPrefix}`);
  }
  
  discovery.stop();
  process.exit(0);
}

main().catch(console.error);