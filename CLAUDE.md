# CLAUDE.md - Development Memory File

This file helps maintain context across Claude sessions for the Sonos Alexa API project.

## Project Overview
- Modern TypeScript rewrite of jishi's node-sonos-http-api
- Designed for Alexa skill compatibility with minimal dependencies (winston, pino, fast-xml-parser)
- Uses native Node.js APIs (requires Node 18+)
- No HTTP framework - just built-in `http` module

## Key User Preferences
- **NO proactive file creation** - Only create files when explicitly asked
- **Prefer editing existing files** over creating new ones
- **Run servers in background** - Always use `npm start > logs/server.log 2>&1 &`
- **Show curl commands for testing** - Don't restart server unnecessarily
- **Don't add comments** unless specifically requested
- **No emojis in code** unless user asks

## Fundamental Coding Principles

### TypeScript Type Safety: `unknown` vs `any`
- **Always prefer `unknown` over `any`** when dealing with values of uncertain type
- **`unknown` is the type-safe counterpart to `any`** - it represents any value but requires type checking before use
- **Use `unknown` for**:
  - External inputs (JSON parsing, API responses, user input)
  - Function parameters that accept multiple types
  - Error handling where error type is uncertain
  - Any place where you need to check the type before using it
- **Only use `any` when**:
  - Interfacing with untyped JavaScript libraries
  - Temporary workarounds during migration (with TODO comments)
  - Complex generic constraints that TypeScript can't express
  - Performance-critical code where type checks would be prohibitive

#### Examples:
```typescript
// GOOD: Forces type checking
function processData(input: unknown) {
  if (typeof input === 'string') {
    return input.toUpperCase(); // Safe!
  }
  if (typeof input === 'object' && input !== null) {
    return JSON.stringify(input); // Safe!
  }
  throw new Error('Unsupported type');
}

// BAD: No type safety
function processData(input: any) {
  return input.toUpperCase(); // Runtime error if not string!
}
```

**Key Principle**: If you're checking the type anyway, use `unknown`. It documents your intent and catches errors at compile time.

## Important Commands
- Build: `npm run build`
- Start: `npm start > logs/server.log 2>&1 &` (loads .env file via dotenv)
- Start with debug: `npm run dev > logs/server.log 2>&1 &` (forces LOG_LEVEL=debug, DEBUG_CATEGORIES=all)
- Kill server: Multiple options depending on how it was started:
  - `pkill -f "node.*dist/server.js"` (for npm start)
  - `pkill -f "tsx.*src/server.ts"` (for npm run dev)
  - `pkill -f "tsx watch"` (kill any tsx watch processes)
  - Check what's running: `ps aux | grep -E "(tsx|node.*server)" | grep -v grep`
- Test endpoints: Use curl commands, not server restarts
- **Note**: All npm scripts include `NODE_OPTIONS='--openssl-legacy-provider'` ONLY for Pandora API's Blowfish encryption. This is not needed if Pandora is not used.

### Command Line Overrides
```bash
# Override debug categories (fast startup)
DEBUG_CATEGORIES=api,discovery npm start

# Enable all debug (verbose)
DEBUG_CATEGORIES=all npm start

# Disable all debug
DEBUG_CATEGORIES= npm start

# Override multiple settings
CREATE_DEFAULT_PRESETS=true DEBUG_CATEGORIES=presets npm start
```

## Debug Logging
- **IMPORTANT**: Debug logging is NOT enabled by default with `npm start`
- To enable debug logging, either:
  1. Use `npm run dev` to start server with debug enabled, OR
  2. Enable debug after starting with curl: `curl http://localhost:5005/debug/enable-all`
- Check debug status: `curl http://localhost:5005/debug`
- Set specific category: `curl http://localhost:5005/debug/category/discovery/true`
- Set log level: `curl http://localhost:5005/debug/level/debug` (or error/warn/info/debug/trace)

### Log Levels
- **error**: Only errors
- **warn**: Errors and warnings
- **info**: Errors, warnings, and info messages (default)
- **debug**: All of the above plus debug messages
- **trace**: Everything including massive XML/SOAP responses (most verbose)
- **wall**: Deprecated alias for trace (use trace instead)

### Debug Categories
- **api**: API request/response logging (enabled by default)
- **discovery**: Device discovery details
- **soap**: SOAP request/response XML (verbose with trace level)
- **topology**: UPnP topology events
- **favorites**: Favorite resolution details
- **presets**: Preset loading and conversion (can be very verbose)
- **upnp**: Raw UPnP event details
- **sse**: Server-Sent Events for webhooks
- **all**: Enable all categories

