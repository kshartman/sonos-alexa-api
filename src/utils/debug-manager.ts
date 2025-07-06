import logger from './logger.js';
import type { Config } from '../types/sonos.js';

export interface DebugCategories {
  soap: boolean;
  topology: boolean;
  discovery: boolean;
  favorites: boolean;
  presets: boolean;
  upnp: boolean;
  api: boolean;
  sse: boolean;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'wall'; // wall is alias for trace

class DebugManager {
  private categories: DebugCategories;
  private wallDeprecationWarned = false;

  constructor(config?: Config) {
    // Initialize with defaults
    this.categories = {
      soap: false,      // SOAP request/response details
      topology: false,  // UPnP topology events and processing
      discovery: false, // Device discovery details
      favorites: false, // Favorite resolution details
      presets: false,   // Preset loading and resolution
      upnp: false,      // Raw UPnP event details
      api: true,        // API request logging (always on by default)
      sse: false        // Server-Sent Events for webhooks
    };

    // Initialize from config
    if (config) {
      this.initFromConfig(config);
    }
  }

  private initFromConfig(config: Config): void {
    // Set log level from config
    if (config.logLevel && this.isValidLogLevel(config.logLevel)) {
      // Normalize 'wall' to 'trace'
      const normalized = config.logLevel.toLowerCase() === 'wall' ? 'trace' : config.logLevel as LogLevel;
      logger.level = normalized;
      logger.info(`Log level set to '${logger.level}' from configuration`);
    }

    // Set debug categories from config
    if (config.debugCategories && config.debugCategories.length > 0) {
      const categoriesToEnable = config.debugCategories.map(c => c.toLowerCase());
      
      // Special case: '*' or 'all' enables all categories
      if (categoriesToEnable.includes('*') || categoriesToEnable.includes('all')) {
        this.enableAll();
        logger.info('All debug categories enabled from configuration');
      } else {
        categoriesToEnable.forEach(category => {
          if (this.isValidCategory(category)) {
            this.categories[category as keyof DebugCategories] = true;
          }
        });
        logger.info(`Debug categories enabled from configuration: ${categoriesToEnable.filter(c => this.isValidCategory(c)).join(', ')}`);
      }
    }

    // Log the debug configuration
    logger.info('Debug configuration:', {
      logLevel: logger.level,
      categories: Object.entries(this.categories)
        .filter(([_, enabled]) => enabled)
        .map(([category]) => category)
        .join(', ') || 'none'
    });
  }


  private isValidLogLevel(level: string): boolean {
    // Only check normalized levels (no 'wall')
    return ['error', 'warn', 'info', 'debug', 'trace'].includes(level.toLowerCase());
  }

  private isValidCategory(category: string): boolean {
    return Object.keys(this.categories).includes(category);
  }

  isEnabled(category: keyof DebugCategories): boolean {
    return this.categories[category];
  }

  setCategory(category: keyof DebugCategories, enabled: boolean): void {
    this.categories[category] = enabled;
    logger.info(`Debug category '${category}' ${enabled ? 'enabled' : 'disabled'}`);
  }

  setLogLevel(level: LogLevel): void {
    // Normalize 'wall' to 'trace'
    const normalized = level === 'wall' ? 'trace' : level;
    
    // Validate the normalized level
    if (!this.isValidLogLevel(normalized)) {
      throw new Error(`Invalid log level: ${level}`);
    }
    
    // Simply delegate to logger
    logger.level = normalized;
    
    // Also update the process environment variable for consistency
    process.env['LOG_LEVEL'] = normalized;
    
    logger.info(`Log level set to: ${normalized}`);
  }

  getLogLevel(): LogLevel {
    return logger.level as LogLevel;
  }
  
  isLevelEnabled(level: LogLevel): boolean {
    return this.shouldLog(level);
  }

  getCategories(): DebugCategories {
    return { ...this.categories };
  }

