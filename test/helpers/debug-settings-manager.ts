import { defaultConfig } from './test-config.js';

interface DebugSettings {
  logLevel: string;
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
      
      const response = await fetch(`${baseUrl}/debug`, { headers });
      if (!response.ok) {
        throw new Error(`Failed to get debug settings: ${response.status}`);
      }
      
      const data = await response.json();
      this.savedSettings = {
        logLevel: data.logLevel,
        categories: data.categories
      };
      
      console.log('💾 Saved debug settings:', {
        logLevel: this.savedSettings.logLevel,
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
      
      // Restore log level
      const logLevelResponse = await fetch(`${baseUrl}/debug/level/${this.savedSettings.logLevel}`, { headers });
      if (!logLevelResponse.ok) {
        console.warn(`⚠️  Failed to restore log level: ${logLevelResponse.status}`);
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
      
      // Enable all debug categories
      const enableAllResponse = await fetch(`${baseUrl}/debug/enable-all`, { headers });
      if (enableAllResponse.ok) {
        console.log('✅ All debug categories enabled on server');
      }
      
      // Set log level to debug
      const logLevelResponse = await fetch(`${baseUrl}/debug/level/debug`, { headers });
      if (logLevelResponse.ok) {
        console.log('✅ Server log level set to debug');
      }
    } catch (error) {
      console.warn('⚠️  Could not enable debug mode:', error);
    }
  }
}