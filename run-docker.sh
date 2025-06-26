#!/bin/bash
set -e

if (( $# >= 1 )); then
   BUILDFOR=$1
else
    BUILDFOR=$(echo "${HOSTNAME%%.*}" | tr '[:upper:]' '[:lower:]')
fi

echo "Running Sonos Alexa API for: $BUILDFOR"

# Determine which settings file to read
if [ -f settings-${BUILDFOR}.json ]; then
    SETTINGS_FILE="settings-${BUILDFOR}.json"
    echo "Using settings file: $SETTINGS_FILE"
elif [ -f settings.json ]; then
    SETTINGS_FILE="settings.json"
    echo "Using settings file: $SETTINGS_FILE"
else
    echo "Warning: No settings file found (settings-${BUILDFOR}.json or settings.json)"
    echo "Using default port 5005"
    port=5005
fi

# Extract port from settings file if it exists
if [ -n "$SETTINGS_FILE" ] && [ -f "$SETTINGS_FILE" ]; then
    port=$(node -p "try { require('./$SETTINGS_FILE').port || 5005 } catch(e) { 5005 }" 2>/dev/null || echo "5005")
else
    port=5005
fi

echo "Port: $port"

# Get version
version=$(npm run version:simple --silent 2>/dev/null || echo "1.0.0")
echo "Version: $version"

# Export as environment variables for docker-compose
export VERSION=$version
export PORT=$port

# Check if container is already running
if docker ps --format '{{.Names}}' | grep -q '^sonosd$'; then
    echo ""
    echo "Container 'sonosd' is already running."
    echo "To restart it, run:"
    echo "  docker stop sonosd && docker rm sonosd"
    echo "  ./run-docker.sh $BUILDFOR"
    exit 1
fi

# Check if container exists but is stopped
if docker ps -a --format '{{.Names}}' | grep -q '^sonosd$'; then
    echo ""
    echo "Removing stopped container 'sonosd'..."
    docker rm sonosd
fi

# Run the container
echo ""
echo "Starting container..."

# Check which docker compose command is available
if docker compose version &>/dev/null 2>&1; then
    echo "Using: docker compose"
    PORT=$port VERSION=$version docker compose up -d
elif command -v docker-compose &>/dev/null; then
    echo "Using: docker-compose"
    PORT=$port VERSION=$version docker-compose up -d
else
    echo "Error: Neither 'docker compose' nor 'docker-compose' found"
    exit 1
fi

# Wait a moment for container to start
sleep 2

# Check if container is running
if docker ps --format '{{.Names}}' | grep -q '^sonosd$'; then
    echo ""
    echo "Container started successfully!"
    echo ""
    echo "Sonos Alexa API is running on port $port"
    echo ""
    echo "To view logs:"
    echo "  docker logs -f sonosd"
    echo ""
    echo "To stop:"
    echo "  docker compose down"
    echo "  # or"
    echo "  docker stop sonosd"
    echo ""
    echo "To check health:"
    echo "  curl http://localhost:$port/health"
else
    echo ""
    echo "Error: Container failed to start"
    echo "Check logs with: docker logs sonosd"
    exit 1
fi