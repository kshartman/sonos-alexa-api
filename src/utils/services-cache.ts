import logger from './logger.js';
import { XMLParser } from 'fast-xml-parser';
import type { SonosDiscovery } from '../discovery.js';

interface ServiceInfo {
  id: number;
  name: string;
  internalName: string;
  uri: string;
  secureUri: string;
  containerType: string;
  capabilities: string;
  version: string;
  auth: string;
  pollInterval: string | number;
  manifest: string;
  type: string;
  isTuneIn: boolean;
  isPersonalized: boolean;
}

export class ServicesCache {
  private cache: Record<string, ServiceInfo> | null = null;
  private lastRefresh: Date | null = null;
  private refreshInterval: number = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  private discovery: SonosDiscovery;
  private refreshTimer?: NodeJS.Timeout;

  constructor(discovery: SonosDiscovery) {
    this.discovery = discovery;
  }

  async initialize(): Promise<void> {
    logger.info('Initializing services cache...');
    await this.refresh();
    
    // Set up automatic refresh timer
    this.scheduleNextRefresh();
  }

  private scheduleNextRefresh(): void {
    // Clear any existing timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    // Schedule next refresh
    this.refreshTimer = setTimeout(() => {
      logger.info('Performing scheduled services cache refresh');
      this.refresh().then(() => {
        this.scheduleNextRefresh();
      }).catch(error => {
        logger.error('Failed to refresh services cache:', error);
        // Retry in 1 hour if refresh fails
        this.refreshTimer = setTimeout(() => this.scheduleNextRefresh(), 60 * 60 * 1000);
      });
    }, this.refreshInterval);
  }

  async getServices(): Promise<Record<string, ServiceInfo>> {
    // Check if we need to refresh based on age
    if (!this.cache || !this.lastRefresh || this.isStale()) {
      await this.refresh();
    }
    
    return this.cache || {};
  }

  private isStale(): boolean {
    if (!this.lastRefresh) return true;
    const age = Date.now() - this.lastRefresh.getTime();
    return age > this.refreshInterval;
  }

  async refresh(): Promise<void> {
    logger.info('Refreshing services cache...');
    
    try {
      const services = await this.fetchServicesFromDevices();
      this.cache = services;
      this.lastRefresh = new Date();
      
      const serviceCount = Object.keys(services).length;
      logger.info(`Services cache refreshed successfully with ${serviceCount} services`);
      
      // Log some interesting services for debugging
      const tuneInServices = Object.values(services).filter(s => s.isTuneIn);
      const personalizedServices = Object.values(services).filter(s => s.isPersonalized);
      logger.debug(`Found ${tuneInServices.length} TuneIn services, ${personalizedServices.length} personalized services`);
    } catch (error) {
      logger.error('Failed to refresh services cache:', error);
      throw error;
    }
  }

  private async fetchServicesFromDevices(): Promise<Record<string, ServiceInfo>> {
    const devices = this.discovery.getAllDevices();
    if (devices.length === 0) {
      throw new Error('No Sonos devices found');
    }

    // Get zone information to identify coordinators
    const zones = this.discovery.getZones();
    const coordinatorIds = new Set(zones.map(zone => 
      zone.members.find(m => m.isCoordinator)?.id
    ).filter(Boolean));

    // Sort devices: coordinators first, then by model (non-satellites)
    const sortedDevices = [...devices].sort((a, b) => {
      const aIsCoordinator = coordinatorIds.has(a.id);
      const bIsCoordinator = coordinatorIds.has(b.id);
      
      if (aIsCoordinator && !bIsCoordinator) return -1;
      if (!aIsCoordinator && bIsCoordinator) return 1;
      
      // Deprioritize satellite/portable devices
      const aIsSatellite = a.modelName.includes('Roam') || a.modelName.includes('Move');
      const bIsSatellite = b.modelName.includes('Roam') || b.modelName.includes('Move');
      
      if (!aIsSatellite && bIsSatellite) return -1;
      if (aIsSatellite && !bIsSatellite) return 1;
      
      return 0;
    });

    // Try each device until we get a successful response
    for (const device of sortedDevices) {
      try {
        const isCoordinator = coordinatorIds.has(device.id);
        logger.debug(`Trying to get services from ${device.roomName} (${device.ip}) - Model: ${device.modelName}, Coordinator: ${isCoordinator}`);
        
        const services = await this.fetchServicesFromDevice(device.ip);
        const serviceCount = Object.keys(services).length;
        
        if (serviceCount > 0) {
          logger.info(`Found ${serviceCount} services from ${device.roomName} (${device.modelName})`);
          return services;
        }
      } catch (error) {
        logger.debug(`Error getting services from ${device.roomName}:`, error);
      }
    }

    logger.warn('No services found from any device');
    return {};
  }

