import { readFileSync } from 'fs';
import logger, { loggerType } from './logger.js';
import { applicationVersion } from '../version.js';
import type { Config, WebhookConfig } from '../types/sonos.js';

/**
 * Usual debug categories for balanced debugging output
 */
const USUAL_DEBUG_CATEGORIES = ['api', 'discovery', 'favorites', 'presets'];

/**
 * Default configuration values
 */
const defaultConfig: Partial<Config> = {
  host: '0.0.0.0',
  port: 5005,
  announceVolume: 40,
  logLevel: 'info',
  presets: {},
  presetDir: './presets',
  webhooks: [],
  tts: {
    provider: 'google',
    lang: 'en-US'
  },
  library: {
    randomQueueLimit: 100
  }
};

/**
 * Parse comma-separated environment variable into array
 */
function parseArrayEnv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(',').map(v => v.trim()).filter(v => v.length > 0);
}

/**
 * Parse boolean environment variable
 */
function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Result of configuration loading
 */
export interface ConfigLoadResult {
  config: Config;
  sources: string[];
  envOverrides: string[];
}

/**
 * Format the configuration loading info as a message
 */
export function formatConfigInfo(result: ConfigLoadResult): string {
  return result.envOverrides.length > 0 
    ? `Configuration loaded from: ${result.sources.join(' → ')} (${result.envOverrides.join(', ')})`
    : `Configuration loaded from: ${result.sources.join(' → ')}`;
}

/**
 * Load configuration from multiple sources with precedence:
 * 1. Default values
 * 2. settings.json (if exists)
 * 3. Environment variables (highest priority)
 * 
 * @returns Configuration and metadata about how it was loaded
 */
