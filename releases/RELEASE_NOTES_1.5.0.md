# Sonos Alexa API v1.5.0 Release Notes

## Release Date: July 9, 2025

## Overview
Version 1.5.0 introduces comprehensive Spotify integration with OAuth2 authentication, enabling full search functionality alongside the existing URL-based preset support and direct playback capabilities. This release also includes major improvements to Pandora reliability with automatic session management.

## New Features

### Spotify URL Support in Presets
- **Direct Spotify Links**: Use Spotify share URLs directly in preset files
- **Automatic URI Conversion**: System automatically converts Spotify URLs to Sonos-compatible URIs
- **Multiple Content Types**: Support for tracks, albums, playlists, and artists
- **Example**:
  ```json
  {
    "players": [{ "roomName": "Office", "volume": 30 }],
    "spotifyUrl": "https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp"
  }
  ```

### Spotify OAuth2 Authentication
- **Full Search Support**: Search for songs, albums, artists, and playlists by name
- **Automatic Token Management**: Tokens refresh automatically before expiration
- **Multi-Instance Support**: Each deployment maintains separate token storage
- **Headless Authentication**: Setup script for environments without browser access
- **Browser-Based Flow**: Simple web-based authentication at `/spotify/auth`

### Enhanced Spotify Integration
- **Account Extraction**: Automatically extracts Spotify account information from favorites (S2 compatible)
- **Multiple Account Support**: Handles multiple Spotify accounts with separate prefixes
- **Direct ID Playback**: Play any Spotify content with known IDs via `/spotify/play/{id}`
- **Dynamic Flags System**: Smart flag selection based on content type and context
- **S2 Compatibility**: Removed dependency on deprecated S1 endpoints
- **Artist Search**: Added artist as synonym for station in music search endpoints

### Service Discovery Improvements
- **Service ID Extraction**: Gets current Spotify service ID from Sonos system
- **Dynamic Service Resolution**: No longer relies on hardcoded service IDs
- **Better Error Handling**: Clear messages when Spotify isn't configured

### Music Library Enhancements
- **Fuzzy Search Support**: Intelligent fuzzy matching for more flexible searches
  - Automatically falls back to fuzzy matching when exact matches aren't found
  - Multi-field search across artist, album, and title
  - Smart query handling for better search results
- **Enhanced Statistics**: New getSummary() and getDetailedData() methods
  - Track library statistics (top artists, albums, track counts)
  - Optimized data export for analysis
- **Random Queue Limit**: Library artist searches now queue random tracks up to configured limit
  - Default limit: 100 tracks, configurable via `LIBRARY_RANDOM_QUEUE_LIMIT`
  - Consistent behavior across all services

### API Health and Monitoring
- **Device Health Endpoint**: `/debug/device-health` for monitoring system health
  - Track device event subscription status
  - Detect stale NOTIFY events (90+ seconds without updates)
  - Monitor event timing and listener health
- **Enhanced Diagnostics**: Better visibility into system operation

### Pandora Reliability Improvements
- **Complete Architecture Overhaul**: Pandora station management rebuilt from ground up
  - New `PandoraStationManager` maintains pre-loaded in-memory cache of all stations
  - NO API calls during playback - only memory lookups for instant response
  - Automatic background refresh: favorites every 5 minutes, API cache every 24 hours
  - Merged station list combines API stations with Sonos favorites, tracking source as 'api', 'favorite', or 'both'
- **Station Switching Fixed**: Resolved "bad state" where Pandora plays but state shows STOPPED
  - Added critical 2-second delay after setAVTransportURI for session initialization
  - Proper `.#station` metadata suffix for streaming broadcast content
  - Conditional queue clearing only when switching between different sessions
  - Eliminated SOAP 500/501 errors completely
- **Music Search Support**: Full Pandora search functionality
  - `/{room}/musicsearch/pandora/station/{name}` - Search for stations
  - `/{room}/musicsearch/pandora/artist/{name}` - Search for artist radio
  - Fuzzy matching algorithm: exact match → starts with → contains → word boundary
  - Searches work across entire merged station list (API + favorites)
- **Enhanced Station Discovery**: Robust fallback mechanisms
  - Primary: Load from API cache file if available
  - Fallback: Browse Sonos favorites (FV:2 container) when API unavailable
  - Works even during API backoff or authentication failures
  - Proper XML parsing for DIDL-Lite favorites with res object handling
- **Session Management**: Intelligent Pandora session handling
  - Automatic session number extraction from favorite URIs
  - Proper flags handling (32768 for station playback)
  - Clear endpoint (`/{room}/pandora/clear`) for explicit session cleanup
  - Station switching now takes only 3-5 seconds with ~3.5s typical response time
- **Improved Error Handling**: 
  - Returns proper 404 with station name when not found
  - Graceful handling of API backoff periods
  - Clear logging of station source for debugging

