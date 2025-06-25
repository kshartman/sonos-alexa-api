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
  coordinator?: any; // Will be SonosDevice but avoiding circular reference
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
  url: string;
  headers?: Record<string, string>;
}

export interface Config {
  port: number;
  logLevel: string;
  presetDir: string;
  presets: PresetCollection;
  webhooks: WebhookConfig[];
  defaultRoom?: string;
  defaultMusicService?: string;
  dataDir?: string;
  // From settings.json
  host?: string;
  listenAddress?: string;
  auth?: {
    username: string;
    password: string;
    rejectUnauthorized?: boolean;
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
  };
  library?: {
    randomQueueLimit: number;
  };
}

export interface ApiResponse<T = any> {
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
}

export interface BrowseResult {
  items: BrowseItem[];
  startIndex: number;
  numberReturned: number;
  totalMatches: number;
}