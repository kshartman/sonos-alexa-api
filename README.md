# Sonos HTTP API

A modern, high-performance HTTP API for controlling Sonos speakers, designed for Alexa skill integration and home automation.

This is a complete TypeScript rewrite of the original [node-sonos-http-api](https://github.com/jishi/node-sonos-http-api), focused on speed, reliability, and minimal dependencies.

**Version 1.6.0** adds enhanced authentication monitoring, deferred preset validation, and improved server status reporting.

## Key Features

- ⚡ **Lightning fast** - Near-instant response times using native Node.js HTTP
- 🎯 **Alexa-ready** - Drop-in replacement for jishi's node-sonos-http-api  
- 📦 **Minimal dependencies** - Just 2 runtime dependencies vs 50+ in legacy
- 🔍 **TypeScript** - Full type safety with comprehensive error handling
- 🐳 **Docker-first** - Production-ready container with health checks
- 🎵 **Music services** - Apple Music, Spotify, Pandora, local library search
- 🔊 **TTS support** - Multiple text-to-speech providers
- 🏠 **Group control** - Manage speaker groups and stereo pairs
- 🛡️ **Robust error handling** - Typed errors with automatic retry logic
- 📊 **96% test coverage** - Comprehensive test suite
- 🔐 **Secure** - Optional authentication with trusted network support
- 🎧 **Spotify Integration** - Play tracks, albums, playlists with OAuth2 search

## Requirements

- **Sonos S2 system** - S1 systems are not supported
- **Node.js 18+** - Uses native Node.js APIs
- **Network access** - Must be on same network as Sonos devices

### For Spotify Support
- **Spotify Premium account** - Free accounts cannot be controlled via API
- **Account linked in Sonos app** - Spotify must be configured in your Sonos system
- **Required favorites** - Add at least one of each to Sonos favorites:
  - A Spotify track
  - A Spotify album  
  - A Spotify playlist
  
  *These favorites are used to extract authentication tokens since S2 systems don't expose account details via API*

## Performance

Typical response times:
- Play/pause commands: <100ms
- Volume changes: <100ms  
- Music search: <200ms
- Group operations: <150ms

## What's New in v1.6.0

- **Enhanced Authentication Status** - New `/pandora/status` and `/spotify/status` endpoints show detailed auth state
- **Proactive Token Refresh** - Spotify tokens now refresh automatically on startup when configured
- **Server Summary JSON** - The `server-summary.sh` script now supports `--json` flag for structured output
- **Deferred Preset Validation** - Presets validate only when used, preventing issues with devices discovered later
- **sonosdebug.sh Utility** - New script for managing debug settings remotely with network-aware defaults
- **Bug Fixes** - Library search playback, Pandora cache loading, preset favorite resolution

## Quick Start

### Docker (Recommended)

```bash
# Quick start with Docker
docker run -d \
  --name sonos-alexa-api \
  --network host \
  -e DEFAULT_ROOM="Living Room" \
  kshartman/sonos-alexa-api:v1.6.0

# Or using Docker Compose (recommended)
curl -O https://raw.githubusercontent.com/kshartman/sonos-alexa-api/main/docker-compose.example.yml
mv docker-compose.example.yml docker-compose.yml
# Edit docker-compose.yml with your settings
docker-compose up -d

# View logs
docker logs -f sonos-alexa-api
```

**Docker Hub**: [`kshartman/sonos-alexa-api`](https://hub.docker.com/r/kshartman/sonos-alexa-api)

See [DOCKER.md](DOCKER.md) for detailed Docker usage and configuration.

### Local Development

```bash
npm install
npm start
```

## Configuration

The API can be configured through multiple sources with the following precedence:
1. Default values
2. `settings.json` file
3. Environment variables (highest priority)

### Environment Variables (Recommended)

The `npm start` command now loads `.env` files automatically using dotenv:

```bash
# Copy example and customize
cp example.env .env
# Edit .env with your settings
```

Key environment variables:
```bash
# Server
PORT=5005
HOST=sonosapi.local              # Display name only (listens on 0.0.0.0)
TTS_HOST_IP=192.168.1.100        # Optional - auto-detected if not set

# Logging & Debug
LOG_LEVEL=info                    # error, warn, info, debug, trace
DEBUG_CATEGORIES=api,discovery    # api,discovery,soap,topology,favorites,presets,upnp,sse,all
NODE_ENV=development              # development or production
LOGGER=winston                    # winston or pino

# Authentication (optional)
AUTH_USERNAME=admin
AUTH_PASSWORD=secret
AUTH_TRUSTED_NETWORKS=192.168.1.0/24

# Defaults
DEFAULT_ROOM=LivingRoom
DEFAULT_SERVICE=apple
CREATE_DEFAULT_PRESETS=false      # Auto-generate presets from favorites

# TTS
TTS_PROVIDER=google
TTS_LANG=en-US

# Spotify OAuth (for search functionality)
SPOTIFY_CLIENT_ID=your-client-id
SPOTIFY_CLIENT_SECRET=your-client-secret
SPOTIFY_REDIRECT_URI=http://localhost:5005/spotify/callback
SPOTIFY_REFRESH_TOKEN=your-refresh-token  # Optional - obtained after OAuth flow

# Music Library
LIBRARY_RANDOM_QUEUE_LIMIT=100
```

See `.env.example` for all available options.

### Command Line Overrides

Environment variables can be overridden on the command line:

```bash
# Override specific settings
DEBUG_CATEGORIES=api,discovery npm start

# Enable all debug categories (verbose)
DEBUG_CATEGORIES=all npm start

# Disable all debug categories for fastest startup
DEBUG_CATEGORIES= npm start

# Enable preset generation temporarily
CREATE_DEFAULT_PRESETS=true npm start
```

### Debug Categories

Control log verbosity with DEBUG_CATEGORIES:
- `api` - API request/response logging (enabled by default)
- `discovery` - Device discovery details  
- `soap` - SOAP request/response XML (verbose)
- `topology` - UPnP topology events
- `favorites` - Favorite resolution details
- `presets` - Preset loading and conversion (can be verbose)
- `upnp` - Raw UPnP event details
- `sse` - Server-Sent Events for webhooks
- `all` - Enable all categories

**Note**: The `presets` category can generate hundreds of log lines during startup. It's recommended to enable it only when debugging preset issues.

# Enable all debug categories (verbose)
DEBUG_CATEGORIES=all npm start

# Disable all debug categories for fastest startup
DEBUG_CATEGORIES= npm start

# Enable preset generation temporarily
CREATE_DEFAULT_PRESETS=true npm start
```

### settings.json (Deprecated)

**⚠️ Deprecated**: Use environment variables instead.  
Kept only for backward compatibility.

For reference, the settings.json format is:

```json
{
  "port": 5005,
  "host": "sonosapi.local",
  "defaultRoom": "Living Room",
  "defaultService": "apple",
  "announceVolume": 40,
  
  "auth": {
    "username": "admin",
    "password": "secret",
    "rejectUnauthorized": true,
    "trustedNetworks": ["192.168.1.0/24"]
  },
  
  "tts": {
    "provider": "google",
    "lang": "en-US"
  },
  
  "macSay": {
    "voice": "Samantha",
    "rate": 175
  },
  
  "pandora": {
    "username": "your-pandora-username",
    "password": "your-pandora-password"
  },
  
  "library": {
    "randomQueueLimit": 50,
    "reindexInterval": "1 week"
  }
}
```

## API Documentation

See the [Help & Usage Guide](./HELP.md) for common usage patterns and examples, or the [OpenAPI specification](./apidoc/openapi.yaml) for complete endpoint documentation.

## Spotify Setup

The API supports Spotify search and playback through OAuth2 authentication. There are two ways to configure Spotify:

### Option 1: Pre-configured Refresh Token (Recommended for Production)

If you already have a Spotify refresh token:

```bash
# Add to your .env file
SPOTIFY_CLIENT_ID=your-client-id
SPOTIFY_CLIENT_SECRET=your-client-secret
SPOTIFY_REFRESH_TOKEN=your-refresh-token
```

### Option 2: OAuth Flow

1. **Create a Spotify App**
   - Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   - Create a new app
   - Add your redirect URI to the app settings:
     - For local development: `http://localhost:5005/spotify/callback`
     - For production: `https://your-domain.com/spotify/callback`
   - Copy the Client ID and Client Secret

2. **Configure the API**
   ```bash
   # Add to your .env file
   SPOTIFY_CLIENT_ID=your-client-id
   SPOTIFY_CLIENT_SECRET=your-client-secret
   SPOTIFY_REDIRECT_URI=http://localhost:5005/spotify/callback
   ```

3. **Authenticate**
   - **Option A - Browser**: Visit `http://localhost:5005/spotify/auth` and follow the flow
   - **Option B - Headless**: Use the setup script:
     ```bash
     ./scripts/spotify-auth-setup.sh
     ```
     This script will guide you through manual authentication and help you obtain a refresh token.

4. **Multi-Instance Support**
   
   For multiple deployments (e.g., different homes):
   ```bash
   # Set a unique instance ID
   INSTANCE_ID=home-name
   ```
   
   Each instance maintains its own token storage in `data/spotify-tokens-{instance-id}.json`

### Public Proxy Configuration

For headless deployments, configure your proxy to handle OAuth callbacks:

**nginx example:**
```nginx
location /spotify/callback {
    proxy_pass http://localhost:5005;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

See the `deploy/` directory for complete proxy configuration examples.

## Pandora Setup

The API supports Pandora playback with some important considerations:

### Recommended Approach: Use Favorites

**The most reliable way to use Pandora with this API is to add your stations as Sonos favorites first.** This is the approach we strongly recommend because:

1. **Reliability** - Favorites always work and don't depend on external APIs
2. **No API Blocks** - The unofficial Pandora API can block access or change without notice
3. **Faster** - No need to query external services
4. **Official Support** - Uses Sonos's built-in favorite system

#### How to Add Pandora Stations as Favorites

1. Open the Sonos app
2. Navigate to Pandora and find your station
3. Press and hold (or right-click) on the station
4. Select "Add to My Sonos" or "Add to Favorites"
5. The station is now available via the API:
   ```bash
   # List all favorites
   curl http://localhost:5005/favorites
   
   # Play a Pandora favorite
   curl http://localhost:5005/OfficeSpeakers/favorite/Classic%20Rock%20Radio
   ```

### Alternative: Direct Station Play (Not Recommended)

The API also supports playing Pandora stations directly by name, but this method:
- Requires Pandora credentials in settings.json
- Uses an unofficial API that may stop working
- Can trigger Pandora's bot detection and block your IP
- Is slower and less reliable

**⚠️ Bot Detection Warning**: Pandora has implemented aggressive bot detection that can temporarily block logins even with correct credentials. This happens when the unofficial API makes frequent requests or exhibits bot-like behavior.

The API now includes automatic bot detection backoff:
- If Pandora blocks a login attempt, the API enters a backoff period starting at 24 hours
- Subsequent failures increase the backoff to 36 hours, then 48 hours maximum
- The backoff resets only after a successful login
- During backoff, all login attempts are blocked locally to prevent further triggering Pandora's bot detection

If you still want to use this method:

```json
{
  "pandora": {
    "username": "your-pandora-username",
    "password": "your-pandora-password"
  }
}
```

Then you can play stations directly:
```bash
curl http://localhost:5005/OfficeSpeakers/pandora/play/Classic%20Rock%20Radio
```

**Important:** When Pandora API credentials are not configured, incorrect, or blocked by Pandora, the API automatically falls back to searching your Sonos favorites. This fallback only works for stations you've already added as favorites in the Sonos app.

### Technical Details

- The API automatically manages Pandora session locks using a silence file technique
- Station switching is reliable and takes about 3-5 seconds
- Thumbs up/down functionality is supported
- Station discovery works through both the unofficial API (if credentials are valid) and by browsing your Sonos favorites
- Station cache is automatically refreshed: favorites every 5 minutes, API stations every 24 hours

### Troubleshooting: Ghost Pandora Favorites

A common issue occurs when you delete and re-add a Pandora account in Sonos. The old favorites remain but won't play because they reference the deleted account's session number. These "ghost" favorites will fail with SOAP 500/501 errors.

#### Identifying Ghost Favorites

Use the included diagnostic script to find problematic Pandora favorites:

```bash
cd scripts
./pandoradump.sh

# Output shows session numbers (SN) for each Pandora favorite:
# Ambient Radio         | 25   | 236   | 8296  | ST | 4115366826458437828  | Pandora
# Chicago Blues        | 3    | 236   | 8296  | ST | 142640745130511057   | Pandora  <- Old SN
# Classic Rock Radio   | 25   | 236   | 8296  | ST | 116482263994085703   | Pandora
```

In this example, "Chicago Blues" has SN=3 while others have SN=25, indicating it's from an old account.

**Note about Multiple Pandora Accounts**: While the example above assumes a single Pandora account per household, it's technically possible to have multiple valid Pandora accounts with different session numbers. However, this API makes a simplifying assumption:
- **Favorites playback**: Preserves the original session number from each favorite, so multi-account favorites should work
- **Direct station play** (`/pandora/play/`): Always uses the highest session number found, which may not work for stations from other accounts
- This limitation exists because we cannot reliably determine which session numbers are currently valid without attempting to play content

#### Fixing Ghost Favorites

1. **Remove the old favorite** in the Sonos app:
   - Go to My Sonos/Favorites
   - Find the problematic station
   - Remove it from favorites

2. **Re-add from current Pandora account**:
   - Navigate to Pandora in the Sonos app
   - Find the station again
   - Add it back to favorites

3. **Verify the fix**:
   ```bash
   ./pandoradump.sh
   # All stations should now show the same SN
   ```

When playing stations by name, the API automatically uses the highest session number found. Ghost favorites will still fail to play regardless of the method used. It's best to clean them up for a better experience.

## Authentication Status Monitoring

### Music Service Status Endpoints

Monitor the authentication state of music services:

```bash
# Check Pandora status
curl http://localhost:5005/pandora/status

# Response shows detailed state:
{
  "authenticated": true,
  "hasCredentials": true,
  "authStatus": {
    "success": true,
    "timestamp": "2025-07-14T18:25:24.428Z"
  },
  "stationCount": 82,
  "apiStations": 68,
  "favoriteStations": 0,
  "bothSources": 14,
  "cacheAge": "5m ago",
  "message": "Pandora authenticated - 82 stations (68 from API cached 5m ago, 0 from favorites)"
}

# Check Spotify status
curl http://localhost:5005/spotify/status

# Response shows token state:
{
  "authenticated": true,
  "hasTokens": true,
  "tokenExpired": false,
  "hasRefreshToken": true,
  "expiresIn": "45m",
  "lastAuth": "2025-07-14T18:25:22.831Z",
  "authAge": "5m ago",
  "message": "Spotify authenticated (token expires in 45m)"
}
```

### Server Summary Script

Monitor the overall server status with the included summary script:

```bash
# Text output (default)
./scripts/server-summary.sh localhost 5005

# JSON output for monitoring tools
./scripts/server-summary.sh localhost 5005 --json | jq

# Example JSON output includes:
{
  "server": {
    "host": "localhost",
    "port": 5005,
    "version": "1.6.0",
    "environment": "development",
    "started": "2025-07-14T18:25:22.630Z",
    "uptimeSeconds": 3600
  },
  "entities": {
    "devices": 14,
    "zones": 11,
    "presets": { "valid": 133, "total": 133, "awaitingValidation": false },
    "musicServices": 101,
    "musicLibrary": { "tracks": 49322, "albums": 3819, "artists": 4621 },
    "pandoraStations": 82
  },
  "readiness": {
    "discovery": true,
    "servicesCache": true,
    "musicLibrary": true,
    "upnpSubscriptions": true,
    "topology": true,
    "allReady": true
  },
  "authentication": {
    "pandora": { /* full status object */ },
    "spotify": { /* full status object */ }
  }
}
```

The summary script provides:
- Color-coded authentication states (green=authenticated, yellow=partial, red=failed)
- Human-readable cache ages and token expiry times
- Entity counts and system readiness status
- JSON output with proper ISO 8601 timestamps for integration with monitoring tools

## Utility Scripts

The `scripts/` directory contains helpful utilities:

- **`server-summary.sh`** - Compact server status overview with optional JSON output
- **`sonosdump.sh`** - Raw device state dump for a single Sonos device
- **`pandoradump.sh`** - Diagnose ghost Pandora favorites
- **`spotify-auth-setup.sh`** - Manual Spotify OAuth flow for headless systems
- **`analyze-content.sh`** - Analyze favorites, presets, and music library
- **`analyze-infrastructure.sh`** - Detailed device and network analysis
- **`analyze-build.sh`** - Analyze build configuration and startup state
- **`analyze-auth-failures.sh`** - Diagnose authentication issues with music services
- **`sonosdebug.sh`** - Interactive debug control for log levels and categories

## Credits

This project is built on the excellent foundation of:
- [node-sonos-http-api](https://github.com/jishi/node-sonos-http-api) by @jishi - The original HTTP API
- [node-sonos-discovery](https://github.com/jishi/node-sonos-discovery) by @jishi - The Sonos discovery library

This rewrite maintains full API compatibility while modernizing the codebase with:
- TypeScript for type safety
- Minimal dependencies (2 vs 50+)
- Modern async/await patterns
- Native Node.js HTTP server
- Comprehensive test coverage

## Supported Services

- ✅ Local Music Library
- ✅ Apple Music (via iTunes Search API)
- ✅ Pandora (with account)
- ✅ Line-In playback
- ✅ Spotify (Direct playback + OAuth2 search) - **NEW in v1.5.0**
- ❌ SiriusXM (no public API)
- ❌ Amazon Music (no public API)
- ❌ Deezer (not implemented)

## Requirements

- Node.js 18+ (uses native Node.js APIs)
- Sonos S2 system (S1 not supported)
- Network access to Sonos devices

## License

MIT License - see [LICENSE](./LICENSE) file for details.

## Contributing

Contributions are welcome! Please read our [Contributing Guidelines](./CONTRIBUTING.md) first.

### Development

```bash
# Install dependencies
npm install

# Run in development mode (forces LOG_LEVEL=debug, DEBUG_CATEGORIES=all)
npm run dev

# Run tests
npm test

# Run specific test file
npm test -- integration/playback-tests.ts

# Build for production
npm run build
```

### Analysis Tools

The project includes tools for analyzing your Sonos system:

```bash
# Analyze system infrastructure
./analyze-infrastructure.sh [home-name] [api-url]

# Analyze content (favorites, presets, music library)
./analyze-content.sh [home-name] [api-url] [room-name]
```

These tools generate detailed reports in the `homes/` directory documenting your system configuration, device capabilities, and content. The content analyzer creates:
- `content-analysis.md` - Favorites breakdown by type and service
- `preset-validation-results.md` - Preset validation status
- `music-library-analysis.md` - Library statistics and top artists/albums
- `music-library.json` - Complete track database (optimized, pretty-printed with jq)

## Deployment

### Docker Deployment

For detailed Docker deployment instructions, environment variables, and configuration options, see [DOCKER.md](DOCKER.md).

### Security

The API supports optional HTTP Basic Authentication with trusted network bypass:

1. Set credentials in `settings.json`
2. Configure trusted networks (CIDR notation supported)
3. Requests from trusted networks bypass authentication
4. All other requests require authentication

For HTTPS, use a reverse proxy like nginx, Apache, Caddy, or HAProxy. See [deploy/](deploy/) for example nginx and Apache configurations.

## Troubleshooting

- **No devices found**: Ensure the API server is on the same network as your Sonos devices
- **Authentication errors**: Check your credentials and trusted networks configuration
- **Slow music library**: The library indexes on startup; large libraries may take 10-30 seconds
- **Docker networking**: Use `--network host` for SSDP discovery to work

## Support

- 🐛 [Report bugs](https://github.com/kshartman/sonos-http-api/issues)
- 💡 [Request features](https://github.com/kshartman/sonos-http-api/issues)
- 💬 [Discussions](https://github.com/kshartman/sonos-http-api/discussions)