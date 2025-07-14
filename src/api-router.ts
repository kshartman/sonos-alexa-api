import { IncomingMessage, ServerResponse } from 'http';
import logger, { loggerType } from './utils/logger.js';
import { getClientIp, isIpTrusted } from './utils/network-utils.js';
import { getErrorMessage, getErrorStatus, errorMessageIncludes } from './utils/error-helper.js';
import type { SonosDiscovery } from './discovery.js';
import type { SonosDevice } from './sonos-device.js';
import type { ZoneGroup } from './topology-manager.js';
import type { PresetLoader } from './preset-loader.js';
import type { DefaultRoomManager } from './utils/default-room-manager.js';
import type { TTSService } from './services/tts-service.js';
import { AppleMusicService } from './services/apple-music-service.js';
import { SpotifyService } from './services/spotify-service.js';
import { createSpotifyAuthService, SpotifyAuthService } from './services/spotify-auth-service.js';
import { AccountService } from './services/account-service.js';
import type { ServiceAccount } from './services/music-service.js';
import { MusicLibraryCache } from './services/music-library-cache.js';
import { createError, type Config, type ApiResponse, type RouteParams, type ErrorResponse, type SuccessResponse, type MusicSearchSuccessResponse, type LibrarySearchSuccessResponse, type BrowseItem, type QueueItem } from './types/sonos.js';
import { debugManager, type DebugCategories, type LogLevel } from './utils/debug-manager.js';
import { ServicesCache } from './utils/services-cache.js';
import { EventManager } from './utils/event-manager.js';
import { PandoraStationManager } from './services/pandora-station-manager.js';
import { scheduler } from './utils/scheduler.js';

type RouteHandler = (params: RouteParams, queryParams?: URLSearchParams, body?: string) => Promise<ApiResponse>;

/**
 * Main API router that handles all HTTP requests for the Sonos API.
 * Maps URL patterns to handler functions and manages request/response lifecycle.
 */
export class ApiRouter {
  private discovery: SonosDiscovery;
  private config: Config;
  private presetLoader?: PresetLoader | undefined;
  private defaultRoomManager: DefaultRoomManager;
  private ttsService: TTSService;
  private appleMusicService: AppleMusicService;
  private spotifyService: SpotifyService;
  private spotifyAuthService: SpotifyAuthService;
  private accountService: AccountService;
  private musicLibraryCache?: MusicLibraryCache;
  private servicesCache: ServicesCache;
  private pandoraStationManager: PandoraStationManager;
  private routes = new Map<string, RouteHandler>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private startupInfo: any = { // ANY IS CORRECT: startup info contains dynamic properties added at runtime
    timestamp: new Date().toISOString(), // Server initialization time
    version: '',
    config: {},
    presets: {},
    musicLibrary: {},
    devices: {},
    errors: [],
    readiness: {
      discovery: false,
      servicesCache: false,
      musicLibrary: false,
      upnpSubscriptions: false,
      topology: false,
      allReady: false
    },
    readinessTimes: {
      discovery: null as string | null,
      servicesCache: null as string | null,
      musicLibrary: null as string | null,
      upnpSubscriptions: null as string | null,
      topology: null as string | null,
      allReady: null as string | null
    }
  };

  /**
   * Creates a new API router instance.
   * @param discovery - The Sonos discovery service for finding and controlling devices
   * @param config - Application configuration
   * @param presetLoader - Optional preset loader for managing saved presets
   * @param defaultRoomManager - Manager for persisting default room/service settings
   * @param ttsService - Text-to-speech service for announcements
   */
  constructor(discovery: SonosDiscovery, config: Config, presetLoader?: PresetLoader | undefined, defaultRoomManager?: DefaultRoomManager, ttsService?: TTSService) {
    this.discovery = discovery;
    this.config = config;
    this.presetLoader = presetLoader;
    this.defaultRoomManager = defaultRoomManager!;
    this.ttsService = ttsService!;
    this.appleMusicService = new AppleMusicService();
    this.spotifyService = new SpotifyService(config);
    this.spotifyAuthService = createSpotifyAuthService(config);
    this.servicesCache = new ServicesCache(discovery);
    this.accountService = new AccountService(this.servicesCache);
    this.pandoraStationManager = PandoraStationManager.getInstance(config);
    
    // Add version and config to startup info
    this.startupInfo.version = config.version;
    this.startupInfo.config = config;
    this.startupInfo.actualLoggerType = loggerType;
    
    this.registerRoutes();
  }

  /**
   * Initializes the API router by setting up services cache and music library.
   * Should be called after construction but before handling requests.
   */
  async initialize(): Promise<void> {
    // Initialize services cache
    try {
      await this.servicesCache.initialize();
      this.updateStartupInfo('services', this.servicesCache.getStatus());
      this.updateReadiness('servicesCache', true);
    } catch (error) {
      logger.error('Failed to initialize services cache:', error);
      this.updateStartupInfo('errors', {
        servicesCache: (error as Error).message
      });
    }
    
    // Initialize music library
    await this.initializeMusicLibrary();
    
    // Initialize Pandora station manager
    try {
      await this.pandoraStationManager.initialize(this.discovery);
      const stats = this.pandoraStationManager.getStats();
      this.updateStartupInfo('pandoraStations', stats);
      logger.info(`Pandora station manager initialized with ${stats.total} stations`);
    } catch (error) {
      logger.error('Failed to initialize Pandora station manager:', error);
      this.updateStartupInfo('errors', {
        pandoraStations: (error as Error).message
      });
    }
  }

  /**
   * Initializes the music library cache if devices are available.
   * Sets up periodic reindexing based on configuration.
   */
  async initializeMusicLibrary(): Promise<void> {
    // Skip music library initialization in unit test mode to prevent persistent timers
    if (process.env.LOG_LEVEL === 'silent') {
      logger.always('Skipping music library initialization in unit test mode');
      return;
    }
    try {
      // Get any device IP to access the music library
      const zones = await this.getZones();
      if (zones.body && Array.isArray(zones.body) && zones.body.length > 0) {
        const firstZone = zones.body[0];
        if (firstZone.members && firstZone.members.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const coordinator = firstZone.members.find((m: any) => m.isCoordinator) || firstZone.members[0]; // ANY IS CORRECT: member type comes from dynamic zone response
          const device = this.discovery.getDevice(coordinator.roomName);
          if (device) {
            logger.info('Initializing music library cache...');
            this.musicLibraryCache = new MusicLibraryCache(
              device.ip, 
              this.config.dataDir || './data',
              (musicLibraryStats) => {
                this.updateStartupInfo('musicLibrary', musicLibraryStats);
                this.updateReadiness('musicLibrary', true);
              }
            );
            await this.musicLibraryCache.initialize();
            
            // Set up periodic reindexing if configured
            const reindexInterval = this.config.library?.reindexInterval;
            if (reindexInterval) {
              this.musicLibraryCache.setReindexInterval(reindexInterval);
            }
          }
        }
      }
    } catch (error) {
      logger.error('Failed to initialize music library cache:', error);
      this.updateStartupInfo('errors', {
        musicLibrary: (error as Error).message
      });
    }
  }

  /**
   * Gets the current status of the music library cache.
   * @returns Cache status including indexing progress, or null if not initialized
   */
  getMusicLibraryCacheStatus(): { isIndexing: boolean; progress: number; metadata: unknown } | null { // CacheMetadata type not exported from music-library-cache
    if (!this.musicLibraryCache) {
      return null;
    }
    return this.musicLibraryCache.getStatus();
  }

  /**
   * Gets the music library cache instance.
   * @returns The music library cache or undefined if not initialized
   */
  getMusicLibraryCache(): MusicLibraryCache | undefined {
    return this.musicLibraryCache;
  }

  /**
   * Cleans up resources when shutting down the API router.
   */
  destroy(): void {
    this.servicesCache.destroy();
    logger.info('Services cache cleaned up');
  }

  /**
   * Registers all API routes with their handlers.
   * Called during construction to set up the routing table.
   */
  private registerRoutes(): void {
    // System routes
    this.routes.set('GET /zones', this.getZones.bind(this));
    this.routes.set('GET /devices', this.getDevices.bind(this));
    this.routes.set('GET /devices/id/{id}', this.getDeviceById.bind(this));
    this.routes.set('GET /devices/room/{room}', this.getDevicesByRoom.bind(this));
    this.routes.set('GET /state', this.getState.bind(this));
    this.routes.set('GET /health', this.getHealth.bind(this));
    this.routes.set('GET /presets', this.getPresets.bind(this));
    this.routes.set('GET /services', this.getServices.bind(this));
    this.routes.set('GET /services/refresh', this.refreshServices.bind(this));
    this.routes.set('GET /presets/{detailed}', this.getPresets.bind(this));

    // Room-specific routes
    this.routes.set('GET /{room}/state', this.getRoomState.bind(this));
    this.routes.set('GET /{room}/play', this.play.bind(this));
    this.routes.set('GET /{room}/pause', this.pause.bind(this));
    this.routes.set('GET /{room}/playpause', this.playPause.bind(this));
    this.routes.set('GET /{room}/stop', this.stop.bind(this));
    this.routes.set('GET /{room}/next', this.next.bind(this));
    this.routes.set('GET /{room}/previous', this.previous.bind(this));
    // Register more specific routes first
    this.routes.set('GET /{room}/volume/+{delta}', this.volumeUp.bind(this));
    this.routes.set('GET /{room}/volume/-{delta}', this.volumeDown.bind(this));
    this.routes.set('GET /{room}/volume/{level}', this.setVolume.bind(this));
    this.routes.set('GET /{room}/mute', this.mute.bind(this));
    this.routes.set('GET /{room}/unmute', this.unmute.bind(this));
    this.routes.set('GET /{room}/togglemute', this.toggleMute.bind(this));
    this.routes.set('GET /{room}/preset/{preset}', this.playPreset.bind(this));

    // Group management routes
    this.routes.set('GET /{room}/join/{targetRoom}', this.joinGroup.bind(this));
    this.routes.set('GET /{room}/leave', this.leaveGroup.bind(this));
    this.routes.set('GET /{room}/ungroup', this.leaveGroup.bind(this));
    this.routes.set('GET /{room}/isolate', this.leaveGroup.bind(this));
    this.routes.set('GET /{room}/add/{otherRoom}', this.addToGroup.bind(this));

    // Favorites routes
    this.routes.set('GET /{room}/favorites', this.getFavorites.bind(this));
    this.routes.set('GET /{room}/favorites/{detailed}', this.getFavorites.bind(this));
    this.routes.set('GET /{room}/favourites', this.getFavorites.bind(this)); // British spelling
    this.routes.set('GET /{room}/favourites/{detailed}', this.getFavorites.bind(this)); // British spelling
    this.routes.set('GET /{room}/favorite/{name}', this.playFavorite.bind(this));
    this.routes.set('GET /{room}/favourite/{name}', this.playFavorite.bind(this)); // British spelling

    // Playlists routes
    this.routes.set('GET /{room}/playlists', this.getPlaylists.bind(this));
    this.routes.set('GET /{room}/playlists/{detailed}', this.getPlaylists.bind(this));
    this.routes.set('GET /{room}/playlist/{name}', this.playPlaylist.bind(this));

    // Apple Music routes
    this.routes.set('GET /{room}/applemusic/{action}/{id}', this.appleMusic.bind(this));

    // Music library routes (must be before generic music search routes)
    this.routes.set('GET /{room}/musicsearch/library/song/{query}', this.musicLibrarySearchSong.bind(this));
    this.routes.set('GET /{room}/musicsearch/library/artist/{query}', this.musicLibrarySearchArtist.bind(this));
    this.routes.set('GET /{room}/musicsearch/library/album/{query}', this.musicLibrarySearchAlbum.bind(this));
    this.routes.set('GET /library/index', this.getMusicLibraryStatus.bind(this));
    this.routes.set('GET /library/refresh', this.refreshMusicLibrary.bind(this));
    this.routes.set('GET /library/summary', this.getMusicLibrarySummary.bind(this));
    this.routes.set('GET /library/detailed', this.getMusicLibraryDetailed.bind(this));

    // Music search routes (for Alexa compatibility)
    this.routes.set('GET /{room}/musicsearch/{service}/album/{name}', this.musicSearchAlbum.bind(this));
    this.routes.set('GET /{room}/musicsearch/{service}/song/{query}', this.musicSearchSong.bind(this));
    this.routes.set('GET /{room}/musicsearch/{service}/station/{name}', this.musicSearchStation.bind(this));
    this.routes.set('GET /{room}/musicsearch/{service}/artist/{name}', this.musicSearchArtist.bind(this));
    
    // Service-specific routes
    this.routes.set('GET /{room}/siriusxm/{name}', this.siriusXM.bind(this));
    this.routes.set('GET /{room}/pandora/play/{name}', this.pandoraPlay.bind(this));
    this.routes.set('GET /{room}/pandora/thumbsup', this.pandoraThumbsUp.bind(this));
    this.routes.set('GET /{room}/pandora/thumbsdown', this.pandoraThumbsDown.bind(this));
    this.routes.set('GET /{room}/pandora/stations', this.pandoraGetStations.bind(this));
    this.routes.set('GET /{room}/pandora/stations/{detailed}', this.pandoraGetStations.bind(this));
    this.routes.set('GET /pandora/stations', this.pandoraAllStations.bind(this));
    this.routes.set('GET /pandora/status', this.pandoraStatus.bind(this));
    this.routes.set('GET /{room}/pandora/clear', this.pandoraClear.bind(this));
    this.routes.set('GET /{room}/spotify/play/{id}', this.spotifyPlay.bind(this));
    
    // Spotify OAuth routes
    this.routes.set('GET /spotify/auth', this.spotifyGetAuthUrl.bind(this));
    this.routes.set('GET /spotify/auth-url', this.spotifyGetAuthUrl.bind(this));
    this.routes.set('GET /spotify/callback', this.spotifyCallback.bind(this));
    this.routes.set('POST /spotify/callback-url', this.spotifySubmitCallbackUrl.bind(this));
    this.routes.set('GET /spotify/status', this.spotifyAuthStatus.bind(this));
    
    // Queue management routes
    this.routes.set('GET /{room}/queue', this.getQueue.bind(this));
    this.routes.set('GET /{room}/queue/detailed', this.getQueue.bind(this));
    this.routes.set('GET /{room}/queue/{limit}', this.getQueue.bind(this));
    this.routes.set('GET /{room}/queue/{limit}/detailed', this.getQueue.bind(this));
    this.routes.set('GET /{room}/queue/{limit}/{offset}', this.getQueue.bind(this));
    this.routes.set('GET /{room}/queue/{limit}/{offset}/detailed', this.getQueue.bind(this));
    this.routes.set('GET /{room}/clearqueue', this.clearQueue.bind(this));
    this.routes.set('POST /{room}/queue', this.addToQueue.bind(this));
    
    // Playback control routes
    this.routes.set('GET /{room}/repeat/{toggle}', this.setRepeat.bind(this));
    this.routes.set('GET /{room}/shuffle/{toggle}', this.setShuffle.bind(this));
    this.routes.set('GET /{room}/crossfade/{toggle}', this.setCrossfade.bind(this));
    this.routes.set('GET /{room}/sleep/{seconds}', this.setSleepTimer.bind(this));
    this.routes.set('GET /{room}/linein', this.playLineIn.bind(this));
    this.routes.set('GET /{room}/linein/{source}', this.playLineIn.bind(this));
    this.routes.set('GET /{room}/groupVolume/{level}', this.setGroupVolume.bind(this));
    
    // Global routes
    this.routes.set('GET /pauseall', this.pauseAll.bind(this));
    this.routes.set('GET /resumeAll', this.resumeAll.bind(this));
    this.routes.set('GET /loglevel/{level}', this.setLogLevel.bind(this));

    // Debug routes
    this.routes.set('GET /debug', this.getDebugStatus.bind(this));
    this.routes.set('GET /debug/level/{level}', this.setDebugLevel.bind(this));
    this.routes.set('GET /debug/category/{category}/{enabled}', this.setDebugCategory.bind(this));
    this.routes.set('GET /debug/enable-all', this.enableAllDebug.bind(this));
    this.routes.set('GET /debug/disable-all', this.disableAllDebug.bind(this));
    this.routes.set('GET /debug/startup', this.getStartupInfo.bind(this));
    this.routes.set('GET /debug/startup/config', this.getStartupConfig.bind(this));
    this.routes.set('GET /debug/spotify/parse/{input}', this.debugSpotifyParse.bind(this));
    this.routes.set('GET /debug/spotify/browse/{room}/{sid}', this.debugBrowseSpotify.bind(this));
    this.routes.set('GET /debug/spotify/account/{room}', this.debugSpotifyAccount.bind(this));
    this.routes.set('GET /debug/device-health', this.getDeviceHealth.bind(this));
    this.routes.set('GET /debug/scheduler', this.getSchedulerStatus.bind(this));
    // Settings route
    this.routes.set('GET /settings', this.getSettings.bind(this));
    
    // Default room management
    this.routes.set('GET /default', this.getDefaults.bind(this));
    this.routes.set('GET /default/room/{room}', this.setDefaultRoom.bind(this));
    this.routes.set('GET /default/service/{service}', this.setDefaultService.bind(this));
    
    // Room-less endpoints (use default room)
    this.routes.set('GET /play', this.playDefault.bind(this));
    this.routes.set('GET /pause', this.pauseDefault.bind(this));
    this.routes.set('GET /volume/{level}', this.setVolumeDefault.bind(this));
    this.routes.set('GET /preset/{preset}', this.playPresetDefault.bind(this));
    this.routes.set('GET /preset/{preset}/room/{room}', this.playPresetInRoom.bind(this));
    
    // TTS endpoints
    this.routes.set('GET /{room}/say/{text}', this.sayText.bind(this));
    this.routes.set('GET /{room}/say/{text}/{volume}', this.sayTextWithVolume.bind(this));
    this.routes.set('GET /{room}/sayall/{text}', this.sayTextAll.bind(this));
    this.routes.set('GET /{room}/sayall/{text}/{volume}', this.sayTextAllWithVolume.bind(this));
    this.routes.set('GET /sayall/{text}', this.sayTextAllRooms.bind(this));
    this.routes.set('GET /sayall/{text}/{volume}', this.sayTextAllRoomsWithVolume.bind(this));
    
    // Music search with defaults (room-less endpoints)
    this.routes.set('GET /song/{query}', this.musicSearchSongDefault.bind(this));
    this.routes.set('GET /album/{name}', this.musicSearchAlbumDefault.bind(this));
    this.routes.set('GET /station/{name}', this.musicSearchStationDefault.bind(this));
    this.routes.set('GET /artist/{name}', this.musicSearchArtistDefault.bind(this));
    
    // Debug endpoint for subscription status
    this.routes.set('GET /debug/subscriptions', this.debugSubscriptions.bind(this));
  }

