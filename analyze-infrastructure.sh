#!/bin/bash
#
# analyze-infrastructure.sh - Generate Sonos infrastructure analysis reports for a specific home
#
# Usage: ./analyze-infrastructure.sh [home-name] [api-url]
#
# Arguments:
#   home-name  - Name of the home/location (default: hostname without domain)
#   api-url    - Sonos API URL (default: http://localhost:5005)
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get home name (default to hostname without domain)
HOME_NAME=${1:-$(hostname -s 2>/dev/null || hostname | cut -d. -f1)}
API_URL=${2:-"http://localhost:5005"}

# Ensure we're in the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${BLUE}🏠 Sonos Infrastructure Analyzer${NC}"
echo "═══════════════════════════════════════"
echo "Home: $HOME_NAME"
echo "API: $API_URL"

# Create output directory
OUTPUT_DIR="homes/$HOME_NAME"
mkdir -p "$OUTPUT_DIR"

# Test API connectivity
echo -e "\n${YELLOW}Testing API connectivity...${NC}"
if ! curl -s -f "$API_URL/health" > /dev/null; then
    echo -e "${RED}❌ Error: Cannot connect to API at $API_URL${NC}"
    echo "Please ensure the Sonos API is running."
    exit 1
fi
echo -e "${GREEN}✅ API is accessible${NC}"

echo -e "\n${YELLOW}Generating infrastructure analysis...${NC}"

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
if $TSX_CMD analyze-home-infrastructure.ts "$API_URL" "$OUTPUT_DIR"; then
    # Extract summary stats for display
    TOTAL_DEVICES=$(grep -oE "Total Devices.*: [0-9]+" "$OUTPUT_DIR/infrastructure-analysis.md" | grep -oE "[0-9]+$" || echo "?")
    TOTAL_ZONES=$(grep -oE "Total Zones.*: [0-9]+" "$OUTPUT_DIR/infrastructure-analysis.md" | grep -oE "[0-9]+$" || echo "?")
    STEREO_PAIRS=$(grep -oE "Stereo Pairs.*: [0-9]+" "$OUTPUT_DIR/infrastructure-analysis.md" | grep -oE "[0-9]+$" | head -1 || echo "0")
    MODELS=$(grep -oE "Device Models.*: [0-9]+" "$OUTPUT_DIR/infrastructure-analysis.md" | grep -oE "[0-9]+$" || echo "?")
    
    echo -e "\n${GREEN}✅ Analysis complete!${NC}"
    echo -e "\nReports saved to: ${GREEN}$OUTPUT_DIR/${NC}"
    echo "  • infrastructure-analysis.md - Detailed system topology and device information"
    echo "  • device-matrix.md - Device capabilities and feature support matrix"
    
    echo -e "\n${YELLOW}Summary:${NC}"
    echo -e "  • Devices: $TOTAL_DEVICES"
    echo -e "  • Zones/Groups: $TOTAL_ZONES"
    echo -e "  • Stereo Pairs: $STEREO_PAIRS"
    echo -e "  • Device Models: $MODELS"
    
    # Show quick device list
    echo -e "\n${YELLOW}Rooms:${NC}"
    grep -E "^### [^Zone]" "$OUTPUT_DIR/infrastructure-analysis.md" | grep -v "Device Models" | grep -v "Subnet" | grep -v "Device Categories" | sed 's/### /  • /' | head -20
    
    # Check for any warnings
    PORTABLE_COUNT=$(grep -oE "Portable Devices.*: [0-9]+" "$OUTPUT_DIR/infrastructure-analysis.md" | grep -oE "[0-9]+$" || echo "0")
    if [ "$PORTABLE_COUNT" -gt 0 ]; then
        echo -e "\n${YELLOW}⚠️  Note: Found $PORTABLE_COUNT portable device(s) (Roam/Move)${NC}"
        echo "   These devices have limited functionality when used as coordinators."
    fi
else
    echo -e "${RED}❌ Error generating reports${NC}"
    exit 1
fi

echo -e "\n${GREEN}Done! 🔊${NC}"