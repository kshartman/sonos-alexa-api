#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

API_URL="http://localhost:5005"

echo -e "${BLUE}Testing Sonos API Minimal${NC}"
echo "================================"

# Wait for server to be ready
echo -e "\n${YELLOW}Checking server health...${NC}"
if ! curl -s ${API_URL}/health > /dev/null; then
    echo -e "${YELLOW}Server not running. Start it with: npm start${NC}"
    exit 1
fi

# Test health endpoint
echo -e "\n${GREEN}1. Testing /health endpoint:${NC}"
curl -s ${API_URL}/health | jq .

# Test zones endpoint
echo -e "\n${GREEN}2. Testing /zones endpoint:${NC}"
curl -s ${API_URL}/zones | jq .

# Test state endpoint
echo -e "\n${GREEN}3. Testing /state endpoint:${NC}"
curl -s ${API_URL}/state | jq .

# Get first room name if available
ROOM=$(curl -s ${API_URL}/state | jq -r '.[0].room // empty')

if [ -n "$ROOM" ]; then
    echo -e "\n${GREEN}Found room: ${ROOM}${NC}"
    
    # Test room state
    echo -e "\n${GREEN}4. Testing /${ROOM}/state endpoint:${NC}"
    curl -s "${API_URL}/${ROOM}/state" | jq .
    
    # Test play/pause
    echo -e "\n${GREEN}5. Testing play/pause commands:${NC}"
    echo "Playing..."
    curl -s "${API_URL}/${ROOM}/play" | jq .
    sleep 2
    echo "Pausing..."
    curl -s "${API_URL}/${ROOM}/pause" | jq .
    
    # Test volume
    echo -e "\n${GREEN}6. Testing volume commands:${NC}"
    echo "Setting volume to 30..."
    curl -s "${API_URL}/${ROOM}/volume/30" | jq .
    echo "Increasing volume by 10..."
    curl -s "${API_URL}/${ROOM}/volume/+10" | jq .
    echo "Decreasing volume by 5..."
    curl -s "${API_URL}/${ROOM}/volume/-5" | jq .
    
    # Test mute
    echo -e "\n${GREEN}7. Testing mute commands:${NC}"
    echo "Muting..."
    curl -s "${API_URL}/${ROOM}/mute" | jq .
    sleep 1
    echo "Unmuting..."
    curl -s "${API_URL}/${ROOM}/unmute" | jq .
else
    echo -e "\n${YELLOW}No Sonos devices found. The API is running but no devices were discovered.${NC}"
    echo -e "${YELLOW}Make sure you're on the same network as your Sonos devices.${NC}"
fi

# Test global commands
echo -e "\n${GREEN}8. Testing global commands:${NC}"
echo "Pause all..."
curl -s ${API_URL}/pauseall | jq .

# Test presets
echo -e "\n${GREEN}9. Testing presets:${NC}"
echo "List all presets:"
curl -s ${API_URL}/presets | jq .

if [ -n "$ROOM" ]; then
    echo "Testing preset playback in $ROOM:"
    curl -s "${API_URL}/${ROOM}/preset/morning_jazz" | jq .
fi

# Test SSE events
echo -e "\n${GREEN}10. Testing Server-Sent Events (5 seconds):${NC}"
echo "Listening for events..."
timeout 5 curl -s -N ${API_URL}/events || true

echo -e "\n${BLUE}Testing complete!${NC}"