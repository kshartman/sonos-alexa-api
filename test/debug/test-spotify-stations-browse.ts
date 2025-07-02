#!/usr/bin/env npx tsx
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  trimValues: true
});

async function fetchSoapXml(ip: string, service: string, action: string, body: string) {
  const path = service === 'ContentDirectory' ? '/MediaServer/ContentDirectory/Control' : `/${service}/Control`;
  const url = `http://${ip}:1400${path}`;
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
    <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <s:Body>
        <u:${action} xmlns:u="urn:schemas-upnp-org:service:${service}:1">
          ${body}
        </u:${action}>
      </s:Body>
    </s:Envelope>`;

  console.log(`\nCalling ${service}/${action} on ${url}`);
  console.log(`ObjectID: ${body.match(/<ObjectID>([^<]+)<\/ObjectID>/)?.[1]}`);
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPAction': `"urn:schemas-upnp-org:service:${service}:1#${action}"`
    },
    body: soapBody
  });

  const text = await res.text();
  if (!res.ok) {
    console.log('Error response:', text);
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return parser.parse(text);
}

async function browseContainer(ip: string, objectId: string) {
  try {
    const result = await fetchSoapXml(
      ip,
      'ContentDirectory',
      'Browse',
      `<ObjectID>${objectId}</ObjectID>
       <BrowseFlag>BrowseDirectChildren</BrowseFlag>
       <Filter>*</Filter>
       <StartingIndex>0</StartingIndex>
       <RequestedCount>100</RequestedCount>
       <SortCriteria></SortCriteria>`
    );
    
    const raw = result['s:Envelope']?.['s:Body']?.['u:BrowseResponse']?.['Result'];
    if (!raw) {
      console.log('No result in response');
      return [];
    }
    
    const parsed = parser.parse(raw);
    const containers = parsed?.['DIDL-Lite']?.['container'];
    const items = parsed?.['DIDL-Lite']?.['item'];
    
    const allItems = [];
    if (containers) {
      allItems.push(...(Array.isArray(containers) ? containers : [containers]));
    }
    if (items) {
      allItems.push(...(Array.isArray(items) ? items : [items]));
    }
    
    return allItems;
  } catch (error: any) {
    if (error.message?.includes('701')) {
      console.log(`❌ Error 701: Cannot browse ${objectId} - Invalid or protected container`);
      return [];
    }
    throw error;
  }
}

async function main() {
  const ip = '192.168.11.46'; // OfficeSpeakers IP
  
  console.log('Testing Spotify station/radio browsing...\n');
  
  // Try various potential Spotify station containers
  const testContainers = [
    'R:0/0',              // Radio root
    'R:0/1',              // Internet Radio
    'A:ARTIST',           // Artist stations
    'A:ALBUMARTIST',      // Album artist stations
    'SP:stations',        // Spotify stations
    'SP:radio',           // Spotify radio
    '0:spotify:stations', // Spotify stations container
    '0:spotify:radio'     // Spotify radio container
  ];
  
  for (const container of testContainers) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Attempting to browse: ${container}`);
    console.log(`${'='.repeat(60)}`);
    
    try {
      const items = await browseContainer(ip, container);
      
      if (items.length > 0) {
        console.log(`✅ Found ${items.length} items:`);
        items.slice(0, 10).forEach((item: any) => {
          const title = item['dc:title'] || 'No title';
          const id = item['@_id'] || 'No ID';
          const res = item['res'] || item['r:resMD'] || 'No resource';
          console.log(`  - ${title}`);
          console.log(`    ID: ${id}`);
          if (typeof res === 'string' && res.includes('spotify')) {
            console.log(`    Resource: ${res}`);
          }
        });
        if (items.length > 10) {
          console.log(`  ... and ${items.length - 10} more`);
        }
      } else {
        console.log('❌ No items found or container not accessible');
      }
    } catch (error) {
      console.error(`❌ Error: ${error}`);
    }
  }
  
  // Also try browsing music services root
  console.log(`\n${'='.repeat(60)}`);
  console.log('Browsing Music Services root (S:)');
  console.log(`${'='.repeat(60)}`);
  
  try {
    const items = await browseContainer(ip, 'S:');
    if (items.length > 0) {
      console.log(`Found ${items.length} music services:`);
      items.forEach((item: any) => {
        const title = item['dc:title'] || 'No title';
        const id = item['@_id'] || 'No ID';
        console.log(`  - ${title} (${id})`);
      });
    }
  } catch (error) {
    console.error(`Error: ${error}`);
  }
}

main().catch(console.error);