### New API Endpoints
- **Artist Search**: `/{room}/musicsearch/{service}/artist/{name}` - Search for artists by name
- **Default Room Artist**: `/artist/{name}` - Artist search using default room
- **Queue Management**: `POST /{room}/queue` - Add items to the playback queue

## Technical Improvements

### Enhanced Type Safety and Error Handling
- **Comprehensive Error Classes**: New error hierarchy with specific error types for better debugging
  - `SonosError`, `SOAPError`, `UPnPError`, `DeviceNotFoundError`, and more
  - Proper HTTP status code mapping for all error types
- **SOAP Response Type Definitions**: All SOAP operations now return typed responses
  - Eliminated most `any` types in favor of proper interfaces
  - Better IntelliSense support and compile-time error detection
- **Retry Logic**: Automatic retry with exponential backoff for transient failures
  - Configurable retry policies for different operation types
  - Smart retry decisions based on UPnP error codes
- **TypeScript Improvements**: Significantly reduced type safety warnings

### Code Quality
- **Spotify Service Architecture**: Clean separation of concerns for Spotify functionality
- **Token Extraction**: Improved parsing of Spotify tokens from favorite metadata
- **URI Generation**: Robust URI construction for different Spotify content types
- **SOAP Architecture Refactoring**: Phase 1 and 2 completed
  - All SOAP operations centralized in SonosDevice class
  - Services no longer make direct device calls

### Logging Improvements
- **Trace Level Support**: Fixed trace log level for both `/loglevel/trace` and `/debug/level/trace` endpoints
- **Unified Log Level Management**: DEBUG_LEVEL and LOG_LEVEL now control the same underlying logger
  - Eliminates synchronization issues between debugManager and logger
  - Simplifies configuration and runtime behavior
- **Environment Variable Consistency**: Process environment updated when log level changes dynamically
- **Reduced Log Verbosity**: Moved routine operations from info to debug level
  - Device discovery and service subscription logs
  - Scheduler task creation and execution logs
  - UPnP event subscription success messages
  - Significantly cleaner logs during normal operation

### Infrastructure Improvements
- **Centralized Scheduler System**:
  - New scheduler abstraction for all timer-based operations
  - Automatic detection and disabling in test environments
  - Prevents test runners from hanging after completion
  - Unified management of intervals and timeouts with unref support
  - Migrated 8 services to use centralized scheduler:
    - MusicLibraryCache (library reindexing)
    - ServicesCache (24-hour refresh)
    - EventManager (health checks)
    - TTSService (cache cleanup)
    - Discovery (SSDP search)
    - UPnP Subscriber (subscription renewals)
    - PresetLoader (file watching)
    - DefaultRoomManager (debounced saves)
  - **New Debug Endpoint**: `/debug/scheduler` provides detailed task status
    - Shows all scheduled tasks with human-readable timing
    - Displays last run time, next run time, and execution count
    - Includes task type (interval or timeout) and current status
- **EventManager Enhancements**:
  - Group-aware event handling for stereo pairs and grouped speakers
  - Device health monitoring with configurable timeouts
  - Improved memory management and listener cleanup
  - Fixed max listeners warnings
  - Fixed dependency on global discovery object
- **Discovery Improvements**:
  - Better handling of stereo pairs and grouped speakers
  - Dynamic EventManager cache updates on topology changes
  - New `getGroupMembers()` method for group handling
- **Test Infrastructure**:
  - Fixed track-change events for stereo pairs
  - File-based triggers for TTY-independent interactive mode
  - Comprehensive test reliability improvements
  - Support for new test environment variables
  - Added `getTestTimeout()` helper for consistent timeout management
  - Support for `TEST_NO_TIMEOUT` environment variable
  - Replaced `TEST_DEBUG` with `LOG_LEVEL` environment variable
  - Added `--match` as synonym for `--grep` in test runner
  - Enhanced EventBridge logging with trace level support
  - Improved TTS test timing instrumentation
  - Added test settling time between TTS tests (2s normally, 5s after multi-room tests)
  - Enhanced test setup/teardown with clear visual separators
  - Fixed TTS test reliability with proper playback state management
  - **Test Organization**: Moved EventManager unit tests to proper location
    - Mock device tests now in unit test suite where they belong
    - Integration tests focus exclusively on real device interactions
    - Maintained 96% overall test coverage

### Documentation
- **New SPOTIFY.md**: Comprehensive guide to Spotify integration
- **New PRESETS.md**: Detailed preset configuration documentation
- **API.md Updates**: Added service-specific endpoints documentation
- **Examples**: Multiple preset examples demonstrating SpotifyUrl feature

