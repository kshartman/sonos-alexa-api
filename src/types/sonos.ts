export interface SonosTrack {
  artist: string;
  title: string;
  album: string;
  albumArtUri: string;  // Legacy uses lowercase 'i'
  duration: number;     // Duration in seconds
  uri: string;
  trackUri: string;     // Legacy compatibility - same as uri
  type: 'track' | 'radio' | 'line_in';
  stationName: string;  // For radio stations
}

export interface SonosState {
  playbackState: 'PLAYING' | 'PAUSED_PLAYBACK' | 'STOPPED';
  volume: number;
  mute: boolean;
  currentTrack: SonosTrack | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  coordinator?: any; // MUST BE ANY: SonosDevice would create circular dependency between types/sonos.ts and sonos-device.ts
}

export interface DeviceInfo {
  device: {
    UDN: string;
    modelName: string;
    modelNumber: string;
    roomName: string;
  };
}

export interface ZoneMember {
  id: string;
  roomName: string;
  isCoordinator: boolean;
}

export interface Zone {
  id: string;
  coordinator: string;
  members: ZoneMember[];
}

export interface Preset {
  uri: string;
  metadata?: string;
  volume?: number;
}

// Legacy preset format from old node-sonos-http-api
export interface LegacyPreset {
  players: Array<{
    roomName: string;
    volume: number;
  }>;
  state?: 'stopped' | 'playing' | 'paused';
  favorite?: string;
  uri?: string;
  spotifyUrl?: string; // New field for Spotify share URLs
  playMode?: {
    shuffle?: boolean;
    repeat?: 'none' | 'all' | 'one';
    crossfade?: boolean;
  };
  pauseOthers?: boolean;
  sleep?: number;
}

export interface PresetCollection {
  [name: string]: Preset;
}

export interface WebhookConfig {
  type?: 'volume' | 'transport' | 'topology';
  url: string;
  headers?: Record<string, string>;
}

export interface Config {
  port: number;
  logLevel: string;
  debugCategories?: string[];
  presetDir: string;
  presets: PresetCollection;
  webhooks: WebhookConfig[];
  defaultRoom?: string;
  defaultMusicService?: string;
  dataDir?: string;
  // Environment
  nodeEnv?: string;
  logger?: string;
  ttsHostIp?: string;
  // Computed environment helpers
  readonly isDevelopment: boolean;
  readonly isProduction: boolean;
  // Version
  readonly version: string;
  // Build date
  readonly buildDate: string;
  // From settings.json
  host?: string;
  auth?: {
    username: string;
    password: string;
    rejectUnauthorized?: boolean;
    trustedNetworks?: string[];
  };
  announceVolume?: number;
  voicerss?: string;
  macSay?: {
    voice?: string;
    rate?: number;
  };
  pandora?: {
    username: string;
    password: string;
  };
  spotify?: {
    clientId: string;
    clientSecret: string;
    refreshToken?: string;
    redirectUri?: string;
    scopes?: string[];
  };
  library?: {
    randomQueueLimit?: number;
    reindexInterval?: string;
  };
  tts?: {
    provider?: string;
    lang?: string;
    voice?: string;
    endpoint?: string;
    apiKey?: string;
  };
  // Advanced settings
  disableDiscovery?: boolean;
  discoveryTimeout?: number;
  httpTimeout?: number;
  cacheDir?: string;
  createDefaultPresets?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ApiResponse<T = any> { // ANY IS CORRECT: Generic default for flexible API responses
  status: number;
  body: T;
}

export interface ErrorResponse {
  status: 'error';
  error: string;
  stack?: string;
}

export interface SuccessResponse {
  status: 'success';
}

export interface MusicSearchSuccessResponse {
  status: 'success';
  title: string;
  artist?: string;
  album?: string;
  service: string;
  message?: string;
}

export interface LibrarySearchResult {
  title: string;
  artist?: string;
  album?: string;
  uri: string;
  id: string;
  type: 'track' | 'album' | 'station' | 'artist';
}

export interface LibrarySearchSuccessResponse {
  status: 'success';
  service: string;
  type: 'song' | 'album' | 'station' | 'artist';
  query: string;
  results: LibrarySearchResult[];
}

export interface StateChangeEvent {
  type: 'device-state-change';
  data: {
    room: string;
    deviceId: string;
    state: SonosState;
    previousState?: Partial<SonosState>;
  };
}

export interface RouteParams {
  [key: string]: string;
}

export interface SonosService {
  serviceType: string;
  controlURL: string;
  eventSubURL: string;
}

export interface BrowseItem {
  id: string;
  parentId: string;
  title: string;
  itemType: 'container' | 'item';
  uri: string;
  artist?: string;
  album?: string;
  metadata?: string;
  desc?: string; // DIDL-Lite desc field containing tokens
}

export interface BrowseResult {
  items: BrowseItem[];
  startIndex: number;
  numberReturned: number;
  totalMatches: number;
}