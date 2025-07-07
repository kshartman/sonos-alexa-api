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

### Get Device Information
```
GET /devices
```
Returns all devices with model information and pairing status.

```
GET /devices/id/{deviceId}
```
Returns specific device by ID (with or without uuid: prefix).

```
GET /devices/room/{roomName}
```
Returns all devices in a specific room (useful for stereo pairs).

Example response:
```json
[
  {
    "room": "BedroomSpeakers",
    "name": "BedroomSpeakers",
    "id": "uuid:RINCON_F0F6C1AF852C01400",
    "model": "Sonos Era 100",
    "ip": "192.168.4.76",
    "paired": {
      "role": "left",
      "groupId": "BedroomSpeakers:stereopair"
    }
  }
]
```

### Get Settings
```
GET /settings
```
Returns current server settings (sanitized).

### Get Music Services
```
GET /services
```
Returns all available music services configured in the Sonos system. Results are cached for 24 hours.

Example response:
```json
{
  "254": {
    "id": 254,
    "name": "TuneIn",
    "internalName": "TuneIn",
    "uri": "https://legato.radiotime.com/Radio.asmx",
    "type": "tunein",
    "isTuneIn": true,
    "isPersonalized": false
  },
  "9223": {
    "id": 9223,
    "name": "HEARTS of SPACE",
    "type": "unknown",
    "isTuneIn": false,
    "isPersonalized": false
  }
}
```

### Refresh Music Services
```
GET /services/refresh
```
Manually refresh the services cache. Returns refresh status.

Example response:
```json
{
  "message": "Services cache refreshed successfully",
  "serviceCount": 101,
  "lastRefresh": "2025-06-30T08:03:31.670Z"
}
```

## Music Library

### Get Library Status
```
GET /library/index
```
Returns indexing status and metadata including track counts.

### Refresh Library Index
```
GET /library/refresh
```
Triggers a manual re-index of the music library.

### Get Library Summary
```
GET /library/summary
```
Returns library overview with top artists and albums by track count.

