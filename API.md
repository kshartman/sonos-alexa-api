# API Quick Reference

This guide covers the most common API endpoints and usage patterns. For complete API documentation, see the [OpenAPI specification](./apidoc/openapi.yaml).

## Base URL

```
http://localhost:5005
```

## Authentication

Optional HTTP Basic Authentication. Trusted networks bypass auth.

```bash
curl -u username:password http://localhost:5005/zones
```

## Common Use Cases

### 1. Basic Playback Control

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

### 2. Volume Control

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

# Example: Set living room to 50%
curl http://localhost:5005/Living%20Room/volume/50
```

### 3. Group Management

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

### 4. Playing Content

#### Favorites
```bash
GET /{room}/favorite/{name}

# Example: Play favorite station
curl http://localhost:5005/Living%20Room/favorite/BBC%20Radio%201
```

#### Presets
```bash
GET /{room}/preset/{preset}
GET /preset/{preset}  # Uses default room

# Example
curl http://localhost:5005/preset/morning-jazz
```

#### Music Search
```bash
# Room-specific search
GET /{room}/musicsearch/{service}/{type}/{query}

# Default room search
GET /song/{query}
GET /album/{query}
GET /station/{query}

# Example: Search for Beatles songs
curl http://localhost:5005/Living%20Room/musicsearch/library/song/Beatles
```

### 5. Text-to-Speech

```bash
# Say in specific room
GET /{room}/say/{text}
GET /{room}/say/{text}/{volume}

# Say in all rooms
GET /sayall/{text}/{volume}

# Example
curl http://localhost:5005/Kitchen/say/Dinner%20is%20ready/40
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

## Default Room Configuration

Set a default room to use room-less endpoints:

```bash
# Set default room
GET /default/room/{room}

# Then use simplified commands
GET /play
GET /pause
GET /volume/{level}
GET /preset/{preset}
```

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

## Tips

- Room names are case-insensitive and should be URL-encoded
- Use `/zones` to discover available rooms
- Check `/debug/startup` for configuration and system status
- Monitor authentication with `/spotify/status` and `/pandora/status`
- Use Server-Sent Events (`/events`) for real-time updates

For complete endpoint documentation, request/response schemas, and advanced features, see the [OpenAPI specification](./apidoc/openapi.yaml).