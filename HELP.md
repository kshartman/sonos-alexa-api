# Sonos HTTP API - Help & Usage Guide

This guide covers common usage patterns and important behaviors of the Sonos HTTP API.

## Documentation Overview

For comprehensive information, see these additional documentation files:

- **[README.md](README.md)** - Project overview, features, quick start, and installation
- **[DOCKER.md](DOCKER.md)** - Docker usage, environment variables, and container configuration  
- **[SETTINGS.md](SETTINGS.md)** - Complete configuration reference and settings.json format
- **[PRESETS.md](PRESETS.md)** - Detailed preset creation, multi-room setups, and advanced features
- **[SPOTIFY.md](SPOTIFY.md)** - Spotify integration setup, OAuth2 configuration, and troubleshooting
- **[OpenAPI Spec](apidoc/openapi.yaml)** - Complete API reference with all endpoints and parameters

## Base URL

```
http://localhost:5005
```

## Table of Contents
- [Authentication](#authentication)
- [Basic Playback Control](#basic-playback-control)
- [Volume Control](#volume-control)
- [Group Management](#group-management)
- [Presets](#presets)
- [Default Room](#default-room)
- [Music Search](#music-search)
- [Music Service Integration](#music-service-integration)
- [Favorites](#favorites)
- [Text-to-Speech](#text-to-speech)
- [System Status & Monitoring](#system-status--monitoring)
- [Common Workflows](#common-workflows)
- [Tips & Tricks](#tips--tricks)
- [Common Issues](#common-issues)
- [Debug Mode](#debug-mode)
- [Content Analysis Tool](#content-analysis-tool)
- [Response Format](#response-format)
- [API Documentation](#api-documentation)

## Authentication

Optional HTTP Basic Authentication. Trusted networks bypass auth.

```bash
curl -u username:password http://localhost:5005/zones
```

## Basic Playback Control

```bash
# Play/pause/stop
GET /{room}/play
GET /{room}/pause
GET /{room}/playpause
GET /{room}/stop

# Skip tracks
GET /{room}/next
GET /{room}/previous

# Example
curl http://localhost:5005/Living%20Room/play
```

## Volume Control

```bash
# Set volume (0-100)
GET /{room}/volume/{level}

# Adjust volume
GET /{room}/volume/+{delta}
GET /{room}/volume/-{delta}

# Mute control
GET /{room}/mute
GET /{room}/unmute
GET /{room}/togglemute

# Group volume control
GET /{room}/groupVolume/{level}

# Example: Set living room to 50%
curl http://localhost:5005/Living%20Room/volume/50
```

## Presets

Presets are JSON files that define complex playback scenarios. They can control single or multiple rooms, set volumes, and configure playback modes.

### Single Room Preset
```json
{
  "roomName": "Kitchen",
  "volume": 30,
  "favorite": "Jazz Radio",
  "repeat": "all",
  "shuffle": true
}
```

### Multi-Room Preset
```json
{
  "players": [
    { "roomName": "LivingRoom", "volume": 40 },
    { "roomName": "Kitchen", "volume": 25 },
    { "roomName": "Bedroom", "volume": 20 }
  ],
  "favorite": "Dinner Music",
  "pauseOthers": true
}
```

### Important Multi-Room Behaviors

When a preset contains multiple players, the behavior is:

1. **The first player becomes the group coordinator** (e.g., LivingRoom)
2. **The default room is set to this coordinator**
3. All other players join the coordinator's group
4. **ALL commands now affect the entire group**

#### Example Scenario
After playing a preset with `[LivingRoom, Bedroom, Kitchen]`:
- LivingRoom is the coordinator
- Default room is set to LivingRoom
- All three rooms are grouped together

Now these commands ALL control the entire group:
- `/LivingRoom/pause` - pauses the group (it's the coordinator)
- `/Bedroom/pause` - pauses the group (Bedroom is in the group)
- `/Kitchen/pause` - pauses the group (Kitchen is in the group)
- `/pause` - pauses the group (uses default room = LivingRoom)
- `/volume/30` - sets group volume to 30
- `/next` - skips to next track for the group

**Key Point**: After a multi-room preset, roomless commands conveniently control the entire group!

### Preset Execution Order

1. **pauseOthers** (if true): Pause all rooms not in the preset
2. **Group Formation**: First player becomes coordinator, others join
3. **Volume Setting**: Individual volumes set for each room
4. **Playback**: Start playing the favorite/URI on the group

### Preset Options

- **pauseOthers**: When `true`, pauses all rooms not included in the preset BEFORE grouping
- **sleep**: Sleep timer in seconds (e.g., 3600 = 1 hour)
- **playMode**: Object with `repeat` ("none", "all", "one") and `shuffle` (true/false)
- **crossfade**: Enable/disable crossfade between tracks
- **uri**: Direct URI to play instead of favorite
- **members**: Legacy format - use `players` instead

### Playing Presets

```bash
GET /{room}/preset/{preset}
GET /preset/{preset}  # Uses default room

# Examples
curl http://localhost:5005/preset/morning-jazz
curl http://localhost:5005/Living%20Room/preset/dinner-music
```

### Dynamic Preset Loading

The `presets/` folder is **automatically watched for changes**:
- Add, modify, or delete preset files without restarting
- Changes are detected and loaded immediately
- Invalid presets are logged but don't affect others
- **Perfect for Docker**: Mount the presets folder as a volume and edit externally

Docker example:
```yaml
volumes:
  - ./my-presets:/app/presets
```

Now you can edit presets on your host system and they're instantly available in the container!

## Default Room

The API tracks a "default room" used by roomless endpoints. This is particularly powerful with multi-room presets.

### Setting Default Room
```bash
GET /default/room/Kitchen

# Example
curl http://localhost:5005/default/room/Kitchen
```

### Using Default Room
```bash
GET /play              # Plays in default room
GET /volume/30         # Sets volume in default room
GET /favorite/Jazz     # Plays favorite in default room

# Examples
curl http://localhost:5005/play
curl http://localhost:5005/volume/30
curl http://localhost:5005/preset/morning-jazz
```

### Default Room with Groups
When you play a multi-room preset:
- Default room becomes the group coordinator
- Roomless commands control the entire group
- Very convenient for controlling multi-room audio!

### Default Music Service
```bash
GET /default/service/apple
GET /song/Yesterday    # Searches default service in default room

# Examples
curl http://localhost:5005/default/service/apple
curl http://localhost:5005/song/Yesterday
```

## Music Search

Search and play music from configured services:

### Room-Specific Search
```
GET /{room}/musicsearch/{service}/song/{query}
GET /{room}/musicsearch/{service}/album/{query}
GET /{room}/musicsearch/{service}/station/{query}
```

### Default Room Search
```bash
GET /song/{query}      # Uses default room and service
GET /album/{query}     # Uses default room and service
GET /station/{query}   # Uses default room and service

# Example: Search for Beatles songs
curl http://localhost:5005/song/Yesterday
```

### Library Search
```bash
GET /{room}/musicsearch/library/song/{query}
GET /{room}/musicsearch/library/artist/{query}
GET /{room}/musicsearch/library/album/{query}

# Example: Search library for Beatles songs
curl http://localhost:5005/Living%20Room/musicsearch/library/song/Beatles
```

## Music Service Integration

### Spotify
```bash
# Check auth status
GET /spotify/status

# Play Spotify content (requires Spotify favorites)
GET /{room}/spotify/play/{uri}

# Search (requires OAuth)
GET /{room}/musicsearch/spotify/song/{query}
```

**Authentication Response Example:**
```json
{
  "authenticated": true,
  "hasTokens": true,
  "tokenExpired": false,
  "expiresIn": "45m",
  "message": "Spotify authenticated (token expires in 45m)"
}
```

### Pandora
```bash
# Check auth status
GET /pandora/status

# Play station
GET /{room}/pandora/play/{stationName}

# Thumbs up/down
GET /{room}/pandora/thumbsup
GET /{room}/pandora/thumbsdown
```

**Authentication Response Example:**
```json
{
  "authenticated": true,
  "hasCredentials": true,
  "stationCount": 82,
  "apiStations": 68,
  "cacheAge": "5m ago",
  "message": "Pandora authenticated - 82 stations (68 from API cached 5m ago, 0 from favorites)"
}
```

### Apple Music
```bash
# Search and play (no auth required)
GET /{room}/musicsearch/apple/song/{query}
GET /{room}/musicsearch/apple/album/{query}
```

## Group Management

### Creating Groups
```bash
# Join another room's group
GET /{room}/join/{targetRoom}

# Leave current group
GET /{room}/leave

# Add room to this group
GET /{room}/add/{otherRoom}

# Example: Add Kitchen to Living Room's group
curl http://localhost:5005/Kitchen/join/Living%20Room
```

### Breaking Groups
```bash
GET /{room}/leave                # Leave current group
GET /{room}/ungroup              # Ungroup all speakers
GET /{room}/isolate              # Ungroup and stop all others
```

### Group Volume
```bash
GET /{room}/groupVolume/50       # Set entire group's volume
```

### Group Behavior
- Commands to ANY room in a group affect the ENTIRE group
- The coordinator manages playback for all members
- Individual room volumes are preserved within the group
- Breaking a group returns rooms to independent control

## Favorites

Favorites are saved Sonos items (radio stations, playlists, albums).

### List Favorites
```bash
GET /{room}/favorites            # Full objects
GET /{room}/favorites?simple     # Just names

# Examples
curl http://localhost:5005/Living%20Room/favorites
curl http://localhost:5005/Living%20Room/favorites?simple
```

### Play Favorite
```bash
GET /{room}/favorite/{name}

# Example: Play favorite station
curl http://localhost:5005/Living%20Room/favorite/BBC%20Radio%201
```

Case-insensitive matching is supported - "Jazz Radio" matches "jazz radio".

## Text-to-Speech

```bash
# Say in specific room
GET /{room}/say/{text}
GET /{room}/say/{text}/{volume}

# Say in all rooms
GET /sayall/{text}/{volume}

# Example
curl http://localhost:5005/Kitchen/say/Dinner%20is%20ready/40
```

## System Status & Monitoring

### Quick Status Checks
```bash
# Health check
GET /health

# Get all zones
GET /zones

# Get room state
GET /{room}/state

# Get all devices
GET /devices
```

### Music Library
```bash
# Get library summary
GET /library/summary

# Refresh library index
GET /library/refresh
```

### Debug & Monitoring
```bash
# Server-Sent Events stream
GET /events

# Debug status
GET /debug

# Startup info
GET /debug/startup
```

## Common Workflows

### Morning Routine
```bash
# 1. Group speakers
curl http://localhost:5005/Kitchen/join/Living%20Room

# 2. Set volume
curl http://localhost:5005/Living%20Room/groupVolume/30

# 3. Play preset
curl http://localhost:5005/Living%20Room/preset/morning-news
```

### Party Mode
```bash
# 1. Group all speakers
curl http://localhost:5005/Bedroom/join/Living%20Room
curl http://localhost:5005/Kitchen/join/Living%20Room
curl http://localhost:5005/Office/join/Living%20Room

# 2. Play party playlist
curl http://localhost:5005/Living%20Room/playlist/Party%20Mix

# 3. Set party volume
curl http://localhost:5005/Living%20Room/groupVolume/60
```

### Bedtime
```bash
# 1. Ungroup bedroom
curl http://localhost:5005/Bedroom/leave

# 2. Low volume
curl http://localhost:5005/Bedroom/volume/20

# 3. Play sleep sounds
curl http://localhost:5005/Bedroom/favorite/Sleep%20Sounds

# 4. Set sleep timer (30 minutes)
curl http://localhost:5005/Bedroom/sleep/1800
```

## Tips & Tricks

1. **Preset Coordinator**: Always list your preferred coordinator first in multi-room presets

2. **Convenient Group Control**: After a multi-room preset, use roomless commands to control the whole group

3. **Case Sensitivity**: Room names are case-sensitive, but favorites are matched case-insensitively

4. **Queue-Based URIs**: Some content (playlists, containers) uses queue-based playback

5. **Trusted Networks**: Configure `auth.trustedNetworks` to bypass authentication for specific IPs

6. **Environment Variables**: 
   - `LOGGER=pino` for production JSON logging
   - `DEBUG_CATEGORIES=all` to enable all debug output
   - `NODE_ENV=production` for production mode

7. **URL Encoding**: Room names and text should be URL-encoded (spaces become %20)

8. **Service Authentication**: Check `/spotify/status` and `/pandora/status` for auth state

9. **Real-time Updates**: Use Server-Sent Events (`/events`) for real-time state monitoring

## Common Issues

### "Not Found" Errors
- Check that the room name matches exactly (case-sensitive)
- Verify the favorite exists with `/{room}/favorites`
- Ensure the device is powered on and connected

### Playback Won't Start
- Some content requires clearing the queue first
- Check if the room is grouped with another coordinator
- Verify the music service is configured

### Multi-Room Confusion
- Remember: ANY command to a grouped room affects the whole group
- Use `/zones` to see current grouping
- Default room is set to the coordinator after multi-room presets
- Use `/{room}/leave` to remove a room from a group

### Preset Issues
- First player in the list becomes coordinator - order matters!
- Invalid room names cause the preset to be skipped
- Use `/presets/detailed` to see full preset configuration

### Slow Startup with Many Presets
If startup shows hundreds of preset conversion logs:
```bash
# Option 1: Use default debug categories (recommended)
npm start  # Uses .env settings (api,discovery by default)

# Option 2: Disable preset debug logs explicitly
DEBUG_CATEGORIES=api,discovery npm start

# Option 3: Disable all debug categories
DEBUG_CATEGORIES= npm start
```

The `presets` debug category can generate hundreds of log lines during startup. Enable it only when debugging preset issues:
```bash
DEBUG_CATEGORIES=presets npm start
```

## Debug Mode

Enable debug logging for troubleshooting:

### Check Status
```bash
GET /debug                       # Current debug settings
GET /debug/startup               # Startup information

# Examples
curl http://localhost:5005/debug
curl http://localhost:5005/debug/startup
```

### Enable Debugging
```bash
GET /debug/enable-all            # Enable all categories
GET /debug/level/debug           # Set to debug level
GET /debug/category/soap/true    # Enable specific category

# Examples
curl http://localhost:5005/debug/enable-all
curl http://localhost:5005/debug/level/debug
curl http://localhost:5005/debug/category/soap/true
```

### Debug Categories
- **api**: HTTP request/response logging
- **discovery**: Device discovery events
- **soap**: SOAP requests/responses
- **topology**: Zone topology changes
- **favorites**: Favorite resolution
- **presets**: Preset loading
- **upnp**: UPnP events
- **sse**: Server-sent events

### Log Levels
- **error**: Only errors
- **warn**: Errors and warnings  
- **info**: Normal operation (default)
- **debug**: Detailed debugging
- **trace**: Everything including XML (very verbose)

## Utility Scripts

The API includes several powerful utility scripts for analysis, debugging, and management. All scripts support `--help` for detailed usage.

### Content Analysis Tool

Validates and analyzes your Sonos content:

```bash
./scripts/analyze-content.sh {home-name} {api-url} {room-name}
```

Example:
```bash
./scripts/analyze-content.sh home http://localhost:5005 LivingRoom
./scripts/analyze-content.sh remote http://remote.home:5005 Kitchen
```

Generates reports in `homes/{home-name}/`:
- **`content-analysis.md`** - Favorites breakdown, URI patterns, preset references
- **`preset-validation-results.md`** - Valid/failed presets with specific fixes
- **`music-library-analysis.md`** - Library statistics and top content
- **`music-library.json`** - Optimized JSON export of all tracks

### Infrastructure Analysis

Analyzes your Sonos hardware setup:

```bash
./scripts/analyze-infrastructure.sh {home-name} {api-url}
```

Generates:
- **`infrastructure-analysis.md`** - Device inventory, stereo pairs, network details
- **`device-matrix.md`** - Zone topology and groupings

### Server Management

**Server Summary** - Get comprehensive status:
```bash
./scripts/server-summary.sh [host] [port] [--json]
```

**Debug Management** - Control debug settings remotely:
```bash
./scripts/sonosdebug.sh --level debug --categories all
./scripts/sonosdebug.sh --url http://remote:5005 --level info
```

**Spotify Setup** - OAuth2 authentication helper:
```bash
./scripts/spotify-auth-setup.sh
```

### Diagnostic Tools

**Direct Device Dumps** (connect to Sonos IP directly):
```bash
./scripts/sonosdump.sh 192.168.1.50 --output device-dump.txt
./scripts/pandoradump.sh 192.168.1.50
```

**Build Analysis** - Check version and build info:
```bash
./scripts/analyze-build.sh localhost 5005
```

**Auth Failure Analysis** - Security monitoring:
```bash
./scripts/analyze-auth-failures.sh logs/server.log
```

### Why Use These Tools?

- **Before deploying presets** - verify compatibility across homes
- **Debug playback failures** - identify missing favorites or device issues
- **Monitor system health** - track authentication, build versions, device status
- **Cross-home management** - analyze and compare different Sonos installations
- **Security monitoring** - detect authentication failures and suspicious activity
- **Works remotely** - analyze systems over VPN without local access

## Response Format

All responses follow this structure:

**Success:**
```json
{
  "status": "success",
  "data": { ... }
}
```

**Error:**
```json
{
  "status": "error", 
  "error": "Error message"
}
```

## API Documentation

### OpenAPI/Swagger Documentation
The API is fully documented using OpenAPI 3.0 specification:
- Main spec: `apidoc/openapi.yaml`
- Component definitions: `apidoc/components/`
- Endpoint definitions: `apidoc/paths/`

#### Viewing with Swagger UI
You can use Swagger UI to explore the API interactively:

1. **Online Swagger Editor**:
   - Go to https://editor.swagger.io/
   - Copy the contents of `apidoc/openapi.yaml`
   - Paste into the editor
   - View the interactive documentation on the right

2. **Local Swagger UI** (if you have Docker):
   ```bash
   docker run -p 8080:8080 -e SWAGGER_JSON=/api/openapi.yaml \
     -v $(pwd)/apidoc:/api swaggerapi/swagger-ui
   ```
   Then open http://localhost:8080

3. **VS Code Extension**:
   - Install "OpenAPI (Swagger) Editor" extension
   - Open `apidoc/openapi.yaml`
   - Preview renders automatically

The OpenAPI documentation includes:
- All endpoints with parameters
- Request/response schemas
- Example responses
- Authentication details
- Error codes