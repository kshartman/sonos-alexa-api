# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
- Modern TypeScript rewrite of jishi's node-sonos-http-api
- Designed for Alexa skill compatibility with minimal dependencies (winston, pino, fast-xml-parser)
- Uses native Node.js APIs (requires Node 20+)
- No HTTP framework - just built-in `http` module
- **S2 Systems Only** - S1 systems are not supported (no /status/accounts or Status:ListAccounts)

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
- Lint: `npm run lint` (ESLint)
- Start: `npm start > logs/server.log 2>&1 &` (loads .env file via dotenv)
- Start with debug: `npm run dev > logs/server.log 2>&1 &` (forces LOG_LEVEL=debug, DEBUG_CATEGORIES=usual)
- Kill server: `npm run killall` (kills all server processes and frees port 5005)
  - Check what's running: `ps aux | grep -E "(tsx|node.*server)" | grep -v grep`
- Test all: `npm test` (builds first, runs all tests)
- Test unit only: `npm run test:unit`
- Test integration only: `npm run test:integration`
- Test with verbose logs: `npm run test:log`
- List tests: `npm run test:list` or `npm run test:list:detailed`
- Check coverage: `npm run test:coverage`
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
- **usual**: Shorthand for api, discovery, favorites, presets (used by `npm run dev`)
- **all**: Enable all categories

### Logger System
The application supports two logger implementations, automatically selected based on environment:

#### Logger Selection
- **Default Behavior**:
  - Development (`NODE_ENV=development`): Winston with colorized output
  - Production (`NODE_ENV=production`): Pino with JSON format
- **Manual Override**: Set `LOGGER=winston` or `LOGGER=pino` to override defaults
- **Source of Truth**: The actual logger in use is exposed at `/debug/startup` as `actualLoggerType`

#### Winston Logger
- **Development**: Colorized traditional format with timestamps
- **Production**: Traditional format with timestamps (no colors)
- **Use Case**: Human-readable logs, debugging, local development
- **Format**: `2025-07-09T21:26:25.302Z info: Server ready at http://0.0.0.0:5005`

#### Pino Logger
- **Always JSON**: Structured JSON output in all environments
- **Use Case**: Log aggregation, parsing, production monitoring
- **Format**: `{"level":"info","timestamp":"2025-07-09T21:26:25.302Z","service":"sonos-alexa-api","message":"Server ready"}`
- **Performance**: Faster than Winston, recommended for production

#### Key Differences
- **Timestamp Position**: Pino puts timestamp second, Winston puts it last in JSON
- **Output Format**: Winston uses traditional format unless in dev mode, Pino always uses JSON
- **Purpose**: Choose Winston for readability, Pino for parsing/performance

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

## Generated Data Files
- `data/services-cache.json` - Cached music services from Sonos system (generated at startup, auto-refreshes every 24 hours)
- `data/music-library.cache` - Indexed music library data (generated at startup, refreshes based on library.reindexInterval setting)

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

## Preset File Locations (Manual Sync Required)
Presets exist in THREE locations that must be manually synchronized:

1. **Presets repo** (`../presets/presets-{home}/`) - Source of truth, version controlled
2. **API project** (`./presets/`) - Used for local development (`npm start`)
3. **Data mount** (`/usr/local/data/sonos/presets/`) - Used by Docker container

### Syncing Presets
After updating presets in the repo, sync to both locations:

```bash
# Sync to API project (for local dev)
rsync -av --delete ../presets/presets-talon/ ./presets/

# Sync to data mount (for Docker)
rsync -av --delete ../presets/presets-talon/ /usr/local/data/sonos/presets/

# Restart container to pick up changes
docker compose restart
```

Replace `presets-talon` with `presets-worf` on the worf instance.

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

### Pandora Play Algorithm (Final)
1. **Station Lookup**: Memory-only from PandoraStationManager (NO API calls)
2. **Conditional Clear**: Only if switching sessions (`if (sessionNumber !== current)`)
3. **Build URI**: `x-sonos-http:ST%3a{stationId}.mp3?sid=236&flags=32768&sn={sessionNumber}`
4. **Set Metadata**: Include `.#station` suffix in `<upnp:class>` for streaming
5. **Critical Delay**: 2-second wait after setAVTransportURI before play()
6. **Result**: Reliable station switching in ~3.5 seconds with no SOAP errors

## Common Issues & Solutions

