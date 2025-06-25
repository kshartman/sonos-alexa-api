import logger from '../utils/logger.js';
import { XMLParser } from 'fast-xml-parser';
import type { SonosDevice } from '../sonos-device.js';

export interface PandoraStation {
  id: string;
  title: string;
  uri: string;
}

export class PandoraBrowser {
  private static xmlParser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true
  });

  /**
   * Get available Pandora stations from Sonos device
   */
  static async getStations(device: SonosDevice): Promise<PandoraStation[]> {
    try {
      // First, get the Pandora service ID
      const serviceId = await this.getPandoraServiceId(device);
      if (!serviceId) {
        throw new Error('Pandora service not found on this Sonos system');
      }
      
      logger.debug(`Found Pandora service ID: ${serviceId}`);
      
      // First browse the root to find available containers
      const rootContainers = await this.browseRoot(device, serviceId);
      logger.debug('Pandora root containers:', rootContainers);
      
      // Look for stations container
      const stationsContainer = rootContainers.find(c => 
        c.id.includes('stations') || c.title.toLowerCase().includes('station')
      );
      
      if (!stationsContainer) {
        logger.warn('No stations container found in Pandora root');
        return [];
      }
      
      // Browse the stations container
      const objectId = stationsContainer.id;
      
      // Make SOAP request directly
      const soapBody = `<?xml version="1.0" encoding="utf-8"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                    s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
          <s:Body>
            <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
              <ObjectID>${objectId}</ObjectID>
              <BrowseFlag>BrowseDirectChildren</BrowseFlag>
              <Filter>*</Filter>
              <StartingIndex>0</StartingIndex>
              <RequestedCount>100</RequestedCount>
              <SortCriteria></SortCriteria>
            </u:Browse>
          </s:Body>
        </s:Envelope>`;
      
      const response = await fetch(`${device.baseUrl}/MediaServer/ContentDirectory/Control`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"'
        },
        body: soapBody
      });
      
      const responseText = await response.text();
      const responseData = this.xmlParser.parse(responseText);
      
      // Check for SOAP fault
      const fault = responseData['s:Envelope']?.['s:Body']?.['s:Fault'];
      if (fault) {
        const errorCode = fault.detail?.UPnPError?.errorCode;
        if (errorCode === '701') {
          throw new Error('Pandora not logged in. Please use the Sonos app to log into Pandora first.');
        }
        throw new Error(`Pandora error ${errorCode}: ${fault.faultstring}`);
      }
      
      // Extract the Result from the SOAP response
      const result = responseData['s:Envelope']?.['s:Body']?.['u:BrowseResponse']?.Result;
      if (!result) {
        return [];
      }
      
      return this.parseStations(result);
    } catch (error) {
      logger.error('Error browsing Pandora stations:', error);
      throw error;
    }
  }
  
  /**
   * Get Pandora service ID from available services
   */
  private static async getPandoraServiceId(device: SonosDevice): Promise<string | null> {
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
      const data = this.xmlParser.parse(text);
      
      // Navigate through the SOAP response
      const services = data['s:Envelope']?.['s:Body']?.['u:ListAvailableServicesResponse']?.AvailableServiceDescriptorList;
      if (!services) return null;
      
      // Parse the XML list of services - it's HTML-encoded XML within XML
      // Decode HTML entities first
      const decodedServices = services
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');
      
      const servicesData = this.xmlParser.parse(decodedServices);
      const serviceList = servicesData.Services?.Service;
      if (!serviceList) return null;
      
      // Handle both single service and array of services
      const serviceArray = Array.isArray(serviceList) ? serviceList : [serviceList];
      
      for (const service of serviceArray) {
        if (service['@_Name'] === 'Pandora' && service['@_Id']) {
          logger.debug(`Found Pandora service with ID: ${service['@_Id']}`);
          return service['@_Id'];
        }
      }
      
      logger.debug('Pandora service not found in available services');
      return null;
    } catch (error) {
      logger.error('Error getting Pandora service ID:', error);
      return null;
    }
  }
  
  /**
   * Parse stations from Browse response
   */
  private static parseStations(result: string): PandoraStation[] {
    try {
      if (!result) {
        return [];
      }
      
      // The result is DIDL-Lite XML
      const data = this.xmlParser.parse(result);
      const items = data['DIDL-Lite']?.item;
      if (!items) return [];
      
      // Handle both single item and array of items
      const itemArray = Array.isArray(items) ? items : [items];
      const stations: PandoraStation[] = [];
      
      for (const item of itemArray) {
        const id = item['@_id'];
        const title = item['dc:title'];
        
        if (id && title) {
          stations.push({
            id,
            title,
            uri: id // The ID is the URI for Pandora stations
          });
        }
      }
      
      return stations;
    } catch (error) {
      logger.error('Error parsing Pandora stations:', error);
      return [];
    }
  }
  
  /**
   * Browse root of Pandora service to find available containers
   */
  private static async browseRoot(device: SonosDevice, serviceId: string): Promise<Array<{id: string, title: string}>> {
    try {
      const soapBody = `<?xml version="1.0" encoding="utf-8"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                    s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
          <s:Body>
            <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
              <ObjectID>S:${serviceId}</ObjectID>
              <BrowseFlag>BrowseDirectChildren</BrowseFlag>
              <Filter>*</Filter>
              <StartingIndex>0</StartingIndex>
              <RequestedCount>100</RequestedCount>
              <SortCriteria></SortCriteria>
            </u:Browse>
          </s:Body>
        </s:Envelope>`;
      
      const response = await fetch(`${device.baseUrl}/MediaServer/ContentDirectory/Control`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"'
        },
        body: soapBody
      });
      
      const responseText = await response.text();
      const responseData = this.xmlParser.parse(responseText);
      
      // Check for SOAP fault
      const fault = responseData['s:Envelope']?.['s:Body']?.['s:Fault'];
      if (fault) {
        const errorCode = fault.detail?.UPnPError?.errorCode;
        logger.error(`Error browsing Pandora root: ${errorCode} - ${fault.faultstring}`);
        return [];
      }
      
      const result = responseData['s:Envelope']?.['s:Body']?.['u:BrowseResponse']?.Result;
      if (!result) {
        return [];
      }
      
      // Parse DIDL-Lite to find containers
      const didlData = this.xmlParser.parse(result);
      const containers = didlData['DIDL-Lite']?.container || [];
      const containerArray = Array.isArray(containers) ? containers : [containers];
      
      return containerArray.map(c => ({
        id: c['@_id'] || '',
        title: c['dc:title'] || ''
      }));
    } catch (error) {
      logger.error('Error browsing Pandora root:', error);
      return [];
    }
  }
  
  /**
   * Search for a station by name
   */
  static async findStation(device: SonosDevice, searchName: string): Promise<PandoraStation | null> {
    const stations = await this.getStations(device);
    const searchLower = searchName.toLowerCase();
    
    // Try exact match first
    let match = stations.find(s => s.title.toLowerCase() === searchLower);
    if (match) return match;
    
    // Try contains match
    match = stations.find(s => s.title.toLowerCase().includes(searchLower));
    if (match) return match;
    
    // Try fuzzy match
    if (searchLower.split(' ').length > 0) {
      match = stations.find(s => 
        searchLower.includes(s.title.toLowerCase()) || 
        s.title.toLowerCase().includes(searchLower.split(' ')[0] || '')
      );
    }
    
    return match || null;
  }
}