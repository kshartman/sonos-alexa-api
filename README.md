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

## Performance

Typical response times:
- Play/pause commands: <100ms
- Volume changes: <100ms  
- Music search: <200ms
- Group operations: <150ms

## Quick Start

### Docker (Recommended)

```bash
# Build the image
docker build -t sonos-http-api .

# Run with environment variables
docker run -d \
  --name sonos-http-api \
  --network host \
  -e PORT=5005 \
  -e DEFAULT_ROOM=LivingRoom \
  -v ./presets:/app/presets \
  sonos-http-api:latest

# Or use an env file
docker run -d \
  --name sonos-http-api \
  --network host \
  --env-file .env \
  -v ./presets:/app/presets \
  sonos-http-api:latest
```

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
HOST=0.0.0.0                     # Display name only - server always listens on 0.0.0.0
TTS_HOST_IP=192.168.1.100        # Your server's IP for TTS (auto-detected if not set)

# Logging & Debug
LOG_LEVEL=info                    # error, warn, info, debug, trace
DEBUG_CATEGORIES=api,discovery    # api,discovery,soap,topology,favorites,presets,upnp,sse,all

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

### settings.json (Alternative)

For complex configurations, you can use `settings.json`:

```json
{
  "port": 5005,
  "host": "0.0.0.0",
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
- ❌ Spotify (requires OAuth2 - PRs welcome!)
- ❌ SiriusXM (no public API)
- ❌ Amazon Music (no public API)
- ❌ Deezer (not implemented)

## Requirements

- Node.js 20+ 
- Sonos S2 system (S1 untested)
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

## Deployment

### Docker Compose

```bash
# Copy and configure the environment file
cp .env.example .env
# Edit .env to set your preferences

# Start the container
docker-compose up -d

# View logs
docker-compose logs -f
```

#### Environment Variables

The Docker container supports configuration via `.env` file:

```bash
# API server port
PORT=5005

# REQUIRED for Docker: Host IP for TTS URLs
# Sonos devices need this IP to download TTS audio files
TTS_HOST_IP=192.168.1.100   # Your Docker host's IP address

# External preset directory (optional)
HOST_PRESET_PATH=/path/to/your/presets

# Logging configuration
LOG_LEVEL=info              # error, warn, info, debug
LOGGER=pino                 # winston or pino (winston for dev, pino for prod)
DEBUG_LEVEL=debug           # error, warn, info, debug, trace
DEBUG_CATEGORIES=api,soap   # soap, topology, discovery, favorites, presets, upnp, api, sse
```

**Important**: The `TTS_HOST_IP` must be set to an IP address that your Sonos devices can reach. This is typically your Docker host's IP on your local network (not `localhost` or `127.0.0.1`).

#### Custom docker-compose.yml

```yaml
services:
  sonos-http-api:
    build: .
    container_name: sonos-http-api
    network_mode: host
    restart: unless-stopped
    environment:
      - TTS_HOST_IP=${TTS_HOST_IP}  # REQUIRED: Set in .env file
      - LOG_LEVEL=${LOG_LEVEL:-info}
      - DEBUG_CATEGORIES=${DEBUG_CATEGORIES:-}
    volumes:
      - ./settings.json:/app/settings.json:ro
      - ${HOST_PRESET_PATH:-./presets}:/app/presets:ro
    logging:
      driver: "json-file"
      options:
        max-size: "20m"
        max-file: "10"
```

### Security

The API supports optional HTTP Basic Authentication with trusted network bypass:

1. Set credentials in `settings.json`
2. Configure trusted networks (CIDR notation supported)
3. Requests from trusted networks bypass authentication
4. All other requests require authentication

For HTTPS, use a reverse proxy like nginx, Caddy, or HAProxy.

## Troubleshooting

- **No devices found**: Ensure the API server is on the same network as your Sonos devices
- **Authentication errors**: Check your credentials and trusted networks configuration
- **Slow music library**: The library indexes on startup; large libraries may take 10-30 seconds
- **Docker networking**: Use `--network host` for SSDP discovery to work

## Support

- 🐛 [Report bugs](https://github.com/kshartman/sonos-http-api/issues)
- 💡 [Request features](https://github.com/kshartman/sonos-http-api/issues)
- 💬 [Discussions](https://github.com/kshartman/sonos-http-api/discussions)