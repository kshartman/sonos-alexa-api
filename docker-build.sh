#!/usr/bin/env bash
# docker-build.sh - Build Docker image locally for manual publishing

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
VCS_REF=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Image name
IMAGE_NAME="sonos-alexa-api"
DOCKER_USERNAME="kshartman"

echo -e "${GREEN}Building Sonos Alexa API Docker image...${NC}"
echo -e "Version: ${YELLOW}${VERSION}${NC}"
echo -e "Build Date: ${YELLOW}${BUILD_DATE}${NC}"
echo -e "Git Ref: ${YELLOW}${VCS_REF}${NC}"
echo ""

# Build arguments
BUILD_ARGS="--build-arg VERSION=${VERSION}"
BUILD_ARGS="${BUILD_ARGS} --build-arg BUILD_DATE=${BUILD_DATE}"
BUILD_ARGS="${BUILD_ARGS} --build-arg VCS_REF=${VCS_REF}"

# Tags for local and Docker Hub
TAGS="-t ${IMAGE_NAME}:latest"
TAGS="${TAGS} -t ${IMAGE_NAME}:${VERSION}"
TAGS="${TAGS} -t ${DOCKER_USERNAME}/${IMAGE_NAME}:latest"
TAGS="${TAGS} -t ${DOCKER_USERNAME}/${IMAGE_NAME}:${VERSION}"

# Build the image
echo -e "${GREEN}Building image with tags:${NC}"
echo -e "  ${YELLOW}${IMAGE_NAME}:latest${NC}"
echo -e "  ${YELLOW}${IMAGE_NAME}:${VERSION}${NC}"
echo -e "  ${YELLOW}${DOCKER_USERNAME}/${IMAGE_NAME}:latest${NC}"
echo -e "  ${YELLOW}${DOCKER_USERNAME}/${IMAGE_NAME}:${VERSION}${NC}"
echo ""

# Build command
BUILD_CMD="docker build ${BUILD_ARGS} ${TAGS} ."

echo -e "${GREEN}Running build command:${NC}"
echo -e "${YELLOW}${BUILD_CMD}${NC}"
echo ""

# Execute build
eval "${BUILD_CMD}"

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ Build successful!${NC}"
    echo ""
    echo -e "${GREEN}To test locally:${NC}"
    echo -e "${YELLOW}docker run -d --name sonos-api --network host ${IMAGE_NAME}:latest${NC}"
    echo ""
    echo -e "${GREEN}To publish to Docker Hub:${NC}"
    echo -e "${YELLOW}docker login${NC}"
    echo -e "${YELLOW}docker push ${DOCKER_USERNAME}/${IMAGE_NAME}:${VERSION}${NC}"
    echo -e "${YELLOW}docker push ${DOCKER_USERNAME}/${IMAGE_NAME}:latest${NC}"
    echo ""
else
    echo ""
    echo -e "${RED}✗ Build failed!${NC}"
    exit 1
fi