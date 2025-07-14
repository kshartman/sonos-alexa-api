# Docker Image Usage

The Sonos Alexa API is available as a public Docker image with multi-architecture support (amd64, arm64, arm/v7).

**Docker Hub**: [`kshartman/sonos-alexa-api`](https://hub.docker.com/r/kshartman/sonos-alexa-api)

## Quick Start

```bash
# Basic usage - discovers all Sonos devices on your network
docker run -d \
  --name sonos-api \
  --network host \
  kshartman/sonos-alexa-api:latest

# With configuration and presets
docker run -d \
  --name sonos-api \
  --network host \
  -v $(pwd)/presets:/app/presets:ro \
  -e DEFAULT_ROOM="Living Room" \
  -e LOG_LEVEL=info \
  kshartman/sonos-alexa-api:latest
```

> **Note**: `--network host` is required for SSDP discovery to work properly.

## Available Tags

- `latest` - Latest stable release
- `v1.6.0`, `v1.5.0`, etc. - Specific version releases

Docker Hub: `kshartman/sonos-alexa-api`

## Environment Variables

All configuration can be done via environment variables:

### Core Settings
- `PORT` - API server port (default: 5005)
- `LOG_LEVEL` - Log level: error, warn, info, debug, trace (default: info)
- `LOGGER` - Logger type: winston or pino (default: winston for dev, pino for prod)
- `NODE_ENV` - Environment: development or production (default: production in Docker)

### Debug Settings
- `DEBUG_LEVEL` - Debug verbosity: error, warn, info, debug, trace (default: info) - Note: This is now effectively the same as LOG_LEVEL
- `DEBUG_CATEGORIES` - Debug categories: soap, topology, discovery, favorites, presets, upnp, api, sse, or "all"

### Default Configuration
- `DEFAULT_ROOM` - Default room name for commands without room parameter
- `DEFAULT_MUSIC_SERVICE` - Default music service (e.g., "apple")

### Feature Flags
- `CREATE_DEFAULT_PRESETS` - Auto-generate default presets on startup (default: false)

### Authentication
- `AUTH_USERNAME` - HTTP Basic Auth username
- `AUTH_PASSWORD` - HTTP Basic Auth password
- `AUTH_REJECT_UNAUTHORIZED` - Set to "false" to disable auth check
- `AUTH_TRUSTED_NETWORKS` - Comma-separated list of trusted networks (e.g., "192.168.1.0/24,10.0.0.0/8")

### TTS Configuration
- `TTS_PROVIDER` - TTS provider: voicerss, google, or macos
- `TTS_LANG` - TTS language code (default: en-us)
- `VOICERSS_KEY` - VoiceRSS API key (if using VoiceRSS)

### Music Library
- `LIBRARY_REINDEX_INTERVAL` - Auto-reindex interval (e.g., "1 week", "2 days", "24 hours")

### Pandora Integration
- `PANDORA_USERNAME` - Pandora account username
- `PANDORA_PASSWORD` - Pandora account password

## Volume Mounts

### Optional Volumes
- `/app/presets` - Preset JSON files (read-only)
- `/app/data` - Persistent defaults (only if you want to save default room/service across restarts)

All caches (TTS, music library) are stored inside the container and recreated as needed. Logs go to stdout/stderr for Docker log management.

## Docker Compose Example

A complete example is available at [`docker-compose.example.yml`](https://github.com/kshartman/sonos-alexa-api/blob/main/docker-compose.example.yml).

```yaml
version: '3.8'

services:
  sonos-api:
    image: kshartman/sonos-alexa-api:latest
    container_name: sonos-api
    network_mode: host
    restart: unless-stopped
    environment:
      - PORT=5005
      - LOG_LEVEL=info
      - DEFAULT_ROOM=Living Room
      - DEFAULT_MUSIC_SERVICE=apple
      - AUTH_USERNAME=${AUTH_USERNAME}
      - AUTH_PASSWORD=${AUTH_PASSWORD}
      - AUTH_TRUSTED_NETWORKS=192.168.1.0/24,127.0.0.1
      - TTS_PROVIDER=google
      - CREATE_DEFAULT_PRESETS=true
    volumes:
      - ./presets:/app/presets:ro
      # Optional: persist default room/service across restarts
      # - ./data:/app/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:5005/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 3s
      retries: 3
```

## Using with .env File

Create a `.env` file in the same directory as your `docker-compose.yml`:

```env
# Authentication
AUTH_USERNAME=admin
AUTH_PASSWORD=your-secure-password

# Defaults
DEFAULT_ROOM=Living Room
DEFAULT_MUSIC_SERVICE=apple

# Logging
LOG_LEVEL=info
DEBUG_LEVEL=info
DEBUG_CATEGORIES=api,discovery

# TTS
TTS_PROVIDER=google
TTS_LANG=en-us

# Pandora (optional)
PANDORA_USERNAME=your-email@example.com
PANDORA_PASSWORD=your-pandora-password
```

## Network Configuration

The API requires host networking for SSDP discovery. If you need to use bridge networking:

1. Map the API port: `-p 5005:5005`
2. Set up static discovery by creating a `topology.json` file
3. Mount it: `-v $(pwd)/topology.json:/app/topology.json`

Example topology.json:
```json
{
  "zones": [
    {
      "coordinator": "192.168.1.100",
      "roomName": "Living Room",
      "uuid": "RINCON_B8E937583C3A01400"
    }
  ]
}
```

## Building Custom Images

To build your own image with custom presets:

```dockerfile
FROM kshartman/sonos-alexa-api:latest

# Copy your custom presets
COPY my-presets/*.json /app/presets/

# Copy custom settings
COPY my-settings.json /app/settings.json
```

Build and run:
```bash
docker build -t my-sonos-api .
docker run -d --name sonos-api --network host my-sonos-api
```

## Multi-Architecture Support

Images are built for multiple architectures:
- `linux/amd64` - Standard x86_64 systems
- `linux/arm64` - 64-bit ARM (Raspberry Pi 4, Apple Silicon)
- `linux/arm/v7` - 32-bit ARM (Raspberry Pi 3)

Docker will automatically pull the correct architecture for your system.

## Troubleshooting

### Discovery Issues
If devices aren't discovered:
1. Ensure `--network host` is used
2. Check firewall rules for UDP port 1900 (SSDP)
3. Verify Sonos devices are on the same network

### Permission Issues
The container runs as non-root user (UID 1001). Ensure mounted volumes have appropriate permissions:
```bash
sudo chown -R 1001:1001 ./data ./logs ./presets
```

### Debug Mode
Enable debug logging to troubleshoot:
```bash
docker run -d \
  --name sonos-api \
  --network host \
  -e LOG_LEVEL=debug \
  -e DEBUG_LEVEL=debug \
  -e DEBUG_CATEGORIES=all \
  kshartman/sonos-alexa-api:latest
```

View logs:
```bash
docker logs -f sonos-api
```

## Security Considerations

1. Always use authentication in production:
   - Set `AUTH_USERNAME` and `AUTH_PASSWORD`
   - Configure `AUTH_TRUSTED_NETWORKS` for internal networks

2. Use secrets management for sensitive data:
   ```yaml
   environment:
     - AUTH_USERNAME_FILE=/run/secrets/auth_username
     - AUTH_PASSWORD_FILE=/run/secrets/auth_password
   ```

3. Run behind a reverse proxy (nginx/Apache/traefik) for:
   - SSL/TLS termination
   - Additional security headers
   - Rate limiting
   - See [deploy/](https://github.com/kshartman/sonos-alexa-api/tree/main/deploy) for nginx and Apache example configurations

## Updates

Pull the latest image:
```bash
docker pull kshartman/sonos-alexa-api:latest
docker stop sonos-api
docker rm sonos-api
# Run with same parameters as before
```

Or with docker-compose:
```bash
docker-compose pull
docker-compose up -d
```