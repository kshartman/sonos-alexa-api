import logger from './logger.js';

export interface DebugCategories {
  soap: boolean;
  topology: boolean;
  discovery: boolean;
  favorites: boolean;
  presets: boolean;
  upnp: boolean;
  api: boolean;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

class DebugManager {
  private categories: DebugCategories;
  private logLevel: LogLevel;

  constructor() {
    // Initialize with defaults
    this.categories = {
      soap: false,      // SOAP request/response details
      topology: false,  // UPnP topology events and processing
      discovery: false, // Device discovery details
      favorites: false, // Favorite resolution details
      presets: false,   // Preset loading and resolution
      upnp: false,      // Raw UPnP event details
      api: true         // API request logging (always on by default)
    };
    this.logLevel = 'info';

    // Initialize from environment variables
    this.initFromEnv();
  }

  private initFromEnv(): void {
    // Set log level from DEBUG_LEVEL or LOG_LEVEL env var
    const envLogLevel = process.env.DEBUG_LEVEL || process.env.LOG_LEVEL;
    if (envLogLevel && this.isValidLogLevel(envLogLevel)) {
      this.logLevel = envLogLevel as LogLevel;
      logger.info(`Log level set to '${this.logLevel}' from environment`);
    }

    // Set debug categories from DEBUG_CATEGORIES env var (comma-separated)
    const envCategories = process.env.DEBUG_CATEGORIES;
    if (envCategories) {
      const categoriesToEnable = envCategories.split(',').map(c => c.trim().toLowerCase());
      
      // Special case: '*' or 'all' enables all categories
      if (categoriesToEnable.includes('*') || categoriesToEnable.includes('all')) {
        this.enableAll();
        logger.info('All debug categories enabled from environment');
      } else {
        categoriesToEnable.forEach(category => {
          if (this.isValidCategory(category)) {
            this.categories[category as keyof DebugCategories] = true;
          }
        });
        logger.info(`Debug categories enabled from environment: ${categoriesToEnable.filter(c => this.isValidCategory(c)).join(', ')}`);
      }
    }
  }

  private isValidLogLevel(level: string): boolean {
    return ['error', 'warn', 'info', 'debug'].includes(level.toLowerCase());
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
    this.logLevel = level;
    logger.info(`Log level set to: ${level}`);
  }

  getLogLevel(): LogLevel {
    return this.logLevel;
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
  debug(category: keyof DebugCategories, message: string, meta?: any): void {
    if (this.categories[category] && this.shouldLog('debug')) {
      logger.debug(`[${category.toUpperCase()}] ${message}`, meta);
    }
  }

  info(category: keyof DebugCategories, message: string, meta?: any): void {
    if (this.categories[category] && this.shouldLog('info')) {
      logger.info(`[${category.toUpperCase()}] ${message}`, meta);
    }
  }

  warn(category: keyof DebugCategories, message: string, meta?: any): void {
    if (this.categories[category] && this.shouldLog('warn')) {
      logger.warn(`[${category.toUpperCase()}] ${message}`, meta);
    }
  }

  error(category: keyof DebugCategories, message: string, meta?: any): void {
    if (this.categories[category] && this.shouldLog('error')) {
      logger.error(`[${category.toUpperCase()}] ${message}`, meta);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex <= currentLevelIndex;
  }
}

export const debugManager = new DebugManager();

// Log startup configuration
logger.info('Debug configuration:', {
  logLevel: debugManager.getLogLevel(),
  categories: Object.entries(debugManager.getCategories())
    .filter(([_, enabled]) => enabled)
    .map(([category]) => category)
    .join(', ') || 'none'
});