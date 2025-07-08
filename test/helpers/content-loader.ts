import { defaultConfig } from './test-config.js';
import { getSafeTestRoom, discoverSystem } from './discovery.js';
import { getBestTestFavorite, Favorite } from './favorite-selector.js';
import { getTestContentUris } from './test-content-cache.js';
import { testLog } from './test-logger-init.js';


/**
 * Load a single known test song into the queue.
 * Uses cached URIs for consistent, reliable test content.
 * If the song can be queued successfully, it's considered valid.
 * 
 * @param room - The room name to load content for (defaults to safe test room)
 * @param play - Whether to start playing after loading (default: false)
 * @returns Promise that resolves when test song is queued (and optionally playing)
 * @throws Error if unable to queue test content
 */
export async function loadTestSong(room?: string, play: boolean = false): Promise<void> {
  // Use provided room or get the default test room
  let targetRoom = room;
  if (!targetRoom) {
    const topology = await discoverSystem();
    targetRoom = await getSafeTestRoom(topology);
  }
  
  testLog.info('🎵 Loading test song...');
  
  // Check for environment variable override
  const envSongUri = process.env.TEST_SONG_URI;
  if (envSongUri) {
    testLog.info('   Using TEST_SONG_URI from environment');
    const response = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: envSongUri })
    });
    
    if (response.ok) {
      testLog.info('   ✅ Loaded song from environment variable');
      return;
    }
  }
  
  // Get cached content URIs (will discover if needed)
  const cache = await getTestContentUris(targetRoom);
  
  if (!cache.songUri) {
    throw new Error('Failed to find suitable test song');
  }
  
  // Clear queue first
  await fetch(`${defaultConfig.apiUrl}/${targetRoom}/clearqueue`);
  
  // Add the cached song URI
  testLog.info(`   Loading: "${cache.songTitle}" by ${cache.songArtist}`);
  const response = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uri: cache.songUri })
  });
  
  if (!response.ok) {
    throw new Error(`Failed to add test song to queue: ${response.status}`);
  }
  
  testLog.info(`   ✅ Song queued successfully`);
  
  // Start playing if requested
  if (play) {
    const playResponse = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/play`);
    if (!playResponse.ok) {
      throw new Error(`Failed to start playback: ${playResponse.status}`);
    }
    testLog.info(`   ▶️  Playback started`);
    // Pause for 1 second so you can hear the music
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * Load a test favorite into the queue.
 * Selects from available favorites using priority order:
 * 1. x-file-cifs (network playlists)
 * 2. x-rincon-playlist (local playlists) 
 * 3. x-sonos-spotify (spotify tracks)
 * 4. x-sonosapi-stream (streams)
 * 
 * @param room - The room name to load content for (defaults to safe test room)
 * @param play - Whether to start playing after loading (default: false)
 * @returns Promise that resolves when test favorite is queued (and optionally playing)
 * @throws Error if unable to queue test content
 */
export async function loadTestFavorite(room?: string, play: boolean = false): Promise<void> {
  // Use provided room or get the default test room
  let targetRoom = room;
  if (!targetRoom) {
    const topology = await discoverSystem();
    targetRoom = await getSafeTestRoom(topology);
  }
  
  testLog.info('⭐ Loading test favorite...');
  
  // Check for TEST_FAVORITE environment variable
  const testFavorite = process.env.TEST_FAVORITE;
  if (testFavorite) {
    testLog.info(`   Using TEST_FAVORITE: "${testFavorite}"`);
    
    // Get all favorites and look for the specified one
    const favoritesResponse = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/favorites/detailed`);
    if (favoritesResponse.ok) {
      const favorites = await favoritesResponse.json();
      const found = favorites.find((f: any) => f.title === testFavorite);
      
      if (found) {
        // Check if it's a queueable URI type
        const queueableTypes = ['x-file-cifs:', 'x-rincon-playlist:', 'x-sonos-spotify:', 'x-sonosapi-stream:'];
        const isQueueable = found.uri && queueableTypes.some(type => found.uri.startsWith(type));
        
        if (isQueueable) {
          testLog.info(`   Found queueable favorite: "${found.title}" (${found.uri.split(':')[0]}:)`);
          
          // Clear queue and add it
          await fetch(`${defaultConfig.apiUrl}/${targetRoom}/clearqueue`);
          
          const response = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/queue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              uri: found.uri,
              metadata: found.metadata || ''
            })
          });
          
          if (response.ok) {
            testLog.info(`   ✅ Favorite queued successfully`);
            
            // Start playing if requested
            if (play) {
              const playResponse = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/play`);
              if (!playResponse.ok) {
                throw new Error(`Failed to start playback: ${playResponse.status}`);
              }
              testLog.info(`   ▶️  Playback started`);
          // Pause for 1 second so you can hear the music
          await new Promise(resolve => setTimeout(resolve, 1000));
            // Pause for 1 second so you can hear the music
            await new Promise(resolve => setTimeout(resolve, 1000));
              // Pause for 1 second so you can hear the music
              await new Promise(resolve => setTimeout(resolve, 1000));
      // Pause for 1 second so you can hear the music
      await new Promise(resolve => setTimeout(resolve, 1000));
    // Pause for 1 second so you can hear the music
    await new Promise(resolve => setTimeout(resolve, 1000));
            }
            return;
          } else {
            const error = await response.text();
            testLog.info(`   ❌ Failed to queue favorite: ${error}`);
          }
        } else {
          const uriType = found.uri?.split(':').slice(0, 2).join(':') || 'no uri';
          testLog.info(`   ⚠️  TEST_FAVORITE "${testFavorite}" found but not queueable`);
          testLog.info(`      URI type: ${uriType}`);
          testLog.info(`      Queueable types: x-file-cifs, x-rincon-playlist, x-sonos-spotify, x-sonosapi-stream`);
          testLog.info(`   Falling back to auto-selection...`);
        }
      } else {
        testLog.info(`   ⚠️  TEST_FAVORITE "${testFavorite}" not found`);
      }
    }
  }
  
  // Get all favorites
  const favoritesResponse = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/favorites/detailed`);
  if (!favoritesResponse.ok) {
    throw new Error('Failed to fetch favorites');
  }
  
  const favorites = await favoritesResponse.json();
  if (!Array.isArray(favorites) || favorites.length === 0) {
    throw new Error('No favorites available');
  }
  
  // Priority order for URI types
  const uriPriority = [
    'x-file-cifs:',
    'x-rincon-playlist:',
    'x-sonos-spotify:',
    'x-sonosapi-stream:'
  ];
  
  // Find best favorite by URI type priority
  let selectedFavorite = null;
  for (const uriPrefix of uriPriority) {
    const found = favorites.find(fav => fav.uri && fav.uri.startsWith(uriPrefix));
    if (found) {
      selectedFavorite = found;
      break;
    }
  }
  
  if (!selectedFavorite) {
    throw new Error('No queueable favorites found (need x-file-cifs, x-rincon-playlist, x-sonos-spotify, or x-sonosapi-stream)');
  }
  
  testLog.info(`   Selected: "${selectedFavorite.title}" (${selectedFavorite.uri.split(':')[0]}:)`);
  
  // Clear queue first
  await fetch(`${defaultConfig.apiUrl}/${targetRoom}/clearqueue`);
  
  // Queue the favorite
  const response = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      uri: selectedFavorite.uri,
      metadata: selectedFavorite.metadata || ''
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to queue favorite: ${error}`);
  }
  
  testLog.info(`   ✅ Favorite queued successfully`);
  
  // Start playing if requested
  if (play) {
    const playResponse = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/play`);
    if (!playResponse.ok) {
      throw new Error(`Failed to start playback: ${playResponse.status}`);
    }
    testLog.info(`   ▶️  Playback started`);
    // Pause for 1 second so you can hear the music
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * Load a test playlist into the queue.
 * Looks for network playlists (x-file-cifs) or local playlists (x-rincon-playlist).
 * 
 * @param room - The room name to load content for (defaults to safe test room)
 * @param play - Whether to start playing after loading (default: false)
 * @returns Promise that resolves when test playlist is queued (and optionally playing)
 * @throws Error if unable to queue test content
 */
