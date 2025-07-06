import { defaultConfig } from './test-config.js';

export interface Favorite {
  id: string;
  title: string;
  uri: string;
  albumArtUri?: string;
  metadata?: string;
  [key: string]: any;
}

/**
 * Categorize a favorite based on its URI
 */
export function categorizeFavorite(favorite: Favorite): string {
  const uri = favorite.uri.toLowerCase();
  const title = favorite.title.toLowerCase();
  
  // Songs (individual tracks)
  if (uri.includes('track:') || 
      uri.includes('song:') ||
      uri.includes('.mp3') || 
      uri.includes('.m4a') ||
      uri.includes('.flac')) {
    return 'song';
  }
  
  // Albums - but check if it's ambient/nature sounds
  if (uri.includes('album:') || 
      uri.includes('x-rincon-cpcontainer:1004206c')) {
    // Check for nature sounds / ambient albums that might not behave like regular music
    if (title.includes('ocean') || title.includes('wave') || title.includes('rain') || 
        title.includes('nature') || title.includes('ambient') || title.includes('white noise') ||
        title.includes('sleep') || title.includes('meditation') || title.includes('relax')) {
      return 'ambient';  // Lower priority for testing
    }
    return 'album';
  }
  
  // Playlists
  if (uri.includes('playlist:') || 
      uri.includes('x-rincon-cpcontainer:1006206c') ||
      uri.includes('savedqueue')) {
    return 'playlist';
  }
  
  // Sonos Radio stations
  if (uri.includes('x-sonosapi-radio:') ||
      uri.includes('sslibrary://') ||
      uri.includes('x-sonos-http:track')) {
    return 'sonos-radio';
  }
  
  // Pandora stations  
  if (uri.includes('pandora') ||
      uri.includes('pndrradio')) {
    return 'pandora-station';
  }
  
  // Other radio stations
  if (uri.includes('radio') ||
      uri.includes('x-rincon-mp3radio') ||
      uri.includes('x-sonosapi-stream') ||
      uri.includes('tunein') ||
      uri.includes('stream')) {
    return 'other-radio';
  }
  
  // Music service containers (might be albums/playlists)
  if (uri.includes('x-rincon-cpcontainer')) {
    return 'container';
  }
  
  return 'unknown';
}

/**
 * Select the best favorite for testing based on priority:
 * 1. Songs (most predictable)
 * 2. Albums (predictable, multiple tracks)
 * 3. Playlists (predictable, multiple tracks)
 * 4. Sonos Radio (Sonos-curated stations)
 * 5. Pandora stations (if available)
 * 6. Other radio stations (least predictable)
 * 
 * @param favorites Array of favorite objects from /favorites/detailed
 * @returns The best favorite for testing, or null if none found
 */
export function selectBestFavoriteForTesting(favorites: Favorite[]): Favorite | null {
  if (!favorites || favorites.length === 0) {
    return null;
  }
  
  // Categorize all favorites
  const categorized = favorites.map(fav => ({
    favorite: fav,
    category: categorizeFavorite(fav)
  }));
  
  // Priority order for testing
  const priorityOrder = [
    'song',
    'album', 
    'playlist',
    'container', // Might be albums/playlists
    'sonos-radio',
    'pandora-station',
    'other-radio',
    'ambient', // Lowest priority - nature sounds, white noise, etc.
    'unknown'
  ];
  
  // Find first favorite matching priority order
  for (const category of priorityOrder) {
    const match = categorized.find(item => item.category === category);
    if (match) {
      console.log(`   Selected ${category} favorite: ${match.favorite.title}`);
      return match.favorite;
    }
  }
  
  // If no categorized match, return first favorite
  console.log(`   No categorized favorite found, using first: ${favorites[0].title}`);
  return favorites[0];
}

/**
 * Get the best favorite for testing from a room
 * Uses smart algorithm to find favorites from preferred services in priority order
 * @param room The room to get favorites from
 * @returns The best favorite or null
 */
export async function getBestTestFavorite(room: string): Promise<Favorite | null> {
  try {
    console.log('   Finding best test favorite...');
    
    // Check if TEST_FAVORITE is set
    const testFavorite = process.env.TEST_FAVORITE;
    if (testFavorite) {
      console.log(`   ℹ️  TEST_FAVORITE="${testFavorite}" is set but getBestTestFavorite() uses auto-selection`);
      console.log(`      Use loadTestFavorite() to respect TEST_FAVORITE environment variable`);
    }
    
    // Get user's default service
    const defaultService = await getDefaultMusicService();
    console.log(`   Default service: ${defaultService || 'none'}`);
    
    // IMPORTANT: Using /favorites/detailed to get full objects with URI
    const response = await fetch(`${defaultConfig.apiUrl}/${room}/favorites/detailed`);
    if (!response.ok) {
      console.log('   Failed to get favorites');
      return null;
    }
    
    const favorites = await response.json();
    if (!Array.isArray(favorites) || favorites.length === 0) {
      console.log('   No favorites found');
      return null;
    }
    
    return await selectBestFavoriteByServicePriority(favorites, defaultService);
  } catch (error) {
    console.log('   Error getting favorites:', error);
    return null;
  }
}

