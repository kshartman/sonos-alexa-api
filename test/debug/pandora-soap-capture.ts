#!/usr/bin/env tsx
/**
 * Capture raw SOAP data during Pandora operations
 * Helps debug what's different between API calls and Sonos app
 */

import { XMLParser } from 'fast-xml-parser';

const DEVICE_IP = '192.168.11.46'; // OfficeSpeakers IP
const API_URL = 'http://localhost:5005';
const ROOM = 'OfficeSpeakers';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true
});

async function captureTransportInfo(label: string) {
  console.log(`\n=== ${label} ===`);
  console.log(`Time: ${new Date().toISOString()}`);
  
  // Get AVTransport info
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
    <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <s:Body>
        <u:GetPositionInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
          <InstanceID>0</InstanceID>
        </u:GetPositionInfo>
      </s:Body>
    </s:Envelope>`;
  
  try {
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
      console.log('\nTrackURI:', positionInfo.TrackURI);
      console.log('TrackMetaData (raw):', positionInfo.TrackMetaData);
      
      if (positionInfo.TrackMetaData) {
        // Decode and parse the metadata
        const decodedMetadata = positionInfo.TrackMetaData
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&');
        
        console.log('\nDecoded Metadata:');
        console.log(decodedMetadata);
        
        try {
          const metadataObj = xmlParser.parse(decodedMetadata);
          console.log('\nParsed Metadata:', JSON.stringify(metadataObj, null, 2));
        } catch (e) {
          console.log('Could not parse metadata:', e);
        }
      }
    }
  } catch (error) {
    console.error('SOAP Error:', error);
  }
  
  // Also get MediaInfo
  const mediaInfoBody = `<?xml version="1.0" encoding="utf-8"?>
    <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <s:Body>
        <u:GetMediaInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
          <InstanceID>0</InstanceID>
        </u:GetMediaInfo>
      </s:Body>
    </s:Envelope>`;
  
  try {
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
      console.log('\n--- Media Info ---');
      console.log('CurrentURI:', mediaInfo.CurrentURI);
      console.log('CurrentURIMetaData (raw):', mediaInfo.CurrentURIMetaData);
    }
  } catch (error) {
    console.error('MediaInfo SOAP Error:', error);
  }
}

async function playPandoraStation(stationName: string) {
  console.log(`\n📻 Playing station via API: ${stationName}`);
  const response = await fetch(`${API_URL}/${ROOM}/pandora/play/${encodeURIComponent(stationName)}`);
  console.log(`Response: ${response.status}`);
  if (!response.ok) {
    const error = await response.text();
    console.error('Error:', error);
  }
  return response.ok;
}

async function main() {
  console.log('🔍 Pandora SOAP Capture Tool');
  console.log(`Device: ${ROOM} (${DEVICE_IP})`);
  
  // Get current state
  await captureTransportInfo('INITIAL STATE');
  
  // Get stations
  const stationsResponse = await fetch(`${API_URL}/${ROOM}/pandora/stations`);
  if (!stationsResponse.ok) {
    console.error('Failed to get stations');
    return;
  }
  const stations = await stationsResponse.json();
  
  if (!Array.isArray(stations) || stations.length < 2) {
    console.error('Need at least 2 stations for testing');
    return;
  }
  
  console.log(`\nAvailable stations: ${stations.join(', ')}`);
  
  // Play first station
  console.log('\n--- TEST 1: Play First Station ---');
  if (await playPandoraStation(stations[0])) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    await captureTransportInfo('AFTER PLAYING FIRST STATION');
  }
  
  console.log('\n\nPress Enter to switch to second station...');
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });
  
  // Switch to second station
  console.log('\n--- TEST 2: Switch to Second Station ---');
  if (await playPandoraStation(stations[1])) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    await captureTransportInfo('AFTER SWITCHING STATION');
  }
  
  console.log('\n\nNow switch stations using the Sonos app, then press Enter to capture...');
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });
  
  await captureTransportInfo('AFTER SONOS APP SWITCH');
  
  console.log('\n✅ Capture complete');
}

main().catch(console.error);