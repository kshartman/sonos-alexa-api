import { SonosDiscovery } from '../../src/discovery.js';
import { AccountService } from '../../src/services/account-service.js';
import { ServicesCache } from '../../src/utils/services-cache.js';
import logger from '../../src/utils/logger.js';
import { initializeDebugManager } from '../../src/utils/debug-manager.js';
import { loadConfiguration } from '../../src/utils/config-loader.js';

/**
 * Test the per-account Spotify extraction
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
    
    const device = devices[0];
    console.log(`\nUsing device: ${device.roomName}`);
    
    // Create services cache and account service
    const servicesCache = new ServicesCache(discovery);
    await servicesCache.initialize();
    
    const accountService = new AccountService(servicesCache);
    
    // Clear cache to force extraction
    accountService.clearSpotifyCache();
    
    // Test extraction
    console.log('\n1. Testing Spotify extraction...');
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
      });
    } else {
      console.log('No Spotify accounts discovered from favorites');
    }
    
    // Test getting specific account (if multiple found)
    if (allAccounts.size > 1) {
      console.log('\n3. Testing specific account retrieval:');
      const accountIds = Array.from(allAccounts.keys());
      
      for (const accountId of accountIds) {
        console.log(`\nGetting account ${accountId}...`);
        const specificAccount = await accountService.getServiceAccount(device, 'spotify', accountId);
        console.log(JSON.stringify(specificAccount, null, 2));
      }
    }
    
    // Test cache behavior
    console.log('\n4. Testing cache behavior...');
    const cachedAccount = await accountService.getServiceAccount(device, 'spotify');
    console.log('Account retrieved from cache (should be fast)');
    
    // Test with extraction disabled
    console.log('\n5. Testing with extraction disabled...');
    AccountService.DISABLE_SPOTIFY_EXTRACTION = true;
    accountService.clearSpotifyCache();
    
    const noExtractionAccount = await accountService.getServiceAccount(device, 'spotify');
    console.log('Account without extraction:');
    console.log(JSON.stringify(noExtractionAccount, null, 2));
    
    // Reset flag
    AccountService.DISABLE_SPOTIFY_EXTRACTION = false;
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    discovery.stop();
  }
}

main();