### Get Detailed Library Data
```
GET /library/detailed
```
Returns complete track, artist, and album data. Warning: Can be a large response.

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
GET /{room}/favorites            # List favorite titles only
GET /{room}/favorites/detailed   # List favorites with full details
GET /{room}/favorite/{name}      # Play favorite by name
```

### Playlists
```
GET /{room}/playlists            # List playlist titles only
GET /{room}/playlists/detailed   # List playlists with full details
GET /{room}/playlist/{name}      # Play playlist by name
```

### Presets
```
GET /presets                     # List preset names only
GET /presets/detailed            # List presets with full details
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
GET /song/{query}               # Search songs (uses default service)
GET /album/{query}              # Search albums (uses default service)
GET /artist/{query}             # Search artists (uses default service)
GET /station/{query}            # Search stations (uses default service)
```

Parameters:
- `service`: `library`, `apple`, `spotify`, `pandora`
- `type`: `song`, `album`, `station`, `artist`
- `query`: Search term (URL encoded)

**Note**: `artist` search behavior varies by service:
- **Spotify/Apple**: Plays artist radio station
- **Pandora**: Searches for Pandora stations (not limited to artists)
- **Library**: Queues random tracks by artist (up to `LIBRARY_RANDOM_QUEUE_LIMIT`)

## Service-Specific Endpoints

### Apple Music
```
GET /{room}/applemusic/{action}/{id}
```
- `action`: `now`, `next`, `queue`
- `id`: Apple Music ID

### Spotify

#### Playback
```
GET /{room}/spotify/play/{id}     # Play Spotify content by ID
```
- `id`: Spotify URI (e.g., `spotify:track:123`, `spotify:album:456`, `spotify:playlist:789`)

#### Authentication
```
GET /spotify/auth               # Start OAuth flow (browser-based)
GET /spotify/callback           # OAuth callback (handled automatically)
POST /spotify/callback-url      # Submit callback URL (headless auth)
GET /spotify/status             # Check authentication status
```

#### Search (requires authentication)
```
GET /{room}/musicsearch/spotify/song/{query}    # Search songs
GET /{room}/musicsearch/spotify/album/{query}   # Search albums
GET /{room}/musicsearch/spotify/artist/{query}  # Search artists (plays artist radio)
GET /{room}/musicsearch/spotify/station/{query} # Search stations (same as artist)
```

### Pandora
```
GET /{room}/pandora/play/{name}        # Play Pandora station
GET /{room}/pandora/stations           # List Pandora stations (names only)
GET /{room}/pandora/stations/detailed  # List Pandora stations with full info
GET /{room}/pandora/thumbsup           # Thumbs up current track
GET /{room}/pandora/thumbsdown         # Thumbs down current track
```

**Note**: Pandora station discovery works best when stations are added as Sonos favorites. The API will attempt to use Pandora credentials if configured, but falls back to browsing favorites when the API is unavailable.

### SiriusXM
```
GET /{room}/siriusxm/{name}       # Play SiriusXM channel (NOT IMPLEMENTED)
```

## Queue Management

```
GET /{room}/queue               # Get queue (default 500 items)
GET /{room}/queue/{limit}       # Get queue with limit
GET /{room}/queue/{limit}/{offset}  # Get queue with pagination
GET /{room}/queue/detailed      # Get detailed queue info
POST /{room}/queue              # Add items to queue
GET /{room}/clearqueue          # Clear the queue
```

## Text-to-Speech

```
GET /{room}/say/{text}          # Announce in room
GET /{room}/say/{text}/{volume} # Announce with specific volume
GET /{room}/sayall/{text}       # Announce in room's group
GET /{room}/sayall/{text}/{volume}  # Announce in room's group with volume
GET /sayall/{text}              # Announce in all rooms
GET /sayall/{text}/{volume}     # Announce in all rooms with volume
GET /{room}/saypreset/{preset}/{text}  # Announce to preset rooms
```

Supported languages with `lang` parameter:
- `en`, `de`, `fr`, `es`, `it`, `nl`, `ru`, `pt`, etc.

## Global Commands

```
GET /pauseall                   # Pause all rooms
GET /resumeall                  # Resume all rooms
```

## Default Settings

```
GET /default                    # Get current default room and service
GET /default/room/{room}        # Set default room
GET /default/service/{service}  # Set default music service
```

The default room is used for room-less endpoints like `/play`, `/pause`, `/volume/{level}`, etc.
The default service is used for room-less music search endpoints like `/song/{query}`, `/album/{query}`, etc.

### Room-less Playback Endpoints (use default room)
```
GET /play                       # Play in default room
GET /pause                      # Pause in default room
GET /volume/{level}             # Set volume in default room
GET /preset/{preset}            # Play preset in default room
GET /preset/{preset}/room/{room}  # Play preset in specific room
```

## Debug & Monitoring

```
GET /debug                      # Get debug status
GET /debug/level/{level}        # Set debug level (error, warn, info, debug, trace)
GET /debug/category/{category}/{true|false}  # Toggle category
GET /debug/enable-all           # Enable all categories
GET /debug/disable-all          # Disable all categories
GET /debug/startup              # Get startup info (version, config, presets)
GET /debug/startup/config       # Get startup configuration with version
GET /debug/subscriptions        # Get UPnP subscription status
GET /debug/device-health        # Get device event health monitoring
GET /loglevel/{level}           # Set log level (error, warn, info, debug, trace)
```

### Spotify Debug Endpoints
```
GET /debug/spotify/parse/{input}    # Parse Spotify URL/URI
GET /debug/spotify/browse/{room}/{sid}  # Browse Spotify service
GET /debug/spotify/account/{room}   # Get Spotify account info
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

### Get music library summary
```bash
curl http://localhost:5005/library/summary
```