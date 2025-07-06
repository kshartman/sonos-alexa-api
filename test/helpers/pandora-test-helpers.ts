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

// Track stations that have been selected across test runs
const usedStations = new Set<string>();

/**
 * Get a Pandora station name for testing
 * @param room - The room to use for API calls
 * @param n - Which test station to get (1-5). Throws if n > 5.
 * @returns A unique station name from TEST_PANDORA_STATIONS env var or from API
 */
export async function getPandoraTestStation(room: string, n: number = 1): Promise<string> {
  // Validate index
  if (n < 1 || n > 5) {
    throw new Error(`Station index ${n} out of bounds. Must be between 1 and 5.`);
  }
  
  // Default fallback stations
  const defaultStations = ['Thumbprint Radio', 'QuickMix', 'The Beatles Radio', 'Today\'s Hits Radio', 'Classic Rock Radio'];
  
  // Build a list of available stations, starting with env var stations
  let availableStations: string[] = [];
  
  // Check if TEST_PANDORA_STATIONS is configured
  if (process.env.TEST_PANDORA_STATIONS) {
    const configuredStations = process.env.TEST_PANDORA_STATIONS.split(';').map(s => s.trim()).filter(s => s);
    
    // De-duplicate and add to available stations
    const uniqueConfigured = [...new Set(configuredStations)];
    availableStations.push(...uniqueConfigured);
    
    // If we have enough unique stations from env var, use them
    if (availableStations.length >= n) {
      const station = availableStations[n - 1];
      usedStations.add(station);
      testLog.info(`   (from TEST_PANDORA_STATIONS env)`);
      return station;
    }
  }
  
  // If we need more stations, try to get them from the API
  try {
    const stationsResponse = await fetch(`${defaultConfig.apiUrl}/${room}/pandora/stations`);
    if (stationsResponse.ok) {
      const allStations = await stationsResponse.json();
      if (Array.isArray(allStations) && allStations.length > 0) {
        // Filter out QuickMix and Thumbprint Radio as they behave differently
        const userStations = allStations.filter(s => 
          s !== 'QuickMix' && 
          s !== 'Thumbprint Radio' &&
          !s.includes('Thumbprint') &&
          !s.includes('QuickMix')
        );
        
        // Add API stations that aren't already in our list (avoid duplicates)
        for (const station of userStations) {
          if (!availableStations.includes(station)) {
            availableStations.push(station);
          }
        }
        
        // Now we have all unique stations from env + API, pick the nth one
        if (availableStations.length >= n) {
          const station = availableStations[n - 1];
          usedStations.add(station);
          testLog.info(`   (from ${availableStations.length <= (process.env.TEST_PANDORA_STATIONS?.split(';').length || 0) ? 'TEST_PANDORA_STATIONS env' : 'Pandora API'})`);
          return station;
        }
      }
    }
  } catch (error) {
    testLog.info('Could not get stations from API:', error);
  }
  
  // Fallback to default stations
  const index = n - 1;
  if (index >= 0 && index < defaultStations.length) {
    const station = defaultStations[index];
    usedStations.add(station);
    return station;
  }
  
  // Should never reach here due to validation
  throw new Error(`Could not find station for index ${n}`);
}