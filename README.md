# Sonos Alexa API

A lightweight, modern implementation of a Sonos HTTP API designed for Alexa integration with minimal dependencies.

## Acknowledgments

This code depends heavily on Jishi's excellent work ([node-sonos-http-api](https://jishi.github.io/node-sonos-http-api/) and [node-sonos-discovery](https://jishi.github.io/node-sonos-discovery)) which I used for many years to implement an Alexa skill to control the speakers in my homes. In many ways, I still think it is better than the official Sonos skill or the Sonos Voice Control built into some devices.

I was annoyed with the supply chain of these packages, so I decided to use Claude to implement a drop-in replacement with minimal dependencies. That means it will support Pandora, for example, but not Deezer or Apple Music but not Spotify like the original did. I don't care about these services because I don't have them and won't pay for them. I also don't care or test if this works with an S1 system.  I use S2 and the olderst speakers I have are One's and Five's.  The rest are ERA 100, 300, Move or Roam. If you can use the code but need these features, then fork it and have a go. 

I may respond to bug and feature requests if they affect me or I may not. I am retired and have better things to do than support changes in a package that works perfectly well for me.  That said, if you want chabges to support an Arc with subs and Atmos speakers, feel free to send me such a system and I will make it work lol.

*Shane and Claude ;)*

## Features

- Zero external HTTP framework dependencies (uses Node.js built-in `http`)
- Modern ES modules and async/await
- TypeScript with strict type checking
- Minimal dependencies (only `winston` for logging and `fast-xml-parser` for SOAP)
- Docker support with multi-stage builds
- Health checks and graceful shutdown
- Webhook and Server-Sent Events support
- UPnP topology tracking for multi-room coordination
- Automatic device discovery via SSDP
- Preset support with legacy format compatibility
- Favorites resolution from Sonos system
- Comprehensive debug system with categorized logging
- Default room tracking with persistence
- Text-to-Speech (TTS) with multiple providers
- Optional basic authentication
- Full Alexa compatibility

## Quick Start

### Docker (Recommended)

```bash
docker-compose up -d
```

### Local Development

```bash
npm install
npm start
```

## Configuration

### settings.json
The API loads configuration from `settings.json` file for compatibility with legacy systems:

```json
{
  "host": "192.168.1.100",
  "port": 5005,
  "defaultRoom": "Living Room",
  "announceVolume": 40,
  "auth": {
    "username": "user",
    "password": "pass",
    "rejectUnauthorized": true
  },
  "voicerss": "YOUR_API_KEY",
  "macSay": {
    "voice": "Alex",
    "rate": 175
  },
  "pandora": {
    "username": "",
    "password": ""
  }
}
```

### config.json
Additionally, `config.json` can be used for presets and webhooks:

```json
{
  "port": 5005,
  "logLevel": "info",
  "presetDir": "./presets",
  "defaultRoom": "Living Room",
  "dataDir": "./data",
  "presets": {
    "preset-name": {
      "uri": "x-sonosapi-radio:...",
      "volume": 20,
      "metadata": "optional DIDL-Lite metadata"
    }
  },
  "webhooks": [
    {
      "url": "http://your-endpoint",
      "headers": { "X-API-Key": "your-key" }
    }
  ]
}
```

### Preset Files
Place JSON preset files in the `presetDir` directory (default: `./presets`). Supports both new and legacy preset formats.

New format:
```json
{
  "uri": "x-sonosapi-radio:...",
  "volume": 20,
  "metadata": "<DIDL-Lite>...</DIDL-Lite>"
}
```

Legacy format (automatically converted):
```json
{
  "players": [
    { "roomName": "Kitchen", "volume": 20 }
  ],
  "favorite": "My Favorite Station",
  "uri": "x-sonosapi-radio:..."
}
```

## Default Room Feature

The API supports a default room that is automatically used when room parameter is omitted. This is essential for Alexa integration where users often don't specify a room. The system remembers the last room used and applies it to subsequent commands.

### Default Room Management
- `GET /default` - Get current default settings
- `GET /default/room/{room}` - Set default room

### Room-less Endpoints (use default room)
- `GET /play` - Play in default room
- `GET /pause` - Pause in default room
- `GET /volume/{level}` - Set volume in default room
- `GET /preset/{preset}` - Play preset in default room

When you specify a room in any command, it becomes the new default room for future commands.

## API Endpoints

### System Endpoints
- `GET /health` - Health check
- `GET /zones` - List all zones with group information
- `GET /state` - Get state of all devices
- `GET /presets` - List all available presets (config and folder)
- `GET /events` - Server-Sent Events stream for real-time updates

### Room Control
- `GET /{room}/state` - Get room state
- `GET /{room}/play` - Start playback
- `GET /{room}/pause` - Pause playback
- `GET /{room}/playpause` - Toggle play/pause
- `GET /{room}/stop` - Stop playback
- `GET /{room}/next` - Next track
- `GET /{room}/previous` - Previous track

### Volume Control
- `GET /{room}/volume/{level}` - Set volume (0-100)
- `GET /{room}/volume/+{delta}` - Increase volume
- `GET /{room}/volume/-{delta}` - Decrease volume
- `GET /{room}/mute` - Mute
- `GET /{room}/unmute` - Unmute

