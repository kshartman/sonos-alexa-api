#!/usr/bin/env tsx
import 'dotenv/config';
import { PandoraAPI } from '../services/pandora-api.js';
import { loadConfiguration } from '../utils/config-loader.js';
import logger from '../utils/logger.js';

const { config } = loadConfiguration();

async function getStationDetails() {
  if (!config.pandora?.username || !config.pandora?.password) {
    console.error('❌ Pandora credentials not configured');
    process.exit(1);
  }

  const pandoraApi = new PandoraAPI(config.pandora.username, config.pandora.password);
  
  try {
    // Login to Pandora
    console.log('🔐 Logging in to Pandora...');
    await pandoraApi.login();
    console.log('✅ Logged in successfully\n');

    // Get station list to verify connection
    console.log('📋 Verifying connection...');
    await pandoraApi.getStationList();
    
    // Find our target stations
    const targetStations = [
      { name: '80s Rock Radio', token: '126676935806818498' },
      { name: 'Sahara Sunset Radio', token: '4115365344694720708' }
    ];

    for (const target of targetStations) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📻 Station: ${target.name}`);
      console.log(`🔑 Token: ${target.token}`);
      console.log(`${'='.repeat(60)}\n`);

      try {
        // Make the station.getDetails request
        const details = await pandoraApi.request('station.getDetails', {
          stationToken: target.token,
          includeExtendedFields: true,
          includeExtraParams: true
        });

        // Pretty print the details
        console.log('📊 Station Details:');
        console.log(JSON.stringify(details, null, 2));
        
        // Highlight key information
        if (details) {
          console.log('\n🔍 Key Information:');
          console.log(`   Name: ${details.name || details.stationName}`);
          console.log(`   Station ID: ${details.stationId}`);
          console.log(`   Pandora ID: ${details.pandoraId || 'N/A'}`);
          console.log(`   Date Created: ${details.dateCreated || 'N/A'}`);
          console.log(`   Last Played: ${details.lastPlayed || 'N/A'}`);
          console.log(`   Genre: ${details.genre?.join(', ') || 'N/A'}`);
          console.log(`   Is Thumbprint: ${details.isThumbprint}`);
          console.log(`   Is Shuffle: ${details.isShuffle || false}`);
          console.log(`   Allow Delete: ${details.allowDelete}`);
          console.log(`   Allow Rename: ${details.allowRename}`);
          
          if (details.seeds && details.seeds.length > 0) {
            console.log(`   Seeds: ${details.seeds.length}`);
            details.seeds.forEach((seed: { artist?: { artistName?: string }, song?: { songName?: string }, musicId?: string }, idx: number) => {
              console.log(`     ${idx + 1}. ${seed.artist?.artistName || seed.song?.songName || seed.musicId}`);
            });
          }
          
          if (details.initialSeed) {
            console.log(`   Initial Seed: ${details.initialSeed.artist?.artistName || details.initialSeed.musicId}`);
          }
          
          console.log(`   Positive Feedback: ${details.positiveFeedbackCount || 0}`);
          console.log(`   Negative Feedback: ${details.negativeFeedbackCount || 0}`);
        }
        
      } catch (error) {
        console.error(`❌ Failed to get details for ${target.name}:`, error);
        if (error instanceof Error) {
          console.error(`   Error: ${error.message}`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Failed to connect to Pandora:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Reduce logging noise
logger.level = 'error';

// Run the script
getStationDetails().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});