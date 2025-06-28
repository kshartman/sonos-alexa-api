# Sonos Alexa API v1.2.0 Release Notes

Released: January 28, 2025

## Major Features

### 🐳 Docker Support
- **Production-ready Docker image** with multi-stage Alpine Linux build
- **Multi-architecture support** (amd64, arm64, arm/v7)
- **Environment variable configuration** - no settings.json required
- **Auto-detection of host IP** for TTS callbacks
- **Docker Compose** with comprehensive environment configuration
- **Non-root container execution** for enhanced security
- **Built-in health checks** for container orchestration
- **Manual publishing workflow** via docker-build.sh script

### 🎤 TTS Improvements
- **curl added to Docker image** for TTS functionality
- **Automatic IP detection** displayed on startup
- **Better error messages** when IP detection fails

## Technical Improvements

### Build & Configuration
- Removed CI/CD workflow in favor of manual Docker publishing
- Enhanced build scripts with proper metadata labels
- Simplified volume mounts - only presets require persistence
- Removed obsolete docker-compose version attribute
- Updated setup scripts to use environment variables exclusively

### Documentation
- Added comprehensive DOCKER.md with:
  - Quick start guide
  - Environment variable reference
  - Docker Compose examples
  - Troubleshooting section
- Updated README with Docker installation instructions

## Bug Fixes
- Fixed TTS failures in containerized environments
- Resolved permission issues with cache directories
- Fixed container naming in docker-run.sh script
- Corrected package.json version:save script for ESLint compliance

## Breaking Changes
- None - fully backward compatible

## Docker Quick Start

```bash
# Using Docker Compose (recommended)
curl -O https://raw.githubusercontent.com/kshartman/sonos-alexa-api/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/kshartman/sonos-alexa-api/main/.env.example
cp .env.example .env
# Edit .env with your settings
docker-compose up -d

# Or using Docker directly
docker run -d \
  --name sonosd \
  --network host \
  -e DEFAULT_ROOM="Living Room" \
  -e LOG_LEVEL=info \
  -v ./presets:/app/presets:ro \
  kshartman/sonos-alexa-api:latest
```

## Notes
- Docker image will be published to Docker Hub as `kshartman/sonos-alexa-api`
- Host networking is required for SSDP discovery
- TTS providers (VoiceRSS, Google) work out of the box
- All configuration via environment variables for 12-factor app compliance

## Contributors
- Shane Hartman (@kshartman)
- Claude (Anthropic)