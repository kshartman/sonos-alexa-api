#!/bin/bash
#
# docker-build-local.sh - Build Docker image locally for testing
#
# This script builds the Sonos API Docker image with a local tag
# without pushing to any registry.
#

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🐳 Building Sonos API Docker Image Locally${NC}"
echo "═══════════════════════════════════════════════"

# Ensure we're in the correct directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Pull latest changes
echo -e "\n${YELLOW}Pulling latest changes from git...${NC}"
git pull

# Get last commit date
BUILD_SOURCE_DATE=$(npm run --silent build:date)
echo -e "\n${YELLOW}Source Date: ${BUILD_SOURCE_DATE}${NC}"

# Build the image
echo -e "\n${YELLOW}Building Docker image...${NC}"
docker build --build-arg BUILD_SOURCE_DATE="${BUILD_SOURCE_DATE}" -t sonos-alexa-api:local .

if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}✅ Docker image built successfully!${NC}"
    echo -e "Image tag: ${GREEN}sonos-alexa-api:local${NC}"
    
    # Show image info
    echo -e "\n${YELLOW}Image details:${NC}"
    docker images sonos-alexa-api:local
else
    echo -e "\n${RED}❌ Docker build failed!${NC}"
    exit 1
fi

echo -e "\n${GREEN}Done! Use docker-run-local.sh to run the container.${NC}"