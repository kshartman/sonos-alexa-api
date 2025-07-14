import { EventEmitter } from 'events';
import { XMLParser } from 'fast-xml-parser';
import logger from './utils/logger.js';
import { soapRequest } from './utils/soap.js';
import { EventManager } from './utils/event-manager.js';
import { errorMessageIncludes } from './utils/error-helper.js';
import type { DeviceInfo, SonosState, SonosTrack, SonosService, Preset, BrowseResult, BrowseItem } from './types/sonos.js';
import type { PresetWithLegacy } from './utils/preset-converter.js';
import type { SonosDiscovery } from './discovery.js';
import type { 
  TransportInfo, 
  PositionInfo, 
  MediaInfo,
  TransportSettings, 
  CrossfadeMode,
  VolumeResponse,
  MuteResponse
} from './types/soap-responses.js';

const SERVICES: Record<string, SonosService> = {
  AVTransport: {
    serviceType: 'urn:schemas-upnp-org:service:AVTransport:1',
    controlURL: '/MediaRenderer/AVTransport/Control',
    eventSubURL: '/MediaRenderer/AVTransport/Event'
  },
  RenderingControl: {
    serviceType: 'urn:schemas-upnp-org:service:RenderingControl:1',
    controlURL: '/MediaRenderer/RenderingControl/Control',
    eventSubURL: '/MediaRenderer/RenderingControl/Event'
  },
  GroupRenderingControl: {
    serviceType: 'urn:schemas-upnp-org:service:GroupRenderingControl:1',
    controlURL: '/MediaRenderer/GroupRenderingControl/Control',
    eventSubURL: '/MediaRenderer/GroupRenderingControl/Event'
  },
  ZoneGroupTopology: {
    serviceType: 'urn:schemas-upnp-org:service:ZoneGroupTopology:1',
    controlURL: '/ZoneGroupTopology/Control',
    eventSubURL: '/ZoneGroupTopology/Event'
  },
  ContentDirectory: {
    serviceType: 'urn:schemas-upnp-org:service:ContentDirectory:1',
    controlURL: '/MediaServer/ContentDirectory/Control',
    eventSubURL: '/MediaServer/ContentDirectory/Event'
  }
};

interface DiscoveredService {
  serviceType: string;
  serviceId: string;
  controlURL: string;
  eventSubURL: string;
  SCPDURL: string;
}

/**
 * Represents a Sonos device with control capabilities.
 * Handles SOAP requests, UPnP subscriptions, and state management.
 * Emits events for state changes and content updates.
 */
export class SonosDevice extends EventEmitter {
  public readonly id: string;
  public readonly modelName: string;
  public readonly modelNumber: string;
  public readonly roomName: string;
  public readonly location: string;
  public readonly baseUrl: string;
  public readonly ip: string;
  public state: SonosState;
  
  private xmlParser: XMLParser;

