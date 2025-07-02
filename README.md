# Sonos HTTP API

A modern, high-performance HTTP API for controlling Sonos speakers, designed for Alexa skill integration and home automation.

This is a complete TypeScript rewrite of the original [node-sonos-http-api](https://github.com/jishi/node-sonos-http-api), focused on speed, reliability, and minimal dependencies.

## Key Features

- ⚡ **Lightning fast** - Near-instant response times using native Node.js HTTP
- 🎯 **Alexa-ready** - Drop-in replacement for jishi's node-sonos-http-api  
- 📦 **Minimal dependencies** - Just 2 runtime dependencies vs 50+ in legacy
- 🔍 **TypeScript** - Full type safety and modern JavaScript features
- 🐳 **Docker-first** - Production-ready container with health checks
- 🎵 **Music services** - Apple Music, Pandora, local library search
- 🔊 **TTS support** - Multiple text-to-speech providers
- 🏠 **Group control** - Manage speaker groups and stereo pairs
- 📊 **96% test coverage** - Comprehensive test suite
- 🔐 **Secure** - Optional authentication with trusted network support

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

## Quick Start

### Docker (Recommended)

```bash
# Quick start with Docker
docker run -d \
  --name sonos-api \
  --network host \
  -e DEFAULT_ROOM="Living Room" \
  kshartman/sonos-alexa-api:latest

# Or using Docker Compose (recommended)
curl -O https://raw.githubusercontent.com/kshartman/sonos-alexa-api/main/docker-compose.example.yml
mv docker-compose.example.yml docker-compose.yml
# Edit docker-compose.yml with your settings
docker-compose up -d

# View logs
docker logs -f sonos-api
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
```

See `example.env` for all available options.

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

See the [API documentation](./API.md) for a complete list of endpoints.

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
- ⚡ Spotify (Phase 1: Direct playback ✅, Search requires OAuth2)
- ❌ SiriusXM (no public API)
- ❌ Amazon Music (no public API)
- ❌ Deezer (not implemented)

## Requirements

- Node.js 20+ 
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