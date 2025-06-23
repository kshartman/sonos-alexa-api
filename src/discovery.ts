import dgram from 'dgram';
import { EventEmitter } from 'events';
import http from 'http';
import { XMLParser } from 'fast-xml-parser';
import logger from './utils/logger.js';
import { debugManager } from './utils/debug-manager.js';
import { SonosDevice } from './sonos-device.js';
import { UPnPSubscriber } from './upnp/subscriber.js';
import { TopologyManager } from './topology-manager.js';
import type { DeviceInfo, Zone, SonosState } from './types/sonos.js';
import type { ZoneGroup } from './topology-manager.js';

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const SONOS_URN = 'urn:schemas-upnp-org:device:ZonePlayer:1';

export declare interface SonosDiscovery {
  on(event: 'device-found', listener: (device: SonosDevice) => void): this;
  on(event: 'device-state-change', listener: (device: SonosDevice, state: SonosState) => void): this;
  on(event: 'topology-change', listener: (zones: ZoneGroup[]) => void): this;
}

export class SonosDiscovery extends EventEmitter {
  public readonly devices = new Map<string, SonosDevice>();
  private socket?: dgram.Socket;
  private xmlParser: XMLParser;
  private searchInterval?: NodeJS.Timeout;
  private subscriber?: UPnPSubscriber;
  private topologyManager: TopologyManager;

