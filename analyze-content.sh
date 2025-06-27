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
    echo -e "\n${GREEN}✅ Analysis complete!${NC}"
    echo -e "\nReports saved to: ${GREEN}$OUTPUT_DIR/${NC}"
    echo "  • content-analysis.md - Detailed breakdown of favorites and presets"
    echo "  • preset-validation-results.md - Validation status of all presets"
    
    # Show summary
    echo -e "\n${YELLOW}Summary:${NC}"
    echo -n "  • Favorites: "
    grep -E "^\*\*Total favorites\*\*:" "$OUTPUT_DIR/content-analysis.md" 2>/dev/null | grep -o '[0-9]*' || echo "?"
    echo -n "  • Presets: "
    grep -E "^\*\*Total presets\*\*:" "$OUTPUT_DIR/content-analysis.md" 2>/dev/null | grep -o '[0-9]*' || echo "?"
    echo -n "  • Valid presets: "
    grep -E "^\- \*\*Valid presets\*\*:" "$OUTPUT_DIR/preset-validation-results.md" 2>/dev/null | grep -o '[0-9]*' | head -1 || echo "?"
    echo -n "  • Failed presets: "
    grep -E "^\- \*\*Failed favorite resolution\*\*:" "$OUTPUT_DIR/preset-validation-results.md" 2>/dev/null | grep -o '[0-9]*' | head -1 || echo "?"
else
    echo -e "${RED}❌ Error generating reports${NC}"
    exit 1
fi

echo -e "\n${GREEN}Done! 🎵${NC}"