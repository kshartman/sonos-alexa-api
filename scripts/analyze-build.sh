#!/bin/bash
#
# analyze-build.sh - Analyze build information from a running Sonos API instance
#
# Usage: ./analyze-build.sh <host> <port>
# Example: ./analyze-build.sh localhost 5005

# Colors for output - use tput for better compatibility
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    # Terminal supports colors
    GREEN=$(tput setaf 2)
    YELLOW=$(tput setaf 3)
    RED=$(tput setaf 1)
    BLUE=$(tput setaf 4)
    CYAN=$(tput setaf 6)
    NC=$(tput sgr0) # No Color
    GIT_COLOR_FLAG="-c color.ui=always"
else
    # No color support - we're in a pipe
    GREEN=''
    YELLOW=''
    RED=''
    BLUE=''
    CYAN=''
    NC=''
    GIT_COLOR_FLAG="-c color.ui=never"
fi

# Check for help flag
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "analyze-build.sh - Analyze build information from a running Sonos API instance"
    echo ""
    echo "Usage: $0 <host> <port>"
    echo "       $0 --help"
    echo ""
    echo "Arguments:"
    echo "  host    The hostname or IP address of the Sonos API server"
    echo "  port    The port number of the Sonos API server"
    echo ""
    echo "Options:"
    echo "  -h, --help    Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 localhost 5005"
    echo "  $0 192.168.1.100 5005"
    echo "  $0 talon 35005"
    echo ""
    echo "Description:"
    echo "  This script queries a running Sonos API instance to retrieve build"
    echo "  information including version, build date, environment settings,"
    echo "  and attempts to correlate the build with git commit history."
    exit 0
fi

