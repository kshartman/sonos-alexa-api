#!/bin/bash
#
# server-summary.sh - Compact summary of Sonos API server status
#
# Usage: ./server-summary.sh <host> <port> [--json]
# Example: ./server-summary.sh localhost 5005
#          ./server-summary.sh localhost 5005 --json

# Colors for output
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    GREEN=$(tput setaf 2)
    YELLOW=$(tput setaf 3)
    RED=$(tput setaf 1)
    BLUE=$(tput setaf 4)
    CYAN=$(tput setaf 6)
    NC=$(tput sgr0)
else
    GREEN=''
    YELLOW=''
    RED=''
    BLUE=''
    CYAN=''
    NC=''
fi

# Check arguments
if [ $# -lt 2 ] || [ $# -gt 3 ]; then
    echo "Usage: $0 <host> <port> [--json]"
    echo "Example: $0 localhost 5005"
    echo "         $0 localhost 5005 --json"
    exit 1
fi

HOST=$1
PORT=$2
JSON_OUTPUT=false

# Check for --json flag
if [ $# -eq 3 ] && [ "$3" = "--json" ]; then
    JSON_OUTPUT=true
fi

# Fetch startup data
STARTUP_DATA=$(curl -s http://${HOST}:${PORT}/debug/startup 2>/dev/null)

if [ -z "$STARTUP_DATA" ]; then
    if [ "$JSON_OUTPUT" = true ]; then
        # Output error as JSON
        jq -n --arg host "$HOST" --arg port "$PORT" '{
            "error": "Unable to connect to server",
            "server": {
                "host": $host,
                "port": $port | tonumber
            }
        }'
    else
        echo -e "${RED}Error: Unable to connect to ${HOST}:${PORT}${NC}"
    fi
    exit 1
fi

# Function to convert UTC timestamp to local timezone format without timezone suffix
convert_to_local() {
    local utc_time=$1
    if [ "$utc_time" != "unknown" ] && [ "$utc_time" != "null" ] && [ "$utc_time" != "never" ]; then
        # Convert UTC to local time without timezone suffix, with space instead of T
        date -d "$utc_time" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || \
        date -j -f "%Y-%m-%dT%H:%M:%S" "${utc_time%%.*}" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || \
        echo "$utc_time"
    else
        echo "$utc_time"
    fi
}

# Extract basic info
VERSION=$(echo "$STARTUP_DATA" | jq -r '.version // "unknown"')
TIMESTAMP_UTC=$(echo "$STARTUP_DATA" | jq -r '.timestamp // "unknown"')
BUILD_DATE_RAW=$(echo "$STARTUP_DATA" | jq -r '.config.buildDate // "unknown"')
# Convert build date to local time like other timestamps
BUILD_DATE=$(convert_to_local "$BUILD_DATE_RAW")
ENV=$(echo "$STARTUP_DATA" | jq -r '.config.nodeEnv // "unknown"')
LOGGER=$(echo "$STARTUP_DATA" | jq -r '.actualLoggerType // "unknown"')

# Convert timestamp to local
TIMESTAMP=$(convert_to_local "$TIMESTAMP_UTC")

# Calculate uptime from original UTC timestamp
if [ "$TIMESTAMP_UTC" != "unknown" ] && [ "$TIMESTAMP_UTC" != "null" ]; then
    # Use UTC time for both timestamps to ensure correct calculation
    START_EPOCH=$(date -u -d "$TIMESTAMP_UTC" +%s 2>/dev/null || date -u -j -f "%Y-%m-%dT%H:%M:%S" "${TIMESTAMP_UTC%%.*}" +%s 2>/dev/null || echo 0)
    CURRENT_EPOCH=$(date -u +%s)
    UPTIME_SECONDS=$((CURRENT_EPOCH - START_EPOCH))
    
    # Handle negative uptime (server started in the future)
    if [ $UPTIME_SECONDS -lt 0 ]; then
        UPTIME_SECONDS=$((-UPTIME_SECONDS))
        UPTIME=$(printf '-%dd %dh %dm' $((UPTIME_SECONDS/86400)) $((UPTIME_SECONDS%86400/3600)) $((UPTIME_SECONDS%3600/60)))
    else
        UPTIME=$(printf '%dd %dh %dm' $((UPTIME_SECONDS/86400)) $((UPTIME_SECONDS%86400/3600)) $((UPTIME_SECONDS%3600/60)))
    fi
    UPTIME_READABLE="$UPTIME"
else
    UPTIME_SECONDS=0
    UPTIME_READABLE="unknown"
fi

# Collect all data for potential JSON output
DEVICES=$(echo "$STARTUP_DATA" | jq -r '.devices.count // 0')
ZONES=$(echo "$STARTUP_DATA" | jq -r '.topology.zoneCount // 0')
PRESET_VALID=$(echo "$STARTUP_DATA" | jq -r '.presets.stats.validPresets // 0')
PRESET_TOTAL=$(echo "$STARTUP_DATA" | jq -r '.presets.stats.totalFiles // 0')
MUSIC_TRACKS=$(echo "$STARTUP_DATA" | jq -r '.musicLibrary.metadata.totalTracks // 0')
MUSIC_ALBUMS=$(echo "$STARTUP_DATA" | jq -r '.musicLibrary.metadata.totalAlbums // 0')
MUSIC_ARTISTS=$(echo "$STARTUP_DATA" | jq -r '.musicLibrary.metadata.totalArtists // 0')
SERVICES=$(echo "$STARTUP_DATA" | jq -r '.services.serviceCount // 0')
PANDORA_STATIONS=$(echo "$STARTUP_DATA" | jq -r '.pandoraStations.total // 0')

# Readiness data
READINESS=$(echo "$STARTUP_DATA" | jq -r '.readiness')
READINESS_TIMES=$(echo "$STARTUP_DATA" | jq -r '.readinessTimes')

# Recent updates with proper timestamps
PRESET_UPDATE_UTC=$(echo "$STARTUP_DATA" | jq -r '.presets.lastUpdated // "never"')
LIBRARY_UPDATE_UTC=$(echo "$STARTUP_DATA" | jq -r '.musicLibrary.metadata.lastUpdated // "never"')
SERVICES_UPDATE_UTC=$(echo "$STARTUP_DATA" | jq -r '.services.lastRefresh // "never"')
PANDORA_UPDATE_UTC=$(echo "$STARTUP_DATA" | jq -r '.pandoraStations.lastUpdated // "never"')

# Get authentication status
PANDORA_STATUS=$(curl -s http://${HOST}:${PORT}/pandora/status 2>/dev/null)
SPOTIFY_STATUS=$(curl -s http://${HOST}:${PORT}/spotify/status 2>/dev/null)

# Errors
ERRORS=$(echo "$STARTUP_DATA" | jq -r '.errors // []')

# If JSON output requested, generate and output JSON
if [ "$JSON_OUTPUT" = true ]; then
    # Build JSON object
    JSON_RESULT=$(jq -n \
        --arg host "$HOST" \
        --arg port "$PORT" \
        --arg version "$VERSION" \
        --arg environment "$ENV" \
        --arg started "$TIMESTAMP_UTC" \
        --arg built "$BUILD_DATE_RAW" \
        --argjson uptimeSeconds "$UPTIME_SECONDS" \
        --argjson entities '{
            "devices": '"$DEVICES"',
            "zones": '"$ZONES"',
            "presets": {
                "valid": '"$PRESET_VALID"',
                "total": '"$PRESET_TOTAL"',
                "awaitingValidation": '"$((PRESET_VALID == 0 && PRESET_TOTAL > 0))"'
            },
            "musicServices": '"$SERVICES"',
            "musicLibrary": {
                "tracks": '"$MUSIC_TRACKS"',
                "albums": '"$MUSIC_ALBUMS"',
                "artists": '"$MUSIC_ARTISTS"'
            },
            "pandoraStations": '"$PANDORA_STATIONS"'
        }' \
        --argjson readiness "$READINESS" \
        --argjson readinessTimes "$READINESS_TIMES" \
        --arg presetUpdate "$PRESET_UPDATE_UTC" \
        --arg libraryUpdate "$LIBRARY_UPDATE_UTC" \
        --arg servicesUpdate "$SERVICES_UPDATE_UTC" \
        --arg pandoraUpdate "$PANDORA_UPDATE_UTC" \
        --argjson pandoraStatus "${PANDORA_STATUS:-null}" \
        --argjson spotifyStatus "${SPOTIFY_STATUS:-null}" \
        --argjson errors "$ERRORS" \
        '{
            "server": {
                "host": $host,
                "port": $port | tonumber,
                "version": $version,
                "environment": $environment,
                "started": $started,
                "built": $built,
                "uptimeSeconds": $uptimeSeconds
            },
            "entities": $entities,
            "readiness": $readiness,
            "readinessTimes": $readinessTimes,
            "recentUpdates": {
                "presets": $presetUpdate,
                "musicLibrary": $libraryUpdate,
                "services": $servicesUpdate,
                "pandora": $pandoraUpdate
            },
            "authentication": {
                "pandora": $pandoraStatus,
                "spotify": $spotifyStatus
            },
            "errors": $errors
        }')
    
    echo "$JSON_RESULT"
    exit 0
fi

# Otherwise continue with normal text output...

# Header
echo -e "${BLUE}═══ Sonos API Server Summary ═══${NC}"
echo -e "${CYAN}${HOST}:${PORT}${NC} | v${VERSION} | ${ENV} | ${UPTIME_READABLE}"
printf "%-9s %s\n" "Started:" "${TIMESTAMP}"
printf "%-9s %s\n" "Built:" "${BUILD_DATE}"
echo ""

# Entity counts
echo -e "${GREEN}Entities:${NC}"

printf "  %-20s %8d\n" "Devices:" "$DEVICES"
printf "  %-20s %8d\n" "Zones:" "$ZONES"
# Show preset count with validation status
if [ "$PRESET_VALID" -eq 0 ] && [ "$PRESET_TOTAL" -gt 0 ]; then
    printf "  %-20s %8d ${YELLOW}(awaiting validation)${NC}\n" "Presets:" "$PRESET_TOTAL"
else
    printf "  %-20s %8d\n" "Presets:" "$PRESET_VALID"
fi
printf "  %-20s %8d\n" "Music Services:" "$SERVICES"
printf "  %-20s %8d\n" "Music Tracks:" "$MUSIC_TRACKS"
printf "  %-20s %8d\n" "Music Albums:" "$MUSIC_ALBUMS"
printf "  %-20s %8d\n" "Music Artists:" "$MUSIC_ARTISTS"
printf "  %-20s %8d\n" "Pandora Stations:" "$PANDORA_STATIONS"

echo ""

# Readiness status
echo -e "${GREEN}Readiness:${NC}"

# Function to display readiness status
show_readiness() {
    local component=$1
    local display_name=$2
    local ready=$(echo "$READINESS" | jq -r ".$component // false")
    local ready_time=$(echo "$READINESS_TIMES" | jq -r ".$component // null")
    
    if [ "$ready" = "true" ]; then
        if [ "$ready_time" != "null" ]; then
            local local_time=$(convert_to_local "$ready_time")
            printf "  ${GREEN}✓${NC} %-25s${CYAN}%s${NC}\n" "$display_name" "$local_time"
        else
            printf "  ${GREEN}✓${NC} %-25s${GREEN}ready${NC}\n" "$display_name"
        fi
    else
        printf "  ${RED}✗${NC} %-25s${RED}not ready${NC}\n" "$display_name"
    fi
}

show_readiness "discovery" "Discovery"
show_readiness "topology" "Topology"
show_readiness "servicesCache" "Services Cache"
show_readiness "musicLibrary" "Music Library"
show_readiness "upnpSubscriptions" "UPnP Subscriptions"
show_readiness "allReady" "All Systems"

# Recent updates
echo ""
echo -e "${GREEN}Recent Updates:${NC}"
PRESET_UPDATE=$(convert_to_local "$PRESET_UPDATE_UTC")
LIBRARY_UPDATE=$(convert_to_local "$LIBRARY_UPDATE_UTC")
SERVICES_UPDATE=$(convert_to_local "$SERVICES_UPDATE_UTC")
PANDORA_UPDATE=$(convert_to_local "$PANDORA_UPDATE_UTC")

printf "  %-27s${CYAN}%s${NC}\n" "Presets" "$PRESET_UPDATE"
printf "  %-27s${CYAN}%s${NC}\n" "Music Library" "$LIBRARY_UPDATE"
printf "  %-27s${CYAN}%s${NC}\n" "Services" "$SERVICES_UPDATE"
printf "  %-27s${CYAN}%s${NC}\n" "Pandora" "$PANDORA_UPDATE"

# Authentication Status
echo ""
echo -e "${GREEN}Authentication:${NC}"

# Process Pandora status
if [ -n "$PANDORA_STATUS" ]; then
    PANDORA_AUTH=$(echo "$PANDORA_STATUS" | jq -r '.authenticated // false')
    PANDORA_HAS_CREDS=$(echo "$PANDORA_STATUS" | jq -r '.hasCredentials // false')
    PANDORA_AUTH_STATUS=$(echo "$PANDORA_STATUS" | jq -r '.authStatus.success // null')
    PANDORA_STATIONS=$(echo "$PANDORA_STATUS" | jq -r '.stationCount // 0')
    PANDORA_API=$(echo "$PANDORA_STATUS" | jq -r '.apiStations // 0')
    PANDORA_CACHE_AGE=$(echo "$PANDORA_STATUS" | jq -r '.cacheAge // ""')
    
    if [ "$PANDORA_AUTH" = "true" ]; then
        if [ -n "$PANDORA_CACHE_AGE" ] && [ "$PANDORA_API" -gt 0 ]; then
            printf "  %-27s${GREEN}Authenticated${NC} (${PANDORA_STATIONS} stations, ${PANDORA_API} from cache ${PANDORA_CACHE_AGE})\n" "Pandora"
        else
            printf "  %-27s${GREEN}Authenticated${NC} (${PANDORA_STATIONS} stations, ${PANDORA_API} from API)\n" "Pandora"
        fi
    elif [ "$PANDORA_HAS_CREDS" = "true" ] && [ "$PANDORA_AUTH_STATUS" = "false" ]; then
        printf "  %-27s${RED}Auth failed${NC} (${PANDORA_STATIONS} stations, ${PANDORA_API} from cache ${PANDORA_CACHE_AGE})\n" "Pandora"
    elif [ "$PANDORA_HAS_CREDS" = "false" ]; then
        printf "  %-27s${YELLOW}Not configured${NC} (${PANDORA_STATIONS} stations from favorites)\n" "Pandora"
    else
        printf "  %-27s${YELLOW}Not authenticated${NC} (${PANDORA_STATIONS} stations)\n" "Pandora"
    fi
else
    printf "  %-27s${RED}Unable to check${NC}\n" "Pandora"
fi

# Process Spotify status
if [ -n "$SPOTIFY_STATUS" ]; then
    SPOTIFY_AUTH=$(echo "$SPOTIFY_STATUS" | jq -r '.authenticated // false')
    SPOTIFY_HAS_TOKENS=$(echo "$SPOTIFY_STATUS" | jq -r '.hasTokens // false')
    SPOTIFY_TOKEN_EXPIRED=$(echo "$SPOTIFY_STATUS" | jq -r '.tokenExpired // true')
    SPOTIFY_HAS_REFRESH=$(echo "$SPOTIFY_STATUS" | jq -r '.hasRefreshToken // false')
    SPOTIFY_EXPIRES_IN=$(echo "$SPOTIFY_STATUS" | jq -r '.expiresIn // ""')
    SPOTIFY_AUTH_AGE=$(echo "$SPOTIFY_STATUS" | jq -r '.authAge // ""')
    
    if [ "$SPOTIFY_AUTH" = "true" ] && [ -n "$SPOTIFY_EXPIRES_IN" ]; then
        printf "  %-27s${GREEN}Authenticated${NC} (token expires in ${SPOTIFY_EXPIRES_IN})\n" "Spotify"
    elif [ "$SPOTIFY_HAS_TOKENS" = "true" ] && [ "$SPOTIFY_TOKEN_EXPIRED" = "true" ] && [ -n "$SPOTIFY_AUTH_AGE" ]; then
        printf "  %-27s${YELLOW}Token expired${NC} (last auth ${SPOTIFY_AUTH_AGE})\n" "Spotify"
    elif [ "$SPOTIFY_HAS_REFRESH" = "true" ] && [ "$SPOTIFY_HAS_TOKENS" = "false" ]; then
        printf "  %-27s${YELLOW}Has refresh token${NC} (needs initialization)\n" "Spotify"
    else
        printf "  %-27s${RED}Not authenticated${NC}\n" "Spotify"
    fi
else
    printf "  %-27s${RED}Unable to check${NC}\n" "Spotify"
fi

# Errors if any
ERRORS=$(echo "$STARTUP_DATA" | jq -r '.errors | length')
if [ "$ERRORS" -gt 0 ]; then
    echo ""
    echo -e "${RED}Errors:${NC}"
    echo "$STARTUP_DATA" | jq -r '.errors[]' | while read -r error; do
        echo "  - $error"
    done
fi