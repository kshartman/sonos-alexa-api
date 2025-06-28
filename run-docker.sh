#!/bin/bash
set -e

# Container name - can be overridden with first argument
CONTAINER_NAME="${1:-sonos-api}"

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

# Check for --restart flag
RESTART=false
for arg in "$@"; do
    if [[ "$arg" == "--restart" ]]; then
        RESTART=true
        break
    fi
done

# Check if container is already running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo ""
    echo "Container '${CONTAINER_NAME}' is already running."
    
    if [ "$RESTART" = true ]; then
        echo ""
        read -p "Do you want to restart it? (y/N) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "Restarting container..."
            docker stop "${CONTAINER_NAME}"
            docker rm "${CONTAINER_NAME}" 2>/dev/null || true
            echo ""
        else
            echo "Aborted."
            exit 0
        fi
    else
        echo "To restart it, run:"
        echo "  ./run-docker.sh ${CONTAINER_NAME} --restart"
        echo "  # or"
        echo "  docker stop ${CONTAINER_NAME} && docker rm ${CONTAINER_NAME}"
        echo "  ./run-docker.sh ${CONTAINER_NAME}"
        exit 1
    fi
fi

# Check if container exists but is stopped
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo ""
    echo "Removing stopped container '${CONTAINER_NAME}'..."
    docker rm "${CONTAINER_NAME}"
fi

# Run the container
echo ""
echo "Starting container..."

# Determine if we're using docker-compose or direct docker run
if [ -f docker-compose.yml ]; then
    # Use docker-compose if available
    if docker compose version &>/dev/null 2>&1; then
        echo "Using: docker compose"
        # Override container name in compose
        COMPOSE_PROJECT_NAME="${CONTAINER_NAME}" docker compose up -d
    elif command -v docker-compose &>/dev/null; then
        echo "Using: docker-compose"
        COMPOSE_PROJECT_NAME="${CONTAINER_NAME}" docker-compose up -d
    else
        echo "Error: docker-compose.yml exists but neither 'docker compose' nor 'docker-compose' found"
        exit 1
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
    
    # Add other volumes
    DOCKER_CMD="${DOCKER_CMD} -v $(pwd)/data:/app/data"
    DOCKER_CMD="${DOCKER_CMD} -v $(pwd)/logs:/app/logs"
    
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