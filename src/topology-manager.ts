import { EventEmitter } from 'events';
import { XMLParser } from 'fast-xml-parser';
import { debugManager } from './utils/debug-manager.js';
import type { SonosDevice } from './sonos-device.js';

export interface ZoneGroup {
  id: string;
  coordinator: SonosDevice;
  members: SonosDevice[];
  coordinatorUuid: string;
  memberDetails?: Array<{uuid: string, roomName: string, channelMapSet?: string}>;
}

export interface TopologyChangeEvent {
  zones: ZoneGroup[];
  timestamp: number;
}

export declare interface TopologyManager {
  on(event: 'topology-change', listener: (event: TopologyChangeEvent) => void): this;
}

export class TopologyManager extends EventEmitter {
  private zones: ZoneGroup[] = [];
  public xmlParser: XMLParser;
  private deviceMap = new Map<string, SonosDevice>();

  constructor() {
    super();
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: false,
      trimValues: true
    });
  }

  setDeviceMap(deviceMap: Map<string, SonosDevice>): void {
    this.deviceMap = deviceMap;
  }

  handleTopologyEvent(deviceId: string, service: string, body: string): void {
    if (!service.includes('ZoneGroupTopology')) {
      return;
    }

    try {
      const device = this.deviceMap.get(deviceId);
      const deviceName = device ? device.roomName : 'unknown';
      debugManager.info('topology', `Processing topology event from ${deviceName} (${deviceId}), body length: ${body.length}`);
      debugManager.wall('upnp', `Topology event body: ${body}`);
      
      // Parse the UPnP event XML or JSON
      let parsed;
      if (body.trim().startsWith('{')) {
        // It's JSON from our SOAP request
        parsed = JSON.parse(body);
      } else {
        // It's XML from real UPnP events
        parsed = this.xmlParser.parse(body);
      }
      debugManager.wall('upnp', 'UPnP event parsed structure:', JSON.stringify(parsed, null, 2));
      
      const propertySet = parsed['e:propertyset'];
      
      if (!propertySet) {
        debugManager.warn('topology', 'No e:propertyset in UPnP event');
        return;
      }
      
      if (!propertySet['e:property']) {
        debugManager.warn('topology', 'No e:property in propertyset');
        return;
      }

      const properties = Array.isArray(propertySet['e:property']) 
        ? propertySet['e:property'] 
        : [propertySet['e:property']];

      debugManager.debug('topology', `Processing ${properties.length} properties`);
      
      for (const property of properties) {
        debugManager.wall('upnp', 'Property content:', JSON.stringify(property, null, 2));
        if (property.ZoneGroupState) {
          debugManager.debug('topology', 'Found ZoneGroupState property, processing...');
          this.processZoneGroupState(property.ZoneGroupState);
        } else {
          debugManager.debug('topology', 'Property does not contain ZoneGroupState');
        }
      }
    } catch (error) {
      debugManager.error('topology', 'Error processing topology event:', error);
    }
  }

  private processZoneGroupState(zoneGroupStateData: any): void {
    try {
      debugManager.debug('topology', 'Processing ZoneGroupState data');
      debugManager.debug('upnp', 'ZoneGroupState data type:', typeof zoneGroupStateData);
      debugManager.wall('upnp', 'ZoneGroupState data:', JSON.stringify(zoneGroupStateData, null, 2));
      
      // If it's a string, parse it. If it's already an object, use it directly
      let parsed;
      if (typeof zoneGroupStateData === 'string') {
        debugManager.debug('topology', 'Parsing ZoneGroupState XML string');
        parsed = this.xmlParser.parse(zoneGroupStateData);
      } else {
        debugManager.debug('topology', 'Using ZoneGroupState as object');
        parsed = { ZoneGroupState: zoneGroupStateData };
      }
      
      const zoneGroupState = parsed.ZoneGroupState;
      
      if (!zoneGroupState) {
        debugManager.warn('topology', 'No ZoneGroupState in parsed XML');
        return;
      }
      
      if (!zoneGroupState.ZoneGroups) {
        debugManager.warn('topology', 'No ZoneGroups in ZoneGroupState');
        debugManager.debug('topology', 'ZoneGroupState content:', JSON.stringify(zoneGroupState, null, 2));
        return;
      }

      const zoneGroups = zoneGroupState.ZoneGroups.ZoneGroup;
      debugManager.wall('upnp', 'Found ZoneGroups:', JSON.stringify(zoneGroups, null, 2));
      
      const groups = Array.isArray(zoneGroups) ? zoneGroups : [zoneGroups];
      debugManager.debug('topology', `Processing ${groups.length} zone groups`);
      
      const newZones: ZoneGroup[] = [];

      for (const group of groups) {
        if (!group || !group['@_Coordinator']) {
          debugManager.debug('topology', 'Skipping group without coordinator:', group);
          continue;
        }

        const coordinatorUuid = group['@_Coordinator'];
        const groupId = group['@_ID'] || coordinatorUuid;
        
        // Parse zone group members
        const members = this.parseZoneGroupMembers(group.ZoneGroupMember);
        
        // Find coordinator device - try both with and without uuid: prefix
        let coordinator = this.deviceMap.get(coordinatorUuid);
        if (!coordinator) {
          coordinator = this.deviceMap.get(`uuid:${coordinatorUuid}`);
        }
        if (!coordinator) {
          debugManager.debug('topology', `Coordinator ${coordinatorUuid} not found in device map`);
          continue;
        }

        // Filter members to only include devices we know about
        const knownMembers = members.filter(member => {
          let device = this.deviceMap.get(member.uuid);
          if (!device) {
            device = this.deviceMap.get(`uuid:${member.uuid}`);
          }
          if (device) {
            // Update device's coordinator reference
            (device.state as any).coordinator = coordinator;
            return true;
          }
          return false;
        }).map(member => {
          let device = this.deviceMap.get(member.uuid);
          if (!device) {
            device = this.deviceMap.get(`uuid:${member.uuid}`);
          }
          return device!;
        });

        // Ensure coordinator is in the members list
        if (!knownMembers.find(m => m.id === coordinator.id)) {
          knownMembers.unshift(coordinator);
        }

        // Update coordinator's state
        (coordinator.state as any).coordinator = coordinator;

        const zone: ZoneGroup = {
          id: groupId,
          coordinator,
          members: knownMembers,
          coordinatorUuid,
          memberDetails: members
        };

        newZones.push(zone);
        debugManager.debug('topology', `Zone group: ${zone.id}, coordinator: ${coordinator.roomName}, members: ${knownMembers.length}`);
      }

      // Update zones and emit event
      this.zones = newZones;
      this.emit('topology-change', {
        zones: this.zones,
        timestamp: Date.now()
      });

      debugManager.info('topology', `Topology updated: ${newZones.length} zones`);
    } catch (error) {
      debugManager.error('topology', 'Error processing ZoneGroupState:', error);
    }
  }

  private parseZoneGroupMembers(zoneGroupMembers: any): Array<{uuid: string, roomName: string, channelMapSet?: string}> {
    if (!zoneGroupMembers) {
      return [];
    }

    const members = Array.isArray(zoneGroupMembers) ? zoneGroupMembers : [zoneGroupMembers];
    
    return members.map(member => ({
      uuid: member['@_UUID'],
      roomName: member['@_ZoneName'],
      channelMapSet: member['@_ChannelMapSet']
    })).filter(member => member.uuid && member.roomName);
  }

  getZones(): ZoneGroup[] {
    return [...this.zones];
  }

  getZoneForDevice(deviceId: string): ZoneGroup | undefined {
    return this.zones.find(zone => 
      zone.members.some(member => member.id === deviceId)
    );
  }

  isCoordinator(deviceId: string): boolean {
    const zone = this.getZoneForDevice(deviceId);
    return zone?.coordinator.id === deviceId;
  }

  getCoordinator(deviceId: string): SonosDevice | undefined {
    const zone = this.getZoneForDevice(deviceId);
    return zone?.coordinator;
  }

  getGroupMembers(deviceId: string): SonosDevice[] {
    const zone = this.getZoneForDevice(deviceId);
    return zone?.members || [];
  }

  getStereoPairPrimary(roomName: string): string | undefined {
    // Find the zone that contains this room
    for (const zone of this.zones) {
      const membersInRoom = zone.memberDetails?.filter(m => m.roomName === roomName) || [];
      
      // If we have multiple members with same room name, it's a stereo pair
      if (membersInRoom.length > 1) {
        // Look for the UUID that appears before :LF in any member's channelMapSet
        for (const member of membersInRoom) {
          if (member.channelMapSet) {
            // ChannelMapSet format: "UUID1:LF,LF;UUID2:RF,RF"
            // The UUID before :LF is the primary (left) speaker
            const match = member.channelMapSet.match(/(\w+):LF/);
            if (match && match[1]) {
              const primaryUuid = match[1];
              debugManager.debug('topology', `Found stereo pair primary for ${roomName}: ${primaryUuid} from channelMapSet: ${member.channelMapSet}`);
              return primaryUuid;
            }
          }
        }
      }
    }
    
    return undefined;
  }
}