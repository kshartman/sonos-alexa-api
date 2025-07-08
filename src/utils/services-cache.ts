import logger from './logger.js';
import { scheduler } from './scheduler.js';
import { XMLParser } from 'fast-xml-parser';
import type { SonosDiscovery } from '../discovery.js';
import { promises as fs } from 'fs';
import path from 'path';

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
  isDiscovered?: boolean; // Flag for services discovered via alternate methods
}

export class ServicesCache {
  private cache: Record<string, ServiceInfo> | null = null;
  private lastRefresh: Date | null = null;
  private refreshInterval: number = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  private discovery: SonosDiscovery;
  private readonly REFRESH_TASK_ID = 'services-cache-refresh';

  constructor(discovery: SonosDiscovery) {
    this.discovery = discovery;
  }

  async initialize(): Promise<void> {
    logger.info('Initializing services cache...');
    await this.refresh();
    
    // Write cache to file for debugging
    await this.writeCacheToFile();
    
    // Set up automatic refresh timer
    this.scheduleNextRefresh();
  }

  private scheduleNextRefresh(): void {
    // Clear any existing timer
    scheduler.clearTask(this.REFRESH_TASK_ID);

    // Schedule next refresh
    scheduler.scheduleTimeout(
      this.REFRESH_TASK_ID,
      async () => {
        logger.info('Performing scheduled services cache refresh');
        try {
          await this.refresh();
          await this.writeCacheToFile();
          this.scheduleNextRefresh();
        } catch (error) {
          logger.error('Failed to refresh services cache:', error);
          // Retry in 1 hour if refresh fails
          scheduler.scheduleTimeout(`${this.REFRESH_TASK_ID}-retry`, () => this.scheduleNextRefresh(), 60 * 60 * 1000, { unref: true });
        }
      },
      this.refreshInterval,
      { unref: true }
    );
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
      // Preserve any discovered services before refresh
      const discoveredServices: Record<string, ServiceInfo> = {};
      if (this.cache) {
        Object.entries(this.cache).forEach(([id, service]) => {
          if (service.isDiscovered) {
            discoveredServices[id] = service;
          }
        });
      }
      
      const services = await this.fetchServicesFromDevices();
      
      // Merge discovered services back in
      this.cache = { ...services, ...discoveredServices };
      this.lastRefresh = new Date();
      
      const serviceCount = Object.keys(this.cache).length;
      logger.info(`Services cache refreshed successfully with ${serviceCount} services (including ${Object.keys(discoveredServices).length} discovered)`);
      
      // Log some interesting services for debugging
      const tuneInServices = Object.values(this.cache).filter(s => s.isTuneIn);
      const personalizedServices = Object.values(this.cache).filter(s => s.isPersonalized);
      logger.debug(`Found ${tuneInServices.length} TuneIn services, ${personalizedServices.length} personalized services`);
    } catch (error) {
      logger.error('Failed to refresh services cache:', error);
      throw error;
    }
  }

  private async writeCacheToFile(): Promise<void> {
    if (!this.cache) {
      logger.warn('Cannot write cache to file: cache is null');
      return;
    }
    
    try {
      const dataDir = path.resolve(process.cwd(), 'data');
      await fs.mkdir(dataDir, { recursive: true });
      
      const filePath = path.join(dataDir, 'services-cache.json');
      const cacheData = {
        lastRefresh: this.lastRefresh,
        serviceCount: Object.keys(this.cache).length,
        services: this.cache
      };
      
      // Write to a temp file first then rename for atomicity
      const tempPath = `${filePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(cacheData, null, 2));
      await fs.rename(tempPath, filePath);
      
      logger.info(`Services cache written to ${filePath} (${Object.keys(this.cache).length} services)`);
    } catch (error) {
      logger.error('Failed to write services cache to file:', error);
      throw error; // Re-throw to ensure caller knows it failed
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
    const sessionIdList = response?.AvailableServiceTypeList;
    
    if (!serviceListXml) {
      logger.debug('No AvailableServiceDescriptorList found in SOAP response');
      return {};
    }
    
    // Log session ID list if available (for debugging)
    if (sessionIdList) {
      logger.debug('AvailableServiceTypeList:', sessionIdList);
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

  /**
   * Add a discovered service ID mapping for an existing service.
   * This is used when we find favorites with different service IDs than what's in the device list.
   * For example, Spotify might be ID 12 in the device list but ID 3079 in an old favorite.
   * 
   * @param discoveredId - The service ID found in a favorite
   * @param canonicalServiceName - The service name to map to (e.g., "Spotify")
   */
  async addDiscoveredServiceId(discoveredId: string, canonicalServiceName: string): Promise<void> {
    if (!this.cache) {
      await this.refresh();
    }

    // Find the canonical service entry
    const canonicalEntry = Object.values(this.cache!).find(
      service => service.name.toLowerCase() === canonicalServiceName.toLowerCase()
    );

    if (!canonicalEntry) {
      logger.warn(`Cannot add discovered service ID ${discoveredId}: service ${canonicalServiceName} not found`);
      return;
    }

    // Check if this ID already exists
    if (this.cache![discoveredId]) {
      // If it already points to the same service, we're good
      if (this.cache![discoveredId].name === canonicalEntry.name) {
        return;
      }
      logger.warn(`Service ID ${discoveredId} already exists for ${this.cache![discoveredId].name}, not overwriting with ${canonicalServiceName}`);
      return;
    }

    // Clone the canonical entry with the discovered ID
    this.cache![discoveredId] = {
      ...canonicalEntry,
      id: parseInt(discoveredId, 10),
      internalName: `${canonicalEntry.internalName} (App)`,
      // Mark as a discovered mapping
      isDiscovered: true
    };

    logger.info(`Added discovered service mapping: ${discoveredId} -> ${canonicalServiceName}`);
    
    // Update the cache file
    await this.writeCacheToFile();
  }

  destroy(): void {
    scheduler.clearTask(this.REFRESH_TASK_ID);
    scheduler.clearTask(`${this.REFRESH_TASK_ID}-retry`);
  }
}