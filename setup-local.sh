#!/bin/bash

if (( $# >= 1 )); then
   BUILDFOR=$1
else
    BUILDFOR=$(echo "${HOSTNAME%%.*}" | tr '[:upper:]' '[:lower:]')
fi

echo "Setting up local environment for: $BUILDFOR"

# Copy configuration if it exists
if [ -f ../sonosd-priv/settings-${BUILDFOR}.json ]; then
    echo "Copying config for $BUILDFOR..."
    cp ../sonosd-priv/settings-${BUILDFOR}.json config.json
else
    echo "Warning: No config found at ../sonosd-priv/settings-${BUILDFOR}.json"
    echo "Using default config.json"
fi

# Copy presets if they exist
if [ -d ../sonosd-presets/presets-${BUILDFOR} ]; then
    echo "Copying presets for $BUILDFOR..."
    # Remove existing presets
    if [ -L ./presets ]; then
        rm ./presets 
    elif [ -d ./presets ]; then
        rm -rf ./presets
    elif [ -f ./presets ]; then
        rm ./presets
    fi
    
    # Create presets directory and copy files
    mkdir ./presets
    (cd ../sonosd-presets/presets-${BUILDFOR} && tar cf - .) | (cd ./presets && tar xf -)
    echo "Copied $(ls presets/*.json 2>/dev/null | wc -l) preset files"
else
    echo "Warning: No presets found at ../sonosd-presets/presets-${BUILDFOR}"
    echo "Creating default presets directory"
    mkdir -p ./presets
fi

echo ""
echo "Setup complete! You can now run:"
echo "  npm start"