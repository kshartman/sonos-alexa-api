#!/bin/bash

echo "==================================="
echo "Spotify Music Search Test"
echo "==================================="

BASE_URL="http://localhost:5005"
ROOM="OfficeSpeakers"

echo -e "\n1. Testing Song Search: 'Yesterday' by The Beatles"
echo "Command: curl \"$BASE_URL/$ROOM/musicsearch/spotify/song/Yesterday\""
curl "$BASE_URL/$ROOM/musicsearch/spotify/song/Yesterday"
echo -e "\n"
sleep 5

echo -e "\n2. Checking current state..."
curl -s "$BASE_URL/$ROOM/state" | jq '{
  playbackState: .playbackState,
  currentTrack: {
    title: .currentTrack.title,
    artist: .currentTrack.artist,
    album: .currentTrack.album,
    uri: .currentTrack.uri
  }
}'
echo -e "\n"
sleep 5

echo -e "\n3. Testing Album Search: 'Abbey Road'"
echo "Command: curl \"$BASE_URL/$ROOM/musicsearch/spotify/album/Abbey%20Road\""
curl "$BASE_URL/$ROOM/musicsearch/spotify/album/Abbey%20Road"
echo -e "\n"
sleep 5

echo -e "\n4. Checking current state..."
curl -s "$BASE_URL/$ROOM/state" | jq '{
  playbackState: .playbackState,
  currentTrack: {
    title: .currentTrack.title,
    artist: .currentTrack.artist,
    album: .currentTrack.album,
    uri: .currentTrack.uri
  }
}'
echo -e "\n"
sleep 5

echo -e "\n5. Testing Playlist Search: 'This Is The Beatles'"
echo "Command: curl \"$BASE_URL/$ROOM/musicsearch/spotify/station/This%20Is%20The%20Beatles\""
curl "$BASE_URL/$ROOM/musicsearch/spotify/station/This%20Is%20The%20Beatles"
echo -e "\n"
sleep 5

echo -e "\n6. Final state check..."
curl -s "$BASE_URL/$ROOM/state" | jq '{
  playbackState: .playbackState,
  currentTrack: {
    title: .currentTrack.title,
    artist: .currentTrack.artist,
    album: .currentTrack.album,
    uri: .currentTrack.uri
  }
}'

echo -e "\n==================================="
echo "Test completed!"
echo "==================================="