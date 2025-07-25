import http, { ServerResponse } from 'http';
import { SonosDiscovery } from './discovery.js';
import { ApiRouter } from './api-router.js';
import { PresetLoader } from './preset-loader.js';
import logger from './utils/logger.js';
import { debugManager, initializeDebugManager } from './utils/debug-manager.js';
import { DefaultRoomManager } from './utils/default-room-manager.js';
import { TTSService } from './services/tts-service.js';
import { applicationVersion } from './version.js';
import { loadConfiguration, formatConfigInfo } from './utils/config-loader.js';
import { PresetGenerator } from './utils/preset-generator.js';
import { EventManager } from './utils/event-manager.js';
import type { Config } from './types/sonos.js';

// Load configuration from multiple sources
const configResult = loadConfiguration();
const config: Config = configResult.config;

// Show startup banner immediately
logger.info('═══════════════════════════════════════');
logger.info(`🎵 Sonos Alexa API Version ${applicationVersion.version}`);
logger.info('═══════════════════════════════════════');
logger.info(formatConfigInfo(configResult));

// Initialize debug manager with the loaded config
initializeDebugManager(config);

// Environment variables are now handled in config-loader.ts

// Initialize components
const discovery = new SonosDiscovery();
// Make discovery globally available for devices to access subscriber
declare global {
  var discovery: SonosDiscovery | undefined;
}
global.discovery = discovery;

// Create the router first (we'll need it for the callback)
const defaultRoomManager = new DefaultRoomManager(config.dataDir || './data', config.defaultRoom || '', config.defaultMusicService || 'library');
const ttsService = new TTSService(config);

// Create a temporary router variable that will be initialized later
let router: ApiRouter;

// Track discovery readiness and check if presets can be validated
discovery.on('device-found', async () => {
  if (router && discovery.devices.size > 0) {
    router.updateReadiness('discovery', true);
  }
  
  // Check if we can validate presets now that a new device was found
  if (presetLoader && !presetLoader.isValidated()) {
    await presetLoader.checkAndValidate();
  }
});

// Track topology readiness
discovery.on('topology-change', () => {
  if (router) {
    router.updateReadiness('topology', true);
  }
});

// Create preset loader with callback to update startup info
const presetLoader = new PresetLoader(config.presetDir, discovery, (presetStats) => {
  if (router) {
    router.updateStartupInfo('presets', presetStats);
  }
});

// Now create the router with all dependencies
router = new ApiRouter(discovery, config, presetLoader, defaultRoomManager, ttsService);

// Create HTTP server
const server = http.createServer((req, res) => {
  router.handleRequest(req, res);
});

// Webhook support
let webhookClients: ServerResponse[] = [];

// Get EventManager instance  
const eventManagerInstance = EventManager.getInstance();


// Forward content update events
discovery.on('content-update', (deviceId, containerUpdateIDs) => {
  const event = {
    type: 'content-update',
    data: {
      deviceId,
      containerUpdateIDs,
      timestamp: new Date().toISOString()
    }
  };
  
  const sseData = `data: ${JSON.stringify(event)}\n\n`;
  webhookClients = webhookClients.filter(client => {
    try {
      client.write(sseData);
      return true;
    } catch (_err) {
      return false;
    }
  });
});

// Forward topology change events  
discovery.on('topology-change', (_zones) => {
  // Get serializable zones data
  const serializableZones = discovery.getZones();
  
  const event = {
    type: 'topology-change',
    data: {
      zones: serializableZones,
      timestamp: new Date().toISOString()
    }
  };
  
  const sseData = `data: ${JSON.stringify(event)}\n\n`;
  webhookClients = webhookClients.filter(client => {
    try {
      client.write(sseData);
      return true;
    } catch (_err) {
      return false;
    }
  });
});

