/**
 * Default search terms for different content types and services
 * These are carefully chosen to work across different music libraries and services
 */

import { loadTestContentCache } from './test-content-cache.js';

export interface SearchTerms {
  song: string;
  album: string;
  artist: string;
}

/**
 * Get default search terms based on cached content or fallbacks
 */
export async function getDefaultSearchTerms(service: string = 'library'): Promise<SearchTerms> {
  // First try to use cached content
  const cache = await loadTestContentCache();
  
  if (cache && service === cache.service) {
    // Use the cached content's metadata for more reliable results
    if (cache.songTitle && cache.songArtist) {
      // Use just the first word of the title for a broader search
      const firstWord = cache.songTitle.split(' ')[0].toLowerCase();
      return {
        song: firstWord,
        album: cache.albumTitle?.split(' ')[0].toLowerCase() || 'greatest',
        artist: cache.songArtist.split(' ')[0].toLowerCase()
      };
    }
  }
  
  // Service-specific defaults that are likely to return results
  switch (service) {
    case 'library':
      // Generic terms that commonly appear in music libraries
      return {
        song: 'love',     // Very common word in song titles
        album: 'greatest', // Greatest hits albums are common
        artist: 'the'      // Many bands start with "The"
      };
      
    case 'apple':
      // Popular content likely available on Apple Music
      return {
        song: 'hello',     // Adele's Hello
        album: 'abbey',    // Beatles' Abbey Road
        artist: 'beatles'  // The Beatles
      };
      
    case 'spotify':
      // Popular content likely available on Spotify
      return {
        song: 'shape',     // Shape of You
        album: 'thriller', // Michael Jackson's Thriller
        artist: 'taylor'   // Taylor Swift
      };
      
    case 'pandora':
      // Station-friendly search terms
      return {
        song: 'classic',
        album: 'hits',
        artist: 'rock'
      };
      
    default:
      // Generic fallback
      return {
        song: 'music',
        album: 'album',
        artist: 'artist'
      };
  }
}

/**
 * Get a search term for a specific content type
 */
export async function getSearchTerm(
  contentType: 'song' | 'album' | 'artist', 
  service: string = 'library'
): Promise<string> {
  const terms = await getDefaultSearchTerms(service);
  return terms[contentType];
}

/**
 * Get a safe search query that's likely to return results
 * This combines terms for better results
 */
export async function getSafeSearchQuery(
  contentType: 'song' | 'album' | 'artist',
  service: string = 'library'
): Promise<string> {
  const cache = await loadTestContentCache();
  
  // If we have cached content for this service, use it
  if (cache && service === cache.service) {
    switch (contentType) {
      case 'song':
        if (cache.songTitle) {
          // Use partial title for broader matches
          return cache.songTitle.split(' ').slice(0, 2).join(' ');
        }
        break;
      case 'album':
        if (cache.albumTitle) {
          return cache.albumTitle.split(' ').slice(0, 2).join(' ');
        }
        break;
      case 'artist':
        if (cache.songArtist) {
          return cache.songArtist.split(' ')[0];
        }
        break;
    }
  }
  
  // Fall back to simple search term
  return getSearchTerm(contentType, service);
}