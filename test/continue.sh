#!/bin/bash
# Helper script to continue paused interactive tests

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Go up one level to get project root
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

TRIGGER_FILE="$PROJECT_ROOT/tmp/test-continue.flag"

# Create the trigger file
mkdir -p "$PROJECT_ROOT/tmp"
touch "$TRIGGER_FILE"

echo "✅ Test continuation triggered!"
echo "   Created: $TRIGGER_FILE"