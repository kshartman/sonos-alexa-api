import dgram from 'dgram';
import { EventEmitter } from 'events';
import http from 'http';
import os from 'os';
import { XMLParser } from 'fast-xml-parser';
import logger from './utils/logger.js';
import { debugManager } from './utils/debug-manager.js';
import { scheduler } from './utils/scheduler.js';
import { SonosDevice } from './sonos-device.js';
import { UPnPSubscriber } from './upnp/subscriber.js';
import { TopologyManager } from './topology-manager.js';
import { EventManager } from './utils/event-manager.js';
import type { DeviceInfo, Zone, SonosState } from './types/sonos.js';
import type { ZoneGroup } from './topology-manager.js';

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const SONOS_URN = 'urn:schemas-upnp-org:device:ZonePlayer:1';

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export declare interface SonosDiscovery {
  on(event: 'device-found', listener: (device: SonosDevice) => void): this;
  on(event: 'topology-change', listener: (zones: ZoneGroup[]) => void): this;
  on(event: 'content-update', listener: (deviceId: string, containerUpdateIDs: string) => void): this;
}

/**
 * Service that discovers Sonos devices on the network using SSDP.
 * Manages device lifecycle, tracks topology changes, and handles UPnP subscriptions.
 * Emits events for device discovery, state changes, and topology updates.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, no-redeclare
export class SonosDiscovery extends EventEmitter {
  public readonly devices = new Map<string, SonosDevice>();
  private socket?: dgram.Socket | undefined;
  private xmlParser: XMLParser;
  private readonly SEARCH_TASK_ID = 'discovery-search';
  private subscriber?: UPnPSubscriber;
  public topologyManager: TopologyManager;
  private topologyDevices = new Set<string>();  // Track which devices we've subscribed to for topology

  constructor() {
    super();
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: false,
      trimValues: true
    });
    
    this.topologyManager = new TopologyManager();
    this.subscriber = new UPnPSubscriber((deviceId, service, body) => {
      this.handleUPnPEvent(deviceId, service, body).catch(err => 
        logger.error('Error handling UPnP event:', err)
      );
    });
    
    // Forward topology events
    this.topologyManager.on('topology-change', (event) => {
      this.emit('topology-change', event.zones);
      // Update EventManager's group cache when topology changes
      const eventManager = EventManager.getInstance();
      eventManager.updateGroupMembersCache();
    });
    
    // Listen for devices that need resubscription
    const eventManager = EventManager.getInstance();
    eventManager.setDiscovery(this);
    eventManager.on('devices-need-resubscribe', (deviceIds: string[]) => {
      logger.debug(`Discovery: ${deviceIds.length} devices need resubscription`);
      this.handleStaleDevices(deviceIds);
    });
  }

  /**
   * Starts the discovery service.
   * Begins listening for SSDP announcements and sends periodic search requests.
   */
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
    scheduler.scheduleInterval(this.SEARCH_TASK_ID, () => this.search(), 30000, { unref: true });
    
    // No longer needed - we subscribe to topology on every device
  }

  /**
   * Stops the discovery service and cleans up resources.
   * Unsubscribes from all devices and closes the UDP socket.
   */
  stop(): void {
    scheduler.clearTask(this.SEARCH_TASK_ID);
    
    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
    }
    
    // Stop UPnP subscriber
    this.subscriber?.stop();
    
    // Unregister all devices from EventManager
    const eventManager = EventManager.getInstance();
    for (const device of this.devices.values()) {
      eventManager.unregisterDevice(device.id);
      device.unsubscribe();
    }
    
    this.devices.clear();
    debugManager.info('discovery', 'Discovery stopped');
  }

  /**
   * Sends an SSDP M-SEARCH request to discover Sonos devices.
   * Devices respond with their location URLs.
   */
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
      
      let device: SonosDevice;
      
      if (!this.devices.has(deviceId)) {
        device = new SonosDevice(deviceInfo, location);
        this.devices.set(deviceId, device);
        
        // Extract IP from location URL
        const locationUrl = new URL(location);
        logger.debug(`Created device ${device.roomName} from SSDP discovery - IP: ${locationUrl.hostname}, UUID: ${device.id}`);
        debugManager.info('discovery', `Discovered Sonos device: ${device.roomName} (${device.modelName})`);
      } else {
        // Device already exists (probably from topology), update its model info
        device = this.devices.get(deviceId)!;
        if (device.modelName === 'Unknown') {
          // Create a new device with updated model information
          const updatedDevice = new SonosDevice(deviceInfo, location);
          // Copy over the existing state
          updatedDevice.state = device.state;
          
          // CRITICAL: Copy all event listeners from the old device to the new one
          const eventNames = device.eventNames();
          for (const eventName of eventNames) {
            const listeners = device.listeners(eventName);
            for (const listener of listeners) {
              updatedDevice.on(eventName as string, listener as (...args: unknown[]) => void);
            }
          }
          
          // Replace the device in our map
          this.devices.set(deviceId, updatedDevice);
          device = updatedDevice;
          debugManager.debug('discovery', `Updated device info for ${device.roomName}: model=${deviceInfo.device.modelName}, preserved ${eventNames.length} event types`);
        }
      }
      
      // Update topology manager with current device map
      this.topologyManager.setDeviceMap(this.devices);
      
      // Subscribe to topology events on every device (except portable devices)
      if (!this.topologyDevices.has(device.id)) {
        const modelLower = device.modelName.toLowerCase();
        if (modelLower.includes('roam') || modelLower.includes('move')) {
          logger.debug(`${device.roomName} (${device.modelName}) cannot be used for topology - portable devices lack required services`);
        } else {
          // Get initial topology state from the first device
          if (this.topologyDevices.size === 0) {
            await this.requestTopologyState(device);
          }
          
          // Subscribe to topology changes on this device
          await this.subscribeToTopology(device);
          this.topologyDevices.add(device.id);
        }
      }
      
      this.emit('device-found', device);
      
      // Register device with EventManager for state tracking
      const eventManager = EventManager.getInstance();
      eventManager.registerDevice(device);
      
      // Subscribe to all UPnP services for this device
      try {
        await device.subscribe();
        debugManager.info('discovery', `${device.roomName}: Subscribed to UPnP events`);
      } catch (error) {
        logger.error(`${device.roomName}: Failed to subscribe to UPnP events:`, error);
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

  /**
   * Gets a device by room name (case-insensitive).
   * @param roomName - The room name to search for
   * @returns The device or null if not found
   */
  getDevice(roomName: string): SonosDevice | null {
    // Simple approach: just return the first device with this room name
    // The API endpoints will handle stereo pair complexity if needed
    for (const device of this.devices.values()) {
      if (device.roomName.toLowerCase() === roomName.toLowerCase()) {
        return device;
      }
    }
    return null;
  }

  getDeviceById(deviceId: string): SonosDevice | null {
    // Remove uuid: prefix if present
    const cleanId = deviceId.replace('uuid:', '');
    return this.devices.get(cleanId) || null;
  }

  /**
   * Gets the current zone topology.
   * Groups devices by their zone coordinator.
   * @returns Array of zones with coordinator and members
   */
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

  /**
   * Gets all discovered devices.
   * @returns Array of all devices
   */
  getAllDevices(): SonosDevice[] {
    return Array.from(this.devices.values());
  }

  /**
   * Gets the local IP address that can reach Sonos devices.
   * Prefers IPs on the same subnet as discovered devices.
   * @returns Local IP address or undefined if none found
   */
  getLocalIP(): string | undefined {
    // Get the first non-localhost IP address from any discovered device's perspective
    // This ensures we get an IP that's reachable from the Sonos network
    const firstDevice = this.getAllDevices()[0];
    if (!firstDevice) {
      return undefined;
    }
    
    try {
      // Try to determine our IP by seeing which interface can reach the Sonos device
      const interfaces = os.networkInterfaces();
      const deviceIP = firstDevice.ip;
      const deviceSubnet = deviceIP.substring(0, deviceIP.lastIndexOf('.'));
      
      for (const name of Object.keys(interfaces)) {
        const addrs = interfaces[name];
        if (!addrs) continue;
        
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && !addr.internal) {
            // Check if this IP is on the same subnet as the Sonos device
            const addrSubnet = addr.address.substring(0, addr.address.lastIndexOf('.'));
            if (addrSubnet === deviceSubnet) {
              debugManager.debug('discovery', `Found local IP ${addr.address} on same subnet as Sonos devices`);
              return addr.address;
            }
          }
        }
      }
      
      // Fallback: return any non-localhost IPv4 address
      for (const name of Object.keys(interfaces)) {
        const addrs = interfaces[name];
        if (!addrs) continue;
        
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && !addr.internal) {
            debugManager.debug('discovery', `Using fallback local IP ${addr.address}`);
            return addr.address;
          }
        }
      }
    } catch (error) {
      logger.error('Error getting local IP:', error);
    }
    
    return undefined;
  }

  // Handle devices with stale NOTIFY subscriptions
  private async handleStaleDevices(deviceIds: string[]): Promise<void> {
    for (const deviceId of deviceIds) {
      const device = this.getDeviceById(deviceId);
      if (!device) {
        logger.debug(`Discovery: Device ${deviceId} not found for resubscription`);
        continue;
      }
      
      try {
        logger.debug(`Discovery: Attempting to resubscribe ${device.roomName} (${deviceId})`);
        // Unsubscribe and resubscribe to refresh subscriptions
        await device.unsubscribe();
        await device.subscribe();
        
        // Notify EventManager that subscription was refreshed
        const eventManager = EventManager.getInstance();
        eventManager.handleSubscriptionRenewal(deviceId);
        
        logger.debug(`Discovery: Successfully resubscribed ${device.roomName}`);
      } catch (error) {
        logger.error(`Discovery: Failed to resubscribe ${device.roomName}:`, error);
        // Device might be offline
        const eventManager = EventManager.getInstance();
        eventManager.handleDeviceOffline(deviceId);
      }
    }
  }

  // Topology-related methods
  /**
   * Checks if a device is a zone coordinator.
   * @param deviceId - The device ID to check
   * @returns True if the device is a coordinator
   */
  isCoordinator(deviceId: string): boolean {
    return this.topologyManager.isCoordinator(deviceId);
  }

  /**
   * Gets the coordinator device for a given device.
   * Returns the device itself if it's already a coordinator.
   * @param deviceId - The device ID to find the coordinator for
   * @returns The coordinator device or undefined
   */
  getCoordinator(deviceId: string): SonosDevice | undefined {
    return this.topologyManager.getCoordinator(deviceId);
  }

  /**
   * Checks if a device is capable of browsing favorites (has ContentDirectory service).
   * Portable devices (Roam, Move) and subwoofers typically don't support this.
   */
  isCapableDevice(device: SonosDevice): boolean {
    // Coordinators are always capable
    if (this.isCoordinator(device.id)) {
      return true;
    }
    
    // Known capable model numbers (non-portable speakers)
    const capableModels = ['S1', 'S3', 'S5', 'S9', 'S14', 'S15', 'S22', 'S23', 'S24', 'S27', 'S33', 'S35', 'S36', 'S38'];
    return capableModels.includes(device.modelNumber);
  }

  /**
   * Waits for discovery to have devices suitable for favorite resolution.
   * Resolves when:
   * - At least one capable device is found, OR
   * - 3+ non-capable devices are found (and no capable ones), OR  
   * - 3 minutes timeout
   * 
   * @returns Promise with info about what devices are available
   */
  async waitForFavoriteCapableDevice(): Promise<{ hasCapableDevice: boolean; deviceCount: number }> {
    const timeout = 3 * 60 * 1000; // 3 minutes
    
    // Check current state
    const checkCurrent = () => {
      const allDevices = Array.from(this.devices.values());
      const capableDevice = allDevices.find(d => this.isCapableDevice(d));
      const nonCapableCount = allDevices.filter(d => !this.isCapableDevice(d)).length;
      
      return {
        hasCapableDevice: !!capableDevice,
        deviceCount: allDevices.length,
        nonCapableCount
      };
    };

    // If we already meet criteria, return immediately
    const current = checkCurrent();
    if (current.hasCapableDevice || current.nonCapableCount >= 3) {
      logger.info(`Discovery ready: ${current.hasCapableDevice ? 'capable device found' : `${current.nonCapableCount} non-capable devices only`}`);
      return { hasCapableDevice: current.hasCapableDevice, deviceCount: current.deviceCount };
    }

    return new Promise((resolve) => {
      let resolved = false;
      
      const checkAndResolve = () => {
        if (resolved) return;
        
        const state = checkCurrent();
        
        // Exit conditions
        if (state.hasCapableDevice) {
          resolved = true;
          logger.info('Discovery: Found capable device for favorite resolution');
          cleanup();
          resolve({ hasCapableDevice: true, deviceCount: state.deviceCount });
        } else if (state.nonCapableCount >= 3) {
          resolved = true;
          logger.warn(`Discovery: Found ${state.nonCapableCount} devices but none capable of favorite resolution`);
          cleanup();
          resolve({ hasCapableDevice: false, deviceCount: state.deviceCount });
        }
      };

      const cleanup = () => {
        this.off('device-found', deviceHandler);
        this.off('topology-change', topologyHandler);
        if (timeoutId) clearTimeout(timeoutId);
      };

      const deviceHandler = () => checkAndResolve();
      const topologyHandler = () => checkAndResolve();

      this.on('device-found', deviceHandler);
      this.on('topology-change', topologyHandler);

      // Timeout handler
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          const state = checkCurrent();
          logger.warn(`Discovery timeout after 3 minutes: ${state.deviceCount} devices found, ${state.hasCapableDevice ? 'has' : 'no'} capable device`);
          cleanup();
          resolve({ hasCapableDevice: state.hasCapableDevice, deviceCount: state.deviceCount });
        }
      }, timeout);
    });
  }

  /**
   * Gets all members of the group that the specified device belongs to.
   * @param deviceId - The device ID
   * @returns Array of devices in the same group
   */
  getGroupMembers(deviceId: string): SonosDevice[] {
    return this.topologyManager.getGroupMembers(deviceId);
  }


  private async subscribeToTopology(device: SonosDevice): Promise<void> {
    try {
      // First check if device has ZoneGroupTopology service
      const services = await device.discoverServices();
      const hasTopologyService = services.some(s => 
        s.serviceType.includes('ZoneGroupTopology') && s.eventSubURL
      );
      
      if (!hasTopologyService) {
        logger.debug(`${device.roomName}: No ZoneGroupTopology service found, skipping topology subscription`);
        return;
      }
      
      const url = new URL(device.location);
      const baseUrl = `http://${url.hostname}:${url.port}`;
      
      // Subscribe with the device's actual ID so we know which device sent the event
      await this.subscriber!.subscribe(baseUrl, '/ZoneGroupTopology/Event', device.id);
      logger.debug(`Subscribed to topology events via ${device.roomName} (${device.modelName})`);
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
        logger.debug(`Received initial topology from ${device.roomName}, processing...`);
        
        // Parse the topology to create devices for all members
        const topologyXml = this.xmlParser.parse(result.ZoneGroupState);
        const zoneGroups = topologyXml.ZoneGroupState?.ZoneGroups?.ZoneGroup;
        
        if (zoneGroups) {
          const groups = Array.isArray(zoneGroups) ? zoneGroups : [zoneGroups];
          
          // First pass: create stub devices for all members we haven't discovered yet
          for (const group of groups) {
            const members = Array.isArray(group.ZoneGroupMember) ? group.ZoneGroupMember : [group.ZoneGroupMember];
            
            for (const member of members) {
              const uuid = `uuid:${member['@_UUID']}`;
              const location = member['@_Location'];
              const zoneName = member['@_ZoneName'];
              
              // Check if we already have this device
              if (!this.devices.has(uuid) && location && zoneName) {
                // Extract IP from location URL
                const locationUrl = new URL(location);
                logger.debug(`Creating stub device for ${zoneName} from topology - IP: ${locationUrl.hostname}, UUID: ${uuid}`);
                
                // Create a minimal device info structure
                const deviceInfo: DeviceInfo = {
                  device: {
                    UDN: uuid,
                    modelName: 'Unknown',
                    modelNumber: 'Unknown',
                    roomName: zoneName
                  }
                };
                
                // Create the device
                const stubDevice = new SonosDevice(deviceInfo, location);
                this.devices.set(uuid, stubDevice);
                
                // Update topology manager with new device map
                this.topologyManager.setDeviceMap(this.devices);
                
                // Emit device-found event
                this.emit('device-found', stubDevice);
                
                // Initialize stub device with device description and subscribe to events
                this.initializeStubDevice(stubDevice).catch(error => {
                  logger.error(`Failed to initialize stub device ${zoneName}:`, error);
                });
              }
            }
          }
        }
        
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

  private async initializeStubDevice(device: SonosDevice): Promise<void> {
    try {
      logger.debug(`Initializing stub device ${device.roomName} with device description and event subscriptions`);
      
      // Register device with EventManager for state tracking
      const eventManager = EventManager.getInstance();
      eventManager.registerDevice(device);
      
      // Subscribe to all UPnP services for this device
      await device.subscribe();
      logger.debug(`${device.roomName}: Initialized stub device with UPnP event subscriptions`);
    } catch (error) {
      logger.error(`${device.roomName}: Failed to initialize stub device:`, error);
      // Don't throw - we want the device to exist even if events don't work
    }
  }

  private async handleUPnPEvent(deviceId: string, service: string, body: string): Promise<void> {
    const device = this.devices.get(deviceId);
    const deviceName = device ? device.roomName : 'unknown';
    
    // Always log UPnP events for debugging
    debugManager.info('upnp', `Received event from ${deviceName} (${deviceId})/${service}, body length: ${body.length}`);
    debugManager.debug('upnp', `UPnP event from ${deviceName} (${deviceId})/${service}, body length: ${body.length}`);
    
    // Parse the UPnP event notification
    try {
      const parsed = this.xmlParser.parse(body);
      const propertyset = parsed['e:propertyset'];
      if (!propertyset || !propertyset['e:property']) {
        debugManager.warn('upnp', `No propertyset in UPnP event from ${deviceName}/${service}`);
        return;
      }
      
      const property = propertyset['e:property'];
      
      // Debug log the properties we receive
      debugManager.debug('upnp', `${deviceName}/${service} properties:`, Object.keys(property));
      
      // Handle ZoneGroupTopology events
      if (service.includes('ZoneGroupTopology')) {
        // Property might be an array if there are multiple properties
        const properties = Array.isArray(property) ? property : [property];
        const zoneGroupStateProp = properties.find(p => p && p.ZoneGroupState);
        
        debugManager.debug('topology', `ZoneGroupTopology event properties: ${JSON.stringify(properties.map(p => Object.keys(p || {})))}`);
        
        if (zoneGroupStateProp && zoneGroupStateProp.ZoneGroupState) {
          debugManager.info('topology', `Processing ZoneGroupTopology event from ${deviceName}`);
          // Pass the actual device ID that sent the event
          this.topologyManager.handleTopologyEvent(deviceId, service, body);
          return;
        } else {
          debugManager.warn('topology', 'ZoneGroupTopology event missing ZoneGroupState property');
        }
      }
      
      // Handle LastChange events (AVTransport, RenderingControl, etc.)
      if (property.LastChange && device) {
        debugManager.info('upnp', `${deviceName}: Processing LastChange event for ${service}`);
        // Parse LastChange XML (it's embedded XML within the property)
        const lastChange = this.xmlParser.parse(property.LastChange);
        
        // AVTransport events
        if (service.includes('AVTransport') && lastChange.Event && lastChange.Event.InstanceID) {
          const instance = Array.isArray(lastChange.Event.InstanceID) 
            ? lastChange.Event.InstanceID[0] 
            : lastChange.Event.InstanceID;
          
          // Track what changed
          let stateChanged = false;
          const previousState: Partial<SonosState> = {};
          
          if (instance.TransportState) {
            const newState = instance.TransportState['@_val'] || instance.TransportState;
            previousState.playbackState = device.state.playbackState;
            if (newState !== device.state.playbackState) {
              device.state.playbackState = newState;
              stateChanged = true;
              debugManager.info('upnp', `${deviceName}: Transport state changed from ${previousState.playbackState} to ${newState}`);
            }
          }
          
          if (instance.CurrentTrackURI || instance.CurrentTrackMetaData) {
            // Track metadata changed
            // Update full state to get new track info
            await device.updateState();
            
            // Track change will be handled by EventManager via state-change event
            
            stateChanged = true;
          }
          
          if (stateChanged) {
            debugManager.info('upnp', `${deviceName}: AVTransport state changed`);
            logger.trace(`Discovery: Emitting state-change for ${deviceName} (${device.id})`);
            logger.trace(`Discovery: Device has ${device.listenerCount('state-change')} state-change listeners`);
            device.emit('state-change', device.state, previousState);
          }
        }
        
        // RenderingControl events
        if (service.includes('RenderingControl') && lastChange.Event && lastChange.Event.InstanceID) {
          const instance = Array.isArray(lastChange.Event.InstanceID)
            ? lastChange.Event.InstanceID[0]
            : lastChange.Event.InstanceID;
          
          let stateChanged = false;
          const previousState: Partial<SonosState> = {};
          
          // Look for volume changes
          if (instance.Volume) {
            const volumes = Array.isArray(instance.Volume) ? instance.Volume : [instance.Volume];
            const masterVolume = volumes.find((v: { '@_channel': string; '@_val': string }) => v['@_channel'] === 'Master');
            
            if (masterVolume) {
              const newVolume = parseInt(masterVolume['@_val'], 10);
              previousState.volume = device.state.volume;
              if (newVolume !== device.state.volume) {
                device.state.volume = newVolume;
                stateChanged = true;
                debugManager.info('upnp', `${deviceName}: Volume changed from ${previousState.volume} to ${newVolume}`);
              }
            }
          }
          
          // Look for mute changes
          if (instance.Mute) {
            const mutes = Array.isArray(instance.Mute) ? instance.Mute : [instance.Mute];
            const masterMute = mutes.find((m: { '@_channel': string; '@_val': string }) => m['@_channel'] === 'Master');
            
            if (masterMute) {
              const newMute = masterMute['@_val'] === '1';
              previousState.mute = device.state.mute;
              if (newMute !== device.state.mute) {
                device.state.mute = newMute;
                stateChanged = true;
                debugManager.info('upnp', `${deviceName}: Mute changed from ${previousState.mute} to ${newMute}`);
              }
            }
          }
          
          if (stateChanged) {
            debugManager.info('upnp', `${deviceName}: RenderingControl state changed`);
            device.emit('state-change', device.state, previousState);
            
            // Emit events to EventManager for proper event tracking
            const eventManager = EventManager.getInstance();
            
            // Emit volume change if volume changed
            if (previousState.volume !== undefined && previousState.volume !== device.state.volume) {
              debugManager.debug('upnp', `${deviceName}: Emitting volume-change event to EventManager (${previousState.volume} -> ${device.state.volume})`);
              eventManager.emit('volume-change', {
                deviceId: device.id,
                roomName: device.roomName,
                previousVolume: previousState.volume,
                currentVolume: device.state.volume,
                timestamp: Date.now()
              });
            }
            
            // Emit mute change if mute changed
            if (previousState.mute !== undefined && previousState.mute !== device.state.mute) {
              debugManager.debug('upnp', `${deviceName}: Emitting mute-change event to EventManager (${previousState.mute} -> ${device.state.mute})`);
              eventManager.emit('mute-change', {
                deviceId: device.id,
                roomName: device.roomName,
                previousMute: previousState.mute,
                currentMute: device.state.mute,
                timestamp: Date.now()
              });
            } else {
              debugManager.debug('upnp', `${deviceName}: NOT emitting mute-change event - previousState.mute=${previousState.mute}, device.state.mute=${device.state.mute}`);
            }
          }
        }
      }
      
      // Queue events
      if (service.includes('Queue') && property.QueueID) {
        debugManager.info('upnp', `${deviceName}: Queue changed, QueueID: ${property.QueueID}`);
        if (device) {
          device.updateState();
        }
      }
      
      // ContentDirectory events
      if (service.includes('ContentDirectory') && property.ContainerUpdateIDs) {
        debugManager.info('upnp', `${deviceName}: Content updated, ContainerUpdateIDs: ${property.ContainerUpdateIDs}`);
        this.emit('content-update', deviceId, property.ContainerUpdateIDs);
      }
      
      // DeviceProperties events
      if (service.includes('DeviceProperties')) {
        debugManager.debug('upnp', `${deviceName}: Device properties changed`);
        // Could emit specific events for room name changes, icon changes, etc.
      }
      
    } catch (error) {
      logger.error(`Error parsing UPnP event from ${deviceName}/${service}:`, error);
      debugManager.debug('upnp', `Failed event body: ${body}`);
    }
  }
  
  /**
   * Subscribe to UPnP events for a device
   */
  async subscribeToDevice(baseUrl: string, eventUrl: string, deviceId: string): Promise<void> {
    if (!this.subscriber) {
      throw new Error('UPnP subscriber not initialized');
    }
    await this.subscriber.subscribe(baseUrl, eventUrl, deviceId);
  }
  
  /**
   * Get the current topology
   */
  getTopology(): { zones: ZoneGroup[] } | null {
    const zones = this.topologyManager.getZones();
    return zones.length > 0 ? { zones } : null;
  }
}