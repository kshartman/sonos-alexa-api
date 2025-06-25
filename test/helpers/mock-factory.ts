import type { Config } from '../../src/types/sonos.js';
import type { DefaultRoomManager } from '../../src/utils/default-room-manager.js';
import type { TTSService } from '../../src/services/tts-service.js';
import type { PresetLoader } from '../../src/preset-loader.js';

interface Zone {
  id: string;
  coordinator: {
    id: string;
    roomName: string;
    uuid: string;
  };
  members: Array<{
    id: string;
    roomName: string;
    uuid: string;
  }>;
}

export interface MockCall {
  method: string;
  args: any[];
  timestamp: number;
}

export class MockDevice {
  public id: string;
  public roomName: string;
  public calls: MockCall[] = [];
  public state: any = {
    volume: 50,
    mute: false,
    currentTrack: null,
    nextTrack: null,
    trackNo: 1,
    elapsedTime: 0,
    elapsedTimeFormatted: '00:00:00',
    playbackState: 'STOPPED',
    playMode: {
      repeat: 'none',
      repeatOne: false,
      shuffle: false,
      crossfade: false
    }
  };

  constructor(roomName: string, id: string = `RINCON_${Math.random().toString(36).substring(7)}`) {
    this.roomName = roomName;
    this.id = id;
  }

  private recordCall(method: string, args: any[] = []): void {
    this.calls.push({ method, args, timestamp: Date.now() });
  }

  async play(): Promise<void> {
    this.recordCall('play');
    this.state.playbackState = 'PLAYING';
  }

  async pause(): Promise<void> {
    this.recordCall('pause');
    this.state.playbackState = 'PAUSED_PLAYBACK';
  }

  async stop(): Promise<void> {
    this.recordCall('stop');
    this.state.playbackState = 'STOPPED';
  }

  async playPause(): Promise<void> {
    this.recordCall('playPause');
    if (this.state.playbackState === 'PLAYING') {
      this.state.playbackState = 'PAUSED_PLAYBACK';
    } else {
      this.state.playbackState = 'PLAYING';
    }
  }

  async next(): Promise<void> {
    this.recordCall('next');
  }

  async previous(): Promise<void> {
    this.recordCall('previous');
  }

  async setVolume(level: number): Promise<void> {
    this.recordCall('setVolume', [level]);
    // Clamp volume between 0 and 100
    if (level > 100) {
      this.state.volume = 100;
    } else if (level < 0) {
      this.state.volume = 0;
    } else {
      this.state.volume = level;
    }
  }

  async adjustVolume(delta: number): Promise<void> {
    this.recordCall('adjustVolume', [delta]);
    const newVolume = this.state.volume + delta;
    if (newVolume > 100) {
      this.state.volume = 100;
    } else if (newVolume < 0) {
      this.state.volume = 0;
    } else {
      this.state.volume = newVolume;
    }
  }

  async mute(): Promise<void> {
    this.recordCall('mute');
    this.state.mute = true;
  }

  async unmute(): Promise<void> {
    this.recordCall('unmute');
    this.state.mute = false;
  }

  async setMute(mute: boolean): Promise<void> {
    this.recordCall('setMute', [mute]);
    this.state.mute = mute;
  }

  async setRepeat(mode: string): Promise<void> {
    this.recordCall('setRepeat', [mode]);
    // Handle 'all', 'one', 'none' modes
    if (mode === 'all') {
      this.state.playMode.repeat = 'all';
      this.state.playMode.repeatOne = false;
    } else if (mode === 'one') {
      this.state.playMode.repeat = 'one';
      this.state.playMode.repeatOne = true;
    } else {
      this.state.playMode.repeat = 'none';
      this.state.playMode.repeatOne = false;
    }
  }

  async setShuffle(enabled: boolean): Promise<void> {
    this.recordCall('setShuffle', [enabled]);
    this.state.playMode.shuffle = enabled;
  }

