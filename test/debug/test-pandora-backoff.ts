#!/usr/bin/env tsx

import { PandoraAPI } from '../../src/services/pandora-api.js';
import logger from '../../src/utils/logger.js';

async function testBackoff() {
  // Create API instance with invalid credentials to trigger failure
  const api = new PandoraAPI('invalid@example.com', 'wrongpassword');
  
  logger.info('Testing Pandora bot detection backoff...');
  
  // First login attempt - should fail and set backoff
  try {
    logger.info('Attempt 1: First login (should fail and set 24h backoff)');
    await api.login();
  } catch (error) {
    logger.info(`✅ Expected failure: ${error instanceof Error ? error.message : error}`);
  }
  
  // Second immediate attempt - should be blocked by backoff
  try {
    logger.info('\nAttempt 2: Immediate retry (should be blocked by backoff)');
    await api.login();
    logger.error('❌ This should have been blocked!');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('backoff period')) {
      logger.info(`✅ Correctly blocked: ${message}`);
    } else {
      logger.error(`❌ Unexpected error: ${message}`);
    }
  }
  
  // Test with valid credentials (if available)
  const validUsername = process.env.PANDORA_USERNAME;
  const validPassword = process.env.PANDORA_PASSWORD;
  
  if (validUsername && validPassword) {
    logger.info('\nTesting with valid credentials to reset backoff...');
    
    // We need to wait or manually reset the backoff for testing
    // For testing purposes, let's simulate time passing by resetting the static properties
    // In real usage, we'd wait the full backoff period
    
    // Access private static properties for testing (normally wouldn't do this)
    (PandoraAPI as any).lastLoginFailure = 0;
    (PandoraAPI as any).backoffHours = 0;
    
    const validApi = new PandoraAPI(validUsername, validPassword);
    
    try {
      logger.info('Attempting login with valid credentials...');
      await validApi.login();
      logger.info('✅ Login successful - backoff should be reset');
      
      // Verify we can get stations
      const stations = await validApi.getStationList();
      logger.info(`✅ Retrieved ${stations.stations.length} stations`);
    } catch (error) {
      logger.error(`❌ Login failed even with valid credentials: ${error instanceof Error ? error.message : error}`);
    }
  } else {
    logger.info('\nSkipping valid credential test (PANDORA_USERNAME/PASSWORD not set)');
  }
  
  logger.info('\n✅ Bot detection backoff test completed');
}

// Run the test
testBackoff().catch(error => {
  logger.error('Test failed:', error);
  process.exit(1);
});