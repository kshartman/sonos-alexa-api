#!/bin/bash

# Script to manage debug settings on a Sonos API server

# Function to show usage
show_usage() {
    echo "sonosdebug.sh - Manage debug settings on a Sonos API server"
    echo ""
    echo "Usage: $0 [options]"
    echo "       $0 --help"
    echo ""
    echo "Options:"
    echo "  --url URL              API server URL (default: auto-detect based on network)"
    echo "  --level LEVEL          Set log level (error, warn, info, debug, trace)"
    echo "  --categories CATS      Set debug categories (comma-separated or 'all')"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Default URLs:"
    echo "  - On talon network: http://talon.bogometer.com:35005"
    echo "  - On worf network: http://worf.bogometer.com:35005"
    echo "  - Otherwise: http://localhost:5005"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Show current debug settings"
    echo "  $0 --level debug                      # Set log level to debug"
    echo "  $0 --categories api,discovery         # Enable specific debug categories"
    echo "  $0 --level trace --categories all     # Maximum verbosity"
    echo "  $0 --url http://192.168.1.100:5005   # Use specific server"
    echo ""
    echo "Debug Categories:"
    echo "  api        - API request/response logging"
    echo "  discovery  - Device discovery details"
    echo "  soap       - SOAP request/response XML"
    echo "  topology   - UPnP topology events"
    echo "  favorites  - Favorite resolution details"
    echo "  presets    - Preset loading and conversion"
    echo "  upnp       - Raw UPnP event details"
    echo "  sse        - Server-Sent Events for webhooks"
    echo "  all        - Enable all categories"
}

# Check for help flag
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    show_usage
    exit 0
fi

# Function to get current IP address
get_ip_address() {
    # Try ip command first (modern Linux) - more reliable on systems with Docker
    if command -v ip >/dev/null 2>&1; then
        ip route get 1 | awk '/src/ {print $7}'
    # Fallback to ifconfig (macOS, BSD)
    elif command -v ifconfig >/dev/null 2>&1; then
        ifconfig | grep 'inet ' | grep -v 127.0.0.1 | awk '{print $2}' | head -1
    else
        # No network commands available
        echo ""
    fi
}

# Function to detect network and set default URL
get_default_url() {
    # Detect network based on local IP address
    # 192.168.11.x = worf network
    # 192.168.4.x = talon network
    local local_ip=$(get_ip_address)
    
    if [[ "$local_ip" =~ ^192\.168\.11\. ]]; then
        echo "http://worf.bogometer.com:35005"
    elif [[ "$local_ip" =~ ^192\.168\.4\. ]]; then
        echo "http://talon.bogometer.com:35005"
    else
        echo "http://localhost:5005"
    fi
}

# Parse arguments
URL=""
LEVEL=""
CATEGORIES=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --url)
            URL="$2"
            shift 2
            ;;
        --level)
            LEVEL="$2"
            shift 2
            ;;
        --categories)
            CATEGORIES="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo ""
            show_usage
            exit 1
            ;;
    esac
done

# Set default URL if not provided
if [ -z "$URL" ]; then
    URL=$(get_default_url)
    echo "Using default URL: $URL"
fi

# Ensure URL has protocol
if [[ ! "$URL" =~ ^https?:// ]]; then
    URL="http://$URL"
fi

# Function to make a request and handle errors
make_request() {
    local endpoint="$1"
    local response
    local http_code
    
    # Use curl with timeout and capture both response and HTTP code
    response=$(curl -s -w "\n%{http_code}" --connect-timeout 5 --max-time 10 "$endpoint" 2>/dev/null)
    http_code=$(echo "$response" | tail -n1)
    response=$(echo "$response" | sed '$d')  # Remove last line (http code)
    
    if [ -z "$http_code" ] || [ "$http_code" = "000" ]; then
        echo "Error: Failed to connect to $URL"
        echo "Please check that the server is running and the URL is correct."
        exit 1
    elif [ "$http_code" != "200" ]; then
        echo "Error: Server returned HTTP $http_code"
        echo "Response: $response"
        exit 1
    fi
    
    echo "$response"
}

# If no level or categories specified, just show current settings
if [ -z "$LEVEL" ] && [ -z "$CATEGORIES" ]; then
    echo ""
    echo "=== Current Debug Settings ==="
    echo ""
    
    # Get debug info
    response=$(make_request "$URL/debug")
    
    # Parse JSON response using grep and sed for portability
    current_level=$(echo "$response" | grep -o '"logLevel":"[^"]*"' | sed 's/.*"logLevel":"\([^"]*\)".*/\1/')
    # Extract enabled categories by looking for true values in the categories object
    enabled_cats=$(echo "$response" | grep -o '"[^"]*":true' | sed 's/"\([^"]*\)":true/\1/g' | paste -sd ',' - | sed 's/,$//')
    
    echo "Server URL: $URL"
    echo "Log Level: $current_level"
    echo "Enabled Categories: ${enabled_cats:-none}"
    echo ""
    exit 0
fi

# Apply settings
echo ""
echo "=== Applying Debug Settings ==="
echo ""

# Set log level if specified
if [ -n "$LEVEL" ]; then
    echo "Setting log level to: $LEVEL"
    response=$(make_request "$URL/debug/level/$LEVEL")
    echo "Response: $response"
    echo ""
fi

# Set categories if specified
if [ -n "$CATEGORIES" ]; then
    if [ "$CATEGORIES" = "all" ]; then
        echo "Enabling all debug categories"
        response=$(make_request "$URL/debug/enable-all")
    else
        # Split categories by comma and enable each one
        IFS=',' read -ra CATS <<< "$CATEGORIES"
        for cat in "${CATS[@]}"; do
            cat=$(echo "$cat" | xargs)  # Trim whitespace
            echo "Enabling category: $cat"
            response=$(make_request "$URL/debug/category/$cat/true")
        done
    fi
    echo ""
fi

# Show final settings
echo "=== Updated Debug Settings ==="
echo ""
response=$(make_request "$URL/debug")
current_level=$(echo "$response" | grep -o '"logLevel":"[^"]*"' | sed 's/.*"logLevel":"\([^"]*\)".*/\1/')
# Extract enabled categories by looking for true values in the categories object
enabled_cats=$(echo "$response" | grep -o '"[^"]*":true' | sed 's/"\([^"]*\)":true/\1/g' | paste -sd ',' - | sed 's/,$//')

echo "Server URL: $URL"
echo "Log Level: $current_level"
echo "Enabled Categories: ${enabled_cats:-none}"
echo ""