#!/usr/bin/env bash
# setup-local-enhanced.sh [settings-name] [--create-default-presets]
#
# Enhanced version that selects presets based on IP address when no argument given
#
# The purpose of this script is to copy the appropriate presets and
# settings for this host into the project directory.  These are the
# presets and settings that will be present in the final
# container. Since I have two homes, there is a host in each home that
# runs the alexa skill support.  Each home has a different sonos
# system with some shared presets but many are unique, particularly
# the room parameters.  It also copies in the correct settings.json
# for the host. If no argument, it determines based on IP address.
#
# This assumes you have ../private/settings-{HOSTNAME}.json and ../presets/presets-${HOSTNAME}/
#
# Options:
#   --create-default-presets  Empty presets folder and set CREATE_DEFAULT_PRESETS=true
#

# Function to get current IP address
get_ip_address() {
    # Try to get IP from active interface (usually en0 on Mac)
    ifconfig en0 2>/dev/null | grep "inet " | awk '{print $2}' | head -1
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

# Parse command line arguments
CREATE_DEFAULT_PRESETS=false
SETTINGS_ARG=""

for arg in "$@"; do
    if [[ "$arg" == "--create-default-presets" ]]; then
        CREATE_DEFAULT_PRESETS=true
    else
        SETTINGS_ARG="$arg"
    fi
done

if [[ -n "$SETTINGS_ARG" ]]; then
   SETTINGS_HOST="$SETTINGS_ARG"
   PRESETS_HOST="$SETTINGS_ARG"
else
    # Get hostname
    LOCAL_HOST=$(echo "${HOSTNAME%%.*}" | tr '[:upper:]' '[:lower:]')
    
    # Get current IP
    CURRENT_IP=$(get_ip_address)
    echo "Current IP: ${CURRENT_IP}"
    echo "Local host: ${LOCAL_HOST}"
    
    # Determine presets based on network
    if ip_in_subnet "$CURRENT_IP" "192.168.4.0/24"; then
        PRESETS_HOST="talon"
        echo "Detected talon network (192.168.4.0/24) - will use talon presets"
    elif ip_in_subnet "$CURRENT_IP" "192.168.11.0/24"; then
        PRESETS_HOST="worf"
        echo "Detected worf network (192.168.11.0/24) - will use worf presets"
    else
        PRESETS_HOST="${LOCAL_HOST}"
        echo "Other network - will use ${LOCAL_HOST} presets"
    fi
    
    # Settings/env always based on hostname
    SETTINGS_HOST="${LOCAL_HOST}"
fi    

echo "Using settings/env for: ${SETTINGS_HOST}"
if [ "$CREATE_DEFAULT_PRESETS" = true ]; then
    echo "Will use auto-generated default presets"
else
    echo "Using presets for: ${PRESETS_HOST}"
fi
echo ""

# Settings file
if [ -f ../private/settings-${SETTINGS_HOST}.json ]; then
    rm -f settings.json
    cp ../private/settings-${SETTINGS_HOST}.json settings.json
    rm -f settings-${SETTINGS_HOST}.json 2>/dev/null || true
    ln -s ../private/settings-${SETTINGS_HOST}.json .
    echo "✓ Copied settings-${SETTINGS_HOST}.json"
else
    echo "! No settings-${SETTINGS_HOST}.json found, using defaults"
    rm -f settings.json
    if [ -f settings.default.json ]; then
        cp settings.default.json settings.json
    else
        echo "{}" > settings.json
    fi
fi

# Environment file - try enhanced version first, fall back to regular
if [ -f ../private/.env-${SETTINGS_HOST}-enhanced ]; then
    rm -f .env
    cp ../private/.env-${SETTINGS_HOST}-enhanced .env
    rm -f .env-${SETTINGS_HOST} 2>/dev/null || true
    ln -s ../private/.env-${SETTINGS_HOST}-enhanced .env-${SETTINGS_HOST}
    echo "✓ Copied .env-${SETTINGS_HOST}-enhanced"
elif [ -f ../private/.env-${SETTINGS_HOST} ]; then
    rm -f .env
    cp ../private/.env-${SETTINGS_HOST} .env
    rm -f .env-${SETTINGS_HOST} 2>/dev/null || true
    ln -s ../private/.env-${SETTINGS_HOST} .
    echo "✓ Copied .env-${SETTINGS_HOST}"
else
    echo "! No .env-${SETTINGS_HOST} found, using example.env as template"
    rm -f .env
    if [ -f example.env ]; then
        cp example.env .env
    else
        touch .env
    fi
fi

# Check if mbpro4 presets folder is empty
if [ "$PRESETS_HOST" = "mbpro4" ] && [ -d ../presets/presets-mbpro4 ]; then
    # Check if directory is empty (no files)
    if [ -z "$(ls -A ../presets/presets-mbpro4 2>/dev/null)" ]; then
        echo "✓ Detected empty mbpro4 presets folder - enabling auto-generation"
        CREATE_DEFAULT_PRESETS=true
    fi
fi

# Presets directory
if [ "$CREATE_DEFAULT_PRESETS" = true ]; then
    # Empty the presets folder when using --create-default-presets
    echo "✓ CREATE_DEFAULT_PRESETS enabled"
    if [ -L ./presets ]; then
        rm ./presets 
    elif [ -d ./presets ]; then
        rm -rf ./presets
    elif [ -f ./presets ]; then
        rm ./presets
    fi
    mkdir -p ./presets
    echo "✓ Created empty presets directory for auto-generation"
else
    # Normal preset copying behavior
    if [ -d ../presets/presets-${PRESETS_HOST} ]; then
        if [ -L ./presets ]; then
            rm ./presets 
        elif [ -d ./presets ]; then
            rm -rf ./presets
        elif [ -f ./presets ]; then
            rm ./presets
        fi
        mkdir ./presets
        (cd ../presets/presets-${PRESETS_HOST} && tar cf - .) | (cd ./presets && tar xf -)
        echo "✓ Copied presets-${PRESETS_HOST}"
    else
        echo "! No presets-${PRESETS_HOST} found, creating empty presets directory"
        rm -rf ./presets 2>/dev/null || true
        mkdir -p ./presets
    fi
fi

# For mbpro4, adjust DEFAULT_ROOM based on network in both .env and settings.json
if [ "$SETTINGS_HOST" = "mbpro4" ]; then
    if [ -n "$CURRENT_IP" ]; then
        if ip_in_subnet "$CURRENT_IP" "192.168.4.0/24"; then
            # Talon network - use ShanesOfficeSpeakers
            echo "✓ Setting DEFAULT_ROOM=ShanesOfficeSpeakers for talon network"
            
            # Update .env file
            if [ -f .env ]; then
                if grep -q "^DEFAULT_ROOM=" .env; then
                    if [[ "$OSTYPE" == "darwin"* ]]; then
                        sed -i '' 's/^DEFAULT_ROOM=.*/DEFAULT_ROOM=ShanesOfficeSpeakers/' .env
                    else
                        sed -i 's/^DEFAULT_ROOM=.*/DEFAULT_ROOM=ShanesOfficeSpeakers/' .env
                    fi
                else
                    if [ -s .env ] && [ "$(tail -c 1 .env | wc -l)" -eq 0 ]; then
                        echo "" >> .env
                    fi
                    echo "DEFAULT_ROOM=ShanesOfficeSpeakers" >> .env
                fi
            fi
            
            # Update settings.json
            if [ -f settings.json ]; then
                if command -v jq >/dev/null 2>&1; then
                    # Use jq if available
                    jq '.defaultRoom = "ShanesOfficeSpeakers"' settings.json > settings.json.tmp && mv settings.json.tmp settings.json
                else
                    # Fallback to sed
                    if [[ "$OSTYPE" == "darwin"* ]]; then
                        sed -i '' 's/"defaultRoom"[[:space:]]*:[[:space:]]*"[^"]*"/"defaultRoom": "ShanesOfficeSpeakers"/' settings.json
                    else
                        sed -i 's/"defaultRoom"[[:space:]]*:[[:space:]]*"[^"]*"/"defaultRoom": "ShanesOfficeSpeakers"/' settings.json
                    fi
                fi
            fi
        elif ip_in_subnet "$CURRENT_IP" "192.168.11.0/24"; then
            # Worf network - use OfficeSpeakers
            echo "✓ Setting DEFAULT_ROOM=OfficeSpeakers for worf network"
            
            # Update .env file
            if [ -f .env ]; then
                if grep -q "^DEFAULT_ROOM=" .env; then
                    if [[ "$OSTYPE" == "darwin"* ]]; then
                        sed -i '' 's/^DEFAULT_ROOM=.*/DEFAULT_ROOM=OfficeSpeakers/' .env
                    else
                        sed -i 's/^DEFAULT_ROOM=.*/DEFAULT_ROOM=OfficeSpeakers/' .env
                    fi
                else
                    if [ -s .env ] && [ "$(tail -c 1 .env | wc -l)" -eq 0 ]; then
                        echo "" >> .env
                    fi
                    echo "DEFAULT_ROOM=OfficeSpeakers" >> .env
                fi
            fi
            
            # Update settings.json
            if [ -f settings.json ]; then
                if command -v jq >/dev/null 2>&1; then
                    # Use jq if available
                    jq '.defaultRoom = "OfficeSpeakers"' settings.json > settings.json.tmp && mv settings.json.tmp settings.json
                else
                    # Fallback to sed
                    if [[ "$OSTYPE" == "darwin"* ]]; then
                        sed -i '' 's/"defaultRoom"[[:space:]]*:[[:space:]]*"[^"]*"/"defaultRoom": "OfficeSpeakers"/' settings.json
                    else
                        sed -i 's/"defaultRoom"[[:space:]]*:[[:space:]]*"[^"]*"/"defaultRoom": "OfficeSpeakers"/' settings.json
                    fi
                fi
            fi
        else
            # Other network - remove DEFAULT_ROOM
            echo "✓ Removing DEFAULT_ROOM for unknown network"
            
            # Remove from .env file
            if [ -f .env ]; then
                if [[ "$OSTYPE" == "darwin"* ]]; then
                    sed -i '' '/^DEFAULT_ROOM=/d' .env
                else
                    sed -i '/^DEFAULT_ROOM=/d' .env
                fi
            fi
            
            # Remove from settings.json
            if [ -f settings.json ]; then
                if command -v jq >/dev/null 2>&1; then
                    # Use jq if available - remove the defaultRoom key
                    jq 'del(.defaultRoom)' settings.json > settings.json.tmp && mv settings.json.tmp settings.json
                else
                    # Fallback to sed - remove the line (may leave trailing comma)
                    if [[ "$OSTYPE" == "darwin"* ]]; then
                        sed -i '' '/"defaultRoom"[[:space:]]*:[[:space:]]*"[^"]*",*/d' settings.json
                        sed -i '' '/"defaultRoom"[[:space:]]*:[[:space:]]*"[^"]*"/d' settings.json
                    else
                        sed -i '/"defaultRoom"[[:space:]]*:[[:space:]]*"[^"]*",*/d' settings.json
                        sed -i '/"defaultRoom"[[:space:]]*:[[:space:]]*"[^"]*"/d' settings.json
                    fi
                fi
            fi
        fi
    fi
fi

# If CREATE_DEFAULT_PRESETS is true, ensure it's set in the .env file
if [ "$CREATE_DEFAULT_PRESETS" = true ] && [ -f .env ]; then
    # Check if CREATE_DEFAULT_PRESETS exists in .env
    if grep -q "^CREATE_DEFAULT_PRESETS=" .env; then
        # Update existing value
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' 's/^CREATE_DEFAULT_PRESETS=.*/CREATE_DEFAULT_PRESETS=true/' .env
        else
            # Linux
            sed -i 's/^CREATE_DEFAULT_PRESETS=.*/CREATE_DEFAULT_PRESETS=true/' .env
        fi
    else
        # Add the setting with a newline if file doesn't end with one
        if [ -s .env ] && [ "$(tail -c 1 .env | wc -l)" -eq 0 ]; then
            echo "" >> .env
        fi
        echo "CREATE_DEFAULT_PRESETS=true" >> .env
    fi
    echo "✓ Set CREATE_DEFAULT_PRESETS=true in .env"
fi

# Update test/.env with DEFAULT_ROOM from main .env
if [ -f .env ] && [ -f test/.env ]; then
    # Extract DEFAULT_ROOM from main .env
    DEFAULT_ROOM=$(grep "^DEFAULT_ROOM=" .env | cut -d'=' -f2)
    
    if [ -n "$DEFAULT_ROOM" ]; then
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
    else
        echo "✓ No DEFAULT_ROOM found in .env, leaving test/.env unchanged"
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
echo "- Settings/env: ${SETTINGS_HOST}"
if [ "$CREATE_DEFAULT_PRESETS" = true ]; then
    echo "- Presets: AUTO-GENERATED"
else
    echo "- Presets: ${PRESETS_HOST}"
fi