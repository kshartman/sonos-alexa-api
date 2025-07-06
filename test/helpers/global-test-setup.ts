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
}

/**
 * Global test setup - called before test suites
 */
export async function globalTestSetup(testSuiteName: string): Promise<TestContext> {
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
  
  // Set default volume if specified
  const defaultVolume = process.env.TEST_VOLUME_DEFAULT;
  if (defaultVolume) {
    const volume = parseInt(defaultVolume);
    if (!isNaN(volume) && volume >= 0 && volume <= 100) {
      testLog.info(`🔊 Setting default volume to ${volume} for all rooms...`);
      await setVolumeForAllRooms(topology.rooms, volume);
    } else {
      testLog.warn(`⚠️  Invalid TEST_VOLUME_DEFAULT: ${defaultVolume} (must be 0-100)`);
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
  
  // Build device ID mapping from topology
  for (const zone of topology.zones) {
    for (const member of zone.members) {
      deviceIdMapping.set(member.roomName, member.id);
    }
  }
  
  testLog.info(`✅ Setup complete - ${topology.rooms.length} rooms, ${topology.zones.length} zones`);
  
  // Get search terms from environment or use defaults
  const musicsearchSongTerm = process.env.TEST_MUSICSEARCH_SONG || 'love';
  const musicsearchAlbumTerm = process.env.TEST_MUSICSEARCH_ALBUM || 'greatest';
  
  if (process.env.TEST_MUSICSEARCH_SONG) {
    testLog.info(`🔍 Using custom song search term: "${musicsearchSongTerm}"`);
  }
  if (process.env.TEST_MUSICSEARCH_ALBUM) {
    testLog.info(`🔍 Using custom album search term: "${musicsearchAlbumTerm}"`);
  }
  
  return {
    eventManager,
    topology,
    deviceIdMapping,
    musicsearchSongTerm,
    musicsearchAlbumTerm
  };
}

/**
 * Global test teardown - called after test suites
 */
export async function globalTestTeardown(testSuiteName: string, context: TestContext): Promise<void> {
  testLog.info(`\n🧹 Global test teardown for: ${testSuiteName}`);
  
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
 * This function uses the /zones API to find the device ID for a given room
 */
export async function getDeviceIdForRoom(room: string): Promise<string> {
  try {
    const { defaultConfig } = await import('./test-config.js');
    const response = await fetch(`${defaultConfig.apiUrl}/zones`);
    if (!response.ok) {
      throw new Error(`Failed to fetch zones: ${response.statusText}`);
    }
    
    const zones = await response.json();
    for (const zone of zones) {
      for (const member of zone.members) {
        if (member.roomName === room) {
          return member.id;
        }
      }
    }
    
    throw new Error(`Room '${room}' not found in topology`);
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