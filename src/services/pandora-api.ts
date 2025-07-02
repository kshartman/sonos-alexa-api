import crypto from 'crypto';
import logger from '../utils/logger.js';

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

export interface PandoraStation {
  stationId: string;
  stationName: string;
  stationToken?: string;
  artUrl?: string;
  type?: 'artist' | 'song' | 'genre';
  isUserCreated?: boolean;
  isQuickMix?: boolean;
  isThumbprint?: boolean;
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

  constructor(username: string, password: string, partnerInfo?: Partial<PartnerInfo>) {
    this.username = username;
    this.password = password;
    
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
    } catch (error) {
      logger.error('Pandora login failed:', error);
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
  async getStationList(includeStationArtUrl = true): Promise<{ stations: PandoraStation[] }> {
    const response = await this.request('user.getStationList', { includeStationArtUrl });
    
    // Enhance station data with additional metadata
    if (response.stations) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response.stations = response.stations.map((station: any) => {
        const enhanced: PandoraStation = {
          ...station,
          isQuickMix: station.stationName === 'QuickMix' || station.isQuickMix === true,
          isThumbprint: station.stationName === 'Thumbprint Radio' || station.isThumbprint === true,
          // Stations without a specific type are typically user-created
          isUserCreated: !station.isQuickMix && !station.isThumbprint && 
                        station.stationName !== 'QuickMix' && 
                        station.stationName !== 'Thumbprint Radio'
        };
        return enhanced;
      });
    }
    
    return response;
  }

  async searchMusic(searchText: string): Promise<PandoraSearchResult> {
    return await this.request('music.search', { searchText });
  }

  async getGenreStations(): Promise<{ categories: PandoraGenreCategory[] }> {
    return await this.request('station.getGenreStations', {});
  }

  async createStation(musicToken: string, musicType: 'artist' | 'song'): Promise<PandoraStation> {
    return await this.request('station.createStation', { musicToken, musicType });
  }

  async addFeedback(stationToken: string, trackToken: string, isPositive: boolean): Promise<void> {
    await this.request('station.addFeedback', { stationToken, trackToken, isPositive });
  }
}