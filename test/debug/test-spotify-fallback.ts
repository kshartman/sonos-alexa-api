import { SonosDiscovery } from '../../src/discovery.js';
import { AccountService } from '../../src/services/account-service.js';
import { ServicesCache } from '../../src/utils/services-cache.js';
import logger from '../../src/utils/logger.js';
import { initializeDebugManager } from '../../src/utils/debug-manager.js';
import { loadConfiguration } from '../../src/utils/config-loader.js';

/**
 * Test the Spotify fallback behavior with selective extraction disabled
 */
async function main() {
  // Initialize debug manager first
  const config = loadConfiguration();
  initializeDebugManager(config);
  
  const discovery = new SonosDiscovery();
  
  // Make discovery globally available
  declare global {
    var discovery: SonosDiscovery | undefined;
  }
  global.discovery = discovery;
  
  try {
    await discovery.start();
    
    // Wait for devices
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const devices = discovery.getAllDevices();
    if (devices.length === 0) {
      console.log('No Sonos devices found');
      return;
    }
    
    const device = devices.find(d => d.roomName === 'OfficeSpeakers') || devices[0];
    console.log(`\nUsing device: ${device.roomName}`);
    
    // Create services cache and account service
    const servicesCache = new ServicesCache(discovery);
    await servicesCache.initialize();
    
    const accountService = new AccountService(servicesCache);
    
    // Clear cache to force extraction
    accountService.clearSpotifyCache();
    
    // Show current extraction settings
    console.log('\nCurrent extraction settings:');
    console.log(JSON.stringify(AccountService.DISABLE_SPOTIFY_EXTRACTION, null, 2));
    
    // Test extraction
    console.log('\n1. Testing Spotify extraction with selective disabling...');
    const account = await accountService.getServiceAccount(device, 'spotify');
    
    if (account) {
      console.log('\nSpotify account found:');
      console.log(JSON.stringify(account, null, 2));
    } else {
      console.log('No Spotify account found');
    }
    
    // Get all discovered accounts
    console.log('\n2. All discovered Spotify accounts:');
    const allAccounts = accountService.getAllSpotifyAccounts();
    
    if (allAccounts.size > 0) {
      console.log(`Found ${allAccounts.size} Spotify account(s):`);
      allAccounts.forEach((data, accountId) => {
        console.log(`\nAccount ID: ${accountId}`);
        console.log(JSON.stringify(data, null, 2));
        console.log('Note: sn and token should be present, but albumPrefix/playlistPrefix may be missing due to disabled extraction');
      });
    } else {
      console.log('No Spotify accounts discovered from favorites');
    }
    
    // Test playing each content type to see fallback behavior
    console.log('\n3. Testing playback with fallback behavior...');
    console.log('(Check server logs to see browse fallback in action)');
    
    const testCases = [
      { type: 'track', id: '3n3Ppam7vgaVa1iaRUc9Lp', name: 'Track (extraction disabled, should use defaults)' },
      { type: 'album', id: '4aawyAB9vmqN3uQ7FjRGTy', name: 'Album (extraction enabled, should use extracted prefix)' },
      { type: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M', name: 'Playlist (extraction enabled, should use extracted prefix)' },
      { type: 'artist', id: '4Z8W4fKeB5YxbusRsdQVPb', name: 'Artist Radio (extraction disabled, should use defaults)' }
    ];
    
    for (const test of testCases) {
      console.log(`\nTesting ${test.name}...`);
      const url = `http://localhost:5005/${device.roomName}/spotify/play/spotify:${test.type}:${test.id}`;
      
      try {
        const response = await fetch(url);
        const result = await response.json();
        console.log(`Result: ${JSON.stringify(result)}`);
      } catch (error) {
        console.error(`Error: ${error}`);
      }
      
      // Brief pause between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    discovery.stop();
  }
}

main();