### "Port already in use"
```bash
npm run killall && sleep 2 && npm start > logs/server.log 2>&1 &
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

## Important Planning Documents

The project has several key planning documents in the `docs/` directory:

### Active Plans
- **`docs/REFACTORING_PLAN.md`** - SOAP architecture refactoring plan
  - Phase 1 & 2 completed (centralized SOAP operations, error handling, type safety)
  - Phase 3 & 4 deferred (dependency injection, service refactoring)
  - Includes Pandora architecture overhaul details
  - Tracks alignment with type refactoring efforts

- **`docs/TYPE_REFACTORING_PLAN.md`** - Type safety improvement plan
  - Consolidated document with future work at top, completed work at bottom
  - Achieved: 0 TypeScript errors/warnings, comprehensive error types, SOAP response types
  - Remaining: Strict compiler options, runtime validation, consistent type usage

- **`docs/LIBRARY_INDEX_PLAN.md`** - Music library search optimization plan
  - NEW: Addresses 57-second search times for large libraries (49k+ tracks)
  - Proposes in-memory indexing to reduce to <100ms
  - Maintains zero-dependency philosophy
  - Targeted for v1.7.0

### Test Documentation
- **`docs/TEST_PLAN.md`** - Comprehensive test strategy
  - 96% coverage achieved
  - Details integration test approach
  - Environment variable configuration

### Historical Context
When working on architectural changes or type improvements, always check these planning documents first. They contain important context about what's been done, what worked, what didn't, and what's planned for the future.

## Legacy System Reference
- The legacy node-sonos-http-api code is located at: ~/projects/sonos-old/node-sonos-http-api
- The legacy Sonos API layer implementation is at: ~/projects/sonos-old/node-sonos-discovery
- Don't search GitHub for legacy code - use the local copy

## Git Remotes & GitHub Workflow

### Remote Configuration
- **origin**: Private GitLab (git.bogometer.com) - full repo with all files
- **upstream**: Public GitHub - filtered repo (no private files)

### CRITICAL: Never Pull from GitHub
**NEVER run `git pull upstream` or `git merge upstream/main`**. The GitHub repo has private files removed. Pulling from it will delete your local private files.

### Pushing to GitHub
Always use the `push-to-github.sh` script to sync to GitHub:
```bash
./push-to-github.sh              # Dry run (default) - see what will happen
./push-to-github.sh --action:execute  # Actually push to GitHub
```

This script:
1. Clones to a temp directory
2. Removes files listed in `.github-exclude`
3. Force pushes the filtered version to GitHub
4. Your local repo remains unchanged

### Files Excluded from GitHub
See `.github-exclude` for the full list. Includes:
- `CLAUDE.md`, `.claude/` - Development context
- `docker-compose.yml`, `docker-*.sh` - Build/deploy scripts
- `test/debug/` - Debug test scripts
- `private/` - Environment configs

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
9. **Update Docker Hub Overview**:
   - Go to https://hub.docker.com/repository/docker/kshartman/sonos-alexa-api/general
   - Copy contents from `DOCKERHUB_README.md` (NOT the main README.md)
   - This file is intentionally version-agnostic and doesn't need updating for releases

## Design Decisions & Gotchas
- **HTTPS/TLS not supported** - Design decision to use reverse proxy (nginx) for SSL termination
- Docker health check endpoint exists at /health
- **Saved Queue (Sonos Playlist) Handling**:
  - Saved queues use `file:///jffs/settings/savedqueues.rsq#ID` format
  - Playable directly with `setAVTransportURI` using proper metadata
  - Enumerate via `/status/playlists` or by browsing `SQ:` container
- **Spotify Requirements**: Premium account, linked in Sonos app, must add Spotify favorites for account extraction

## Environment Variables
All configuration can now be set via environment variables. `npm start` loads .env files via dotenv:

### Core Settings
- **PORT**: API server port (default: 5005)
- **HOST**: Interface to bind (default: 0.0.0.0)
- **ANNOUNCE_VOLUME**: Volume for announcements (default: 40)
- **CREATE_DEFAULT_PRESETS**: Auto-generate presets from favorites (default: false)
- **TTS_HOST_IP**: Override auto-detected IP for TTS (useful in Docker)

### Logging
- **LOG_LEVEL**: Log level (error, warn, info, debug, trace)
- **LOGGER**: Logger type - winston or pino (default: winston for dev, pino for prod)
- **LOG_FORMAT**: DEPRECATED - use LOGGER instead
- **DEBUG_LEVEL**: Debug verbosity (error, warn, info, debug, trace) - Note: This is now effectively the same as LOG_LEVEL
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

### Test Environment Variables
- **TEST_ROOM**: Room to use for integration tests (default: first available room)
- **TEST_SERVICE**: Music service for test content discovery (default: library)
- **TEST_FAVORITE**: Specific favorite to use in tests
- **TEST_PLAYLIST**: Specific playlist to use in tests
- **TEST_PANDORA_STATION**: Pandora station name for tests (default: quickmix)
- **TEST_PANDORA_STATIONS**: Semicolon or comma-separated list of stations for testing
- **TEST_MUSICSEARCH_STATION**: Station name for music search testing (default: rock)
- **TEST_SONG_QUERIES**: JSON array of song queries for test content discovery
- **TEST_ALBUM_QUERIES**: JSON array of album queries for test content discovery
- **TEST_VOLUME_DEFAULT**: Initial volume level (0-100) to set for all rooms during test setup

## Service Implementation Status
- **Apple Music**: Full search via iTunes API (no auth needed). Default account SID: 52231
- **Spotify**: Direct playback and SpotifyUrl presets work (v1.5.0). Search requires OAuth2. Premium account required
- **Pandora**: Full integration with PandoraStationManager. Requires `--openssl-legacy-provider` for Blowfish encryption
- **Music Library**: Auto-indexing at startup with search by song/artist/album
- **SiriusXM**: Endpoints exist but return 501 (not implemented)
- **Amazon Music**: No public API available
- **Deezer**: Not implemented