  /**
   * Main request handler for all HTTP requests.
   * Handles authentication, CORS, routing, and error responses.
   * @param req - The incoming HTTP request
   * @param res - The HTTP response object
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { method, url } = req;
    const [path, queryString] = (url || '/').split('?');
    const queryParams = new URLSearchParams(queryString || '');
    const clientIp = getClientIp(req);
    
    debugManager.info('api', `${method} ${path}`, { ip: clientIp });

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    
    // Skip auth for specific endpoints
    const authExemptPaths = ['/spotify/callback', '/health'];
    const isAuthExempt = authExemptPaths.some(exempt => path === exempt);
    
    // Basic auth check if configured
    if (this.config.auth && this.config.auth.username && this.config.auth.password && !isAuthExempt) {
      // Skip auth check if rejectUnauthorized is false
      if (this.config.auth.rejectUnauthorized === false) {
        debugManager.debug('api', 'Auth configured but rejectUnauthorized=false, skipping auth check');
      } else {
        // Check if client IP is in trusted networks
        const clientIp = getClientIp(req);
        const trustedNetworks = this.config.auth.trustedNetworks || [];
        
        if (isIpTrusted(clientIp, trustedNetworks)) {
          debugManager.debug('api', `Skipping auth for trusted IP: ${clientIp}`);
        } else {
          // Require authentication for untrusted IPs
          const authHeader = req.headers.authorization;
          
          if (!authHeader || !authHeader.startsWith('Basic ')) {
            const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress;
            debugManager.warn('api', 'Authentication failed', {
              ip: clientIp,
              auth: 'missing',
              path: path
            });
            res.statusCode = 401;
            res.setHeader('WWW-Authenticate', 'Basic realm="Sonos API"');
            res.end(JSON.stringify({ status: 'error', error: 'Authentication required' }));
            return;
          }
        
          const base64Credentials = authHeader.split(' ')[1];
          if (!base64Credentials) {
            const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress;
            debugManager.warn('api', 'Authentication failed', {
              ip: clientIp,
              auth: 'invalid-header',
              path: path
            });
            res.statusCode = 401;
            res.end(JSON.stringify({ status: 'error', error: 'Invalid authorization header' }));
            return;
          }
          const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
          const [username, password] = credentials.split(':');
        
          if (username !== this.config.auth.username || password !== this.config.auth.password) {
            const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress;
            debugManager.warn('api', 'Authentication failed', {
              ip: clientIp,
              user: username,
              auth: 'invalid-credentials',
              path: path
            });
            res.statusCode = 401;
            res.end(JSON.stringify({ status: 'error', error: 'Invalid credentials' }));
            return;
          }
        }
      }
    }

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    // Parse POST body if needed
    let body = '';
    if (method === 'POST') {
      body = await new Promise<string>((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
      });
    }

    try {
      const result = await this.routeRequest(method || 'GET', path!, queryParams, body);
      res.statusCode = result.status || 200;
      
      // Handle HTML responses for OAuth callbacks
      if (typeof result.body === 'string' && result.body.includes('<html>')) {
        res.setHeader('Content-Type', 'text/html');
        res.end(result.body);
      } else {
        res.end(JSON.stringify(result.body || { status: 'success' }));
      }
    } catch (error) {
      debugManager.error('api', 'Request error:', error);
      res.statusCode = getErrorStatus(error) || 500;
      
      const errorResponse: ErrorResponse = {
        status: 'error',
        error: getErrorMessage(error) || 'Internal server error'
      };
      
      if (this.config.isDevelopment && error instanceof Error && error.stack) {
        errorResponse.stack = error.stack;
      }
      
      res.end(JSON.stringify(errorResponse));
    }
  }

  /**
   * Clear Pandora session by stopping and setting transport to queue
   * This is more reliable than playing silence and properly releases the session
   */
  private async clearPandoraSession(device: SonosDevice): Promise<void> {
    logger.debug('Clearing Pandora session using stop + queue method');
    
    try {
      // Step 1: Stop playback
      await device.stop();
      
      // Step 2: Clear the transport by setting to queue
      // This releases the Pandora session more reliably than playing silence
      // Remove uuid: prefix if present
      const deviceId = device.id.replace('uuid:', '');
      const queueUri = `x-rincon-queue:${deviceId}#0`;
      const queueMetadata = '';
      await device.setAVTransportURI(queueUri, queueMetadata);
      
      logger.debug('Pandora session cleared successfully');
    } catch (error) {
      logger.error('Error clearing Pandora session:', error);
    }
  }

  /**
   * Routes requests to the appropriate handler based on method and path.
   * Supports both exact matches and pattern matching with parameters.
   * @param method - HTTP method (GET, POST, etc.)
   * @param path - Request path
   * @param queryParams - Optional query string parameters
   * @param body - Optional request body for POST requests
   * @returns API response with status and body
   */
  private async routeRequest(method: string, path: string, queryParams?: URLSearchParams, body?: string): Promise<ApiResponse> {
    // Try exact match first
    let handler = this.routes.get(`${method} ${path}`);
    let params: RouteParams = {};

    if (!handler) {
      // Try pattern matching
      for (const [pattern, routeHandler] of this.routes) {
        const [routeMethod, routePath] = pattern.split(' ');
        
        if (routeMethod !== method) continue;

        const match = this.matchPath(path, routePath!);
        if (match) {
          handler = routeHandler;
          params = match;
          break;
        }
      }
    }

    if (!handler) {
      throw createError(404, 'Not found');
    }

    return handler(params, queryParams, body);
  }

  /**
   * Matches a request path against a route pattern.
   * Extracts parameters from path segments like {room} or {volume}.
   * @param actualPath - The actual request path
   * @param pattern - The route pattern to match against
   * @returns Extracted parameters or null if no match
   */
  private matchPath(actualPath: string, pattern: string): RouteParams | null {
    const actualParts = actualPath.split('/').filter(Boolean);
    const patternParts = pattern.split('/').filter(Boolean);

    if (actualParts.length !== patternParts.length) {
      return null;
    }

    const params: RouteParams = {};
    
    // Check if this is a TTS route
    const isTTSRoute = pattern.includes('/say/') || pattern.includes('/sayall/');

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i]!;
      const actualPart = actualParts[i]!;

