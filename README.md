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
docker run -d \
  --name sonos-http-api \
  --network host \
  -v ./settings.json:/app/settings.json:ro \
  sonos-http-api:latest
```

### Local Development

```bash
npm install
npm start
```

## Configuration

Copy `settings.json.example` to `settings.json` and customize:

```json
{
  "port": 5005,
  "host": "your-hostname-or-ip",
  "defaultRoom": "Living Room",
  "defaultMusicService": "library",
  "announceVolume": 40,
  
  "auth": {
    "username": "your-username",
    "password": "your-password",
    "rejectUnauthorized": true,
    "trustedNetworks": [
      "192.168.1.0/24",
      "10.0.0.0/24",
      "127.0.0.1"
    ]
  },
  
  "voicerss": "your-voicerss-api-key",
  
  "macSay": {
    "voice": "Alex",
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

# Run in development mode
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
# Using the provided docker-compose file
docker-compose -f docker-compose.public.yml up -d

# Or create your own docker-compose.yml
```

```yaml
services:
  sonos-http-api:
    build: .
    container_name: sonos-http-api
    network_mode: host
    restart: unless-stopped
    volumes:
      - ./settings.json:/app/settings.json:ro
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