### Log Format
- **Development**: Winston with colorized output (default when NODE_ENV=development)
- **Production**: Pino with JSON format for better parsing/aggregation (default when NODE_ENV=production)
- **Logger Selection**: Set LOGGER=winston or LOGGER=pino to override defaults
- **Legacy**: LOG_FORMAT=json is deprecated, use LOGGER=pino instead

## Configuration Features

### CREATE_DEFAULT_PRESETS
- When set to `true`, automatically generates presets from all favorites, playlists, and stations
- Generated presets use the default room configured in settings/env
- Never overwrites existing user presets
- Useful for initial setup or when moving between locations
- Can be set via environment variable or in settings.json

## Configuration Files
- `settings.json` - Main config (host, port, auth, TTS, default room/service)
- `data/default-settings.json` - Persisted defaults (room, music service)
- `presets/` - Preset files in JSON format

## Configuration Architecture (v1.4.0+)
- **Single Source of Truth**: Config loader reads ALL environment variables
- **Logger Exception**: Logger module reads its own env vars (NODE_ENV, LOGGER, LOG_LEVEL) for early initialization
- **No Direct process.env**: All other modules read from config object, never from process.env
- **Computed Fields**: Config includes `isDevelopment` and `isProduction` boolean helpers
- **Field Normalization**: Logger type is automatically lowercased in config
- **Debug Integration**: Debug manager initialized with config, not environment variables
- **Startup Order**: 
  1. Logger initializes (reads its own env vars)
  2. Config loader runs (reads all env vars, shows startup banner)
  3. Debug manager initializes from config
  4. All other modules use config object

## Preset Behavior
- **Multi-room presets**: When a preset contains multiple players:
  - The **first player in the list becomes the group coordinator**
  - All other players join the coordinator's group
  - The current/default room is set to the coordinator
  - Future commands to any room in the group affect the entire group
  - Example: If preset has `[LivingRoom, Bedroom]`, LivingRoom becomes coordinator
- **pauseOthers**: When true, pauses all rooms not in the preset BEFORE grouping/playing
- **Order matters**: Players are processed in array order for grouping

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
  - API endpoints: /library/index, /library/refresh, /library/summary, /library/detailed
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
- Fixed x-rincon-cpcontainer URI support:
  - Implemented proper handling for music service containers (e.g., Hearts of Space, This Weeks Show)
  - These URIs now use queue-based playback (clear queue, add container, play from queue)
  - Fixes SOAP 500 errors when playing certain music service favorites
- Fixed x-rincon-playlist URI support:
  - Music library playlists now properly browse and add all tracks to queue
  - Handles playlist URIs by extracting playlist ID and browsing contents
- Improved content analysis script:
  - Added case-insensitive favorite matching
  - Better detection of favorites referenced by presets
- Logger improvements:
  - NODE_ENV defaults to development when not set (enables colorized output)
  - Respects LOG_LEVEL and DEBUG_CATEGORIES from environment/dotenv
- Music Services API:
  - Added /services endpoint to get all available music services
  - Added /services/refresh endpoint to manually refresh services cache
  - Automatic 24-hour cache refresh with retry on failure
  - Proper identification of personalized services (e.g., user-specific TuneIn accounts)
  - Service name resolution from presentation strings
  - Content analysis now uses services API for accurate service identification

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

## Recent Script Changes (June 27, 2025)
- Removed `test:full` script (was non-functional, `npm test` already runs all tests)
- Removed `test:id` script (was non-functional with trailing --)
- Renamed `save-version` to `version:save` for consistency
- Added `test:list:detailed` to show all test cases
- Updated `test:coverage` to run check-coverage.ts instead of run-tests.ts
- Added `--detailed` flag to check-coverage.ts
- Updated `clean` script to also remove logs directory
- Tests now run with LOG_LEVEL=error by default (use --debug flag for verbose output)

## Docker Release Process
When ready to publish a new Docker image:

1. **Update version** in package.json
2. **Update release notes** in releases/
3. **Test thoroughly** with local Docker build
4. **Build and tag**:
   ```bash
   ./docker-build.sh
   ```
5. **Test the image locally**:
   ```bash
   docker run -d --name sonos-test --network host sonos-alexa-api:latest
   docker logs -f sonos-test
   # Test some API calls
   docker stop sonos-test && docker rm sonos-test
   ```
6. **Login to Docker Hub**:
   ```bash
   docker login
   ```
7. **Push to Docker Hub**:
   ```bash
   docker push kshartman/sonos-alexa-api:v1.2.0
   docker push kshartman/sonos-alexa-api:latest
   ```
