#!/usr/bin/env tsx
/**
 * Monitor Pandora station switching behavior
 * Records detailed state at each step
 */

import { testLog } from '../helpers/test-logger.js';

const API_URL = 'http://localhost:5005';
const ROOM = 'OfficeSpeakers';
const MONITOR_INTERVAL = 500; // Check state every 500ms

interface DetailedState {
  timestamp: string;
  playbackState: string;
  currentTrack?: {
    uri?: string;
    title?: string;
    artist?: string;
    album?: string;
    duration?: number;
    queuePosition?: number;
  };
  transportUri?: string;
  transportMetadata?: string;
  avTransportUri?: string;
  avTransportUriMetadata?: string;
  nextTrack?: {
    uri?: string;
    title?: string;
  };
}

async function getDetailedState(): Promise<DetailedState> {
  try {
    const response = await fetch(`${API_URL}/${ROOM}/state`);
    const state = await response.json();
    
    // Also get transport info for more details
    const transportResponse = await fetch(`${API_URL}/debug/${ROOM}/transport-info`);
    const transportInfo = transportResponse.ok ? await transportResponse.json() : {};
    
    return {
      timestamp: new Date().toISOString(),
      playbackState: state.playbackState,
      currentTrack: state.currentTrack,
      transportUri: transportInfo.CurrentURI,
      transportMetadata: transportInfo.CurrentURIMetaData,
      avTransportUri: transportInfo.AVTransportURI,
      avTransportUriMetadata: transportInfo.AVTransportURIMetaData,
      nextTrack: state.nextTrack
    };
  } catch (error) {
    return {
      timestamp: new Date().toISOString(),
      playbackState: 'ERROR',
      currentTrack: { title: `Error: ${error}` }
    };
  }
}

function logState(label: string, state: DetailedState) {
  console.log(`\n=== ${label} [${state.timestamp}] ===`);
  console.log(`State: ${state.playbackState}`);
  if (state.currentTrack) {
    console.log(`Track: ${state.currentTrack.title || 'Unknown'}`);
    console.log(`Artist: ${state.currentTrack.artist || 'Unknown'}`);
    console.log(`URI: ${state.currentTrack.uri || 'None'}`);
  }
  if (state.transportUri) {
    console.log(`Transport URI: ${state.transportUri}`);
  }
  if (state.avTransportUri && state.avTransportUri !== state.transportUri) {
    console.log(`AVTransport URI: ${state.avTransportUri}`);
  }
}

async function monitorStationSwitch(fromStation: string, toStation: string) {
  console.log(`\n🎵 Monitoring Pandora station switch: "${fromStation}" → "${toStation}"`);
  
  // Step 1: Ensure we're playing the first station
  console.log(`\n📻 Step 1: Playing initial station: ${fromStation}`);
  let response = await fetch(`${API_URL}/${ROOM}/pandora/play/${encodeURIComponent(fromStation)}`);
  if (!response.ok) {
    console.error(`Failed to play initial station: ${response.status}`);
    return;
  }
  
  // Wait for it to stabilize
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Record initial state
  const states: DetailedState[] = [];
  let initialState = await getDetailedState();
  states.push(initialState);
  logState('INITIAL STATE', initialState);
  
  // Step 2: Start monitoring and switch stations
  console.log(`\n📻 Step 2: Switching to: ${toStation}`);
  console.log('Starting continuous monitoring...');
  
  // Start monitoring
  let monitoring = true;
  const monitorPromise = (async () => {
    while (monitoring) {
      const state = await getDetailedState();
      states.push(state);
      
      // Only log significant changes
      const lastState = states[states.length - 2];
      if (lastState && (
        state.playbackState !== lastState.playbackState ||
        state.currentTrack?.uri !== lastState.currentTrack?.uri ||
        state.transportUri !== lastState.transportUri
      )) {
        logState('STATE CHANGE', state);
      }
      
      await new Promise(resolve => setTimeout(resolve, MONITOR_INTERVAL));
    }
  })();
  
  // Perform the switch
  const switchStartTime = Date.now();
  response = await fetch(`${API_URL}/${ROOM}/pandora/play/${encodeURIComponent(toStation)}`);
  const switchDuration = Date.now() - switchStartTime;
  
  if (!response.ok) {
    console.error(`\n❌ Station switch failed: ${response.status}`);
    const error = await response.text();
    console.error(error);
    monitoring = false;
    return;
  }
  
  console.log(`\n✅ Station switch request completed in ${switchDuration}ms`);
  
  // Monitor for 10 seconds after switch
  await new Promise(resolve => setTimeout(resolve, 10000));
  monitoring = false;
  await monitorPromise;
  
  // Final state
  const finalState = await getDetailedState();
  logState('FINAL STATE', finalState);
  
  // Analyze the transition
  console.log('\n=== TRANSITION ANALYSIS ===');
  console.log(`Total states captured: ${states.length}`);
  
  // Find key transitions
  const stateChanges = states.filter((state, i) => 
    i > 0 && state.playbackState !== states[i-1].playbackState
  );
  console.log(`\nPlayback state changes: ${stateChanges.length}`);
  stateChanges.forEach(state => {
    console.log(`  - ${state.timestamp}: ${state.playbackState}`);
  });
  
  const trackChanges = states.filter((state, i) => 
    i > 0 && state.currentTrack?.uri !== states[i-1].currentTrack?.uri
  );
  console.log(`\nTrack URI changes: ${trackChanges.length}`);
  trackChanges.forEach(state => {
    console.log(`  - ${state.timestamp}: ${state.currentTrack?.title || 'Unknown'}`);
    console.log(`    URI: ${state.currentTrack?.uri || 'None'}`);
  });
  
  return states;
}

async function main() {
  console.log('🔍 Pandora Station Monitor');
  console.log('This tool monitors state changes during Pandora station switching\n');
  
  // Get available stations
  const stationsResponse = await fetch(`${API_URL}/${ROOM}/pandora/stations`);
  if (!stationsResponse.ok) {
    console.error('Failed to get Pandora stations');
    return;
  }
  
  const stations = await stationsResponse.json();
  console.log(`Found ${stations.length} Pandora stations:`);
  stations.forEach((station: string, i: number) => {
    console.log(`  ${i + 1}. ${station}`);
  });
  
  // Test switching between first two stations
  if (stations.length >= 2) {
    await monitorStationSwitch(stations[0], stations[1]);
    
    console.log('\n\nPress Enter to test reverse switch...');
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });
    
    await monitorStationSwitch(stations[1], stations[0]);
  }
  
  console.log('\n✅ Monitoring complete');
}

main().catch(console.error);