### Presets
- `GET /presets` - List all available presets
- `GET /{room}/preset/{name}` - Play preset in room
- `GET /preset/{name}` - Play preset in default room
- `GET /preset/{name}/room/{room}` - Play preset in room (Alexa-compatible format)

### Group Management
- `GET /{room}/join/{targetRoom}` - Join another room's group
- `GET /{room}/leave` - Leave current group and become standalone
- `GET /{room}/ungroup` - Same as leave
- `GET /{room}/isolate` - Same as leave
- `GET /{room}/add/{otherRoom}` - Add another room to this room's group

### Favorites
- `GET /{room}/favorites` - List favorites (add ?detailed=true for full info)
- `GET /{room}/favourites` - British spelling alias
- `GET /{room}/favorite/{name}` - Play favorite by name
- `GET /{room}/favourite/{name}` - British spelling alias

### Playlists
- `GET /{room}/playlists` - List playlists (add ?detailed=true for full info)
- `GET /{room}/playlist/{name}` - Play playlist by name

### Playback Control
- `GET /{room}/clearqueue` - Clear the queue
- `GET /{room}/repeat/{toggle}` - Turn repeat on/off
- `GET /{room}/shuffle/{toggle}` - Turn shuffle on/off
- `GET /{room}/crossfade/{toggle}` - Turn crossfade on/off
- `GET /{room}/sleep/{seconds}` - Set sleep timer (0 to cancel)
- `GET /{room}/groupVolume/{level}` - Set volume for entire group

### Text-to-Speech (TTS)
- `GET /{room}/say/{text}` - Say text in specified room
- `GET /{room}/sayall/{text}` - Say text in all grouped rooms
- `GET /sayall/{text}` - Say text in all rooms

The TTS system supports multiple providers:
1. **VoiceRSS** - If API key is configured in settings.json (note: key is host-specific)
2. **macOS Say** - Available on macOS, configurable voice and rate
3. **Google TTS** - Free fallback option (no API key required)

The system will automatically pause current playback, announce the text at the configured volume, and resume playback.

### Music Services
- `GET /{room}/musicsearch/{service}/album/{name}` - Search and play album (Apple Music only currently)
- `GET /{room}/musicsearch/{service}/song/{query}` - Search and play songs (Apple Music only currently)
- `GET /{room}/musicsearch/{service}/station/{name}` - Play radio station (Apple Music only currently)
- `GET /{room}/siriusxm/{name}` - Play SiriusXM station (**NOT IMPLEMENTED** - returns 501)
- `GET /{room}/pandora/play/{name}` - Play Pandora station (requires Pandora credentials in settings.json)
- `GET /{room}/pandora/thumbsup` - Thumbs up current track
- `GET /{room}/pandora/thumbsdown` - Thumbs down current track
- `GET /{room}/applemusic/now/{id}` - Play immediately (id format: type:id, e.g., song:123456)
- `GET /{room}/applemusic/next/{id}` - Add as next track
- `GET /{room}/applemusic/queue/{id}` - Add to end of queue

Note: Music service endpoints require proper service authentication. Currently implemented: Apple Music (via Sonos account), Pandora (requires credentials). SiriusXM is not implemented.

### Line-In
- `GET /{room}/linein` - Play line-in from the same device
- `GET /{room}/linein/{source}` - Play line-in from source device

### Global Commands
- `GET /pauseall` - Pause all rooms
- `GET /resumeAll` - Resume playback in all rooms
- `GET /loglevel/{level}` - Set log level (error|warn|info|debug)

### Debug Endpoints
- `GET /debug` - Show current debug configuration
- `GET /debug/level/{level}` - Set log level (error|warn|info|debug)
- `GET /debug/category/{category}/{enabled}` - Enable/disable debug category
- `GET /debug/enable-all` - Enable all debug categories
- `GET /debug/disable-all` - Disable all debug categories (except API)

## Alexa Integration

This API is designed to work with Alexa skills. Common commands:

- "Alexa, tell Sonos to play in the kitchen"
- "Alexa, tell Sonos to pause all"
- "Alexa, tell Sonos to set volume to 50 in living room"
- "Alexa, tell Sonos to play preset morning jazz"

## Environment Variables

### Basic Configuration
- `PORT` - HTTP port (default: 5005)
- `NODE_ENV` - Environment (development/production)
- `DEFAULT_ROOM` - Default room name for commands without room parameter

### Debug Configuration
- `LOG_LEVEL` or `DEBUG_LEVEL` - Logging level: error, warn, info, debug (default: info)
- `DEBUG_CATEGORIES` - Comma-separated list of debug categories to enable:
  - `soap` - SOAP request/response details
  - `topology` - UPnP topology events and processing
  - `discovery` - Device discovery details
  - `favorites` - Favorite resolution details
  - `presets` - Preset loading and resolution
  - `upnp` - Raw UPnP event details
  - `api` - API request logging (enabled by default)
  - `*` or `all` - Enable all categories

