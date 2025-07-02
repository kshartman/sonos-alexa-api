#!/usr/bin/env npx tsx

async function testSpotifyAPI() {
  console.log('Testing Spotify Public API directly...\n');
  
  const searchQuery = 'Yesterday Beatles';
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(searchQuery)}&type=track&limit=5`;
  
  console.log(`URL: ${url}\n`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Headers:`, Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log('\nError response:', errorText);
      
      if (response.status === 401) {
        console.log('\n❌ Spotify API now requires authentication!');
        console.log('The public search API is no longer available without an OAuth token.');
      }
    } else {
      const data = await response.json();
      console.log('\n✅ Success! Found tracks:');
      data.tracks?.items.forEach((track: any, i: number) => {
        console.log(`${i + 1}. ${track.name} by ${track.artists.map((a: any) => a.name).join(', ')}`);
        console.log(`   Album: ${track.album.name}`);
        console.log(`   ID: ${track.id}`);
        console.log(`   URI: ${track.uri}\n`);
      });
    }
  } catch (error) {
    console.error('Failed to fetch:', error);
  }
}

testSpotifyAPI();