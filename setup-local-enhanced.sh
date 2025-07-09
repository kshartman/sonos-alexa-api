#!/usr/bin/env bash
# setup-local-enhanced.sh [--dryrun] [home]
#
# Sets up environment based on network location or explicit home parameter
#
# Options:
#   --dryrun    Show what would be done without making changes
#
# Homes: worf, talon, mbpro4
#
# Algorithm:
# - If no argument: determine home from network (worf/talon), default to mbpro4
# - If argument provided: must be worf, talon, or mbpro4
# - For worf/talon: use .env-mbpro4-enhanced-{home}
# - For mbpro4: use .env-mbpro4-enhanced
#
# Always copies:
# - ../private/.env-* to ./.env
# - ../private/presets-{home}/ to ./presets/
# - ../private/data-{home}/ to ./data/
# - ../private/test/.env-test-{hostname}-{home} to ./test/.env
#

# Parse command line arguments
DRY_RUN=false
ARGS=()

for arg in "$@"; do
    case $arg in
        --dryrun)
            DRY_RUN=true
            ;;
        *)
            ARGS+=("$arg")
            ;;
    esac
done

# Function to execute or display command based on dry run mode
execute_cmd() {
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY RUN] Would execute: $@"
    else
        "$@"
    fi
}

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

# Function to check if IP is in a subnet
ip_in_subnet() {
    local ip=$1
    local subnet=$2
    
    # Simple check for /24 networks
    if [[ "$subnet" =~ ^([0-9]+\.[0-9]+\.[0-9]+)\.0/24$ ]]; then
        local network_prefix="${BASH_REMATCH[1]}"
        if [[ "$ip" =~ ^$network_prefix\.[0-9]+$ ]]; then
            return 0
        fi
    fi
    return 1
}

# Determine home based on argument or network
if [[ -n "${ARGS[0]}" ]]; then
    # Home explicitly specified
    HOME_NAME="${ARGS[0]}"
    
    # Validate home name
    if [[ "$HOME_NAME" != "worf" && "$HOME_NAME" != "talon" && "$HOME_NAME" != "mbpro4" ]]; then
        echo "Error: Invalid home '$HOME_NAME'. Must be one of: worf, talon, mbpro4"
        exit 1
    fi
    echo "Using specified home: $HOME_NAME"
else
    # Determine home from network
    CURRENT_IP=$(get_ip_address)
    echo "Current IP: ${CURRENT_IP}"
    
    if [[ -n "$CURRENT_IP" ]]; then
        if ip_in_subnet "$CURRENT_IP" "192.168.11.0/24"; then
            HOME_NAME="worf"
            echo "Detected worf network (192.168.11.0/24)"
        elif ip_in_subnet "$CURRENT_IP" "192.168.4.0/24"; then
            HOME_NAME="talon"
            echo "Detected talon network (192.168.4.0/24)"
        else
            HOME_NAME="mbpro4"
            echo "Not on worf or talon network, defaulting to mbpro4"
        fi
    else
        HOME_NAME="mbpro4"
        echo "Could not determine IP, defaulting to mbpro4"
    fi
fi

echo "Current directory: $(pwd)"

# Get hostname once, early in the script
HOSTNAME=$(hostname -s | tr '[:upper:]' '[:lower:]')

echo ""
if [ "$DRY_RUN" = true ]; then
    echo "*** DRY RUN MODE - No changes will be made ***"
    echo ""
fi
echo "Setting up for home: $HOME_NAME"
echo ""

# Remove settings.json if it exists (using env vars instead)
if [ -f settings.json ]; then
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY RUN] Would remove settings.json (using environment variables instead)"
    else
        echo "✓ Removing settings.json (using environment variables instead)"
        rm -f settings.json
    fi
fi

# Clean up any settings symlinks
if [ "$DRY_RUN" = true ]; then
    if ls settings-*.json 2>/dev/null >/dev/null; then
        echo "[DRY RUN] Would remove settings-*.json symlinks"
    fi
else
    rm -f settings-*.json 2>/dev/null || true
fi

# Copy environment file based on home and hostname
if [ "$HOME_NAME" = "mbpro4" ]; then
    ENV_FILE="../private/.env-mbpro4-enhanced"
elif [ "$HOSTNAME" != "mbpro4" ] && [ "$HOSTNAME" = "$HOME_NAME" ]; then
    # Running on the actual host (e.g., on worf for home worf)
    ENV_FILE="../private/.env-${HOME_NAME}-enhanced"
else
    # Running on mbpro4 for a different home
    ENV_FILE="../private/.env-mbpro4-enhanced-${HOME_NAME}"
fi

if [ -f "$ENV_FILE" ]; then
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY RUN] Would copy $ENV_FILE to .env"
    else
        rm -f .env
        cp "$ENV_FILE" .env
        echo "✓ Copied $ENV_FILE to .env"
    fi
