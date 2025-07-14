# Release Notes - v1.6.0 (DRAFT)

**Release Date**: TBD

## Overview

Version 1.6.0 brings enhanced authentication monitoring, improved preset validation, and comprehensive server status reporting to the Sonos Alexa API. This release focuses on operational visibility and resilience.

## New Features

### 🔐 Enhanced Authentication Status Monitoring
- [x] **Pandora Status Endpoint** (`/pandora/status`) - Shows detailed authentication state, station counts, and cache age
- [x] **Spotify Status Endpoint** (`/spotify/status`) - Displays token expiry, authentication state, and last auth time
- [x] **Authentication State Tracking** - Both services now track and report authentication success/failure with timestamps

### 📊 Server Summary JSON Output
- [x] Added `--json` flag to `server-summary.sh` for structured monitoring output
- [x] Proper ISO 8601 timestamps in JSON mode for integration with monitoring tools
- [x] Comprehensive status including entities, readiness, and authentication states

### 🎯 Deferred Preset Validation
- [x] Presets now validate only when first used, preventing issues with devices discovered after startup
- [x] Automatic validation when all referenced rooms become available
- [x] Prevents valid rooms (like SpaSpeakers) from being removed due to discovery timing

## Improvements

### Authentication & Token Management
- [x] **Proactive Spotify Token Refresh** - Tokens refresh automatically on startup when refresh token is configured
- [x] **Token Expiry Tracking** - Spotify shows remaining time until token expires
- [x] **Authentication Age Display** - Shows how long ago authentication occurred for expired tokens
- [x] **Detailed Status Messages** - Human-readable authentication states for both services

### Developer Experience
- [x] Add `--help` support to test-remote.sh, set-version.sh, and push-to-github.sh scripts
- [x] push-to-github.sh now shows usage by default instead of running dry-run
- [x] Color-coded authentication states in server-summary.sh (green=authenticated, yellow=partial, red=failed)

### API Enhancements
- [x] Pandora status distinguishes between "not configured", "authenticated", "auth failed", and "not authenticated"
- [x] Spotify status shows different states for "authenticated", "token expired", "has refresh token", and "not authenticated"
- [x] Both status endpoints include cache age and detailed metadata

### Documentation
- [x] Fixed incorrect Pandora cache expiration time in README (was "1 hour", actually "5 minutes for favorites, 24 hours for API")
- [x] Clarified Pandora multi-account behavior and session number handling
- [x] Added comprehensive documentation for authentication status monitoring
- [x] Updated utility scripts section with all available tools
- [x] Added OpenAPI documentation for new authentication endpoints

## Bug Fixes

- [x] Corrected Pandora station cache refresh documentation
- [x] Fixed preset validation removing valid rooms that haven't been discovered yet
- [x] Fixed Spotify token showing as expired from 1969 when using refresh token
- [x] Fixed library search resuming previous content (e.g., Pandora) instead of playing searched tracks

## Breaking Changes

None.

## Dependencies

No dependency updates in this release.

## Migration Guide

No migration required from v1.5.0. All changes are backward compatible.

### For Monitoring Tools

If you have monitoring tools that check authentication status, you can now use the enhanced status endpoints:

```bash
# Instead of checking for Spotify/Pandora errors in logs:
curl http://localhost:5005/pandora/status
curl http://localhost:5005/spotify/status

# For comprehensive monitoring:
./scripts/server-summary.sh localhost 5005 --json
```

## Technical Details

### Preset Validation Changes
- Presets are now parsed at startup but validated only on first use
- Validation occurs automatically when all required rooms are discovered
- The `getPreset()` and `getAllPresets()` methods are now async to support deferred validation
- Raw preset data is accessible via `getRawPresets()` without triggering validation

### Authentication Status Implementation
- PandoraStationManager tracks authentication attempts with timestamps and error messages
- SpotifyAuthService provides detailed token status including expiry calculations
- Both services distinguish between having credentials, being authenticated, and auth failures

### Library Search Fix
- Library search methods now properly set transport URI to queue before playing
- Prevents Sonos from resuming previous content when playing library search results
- Apple and Spotify search were already handling this correctly

## Known Issues

- Spotify tokens initialized from refresh token show authentication time as token issue time (1 hour before expiry)
- Pandora bot detection can still occur with frequent API requests - use favorites when possible

## What's Next

Planning for v1.7.0 includes:
- Amazon Music integration (pending API availability)
- Enhanced error recovery mechanisms
- **Performance optimizations for large music libraries**
  - Implement in-memory search indexing to reduce search time from ~60s to <100ms
  - Add inverted word indexes for title, artist, and album searches
  - Use Set intersections for efficient multi-word queries
  - Add trie data structure for prefix matching
  - Maintain zero-dependency approach with better algorithms
- WebSocket support for real-time state updates
- Improved preset management with validation status in UI

---

**Note**: This is a draft document. Features and changes are subject to modification before the final release.