export async function loadTestPlaylist(room?: string, play: boolean = false): Promise<void> {
  // Use provided room or get the default test room
  let targetRoom = room;
  if (!targetRoom) {
    const topology = await discoverSystem();
    targetRoom = await getSafeTestRoom(topology);
  }
  
  testLog.info('📋 Loading test playlist...');
  
  // Check for TEST_PLAYLIST environment variable
  const testPlaylist = process.env.TEST_PLAYLIST;
  if (testPlaylist) {
    testLog.info(`   Using TEST_PLAYLIST: "${testPlaylist}"`);
    
    // First check if it exists in playlists
    const playlistsResponse = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/playlists/detailed`);
    if (playlistsResponse.ok) {
      const playlists = await playlistsResponse.json();
      const found = playlists.find((p: any) => p.title === testPlaylist);
      
      if (found) {
        testLog.info(`   Found playlist: "${found.title}"`);
        const response = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/playlist/${encodeURIComponent(found.title)}`);
        if (response.ok) {
          testLog.info(`   ✅ Playlist loaded successfully`);
          return;
        }
      }
    }
    
    // Also check favorites for playlist-like entries
    const favoritesResponse = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/favorites/detailed`);
    if (favoritesResponse.ok) {
      const favorites = await favoritesResponse.json();
      const found = favorites.find((f: any) => 
        f.title === testPlaylist && 
        f.uri && (
          (f.uri.startsWith('x-file-cifs:') && f.uri.includes('.m3u')) ||
          f.uri.startsWith('x-rincon-playlist:')
        )
      );
      
      if (found) {
        testLog.info(`   Found playlist in favorites: "${found.title}"`);
        
        // Clear queue and add it
        await fetch(`${defaultConfig.apiUrl}/${targetRoom}/clearqueue`);
        
        const response = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            uri: found.uri,
            metadata: found.metadata || ''
          })
        });
        
        if (response.ok) {
          testLog.info(`   ✅ Playlist queued successfully`);
          
          // Start playing if requested
          if (play) {
            const playResponse = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/play`);
            if (!playResponse.ok) {
              throw new Error(`Failed to start playback: ${playResponse.status}`);
            }
            testLog.info(`   ▶️  Playback started`);
          // Pause for 1 second so you can hear the music
          await new Promise(resolve => setTimeout(resolve, 1000));
            // Pause for 1 second so you can hear the music
            await new Promise(resolve => setTimeout(resolve, 1000));
      // Pause for 1 second so you can hear the music
      await new Promise(resolve => setTimeout(resolve, 1000));
    // Pause for 1 second so you can hear the music
    await new Promise(resolve => setTimeout(resolve, 1000));
          }
          return;
        }
      }
    }
    
    testLog.info(`   ⚠️  TEST_PLAYLIST "${testPlaylist}" not found, falling back to auto-selection`);
  }
  
  // First try to find a playlist in favorites (many playlists show up there)
  const favoritesResponse = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/favorites/detailed`);
  if (favoritesResponse.ok) {
    const favorites = await favoritesResponse.json();
    
    // Look for playlist-like favorites
    const playlistFavorite = favorites.find(fav => 
      fav.uri && (
        (fav.uri.startsWith('x-file-cifs:') && fav.uri.includes('.m3u')) ||
        fav.uri.startsWith('x-rincon-playlist:')
      )
    );
    
    if (playlistFavorite) {
      testLog.info(`   Found playlist in favorites: "${playlistFavorite.title}"`);
      
      // Clear queue and add it
      await fetch(`${defaultConfig.apiUrl}/${targetRoom}/clearqueue`);
      
      const response = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          uri: playlistFavorite.uri,
          metadata: playlistFavorite.metadata || ''
        })
      });
      
      if (response.ok) {
        testLog.info(`   ✅ Playlist queued successfully`);
        
        // Start playing if requested
        if (play) {
          const playResponse = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/play`);
          if (!playResponse.ok) {
            throw new Error(`Failed to start playback: ${playResponse.status}`);
          }
          testLog.info(`   ▶️  Playback started`);
          // Pause for 1 second so you can hear the music
          await new Promise(resolve => setTimeout(resolve, 1000));
      // Pause for 1 second so you can hear the music
      await new Promise(resolve => setTimeout(resolve, 1000));
    // Pause for 1 second so you can hear the music
    await new Promise(resolve => setTimeout(resolve, 1000));
        }
        return;
      }
    }
  }
  
  // If no playlist found in favorites, try the playlists endpoint
  const playlistsResponse = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/playlists/detailed`);
  if (!playlistsResponse.ok) {
    throw new Error('Failed to fetch playlists');
  }
  
  const playlists = await playlistsResponse.json();
  if (!Array.isArray(playlists) || playlists.length === 0) {
    throw new Error('No playlists available');
  }
  
  // Playlists from this endpoint typically have x-rincon-playlist URIs
  const selectedPlaylist = playlists[0];
  testLog.info(`   Selected playlist: "${selectedPlaylist.title}"`);
  
  // For playlists from /playlists endpoint, we need to use the play endpoint
  // as they might need special handling
  const response = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/playlist/${encodeURIComponent(selectedPlaylist.title)}`);
  
  if (!response.ok) {
    throw new Error(`Failed to load playlist: ${response.status}`);
  }
  
  testLog.info(`   ✅ Playlist loaded successfully`);
}

