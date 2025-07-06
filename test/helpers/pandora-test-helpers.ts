import { XMLParser } from 'fast-xml-parser';
import { defaultConfig } from './test-config.js';
import { testLog } from './test-logger.js';

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
      testLog.info('⚠️  Pandora credentials not configured in settings.json');
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
      testLog.info('⚠️  No services found in SOAP response');
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
      testLog.info('⚠️  No services found in parsed list');
      return false;
    }
    
    // Handle both single service and array of services
    const serviceArray = Array.isArray(serviceList) ? serviceList : [serviceList];
    
    // Check if Pandora exists (Service ID 236)
    const hasPandora = serviceArray.some(service => 
      service['@_Name'] === 'Pandora' || service['@_Id'] === '236'
    );
    
    if (!hasPandora) {
      testLog.info('⚠️  Pandora service not available on Sonos system');
      return false;
    }
    
    testLog.info('✅ Pandora is available for testing (credentials configured and service available)');
    return true;
    
  } catch (error) {
    console.error('Error checking Pandora availability:', error);
    return false;
  }
}

/**
 * Get a Pandora station name for testing
 * @param room - The room to use for API calls
 * @param n - Which test station to get (1, 2, or 3). Defaults to 1.
 * @returns A station name from TEST_PANDORA_STATIONS env var or from API
 */
export async function getPandoraTestStation(room: string, n: number = 1): Promise<string> {
  // Default fallback stations
  const defaultStations = ['Thumbprint Radio', 'QuickMix', 'The Beatles Radio'];
  
  // Check if TEST_PANDORA_STATIONS is configured
  if (process.env.TEST_PANDORA_STATIONS) {
    const configuredStations = process.env.TEST_PANDORA_STATIONS.split(';').map(s => s.trim()).filter(s => s);
    
    // Get the requested station (n-1 for 0-based index)
    const index = n - 1;
    if (index >= 0 && index < configuredStations.length) {
      return configuredStations[index];
    }
    
    // If n is out of bounds but we have some stations, use modulo to wrap around
    if (configuredStations.length > 0) {
      return configuredStations[index % configuredStations.length];
    }
  }
  
  // Try to get stations from the API
  try {
    const stationsResponse = await fetch(`${defaultConfig.apiUrl}/${room}/pandora/stations`);
    if (stationsResponse.ok) {
      const stations = await stationsResponse.json();
      if (Array.isArray(stations) && stations.length > 0) {
        // Get the requested station
        const index = n - 1;
        if (index >= 0 && index < stations.length) {
          return stations[index];
        }
        // Wrap around if needed
        return stations[index % stations.length];
      }
    }
  } catch (error) {
    testLog.info('Could not get stations from API:', error);
  }
  
  // Fallback to default stations
  const index = n - 1;
  if (index >= 0 && index < defaultStations.length) {
    return defaultStations[index];
  }
  return defaultStations[0];
}