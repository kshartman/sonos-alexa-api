import { IncomingMessage, ServerResponse } from 'http';
import logger from './utils/logger.js';
import type { SonosDiscovery } from './discovery.js';
import type { PresetLoader } from './preset-loader.js';
import type { DefaultRoomManager } from './utils/default-room-manager.js';
import type { TTSService } from './services/tts-service.js';
import { AppleMusicService } from './services/apple-music-service.js';
import { AccountService } from './services/account-service.js';
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
    this.routes.set('GET /{room}/volume/{level}', this.setVolume.bind(this));
    this.routes.set('GET /{room}/volume/+{delta}', this.volumeUp.bind(this));
    this.routes.set('GET /{room}/volume/-{delta}', this.volumeDown.bind(this));
    this.routes.set('GET /{room}/mute', this.mute.bind(this));
    this.routes.set('GET /{room}/unmute', this.unmute.bind(this));
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

    // Music search routes (for Alexa compatibility)
    this.routes.set('GET /{room}/musicsearch/{service}/album/{name}', this.musicSearchAlbum.bind(this));
    this.routes.set('GET /{room}/musicsearch/{service}/song/{query}', this.musicSearchSong.bind(this));
    this.routes.set('GET /{room}/musicsearch/{service}/station/{name}', this.musicSearchStation.bind(this));
    
    // Service-specific routes
    this.routes.set('GET /{room}/siriusxm/{name}', this.siriusXM.bind(this));
    this.routes.set('GET /{room}/pandora/play/{name}', this.pandoraPlay.bind(this));
    this.routes.set('GET /{room}/pandora/thumbsup', this.pandoraThumbsUp.bind(this));
    this.routes.set('GET /{room}/pandora/thumbsdown', this.pandoraThumbsDown.bind(this));
    
    // Playback control routes
    this.routes.set('GET /{room}/clearqueue', this.clearQueue.bind(this));
    this.routes.set('GET /{room}/repeat/{toggle}', this.setRepeat.bind(this));
    this.routes.set('GET /{room}/shuffle/{toggle}', this.setShuffle.bind(this));
    this.routes.set('GET /{room}/crossfade/{toggle}', this.setCrossfade.bind(this));
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
    this.routes.set('GET /{room}/sayall/{text}', this.sayTextAll.bind(this));
    this.routes.set('GET /sayall/{text}', this.sayTextAllRooms.bind(this));
    
    // Music search with defaults (room-less endpoints)
    this.routes.set('GET /song/{query}', this.musicSearchSongDefault.bind(this));
    this.routes.set('GET /album/{name}', this.musicSearchAlbumDefault.bind(this));
    this.routes.set('GET /station/{name}', this.musicSearchStationDefault.bind(this));
    
    // Debug endpoint for account testing
    this.routes.set('GET /{room}/debug/accounts', this.debugAccounts.bind(this));
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
    
    // Create a safe copy of the state without circular references
    const safeState = {
      playbackState: device.state.playbackState,
      volume: device.state.volume,
      mute: device.state.mute,
      currentTrack: device.state.currentTrack,
      coordinator: device.state.coordinator ? {
        id: device.state.coordinator.id,
        roomName: device.state.coordinator.roomName,
        modelName: device.state.coordinator.modelName
      } : undefined
    };
    
    return { status: 200, body: safeState };
  }

  private async play({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    const device = this.getDevice(room);
    await device.play();
    return { status: 200, body: { status: 'success' } };
  }

  private async pause({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    const device = this.getDevice(room);
    await device.pause();
    return { status: 200, body: { status: 'success' } };
  }

  private async playPause({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    const device = this.getDevice(room);
    if (device.state.playbackState === 'PLAYING') {
      await device.pause();
    } else {
      await device.play();
    }
    return { status: 200, body: { status: 'success' } };
  }

  private async stop({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    const device = this.getDevice(room);
    await device.stop();
    return { status: 200, body: { status: 'success' } };
  }

  private async next({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    const device = this.getDevice(room);
    await device.next();
    return { status: 200, body: { status: 'success' } };
  }

  private async previous({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    const device = this.getDevice(room);
    await device.previous();
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
    
    const currentVolume = device.state.volume;
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
    
    const currentVolume = device.state.volume;
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
    await Promise.all(devices.map(device => device.pause().catch(err => 
      logger.error(`Error pausing ${device.roomName}:`, err)
    )));
    return { status: 200, body: { status: 'success' } };
  }


  // Group management endpoints
  private async joinGroup({ room, targetRoom }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!targetRoom) throw { status: 400, message: 'Target room parameter is required' };
    
    const device = this.getDevice(room);
    const targetDevice = this.getDevice(targetRoom);
    
    // Get the coordinator of the target room's group
    const targetCoordinator = this.discovery.getCoordinator(targetDevice.id) || targetDevice;
    
    // Make this device join the target coordinator's group
    await device.addPlayerToGroup(targetCoordinator.id.replace('uuid:', ''));
    
    return { status: 200, body: { status: 'success' } };
  }

  private async leaveGroup({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
    const device = this.getDevice(room);
    
    // Make this device become a standalone coordinator
    await device.becomeCoordinatorOfStandaloneGroup();
    
    return { status: 200, body: { status: 'success' } };
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
  private async getFavorites({ room, queryParams }: RouteParams & { queryParams?: URLSearchParams }): Promise<ApiResponse> {
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
    
    return { status: 200, body: { status: 'success' } };
  }

  // Playlists endpoints
  private async getPlaylists({ room, queryParams }: RouteParams & { queryParams?: URLSearchParams }): Promise<ApiResponse> {
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
    
    const validLevels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    if (!validLevels.includes(level as LogLevel)) {
      throw { status: 400, message: `Invalid log level. Must be one of: ${validLevels.join(', ')}` };
    }

    debugManager.setLogLevel(level as LogLevel);
    return { status: 200, body: { status: 'success', logLevel: level } };
  }

  private async setDebugCategory({ category, enabled }: RouteParams): Promise<ApiResponse> {
    if (!category) throw { status: 400, message: 'Category parameter is required' };
    if (!enabled) throw { status: 400, message: 'Enabled parameter is required' };

    const validCategories: (keyof DebugCategories)[] = ['soap', 'topology', 'discovery', 'favorites', 'presets', 'upnp', 'api'];
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
    await device.play();
    return { status: 200, body: { status: 'success' } };
  }
  
  private async pauseDefault(): Promise<ApiResponse<SuccessResponse>> {
    const device = this.getDevice(undefined); // Will use default room
    await device.pause();
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

    await device.playPreset(presetConfig, this.discovery);
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
    
    throw { status: 501, message: 'Pandora support not yet implemented' };
  }
  
  private async pandoraThumbsUp({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
    throw { status: 501, message: 'Pandora support not yet implemented' };
  }
  
  private async pandoraThumbsDown({ room }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    
    throw { status: 501, message: 'Pandora support not yet implemented' };
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
    await device.setRepeat(toggle === 'on' ? 'all' : 'none');
    
    return { status: 200, body: { status: 'success' } };
  }
  
  private async setShuffle({ room, toggle }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!toggle) throw { status: 400, message: 'Toggle parameter is required' };
    
    if (toggle !== 'on' && toggle !== 'off') {
      throw { status: 400, message: 'Toggle must be "on" or "off"' };
    }
    
    const device = this.getDevice(room);
    await device.setShuffle(toggle === 'on');
    
    return { status: 200, body: { status: 'success' } };
  }
  
  private async setCrossfade({ room, toggle }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!toggle) throw { status: 400, message: 'Toggle parameter is required' };
    
    if (toggle !== 'on' && toggle !== 'off') {
      throw { status: 400, message: 'Toggle must be "on" or "off"' };
    }
    
    const device = this.getDevice(room);
    await device.setCrossfade(toggle === 'on');
    
    return { status: 200, body: { status: 'success' } };
  }
  
  private async playLineIn({ room, source }: RouteParams): Promise<ApiResponse<SuccessResponse>> {
    if (!room) throw { status: 400, message: 'Room parameter is required' };
    if (!source) throw { status: 400, message: 'Source parameter is required' };
    
    const device = this.getDevice(room);
    await device.playLineIn(source);
    
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
    
    // Set the winston logger level
    logger.level = level;
    
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

    // Currently only Apple Music is implemented
    if (service.toLowerCase() !== 'apple') {
      throw { status: 501, message: `Music search for '${service}' not yet implemented. Only 'apple' is supported.` };
    }

    try {
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
}