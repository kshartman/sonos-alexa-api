import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import logger from '../utils/logger.js';

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

export class SpotifyTokenManager {
  private dataDir: string;
  private instanceId: string;
  private tokens: SpotifyTokens | null = null;

  constructor(dataDir: string = './data', instanceId?: string) {
    this.dataDir = dataDir;
    // Use hostname or INSTANCE_ID env var as instance identifier
    this.instanceId = instanceId || process.env.INSTANCE_ID || process.env.HOSTNAME || 'default';
    
    // Ensure data directory exists
    try {
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true });
      }
    } catch (error) {
      logger.error(`Failed to create data directory: ${error}`);
    }
    
    this.loadTokens();
  }

  /**
   * Initialize with a refresh token from config
   */
  public initializeFromRefreshToken(refreshToken: string): void {
    // Create a token object with only refresh token
    // Access token will be fetched on first use
    this.tokens = {
      accessToken: '',
      refreshToken: refreshToken,
      expiresAt: 0, // Force immediate refresh
      scope: 'user-read-private user-read-email playlist-read-private playlist-read-collaborative user-library-read user-top-read user-read-recently-played'
    };
    // Don't save to file yet - wait for successful refresh
    logger.info(`Initialized Spotify tokens from config for instance: ${this.instanceId}`);
  }

  private get tokenFile(): string {
    return join(this.dataDir, `spotify-tokens-${this.instanceId}.json`);
  }

  private loadTokens(): void {
    if (existsSync(this.tokenFile)) {
      try {
        const data = readFileSync(this.tokenFile, 'utf-8');
        this.tokens = JSON.parse(data);
        logger.debug(`Loaded Spotify tokens for instance: ${this.instanceId}`);
      } catch (error) {
        logger.error(`Failed to load Spotify tokens: ${error}`);
      }
    }
  }

  public saveTokens(tokens: SpotifyTokens): void {
    this.tokens = tokens;
    try {
      // Ensure directory exists
      const dir = dirname(this.tokenFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      
      writeFileSync(this.tokenFile, JSON.stringify(tokens, null, 2));
      logger.info(`Saved Spotify tokens for instance: ${this.instanceId}`);
    } catch (error) {
      logger.error(`Failed to save Spotify tokens: ${error}`);
      throw error;
    }
  }

  public getTokens(): SpotifyTokens | null {
    return this.tokens;
  }

  public isTokenExpired(): boolean {
    if (!this.tokens) return true;
    return Date.now() >= this.tokens.expiresAt;
  }

  public needsRefresh(): boolean {
    if (!this.tokens) return false;
    // Refresh 5 minutes before expiry
    return Date.now() >= (this.tokens.expiresAt - 5 * 60 * 1000);
  }

  public clearTokens(): void {
    this.tokens = null;
    try {
      if (existsSync(this.tokenFile)) {
        logger.info(`Clearing Spotify tokens for instance: ${this.instanceId}`);
        // Don't delete file, just write empty object
        writeFileSync(this.tokenFile, '{}');
      }
    } catch (error) {
      logger.error(`Failed to clear Spotify tokens: ${error}`);
    }
  }

  public getInstanceId(): string {
    return this.instanceId;
  }
}