else
    echo "! Error: $ENV_FILE not found"
    if [ "$DRY_RUN" != true ]; then
        exit 1
    fi
fi

# Copy presets directory
PRESETS_SOURCE="../presets/presets-${HOME_NAME}"

if [ "$DRY_RUN" = true ]; then
    # Dry run mode - just show what would happen
    if [ -L ./presets ] || [ -d ./presets ] || [ -f ./presets ]; then
        echo "[DRY RUN] Would remove existing ./presets"
    fi
    
    if [ -d "$PRESETS_SOURCE" ]; then
        if [ -n "$(ls -A "$PRESETS_SOURCE" 2>/dev/null)" ]; then
            echo "[DRY RUN] Would copy $PRESETS_SOURCE to ./presets"
        else
            echo "[DRY RUN] Would create empty ./presets (source is empty)"
        fi
    else
        echo "[DRY RUN] Would create empty ./presets (no source found)"
    fi
else
    # Remove existing presets
    if [ -L ./presets ]; then
        rm ./presets
    elif [ -d ./presets ]; then
        rm -rf ./presets
    elif [ -f ./presets ]; then
        rm ./presets
    fi
    
    # Copy presets (create empty if source doesn't exist)
    if [ -d "$PRESETS_SOURCE" ]; then
        mkdir ./presets
        if [ -n "$(ls -A "$PRESETS_SOURCE" 2>/dev/null)" ]; then
            (cd "$PRESETS_SOURCE" && tar cf - .) | (cd ./presets && tar xf -)
            echo "✓ Copied $PRESETS_SOURCE to ./presets"
        else
            echo "✓ Created empty ./presets (source was empty)"
        fi
    else
        mkdir -p ./presets
        echo "✓ Created empty ./presets (no source found)"
    fi
fi

# For mbpro4, check if presets are empty and add CREATE_DEFAULT_PRESETS if needed
if [ "$HOME_NAME" = "mbpro4" ] && [ -z "$(ls -A ./presets 2>/dev/null)" ]; then
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY RUN] Would add CREATE_DEFAULT_PRESETS=true to .env (empty presets for mbpro4)"
    else
        echo "✓ Empty presets detected for mbpro4, adding CREATE_DEFAULT_PRESETS=true"
        
        # Add CREATE_DEFAULT_PRESETS to .env
        if [ -s .env ] && [ "$(tail -c 1 .env | wc -l)" -eq 0 ]; then
            echo "" >> .env
        fi
        echo "" >> .env
        echo "# Auto-generate presets from favorites since presets folder is empty" >> .env
        echo "CREATE_DEFAULT_PRESETS=true" >> .env
        echo "" >> .env
    fi
fi


# Copy data directory
DATA_SOURCE="../private/data-${HOME_NAME}"

if [ "$DRY_RUN" = true ]; then
    # Dry run mode - just show what would happen
    if [ -L ./data ] || [ -d ./data ] || [ -f ./data ]; then
        echo "[DRY RUN] Would remove existing ./data"
    fi
    
    if [ -d "$DATA_SOURCE" ]; then
        if [ -n "$(ls -A "$DATA_SOURCE" 2>/dev/null)" ]; then
            echo "[DRY RUN] Would copy $DATA_SOURCE to ./data"
            
            # Check for compressed files that would be decompressed
            if [ -f "$DATA_SOURCE/music-library.cache.gz" ]; then
                echo "[DRY RUN] Would decompress music-library.cache.gz"
            fi
            if [ -f "$DATA_SOURCE/services-cache.json.gz" ]; then
                echo "[DRY RUN] Would decompress services-cache.json.gz"
            fi
        else
            echo "[DRY RUN] Would create empty ./data (source is empty)"
        fi
    else
        echo "[DRY RUN] Would create empty ./data (no source found)"
    fi
else
    # Remove existing data directory or symlink
    if [ -L ./data ]; then
        rm ./data
    elif [ -d ./data ]; then
        rm -rf ./data
    elif [ -f ./data ]; then
        rm ./data
    fi
    
    # Copy data (create empty if source doesn't exist)
    if [ -d "$DATA_SOURCE" ]; then
        mkdir ./data
        if [ -n "$(ls -A "$DATA_SOURCE" 2>/dev/null)" ]; then
            (cd "$DATA_SOURCE" && tar cf - .) | (cd ./data && tar xf -)
            echo "✓ Copied $DATA_SOURCE to ./data"
            
            # Check for compressed cache files and decompress them
            if [ -f ./data/music-library.cache.gz ]; then
                echo "✓ Decompressing music-library.cache.gz"
                gunzip ./data/music-library.cache.gz
            fi
            if [ -f ./data/services-cache.json.gz ]; then
                echo "✓ Decompressing services-cache.json.gz"
                gunzip ./data/services-cache.json.gz
            fi
        else
            echo "✓ Created empty ./data (source was empty)"
        fi
    else
        mkdir -p ./data
        echo "✓ Created empty ./data (no source found)"
    fi
