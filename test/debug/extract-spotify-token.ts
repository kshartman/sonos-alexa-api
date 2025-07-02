#!/usr/bin/env npx tsx
import { SonosDiscovery } from '../../src/discovery.js';
import { XMLParser } from 'fast-xml-parser';
import { loadConfiguration } from '../../src/utils/config-loader.js';
import { initializeDebugManager } from '../../src/utils/debug-manager.js';

async function main() {
  const config = loadConfiguration();
  initializeDebugManager(config);
  
  console.log('Testing Spotify token extraction from favorites...\n');
  
  // Initialize discovery
  const discovery = new SonosDiscovery();
  await discovery.start();
  
  // Wait for devices
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const devices = discovery.getAllDevices();
  const device = devices.find(d => d.roomName === 'OfficeSpeakers') || devices[0];
  console.log(`Using device: ${device.roomName}\n`);
  
  // Browse favorites
  console.log('Browsing favorites...');
  const browseResult = await device.browse('FV:2');
  console.log(`Found ${browseResult?.items?.length || 0} favorites total\n`);
  
  const spotifyFavorites = browseResult?.items?.filter(item => 
    item.uri?.includes('spotify')
  ) || [];
  
  console.log(`Found ${spotifyFavorites.length} Spotify favorites:\n`);
  
  // XML parser for DIDL-Lite
  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false,
    trimValues: true
  });
  
  for (const fav of spotifyFavorites) {
    console.log(`Favorite: ${fav.title}`);
    console.log(`URI: ${fav.uri}`);
    
    // The metadata field contains ALL favorites, we need to parse it
    if (fav.metadata) {
      try {
        const parsed = xmlParser.parse(fav.metadata);
        const didlLite = parsed['DIDL-Lite'];
        
        if (didlLite && didlLite.item) {
          const items = Array.isArray(didlLite.item) ? didlLite.item : [didlLite.item];
          
          // Find THIS specific favorite by ID
          const thisItem = items.find(item => item['@_id'] === fav.id);
          
          if (thisItem) {
            console.log(`  Found matching item in DIDL-Lite`);
            
            // Check r:resMD field
            if (thisItem['r:resMD']) {
              console.log(`  Has r:resMD field!`);
              
              // The r:resMD contains escaped DIDL-Lite, need to unescape and parse
              const unescaped = thisItem['r:resMD']
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&');
              
              console.log(`  Unescaped r:resMD: ${unescaped.substring(0, 200)}...`);
              
              // Parse the inner DIDL-Lite
              const innerParsed = xmlParser.parse(unescaped);
              const innerDidl = innerParsed['DIDL-Lite'];
              
              if (innerDidl && innerDidl.item && innerDidl.item.desc) {
                // desc might be an object with attributes
                let descText = '';
                if (typeof innerDidl.item.desc === 'string') {
                  descText = innerDidl.item.desc;
                } else if (innerDidl.item.desc['#text']) {
                  descText = innerDidl.item.desc['#text'];
                } else if (innerDidl.item.desc['_']) {
                  descText = innerDidl.item.desc['_'];
                } else {
                  console.log(`  desc object structure:`, JSON.stringify(innerDidl.item.desc, null, 2));
                  descText = JSON.stringify(innerDidl.item.desc);
                }
                
                console.log(`  Found desc in r:resMD: ${descText}`);
                
                // Extract token info
                const tokenMatch = descText.match(/SA_RINCON(\d+)_X_#Svc(\d+)-([a-zA-Z0-9]+)-Token/);
                if (tokenMatch) {
                  console.log(`  Extracted from token:`);
                  console.log(`    Service ID: ${tokenMatch[1]}`);
                  console.log(`    Account ID: ${tokenMatch[3]}`);
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('Error parsing metadata:', error);
      }
    }
    console.log('');
  }
  
  discovery.stop();
  process.exit(0);
}

main().catch(console.error);