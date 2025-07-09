#!/bin/bash
#
# analyze-content.sh - Generate Sonos content analysis reports for a specific home
#
# Usage: ./analyze-content.sh [home-name] [api-url] [room-name]
#
# Arguments:
#   home-name  - Name of the home/location (default: hostname without domain)
#   api-url    - Sonos API URL (default: http://localhost:5005)
#   room-name  - Room to use for queries (default: first room found)
#

set -e

# Check for help flag
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "analyze-content.sh - Generate Sonos content analysis reports for a specific home"
    echo ""
    echo "Usage: $0 [home-name] [api-url] [room-name]"
    echo "       $0 --help"
    echo ""
    echo "Arguments:"
    echo "  home-name   Name of the home/location (default: hostname without domain)"
    echo "  api-url     Sonos API URL (default: http://localhost:5005)"
    echo "  room-name   Room to use for queries (default: first room found)"
    echo ""
    echo "Options:"
    echo "  -h, --help  Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                           # Use defaults (current hostname, localhost:5005)"
    echo "  $0 office                    # Analyze 'office' home on localhost"
    echo "  $0 home http://192.168.1.100:5005"
    echo "  $0 cabin http://cabin.local:5005 LivingRoom"
    echo ""
    echo "Output:"
    echo "  Creates analysis reports in homes/<home-name>/ directory:"
    echo "  - content-analysis.md          # Favorites and presets breakdown"
    echo "  - preset-validation-results.md # Preset validation status"
    echo "  - music-library-analysis.md    # Library statistics"
    echo "  - music-library.json           # Optimized JSON export of tracks"
    echo ""
    echo "Description:"
    echo "  This script connects to a Sonos API instance and generates comprehensive"
    echo "  content analysis reports including favorites by service, preset validation,"
    echo "  music library statistics, and track exports. Useful for understanding"
    echo "  what content is available and how it's organized."
    exit 0
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get home name (default to hostname without domain)
HOME_NAME=${1:-$(hostname -s 2>/dev/null || hostname | cut -d. -f1)}
API_URL=${2:-"http://localhost:5005"}

# Ensure we're in the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${GREEN}🏠 Sonos Content Analyzer${NC}"
echo "═══════════════════════════════════════"
echo "Home: $HOME_NAME"
echo "API: $API_URL"

# Create output directory
OUTPUT_DIR="homes/$HOME_NAME"
mkdir -p "$OUTPUT_DIR"

# Get room name if not provided
if [ -z "$3" ]; then
    echo -e "\n${YELLOW}Discovering rooms...${NC}"
    # Try to get zones and extract first room name
    ROOM_NAME=$(curl -s "$API_URL/zones" | grep -o '"roomName":"[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ -z "$ROOM_NAME" ]; then
        echo -e "${RED}❌ Error: Could not discover any rooms. Is the API running at $API_URL?${NC}"
        exit 1
    fi
    echo "Using room: $ROOM_NAME"
else
    ROOM_NAME="$3"
fi

echo -e "\n${YELLOW}Generating content analysis...${NC}"

# Check if tsx is available
if command -v tsx &> /dev/null; then
    TSX_CMD="tsx"
elif command -v npx &> /dev/null; then
    TSX_CMD="npx tsx"
else
    echo -e "${RED}❌ Error: tsx not found. Please install it with: npm install -g tsx${NC}"
    exit 1
fi

# Run the TypeScript analyzer
if $TSX_CMD analyze-home-content.ts "$API_URL" "$ROOM_NAME" "$OUTPUT_DIR"; then
    # Extract summary stats for display
    TOTAL_FAVORITES=$(grep -oE "Total favorites.*: [0-9]+" "$OUTPUT_DIR/content-analysis.md" | grep -oE "[0-9]+$" || echo "?")
    TOTAL_PRESETS=$(grep -oE "Total presets.*: [0-9]+" "$OUTPUT_DIR/content-analysis.md" | grep -oE "[0-9]+$" || echo "?")
    VALID_COUNT=$(grep -oE "Valid presets.*: [0-9]+" "$OUTPUT_DIR/preset-validation-results.md" | grep -oE "[0-9]+$" | head -1 || echo "?")
    FAILED_COUNT=$(grep -oE "Failed favorite resolution.*: [0-9]+" "$OUTPUT_DIR/preset-validation-results.md" | grep -oE "[0-9]+$" | head -1 || echo "?")
    
    # Extract music library stats if available
    if [ -f "$OUTPUT_DIR/music-library-analysis.md" ]; then
        TOTAL_TRACKS=$(grep -oE "Total Tracks.*: [0-9,]+" "$OUTPUT_DIR/music-library-analysis.md" | grep -oE "[0-9,]+$" || echo "?")
        TOTAL_ARTISTS=$(grep -oE "Total Artists.*: [0-9,]+" "$OUTPUT_DIR/music-library-analysis.md" | grep -oE "[0-9,]+$" || echo "?")
        TOTAL_ALBUMS=$(grep -oE "Total Albums.*: [0-9,]+" "$OUTPUT_DIR/music-library-analysis.md" | grep -oE "[0-9,]+$" || echo "?")
    fi
    
    echo -e "\n${GREEN}✅ Analysis complete!${NC}"
    echo -e "\nReports saved to: ${GREEN}$OUTPUT_DIR/${NC}"
    echo "  • content-analysis.md - Detailed breakdown of favorites and presets"
    echo "  • preset-validation-results.md - Validation status of all presets"
    echo "  • music-library-analysis.md - Music library statistics and top content"
    if [ -f "$OUTPUT_DIR/music-library.json" ]; then
        if command -v jq &> /dev/null; then
            echo "  • music-library.json - Music library data (pretty-printed)"
        else
            echo "  • music-library.json - Music library data (install jq for formatting)"
        fi
    fi
    
    echo -e "\n${YELLOW}Summary:${NC}"
    echo -e "  • Favorites: $TOTAL_FAVORITES"
    echo -e "  • Presets: $TOTAL_PRESETS"
    echo -e "  • Valid presets: $VALID_COUNT" 
    echo -e "  • Failed presets: $FAILED_COUNT"
    
    if [ -f "$OUTPUT_DIR/music-library-analysis.md" ]; then
        echo -e "\n${YELLOW}Music Library:${NC}"
        echo -e "  • Tracks: $TOTAL_TRACKS"
        echo -e "  • Artists: $TOTAL_ARTISTS"
        echo -e "  • Albums: $TOTAL_ALBUMS"
    fi
else
    echo -e "${RED}❌ Error generating reports${NC}"
    exit 1
fi

echo -e "\n${GREEN}Done! 🎵${NC}"