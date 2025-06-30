import { defaultConfig } from './test-config.js';
import { getSafeTestRoom, discoverSystem } from './discovery.js';

/**
 * Helper to load content for testing playback commands
 * Uses multiple fallback methods to ensure content is loaded
 */
export async function loadTestContent(room: string): Promise<boolean> {
  console.log('📻 Loading content for testing...');
  
  // Try multiple methods in order of preference
  // Songs and playlists load faster than radio stations, so try favorites last
  const methods = [
    () => loadFromMusicSearch(room),
    () => loadFromPlaylists(room),
    () => loadFromFavorites(room),
  ];
  
  for (const method of methods) {
    try {
      const success = await method();
      if (success) return true;
    } catch (error) {
      console.log(`   Method failed: ${error}`);
    }
  }
  
  console.log('⚠️  All content loading methods failed');
  return false;
}

/**
 * Try to load content from favorites
 */
async function loadFromFavorites(room: string): Promise<boolean> {
  console.log('   Trying favorites...');
  
  const favoritesResponse = await fetch(`${defaultConfig.apiUrl}/${room}/favorites/detailed`);
  if (!favoritesResponse.ok) {
    console.log('   Failed to get favorites list');
    return false;
  }
  
  const favorites = await favoritesResponse.json();
  console.log(`   Found ${favorites.length} favorites`);
  
  if (favorites.length === 0) {
    return false;
  }
  
  // Check if we got the detailed response or just titles
  if (Array.isArray(favorites) && favorites.length > 0) {
    const firstFav = favorites[0];
    
    // If we have objects with uri/title, look for radio stations
    if (typeof firstFav === 'object' && firstFav.uri) {
      console.log('   Got detailed favorites');
      
      // Look for a radio station (most reliable for continuous playback)
      const radioFavorite = favorites.find((fav: any) => 
        fav.uri && (
          fav.uri.includes('radio') || 
          fav.uri.includes('x-sonosapi-stream') ||
          fav.uri.includes('x-sonosapi-radio') ||
          fav.uri.includes('x-rincon-mp3radio')
        )
      );
      
      const targetFavorite = radioFavorite || favorites[0];
      console.log(`   Loading favorite: ${targetFavorite.title}`);
      const playResponse = await fetch(`${defaultConfig.apiUrl}/${room}/favorite/${encodeURIComponent(targetFavorite.title)}`);
      
      if (playResponse.ok) {
        console.log('✅ Loaded favorite successfully');
        return true;
      } else {
        const error = await playResponse.text();
        console.log(`   Failed to play favorite: ${error}`);
        return false;
      }
    } 
    // If we just got strings (titles), pick one
    else if (typeof firstFav === 'string') {
      console.log('   Got favorite titles only');
      
      // Look for one that might be a radio station
      const radioTitle = favorites.find((title: string) => 
        title.toLowerCase().includes('radio') ||
        title.toLowerCase().includes('fm') ||
        title.toLowerCase().includes('am') ||
        title.toLowerCase().includes('classic') ||
        title.toLowerCase().includes('jazz')
      );
      
      const targetTitle = radioTitle || favorites[0];
      console.log(`   Loading favorite: ${targetTitle}`);
      const playResponse = await fetch(`${defaultConfig.apiUrl}/${room}/favorite/${encodeURIComponent(targetTitle)}`);
      
      if (playResponse.ok) {
        console.log('✅ Loaded favorite successfully');
        return true;
      } else {
        const error = await playResponse.text();
        console.log(`   Failed to play favorite: ${error}`);
        return false;
      }
    }
  }
  
  console.log('   No valid favorites found');
  return false;
}

/**
 * Try to load content via music search
 */
async function loadFromMusicSearch(room: string): Promise<boolean> {
  console.log('   Trying music search...');
  
  // Try to search for classic, non-disruptive songs using structured format
  const queries = [
    'track:Yesterday artist:The Beatles',
    'track:Imagine artist:John Lennon', 
    'track:Let It Be artist:The Beatles'
  ];
  
  for (const query of queries) {
    try {
      const searchResponse = await fetch(`${defaultConfig.apiUrl}/${room}/musicsearch/apple/song/${encodeURIComponent(query)}`);
      if (searchResponse.ok) {
        console.log(`✅ Loaded content via music search: ${query}`);
        return true;
      }
    } catch (error) {
      console.log(`   Search failed for "${query}"`);
    }
  }
  
  return false;
}

/**
 * Try to load content from playlists
 */
