#!/usr/bin/env npx tsx
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  trimValues: true
});

async function fetchSoapXml(ip: string, service: string, action: string, body: string) {
  // ContentDirectory has a different path
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

  console.log(`\nCalling ${service}/${action} with body:`, body);
  
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
  }
  return parser.parse(text);
}

async function browseContainer(ip: string, objectId: string) {
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
  if (!raw) return [];
  const parsed = parser.parse(raw);
  const items = parsed?.['DIDL-Lite']?.['item'] || parsed?.['DIDL-Lite']?.['container'];
  return Array.isArray(items) ? items : items ? [items] : [];
}

async function main() {
  const ip = '192.168.11.46'; // OfficeSpeakers IP
  const sid = '12';
  
  console.log(`Testing browse of SP:${sid} on ${ip}...`);
  
  try {
    const spRoot = await browseContainer(ip, `SP:${sid}`);
    console.log(`\nFound ${spRoot.length} items in Spotify root`);
    
    if (spRoot.length > 0) {
      console.log('\nSpotify root containers:');
      spRoot.forEach((item: any) => {
        const title = item['dc:title'];
        const id = item['@_id'];
        console.log(`  - ${title} (${id})`);
      });
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);