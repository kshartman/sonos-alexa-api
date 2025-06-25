#!/usr/bin/env tsx
import { PandoraAPI } from '../../src/services/pandora-api.js';
import * as fs from 'fs/promises';
import * as path from 'path';

async function listStations() {
  const settingsPath = path.join(process.cwd(), 'settings.json');
  const content = await fs.readFile(settingsPath, 'utf-8');
  const settings = JSON.parse(content);
  
  if (!settings?.pandora?.username || !settings?.pandora?.password) {
    console.error('❌ Pandora credentials not found in settings.json');
    return;
  }

  const api = new PandoraAPI(settings.pandora.username, settings.pandora.password);
  
  console.log('Logging into Pandora...');
  await api.login();
  
  console.log('\n📻 Your Pandora Stations:');
  const stationList = await api.getStationList();
  stationList.stations.forEach(station => {
    console.log(`  - ${station.stationName}`);
  });
  
  console.log(`\nTotal: ${stationList.stations.length} stations`);
}

listStations().catch(console.error);