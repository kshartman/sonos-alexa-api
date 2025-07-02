#!/usr/bin/env npx tsx
import { SonosDiscovery } from '../../src/discovery.js';
import { loadConfiguration } from '../../src/utils/config-loader.js';
import { initializeDebugManager } from '../../src/utils/debug-manager.js';

async function main() {
  const config = loadConfiguration();
  initializeDebugManager(config);
  
  console.log('Testing Spotify browse IDs...\n');
  
  // Initialize discovery
  const discovery = new SonosDiscovery();
  await discovery.start();
  
  // Wait for devices
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const devices = discovery.getAllDevices();
  const device = devices.find(d => d.roomName === 'OfficeSpeakers') || devices[0];
  console.log(`Using device: ${device.roomName}\n`);
  
  // Test various browse IDs
  const testIds = [
    'SP:12',  // Spotify with SID 12
    'A:ARTIST',
    'A:ALBUMARTIST', 
    'A:ALBUM',
    'A:TRACK',
    'R:0/0',  // Root
    'R:0/1',  // Music services root
    'R:0/15', // Try other roots
    'MS:12'   // Music service 12
  ];
  
  for (const id of testIds) {
    console.log(`\nTrying to browse: ${id}`);
    try {
      const result = await device.browse(id);
      console.log(`  Success! Found ${result.items?.length || 0} items`);
      if (result.items && result.items.length > 0) {
        console.log('  First few items:');
        result.items.slice(0, 3).forEach(item => {
          console.log(`    - ${item.title} (${item.id})`);
        });
      }
    } catch (error: any) {
      console.log(`  Failed: ${error.message}`);
    }
  }
  
  discovery.stop();
  process.exit(0);
}

main().catch(console.error);