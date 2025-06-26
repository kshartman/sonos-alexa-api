import { IncomingMessage, ServerResponse } from 'http';
import logger from './utils/logger.js';
import { getClientIp, isIpTrusted } from './utils/network-utils.js';
import type { SonosDiscovery } from './discovery.js';
import type { PresetLoader } from './preset-loader.js';
import type { DefaultRoomManager } from './utils/default-room-manager.js';
import type { TTSService } from './services/tts-service.js';
import { AppleMusicService } from './services/apple-music-service.js';
import { AccountService } from './services/account-service.js';
import { MusicLibraryCache } from './services/music-library-cache.js';
import type { Config, ApiResponse, RouteParams, ErrorResponse, SuccessResponse, MusicSearchSuccessResponse } from './types/sonos.js';
import { debugManager, type DebugCategories, type LogLevel } from './utils/debug-manager.js';

type RouteHandler = (params: RouteParams, queryParams?: URLSearchParams) => Promise<ApiResponse>;

export class ApiRouter {
  private discovery: SonosDiscovery;
  private config: Config;
  private presetLoader?: PresetLoader | undefined;
  private defaultRoomManager: DefaultRoomManager;
  private ttsService: TTSService;
  private appleMusicService: AppleMusicService;
  private accountService: AccountService;
  private musicLibraryCache?: MusicLibraryCache;
  private routes = new Map<string, RouteHandler>();

  constructor(discovery: SonosDiscovery, config: Config, presetLoader?: PresetLoader | undefined, defaultRoomManager?: DefaultRoomManager, ttsService?: TTSService) {
    this.discovery = discovery;
    this.config = config;
    this.presetLoader = presetLoader;
    this.defaultRoomManager = defaultRoomManager!;
    this.ttsService = ttsService!;
    this.appleMusicService = new AppleMusicService();
    this.accountService = new AccountService();
    
    this.registerRoutes();
  }

