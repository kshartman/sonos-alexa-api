import { EventEmitter } from 'events';
import { XMLParser } from 'fast-xml-parser';
import logger from './utils/logger.js';
import { soapRequest } from './utils/soap.js';
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
  public state: SonosState;
  
  private xmlParser: XMLParser;
  private stateInterval?: NodeJS.Timeout;

  constructor(deviceInfo: DeviceInfo, location: string) {
    super();
    
    this.id = deviceInfo.device.UDN;
    this.modelName = deviceInfo.device.modelName;
    this.modelNumber = deviceInfo.device.modelNumber;
    this.roomName = deviceInfo.device.roomName || 'Unknown Room';
    this.location = location;
    
    const url = new URL(location);
    this.baseUrl = `http://${url.hostname}:${url.port}`;
    
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
    // In a full implementation, we would set up event subscriptions here
    // For now, we'll poll for state changes
    await this.updateState();
    
    this.stateInterval = setInterval(() => this.updateState(), 5000);
  }

  unsubscribe(): void {
    if (this.stateInterval) {
      clearInterval(this.stateInterval);
      this.stateInterval = undefined;
    }
  }

  private async updateState(): Promise<void> {
    try {
      const [transportInfo, volume, mute, positionInfo] = await Promise.all([
        this.getTransportInfo(),
        this.getVolume(),
        this.getMute(),
        this.getPositionInfo()
      ]);

      const newState: SonosState = {
        playbackState: transportInfo.CurrentTransportState as SonosState['playbackState'],
        volume: parseInt(volume.CurrentVolume, 10),
        mute: mute.CurrentMute === '1',
        currentTrack: this.parseTrackInfo(positionInfo)
      };

      // Check for state changes (excluding coordinator for comparison)
      const oldStateForComparison = { ...this.state };
      delete (oldStateForComparison as any).coordinator;
      
      if (JSON.stringify(newState) !== JSON.stringify(oldStateForComparison)) {
        this.state = { ...this.state, ...newState };
        this.emit('state-change', this.state);
      }
    } catch (error) {
      logger.error(`Error updating state for ${this.roomName}:`, error);
    }
  }

  private parseTrackInfo(positionInfo: any): SonosTrack | null {
    if (!positionInfo.TrackMetaData || positionInfo.TrackMetaData === 'NOT_IMPLEMENTED') {
      return null;
    }

    try {
      const metadata = this.xmlParser.parse(positionInfo.TrackMetaData);
      const item = metadata['DIDL-Lite']?.item;
      
      if (!item) return null;

      return {
        title: item['dc:title'] || 'Unknown',
        artist: item['dc:creator'] || item['r:albumArtist'] || 'Unknown Artist',
        album: item['upnp:album'] || '',
        duration: positionInfo.TrackDuration,
        position: positionInfo.RelTime,
        uri: positionInfo.TrackURI,
        albumArtURI: item['upnp:albumArtURI']
      };
    } catch (error) {
      logger.error('Error parsing track metadata:', error);
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
      // This would be implemented as a delayed pause
    }
    
    // Favorites should already be resolved at load time
    // playUri handles all the group management internally
    await this.playUri(preset.uri, preset.metadata || '', discovery);
    
    // Handle playMode settings
    if (legacyData?.playMode) {
      logger.debug('Legacy preset playMode settings:', legacyData.playMode);
      // These would need to be implemented via additional SOAP calls
      // For now, we'll just log them
    }
  }

  private async pauseOtherZones(discovery: any): Promise<void> {
    try {
      const allDevices = discovery.getAllDevices();
      const pausePromises = allDevices
        .filter((device: SonosDevice) => device.id !== this.id)
        .filter((device: SonosDevice) => discovery.isCoordinator(device.id))
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

  async getQueue(startIndex = 0, limit = 100): Promise<BrowseResult> {
    logger.debug(`${this.roomName}: getting queue items from ${startIndex}, limit ${limit}`);
    return this.browse('Q:0', startIndex, limit);
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
      newMode = enabled ? 'SHUFFLE_REPEAT_ONE' : 'REPEAT_ONE';
    } else if (transportSettings.PlayMode?.includes('REPEAT')) {
      newMode = enabled ? 'SHUFFLE' : 'REPEAT_ALL';
    } else {
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

  async playLineIn(sourceRoomName: string): Promise<void> {
    logger.debug(`${this.roomName}: playing line-in from ${sourceRoomName}`);
    
    // Need to find the UUID of the source room
    // For now, just use the room name in the URI
    const lineInUri = `x-rincon-stream:${sourceRoomName}`;
    
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
}