fi

# Copy test environment file based on hostname and home
# For hosts other than mbpro4, when running on the actual host (hostname == home),
# use just the hostname. Otherwise use hostname-home format.
if [ "$HOSTNAME" != "mbpro4" ] && [ "$HOSTNAME" = "$HOME_NAME" ]; then
    TEST_ENV_SOURCE="../private/test/.env-test-${HOSTNAME}"
else
    TEST_ENV_SOURCE="../private/test/.env-test-${HOSTNAME}-${HOME_NAME}"
fi
TEST_ENV_DEST="test/.env"

if [ "$DRY_RUN" = true ]; then
    # Dry run mode
    if [ ! -d test ]; then
        echo "[DRY RUN] Would create test directory"
    fi
    
    if [ -f "$TEST_ENV_SOURCE" ]; then
        echo "[DRY RUN] Would copy $TEST_ENV_SOURCE to $TEST_ENV_DEST"
    else
        echo "[DRY RUN] Test environment file not found: $TEST_ENV_SOURCE"
        if [ ! -f "$TEST_ENV_DEST" ]; then
            echo "[DRY RUN] Would create minimal test/.env"
        fi
    fi
else
    # Create test directory if it doesn't exist
    mkdir -p test
    
    # Copy test environment file if it exists
    if [ -f "$TEST_ENV_SOURCE" ]; then
        cp "$TEST_ENV_SOURCE" "$TEST_ENV_DEST"
        echo "✓ Copied $TEST_ENV_SOURCE to $TEST_ENV_DEST"
    else
        echo "! Test environment file not found: $TEST_ENV_SOURCE"
        # Create minimal test/.env if it doesn't exist
        if [ ! -f "$TEST_ENV_DEST" ]; then
            echo "✓ Creating minimal test/.env"
            echo "# Test environment configuration" > "$TEST_ENV_DEST"
            echo "" >> "$TEST_ENV_DEST"
        fi
    fi
fi

# Update test/.env with DEFAULT_ROOM from main .env
if [ -f .env ] && [ -f test/.env ]; then
    # Extract DEFAULT_ROOM from main .env
    DEFAULT_ROOM=$(grep "^DEFAULT_ROOM=" .env | cut -d'=' -f2)
    
    if [ -n "$DEFAULT_ROOM" ]; then
        if [ "$DRY_RUN" = true ]; then
            if grep -q "^TEST_ROOM=" test/.env; then
                echo "[DRY RUN] Would update TEST_ROOM in test/.env to ${DEFAULT_ROOM}"
            else
                echo "[DRY RUN] Would add TEST_ROOM=${DEFAULT_ROOM} to test/.env"
            fi
        else
            echo "✓ Updating test/.env with TEST_ROOM=${DEFAULT_ROOM}"
            
            # Update or add TEST_ROOM in test/.env
            if grep -q "^TEST_ROOM=" test/.env; then
                # Update existing TEST_ROOM line
                if [[ "$OSTYPE" == "darwin"* ]]; then
                    sed -i '' "s/^TEST_ROOM=.*/TEST_ROOM=${DEFAULT_ROOM}/" test/.env
                else
                    sed -i "s/^TEST_ROOM=.*/TEST_ROOM=${DEFAULT_ROOM}/" test/.env
                fi
            else
                # Add TEST_ROOM line with newline if needed
                if [ -s test/.env ] && [ "$(tail -c 1 test/.env | wc -l)" -eq 0 ]; then
                    echo "" >> test/.env
                fi
                echo "TEST_ROOM=${DEFAULT_ROOM}" >> test/.env
            fi
        fi
    else
        if [ "$DRY_RUN" != true ]; then
            echo "✓ No DEFAULT_ROOM found in .env, leaving test/.env unchanged"
        fi
    fi
else
    if [ ! -f .env ]; then
        echo "! No .env file found"
    fi
    if [ ! -f test/.env ]; then
        echo "! No test/.env file found"
    fi
fi

echo ""
echo "Setup complete!"
echo "- Home: ${HOME_NAME}"
echo "- Hostname: ${HOSTNAME}"
echo "- Environment: ${ENV_FILE##*/}"
echo "- Test Environment: ${TEST_ENV_SOURCE##*/}"
echo "- Presets: presets-${HOME_NAME}"
echo "- Data: data-${HOME_NAME}"
if [ "$HOME_NAME" = "mbpro4" ] && [ -z "$(ls -A ./presets 2>/dev/null)" ]; then
    echo "- Auto-presets: ENABLED (empty presets folder)"
fi