// Forward track change events
interface TrackChangeEvent {
  deviceId: string;
  currentTrack?: {
    title?: string;
    artist?: string;
    album?: string;
    uri?: string;
  };
  previousTrack?: {
    title?: string;
    artist?: string;
    album?: string;
    uri?: string;
  };
}
eventManagerInstance.on('track-change', (trackEvent: TrackChangeEvent) => {
  const event = {
    type: 'track-change',
    data: {
      ...trackEvent,
      timestamp: new Date().toISOString()
    }
  };
  
  const sseData = `data: ${JSON.stringify(event)}\n\n`;
  webhookClients = webhookClients.filter(client => {
    try {
      client.write(sseData);
      return true;
    } catch (_err) {
      return false;
    }
  });
});

// Forward state change events
import type { StateChangeEvent } from './utils/event-manager.js';

eventManagerInstance.on('state-change', (stateEvent: StateChangeEvent) => {
  const event = {
    type: 'device-state-change',
    data: {
      room: stateEvent.roomName,
      deviceId: stateEvent.deviceId,
      state: {
        playbackState: stateEvent.currentState,
        // Include volume and mute if available
        volume: undefined,
        mute: undefined
      },
      previousState: {
        playbackState: stateEvent.previousState
      },
      timestamp: new Date().toISOString()
    }
  };
  
  const sseData = `data: ${JSON.stringify(event)}\n\n`;
  webhookClients = webhookClients.filter(client => {
    try {
      client.write(sseData);
      return true;
    } catch (_err) {
      return false;
    }
  });
});

// Forward volume change events
interface VolumeChangeEvent {
  deviceId: string;
  roomName: string;
  previousVolume: number;
  currentVolume: number;
  timestamp: number;
}

eventManagerInstance.on('volume-change', (volumeEvent: VolumeChangeEvent) => {
  // Also send as device-state-change for EventBridge compatibility
  const event = {
    type: 'device-state-change',
    data: {
      room: volumeEvent.roomName,
      deviceId: volumeEvent.deviceId,
      state: {
        playbackState: 'UNKNOWN', // We don't know the playback state
        volume: volumeEvent.currentVolume,
        mute: undefined
      },
      previousState: {
        playbackState: 'UNKNOWN',
        volume: volumeEvent.previousVolume
      },
      timestamp: new Date().toISOString()
    }
  };
  
  const sseData = `data: ${JSON.stringify(event)}\n\n`;
  webhookClients = webhookClients.filter(client => {
    try {
      client.write(sseData);
      return true;
    } catch (_err) {
      return false;
    }
  });
});

// Forward mute change events
interface MuteChangeEvent {
  deviceId: string;
  roomName: string;
  previousMute: boolean;
  currentMute: boolean;
  timestamp: number;
}

eventManagerInstance.on('mute-change', (muteEvent: MuteChangeEvent) => {
  // Also send as device-state-change for EventBridge compatibility
  const event = {
    type: 'device-state-change',
    data: {
      room: muteEvent.roomName,
      deviceId: muteEvent.deviceId,
      state: {
        playbackState: 'UNKNOWN', // We don't know the playback state
        volume: undefined,
        mute: muteEvent.currentMute
      },
      previousState: {
        playbackState: 'UNKNOWN',
        mute: muteEvent.previousMute
      },
      timestamp: new Date().toISOString()
    }
  };
  
  const sseData = `data: ${JSON.stringify(event)}\n\n`;
  webhookClients = webhookClients.filter(client => {
    try {
      client.write(sseData);
      return true;
    } catch (_err) {
      return false;
    }
  });
});