export function loadConfiguration(): ConfigLoadResult {
  // Start with defaults (we'll add computed fields at the end)
  let config: Partial<Config> = { ...defaultConfig };

  // Load settings.json if exists
  try {
    const settingsFile = readFileSync('./settings.json', 'utf-8');
    const settings = JSON.parse(settingsFile);
    
    // Deep merge settings into config
    config = deepMerge(config as unknown as Record<string, unknown>, settings) as unknown as Config;
    
    // Normalize logger field if it exists in settings
    if (config.logger && typeof config.logger === 'string') {
      config.logger = config.logger.toLowerCase();
    }
    
    logger.info('Loaded settings from settings.json');
  } catch (_error) {
    // settings.json is optional
    logger.debug('No settings.json found, using defaults');
  }

  // Apply environment variable overrides
  
  // Environment settings (read first as they might affect other behavior)
  if (process.env.NODE_ENV) config.nodeEnv = process.env.NODE_ENV;
  if (process.env.LOGGER) config.logger = process.env.LOGGER.toLowerCase();
  
  // Server configuration
  if (process.env.HOST) config.host = process.env.HOST;
  if (process.env.PORT) config.port = parseInt(process.env.PORT, 10);
  if (process.env.ANNOUNCE_VOLUME) config.announceVolume = parseInt(process.env.ANNOUNCE_VOLUME, 10);
  if (process.env.TTS_HOST_IP) config.ttsHostIp = process.env.TTS_HOST_IP;
  
  // Logging configuration
  if (process.env.LOG_LEVEL || process.env.DEBUG_LEVEL) {
    config.logLevel = process.env.LOG_LEVEL || process.env.DEBUG_LEVEL || config.logLevel;
  }
  if (process.env.DEBUG_CATEGORIES) {
    if (process.env.DEBUG_CATEGORIES.toLowerCase() === 'usual') {
      config.debugCategories = USUAL_DEBUG_CATEGORIES;
    } else {
      config.debugCategories = parseArrayEnv(process.env.DEBUG_CATEGORIES);
    }
  }
  
  // Authentication
  if (process.env.AUTH_USERNAME || process.env.AUTH_PASSWORD) {
    if (!config.auth) {
      config.auth = {
        username: process.env.AUTH_USERNAME || '',
        password: process.env.AUTH_PASSWORD || ''
      };
    }
    if (process.env.AUTH_USERNAME) config.auth.username = process.env.AUTH_USERNAME;
    if (process.env.AUTH_PASSWORD) config.auth.password = process.env.AUTH_PASSWORD;
    if (process.env.AUTH_REJECT_UNAUTHORIZED !== undefined) {
      config.auth.rejectUnauthorized = parseBooleanEnv(process.env.AUTH_REJECT_UNAUTHORIZED);
    }
    if (process.env.AUTH_TRUSTED_NETWORKS) {
      config.auth.trustedNetworks = parseArrayEnv(process.env.AUTH_TRUSTED_NETWORKS);
    }
  }
  
  // TTS configuration
  if (process.env.TTS_PROVIDER || process.env.TTS_LANG || process.env.TTS_VOICE) {
    config.tts = config.tts || {};
    if (process.env.TTS_PROVIDER) config.tts.provider = process.env.TTS_PROVIDER;
    if (process.env.TTS_LANG) config.tts.lang = process.env.TTS_LANG;
    if (process.env.TTS_VOICE) config.tts.voice = process.env.TTS_VOICE;
    if (process.env.TTS_ENDPOINT) config.tts.endpoint = process.env.TTS_ENDPOINT;
    if (process.env.TTS_API_KEY) config.tts.apiKey = process.env.TTS_API_KEY;
  }
  
  // macOS Say specific
  if (process.env.TTS_MACOS_VOICE || process.env.TTS_MACOS_RATE) {
    config.macSay = config.macSay || {};
    if (process.env.TTS_MACOS_VOICE) config.macSay.voice = process.env.TTS_MACOS_VOICE;
    if (process.env.TTS_MACOS_RATE) config.macSay.rate = parseInt(process.env.TTS_MACOS_RATE, 10);
  }
  
  // Defaults
  if (process.env.DEFAULT_ROOM) config.defaultRoom = process.env.DEFAULT_ROOM;
  if (process.env.DEFAULT_SERVICE) config.defaultMusicService = process.env.DEFAULT_SERVICE;
  
  // Music library
  if (process.env.LIBRARY_REINDEX_INTERVAL || process.env.LIBRARY_RANDOM_QUEUE_LIMIT) {
    config.library = config.library || {};
    if (process.env.LIBRARY_REINDEX_INTERVAL) {
      config.library.reindexInterval = process.env.LIBRARY_REINDEX_INTERVAL;
    }
    if (process.env.LIBRARY_RANDOM_QUEUE_LIMIT) {
      config.library.randomQueueLimit = parseInt(process.env.LIBRARY_RANDOM_QUEUE_LIMIT, 10);
    }
  }
  
  // Service credentials
  if (process.env.PANDORA_USERNAME || process.env.PANDORA_PASSWORD) {
    if (!config.pandora) {
      config.pandora = {
        username: process.env.PANDORA_USERNAME || '',
        password: process.env.PANDORA_PASSWORD || ''
      };
    }
    if (process.env.PANDORA_USERNAME) config.pandora.username = process.env.PANDORA_USERNAME;
    if (process.env.PANDORA_PASSWORD) config.pandora.password = process.env.PANDORA_PASSWORD;
  }
  
  if (process.env.SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_SECRET || process.env.SPOTIFY_REFRESH_TOKEN || process.env.SPOTIFY_REDIRECT_URI || process.env.SPOTIFY_SCOPES) {
    if (!config.spotify) {
      config.spotify = {
        clientId: process.env.SPOTIFY_CLIENT_ID || '',
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET || ''
      };
    }
    if (process.env.SPOTIFY_CLIENT_ID) config.spotify.clientId = process.env.SPOTIFY_CLIENT_ID;
    if (process.env.SPOTIFY_CLIENT_SECRET) config.spotify.clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (process.env.SPOTIFY_REFRESH_TOKEN) config.spotify.refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
    if (process.env.SPOTIFY_REDIRECT_URI) config.spotify.redirectUri = process.env.SPOTIFY_REDIRECT_URI;
    if (process.env.SPOTIFY_SCOPES) config.spotify.scopes = process.env.SPOTIFY_SCOPES.split(',').map(s => s.trim());
  }
  
  // Webhooks
  const webhooks: WebhookConfig[] = [];
  if (process.env.WEBHOOKS_VOLUME_URL) {
    webhooks.push({ type: 'volume' as const, url: process.env.WEBHOOKS_VOLUME_URL });
  }
  if (process.env.WEBHOOKS_TRANSPORT_URL) {
    webhooks.push({ type: 'transport' as const, url: process.env.WEBHOOKS_TRANSPORT_URL });
  }
  if (process.env.WEBHOOKS_TOPOLOGY_URL) {
    webhooks.push({ type: 'topology' as const, url: process.env.WEBHOOKS_TOPOLOGY_URL });
  }
  if (webhooks.length > 0) {
    config.webhooks = webhooks;
  }
  
  // Advanced settings
  if (process.env.DISABLE_DISCOVERY !== undefined) {
    config.disableDiscovery = parseBooleanEnv(process.env.DISABLE_DISCOVERY);
  }
  if (process.env.DISCOVERY_TIMEOUT) {
    config.discoveryTimeout = parseInt(process.env.DISCOVERY_TIMEOUT, 10);
  }
  if (process.env.HTTP_TIMEOUT) {
    config.httpTimeout = parseInt(process.env.HTTP_TIMEOUT, 10);
  }
  if (process.env.CACHE_DIR) {
    config.cacheDir = process.env.CACHE_DIR;
  }
  if (process.env.CREATE_DEFAULT_PRESETS !== undefined) {
    config.createDefaultPresets = parseBooleanEnv(process.env.CREATE_DEFAULT_PRESETS);
  }
  
  // Log which config sources were used
  const configSources = ['defaults'];
  if (Object.keys(config).length > Object.keys(defaultConfig).length) {
    configSources.push('settings.json');
  }
  const envOverrides = getEnvironmentOverrides();
  if (envOverrides.length > 0) {
    configSources.push(`env vars (${envOverrides.join(', ')})`);
  }
  
  // Apply log level to logger before showing startup banner
  if (config.logLevel) {
    logger.level = config.logLevel;
  }
  
  // Add computed environment helpers and version
  const finalConfig = config as Config;
  Object.defineProperty(finalConfig, 'isDevelopment', {
    value: !config.nodeEnv || config.nodeEnv === '' || config.nodeEnv === 'development',
    writable: false,
    enumerable: true
  });
  Object.defineProperty(finalConfig, 'isProduction', {
    value: config.nodeEnv === 'production',
    writable: false,
    enumerable: true
  });
  Object.defineProperty(finalConfig, 'version', {
    value: applicationVersion.version,
    writable: false,
    enumerable: true
  });
  Object.defineProperty(finalConfig, 'buildDate', {
    value: process.env.BUILD_SOURCE_DATE || new Date().toISOString(),
    writable: false,
    enumerable: true
  });
  
  // Set the actual logger type being used (not what was configured)
  Object.defineProperty(finalConfig, 'loggerType', {
    value: loggerType,
    writable: false,
    enumerable: true
  });
  
  return {
    config: finalConfig,
    sources: configSources,
    envOverrides: envOverrides
  };
}

