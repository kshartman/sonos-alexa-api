#!/bin/bash
#
# sonosdump.sh - Capture comprehensive Sonos system state
#
# This script connects directly to a Sonos device to dump complete system
# information for debugging and development purposes.

set -e

# Initialize variables
OUTPUT_FILE=""

# Check for help flag
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "sonosdump.sh - Capture comprehensive Sonos system state"
    echo ""
    echo "Usage: $0 [sonos-ip] [--output filename]"
    echo "       $0 --help"
    echo ""
    echo "Arguments:"
    echo "  sonos-ip        IP address of a Sonos device (works best with coordinator)"
    echo ""
    echo "Options:"
    echo "  -h, --help      Show this help message"
    echo "  --output FILE   Write output to FILE instead of stdout"
    echo ""
    echo "Environment:"
    echo "  SONOS_IP        Can be set as an environment variable instead of argument"
    echo ""
    echo "Examples:"
    echo "  $0 192.168.1.50                    # Output to stdout"
    echo "  $0 192.168.1.50 --output dump.txt  # Output to file"
    echo "  SONOS_IP=192.168.1.50 $0           # Using environment variable"
    echo ""
    echo "Output includes:"
    echo "  - All device information and capabilities"
    echo "  - Current playback state for all zones"
    echo "  - Network topology and groupings"
    echo "  - Favorites and playlists"
    echo "  - Music service configurations"
    echo ""
    echo "Note: This script connects directly to the Sonos device, not through the API."
    echo "      For best results, use the IP of a zone coordinator."
    exit 0
fi

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        *)
            # If SONOS_IP not set and this looks like an IP, use it
            if [ -z "$SONOS_IP" ] && [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                export SONOS_IP="$1"
            fi
            shift
            ;;
    esac
done

# Verify SONOS_IP is set
if [ -z "$SONOS_IP" ]; then
    echo "Error: SONOS_IP must be set either as an argument or environment variable" >&2
    echo "" >&2
    echo "Usage: $0 <sonos-ip> [--output filename]" >&2
    echo "   or: SONOS_IP=<ip> $0 [--output filename]" >&2
    echo "" >&2
    echo "Try '$0 --help' for more information." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run the dump command
if [ -n "$OUTPUT_FILE" ]; then
    echo "Using Sonos IP: $SONOS_IP" >&2
    echo "Capturing Sonos system state to $OUTPUT_FILE..." >&2
    node "${SCRIPT_DIR}/sonos-dump-all.cjs" > "$OUTPUT_FILE"
    echo "Output saved to: $OUTPUT_FILE" >&2
else
    # Output to stdout (no status messages)
    node "${SCRIPT_DIR}/sonos-dump-all.cjs"
fi