// Add SSE endpoint and TTS file serving
const originalHandler = router.handleRequest.bind(router);
router.handleRequest = async (req, res) => {
  const url = req.url || '';
  
  if (url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    
    webhookClients.push(res);
    
    req.on('close', () => {
      webhookClients = webhookClients.filter(client => client !== res);
    });
    
    // Send initial ping
    res.write(':ping\n\n');
    
    return;
  }
  
  // Handle TTS file serving
  if (url.startsWith('/tts/')) {
    const filename = url.substring(5);
    const fileData = await ttsService.serveTTSFile(filename);
    
    if (fileData) {
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': fileData.length,
        'Cache-Control': 'public, max-age=3600'
      });
      res.end(fileData);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
    
    return;
  }
  
  // Handle static audio file serving
  if (url.startsWith('/static/audio/')) {
    const filename = url.substring(14);
    try {
      const path = await import('path');
      const fs = await import('fs/promises');
      const filePath = path.join(process.cwd(), 'static', 'audio', filename);
      
      // Security: ensure the path doesn't escape the audio directory
      if (!filePath.includes('static/audio') || filename.includes('..')) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      
      const fileData = await fs.readFile(filePath);
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': fileData.length,
        'Cache-Control': 'public, max-age=3600'
      });
      res.end(fileData);
    } catch (_error) {
      res.writeHead(404);
      res.end('Not found');
    }
    
    return;
  }
  
  return originalHandler(req, res);
};

// Graceful shutdown
let isShuttingDown = false;

async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  logger.info('Shutting down gracefully...');
  
  // Close server
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  // Stop discovery
  discovery.stop();
  
  // Stop preset watching
  presetLoader.stopWatching();
  
  // Clean up music library cache
  const musicLibraryCache = router.getMusicLibraryCache();
  if (musicLibraryCache) {
    musicLibraryCache.destroy();
    logger.info('Music library cache cleaned up');
  }
  
  // Clean up services cache
  router.destroy();
  
  // Clean up TTS service
  ttsService.destroy();
  logger.info('TTS service cleaned up');
  
  // Force exit after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