  async initializeMusicLibrary(): Promise<void> {
    try {
      // Get any device IP to access the music library
      const zones = await this.getZones();
      if (zones.body && Array.isArray(zones.body) && zones.body.length > 0) {
        const firstZone = zones.body[0];
        if (firstZone.members && firstZone.members.length > 0) {
          const coordinator = firstZone.members.find((m: any) => m.isCoordinator) || firstZone.members[0];
          const device = this.discovery.getDevice(coordinator.roomName);
          if (device) {
            logger.info('Initializing music library cache...');
            this.musicLibraryCache = new MusicLibraryCache(device.ip, this.config.dataDir || './data');
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
    }
  }

  getMusicLibraryCacheStatus(): { isIndexing: boolean; progress: number; metadata: any } | null {
    if (!this.musicLibraryCache) {
      return null;
    }
    return this.musicLibraryCache.getStatus();
  }

  getMusicLibraryCache(): MusicLibraryCache | undefined {
    return this.musicLibraryCache;
  }

  private registerRoutes(): void {
    // System routes
    this.routes.set('GET /zones', this.getZones.bind(this));
    this.routes.set('GET /state', this.getState.bind(this));
    this.routes.set('GET /health', this.getHealth.bind(this));
    this.routes.set('GET /presets', this.getPresets.bind(this));

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
    this.routes.set('GET /{room}/favourites', this.getFavorites.bind(this)); // British spelling
    this.routes.set('GET /{room}/favorite/{name}', this.playFavorite.bind(this));
    this.routes.set('GET /{room}/favourite/{name}', this.playFavorite.bind(this)); // British spelling

    // Playlists routes
    this.routes.set('GET /{room}/playlists', this.getPlaylists.bind(this));
    this.routes.set('GET /{room}/playlist/{name}', this.playPlaylist.bind(this));

    // Apple Music routes
    this.routes.set('GET /{room}/applemusic/{action}/{id}', this.appleMusic.bind(this));

    // Music library routes (must be before generic music search routes)
    this.routes.set('GET /{room}/musicsearch/library/song/{query}', this.musicLibrarySearchSong.bind(this));
    this.routes.set('GET /{room}/musicsearch/library/artist/{query}', this.musicLibrarySearchArtist.bind(this));
    this.routes.set('GET /{room}/musicsearch/library/album/{query}', this.musicLibrarySearchAlbum.bind(this));
    this.routes.set('GET /library/index', this.getMusicLibraryStatus.bind(this));
    this.routes.set('GET /library/refresh', this.refreshMusicLibrary.bind(this));

    // Music search routes (for Alexa compatibility)
    this.routes.set('GET /{room}/musicsearch/{service}/album/{name}', this.musicSearchAlbum.bind(this));
    this.routes.set('GET /{room}/musicsearch/{service}/song/{query}', this.musicSearchSong.bind(this));
    this.routes.set('GET /{room}/musicsearch/{service}/station/{name}', this.musicSearchStation.bind(this));
    
    // Service-specific routes
    this.routes.set('GET /{room}/siriusxm/{name}', this.siriusXM.bind(this));
    this.routes.set('GET /{room}/pandora/play/{name}', this.pandoraPlay.bind(this));
    this.routes.set('GET /{room}/pandora/thumbsup', this.pandoraThumbsUp.bind(this));
    this.routes.set('GET /{room}/pandora/thumbsdown', this.pandoraThumbsDown.bind(this));
    this.routes.set('GET /{room}/pandora/stations', this.pandoraGetStations.bind(this));
    
    // Queue management routes
    this.routes.set('GET /{room}/queue', this.getQueue.bind(this));
    this.routes.set('GET /{room}/queue/{limit}', this.getQueue.bind(this));
    this.routes.set('GET /{room}/queue/{limit}/{offset}', this.getQueue.bind(this));
    this.routes.set('GET /{room}/queue/detailed', this.getQueueDetailed.bind(this));
    this.routes.set('GET /{room}/clearqueue', this.clearQueue.bind(this));
    
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
    
    // Debug endpoint for account testing
    this.routes.set('GET /{room}/debug/accounts', this.debugAccounts.bind(this));
    
    // Debug endpoint for subscription status
    this.routes.set('GET /debug/subscriptions', this.debugSubscriptions.bind(this));
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { method, url } = req;
    const [path, queryString] = (url || '/').split('?');
    const queryParams = new URLSearchParams(queryString || '');
    
    debugManager.info('api', `${method} ${path}`);

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    
    // Basic auth check if configured
    if (this.config.auth && this.config.auth.username && this.config.auth.password) {
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
            res.statusCode = 401;
            res.setHeader('WWW-Authenticate', 'Basic realm="Sonos API"');
            res.end(JSON.stringify({ status: 'error', error: 'Authentication required' }));
            return;
          }
        
          const base64Credentials = authHeader.split(' ')[1];
          if (!base64Credentials) {
            res.statusCode = 401;
            res.end(JSON.stringify({ status: 'error', error: 'Invalid authorization header' }));
            return;
          }
          const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
          const [username, password] = credentials.split(':');
        
          if (username !== this.config.auth.username || password !== this.config.auth.password) {
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

    try {
      const result = await this.routeRequest(method || 'GET', path!, queryParams);
      res.statusCode = result.status || 200;
      res.end(JSON.stringify(result.body || { status: 'success' }));
    } catch (error) {
      debugManager.error('api', 'Request error:', error);
      const errorObj = error as any;
      res.statusCode = errorObj.status || 500;
      
      const errorResponse: ErrorResponse = {
        status: 'error',
        error: errorObj.message || 'Internal server error'
      };
      
      if (process.env.NODE_ENV === 'development' && errorObj.stack) {
        errorResponse.stack = errorObj.stack;
      }
      
      res.end(JSON.stringify(errorResponse));
    }
  }

  private async routeRequest(method: string, path: string, queryParams?: URLSearchParams): Promise<ApiResponse> {
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
      throw { status: 404, message: 'Not found' };
    }

    return handler(params, queryParams);
  }

  private matchPath(actualPath: string, pattern: string): RouteParams | null {
    const actualParts = actualPath.split('/').filter(Boolean);
    const patternParts = pattern.split('/').filter(Boolean);

    if (actualParts.length !== patternParts.length) {
      return null;
    }

    const params: RouteParams = {};

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i]!;
      const actualPart = actualParts[i]!;

      if (patternPart.startsWith('{') && patternPart.endsWith('}')) {
        const paramName = patternPart.slice(1, -1);
        params[paramName] = decodeURIComponent(actualPart);
      } else if (patternPart.includes('{') && patternPart.includes('}')) {
        // Handle patterns like +{delta} or -{delta}
        const paramMatch = patternPart.match(/^(.*)\{([^}]+)\}(.*)$/);
        if (paramMatch) {
          const [, prefix, paramName, suffix] = paramMatch;
          if (actualPart.startsWith(prefix!) && actualPart.endsWith(suffix!)) {
            const value = actualPart.slice(prefix!.length, actualPart.length - suffix!.length);
            params[paramName!] = decodeURIComponent(value);
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
  private getDevice(roomName: string | undefined) {
    // Use default room manager to resolve room name
    const resolvedRoom = this.defaultRoomManager.getRoom(roomName);
    
    if (!resolvedRoom) {
      throw { status: 400, message: 'No room specified and no default room configured' };
    }
    
    const device = this.discovery.getDevice(resolvedRoom);
    if (!device) {
      throw { status: 404, message: `Room '${resolvedRoom}' not found` };
    }
    return device;
  }

  // System endpoints
  private async getZones(): Promise<ApiResponse> {
    return { status: 200, body: this.discovery.getZones() };
  }

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

  private async getPresets(): Promise<ApiResponse> {
    const configPresets = this.config.presets || {};
    const folderPresets = this.presetLoader ? this.presetLoader.getAllPresets() : {};
    
    return {
      status: 200,
      body: {
        config: configPresets,
        folder: folderPresets,
        all: { ...configPresets, ...folderPresets }
      }
    };
  }

  // Room-specific endpoints
  private async getRoomState({ room }: RouteParams): Promise<ApiResponse> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
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
        crossfade = crossfadeMode.CrossfadeMode === '1' || crossfadeMode.CrossfadeMode === 1;
      } catch (e) {
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
        relTime = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
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

  private async play({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.play();
    return { status: 200, body: { status: 'success' } };
  }

  private async pause({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.pause();
    return { status: 200, body: { status: 'success' } };
  }

  private async playPause({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    if (coordinator.state.playbackState === 'PLAYING') {
      await coordinator.pause();
    } else {
      await coordinator.play();
    }
    return { status: 200, body: { status: 'success' } };
  }

  private async stop({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.stop();
    return { status: 200, body: { status: 'success' } };
  }

  private async next({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.next();
    return { status: 200, body: { status: 'success' } };
  }

  private async previous({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.previous();
    return { status: 200, body: { status: 'success' } };
  }

  private async setVolume({ room, level }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!level) throw { status: 400, message: 'Level parameter is required' };
    const device = this.getDevice(room);
    const volumeLevel = parseInt(level, 10);
    
    if (isNaN(volumeLevel) || volumeLevel < 0 || volumeLevel > 100) {
      throw { status: 400, message: 'Volume must be between 0 and 100' };
    }
    
    await device.setVolume(volumeLevel);
    return { status: 200, body: { status: 'success' } };
  }

  private async volumeUp({ room, delta }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!delta) throw { status: 400, message: 'Delta parameter is required' };
    const device = this.getDevice(room);
    const deltaValue = parseInt(delta, 10);
    
    if (isNaN(deltaValue)) {
      throw { status: 400, message: 'Volume delta must be a number' };
    }
    
    // Get current volume from device to ensure it's up-to-date
    const volumeResponse = await device.getVolume();
    const currentVolume = parseInt(volumeResponse.CurrentVolume, 10);
    await device.setVolume(currentVolume + deltaValue);
    return { status: 200, body: { status: 'success' } };
  }

  private async volumeDown({ room, delta }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!delta) throw { status: 400, message: 'Delta parameter is required' };
    const device = this.getDevice(room);
    const deltaValue = parseInt(delta, 10);
    
    if (isNaN(deltaValue)) {
      throw { status: 400, message: 'Volume delta must be a number' };
    }
    
    // Get current volume from device to ensure it's up-to-date
    const volumeResponse = await device.getVolume();
    const currentVolume = parseInt(volumeResponse.CurrentVolume, 10);
    await device.setVolume(currentVolume - deltaValue);
    return { status: 200, body: { status: 'success' } };
  }

  private async mute({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    const device = this.getDevice(room);
    await device.setMute(true);
    return { status: 200, body: { status: 'success' } };
  }

  private async unmute({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    const device = this.getDevice(room);
    await device.setMute(false);
    return { status: 200, body: { status: 'success' } };
  }

  private async toggleMute({ room }: RouteParams): Promise<ApiResponse<{status: string, muted: boolean}>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    const device = this.getDevice(room);
    const currentMute = device.state.mute;
    await device.setMute(!currentMute);
    return { status: 200, body: { status: 'success', muted: !currentMute } };
  }

  private async playPreset({ room, preset }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!preset) throw { status: 400, message: 'Preset parameter is required' };
    
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
      presetConfig = this.presetLoader.getPreset(preset);
    }
    
    if (!presetConfig) {
      throw { status: 404, message: `Preset '${preset}' not found` };
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
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!targetRoom) throw { status: 400, message: 'Target room parameter is required' };
    
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
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
    const device = this.getDevice(room);
    
    // Get current zone information
    const zones = this.discovery.getZones();
    const deviceZone = zones.find(zone => 
      zone.members.some(member => member.roomName.toLowerCase() === room.toLowerCase())
    );
    
    if (!deviceZone) {
      throw { status: 404, message: `Room '${room}' not found in any zone` };
    }
    
    // Only block breaking up pure stereo pairs (exactly 2 members with same room name in zone)
    // Allow stereo pairs to leave larger groups (more than 2 members total)
    if (deviceZone.members.length === 2) {
      const uniqueRoomNames = new Set(deviceZone.members.map(m => m.roomName));
      if (uniqueRoomNames.size === 1) {
        // This is a pure stereo pair - cannot be broken
        throw { 
          status: 400, 
          message: `Cannot break stereo pair '${room}'. Stereo pairs can only be separated using the Sonos app.` 
        };
      }
    }
    
    // Try to make the device leave
    try {
      await device.becomeCoordinatorOfStandaloneGroup();
      debugManager.debug('api', `${room} left group successfully`);
      return { status: 200, body: { status: 'success' } };
    } catch (error: any) {
      // Check if this is because the device is already the coordinator
      if (error.message && (error.message.includes('1023') || error.message.includes('701'))) {
        throw { 
          status: 400, 
          message: `Cannot ungroup '${room}': It appears to be the group coordinator. Other members must leave first.` 
        };
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
            } catch (e: any) {
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
              } catch (e: any) {
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
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!otherRoom) throw { status: 400, message: 'Other room parameter is required' };
    
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
    const { room } = params;
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
    const device = this.getDevice(room);
    const { FavoritesManager } = await import('./actions/favorites.js');
    const favoritesManager = new FavoritesManager();
    
    const favorites = await favoritesManager.getFavorites(device);
    
    // Check if detailed parameter is in the URL
    const detailed = queryParams?.get('detailed') === 'true';
    
    if (detailed) {
      return { status: 200, body: favorites };
    } else {
      // Return just the titles
      return { status: 200, body: favorites.map(f => f.title) };
    }
  }

  private async playFavorite({ room, name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!name) throw { status: 400, message: 'Favorite name is required' };
    
    const device = this.getDevice(room);
    const { FavoritesManager } = await import('./actions/favorites.js');
    const favoritesManager = new FavoritesManager();
    
    const favorite = await favoritesManager.findFavoriteByName(device, name);
    
    if (!favorite) {
      throw { status: 404, message: `Favorite '${name}' not found` };
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
    const { room } = params;
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
    const device = this.getDevice(room);
    
    // Browse for playlists using ContentDirectory
    const playlists = await device.browse('SQ:', 0, 100);
    
    // Check if detailed parameter is in the URL
    const detailed = queryParams?.get('detailed') === 'true';
    
    if (detailed) {
      return { status: 200, body: playlists.items };
    } else {
      // Return just the titles
      return { status: 200, body: playlists.items.map((p: any) => p.title) };
    }
  }

  private async playPlaylist({ room, name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!name) throw { status: 400, message: 'Playlist name is required' };
    
    const device = this.getDevice(room);
    
    // Browse for playlists
    const playlists = await device.browse('SQ:', 0, 100);
    
    // Find playlist by name (case-insensitive)
    const playlist = playlists.items.find((p: any) => 
      p.title.toLowerCase() === name.toLowerCase()
    );
    
    if (!playlist) {
      throw { status: 404, message: `Playlist '${name}' not found` };
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
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!action) throw { status: 400, message: 'Action parameter is required' };
    if (!id) throw { status: 400, message: 'ID parameter is required' };
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    // Parse the ID format (e.g., "song:123456")
    const [type, contentId] = id.split(':');
    if (!type || !contentId) {
      throw { status: 400, message: 'Invalid ID format. Expected format: type:id (e.g., song:123456)' };
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
      throw { status: 400, message: `Invalid action '${action}'. Valid actions: now, next, queue` };
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
      throw { status: 400, message: `Invalid type '${type}'. Valid types: song, album, playlist` };
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
          level: 'GET /debug/level/{level} - Set log level (error|warn|info|debug)',
          category: 'GET /debug/category/{category}/{enabled} - Enable/disable category (true|false)',
          enableAll: 'GET /debug/enable-all - Enable all debug categories',
          disableAll: 'GET /debug/disable-all - Disable all debug categories (except API)',
          categories: 'soap, topology, discovery, favorites, presets, upnp, api'
        }
      }
    };
  }

  private async setDebugLevel({ level }: RouteParams): Promise<ApiResponse> {
    if (!level) throw { status: 400, message: 'Level parameter is required' };
    
    const validLevels: LogLevel[] = ['error', 'warn', 'info', 'debug', 'wall'];
    if (!validLevels.includes(level as LogLevel)) {
      throw { status: 400, message: `Invalid log level. Must be one of: ${validLevels.join(', ')}` };
    }

    debugManager.setLogLevel(level as LogLevel);
    return { status: 200, body: { status: 'success', logLevel: level } };
  }

  private async setDebugCategory({ category, enabled }: RouteParams): Promise<ApiResponse> {
    if (!category) throw { status: 400, message: 'Category parameter is required' };
    if (!enabled) throw { status: 400, message: 'Enabled parameter is required' };

    const validCategories: (keyof DebugCategories)[] = ['soap', 'topology', 'discovery', 'favorites', 'presets', 'upnp', 'api', 'sse'];
    if (!validCategories.includes(category as keyof DebugCategories)) {
      throw { status: 400, message: `Invalid category. Must be one of: ${validCategories.join(', ')}` };
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
  
  // Default room management endpoints
  private async getDefaults(): Promise<ApiResponse> {
    return {
      status: 200,
      body: this.defaultRoomManager.getSettings()
    };
  }
  
  private async setDefaultRoom({ room }: RouteParams): Promise<ApiResponse> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
    // Verify room exists
    const device = this.discovery.getDevice(room);
    if (!device) {
      throw { status: 404, message: `Room '${room}' not found` };
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
    if (!service) throw { status: 400, message: 'Service parameter is required' };
    
    // Validate service (could expand this list as more services are implemented)
    const validServices = ['library', 'apple', 'spotify', 'amazon', 'pandora', 'tunein', 'siriusxm'];
    if (!validServices.includes(service.toLowerCase())) {
      throw { status: 400, message: `Invalid service. Valid services: ${validServices.join(', ')}` };
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
    if (!level) throw { status: 400, message: 'Level parameter is required' };
    const device = this.getDevice(undefined); // Will use default room
    const volumeLevel = parseInt(level, 10);
    
    if (isNaN(volumeLevel) || volumeLevel < 0 || volumeLevel > 100) {
      throw { status: 400, message: 'Volume must be between 0 and 100' };
    }
    
    await device.setVolume(volumeLevel);
    return { status: 200, body: { status: 'success' } };
  }
  
  private async playPresetDefault({ preset }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!preset) throw { status: 400, message: 'Preset parameter is required' };
    
    const device = this.getDevice(undefined); // Will use default room
    
    // Look in config presets first, then folder presets
    let presetConfig = this.config.presets[preset];
    if (!presetConfig && this.presetLoader) {
      presetConfig = this.presetLoader.getPreset(preset);
    }
    
    if (!presetConfig) {
      throw { status: 404, message: `Preset '${preset}' not found` };
    }
    
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.playPreset(presetConfig, this.discovery);
    return { status: 200, body: { status: 'success' } };
  }
  
  private async playPresetInRoom({ preset, room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!preset) throw { status: 400, message: 'Preset parameter is required' };
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
    // This is the same as playPreset but with different route format
    return this.playPreset({ room, preset });
  }
  
  // Default music search endpoints (use default room and service)
  private async musicSearchSongDefault({ query }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!query) throw { status: 400, message: 'Query is required' };
    
    const room = this.defaultRoomManager.getRoom();
    if (!room) throw { status: 400, message: 'No default room set' };
    
    const service = this.defaultRoomManager.getMusicService();
    
    return this.performMusicSearch(room, service, 'song', query);
  }
  
  private async musicSearchAlbumDefault({ name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!name) throw { status: 400, message: 'Album name is required' };
    
    const room = this.defaultRoomManager.getRoom();
    if (!room) throw { status: 400, message: 'No default room set' };
    
    const service = this.defaultRoomManager.getMusicService();
    
    return this.performMusicSearch(room, service, 'album', name);
  }
  
  private async musicSearchStationDefault({ name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!name) throw { status: 400, message: 'Station name is required' };
    
    const room = this.defaultRoomManager.getRoom();
    if (!room) throw { status: 400, message: 'No default room set' };
    
    const service = this.defaultRoomManager.getMusicService();
    
    return this.performMusicSearch(room, service, 'station', name);
  }
  
  // Music search endpoints
  private async musicSearchAlbum({ room, service, name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!service) throw { status: 400, message: 'Service parameter is required' };
    if (!name) throw { status: 400, message: 'Album name is required' };
    
    return this.performMusicSearch(room, service, 'album', name);
  }
  
  private async musicSearchSong({ room, service, query }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!service) throw { status: 400, message: 'Service parameter is required' };
    if (!query) throw { status: 400, message: 'Query is required' };
    
    return this.performMusicSearch(room, service, 'song', query);
  }
  
  private async musicSearchStation({ room, service, name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!service) throw { status: 400, message: 'Service parameter is required' };
    if (!name) throw { status: 400, message: 'Station name is required' };
    
    return this.performMusicSearch(room, service, 'station', name);
  }
  
  // Music library search endpoints
  private async musicLibrarySearchSong({ room, query }: RouteParams): Promise<ApiResponse<MusicSearchSuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!query) throw { status: 400, message: 'Query parameter is required' };
    
    if (!this.musicLibraryCache) {
      throw { status: 503, message: 'Music library not yet indexed' };
    }
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    try {
      const results = await this.musicLibraryCache.search(query, 'title', 50);
      
      if (results.length === 0) {
        throw { status: 404, message: `No songs found matching: ${query}` };
      }
      
      // Play the first result
      const track = results[0]!;
      await coordinator.setAVTransportURI(track.uri, '');
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
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) {
        throw error;
      }
      throw { status: 500, message: `Library search failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }
  
  private async musicLibrarySearchArtist({ room, query }: RouteParams): Promise<ApiResponse<MusicSearchSuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!query) throw { status: 400, message: 'Query parameter is required' };
    
    if (!this.musicLibraryCache) {
      throw { status: 503, message: 'Music library not yet indexed' };
    }
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    try {
      const results = await this.musicLibraryCache.search(query, 'artist', 50);
      
      if (results.length === 0) {
        throw { status: 404, message: `No tracks by artist matching: ${query}` };
      }
      
      // Play the first result
      const track = results[0]!;
      await coordinator.setAVTransportURI(track.uri, '');
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
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) {
        throw error;
      }
      throw { status: 500, message: `Library search failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }
  
  private async musicLibrarySearchAlbum({ room, query }: RouteParams): Promise<ApiResponse<MusicSearchSuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!query) throw { status: 400, message: 'Query parameter is required' };
    
    if (!this.musicLibraryCache) {
      throw { status: 503, message: 'Music library not yet indexed' };
    }
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    try {
      const results = await this.musicLibraryCache.search(query, 'album', 50);
      
      if (results.length === 0) {
        throw { status: 404, message: `No tracks from album matching: ${query}` };
      }
      
      // Play the first result
      const track = results[0]!;
      await coordinator.setAVTransportURI(track.uri, '');
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
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) {
        throw error;
      }
      throw { status: 500, message: `Library search failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }
  
  private async getMusicLibraryStatus(): Promise<ApiResponse<any>> {
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
  
  // Service-specific endpoints
  private async siriusXM({ room, name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!name) throw { status: 400, message: 'Station name is required' };
    
    // SiriusXM requires authentication and special handling
    throw { status: 501, message: 'SiriusXM support not yet implemented' };
  }
  
  
  private async pandoraPlay({ room, name }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!name) throw { status: 400, message: 'Station name is required' };
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    try {
      const decodedName = decodeURIComponent(name);
      let stationUri: string | null = null;
      let stationTitle: string | null = null;
      
      // Try using Pandora API if credentials are configured
      if (this.config.pandora?.username && this.config.pandora?.password) {
        logger.debug('Using Pandora API to find station');
        const { PandoraAPI } = await import('./services/pandora-api.js');
        const { PandoraService } = await import('./services/pandora-service.js');
        
        const api = new PandoraAPI(this.config.pandora.username, this.config.pandora.password);
        
        try {
          // Login to Pandora
          await api.login();
          
          // Search for the station
          const searchResult = await PandoraService.searchForStation(api, decodedName);
          
          if (searchResult) {
            stationUri = searchResult.uri;
            stationTitle = searchResult.title;
            logger.info(`Found Pandora station via API: ${stationTitle}`);
          }
        } catch (apiError) {
          logger.warn('Pandora API failed, falling back to browse method:', apiError);
        }
      }
      
      // Fall back to browse method if API didn't work
      if (!stationUri) {
        logger.debug('Using browse method to find Pandora station');
        const { PandoraBrowser } = await import('./services/pandora-browse.js');
        
        const station = await PandoraBrowser.findStation(coordinator, decodedName);
        if (!station) {
          throw new Error(`Pandora station '${decodedName}' not found`);
        }
        
        stationUri = station.uri;
        stationTitle = station.title;
      }
      
      // Ensure we have both URI and title
      if (!stationUri || !stationTitle) {
        throw new Error(`Failed to find complete Pandora station information for '${decodedName}'`);
      }
      
      // Generate metadata with proper service type
      const metadata = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"
        xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/"
        xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
        <item id="${stationUri}" parentID="0" restricted="true">
          <dc:title>${stationTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</dc:title>
          <upnp:class>object.item.audioItem.audioBroadcast</upnp:class>
          <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON2311_X_#Svc2311-0-Token</desc>
        </item>
      </DIDL-Lite>`;
      
      // IMPORTANT: Pandora requires proper session management on Sonos
      // When switching between Pandora stations, we MUST stop playback first
      // to release the current session. Otherwise, you'll get 701 or ERROR_NOT_AVAILABLE
      // See: https://github.com/jishi/node-sonos-http-api/issues/119
      const currentState = coordinator.state;
      const isCurrentlyPlayingPandora = currentState.currentTrack?.uri?.includes('x-sonosapi-radio') && 
                                       currentState.currentTrack?.uri?.includes('sid=236');
      const isPlayingAnything = currentState.playbackState === 'PLAYING';
      
      if (isCurrentlyPlayingPandora || isPlayingAnything) {
        logger.debug('Stopping playback to ensure clean Pandora session');
        await coordinator.stop();
        // Wait for Pandora to release the session
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Set the new Pandora station URI with fresh metadata
      logger.debug(`Setting Pandora URI: ${stationUri}`);
      await coordinator.setAVTransportURI(stationUri, metadata);
      
      // Wait for transport to be ready
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Start playback
      logger.debug('Starting Pandora playback');
      await coordinator.play();
      
      // Update default room
      this.defaultRoomManager.setDefaults(room);
      
      return { status: 200, body: { status: 'success' } };
    } catch (error: any) {
      logger.error(`Failed to play Pandora station '${name}':`, error);
      throw { status: 404, message: error.message || 'Failed to play Pandora station' };
    }
  }
  
  private async pandoraThumbsUp({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
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
    } catch (error: any) {
      logger.error('Failed to send Pandora thumbs up:', error);
      throw { status: 400, message: error.message || 'Failed to send thumbs up' };
    }
  }
  
  private async pandoraThumbsDown({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
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
    } catch (error: any) {
      logger.error('Failed to send Pandora thumbs down:', error);
      throw { status: 400, message: error.message || 'Failed to send thumbs down' };
    }
  }
  
  private async pandoraGetStations(params: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse> {
    const { room } = params;
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
    try {
      // Check if Pandora credentials are configured
      if (!this.config.pandora?.username || !this.config.pandora?.password) {
        throw { status: 501, message: 'Pandora credentials not configured' };
      }
      
      const { PandoraAPI } = await import('./services/pandora-api.js');
      const api = new PandoraAPI(this.config.pandora.username, this.config.pandora.password);
      
      // Login to Pandora
      await api.login();
      
      // Get station list
      const stationData = await api.getStationList();
      
      // Check if detailed parameter is in the URL
      const detailed = queryParams?.get('detailed') === 'true';
      
      if (detailed) {
        // Return full station data with metadata
        return { status: 200, body: stationData };
      } else {
        // Return just the station names for backwards compatibility
        return { status: 200, body: stationData.stations.map(s => s.stationName) };
      }
    } catch (error: any) {
      logger.error('Failed to get Pandora stations:', error);
      if (error.status) throw error;
      throw { status: 500, message: error.message || 'Failed to get Pandora stations' };
    }
  }
  
  // Queue management endpoints
  private async getQueue({ room, limit, offset }: RouteParams): Promise<ApiResponse> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
    const device = this.getDevice(room);
    // Use coordinator for queue operations
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    const limitNum = limit ? parseInt(limit as string) : 100;
    const offsetNum = offset ? parseInt(offset as string) : 0;
    
    const queueData = await coordinator.getQueue(limitNum, offsetNum);
    
    // Return the full queue object for proper API compatibility
    return { status: 200, body: queueData };
  }
  
  private async getQueueDetailed({ room }: RouteParams): Promise<ApiResponse> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
    const device = this.getDevice(room);
    // Use coordinator for queue operations
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    // For detailed, return the full queue data structure
    const queueData = await coordinator.getQueue(100, 0);
    
    return { status: 200, body: queueData };
  }
  
  // Playback control endpoints
  private async clearQueue({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    await coordinator.clearQueue();
    return { status: 200, body: { status: 'success' } };
  }
  
  private async setRepeat({ room, toggle }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!toggle) throw { status: 400, message: 'Toggle parameter is required' };
    
    if (toggle !== 'on' && toggle !== 'off') {
      throw { status: 400, message: 'Toggle must be "on" or "off"' };
    }
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.setRepeat(toggle === 'on' ? 'all' : 'none');
    
    return { status: 200, body: { status: 'success' } };
  }
  
  private async setShuffle({ room, toggle }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!toggle) throw { status: 400, message: 'Toggle parameter is required' };
    
    if (toggle !== 'on' && toggle !== 'off') {
      throw { status: 400, message: 'Toggle must be "on" or "off"' };
    }
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.setShuffle(toggle === 'on');
    
    return { status: 200, body: { status: 'success' } };
  }
  
  private async setCrossfade({ room, toggle }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!toggle) throw { status: 400, message: 'Toggle parameter is required' };
    
    if (toggle !== 'on' && toggle !== 'off') {
      throw { status: 400, message: 'Toggle must be "on" or "off"' };
    }
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.setCrossfade(toggle === 'on');
    
    return { status: 200, body: { status: 'success' } };
  }
  
  private async setSleepTimer({ room, seconds }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!seconds) throw { status: 400, message: 'Seconds parameter is required' };
    
    const sleepSeconds = parseInt(seconds, 10);
    if (isNaN(sleepSeconds) || sleepSeconds < 0) {
      throw { status: 400, message: 'Seconds must be a non-negative number' };
    }
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    await coordinator.setSleepTimer(sleepSeconds);
    
    return { status: 200, body: { status: 'success' } };
  }
  
  private async playLineIn({ room, source }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    // If no source is specified, use the same room as the source
    const sourceRoom = source || room;
    
    // Find the source device to get its UUID
    const sourceDevice = this.discovery.getDevice(sourceRoom);
    if (!sourceDevice) {
      throw { status: 404, message: `Could not find player ${sourceRoom}` };
    }
    
    await coordinator.playLineIn(sourceDevice);
    
    return { status: 200, body: { status: 'success' } };
  }
  
  private async setGroupVolume({ room, level }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!level) throw { status: 400, message: 'Level parameter is required' };
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    const volumeLevel = parseInt(level, 10);
    
    if (isNaN(volumeLevel) || volumeLevel < 0 || volumeLevel > 100) {
      throw { status: 400, message: 'Volume must be between 0 and 100' };
    }
    
    await coordinator.setGroupVolume(volumeLevel);
    return { status: 200, body: { status: 'success' } };
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
    if (!level) throw { status: 400, message: 'Level parameter is required' };
    
    const validLevels = ['error', 'warn', 'info', 'debug'];
    if (!validLevels.includes(level)) {
      throw { status: 400, message: `Invalid log level. Must be one of: ${validLevels.join(', ')}` };
    }
    
    // Set both winston logger level and debug manager level
    logger.level = level;
    debugManager.setLogLevel(level as LogLevel);
    
    return { status: 200, body: { status: 'success', logLevel: level } };
  }
  