async function loadFromPlaylists(room: string): Promise<boolean> {
  console.log('   Trying playlists...');
  
  const playlistsResponse = await fetch(`${defaultConfig.apiUrl}/${room}/playlists/detailed`);
  if (!playlistsResponse.ok) {
    console.log('   Failed to get playlists');
    return false;
  }
  
  const playlists = await playlistsResponse.json();
  console.log(`   Found ${playlists.length} playlists`);
  
  if (playlists.length === 0) {
    return false;
  }
  
  // Try the first playlist
  const playlist = playlists[0];
  if (!playlist || !playlist.title) {
    console.log('   No valid playlist found');
    return false;
  }
  
  console.log(`   Loading playlist: ${playlist.title}`);
  const playResponse = await fetch(`${defaultConfig.apiUrl}/${room}/playlist/${encodeURIComponent(playlist.title)}`);
  
  if (playResponse.ok) {
    console.log('✅ Loaded playlist successfully');
    return true;
  } else {
    const error = await playResponse.text();
    console.log(`   Failed to play playlist: ${error}`);
    return false;
  }
}

/**
 * Alternative: Use a specific favorite by name if you know it exists
 */
export async function loadSpecificFavorite(room: string, favoriteName: string): Promise<boolean> {
  try {
    const response = await fetch(`${defaultConfig.apiUrl}/${room}/favorite/${encodeURIComponent(favoriteName)}`);
    if (response.ok) {
      console.log(`✅ Loaded favorite: ${favoriteName}`);
      return true;
    }
    return false;
  } catch (error) {
    console.log('⚠️  Error loading favorite:', error);
    return false;
  }
}

/**
 * Load a Beatles song into the queue for testing playback commands.
 * This ensures we get appropriate content (not explicit/offensive).
 * Verifies that the loaded track is actually by The Beatles.
 * 
 * @param room - The room name to load content for (defaults to safe test room)
 * @returns Promise that resolves when Beatles content is loaded
 * @throws Error if unable to load Beatles content
 */
export async function loadBeatlesSong(room?: string): Promise<void> {
  // Use provided room or get the default test room
  let targetRoom = room;
  if (!targetRoom) {
    const topology = await discoverSystem();
    targetRoom = await getSafeTestRoom(topology);
  }
  
  // Try multiple Beatles songs in case one fails
  const beatlesSongs = [
    'track:Yesterday artist:The Beatles',
    'track:Hey Jude artist:The Beatles',
    'track:Let It Be artist:The Beatles',
    'track:Come Together artist:The Beatles',
    'track:Here Comes the Sun artist:The Beatles',
    'track:All You Need Is Love artist:The Beatles',
    'track:Help! artist:The Beatles',
    'track:Eleanor Rigby artist:The Beatles'
  ];

  let loaded = false;
  let lastError: any;

  for (const searchQuery of beatlesSongs) {
    try {
      console.log(`   Trying: ${searchQuery}`);
      const query = encodeURIComponent(searchQuery);
      const response = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/musicsearch/apple/song/${query}`);
      
      if (response.status !== 200) {
        lastError = `Search returned status ${response.status}`;
        continue;
      }

      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify the content loaded correctly by checking the state
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/state`);
      const state = await stateResponse.json();

      // Check if we have a current track and it's by The Beatles
      if (state.currentTrack?.artist) {
        const artist = state.currentTrack.artist.toLowerCase();
        if (artist.includes('beatles') || artist === 'the beatles') {
          console.log(`   ✅ Loaded Beatles song: "${state.currentTrack.title}" by ${state.currentTrack.artist}`);
          loaded = true;
          break;
        } else {
          console.log(`   ⚠️  Unexpected artist: ${state.currentTrack.artist} (expected The Beatles)`);
          lastError = `Got artist: ${state.currentTrack.artist}`;
          
          // Stop playback if we got the wrong content
          try {
            await fetch(`${defaultConfig.apiUrl}/${targetRoom}/pause`);
          } catch (e) {
            // Ignore pause errors
          }
        }
      } else {
        lastError = 'No current track after loading';
      }
    } catch (error) {
      lastError = error;
      console.log(`   ⚠️  Failed to load ${searchQuery}:`, error.message || error);
    }
  }

  if (!loaded) {
    // Try a more general Beatles search as fallback
    try {
      console.log('   Trying general Beatles search...');
      const query = encodeURIComponent('The Beatles');
      const response = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/musicsearch/apple/song/${query}`);
      
      if (response.status === 200) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const stateResponse = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/state`);
        const state = await stateResponse.json();
        
        if (state.currentTrack?.artist?.toLowerCase().includes('beatles')) {
          console.log(`   ✅ Loaded Beatles song: "${state.currentTrack.title}" by ${state.currentTrack.artist}`);
          loaded = true;
        }
      }
    } catch (error) {
      console.log('   General Beatles search also failed:', error.message || error);
    }
  }

  if (!loaded) {
    throw new Error(`Failed to load Beatles content. Last error: ${lastError}`);
  }
}