  /**
   * Creates a new Sonos device instance.
   * @param deviceInfo - Device information from discovery
   * @param location - Device location URL
   */
  constructor(deviceInfo: DeviceInfo, location: string) {
    super();
    
    // Increase max listeners to prevent warning when multiple components subscribe
    this.setMaxListeners(20);
    
    this.id = deviceInfo.device.UDN;
    this.modelName = deviceInfo.device.modelName;
    this.modelNumber = deviceInfo.device.modelNumber;
    this.roomName = deviceInfo.device.roomName || 'Unknown Room';
    this.location = location;
    
    const url = new URL(location);
    this.baseUrl = `http://${url.hostname}:${url.port}`;
    this.ip = url.hostname;
    
    this.state = {
      playbackState: 'STOPPED',
      volume: 0,
      mute: false,
      currentTrack: null,
      coordinator: undefined
    };
    
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: false,
      trimValues: true
    });
  }

  /**
   * Subscribes to UPnP events for state updates.
   * Only subscribes to AVTransport and RenderingControl services.
   * Portable devices subscribe to GroupRenderingControl instead.
   */
  async subscribe(): Promise<void> {
    const discovery = global.discovery;
    if (!discovery) {
      throw new Error(`${this.roomName}: No discovery instance available`);
    }

    try {
      // Check if this device is part of a stereo pair or group
      // If so, we should subscribe to the coordinator instead
      const coordinator = discovery.getCoordinator ? discovery.getCoordinator(this.id) : null;
      const targetDevice = this; // eslint-disable-line @typescript-eslint/no-this-alias
      let targetBaseUrl = this.baseUrl;
      
      if (coordinator && coordinator.id !== this.id) {
        logger.debug(`${this.roomName}: This device is part of a stereo pair/group. Using coordinator ${coordinator.roomName} for subscriptions.`);
        // targetDevice = coordinator;
        targetBaseUrl = coordinator.baseUrl;
      }
      
      // Discover available services from the target device
      const services = await targetDevice.discoverServices();
      logger.debug(`${targetDevice.roomName}: Found ${services.length} services from device description`);
      
      // Log all discovered services
      services.forEach(service => {
        logger.debug(`${targetDevice.roomName}: Service: ${service.serviceType}, EventURL: ${service.eventSubURL}`);
      });
      
      // Subscribe to services that support events
      // Note: ZoneGroupTopology is handled separately in discovery.ts for ALL devices
      const eventServices = [
        'AVTransport',
        'RenderingControl', 
        'GroupRenderingControl',
        'ContentDirectory',
        'Queue',
        'DeviceProperties'
      ];
      
      let subscribedCount = 0;
      for (const serviceName of eventServices) {
        const service = services.find(s => s.serviceType.includes(serviceName));
        if (service && service.eventSubURL) {
          try {
            const eventUrl = service.eventSubURL.startsWith('/')
              ? service.eventSubURL
              : `/${service.eventSubURL}`;
            // Subscribe using this device's ID but the coordinator's URL
            await discovery.subscribeToDevice(targetBaseUrl, eventUrl, this.id);
            logger.debug(`${this.roomName}: Successfully subscribed to ${serviceName} at ${eventUrl} via ${targetDevice.roomName}`);
            subscribedCount++;
          } catch (err) {
            logger.warn(`${this.roomName}: Failed to subscribe to ${serviceName}:`, err);
          }
        } else {
          if (serviceName === 'AVTransport' || serviceName === 'RenderingControl') {
            logger.debug(`${this.roomName}: Service ${serviceName} not found - this may be a stereo pair member`);
          } else {
            logger.debug(`${this.roomName}: Service ${serviceName} not found or has no event URL`);
          }
        }
      }
      
      if (subscribedCount === 0 && coordinator && coordinator.id !== this.id) {
        logger.debug(`${this.roomName}: This is a stereo pair member. Events will be handled by coordinator ${coordinator.roomName}.`);
        // For stereo pair members, we don't need to throw an error - they get events from their coordinator
        return;
      } else if (subscribedCount === 0) {
        throw new Error(`${this.roomName}: Failed to subscribe to any UPnP events`);
      }
      
      logger.debug(`${this.roomName}: Subscribed to ${subscribedCount} UPnP event services`);
      
      // Get initial state
      await this.updateState();
    } catch (error) {
      logger.error(`${this.roomName}: Critical error in UPnP subscription:`, error);
      throw error; // Don't fall back to polling - fail fast
    }
  }

  /**
   * Discovers available UPnP services from the device description.
   * @returns Array of discovered services with their endpoints
   */
  async discoverServices(): Promise<DiscoveredService[]> {
    const deviceDescUrl = `${this.baseUrl}/xml/device_description.xml`;
    
    const response = await fetch(deviceDescUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch device description: ${response.status}`);
    }
    
    const xml = await response.text();
    const parsed = this.xmlParser.parse(xml);
    
    const discoveredServices: DiscoveredService[] = [];
    
    // Helper function to extract services from a device
    const extractServices = (device: unknown) => {
      if (device && typeof device === 'object' && 'serviceList' in device && 
          device.serviceList && typeof device.serviceList === 'object' && 'service' in device.serviceList) {
        const deviceWithService = device as { serviceList: { service: unknown } };
        const serviceData = deviceWithService.serviceList.service;
        const serviceList = Array.isArray(serviceData) ? serviceData : [serviceData];
        
        for (const service of serviceList) {
          discoveredServices.push({
            serviceType: service.serviceType || '',
            serviceId: service.serviceId || '',
            controlURL: service.controlURL || '',
            eventSubURL: service.eventSubURL || '',
            SCPDURL: service.SCPDURL || ''
          });
        }
      }
    };
    
    // Extract services from root device
    const rootDevice = parsed.root?.device;
    if (rootDevice) {
      extractServices(rootDevice);
      
      // Also check for embedded devices (MediaServer, MediaRenderer, etc.)
      if (rootDevice.deviceList?.device) {
        const embeddedDevices = Array.isArray(rootDevice.deviceList.device)
          ? rootDevice.deviceList.device
          : [rootDevice.deviceList.device];
        
        for (const embeddedDevice of embeddedDevices) {
          extractServices(embeddedDevice);
        }
      }
    }
    
    return discoveredServices;
  }

  unsubscribe(): void {
    // TODO: Properly unsubscribe from UPnP events
    const discovery = global.discovery;
    if (discovery) {
      // We need to track which services we subscribed to
      logger.debug(`${this.roomName}: Unsubscribing from UPnP events`);
    }
  }

  async updateState(): Promise<void> {
    try {
      const [transportInfo, volume, mute, positionInfo] = await Promise.all([
        this.getTransportInfo(),
        this.getVolume(),
        this.getMute(),
        this.getPositionInfo()
      ]);

      // Debug logging for position info
      logger.debug(`${this.roomName}: Position info:`, {
        TrackURI: positionInfo.TrackURI,
        TrackMetaData: positionInfo.TrackMetaData?.substring(0, 100) + '...',
        TrackDuration: positionInfo.TrackDuration,
        RelTime: positionInfo.RelTime
      });

      // When a device is playing from a coordinator (x-rincon:), 
      // its transport state doesn't reflect the actual playback state
      const effectivePlaybackState = transportInfo.CurrentTransportState as SonosState['playbackState'];
      if (positionInfo.TrackURI?.startsWith('x-rincon:')) {
        // Device is a group member playing from coordinator
        // For now, we'll trust the transport state, but log it
        logger.debug(`${this.roomName}: Group member detected (${positionInfo.TrackURI}), transport state: ${effectivePlaybackState}`);
      }

      const newState: SonosState = {
        playbackState: effectivePlaybackState,
        volume: parseInt(volume.CurrentVolume, 10),
        mute: mute.CurrentMute === '1',
        currentTrack: this.parseTrackInfo(positionInfo)
      };

      // Check for state changes (excluding coordinator for comparison)
      const { coordinator: _coordinator, ...oldStateForComparison } = this.state;
      
      if (JSON.stringify(newState) !== JSON.stringify(oldStateForComparison)) {
        const previousPlaybackState = this.state.playbackState;
        const previousVolume = this.state.volume;
        const previousMute = this.state.mute;
        
        this.state = { ...this.state, ...newState };
        
        // Emit state change with previous state included
        this.emit('state-change', this.state, {
          playbackState: previousPlaybackState,
          volume: previousVolume,
          mute: previousMute
        });
        
        // Emit to EventManager for event-driven tests
        const eventManager = EventManager.getInstance();
        
        // Emit playback state change
        if (previousPlaybackState !== newState.playbackState) {
          eventManager.emitStateChange(this, previousPlaybackState, newState.playbackState);
        }
        
        // Emit volume change
        if (previousVolume !== newState.volume) {
          eventManager.emit('volume-change', {
            deviceId: this.id,
            roomName: this.roomName,
            previousVolume,
            currentVolume: newState.volume,
            timestamp: Date.now()
          });
        }
      }
    } catch (error) {
      logger.error(`Error updating state for ${this.roomName}:`, error);
    }
  }

  private parseTrackInfo(positionInfo: PositionInfo): SonosTrack | null {
    if (!positionInfo.TrackMetaData || positionInfo.TrackMetaData === 'NOT_IMPLEMENTED') {
      logger.debug(`${this.roomName}: No track metadata available (TrackMetaData: ${positionInfo.TrackMetaData})`);
      return null;
    }

    try {
      // SOAP returns {} for empty strings, so convert to string
      const trackMetaDataStr = typeof positionInfo.TrackMetaData === 'string' 
        ? positionInfo.TrackMetaData 
        : '';
        
      if (!trackMetaDataStr) {
        logger.debug(`${this.roomName}: No track metadata available`);
        return null;
      }
      
      const metadata = this.xmlParser.parse(trackMetaDataStr);
      logger.debug(`${this.roomName}: Parsed metadata:`, JSON.stringify(metadata, null, 2).substring(0, 500) + '...');
      
      const item = metadata['DIDL-Lite']?.item;
      
      if (!item) {
        logger.debug(`${this.roomName}: No item found in DIDL-Lite metadata`);
        return null;
      }

      // Determine track type based on URI
      let type = 'track';
      let stationName = '';
      
      // SOAP returns {} for empty strings
      const trackUri = typeof positionInfo.TrackURI === 'string' ? positionInfo.TrackURI : '';
      
      if (trackUri) {
        if (trackUri.includes('x-sonosapi-radio:') || 
            trackUri.includes('x-sonosapi-stream:') ||
            trackUri.includes('x-rincon-mp3radio:')) {
          type = 'radio';
          // Extract station name from StreamContent if available
          if (item['r:streamContent']) {
            stationName = item['r:streamContent'];
          } else if (item['dc:title'] && !item['dc:creator']) {
            // Sometimes radio stations put station name in title
            stationName = item['dc:title'];
          }
        } else if (trackUri.includes('x-rincon-stream:')) {
          type = 'line_in';
        }
      }
      
      // Convert duration to seconds
      let durationSeconds = 0;
      const trackDuration = typeof positionInfo.TrackDuration === 'string' ? positionInfo.TrackDuration : '';
      if (trackDuration && trackDuration !== 'NOT_IMPLEMENTED') {
        const durationParts = trackDuration.split(':');
        if (durationParts.length === 3) {
          durationSeconds = parseInt(durationParts[0]!, 10) * 3600 + 
                           parseInt(durationParts[1]!, 10) * 60 + 
                           parseInt(durationParts[2]!, 10);
        }
      }
      
      const track: SonosTrack = {
        artist: item['dc:creator'] || item['r:albumArtist'] || '',
        title: item['dc:title'] || '',
        album: item['upnp:album'] || '',
        albumArtUri: item['upnp:albumArtURI'] || '',
        duration: durationSeconds,
        uri: trackUri,
        trackUri: trackUri,  // Legacy compatibility
        type: type as 'track' | 'radio' | 'line_in',
        stationName
      };
      
      logger.debug(`${this.roomName}: Parsed track:`, track);
      return track;
    } catch (error) {
      logger.error(`${this.roomName}: Error parsing track metadata:`, error);
      return null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async soap(service: string, action: string, body: Record<string, unknown> = {}): Promise<any> { // ANY IS CORRECT: SOAP responses vary by service/action
    const serviceInfo = SERVICES[service];
    if (!serviceInfo) {
      throw new Error(`Unknown service: ${service}`);
    }

    const url = `${this.baseUrl}${serviceInfo.controlURL}`;
    return soapRequest(url, serviceInfo.serviceType, action, body);
  }

  // AVTransport actions
  /**
   * Starts playback.
   * @throws Error if SOAP request fails
   */
  async play(): Promise<void> {
    await this.soap('AVTransport', 'Play', {
      InstanceID: 0,
      Speed: 1
    });
  }

  /**
   * Pauses playback.
   * @throws Error if SOAP request fails
   */
  async pause(): Promise<void> {
    await this.soap('AVTransport', 'Pause', {
      InstanceID: 0
    });
  }

  /**
   * Stops playback.
   * @throws Error if SOAP request fails
   */
  async stop(): Promise<void> {
    await this.soap('AVTransport', 'Stop', {
      InstanceID: 0
    });
  }

  /**
   * Skips to the next track.
   * @throws Error if SOAP request fails
   */
  async next(): Promise<void> {
    await this.soap('AVTransport', 'Next', {
      InstanceID: 0
    });
  }

  /**
   * Goes to the previous track.
   * @throws Error if SOAP request fails
   */
  async previous(): Promise<void> {
    await this.soap('AVTransport', 'Previous', {
      InstanceID: 0
    });
  }

  /**
   * Seeks to a specific position in the current track or to a specific track.
   * @param positionOrTrack - Time position (HH:MM:SS) or track number
   * @param elapsedTime - Optional elapsed time when seeking to track number
   */
  async seek(positionOrTrack: string | number, elapsedTime?: number): Promise<void> {
    if (typeof positionOrTrack === 'number' && elapsedTime !== undefined) {
      // Seek to track number first
      await this.soap('AVTransport', 'Seek', {
        InstanceID: 0,
        Unit: 'TRACK_NR',
        Target: positionOrTrack.toString()
      });
      // Then seek to elapsed time within track
      const timeStr = this.formatTime(elapsedTime);
      await this.soap('AVTransport', 'Seek', {
        InstanceID: 0,
        Unit: 'REL_TIME',
        Target: timeStr
      });
    } else {
      // Seek to time position
      await this.soap('AVTransport', 'Seek', {
        InstanceID: 0,
        Unit: 'REL_TIME',
        Target: positionOrTrack as string
      });
    }
  }

  private formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Sets the transport URI for playback.
   * Used for playing content or joining groups.
   * @param uri - The URI to play (content URI or x-rincon: for grouping)
   * @param metadata - Optional DIDL-Lite metadata for the content
   */
  async setAVTransportURI(uri: string, metadata = ''): Promise<void> {
    await this.soap('AVTransport', 'SetAVTransportURI', {
      InstanceID: 0,
      CurrentURI: uri,
      CurrentURIMetaData: metadata
    });
  }

  async getTransportInfo(): Promise<TransportInfo> {
    return this.soap('AVTransport', 'GetTransportInfo', {
      InstanceID: 0
    });
  }

  async getPositionInfo(): Promise<PositionInfo> {
    return this.soap('AVTransport', 'GetPositionInfo', {
      InstanceID: 0
    });
  }

  async getMediaInfo(): Promise<MediaInfo> {
    return this.soap('AVTransport', 'GetMediaInfo', {
      InstanceID: 0
    });
  }

  async getTransportSettings(): Promise<TransportSettings> {
    return this.soap('AVTransport', 'GetTransportSettings', {
      InstanceID: 0
    });
  }

  async getCrossfadeMode(): Promise<CrossfadeMode> {
    return this.soap('AVTransport', 'GetCrossfadeMode', {
      InstanceID: 0
    });
  }
   

  // RenderingControl actions
  /**
   * Sets the device volume.
   * @param level - Volume level (0-100), automatically clamped to valid range
   * @throws Error if SOAP request fails
   */
  async setVolume(level: number): Promise<void> {
    const clampedLevel = Math.max(0, Math.min(100, level));
    await this.soap('RenderingControl', 'SetVolume', {
      InstanceID: 0,
      Channel: 'Master',
      DesiredVolume: clampedLevel
    });
  }

  async getVolume(): Promise<VolumeResponse> {
    return this.soap('RenderingControl', 'GetVolume', {
      InstanceID: 0,
      Channel: 'Master'
    });
  }

  /**
   * Sets the mute state.
   * @param mute - True to mute, false to unmute
   * @throws Error if SOAP request fails
   */
  async setMute(mute: boolean): Promise<void> {
    await this.soap('RenderingControl', 'SetMute', {
      InstanceID: 0,
      Channel: 'Master',
      DesiredMute: mute ? 1 : 0
    });
  }

  async getMute(): Promise<MuteResponse> {
    return this.soap('RenderingControl', 'GetMute', {
      InstanceID: 0,
      Channel: 'Master'
    });
  }

  // Group management - these will be overridden by discovery system
  getCoordinator(): SonosDevice {
    // Return the coordinator from state if available, otherwise self
    return this.state.coordinator || this;
  }

  isCoordinator(): boolean {
    const coordinator = this.getCoordinator();
    return coordinator.id === this.id;
  }

  // Group management
  async becomeCoordinatorOfStandaloneGroup(): Promise<void> {
    logger.debug(`Breaking out ${this.roomName} to become standalone coordinator`);
    await this.soap('AVTransport', 'BecomeCoordinatorOfStandaloneGroup', {
      InstanceID: 0
    });
  }

  async addPlayerToGroup(coordinatorUuid: string): Promise<void> {
    const rinconUri = `x-rincon:${coordinatorUuid}`;
    logger.debug(`Adding ${this.roomName} to group with coordinator ${coordinatorUuid}`);
    await this.setAVTransportURI(rinconUri);
  }

  // Utility methods
  /**
   * Plays a specific URI with automatic handling for different content types.
   * Handles special cases like playlists, containers, and queue-based content.
   * @param uri - The content URI to play
   * @param metadata - Optional DIDL-Lite metadata
   * @param discovery - Optional discovery instance for coordinator lookup
   */
  async playUri(uri: string, metadata = '', discovery?: SonosDiscovery): Promise<void> {
    // Handle favorite: URIs that weren't resolved at preset load time
    if (uri.startsWith('favorite:')) {
      const favoriteName = uri.substring(9);
      logger.debug(`${this.roomName}: resolving favorite at runtime: ${favoriteName}`);
      
      try {
        const { FavoritesManager } = await import('./actions/favorites.js');
        const favoritesManager = new FavoritesManager();
        const favorite = await favoritesManager.findFavoriteByName(this, favoriteName);
        
        if (!favorite) {
          throw new Error(`Favorite not found: ${favoriteName}`);
        }
        
        logger.debug(`${this.roomName}: resolved favorite "${favoriteName}" to URI: ${favorite.uri}`);
        uri = favorite.uri;
        metadata = favorite.metadata || metadata || '';
      } catch (error) {
        logger.error(`${this.roomName}: Failed to resolve favorite "${favoriteName}":`, error);
        throw new Error(`Failed to resolve favorite: ${favoriteName}`);
      }
    }
    
    // Handle saved queue URIs (file:///jffs/settings/savedqueues.rsq#ID)
    // These are Sonos playlists that need to be loaded to the queue
    if (uri.startsWith('file:///jffs/settings/savedqueues.rsq#')) {
      logger.debug(`${this.roomName}: handling saved queue URI by loading to queue`);
      
      // First ensure we're coordinator if needed
      const hasTopologyData = discovery && discovery.getZones().length > 0;
      if (!hasTopologyData) {
        // Wait briefly for topology data
        for (let i = 0; i < 3; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (discovery && discovery.getZones().length > 0) break;
        }
      }
      
      const isCurrentlyCoordinator = discovery ? discovery.isCoordinator(this.id) : true;
      if (!isCurrentlyCoordinator) {
        logger.debug(`${this.roomName}: becoming coordinator before queue operation`);
        try {
          await this.becomeCoordinatorOfStandaloneGroup();
        } catch (error) {
          logger.warn(`${this.roomName}: becomeCoordinatorOfStandaloneGroup failed: ${(error as Error).message}`);
        }
      }
      
      // Clear the queue
      logger.debug(`${this.roomName}: clearing queue`);
      await this.clearQueue();
      
      // Add the saved queue to the queue
      logger.debug(`${this.roomName}: adding saved queue to queue: ${uri}`);
      await this.addURIToQueue(uri, metadata);
      
      // Play from the queue
      const deviceId = this.id.replace('uuid:', '');
      const queueUri = `x-rincon-queue:${deviceId}#0`;
      logger.debug(`${this.roomName}: setting AVTransport to queue: ${queueUri}`);
      
      await this.setAVTransportURI(queueUri, '');
      await this.play();
      return;
    }
    
    // Handle x-rincon-playlist: URIs for music library playlists
    // These need special handling - we browse the playlist and add its contents to the queue
    if (uri.startsWith('x-rincon-playlist:')) {
      logger.debug(`${this.roomName}: handling x-rincon-playlist URI by browsing and adding contents to queue`);
      
      // Extract the playlist ID from the URI
      const match = uri.match(/#(.+)$/);
      if (!match) {
        throw new Error('Invalid x-rincon-playlist URI format');
      }
      const playlistId = match[1]!; // e.g., "S://media/mgplaylists/Blues(Acoustic Favorites).m3u"
      
      // First ensure we're coordinator if needed
      const hasTopologyData = discovery && discovery.getZones().length > 0;
      if (!hasTopologyData) {
        // Wait briefly for topology data
        for (let i = 0; i < 3; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (discovery && discovery.getZones().length > 0) break;
        }
      }
      
      const isCurrentlyCoordinator = discovery ? discovery.isCoordinator(this.id) : true;
      if (!isCurrentlyCoordinator) {
        logger.debug(`${this.roomName}: becoming coordinator before queue operation`);
        try {
          await this.becomeCoordinatorOfStandaloneGroup();
        } catch (error) {
          logger.warn(`${this.roomName}: becomeCoordinatorOfStandaloneGroup failed: ${(error as Error).message}`);
        }
      }
      
      // Clear the queue
      logger.debug(`${this.roomName}: clearing queue`);
      await this.clearQueue();
      
      // Browse the playlist to get its contents
      logger.debug(`${this.roomName}: browsing playlist ${playlistId}`);
      const browseResult = await this.browse(playlistId, 0, 1000); // Get up to 1000 tracks
      
      if (browseResult.items.length === 0) {
        throw new Error('Playlist is empty or could not be browsed');
      }
      
      logger.debug(`${this.roomName}: found ${browseResult.items.length} tracks in playlist`);
      
      // Add all tracks to the queue
      for (let i = 0; i < browseResult.items.length; i++) {
        const item = browseResult.items[i];
        if (item && item.uri && item.metadata) {
          logger.debug(`${this.roomName}: adding track ${i + 1}/${browseResult.items.length}: ${item.title}`);
          await this.addURIToQueue(item.uri, item.metadata);
        }
      }
      
      // Play from the queue - we need to set the transport URI to the queue
      const deviceId = this.id.replace('uuid:', '');
      const queueUri = `x-rincon-queue:${deviceId}#0`;
      logger.debug(`${this.roomName}: setting AVTransport to queue: ${queueUri}`);
      
      // Use empty metadata for queue playback
      await this.setAVTransportURI(queueUri, '');
      
      logger.debug(`${this.roomName}: starting playback from queue`);
      await this.play();
      return;
    }
    
    // Handle x-rincon-cpcontainer: URIs (e.g., Hearts of Space, Spotify playlists)
    // These are treated like music library items - add to queue and play from queue
    if (uri.startsWith('x-rincon-cpcontainer:')) {
      logger.debug(`${this.roomName}: handling x-rincon-cpcontainer URI by adding to queue`);
      
      // First ensure we're coordinator if needed
      const hasTopologyData = discovery && discovery.getZones().length > 0;
      if (!hasTopologyData) {
        // Wait briefly for topology data
        for (let i = 0; i < 3; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (discovery && discovery.getZones().length > 0) break;
        }
      }
      
      const isCurrentlyCoordinator = discovery ? discovery.isCoordinator(this.id) : true;
      if (!isCurrentlyCoordinator) {
        logger.debug(`${this.roomName}: becoming coordinator before queue operation`);
        try {
          await this.becomeCoordinatorOfStandaloneGroup();
        } catch (error) {
          logger.warn(`${this.roomName}: becomeCoordinatorOfStandaloneGroup failed: ${(error as Error).message}`);
        }
      }
      
      // Clear the queue
      logger.debug(`${this.roomName}: clearing queue`);
      await this.clearQueue();
      
      // Add the container to the queue
      logger.debug(`${this.roomName}: adding container to queue: ${uri}`);
      await this.addURIToQueue(uri, metadata);
      
      // Play from the queue
      const deviceId = this.id.replace('uuid:', '');
      const queueUri = `x-rincon-queue:${deviceId}#0`;
      logger.debug(`${this.roomName}: setting AVTransport to queue: ${queueUri}`);
      
      await this.setAVTransportURI(queueUri, '');
      await this.play();
      return;
    }
    
    // Regular URI handling
    const playUri = uri;
    const playMetadata = metadata;
    
    logger.debug(`${this.roomName}: playUri called with uri=${playUri.substring(0, 50)}...`);
    
    // Check if we need to become coordinator using real topology data
    let hasTopologyData = discovery && discovery.getZones().length > 0;
    
    // If no topology data, wait briefly for it to arrive
    if (!hasTopologyData && discovery) {
      logger.debug(`${this.roomName}: waiting briefly for topology data...`);
      for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
        hasTopologyData = discovery.getZones().length > 0;
        if (hasTopologyData) {
          logger.debug(`${this.roomName}: topology data received after ${(i + 1) * 100}ms`);
          break;
        }
      }
    }
    
    const isCurrentlyCoordinator = discovery ? discovery.isCoordinator(this.id) : this.isCoordinator();
    
    logger.debug(`${this.roomName}: hasTopologyData=${hasTopologyData}, isCoordinator=${isCurrentlyCoordinator}`);
    
    if (hasTopologyData && !isCurrentlyCoordinator) {
      // We have topology data and know we're not coordinator - break out
      logger.debug(`${this.roomName}: becoming coordinator of standalone group (topology-based)`);
      try {
        await this.becomeCoordinatorOfStandaloneGroup();
      } catch (error) {
        logger.debug(`${this.roomName}: becomeCoordinatorOfStandaloneGroup failed:`, (error as Error).message);
      }
    } else if (!hasTopologyData) {
      // No topology data yet - try to become coordinator, but handle stereo pair errors
      logger.debug(`${this.roomName}: no topology data available, trying to become coordinator`);
      try {
        await this.becomeCoordinatorOfStandaloneGroup();
      } catch (error) {
        const errorMsg = (error as Error).message;
        logger.warn(`${this.roomName}: becomeCoordinatorOfStandaloneGroup failed: ${errorMsg}`);
        
        // If this fails with 1023, it might be a stereo pair slave - just continue
        if (errorMsg.includes('1023')) {
          logger.info(`${this.roomName}: UPnP 1023 error suggests this may be a stereo pair slave speaker`);
        }
      }
    } else {
      logger.debug(`${this.roomName}: already coordinator according to topology, proceeding`);
    }
    
    // Always try to stop first to clear any existing playback state
    try {
      logger.debug(`${this.roomName}: stopping current playback before setting new URI`);
      await this.stop();
    } catch (error) {
      logger.debug(`${this.roomName}: stop failed (may already be stopped):`, (error as Error).message);
    }
    
    logger.debug(`${this.roomName}: setting AVTransport URI`);
    await this.setAVTransportURI(playUri, playMetadata);
    
    // For HTTP URLs (like TTS), wait a bit for the device to load the content
    if (playUri.startsWith('http://') || playUri.startsWith('https://')) {
      logger.debug(`${this.roomName}: waiting for HTTP content to load`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    logger.debug(`${this.roomName}: starting playback`);
    try {
      await this.play();
    } catch (error) {
      // If play fails with error 701, it might be because the content hasn't loaded yet
      if (errorMessageIncludes(error, '701')) {
        logger.debug(`${this.roomName}: play failed with 701, waiting and retrying`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.play();
      } else {
        throw error;
      }
    }
  }

  async playPreset(preset: Preset | PresetWithLegacy, discovery?: SonosDiscovery): Promise<void> {
    // Handle legacy preset features if available
    const legacyData = '_legacy' in preset ? preset._legacy : undefined;
    
    // Handle pauseOthers if discovery system is available
    if (legacyData?.pauseOthers && discovery) {
      logger.debug('Pausing other zones as requested by preset');
      await this.pauseOtherZones(discovery);
    }
    
    if (preset.volume !== undefined) {
      await this.setVolume(preset.volume);
    }
    
    // Handle sleep timer if specified
    if (legacyData?.sleep) {
      logger.debug(`Legacy preset sleep timer: ${legacyData.sleep} seconds`);
      await this.setSleepTimer(legacyData.sleep);
    }
    
    // Favorites should already be resolved at load time
    // playUri handles all the group management internally
    await this.playUri(preset.uri, preset.metadata || '', discovery);
    
    // Handle playMode settings
    if (legacyData?.playMode) {
      logger.debug('Legacy preset playMode settings:', legacyData.playMode);
      
      if (legacyData.playMode.repeat !== undefined) {
        await this.setRepeat(legacyData.playMode.repeat);
      }
      
      if (legacyData.playMode.shuffle !== undefined) {
        await this.setShuffle(legacyData.playMode.shuffle);
      }
      
      if (legacyData.playMode.crossfade !== undefined) {
        await this.setCrossfade(legacyData.playMode.crossfade);
      }
    }
  }

  private async pauseOtherZones(discovery: SonosDiscovery): Promise<void> {
    try {
      const allDevices = discovery.getAllDevices();
      const pausePromises = allDevices
        .filter((device: SonosDevice) => device.id !== this.id)
        .filter((device: SonosDevice) => discovery.isCoordinator(device.id))
        .filter((device: SonosDevice) => device.state.playbackState === 'PLAYING')
        .map((device: SonosDevice) => 
          device.pause().catch((err: Error) => {
            logger.debug(`Failed to pause ${device.roomName}: ${err.message}`);
          })
        );
      
      await Promise.all(pausePromises);
      logger.debug('Finished pausing other zones');
    } catch (error) {
      logger.error('Error pausing other zones:', error);
    }
  }

  // Queue manipulation methods
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async addURIToQueue(uri: string, metadata = '', enqueueAsNext = false, desiredFirstTrackNumberEnqueued = 0): Promise<any> {
    logger.debug(`${this.roomName}: adding URI to queue - uri=${uri.substring(0, 50)}..., enqueueAsNext=${enqueueAsNext}`);
    
    return this.soap('AVTransport', 'AddURIToQueue', {
      InstanceID: 0,
      EnqueuedURI: uri,
      EnqueuedURIMetaData: metadata,
      DesiredFirstTrackNumberEnqueued: desiredFirstTrackNumberEnqueued,
      EnqueueAsNext: enqueueAsNext ? 1 : 0
    });
  }

  async clearQueue(): Promise<void> {
    logger.debug(`${this.roomName}: clearing queue`);
    
    await this.soap('AVTransport', 'RemoveAllTracksFromQueue', {
      InstanceID: 0
    });
  }

  async setSleepTimer(seconds: number): Promise<void> {
    logger.debug(`${this.roomName}: setting sleep timer to ${seconds} seconds`);
    
    // Convert seconds to HH:MM:SS format or empty string to cancel
    let duration = '';
    if (seconds > 0) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      duration = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    await this.soap('AVTransport', 'ConfigureSleepTimer', {
      InstanceID: 0,
      NewSleepTimerDuration: duration
    });
  }


  // Playback mode methods
  async setRepeat(mode: 'none' | 'all' | 'one'): Promise<void> {
    logger.debug(`${this.roomName}: setting repeat mode to ${mode}`);
    
    const playModeMap = {
      'none': 'NORMAL',
      'all': 'REPEAT_ALL', 
      'one': 'REPEAT_ONE'
    };
    
    await this.soap('AVTransport', 'SetPlayMode', {
      InstanceID: 0,
      NewPlayMode: playModeMap[mode]
    });
  }

  async setShuffle(enabled: boolean): Promise<void> {
    logger.debug(`${this.roomName}: setting shuffle to ${enabled}`);
    
    // Get current play mode to preserve repeat setting
    const transportSettings = await this.soap('AVTransport', 'GetTransportSettings', {
      InstanceID: 0
    });
    
    let newMode = 'NORMAL';
    if (transportSettings.PlayMode?.includes('REPEAT_ONE')) {
      // Sonos doesn't support shuffle with REPEAT_ONE
      newMode = enabled ? 'SHUFFLE_NOREPEAT' : 'REPEAT_ONE';
    } else if (transportSettings.PlayMode?.includes('REPEAT')) {
      // SHUFFLE = shuffle and repeat (loop), REPEAT_ALL = repeat without shuffle
      newMode = enabled ? 'SHUFFLE' : 'REPEAT_ALL';
    } else {
      // SHUFFLE_NOREPEAT = shuffle once, NORMAL = no shuffle/repeat
      newMode = enabled ? 'SHUFFLE_NOREPEAT' : 'NORMAL';
    }
    
    await this.soap('AVTransport', 'SetPlayMode', {
      InstanceID: 0,
      NewPlayMode: newMode
    });
  }

  async setCrossfade(enabled: boolean): Promise<void> {
    logger.debug(`${this.roomName}: setting crossfade to ${enabled}`);
    
    await this.soap('AVTransport', 'SetCrossfadeMode', {
      InstanceID: 0,
      CrossfadeMode: enabled ? 1 : 0
    });
  }

  async setGroupVolume(level: number): Promise<void> {
    logger.debug(`${this.roomName}: setting group volume to ${level}`);
    const clampedLevel = Math.max(0, Math.min(100, level));
    
    try {
      await this.soap('GroupRenderingControl', 'SetGroupVolume', {
        InstanceID: 0,
        DesiredVolume: clampedLevel
      });
    } catch (_error) {
      // If GroupRenderingControl is not supported, we need to be smarter
      logger.warn(`${this.roomName}: GroupRenderingControl not supported, checking coordinator`);
      
      // Check if we're the coordinator
      const discovery = global.discovery;
      if (discovery && !discovery.isCoordinator(this.id)) {
        // We're not the coordinator, find who is and delegate
        const coordinator = discovery.getCoordinator(this.id);
        if (coordinator && coordinator.id !== this.id) {
          logger.debug(`${this.roomName}: Delegating group volume to coordinator ${coordinator.roomName}`);
          return coordinator.setGroupVolume(level);
        }
      }
      
      // We are the coordinator or can't find one, use regular volume
      logger.debug(`${this.roomName}: Using regular volume as fallback`);
      await this.setVolume(clampedLevel);
    }
  }

  async playLineIn(sourceDevice: SonosDevice): Promise<void> {
    logger.debug(`${this.roomName}: playing line-in from ${sourceDevice.roomName}`);
    
    // Use the source device's UUID in the URI
    const lineInUri = `x-rincon-stream:${sourceDevice.id}`;
    
    await this.setAVTransportURI(lineInUri);
    await this.play();
  }

  // Browse ContentDirectory for items - returns raw SOAP response
  async browseRaw(
    objectId: string,
    browseFlag: 'BrowseDirectChildren' | 'BrowseMetadata' = 'BrowseDirectChildren',
    filter = '*',
    startIndex = 0,
    limit = 100,
    sortCriteria = ''
  ): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.soap('ContentDirectory', 'Browse', {
      ObjectID: objectId,
      BrowseFlag: browseFlag,
      Filter: filter,
      StartingIndex: startIndex,
      RequestedCount: limit,
      SortCriteria: sortCriteria
    });
  }

  // Browse ContentDirectory for items - returns parsed BrowseResult
  async browse(objectId: string, startIndex = 0, limit = 100): Promise<BrowseResult> {
    const result = await this.browseRaw(objectId, 'BrowseDirectChildren', '*', startIndex, limit, '');

    // Parse the DIDL-Lite XML response
    const items: BrowseItem[] = [];
    
    if (result.Result) {
      const { XMLParser } = await import('fast-xml-parser');
      const parser = new XMLParser({
        ignoreAttributes: false,
        parseAttributeValue: false,
        trimValues: true
      });

      const parsed = parser.parse(result.Result);
      const didlLite = parsed['DIDL-Lite'];
      
      if (didlLite) {
        // Handle both single items and arrays
        const containers = didlLite.container ? 
          (Array.isArray(didlLite.container) ? didlLite.container : [didlLite.container]) : [];
        const mediaItems = didlLite.item ? 
          (Array.isArray(didlLite.item) ? didlLite.item : [didlLite.item]) : [];

        // Process containers (playlists, albums, etc.)
        for (const container of containers) {
          if (container && container['dc:title']) {
            items.push({
              id: container['@_id'] || '',
              parentId: container['@_parentID'] || '',
              title: container['dc:title'],
              itemType: 'container',
              uri: container.res ? container.res['#text'] || container.res : '',
              metadata: result.Result, // Store original DIDL-Lite for playback
              desc: container.desc || container['r:description'] || container['desc'] // Extract desc field
            });
          }
        }

        // Process items (tracks, etc.)
        for (const item of mediaItems) {
          if (item && item['dc:title']) {
            items.push({
              id: item['@_id'] || '',
              parentId: item['@_parentID'] || '',
              title: item['dc:title'],
              itemType: 'item',
              artist: item['dc:creator'],
              album: item['upnp:album'],
              uri: item.res ? (item.res['#text'] || item.res) : '',
              metadata: result.Result, // Store original DIDL-Lite for playback
              desc: item.desc || item['r:description'] || item['desc'] // Extract desc field
            });
          }
        }
      }
    }

    return {
      items,
      startIndex,
      numberReturned: parseInt(result.NumberReturned || '0', 10),
      totalMatches: parseInt(result.TotalMatches || '0', 10)
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getQueue(limit = 100, offset = 0): Promise<any> {
    // Get queue from ContentDirectory - Q:0 is the queue ID
    const result = await this.browse('Q:0', offset, limit);
    
    // Transform the items to match legacy format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queueItems = result.items.map((item: any, index) => {
      // Since BrowseItem is a simplified type, we access the raw data
      return {
        uri: item.uri || '',
        title: item.title || '',
        artist: item.artist || '',
        album: item.album || '',
        albumTrackNumber: '',
        albumArtUri: '',
        metadata: item.metadata || '',
        queuePosition: offset + index + 1  // 1-based position in queue
      };
    });
    
    return {
      items: queueItems,
      startIndex: result.startIndex,
      numberReturned: result.numberReturned,
      totalMatches: result.totalMatches
    };
  }

  /**
   * List all music service accounts configured on the device
   * @deprecated Not supported on S2 systems - returns 405 Method Not Allowed
   * Use favorites-based account extraction instead (see AccountService)
   * @returns Empty array (method kept for backwards compatibility)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async listAccounts(): Promise<any[]> {
    logger.warn(`${this.roomName}: Status:ListAccounts is not supported on S2 systems`);
    return [];
  }


  /**
   * Search the content directory
   * @param containerId - Container to search in
   * @param searchCriteria - Search criteria string
   * @param filter - Which metadata to return (* for all)
   * @param startingIndex - Starting index for pagination
   * @param requestedCount - Number of items to return
   * @param sortCriteria - Sort criteria
   * @returns SOAP response containing Result XML and counts
   */
  async searchContentDirectory(
    containerId: string,
    searchCriteria: string,
    filter = '*',
    startingIndex = 0,
    requestedCount = 100,
    sortCriteria = ''
  ): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.soap('ContentDirectory', 'Search', {
      ContainerID: containerId,
      SearchCriteria: searchCriteria,
      Filter: filter,
      StartingIndex: startingIndex,
      RequestedCount: requestedCount,
      SortCriteria: sortCriteria
    });
  }

  /**
   * Delete a content directory object (e.g., favorite)
   * @param objectId - The object ID to delete
   * @returns SOAP response
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async destroyObject(objectId: string): Promise<any> {
    return this.soap('ContentDirectory', 'DestroyObject', {
      ObjectID: objectId
    });
  }

  /**
   * Create a new object in the content directory
   * @param containerId - Container to create object in
   * @param elements - Object metadata
   * @returns SOAP response with new object ID and result
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createObject(containerId: string, elements: string): Promise<any> {
    return this.soap('ContentDirectory', 'CreateObject', {
      ContainerID: containerId,
      Elements: elements
    });
  }


  /**
   * Add multiple URIs to queue
   * @param uris - Array of URIs to add
   * @param metadatas - Array of metadata strings
   * @param containerId - Container ID for the items
   * @param desiredFirstTrackNumber - Position in queue (0 = end)
   * @param enqueueAsNext - Whether to add as next items
   * @returns SOAP response with new queue info
   */
  async addMultipleURIsToQueue(
    uris: string[],
    metadatas: string[],
    containerId: string,
    desiredFirstTrackNumber = 0,
    enqueueAsNext = true
  ): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.soap('AVTransport', 'AddMultipleURIsToQueue', {
      InstanceID: 0,
      UpdateID: 0,
      NumberOfURIs: uris.length,
      EnqueuedURIs: uris.join(' '),
      EnqueuedURIsMetaData: metadatas.join(' '),
      ContainerURI: containerId,
      ContainerMetaData: '',
      DesiredFirstTrackNumberEnqueued: desiredFirstTrackNumber,
      EnqueueAsNext: enqueueAsNext ? 1 : 0
    });
  }

  /**
   * Remove tracks from queue
   * @param startingIndex - Starting position (1-based)
   * @param numberOfTracks - Number of tracks to remove
   * @returns SOAP response
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async removeTrackRangeFromQueue(startingIndex: number, numberOfTracks: number): Promise<any> {
    return this.soap('AVTransport', 'RemoveTrackRangeFromQueue', {
      InstanceID: 0,
      UpdateID: 0,
      StartingIndex: startingIndex,
      NumberOfTracks: numberOfTracks
    });
  }

  /**
   * Reorder tracks in queue
   * @param startingIndex - Starting position of tracks to move (1-based)
   * @param numberOfTracks - Number of tracks to move
   * @param insertBefore - Position to insert before (1-based)
   * @returns SOAP response
   */
  async reorderTracksInQueue(
    startingIndex: number,
    numberOfTracks: number,
    insertBefore: number
  ): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.soap('AVTransport', 'ReorderTracksInQueue', {
      InstanceID: 0,
      UpdateID: 0,
      StartingIndex: startingIndex,
      NumberOfTracks: numberOfTracks,
      InsertBefore: insertBefore
    });
  }

  /**
   * Save current queue as a Sonos playlist
   * @param title - Playlist title
   * @returns SOAP response with assigned object ID
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async saveQueue(title: string): Promise<any> {
    return this.soap('AVTransport', 'SaveQueue', {
      InstanceID: 0,
      Title: title,
      ObjectID: ''
    });
  }

  // RenderingControl extended methods
  /**
   * Get bass level
   * @returns SOAP response with CurrentBass value
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getBass(): Promise<any> {
    return this.soap('RenderingControl', 'GetBass', {
      InstanceID: 0,
      Channel: 'Master'
    });
  }

  /**
   * Set bass level
   * @param level - Bass level (-10 to +10)
   * @returns SOAP response
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async setBass(level: number): Promise<any> {
    return this.soap('RenderingControl', 'SetBass', {
      InstanceID: 0,
      DesiredBass: Math.max(-10, Math.min(10, level))
    });
  }

  /**
   * Get treble level
   * @returns SOAP response with CurrentTreble value
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getTreble(): Promise<any> {
    return this.soap('RenderingControl', 'GetTreble', {
      InstanceID: 0,
      Channel: 'Master'
    });
  }

  /**
   * Set treble level
   * @param level - Treble level (-10 to +10)
   * @returns SOAP response
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async setTreble(level: number): Promise<any> {
    return this.soap('RenderingControl', 'SetTreble', {
      InstanceID: 0,
      DesiredTreble: Math.max(-10, Math.min(10, level))
    });
  }

  /**
   * Get loudness setting
   * @returns SOAP response with CurrentLoudness value
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getLoudness(): Promise<any> {
    return this.soap('RenderingControl', 'GetLoudness', {
      InstanceID: 0,
      Channel: 'Master'
    });
  }

  /**
   * Set loudness on/off
   * @param enabled - Whether loudness is enabled
   * @returns SOAP response
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async setLoudness(enabled: boolean): Promise<any> {
    return this.soap('RenderingControl', 'SetLoudness', {
      InstanceID: 0,
      Channel: 'Master',
      DesiredLoudness: enabled ? 1 : 0
    });
  }

  // MusicServices methods
  /**
   * List available music services
   * @returns SOAP response with AvailableServiceDescriptorList
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async listAvailableServices(): Promise<any> {
    // Note: MusicServices doesn't have a pre-defined service constant
    // We need to make a direct SOAP call
    const url = `${this.baseUrl}/MusicServices/Control`;
    return soapRequest(url, 'urn:schemas-upnp-org:service:MusicServices:1', 'ListAvailableServices', {});
  }

}