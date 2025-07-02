#!/usr/bin/env npx tsx
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  trimValues: true
});

async function fetchSoapXml(ip: string, service: string, action: string, body: string) {
  const path = service === 'ContentDirectory' ? '/MediaServer/ContentDirectory/Control' : 
               service === 'DeviceProperties' ? '/DeviceProperties/Control' : 
               service === 'MusicServices' ? '/MusicServices/Control' :
               `/${service}/Control`;
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

async function getAvailableServices(ip: string) {
  try {
    // Try our method first - MusicServices/ListAvailableServices
    const result = await fetchSoapXml(ip, 'MusicServices', 'ListAvailableServices', '');
    const list = result['s:Envelope']?.['s:Body']?.['u:ListAvailableServicesResponse']?.['AvailableServiceDescriptorList'];
    if (!list) {
      console.log('\nNo AvailableServiceDescriptorList found. Full response:');
      console.log(JSON.stringify(result, null, 2));
      return null;
    }
    
    console.log('\nRaw AvailableServiceDescriptorList:');
    console.log(list.substring(0, 500) + '...');
    
    const parsed = parser.parse(list);
    console.log('\nParsed structure:');
    console.log(JSON.stringify(parsed, null, 2).substring(0, 1000) + '...');
    
    const services = parsed?.Services?.Service;
    const serviceList = Array.isArray(services) ? services : services ? [services] : [];
    
    console.log(`\nFound ${serviceList.length} services`);
    
    const spotify = serviceList.find((svc: any) => svc?.['@_Name'] === 'Spotify');
    if (!spotify) {
      console.log('\nNo Spotify service found. Available services:');
      serviceList.slice(0, 10).forEach((svc: any) => {
        console.log(`  - ${svc?.['@_Name']} (ID: ${svc?.['@_Id']})`);
      });
      console.log('  ... and more');
      return null;
    }
    
    console.log('\nSpotify service found:');
    console.log(JSON.stringify(spotify, null, 2));
    
    return {
      sid: spotify?.['@_Id'],
      manifestUrl: spotify?.Manifest?.['@_Uri'],
      uri: spotify?.['@_Uri'],
      secureUri: spotify?.['@_SecureUri']
    };
  } catch (error) {
    console.error('Error:', error);
    return null;
  }
}

async function main() {
  const ip = '192.168.11.46'; // OfficeSpeakers IP
  
  console.log(`Getting available services from ${ip}...`);
  
  const spotifyInfo = await getAvailableServices(ip);
  
  if (spotifyInfo) {
    console.log('\nSpotify service info:');
    console.log(`  SID: ${spotifyInfo.sid}`);
    console.log(`  URI: ${spotifyInfo.uri}`);
    console.log(`  Secure URI: ${spotifyInfo.secureUri}`);
    console.log(`  Manifest: ${spotifyInfo.manifestUrl}`);
  }
}

main().catch(console.error);