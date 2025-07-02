#!/usr/bin/env npx tsx
import { SonosDiscovery } from '../../src/discovery.js';
import { loadConfiguration } from '../../src/utils/config-loader.js';
import { initializeDebugManager } from '../../src/utils/debug-manager.js';

async function main() {
  const config = loadConfiguration();
  initializeDebugManager(config);
  
  console.log('Testing various Spotify browse formats...\n');
  
  // Initialize discovery
  const discovery = new SonosDiscovery();
  await discovery.start();
  
  // Wait for devices
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const devices = discovery.getAllDevices();
  const device = devices.find(d => d.roomName === 'OfficeSpeakers') || devices[0];
  console.log(`Using device: ${device.roomName}\n`);
  
  // Test various Spotify-related browse IDs
  const testIds = [
    'SP:12',                          // Service provider 12
    'MS:12',                          // Music service 12  
    'S:12',                           // Service 12
    '0:0:spotify',                    // Root spotify
    'R:0/12',                         // Root service 12
    'SA_RINCON12_X',                  // Service account format
    'SA_RINCON12_X_#Svc12-85a80dc4-Token',  // With account ID
    '10020000spotify',                // Some prefix
    '00020000spotify%3auser%3aspotify', // From metadata
    'spotify:user:spotify',           // Direct spotify URI
    'x-rincon-cpcontainer:1006006cspotify', // Container format
  ];
  
  for (const id of testIds) {
    console.log(`\nTrying: ${id}`);
    try {
      const result = await device.browse(id);
      console.log(`  ✓ Success! Found ${result.items?.length || 0} items`);
      if (result.items && result.items.length > 0) {
        console.log('  First item:');
        const item = result.items[0];
        console.log(`    Title: ${item.title}`);
        console.log(`    ID: ${item.id}`);
        if (item.uri) console.log(`    URI: ${item.uri}`);
      }
    } catch (error: any) {
      const errorCode = error.message.match(/errorCode>(\d+)</)?.[1];
      console.log(`  ✗ Failed: Error ${errorCode || 'unknown'}`);
    }
  }
  
  discovery.stop();
  process.exit(0);
}

main().catch(console.error);