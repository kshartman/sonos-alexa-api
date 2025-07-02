import http, { ServerResponse } from 'http';
import { SonosDiscovery } from './discovery.js';
import { ApiRouter } from './api-router.js';
import { PresetLoader } from './preset-loader.js';
import logger from './utils/logger.js';
import { debugManager, initializeDebugManager } from './utils/debug-manager.js';
import { DefaultRoomManager } from './utils/default-room-manager.js';
import { TTSService } from './services/tts-service.js';
import { applicationVersion } from './version.js';
import { loadConfiguration } from './utils/config-loader.js';
import { PresetGenerator } from './utils/preset-generator.js';
import type { Config, StateChangeEvent } from './types/sonos.js';

// Load configuration from multiple sources (this will show the startup banner)
const config: Config = loadConfiguration();

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

// Track discovery readiness
discovery.on('device-found', () => {
  if (router && discovery.devices.size > 0) {
    router.updateReadiness('discovery', true);
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
}, config);

// Now create the router with all dependencies
router = new ApiRouter(discovery, config, presetLoader, defaultRoomManager, ttsService);

// Create HTTP server
const server = http.createServer((req, res) => {
  router.handleRequest(req, res);
});

// Webhook support
let webhookClients: ServerResponse[] = [];

discovery.on('device-state-change', (device, state, previousState) => {
  debugManager.info('sse', `Forwarding device-state-change event for ${device.roomName}`);
  
  // Create a serializable state without circular references
  const serializableState = {
    playbackState: state.playbackState,
    volume: state.volume,
    mute: state.mute,
    currentTrack: state.currentTrack
    // Exclude coordinator to avoid circular reference
  };
  
  const event: StateChangeEvent = {
    type: 'device-state-change',
    data: {
      room: device.roomName,
      deviceId: device.id,
      state: serializableState,
      ...(previousState ? { previousState } : {})
    }
  };

  // Send to webhooks
  config.webhooks.forEach(webhook => {
    // Skip invalid URLs
    try {
      new URL(webhook.url);
    } catch (_err) {
      return;
    }
    
    fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...webhook.headers
      },
      body: JSON.stringify(event)
    }).catch(err => {
      let errorMsg = 'Unknown error';
      if (err instanceof Error) {
        // Check for Node.js system errors with cause
        const cause = (err as Error & { cause?: { code?: string } }).cause;
        errorMsg = cause?.code || err.message;
      }
      logger.error(`Webhook error for ${webhook.url}:`, errorMsg);
    });
  });

  // Send to SSE clients
  const sseData = `data: ${JSON.stringify(event)}\n\n`;
  debugManager.debug('sse', `Sending to ${webhookClients.length} SSE clients`);
  webhookClients = webhookClients.filter(client => {
    try {
      client.write(sseData);
      return true;
    } catch (err) {
      debugManager.error('sse', 'Error writing to client:', err);
      return false;
    }
  });
});

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
discovery.on('track-change', (trackEvent) => {
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
    
    // Wait a bit for device discovery, then load presets
    setTimeout(async () => {
      debugManager.debug('presets', 'Loading presets with favorite resolution...');
      await presetLoader.init();
      
      // Get all loaded presets for tracking
      const allLoadedPresets = { ...config.presets, ...presetLoader.getAllPresets() };
      
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
      
      const totalPresets = Object.keys(config.presets).length + Object.keys(presetLoader.getAllPresets()).length;
      
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
      logger.info(`🎵 Sonos Alexa API Version ${applicationVersion.version}`);
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
    }, 2000); // Wait 2 seconds for initial device discovery
    
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