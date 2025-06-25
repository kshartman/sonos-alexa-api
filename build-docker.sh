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
oldversion=$(cat VERSION 2>/dev/null || echo "")
echo $version > VERSION
echo "Version: $version"

# Build Docker image
IMAGE=sonos-alexa-api
echo "Building Docker image: $IMAGE:latest"

if command -v docker-compose &>/dev/null; then
    docker-compose build
else
    docker compose build
fi

# Tag with version
docker tag $IMAGE:latest $IMAGE:$version
echo "Tagged: $IMAGE:$version"

echo ""
echo "Build complete!"
echo "To run:"
echo "  docker-compose up -d"
echo "Or:"
echo "  docker run -d --name sonos-api --network host $IMAGE:latest"
