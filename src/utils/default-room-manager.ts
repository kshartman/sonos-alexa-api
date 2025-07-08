import fs from 'fs/promises';
import path from 'path';
import logger from './logger.js';
import { scheduler } from './scheduler.js';

export interface DefaultSettings {
  room?: string;
  musicService?: string;
  lastUpdated?: Date;
}

export class DefaultRoomManager {
  private settings: DefaultSettings = {};
  private configPath: string;
  private defaultRoom: string;
  private defaultMusicService: string;
  private readonly SAVE_TASK_ID = 'default-room-manager-save';

  constructor(configDir: string, defaultRoom: string = '', defaultMusicService: string = 'library') {
    this.configPath = path.join(configDir, 'default-settings.json');
    this.defaultRoom = defaultRoom;
    this.defaultMusicService = defaultMusicService;
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      this.settings = JSON.parse(data);
      logger.info('Loaded default settings:', this.settings);
    } catch (_error) {
      // File doesn't exist or is invalid, use defaults
      this.settings = {
        room: this.defaultRoom,
        musicService: this.defaultMusicService,
        lastUpdated: new Date()
      };
      logger.info('Using default settings:', this.settings);
    }
  }

  async save(): Promise<void> {
    // Cancel any pending save
    scheduler.clearTask(this.SAVE_TASK_ID);

    // Debounce saves to avoid excessive writes
    scheduler.scheduleTimeout(
      this.SAVE_TASK_ID,
      async () => {
        try {
          this.settings.lastUpdated = new Date();
          await fs.mkdir(path.dirname(this.configPath), { recursive: true });
          await fs.writeFile(this.configPath, JSON.stringify(this.settings, null, 2));
          logger.debug('Saved default settings:', this.settings);
        } catch (error) {
          logger.error('Error saving default settings:', error);
        }
      },
      500,
      { unref: true }
    );
  }

  getRoom(requestedRoom?: string): string {
    // If a room is specified and it's not "room" placeholder, use it
    if (requestedRoom && requestedRoom !== 'room') {
      // Update the default for next time
      if (requestedRoom !== this.settings.room) {
        this.settings.room = requestedRoom;
        this.save().catch(err => logger.error('Error saving room default:', err));
      }
      return requestedRoom;
    }

    // Otherwise use the saved default or config default
    return this.settings.room || this.defaultRoom || '';
  }

  getMusicService(requestedService?: string): string {
    // If a service is specified and it's not "service" placeholder, use it
    if (requestedService && requestedService !== 'service') {
      // Update the default for next time
      if (requestedService !== this.settings.musicService) {
        this.settings.musicService = requestedService;
        this.save().catch(err => logger.error('Error saving service default:', err));
      }
      return requestedService;
    }

    // Otherwise use the saved default or config default
    return this.settings.musicService || this.defaultMusicService || 'library';
  }

  setDefaults(room?: string, musicService?: string): void {
    let changed = false;

    if (room && room !== this.settings.room) {
      this.settings.room = room;
      changed = true;
    }

    if (musicService && musicService !== this.settings.musicService) {
      this.settings.musicService = musicService;
      changed = true;
    }

    if (changed) {
      this.save().catch(err => logger.error('Error saving defaults:', err));
    }
  }

  getSettings(): DefaultSettings {
    return { ...this.settings };
  }
}