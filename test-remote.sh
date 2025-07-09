#!/bin/bash

# Script to run tests against a remote Sonos API server
# Usage: ./test-remote.sh [host:port] [test-pattern] [options]
# Examples:
#   ./test-remote.sh                                    # Run all tests against localhost
#   ./test-remote.sh 192.168.1.100:5005                # Run all tests against remote host
#   ./test-remote.sh linux-host:5005 volume            # Run volume tests against remote host
#   ./test-remote.sh linux-host:5005 "02*" --clear-cache  # Run tests with cache cleared
#   ./test-remote.sh linux-host:5005 "" --debug        # Run all tests with debug logging
#
# Options:
#   --clear-cache   Clear test content cache before running
#   --log          Enable standard logging
#   --debug        Enable debug logging
#   --trace        Enable trace logging (most verbose)

HOST=""
PATTERN=""
EXTRA_ARGS=""

# Parse arguments
for arg in "$@"; do
    case $arg in
        --clear-cache|--log|--debug|--trace)
            EXTRA_ARGS="$EXTRA_ARGS $arg"
            ;;
        *)
            if [ -z "$HOST" ]; then
                HOST="$arg"
            elif [ -z "$PATTERN" ]; then
                PATTERN="$arg"
            fi
            ;;
    esac
done

# Set defaults
HOST=${HOST:-localhost:5005}

# Ensure we have the http:// prefix
if [[ ! "$HOST" =~ ^https?:// ]]; then
    HOST="http://$HOST"
fi

echo "🧪 Running tests against: $HOST"
if [ -n "$PATTERN" ]; then
    echo "   Pattern: $PATTERN"
fi
if [ -n "$EXTRA_ARGS" ]; then
    echo "   Options:$EXTRA_ARGS"
fi
echo ""

# Build first (needed for TypeScript)
npm run build

# Run tests with the custom host and options
if [ -z "$PATTERN" ]; then
    TEST_API_URL="$HOST" npm test -- $EXTRA_ARGS
else
    TEST_API_URL="$HOST" npm test -- "$PATTERN" $EXTRA_ARGS
fi