  async setCrossfade(enabled: boolean): Promise<void> {
    this.recordCall('setCrossfade', [enabled]);
    this.state.playMode.crossfade = enabled;
  }

  async clearQueue(): Promise<void> {
    this.recordCall('clearQueue');
  }

  async getTransportSettings(): Promise<any> {
    this.recordCall('getTransportSettings');
    // Convert internal playMode to Sonos PlayMode format
    let playMode = 'NORMAL';
    if (this.state.playMode.shuffle && this.state.playMode.repeat === 'all') {
      playMode = 'SHUFFLE';
    } else if (this.state.playMode.shuffle && this.state.playMode.repeat === 'none') {
      playMode = 'SHUFFLE_NOREPEAT';
    } else if (this.state.playMode.repeat === 'all') {
      playMode = 'REPEAT_ALL';
    } else if (this.state.playMode.repeat === 'one' || this.state.playMode.repeatOne) {
      playMode = 'REPEAT_ONE';
    }
    return { PlayMode: playMode };
  }

  async getCrossfadeMode(): Promise<any> {
    this.recordCall('getCrossfadeMode');
    return { CrossfadeMode: this.state.playMode.crossfade ? 1 : 0 };
  }

  async getState(): Promise<any> {
    this.recordCall('getState');
    return { ...this.state };
  }

  getVolume(): number {
    return this.state.volume;
  }

  async setGroupVolume(level: number): Promise<void> {
    this.recordCall('setGroupVolume', [level]);
    // Clamp volume between 0 and 100
    if (level > 100) {
      this.state.volume = 100;
    } else if (level < 0) {
      this.state.volume = 0;
    } else {
      this.state.volume = level;
    }
  }

  async join(targetRoom: string): Promise<void> {
    this.recordCall('join', [targetRoom]);
  }

  async leave(): Promise<void> {
    this.recordCall('leave');
  }

  async addPlayerToGroup(targetCoordinatorId: string): Promise<void> {
    this.recordCall('addPlayerToGroup', [targetCoordinatorId]);
  }

  async becomeCoordinatorOfStandaloneGroup(): Promise<void> {
    this.recordCall('becomeCoordinatorOfStandaloneGroup');
  }

  async getFavorites(): Promise<any[]> {
    this.recordCall('getFavorites');
    return [
      { title: 'Test Favorite 1', uri: 'x-sonosapi-favorite:1' },
      { title: 'Test Favorite 2', uri: 'x-sonosapi-favorite:2' }
    ];
  }

  async getPlaylists(): Promise<any[]> {
    this.recordCall('getPlaylists');
    return [
      { title: 'Test Playlist 1', uri: 'x-file-cifs://playlist1' },
      { title: 'Test Playlist 2', uri: 'x-file-cifs://playlist2' }
    ];
  }

  async playFavorite(name: string): Promise<void> {
    this.recordCall('playFavorite', [name]);
    this.state.playbackState = 'PLAYING';
  }

  async playPlaylist(name: string): Promise<void> {
    this.recordCall('playPlaylist', [name]);
    this.state.playbackState = 'PLAYING';
  }

  async playUri(uri: string, metadata?: string): Promise<void> {
    this.recordCall('playUri', [uri, metadata]);
    this.state.playbackState = 'PLAYING';
  }

  async setLineIn(sourceDevice: SonosDevice): Promise<void> {
    this.recordCall('setLineIn', [sourceDevice.roomName]);
  }

  wasMethodCalled(method: string): boolean {
    return this.calls.some(call => call.method === method);
  }

  getCallsFor(method: string): MockCall[] {
    return this.calls.filter(call => call.method === method);
  }

  reset(): void {
    this.calls = [];
  }
}

export class MockDiscovery {
  private devices: Map<string, MockDevice> = new Map();
  private zones: Zone[] = [];