/**
 * Get user's default music service
 */
async function getDefaultMusicService(): Promise<string | null> {
  try {
    const response = await fetch(`${defaultConfig.apiUrl}/defaults`);
    if (response.ok) {
      const defaults = await response.json();
      return defaults.defaultMusicService || null;
    }
  } catch (error) {
    console.log('   Error getting default service:', error);
  }
  return null;
}

/**
 * Check which services are available on the Sonos system
 */
async function getAvailableServices(): Promise<string[]> {
  const available: string[] = ['library']; // Library is always available
  
  try {
    const response = await fetch(`${defaultConfig.apiUrl}/services`);
    if (response.ok) {
      const servicesData = await response.json();
      
      // Check for Apple Music and Spotify
      for (const serviceId of Object.keys(servicesData)) {
        const service = servicesData[serviceId];
        
        if (service.sid === 52231 || service.name?.toLowerCase().includes('apple')) {
          available.push('apple');
        }
        
        if (service.name?.toLowerCase().includes('spotify')) {
          available.push('spotify');
        }
      }
    }
  } catch (error) {
    console.log('   Error checking available services:', error);
  }
  
  return available;
}

/**
 * Select best favorite by service priority with validation
 * Priority: user's default service > library > apple > spotify
 * Types: album > playlist > song ONLY
 */
async function selectBestFavoriteByServicePriority(favorites: Favorite[], defaultService: string | null): Promise<Favorite | null> {
  if (!favorites || favorites.length === 0) {
    return null;
  }

  // Validate default service
  const blessedServices = ['library', 'apple', 'spotify'];
  if (defaultService && !blessedServices.includes(defaultService)) {
    console.warn(`   ⚠️  Warning: Default service '${defaultService}' is not supported for testing. Supported: ${blessedServices.join(', ')}`);
    defaultService = null; // Ignore unsupported default
  }

  // Get available services on this Sonos system
  const availableServices = await getAvailableServices();
  console.log(`   Available services: ${availableServices.join(', ')}`);

  // Create service priority order (only include available services)
  const servicePriority = [
    defaultService,     // User's default service first (if blessed)
    'library',          // Local library second
    'apple',           // Apple Music third  
    'spotify'          // Spotify fourth
  ].filter(service => service && availableServices.includes(service));

  console.log(`   Service priority: ${servicePriority.join(' > ')}`);

  // Categorize favorites by type and service (ONLY songs, albums, playlists)
  const categorizedFavorites = favorites.map(fav => ({
    favorite: fav,
    category: categorizeFavorite(fav),
    service: detectService(fav.uri)
  })).filter(item => 
    // ONLY include songs, albums, and playlists
    ['song', 'album', 'playlist'].includes(item.category)
  );

  console.log(`   Analyzing ${categorizedFavorites.length} songs/albums/playlists...`);

  // Type priority: album > playlist > song
  const typePriority = ['album', 'playlist', 'song'];

  // Try each service in priority order
  for (const service of servicePriority) {
    console.log(`   Checking ${service} favorites...`);
    
    // Try each type in priority order for this service
    for (const type of typePriority) {
      const match = categorizedFavorites.find(item => 
        item.service === service && item.category === type
      );
      
      if (match) {
        console.log(`   ✅ Selected ${type} from ${service}: "${match.favorite.title}"`);
        return match.favorite;
      }
    }
  }

  // Fallback: try any available service with preferred types
  console.log('   No favorites from preferred services, trying any available service...');
  for (const type of typePriority) {
    const match = categorizedFavorites.find(item => 
      item.category === type && availableServices.includes(item.service)
    );
    if (match) {
      console.log(`   ✅ Fallback selected ${type} from ${match.service}: "${match.favorite.title}"`);
      return match.favorite;
    }
  }

  // No suitable favorites found
  console.log('   ❌ No suitable favorites found (only songs, albums, or playlists from available services)');
  return null;
}

/**
 * Detect music service from URI
 */
function detectService(uri: string): string {
  const uriLower = uri.toLowerCase();
  
  // Library/Local content
  if (uriLower.includes('x-file-cifs') || uriLower.includes('file://') || uriLower.includes('library')) {
    return 'library';
  }
  
  // Apple Music (SID 52231)
  if (uriLower.includes('sid=52231') || uriLower.includes('apple')) {
    return 'apple';
  }
  
  // Spotify
  if (uriLower.includes('spotify') || uriLower.includes('2311')) {
    return 'spotify';
  }
  
  return 'unknown';
}