#!/usr/bin/env tsx

// Quick script to extract Spotify service info from favorites

async function extractSpotifyInfo() {
  try {
    const response = await fetch('http://localhost:5005/OfficeSpeakers/favorites/detailed');
    const favorites = await response.json();
    
    // Find Spotify favorites
    const spotifyFavorites = favorites.filter((f: any) => 
      f.uri && f.uri.includes('spotify')
    );
    
    console.log(`Found ${spotifyFavorites.length} Spotify favorites\n`);
    
    for (const fav of spotifyFavorites) {
      console.log('Name:', fav.name || 'Unnamed');
      console.log('URI:', fav.uri);
      
      // Extract info from URI
      const uriMatch = fav.uri.match(/sid=(\d+)&.*sn=(\d+)/);
      if (uriMatch) {
        console.log('  SID:', uriMatch[1]);
        console.log('  Serial Number:', uriMatch[2]);
      }
      
      // Extract info from metadata
      if (fav.metadata) {
        const tokenMatch = fav.metadata.match(/SA_RINCON(\d+)_X_#Svc(\d+)-([a-f0-9]+)-Token/);
        if (tokenMatch) {
          console.log('  Service Type:', tokenMatch[1]);
          console.log('  Service ID:', tokenMatch[2]);
          console.log('  Account ID:', tokenMatch[3]);
        }
      }
      console.log('');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

extractSpotifyInfo();