  addDevice(device: MockDevice): void {
    this.devices.set(device.roomName.toLowerCase(), device);
    this.updateZones();
  }

  private updateZones(): void {
    this.zones = Array.from(this.devices.values()).map(device => ({
      id: device.id,
      coordinator: {
        id: device.id,
        roomName: device.roomName,
        uuid: device.id
      },
      members: [{
        id: device.id,
        roomName: device.roomName,
        uuid: device.id
      }]
    }));
  }

  getDeviceByName(roomName: string): MockDevice | undefined {
    return this.devices.get(roomName.toLowerCase());
  }

  getDevice(roomName: string): MockDevice | undefined {
    return this.getDeviceByName(roomName);
  }

  getZones(): Zone[] {
    return this.zones;
  }

  setZones(zones: Zone[]): void {
    this.zones = zones;
  }

  getAllDevices(): MockDevice[] {
    return Array.from(this.devices.values());
  }

  getCoordinator(deviceId: string): MockDevice | undefined {
    // By default, each device is its own coordinator
    // This can be overridden in tests to simulate groups
    return this.devices.get(deviceId.toLowerCase());
  }

  isCoordinator(deviceId: string): boolean {
    // In our mock, all devices are coordinators of their own zones by default
    // This can be overridden in tests to simulate group members
    return true;
  }

  getZoneForDevice(deviceId: string): Zone | undefined {
    return this.zones.find(zone => 
      zone.members.some(member => member.id === deviceId || member.roomName === deviceId)
    );
  }

  reset(): void {
    this.devices.clear();
    this.zones = [];
  }
}

export function createMockDevice(roomName: string = 'TestRoom'): MockDevice {
  return new MockDevice(roomName);
}

export function createMockDiscovery(...roomNames: string[]): MockDiscovery {
  const discovery = new MockDiscovery();
  for (const roomName of roomNames) {
    discovery.addDevice(createMockDevice(roomName));
  }
  return discovery;
}

export function createMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 5005,
    logLevel: 'info',
    presetDir: './presets',
    presets: {},
    webhooks: [],
    defaultRoom: undefined,
    defaultMusicService: undefined,
    ...overrides
  };
}

export class MockDefaultRoomManager {
  public room?: string;
  public service?: string;
  private config: Config;
  
  constructor(config: Config) {
    this.config = config;
    this.room = config.defaultRoom;
    this.service = config.defaultMusicService;
  }

  getDefaultRoom(): string | undefined {
    return this.room;
  }

  getRoom(requestedRoom?: string): string | undefined {
    // If a room is specified, use it and update default
    if (requestedRoom && requestedRoom !== 'room') {
      if (requestedRoom !== this.room) {
        this.room = requestedRoom;
        this.config.defaultRoom = requestedRoom;
      }
      return requestedRoom;
    }
    // Otherwise use the saved default
    return this.room;
  }

  setDefaultRoom(room: string | undefined): void {
    this.room = room;
  }

  getDefaultService(): string | undefined {
    return this.service;
  }

  getMusicService(): string | undefined {
    return this.service;
  }

  setDefaultService(service: string | undefined): void {
    this.service = service;
  }

  getSettings(): { room?: string; service?: string } {
    return {
      room: this.room,
      service: this.service
    };
  }

  setDefaults(room?: string, service?: string): void {
    if (room !== undefined) {
      this.room = room;
      this.config.defaultRoom = room;
    }
    if (service !== undefined) {
      this.service = service;
      this.config.defaultMusicService = service;
    }
    this.saveDefaults();
  }

  saveDefaults(): void {
    // Mock implementation
  }
}

export class MockTTSService {
  async say(device: any, text: string, volume: number): Promise<void> {
    // Mock implementation
  }
}

export class MockPresetLoader {
  private presets: any = {};

  getPresets(): any {
    return this.presets;
  }

  setPresets(presets: any): void {
    this.presets = presets;
  }
}