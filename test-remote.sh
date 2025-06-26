#!/bin/bash

# Script to run tests against a remote Sonos API server
# Usage: ./test-remote.sh [host:port] [test-pattern]
# Examples:
#   ./test-remote.sh                           # Run all tests against localhost
#   ./test-remote.sh 192.168.1.100:5005       # Run all tests against remote host
#   ./test-remote.sh linux-host:5005 volume   # Run volume tests against remote host

HOST=${1:-localhost:5005}
PATTERN=${2:-}

# Ensure we have the http:// prefix
if [[ ! "$HOST" =~ ^https?:// ]]; then
    HOST="http://$HOST"
fi

echo "🧪 Running tests against: $HOST"
echo ""

# Build first (needed for TypeScript)
npm run build

# Run tests with the custom host
if [ -z "$PATTERN" ]; then
    TEST_API_URL="$HOST" npm test
else
    TEST_API_URL="$HOST" npm test -- "$PATTERN"
fi