async function start(): Promise<void> {
  try {
    // Load default room settings
    await defaultRoomManager.load();
    
    // Initialize TTS service
    await ttsService.init();
    
    // Start discovery first
    await discovery.start();
    
    // Show detected IP for TTS after discovery starts
    const ttsHostIp = config.ttsHostIp;
    if (!ttsHostIp) {
      // Wait a moment for discovery to find devices
      await new Promise(resolve => setTimeout(resolve, 1000));
      const detectedIp = discovery.getLocalIP();
      logger.always(`🎤 TTS IP: ${detectedIp || 'Unable to detect'} (auto-detected)`);
      if (!detectedIp) {
        logger.warn('Could not detect local IP - TTS may not work correctly');
        logger.info('Set TTS_HOST_IP environment variable to fix this');
      }
    } else {
      logger.always(`🎤 TTS IP: ${ttsHostIp} (configured)`);
    }
    
    // Wait for capable device discovery, then load presets
    discovery.waitForFavoriteCapableDevice().then(async (result) => {
      logger.info(`Loading presets (${result.deviceCount} devices found, capable device: ${result.hasCapableDevice ? 'yes' : 'no'})`);
      await presetLoader.init();
      
      // Get all loaded presets for tracking (use raw presets to avoid triggering validation)
      const allLoadedPresets = { ...config.presets, ...presetLoader.getRawPresets() };
      
      // Generate default presets if enabled
      const defaultRoom = defaultRoomManager.getRoom();
      logger.info(`CREATE_DEFAULT_PRESETS: ${config.createDefaultPresets}, Default Room: ${defaultRoom}`);
      if (config.createDefaultPresets && defaultRoom) {
        const devices = discovery.getAllDevices();
        const device = devices.find(d => d.roomName === defaultRoom) || devices[0];
        if (device) {
          const generator = new PresetGenerator(allLoadedPresets);
          await generator.generateDefaultPresets(device, defaultRoom);
          
          // Reload presets to include generated ones
          await presetLoader.init();
        }
      }
      
      const totalPresets = Object.keys(config.presets).length + Object.keys(presetLoader.getRawPresets()).length;
      
      // Startup status summary
      const devices = discovery.getAllDevices();
      const zones = discovery.getZones();
      const hasTopologyData = zones.length > 0;
      
      // Always show minimal summary
      logger.always(`🔊 Discovered ${devices.length} Sonos device${devices.length !== 1 ? 's' : ''}`);
      if (devices.length > 0) {
        const deviceNames = devices.map(d => d.roomName).sort().join(', ');
        logger.always(`   Rooms: ${deviceNames}`);
      }
      
      // Show detailed summary only if log level allows
      logger.info('═══════════════════════════════════════');
      logger.info(`🌐 Server running on ${config.host || 'http://localhost'}:${config.port}`);
      logger.info(`🔊 Discovered ${devices.length} Sonos device${devices.length !== 1 ? 's' : ''}`);
      
      if (devices.length > 0) {
        const deviceNames = devices.map(d => d.roomName).sort().join(', ');
        logger.info(`   Rooms: ${deviceNames}`);
        
        // Report device info to startup stats
        router.updateStartupInfo('devices', {
          count: devices.length,
          rooms: devices.map(d => d.roomName).sort()
        });
      }
      
      logger.info(`🏠 Zone groups: ${zones.length}`);
      if (hasTopologyData) {
        logger.info('✅ Topology data: Available');
        zones.forEach(zone => {
          const memberCount = zone.members.length;
          const memberInfo = memberCount > 1 ? ` (${memberCount} speakers)` : '';
          logger.info(`   ${zone.coordinator}${memberInfo}`);
        });
        
        // Report topology info to startup stats
        router.updateStartupInfo('topology', {
          zoneCount: zones.length,
          zones: zones.map(zone => ({
            coordinator: zone.coordinator,
            memberCount: zone.members.length,
            members: zone.members.map(m => m.roomName)
          }))
        });
      } else {
        logger.info('⏳ Topology data: Pending (will update when received)');
        router.updateStartupInfo('topology', {
          zoneCount: 0,
          status: 'pending'
        });
      }
      
      logger.info(`🎼 Presets: ${totalPresets} total`);
      logger.info(`📁 Preset directory: ${config.presetDir}`);
      logger.info(`🔗 Webhooks: ${config.webhooks.length} configured`);
      logger.info('═══════════════════════════════════════');
      logger.info('✅ System ready for Alexa requests');
      logger.info('═══════════════════════════════════════');
      
      // Mark UPnP subscriptions as ready (they're set up by now)
      router.updateReadiness('upnpSubscriptions', true);
      
      // Initialize music library cache in the background
      logger.info('📚 Initializing music library cache...');
      router.initialize().then(() => {
        // Get cache status to show counts
        const cacheStatus = router.getMusicLibraryCacheStatus();
        if (cacheStatus && cacheStatus.metadata) {
          const metadata = cacheStatus.metadata as { totalTracks?: number; totalAlbums?: number; totalArtists?: number };
          if (metadata.totalTracks !== undefined && metadata.totalAlbums !== undefined && metadata.totalArtists !== undefined) {
            logger.info(`✅ Music library cache initialized: ${metadata.totalTracks} tracks, ${metadata.totalAlbums} albums, ${metadata.totalArtists} artists`);
          } else {
            logger.info('⏳ Music library cache started (still indexing)');
          }
        } else {
          logger.info('⏳ Music library cache started (no metadata yet)');
        }
      }).catch(error => {
        logger.error('Failed to initialize music library cache:', error);
      });
    }).catch(error => {
      logger.error('Failed to wait for capable device discovery:', error);
      // Still try to load presets even if wait failed
      presetLoader.init().catch(err => {
        logger.error('Failed to initialize presets:', err);
      });
    });
    
    // Start HTTP server - always listen on all interfaces
    server.listen(config.port, '0.0.0.0', () => {
      // Always show this message regardless of log level
      logger.always(`✅ Server ready at http://0.0.0.0:${config.port}`);
      debugManager.debug('api', 'HTTP server started on all interfaces');
    });
    
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`Port ${config.port} is already in use`);
      } else {
        logger.error('Server error:', err);
      }
      process.exit(1);
    });
    
  } catch (error) {
    logger.error('Failed to start:', error);
    process.exit(1);
  }
}

start();