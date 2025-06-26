# API Documentation

## Base URL

```
http://localhost:5005
```

## Authentication

If authentication is enabled in `settings.json`, all requests require HTTP Basic Authentication unless coming from a trusted network.

```bash
curl -u username:password http://localhost:5005/zones
```

## System Endpoints

### Get Zones
```
GET /zones
```
Returns all Sonos zones with their members and coordinators.

### Get System State
```
GET /state
```
Returns the state of all rooms in the system.

### Health Check
```
GET /health
```
Returns server health status and device count.

### Get Settings
```
GET /settings
```
Returns current server settings (sanitized).

## Room Control

All room endpoints support URL-encoded room names and are case-insensitive.

### Get Room State
```
GET /{room}/state
```
Returns detailed state including playback, volume, queue, and play modes.

### Playback Control
```
GET /{room}/play
GET /{room}/pause
GET /{room}/playpause
GET /{room}/stop
GET /{room}/next
GET /{room}/previous
```

### Volume Control
```
GET /{room}/volume/{level}     # Set volume (0-100)
GET /{room}/volume/+{delta}     # Increase volume
GET /{room}/volume/-{delta}     # Decrease volume
GET /{room}/mute
GET /{room}/unmute
GET /{room}/togglemute
GET /{room}/groupVolume/{level} # Set volume for entire group
```

### Play Modes
```
GET /{room}/repeat/{on|off}
GET /{room}/shuffle/{on|off}
GET /{room}/crossfade/{on|off}
```

### Sleep Timer
```
GET /{room}/sleep/{seconds}
```

## Group Management

### Join/Leave Groups
```
GET /{room}/join/{targetRoom}   # Join another room's group
GET /{room}/leave               # Leave current group
GET /{room}/ungroup             # Alias for leave
GET /{room}/isolate             # Alias for leave
GET /{room}/add/{otherRoom}     # Add another room to this group
```

## Content Playback

### Favorites
```
GET /{room}/favorites            # List favorites
GET /{room}/favorites?detailed=true  # Detailed favorite info
GET /{room}/favorite/{name}      # Play favorite by name
```

### Playlists
```
GET /{room}/playlists            # List playlists
GET /{room}/playlists?detailed=true  # Detailed playlist info
GET /{room}/playlist/{name}      # Play playlist by name
```

### Presets
```
GET /presets                     # List all presets
GET /{room}/preset/{preset}      # Play preset in room
GET /preset/{preset}             # Play preset in default room
```

### Line-In
```
GET /{room}/linein              # Play line-in from same room
GET /{room}/linein/{source}     # Play line-in from source room
```

## Music Search

### Room-specific search
```
GET /{room}/musicsearch/{service}/{type}/{query}
```

### Default room search
```
GET /song/{query}               # Search songs in library
GET /album/{query}              # Search albums in library
GET /station/{query}            # Search stations (Apple Music)
```

Parameters:
- `service`: `library`, `apple`, `pandora`
- `type`: `song`, `album`, `station`, `artist`
- `query`: Search term (URL encoded)

## Queue Management

```
GET /{room}/queue               # Get queue (default 500 items)
GET /{room}/queue/{limit}       # Get queue with limit
GET /{room}/queue/{limit}/{offset}  # Get queue with pagination
GET /{room}/queue/detailed      # Get detailed queue info
GET /{room}/clearqueue          # Clear the queue
```

## Text-to-Speech

```
GET /{room}/say/{text}          # Announce in room
GET /{room}/say/{text}/{volume} # Announce with specific volume
GET /{room}/sayall/{text}       # Announce in all rooms
GET /{room}/sayall/{text}/{volume}  # Announce in all with volume
GET /{room}/saypreset/{preset}/{text}  # Announce to preset rooms
```

Supported languages with `lang` parameter:
- `en`, `de`, `fr`, `es`, `it`, `nl`, `ru`, `pt`, etc.

## Global Commands

```
GET /pauseall                   # Pause all rooms
GET /resumeall                  # Resume all rooms
```

## Default Room

```
GET /default                    # Get default settings
GET /default/room/{room}        # Set default room
```

## Debug & Monitoring

```
GET /debug                      # Get debug status
GET /debug/level/{level}        # Set debug level
GET /debug/category/{category}/{true|false}  # Toggle category
GET /debug/enable-all           # Enable all categories
GET /debug/disable-all          # Disable all categories
```

## Server-Sent Events

```
GET /events                     # SSE stream of system events
```

Event types:
- `transport-state`
- `volume-change`
- `mute-change`
- `topology-change`
- `favorites-update`
- `queue-change`

## Response Format

All endpoints return JSON with this structure:

### Success Response
```json
{
  "status": 200,
  "body": {
    // Response data
  }
}
```

### Error Response
```json
{
  "status": 400,
  "error": "Error message"
}
```

## Examples

### Play music in Living Room
```bash
curl http://localhost:5005/Living%20Room/play
```

### Set volume to 50
```bash
curl http://localhost:5005/Living%20Room/volume/50
```

### Play a favorite
```bash
curl http://localhost:5005/Living%20Room/favorite/My%20Favorite%20Station
```

### Search for Beatles songs
```bash
curl http://localhost:5005/Living%20Room/musicsearch/library/song/Beatles
```

### Join speakers
```bash
curl http://localhost:5005/Kitchen/join/Living%20Room
```

### Text-to-Speech announcement
```bash
curl http://localhost:5005/Living%20Room/say/Dinner%20is%20ready/40
```