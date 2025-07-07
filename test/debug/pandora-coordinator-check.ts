#!/usr/bin/env tsx
/**
 * Check what's happening on the coordinator when switching Pandora stations
 */

import { XMLParser } from 'fast-xml-parser';

const COORDINATOR_IP = '192.168.11.47'; // OfficeSpeakers coordinator
const MEMBER_IP = '192.168.11.46'; // OfficeSpeakers member

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true
});

async function checkDevice(ip: string, label: string) {
  console.log(`\n=== ${label} (${ip}) ===`);
  
  // Get Position Info
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
    
    const response = await fetch(`http://${ip}:1400/MediaRenderer/AVTransport/Control`, {
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
      console.log('TrackURI:', positionInfo.TrackURI);
      
      if (positionInfo.TrackMetaData && positionInfo.TrackMetaData !== 'NOT_IMPLEMENTED') {
        const decoded = positionInfo.TrackMetaData
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&');
        
        console.log('\nTrackMetadata:');
        console.log(decoded);
        
        try {
          const parsed = xmlParser.parse(decoded);
          const item = parsed['DIDL-Lite']?.item;
          if (item) {
            console.log('\nParsed Metadata:');
            console.log('  Item ID:', item['@_id']);
            console.log('  Parent ID:', item['@_parentID']);
            console.log('  Title:', item['dc:title']);
            console.log('  Class:', item['upnp:class']);
            if (item['r:streamContent']) {
              console.log('  Stream Content:', item['r:streamContent']);
            }
            if (item.desc) {
              console.log('  Description:', JSON.stringify(item.desc, null, 2));
            }
          }
        } catch (e) {
          console.log('Could not parse metadata');
        }
      }
    }
  } catch (error) {
    console.error('Position Info Error:', error);
  }
  
  // Get Media Info
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
    
    const response = await fetch(`http://${ip}:1400/MediaRenderer/AVTransport/Control`, {
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
      console.log('\nCurrentURI:', mediaInfo.CurrentURI);
      
      if (mediaInfo.CurrentURIMetaData && mediaInfo.CurrentURIMetaData !== '') {
        const decoded = mediaInfo.CurrentURIMetaData
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&');
        
        console.log('\nCurrentURIMetadata:');
        console.log(decoded);
      }
    }
  } catch (error) {
    console.error('Media Info Error:', error);
  }
}

async function main() {
  console.log('🔍 Pandora Coordinator Check');
  console.log('Checking both coordinator and member devices...');
  
  await checkDevice(COORDINATOR_IP, 'COORDINATOR');
  await checkDevice(MEMBER_IP, 'MEMBER');
  
  console.log('\n\nNow switch Pandora stations in the Sonos app and press Enter...');
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });
  
  console.log('\nChecking after station switch...');
  await checkDevice(COORDINATOR_IP, 'COORDINATOR AFTER SWITCH');
  await checkDevice(MEMBER_IP, 'MEMBER AFTER SWITCH');
}

main().catch(console.error);