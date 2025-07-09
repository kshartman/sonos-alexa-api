import crypto from 'crypto';
import { promises as fs, readFileSync } from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import type { PandoraStation } from '../types/sonos.js';

interface PartnerInfo {
  username: string;
  password: string;
  deviceModel: string;
  decryptPassword: string;
  encryptPassword: string;
  version: string;
}

interface AuthData {
  userAuthToken: string;
  partnerId: string;
  userId: string;
  syncTimeOffset: number;
}

interface PandoraResponse {
  stat: 'ok' | 'fail';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any; // ANY IS CORRECT: Pandora API returns different result types based on method
  message?: string;
  code?: number;
}

interface PartnerLoginResult {
  partnerAuthToken: string;
  partnerId: string;
  syncTime: string;
  syncTimeOffset?: number;
}

interface UserLoginResult {
  userAuthToken: string;
  userId: string;
}

export interface PandoraSearchResult {
  artists?: Array<{
    artistName: string;
    musicToken: string;
    score: number;
  }>;
  songs?: Array<{
    songName: string;
    artistName: string;
    musicToken: string;
    score: number;
  }>;
}

export interface PandoraGenreCategory {
  categoryName: string;
  stations: Array<{
    stationToken: string;
    stationName: string;
  }>;
}

const PADDING_LENGTH = 16;
const PADDING = '\0'.repeat(PADDING_LENGTH);

export class PandoraAPI {
  private username: string;
  private password: string;
  private partnerInfo: PartnerInfo;
  private authData: AuthData | null = null;
  private static readonly ENDPOINT = '://tuner.pandora.com/services/json/';
  
  // Cache for station list
  private stationListCache: { stations: PandoraStation[], timestamp: number } | null = null;
  private static readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly STATION_CACHE_FILE = path.join('data', 'pandora-stations-cache.json');
  private static stationCacheLoaded = false;
  
  // Bot detection backoff
  private static lastLoginFailure: number = 0;
  private static backoffHours: number = 0;
  private static readonly INITIAL_BACKOFF = 24; // 24 hours
  private static readonly MAX_BACKOFF = 48; // 48 hours
  private static readonly BACKOFF_FILE = path.join('data', 'pandora-backoff.json');
  private static backoffLoaded = false;

  constructor(username: string, password: string, partnerInfo?: Partial<PartnerInfo>) {
    this.username = username;
    this.password = password;
    
    // Load backoff state on first instance creation
    if (!PandoraAPI.backoffLoaded) {
      PandoraAPI.loadBackoffState().catch(error => {
        logger.debug('Could not load backoff state:', error);
      });
    }
    
    // Load station cache on first instance creation
    if (!PandoraAPI.stationCacheLoaded) {
      PandoraAPI.stationCacheLoaded = true;
      this.loadStationCache().catch(error => {
        logger.debug('Could not load station cache:', error);
      });
    }
    
    // Default partner info for Android client
    this.partnerInfo = {
      username: 'android',
      password: 'AC7IBG09A3DTSYM4R41UJWL07VLN8JI7',
      deviceModel: 'android-generic',
      decryptPassword: 'R=U!LH$O2B#',
      encryptPassword: '6#26FRL$ZWD',
      version: '5',
      ...partnerInfo
    };
  }

  private static async loadBackoffState(): Promise<void> {
    if (PandoraAPI.backoffLoaded) {
      return; // Already loaded
    }
    
    try {
      const data = await fs.readFile(PandoraAPI.BACKOFF_FILE, 'utf8');
      const state = JSON.parse(data);
      
      if (state.lastLoginFailure && state.backoffHours) {
        PandoraAPI.lastLoginFailure = state.lastLoginFailure;
        PandoraAPI.backoffHours = state.backoffHours;
        
        // Check if backoff has expired
        const hoursSinceFailure = (Date.now() - PandoraAPI.lastLoginFailure) / (1000 * 60 * 60);
        if (hoursSinceFailure >= PandoraAPI.backoffHours) {
          // Backoff expired, reset
          PandoraAPI.lastLoginFailure = 0;
          PandoraAPI.backoffHours = 0;
          await PandoraAPI.saveBackoffState();
          logger.info('Pandora backoff period has expired and been reset');
        } else {
          const remainingHours = Math.ceil(PandoraAPI.backoffHours - hoursSinceFailure);
          logger.warn(`Pandora backoff loaded: ${remainingHours} hours remaining`);
        }
      }
      
      PandoraAPI.backoffLoaded = true;
    } catch (_error) {
      // File doesn't exist or is invalid, that's okay
      PandoraAPI.backoffLoaded = true;
    }
  }
  
