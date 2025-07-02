#!/bin/bash

echo "==================================="
echo "Spotify Playback Test with curl"
echo "==================================="

BASE_URL="http://localhost:5005"
ROOM="OfficeSpeakers"

echo -e "\n1. Testing Track Playback: 'Yesterday' by The Beatles"
echo "Command: curl \"$BASE_URL/$ROOM/spotify/now/track:Yesterday\""
curl "$BASE_URL/$ROOM/spotify/now/track:Yesterday"
echo -e "\n"
sleep 5

echo -e "\n2. Checking current state..."
curl -s "$BASE_URL/$ROOM/state" | jq '.currentTrack'
echo -e "\n"
sleep 5

echo -e "\n3. Testing Album Playback: 'Abbey Road'"
echo "Command: curl \"$BASE_URL/$ROOM/spotify/now/album:Abbey%20Road\""
curl "$BASE_URL/$ROOM/spotify/now/album:Abbey%20Road"
echo -e "\n"
sleep 5

echo -e "\n4. Checking current state..."
curl -s "$BASE_URL/$ROOM/state" | jq '.currentTrack'
echo -e "\n"
sleep 5

echo -e "\n5. Testing Playlist Playback: 'This Is The Beatles'"
echo "Command: curl \"$BASE_URL/$ROOM/spotify/now/playlist:This%20Is%20The%20Beatles\""
curl "$BASE_URL/$ROOM/spotify/now/playlist:This%20Is%20The%20Beatles"
echo -e "\n"
sleep 5

echo -e "\n6. Final state check..."
curl -s "$BASE_URL/$ROOM/state" | jq '.currentTrack'

echo -e "\n==================================="
echo "Test completed!"
echo "==================================="