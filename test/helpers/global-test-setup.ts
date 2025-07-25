/**
 * Global test setup and teardown for integration tests
 * 
 * This module provides test lifecycle management, topology discovery,
 * event management setup, and cleanup of synthetic content.
 */

import { EventManager } from '../../src/utils/event-manager.js';
import { discoverSystem } from './discovery.js';
import { SystemTopology, defaultConfig } from './test-config.js';
import { startEventBridge, stopEventBridge } from './event-bridge.js';
import { initTestLogger, closeTestLogger, testLog } from './test-logger.js';

/**
 * Test context returned by globalTestSetup
 */
export interface TestContext {
  eventManager: EventManager;
  topology: SystemTopology;
  deviceIdMapping: Map<string, string>;
  musicsearchSongTerm: string;
  musicsearchAlbumTerm: string;
  musicsearchArtistTerm: string;
  musicsearchArtistTerms: string[];
  testRoom: string;
  testDeviceId: string;
  defaultVolume: number;
}

/**
 * Options for global test setup
 */
export interface TestSetupOptions {
  /** Ensure a song is playing in the test room */
  ensurePlaying?: boolean;
  /** Room to ensure playing in (defaults to TEST_ROOM or first available) */
  testRoom?: string;
  /** Volume to set when ensuring playback */
  playbackVolume?: number;
}

/**
 * Global test setup - called before test suites
 */
