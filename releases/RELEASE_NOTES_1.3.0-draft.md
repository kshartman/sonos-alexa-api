# v1.3.0 Release Notes (DRAFT)

## 🎯 Device Information API

This release adds comprehensive device information endpoints to provide detailed hardware and configuration data.

### New Features

#### Device Information Endpoints
- **GET /devices** - List all devices with model, IP, and stereo/surround configuration
- **GET /devices/id/{deviceId}** - Get specific device by ID (with or without uuid: prefix)
- **GET /devices/room/{roomName}** - Get all devices in a specific room

#### Device Details Include:
- Room name
- Device ID (UUID)
- Model name (e.g., "Sonos Era 100", "Sonos Era 300", "Sonos Connect")
- IP address
- Stereo/surround pairing information:
  - Role: left, right, center, surround-left, surround-right, subwoofer, height
  - Group ID for paired devices

### Improvements

#### Model Name Resolution
- Fixed "Unknown" model names appearing for devices discovered via topology
- Model information now properly updates when devices are discovered via SSDP
- All devices now display their correct hardware model

#### Stereo Pair Detection
- Accurate left/right channel detection for stereo pairs
- Support for all Sonos speaker roles (stereo, surround, Atmos)
- Proper parsing of channelMapSet data from topology

### Example Response

```json
[
  {
    "room": "BedroomSpeakers",
    "name": "BedroomSpeakers",
    "id": "uuid:RINCON_F0F6C1AF852C01400",
    "model": "Sonos Era 100",
    "ip": "192.168.4.76",
    "paired": {
      "role": "left",
      "groupId": "BedroomSpeakers:stereopair"
    }
  },
  {
    "room": "BedroomSpeakers",
    "name": "BedroomSpeakers", 
    "id": "uuid:RINCON_C4387597EEE001400",
    "model": "Sonos Era 100",
    "ip": "192.168.4.64",
    "paired": {
      "role": "right",
      "groupId": "BedroomSpeakers:stereopair"
    }
  }
]
```

### Technical Details

- Device discovery now updates existing device records with proper model information
- Added comprehensive channel role mapping for all Sonos configurations
- TypeScript improvements for better type safety in device handling

## 🔍 Infrastructure Analysis Tools

New command-line tools for analyzing and documenting Sonos system configuration.

### analyze-infrastructure.sh
Generates comprehensive reports about your Sonos system infrastructure:

```bash
./analyze-infrastructure.sh [home-name] [api-url]
```

#### Reports Generated:
1. **infrastructure-analysis.md** - Complete system overview including:
   - Device inventory with model details
   - Zone/group configurations  
   - Network topology and subnet distribution
   - Current playback states
   - Stereo pair configurations
   - Raw device JSON data

2. **device-matrix.md** - Feature compatibility matrix showing:
   - Supported features by model (Line-In, AirPlay, Voice, Portable)
   - Accurate voice assistant support based on model
   - Room-by-room capability breakdown
   - Group membership status

### Example Usage:
```bash
# Analyze local system
./analyze-infrastructure.sh my-home

# Analyze remote system
./analyze-infrastructure.sh office-system http://192.168.1.100:5005
```

## 🐛 Bug Fixes

### Detailed Endpoints Regression Fix
- Fixed regression where `/detailed` endpoints were returning simple arrays instead of full objects
- Affected endpoints now properly return complete data:
  - `/presets/detailed` - Returns full preset objects with metadata
  - `/{room}/favorites/detailed` - Returns favorites with URI and metadata
  - `/{room}/playlists/detailed` - Returns playlists with full details
- Updated route patterns from `/detailed` to `/{detailed}` to properly capture the parameter
- Queue endpoints (`/queue/detailed`) remain unchanged as they use a different pattern

### Content Analyzer Improvements
- Fixed favorites URL format in analyze-home-content.ts (from query parameter to path format)
- Added defensive checks for missing URI and title properties in favorites
- Improved error handling to prevent crashes with malformed data
- Better logging for debugging problematic favorites

### Infrastructure Analysis Enhancements
- Device matrix now shows stereo/surround role designations (L, R, C, SW, SL, SR, HL, HR)
- Improved readability for stereo pairs and home theater configurations
- Makes it easier to identify which speaker is which in multi-speaker setups

## 📚 Music Library API

New endpoints for accessing and analyzing your local music library content.

### New Library Endpoints
- **GET /library/index** - Get music library indexing status and metadata
- **GET /library/refresh** - Trigger a manual re-index of the music library
- **GET /library/summary** - Get library overview with top artists and albums
- **GET /library/detailed** - Get complete track, artist, and album data

### Library Summary Response Example:
```json
{
  "totalTracks": 49322,
  "totalArtists": 4621,
  "totalAlbums": 3819,
  "topArtists": [
    {
      "name": "Academy of Ancient Music",
      "trackCount": 568
    },
    {
      "name": "Beach Boys",
      "trackCount": 314
    }
  ],
  "topAlbums": [
    {
      "name": "Greatest Hits",
      "trackCount": 578
    }
  ],
  "lastUpdated": "2025-06-30T05:03:45.839Z",
  "isIndexing": false,
  "indexingProgress": 0
}
```

### Music Library Analysis Integration
- Content analysis script now generates music library report
- **music-library-analysis.md** includes:
  - Total tracks, artists, and albums
  - Top 10 artists by track count
  - Top 10 albums by track count
  - Average tracks per artist/album statistics
  - Last index time and status
- **music-library.json** - Pretty-printed JSON export of all tracks:
  - Optimized format with only essential fields (id, title, artist, album, uri)
  - Reduced file size by ~50% by removing search-only fields
  - Pretty-printed with jq if available

### Technical Implementation
- Added `getSummary()` and `getDetailedData()` methods to MusicLibraryCache class
- Efficient data structures with artist and album indexes
- Supports libraries up to Sonos limit of 65,000 tracks
- Automatic background re-indexing based on configured interval

## 🎵 Content Analysis Improvements

### Enhanced analyze-content.sh Script
- Now generates three comprehensive reports:
  1. **content-analysis.md** - Favorites and presets breakdown
  2. **preset-validation-results.md** - Preset validation status
  3. **music-library-analysis.md** - Music library statistics

### URI Type Recognition
- Updated content analyzer to properly categorize all Sonos URI types:
  - `file:` - Local filesystem references
  - `x-rincon-mp3radio:` - MP3 Internet radio streams
  - `x-rincon-stream:` - Internal streams (Line-In, TV audio)
  - `x-sonos-http:` - Direct HTTP streams
  - `x-sonosapi-hls-static:` - Static HLS content (Calm app, Sonos Radio)

### Coming in Future Releases

- WebSocket support for real-time device state updates
- Enhanced error handling and retry logic
- Additional device capabilities and service information
- Music library search improvements

---

*Note: This is a draft. Final release notes will be updated before v1.3.0 release.*