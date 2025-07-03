#!/bin/bash
#
# Spotify OAuth Setup Script for Headless Environments
# 
# This script helps you authenticate with Spotify when running locally
# without a browser or when you can't receive the OAuth callback.
#
# Usage: ./scripts/spotify-auth-setup.sh [options]
#
# Options:
#   -p, --port PORT       API port (default: 5005)
#   -h, --host HOST       API host (default: localhost)
#   -i, --instance ID     Instance identifier (default: from INSTANCE_ID env var)
#   --help                Show this help message

set -e

# Default values
API_HOST="localhost"
API_PORT="5005"
INSTANCE_ID="${INSTANCE_ID:-default}"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -p|--port)
      API_PORT="$2"
      shift 2
      ;;
    -h|--host)
      API_HOST="$2"
      shift 2
      ;;
    -i|--instance)
      INSTANCE_ID="$2"
      shift 2
      ;;
    --help)
      grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# //'
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

API_URL="http://${API_HOST}:${API_PORT}"

echo "🎵 Spotify OAuth Setup for Sonos API"
echo "===================================="
echo "API URL: ${API_URL}"
echo "Instance: ${INSTANCE_ID}"
echo ""

# Check if API is running
echo "Checking API status..."
if ! curl -s -f "${API_URL}/health" > /dev/null 2>&1; then
    echo "❌ Error: Cannot connect to API at ${API_URL}"
    echo "Make sure the Sonos API is running on port ${API_PORT}"
    exit 1
fi

# Check current auth status
echo "Checking Spotify authentication status..."
AUTH_STATUS=$(curl -s "${API_URL}/spotify/status" | jq -r '.authenticated')

if [ "$AUTH_STATUS" = "true" ]; then
    echo "✅ Spotify is already authenticated!"
    echo ""
    echo "To re-authenticate, first clear the existing tokens:"
    echo "  rm data/spotify-tokens-${INSTANCE_ID}.json"
    echo ""
    exit 0
fi

# Get auth URL
echo "Getting Spotify authorization URL..."
AUTH_RESPONSE=$(curl -s "${API_URL}/spotify/auth-url")
AUTH_URL=$(echo "$AUTH_RESPONSE" | jq -r '.authUrl')
STATE=$(echo "$AUTH_RESPONSE" | jq -r '.state')

if [ -z "$AUTH_URL" ] || [ "$AUTH_URL" = "null" ]; then
    echo "❌ Error: Failed to get authorization URL"
    echo "Response: $AUTH_RESPONSE"
    exit 1
fi

echo ""
echo "📋 Instructions:"
echo "1. Copy and paste this URL into your browser:"
echo ""
echo "$AUTH_URL"
echo ""
echo "2. Log in to Spotify and authorize the application"
echo ""
echo "3. You'll be redirected to a URL that starts with:"
echo "   ${SPOTIFY_REDIRECT_URI:-http://localhost:8888/callback}"
echo ""
echo "4. Copy the ENTIRE redirect URL from your browser's address bar"
echo "   (It will show 'Unable to connect' - that's normal!)"
echo ""
echo "5. Paste the redirect URL here and press Enter:"
echo ""

# Read the callback URL
read -r CALLBACK_URL

if [ -z "$CALLBACK_URL" ]; then
    echo "❌ Error: No URL provided"
    exit 1
fi

# Submit the callback URL
echo ""
echo "Processing callback..."
CALLBACK_RESPONSE=$(curl -s -X POST "${API_URL}/spotify/callback-url" \
    -H "Content-Type: application/json" \
    -d "{\"callbackUrl\": \"$CALLBACK_URL\"}")

SUCCESS=$(echo "$CALLBACK_RESPONSE" | jq -r '.status')

if [ "$SUCCESS" = "success" ]; then
    echo "✅ Success! Spotify has been authenticated."
    echo ""
    
    # Get the refresh token location
    TOKEN_FILE="data/spotify-tokens-${INSTANCE_ID}.json"
    
    if [ -f "$TOKEN_FILE" ]; then
        REFRESH_TOKEN=$(jq -r '.refreshToken' "$TOKEN_FILE" 2>/dev/null)
        
        if [ -n "$REFRESH_TOKEN" ] && [ "$REFRESH_TOKEN" != "null" ]; then
            echo "📝 To make this permanent, add to your .env file:"
            echo ""
            echo "SPOTIFY_REFRESH_TOKEN=${REFRESH_TOKEN}"
            echo ""
            echo "This will allow the API to authenticate automatically on startup."
        fi
    fi
else
    echo "❌ Error: Authentication failed"
    echo "Response: $CALLBACK_RESPONSE"
    exit 1
fi