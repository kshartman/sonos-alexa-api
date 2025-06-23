import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import type { Config } from '../types/sonos.js';

const execAsync = promisify(exec);

export class TTSService {
  private config: Config;
  private cacheDir: string;

  constructor(config: Config) {
    this.config = config;
    this.cacheDir = path.join(config.dataDir || './data', 'tts-cache');
  }

  async init(): Promise<void> {
    // Create cache directory
    await fs.mkdir(this.cacheDir, { recursive: true });
  }

  async generateTTS(text: string, language = 'en'): Promise<string> {
    // Generate cache key
    const cacheKey = crypto.createHash('md5').update(`${text}-${language}`).digest('hex');
    const cacheFile = path.join(this.cacheDir, `${cacheKey}.mp3`);

    // Check cache first
    try {
      await fs.access(cacheFile);
      logger.debug(`TTS cache hit for: ${text}`);
      return cacheFile;
    } catch {
      // Not in cache, generate it
    }

    // Try configured TTS providers in order
    if (this.config.voicerss) {
      return this.generateVoiceRSS(text, language, cacheFile);
    } else if (this.config.macSay && process.platform === 'darwin') {
      return this.generateMacSay(text, cacheFile);
    } else {
      // Default to Google TTS (free but unofficial)
      return this.generateGoogleTTS(text, language, cacheFile);
    }
  }

  private async generateGoogleTTS(text: string, language: string, outputFile: string): Promise<string> {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${language}&q=${encodeURIComponent(text)}`;
    
    logger.debug(`Generating Google TTS for: ${text}`);
    
    // Download using curl (cross-platform)
    try {
      await execAsync(`curl -s -o "${outputFile}" "${url}" -H "User-Agent: Mozilla/5.0"`);
      logger.debug(`Google TTS generated: ${outputFile}`);
      return outputFile;
    } catch (error) {
      logger.error('Google TTS generation failed:', error);
      throw new Error('TTS generation failed');
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
      await execAsync(`say -v ${voice} -r ${rate} -o "${tempFile}" "${text}"`);
      
      // Convert AIFF to MP3 using ffmpeg or afconvert
      try {
        // Try afconvert first (built into macOS)
        await execAsync(`afconvert -f mp4f -d aac "${tempFile}" "${outputFile}"`);
      } catch {
        // If afconvert fails, try ffmpeg if available
        try {
          await execAsync(`ffmpeg -i "${tempFile}" -acodec mp3 -ab 128k "${outputFile}" -y`);
        } catch {
          // If both fail, just use Google TTS instead
          await fs.unlink(tempFile).catch(() => {}); // Clean up temp file
          logger.warn('Neither afconvert nor ffmpeg available, falling back to Google TTS');
          return this.generateGoogleTTS(text, 'en', outputFile);
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

  async getTTSUrl(text: string, language = 'en', baseUrl: string): Promise<string> {
    const audioFile = await this.generateTTS(text, language);
    
    // Generate a unique filename for serving
    const filename = path.basename(audioFile);
    
    // Return URL that will be served by our server
    const url = `${baseUrl}/tts/${filename}`;
    logger.debug(`TTS URL generated: ${url} for file: ${audioFile}`);
    return url;
  }

  async serveTTSFile(filename: string): Promise<Buffer | null> {
    const filePath = path.join(this.cacheDir, filename);
    
    try {
      const data = await fs.readFile(filePath);
      return data;
    } catch (error) {
      logger.error(`TTS file not found: ${filename}`);
      return null;
    }
  }

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
}