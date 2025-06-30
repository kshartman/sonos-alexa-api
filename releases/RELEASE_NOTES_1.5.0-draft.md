# Sonos Alexa API v1.5.0 Release Notes (DRAFT)

## Release Date: TBD

## Overview
Version 1.5.0 focuses on [TO BE DETERMINED - describe main theme of this release].

## New Features

### Feature 1 (Tentative)
- Description of feature
- Key capabilities
- Use cases

### Feature 2 (Tentative)
- Description of feature
- Benefits
- Implementation details

## Technical Improvements

### Code Quality
- TypeScript type safety improvements
- Error handling enhancements
- Performance optimizations

### Documentation
- API documentation updates
- README improvements
- Example usage scenarios

## Bug Fixes
- Fix description 1
- Fix description 2

## Architecture & Performance

### Improvements
- Architecture improvements
- Performance enhancements
- Resource optimization

## Breaking Changes
None - This release maintains backward compatibility with v1.4.0

## Migration Guide
No migration required. All changes are backward compatible.

## Known Issues
- Issue 1
- Issue 2

## Future Enhancements
- Enhancement 1
- Enhancement 2
- Enhancement 3

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