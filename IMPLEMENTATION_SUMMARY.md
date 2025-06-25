# Sonos API Implementation Summary

## Overview

This is a modern TypeScript implementation of a Sonos HTTP API designed for Alexa integration, based on jishi's excellent work on node-sonos-http-api and node-sonos-discovery. The implementation uses minimal dependencies and native Node.js APIs.

## Key Features

### 1. **Zero HTTP Framework Dependencies**
- Uses Node.js built-in `http` module
- Custom router with pattern matching
- No Express, Koa, or other frameworks
- Minimal dependencies (winston for logging, fast-xml-parser for SOAP)

### 2. **Music Service Integration**
- **Apple Music**: Full search (albums, songs, stations) using iTunes API
- **Pandora**: Station playback with real API integration, thumbs up/down
- **Music Library**: Local library search with background indexing
- **Default Service**: Configurable default music service for room-less endpoints

### 3. **Group Management**
- Proper coordinator routing for grouped speakers
- Stereo pair detection and handling
- Join/leave operations with topology awareness
- Group volume control
- Non-stereo group warning in tests

### 4. **Text-to-Speech (TTS)**
- Multiple providers: VoiceRSS, Google TTS, macOS Say
- Automatic playback save/restore
- Configurable announcement volume
- Per-endpoint volume override
- Audio file caching

### 5. **Default Room System**
- Persistent default room tracking
- Room-less endpoints use saved default
- Automatic default update on room usage
- Essential for Alexa "play music" commands

### 6. **Event-Driven Architecture**
- UPnP event subscriptions with auto-renewal
- Server-Sent Events (SSE) for real-time updates
- Event-driven test framework (no polling)
- Topology change detection

### 7. **Debug System**
- Categorized debug logging
- Runtime enable/disable via API
- Log levels: error, warn, info, debug, wall
- Categories: soap, topology, discovery, favorites, presets, upnp, api

## API Endpoints

### System
- Health check, zones, state, presets, settings
- Server-Sent Events stream

### Room Control
- Playback: play, pause, stop, next, previous
- Volume: set, increase, decrease, mute, group volume
- Content: favorites, playlists, presets
- Group: join, leave, add members

### Music Search
- Multi-service search (apple, library, pandora)
- Room-specific: `/{room}/musicsearch/{service}/{type}/{query}`
- Default room: `/song/{query}`, `/album/{name}`, `/station/{name}`

### TTS Announcements
- Room-specific with optional volume
- Group announcements
- System-wide announcements

### Debug & Monitoring
- Debug configuration and control
- UPnP subscription status
- Log level management

## Technical Implementation

### Device Discovery
- SSDP-based discovery with topology awareness
- Automatic device detection and tracking
- Service availability checking
- Portable device handling (Roam, Move)

### Coordinator Pattern
- Commands routed to group coordinator
- Queue operations on coordinator only
- Individual volume control preserved
- Stereo pair awareness

### Music Playback Restoration
- Captures transport state before announcements
- Handles TRANSITIONING states with retry
- Preserves queue position and play mode

### Pandora Integration
- Real API with partner authentication
- Blowfish encryption for auth tokens
- Station list caching
- Feedback support (thumbs up/down)

## Testing

### Adaptive Test Framework
- Discovers available Sonos system
- Runs appropriate tests based on system
- Event-driven (no polling or fixed delays)
- Safe mode and full mode options

### Test Categories
1. Infrastructure and discovery
2. Playback controls
3. Volume and mute
4. Content loading (by service)
5. Group management
6. Playback modes
7. Advanced features
8. TTS functionality

### Test Helpers
- Content loader with fallback strategies
- Event bridge for SSE integration
- State management and verification
- Mock factory for unit tests

## Configuration

### settings.json
- Host, port, authentication
- Default room and announce volume
- TTS provider keys
- Music service credentials

### Environment Variables
- PORT, NODE_ENV, DEFAULT_ROOM
- LOG_LEVEL, DEBUG_CATEGORIES
- Legacy support: NODE_OPTIONS='--openssl-legacy-provider'

## Recent Enhancements

1. **Music Library Integration**
   - Auto-indexing at startup
   - Cache persistence
   - Search by song, artist, album
   - Progress tracking

2. **Pandora Improvements**
   - Real API integration
   - Station switching with delays
   - Proper session management
   - Browse fallback support

3. **Test Reliability**
   - Group member names in warnings
   - Volume mock fixes
   - Content loading improvements
   - Timing adjustments

4. **API Completeness**
   - TTS with volume endpoints
   - Queue pagination support
   - Toggle mute endpoint
   - Library management endpoints

## Known Limitations

- SiriusXM not implemented (returns 501)
- Spotify requires OAuth2 setup
- Amazon Music has no public API
- Some Pandora feedback returns error code 0

## Migration from Legacy

1. Point Alexa skill to new API endpoint
2. Copy settings.json and presets
3. No Alexa skill code changes needed
4. Test voice commands
5. Monitor with debug logging

## Credits

This implementation builds on the excellent work by:
- [jishi](https://github.com/jishi) - Original node-sonos-http-api and node-sonos-discovery
- [dlom](https://github.com/dlom) - Anesidora Pandora API implementation