/**
 * Get list of environment variables that are overriding config
 */
function getEnvironmentOverrides(): string[] {
  const overrides: string[] = [];
  const envVars = [
    'NODE_ENV', 'LOGGER', 'TTS_HOST_IP', 'BUILD_SOURCE_DATE',
    'HOST', 'PORT', 'ANNOUNCE_VOLUME',
    'LOG_LEVEL', 'DEBUG_LEVEL', 'DEBUG_CATEGORIES',
    'AUTH_USERNAME', 'AUTH_PASSWORD', 'AUTH_REJECT_UNAUTHORIZED', 'AUTH_TRUSTED_NETWORKS',
    'TTS_PROVIDER', 'TTS_LANG', 'TTS_VOICE', 'TTS_ENDPOINT', 'TTS_API_KEY',
    'TTS_MACOS_VOICE', 'TTS_MACOS_RATE',
    'DEFAULT_ROOM', 'DEFAULT_SERVICE',
    'LIBRARY_REINDEX_INTERVAL', 'LIBRARY_RANDOM_QUEUE_LIMIT',
    'PANDORA_USERNAME', 'PANDORA_PASSWORD',
    'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REFRESH_TOKEN', 'SPOTIFY_REDIRECT_URI', 'SPOTIFY_SCOPES',
    'WEBHOOKS_VOLUME_URL', 'WEBHOOKS_TRANSPORT_URL', 'WEBHOOKS_TOPOLOGY_URL',
    'DISABLE_DISCOVERY', 'DISCOVERY_TIMEOUT', 'HTTP_TIMEOUT', 'CACHE_DIR',
    'CREATE_DEFAULT_PRESETS'
  ];
  
  for (const envVar of envVars) {
    if (process.env[envVar] !== undefined) {
      overrides.push(envVar);
    }
  }
  
  return overrides;
}

/**
 * Deep merge two objects
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const output = { ...target };
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  
  return output;
}

/**
 * Check if value is an object
 */
function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}