### Debug Examples
```bash
# Enable debug logging with topology and discovery categories
DEBUG_LEVEL=debug DEBUG_CATEGORIES=topology,discovery npm start

# Enable all debug categories
DEBUG_LEVEL=debug DEBUG_CATEGORIES=all npm start

# Docker example
docker run -e DEBUG_LEVEL=debug -e DEBUG_CATEGORIES=soap,upnp -p 5005:5005 sonos-alexa-api
```

### Runtime Debug Control
You can also control debugging at runtime via API:
- `GET /debug` - Show current debug status
- `GET /debug/level/{level}` - Set log level
- `GET /debug/category/{category}/{enabled}` - Enable/disable category
- `GET /debug/enable-all` - Enable all categories
- `GET /debug/disable-all` - Disable all categories (except API)

## Grouped Speakers and Stereo Pairs

When speakers are grouped together or configured as stereo pairs, certain operations must be sent to the group coordinator rather than individual speakers. The API automatically handles this routing for you.

### Operations Automatically Routed to Coordinator
The following operations are always sent to the group coordinator when a room is part of a group:
- **Queue Management**: Getting, adding to, clearing, or reordering the queue
- **Playback Control**: Play, pause, stop, next, previous, seek
- **Content Selection**: Playing favorites, playlists, music service content
- **Transport Settings**: Changing tracks or switching sources
- **Playback Modes**: Repeat, shuffle, crossfade settings
- **Music Service Operations**: Searching and browsing content

### Operations That Remain Room-Specific
These operations work on individual speakers even when grouped:
- **Volume Control**: Each speaker maintains its own volume level
- **Mute/Unmute**: Individual mute control per speaker
- **Equalizer Settings**: Bass, treble, loudness per speaker
- **Group Management**: Join/leave operations

### Example
```bash
# If Kitchen and Living Room are grouped with Living Room as coordinator:

# These commands are automatically sent to the coordinator (Living Room):
GET /Kitchen/play           # Plays on the entire group
GET /Kitchen/queue          # Returns the group's queue
GET /Kitchen/shuffle/on     # Sets shuffle for the group

# These commands operate on Kitchen specifically:
GET /Kitchen/volume/50      # Sets Kitchen's volume only
GET /Kitchen/mute           # Mutes only Kitchen speaker
```

## API Documentation

A complete OpenAPI 3.0 specification is available in `openapi.yaml`. This includes:
- Detailed endpoint descriptions
- Request/response schemas
- Error responses
- Example values

You can use tools like Swagger UI or ReDoc to view the interactive API documentation:

```bash
# Using Docker
docker run -p 8080:8080 -e SWAGGER_JSON=/openapi.yaml -v $(pwd)/openapi.yaml:/openapi.yaml swaggerapi/swagger-ui

# Or with ReDoc
docker run -p 8080:80 -e SPEC_URL=/spec/openapi.yaml -v $(pwd)/openapi.yaml:/usr/share/nginx/html/spec/openapi.yaml redocly/redoc
```

## Authentication

The API supports optional HTTP Basic Authentication. Configure in `settings.json`:

```json
{
  "auth": {
    "username": "your-username",
    "password": "your-password",
    "rejectUnauthorized": true
  }
}
```

- If `rejectUnauthorized` is `false`, authentication headers are not checked even if credentials are configured
- Use this behind a reverse proxy (nginx) for HTTPS support
- Designed for local network use; add proper security for external access

## Testing

The project includes an adaptive test suite that discovers your Sonos system and runs appropriate tests:

```bash
# Run all tests (safe mode)
npm test

# Run only unit tests (no Sonos required)
npm run test:unit

# Run integration tests only
npm run test:integration

# Run full test suite (may interrupt playback)
npm run test:full
```

See [test/README.md](test/README.md) for detailed testing documentation.

## Future Enhancements

The following features are not currently implemented but could be added in the future:

### Possible Implementations

- **SiriusXM Support** - Endpoints exist but return 501 Not Implemented. Would require channel list and proper URI generation.
- **Spotify Music Search** - Not implemented. Would require:
  - Spotify Developer account and app registration
  - OAuth2 client credentials (Client ID and Secret in settings.json)
  - Token management for API authentication
  - Implementation of Spotify Web API calls
  - URI transformation to Sonos format
- **Alarm Management** - Create, modify, and delete Sonos alarms
- **Music Library Search** - Search and play from local music library

### Unlikely to be Implemented

- **Amazon Music Search** - Cannot be implemented without reverse engineering private APIs. Amazon does not provide a public search API, which is why even the legacy system never implemented this feature.
- **Deezer Music Search** - Not implemented. Would require Deezer API integration and credentials.

## Credits

This project is based on the excellent work by [jishi](https://github.com/jishi):
- [node-sonos-http-api](https://github.com/jishi/node-sonos-http-api) - The original Sonos HTTP API that inspired this implementation
- [node-sonos-discovery](https://github.com/jishi/node-sonos-discovery) - The UPNP discovery and control logic that this project builds upon

This implementation modernizes the original codebase with TypeScript, ES modules, and minimal dependencies while maintaining compatibility with existing Alexa skills and automation systems.

## License

MIT
