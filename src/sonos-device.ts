import { EventEmitter } from 'events';
import { XMLParser } from 'fast-xml-parser';
import logger from './utils/logger.js';
import { soapRequest } from './utils/soap.js';
import { EventManager } from './utils/event-manager.js';
import type { DeviceInfo, SonosState, SonosTrack, SonosService, Preset, BrowseResult, BrowseItem } from './types/sonos.js';

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

  constructor(deviceInfo: DeviceInfo, location: string) {
    super();
    
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

  async subscribe(): Promise<void> {
    const discovery = (global as any).discovery;
    if (!discovery || !discovery.subscriber) {
      throw new Error(`${this.roomName}: No UPnP subscriber available - cannot use events`);
    }

    try {
      // Check if this device is part of a stereo pair or group
      // If so, we should subscribe to the coordinator instead
      const coordinator = discovery.getCoordinator ? discovery.getCoordinator(this.id) : null;
      let targetDevice = this; // eslint-disable-line @typescript-eslint/no-this-alias
      let targetBaseUrl = this.baseUrl;
      
      if (coordinator && coordinator.id !== this.id) {
        logger.info(`${this.roomName}: This device is part of a stereo pair/group. Using coordinator ${coordinator.roomName} for subscriptions.`);
        targetDevice = coordinator;
        targetBaseUrl = coordinator.baseUrl;
      }
      
      // Discover available services from the target device
      const services = await targetDevice.discoverServices();
      logger.info(`${targetDevice.roomName}: Found ${services.length} services from device description`);
      
      // Log all discovered services
      services.forEach(service => {
        logger.info(`${targetDevice.roomName}: Service: ${service.serviceType}, EventURL: ${service.eventSubURL}`);
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
            await discovery.subscriber.subscribe(targetBaseUrl, eventUrl, this.id);
            logger.info(`${this.roomName}: Successfully subscribed to ${serviceName} at ${eventUrl} via ${targetDevice.roomName}`);
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
        logger.info(`${this.roomName}: This is a stereo pair member. Events will be handled by coordinator ${coordinator.roomName}.`);
        // For stereo pair members, we don't need to throw an error - they get events from their coordinator
        return;
      } else if (subscribedCount === 0) {
        throw new Error(`${this.roomName}: Failed to subscribe to any UPnP events`);
      }
      
      logger.info(`${this.roomName}: Subscribed to ${subscribedCount} UPnP event services`);
      
      // Get initial state
      await this.updateState();
    } catch (error) {
      logger.error(`${this.roomName}: Critical error in UPnP subscription:`, error);
      throw error; // Don't fall back to polling - fail fast
    }
  }

  async discoverServices(): Promise<any[]> {
    const deviceDescUrl = `${this.baseUrl}/xml/device_description.xml`;
    
    const response = await fetch(deviceDescUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch device description: ${response.status}`);
    }
    
    const xml = await response.text();
    const parsed = this.xmlParser.parse(xml);
    
    const services: any[] = [];
    
    // Helper function to extract services from a device
    const extractServices = (device: any) => {
      if (device?.serviceList?.service) {
        const serviceList = Array.isArray(device.serviceList.service) 
          ? device.serviceList.service 
          : [device.serviceList.service];
        
        for (const service of serviceList) {
          services.push({
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
    
    return services;
  }

  unsubscribe(): void {
    // TODO: Properly unsubscribe from UPnP events
    const discovery = (global as any).discovery;
    if (discovery && discovery.subscriber) {
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
      const oldStateForComparison = { ...this.state };
      delete (oldStateForComparison as any).coordinator;
      
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

  private parseTrackInfo(positionInfo: any): SonosTrack | null {
    if (!positionInfo.TrackMetaData || positionInfo.TrackMetaData === 'NOT_IMPLEMENTED') {
      logger.debug(`${this.roomName}: No track metadata available (TrackMetaData: ${positionInfo.TrackMetaData})`);
      return null;
    }

    try {
      const metadata = this.xmlParser.parse(positionInfo.TrackMetaData);
      logger.debug(`${this.roomName}: Parsed metadata:`, JSON.stringify(metadata, null, 2).substring(0, 500) + '...');
      
      const item = metadata['DIDL-Lite']?.item;
      
      if (!item) {
        logger.debug(`${this.roomName}: No item found in DIDL-Lite metadata`);
        return null;
      }

      // Determine track type based on URI
      let type = 'track';
      let stationName = '';
      
      if (positionInfo.TrackURI) {
        if (positionInfo.TrackURI.includes('x-sonosapi-radio:') || 
            positionInfo.TrackURI.includes('x-sonosapi-stream:') ||
            positionInfo.TrackURI.includes('x-rincon-mp3radio:')) {
          type = 'radio';
          // Extract station name from StreamContent if available
          if (item['r:streamContent']) {
            stationName = item['r:streamContent'];
          } else if (item['dc:title'] && !item['dc:creator']) {
            // Sometimes radio stations put station name in title
            stationName = item['dc:title'];
          }
        } else if (positionInfo.TrackURI.includes('x-rincon-stream:')) {
          type = 'line_in';
        }
      }
      
      // Convert duration to seconds
      let durationSeconds = 0;
      if (positionInfo.TrackDuration && positionInfo.TrackDuration !== 'NOT_IMPLEMENTED') {
        const durationParts = positionInfo.TrackDuration.split(':');
        durationSeconds = parseInt(durationParts[0]) * 3600 + 
                         parseInt(durationParts[1]) * 60 + 
                         parseInt(durationParts[2]);
      }
      
      const track: SonosTrack = {
        artist: item['dc:creator'] || item['r:albumArtist'] || '',
        title: item['dc:title'] || '',
        album: item['upnp:album'] || '',
        albumArtUri: item['upnp:albumArtURI'] || '',
        duration: durationSeconds,
        uri: positionInfo.TrackURI || '',
        trackUri: positionInfo.TrackURI || '',  // Legacy compatibility
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

  async soap(service: string, action: string, body: Record<string, any> = {}): Promise<any> {
    const serviceInfo = SERVICES[service];
    if (!serviceInfo) {
      throw new Error(`Unknown service: ${service}`);
    }

    const url = `${this.baseUrl}${serviceInfo.controlURL}`;
    return soapRequest(url, serviceInfo.serviceType, action, body);
  }

  // AVTransport actions
  async play(): Promise<void> {
    await this.soap('AVTransport', 'Play', {
      InstanceID: 0,
      Speed: 1
    });
  }

  async pause(): Promise<void> {
    await this.soap('AVTransport', 'Pause', {
      InstanceID: 0
    });
  }

  async stop(): Promise<void> {
    await this.soap('AVTransport', 'Stop', {
      InstanceID: 0
    });
  }

  async next(): Promise<void> {
    await this.soap('AVTransport', 'Next', {
      InstanceID: 0
    });
  }

  async previous(): Promise<void> {
    await this.soap('AVTransport', 'Previous', {
      InstanceID: 0
    });
  }

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

  async setAVTransportURI(uri: string, metadata = ''): Promise<void> {
    await this.soap('AVTransport', 'SetAVTransportURI', {
      InstanceID: 0,
      CurrentURI: uri,
      CurrentURIMetaData: metadata
    });
  }

  async getTransportInfo(): Promise<any> {
    return this.soap('AVTransport', 'GetTransportInfo', {
      InstanceID: 0
    });
  }

  async getPositionInfo(): Promise<any> {
    return this.soap('AVTransport', 'GetPositionInfo', {
      InstanceID: 0
    });
  }

  async getTransportSettings(): Promise<any> {
    return this.soap('AVTransport', 'GetTransportSettings', {
      InstanceID: 0
    });
  }

  async getCrossfadeMode(): Promise<any> {
    return this.soap('AVTransport', 'GetCrossfadeMode', {
      InstanceID: 0
    });
  }

  // RenderingControl actions
  async setVolume(level: number): Promise<void> {
    const clampedLevel = Math.max(0, Math.min(100, level));
    await this.soap('RenderingControl', 'SetVolume', {
      InstanceID: 0,
      Channel: 'Master',
      DesiredVolume: clampedLevel
    });
  }

  async getVolume(): Promise<any> {
    return this.soap('RenderingControl', 'GetVolume', {
      InstanceID: 0,
      Channel: 'Master'
    });
  }

  async setMute(mute: boolean): Promise<void> {
    await this.soap('RenderingControl', 'SetMute', {
      InstanceID: 0,
      Channel: 'Master',
      DesiredMute: mute ? 1 : 0
    });
  }

  async getMute(): Promise<any> {
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
  async playUri(uri: string, metadata = '', discovery?: any): Promise<void> {
    logger.debug(`${this.roomName}: playUri called with uri=${uri.substring(0, 50)}...`);
    
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
    
    logger.info(`${this.roomName}: hasTopologyData=${hasTopologyData}, isCoordinator=${isCurrentlyCoordinator}`);
    
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
    await this.setAVTransportURI(uri, metadata);
    
    logger.debug(`${this.roomName}: starting playback`);
    await this.play();
  }

  async playPreset(preset: Preset, discovery?: any): Promise<void> {
    // Handle legacy preset features if available
    const legacyData = (preset as any)._legacy;
    
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

  private async pauseOtherZones(discovery: any): Promise<void> {
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
    
    await this.soap('GroupRenderingControl', 'SetGroupVolume', {
      InstanceID: 0,
      DesiredVolume: clampedLevel
    });
  }

  async playLineIn(sourceDevice: SonosDevice): Promise<void> {
    logger.debug(`${this.roomName}: playing line-in from ${sourceDevice.roomName}`);
    
    // Use the source device's UUID in the URI
    const lineInUri = `x-rincon-stream:${sourceDevice.id}`;
    
    await this.setAVTransportURI(lineInUri);
    await this.play();
  }

  // Browse ContentDirectory for items
  async browse(objectId: string, startIndex = 0, limit = 100): Promise<BrowseResult> {
    const result = await this.soap('ContentDirectory', 'Browse', {
      ObjectID: objectId,
      BrowseFlag: 'BrowseDirectChildren',
      Filter: '*',
      StartingIndex: startIndex,
      RequestedCount: limit,
      SortCriteria: ''
    });

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
              metadata: result.Result // Store original DIDL-Lite for playback
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
              metadata: result.Result // Store original DIDL-Lite for playback
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

  async getQueue(limit = 100, offset = 0): Promise<any> {
    // Get queue from ContentDirectory - Q:0 is the queue ID
    const result = await this.browse('Q:0', offset, limit);
    
    // Transform the items to match legacy format
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
}