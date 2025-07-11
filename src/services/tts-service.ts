import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import { scheduler } from '../utils/scheduler.js';
import type { Config } from '../types/sonos.js';

const execAsync = promisify(exec);

/**
 * Text-to-speech service that generates audio files from text.
 * Supports multiple providers (Google TTS, VoiceRSS, macOS Say).
 * Caches generated audio files to avoid redundant generation.
 */
export class TTSService {
  private config: Config;
  private cacheDir: string;
  private readonly CLEANUP_TASK_ID = 'tts-cache-cleanup';
  private maxAge: number = 24 * 60 * 60 * 1000; // 24 hours default

  /**
   * Creates a new TTS service instance.
   * @param config - Application configuration including TTS provider settings
   */
  constructor(config: Config) {
    this.config = config;
    this.cacheDir = path.join(config.dataDir || './data', 'tts-cache');
    // Allow config override for cache max age
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.maxAge = (config as any).ttsCacheMaxAge || this.maxAge; // ANY IS CORRECT: Config type doesn't include ttsCacheMaxAge but it may be present
  }

  /**
   * Initializes the TTS service.
   * Creates cache directory and starts periodic cleanup.
   */
  async init(): Promise<void> {
    // Create cache directory
    await fs.mkdir(this.cacheDir, { recursive: true });
    
    // Start cleanup interval - run every hour
    scheduler.scheduleInterval(
      this.CLEANUP_TASK_ID,
      async () => {
        try {
          await this.cleanCache(1);
        } catch (err) {
          logger.error('TTS cache cleanup error:', err);
        }
      },
      60 * 60 * 1000, // 1 hour
      { unref: true }
    );
    
    // Run initial cleanup - remove files older than 1 day
    await this.cleanCache(1);
    logger.info(`TTS cache cleanup scheduled - removing files older than ${this.maxAge / 1000 / 60 / 60} hours`);
  }

  /**
   * Generates a TTS audio file from text.
   * Returns cached file if available, otherwise generates new audio.
   * @param text - The text to convert to speech
   * @param language - Language code (default: 'en')
   * @returns Path to the generated MP3 file
   */
  async generateTTS(text: string, language = 'en'): Promise<string> {
    // Limit text length based on provider
    // Google Translate TTS (free) has ~200 character limit
    // Other providers may support longer text
    const maxLength = this.config.voicerss || (this.config.macSay && process.platform === 'darwin') ? 256 : 200;
    const truncatedText = text.substring(0, maxLength);
    if (text.length > maxLength) {
      logger.warn(`TTS text truncated from ${text.length} to ${maxLength} characters`);
    }
    
    // Generate cache key
    const cacheKey = crypto.createHash('md5').update(`${truncatedText}-${language}`).digest('hex');
    const cacheFile = path.join(this.cacheDir, `${cacheKey}.mp3`);

    // Check cache first
    try {
      await fs.access(cacheFile);
      logger.debug(`TTS cache hit for: ${truncatedText}`);
      return cacheFile;
    } catch {
      logger.debug(`TTS cache miss for: ${truncatedText}, will generate new file`);
      // Not in cache, generate it
    }

    // Ensure cache directory exists
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (err) {
      logger.error('Failed to create TTS cache directory:', err);
    }

    // Try configured TTS providers in order - pass truncated text
    if (this.config.voicerss) {
      return this.generateVoiceRSS(truncatedText, language, cacheFile);
    } else if (this.config.macSay && process.platform === 'darwin') {
      return this.generateMacSay(truncatedText, cacheFile);
    } else {
      // Default to Google TTS (free but unofficial)
      return this.generateGoogleTTS(truncatedText, language, cacheFile);
    }
  }

