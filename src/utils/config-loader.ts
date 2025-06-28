import { readFileSync } from 'fs';
import logger from './logger.js';
import type { Config, WebhookConfig } from '../types/sonos.js';

/**
 * Default configuration values
 */
const defaultConfig: Config = {
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
 * Load configuration from multiple sources with precedence:
 * 1. Default values
 * 2. settings.json (if exists)
 * 3. Environment variables (highest priority)
 */
export function loadConfiguration(): Config {
  // Start with defaults
  let config: Config = { ...defaultConfig };

  // Load settings.json if exists
  try {
    const settingsFile = readFileSync('./settings.json', 'utf-8');
    const settings = JSON.parse(settingsFile);
    
    // Deep merge settings into config
    config = deepMerge(config as unknown as Record<string, unknown>, settings) as unknown as Config;
    
    logger.info('Loaded settings from settings.json');
  } catch (_error) {
    // settings.json is optional
    logger.debug('No settings.json found, using defaults');
  }

  // Apply environment variable overrides
  
  // Server configuration
  if (process.env.HOST) config.host = process.env.HOST;
  if (process.env.PORT) config.port = parseInt(process.env.PORT, 10);
  if (process.env.ANNOUNCE_VOLUME) config.announceVolume = parseInt(process.env.ANNOUNCE_VOLUME, 10);
  
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
  if (process.env.LIBRARY_REINDEX_INTERVAL) {
    config.library = config.library || {};
    config.library.reindexInterval = process.env.LIBRARY_REINDEX_INTERVAL;
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
  
  if (process.env.SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_SECRET || process.env.SPOTIFY_REFRESH_TOKEN) {
    if (!config.spotify) {
      config.spotify = {
        clientId: process.env.SPOTIFY_CLIENT_ID || '',
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET || ''
      };
    }
    if (process.env.SPOTIFY_CLIENT_ID) config.spotify.clientId = process.env.SPOTIFY_CLIENT_ID;
    if (process.env.SPOTIFY_CLIENT_SECRET) config.spotify.clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (process.env.SPOTIFY_REFRESH_TOKEN) config.spotify.refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
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
  
  logger.info(`Configuration loaded from: ${configSources.join(' → ')}`);
  
  return config;
}

/**
 * Get list of environment variables that are overriding config
 */
function getEnvironmentOverrides(): string[] {
  const overrides: string[] = [];
  const envVars = [
    'HOST', 'PORT', 'ANNOUNCE_VOLUME',
    'AUTH_USERNAME', 'AUTH_PASSWORD', 'AUTH_REJECT_UNAUTHORIZED', 'AUTH_TRUSTED_NETWORKS',
    'TTS_PROVIDER', 'TTS_LANG', 'TTS_VOICE', 'TTS_ENDPOINT', 'TTS_API_KEY',
    'TTS_MACOS_VOICE', 'TTS_MACOS_RATE',
    'DEFAULT_ROOM', 'DEFAULT_SERVICE',
    'LIBRARY_REINDEX_INTERVAL',
    'PANDORA_USERNAME', 'PANDORA_PASSWORD',
    'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REFRESH_TOKEN',
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