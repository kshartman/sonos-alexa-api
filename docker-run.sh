#!/bin/bash
set -e

# Parse arguments
CONTAINER_NAME="sonosd"
RESTART=false

for arg in "$@"; do
    if [[ "$arg" == "--restart" ]]; then
        RESTART=true
    else
        # First non-flag argument is container name
        if [[ "$arg" != -* ]]; then
            CONTAINER_NAME="$arg"
        fi
    fi
done

echo "Running Sonos Alexa API container: $CONTAINER_NAME"

# Check for .env file
if [ -f .env ]; then
    echo "Using environment file: .env"
    # Source it to get PORT for display
    set -a
    source .env
    set +a
else
    echo "No .env file found - using default settings"
fi

# Use PORT from environment or default
PORT="${PORT:-5005}"
echo "Port: $PORT"

# Get version from local package.json if available
if [ -f package.json ]; then
    version=$(node -p "require('./package.json').version" 2>/dev/null || echo "latest")
else
    version="latest"
fi
echo "Version: $version"

# Export for docker-compose
export VERSION=$version

# Check if either the custom name or compose default name exists
check_container() {
    local name=$1
    if docker ps --format '{{.Names}}' | grep -q "^${name}$"; then
        echo "running"
    elif docker ps -a --format '{{.Names}}' | grep -q "^${name}$"; then
        echo "stopped"
    else
        echo "none"
    fi
}

# Check both possible container names
CONTAINER_STATUS=$(check_container "${CONTAINER_NAME}")
COMPOSE_STATUS=$(check_container "sonos-alexa-api")

# Handle existing containers
if [ "$CONTAINER_STATUS" = "running" ] || [ "$COMPOSE_STATUS" = "running" ]; then
    EXISTING_NAME="${CONTAINER_NAME}"
    if [ "$COMPOSE_STATUS" = "running" ]; then
        EXISTING_NAME="sonos-alexa-api"
    fi
    
    echo ""
    echo "Container '${EXISTING_NAME}' is already running."
    
    if [ "$RESTART" = true ]; then
        echo "Restarting container..."
        docker stop "${EXISTING_NAME}"
        docker rm "${EXISTING_NAME}" 2>/dev/null || true
        echo ""
    else
        echo "To restart it, run:"
        echo "  ./run-docker.sh ${CONTAINER_NAME} --restart"
        exit 1
    fi
fi

# Clean up any stopped containers
if [ "$CONTAINER_STATUS" = "stopped" ]; then
    echo "Removing stopped container '${CONTAINER_NAME}'..."
    docker rm "${CONTAINER_NAME}"
fi
if [ "$COMPOSE_STATUS" = "stopped" ]; then
    echo "Removing stopped container 'sonos-alexa-api'..."
    docker rm "sonos-alexa-api"
fi

# Run the container
echo ""
echo "Starting container..."

# Determine if we're using docker-compose or direct docker run
if [ -f docker-compose.yml ]; then
    # Use docker-compose if available
    if docker compose version &>/dev/null 2>&1; then
        echo "Using: docker compose"
        docker compose up -d
        COMPOSE_CONTAINER="sonos-alexa-api"
    elif command -v docker-compose &>/dev/null; then
        echo "Using: docker-compose"
        docker-compose up -d
        COMPOSE_CONTAINER="sonos-alexa-api"
    else
        echo "Error: docker-compose.yml exists but neither 'docker compose' nor 'docker-compose' found"
        exit 1
    fi
    
    # If using a custom container name, rename it
    if [ "${CONTAINER_NAME}" != "sonos-api" ] && [ "${CONTAINER_NAME}" != "sonos-alexa-api" ]; then
        echo "Renaming container to: ${CONTAINER_NAME}"
        docker rename "${COMPOSE_CONTAINER}" "${CONTAINER_NAME}" 2>/dev/null || true
    fi
else
    # Direct docker run
    echo "Using: docker run"
    
    # Build docker run command
    DOCKER_CMD="docker run -d --name ${CONTAINER_NAME} --network host"
    
    # Add env file if it exists
    if [ -f .env ]; then
        DOCKER_CMD="${DOCKER_CMD} --env-file .env"
    fi
    
    # Add volume mounts if paths exist
    if [ -n "${HOST_PRESET_PATH}" ] && [ -d "${HOST_PRESET_PATH}" ]; then
        DOCKER_CMD="${DOCKER_CMD} -v ${HOST_PRESET_PATH}:/app/presets:ro"
    fi
    
    # Add data volume mount if path exists
    if [ -n "${HOST_DATA_PATH}" ] && [ -d "${HOST_DATA_PATH}" ]; then
        DOCKER_CMD="${DOCKER_CMD} -v ${HOST_DATA_PATH}:/app/data"
    fi
    
    # Use the image
    DOCKER_CMD="${DOCKER_CMD} kshartman/sonos-alexa-api:${version}"
    
    echo "Running: ${DOCKER_CMD}"
    eval "${DOCKER_CMD}"
fi

# Wait a moment for container to start
sleep 2

# Check if container is running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo ""
    echo "Container started successfully!"
    echo ""
    echo "Sonos Alexa API is running on port ${PORT}"
    echo ""
    echo "To view logs:"
    echo "  docker logs -f ${CONTAINER_NAME}"
    echo ""
    echo "To stop:"
    echo "  docker stop ${CONTAINER_NAME}"
    echo ""
    echo "To check health:"
    echo "  curl http://localhost:${PORT}/health"
else
    echo ""
    echo "Error: Container failed to start"
    echo "Check logs with: docker logs ${CONTAINER_NAME}"
    exit 1
fi