# Check arguments
if [ $# -ne 2 ]; then
    echo "Usage: $0 <host> <port>"
    echo "Example: $0 localhost 5005"
    echo "Try '$0 --help' for more information."
    exit 1
fi

HOST=$1
PORT=$2

echo -e "${BLUE}=== Analyzing build on ${HOST}:${PORT} ===${NC}\n"

# Fetch startup config
STARTUP_DATA=$(curl -s http://${HOST}:${PORT}/debug/startup/config 2>/dev/null)

if [ -z "$STARTUP_DATA" ]; then
    echo -e "${RED}Error: Unable to connect to ${HOST}:${PORT}${NC}"
    exit 1
fi

# Extract interesting fields
BUILD_DATE=$(echo "$STARTUP_DATA" | jq -r '.buildDate // "unknown"')
VERSION=$(echo "$STARTUP_DATA" | jq -r '.version // "unknown"')
NODE_ENV=$(echo "$STARTUP_DATA" | jq -r '.nodeEnv // "unknown"')
IS_PRODUCTION=$(echo "$STARTUP_DATA" | jq -r '.isProduction // false')
LOGGER=$(echo "$STARTUP_DATA" | jq -r '.loggerType // .logger // "unknown"')
AUTH_ENABLED=$(echo "$STARTUP_DATA" | jq -r '.auth.username // empty' | grep -q . && echo "Yes" || echo "No")

# Get runtime info from /debug/startup
RUNTIME_DATA=$(curl -s http://${HOST}:${PORT}/debug/startup 2>/dev/null)
UPTIME=$(echo "$RUNTIME_DATA" | jq -r '.system.uptime // 0' 2>/dev/null)
DEVICE_COUNT=$(echo "$RUNTIME_DATA" | jq -r '.discovery.deviceCount // 0' 2>/dev/null)

# Convert uptime to human readable
if [ "$UPTIME" != "0" ]; then
    UPTIME_HUMAN=$(printf '%dd %dh %dm %ds' $((UPTIME/86400)) $((UPTIME%86400/3600)) $((UPTIME%3600/60)) $((UPTIME%60)))
else
    UPTIME_HUMAN="unknown"
fi

# Display server info
echo -e "${GREEN}Server Information:${NC}"
echo -e "  Host:          ${CYAN}${HOST}:${PORT}${NC}"
echo -e "  Version:       ${CYAN}${VERSION}${NC}"
echo -e "  Build Date:    ${CYAN}${BUILD_DATE}${NC}"
echo -e "  Environment:   ${CYAN}${NODE_ENV}${NC}"
echo -e "  Production:    ${CYAN}${IS_PRODUCTION}${NC}"
echo -e "  Logger:        ${CYAN}${LOGGER}${NC}"
echo -e "  Auth Enabled:  ${CYAN}${AUTH_ENABLED}${NC}"
echo -e "  Uptime:        ${CYAN}${UPTIME_HUMAN}${NC}"
echo -e "  Devices:       ${CYAN}${DEVICE_COUNT}${NC}"

# If build date is not "unknown", try to find the corresponding commit
if [ "$BUILD_DATE" != "unknown" ] && [ "$BUILD_DATE" != "null" ]; then
    echo -e "\n${GREEN}Git Commit Information:${NC}"
    
    # Convert ISO date to a format git understands
    # Handle the case where BUILD_DATE might be current time (non-container)
    SEARCH_DATE=$(echo "$BUILD_DATE" | cut -d'T' -f1)
    
    # Find commits around that date
    echo -e "\n${YELLOW}Searching for commits near ${SEARCH_DATE}...${NC}"
    
    # Get the exact commit by matching the date
    COMMIT=$(git log --format="%H %cd" --date=iso-strict | grep "$BUILD_DATE" | head -1 | awk '{print $1}')
    
    if [ -z "$COMMIT" ]; then
        # If exact match not found, find closest commit
        echo -e "${YELLOW}No exact match found, searching for closest commit...${NC}"
        COMMIT=$(git log --since="${SEARCH_DATE} 00:00:00" --until="${SEARCH_DATE} 23:59:59" --format="%H" -1)
    fi
    
    if [ -n "$COMMIT" ]; then
        echo -e "\n${GREEN}Found commit:${NC}"
        git $GIT_COLOR_FLAG log --format="%C(yellow)%h%C(reset) - %C(green)%cd%C(reset) - %C(bold)%s%C(reset)%n%C(dim)Author: %an <%ae>%C(reset)" --date=iso-strict -n 1 $COMMIT
        
        # Show what changed in this commit
        echo -e "\n${GREEN}Files changed:${NC}"
        git $GIT_COLOR_FLAG show --stat --format="" $COMMIT | head -20
        
        # Show recent commits around this one
        echo -e "\n${GREEN}Context (5 commits before and after):${NC}"
        git $GIT_COLOR_FLAG log --oneline --graph -10 $COMMIT | grep --color=never -C5 $COMMIT || git $GIT_COLOR_FLAG log --oneline --graph -10 $COMMIT
    else
        echo -e "${YELLOW}No commits found for date ${SEARCH_DATE}${NC}"
        echo -e "\n${GREEN}Most recent commits:${NC}"
        git $GIT_COLOR_FLAG log --oneline --graph -5
    fi
else
    echo -e "\n${YELLOW}Build date unavailable - showing recent commits:${NC}"
    git $GIT_COLOR_FLAG log --oneline --graph -5
fi

# Check if this might be a container or local build
echo -e "\n${GREEN}Build Type Analysis:${NC}"
if echo "$BUILD_DATE" | grep -q "T.*Z$"; then
    if [ "$IS_PRODUCTION" = "true" ] && [ "$LOGGER" = "pino" ]; then
        echo -e "  ${CYAN}✓ Appears to be a production container build${NC}"
    else
        echo -e "  ${CYAN}✓ Appears to be a container build${NC}"
    fi
else
    # Check if build date equals current time (within a reasonable window)
    CURRENT_TIME=$(date -u +%s)
    BUILD_TIME=$(date -d "$BUILD_DATE" +%s 2>/dev/null || echo "0")
    TIME_DIFF=$((CURRENT_TIME - BUILD_TIME))
    
    if [ "$TIME_DIFF" -lt "$UPTIME" ] 2>/dev/null; then
        echo -e "  ${YELLOW}⚠ Appears to be a non-container build (build date = start time)${NC}"
    else
        echo -e "  ${CYAN}✓ Build date suggests a container build${NC}"
    fi
fi