      if (patternPart.startsWith('{') && patternPart.endsWith('}')) {
        const paramName = patternPart.slice(1, -1);
        
        // Special handling for TTS text parameter
        if (isTTSRoute && paramName === 'text') {
          // Don't decode here - the TTS handler will do safe decoding
          params[paramName] = actualPart;
        } else {
          try {
            params[paramName] = decodeURIComponent(actualPart);
          } catch (_e) {
            // For non-TTS routes, malformed URLs are an error
            logger.debug(`Malformed URL parameter '${paramName}' in path '${actualPath}': ${actualPart}`);
            return null;
          }
        }
      } else if (patternPart.includes('{') && patternPart.includes('}')) {
        // Handle patterns like +{delta} or -{delta}
        const paramMatch = patternPart.match(/^(.*)\{([^}]+)\}(.*)$/);
        if (paramMatch) {
          const [, prefix, paramName, suffix] = paramMatch;
          if (actualPart.startsWith(prefix!) && actualPart.endsWith(suffix!)) {
            const value = actualPart.slice(prefix!.length, actualPart.length - suffix!.length);
            try {
              params[paramName!] = decodeURIComponent(value);
            } catch (_e) {
              // For non-TTS routes, malformed URLs are an error
              logger.debug(`Malformed URL parameter '${paramName}' in path '${actualPath}': ${value}`);
              return null;
            }
          } else {
            return null;
          }
        } else {
          return null;
        }
      } else if (patternPart !== actualPart) {
        return null;
      }
    }

    return params;
  }

  // Helper methods
  /**
   * Gets a device by room name, using default room if not specified.
   * @param roomName - Optional room name
   * @returns The Sonos device
   * @throws Error if room not found or no default configured
   */
  private getDevice(roomName: string | undefined) {
    // Use default room manager to resolve room name
    const resolvedRoom = this.defaultRoomManager.getRoom(roomName);
    
    if (!resolvedRoom) {
      throw createError(400, 'No room specified and no default room configured');
    }
    
    const device = this.discovery.getDevice(resolvedRoom);
    if (!device) {
      throw createError(404, `Room '${resolvedRoom}' not found`);
    }
    return device;
  }

  // System endpoints
  /**
   * Gets current zone topology with all groups and members.
   * @returns Zone group information
   */
  private async getZones(): Promise<ApiResponse> {
    return { status: 200, body: this.discovery.getZones() };
  }

  /**
   * Gets playback state for all devices.
   * @returns Current state of all devices including volume, playback, and track info
   */
  private async getState(): Promise<ApiResponse> {
    const devices = this.discovery.getAllDevices();
    const state = devices.map(device => ({
      room: device.roomName,
      state: {
        playbackState: device.state.playbackState,
        volume: device.state.volume,
        mute: device.state.mute,
        currentTrack: device.state.currentTrack,
        coordinator: device.state.coordinator ? {
          id: device.state.coordinator.id,
          roomName: device.state.coordinator.roomName,
          modelName: device.state.coordinator.modelName
        } : undefined
      }
    }));
    return { status: 200, body: state };
  }

  private async getHealth(): Promise<ApiResponse> {
    return { 
      status: 200,
      body: { 
        status: 'healthy',
        devices: this.discovery.devices.size,
        uptime: process.uptime()
      }
    };
  }

  private async getServices(): Promise<ApiResponse> {
    try {
      const services = await this.servicesCache.getServices();
      return { 
        status: 200, 
        body: services
      };
    } catch (error) {
      logger.error('Failed to get services:', error);
      return { 
        status: 500, 
        body: { 
          error: 'Failed to get services', 
          message: error instanceof Error ? error.message : 'Unknown error' 
        } 
      };
    }
  }

  private async refreshServices(): Promise<ApiResponse> {
    try {
      await this.servicesCache.refresh();
      const status = this.servicesCache.getStatus();
      
      return { 
        status: 200, 
        body: {
          message: 'Services cache refreshed successfully',
          serviceCount: status.serviceCount,
          lastRefresh: status.lastRefresh
        }
      };
    } catch (error) {
      logger.error('Failed to refresh services:', error);
      return { 
        status: 500, 
        body: { 
          error: 'Failed to refresh services', 
          message: error instanceof Error ? error.message : 'Unknown error' 
        } 
      };
    }
  }


  private parseStereoRole(device: SonosDevice, channelMapSet?: string): { role: string; groupId: string } | undefined {
    if (!channelMapSet) return undefined;
    
    // Format: "UUID1:LF,LF;UUID2:RF,RF" or with subwoofer "UUID1:LF,LF;UUID2:RF,RF;UUID3:SW,SW"
    // Parse each UUID:role pair
    const pairs = channelMapSet.split(';');
    for (const pair of pairs) {
      const [uuid, roles] = pair.split(':');
      if (!uuid || !roles) continue;
      // Check if this device's UUID matches (handle with/without uuid: prefix)
      const deviceUuid = device.id.replace('uuid:', '');
      const pairUuid = uuid.replace('uuid:', '');
      if (pairUuid === deviceUuid || `RINCON_${pairUuid}` === deviceUuid) {
        // Determine the role based on channel mapping
        const roleUpper = roles ? roles.toUpperCase() : '';
        
        // Main stereo pair roles
        if (roleUpper.includes('LF')) {
          return { role: 'left', groupId: `${device.roomName}:stereopair` };
        } else if (roleUpper.includes('RF')) {
          return { role: 'right', groupId: `${device.roomName}:stereopair` };
        }
        // Surround sound roles
        else if (roleUpper.includes('LR')) {
          return { role: 'surround-left', groupId: `${device.roomName}:surround` };
        } else if (roleUpper.includes('RR')) {
          return { role: 'surround-right', groupId: `${device.roomName}:surround` };
        }
        // Center/Soundbar
        else if (roleUpper.includes('C') && !roleUpper.includes('RC')) {
          return { role: 'center', groupId: `${device.roomName}:surround` };
        }
        // Subwoofer variations
        else if (roleUpper.includes('SW') || roleUpper.includes('SUB') || roleUpper.includes('LFE')) {
          return { role: 'subwoofer', groupId: `${device.roomName}:surround` };
        }
        // Height/Atmos speakers
        else if (roleUpper.includes('H')) {
          return { role: 'height', groupId: `${device.roomName}:surround` };
        }
        // Mix-down (rare)
        else if (roleUpper.includes('MX')) {
          return { role: 'mix', groupId: `${device.roomName}:surround` };
        }
      }
    }
    return undefined;
  }

  /**
   * Gets information about all discovered Sonos devices.
   * Includes model, IP, and stereo/surround pair configuration.
   * @returns Array of device information
   */
  private async getDevices(): Promise<ApiResponse> {
    const devices = Array.from(this.discovery.devices.values());
    const topology = this.discovery.topologyManager.getZones();
    
    const deviceInfo = devices.map(device => {
      // Find the zone this device belongs to
      const zone = topology.find((z: ZoneGroup) => z.members.some((m: SonosDevice) => m.id === device.id));
      const memberDetails = zone?.memberDetails?.find((m: { uuid: string; roomName: string; channelMapSet?: string }) => 
        m.uuid === device.id || m.uuid === device.id.replace('uuid:', '')
      );
      
      // Parse stereo pair info from channelMapSet
      const pairedInfo = this.parseStereoRole(device, memberDetails?.channelMapSet);
      
      return {
        room: device.roomName,
        name: device.roomName,
        id: device.id,
        model: device.modelName,
        ip: device.ip,
        ...(pairedInfo && { paired: pairedInfo })
      };
    });
    
    return { status: 200, body: deviceInfo };
  }

  /**
   * Gets information about a specific device by ID.
   * @param params - Route parameters containing device ID
   * @returns Device information including model, IP, and pairing info
   */
  private async getDeviceById({ id }: RouteParams): Promise<ApiResponse> {
    if (!id) {
      return { status: 400, body: { status: 'error', error: 'Device ID is required' } };
    }
    
    // Try with and without uuid: prefix
    let device = this.discovery.devices.get(id);
    if (!device && !id.startsWith('uuid:')) {
      device = this.discovery.devices.get(`uuid:${id}`);
    }
    if (!device && id.startsWith('uuid:')) {
      device = this.discovery.devices.get(id.replace('uuid:', ''));
    }
    
    if (!device) {
      return { status: 404, body: { status: 'error', error: 'Device not found' } };
    }
    
    // Get topology info for this device
    const topology = this.discovery.topologyManager.getZones();
    const zone = topology.find((z: ZoneGroup) => z.members.some((m: SonosDevice) => m.id === device.id));
    const memberDetails = zone?.memberDetails?.find(m => 
      m.uuid === device.id || m.uuid === device.id.replace('uuid:', '')
    );
    
    // Parse stereo pair info
    const pairedInfo = this.parseStereoRole(device, memberDetails?.channelMapSet);
    
    return {
      status: 200,
      body: {
        room: device.roomName,
        name: device.roomName,
        id: device.id,
        model: device.modelName,
        ip: device.ip,
        ...(pairedInfo && { paired: pairedInfo })
      }
    };
  }

  /**
   * Gets all devices in a specific room (handles stereo pairs).
   * @param params - Route parameters containing room name
   * @returns Array of devices in the room
   */
  private async getDevicesByRoom({ room }: RouteParams): Promise<ApiResponse> {
    if (!room) {
      return { status: 400, body: { status: 'error', error: 'Room name is required' } };
    }
    
    const devices = Array.from(this.discovery.devices.values()).filter(
      device => device.roomName.toLowerCase() === room.toLowerCase()
    );
    
    if (devices.length === 0) {
      return { status: 404, body: { status: 'error', error: 'Room not found' } };
    }
    
    const topology = this.discovery.topologyManager.getZones();
    
    const deviceInfo = devices.map(device => {
      const zone = topology.find((z: ZoneGroup) => z.members.some((m: SonosDevice) => m.id === device.id));
      const memberDetails = zone?.memberDetails?.find((m: { uuid: string; roomName: string; channelMapSet?: string }) => 
        m.uuid === device.id || m.uuid === device.id.replace('uuid:', '')
      );
      
      const pairedInfo = this.parseStereoRole(device, memberDetails?.channelMapSet);
      
      return {
        room: device.roomName,
        name: device.roomName,
        id: device.id,
        model: device.modelName,
        ip: device.ip,
        ...(pairedInfo && { paired: pairedInfo })
      };
    });
    
    return { status: 200, body: deviceInfo };
  }

  /**
   * Gets available presets from configuration and preset files.
   * @param params - Route parameters (may contain 'detailed' flag)
   * @returns List of preset names or detailed preset objects
   */
  private async getPresets(params: RouteParams, _queryParams?: URLSearchParams): Promise<ApiResponse> {
    const configPresets = this.config.presets || {};
    const folderPresets = this.presetLoader ? this.presetLoader.getAllPresets() : {};
    const allPresets = { ...configPresets, ...folderPresets };
    
    // Check if this is a detailed request (path contains 'detailed')
    const isDetailed = params['detailed'] === 'detailed';
    
    if (isDetailed) {
      // Return full preset objects with metadata
      return {
        status: 200,
        body: {
          config: configPresets,
          folder: folderPresets,
          all: allPresets
        }
      };
    } else {
      // Return just an array of preset names
      return {
        status: 200,
        body: Object.keys(allPresets)
      };
    }
  }

  // Room-specific endpoints
  /**
   * Gets comprehensive state for a specific room.
   * Includes playback state, volume, track info, play modes, and equalizer settings.
   * @param params - Route parameters containing room name
   * @returns Complete room state information
   */
  private async getRoomState({ room }: RouteParams): Promise<ApiResponse> {
    if (!room) throw createError(400, 'Room parameter is required');
    const device = this.getDevice(room);
    
    // Determine if we should use coordinator for certain info
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    // Get transport settings for playMode information from the coordinator
    let playMode = {
      repeat: 'none',
      shuffle: false,
      crossfade: false
    };
    
    try {
      // Get transport settings for repeat/shuffle from coordinator
      const transportSettings = await coordinator.getTransportSettings();
      const mode = transportSettings.PlayMode || 'NORMAL';
      
      // Get crossfade mode separately
      let crossfade = false;
      try {
        const crossfadeMode = await coordinator.getCrossfadeMode();
        crossfade = crossfadeMode.CrossfadeMode === '1';
      } catch (_e) {
        // Some devices might not support crossfade
        logger.debug(`Crossfade not supported for ${room}`);
      }
      
      playMode = {
        repeat: mode.includes('REPEAT_ONE') ? 'one' : 
          (mode.includes('REPEAT') || mode === 'SHUFFLE') ? 'all' : 'none',
        shuffle: mode.includes('SHUFFLE'),
        crossfade
      };
    } catch (error) {
      logger.debug(`Failed to get transport settings for ${room}:`, error);
    }
    
    // Get position info and track data from coordinator
    let relTime = 0;
    let trackNo = 0;
    let currentTrack = null;
    const nextTrack = null;
    
    try {
      const positionInfo = await coordinator.getPositionInfo();
      
      // Parse time format "0:00:00" to seconds
      if (positionInfo.RelTime && positionInfo.RelTime !== 'NOT_IMPLEMENTED') {
        const parts = positionInfo.RelTime.split(':');
        relTime = parseInt(parts[0] || '0') * 3600 + parseInt(parts[1] || '0') * 60 + parseInt(parts[2] || '0');
      }
      trackNo = parseInt(positionInfo.Track) || 0;
      
      // Get current track from coordinator's state
      currentTrack = coordinator.state.currentTrack;
    } catch (error) {
      logger.debug(`Failed to get position info from coordinator for ${room}:`, error);
    }
    
    // Get equalizer settings
    let equalizer = {
      bass: 0,
      treble: 0,
      loudness: false
    };
    
    try {
      // Get RenderingControl properties for equalizer
      const bass = await device.soap('RenderingControl', 'GetBass', { InstanceID: 0, Channel: 'Master' });
      const treble = await device.soap('RenderingControl', 'GetTreble', { InstanceID: 0, Channel: 'Master' });
      const loudness = await device.soap('RenderingControl', 'GetLoudness', { InstanceID: 0, Channel: 'Master' });
      
      equalizer = {
        bass: parseInt(bass.CurrentBass) || 0,
        treble: parseInt(treble.CurrentTreble) || 0,
        loudness: loudness.CurrentLoudness === '1' || loudness.CurrentLoudness === 1
      };
    } catch (error) {
      logger.debug(`Failed to get equalizer settings for ${room}:`, error);
    }
    
    // Create a safe copy of the state without circular references
    const safeState = {
      // Use coordinator's track info if this device is not the coordinator
      currentTrack: currentTrack || coordinator.state.currentTrack || {
        artist: '',
        title: '',
        album: '',
        albumArtUri: '',
        duration: 0,
        uri: '',
        trackUri: '',
        type: 'track',
        stationName: ''
      },
      nextTrack: nextTrack || {
        artist: '',
        title: '',
        album: '',
        albumArtUri: '',
        duration: 0,
        uri: ''
      },
      playMode,
      playlistName: '',  // TODO: Implement playlist name detection
      relTime,
      stateTime: Date.now(),
      volume: device.state.volume,  // Volume is device-specific
      mute: device.state.mute,      // Mute is device-specific
      trackNo,
      playbackState: coordinator.state.playbackState,  // Playback state from coordinator
      equalizer,
      ip: device.ip,  // Device IP address
      // Keep our additional field
      coordinator: coordinator.id !== device.id ? {
        id: coordinator.id,
        roomName: coordinator.roomName,
        modelName: coordinator.modelName
      } : undefined
    };
    
    return { status: 200, body: safeState };
  }

  /**
   * Starts playback in the specified room.
   * Routes to coordinator if room is part of a group.
   * @param params - Route parameters containing room name
   * @returns Success response
   */
  private async play({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.play();
    return { status: 200, body: { status: 'success' } };
  }

  /**
   * Pauses playback in the specified room.
   * Routes to coordinator if room is part of a group.
   * @param params - Route parameters containing room name
   * @returns Success response
   */
  private async pause({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.pause();
    return { status: 200, body: { status: 'success' } };
  }

  /**
   * Toggles between play and pause based on current state.
   * Fetches fresh transport info to ensure accurate state.
   * @param params - Route parameters containing room name
   * @returns Success response
   */
  private async playPause({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    // Get fresh transport info to ensure we have the current state
    const transportInfo = await coordinator.getTransportInfo();
    const currentState = transportInfo.CurrentTransportState;
    
    logger.debug(`PlayPause: current state is ${currentState}`);
    
    if (currentState === 'PLAYING') {
      await coordinator.pause();
    } else {
      await coordinator.play();
    }
    return { status: 200, body: { status: 'success' } };
  }

  private async stop({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.stop();
    return { status: 200, body: { status: 'success' } };
  }

  private async next({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.next();
    return { status: 200, body: { status: 'success' } };
  }

  private async previous({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.previous();
    return { status: 200, body: { status: 'success' } };
  }

  /**
   * Sets the volume for a specific room.
   * Supports absolute values (0-100) and relative changes (+5, -10).
   * @param params - Route parameters containing room name and volume level
   * @returns Success response
   */
  private async setVolume({ room, level }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!level) throw createError(400, 'Level parameter is required');
    const device = this.getDevice(room);
    const volumeLevel = parseInt(level, 10);
    
    if (isNaN(volumeLevel) || volumeLevel < 0 || volumeLevel > 100) {
      throw createError(400, 'Volume must be between 0 and 100');
    }
    
    await device.setVolume(volumeLevel);
    return { status: 200, body: { status: 'success' } };
  }

  private async volumeUp({ room, delta }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!delta) throw createError(400, 'Delta parameter is required');
    const device = this.getDevice(room);
    const deltaValue = parseInt(delta, 10);
    
    if (isNaN(deltaValue)) {
      throw createError(400, 'Volume delta must be a number');
    }
    
    // Get current volume from device to ensure it's up-to-date
    const volumeResponse = await device.getVolume();
    const currentVolume = parseInt(volumeResponse.CurrentVolume, 10);
    await device.setVolume(currentVolume + deltaValue);
    return { status: 200, body: { status: 'success' } };
  }

  private async volumeDown({ room, delta }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!delta) throw createError(400, 'Delta parameter is required');
    const device = this.getDevice(room);
    const deltaValue = parseInt(delta, 10);
    
    if (isNaN(deltaValue)) {
      throw createError(400, 'Volume delta must be a number');
    }
    
    // Get current volume from device to ensure it's up-to-date
    const volumeResponse = await device.getVolume();
    const currentVolume = parseInt(volumeResponse.CurrentVolume, 10);
    await device.setVolume(currentVolume - deltaValue);
    return { status: 200, body: { status: 'success' } };
  }

  private async mute({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    const device = this.getDevice(room);
    await device.setMute(true);
    return { status: 200, body: { status: 'success' } };
  }

  private async unmute({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    const device = this.getDevice(room);
    await device.setMute(false);
    return { status: 200, body: { status: 'success' } };
  }

  private async toggleMute({ room }: RouteParams): Promise<ApiResponse<{status: string, muted: boolean}>> {
    if (!room) throw createError(400, 'Room parameter is required');
    const device = this.getDevice(room);
    const currentMute = device.state.mute;
    await device.setMute(!currentMute);
    return { status: 200, body: { status: 'success', muted: !currentMute } };
  }

  private async playPreset({ room, preset }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!preset) throw createError(400, 'Preset parameter is required');
    
    // Get the device, but check if we need to route to coordinator
    let device = this.getDevice(room);
    
    // If we have topology data, check if this device is the coordinator
    const coordinator = this.discovery.getCoordinator(device.id);
    if (coordinator && coordinator.id !== device.id) {
      debugManager.info('api', `Routing ${room} preset request to coordinator: ${coordinator.roomName}`);
      device = coordinator;
    }
    
    // Look in config presets first, then folder presets
    let presetConfig = this.config.presets[preset];
    if (!presetConfig && this.presetLoader) {
      presetConfig = await this.presetLoader.getPreset(preset);
    }
    
    if (!presetConfig) {
      throw createError(404, `Preset '${preset}' not found`);
    }

    await device.playPreset(presetConfig, this.discovery);
    return { status: 200, body: { status: 'success' } };
  }

  // Global endpoints
  private async pauseAll(): Promise<ApiResponse<SuccessResponse>> {
    const devices = this.discovery.getAllDevices();
    
    // Only pause coordinators to avoid duplicate commands
    const coordinators = devices.filter(device => this.discovery.isCoordinator(device.id));
    
    await Promise.all(coordinators.map(async device => {
      try {
        // Only pause if the device is actually playing
        if (device.state.playbackState === 'PLAYING') {
          await device.pause();
        }
      } catch (err) {
        logger.error(`Error pausing ${device.roomName}:`, err);
      }
    }));
    return { status: 200, body: { status: 'success' } };
  }


  // Group management endpoints
  private async joinGroup({ room, targetRoom }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!targetRoom) throw createError(400, 'Target room parameter is required');
    
    const device = this.getDevice(room);
    const targetDevice = this.getDevice(targetRoom);
    
    // Get the coordinator of the source device (handles stereo pairs)
    const sourceCoordinator = this.discovery.getCoordinator(device.id) || device;
    
    // Get the coordinator of the target room's group
    const targetCoordinator = this.discovery.getCoordinator(targetDevice.id) || targetDevice;
    
    // Don't join to self
    if (sourceCoordinator.id === targetCoordinator.id) {
      debugManager.debug('api', `${room} is already in the same group as ${targetRoom}`);
      return { status: 200, body: { status: 'success' } };
    }
    
    try {
      // First, make the source device leave its current group (if in one)
      debugManager.debug('api', `Making ${sourceCoordinator.roomName} leave its current group`);
      await sourceCoordinator.becomeCoordinatorOfStandaloneGroup();
    } catch (error) {
      // It's OK if this fails - device might already be standalone
      debugManager.debug('api', `${sourceCoordinator.roomName} leave group failed (might already be standalone):`, error);
    }
    
    // Then join the target coordinator's group
    debugManager.debug('api', `Adding ${sourceCoordinator.roomName} to ${targetCoordinator.roomName}'s group`);
    await sourceCoordinator.addPlayerToGroup(targetCoordinator.id.replace('uuid:', ''));
    
    return { status: 200, body: { status: 'success' } };
  }

  private async leaveGroup({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    
    const device = this.getDevice(room);
    
    // Get current zone information
    const zones = this.discovery.getZones();
    const deviceZone = zones.find(zone => 
      zone.members.some(member => member.roomName.toLowerCase() === room.toLowerCase())
    );
    
    if (!deviceZone) {
      throw createError(404, `Room '${room}' not found in any zone`);
    }
    
    // Only block breaking up pure stereo pairs (exactly 2 members with same room name in zone)
    // Allow stereo pairs to leave larger groups (more than 2 members total)
    if (deviceZone.members.length === 2) {
      const uniqueRoomNames = new Set(deviceZone.members.map(m => m.roomName));
      if (uniqueRoomNames.size === 1) {
        // This is a pure stereo pair - cannot be broken
        throw createError(400, `Cannot break stereo pair '${room}'. Stereo pairs can only be separated using the Sonos app.`);
      }
    }
    
    // Try to make the device leave
    try {
      await device.becomeCoordinatorOfStandaloneGroup();
      debugManager.debug('api', `${room} left group successfully`);
      return { status: 200, body: { status: 'success' } };
    } catch (error) {
      // Check if this is because the device is already the coordinator
      if (errorMessageIncludes(error, '1023') || errorMessageIncludes(error, '701')) {
        throw createError(400, `Cannot ungroup '${room}': It appears to be the group coordinator. Other members must leave first.`);
      }
      
      // For stereo pairs, we need to find the primary (left) speaker
      const membersWithSameRoom = deviceZone.members.filter(m => m.roomName === room);
      if (membersWithSameRoom.length > 1) {
        debugManager.debug('api', `First device failed for stereo pair ${room}, looking for primary speaker`);
        
        // Get the stereo pair primary from topology
        const primaryUuid = this.discovery.topologyManager.getStereoPairPrimary(room);
        if (primaryUuid) {
          // Add uuid: prefix if not present
          const primaryId = primaryUuid.startsWith('uuid:') ? primaryUuid : `uuid:${primaryUuid}`;
          debugManager.debug('api', `Looking for primary device with ID: ${primaryId}`);
          const primaryDevice = this.discovery.getDeviceById(primaryId);
          debugManager.debug('api', `Primary device lookup result: ${primaryDevice ? primaryDevice.id : 'not found'}`);
          if (primaryDevice && primaryDevice.id !== device.id) {
            try {
              debugManager.debug('api', `Trying stereo pair primary device ${primaryDevice.id} for ${room}`);
              await primaryDevice.becomeCoordinatorOfStandaloneGroup();
              debugManager.debug('api', `${room} left group successfully via primary device ${primaryDevice.id}`);
              return { status: 200, body: { status: 'success' } };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (e: any) { // ANY IS CORRECT: need to access e.message property
              debugManager.debug('api', `Primary device ${primaryDevice.id} also failed: ${e.message}`);
            }
          }
        }
        
        // Fallback: try all devices with this room name
        for (const member of membersWithSameRoom) {
          debugManager.debug('api', `Checking member ${member.id} for room ${room}`);
          const memberDevice = this.discovery.getDeviceById(member.id);
          if (memberDevice) {
            debugManager.debug('api', `Found device ${memberDevice.id}, original device was ${device.id}`);
            if (memberDevice.id !== device.id) {
              try {
                debugManager.debug('api', `Trying device ${memberDevice.id} for stereo pair ${room}`);
                await memberDevice.becomeCoordinatorOfStandaloneGroup();
                debugManager.debug('api', `${room} left group successfully via device ${member.id}`);
                return { status: 200, body: { status: 'success' } };
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } catch (e: any) { // ANY IS CORRECT: need to access e.message property
                // Continue trying other devices
                debugManager.debug('api', `Device ${member.id} also failed: ${e.message}`);
              }
            } else {
              debugManager.debug('api', `Skipping same device ${memberDevice.id}`);
            }
          } else {
            debugManager.debug('api', `Could not find device for member ${member.id}`);
          }
        }
      }
      
      // All attempts failed
      throw error;
    }
  }

  private async addToGroup({ room, otherRoom }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!otherRoom) throw createError(400, 'Other room parameter is required');
    
    const device = this.getDevice(room);
    const otherDevice = this.getDevice(otherRoom);
    
    // Get the coordinator of this room's group
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    // Make the other device join this coordinator's group
    await otherDevice.addPlayerToGroup(coordinator.id.replace('uuid:', ''));
    
    return { status: 200, body: { status: 'success' } };
  }

  // Favorites endpoints
  private async getFavorites(params: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse> {
    const { room, detailed } = params;
    if (!room) throw createError(400, 'Room parameter is required');
    
    const device = this.getDevice(room);
    const { FavoritesManager } = await import('./actions/favorites.js');
    const favoritesManager = new FavoritesManager();
    
    const favorites = await favoritesManager.getFavorites(device);
    
    // Support both /detailed path parameter and ?detailed=true query parameter
    const isDetailed = detailed === 'detailed' || queryParams?.get('detailed') === 'true';
    
    if (isDetailed) {
      return { status: 200, body: favorites };
    } else {
      // Return just the titles
      return { status: 200, body: favorites.map(f => f.title) };
    }
  }

  private async playFavorite({ room, name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!name) throw createError(400, 'Favorite name is required');
    
    const device = this.getDevice(room);
    const { FavoritesManager } = await import('./actions/favorites.js');
    const favoritesManager = new FavoritesManager();
    
    const favorite = await favoritesManager.findFavoriteByName(device, name);
    
    if (!favorite) {
      throw createError(404, `Favorite '${name}' not found`);
    }
    
    // Get coordinator and play on it
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.playUri(favorite.uri, favorite.metadata, this.discovery);
    
    // Play the favorite (matching legacy behavior)
    await coordinator.play();
    
    return { status: 200, body: { status: 'success' } };
  }

  // Playlists endpoints
  private async getPlaylists(params: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse> {
    const { room, detailed } = params;
    if (!room) throw createError(400, 'Room parameter is required');
    
    const device = this.getDevice(room);
    
    // Browse for playlists using ContentDirectory
    const playlists = await device.browse('SQ:', 0, 100);
    
    // Support both /detailed path parameter and ?detailed=true query parameter
    const isDetailed = detailed === 'detailed' || queryParams?.get('detailed') === 'true';
    
    if (isDetailed) {
      return { status: 200, body: playlists.items };
    } else {
      // Return just the titles
      return { status: 200, body: playlists.items.map((p: BrowseItem) => p.title) };
    }
  }

  private async playPlaylist({ room, name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!name) throw createError(400, 'Playlist name is required');
    
    const device = this.getDevice(room);
    
    // Browse for playlists
    const playlists = await device.browse('SQ:', 0, 100);
    
    // Find playlist by name (case-insensitive)
    const playlist = playlists.items.find((p: BrowseItem) => 
      p.title.toLowerCase() === name.toLowerCase()
    );
    
    if (!playlist) {
      throw createError(404, `Playlist '${name}' not found`);
    }
    
    // Get coordinator and replace queue with playlist
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.playUri(playlist.uri, playlist.metadata || '', this.discovery);
    
    // Play the playlist (matching legacy behavior)
    await coordinator.play();
    
    return { status: 200, body: { status: 'success' } };
  }

  // Apple Music endpoint
  private async appleMusic({ room, action, id }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!action) throw createError(400, 'Action parameter is required');
    if (!id) throw createError(400, 'ID parameter is required');
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    // Parse the ID format (e.g., "song:123456")
    const [type, contentId] = id.split(':');
    if (!type || !contentId) {
      throw createError(400, 'Invalid ID format. Expected format: type:id (e.g., song:123456)');
    }
    
    // Generate Apple Music URI and metadata
    const { uri, metadata } = this.generateAppleMusicContent(type, contentId);
    
    switch (action) {
    case 'now':
      // Replace queue and play immediately
      await coordinator.playUri(uri, metadata, this.discovery);
      // playUri already calls play(), so no need to call it again
      break;
      
    case 'next': {
      // Add as next track in queue
      const currentTrackNo = coordinator.state.currentTrack ? 1 : 0; // If playing, insert after current
      await coordinator.addURIToQueue(uri, metadata, true, currentTrackNo + 1);
      break;
    }
      
    case 'queue':
      // Add to end of queue
      await coordinator.addURIToQueue(uri, metadata, false, 0);
      break;
      
    default:
      throw createError(400, `Invalid action '${action}'. Valid actions: now, next, queue`);
    }
    
    return { status: 200, body: { status: 'success' } };
  }

  private generateAppleMusicContent(type: string, id: string): { uri: string; metadata: string } {
    const encodedId = encodeURIComponent(`${type}:${id}`);
    
    const uriTemplates: Record<string, string> = {
      song: `x-sonos-http:${encodedId}.mp4?sid=204&flags=8224&sn=4`,
      album: `x-rincon-cpcontainer:0004206c${encodedId}`,
      playlist: `x-rincon-cpcontainer:1006206c${encodedId}`
    };
    
    const metadataStarters: Record<string, string> = {
      song: '00032020',
      album: '0004206c',
      playlist: '1006206c'
    };
    
    const classes: Record<string, string> = {
      song: 'object.item.audioItem.musicTrack',
      album: 'object.item.audioItem.musicAlbum',
      playlist: 'object.container.playlistContainer.#PlaylistView'
    };
    
    const parents: Record<string, string> = {
      song: '0004206calbum%3a',
      album: '00020000album%3a',
      playlist: '1006206cplaylist%3a'
    };
    
    if (!uriTemplates[type]) {
      throw createError(400, `Invalid type '${type}'. Valid types: song, album, playlist`);
    }
    
    const uri = uriTemplates[type];
    const metadataId = metadataStarters[type] + encodedId;
    
    // Generate DIDL-Lite metadata
    const metadata = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"
    xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
    <item id="${metadataId}" parentID="${parents[type]}" restricted="true">
      <dc:title></dc:title>
      <upnp:class>${classes[type]}</upnp:class>
      <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON52231_X_#Svc52231-0-Token</desc>
    </item></DIDL-Lite>`;
    
    return { uri, metadata };
  }

  // Debug endpoints
  private async getDebugStatus(): Promise<ApiResponse> {
    return {
      status: 200,
      body: {
        logLevel: debugManager.getLogLevel(),
        categories: debugManager.getCategories(),
        usage: {
          level: 'GET /debug/level/{level} - Set log level (error|warn|info|debug|trace)',
          category: 'GET /debug/category/{category}/{enabled} - Enable/disable category (true|false)',
          enableAll: 'GET /debug/enable-all - Enable all debug categories',
          disableAll: 'GET /debug/disable-all - Disable all debug categories (except API)',
          categories: 'soap, topology, discovery, favorites, presets, upnp, api, sse'
        }
      }
    };
  }

  private async setDebugLevel({ level }: RouteParams): Promise<ApiResponse> {
    if (!level) throw createError(400, 'Level parameter is required');
    
    const validLevels: LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];
    if (!validLevels.includes(level as LogLevel)) {
      throw createError(400, `Invalid log level. Must be one of: ${validLevels.join(', ')}`);
    }

    // Note: This now sets both debugManager and winston logger levels to keep them in sync
    debugManager.setLogLevel(level as LogLevel);
    return { status: 200, body: { status: 'success', logLevel: level } };
  }

  private async setDebugCategory({ category, enabled }: RouteParams): Promise<ApiResponse> {
    if (!category) throw createError(400, 'Category parameter is required');
    if (!enabled) throw createError(400, 'Enabled parameter is required');

    const validCategories: (keyof DebugCategories)[] = ['soap', 'topology', 'discovery', 'favorites', 'presets', 'upnp', 'api', 'sse'];
    if (!validCategories.includes(category as keyof DebugCategories)) {
      throw createError(400, `Invalid category. Must be one of: ${validCategories.join(', ')}`);
    }

    const isEnabled = enabled.toLowerCase() === 'true';
    debugManager.setCategory(category as keyof DebugCategories, isEnabled);
    
    return { 
      status: 200, 
      body: { 
        status: 'success', 
        category,
        enabled: isEnabled 
      } 
    };
  }

  private async enableAllDebug(): Promise<ApiResponse> {
    debugManager.enableAll();
    return { 
      status: 200, 
      body: { 
        status: 'success', 
        message: 'All debug categories enabled',
        categories: debugManager.getCategories()
      } 
    };
  }

  private async disableAllDebug(): Promise<ApiResponse> {
    debugManager.disableAll();
    return { 
      status: 200, 
      body: { 
        status: 'success', 
        message: 'All debug categories disabled (except API)',
        categories: debugManager.getCategories()
      } 
    };
  }
  
  private async getStartupInfo(): Promise<ApiResponse> {
    return {
      status: 200,
      body: this.startupInfo
    };
  }
  
  private async getStartupConfig(): Promise<ApiResponse> {
    return {
      status: 200,
      body: this.startupInfo.config
    };
  }
  
  private async getDeviceHealth(): Promise<ApiResponse> {
    const eventManager = EventManager.getInstance();
    const health = eventManager.getDeviceHealth();
    
    // Convert Map to object for JSON serialization
    interface DeviceHealthStatus {
      registered: boolean;
      hasListener: boolean;
      lastEventMs: number | null;
      healthy: boolean;
      staleNotify: boolean;
      roomName?: string;
      modelName?: string;
      ip?: string;
    }
    const healthData: Record<string, DeviceHealthStatus> = {};
    for (const [deviceId, status] of health) {
      // DeviceId might have uuid: prefix or not
      const device = this.discovery.getDeviceById(deviceId) || 
                    this.discovery.getDeviceById(deviceId.replace('uuid:', '')) ||
                    this.discovery.getDeviceById(`uuid:${deviceId}`);
      healthData[deviceId] = {
        ...status,
        roomName: device?.roomName || 'Unknown',
        modelName: device?.modelName || 'Unknown',
        ip: device?.ip || 'Unknown'
      };
    }
    
    // Get stale devices
    const staleDevices = eventManager.getStaleNotifyDevices();
    const unhealthyDevices = eventManager.getUnhealthyDevices();
    
    return {
      status: 200,
      body: {
        devices: healthData,
        summary: {
          totalRegistered: eventManager['registeredDevices'].size,
          totalWithListeners: eventManager['deviceListeners'].size,
          staleNotifyCount: staleDevices.length,
          unhealthyCount: unhealthyDevices.length,
          staleDeviceIds: staleDevices,
          unhealthyDeviceIds: unhealthyDevices
        }
      }
    };
  }
  
  private async getSchedulerStatus(): Promise<ApiResponse> {
    const status = scheduler.getStatus();
    const tasks = scheduler.getDetailedTasks();
    
    return {
      status: 200,
      body: {
        enabled: status.enabled,
        taskCount: status.taskCount,
        tasks: tasks
      }
    };
  }
  
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateStartupInfo(category: string, data: any): void { // ANY IS CORRECT: data can be any type of startup information
    this.startupInfo[category] = {
      ...this.startupInfo[category],
      ...data,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Update readiness status for a component
   */
  updateReadiness(component: string, ready: boolean): void {
    this.startupInfo.readiness[component] = ready;
    if (ready) {
      this.startupInfo.readinessTimes[component] = new Date().toISOString();
    }
    
    // Check if all components are ready
    const allReady = Object.entries(this.startupInfo.readiness)
      .filter(([key]) => key !== 'allReady')
      .every(([, value]) => value === true);
    
    if (allReady && !this.startupInfo.readiness.allReady) {
      this.startupInfo.readiness.allReady = true;
      this.startupInfo.readinessTimes.allReady = new Date().toISOString();
      logger.info('All system components are ready');
    }
  }
  
  // Default room management endpoints
  private async getDefaults(): Promise<ApiResponse> {
    return {
      status: 200,
      body: this.defaultRoomManager.getSettings()
    };
  }
  
  private async setDefaultRoom({ room }: RouteParams): Promise<ApiResponse> {
    if (!room) throw createError(400, 'Room parameter is required');
    
    // Verify room exists
    const device = this.discovery.getDevice(room);
    if (!device) {
      throw createError(404, `Room '${room}' not found`);
    }
    
    this.defaultRoomManager.setDefaults(room);
    return {
      status: 200,
      body: {
        status: 'success',
        defaultRoom: room
      }
    };
  }
  
  private async setDefaultService({ service }: RouteParams): Promise<ApiResponse> {
    if (!service) throw createError(400, 'Service parameter is required');
    
    // Validate service (could expand this list as more services are implemented)
    const validServices = ['library', 'apple', 'spotify', 'amazon', 'pandora', 'tunein', 'siriusxm'];
    if (!validServices.includes(service.toLowerCase())) {
      throw createError(400, `Invalid service. Valid services: ${validServices.join(', ')}`);
    }
    
    this.defaultRoomManager.setDefaults(undefined, service);
    return {
      status: 200,
      body: {
        status: 'success',
        defaultMusicService: service
      }
    };
  }
  
  // Room-less endpoints that use default room
  private async playDefault(): Promise<ApiResponse<SuccessResponse>> {
    const device = this.getDevice(undefined); // Will use default room
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.play();
    return { status: 200, body: { status: 'success' } };
  }
  
  private async pauseDefault(): Promise<ApiResponse<SuccessResponse>> {
    const device = this.getDevice(undefined); // Will use default room
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.pause();
    return { status: 200, body: { status: 'success' } };
  }
  
  private async setVolumeDefault({ level }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!level) throw createError(400, 'Level parameter is required');
    const device = this.getDevice(undefined); // Will use default room
    const volumeLevel = parseInt(level, 10);
    
    if (isNaN(volumeLevel) || volumeLevel < 0 || volumeLevel > 100) {
      throw createError(400, 'Volume must be between 0 and 100');
    }
    
    await device.setVolume(volumeLevel);
    return { status: 200, body: { status: 'success' } };
  }
  
  private async playPresetDefault({ preset }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!preset) throw createError(400, 'Preset parameter is required');
    
    const device = this.getDevice(undefined); // Will use default room
    
    // Look in config presets first, then folder presets
    let presetConfig = this.config.presets[preset];
    if (!presetConfig && this.presetLoader) {
      presetConfig = await this.presetLoader.getPreset(preset);
    }
    
    if (!presetConfig) {
      throw createError(404, `Preset '${preset}' not found`);
    }
    
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.playPreset(presetConfig, this.discovery);
    return { status: 200, body: { status: 'success' } };
  }
  
  private async playPresetInRoom({ preset, room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!preset) throw createError(400, 'Preset parameter is required');
    if (!room) throw createError(400, 'Room parameter is required');
    
    // This is the same as playPreset but with different route format
    return this.playPreset({ room, preset });
  }
  
  // Default music search endpoints (use default room and service)
  private async musicSearchSongDefault({ query }: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse<SuccessResponse>> {
    if (!query) throw createError(400, 'Query is required');
    
    const room = this.defaultRoomManager.getRoom();
    if (!room) throw createError(400, 'No default room set');
    
    const service = this.defaultRoomManager.getMusicService();
    
    return this.performMusicSearch(room, service, 'song', query, queryParams);
  }
  
  private async musicSearchAlbumDefault({ name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!name) throw createError(400, 'Album name is required');
    
    const room = this.defaultRoomManager.getRoom();
    if (!room) throw createError(400, 'No default room set');
    
    const service = this.defaultRoomManager.getMusicService();
    
    return this.performMusicSearch(room, service, 'album', name);
  }
  
  private async musicSearchStationDefault({ name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!name) throw createError(400, 'Station name is required');
    
    const room = this.defaultRoomManager.getRoom();
    if (!room) throw createError(400, 'No default room set');
    
    const service = this.defaultRoomManager.getMusicService();
    
    return this.performMusicSearch(room, service, 'station', name);
  }

  private async musicSearchArtistDefault({ name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!name) throw createError(400, 'Artist name is required');
    
    const room = this.defaultRoomManager.getRoom();
    if (!room) throw createError(400, 'No default room set');
    
    const service = this.defaultRoomManager.getMusicService();
    
    return this.performMusicSearch(room, service, 'artist', name);
  }
  
  // Music search endpoints
  private async musicSearchAlbum({ room, service, name }: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!service) throw createError(400, 'Service parameter is required');
    if (!name) throw createError(400, 'Album name is required');
    
    return this.performMusicSearch(room, service, 'album', name, queryParams);
  }
  
  private async musicSearchSong({ room, service, query }: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!service) throw createError(400, 'Service parameter is required');
    if (!query) throw createError(400, 'Query is required');
    
    return this.performMusicSearch(room, service, 'song', query, queryParams);
  }
  
  private async musicSearchStation({ room, service, name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!service) throw createError(400, 'Service parameter is required');
    if (!name) throw createError(400, 'Station name is required');
    
    return this.performMusicSearch(room, service, 'station', name);
  }

  private async musicSearchArtist({ room, service, name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!service) throw createError(400, 'Service parameter is required');
    if (!name) throw createError(400, 'Artist name is required');
    
    return this.performMusicSearch(room, service, 'artist', name);
  }
  
  // Music library search endpoints
  private async musicLibrarySearchSong({ room, query }: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse<MusicSearchSuccessResponse | LibrarySearchSuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!query) throw createError(400, 'Query parameter is required');
    
    if (!this.musicLibraryCache) {
      throw createError(503, 'Music library not yet indexed');
    }
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    try {
      let results = await this.musicLibraryCache.search(query, 'title', 50);
      
      // If the query contains "artist:" but no "track:" or "album:", try album first then track
      if (results.length === 0 && query.toLowerCase().includes('artist:') && 
          !query.toLowerCase().includes('track:') && !query.toLowerCase().includes('album:')) {
        
        // First try as album search
        const albumQuery = 'album: ' + query;
        results = await this.musicLibraryCache.search(albumQuery, 'title', 50);
        
        // If no album found, try as track search
        if (results.length === 0) {
          const trackQuery = 'track: ' + query;
          results = await this.musicLibraryCache.search(trackQuery, 'title', 50);
        }
      }
      
      if (results.length === 0) {
        throw createError(404, `No songs found matching: ${query}`);
      }
      
      // Check if play=false to return results only
      const shouldPlay = queryParams?.get('play') !== 'false';
      
      // Clear the queue first
      await coordinator.clearQueue();
      
      // Add the first result to queue
      await coordinator.addURIToQueue(results[0]!.uri, '');
      
      // If play=true (default), start playback
      if (shouldPlay) {
        await coordinator.play();
      }
      
      // Add the rest of the results to queue
      for (let i = 1; i < results.length; i++) {
        await coordinator.addURIToQueue(results[i]!.uri, '');
      }
      
      // Return results in both cases
      if (!shouldPlay) {
        return {
          status: 200,
          body: {
            status: 'success',
            service: 'library',
            type: 'song',
            query: query,
            results: results.map(r => ({
              title: r.title,
              artist: r.artist,
              album: r.album,
              uri: r.uri,
              id: r.id,
              type: 'track' as const
            }))
          }
        };
      }
      
      return {
        status: 200,
        body: {
          status: 'success',
          title: results[0]!.title,
          artist: results[0]!.artist,
          album: results[0]!.album,
          service: 'library'
        }
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) {
        throw error;
      }
      throw createError(500, `Library search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  private async musicLibrarySearchArtist({ room, query }: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse<MusicSearchSuccessResponse | LibrarySearchSuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!query) throw createError(400, 'Query parameter is required');
    
    if (!this.musicLibraryCache) {
      throw createError(503, 'Music library not yet indexed');
    }
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    try {
      const results = await this.musicLibraryCache.search(query, 'artist', 50);
      
      if (results.length === 0) {
        throw createError(404, `No tracks by artist matching: ${query}`);
      }
      
      // Check if play=false to return results only
      const shouldPlay = queryParams?.get('play') !== 'false';
      
      // Clear the queue first
      await coordinator.clearQueue();
      
      // Add the first result to queue
      await coordinator.addURIToQueue(results[0]!.uri, '');
      
      // If play=true (default), start playback
      if (shouldPlay) {
        await coordinator.play();
      }
      
      // Add the rest of the results to queue
      for (let i = 1; i < results.length; i++) {
        await coordinator.addURIToQueue(results[i]!.uri, '');
      }
      
      // Return results in both cases
      if (!shouldPlay) {
        return {
          status: 200,
          body: {
            status: 'success',
            service: 'library',
            type: 'artist',
            query: query,
            results: results.map(r => ({
              title: r.title,
              artist: r.artist,
              album: r.album,
              uri: r.uri,
              id: r.id,
              type: 'track' as const
            }))
          }
        };
      }
      
      // For play=true, return the first track info
      const track = results[0]!;
      
      return {
        status: 200,
        body: {
          status: 'success',
          title: track.title,
          artist: track.artist,
          album: track.album,
          service: 'library'
        }
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) {
        throw error;
      }
      throw createError(500, `Library search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  private async musicLibrarySearchAlbum({ room, query }: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse<MusicSearchSuccessResponse | LibrarySearchSuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!query) throw createError(400, 'Query parameter is required');
    
    if (!this.musicLibraryCache) {
      throw createError(503, 'Music library not yet indexed');
    }
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    try {
      const results = await this.musicLibraryCache.search(query, 'album', 50);
      
      if (results.length === 0) {
        throw createError(404, `No tracks from album matching: ${query}`);
      }
      
      // Check if play=false to return results only
      const shouldPlay = queryParams?.get('play') !== 'false';
      
      // Clear the queue first
      await coordinator.clearQueue();
      
      // Add the first result to queue
      await coordinator.addURIToQueue(results[0]!.uri, '');
      
      // If play=true (default), start playback
      if (shouldPlay) {
        await coordinator.play();
      }
      
      // Add the rest of the results to queue
      for (let i = 1; i < results.length; i++) {
        await coordinator.addURIToQueue(results[i]!.uri, '');
      }
      
      // Return results in both cases
      if (!shouldPlay) {
        return {
          status: 200,
          body: {
            status: 'success',
            service: 'library',
            type: 'album',
            query: query,
            results: results.map(r => ({
              title: r.title,
              artist: r.artist,
              album: r.album,
              uri: r.uri,
              id: r.id,
              type: 'track' as const
            }))
          }
        };
      }
      
      // For play=true, return the first track info
      const track = results[0]!;
      
      return {
        status: 200,
        body: {
          status: 'success',
          title: track.title,
          artist: track.artist,
          album: track.album,
          service: 'library'
        }
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) {
        throw error;
      }
      throw createError(500, `Library search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getMusicLibraryStatus(): Promise<ApiResponse<any>> { // ANY IS CORRECT: returns various status objects
    if (!this.musicLibraryCache) {
      return { status: 200, body: { status: 'not initialized' } };
    }
    
    const status = this.musicLibraryCache.getStatus();
    return { status: 200, body: status };
  }
  
  private async refreshMusicLibrary(): Promise<ApiResponse<SuccessResponse>> {
    if (!this.musicLibraryCache) {
      await this.initializeMusicLibrary();
    } else {
      await this.musicLibraryCache.refreshCache();
    }
    
    return { status: 200, body: { status: 'success' } };
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getMusicLibrarySummary(): Promise<ApiResponse<any>> { // ANY IS CORRECT: returns summary object
    if (!this.musicLibraryCache) {
      return { status: 200, body: { status: 'not initialized' } };
    }
    
    const summary = this.musicLibraryCache.getSummary();
    const status = this.musicLibraryCache.getStatus();
    
    return { 
      status: 200, 
      body: {
        ...summary,
        lastUpdated: status.metadata?.lastUpdated,
        isIndexing: status.isIndexing,
        indexingProgress: status.progress
      }
    };
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getMusicLibraryDetailed(): Promise<ApiResponse<any>> { // ANY IS CORRECT: returns detailed library data
    if (!this.musicLibraryCache) {
      return { status: 200, body: { status: 'not initialized', tracks: [], artists: [], albums: [] } };
    }
    
    const detailedData = this.musicLibraryCache.getDetailedData();
    const status = this.musicLibraryCache.getStatus();
    
    return { 
      status: 200, 
      body: {
        ...detailedData,
        metadata: status.metadata,
        isIndexing: status.isIndexing
      }
    };
  }
  
  // Service-specific endpoints
  private async siriusXM({ room, name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!name) throw createError(400, 'Station name is required');
    
    // SiriusXM requires authentication and special handling
    throw createError(501, 'SiriusXM support not yet implemented');
  }
  
  
  private async pandoraPlay({ room, name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!name) throw createError(400, 'Station name is required');
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    try {
      const decodedName = decodeURIComponent(name);
      
      // Look up station from merged cache - NO API CALLS!
      logger.debug(`Looking up Pandora station '${decodedName}' in merged cache`);
      const station = this.pandoraStationManager.findStation(decodedName);
      
      if (!station) {
        logger.warn(`Station '${decodedName}' not found in merged station cache`);
        throw createError(404, `Pandora station '${decodedName}' not found`);
      }
      
      logger.info(`Found station in cache: ${station.stationName} (source: ${station.source})`);
      
      // Get current session number
      const { PandoraSessionHelper } = await import('./services/pandora-session.js');
      const sessionNumber = await PandoraSessionHelper.getSessionNumber(coordinator);
      logger.debug(`Using Pandora session number: ${sessionNumber}`);
      
      // Build the URI
      const encodedId = encodeURIComponent(station.stationId);
      const flags = station.flags || '40992'; // Default API flags + Sonos app bit
      const stationUri = `x-sonosapi-radio:ST%3a${encodedId}?sid=236&flags=${flags}&sn=${sessionNumber}`;
      
      // Generate metadata to match Sonos app format
      const metadata = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"
        xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/"
        xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
        <item id="100c206cST%3a${encodedId}" parentID="0" restricted="true">
          <dc:title>${station.stationName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</dc:title>
          <upnp:class>object.item.audioItem.audioBroadcast.#station</upnp:class>
          <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">
            SA_RINCON236_X_#Svc236-0-Token
          </desc>
        </item>
      </DIDL-Lite>`;
      
      // IMPORTANT: Pandora session management
      // Check if currently playing to avoid conflicts
      const currentState = await coordinator.getTransportInfo();
      if (currentState.CurrentTransportState === 'PLAYING') {
        logger.debug('Stopping current playback before switching Pandora station');
        await coordinator.stop();
        // Small delay to let the stop complete
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Set the new Pandora station URI with fresh metadata
      logger.debug(`Setting Pandora URI: ${stationUri}`);
      await coordinator.setAVTransportURI(stationUri, metadata);
      
      // Longer delay to let the URI setting complete and possibly auto-play
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if already playing (sometimes setAVTransportURI auto-plays)
      const newState = await coordinator.getTransportInfo();
      if (newState.CurrentTransportState !== 'PLAYING') {
        logger.debug('Starting Pandora playback');
        await coordinator.play();
      } else {
        logger.debug('Pandora already playing after setting URI');
      }
      
      // Update default room
      this.defaultRoomManager.setDefaults(room);
      
      return { status: 200, body: { status: 'success' } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      logger.error(`Failed to play Pandora station '${name}':`, error);
      throw createError(404, error.message || 'Failed to play Pandora station');
    }
  }
  
  private async pandoraThumbsUp({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    try {
      // Check if Pandora API is configured
      if (this.config.pandora?.username && this.config.pandora?.password) {
        logger.debug('Using Pandora API for thumbs up');
        const { PandoraService } = await import('./services/pandora-service.js');
        await PandoraService.sendFeedback(coordinator, true, this.config);
      } else {
        // Fall back to simple skip for thumbs up when no API
        logger.info('Pandora API not configured, thumbs up not available');
        throw new Error('Pandora credentials required for thumbs up/down');
      }
      
      return { status: 200, body: { status: 'success' } };
    } catch (error) {
      logger.error('Failed to send Pandora thumbs up:', error);
      throw createError(400, getErrorMessage(error) || 'Failed to send thumbs up');
    }
  }
  
  private async pandoraThumbsDown({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    try {
      // For thumbs down, always skip the track regardless of API availability
      logger.info('Skipping to next track for thumbs down');
      await coordinator.next();
      
      // Try to send feedback if API is configured, but don't fail if it doesn't work
      if (this.config.pandora?.username && this.config.pandora?.password) {
        logger.debug('Attempting to send thumbs down via Pandora API');
        try {
          const { PandoraService } = await import('./services/pandora-service.js');
          await PandoraService.sendFeedback(coordinator, false, this.config);
          logger.info('Thumbs down sent to Pandora');
        } catch (feedbackError) {
          logger.warn('Could not send thumbs down to Pandora API, but track was skipped:', feedbackError);
        }
      }
      
      // Update default room
      this.defaultRoomManager.setDefaults(room);
      
      return { status: 200, body: { status: 'success' } };
    } catch (error) {
      logger.error('Failed to send Pandora thumbs down:', error);
      throw createError(400, getErrorMessage(error) || 'Failed to send thumbs down');
    }
  }
  
  /**
   * Clear Pandora session endpoint
   */
  private async pandoraClear({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    await this.clearPandoraSession(coordinator);
    
    return { status: 200, body: { status: 'success' } };
  }
  
  private async pandoraAllStations(): Promise<ApiResponse> {
    const stations = this.pandoraStationManager.getAllStations();
    const stats = this.pandoraStationManager.getStats();
    
    return {
      status: 200,
      body: {
        stations: stations.map(s => ({
          id: s.stationId,
          name: s.stationName,
          source: s.source
        })),
        stats
      }
    };
  }
  
  private async pandoraStatus(): Promise<ApiResponse> {
    const hasCredentials = !!(this.config.pandora?.username && this.config.pandora?.password);
    const stats = this.pandoraStationManager.getStats();
    const authStatus = this.pandoraStationManager.getAuthStatus();
    const lastUpdated = (this.startupInfo.pandoraStations as { lastUpdated?: string })?.lastUpdated || null;
    
    // Calculate cache age
    let cacheAge = '';
    if (lastUpdated) {
      const updatedTime = new Date(lastUpdated).getTime();
      const now = Date.now();
      const ageMs = now - updatedTime;
      const ageMinutes = Math.floor(ageMs / 60000);
      const ageHours = Math.floor(ageMinutes / 60);
      const ageDays = Math.floor(ageHours / 24);
      
      if (ageDays > 0) {
        cacheAge = `${ageDays}d ${ageHours % 24}h ago`;
      } else if (ageHours > 0) {
        cacheAge = `${ageHours}h ${ageMinutes % 60}m ago`;
      } else {
        cacheAge = `${ageMinutes}m ago`;
      }
    }
    
    // Determine actual auth state
    const authenticated = authStatus?.success === true;
    let message = '';
    
    if (!hasCredentials) {
      message = 'Pandora credentials not configured - using favorites only';
    } else if (authenticated) {
      message = `Pandora authenticated - ${stats.total} stations (${stats.apiOnly} from API${stats.apiOnly > 0 && cacheAge ? ' cached ' + cacheAge : ''}, ${stats.favorites} from favorites)`;
    } else if (authStatus?.success === false) {
      message = `Pandora authentication failed - ${stats.total} stations (${stats.apiOnly} from cache ${cacheAge}, ${stats.favorites} from favorites)`;
    } else {
      message = `Pandora not yet authenticated - ${stats.total} stations`;
    }
    
    return {
      status: 200,
      body: {
        authenticated,
        hasCredentials,
        authStatus,
        stationCount: stats.total,
        apiStations: stats.apiOnly,
        favoriteStations: stats.favorites,
        bothSources: stats.both,
        lastUpdated,
        cacheAge,
        message
      }
    };
  }
  
  private async pandoraGetStations(params: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse> {
    const { room, detailed: detailedParam } = params;
    if (!room) throw createError(400, 'Room parameter is required');
    
    // Support both /detailed path parameter and ?detailed=true query parameter
    const detailed = detailedParam === 'detailed' || queryParams?.get('detailed') === 'true';
    
    // Just use the merged list from PandoraStationManager
    const allStations = this.pandoraStationManager.getAllStations();
    const favoriteStations = allStations.filter(s => s.source === 'favorite' || s.source === 'both');
    
    if (detailed) {
      // Return full station details
      return {
        status: 200,
        body: {
          stations: allStations.map(s => ({
            stationName: s.stationName,
            stationId: s.stationId,
            isInSonosFavorites: s.source === 'favorite' || s.source === 'both',
            source: s.source,
            // Add some reasonable defaults for compatibility
            isQuickMix: s.stationName === 'QuickMix',
            isThumbprint: s.stationName.includes('Thumbprint'),
            isUserCreated: true
          }))
        }
      };
    } else {
      // Return just station names (favorites first)
      const sortedStations = [...favoriteStations, ...allStations.filter(s => s.source === 'api')];
      return { 
        status: 200, 
        body: sortedStations.map(s => s.stationName) 
      };
    }
  }
  
  // Queue management endpoints
  private async getQueue({ room, limit, offset, detailed }: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse> {
    if (!room) throw createError(400, 'Room parameter is required');
    
    const device = this.getDevice(room);
    // Use coordinator for queue operations
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    // Support both /detailed path parameter and ?detailed=true query parameter
    const isDetailed = detailed === 'detailed' || limit === 'detailed' || offset === 'detailed' || queryParams?.get('detailed') === 'true';
    
    // Parse numeric parameters
    let limitNum = 100;
    let offsetNum = 0;
    
    if (limit && limit !== 'detailed') {
      limitNum = parseInt(limit as string);
    }
    
    if (offset && offset !== 'detailed') {
      offsetNum = parseInt(offset as string);
    }
    
    const queueData = await coordinator.getQueue(limitNum, offsetNum);
    
    if (isDetailed) {
      // For detailed, return the full items with all properties
      return { status: 200, body: queueData.items };
    } else {
      // For simplified, return only title, artist, album, albumArtUri
      const simplified = queueData.items.map((item: Partial<QueueItem>) => ({
        title: item.title || '',
        artist: item.artist || '',
        album: item.album || '',
        albumArtUri: item.albumArtUri || ''
      }));
      return { status: 200, body: simplified };
    }
  }
  
  // Playback control endpoints
  private async clearQueue({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    await coordinator.clearQueue();
    return { status: 200, body: { status: 'success' } };
  }
  
  private async addToQueue({ room }: RouteParams, _queryParams?: URLSearchParams, body?: unknown): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!body) throw createError(400, 'Request body is required');
    
    // Parse body if it's a string
    let parsedBody: { uri?: string; metadata?: string };
    if (typeof body === 'string') {
      try {
        parsedBody = JSON.parse(body);
      } catch (_e) {
        throw createError(400, 'Invalid JSON in request body');
      }
    } else if (typeof body === 'object') {
      parsedBody = body as { uri?: string; metadata?: string };
    } else {
      throw createError(400, 'Request body must be JSON');
    }
    
    const { uri, metadata } = parsedBody;
    if (!uri) throw createError(400, 'URI is required in request body');
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    // Get current queue position to determine where to add
    const transportInfo = await coordinator.getTransportInfo();
    const positionInfo = await coordinator.getPositionInfo();
    
    // If something is playing, add as next (position 1)
    // If nothing is playing or queue is empty, add at position 0
    const isPlaying = transportInfo.CurrentTransportState === 'PLAYING';
    const hasQueue = parseInt(positionInfo.Track) > 0;
    const enqueueAsNext = isPlaying && hasQueue;
    
    logger.debug(`${room}: Adding to queue - isPlaying=${isPlaying}, hasQueue=${hasQueue}, enqueueAsNext=${enqueueAsNext}`);
    
    await coordinator.addURIToQueue(uri, metadata || '', enqueueAsNext);
    
    return { 
      status: 200, 
      body: { 
        status: 'success'
      } 
    };
  }
  
  private async setRepeat({ room, toggle }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!toggle) throw createError(400, 'Toggle parameter is required');
    
    if (toggle !== 'on' && toggle !== 'off') {
      throw createError(400, 'Toggle must be "on" or "off"');
    }
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.setRepeat(toggle === 'on' ? 'all' : 'none');
    
    return { status: 200, body: { status: 'success' } };
  }
  
  private async setShuffle({ room, toggle }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!toggle) throw createError(400, 'Toggle parameter is required');
    
    if (toggle !== 'on' && toggle !== 'off') {
      throw createError(400, 'Toggle must be "on" or "off"');
    }
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.setShuffle(toggle === 'on');
    
    return { status: 200, body: { status: 'success' } };
  }
  
  private async setCrossfade({ room, toggle }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!toggle) throw createError(400, 'Toggle parameter is required');
    
    if (toggle !== 'on' && toggle !== 'off') {
      throw createError(400, 'Toggle must be "on" or "off"');
    }
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.setCrossfade(toggle === 'on');
    
    return { status: 200, body: { status: 'success' } };
  }
  
  private async setSleepTimer({ room, seconds }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!seconds) throw createError(400, 'Seconds parameter is required');
    
    const sleepSeconds = parseInt(seconds, 10);
    if (isNaN(sleepSeconds) || sleepSeconds < 0) {
      throw createError(400, 'Seconds must be a non-negative number');
    }
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.setSleepTimer(sleepSeconds);
    
    return { status: 200, body: { status: 'success' } };
  }
  
  private async playLineIn({ room, source }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    // If no source is specified, use the same room as the source
    const sourceRoom = source || room;
    
    // Find the source device to get its UUID
    const sourceDevice = this.discovery.getDevice(sourceRoom);
    if (!sourceDevice) {
      throw createError(404, `Could not find player ${sourceRoom}`);
    }
    
    await coordinator.playLineIn(sourceDevice);
    
    return { status: 200, body: { status: 'success' } };
  }
  
  private async spotifyPlay({ room, id }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!id) throw createError(400, 'Spotify ID is required');
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    // Try to parse the ID as a Spotify URI or extract type from context
    const spotifyInput = id.includes(':') ? id : `spotify:track:${id}`;
    const parsed = SpotifyService.parseSpotifyInput(spotifyInput);
    
    if (!parsed) {
      throw createError(400, 'Invalid Spotify ID or URI format');
    }
    
    // Get Spotify account from Sonos
    logger.info('Getting Spotify account for playback...');
    const account = await this.accountService.getServiceAccount(coordinator, 'spotify');
    if (!account) {
      throw createError(503, 'Spotify service not configured in Sonos. Please add Spotify account in Sonos app.');
    }
    
    logger.info(`Using Spotify account - SID: ${account.sid}, SN: ${account.serialNumber}`);
    // Account service extends ServiceAccount with Spotify-specific fields
    const spotifyAccount = account as ServiceAccount & { spotifyAccountId?: string };
    if (spotifyAccount.spotifyAccountId) {
      logger.info(`Spotify account ID: ${spotifyAccount.spotifyAccountId}`);
    }
    
    this.spotifyService.setAccount(account);
    this.spotifyService.setDevice(coordinator);
    
    try {
      // Generate URI and basic metadata
      const uri = await this.spotifyService.generateDirectURI(parsed.type as 'track' | 'album' | 'playlist' | 'artist', parsed.id);
      logger.info(`Spotify play - type: ${parsed.type}, id: ${parsed.id}, Sonos URI: ${uri}`);
      
      // Generate metadata using the direct metadata method which supports all types
      const metadata = this.spotifyService.generateDirectMetadata(
        parsed.type as 'track' | 'album' | 'playlist' | 'artist', 
        parsed.id,
        `Spotify ${parsed.type}`
      );
      
      // Play based on URI type
      if (uri.includes('x-sonos-spotify') || uri.includes('x-sonosapi-radio')) {
        // Direct play for tracks and artist radio (streams)
        await coordinator.setAVTransportURI(uri, metadata);
        await coordinator.play();
      } else {
        // Container URIs (albums, playlists) replace the queue
        // More robust approach: clear, add, then explicitly set transport to the queue
        await coordinator.clearQueue();
        await coordinator.addURIToQueue(uri, metadata, true, 1);
        
        // Set playback explicitly to the new queue position
        const queueURI = `x-rincon-queue:${coordinator.id.replace('uuid:', '')}#0`;
        await coordinator.setAVTransportURI(queueURI, '');
        await coordinator.play();
      }
      
      this.defaultRoomManager.setDefaults(room);
      
      return { status: 200, body: { status: 'success' } };
    } catch (error) {
      logger.error('Failed to play Spotify content:', error);
      
      // Check if this is a SOAP error 800 (content not playable) which often means Premium required
      const errorMsg = getErrorMessage(error);
      if (errorMsg.includes('errorCode>800') || errorMsg.includes('UPnPError') && errorMsg.includes('800')) {
        throw { 
          status: 402, // Payment Required
          message: 'Spotify Premium account required. Free Spotify accounts cannot play content via API control.' 
        };
      }
      
      throw createError(500, `Failed to play Spotify content: ${errorMsg}`);
    }
  }
  
  private async setGroupVolume({ room, level }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!level) throw createError(400, 'Level parameter is required');
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    const volumeLevel = parseInt(level, 10);
    
    if (isNaN(volumeLevel) || volumeLevel < 0 || volumeLevel > 100) {
      throw createError(400, 'Volume must be between 0 and 100');
    }
    
    try {
      await coordinator.setGroupVolume(volumeLevel);
      return { status: 200, body: { status: 'success' } };
    } catch (error) {
      logger.error(`Failed to set group volume for ${room}:`, error);
      throw createError(500, `Failed to set group volume: ${getErrorMessage(error)}`);
    }
  }
  
  // Global control endpoints
  private async resumeAll(): Promise<ApiResponse<SuccessResponse>> {
    const devices = this.discovery.getAllDevices();
    
    // Only resume coordinators to avoid duplicate commands
    const coordinators = devices.filter(device => this.discovery.isCoordinator(device.id));
    
    await Promise.all(coordinators.map(device => device.play().catch(err => 
      logger.error(`Error resuming ${device.roomName}:`, err)
    )));
    
    return { status: 200, body: { status: 'success' } };
  }
  
  private async setLogLevel({ level }: RouteParams): Promise<ApiResponse> {
    if (!level) throw createError(400, 'Level parameter is required');
    
    const validLevels = ['error', 'warn', 'info', 'debug', 'trace'];
    if (!validLevels.includes(level)) {
      throw createError(400, `Invalid log level. Must be one of: ${validLevels.join(', ')}`);
    }
    
    // Set both winston logger level and debug manager level
    logger.level = level;
    debugManager.setLogLevel(level as LogLevel);
    
    return { status: 200, body: { status: 'success', logLevel: level } };
  }
  
  // TTS endpoints
  private async sayText({ room, text }: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!text) throw createError(400, 'Text parameter is required');
    
    const device = this.getDevice(room);
    const language = queryParams?.get('language') || 'en';
    const volume = parseInt(queryParams?.get('volume') || String(this.config.announceVolume || 40), 10);
    
    // Safely decode the text - handle potential malformed URIs
    let decodedText: string;
    try {
      decodedText = decodeURIComponent(text);
    } catch (_e) {
      // If decoding fails, try to fix common issues
      // Remove any incomplete % encodings at the end
      const cleanedText = text.replace(/%(?![0-9a-fA-F]{2})/g, '%25');
      try {
        decodedText = decodeURIComponent(cleanedText);
      } catch (_e2) {
        // If still failing, just use the original text
        logger.warn('Failed to decode TTS text, using raw text');
        decodedText = text;
      }
    }
    
    // Validate that text is not empty after decoding and trimming
    if (!decodedText.trim()) {
      throw createError(400, 'Text cannot be empty');
    }
    
    // Get the base URL for TTS - Sonos needs direct HTTP access to the host
    let ttsHost: string;
    
    // For Docker with host networking, we need the actual host IP
    if (this.config.ttsHostIp) {
      // User can specify the host IP via environment variable
      ttsHost = this.config.ttsHostIp;
      logger.debug(`Using TTS_HOST_IP from configuration: ${ttsHost}`);
    } else if (this.config.host === 'localhost' || this.config.host === '127.0.0.1' || this.config.host === '0.0.0.0') {
      // For local development, auto-detect the IP
      const detectedIP = this.discovery.getLocalIP();
      if (detectedIP) {
        ttsHost = detectedIP;
        logger.debug(`Auto-detected host IP: ${ttsHost}`);
      } else {
        ttsHost = '192.168.4.17'; // Fallback
        logger.warn(`Could not detect host IP, using fallback: ${ttsHost}`);
      }
    } else {
      // For hostnames, try to detect the actual IP since Sonos needs direct access
      const detectedIP = this.discovery.getLocalIP();
      if (detectedIP) {
        ttsHost = detectedIP;
        logger.debug(`Using detected IP ${detectedIP} for TTS (instead of ${this.config.host})`);
      } else {
        // Last resort - use the hostname and hope it resolves correctly
        ttsHost = this.config.host || 'localhost';
        logger.warn(`Using hostname ${ttsHost} for TTS - ensure Sonos can resolve this`);
      }
    }
    
    // Always use HTTP with the actual port for direct container access
    const baseUrl = `http://${ttsHost}:${this.config.port}`;
    logger.debug(`TTS base URL: ${baseUrl}`);
    
    try {
      // Generate TTS URL
      const ttsUrl = await this.ttsService.getTTSUrl(decodedText, language, baseUrl);
      logger.debug(`Generated TTS URL: ${ttsUrl}`);
      
      // Estimate duration based on text length
      const estimatedDuration = Math.max(3000, decodedText.length * 60); // ~60ms per character
      
      // For stereo pairs and groups, always use the coordinator
      let targetDevice = device;
      const coordinator = this.discovery.getCoordinator(device.id);
      if (coordinator && coordinator.id !== device.id) {
        logger.debug(`Routing TTS to coordinator: ${coordinator.roomName}`);
        targetDevice = coordinator;
      }
      
      // Import the announcement helper
      const { playAnnouncement } = await import('./utils/announcement-helper.js');
      
      // Play announcement with full save/restore functionality
      await playAnnouncement(targetDevice, ttsUrl, volume, estimatedDuration, this.discovery);
      
      return { status: 200, body: { status: 'success' } };
    } catch (error) {
      logger.error('TTS failed:', error);
      logger.error('TTS error details:', {
        room,
        text: decodedText,
        volume,
        hasDevice: !!device,
        error: getErrorMessage(error)
      });
      throw createError(500, `TTS failed: ${getErrorMessage(error)}`);
    }
  }
  
  private async sayTextAll({ room, text }: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!text) throw createError(400, 'Text parameter is required');
    
    // Say in specified room's group
    const device = this.getDevice(room);
    
    // Get all members of the group
    const zone = this.discovery.getZones().find(z => 
      z.members.some(m => m.id === device.id)
    );
    
    if (!zone) {
      return this.sayText({ room, text }, queryParams);
    }
    
    // Say in all rooms of the group
    const promises = zone.members.map(member => {
      const memberDevice = this.discovery.devices.get(member.id);
      if (memberDevice) {
        return this.sayText({ room: memberDevice.roomName, text }, queryParams)
          .catch(err => logger.error(`TTS failed in ${memberDevice.roomName}:`, err));
      }
      return Promise.resolve();
    });
    
    await Promise.all(promises);
    return { status: 200, body: { status: 'success' } };
  }
  
  private async sayTextAllRooms({ text }: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse<SuccessResponse>> {
    if (!text) throw createError(400, 'Text parameter is required');
    
    // Say in all rooms
    const devices = this.discovery.getAllDevices();
    const promises = devices.map(device => 
      this.sayText({ room: device.roomName, text }, queryParams)
        .catch(err => logger.error(`TTS failed in ${device.roomName}:`, err))
    );
    
    await Promise.all(promises);
    return { status: 200, body: { status: 'success' } };
  }

  // TTS with volume as path parameter
  private async sayTextWithVolume({ room, text, volume }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!text) throw createError(400, 'Text parameter is required');
    if (!volume) throw createError(400, 'Volume parameter is required');
    
    // Convert volume to query parameter and delegate
    const queryParams = new URLSearchParams();
    queryParams.set('volume', volume);
    
    return this.sayText({ room, text }, queryParams);
  }

  private async sayTextAllWithVolume({ room, text, volume }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!text) throw createError(400, 'Text parameter is required');
    if (!volume) throw createError(400, 'Volume parameter is required');
    
    // Convert volume to query parameter and delegate
    const queryParams = new URLSearchParams();
    queryParams.set('volume', volume);
    
    return this.sayTextAll({ room, text }, queryParams);
  }

  private async sayTextAllRoomsWithVolume({ text, volume }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!text) throw createError(400, 'Text parameter is required');
    if (!volume) throw createError(400, 'Volume parameter is required');
    
    // Convert volume to query parameter and delegate
    const queryParams = new URLSearchParams();
    queryParams.set('volume', volume);
    
    return this.sayTextAllRooms({ text }, queryParams);
  }

  /**
   * Perform music search and play results
   */
  private async performMusicSearch(roomName: string, service: string, type: 'album' | 'song' | 'station' | 'artist', term: string, queryParams?: URLSearchParams): Promise<ApiResponse<MusicSearchSuccessResponse | LibrarySearchSuccessResponse>> {
    const device = this.getDevice(roomName);
    if (!device) {
      throw createError(404, `Room '${roomName}' not found`);
    }

    // Get coordinator for playback
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    if (!coordinator) {
      throw createError(404, `No coordinator found for room '${roomName}'`);
    }

    // Check if play=false to return results only
    const shouldPlay = queryParams?.get('play') !== 'false';

    // Check supported services and types
    const serviceLower = service.toLowerCase();
    if (serviceLower === 'pandora' && type !== 'station' && type !== 'artist') {
      throw createError(400, `Pandora only supports station search, not ${type}`);
    }
    if (serviceLower === 'library' && type === 'station') {
      throw createError(400, 'Library does not support station search, only song, album, and artist');
    }
    if (serviceLower !== 'apple' && serviceLower !== 'spotify' && serviceLower !== 'pandora' && serviceLower !== 'library') {
      throw createError(501, `Music search for '${service}' not yet implemented. Only 'apple', 'spotify', 'pandora', and 'library' are supported.`);
    }

    try {
      // Handle Pandora - both artist and station search for stations
      if (serviceLower === 'pandora') {
        logger.info(`Searching Pandora for ${type}: ${term}`);
        
        // Use the existing pandoraPlay logic
        const decodedTerm = decodeURIComponent(term);
        await this.pandoraPlay({ room: roomName, name: decodedTerm });
        
        return {
          status: 200,
          body: {
            status: 'success',
            title: decodedTerm,
            service: 'pandora'
          }
        };
      }
      
      // Handle Library search
      if (serviceLower === 'library') {
        logger.info(`Searching local music library for ${type}: ${term}`);
        
        if (!this.musicLibraryCache) {
          throw createError(503, 'Music library not yet indexed');
        }
        
        // Handle artist search differently - queue multiple tracks
        if (type === 'artist') {
          const results = await this.musicLibraryCache.search(term, 'artist', 1000); // Get more results for artist
          
          if (results.length === 0) {
            throw createError(404, `No songs found for artist: ${term}`);
          }
          
          // If play=false, return search results without playing
          if (!shouldPlay) {
            return {
              status: 200,
              body: {
                status: 'success',
                service: 'library',
                type: type,
                query: term,
                results: results.map(r => ({
                  title: r.title,
                  artist: r.artist,
                  album: r.album,
                  uri: r.uri,
                  id: r.id,
                  type: 'track' as const
                }))
              }
            };
          }
          
          // Get randomQueueLimit from config (default 100)
          const limit = this.config.library?.randomQueueLimit || 100;
          
          // Shuffle the results
          const shuffled = [...results].sort(() => Math.random() - 0.5);
          const tracksToQueue = shuffled.slice(0, Math.min(limit, shuffled.length));
          
          logger.info(`Found ${results.length} tracks for artist "${term}", queueing ${tracksToQueue.length} tracks`);
          
          // Clear queue and add tracks
          await coordinator.clearQueue();
          const queueURI = `x-rincon-queue:${coordinator.id.replace('uuid:', '')}#0`;
          await coordinator.setAVTransportURI(queueURI, '');
          
          // Add first track and start playing immediately
          if (tracksToQueue.length > 0) {
            const firstTrack = tracksToQueue[0]!;
            const firstMetadata = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
            <item id="library-${firstTrack.id}" parentID="library" restricted="true">
              <dc:title>${firstTrack.title}</dc:title>
              <upnp:artist>${firstTrack.artist}</upnp:artist>
              <upnp:album>${firstTrack.album}</upnp:album>
              <upnp:class>object.item.audioItem.musicTrack</upnp:class>
              <res>${firstTrack.uri}</res>
            </item></DIDL-Lite>`;
            
            await coordinator.addURIToQueue(firstTrack.uri, firstMetadata, true, 0);
            
            // Start playback with just the first track
            await coordinator.play();
            
            // Now add the remaining tracks while the first one is playing
            for (let i = 1; i < tracksToQueue.length; i++) {
              const track = tracksToQueue[i]!;
              const metadata = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
              <item id="library-${track.id}" parentID="library" restricted="true">
                <dc:title>${track.title}</dc:title>
                <upnp:artist>${track.artist}</upnp:artist>
                <upnp:album>${track.album}</upnp:album>
                <upnp:class>object.item.audioItem.musicTrack</upnp:class>
                <res>${track.uri}</res>
              </item></DIDL-Lite>`;
              
              await coordinator.addURIToQueue(track.uri, metadata, true, 0); // Add to end of queue
            }
          }
          
          return {
            status: 200,
            body: {
              status: 'success',
              title: `${tracksToQueue.length} tracks by ${term}`,
              artist: term,
              service: 'library'
            }
          };
        }
        
        // For song and album, use existing single-track logic
        const searchType = type === 'album' ? 'album' : 'title';
        const results = await this.musicLibraryCache.search(term, searchType, 50);
        
        if (results.length === 0) {
          throw createError(404, `No ${type}s found matching: ${term}`);
        }
        
        // If play=false, return search results without playing
        if (!shouldPlay) {
          return {
            status: 200,
            body: {
              status: 'success',
              service: 'library',
              type: type,
              query: term,
              results: results.map(r => ({
                title: r.title,
                artist: r.artist,
                album: r.album,
                uri: r.uri,
                id: r.id,
                type: 'track' as const
              }))
            }
          };
        }
        
        const track = results[0]!;
        
        // Clear queue first to ensure clean state
        await coordinator.clearQueue();
        
        // Play the first result
        const uri = track.uri;
        const metadata = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
        <item id="library-${track.id}" parentID="library" restricted="true">
          <dc:title>${track.title}</dc:title>
          <upnp:artist>${track.artist}</upnp:artist>
          <upnp:album>${track.album}</upnp:album>
          <upnp:class>object.item.audioItem.musicTrack</upnp:class>
          <res>${uri}</res>
        </item></DIDL-Lite>`;
        
        await coordinator.setAVTransportURI(uri, metadata);
        await coordinator.play();
        
        return {
          status: 200,
          body: {
            status: 'success',
            title: track.title,
            artist: track.artist,
            album: track.album,
            service: 'library'
          }
        };
      }
      
      // Apple Music and Spotify logic
      // Get service account from Sonos
      const account = await this.accountService.getServiceAccount(coordinator, service);
      if (!account) {
        throw createError(503, `${service} service not configured in Sonos. Please add ${service} account in Sonos app.`);
      }

      // Set account in appropriate service
      let musicService: typeof this.appleMusicService | typeof this.spotifyService;
      if (serviceLower === 'spotify') {
        this.spotifyService.setAccount(account);
        this.spotifyService.setDevice(coordinator);
        musicService = this.spotifyService;
      } else {
        this.appleMusicService.setAccount(account);
        musicService = this.appleMusicService;
      }

      // For artist search, convert to appropriate type for each service
      // Apple Music: artist -> song (artist radio doesn't work)
      // Spotify: artist -> station (uses artist search)
      let searchType = type;
      if (type === 'artist') {
        searchType = serviceLower === 'apple' ? 'song' : 'station';
      }
      
      // Perform search
      // For Apple Music artist searches, prepend "artist:" to the search term
      const searchTerm = (type === 'artist' && serviceLower === 'apple') ? `artist:${term}` : term;
      logger.info(`Searching ${service} for ${type}: ${searchTerm}`);
      const results = await musicService.search(searchType as 'album' | 'song' | 'station', searchTerm);
      
      if (results.length === 0) {
        throw createError(404, `No ${type}s found for: ${term}`);
      }

      // If play=false, return search results without playing
      if (!shouldPlay) {
        return {
          status: 200,
          body: {
            status: 'success',
            service: service,
            type: type,
            query: term,
            results: results.map(r => ({
              title: r.title,
              artist: r.artist,
              album: r.album,
              uri: musicService.generateURI(searchType as 'album' | 'song' | 'station', r),
              id: r.id,
              type: type as 'track'
            }))
          }
        };
      }

      // Use first result
      const result = results[0];
      if (!result) {
        throw createError(404, `No valid ${type} found for: ${term}`);
      }
      
      // Special handling for Spotify artist search
      if (serviceLower === 'spotify' && (type === 'station' || type === 'artist')) {
        const result = await this.spotifyService.playArtistTopTracks(coordinator, term);
        
        if (!result.success) {
          throw createError(404, result.message);
        }
        
        // Update default room
        this.defaultRoomManager.setDefaults(roomName);
        
        return { 
          status: 200, 
          body: { 
            status: 'success',
            title: `${result.artistName} - Top ${result.trackCount} Tracks`,
            artist: result.artistName || term,
            album: '(Spotify Top Tracks)',
            service: service,
            message: result.message
          } 
        };
      }
      
      // Special handling for Apple Music station search - create genre radio
      if (serviceLower === 'apple' && type === 'station' && results.length > 1) {
        logger.info(`Creating Apple Music genre radio for: ${term}`);
        
        // Clear queue and prepare for multiple tracks
        await coordinator.clearQueue();
        const queueURI = `x-rincon-queue:${coordinator.id.replace('uuid:', '')}#0`;
        await coordinator.setAVTransportURI(queueURI, '');
        
        // Limit to 25 diverse tracks for radio experience
        const radioTracks = results.slice(0, 25);
        
        // Add all tracks to queue
        for (let i = 0; i < radioTracks.length; i++) {
          const track = radioTracks[i]!;
          const trackUri = musicService.generateURI('song', track);
          const trackMetadata = musicService.generateMetadata('song', track);
          await coordinator.addURIToQueue(trackUri, trackMetadata, true, i + 1);
        }
        
        // Start playing
        await coordinator.play();
        
        // Update default room
        this.defaultRoomManager.setDefaults(roomName);
        
        return {
          status: 200,
          body: {
            status: 'success',
            title: `${term} Radio`,
            artist: 'Various Artists',
            album: `(${radioTracks.length} tracks)`,
            service: 'apple',
            message: `Playing ${radioTracks.length} ${term} tracks`
          }
        };
      }
      
      // Generate URI and metadata for non-Spotify artist cases
      logger.info(`Found ${type}: ${result.title} by ${result.artist || 'Unknown'}`);
      const uri = musicService.generateURI(searchType as 'album' | 'song' | 'station', result);
      const metadata = musicService.generateMetadata(searchType as 'album' | 'song' | 'station', result);
      logger.debug(`Generated URI: ${uri}`);
      
      // Play the content
      if (type === 'station' || type === 'artist') {
        // Stations and artist radio play directly
        await coordinator.setAVTransportURI(uri, metadata);
        await coordinator.play();
      } else if (type === 'album') {
        // Albums go to queue and play
        const queueURI = `x-rincon-queue:${coordinator.id.replace('uuid:', '')}#0`;
        await coordinator.clearQueue();
        await coordinator.setAVTransportURI(queueURI, '');
        await coordinator.addURIToQueue(uri, metadata, true, 1);
        await coordinator.play();
      } else { // song
        // Songs are added to current queue (matching legacy behavior)
        const queueURI = `x-rincon-queue:${coordinator.id.replace('uuid:', '')}#0`;
        
        try {
          // Check if queue is empty by getting the queue
          logger.trace(`Getting queue to check if empty for ${coordinator.roomName}`);
          const queueResult = await coordinator.getQueue(0, 1);
          const isEmpty = queueResult.items.length === 0;
          logger.trace(`Queue empty check: ${isEmpty}, items: ${queueResult.items.length}`);
          
          if (isEmpty) {
            // Empty queue - add to position 1 and play
            logger.trace('Empty queue - adding to position 1');
            await coordinator.addURIToQueue(uri, metadata, true, 1);
            await coordinator.setAVTransportURI(queueURI, '');
          } else {
            // Add after current track - we'll add as next track (position 1)
            // This matches the legacy behavior
            const nextTrackNo = 1; // Add as next track
            logger.trace('Non-empty queue - adding as next track');
            await coordinator.addURIToQueue(uri, metadata, true, nextTrackNo);
            logger.trace('Setting transport URI to queue');
            await coordinator.setAVTransportURI(queueURI, '');
            logger.trace('Calling next() to skip to added track');
            await coordinator.next();
          }
          
          logger.trace(`Calling play() on ${coordinator.roomName}`);
          await coordinator.play();
        } catch (error) {
          logger.error('Error in song playback logic:', error);
          throw error;
        }
      }

      // Update default room
      this.defaultRoomManager.setDefaults(roomName);

      return { 
        status: 200, 
        body: { 
          status: 'success',
          title: result.title,
          artist: result.artist || '',
          album: result.album || '',
          service: service
        } 
      };
    } catch (error) {
      logger.error(`Music search failed for ${service} ${type} "${term}":`, error);
      
      if (error && typeof error === 'object' && 'status' in error) {
        throw error; // Re-throw API errors
      }
      
      throw createError(500, `Music search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async debugSubscriptions(): Promise<ApiResponse<any>> { // ANY IS CORRECT: debug endpoint returns various subscription info
    const devices = this.discovery.getAllDevices();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscriber = (this.discovery as any).subscriber; // subscriber property not in discovery type but exists at runtime
    
    const result = {
      subscriberStatus: subscriber ? 'active' : 'not initialized',
      callbackServer: subscriber ? {
        host: subscriber.callbackHost,
        port: subscriber.callbackPort
      } : null,
      devices: devices.map(device => ({
        roomName: device.roomName,
        id: device.id,
        baseUrl: device.baseUrl,
        subscriptions: 'Check server logs for subscription details'
      }))
    };
    
    return {
      status: 200,
      body: result
    };
  }
  
  // Settings endpoint - returns safe config info
  private async getSettings(): Promise<ApiResponse> {
    // Return safe settings info without exposing sensitive credentials
    const safeSettings = {
      port: this.config.port,
      host: this.config.host,
      defaultRoom: this.config.defaultRoom,
      defaultMusicService: this.config.defaultMusicService,
      announceVolume: this.config.announceVolume,
      auth: {
        configured: !!(this.config.auth?.username && this.config.auth?.password),
        rejectUnauthorized: this.config.auth?.rejectUnauthorized
      },
      pandora: {
        configured: !!(this.config.pandora?.username && this.config.pandora?.password)
      },
      library: this.config.library || {}
    };
    
    return {
      status: 200,
      body: safeSettings
    };
  }

  private async debugSpotifyParse({ input }: RouteParams): Promise<ApiResponse> {
    if (!input) throw createError(400, 'Input parameter is required');
    
    // Parse the Spotify input
    const parsed = SpotifyService.parseSpotifyInput(input);
    if (!parsed) {
      return {
        status: 400,
        body: { error: 'Invalid Spotify URL or URI format' }
      };
    }
    
    // Generate the Sonos URI
    const sonosUri = SpotifyService.parseSpotifyUrlToUri(input);
    
    // Parse the URI to extract components
    let sid = '12';
    let sn = '1';
    let flags = '';
    let prefix = '';
    
    if (sonosUri) {
      // Extract parameters from URI
      const sidMatch = sonosUri.match(/sid=(\d+)/);
      if (sidMatch && sidMatch[1]) sid = sidMatch[1];
      
      const snMatch = sonosUri.match(/sn=(\d+)/);
      if (snMatch && snMatch[1]) sn = snMatch[1];
      
      const flagsMatch = sonosUri.match(/flags=(\d+)/);
      if (flagsMatch && flagsMatch[1]) flags = flagsMatch[1];
      
      // Extract prefix for containers
      if (sonosUri.includes('x-rincon-cpcontainer:')) {
        const prefixMatch = sonosUri.match(/x-rincon-cpcontainer:([0-9a-f]+)spotify/);
        if (prefixMatch && prefixMatch[1]) prefix = prefixMatch[1];
      }
    }
    
    // Also generate what our API would create with full account info
    const devices = this.discovery.getAllDevices();
    const device = devices[0];
    let fullUri = null;
    let accountInfo = null;
    
    if (device) {
      try {
        // Get Spotify account
        const account = await this.accountService.getServiceAccount(device, 'spotify');
        if (account) {
          // Account service extends ServiceAccount with Spotify-specific fields
          const spotifyAccount = account as ServiceAccount & { spotifyAccountId?: string };
          accountInfo = {
            id: account.id,
            sid: account.sid,
            serialNumber: account.serialNumber,
            spotifyAccountId: spotifyAccount.spotifyAccountId
          };
          
          this.spotifyService.setAccount(account);
          fullUri = await this.spotifyService.generateDirectURI(
            parsed.type as 'track' | 'album' | 'playlist' | 'artist', 
            parsed.id
          );
        }
      } catch (_error) {
        // Ignore errors, this is just for debugging
      }
    }
    
    return {
      status: 200,
      body: {
        input,
        parsed: {
          type: parsed.type,
          id: parsed.id,
          spotifyUri: `spotify:${parsed.type}:${parsed.id}`,
          sid,
          sn,
          flags,
          prefix: prefix || undefined,
          account: accountInfo
        },
        sonosUri,
        fullUri: fullUri || 'Unable to generate with account info'
      }
    };
  }

  private async debugBrowseSpotify({ room, sid }: RouteParams): Promise<ApiResponse> {
    if (!room) throw createError(400, 'Room parameter is required');
    if (!sid) throw createError(400, 'SID parameter is required');
    
    const device = this.getDevice(room);
    
    try {
      const browseId = `SP:${sid}`;
      logger.info(`Browsing ${browseId} on ${device.roomName}...`);
      
      const result = await device.browse(browseId);
      
      return {
        status: 200,
        body: {
          browseId,
          device: device.roomName,
          totalMatches: result.totalMatches,
          numberReturned: result.numberReturned,
          items: result.items
        }
      };
    } catch (error) {
      return {
        status: 500,
        body: {
          error: getErrorMessage(error),
          message: `Failed to browse SP:${sid}`
        }
      };
    }
  }

  private async debugSpotifyAccount({ room }: RouteParams): Promise<ApiResponse> {
    if (!room) throw createError(400, 'Room parameter is required');
    
    const device = this.getDevice(room);
    
    try {
      // Get the Spotify account info
      const account = await this.accountService.getServiceAccount(device, 'spotify');
      
      // Get all discovered Spotify accounts
      const allAccounts = this.accountService.getAllSpotifyAccounts();
      
      return {
        status: 200,
        body: {
          device: device.roomName,
          currentAccount: account,
          discoveredAccounts: Object.fromEntries(allAccounts),
          message: 'Spotify account info discovered from favorites'
        }
      };
    } catch (error) {
      return {
        status: 500,
        body: {
          error: getErrorMessage(error),
          message: 'Failed to get Spotify account info'
        }
      };
    }
  }

  // Spotify OAuth handlers
  private async spotifyGetAuthUrl(): Promise<ApiResponse> {
    try {
      const { authUrl, state } = this.spotifyAuthService.generateAuthUrl();
      
      return {
        status: 200,
        body: {
          authUrl,
          state,
          instructions: [
            '1. Copy the URL above and paste in your browser',
            '2. Authorize the app with Spotify',
            '3. You will be redirected to the callback URL',
            '4. If running locally without a callback server, copy the FULL redirect URL',
            '5. POST the redirect URL to /spotify/callback-url'
          ].join('\n')
        }
      };
    } catch (error) {
      return {
        status: 500,
        body: {
          error: getErrorMessage(error),
          message: 'Failed to generate Spotify auth URL'
        }
      };
    }
  }

  private async spotifyCallback(_params: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse> {
    try {
      const code = queryParams?.get('code');
      const state = queryParams?.get('state');
      const error = queryParams?.get('error');
      
      if (error) {
        // Return HTML response for browser
        return {
          status: 400,
          body: `<html><body><h1>Authorization Failed</h1><p>${error}</p></body></html>`
        };
      }
      
      if (!code || !state) {
        return {
          status: 400,
          body: '<html><body><h1>Invalid Request</h1><p>Missing code or state parameter</p></body></html>'
        };
      }
      
      // Construct callback URL from request
      const callbackUrl = `http://localhost:8888/callback?code=${code}&state=${state}`;
      await this.spotifyAuthService.processCallbackUrl(callbackUrl);
      
      // Return success HTML for browser
      return {
        status: 200,
        body: `
          <html>
          <head>
            <meta charset="UTF-8">
            <title>Spotify Authorization Successful</title>
          </head>
          <body>
            <h1>Authorization Successful!</h1>
            <p>Spotify has been connected to your Sonos API.</p>
            <p><strong>Important:</strong> If your data folder is not persisted (e.g., in Docker), 
            you should save the refresh token to your .env file to avoid re-authenticating:</p>
            <pre>SPOTIFY_REFRESH_TOKEN=&lt;check data/spotify-tokens-*.json for the token&gt;</pre>
            <p>You can close this window and return to your application.</p>
            <script>
              setTimeout(() => {
                if (window.opener) {
                  window.close();
                }
              }, 10000);
            </script>
          </body>
          </html>
        `
      };
    } catch (error) {
      return {
        status: 500,
        body: `<html><body><h1>Error</h1><p>${getErrorMessage(error)}</p></body></html>`
      };
    }
  }

  private async spotifySubmitCallbackUrl(_params: RouteParams, _queryParams?: URLSearchParams, body?: string): Promise<ApiResponse> {
    try {
      if (!body) {
        throw createError(400, 'Request body is required');
      }
      
      const data = JSON.parse(body);
      const callbackUrl = data.callbackUrl;
      
      if (!callbackUrl) {
        throw createError(400, 'callbackUrl is required in request body');
      }
      
      await this.spotifyAuthService.processCallbackUrl(callbackUrl);
      
      return {
        status: 200,
        body: {
          status: 'success',
          message: 'Spotify authorization successful',
          note: 'Add SPOTIFY_REFRESH_TOKEN to your .env for future deployments'
        }
      };
    } catch (error) {
      return {
        status: getErrorStatus(error) || 500,
        body: {
          error: getErrorMessage(error),
          message: 'Failed to process Spotify callback URL'
        }
      };
    }
  }

  private async spotifyAuthStatus(): Promise<ApiResponse> {
    const detailedStatus = this.spotifyAuthService.getDetailedStatus();
    const hasRefreshToken = !!this.config.spotify?.refreshToken;
    const instanceId = process.env.INSTANCE_ID || 'default';
    
    // Calculate age of last auth
    let authAge = '';
    if (detailedStatus.lastAuth) {
      const authTime = new Date(detailedStatus.lastAuth).getTime();
      const now = Date.now();
      const ageMs = now - authTime;
      const ageMinutes = Math.floor(ageMs / 60000);
      const ageHours = Math.floor(ageMinutes / 60);
      const ageDays = Math.floor(ageHours / 24);
      
      if (ageDays > 0) {
        authAge = `${ageDays}d ${ageHours % 24}h ago`;
      } else if (ageHours > 0) {
        authAge = `${ageHours}h ${ageMinutes % 60}m ago`;
      } else {
        authAge = `${ageMinutes}m ago`;
      }
    }
    
    let message = '';
    if (detailedStatus.authenticated) {
      message = `Spotify authenticated (token expires in ${detailedStatus.expiresIn})`;
    } else if (detailedStatus.hasTokens && detailedStatus.tokenExpired) {
      message = `Spotify token expired (last auth ${authAge})`;
    } else if (hasRefreshToken && !detailedStatus.hasTokens) {
      message = 'Spotify has refresh token but needs initialization';
    } else {
      message = 'Spotify authentication required - visit /spotify/auth';
    }
    
    return {
      status: 200,
      body: {
        authenticated: detailedStatus.authenticated,
        hasTokens: detailedStatus.hasTokens,
        tokenExpired: detailedStatus.tokenExpired,
        hasRefreshToken,
        instanceId,
        expiresIn: detailedStatus.expiresIn,
        lastAuth: detailedStatus.lastAuth,
        authAge,
        message
      }
    };
  }

}