# Scripts Directory

This directory contains various utility scripts for analyzing and managing the Sonos Alexa API system.

## Analysis Scripts

### analyze-content.sh
Generates comprehensive content analysis reports for a Sonos system, including:
- Favorites breakdown by service and type
- Preset validation and status
- Music library statistics and top content
- Available Pandora stations with source tracking

**Usage:** `./analyze-content.sh [home-name] [api-url] [room-name]`

**Output files:**
- `homes/{home}/content-analysis.md` - Detailed favorites and presets breakdown
- `homes/{home}/preset-validation-results.md` - Preset validation status
- `homes/{home}/music-library-analysis.md` - Library statistics
- `homes/{home}/music-library.json` - Optimized JSON export of tracks

### analyze-infrastructure.sh
Analyzes the Sonos hardware infrastructure and generates device inventory reports:
- Device models and IP addresses
- Stereo pairs and surround configurations
- Zone topology and groupings
- Network connectivity details

**Usage:** `./analyze-infrastructure.sh [home-name] [api-url]`

**Output files:**
- `homes/{home}/infrastructure-analysis.md` - Device inventory and configuration
- `homes/{home}/infrastructure-details.json` - Detailed device data

### analyze-build.sh
Queries a running Sonos API instance to determine build information:
- Version number and build date
- Environment configuration
- Logger type and settings
- Correlates build date with git commits

**Usage:** `./analyze-build.sh <host> <port>`

### analyze-auth-failures.sh
Analyzes authentication failure logs to identify potential security issues:
- Failed authentication attempts by IP
- Timestamp analysis of failures
- Pattern detection for brute force attempts

**Usage:** `./analyze-auth-failures.sh [log-file]`

## Supporting TypeScript Files

### analyze-home-content.ts
TypeScript implementation that powers `analyze-content.sh`. Handles:
- Favorites categorization and service detection
- Preset validation logic
- Music library data aggregation
- Pandora station analysis

### analyze-home-infrastructure.ts
TypeScript implementation that powers `analyze-infrastructure.sh`. Handles:
- Device discovery and categorization
- Stereo/surround pair detection
- Zone topology mapping
- JSON report generation

## Common Options

All shell scripts support the `--help` flag for detailed usage information:
```bash
./scripts/analyze-content.sh --help
./scripts/analyze-infrastructure.sh --help
./scripts/analyze-build.sh --help
```

## Requirements

- The TypeScript scripts require `tsx` to be installed: `npm install -g tsx`
- The Sonos API must be running and accessible at the specified URL
- Write access to the project directory for output files

## Output Directory Structure

All analysis scripts create their output in the `homes/{home-name}/` directory structure at the project root, making it easy to maintain separate analyses for different Sonos installations (home, office, cabin, etc.).

## Direct Device Scripts

These scripts connect directly to Sonos devices via their IP address, not through the API.

### pandoradump.sh
Captures raw Pandora data directly from a Sonos device:
- Dumps all Pandora-related data structures
- Helps troubleshoot station loading issues
- Useful for understanding Pandora integration internals

**Usage:** 
- `./pandoradump.sh 192.168.1.50` - Output to stdout
- `./pandoradump.sh 192.168.1.50 --output dump.txt` - Output to file
- `SONOS_IP=192.168.1.50 ./pandoradump.sh` - Using environment variable

**Note:** Works best when using the IP of a zone coordinator.

### sonosdump.sh
Comprehensive diagnostic dump directly from a Sonos device:
- All device information and capabilities
- Current playback state for all zones
- Network topology and groupings
- Favorites and playlists
- Music service configurations

**Usage:** 
- `./sonosdump.sh 192.168.1.50` - Output to stdout
- `./sonosdump.sh 192.168.1.50 --output dump.txt` - Output to file
- `SONOS_IP=192.168.1.50 ./sonosdump.sh` - Using environment variable

**Note:** Works best when using the IP of a zone coordinator.