  // TTS endpoints
  private async sayText({ room, text }: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!text) throw { status: 400, message: 'Text parameter is required' };
    
    const device = this.getDevice(room);
    const language = queryParams?.get('language') || 'en';
    const volume = parseInt(queryParams?.get('volume') || String(this.config.announceVolume || 40), 10);
    
    // Get the base URL for this server
    const baseUrl = `http://${this.config.host || 'localhost'}:${this.config.port}`;
    
    try {
      // Generate TTS URL
      const decodedText = decodeURIComponent(text);
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
      throw { status: 500, message: `TTS failed: ${(error as Error).message}` };
    }
  }
  
  private async sayTextAll({ room, text }: RouteParams, queryParams?: URLSearchParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!text) throw { status: 400, message: 'Text parameter is required' };
    
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
    if (!text) throw { status: 400, message: 'Text parameter is required' };
    
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
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!text) throw { status: 400, message: 'Text parameter is required' };
    if (!volume) throw { status: 400, message: 'Volume parameter is required' };
    
    // Convert volume to query parameter and delegate
    const queryParams = new URLSearchParams();
    queryParams.set('volume', volume);
    
    return this.sayText({ room, text }, queryParams);
  }

  private async sayTextAllWithVolume({ room, text, volume }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!text) throw { status: 400, message: 'Text parameter is required' };
    if (!volume) throw { status: 400, message: 'Volume parameter is required' };
    
    // Convert volume to query parameter and delegate
    const queryParams = new URLSearchParams();
    queryParams.set('volume', volume);
    
    return this.sayTextAll({ room, text }, queryParams);
  }

  private async sayTextAllRoomsWithVolume({ text, volume }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!text) throw { status: 400, message: 'Text parameter is required' };
    if (!volume) throw { status: 400, message: 'Volume parameter is required' };
    
    // Convert volume to query parameter and delegate
    const queryParams = new URLSearchParams();
    queryParams.set('volume', volume);
    
    return this.sayTextAllRooms({ text }, queryParams);
  }

  /**
   * Perform music search and play results
   */
  private async performMusicSearch(roomName: string, service: string, type: 'album' | 'song' | 'station', term: string): Promise<ApiResponse<MusicSearchSuccessResponse>> {
    const device = this.getDevice(roomName);
    if (!device) {
      throw { status: 404, message: `Room '${roomName}' not found` };
    }

    // Get coordinator for playback
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    if (!coordinator) {
      throw { status: 404, message: `No coordinator found for room '${roomName}'` };
    }

    // Check supported services and types
    const serviceLower = service.toLowerCase();
    if (serviceLower === 'pandora' && type !== 'station') {
      throw { status: 400, message: `Pandora only supports station search, not ${type}` };
    }
    if (serviceLower === 'library' && type === 'station') {
      throw { status: 400, message: 'Library does not support station search, only song and album' };
    }
    if (serviceLower !== 'apple' && serviceLower !== 'pandora' && serviceLower !== 'library') {
      throw { status: 501, message: `Music search for '${service}' not yet implemented. Only 'apple', 'pandora', and 'library' are supported.` };
    }

    try {
      // Handle Pandora station search differently
      if (serviceLower === 'pandora') {
        logger.info(`Searching Pandora for station: ${term}`);
        
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
          throw { status: 503, message: 'Music library not yet indexed' };
        }
        
        const searchType = type === 'album' ? 'album' : 'title';
        const results = await this.musicLibraryCache.search(term, searchType, 50);
        
        if (results.length === 0) {
          throw { status: 404, message: `No ${type}s found matching: ${term}` };
        }
        
        const track = results[0]!;
        
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
      
      // Apple Music logic
      // Get service account from Sonos
      const account = await this.accountService.getServiceAccount(coordinator, service);
      if (!account) {
        throw { status: 503, message: `${service} service not configured in Sonos. Please add ${service} account in Sonos app.` };
      }

      // Set account in service
      this.appleMusicService.setAccount(account);

      // Perform search
      logger.info(`Searching ${service} for ${type}: ${term}`);
      const results = await this.appleMusicService.search(type, term);
      
      if (results.length === 0) {
        throw { status: 404, message: `No ${type}s found for: ${term}` };
      }

      // Use first result
      const result = results[0];
      if (!result) {
        throw { status: 404, message: `No valid ${type} found for: ${term}` };
      }
      logger.info(`Found ${type}: ${result.title} by ${result.artist || 'Unknown'}`);

      // Generate URI and metadata
      const uri = this.appleMusicService.generateURI(type, result);
      const metadata = this.appleMusicService.generateMetadata(type, result);

      logger.debug(`Generated URI: ${uri}`);

      // Play the content
      if (type === 'station') {
        // Stations play directly
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
        // Songs can be added to current queue or replace it
        const queueURI = `x-rincon-queue:${coordinator.id.replace('uuid:', '')}#0`;
        
        // Check if queue is empty
        const currentState = coordinator.state;
        const isEmpty = !currentState.currentTrack?.uri || currentState.currentTrack.uri === '';
        
        if (isEmpty) {
          // Empty queue - set up and play
          await coordinator.setAVTransportURI(queueURI, '');
          await coordinator.addURIToQueue(uri, metadata, true, 1);
        } else {
          // Add after current track
          const nextTrackNo = 1; // Add as next track
          await coordinator.addURIToQueue(uri, metadata, true, nextTrackNo);
          await coordinator.setAVTransportURI(queueURI, '');
          await coordinator.next();
        }
        
        await coordinator.play();
      }

      // Update default room
      this.defaultRoomManager.setDefaults(roomName);

      return { 
        status: 200, 
        body: { 
          status: 'success',
          title: result.title,
          artist: result.artist,
          album: result.album,
          service: service
        } 
      };
    } catch (error) {
      logger.error(`Music search failed for ${service} ${type} "${term}":`, error);
      
      if (error && typeof error === 'object' && 'status' in error) {
        throw error; // Re-throw API errors
      }
      
      throw { 
        status: 500, 
        message: `Music search failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }
  
  // Debug endpoint for account testing
  async debugAccounts({ room }: RouteParams): Promise<ApiResponse<any>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    try {
      // Try multiple endpoints to find account data
      const endpoints = [
        '/status/accounts',
        '/status',
        '/status/zp',
        '/xml/device_description.xml'
      ];
      
      const results: any = {};
      
      for (const endpoint of endpoints) {
        try {
          const url = `${coordinator.baseUrl}${endpoint}`;
          const response = await fetch(url);
          const text = await response.text();
          results[endpoint] = {
            status: response.status,
            length: text.length,
            content: text.substring(0, 500) + (text.length > 500 ? '...' : '')
          };
        } catch (error) {
          results[endpoint] = { error: (error as Error).message };
        }
      }
      
      // Also try to call the account service directly
      const account = await this.accountService.getServiceAccount(coordinator, 'apple');
      
      return {
        status: 200,
        body: {
          device: {
            id: coordinator.id,
            baseUrl: coordinator.baseUrl,
            roomName: coordinator.roomName
          },
          endpoints: results,
          appleAccount: account,
          cachedAccounts: this.accountService.getCachedAccounts()
        }
      };
    } catch (error) {
      throw { status: 500, message: `Debug failed: ${(error as Error).message}` };
    }
  }

  async debugSubscriptions(): Promise<ApiResponse<any>> {
    const devices = this.discovery.getAllDevices();
    const subscriber = (this.discovery as any).subscriber;
    
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
}