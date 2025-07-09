#!/bin/bash
#
# docker-run-local.sh - Run locally built Docker image
#
# This script stops any existing sonosd container and runs the locally
# built image with environment variables from .env file.
#

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CONTAINER_NAME="sonosd"
IMAGE_NAME="sonos-alexa-api:local"
ENV_FILE=".env"

echo -e "${BLUE}🚀 Running Sonos API Docker Container${NC}"
echo "═══════════════════════════════════════════════"

# Check if image exists
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    echo -e "${RED}❌ Error: Docker image '$IMAGE_NAME' not found!${NC}"
    echo "Please run docker-build-local.sh first."
    exit 1
fi

# Check if env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}❌ Error: Environment file '$ENV_FILE' not found!${NC}"
    echo "Please create a .env file with your configuration."
    exit 1
fi

# Stop existing container if running
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${YELLOW}Stopping existing container '${CONTAINER_NAME}'...${NC}"
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
    echo -e "${GREEN}✅ Existing container removed${NC}"
fi

# Build docker run command
DOCKER_CMD="docker run -d --name $CONTAINER_NAME --network host --env-file $ENV_FILE --restart unless-stopped"

# Add volume mounts if paths exist (read from env file)
if [ -f "$ENV_FILE" ]; then
    # Source env file to get volume paths
    set -a
    source "$ENV_FILE"
    set +a
    
    # Add preset volume if path exists
    if [ -n "${HOST_PRESET_PATH}" ] && [ -d "${HOST_PRESET_PATH}" ]; then
        DOCKER_CMD="${DOCKER_CMD} -v ${HOST_PRESET_PATH}:/app/presets:ro"
        echo -e "${YELLOW}Mounting presets from: ${HOST_PRESET_PATH}${NC}"
    fi
    
    # Add data volume if path exists
    if [ -n "${HOST_DATA_PATH}" ] && [ -d "${HOST_DATA_PATH}" ]; then
        DOCKER_CMD="${DOCKER_CMD} -v ${HOST_DATA_PATH}:/app/data"
        echo -e "${YELLOW}Mounting data from: ${HOST_DATA_PATH}${NC}"
    fi
fi

# Add image name
DOCKER_CMD="${DOCKER_CMD} $IMAGE_NAME"

# Run the new container
echo -e "\n${YELLOW}Starting new container...${NC}"
CONTAINER_ID=$($DOCKER_CMD)

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Container started successfully!${NC}"
    echo -e "Container ID: ${CONTAINER_ID:0:12}"
    echo -e "Container name: ${GREEN}$CONTAINER_NAME${NC}"
    
    # Wait a moment for container to start
    sleep 2
    
    # Check if container is running
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo -e "\n${YELLOW}Container status:${NC}"
        docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
        
        echo -e "\n${YELLOW}Recent logs:${NC}"
        docker logs --tail 10 "$CONTAINER_NAME"
        
        echo -e "\n${GREEN}✅ Sonos API is running!${NC}"
        # Extract PORT from .env file, default to 5005 if not found
        PORT=$(grep "^PORT=" "$ENV_FILE" | cut -d'=' -f2 || echo "5005")
        echo -e "Health check: ${BLUE}curl http://localhost:${PORT}/health${NC}"
    else
        echo -e "\n${RED}❌ Container failed to start!${NC}"
        echo -e "${YELLOW}Checking logs:${NC}"
        docker logs "$CONTAINER_NAME"
        exit 1
    fi
else
    echo -e "\n${RED}❌ Failed to start container!${NC}"
    exit 1
fi