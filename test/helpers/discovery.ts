import { SystemTopology, Zone, defaultConfig } from './test-config.js';
import { testLog } from './test-logger-init.js';

/**
 * Discover the Sonos system topology and available features
 */
export async function discoverSystem(): Promise<SystemTopology> {
  try {
    // Get zones
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    if (!zonesResponse.ok) {
      throw new Error(`Failed to get zones: ${zonesResponse.statusText}`);
    }
    const zones = await zonesResponse.json() as Zone[];
    
    // Give time for UPnP subscriptions to be established
    // This is critical for event-driven tests to work properly
    testLog.info('⏳ Waiting for UPnP event subscriptions to establish...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Extract unique rooms
    const roomSet = new Set<string>();
    zones.forEach(zone => {
      zone.members.forEach(member => {
        roomSet.add(member.roomName);
      });
    });
    const rooms = Array.from(roomSet).sort();

    // Detect features
    const hasGroups = zones.some(zone => zone.members.length > 1);
    
    // Detect stereo pairs by counting room name occurrences across all zones
    const roomCounts = new Map<string, number>();
    zones.forEach(zone => {
      zone.members.forEach(member => {
        roomCounts.set(member.roomName, (roomCounts.get(member.roomName) || 0) + 1);
      });
    });
    
    // Stereo pairs are rooms that appear exactly twice
    const stereoPairs = Array.from(roomCounts.entries())
      .filter(([_, count]) => count === 2)
      .map(([roomName, _]) => roomName);
    
    const hasStereoPairs = stereoPairs.length > 0;

    // Discover available services
    const availableServices = await discoverMusicServices(zones[0]?.coordinator || rooms[0]);

    // Get defaults (room and service)
    let defaultRoom: string | undefined;
    let defaultService: string | undefined;
    try {
      const defaultsResponse = await fetch(`${defaultConfig.apiUrl}/default`);
      if (defaultsResponse.ok) {
        const defaults = await defaultsResponse.json();
        defaultRoom = defaults.room;
        defaultService = defaults.musicService;
      }
    } catch {}

    // Get presets count
    let presetCount = 0;
    try {
      const presetsResponse = await fetch(`${defaultConfig.apiUrl}/presets`);
      if (presetsResponse.ok) {
        const presets = await presetsResponse.json();
        presetCount = Object.keys(presets.all || {}).length;
      }
    } catch {}

    return {
      zones,
      rooms,
      hasGroups,
      hasStereoPairs,
      stereoPairs,
      availableServices,
      defaultRoom,
      defaultService,
      presetCount
    };
  } catch (error) {
    testLog.error('Failed to discover system:', error);
    throw error;
  }
}

/**
 * Discover which music services are available
 */
async function discoverMusicServices(testRoom: string): Promise<string[]> {
  const services: string[] = [];
  
  // Always available
  services.push('library');
  
  // Check if Apple Music works (it should if configured in Sonos)
  try {
    // Use a safe search query that won't return inappropriate content
    const query = encodeURIComponent('track:Yesterday artist:The Beatles');
    const response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/musicsearch/apple/song/${query}`);
    if (response.status !== 501) {
      services.push('apple');
      // Pause immediately to avoid playing during discovery
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/pause`);
    }
  } catch {}

  // Check if Pandora is configured
  try {
    const settingsPath = new URL('../../settings.json', import.meta.url);
    const settings = await import(settingsPath.pathname, { assert: { type: 'json' } });
    if (settings.default?.pandora?.username) {
      services.push('pandora');
    }
  } catch {}

  return services;
}

/**
 * Make a room safe for testing by ungrouping and stopping playback
 */