  private async generateGoogleTTS(text: string, language: string, outputFile: string): Promise<string> {
    const encodedText = encodeURIComponent(text);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${language}&q=${encodedText}`;
    
    logger.debug(`Generating Google TTS for: ${text}`);
    
    try {
      // Download using native fetch
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Google TTS API returned ${response.status}: ${response.statusText}`);
      }
      
      // Get the audio data as a buffer
      const buffer = Buffer.from(await response.arrayBuffer());
      
      // Verify we got actual audio data
      if (buffer.length === 0) {
        throw new Error('Google TTS returned empty response');
      }
      
      // Write to file
      await fs.writeFile(outputFile, buffer);
      
      logger.debug(`Google TTS generated: ${outputFile} (${buffer.length} bytes)`);
      return outputFile;
    } catch (error) {
      logger.error('Google TTS generation failed:', error);
      throw new Error(`TTS generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async generateVoiceRSS(text: string, language: string, outputFile: string): Promise<string> {
    const apiKey = this.config.voicerss;
    const url = `https://api.voicerss.org/?key=${apiKey}&hl=${language}&src=${encodeURIComponent(text)}&f=48khz_16bit_stereo&c=MP3`;
    
    logger.debug(`Generating VoiceRSS TTS for: ${text}`);
    
    try {
      await execAsync(`curl -s -o "${outputFile}" "${url}"`);
      
      // Check if the file is valid
      const stats = await fs.stat(outputFile);
      if (stats.size < 100) {
        // File is too small, probably an error message
        const content = await fs.readFile(outputFile, 'utf-8');
        logger.error(`VoiceRSS API error: ${content}`);
        await fs.unlink(outputFile); // Remove invalid file
        throw new Error(`VoiceRSS API error: ${content}`);
      }
      
      logger.debug(`VoiceRSS TTS generated: ${outputFile}`);
      return outputFile;
    } catch (error) {
      logger.error('VoiceRSS TTS generation failed:', error);
      // Fall back to Google TTS
      logger.info('Falling back to Google TTS');
      return this.generateGoogleTTS(text, language, outputFile);
    }
  }

  private async generateMacSay(text: string, outputFile: string): Promise<string> {
    const voice = this.config.macSay?.voice || 'Alex';
    const rate = this.config.macSay?.rate || 175;
    
    logger.debug(`Generating macOS Say TTS for: ${text}`);
    
    try {
      // First generate as AIFF, then convert to MP3
      const tempFile = outputFile.replace('.mp3', '.aiff');
      // Escape single quotes in text for shell safety
      const safeText = text.replace(/'/g, '\'"\'"\'');
      await execAsync(`say -v ${voice} -r ${rate} -o '${tempFile}' '${safeText}'`);
      
      // Convert AIFF to MP3 using ffmpeg or afconvert
      try {
        // Try ffmpeg first (creates actual MP3)
        await execAsync(`ffmpeg -i "${tempFile}" -acodec mp3 -ab 128k "${outputFile}" -y`);
        logger.debug('Converted AIFF to MP3 using ffmpeg');
      } catch {
        // If ffmpeg not available, try afconvert to create MP3 format
        try {
          // Use MP3 format with afconvert (requires macOS 10.15+)
          await execAsync(`afconvert -f mp3 -d mp3 "${tempFile}" "${outputFile}"`);
          logger.debug('Converted AIFF to MP3 using afconvert');
        } catch {
          // If MP3 not supported, try M4A which Sonos also supports
          try {
            const m4aFile = outputFile.replace('.mp3', '.m4a');
            await execAsync(`afconvert -f m4af -d aac "${tempFile}" "${m4aFile}"`);
            // Rename to .mp3 for consistency (Sonos will still play it)
            await fs.rename(m4aFile, outputFile);
            logger.debug('Converted AIFF to M4A using afconvert (will serve as MP3)');
          } catch {
            // If all conversion fails, use Google TTS instead
            await fs.unlink(tempFile).catch(() => {}); // Clean up temp file
            logger.warn('Audio conversion failed, falling back to Google TTS');
            return this.generateGoogleTTS(text, 'en', outputFile);
          }
        }
      }
      
      // Clean up temp file
      await fs.unlink(tempFile).catch(() => {});
      
      logger.debug(`macOS Say TTS generated: ${outputFile}`);
      return outputFile;
    } catch (error) {
      logger.error('macOS Say TTS generation failed:', error);
      // Fall back to Google TTS
      return this.generateGoogleTTS(text, 'en', outputFile);
    }
  }

  /**
   * Gets a URL for accessing TTS audio.
   * Generates the audio file if needed and returns a URL path.
   * @param text - The text to convert to speech
   * @param language - Language code (default: 'en')
   * @param baseUrl - Base URL of the API server
   * @returns URL to access the audio file
   */
  async getTTSUrl(text: string, language = 'en', baseUrl: string): Promise<string> {
    const audioFile = await this.generateTTS(text, language);
    
    // Generate a unique filename for serving
    const filename = path.basename(audioFile);
    
    // Return URL that will be served by our server
    const url = `${baseUrl}/tts/${filename}`;
    logger.debug(`TTS URL generated: ${url} for file: ${audioFile}`);
    return url;
  }

  /**
   * Serves a TTS audio file by filename.
   * @param filename - The filename to serve from the cache
   * @returns Buffer containing the audio data or null if not found
   */
  async serveTTSFile(filename: string): Promise<Buffer | null> {
    const filePath = path.join(this.cacheDir, filename);
    
    try {
      const data = await fs.readFile(filePath);
      return data;
    } catch (_error) {
      logger.error(`TTS file not found: ${filename}`);
      return null;
    }
  }

  /**
   * Cleans old files from the TTS cache.
   * @param maxAgeDays - Remove files older than this many days (default: 7)
   */
  async cleanCache(maxAgeDays = 7): Promise<void> {
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    try {
      const files = await fs.readdir(this.cacheDir);
      
      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtimeMs > maxAgeMs) {
          await fs.unlink(filePath);
          logger.debug(`Cleaned old TTS cache file: ${file}`);
        }
      }
    } catch (error) {
      logger.error('Error cleaning TTS cache:', error);
    }
  }
  
  /**
   * Shuts down the TTS service and cleans up resources.
   */
  destroy(): void {
    scheduler.clearTask(this.CLEANUP_TASK_ID);
  }
}