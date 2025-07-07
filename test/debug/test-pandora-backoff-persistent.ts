#!/usr/bin/env tsx

import { PandoraAPI } from '../../src/services/pandora-api.js';
import logger from '../../src/utils/logger.js';
import { promises as fs } from 'fs';
import path from 'path';

const BACKOFF_FILE = path.join('data', 'pandora-backoff.json');

async function testPersistentBackoff() {
  logger.info('Testing Pandora persistent bot detection backoff...');
  
  // Clean up any existing backoff file
  try {
    await fs.unlink(BACKOFF_FILE);
    logger.info('Cleaned up existing backoff file');
  } catch (error) {
    // File doesn't exist, that's fine
  }
  
  // Create API instance with invalid credentials to trigger failure
  const api1 = new PandoraAPI('invalid@example.com', 'wrongpassword');
  
  // First login attempt - should fail and set backoff
  try {
    logger.info('\n1. First login (should fail and set 24h backoff)');
    await api1.login();
  } catch (error) {
    logger.info(`✅ Expected failure: ${error instanceof Error ? error.message : error}`);
  }
  
  // Check if backoff file was created
  try {
    const data = await fs.readFile(BACKOFF_FILE, 'utf8');
    const state = JSON.parse(data);
    logger.info(`✅ Backoff file created with state:`, state);
    
    if (state.backoffHours === 24) {
      logger.info('✅ Correct initial backoff of 24 hours');
    } else {
      logger.error(`❌ Expected 24 hour backoff but got ${state.backoffHours}`);
    }
  } catch (error) {
    logger.error('❌ Backoff file was not created');
    return;
  }
  
  // Simulate a restart by creating a new instance
  logger.info('\n2. Simulating restart with new API instance...');
  const api2 = new PandoraAPI('invalid@example.com', 'wrongpassword');
  
  // Give it a moment to load the backoff state
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Try to login - should be blocked by persistent backoff
  try {
    logger.info('   Attempting login (should be blocked by persistent backoff)');
    await api2.login();
    logger.error('❌ This should have been blocked!');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('backoff period')) {
      logger.info(`✅ Correctly blocked by persistent backoff: ${message}`);
    } else {
      logger.error(`❌ Unexpected error: ${message}`);
    }
  }
  
  // Test expiration by modifying the backoff file
  logger.info('\n3. Testing backoff expiration...');
  try {
    const data = await fs.readFile(BACKOFF_FILE, 'utf8');
    const state = JSON.parse(data);
    
    // Set last failure to 25 hours ago
    state.lastLoginFailure = Date.now() - (25 * 60 * 60 * 1000);
    await fs.writeFile(BACKOFF_FILE, JSON.stringify(state, null, 2));
    logger.info('   Modified backoff file to simulate 25 hours passing');
    
    // Reset the loaded flag to force reload (simulating a real restart)
    (PandoraAPI as any).backoffLoaded = false;
    
    // Create new instance which should detect expired backoff
    const api3 = new PandoraAPI('invalid@example.com', 'wrongpassword');
    
    // Give it a moment to load and check the backoff state
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check if backoff file was reset
    const newData = await fs.readFile(BACKOFF_FILE, 'utf8');
    const newState = JSON.parse(newData);
    
    if (newState.lastLoginFailure === 0 && newState.backoffHours === 0) {
      logger.info('✅ Backoff was correctly reset after expiration');
    } else {
      logger.warn('⚠️  Backoff not reset, but login should still work');
    }
    
    // Try to login - should not be blocked anymore
    try {
      await api3.login();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('backoff period')) {
        logger.error('❌ Still blocked by backoff when it should have expired');
      } else {
        logger.info(`✅ Login attempted (failed for different reason): ${message}`);
      }
    }
  } catch (error) {
    logger.error('Failed to test expiration:', error);
  }
  
  // Clean up
  try {
    await fs.unlink(BACKOFF_FILE);
    logger.info('\n✅ Test completed and cleaned up');
  } catch (error) {
    logger.warn('Could not clean up backoff file');
  }
}

// Run the test
testPersistentBackoff().catch(error => {
  logger.error('Test failed:', error);
  process.exit(1);
});