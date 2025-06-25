#!/usr/bin/env tsx
import { PandoraAPI } from '../../src/services/pandora-api.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Load settings to get Pandora credentials
async function loadSettings() {
  try {
    const settingsPath = path.join(process.cwd(), 'settings.json');
    const content = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Could not load settings.json:', error);
    return null;
  }
}

async function testPandoraFeedback() {
  console.log('🎵 Testing Pandora Feedback API...\n');

  // Load settings
  const settings = await loadSettings();
  if (!settings?.pandora?.username || !settings?.pandora?.password) {
    console.error('❌ Pandora credentials not found in settings.json');
    return;
  }

  const api = new PandoraAPI(settings.pandora.username, settings.pandora.password);

  try {
    // Test login
    console.log('1. Testing login...');
    await api.login();
    console.log('✅ Login successful!\n');

    // Test with the extracted tokens
    const stationToken = '123601601783943282'; // Thumbprint Radio
    const trackToken = '109155864';
    
    console.log(`2. Testing feedback with tokens:`);
    console.log(`   Station: ${stationToken}`);
    console.log(`   Track: ${trackToken}`);
    
    try {
      await api.addFeedback(stationToken, trackToken, true);
      console.log('✅ Thumbs up sent successfully!\n');
    } catch (error) {
      console.error('❌ Feedback failed:', error);
      
      // Try with different token formats
      console.log('\n3. Trying alternative token formats...');
      
      // Try just the numeric part
      const numericTrack = trackToken.replace(/[^0-9]/g, '');
      console.log(`   Numeric track token: ${numericTrack}`);
      
      try {
        await api.addFeedback(stationToken, numericTrack, true);
        console.log('✅ Feedback with numeric token succeeded!');
      } catch (err2) {
        console.error('❌ Numeric token also failed:', err2);
      }
    }

    // Get current playing info to verify format
    console.log('\n4. Getting station info to check current track...');
    try {
      const stationList = await api.getStationList();
      const thumbprint = stationList.stations.find(s => s.stationId === stationToken);
      console.log('Station found:', thumbprint?.stationName || 'Not found');
    } catch (error) {
      console.error('Error getting station list:', error);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testPandoraFeedback().catch(console.error);