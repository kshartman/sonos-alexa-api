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
- Start: `npm start > logs/server.log 2>&1 &` (includes --openssl-legacy-provider)
- Start with debug: `npm run dev > logs/server.log 2>&1 &` (enables debug logging, includes NODE_OPTIONS)
- Kill server: Multiple options depending on how it was started:
  - `pkill -f "node.*dist/server.js"` (for npm start)
  - `pkill -f "tsx.*src/server.ts"` (for npm run dev)
  - `pkill -f "tsx watch"` (kill any tsx watch processes)
  - Check what's running: `ps aux | grep -E "(tsx|node.*server)" | grep -v grep`
- Test endpoints: Use curl commands, not server restarts
- **Note**: All npm scripts include `NODE_OPTIONS='--openssl-legacy-provider'` ONLY for Pandora API's Blowfish encryption. This is not needed if Pandora is not used.

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

### Log Format
- **Development**: Colorized simple format (default when NODE_ENV=development)
- **Production**: JSON format for better parsing/aggregation (default when NODE_ENV=production)
- **Force JSON**: Set LOG_FORMAT=json to use JSON even in development

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
- Trusted networks bypass authentication:
  - Configure in `auth.trustedNetworks` array
  - Supports individual IPs and CIDR notation
  - Localhost (127.0.0.1, ::1) always trusted
  - Client IP extracted from proxy headers (X-Forwarded-For, X-Real-IP)
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
├── server.ts              - Entry point
├── api-router.ts          - All HTTP endpoints
├── discovery.ts           - SSDP device discovery
├── sonos-device.ts        - Device control (SOAP)
├── preset-loader.ts       - Preset file loader with room validation
├── topology-manager.ts    - UPnP topology management
├── actions/
│   └── favorites.ts       - Favorites management
├── services/
│   ├── tts-service.ts     - Text-to-speech service
│   ├── music-service.ts   - Base music service class
│   ├── apple-music-service.ts      - Apple Music search
│   ├── music-library-service.ts    - Local library browsing
│   ├── music-library-cache.ts      - Library cache with periodic reindex
│   ├── pandora-service.ts          - Pandora integration
│   ├── pandora-api.ts              - Pandora API client
│   ├── pandora-browse.ts           - Pandora browse fallback
│   └── account-service.ts          - Account management
├── types/
│   └── sonos.ts           - TypeScript type definitions
├── upnp/
│   └── subscriber.ts      - UPnP event subscriptions
└── utils/
    ├── soap.ts            - SOAP XML generation
    ├── logger.ts          - Winston logger
    ├── debug-manager.ts   - Debug category management
    ├── default-room-manager.ts     - Default room persistence
    ├── event-manager.ts   - Event emitter for SSE
    ├── preset-converter.ts         - Legacy preset conversion
    ├── announcement-helper.ts      - TTS announcement handling
    └── validation.ts      - Input validation

apidoc/                    - OpenAPI documentation
├── openapi.yaml          - Main OpenAPI spec
├── components/           - Reusable components
└── paths/               - Endpoint definitions

