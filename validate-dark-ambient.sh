#!/bin/bash

# Quick validation for dark_ambient_radio preset issue

echo "=== Validating dark_ambient_radio preset ==="
echo ""

cd ../presets/presets-worf || exit 1

echo "1. Checking if dark_ambient_radio.json exists:"
if [[ -f "dark_ambient_radio.json" ]]; then
    echo "   ✓ File exists"
    echo "   File size: $(stat -f%z "dark_ambient_radio.json" 2>/dev/null || stat -c%s "dark_ambient_radio.json" 2>/dev/null) bytes"
    echo "   First few lines:"
    head -3 "dark_ambient_radio.json" | sed 's/^/   /'
else
    echo "   ✗ File NOT FOUND"
fi
echo ""

echo "2. Checking aliases that should point to dark_ambient_radio:"
for alias in "dark ambient" "dark ambient radio" "ambient dark"; do
    if [[ -L "$alias" ]]; then
        target=$(readlink "$alias")
        echo "   ✓ '$alias' -> $target"
    else
        echo "   ✗ '$alias' symlink NOT FOUND"
    fi
done
echo ""

echo "3. Checking what Alexa might be sending:"
# The API endpoint shows: /preset/dark_ambient_radio/room/OfficeSpeakers
# This means Alexa is sending "dark_ambient_radio" which needs to map to a file
echo "   Alexa sends: 'dark_ambient_radio'"
echo "   Looking for: dark_ambient_radio.json"
echo ""

echo "4. All files/links containing 'dark' or 'ambient':"
ls -la | grep -E "(dark|ambient)" | sed 's/^/   /'
echo ""

echo "5. Checking if preset is valid JSON:"
if [[ -f "dark_ambient_radio.json" ]]; then
    if python3 -m json.tool "dark_ambient_radio.json" > /dev/null 2>&1; then
        echo "   ✓ Valid JSON"
    else
        echo "   ✗ Invalid JSON - this would cause failures"
        echo "   JSON errors:"
        python3 -m json.tool "dark_ambient_radio.json" 2>&1 | sed 's/^/   /'
    fi
else
    echo "   Cannot check - file doesn't exist"
fi
echo ""

echo "6. Checking container's preset directory:"
echo "   The container on worf should have presets mounted or copied"
echo "   Run this on worf to check:"
echo "   docker exec sonos-alexa-api ls /app/presets/ | grep -i dark"