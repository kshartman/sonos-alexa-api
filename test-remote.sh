#!/bin/bash

# Script to run tests against a remote Sonos API server

# Check for help flag
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "test-remote.sh - Run tests against a remote Sonos API server"
    echo ""
    echo "Usage: $0 [host:port] [test-pattern] [options]"
    echo "       $0 --help"
    echo ""
    echo "Arguments:"
    echo "  host:port       The remote API server (default: localhost:5005)"
    echo "  test-pattern    Pattern to match test files (e.g., 'volume', '02*')"
    echo ""
    echo "Options:"
    echo "  --clear-cache   Clear test content cache before running"
    echo "  --log           Enable standard logging"
    echo "  --debug         Enable debug logging"
    echo "  --trace         Enable trace logging (most verbose)"
    echo "  -h, --help      Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Run all tests against localhost"
    echo "  $0 192.168.1.100:5005                # Run all tests against remote host"
    echo "  $0 linux-host:5005 volume            # Run volume tests against remote host"
    echo "  $0 linux-host:5005 \"02*\" --clear-cache  # Run tests with cache cleared"
    echo "  $0 linux-host:5005 \"\" --debug        # Run all tests with debug logging"
    echo ""
    echo "Description:"
    echo "  This script builds the project and runs integration tests against a"
    echo "  specified Sonos API server. Tests can be filtered by pattern and run"
    echo "  with various logging levels. The TEST_API_URL environment variable"
    echo "  is automatically set based on the provided host."
    exit 0
fi

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