# CLAUDE.md - Development Memory File

This file helps maintain context across Claude sessions for the Sonos Alexa API project.

## Project Overview
- Modern TypeScript rewrite of jishi's node-sonos-http-api
- Designed for Alexa skill compatibility with minimal dependencies
- Uses native Node.js APIs (requires Node 18+)
- No HTTP framework - just built-in `http` module

## Key User Preferences
- **NO proactive file creation** - Only create files when explicitly asked
- **Prefer editing existing files** over creating new ones
- **Run servers in background** - Always use `npm start > logs/server.log 2>&1 &`
- **Show curl commands for testing** - Don't restart server unnecessarily
- **Don't add comments** unless specifically requested
- **No emojis in code** unless user asks

## Important Commands
- Build: `npm run build`
- Start: `npm start > logs/server.log 2>&1 &`
- Start with debug: `npm run dev > logs/server.log 2>&1 &` (enables debug logging)
- Kill server: Multiple options depending on how it was started:
  - `pkill -f "node.*dist/server.js"` (for npm start)
  - `pkill -f "tsx.*src/server.ts"` (for npm run dev)
  - `pkill -f "tsx watch"` (kill any tsx watch processes)
  - Check what's running: `ps aux | grep -E "(tsx|node.*server)" | grep -v grep`
- Test endpoints: Use curl commands, not server restarts

## Debug Logging
- **IMPORTANT**: Debug logging is NOT enabled by default with `npm start`
- To enable debug logging, either:
  1. Use `npm run dev` to start server with debug enabled, OR
  2. Enable debug after starting with curl: `curl http://localhost:5005/debug/enable-all`
- Check debug status: `curl http://localhost:5005/debug`
- Set specific category: `curl http://localhost:5005/debug/category/discovery/true`
- Set log level: `curl http://localhost:5005/debug/level/debug` (or error/warn/info/debug/wall)

### Log Levels
- **error**: Only errors
- **warn**: Errors and warnings
- **info**: Errors, warnings, and info messages (default)
- **debug**: All of the above plus debug messages
- **wall**: Everything including massive XML/SOAP responses (most verbose)

## Configuration Files
- `settings.json` - Main config (host, port, auth, TTS, default room/service)
- `data/default-settings.json` - Persisted defaults (room, music service)
- `presets/` - Preset files in JSON format

## API Patterns
- Room endpoints: `/{room}/command`
- Default room endpoints: `/command` (uses saved default)
- Music search: `/{room}/musicsearch/{service}/{type}/{query}`
- Default music search: `/{type}/{query}` (uses default room & service)

## Authentication
- Optional HTTP Basic Auth configured in settings.json
- `rejectUnauthorized: false` skips auth check even if credentials exist
- Designed for use behind nginx proxy

## Key Technical Details

### Music Search Implementation
- Apple Music uses iTunes Search API (no auth needed)
- Generates Sonos-compatible URIs with proper metadata
- Account discovery returns empty XML, so we use default accounts
- Apple Music default account: SID 52231

### TTS Implementation
- Multiple providers: VoiceRSS, Google TTS (free), macOS Say
- Caches generated audio files
- Announcement system saves/restores playback state
- macOS Say generates AIFF then converts to MP3

### Playback State Restoration
- Must capture transport info BEFORE playing announcement
- Use coordinator.getTransportInfo() not state.currentTrack
- Retry logic for TRANSITIONING states

### Coordinator Pattern
- Always route commands to zone coordinator
- Stereo pairs and groups need coordinator routing
- Use discovery.getCoordinator(device.id)

## Common Issues & Solutions

### "Port already in use"
```bash
pkill -f "node dist/server.js" && sleep 2 && npm start > logs/server.log 2>&1 &
```

### Empty accounts XML
- Sonos `/status/accounts` returns empty XML even with configured accounts
- Solution: Use default accounts (Apple Music SID: 52231)

### Music restore after announcements
- Issue: Music stops but doesn't resume
- Solution: Capture transport state BEFORE announcement, not from cached state

### Playback commands failing with error 701
- Error 701: "Transition not available" - occurs when trying to control playback without content
- Solution: Load content before testing play/pause/stop commands
- Use favorites API to find and play radio stations for test content
- Helper available: `test/helpers/content-loader.ts` - uses favorites API to find radio stations

## Testing Patterns
- Default room/service: `curl "http://localhost:5005/song/Yesterday"`
- Specific room: `curl "http://localhost:5005/OfficeSpeakers/play"`
- Grouped speakers: Join first, then test on coordinator

## Todo List Management
- Use TodoRead/TodoWrite tools frequently
- Mark items complete immediately after finishing
- Only one task should be in_progress at a time

## File Structure
```
src/
├── server.ts          - Entry point
├── api-router.ts      - All HTTP endpoints
├── discovery.ts       - SSDP device discovery
├── sonos-device.ts    - Device control (SOAP)
├── services/
│   ├── tts-service.ts
│   ├── music-service.ts (base class)
│   ├── apple-music-service.ts
│   └── account-service.ts
└── utils/
    ├── soap.ts        - SOAP XML generation
    ├── logger.ts      - Winston logger
    └── default-room-manager.ts
```

## Recent Changes
- Added music search with Apple Music support
- Implemented default music service configuration
- Added room-less music endpoints (/song/, /album/, /station/)
- Fixed announcement playback restoration
- Added credits to jishi in README
- Converted anesidora library to TypeScript and integrated Pandora API support
- Note: SiriusXM endpoints exist but are NOT IMPLEMENTED (return 501) due to lack of service access

## UPnP Event Subscriptions
- Devices subscribe to UPnP services discovered from device description XML
- Subscriptions auto-renew 30 seconds before expiry (default timeout: 300s)
- Renewal uses existing SID header (not NT/CALLBACK)
- Failed renewals attempt resubscription from scratch
- Only one ZoneGroupTopology subscription needed (all devices expose same data)
- No AlarmClock subscriptions (not needed)
- Subscriptions persist for entire container lifetime

### Device Priority for Topology
- NEVER use portable devices (Roam, Move) - they lack AVTransport/RenderingControl services
- Priority order: Era 300 > Era 100 > One > Five > Arc > Beam > Play:5/3/1
- System automatically selects best available device for topology subscription

## Legacy System Reference
- The legacy node-sonos-http-api code is located at: ~/projects/sonosd/node-sonos-http-api
- Don't search GitHub for legacy code - use the local copy

## Notes for Next Session
- OpenAPI spec needs updating with new music search endpoints
- Unit tests would be valuable for reliability
- Docker health check endpoint exists at /health
- Pandora implementation now uses real API with authentication
- SiriusXM could be implemented if needed (channel list exists in legacy repo)
- Spotify could be implemented but requires OAuth2 and developer account
- Amazon Music search is impossible without reverse engineering (no public API)
- Deezer not implemented (would need API access)