# Release Notes - v1.1.0

## Overview
This release brings significant improvements to content handling, debugging capabilities, and production deployment support.

## New Features

### Content Support
- **x-rincon-cpcontainer URI support** - Music service containers (Hearts of Space, This Weeks Show) now work correctly
- **x-rincon-playlist URI support** - Music library playlists properly browse and queue all tracks
- **Case-insensitive favorite matching** - Improved reliability when matching favorites

### Debug & Monitoring
- **New `/debug/startup` endpoint** - Provides detailed startup information including:
  - Device discovery status
  - Preset loading results (valid/failed/skipped counts)
  - Favorite resolution statistics
  - Music library indexing status
- **Content analysis script** - Analyze Sonos content across multiple homes
  - Validates all presets
  - Identifies missing favorites
  - Groups content by type and service
  - Supports remote API analysis over VPN

### Production Improvements
- **Pino logger support** - High-performance JSON logging for production (LOGGER=pino)
- **Environment variable configuration** - Docker deployments can configure via environment
- **NODE_ENV handling** - Defaults to development mode when not set
- **ANSI color code removal** - Clean logs in production environments

### API Enhancements
- **`?detailed=true` parameter for `/presets`** - Returns full preset objects with metadata
- **Improved error messages** - Better feedback when favorites or content is not found

## Bug Fixes
- Fixed SOAP 500 errors when playing certain music service favorites
- Fixed lint errors for clean TypeScript build
- Fixed empty presets directory handling in Docker builds
- Fixed logging issues in production environment

## Developer Experience
- Test runner supports remote API testing
- Shell script for content analysis across homes
- Comprehensive API documentation updates
- Added .env-* to gitignore for multiple environment configs

## Breaking Changes
None - This release maintains full backward compatibility with v1.0.0

## Upgrade Instructions
1. Pull the latest code: `git pull`
2. Rebuild your Docker container: `docker-compose build`
3. Restart the service: `docker-compose up -d`
4. No configuration changes required
5. New features are opt-in (debug endpoints, content analysis)

## Acknowledgments
Special thanks to all testers who helped identify the x-rincon-cpcontainer issues!