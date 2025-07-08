#!/usr/bin/env tsx

import { discovery } from '../../src/discovery.js';
import logger from '../../src/utils/logger.js';

const TEST_MESSAGE = 'Testing TTS with empty queue';

async function testTTSWithEmptyQueue() {
  try {
    logger.info('Starting TTS empty queue test...');
    
    // Wait for discovery
    logger.info('Waiting for device discovery...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const devices = discovery.getAllDevices();
    if (devices.length === 0) {
      logger.error('No devices found!');
      process.exit(1);
    }
    
    // Get first device
    const device = devices[0];
    if (!device) {
      logger.error('No device available');
      process.exit(1);
    }
    
    logger.info(`Using device: ${device.roomName}`);
    
    // Step 1: Stop playback and clear queue
    logger.info('Step 1: Stopping playback and clearing queue...');
    await device.stop();
    await device.clearQueue();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 2: Verify queue is empty
    const queueBefore = await device.getQueue(0, 1);
    logger.info(`Queue before TTS: ${queueBefore.items.length} items`);
    
    // Step 3: Get initial state
    const stateBefore = await device.getTransportInfo();
    logger.info(`State before TTS: ${stateBefore.CurrentTransportState}`);
    
    // Step 4: Make TTS announcement via API
    logger.info('Step 4: Making TTS announcement...');
    const apiUrl = `http://localhost:5005/${encodeURIComponent(device.roomName)}/say/${encodeURIComponent(TEST_MESSAGE)}`;
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      logger.error(`TTS request failed: ${response.status}`);
      process.exit(1);
    }
    
    logger.info('TTS request sent, waiting for playback...');
    
    // Step 5: Wait for TTS to start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 6: Monitor state during TTS
    let ttsPlaying = false;
    for (let i = 0; i < 10; i++) {
      const state = await device.getTransportInfo();
      logger.info(`During TTS (${i}): State = ${state.CurrentTransportState}`);
      if (state.CurrentTransportState === 'PLAYING') {
        ttsPlaying = true;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    if (!ttsPlaying) {
      logger.warn('TTS did not reach PLAYING state');
    }
    
    // Step 7: Wait for TTS to complete
    logger.info('Waiting for TTS to complete...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Step 8: Check final state
    const stateAfter = await device.getTransportInfo();
    const queueAfter = await device.getQueue(0, 1);
    const mediaInfo = await device.getMediaInfo();
    
    logger.info('=== FINAL STATE ===');
    logger.info(`Transport state: ${stateAfter.CurrentTransportState}`);
    logger.info(`Queue items: ${queueAfter.items.length}`);
    logger.info(`Current URI: ${mediaInfo.CurrentURI}`);
    
    // Check if issue is present
    if (queueAfter.items.length > 0) {
      logger.error('❌ BUG CONFIRMED: Queue is not empty after TTS!');
      logger.error(`   Queue has ${queueAfter.items.length} items`);
      logger.error(`   First item: ${queueAfter.items[0]?.title || 'Unknown'}`);
    } else if (stateAfter.CurrentTransportState !== 'STOPPED') {
      logger.error('❌ BUG CONFIRMED: Device is not STOPPED after TTS!');
      logger.error(`   State is: ${stateAfter.CurrentTransportState}`);
    } else {
      logger.info('✅ Test passed: Queue is empty and device is stopped');
    }
    
  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run the test
testTTSWithEmptyQueue();