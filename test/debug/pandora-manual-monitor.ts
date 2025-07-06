#!/usr/bin/env tsx
/**
 * Monitor Pandora state while manually switching stations in Sonos app
 * Captures detailed SOAP data at each change
 */

import { XMLParser } from 'fast-xml-parser';

const DEVICE_IP = '192.168.11.46'; // OfficeSpeakers IP
const COORDINATOR_IP = '192.168.11.47'; // Coordinator (from the x-rincon URI)
const API_URL = 'http://localhost:5005';
const ROOM = 'OfficeSpeakers';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true
});

interface CapturedState {
  timestamp: string;
  playbackState?: string;
  trackUri?: string;
  trackMetadata?: string;
  currentUri?: string;
  currentUriMetadata?: string;
  title?: string;
  artist?: string;
}

let lastState: CapturedState | null = null;

async function captureFullState(): Promise<CapturedState> {
  const state: CapturedState = {
    timestamp: new Date().toISOString()
  };
  
  // Get playback state from API
  try {
    const response = await fetch(`${API_URL}/${ROOM}/state`);
    const apiState = await response.json();
    state.playbackState = apiState.playbackState;
    state.title = apiState.currentTrack?.title;
    state.artist = apiState.currentTrack?.artist;
  } catch (error) {
    console.error('API Error:', error);
  }
  
  // Get Position Info (Track-level data)
  try {
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
      <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                  s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
        <s:Body>
          <u:GetPositionInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
            <InstanceID>0</InstanceID>
          </u:GetPositionInfo>
        </s:Body>
      </s:Envelope>`;
    
    const response = await fetch(`http://${DEVICE_IP}:1400/MediaRenderer/AVTransport/Control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPACTION': '"urn:schemas-upnp-org:service:AVTransport:1#GetPositionInfo"'
      },
      body: soapBody
    });
    
    const text = await response.text();
    const data = xmlParser.parse(text);
    
    const positionInfo = data['s:Envelope']?.['s:Body']?.['u:GetPositionInfoResponse'];
    if (positionInfo) {
      state.trackUri = positionInfo.TrackURI;
      state.trackMetadata = positionInfo.TrackMetaData;
    }
  } catch (error) {
    // Ignore errors
  }
  
  // Get Media Info (Transport-level data)
  try {
    const mediaInfoBody = `<?xml version="1.0" encoding="utf-8"?>
      <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                  s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
        <s:Body>
          <u:GetMediaInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
            <InstanceID>0</InstanceID>
          </u:GetMediaInfo>
        </s:Body>
      </s:Envelope>`;
    
    const response = await fetch(`http://${DEVICE_IP}:1400/MediaRenderer/AVTransport/Control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPACTION': '"urn:schemas-upnp-org:service:AVTransport:1#GetMediaInfo"'
      },
      body: mediaInfoBody
    });
    
    const text = await response.text();
    const data = xmlParser.parse(text);
    
    const mediaInfo = data['s:Envelope']?.['s:Body']?.['u:GetMediaInfoResponse'];
    if (mediaInfo) {
      state.currentUri = mediaInfo.CurrentURI;
      state.currentUriMetadata = mediaInfo.CurrentURIMetaData;
    }
  } catch (error) {
    // Ignore errors
  }
  
  return state;
}

function hasStateChanged(current: CapturedState, previous: CapturedState | null): boolean {
  if (!previous) return true;
  
  return current.playbackState !== previous.playbackState ||
         current.trackUri !== previous.trackUri ||
         current.currentUri !== previous.currentUri ||
         current.title !== previous.title;
}

function logStateChange(state: CapturedState, label: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`${label} - ${state.timestamp}`);
  console.log('='.repeat(80));
  
  console.log(`\nPlayback State: ${state.playbackState}`);
  console.log(`Track: ${state.title || 'Unknown'} - ${state.artist || 'Unknown'}`);
  
  console.log(`\nTrackURI: ${state.trackUri}`);
  if (state.trackMetadata && state.trackMetadata !== 'NOT_IMPLEMENTED') {
    console.log('TrackMetadata (raw):');
    console.log(state.trackMetadata);
    
    // Try to decode it
    try {
      const decoded = state.trackMetadata
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');
      
      console.log('\nTrackMetadata (decoded):');
      console.log(decoded);
      
      const parsed = xmlParser.parse(decoded);
      const item = parsed['DIDL-Lite']?.item;
      if (item) {
        console.log('\nParsed item ID:', item['@_id']);
        console.log('Parent ID:', item['@_parentID']);
        console.log('Title:', item['dc:title']);
        console.log('Class:', item['upnp:class']);
        console.log('Description:', item.desc);
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
  
  console.log(`\nCurrentURI: ${state.currentUri}`);
  if (state.currentUriMetadata && state.currentUriMetadata !== 'NOT_IMPLEMENTED') {
    console.log('CurrentURIMetadata (raw):');
    console.log(state.currentUriMetadata);
  }
}

async function monitor() {
  console.log('🎵 Pandora Manual Station Switch Monitor');
  console.log('This tool monitors OfficeSpeakers while you switch stations in the Sonos app\n');
  console.log('Initial capture...');
  
  lastState = await captureFullState();
  logStateChange(lastState, 'INITIAL STATE');
  
  console.log('\n📱 Now switch Pandora stations using the Sonos app');
  console.log('   The monitor will capture any changes automatically');
  console.log('   Press Ctrl+C to stop monitoring\n');
  
  // Monitor continuously
  setInterval(async () => {
    const currentState = await captureFullState();
    
    if (hasStateChanged(currentState, lastState)) {
      logStateChange(currentState, 'STATE CHANGE DETECTED');
      lastState = currentState;
    }
  }, 500); // Check every 500ms
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n✅ Monitoring stopped');
  process.exit(0);
});

monitor().catch(console.error);