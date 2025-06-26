import { defaultConfig } from './test-config.js';

interface DebugSettings {
  logLevel: string;         // winston logger level (from /loglevel)
  debugLevel: string;       // debugManager level (from /debug)
  categories: Record<string, boolean>;
}

export class DebugSettingsManager {
  private savedSettings: DebugSettings | null = null;

  /**
   * Get auth headers if URL contains credentials
   */
  private getAuthHeaders(url: string): HeadersInit {
    const parsedUrl = new URL(url);
    const headers: HeadersInit = {};
    
    if (parsedUrl.username && parsedUrl.password) {
      const auth = Buffer.from(`${parsedUrl.username}:${parsedUrl.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }
    
    return headers;
  }

  /**
   * Get base URL without credentials
   */
  private getBaseUrl(url: string): string {
    const parsedUrl = new URL(url);
    parsedUrl.username = '';
    parsedUrl.password = '';
    return parsedUrl.origin;
  }

  /**
   * Save current debug settings
   */
  async save(): Promise<void> {
    try {
      const baseUrl = this.getBaseUrl(defaultConfig.apiUrl);
      const headers = this.getAuthHeaders(defaultConfig.apiUrl);
      
      // Get debug settings (includes debugManager level)
      const debugResponse = await fetch(`${baseUrl}/debug`, { headers });
      if (!debugResponse.ok) {
        throw new Error(`Failed to get debug settings: ${debugResponse.status}`);
      }
      
      const debugData = await debugResponse.json();
      
      // Get winston logger level (may be different from debugManager level)
      // Note: There's no direct endpoint to get winston level, so we assume
      // it matches the debugManager level unless we track it separately
      
      this.savedSettings = {
        logLevel: debugData.logLevel,    // This is actually the debugManager level
        debugLevel: debugData.logLevel,   // Same for now
        categories: debugData.categories
      };
      
      console.log('💾 Saved debug settings:', {
        logLevel: this.savedSettings.logLevel,
        debugLevel: this.savedSettings.debugLevel,
        enabledCategories: Object.keys(this.savedSettings.categories).filter(k => this.savedSettings!.categories[k])
      });
    } catch (error) {
      console.warn('⚠️  Could not save debug settings:', error);
    }
  }

  /**
   * Restore saved debug settings
   */
  async restore(): Promise<void> {
    if (!this.savedSettings) {
      console.log('⚠️  No saved debug settings to restore');
      return;
    }

    try {
      const baseUrl = this.getBaseUrl(defaultConfig.apiUrl);
      const headers = this.getAuthHeaders(defaultConfig.apiUrl);
      
      // Since /loglevel sets BOTH winston and debugManager levels,
      // we need to be careful about the restore order
      
      // First, set the winston logger level (which also sets debugManager)
      // This ensures winston is at the correct level
      if (this.savedSettings.logLevel === this.savedSettings.debugLevel) {
        // If they were the same, just use /loglevel which sets both
        const logLevelResponse = await fetch(`${baseUrl}/loglevel/${this.savedSettings.logLevel}`, { headers });
        if (!logLevelResponse.ok) {
          console.warn(`⚠️  Failed to restore log level: ${logLevelResponse.status}`);
        }
      } else {
        // If they were different, we need to set them separately
        // First set winston+debug via /loglevel, then correct debug via /debug/level
        const logLevelResponse = await fetch(`${baseUrl}/loglevel/${this.savedSettings.logLevel}`, { headers });
        if (!logLevelResponse.ok) {
          console.warn(`⚠️  Failed to restore winston log level: ${logLevelResponse.status}`);
        }
        
        // Then set just the debugManager level if it was different
        const debugLevelResponse = await fetch(`${baseUrl}/debug/level/${this.savedSettings.debugLevel}`, { headers });
        if (!debugLevelResponse.ok) {
          console.warn(`⚠️  Failed to restore debug level: ${debugLevelResponse.status}`);
        }
      }
      
      // Restore categories
      for (const [category, enabled] of Object.entries(this.savedSettings.categories)) {
        const categoryResponse = await fetch(`${baseUrl}/debug/category/${category}/${enabled}`, { headers });
        if (!categoryResponse.ok) {
          console.warn(`⚠️  Failed to restore category ${category}: ${categoryResponse.status}`);
        }
      }
      
      console.log('♻️  Restored debug settings:', {
        logLevel: this.savedSettings.logLevel,
        debugLevel: this.savedSettings.debugLevel,
        enabledCategories: Object.keys(this.savedSettings.categories).filter(k => this.savedSettings.categories[k])
      });
    } catch (error) {
      console.warn('⚠️  Could not restore debug settings:', error);
    }
  }

  /**
   * Enable all debug categories and set log level to debug
   */
  async enableDebugMode(): Promise<void> {
    try {
      const baseUrl = this.getBaseUrl(defaultConfig.apiUrl);
      const headers = this.getAuthHeaders(defaultConfig.apiUrl);
      
      // Use /loglevel/debug to set BOTH winston and debugManager to debug
      const logLevelResponse = await fetch(`${baseUrl}/loglevel/debug`, { headers });
      if (logLevelResponse.ok) {
        console.log('✅ Server log level set to debug (winston + debugManager)');
      }
      
      // Enable all debug categories
      const enableAllResponse = await fetch(`${baseUrl}/debug/enable-all`, { headers });
      if (enableAllResponse.ok) {
        console.log('✅ All debug categories enabled on server');
      }
    } catch (error) {
      console.warn('⚠️  Could not enable debug mode:', error);
    }
  }
}