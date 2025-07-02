# Sonos Alexa API v1.5.0 Release Notes (DRAFT)

## Release Date: TBD

## Overview
Version 1.5.0 introduces Spotify URL support in presets, enhances Spotify integration capabilities, and improves service discovery functionality.

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

### Enhanced Spotify Integration
- **Account Extraction**: Automatically extracts Spotify account information from favorites (S2 compatible)
- **Multiple Account Support**: Handles multiple Spotify accounts with separate prefixes
- **Direct ID Playback**: Play any Spotify content with known IDs via `/spotify/play/{id}`
- **Dynamic Flags System**: Smart flag selection based on content type and context
- **S2 Compatibility**: Removed dependency on deprecated S1 endpoints

### Service Discovery Improvements
- **Service ID Extraction**: Gets current Spotify service ID from Sonos system
- **Dynamic Service Resolution**: No longer relies on hardcoded service IDs
- **Better Error Handling**: Clear messages when Spotify isn't configured

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

### Documentation
- **New SPOTIFY.md**: Comprehensive guide to Spotify integration
- **New PRESETS.md**: Detailed preset configuration documentation
- **API.md Updates**: Added service-specific endpoints documentation
- **Examples**: Multiple preset examples demonstrating SpotifyUrl feature

## Bug Fixes
- Fixed Spotify favorites with old service ID (3079) not playing correctly
- Resolved issue with token extraction from r:resMD metadata field
- Fixed mutual exclusivity validation for preset content sources

## Breaking Changes
- **S2 Systems Only**: S1 systems are no longer supported due to removal of `/status/accounts` and `Status:ListAccounts` dependencies
- **Spotify Favorites Required**: For Spotify to work, you MUST add at least one track, album, and playlist to Sonos favorites

## Migration Guide

### For S1 System Users
This version requires a Sonos S2 system. S1 systems are no longer supported.

### For Spotify Users
Ensure you have added the following to your Sonos favorites:
1. At least one Spotify track
2. At least one Spotify album
3. At least one Spotify playlist

These favorites are required for the system to extract Spotify account information on S2 systems.

## Known Issues
- Spotify search functionality requires OAuth credentials (not yet implemented)
- SP:12 browsing fails without Spotify authorization
- Metadata (title, artist, album) may not populate immediately for Spotify content

## Future Enhancements
- OAuth2 implementation for Spotify search capabilities
- Automatic token refresh for Spotify credentials
- Support for more Spotify content types (podcasts, audiobooks)
- Enhanced metadata retrieval for playing content

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