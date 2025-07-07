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
 * Get the count of available valid Pandora stations for testing
 * @param room - The room to use for API calls
 * @returns Number of valid stations available
 */
export async function getAvailablePandoraStationCount(room: string): Promise<number> {
  try {
    const stationsResponse = await fetch(`${defaultConfig.apiUrl}/${room}/pandora/stations`);
    if (stationsResponse.ok) {
      const allStations = await stationsResponse.json();
      if (Array.isArray(allStations)) {
        // Filter out QuickMix and Thumbprint as they behave differently
        const validStations = allStations.filter(s => 
          s !== 'QuickMix' && 
          s !== 'Thumbprint Radio' &&
          !s.includes('Thumbprint') &&
          !s.includes('QuickMix')
        );
        return validStations.length;
      }
    }
  } catch (error) {
    testLog.warn('Could not get station count:', error);
  }
  return 0;
}

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
  
  // First, get the actual available stations from the API
  let actualStations: string[] = [];
  try {
    const stationsResponse = await fetch(`${defaultConfig.apiUrl}/${room}/pandora/stations`);
    if (stationsResponse.ok) {
      const allStations = await stationsResponse.json();
      if (Array.isArray(allStations) && allStations.length > 0) {
        actualStations = allStations;
        testLog.info(`   Found ${actualStations.length} Pandora stations from API`);
      } else {
        testLog.warn(`   API returned empty or non-array stations: ${JSON.stringify(allStations)}`);
      }
    } else {
      const errorText = await stationsResponse.text();
      testLog.warn(`   Failed to get stations from API: ${stationsResponse.status} - ${errorText}`);
      // Don't try to use fake stations - if the API fails, we have no valid stations
    }
  } catch (error) {
    testLog.warn('Could not get stations from API:', error);
  }
  
  // Build our final list of stations to use
  const finalStations: string[] = [];
  
  // Check if TEST_PANDORA_STATIONS is configured and not empty
  if (process.env.TEST_PANDORA_STATIONS && process.env.TEST_PANDORA_STATIONS.trim()) {
    const configuredStations = process.env.TEST_PANDORA_STATIONS.split(';').map(s => s.trim()).filter(s => s);
    
    // If we have actualStations, validate configured stations
    if (actualStations.length > 0) {
      // Process each configured station
      for (let i = 0; i < configuredStations.length && finalStations.length < 5; i++) {
        const configStation = configuredStations[i];
        
        // Look for exact match only
        const exactMatch = actualStations.find(s => s === configStation);
        
        if (exactMatch) {
          // Found exact match
          if (!finalStations.includes(exactMatch) && !usedStations.has(exactMatch)) {
            finalStations.push(exactMatch);
            testLog.info(`   ✅ Using configured station: "${exactMatch}"`);
          }
        } else {
          // No exact match found - warn and select a replacement
          testLog.warn(`   ⚠️ Configured station "${configStation}" not found (exact match required)`);
          
          // Find a replacement from actual stations
          // Filter out QuickMix and Thumbprint Radio as they behave differently
          const userStations = actualStations.filter(s => 
            s !== 'QuickMix' && 
            s !== 'Thumbprint Radio' &&
            !s.includes('Thumbprint') &&
            !s.includes('QuickMix') &&
            !finalStations.includes(s) &&
            !usedStations.has(s)
          );
          
          if (userStations.length > 0) {
            const replacement = userStations[0];
            finalStations.push(replacement);
            testLog.info(`   → Replaced with: "${replacement}"`);
          }
        }
      }
    } else {
      // No actual stations available - just use configured ones as-is
      for (let i = 0; i < configuredStations.length && finalStations.length < 5; i++) {
        const configStation = configuredStations[i];
        if (!finalStations.includes(configStation) && !usedStations.has(configStation)) {
          finalStations.push(configStation);
          testLog.warn(`   ⚠️ Using configured station without validation: "${configStation}" (API unavailable)`);
        }
      }
    }
  }
  
  // If we don't have enough stations yet, fill from actual stations or use defaults
  if (finalStations.length < 5) {
    if (actualStations.length > 0) {
      // Filter out QuickMix and Thumbprint Radio as they behave differently
      const userStations = actualStations.filter(s => 
        s !== 'QuickMix' && 
        s !== 'Thumbprint Radio' &&
        !s.includes('Thumbprint') &&
        !s.includes('QuickMix') &&
        !finalStations.includes(s) &&
        !usedStations.has(s)
      );
      
      // Add stations until we have 5
      for (const station of userStations) {
        if (finalStations.length >= 5) break;
        finalStations.push(station);
        if (!process.env.TEST_PANDORA_STATIONS) {
          testLog.info(`   Added station: "${station}"`);
        }
      }
    } else {
      // No actual stations available - use default station names
      const defaultStations = ['Thumbprint Radio', 'QuickMix', 'Today\'s Hits Radio', 'Classic Rock Radio', 'Pop Hits Radio'];
      for (const station of defaultStations) {
        if (finalStations.length >= 5) break;
        if (!finalStations.includes(station) && !usedStations.has(station)) {
          finalStations.push(station);
          testLog.warn(`   Using default station name: "${station}" (API unavailable)`);
        }
      }
    }
  }
  
  // Return the requested station
  if (finalStations.length >= n) {
    const station = finalStations[n - 1];
    usedStations.add(station);
    return station;
  }
  
  // If we still don't have enough stations, throw error
  throw new Error(`Could not find enough Pandora stations for testing (need ${n}, have ${finalStations.length})`);
}