8. **Tag the git commit**:
   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```

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

## Environment Variables
All configuration can now be set via environment variables. `npm start` loads .env files via dotenv:

### Core Settings
- **PORT**: API server port (default: 5005)
- **HOST**: Interface to bind (default: 0.0.0.0)
- **ANNOUNCE_VOLUME**: Volume for announcements (default: 40)
- **CREATE_DEFAULT_PRESETS**: Auto-generate presets from favorites (default: false)
- **TTS_HOST_IP**: Override auto-detected IP for TTS (useful in Docker)

### Logging
- **LOG_LEVEL**: Log level (error, warn, info, debug)
- **LOGGER**: Logger type - winston or pino (default: winston for dev, pino for prod)
- **LOG_FORMAT**: DEPRECATED - use LOGGER instead
- **DEBUG_LEVEL**: Debug verbosity (error, warn, info, debug, trace)
- **DEBUG_CATEGORIES**: Comma-separated debug categories (api, discovery, soap, topology, favorites, presets, upnp, sse, or "all")
- **NODE_ENV**: Environment (development or production)

### Authentication
- **AUTH_USERNAME**: Basic auth username
- **AUTH_PASSWORD**: Basic auth password
- **AUTH_REJECT_UNAUTHORIZED**: Enforce auth if credentials exist (default: true)
- **AUTH_TRUSTED_NETWORKS**: Comma-separated trusted networks (e.g., "192.168.1.0/24,10.0.0.0/8")

### Defaults
- **DEFAULT_ROOM**: Default room for roomless endpoints
- **DEFAULT_SERVICE**: Default music service (apple, spotify, etc.)

### Services
- **PANDORA_USERNAME**: Pandora account username
- **PANDORA_PASSWORD**: Pandora account password
- **TTS_PROVIDER**: TTS provider (voicerss, google, macos)
- **TTS_LANG**: TTS language (default: en-US)
- **TTS_MACOS_VOICE**: macOS voice name
- **TTS_MACOS_RATE**: macOS speaking rate

### Advanced
- **LIBRARY_REINDEX_INTERVAL**: How often to reindex music library (e.g., "1 week")
- **HOST_PRESET_PATH**: External preset directory to mount as volume (Docker)

## Architecture Critique & Enhancement Plan

### Architecture Strengths
- Clean separation of concerns with well-defined modules
- Minimal dependencies (only winston + pino + fast-xml-parser)
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
21. **Remove Global Discovery Variable** - Refactor SonosDevice to accept discovery instance via constructor or method parameter instead of using global variable
## Recent Updates (June 29, 2025)
- Fixed detailed endpoints regression where they returned arrays instead of objects
- Added defensive checks to content analyzer for malformed favorites
- Infrastructure analyzer now shows stereo/surround role designations (L, R, C, SW, SL, SR, HL, HR)
- Discovered that some devices (particularly Connect and Amp) may show as "Unknown" until properly discovered via SSDP
- Force discovery can be triggered by querying device state or waiting for SSDP announcement cycle
- Moved force-discovery.ts to debug directory

## Recent API Changes (June 30, 2025)
- Added music library cache endpoints:
  - GET /library/index - Shows indexing status and metadata
  - GET /library/refresh - Triggers library re-index
  - GET /library/summary - Overview with top artists/albums
  - GET /library/detailed - Full track/artist/album data
- Added methods to MusicLibraryCache class:
  - getSummary() - Returns statistics and top content
  - getDetailedData() - Returns full tracks, artists, albums data
- Integrated music library analysis into analyze-home-content.ts
- analyze-content.sh now generates four outputs in homes/{home}/ directory:
  - content-analysis.md - Favorites and presets breakdown
  - preset-validation-results.md - Preset validation status
  - music-library-analysis.md - Library statistics and top content
  - music-library.json - Optimized JSON export of all tracks (with jq pretty-printing if available)
- JSON export strips unnecessary fields (titleLower, artistLower, albumLower, albumArtURI) for ~50% size reduction
- Created delete-favorite.ts script to remove ghost favorites (moved to debug directory)
- Implemented DestroyObject SOAP call for removing favorites that don't appear in Sonos app

## v1.3.0 Release (June 30, 2025)
Major release with comprehensive device information API, music library endpoints, and services discovery:
- **Device Information API**: /devices endpoints with model, IP, and stereo/surround configuration
- **Infrastructure Analysis Tools**: analyze-infrastructure.sh generates detailed system reports
- **Music Library API**: Complete library access with summary and detailed endpoints
- **Music Services API**: Cached service discovery with proper TuneIn identification
- **Bug Fixes**: Fixed detailed endpoints regression, content analyzer improvements, EventEmitter max listeners warning
- **Content Analysis**: Enhanced URI type recognition and service identification
- See releases/RELEASE_NOTES_1.3.0.md for complete details
