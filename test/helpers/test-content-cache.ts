/**
 * Test content cache - stores discovered URIs for consistent test playback
 */

import fs from 'fs/promises';
import path from 'path';
import { defaultConfig } from './test-config.js';

interface TestContentCache {
  songUri?: string;
  songTitle?: string;
  songArtist?: string;
  albumUri?: string;
  albumTitle?: string;
  albumArtist?: string;
  service?: string;
  lastUpdated?: string;
}

const CACHE_FILE = path.join(process.cwd(), 'test', 'helpers', 'test-content.cache.json');

/**
 * Load cached test content URIs
 */
export async function loadTestContentCache(): Promise<TestContentCache | null> {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // Cache doesn't exist yet
    return null;
  }
}

/**
 * Save test content URIs to cache
 */
export async function saveTestContentCache(cache: TestContentCache): Promise<void> {
  cache.lastUpdated = new Date().toISOString();
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log('💾 Saved test content cache');
}

/**
 * Discover and cache good test content
 */
export async function discoverTestContent(room: string): Promise<TestContentCache> {
  console.log('🔍 Discovering test content...');
  
  const cache: TestContentCache = {};
  
  // Check for environment variables first
  const testService = process.env.TEST_SERVICE || process.env.TEST_SONG_SERVICE; // Support both for backwards compatibility
  const testSongQueries = process.env.TEST_SONG_QUERIES;
  const testAlbumQueries = process.env.TEST_ALBUM_QUERIES;
  
  // Try different services in priority order
  const services = testService ? [testService] : ['library', 'apple', 'spotify'];
  
  // Parse song queries from JSON or use defaults
  let songQueries: Array<{title: string, artist: string}>;
  if (testSongQueries) {
    try {
      songQueries = JSON.parse(testSongQueries);
      console.log(`   Using TEST_SONG_QUERIES: ${songQueries.length} queries`);
    } catch (e) {
      console.log(`   ⚠️  Invalid TEST_SONG_QUERIES JSON: ${e.message}`);
      console.log('   Using default song queries');
      songQueries = [
        {title: 'Yesterday', artist: 'The Beatles'},
        {title: 'Imagine', artist: 'John Lennon'},
        {title: 'Let It Be', artist: 'The Beatles'},
        {title: 'Hey Jude', artist: 'The Beatles'},
        {title: 'Come Together', artist: 'The Beatles'}
      ];
    }
  } else {
    songQueries = [
      {title: 'Yesterday', artist: 'The Beatles'},
      {title: 'Imagine', artist: 'John Lennon'},
      {title: 'Let It Be', artist: 'The Beatles'},
      {title: 'Hey Jude', artist: 'The Beatles'},
      {title: 'Come Together', artist: 'The Beatles'}
    ];
  }
  
  // Find a good song
  for (const service of services) {
    for (const query of songQueries) {
      try {
        const searchQuery = `${query.title} ${query.artist}`;
        console.log(`   Searching ${service}: ${searchQuery}`);
        const response = await fetch(
          `${defaultConfig.apiUrl}/${room}/musicsearch/${service}/song/${encodeURIComponent(searchQuery)}?play=false`
        );
        
        if (response.ok) {
          const results = await response.json();
          if (results.results && results.results.length > 0) {
            const song = results.results[0];
            
            // Add to queue to get the URI
            const queueResponse = await fetch(
              `${defaultConfig.apiUrl}/${room}/musicsearch/${service}/song/${encodeURIComponent(song.title + ' ' + song.artist)}?play=false`
            );
            
            if (queueResponse.ok) {
              // The search already returned the URI
              cache.songUri = song.uri;
              cache.songTitle = song.title;
              cache.songArtist = song.artist;
              cache.service = service;
              console.log(`   ✅ Found song: "${song.title}" by ${song.artist}`);
              break;
            }
          }
        }
      } catch (error) {
        console.log(`   Failed: ${error.message}`);
      }
    }
    if (cache.songUri) break;
  }
  
  // Parse album queries from JSON or use defaults
  let albumQueries: Array<{title: string, artist: string}>;
  if (testAlbumQueries) {
    try {
      albumQueries = JSON.parse(testAlbumQueries);
      console.log(`   Using TEST_ALBUM_QUERIES: ${albumQueries.length} queries`);
    } catch (e) {
      console.log(`   ⚠️  Invalid TEST_ALBUM_QUERIES JSON: ${e.message}`);
      console.log('   Using default album queries');
      albumQueries = [
        {title: 'Abbey Road', artist: 'The Beatles'},
        {title: 'The Beatles (White Album)', artist: 'The Beatles'},
        {title: 'Rubber Soul', artist: 'The Beatles'},
        {title: 'Revolver', artist: 'The Beatles'}
      ];
    }
  } else {
    albumQueries = [
      {title: 'Abbey Road', artist: 'The Beatles'},
      {title: 'The Beatles (White Album)', artist: 'The Beatles'},
      {title: 'Rubber Soul', artist: 'The Beatles'},
      {title: 'Revolver', artist: 'The Beatles'}
    ];
  }
  
  // Find a good album
  for (const service of services) {
    for (const query of albumQueries) {
      try {
        const searchQuery = `${query.title} ${query.artist}`;
        console.log(`   Searching ${service} albums: ${searchQuery}`);
        const response = await fetch(
          `${defaultConfig.apiUrl}/${room}/musicsearch/${service}/album/${encodeURIComponent(searchQuery)}?play=false`
        );
        
        if (response.ok) {
          const results = await response.json();
          if (results.results && results.results.length > 0) {
            const album = results.results[0];
            
            // Add to queue to get the URI
            const queueResponse = await fetch(
              `${defaultConfig.apiUrl}/${room}/musicsearch/${service}/album/${encodeURIComponent(album.title + ' ' + album.artist)}?play=false`
            );
            
            if (queueResponse.ok) {
              // For music library albums, we can use the album search directly
              // The album URI is constructed from the search response
              cache.albumUri = album.uri || `x-rincon-playlist:album:${encodeURIComponent(album.title)}`;
              cache.albumTitle = album.title;
              cache.albumArtist = album.artist;
              console.log(`   ✅ Found album: "${album.title}" by ${album.artist}`);
              break;
            }
          }
        }
      } catch (error) {
        console.log(`   Failed: ${error.message}`);
      }
    }
    if (cache.albumUri) break;
  }
  
  // Clear the queue after discovery
  await fetch(`${defaultConfig.apiUrl}/${room}/clearqueue`);
  
  return cache;
}

/**
 * Clear the test content cache
 */
export async function clearTestContentCache(): Promise<void> {
  try {
    await fs.unlink(CACHE_FILE);
    console.log('🗑️  Cleared test content cache');
  } catch (error) {
    // File doesn't exist, that's fine
  }
}

/**
 * Get or discover test content URIs
 */
export async function getTestContentUris(room: string): Promise<TestContentCache> {
  // First try to load from cache
  let cache = await loadTestContentCache();
  
  if (!cache || !cache.songUri) {
    // Need to discover content
    cache = await discoverTestContent(room);
    await saveTestContentCache(cache);
  } else {
    console.log('📦 Using cached test content');
  }
  
  return cache;
}