  enableAll(): void {
    Object.keys(this.categories).forEach(category => {
      this.categories[category as keyof DebugCategories] = true;
    });
    logger.info('All debug categories enabled');
  }

  disableAll(): void {
    Object.keys(this.categories).forEach(category => {
      this.categories[category as keyof DebugCategories] = false;
    });
    // Keep API logging on
    this.categories.api = true;
    logger.info('All debug categories disabled (except API)');
  }

  // Conditional logging methods
  debug(category: keyof DebugCategories, message: string, meta?: unknown): void {
    if (this.categories[category] && this.shouldLog('debug')) {
      const logMeta = typeof meta === 'object' && meta !== null ? { ...meta, category } : { data: meta, category };
      logger.debug(`[${category.toUpperCase()}] ${message}`, logMeta);
    }
  }

  info(category: keyof DebugCategories, message: string, meta?: unknown): void {
    if (this.categories[category] && this.shouldLog('info')) {
      const logMeta = typeof meta === 'object' && meta !== null ? { ...meta, category } : { data: meta, category };
      logger.info(`[${category.toUpperCase()}] ${message}`, logMeta);
    }
  }

  warn(category: keyof DebugCategories, message: string, meta?: unknown): void {
    if (this.categories[category] && this.shouldLog('warn')) {
      const logMeta = typeof meta === 'object' && meta !== null ? { ...meta, category } : { data: meta, category };
      logger.warn(`[${category.toUpperCase()}] ${message}`, logMeta);
    }
  }

  error(category: keyof DebugCategories, message: string, meta?: unknown): void {
    if (this.categories[category] && this.shouldLog('error')) {
      const logMeta = typeof meta === 'object' && meta !== null ? { ...meta, category } : { data: meta, category };
      logger.error(`[${category.toUpperCase()}] ${message}`, logMeta);
    }
  }

  trace(category: keyof DebugCategories, message: string, meta?: unknown): void {
    if (this.categories[category] && this.shouldLog('trace')) {
      const logMeta = typeof meta === 'object' && meta !== null ? { ...meta, category } : { data: meta, category };
      logger.trace(`[${category.toUpperCase()}] ${message}`, logMeta);
    }
  }

  // Deprecated - use trace() instead
  wall(category: keyof DebugCategories, message: string, meta?: unknown): void {
    if (!this.wallDeprecationWarned) {
      logger.warn('debugManager.wall() is deprecated. Please use debugManager.trace() instead.');
      this.wallDeprecationWarned = true;
    }
    this.trace(category, message, meta);
  }
  
  // Always logs regardless of debug level or category
  always(message: string, meta?: unknown): void {
    logger.always(message, meta);
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];
    // Normalize 'wall' to 'trace' for comparison
    const normalizedLevel = level === 'wall' ? 'trace' : level;
    // logger.level is always normalized (never 'wall')
    const currentLevelIndex = levels.indexOf(logger.level as LogLevel);
    const messageLevelIndex = levels.indexOf(normalizedLevel);
    return messageLevelIndex <= currentLevelIndex;
  }
}

// Export a singleton instance that will be initialized later
let debugManagerInstance: DebugManager | null = null;

export function initializeDebugManager(config: Config): DebugManager {
  if (!debugManagerInstance) {
    debugManagerInstance = new DebugManager(config);
  }
  return debugManagerInstance;
}

// For backward compatibility, create a proxy that will use the initialized instance
export const debugManager = new Proxy({} as DebugManager, {
  get(_target, prop, receiver) {
    if (!debugManagerInstance) {
      throw new Error('DebugManager accessed before initialization. Call initializeDebugManager(config) first.');
    }
    return Reflect.get(debugManagerInstance, prop, receiver);
  },
  set(_target, prop, value, receiver) {
    if (!debugManagerInstance) {
      throw new Error('DebugManager accessed before initialization. Call initializeDebugManager(config) first.');
    }
    return Reflect.set(debugManagerInstance, prop, value, receiver);
  }
});