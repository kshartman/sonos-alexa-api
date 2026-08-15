# Sonos Alexa API

Modern TypeScript Sonos HTTP API designed for Alexa skill integration with minimal dependencies.

## Quick Start

```bash
docker run -d \
  --name sonos-api \
  --network host \
  -e DEFAULT_ROOM="Living Room" \
  -e LOG_LEVEL=info \
  kshartman/sonos-alexa-api:latest
```

## Features

- 🎵 Full Sonos control (play, pause, volume, grouping, etc.)
- 🎤 Text-to-speech announcements with multiple providers
- 🔍 Music search (Apple Music, Pandora, local library)
- 📻 Preset support for favorites and playlists
- 🏠 Multi-room audio support
- 🔐 Optional authentication
- 📊 Real-time state updates via SSE
- 🐳 Lightweight Alpine Linux container (~170MB)

## Configuration

All configuration is done via environment variables. See the full list:

### Basic Settings
- `PORT` - API port (default: 5005)
- `DEFAULT_ROOM` - Default room name
- `DEFAULT_MUSIC_SERVICE` - Default music service
- `LOG_LEVEL` - Logging level (error/warn/info/debug)

### TTS Settings
- `TTS_PROVIDER` - TTS provider (voicerss/google/macsay)
- `TTS_LANG` - Language code (default: en-us)
- `VOICERSS_KEY` - VoiceRSS API key (if using VoiceRSS)

### Authentication
- `AUTH_USERNAME` - Basic auth username
- `AUTH_PASSWORD` - Basic auth password

## Docker Compose

```yaml
services:
  sonos-api:
    image: kshartman/sonos-alexa-api:latest
    container_name: sonos-api
    network_mode: host
    environment:
      - DEFAULT_ROOM=Living Room
      - LOG_LEVEL=info
      - TTS_PROVIDER=google
    volumes:
      - ./presets:/app/presets:ro
    restart: unless-stopped
```

## Documentation

- [GitHub Repository](https://github.com/kshartman/sonos-alexa-api)
- [Full Documentation](https://github.com/kshartman/sonos-alexa-api/blob/main/DOCKER.md)
- [API Reference](https://github.com/kshartman/sonos-alexa-api/blob/main/README.md)

## Notes

- Host networking (`--network host`) is required for SSDP discovery
- The container runs as a non-root user, uid/gid `2128:2128` (uid 1001 in releases before v1.8.0). If you mount `/app/data`, chown it to match, or override with `user: "1001:1001"` in compose
- Everything the container writes goes under `/app/data` — mount it to persist defaults, tokens, TTS cache, and the library index
- Health check endpoint available at `/health`
- `linux/amd64` only, by choice — arm64 (Apple Silicon, Raspberry Pi 4/5) builds fine from source, it just isn't published. The `node:22-alpine` base is multi-arch, so a native build works unchanged

## License

MIT License - See [LICENSE](https://github.com/kshartman/sonos-alexa-api/blob/main/LICENSE) for details

## Credits

- Original concept by [jishi](https://github.com/jishi/node-sonos-http-api)
- Modern rewrite by Shane Hartman with Claude (Anthropic)