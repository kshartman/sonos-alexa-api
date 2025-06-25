import { SonosDevice } from '../../src/sonos-device.js';
import { XMLParser } from 'fast-xml-parser';
import logger from '../../src/utils/logger.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true
});

/**
 * Check if Pandora service is available on the Sonos system
 */
export async function isPandoraAvailable(device: SonosDevice): Promise<boolean> {
  try {
    // Make SOAP request to ListAvailableServices
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
      <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                  s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
        <s:Body>
          <u:ListAvailableServices xmlns:u="urn:schemas-upnp-org:service:MusicServices:1">
          </u:ListAvailableServices>
        </s:Body>
      </s:Envelope>`;
    
    const response = await fetch(`${device.baseUrl}/MusicServices/Control`, {
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
    if (!services) return false;
    
    // Parse the XML list of services - it's HTML-encoded XML within XML
    const decodedServices = services
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    
    const servicesData = xmlParser.parse(decodedServices);
    const serviceList = servicesData.Services?.Service;
    if (!serviceList) return false;
    
    // Handle both single service and array of services
    const serviceArray = Array.isArray(serviceList) ? serviceList : [serviceList];
    
    // Check if Pandora exists
    return serviceArray.some(service => service['@_Name'] === 'Pandora');
  } catch (error) {
    logger.error('Error checking Pandora availability:', error);
    return false;
  }
}

/**
 * Find a Pandora station from favorites, or return fallback
 */
export async function getPandoraStationFromFavorites(device: SonosDevice): Promise<string> {
  try {
    const favorites = await device.getFavorites();
    
    // Look for Pandora stations in favorites
    // Pandora URIs typically look like: x-sonosapi-radio:ST%3a... or pndrradio:...
    const pandoraFavorite = favorites.find(fav => 
      fav.uri?.includes('pandora') || 
      fav.uri?.includes('pndrradio') ||
      (fav.uri?.includes('x-sonosapi-radio') && fav.metadata?.includes('Pandora'))
    );
    
    if (pandoraFavorite) {
      logger.info(`Found Pandora station in favorites: ${pandoraFavorite.title}`);
      return pandoraFavorite.title;
    }
    
    logger.info('No Pandora station found in favorites, using fallback: Thumbprint Radio');
    return 'Thumbprint Radio';
  } catch (error) {
    logger.error('Error getting Pandora station from favorites:', error);
    return 'Thumbprint Radio';
  }
}

/**
 * Helper to skip test if Pandora is not available
 */
export async function skipIfNoPandora(device: SonosDevice, context: Mocha.Context): Promise<boolean> {
  const pandoraAvailable = await isPandoraAvailable(device);
  
  if (!pandoraAvailable) {
    console.log('⚠️  Skipping test - Pandora service not available');
    context.skip();
    return true;
  }
  
  return false;
}