  constructor() {
    super();
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: false,
      trimValues: true
    });
    
    this.topologyManager = new TopologyManager();
    this.subscriber = new UPnPSubscriber(this.handleUPnPEvent.bind(this));
    
    // Forward topology events
    this.topologyManager.on('topology-change', (event) => {
      this.emit('topology-change', event.zones);
    });
  }

  async start(): Promise<void> {
    // Start UPnP subscriber first
    await this.subscriber!.start();
    
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    
    this.socket.on('message', (msg) => this.handleMessage(msg));
    this.socket.on('error', (err) => logger.error('Discovery socket error:', err));
    
    await new Promise<void>((resolve) => {
      this.socket!.bind(() => {
        this.socket!.addMembership(SSDP_ADDRESS);
        debugManager.info('discovery', 'SSDP discovery started');
        resolve();
      });
    });

    // Send initial search
    this.search();
    
    // Periodic search every 30 seconds
    this.searchInterval = setInterval(() => this.search(), 30000);
  }

  stop(): void {
    if (this.searchInterval) {
      clearInterval(this.searchInterval);
      this.searchInterval = undefined;
    }
    
    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
    }
    
    // Stop UPnP subscriber
    this.subscriber?.stop();
    
    // Unsubscribe from all devices
    for (const device of this.devices.values()) {
      device.unsubscribe();
    }
    
    this.devices.clear();
    debugManager.info('discovery', 'Discovery stopped');
  }

  private search(): void {
    if (!this.socket) return;

    const searchMessage = [
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      'MX: 3',
      `ST: ${SONOS_URN}`,
      '',
      ''
    ].join('\r\n');

    this.socket.send(searchMessage, SSDP_PORT, SSDP_ADDRESS, (err) => {
      if (err) {
        logger.error('Error sending SSDP search:', err);
      } else {
        debugManager.debug('discovery', 'SSDP search sent');
      }
    });
  }

  private async handleMessage(msg: Buffer): Promise<void> {
    const message = msg.toString();
    
    if (!message.includes('200 OK') || !message.includes(SONOS_URN)) {
      return;
    }

    const location = this.extractLocation(message);
    if (!location) {
      return;
    }

    try {
      const deviceInfo = await this.fetchDeviceInfo(location);
      const deviceId = deviceInfo.device.UDN;
      
      if (!this.devices.has(deviceId)) {
        const device = new SonosDevice(deviceInfo, location);
        this.devices.set(deviceId, device);
        
        debugManager.info('discovery', `Discovered Sonos device: ${device.roomName} (${device.modelName})`);
        
        // Subscribe to topology events for this device
        await this.subscribeToTopology(device);
        
        // Update topology manager with current device map
        this.topologyManager.setDeviceMap(this.devices);
        
        // Request initial topology state from this device
        await this.requestTopologyState(device);
        
        this.emit('device-found', device);
        
        // Start monitoring device
        device.on('state-change', (state: SonosState) => {
          this.emit('device-state-change', device, state);
        });
        
        await device.subscribe();
      }
    } catch (error) {
      debugManager.error('discovery', 'Error processing device:', error);
    }
  }

  private extractLocation(message: string): string | null {
    const match = message.match(/LOCATION: (.+)/i);
    return match ? match[1]!.trim() : null;
  }

  private async fetchDeviceInfo(location: string): Promise<DeviceInfo> {
    const url = new URL(location);
    
    return new Promise((resolve, reject) => {
      http.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const parsed = this.xmlParser.parse(data);
            resolve(parsed.root as DeviceInfo);
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', reject);
    });
  }

  getDevice(roomName: string): SonosDevice | null {
    for (const device of this.devices.values()) {
      if (device.roomName.toLowerCase() === roomName.toLowerCase()) {
        return device;
      }
    }
    return null;
  }

  getZones(): Zone[] {
    const topologyZones = this.topologyManager.getZones();
    
    return topologyZones.map(zone => ({
      id: zone.id,
      coordinator: zone.coordinator.roomName,
      members: zone.members.map(member => ({
        id: member.id,
        roomName: member.roomName,
        isCoordinator: member.id === zone.coordinator.id
      }))
    }));
  }

  getAllDevices(): SonosDevice[] {
    return Array.from(this.devices.values());
  }

  // Topology-related methods
  isCoordinator(deviceId: string): boolean {
    return this.topologyManager.isCoordinator(deviceId);
  }

  getCoordinator(deviceId: string): SonosDevice | undefined {
    return this.topologyManager.getCoordinator(deviceId);
  }

  getGroupMembers(deviceId: string): SonosDevice[] {
    return this.topologyManager.getGroupMembers(deviceId);
  }

  private async subscribeToTopology(device: SonosDevice): Promise<void> {
    try {
      const url = new URL(device.location);
      const baseUrl = `http://${url.hostname}:${url.port}`;
      
      await this.subscriber!.subscribe(baseUrl, 'ZoneGroupTopology', device.id);
      logger.debug(`Subscribed to topology events for ${device.roomName} (${device.id})`);
    } catch (error) {
      logger.error(`Failed to subscribe to topology for ${device.roomName}:`, error);
    }
  }

  private async requestTopologyState(device: SonosDevice): Promise<void> {
    try {
      logger.debug(`Requesting initial topology state from ${device.roomName}`);
      
      // Get current zone group state via SOAP
      const result = await device.soap('ZoneGroupTopology', 'GetZoneGroupState');
      
      if (result && result.ZoneGroupState) {
        logger.info(`Received initial topology from ${device.roomName}, processing...`);
        
        // Directly call the topology manager with the parsed data
        // Create a fake UPnP event structure
        const fakeEventBody = `<?xml version="1.0"?>
<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0">
  <e:property>
    <ZoneGroupState>dummy</ZoneGroupState>
  </e:property>
</e:propertyset>`;
        
        // First parse the fake event structure
        const parsed = this.topologyManager.xmlParser.parse(fakeEventBody);
        // Then replace the dummy with real data
        parsed['e:propertyset']['e:property'].ZoneGroupState = result.ZoneGroupState;
        
        // Now call handleTopologyEvent with the combined structure
        this.topologyManager.handleTopologyEvent(device.id, 'ZoneGroupTopology', JSON.stringify(parsed));
      }
    } catch (error) {
      logger.error(`Failed to request topology from ${device.roomName}:`, error);
    }
  }

  private handleUPnPEvent(deviceId: string, service: string, body: string): void {
    const device = this.devices.get(deviceId);
    const deviceName = device ? device.roomName : 'unknown';
    logger.info(`UPnP event from ${deviceName} (${deviceId})/${service}, body length: ${body.length}`);
    this.topologyManager.handleTopologyEvent(deviceId, service, body);
  }
}