/**
 * Load a test album into the queue.
 * Uses cached URIs for consistent, reliable test content.
 * 
 * @param room - The room name to load content for (defaults to safe test room)
 * @param play - Whether to start playing after loading (default: false)
 * @returns Promise that resolves when test album is queued (and optionally playing)
 * @throws Error if unable to load test content
 */
export async function loadTestAlbum(room?: string, play: boolean = false): Promise<void> {
  // Use provided room or get the default test room
  let targetRoom = room;
  if (!targetRoom) {
    const topology = await discoverSystem();
    targetRoom = await getSafeTestRoom(topology);
  }
  
  testLog.info('💿 Loading test album...');
  
  // Get cached content URIs (will discover if needed)
  const cache = await getTestContentUris(targetRoom);
  
  if (!cache.albumUri || !cache.albumTitle) {
    throw new Error('Failed to find suitable test album');
  }
  
  // Clear queue first
  await fetch(`${defaultConfig.apiUrl}/${targetRoom}/clearqueue`);
  
  // Load the album using music search (which adds all tracks)
  testLog.info(`   Loading album: "${cache.albumTitle}" by ${cache.albumArtist}`);
  const response = await fetch(
    `${defaultConfig.apiUrl}/${targetRoom}/musicsearch/${cache.service || 'apple'}/album/${encodeURIComponent(cache.albumTitle + ' ' + cache.albumArtist)}?play=${play}`
  );
  
  if (!response.ok) {
    throw new Error(`Failed to add test album to queue: ${response.status}`);
  }
  
  // Verify queue has content
  const queueResponse = await fetch(`${defaultConfig.apiUrl}/${targetRoom}/queue`);
  const queue = await queueResponse.json();
  
  if (queue.length > 0) {
    testLog.info(`   ✅ Loaded ${queue.length} tracks from album "${cache.albumTitle}"`);
    if (play) {
      testLog.info(`   ▶️  Playback started`);
      // Pause for 1 second so you can hear the music
      await new Promise(resolve => setTimeout(resolve, 1000));
    // Pause for 1 second so you can hear the music
    await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } else {
    throw new Error('Album loaded but queue is empty');
  }
}

/**
 * Get the best test favorite, respecting TEST_FAVORITE environment variable.
 * This returns the favorite object without loading it, useful for testing the favorite endpoint.
 * 
 * @param room - The room name to get favorite for
 * @returns Promise that resolves to the favorite object or null
 */
export async function getTestFavorite(room: string): Promise<Favorite | null> {
  testLog.info('⭐ Getting test favorite...');
  
  // Check for TEST_FAVORITE environment variable
  const testFavorite = process.env.TEST_FAVORITE;
  if (testFavorite) {
    testLog.info(`   Using TEST_FAVORITE: "${testFavorite}"`);
    
    // Get all favorites and look for the specified one
    const favoritesResponse = await fetch(`${defaultConfig.apiUrl}/${room}/favorites/detailed`);
    if (favoritesResponse.ok) {
      const favorites = await favoritesResponse.json();
      const found = favorites.find((f: any) => f.title === testFavorite);
      
      if (found) {
        testLog.info(`   ✅ Found favorite: "${found.title}"`);
        return found;
      } else {
        testLog.info(`   ⚠️  TEST_FAVORITE "${testFavorite}" not found, falling back to auto-selection`);
      }
    }
  }
  
  // Fall back to auto-selection
  return await getBestTestFavorite(room);
}