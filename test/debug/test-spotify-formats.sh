#!/bin/bash

# Test different Spotify artist radio URI formats

API_URL="http://localhost:5005"
ROOM="OfficeSpeakers"
ARTIST_ID="3WrFJ7ztbogyGnTHbHJFl2"  # The Beatles

echo "🔍 Testing Spotify Artist Radio Formats"
echo ""

# Stop current playback
echo "Stopping playback..."
curl -s "$API_URL/$ROOM/stop" > /dev/null
sleep 1

# Test 1: Direct play with current format
echo "1️⃣  Testing direct play: spotify:artist:$ARTIST_ID"
RESPONSE=$(curl -s "$API_URL/$ROOM/spotify/play/spotify:artist:$ARTIST_ID")
echo "Response: $RESPONSE"
echo ""

# Check if it worked
sleep 2
STATE=$(curl -s "$API_URL/$ROOM/state" | jq -r '.playbackState')
if [ "$STATE" = "PLAYING" ]; then
    TRACK=$(curl -s "$API_URL/$ROOM/state" | jq -r '.currentTrack.title')
    ARTIST=$(curl -s "$API_URL/$ROOM/state" | jq -r '.currentTrack.artist')
    URI=$(curl -s "$API_URL/$ROOM/state" | jq -r '.currentTrack.uri')
    echo "✅ SUCCESS! Playing: $TRACK by $ARTIST"
    echo "   URI: $URI"
else
    echo "❌ Failed - State: $STATE"
fi

echo ""
echo "2️⃣  Testing search: artist 'The Beatles'"
RESPONSE=$(curl -s "$API_URL/$ROOM/musicsearch/spotify/artist/The%20Beatles")
echo "Response: $RESPONSE"

# If you're running the server with debug logging, check the logs:
echo ""
echo "💡 To see detailed SOAP requests/responses:"
echo "   1. Stop the server"
echo "   2. Run: LOG_LEVEL=trace DEBUG_CATEGORIES=soap,api npm start"
echo "   3. Run this script again"
echo ""
echo "📋 Check server logs for:"
echo "   - Generated URI format"
echo "   - Generated metadata"
echo "   - SOAP SetAVTransportURI request/response"