test/
├── helpers/              - Test utilities
├── integration/          - Integration tests by feature
├── unit/                - Unit tests
└── debug/               - Debug scripts
```

## Recent Changes
- Added music search with Apple Music support
- Implemented default music service configuration
- Added room-less music endpoints (/song/, /album/, /station/)
- Fixed announcement playback restoration
- Added credits to jishi in README
- Converted anesidora library to TypeScript and integrated Pandora API support
- Note: SiriusXM endpoints exist but are NOT IMPLEMENTED (return 501) due to lack of service access
- Pandora integration:
  - Play stations works with real API when credentials configured in settings.json
  - Falls back to browse/favorites method when no credentials
  - Thumbs up/down partially working - skip functionality works but API feedback returns error code 0
  - Requires NODE_OPTIONS='--openssl-legacy-provider' for Blowfish encryption (only needed for Pandora)
  - Station switching implemented with proper 500ms delays for session management
- Music Library features:
  - Auto-indexing at startup with cache persistence
  - Search by song, artist, album
  - Periodic reindex via library.reindexInterval setting
  - Progress tracking during indexing
- Documentation updates:
  - Modular OpenAPI spec in apidoc/ folder
  - Updated README with complete API endpoints
  - Updated ALEXA_COMPATIBILITY.md and IMPLEMENTATION_SUMMARY.md
- Test improvements:
  - Split content tests by service type
  - Added group member names to warnings
  - Fixed volume mock response format
- Preset enhancements:
  - Room validation with invalid room filtering
  - Colored output for preset status
- TTS endpoints now support volume parameter
- Added library.reindexInterval setting (e.g., "1 week", "2 days", "24 hours")
- Line-in playback functionality implemented
- Comprehensive TTS test coverage with volume support
- Test coverage increased to 96% (from 94%)
- Test runner improved to handle path formats correctly
- Added setup-local.sh to .dockerignore (user-specific setup script)
- Removed obsolete test-local.sh file
- Implemented trusted networks authentication bypass:
  - Added trustedNetworks array to auth configuration
  - IPs in trusted networks skip authentication (includes localhost by default)
  - Supports CIDR notation (e.g., 192.168.1.0/24)
  - Extracts client IP from proxy headers (X-Forwarded-For, X-Real-IP)
  - Fixes Docker health check authentication issues

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
- The legacy node-sonos-http-api code is located at: ~/projects/sonos-old/node-sonos-http-api
- The legacy Sonos API layer implementation is at: ~/projects/sonos-old/node-sonos-discovery
- Don't search GitHub for legacy code - use the local copy

## Release Information
- **v1.0.0**: Initial public release pushed to GitHub
  - Tag: v1.0.0 (commit 79ca690)
  - Maintenance branch: release_1.0.0
  - GitHub repository: https://github.com/kshartman/sonos-alexa-api
  - Release date: June 26, 2025

## Notes for Next Session
- Unit tests would be valuable for reliability
- Docker health check endpoint exists at /health
- SiriusXM could be implemented if needed (channel list exists in legacy repo)
- Spotify could be implemented but requires OAuth2 and developer account
- Amazon Music search is impossible without reverse engineering (no public API)
- Deezer not implemented (would need API access)
- Consider adding more path files to complete the OpenAPI documentation
- Could add rate limiting to music library refresh endpoint
- Preset validation could be extended to validate favorites exist
- **HTTPS/TLS not supported** - Unlike legacy system, no securePort or certificate handling. Design decision to use reverse proxy (nginx) for SSL termination instead

## Docker Environment Variables
The Docker container now supports configuration via .env file:
- **PORT**: API server port (default: 5005)
- **HOST_PRESET_PATH**: External preset directory to mount as volume
- **LOG_LEVEL**: Log level (error, warn, info, debug)
- **LOG_FORMAT**: Log format (simple or json)
- **DEBUG_LEVEL**: Debug verbosity (error, warn, info, debug, wall)
- **DEBUG_CATEGORIES**: Comma-separated debug categories (soap, topology, discovery, favorites, presets, upnp, api, sse, or "all")

## Architecture Critique & Enhancement Plan

### Architecture Strengths
- Clean separation of concerns with well-defined modules
- Minimal dependencies (only winston + fast-xml-parser)
- Good TypeScript usage with strong typing in most areas
- Event-driven architecture using native Node.js patterns
- Excellent test coverage (96%)
- Well-structured API router without framework overhead

### Architecture Weaknesses
- 87 TypeScript `any` warnings indicate type safety gaps
- Some error handling is inconsistent (mix of try/catch and unhandled promises)
- Hardcoded values that should be configurable
- Limited authentication options (only basic auth)
- No rate limiting or request validation middleware
- Missing some features from legacy system

### Prioritized Enhancement List

#### High Priority (Core Improvements)
1. **Type Safety Improvements** - Replace all `any` types with proper interfaces, add strict TypeScript compiler options, define SOAP response types
2. **Error Handling Standardization** - Implement consistent error classes, global error handler middleware, improve SOAP fault handling, retry logic
3. **Configuration Management** - Move hardcoded values to settings.json, add environment variable support, implement settings validation, hot-reload
4. **API Rate Limiting** - Implement per-IP rate limiting, add burst protection, configurable limits per endpoint

#### Medium Priority (Feature Completeness)
5. **Spotify Integration** - Implement OAuth2 flow, add search/playback capabilities, handle token refresh
6. **SiriusXM Implementation** - Complete the stubbed endpoints, add channel list from legacy system, implement authentication
7. **Enhanced Security** - Add API key authentication option, implement JWT tokens, add request signing, CORS configuration
8. **WebSocket Support** - Real-time state updates, push notifications, reduce polling overhead
9. **Metrics & Monitoring** - Add Prometheus metrics, performance tracking, request/response logging, health check improvements

#### Low Priority (Nice to Have)
10. **Caching Layer** - Redis support for state caching, reduce SOAP calls, configurable TTLs
11. **Queue Management** - Better queue manipulation, save/restore queue state, queue templates
12. **Advanced TTS** - Amazon Polly support, ElevenLabs integration, SSML support
13. **Playlist Management** - Create/edit playlists, import/export capabilities, cross-service playlist sync
14. **Database Support** - SQLite for presets/favorites, historical playback data, user preferences
15. **API Documentation** - Complete OpenAPI spec, interactive API explorer, code examples
16. **Performance Optimizations** - Connection pooling, batch SOAP requests, parallel device updates
17. **Docker Improvements** - Multi-stage builds, Alpine-based image, Kubernetes manifests
18. **CLI Tools** - Device discovery tool, preset manager, diagnostic utilities
19. **Plugin System** - Custom action plugins, music service plugins, TTS provider plugins
20. **Home Assistant Integration** - Native integration, auto-discovery, media player entities