  private async fetchServicesFromDevice(deviceIp: string): Promise<Record<string, ServiceInfo>> {
    // Use SOAP to call ListAvailableServices
    const soapBody = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:ListAvailableServices xmlns:u="urn:schemas-upnp-org:service:MusicServices:1"/>
  </s:Body>
</s:Envelope>`;

    const response = await fetch(`http://${deviceIp}:1400/MusicServices/Control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '"urn:schemas-upnp-org:service:MusicServices:1#ListAvailableServices"'
      },
      body: soapBody
    });
    
    if (!response.ok) {
      throw new Error(`SOAP request failed: ${response.status} ${response.statusText}`);
    }
    
    const soapResponse = await response.text();
    return this.parseSoapServicesResponse(soapResponse);
  }

  private async parseSoapServicesResponse(soapXml: string): Promise<Record<string, ServiceInfo>> {
    const xmlParser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: false,
      trimValues: true,
      textNodeName: '#text'
    });
    
    const parsed = xmlParser.parse(soapXml);
    
    // Navigate SOAP response structure
    const envelope = parsed['s:Envelope'] || parsed['SOAP-ENV:Envelope'];
    const body = envelope?.['s:Body'] || envelope?.['SOAP-ENV:Body'];
    const response = body?.['u:ListAvailableServicesResponse'];
    const serviceListXml = response?.AvailableServiceDescriptorList;
    
    if (!serviceListXml) {
      logger.debug('No AvailableServiceDescriptorList found in SOAP response');
      return {};
    }
    
    // The service list is HTML-encoded XML, so decode it
    const decodedXml = serviceListXml
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    
    // Parse the decoded service list XML
    const servicesParsed = xmlParser.parse(decodedXml);
    const servicesRoot = servicesParsed.Services;
    
    if (!servicesRoot?.Service) {
      logger.debug('No services found in descriptor list');
      return {};
    }
    
    const services: Record<string, ServiceInfo> = {};
    const serviceList = Array.isArray(servicesRoot.Service) 
      ? servicesRoot.Service 
      : [servicesRoot.Service];
      
    for (const service of serviceList) {
      const id = service['@_Id'];
      const name = service['@_Name'] || 'Unknown';
      const uri = service['@_Uri'] || service['@_URI'] || '';
      
      if (id) {
        // Check if this is a personalized TuneIn service
        const isTuneIn = name.toLowerCase().includes('tunein') || 
                        (uri.includes('x-sonosapi-stream') && parseInt(id) >= 80000 && parseInt(id) <= 99999);
        
        // Get user-facing name from presentation strings if available
        let displayName = name;
        const strings = service.Presentation?.Strings?.String;
        if (strings) {
          const stringArray = Array.isArray(strings) ? strings : [strings];
          const nameString = stringArray.find((s: { '@_Id'?: string; '#text'?: string; [key: string]: unknown }) => s['@_Id'] === 'NAME');
          if (nameString) {
            // Handle both text node formats
            displayName = nameString['#text'] || nameString;
          }
        }
        
        services[id] = {
          id: parseInt(id, 10),
          name: displayName,
          internalName: name,
          uri,
          secureUri: service['@_SecureUri'] || '',
          containerType: service['@_ContainerType'] || '',
          capabilities: service['@_Capabilities'] || '',
          version: service['@_Version'] || '',
          auth: service.Policy?.['@_Auth'] || 'Anonymous',
          pollInterval: service.Policy?.['@_PollInterval'] || 0,
          manifest: service.Manifest?.['@_Uri'] || '',
          // Enhanced type determination
          type: isTuneIn ? 'tunein' : this.determineServiceType(uri, name),
          isTuneIn,
          isPersonalized: parseInt(id) >= 80000 && parseInt(id) <= 99999
        };
      }
    }
    
    return services;
  }

  private determineServiceType(uri: string, _name: string): string {
    // Determine service type based on URI patterns
    if (uri.includes('x-sonosapi-stream')) return 'stream';
    if (uri.includes('x-sonosapi-radio')) return 'radio';
    if (uri.includes('x-sonosapi-hls')) return 'hls';
    if (uri.includes('x-sonos-spotify')) return 'spotify';
    if (uri.includes('x-rincon-playlist')) return 'playlist';
    if (uri.includes('x-file-cifs')) return 'library';
    if (uri.includes('x-rincon-mp3radio')) return 'mp3radio';
    return 'unknown';
  }

  getStatus(): { lastRefresh: Date | null; serviceCount: number; isStale: boolean } {
    return {
      lastRefresh: this.lastRefresh,
      serviceCount: this.cache ? Object.keys(this.cache).length : 0,
      isStale: this.isStale()
    };
  }

  destroy(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
  }
}