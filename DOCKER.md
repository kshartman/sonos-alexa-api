# Docker Image Usage

The Sonos Alexa API is available as a public Docker image for `linux/amd64`.

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
- `v1.8.0`, `v1.7.1`, etc. - Specific version releases

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
- `/app/data` - Persistent state: default room/service, Spotify tokens, TTS cache, music library index

Everything the container writes goes under `/app/data`. Mount it if you want that state to survive container replacement; otherwise it is recreated as needed. Logs go to stdout/stderr for Docker log management.

## Container User

The container runs as a non-root user. As of v1.8.0 the published image uses **uid/gid 2128:2128** (earlier images used 1001, with the group incorrectly set to 65533/`nogroup`).

If you mount `/app/data`, the host directory must be writable by that user:

```bash
sudo chown -R 2128:2128 /path/to/your/data
```

Or override the runtime user instead, which needs no rebuild and works with any host ownership:

```yaml
services:
  sonos-api:
    image: kshartman/sonos-alexa-api:latest
    user: "1001:1001"
```

To check what an image uses:

```bash
docker inspect --format '{{.Config.User}}' kshartman/sonos-alexa-api:latest
```

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

### Build Arguments

When building from source, the runtime user is configurable:

| Build arg | Default | Purpose |
|---|---|---|
| `APP_UID` | `1000` | uid the container process runs as |
| `APP_GID` | `1000` | gid the container process runs as |
| `PORT` | `5005` | Port exposed by the image |
| `VERSION` | `latest` | Value for the OCI version label |

```bash
docker build --build-arg APP_UID=1001 --build-arg APP_GID=1001 -t my-sonos-api .
```

If the requested ids already exist in the base image, the build reuses that account rather than failing — uid 1000 is `node` in `node:22-alpine`, so the default produces an image running as `node`. The project's own build scripts (`docker-build.sh`, `docker-build-local.sh`) default to `2128:2128` and honor `APP_UID`/`APP_GID` from the environment:

```bash
APP_UID=1000 APP_GID=1000 ./docker-build.sh
```

## Architecture

The published image is **`linux/amd64` only**, by choice. There is no manifest list,
so Docker cannot select a matching architecture — pulling on ARM hardware (Raspberry
Pi, Apple Silicon) will either fail to find a manifest or produce an exec format error.

Nothing in the project prevents an arm64 build; it simply isn't published. Build from
source on the target machine:

```bash
git clone https://github.com/kshartman/sonos-alexa-api.git
cd sonos-alexa-api
docker build -t sonos-alexa-api:local .
```

The base image (`node:22-alpine`) is multi-architecture, so a native build works
without changes.

## Troubleshooting

### Discovery Issues
If devices aren't discovered:
1. Ensure `--network host` is used
2. Check firewall rules for UDP port 1900 (SSDP)
3. Verify Sonos devices are on the same network

### Permission Issues
The container runs as a non-root user (uid/gid 2128:2128 as of v1.8.0, 1001 before that). Ensure mounted volumes are writable by it:
```bash
sudo chown -R 2128:2128 ./data ./logs ./presets
```

If you cannot change host ownership, override the runtime user instead — see [Container User](#container-user).

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