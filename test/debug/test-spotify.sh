#!/bin/bash

# Test script for Spotify integration

API_URL="${1:-http://localhost:5005}"
ROOM="${2:-Office}"

echo "Testing Spotify integration..."
echo "API URL: $API_URL"
echo "Room: $ROOM"
echo ""

# First, check if we can see Spotify in the services list
echo "1. Checking available music services..."
curl -s "$API_URL/services" | jq '.[] | select(.name | test("spotify"; "i")) | {name, sid, id}'
echo ""

# Test playing a popular track by ID
echo "2. Testing play by Spotify track ID..."
# "Blinding Lights" by The Weeknd - very popular track
TRACK_ID="0VjIjW4GlUZAMYd2vXMi3b"
echo "Playing track: spotify:track:$TRACK_ID"
curl -s "$API_URL/$ROOM/spotify/play/$TRACK_ID" | jq .
echo ""

# Test playing by full Spotify URI
echo "3. Testing play by Spotify URI..."
# "Shape of You" by Ed Sheeran
SPOTIFY_URI="spotify:track:7qiZfU4dY1lWllzX7mPBI3"
echo "Playing URI: $SPOTIFY_URI"
ENCODED_URI=$(echo -n "$SPOTIFY_URI" | jq -sRr @uri)
curl -s "$API_URL/$ROOM/spotify/play/$ENCODED_URI" | jq .
echo ""

# Test playing a playlist
echo "4. Testing play Spotify playlist..."
# Today's Top Hits playlist
PLAYLIST_ID="37i9dQZF1DXcBWIGoYBM5M"
echo "Playing playlist: spotify:playlist:$PLAYLIST_ID"
curl -s "$API_URL/$ROOM/spotify/play/spotify:playlist:$PLAYLIST_ID" | jq .
echo ""

# Test playing artist radio
echo "5. Testing play artist radio..."
# Taylor Swift artist radio
ARTIST_ID="06HL4z0CvFAxyc27GXpf02"
echo "Playing artist radio: spotify:artist:$ARTIST_ID"
curl -s "$API_URL/$ROOM/spotify/play/spotify:artist:$ARTIST_ID" | jq .
echo ""

# Test search (this will likely fail in Phase 1 without auth)
echo "6. Testing Spotify search (expected to fail without auth)..."
curl -s "$API_URL/$ROOM/musicsearch/spotify/song/yesterday" | jq .
echo ""

echo "Done! Check your Sonos to see if music is playing."