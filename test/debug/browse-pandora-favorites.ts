#!/usr/bin/env tsx

import logger from '../../src/utils/logger.js';

const API_URL = 'http://localhost:5005';
const testRoom = process.env.TEST_ROOM || 'OfficeSpeakers';

async function main() {
  try {
    // First get device IP
    const stateResponse = await fetch(`${API_URL}/${testRoom}/state`);
    if (!stateResponse.ok) {
      console.error('Failed to get device state');
      return;
    }
    
    const state = await stateResponse.json();
    const deviceIP = state.ip;
    
    console.log(`\nBrowsing Pandora favorites in FV:2 for device at ${deviceIP}...\n`);
    
    // Browse FV:2 directly via SOAP
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
      <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                  s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
        <s:Body>
          <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
            <ObjectID>FV:2</ObjectID>
            <BrowseFlag>BrowseDirectChildren</BrowseFlag>
            <Filter>*</Filter>
            <StartingIndex>0</StartingIndex>
            <RequestedCount>100</RequestedCount>
            <SortCriteria></SortCriteria>
          </u:Browse>
        </s:Body>
      </s:Envelope>`;
    
    const response = await fetch(`http://${deviceIP}:1400/MediaServer/ContentDirectory/Control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"'
      },
      body: soapBody
    });
    
    const text = await response.text();
    
    // Extract the Result field from SOAP response
    const resultMatch = text.match(/<Result>(.*?)<\/Result>/s);
    if (!resultMatch) {
      console.error('No Result found in response');
      return;
    }
    
    // Decode HTML entities
    const result = resultMatch[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    
    // Find all Pandora items (sid=236)
    const pandoraItems = result.match(/<item[^>]*>.*?<\/item>/gs) || [];
    const pandoraFavorites = pandoraItems.filter(item => item.includes('sid=236'));
    
    console.log(`Found ${pandoraFavorites.length} Pandora favorites:\n`);
    
    pandoraFavorites.forEach((item, index) => {
      // Extract title
      const titleMatch = item.match(/<dc:title>([^<]+)<\/dc:title>/);
      const title = titleMatch ? titleMatch[1] : 'Unknown';
      
      // Extract URI
      const uriMatch = item.match(/<res[^>]*>([^<]+)<\/res>/);
      const uri = uriMatch ? uriMatch[1] : 'Unknown';
      
      // Extract station ID from URI
      const stationMatch = uri.match(/ST[:%]3a([^?&]+)/i);
      const stationId = stationMatch ? decodeURIComponent(stationMatch[1]) : 'Unknown';
      
      // Extract session number
      const snMatch = uri.match(/sn=(\d+)/);
      const sessionNumber = snMatch ? snMatch[1] : 'Unknown';
      
      // Extract flags
      const flagsMatch = uri.match(/flags=(\d+)/);
      const flags = flagsMatch ? flagsMatch[1] : 'Unknown';
      
      console.log(`${index + 1}. ${title}`);
      console.log(`   Station ID: ${stationId}`);
      console.log(`   Session: ${sessionNumber}`);
      console.log(`   Flags: ${flags}`);
      console.log(`   Full URI: ${uri}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main();