# Sonos Alexa API v1.4.0 Release Notes

## Release Date: June 30, 2025

## Overview
Version 1.4.0 focuses on test infrastructure improvements and bug fixes that enhance the stability and reliability of the API.

## New Features

### Potential Features (TBD)
The following features are under consideration for this release:

#### Spotify Public Content Support (Tentative)
- **Spotify URL/URI Playback**: Play Spotify content directly by URL or URI
  - Support for track, album, playlist, and artist links
  - Automatic parsing of Spotify share URLs
  - Direct URI support (e.g., `spotify:playlist:37i9dQZF1DX4JAvHpjipBk`)

- **Popular Playlist Access**: Curated collection of public playlists
  - Global and regional Top 50 charts
  - Genre-specific playlists (Chill, Workout, etc.)
  - No authentication required

- **Simplified Integration**: Leverages existing Sonos Spotify connection
  - No OAuth implementation needed
  - No credential storage
  - Works with user's existing Spotify setup in Sonos

#### API Endpoints (If Spotify is implemented)
- `GET /{room}/spotify/uri/{spotifyUri}` - Play by Spotify URI
- `GET /{room}/spotify/url` - Play by Spotify URL (URL in query param)
- `GET /{room}/spotify/playlist/{playlistId}` - Play specific playlist
- `GET /{room}/spotify/popular/{playlistName}` - Play from curated list

### New Debug Endpoints
- `GET /debug/startup` - Enhanced with version and config information
- `GET /debug/startup/config` - Returns full startup configuration including version

## Technical Improvements

### Configuration Architecture Refactoring
- **Single Source of Truth**: Config loader now handles ALL environment variables (except logger initialization)
- **Startup Banner**: Application version and host info now display as first log entries
- **Debug Manager Integration**: Debug configuration now reads from unified config instead of environment
- **Computed Fields**: Added `isDevelopment` and `isProduction` boolean helpers to config
- **Field Normalization**: Logger type automatically normalized to lowercase
- **Environment Variables**: All modules now read from config object instead of `process.env`
- **Version in Config**: Application version now included as readonly field in config object
- **Debug Endpoints**: New `/debug/startup/config` endpoint shows full startup configuration

### Test Infrastructure Enhancements
- Fixed event bridge timing issues for reliable test execution
- Improved device ID comparison to handle UUID prefix inconsistencies
- Enhanced coordinator selection for stereo pairs and groups
- Standardized test cleanup patterns across all integration tests
- Added comprehensive test result tracking

### Bug Fixes
- Fixed playback state event handling for stereo pairs
- Resolved volume test serialization crashes
- Corrected content loading order for faster test startup
- Fixed EventEmitter max listeners warnings
- Fixed startup message ordering to appear before all other logs

### Security Improvements
- Added authentication failure logging with client IP and username
- Logs missing authentication attempts with warning level
- Logs invalid authorization headers for security monitoring
- Helps identify potential attacks or authentication misconfigurations
- Implemented structured logging for auth failures
  - Auth failures include metadata: ip, user (if known), auth type, and path
  - Auth types: 'missing', 'invalid-header', 'invalid-credentials'
  - Works consistently across Winston and Pino loggers
- Added `scripts/analyze-auth-failures.sh` for monitoring auth failures
  - Interactive mode shows detailed failure analysis
  - Cron mode for automated threshold monitoring
  - Configurable thresholds: hourly (5), 8-hourly (10), daily (20)
  - Shows top offending IPs when thresholds exceeded
  - Updated to parse structured log format and use Docker relative time syntax

### Build and Deployment Improvements
- Added build date tracking for container deployments
  - New npm script `build:date` retrieves last git commit date
  - Docker builds now pass BUILD_SOURCE_DATE to track source version
  - Build date displayed in startup banner and available via API
  - Defaults to current time when not in container environment
  - Accessible via `/debug/startup` and `/debug/startup/config` endpoints
- Added `scripts/analyze-build.sh` for deployment verification
  - Fetches build information from running instances
  - Identifies exact git commit from build date
  - Shows server info: version, environment, uptime, auth status
  - Smart terminal detection for proper color handling
  - Useful for verifying which version is deployed on production servers

## Architecture & Performance

### Code Quality
- Reduced integration test failures from 8 to 2 (98.7% pass rate)
- Improved test stability with proper wait states
- Enhanced error handling in event management
- Better coordinator device selection logic

### Documentation
- Created comprehensive Spotify feature analysis document
- Added decision matrix for implementation approach
- Documented use cases and target audiences
- Updated CLAUDE.md with test patterns and fixes
- Added new config fields: `nodeEnv`, `logger`, `ttsHostIp`, `debugCategories`, `buildDate`
- Documented configuration architecture with single source of truth pattern
- Documented BUILD_SOURCE_DATE environment variable for container builds
- Added monitoring script documentation:
  - Cron setup examples for auth failure monitoring
  - Deployment verification workflow with analyze-build.sh

## Breaking Changes
None - This release maintains backward compatibility with v1.3.0

## Migration Guide
No migration required. Spotify features are additive and optional.

## Known Issues
- Spotify personal playlists not accessible (by design - public content only)
- Dynamic Spotify search not implemented (requires full OAuth)
- Two group management tests still failing (carried from v1.3.0)

## Future Enhancements
- Phase 2: Enhanced public content discovery
- Phase 3: Optional OAuth for personal content (if demand justifies)
- Complete resolution of remaining test failures

## Acknowledgments
Thanks to the ChatGPT analysis that validated our simplified Spotify approach, confirming it delivers ~80% of use cases with ~20% of complexity.

## Installation
```bash
docker pull kshartman/sonos-alexa-api:v1.4.0
# or
docker pull kshartman/sonos-alexa-api:latest
```

## Upgrade from v1.3.0
```bash
docker stop sonos-api
docker rm sonos-api
docker pull kshartman/sonos-alexa-api:v1.4.0
docker run -d --name sonos-api --network host \
  -v $(pwd)/presets:/app/presets \
  -v $(pwd)/settings.json:/app/settings.json \
  -v $(pwd)/data:/app/data \
  -e CREATE_DEFAULT_PRESETS=false \
  kshartman/sonos-alexa-api:v1.4.0
```