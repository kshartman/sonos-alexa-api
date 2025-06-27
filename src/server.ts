import http, { ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { SonosDiscovery } from './discovery.js';
import { ApiRouter } from './api-router.js';
import { PresetLoader } from './preset-loader.js';
import logger from './utils/logger.js';
import { debugManager } from './utils/debug-manager.js';
import { DefaultRoomManager } from './utils/default-room-manager.js';
import { TTSService } from './services/tts-service.js';
import { applicationVersion } from './version.js';
import type { Config, StateChangeEvent } from './types/sonos.js';

// Load configuration
let config: Config = {
  port: 5005,
  logLevel: 'info',
  presets: {},
  presetDir: './presets',
  webhooks: []
};

// Load config.json if exists
try {
  const configFile = readFileSync('./config.json', 'utf-8');
  config = { ...config, ...JSON.parse(configFile) };
} catch (error) {
  logger.info('No config.json found, using defaults');
}

// Load settings.json if exists (legacy compatibility)
try {
  const settingsFile = readFileSync('./settings.json', 'utf-8');
  const settings = JSON.parse(settingsFile);
  
  // Map settings.json fields to config
  if (settings.port) config.port = settings.port;
  if (settings.host) config.host = settings.host;
  if (settings.listenAddress) config.listenAddress = settings.listenAddress;
  if (settings.defaultRoom) config.defaultRoom = settings.defaultRoom;
  if (settings.auth) config.auth = settings.auth;
  if (settings.announceVolume) config.announceVolume = settings.announceVolume;
  if (settings.voicerss) config.voicerss = settings.voicerss;
  if (settings.macSay) config.macSay = settings.macSay;
  if (settings.pandora) config.pandora = settings.pandora;
  if (settings.spotify) config.spotify = settings.spotify;
  if (settings.library) config.library = settings.library;
  
  logger.info('Loaded settings from settings.json');
} catch (error) {
  // settings.json is optional
}

// Override with environment variables
config.port = Number(process.env.PORT) || config.port;
config.logLevel = process.env.LOG_LEVEL || config.logLevel;
config.defaultRoom = process.env.DEFAULT_ROOM || config.defaultRoom;

// Initialize components
const discovery = new SonosDiscovery();
// Make discovery globally available for devices to access subscriber
(global as any).discovery = discovery;

const presetLoader = new PresetLoader(config.presetDir, discovery);
const defaultRoomManager = new DefaultRoomManager(config.dataDir || './data', config.defaultRoom || '', config.defaultMusicService || 'library');
const ttsService = new TTSService(config);
const router = new ApiRouter(discovery, config, presetLoader, defaultRoomManager, ttsService);

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
      previousState: previousState || undefined
    }
  };

  // Send to webhooks
  config.webhooks.forEach(webhook => {
    // Skip invalid URLs
    try {
      new URL(webhook.url);
    } catch (err) {
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
      const errorMsg = (err as any).cause?.code || (err as Error).message;
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
    } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
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
    
    // Wait a bit for device discovery, then load presets
    setTimeout(async () => {
      debugManager.debug('presets', 'Loading presets with favorite resolution...');
      await presetLoader.init();
      const totalPresets = Object.keys(config.presets).length + Object.keys(presetLoader.getAllPresets()).length;
      
      // Startup status summary
      const devices = discovery.getAllDevices();
      const zones = discovery.getZones();
      const hasTopologyData = zones.length > 0;
      
      logger.info('═══════════════════════════════════════');
      logger.info(`🎵 Sonos Alexa API Version ${applicationVersion.version}`);
      logger.info('═══════════════════════════════════════');
      logger.info(`🌐 Server running on ${config.host || 'http://localhost'}:${config.port}`);
      logger.info(`🔊 Discovered ${devices.length} Sonos device${devices.length !== 1 ? 's' : ''}`);
      
      if (devices.length > 0) {
        const deviceNames = devices.map(d => d.roomName).sort().join(', ');
        logger.info(`   Rooms: ${deviceNames}`);
      }
      
      logger.info(`🏠 Zone groups: ${zones.length}`);
      if (hasTopologyData) {
        logger.info('✅ Topology data: Available');
        zones.forEach(zone => {
          const memberCount = zone.members.length;
          const memberInfo = memberCount > 1 ? ` (${memberCount} speakers)` : '';
          logger.info(`   ${zone.coordinator}${memberInfo}`);
        });
      } else {
        logger.info('⏳ Topology data: Pending (will update when received)');
      }
      
      logger.info(`🎼 Presets: ${totalPresets} total`);
      logger.info(`📁 Preset directory: ${config.presetDir}`);
      logger.info(`🔗 Webhooks: ${config.webhooks.length} configured`);
      logger.info('═══════════════════════════════════════');
      logger.info('✅ System ready for Alexa requests');
      logger.info('═══════════════════════════════════════');
      
      // Initialize music library cache in the background
      logger.info('📚 Initializing music library cache...');
      router.initializeMusicLibrary().then(() => {
        // Get cache status to show counts
        const cacheStatus = router.getMusicLibraryCacheStatus();
        if (cacheStatus && cacheStatus.metadata) {
          logger.info(`✅ Music library cache initialized: ${cacheStatus.metadata.totalTracks} tracks, ${cacheStatus.metadata.totalAlbums} albums, ${cacheStatus.metadata.totalArtists} artists`);
        } else {
          logger.info('✅ Music library cache initialized');
        }
      }).catch(error => {
        logger.error('Failed to initialize music library cache:', error);
      });
    }, 2000); // Wait 2 seconds for initial device discovery
    
    // Start HTTP server
    const listenAddress = config.listenAddress || '0.0.0.0';
    server.listen(config.port, listenAddress, () => {
      debugManager.debug('api', `HTTP server started on ${listenAddress}:${config.port}`);
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