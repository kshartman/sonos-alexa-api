import { XMLParser } from 'fast-xml-parser';
import { defaultConfig } from './test-config.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true
});

/**
 * Check if Pandora is available for testing
 * Requires both:
 * 1. Pandora credentials configured in settings.json
 * 2. Pandora service available on Sonos system (via SOAP)
 */
export async function isPandoraAvailableForTesting(deviceIP: string): Promise<boolean> {
  try {
    // Check 1: Are Pandora credentials configured?
    const settingsResponse = await fetch(`${defaultConfig.apiUrl}/settings`);
    const settings = await settingsResponse.json();
    
    if (!settings.pandora?.configured) {
      console.log('⚠️  Pandora credentials not configured in settings.json');
      return false;
    }
    
    // Check 2: Is Pandora service available on Sonos system?
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
      <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                  s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
        <s:Body>
          <u:ListAvailableServices xmlns:u="urn:schemas-upnp-org:service:MusicServices:1">
          </u:ListAvailableServices>
        </s:Body>
      </s:Envelope>`;
    
    const response = await fetch(`http://${deviceIP}:1400/MusicServices/Control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPACTION': '"urn:schemas-upnp-org:service:MusicServices:1#ListAvailableServices"'
      },
      body: soapBody
    });
    
    const text = await response.text();
    const data = xmlParser.parse(text);
    
    // Navigate through the SOAP response
    const services = data['s:Envelope']?.['s:Body']?.['u:ListAvailableServicesResponse']?.AvailableServiceDescriptorList;
    if (!services) {
      console.log('⚠️  No services found in SOAP response');
      return false;
    }
    
    // Parse the XML list of services - it's HTML-encoded XML within XML
    const decodedServices = services
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    
    const servicesData = xmlParser.parse(decodedServices);
    const serviceList = servicesData.Services?.Service;
    if (!serviceList) {
      console.log('⚠️  No services found in parsed list');
      return false;
    }
    
    // Handle both single service and array of services
    const serviceArray = Array.isArray(serviceList) ? serviceList : [serviceList];
    
    // Check if Pandora exists (Service ID 236)
    const hasPandora = serviceArray.some(service => 
      service['@_Name'] === 'Pandora' || service['@_Id'] === '236'
    );
    
    if (!hasPandora) {
      console.log('⚠️  Pandora service not available on Sonos system');
      return false;
    }
    
    console.log('✅ Pandora is available for testing (credentials configured and service available)');
    return true;
    
  } catch (error) {
    console.error('Error checking Pandora availability:', error);
    return false;
  }
}

/**
 * Get a Pandora station name for testing
 * First tries to find one in favorites, then falls back to default stations
 */
export async function getPandoraTestStation(room: string): Promise<string> {
  try {
    // Try to get a station from the API's station list
    const stationsResponse = await fetch(`${defaultConfig.apiUrl}/${room}/pandora/stations`);
    if (stationsResponse.ok) {
      const stations = await stationsResponse.json();
      if (Array.isArray(stations) && stations.length > 0) {
        // Response is just station names (default behavior)
        return stations[0];
      }
    }
  } catch (error) {
    console.log('Could not get stations from API:', error);
  }
  
  // Fallback to default station
  return 'Thumbprint Radio';
}