  private static async saveBackoffState(): Promise<void> {
    try {
      // Ensure data directory exists
      await fs.mkdir('data', { recursive: true });
      
      const state = {
        lastLoginFailure: PandoraAPI.lastLoginFailure,
        backoffHours: PandoraAPI.backoffHours,
        lastUpdate: new Date().toISOString()
      };
      
      await fs.writeFile(PandoraAPI.BACKOFF_FILE, JSON.stringify(state, null, 2));
      logger.debug('Pandora backoff state saved');
    } catch (error) {
      logger.error('Failed to save backoff state:', error);
    }
  }

  private encrypt(password: string, data: string): string {
    const key = Buffer.from(password);
    
    try {
      // Try using the legacy cipher first
      const cipher = crypto.createCipheriv('bf-ecb', key, Buffer.alloc(0));
      cipher.setAutoPadding(false);
      
      const padLength = PADDING_LENGTH - (data.length % PADDING_LENGTH);
      const paddedData = data + PADDING.substring(0, padLength === PADDING_LENGTH ? 0 : padLength);
      
      const encrypted = Buffer.concat([
        cipher.update(paddedData, 'utf8'),
        cipher.final()
      ]);
      return encrypted.toString('hex').toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      // If bf-ecb is not supported, we need to use a different approach
      // For now, let's log the error and provide a better message
      logger.error('Encryption error:', error);
      
      if (error.code === 'ERR_OSSL_EVP_UNSUPPORTED') {
        throw new Error('Blowfish cipher not supported. Node.js may need to be run with --openssl-legacy-provider flag.');
      }
      
      throw new Error('Failed to encrypt data');
    }
  }

  private decrypt(password: string, ciphered: string): Buffer {
    const key = Buffer.from(password);
    
    try {
      const cipher = crypto.createDecipheriv('bf-ecb', key, Buffer.alloc(0));
      cipher.setAutoPadding(false);
      
      const decrypted = Buffer.concat([
        cipher.update(Buffer.from(ciphered, 'hex')),
        cipher.final()
      ]);
      return decrypted;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      logger.error('Decryption error:', error);
      
      if (error.code === 'ERR_OSSL_EVP_UNSUPPORTED') {
        throw new Error('Blowfish cipher not supported. Node.js may need to be run with --openssl-legacy-provider flag.');
      }
      
      throw new Error('Failed to decrypt data');
    }
  }

  private getEndpoint(secure: boolean): string {
    return (secure ? 'https' : 'http') + PandoraAPI.ENDPOINT;
  }

  private getTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  private decryptSyncTime(password: string, ciphered: string): number {
    const decrypted = this.decrypt(password, ciphered);
    return parseInt(decrypted.toString('utf8', 4, 14), 10);
  }

  private async makeRequest(options: {
    method: string;
    secure?: boolean;
    queryParams?: Record<string, string>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body?: any;
    encrypt?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }): Promise<any> {
    const url = new URL(this.getEndpoint(options.secure || false));
    url.searchParams.append('method', options.method);
    
    if (options.queryParams) {
      Object.entries(options.queryParams).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    let body: string | undefined;
    if (options.body) {
      if (options.encrypt !== false && this.partnerInfo.encryptPassword) {
        body = this.encrypt(this.partnerInfo.encryptPassword, JSON.stringify(options.body));
      } else {
        body = JSON.stringify(options.body);
      }
    }

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: body || undefined
      });

      const data: PandoraResponse = await response.json();
      