export async function globalTestSetup(testSuiteName: string, options?: TestSetupOptions): Promise<TestContext> {
  testLog.info(`\n🚀 Global test setup for: ${testSuiteName}`);
  
  // Initialize test logger if requested
  const enableLogging = process.env.TEST_LOGGING === 'true';
  const enableInteractive = process.env.TEST_INTERACTIVE === 'true';
  const logPath = process.env.TEST_LOG_PATH;
  
  if (enableLogging || enableInteractive) {
    initTestLogger(enableLogging, logPath, enableInteractive);
  }
  
  // Start event bridge first to capture all events
  testLog.info('🌉 Starting event bridge for SSE connection...');
  await startEventBridge();
  
  // Discover system topology
  testLog.info('🔍 Discovering system topology...');
  const topology = await discoverSystem();
  
  // Stop all playback to ensure clean test environment
  testLog.info('⏹️  Stopping all playback...');
  await stopAllPlayback(topology.rooms);
  
  // Set default volume if specified and calculate for return value
  let defaultVolume = 50; // default fallback
  const defaultVolumeEnv = process.env.TEST_VOLUME_DEFAULT;
  if (defaultVolumeEnv) {
    const volume = parseInt(defaultVolumeEnv);
    if (!isNaN(volume) && volume >= 0 && volume <= 100) {
      defaultVolume = volume;
      testLog.info(`🔊 Setting default volume to ${volume} for all rooms...`);
      await setVolumeForAllRooms(topology.rooms, volume);
    }
  }
  
  // Wait for system to settle
  testLog.info('⏳ Waiting for system to settle...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Initialize event manager
  testLog.info('📡 Setting up event manager...');
  const eventManager = EventManager.getInstance();
  
  // Create device ID mapping (room name -> device ID)
  const deviceIdMapping = new Map<string, string>();
  
  // Build device ID mapping from topology (room name -> coordinator device ID)
  for (const zone of topology.zones) {
    for (const member of zone.members) {
      // Only map coordinators - for stereo pairs and groups, we need the coordinator
      if (member.isCoordinator) {
        deviceIdMapping.set(member.roomName, member.id);
      }
    }
  }
  
  testLog.info(`✅ Setup complete - ${topology.rooms.length} rooms, ${topology.zones.length} zones`);
  
  // Get search terms from environment or use defaults
  const musicsearchSongTerm = process.env.TEST_MUSICSEARCH_SONG || 'love';
  const musicsearchAlbumTerm = process.env.TEST_MUSICSEARCH_ALBUM || 'greatest';
  
  // Parse artist search terms - semicolon separated list with defaults
  const defaultArtists = ['Beatles', 'Rolling Stones', 'Brian Eno'];
  let musicsearchArtistTerms: string[];
  
  if (process.env.TEST_MUSICSEARCH_ARTIST) {
    musicsearchArtistTerms = process.env.TEST_MUSICSEARCH_ARTIST
      .split(';')
      .map(artist => artist.trim())
      .filter(artist => artist.length > 0);
    
    if (musicsearchArtistTerms.length === 0) {
      testLog.warn('⚠️  TEST_MUSICSEARCH_ARTIST was empty, using defaults');
      musicsearchArtistTerms = defaultArtists;
    }
  } else {
    musicsearchArtistTerms = defaultArtists;
  }
  
  // Get the first artist term for simple use cases
  const musicsearchArtistTerm = musicsearchArtistTerms[0];
  
  if (process.env.TEST_MUSICSEARCH_SONG) {
    testLog.info(`🔍 Using custom song search term: "${musicsearchSongTerm}"`);
  }
  if (process.env.TEST_MUSICSEARCH_ALBUM) {
    testLog.info(`🔍 Using custom album search term: "${musicsearchAlbumTerm}"`);
  }
  if (process.env.TEST_MUSICSEARCH_ARTIST) {
    testLog.info(`🔍 Using custom artist search terms: ${musicsearchArtistTerms.join(', ')}`);
  }
  
  // Determine test room and device ID
  const testRoom = process.env.TEST_ROOM || topology.rooms[0];
  const testDeviceId = await getDeviceIdForRoom(testRoom);
  testLog.info(`📍 Test room: ${testRoom} (${testDeviceId})`);
  
  // Handle ensurePlaying option
  if (options?.ensurePlaying) {
    const playbackVolume = options.playbackVolume || 20;
    
    testLog.info(`🎵 Ensuring music is playing in ${testRoom}...`);
    
    // Import loadTestSong dynamically to avoid circular dependency
    const { loadTestSong } = await import('./content-loader.js');
    
    // First stop any current playback
    testLog.info(`   Stopping current playback in ${testRoom}...`);
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/stop`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Clear queue to remove any TTS content
    testLog.info(`   Clearing queue in ${testRoom}...`);
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/clearqueue`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Load and play a test song
    await loadTestSong(testRoom, true);
    
    // Set volume
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/volume/${playbackVolume}`);
    
    // Wait for playback to start
    let playing = await eventManager.waitForState(testDeviceId, 'PLAYING', 10000);
    
    // If not playing, try explicit play command
    if (!playing) {
      testLog.info(`   Playback didn't start automatically, sending explicit play command...`);
      await fetch(`${defaultConfig.apiUrl}/${testRoom}/play`);
      playing = await eventManager.waitForState(testDeviceId, 'PLAYING', 5000);
    }
    
    if (playing) {
      // Verify what's actually playing and it's not TTS
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
      const state = await stateResponse.json();
      const trackInfo = state.currentTrack?.title || state.currentTrack?.uri || 'Unknown';
      
      // Check if it's TTS content
      if (state.currentTrack?.uri?.includes('/tts/')) {
        throw new Error(`TTS content detected instead of music: ${trackInfo}`);
      }
      
      testLog.info(`✅ Music playing in ${testRoom} at volume ${playbackVolume}: ${trackInfo}`);
      
      // Pause so user can hear the music is actually playing
      testLog.info(`   Pausing 2 seconds so you can hear the music...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      throw new Error(`Failed to start playback in ${testRoom} - tests cannot proceed without music playing`);
    }
  }
  
  // Print clear separator to indicate setup is complete
  testLog.info('\n' + '═'.repeat(80));
  testLog.info('✅ GLOBAL SETUP COMPLETE - STARTING TESTS');
  testLog.info('═'.repeat(80) + '\n');
  
  // defaultVolume was already calculated above
  
  return {
    eventManager,
    topology,
    deviceIdMapping,
    musicsearchSongTerm,
    musicsearchAlbumTerm,
    musicsearchArtistTerm,
    musicsearchArtistTerms,
    testRoom,
    testDeviceId,
    defaultVolume
  };
}

/**
 * Global test teardown - called after test suites
 */
export async function globalTestTeardown(testSuiteName: string, context: TestContext): Promise<void> {
  // Print clear separator to indicate tests are complete and teardown is starting
  testLog.info('\n' + '═'.repeat(80));
  testLog.info('✅ TESTS COMPLETE - STARTING TEARDOWN');
  testLog.info('═'.repeat(80) + '\n');
  
  testLog.info(`🧹 Global test teardown for: ${testSuiteName}`);
  
  try {
    // Clear all queues to clean up test content
    testLog.info('🗑️  Clearing all queues...');
    await clearAllQueues(context.topology.rooms);
  } catch (error) {
    testLog.warn('⚠️  Warning: Failed to cleanup test content:', error);
    // Don't fail tests due to cleanup issues
  }
  
  // Clean up event manager
  if (context.eventManager) {
    // Stop the health check interval to allow process to exit
    context.eventManager.stopHealthCheck();
    
    // Remove all test listeners
    context.eventManager.removeAllListeners();
  }
  
  // Stop event bridge
  testLog.info('🌉 Stopping event bridge...');
  stopEventBridge();
  
  // Close test logger if it was initialized
  closeTestLogger();
  
  testLog.info('✅ Teardown complete');
}

/**
 * Get device ID for a room name
 * This function uses the /zones API to find the coordinator's device ID for a given room.
 * For stereo pairs, this ensures we get the coordinator device ID.
 */
export async function getDeviceIdForRoom(room: string): Promise<string> {
  try {
    const { defaultConfig } = await import('./test-config.js');
    const response = await fetch(`${defaultConfig.apiUrl}/zones`);
    if (!response.ok) {
      throw new Error(`Failed to fetch zones: ${response.statusText}`);
    }
    
    const zones = await response.json();
    
    // Find the zone containing this room
    const zone = zones.find(z => z.members.some(m => m.roomName === room));
    if (!zone) {
      throw new Error(`Room '${room}' not found in any zone`);
    }
    
    // For stereo pairs or groups, we need the coordinator's device ID
    const coordinator = zone.members.find(m => m.isCoordinator);
    if (!coordinator) {
      throw new Error(`No coordinator found for zone containing room '${room}'`);
    }
    
    // If the room is the coordinator, return its ID
    if (coordinator.roomName === room) {
      return coordinator.id;
    }
    
    // For stereo pairs where the room is not the coordinator,
    // we still return the coordinator's ID because that's where events come from
    const roomMembers = zone.members.filter(m => m.roomName === room);
    if (roomMembers.length === 2) {
      // This is a stereo pair
      testLog.info(`   Note: ${room} is part of a stereo pair, using coordinator device ID`);
      return coordinator.id;
    }
    
    // For grouped rooms, if the requested room is not the coordinator,
    // we might want to return that room's device ID for some tests
    // But for event tracking, we should use the coordinator
    testLog.info(`   Note: ${room} is in a group with coordinator ${coordinator.roomName}, using coordinator device ID`);
    return coordinator.id;
  } catch (error) {
    throw new Error(`Failed to get device ID for room '${room}': ${error}`);
  }
}

/**
 * Test-specific setup that individual tests can call
 */
export async function setupTestContent(room: string): Promise<void> {
  // No synthetic content setup needed anymore
  // Tests will use getBestTestFavorite() to find suitable existing favorites
  testLog.info(`🎯 Test content will use existing favorites in room: ${room}`);
}

/**
 * Register cleanup handlers for different test runners
 */
export function registerCleanupHandlers(): void {
  // Node.js built-in test runner
  if (typeof process !== 'undefined' && process.on) {
    process.on('exit', () => {
      testLog.info('🧹 Process exit cleanup');
    });
    
    process.on('SIGINT', async () => {
      testLog.info('\n🧹 SIGINT cleanup');
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      testLog.info('\n🧹 SIGTERM cleanup');
      process.exit(0);
    });
  }
}

// Auto-register cleanup handlers when this module is imported
registerCleanupHandlers();

/**
 * Stop playback on all rooms (ignores already stopped devices)
 */
async function stopAllPlayback(rooms: string[]): Promise<void> {
  const stopPromises = rooms.map(async (room) => {
    try {
      // First check if it's actually playing
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      if (stateResponse.ok) {
        const state = await stateResponse.json();
        if (state.playbackState === 'PLAYING') {
          const response = await fetch(`${defaultConfig.apiUrl}/${room}/pause`, {
            method: 'POST'
          });
          if (response.ok) {
            testLog.info(`   ⏸️  Stopped playback in ${room}`);
          } else {
            testLog.warn(`   Failed to stop playback in ${room}: ${response.status}`);
          }
        } else {
          testLog.info(`   ✅ ${room} already stopped (${state.playbackState})`);
        }
      }
    } catch (error) {
      testLog.warn(`   Error checking/stopping playback in ${room}:`, error.message || error);
    }
  });
  
  await Promise.allSettled(stopPromises);
}

/**
 * Set volume on all rooms
 */
async function setVolumeForAllRooms(rooms: string[], volume: number): Promise<void> {
  const volumePromises = rooms.map(async (room) => {
    try {
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/volume/${volume}`);
      if (response.ok) {
        testLog.info(`   ✅ Set volume to ${volume} in ${room}`);
      } else {
        testLog.warn(`   Failed to set volume in ${room}: ${response.status}`);
      }
    } catch (error) {
      testLog.warn(`   Error setting volume in ${room}:`, error.message || error);
    }
  });
  
  await Promise.allSettled(volumePromises);
}

/**
 * Clear queues on all rooms
 */
async function clearAllQueues(rooms: string[]): Promise<void> {
  const clearPromises = rooms.map(async (room) => {
    try {
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/clearqueue`);
      if (!response.ok) {
        testLog.warn(`   Failed to clear queue in ${room}: ${response.status}`);
      }
    } catch (error) {
      testLog.warn(`   Error clearing queue in ${room}:`, error);
    }
  });
  
  await Promise.allSettled(clearPromises);
}