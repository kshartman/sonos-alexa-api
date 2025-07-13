#!/bin/bash

# Script to manage debug settings on a Sonos API server

# Function to show usage
show_usage() {
    # Get the full path of this script
    local script_path=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
    local script_name=$(basename "$0")
    
    # Replace home directory with ~ if path starts with it
    local home_dir=$(echo ~)
    if [[ "$script_path" == "$home_dir"* ]]; then
        script_path="~${script_path#$home_dir}"
    fi
    
    echo "$script_name - Manage debug settings on a Sonos API server"
    echo ""
    echo "Usage: $script_path [options]"
    echo "       $script_name --help"
    echo ""
    echo "Options:"
    echo "  -u, --url URL          API server URL (default: auto-detect based on network)"
    echo "  -h, --home HOME        Specify home network (talon, worf) instead of auto-detect"
    echo "  -l, --level LEVEL      Set log level (error, warn, info, debug, trace)"
    echo "  -c, --categories CATS  Set debug categories (comma-separated or 'all')"
    echo "  -?, --help             Show this help message"
    echo ""
    echo "Default URLs:"
    echo "  - On talon network: http://talon.bogometer.com:35005"
    echo "  - On worf network: http://worf.bogometer.com:35005"
    echo "  - Otherwise: http://localhost:5005"
    echo ""
    echo "Examples:"
    echo "  $script_name                                           # Show current debug settings"
    echo "  $script_name --level debug                             # Set log level to debug"
    echo "  $script_name --categories usual                        # Enable api,discovery categories"
    echo "  $script_name --level trace --categories all            # Maximum verbosity"
    echo "  $script_name --url http://192.168.1.100:5005           # Use specific server"
    echo "  $script_name --home worf --level debug                 # Use worf server with debug level"
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
    echo "  usual      - Enable api,discovery (common debugging)"
}

# Check for help flag
if [ "$1" = "--help" ] || [ "$1" = "-?" ]; then
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
HOME=""
LEVEL=""
CATEGORIES=""

# Track if we found any unknown options
UNKNOWN_OPTION=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--url)
            if [ -z "$2" ] || [[ "$2" =~ ^- ]]; then
                echo "Error: --url requires an argument"
                exit 1
            fi
            URL="$2"
            shift 2
            ;;
        -h|--home)
            if [ -z "$2" ] || [[ "$2" =~ ^- ]]; then
                echo "Error: --home requires an argument"
                exit 1
            fi
            HOME="$2"
            shift 2
            ;;
        -l|--level)
            if [ -z "$2" ] || [[ "$2" =~ ^- ]]; then
                echo "Error: --level requires an argument"
                exit 1
            fi
            LEVEL="$2"
            shift 2
            ;;
        -c|--categories)
            if [ -z "$2" ] || [[ "$2" =~ ^- ]]; then
                echo "Error: --categories requires an argument"
                exit 1
            fi
            CATEGORIES="$2"
            shift 2
            ;;
        -\?|--help)
            show_usage
            exit 0
            ;;
        -*)
            echo "Error: Unknown option: $1"
            UNKNOWN_OPTION="$1"
            break
            ;;
        *)
            echo "Error: Unexpected argument: $1"
            UNKNOWN_OPTION="$1"
            break
            ;;
    esac
done

# If we found an unknown option, show usage and exit
if [ -n "$UNKNOWN_OPTION" ]; then
    echo ""
    show_usage
    exit 1
fi

# Set URL based on priority: --url, --home, or auto-detect
if [ -n "$URL" ]; then
    # URL explicitly provided
    echo "Using specified URL: $URL"
elif [ -n "$HOME" ]; then
    # Home specified, map to URL
    case "$HOME" in
        talon)
            URL="http://talon.bogometer.com:35005"
            echo "Using home '$HOME': $URL"
            ;;
        worf)
            URL="http://worf.bogometer.com:35005"
            echo "Using home '$HOME': $URL"
            ;;
        *)
            echo "Error: Unknown home '$HOME'. Valid options: talon, worf"
            exit 1
            ;;
    esac
else
    # Auto-detect based on network
    URL=$(get_default_url)
    echo "Using auto-detected URL: $URL"
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
    elif [ "$CATEGORIES" = "usual" ]; then
        echo "Enabling usual debug categories (api,discovery)"
        response=$(make_request "$URL/debug/category/api/true")
        response=$(make_request "$URL/debug/category/discovery/true")
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