      if (data.stat === 'fail') {
        logger.debug('Pandora API error response:', data);
        throw new Error(`${data.message} [${data.code}]`);
      } else if (data.stat === 'ok') {
        return data.result;
      } else {
        logger.debug('Unexpected Pandora response:', data);
        throw new Error('Unknown error');
      }
    } catch (error) {
      logger.error('Pandora API request failed:', error);
      throw error;
    }
  }

  private async partnerLogin(): Promise<PartnerLoginResult> {
    const result = await this.makeRequest({
      method: 'auth.partnerLogin',
      secure: true,
      body: {
        username: this.partnerInfo.username,
        password: this.partnerInfo.password,
        deviceModel: this.partnerInfo.deviceModel,
        version: this.partnerInfo.version
      },
      encrypt: false
    });

    // Calculate sync time offset
    result.syncTimeOffset = this.decryptSyncTime(
      this.partnerInfo.decryptPassword, 
      result.syncTime
    ) - this.getTimestamp();

    return result;
  }

  private async userLogin(partnerData: PartnerLoginResult): Promise<UserLoginResult> {
    return await this.makeRequest({
      method: 'auth.userLogin',
      secure: true,
      queryParams: {
        auth_token: partnerData.partnerAuthToken,
        partner_id: partnerData.partnerId
      },
      body: {
        loginType: 'user',
        username: this.username,
        password: this.password,
        partnerAuthToken: partnerData.partnerAuthToken,
        syncTime: partnerData.syncTimeOffset! + this.getTimestamp()
      },
      encrypt: true
    });
  }

  async login(): Promise<void> {
    // Ensure backoff state is loaded
    if (!PandoraAPI.backoffLoaded) {
      await PandoraAPI.loadBackoffState();
    }
    
    // Check if we're in backoff period
    if (PandoraAPI.lastLoginFailure > 0) {
      const hoursSinceFailure = (Date.now() - PandoraAPI.lastLoginFailure) / (1000 * 60 * 60);
      if (hoursSinceFailure < PandoraAPI.backoffHours) {
        const remainingHours = Math.ceil(PandoraAPI.backoffHours - hoursSinceFailure);
        logger.warn(`Pandora login blocked due to bot detection. Waiting ${remainingHours} more hours before retry.`);
        throw new Error(`Pandora API is in backoff period. ${remainingHours} hours remaining.`);
      }
    }
    
    try {
      logger.debug('Starting Pandora login process');
      const partnerData = await this.partnerLogin();
      logger.debug('Partner login successful');
      
      const userData = await this.userLogin(partnerData);
      logger.debug('User login successful');
      
      this.authData = {
        userAuthToken: userData.userAuthToken,
        partnerId: partnerData.partnerId,
        userId: userData.userId,
        syncTimeOffset: partnerData.syncTimeOffset!
      };
      
      logger.info('Successfully authenticated with Pandora');
      
      // Reset backoff on successful login
      if (PandoraAPI.lastLoginFailure > 0 || PandoraAPI.backoffHours > 0) {
        PandoraAPI.lastLoginFailure = 0;
        PandoraAPI.backoffHours = 0;
        await PandoraAPI.saveBackoffState();
      }
    } catch (error) {
      logger.error('Pandora login failed:', error);
      
      // Check if this might be bot detection
      const errorMessage = error instanceof Error ? error.message : '';
      if (errorMessage.includes('Invalid username and/or password') || 
          errorMessage.includes('1001') || 
          errorMessage.includes('1002')) {
        // Set or increase backoff
        PandoraAPI.lastLoginFailure = Date.now();
        if (PandoraAPI.backoffHours === 0) {
          PandoraAPI.backoffHours = PandoraAPI.INITIAL_BACKOFF; // 24 hours
        } else if (PandoraAPI.backoffHours < PandoraAPI.MAX_BACKOFF) {
          PandoraAPI.backoffHours = Math.min(PandoraAPI.backoffHours * 1.5, PandoraAPI.MAX_BACKOFF); // Increase by 50%
        }
        logger.warn(`Possible Pandora bot detection. Setting backoff to ${PandoraAPI.backoffHours} hours.`);
        await PandoraAPI.saveBackoffState();
      }
      
      throw new Error(`Failed to authenticate with Pandora: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async request(method: string, data?: any): Promise<any> {
    if (!this.authData) {
      throw new Error('Not authenticated with Pandora (call login() before request())');
    }

    const secure = method === 'station.getPlaylist';
    const body = {
      ...data,
      userAuthToken: this.authData.userAuthToken,
      syncTime: this.authData.syncTimeOffset + this.getTimestamp()
    };

    return await this.makeRequest({
      method,
      secure,
      queryParams: {
        auth_token: this.authData.userAuthToken,
        partner_id: this.authData.partnerId,
        user_id: this.authData.userId
      },
      body,
      encrypt: method !== 'test.checkLicensing'
    });
  }

  // Convenience methods for common operations
  async getStationList(includeStationArtUrl = true, forceRefresh = false): Promise<{ stations: PandoraStation[] }> {
    // Load cache from disk if not in memory
    if (!this.stationListCache) {
      await this.loadStationCache();
    }
    
    // Check cache validity
    if (!forceRefresh && this.stationListCache && 
        (Date.now() - this.stationListCache.timestamp) < PandoraAPI.CACHE_TTL) {
      const ageMinutes = Math.round((Date.now() - this.stationListCache.timestamp) / 60000);
      logger.debug(`Returning cached Pandora station list (${this.stationListCache.stations.length} stations, age: ${ageMinutes} minutes)`);
      return { stations: this.stationListCache.stations };
    }
    
    logger.debug('Fetching fresh Pandora station list from API');
    const response = await this.request('user.getStationList', { includeStationArtUrl });
    
    // Enhance station data with additional metadata
    if (response.stations) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response.stations = response.stations.map((station: any) => {
        const enhanced: PandoraStation = {
          stationId: station.stationId,
          stationName: station.stationName,
          isQuickMix: station.stationName === 'QuickMix' || station.isQuickMix === true,
          isThumbprint: station.stationName === 'Thumbprint Radio' || station.isThumbprint === true,
          // Stations without a specific type are typically user-created
          isUserCreated: !station.isQuickMix && !station.isThumbprint && 
                        station.stationName !== 'QuickMix' && 
                        station.stationName !== 'Thumbprint Radio',
          // Store API-specific properties
          apiProperties: {
            stationToken: station.stationToken,
            artUrl: station.artUrl,
            type: station.type
          }
        };
        return enhanced;
      });
      
      // Update cache
      this.stationListCache = {
        stations: response.stations,
        timestamp: Date.now()
      };
      logger.info(`Cached ${response.stations.length} Pandora stations (TTL: 24 hours)`);
      
      // Save cache to disk
      await this.saveStationCache();
    }
    
    return response;
  }

  async searchMusic(searchText: string): Promise<PandoraSearchResult> {
    return await this.request('music.search', { searchText });
  }
  
  // Cache persistence methods
  private async loadStationCache(): Promise<void> {
    try {
      const cacheData = await fs.readFile(PandoraAPI.STATION_CACHE_FILE, 'utf-8');
      const cache = JSON.parse(cacheData);
      
      // Validate cache structure
      if (cache.stations && Array.isArray(cache.stations) && cache.timestamp) {
        this.stationListCache = cache;
        const ageMinutes = Math.round((Date.now() - cache.timestamp) / 60000);
        logger.info(`Loaded Pandora station cache: ${cache.stations.length} stations (age: ${ageMinutes} minutes)`);
      }
    } catch (_error) {
      // Cache doesn't exist or is invalid, will fetch fresh
      logger.debug('No valid Pandora station cache found');
    }
  }
  
  private async saveStationCache(): Promise<void> {
    if (!this.stationListCache) return;
    
    try {
      await fs.writeFile(
        PandoraAPI.STATION_CACHE_FILE,
        JSON.stringify(this.stationListCache, null, 2)
      );
      logger.debug('Saved Pandora station cache to disk');
    } catch (error) {
      logger.error('Failed to save Pandora station cache:', error);
    }
  }

  async getGenreStations(): Promise<{ categories: PandoraGenreCategory[] }> {
    return await this.request('station.getGenreStations', {});
  }

  async createStation(musicToken: string, musicType: 'artist' | 'song'): Promise<PandoraStation> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const station: any = await this.request('station.createStation', { musicToken, musicType });
    
    // Transform to unified structure
    return {
      stationId: station.stationId,
      stationName: station.stationName,
      isQuickMix: station.stationName === 'QuickMix' || station.isQuickMix === true,
      isThumbprint: station.stationName === 'Thumbprint Radio' || station.isThumbprint === true,
      isUserCreated: true, // Created stations are user-created
      apiProperties: {
        stationToken: station.stationToken,
        artUrl: station.artUrl,
        type: musicType === 'song' ? 'song' : 'artist'
      }
    };
  }

  async addFeedback(stationToken: string, trackToken: string, isPositive: boolean): Promise<void> {
    await this.request('station.addFeedback', { stationToken, trackToken, isPositive });
  }
  
  isInBackoff(): boolean {
    // Check if backoff file exists and is still valid
    try {
      const backoffData = readFileSync(PandoraAPI.BACKOFF_FILE, 'utf-8');
      const backoff = JSON.parse(backoffData);
      const backoffEndTime = backoff.lastLoginFailure + (backoff.backoffHours * 60 * 60 * 1000);
      return backoffEndTime > Date.now();
    } catch {
      return false;
    }
  }
  
  getBackoffRemaining(): number {
    if (!this.isInBackoff()) return 0;
    try {
      const backoffData = readFileSync(PandoraAPI.BACKOFF_FILE, 'utf-8');
      const backoff = JSON.parse(backoffData);
      const backoffEndTime = backoff.lastLoginFailure + (backoff.backoffHours * 60 * 60 * 1000);
      return Math.ceil((backoffEndTime - Date.now()) / (60 * 60 * 1000));
    } catch {
      return 0;
    }
  }
}