## Bug Fixes
- Fixed Spotify favorites with old service ID (3079) not playing correctly
- Resolved issue with token extraction from r:resMD metadata field
- Fixed mutual exclusivity validation for preset content sources
- Fixed track-change events not being received for stereo pairs
- Fixed EventManager max listeners warnings
- Fixed volume endpoint to use GET instead of POST
- Enhanced error handling for SOAP operations with proper retry logic
- Fixed Pandora station switching failures due to session locks
- Fixed FV:2 browse parsing to correctly extract Pandora favorites
- Fixed double-encoding of Pandora station URIs
- Fixed Pandora API singleton pattern to maintain cache between requests
- Fixed Pandora "bad state" where audio plays but state tracking shows STOPPED
- Fixed station switching causing SOAP 500 errors by implementing proper delays and metadata
- Fixed API calls during playback by implementing pre-loaded cache architecture
- Fixed XML parsing for favorites with res as object instead of string
- **Fixed unit test hanging issue** - Tests now complete immediately instead of hanging for 30+ seconds due to persistent timers
- **Fixed SpotifyService multiple initialization** - Service no longer calls loadConfiguration() multiple times, preventing duplicate startup banners
- **Fixed integration test failures** - Updated device API tests to match current response structure (`room`/`model` fields)
- **Fixed TTS stereo pair volume restoration** - TTS announcements now correctly capture and restore volume for stereo pairs by always using the coordinator device
- **Fixed TTS empty queue restoration** - TTS announcements now properly clear the transport URI when restoring an empty queue state, preventing TTS files from remaining as the current track
- **Fixed TTS playback restoration** - TTS now correctly restores direct URI playback (e.g., from music search) even when the queue is empty, ensuring music continues after announcements
- **Fixed TTS special character handling** - URLs with special characters no longer cause 500 errors
- **Fixed TTS input validation** - Empty or whitespace-only text now returns 400 Bad Request
- **Added help documentation** - Scripts `analyze-build.sh` and `analyze-content.sh` now support `--help` flag
- **Enhanced content analysis** - `analyze-content.sh` now shows Pandora station source (api/favorite/both) and session number

## Breaking Changes
- **S2 Systems Only**: S1 systems are no longer supported due to removal of `/status/accounts` and `Status:ListAccounts` dependencies
- **Spotify Favorites Required**: For Spotify to work, you MUST add at least one track, album, and playlist to Sonos favorites
- **Pandora Stations API Response Changed**: The detailed Pandora stations endpoint (`GET /{room}/pandora/stations/detailed`) now returns a different structure:
  - Station objects now include `apiProperties` and/or `favoriteProperties` sub-objects
  - Properties like `stationToken`, `artUrl`, and `type` are now nested under `apiProperties`
  - Properties like `uri` and `sessionNumber` are now nested under `favoriteProperties`
  - This allows distinguishing between stations from the Pandora API vs. Sonos favorites

## Migration Guide

### For S1 System Users
This version requires a Sonos S2 system. S1 systems are no longer supported.

### For Spotify Users
1. **Basic Playback**: Ensure you have added the following to your Sonos favorites:
   - At least one Spotify track
   - At least one Spotify album
   - At least one Spotify playlist
   
   These favorites are required for the system to extract Spotify account information on S2 systems.

2. **Search Functionality**: To enable Spotify search:
   - Create a Spotify app at https://developer.spotify.com/dashboard
   - Add OAuth credentials to your `.env` file
   - Run authentication setup using browser or headless script
   - See SPOTIFY.md for detailed instructions

## Known Issues
- SP:12 browsing fails without Spotify authorization
- Metadata (title, artist, album) may not populate immediately for Spotify content
- Spotify OAuth tokens stored in data directory (ensure proper permissions)

## Future Enhancements
- Spotify browse capabilities for discovering content
- Support for more Spotify content types (podcasts, audiobooks)
- Enhanced metadata retrieval for playing content
- User-specific playlists and recommendations (requires user auth scope)

## Environment Variables

### New Test Configuration Variables
- `TEST_VOLUME_DEFAULT`: Initial volume level (0-100) for test setup
- `TEST_ROOM`: Specific room to use for integration tests
- `TEST_SERVICE`: Default music service for test content
- `TEST_FAVORITE`: Specific favorite to use in tests
- `TEST_PLAYLIST`: Specific playlist to use in tests
- `TEST_PANDORA_STATION`: Pandora station name for tests
- `TEST_SONG_QUERIES`: JSON array of song queries for test discovery
- `TEST_ALBUM_QUERIES`: JSON array of album queries for test discovery

### Additional Configuration
- `LIBRARY_RANDOM_QUEUE_LIMIT`: Maximum tracks to queue for library artist searches (default: 100)

## Acknowledgments
Thanks to all contributors and users who provided feedback for this release.

## Installation
```bash
docker pull kshartman/sonos-alexa-api:v1.5.0
# or
docker pull kshartman/sonos-alexa-api:latest
```

## Upgrade from v1.4.0
```bash
docker stop sonos-api
docker rm sonos-api
docker pull kshartman/sonos-alexa-api:v1.5.0
docker run -d --name sonos-api --network host \
  -v $(pwd)/presets:/app/presets \
  -v $(pwd)/settings.json:/app/settings.json \
  -v $(pwd)/data:/app/data \
  -e CREATE_DEFAULT_PRESETS=false \
  kshartman/sonos-alexa-api:v1.5.0
```