async function makeRoomSafe(room: string): Promise<void> {
  try {
    // Check if room is in a group
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    if (zonesResponse.ok) {
      const zones = await zonesResponse.json() as Zone[];
      const roomZone = zones.find(z => z.members.some(m => m.roomName === room));
      
      if (roomZone && roomZone.members.length > 1) {
        // Check if it's just a stereo pair
        const uniqueRoomNames = new Set(roomZone.members.map(m => m.roomName));
        const isJustStereoPair = uniqueRoomNames.size === 1 && roomZone.members.length === 2;
        
        if (!isJustStereoPair) {
          testLog.info(`   Ungrouping ${room} from its current group...`);
          const leaveResponse = await fetch(`${defaultConfig.apiUrl}/${room}/leave`);
          if (leaveResponse.ok) {
            testLog.info(`   ✓ ${room} left its group`);
            // Wait for ungrouping to complete
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
    }
    
    // Stop playback if playing
    const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
    if (stateResponse.ok) {
      const state = await stateResponse.json();
      if (state.playbackState === 'PLAYING') {
        testLog.info(`   Stopping playback on ${room}...`);
        const stopResponse = await fetch(`${defaultConfig.apiUrl}/${room}/stop`);
        if (stopResponse.ok) {
          testLog.info(`   ✓ Stopped playback on ${room}`);
          // Wait for stop to complete
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  } catch (error) {
    testLog.info(`   ⚠️  Error making ${room} safe:`, error);
    // Continue anyway - tests may still work
  }
}

/**
 * Check if a room has content available (favorites, playlists, or music search)
 */
async function checkRoomHasContent(room: string): Promise<boolean> {
  try {
    // Check favorites
    const favResponse = await fetch(`${defaultConfig.apiUrl}/${room}/favorites`);
    if (favResponse.ok) {
      const favorites = await favResponse.json();
      if (favorites.length > 0) {
        return true; // Has favorites
      }
    }
    
    // Check playlists
    const playlistResponse = await fetch(`${defaultConfig.apiUrl}/${room}/playlists`);
    if (playlistResponse.ok) {
      const playlists = await playlistResponse.json();
      if (playlists.length > 0) {
        return true; // Has playlists
      }
    }
    
    // Check if music search works (Apple Music)
    const searchQuery = encodeURIComponent('track:Yesterday artist:The Beatles');
    const searchResponse = await fetch(`${defaultConfig.apiUrl}/${room}/musicsearch/apple/song/${searchQuery}`);
    if (searchResponse.ok) {
      return true; // Music search works
    }
    
    return false; // No content available
  } catch {
    return false; // Error checking content
  }
}

/**
 * Get a safe test room (prefer non-grouped, non-playing room with content available)
 */
export async function getSafeTestRoom(topology: SystemTopology): Promise<string> {
  // Check if TEST_ROOM environment variable is set and not empty
  if (process.env.TEST_ROOM && process.env.TEST_ROOM.trim()) {
    const configuredRoom = process.env.TEST_ROOM.trim();
    
    // Verify the room exists in the topology
    if (topology.rooms.includes(configuredRoom)) {
      testLog.info(`✅ Using configured test room: ${configuredRoom} (from TEST_ROOM env)`);
      await makeRoomSafe(configuredRoom);
      return configuredRoom;
    } else {
      testLog.info(`⚠️  Configured TEST_ROOM '${configuredRoom}' not found in topology, falling back to auto-selection`);
    }
  }
  
  // If TEST_ROOM is empty or not set, check for DEFAULT_ROOM from the API
  if (!process.env.TEST_ROOM || !process.env.TEST_ROOM.trim()) {
    try {
      const defaultsResponse = await fetch(`${defaultConfig.apiUrl}/default`);
      if (defaultsResponse.ok) {
        const defaults = await defaultsResponse.json();
        if (defaults.room && topology.rooms.includes(defaults.room)) {
          testLog.info(`✅ Using default room from API: ${defaults.room}`);
          await makeRoomSafe(defaults.room);
          return defaults.room;
        }
      }
    } catch (error) {
      testLog.info('⚠️  Could not fetch default room from API');
    }
  }
  
  // Try to find a standalone room that's not playing and is a coordinator with content
  for (const zone of topology.zones) {
    // Check if this is a standalone zone (single device or stereo pair)
    const uniqueRoomNames = new Set(zone.members.map(m => m.roomName));
    const isStandalone = uniqueRoomNames.size === 1;
    
    if (isStandalone) {
      const member = zone.members[0];
      const room = member.roomName;
      
      // Check if this is the coordinator (for stereo pairs, only coordinator has full services)
      if (!member.isCoordinator) {
        testLog.info(`⚠️  Skipping ${room} - not a coordinator (likely stereo pair member)`);
        continue;
      }
      
      // Skip portable devices (Roam, Move) as they lack proper services
      if (room.toLowerCase().includes('roam') || room.toLowerCase().includes('move')) {
        testLog.info(`⚠️  Skipping ${room} - portable device (lacks AVTransport/RenderingControl services)`);
        continue;
      }
      
      try {
        const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
        const state = await stateResponse.json();
        if (state.playbackState === 'PLAYING') {
          continue; // Skip playing rooms
        }
        
        // Check if room has content available
        const hasContent = await checkRoomHasContent(room);
        if (!hasContent) {
          testLog.info(`⚠️  Skipping ${room} - no content available (no favorites/playlists or music search)`);
          continue;
        }
        
        testLog.info(`✅ Selected test room: ${room} (coordinator, not playing, has content)`);
        return room;
      } catch {}
    }
  }
  
  // Try to find any coordinator that's not playing with content
  for (const zone of topology.zones) {
    const coordinator = zone.members.find(m => m.isCoordinator);
    if (coordinator) {
      // Skip portable devices
      if (coordinator.roomName.toLowerCase().includes('roam') || coordinator.roomName.toLowerCase().includes('move')) {
        continue;
      }
      
      try {
        const stateResponse = await fetch(`${defaultConfig.apiUrl}/${coordinator.roomName}/state`);
        const state = await stateResponse.json();
        if (state.playbackState === 'PLAYING') {
          continue;
        }
        
        // Check content availability
        const hasContent = await checkRoomHasContent(coordinator.roomName);
        if (!hasContent) {
          testLog.info(`⚠️  Skipping ${coordinator.roomName} - no content available`);
          continue;
        }
        
        testLog.info(`✅ Selected test room: ${coordinator.roomName} (coordinator in group, not playing, has content)`);
        return coordinator.roomName;
      } catch {}
    }
  }
  
  // Last resort: use the first coordinator with content we can find
  for (const zone of topology.zones) {
    const coordinator = zone.members.find(m => m.isCoordinator);
    if (coordinator) {
      const hasContent = await checkRoomHasContent(coordinator.roomName);
      if (hasContent) {
        testLog.info(`⚠️  Using coordinator as test room (may be playing): ${coordinator.roomName}`);
        return coordinator.roomName;
      }
    }
  }
  
  // Absolute fallback to first room with content
  for (const room of topology.rooms) {
    const hasContent = await checkRoomHasContent(room);
    if (hasContent) {
      testLog.info(`⚠️  WARNING: Using ${room} - may not be optimal for testing!`);
      return room;
    }
  }
  
  // No rooms with content available
  throw new Error('No Sonos rooms found with content available (favorites, playlists, or music search)');
}

/**
 * Get the coordinator device ID for a room.
 * For stereo pairs, this ensures we track events from the coordinator device.
 * 
 * @param room - The room name
 * @returns The coordinator's device ID for the room
 */
export async function getCoordinatorDeviceId(room: string): Promise<string> {
  const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
  if (!zonesResponse.ok) {
    throw new Error(`Failed to fetch zones: ${zonesResponse.statusText}`);
  }
  
  const zones = await zonesResponse.json() as Zone[];
  
  // Find the zone containing this room
  const zone = zones.find(z => z.members.some(m => m.roomName === room));
  if (!zone) {
    throw new Error(`Room '${room}' not found in any zone`);
  }
  
  // Find the coordinator for this zone
  const coordinator = zone.members.find(m => m.isCoordinator);
  if (!coordinator) {
    throw new Error(`No coordinator found for zone containing room '${room}'`);
  }
  
  // If this is a stereo pair and the requested room is the coordinator, return its ID
  // Otherwise return the coordinator's ID (which handles grouped speakers too)
  if (coordinator.roomName === room) {
    return coordinator.id;
  }
  
  // For stereo pairs where we asked for the non-coordinator member,
  // we still need to return the coordinator's ID
  const roomMembers = zone.members.filter(m => m.roomName === room);
  if (roomMembers.length === 2) {
    // This is a stereo pair room
    testLog.info(`   Note: ${room} is a stereo pair, using coordinator device ID`);
  }
  
  return coordinator.id;
}

/**
 * Check if a specific service is available
 */
export function isServiceAvailable(topology: SystemTopology, service: string): boolean {
  return topology.availableServices.includes(service);
}

/**
 * Ungroup all speakers to put system in known state
 */
export async function ungroupAllSpeakers(): Promise<void> {
  testLog.info('🔧 Putting system into known state (all speakers standalone)...');
  
  // Get current zones
  const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
  const zones = await zonesResponse.json() as Zone[];
  
  // Find all grouped zones that can be ungrouped
  const groupedZones = zones.filter(zone => zone.members.length > 1);
  
  if (groupedZones.length === 0) {
    testLog.info('   ✓ No groups to ungroup');
    return;
  }
  
  testLog.info(`   Ungrouping ${groupedZones.length} groups...`);
  
  // Ungroup each zone by having all non-coordinator members leave
  for (const zone of groupedZones) {
    // Check if this is a pure stereo pair (only 2 members with same room name)
    // Pure stereo pairs cannot be broken, but stereo pairs in larger groups can leave
    const uniqueRoomNames = new Set(zone.members.map(m => m.roomName));
    if (uniqueRoomNames.size === 1 && zone.members.length === 2) {
      // Skip silently - this is expected behavior
      continue;
    }
    
    // Simple approach: just make all non-coordinator members leave
    // The coordinator (whether stereo pair or standalone) stays
    const processedRooms = new Set<string>();
    
    for (const member of zone.members) {
      // Skip the coordinator and any room we've already processed
      if (!member.isCoordinator && !processedRooms.has(member.roomName)) {
        const membersWithSameRoom = zone.members.filter(m => m.roomName === member.roomName);
        
        if (membersWithSameRoom.length > 1) {
          testLog.info(`   Removing ${member.roomName} (stereo pair) from group`);
          // Mark all instances as processed so we don't try twice
          membersWithSameRoom.forEach(m => processedRooms.add(m.roomName));
        } else {
          testLog.info(`   Removing ${member.roomName} from group`);
          processedRooms.add(member.roomName);
        }
        
        try {
          const response = await fetch(`${defaultConfig.apiUrl}/${member.roomName}/leave`);
          if (response.ok) {
            testLog.info(`   ✓ ${member.roomName} left group`);
          } else {
            const errorText = await response.text();
            testLog.info(`   ✗ Failed to remove ${member.roomName}: ${response.status}`);
            // Don't log full error text, it's too verbose
          }
        } catch (e) {
          testLog.info(`   ✗ Error removing ${member.roomName}:`, e);
        }
      }
    }
  }
  
  // Wait for ungrouping to complete
  testLog.info('   Waiting for ungrouping to complete...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Verify all speakers are standalone (except stereo pairs)
  const verifyResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
  const verifyZones = await verifyResponse.json() as Zone[];
  const stillGrouped = verifyZones.filter(zone => {
    // Check if it's a stereo pair
    const uniqueRoomNames = new Set(zone.members.map(m => m.roomName));
    const isStereoPair = uniqueRoomNames.size === 1 && zone.members.length === 2;
    return zone.members.length > 1 && !isStereoPair;
  });
  
  if (stillGrouped.length > 0) {
    const groupDetails = stillGrouped.map(zone => {
      const memberNames = zone.members.map(m => m.roomName).join(', ');
      return `[${memberNames}]`;
    }).join(', ');
    testLog.info(`   ⚠️  ${stillGrouped.length} non-stereo groups still exist after ungrouping: ${groupDetails}`);
  } else {
    testLog.info('   All speakers are now standalone (stereo pairs preserved)');
  }
}