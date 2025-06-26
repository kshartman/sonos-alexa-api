#!/bin/bash
set -e

if (( $# >= 1 )); then
   BUILDFOR=$1
else
    BUILDFOR=$(echo "${HOSTNAME%%.*}" | tr '[:upper:]' '[:lower:]')
fi

echo "Building Sonos Alexa API for: $BUILDFOR"

# Copy configuration if it exists
if [ -f ../private/settings-${BUILDFOR}.json ]; then
    echo "Copying config for $BUILDFOR..."
    cp ../private/settings-${BUILDFOR}.json settings.json
else echo "Warning: No config found at ../private/settings-${BUILDFOR}.json"
    echo "Using default settings.json"
fi

# Copy presets if they exist
if [ -d ../presets/presets-${BUILDFOR} ]; then
    echo "Copying presets for $BUILDFOR..."
    # Remove existing presets
    if [ -L ./presets ]; then
        rm ./presets 
    elif [ -d ./presets ]; then
        rm -rf ./presets
    elif [ -f ./presets ]; then
        rm ./presets
    fi
    
    # Create presets directory and copy files
    mkdir ./presets
    (cd ../presets/presets-${BUILDFOR} && tar cf - .) | (cd ./presets && tar xf -)
    echo "Copied $(ls presets/*.json 2>/dev/null | wc -l) preset files"
else
    echo "Warning: No presets found at ../presets/presets-${BUILDFOR}"
    echo "Using default presets"
fi

# Get version
version=$(npm run version:simple --silent 2>/dev/null || echo "1.0.0")
echo "Version: $version"

# Extract port from settings.json if it exists
if [ -f settings.json ]; then
    port=$(node -p "try { require('./settings.json').port || 5005 } catch(e) { 5005 }" 2>/dev/null || echo "5005")
else
    port=5005
fi
echo "Port: $port"

# Build Docker image
IMAGE=sonos-alexa-api
echo "Building Docker image: $IMAGE:latest"

# Export as environment variables for docker-compose
export VERSION=$version
export PORT=$port

# Check which docker compose command is available
if docker compose version &>/dev/null 2>&1; then
    echo "Using: docker compose"
    PORT=$port VERSION=$version docker compose build
elif command -v docker-compose &>/dev/null; then
    echo "Using: docker-compose"
    PORT=$port VERSION=$version docker-compose build
else
    echo "Error: Neither 'docker compose' nor 'docker-compose' found"
    exit 1
fi

# Tag with version
docker tag $IMAGE:latest $IMAGE:$version
echo "Tagged: $IMAGE:$version"

echo ""
echo "Build complete!"
echo "To run:"
echo "  PORT=$port docker-compose up -d"
echo "Or:"
echo "  docker run -d --name sonosd --network host -e PORT=$port $IMAGE:latest"
