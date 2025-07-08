import crypto from 'crypto';
import logger from '../utils/logger.js';
import { loadConfiguration } from '../utils/config-loader.js';
import { scheduler } from '../utils/scheduler.js';
import { SpotifyTokenManager, SpotifyTokens } from './spotify-token-manager.js';
import { httpRequest } from '../utils/http.js';
import type { Config } from '../types/sonos.js';

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

export class SpotifyAuthService {
  private config: Config;
  private tokenManager: SpotifyTokenManager;
  private pendingStates = new Map<string, { instanceId: string; expiresAt: number }>();
  private readonly CLEANUP_TASK_ID = 'spotify-auth-cleanup';

  constructor(config?: Config) {
    // Accept optional config to avoid multiple loadConfiguration() calls during testing
    this.config = config || loadConfiguration();
    this.tokenManager = new SpotifyTokenManager(
      this.config.dataDir || './data',
      process.env.INSTANCE_ID
    );
    
    // Initialize from config if refresh token is present
    if (this.config.spotify?.refreshToken) {
      logger.info('Initializing Spotify auth from config refresh token');
      this.tokenManager.initializeFromRefreshToken(this.config.spotify.refreshToken);
    }
    
    // Clean up expired states every minute
    scheduler.scheduleInterval(this.CLEANUP_TASK_ID, () => this.cleanupExpiredStates(), 60000, { unref: true });
  }

  /**
   * Generate authorization URL for manual OAuth flow
   */
  public generateAuthUrl(): { authUrl: string; state: string } {
    if (!this.config.spotify?.clientId) {
      throw new Error('Spotify client ID not configured');
    }

    const state = this.generateState();
    const scopes = this.config.spotify.scopes || [
      'user-read-private',
      'user-read-email',
      'playlist-read-private',
      'playlist-read-collaborative',
      'user-library-read',
      'user-top-read',
      'user-read-recently-played'
    ];

    const params = new URLSearchParams({
      client_id: this.config.spotify.clientId,
      response_type: 'code',
      redirect_uri: this.config.spotify.redirectUri || 'http://localhost:8888/callback',
      state: state,
      scope: scopes.join(' '),
      show_dialog: 'false'
    });

    const authUrl = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
    
    // Store state for verification (expires in 10 minutes)
    this.pendingStates.set(state, {
      instanceId: process.env.INSTANCE_ID || 'default',
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    return { authUrl, state };
  }

  /**
   * Process callback URL submitted by user
   */
  public async processCallbackUrl(callbackUrl: string): Promise<void> {
    const url = new URL(callbackUrl);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      throw new Error(`Spotify authorization failed: ${error}`);
    }

    if (!code || !state) {
      throw new Error('Missing code or state parameter in callback URL');
    }

    // Verify state
    const stateData = this.pendingStates.get(state);
    if (!stateData) {
      throw new Error('Invalid or expired state parameter');
    }

    if (Date.now() > stateData.expiresAt) {
      this.pendingStates.delete(state);
      throw new Error('State parameter has expired. Please start the auth process again.');
    }

    // Exchange code for tokens
    await this.exchangeCodeForTokens(code);
    
    // Clean up state
    this.pendingStates.delete(state);
  }

  /**
   * Exchange authorization code for access and refresh tokens
   */
  private async exchangeCodeForTokens(code: string): Promise<void> {
    if (!this.config.spotify?.clientId || !this.config.spotify?.clientSecret) {
      throw new Error('Spotify client credentials not configured');
    }

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: this.config.spotify.redirectUri || 'http://localhost:8888/callback',
      client_id: this.config.spotify.clientId,
      client_secret: this.config.spotify.clientSecret
    });

    const response = await httpRequest({
      method: 'POST',
      url: SPOTIFY_TOKEN_URL,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (response.statusCode !== 200) {
      throw new Error(`Failed to exchange code for tokens: ${response.body}`);
    }

    const data = JSON.parse(response.body);
    const tokens: SpotifyTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
      scope: data.scope
    };

    this.tokenManager.saveTokens(tokens);
    logger.info('Successfully obtained and saved Spotify tokens');
  }

  /**
   * Refresh access token using refresh token
   */
  public async refreshAccessToken(): Promise<string> {
    const tokens = this.tokenManager.getTokens();
    if (!tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    if (!this.config.spotify?.clientId || !this.config.spotify?.clientSecret) {
      throw new Error('Spotify client credentials not configured');
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: this.config.spotify.clientId,
      client_secret: this.config.spotify.clientSecret
    });

    const response = await httpRequest({
      method: 'POST',
      url: SPOTIFY_TOKEN_URL,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (response.statusCode !== 200) {
      throw new Error(`Failed to refresh token: ${response.body}`);
    }

    const data = JSON.parse(response.body);
    const updatedTokens: SpotifyTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || tokens.refreshToken, // Spotify may not return a new refresh token
      expiresAt: Date.now() + (data.expires_in * 1000),
      scope: data.scope || tokens.scope
    };

    this.tokenManager.saveTokens(updatedTokens);
    return updatedTokens.accessToken;
  }

  /**
   * Get current access token, refreshing if necessary
   */
  public async getAccessToken(): Promise<string> {
    const tokens = this.tokenManager.getTokens();
    if (!tokens) {
      throw new Error('Not authenticated with Spotify. Please complete OAuth flow.');
    }

    if (this.tokenManager.needsRefresh()) {
      logger.debug('Spotify access token needs refresh');
      return await this.refreshAccessToken();
    }

    return tokens.accessToken;
  }

  /**
   * Check if authenticated with Spotify
   */
  public isAuthenticated(): boolean {
    return this.tokenManager.getTokens() !== null;
  }

  /**
   * Generate random state parameter
   */
  private generateState(): string {
    const instanceId = process.env.INSTANCE_ID || 'default';
    const random = crypto.randomBytes(16).toString('hex');
    return `${instanceId}_${random}`;
  }

  /**
   * Clean up expired state parameters
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, data] of this.pendingStates.entries()) {
      if (now > data.expiresAt) {
        this.pendingStates.delete(state);
      }
    }
  }
}

// Export singleton instance
// Create singleton instance with default config
export const spotifyAuthService = new SpotifyAuthService();

// Factory function for creating instances with custom config
export function createSpotifyAuthService(config: Config): SpotifyAuthService {
  return new SpotifyAuthService(config);
}