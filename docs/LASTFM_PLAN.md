# Last.fm Scrobbling Integration Plan

## Overview

This document outlines the plan to add Last.fm scrobbling support to the Sonos Alexa API. Since we already capture all track change events in real-time through UPnP subscriptions, we have the foundation needed to implement automatic scrobbling of listening history to Last.fm.

## Motivation

- **Listening History**: Track what users actually listen to across all Sonos devices
- **Music Discovery**: Leverage Last.fm recommendations based on listening patterns
- **Social Features**: Share listening habits with the Last.fm community
- **Analytics**: Personal music statistics and trends
- **Smart Filtering**: Exclude ambient/sleep music that shouldn't affect listening stats

## Technical Foundation

### What We Already Have
- ✅ Real-time track change detection via UPnP AVTransport events
- ✅ Track metadata capture (artist, title, album, duration)
- ✅ Events from ALL sources (Sonos app, voice control, API, physical buttons)
- ✅ Event system infrastructure for hooking into changes
- ✅ Device state tracking with current track information

### What We Need to Add
- Last.fm API integration (https://www.last.fm/api)
- Track duration monitoring for scrobbling rules
- User authentication and session management
- Configurable filtering system
- API endpoints for filter management
- Scrobbling queue with retry logic

## Implementation Design

### 1. Last.fm API Integration

#### Authentication
- Support both username/password and API key authentication
- Store Last.fm session keys securely
- Support multiple Last.fm accounts per household

#### Core Scrobbling Features
- `track.updateNowPlaying` - Update currently playing track
- `track.scrobble` - Submit completed tracks (after 50% playback or 4 minutes)
- `track.love` - Integration with Sonos favorites

### 2. Filtering System

#### Problem Statement
Ambient sounds, sleep music, and background tracks can dominate Last.fm statistics. For example, playing cricket sounds every night for sleep would make it appear as the most listened track.

#### Filter Types

**Pattern-Based Filters**
```json
{
  "filters": [
    {
      "type": "track",
      "pattern": "cricket*",
      "enabled": true
    },
    {
      "type": "track", 
      "pattern": "*rain sounds*",
      "enabled": true
    },
    {
      "type": "artist",
      "pattern": "Nature Sounds",
      "enabled": true
    }
  ]
}
```

**Genre-Based Filters**
```json
{
  "filters": [
    {
      "type": "genre",
      "values": ["Ambient", "Nature", "White Noise"],
      "enabled": true
    }
  ]
}
```

**Time-Based Filters**
```json
{
  "filters": [
    {
      "type": "schedule",
      "start": "22:00",
      "end": "06:00",
      "description": "No scrobbling during sleep hours",
      "enabled": true
    }
  ]
}
```

**Preset-Based Filters**
```json
{
  "filters": [
    {
      "type": "preset",
      "presets": ["crickets", "ocean waves", "thunderstorm"],
      "description": "Don't scrobble sleep presets",
      "enabled": true
    }
  ]
}
```

**Duration-Based Filters**
```json
{
  "filters": [
    {
      "type": "duration",
      "operator": ">",
      "seconds": 3600,
      "description": "Don't scrobble tracks longer than 1 hour",
      "enabled": true
    }
  ]
}
```

### 3. API Endpoints

#### Configuration
```
GET    /lastfm/config          - Get Last.fm configuration
PUT    /lastfm/config          - Update Last.fm credentials
DELETE /lastfm/config          - Remove Last.fm integration
POST   /lastfm/auth            - Authenticate with Last.fm
GET    /lastfm/status          - Check authentication status
```

#### Filters
```
GET    /lastfm/filters         - List all filters
POST   /lastfm/filters         - Create new filter
GET    /lastfm/filters/{id}    - Get specific filter
PUT    /lastfm/filters/{id}    - Update filter
DELETE /lastfm/filters/{id}    - Delete filter
POST   /lastfm/filters/test    - Test filter against sample data
```

#### Scrobbling Control
```
GET    /lastfm/scrobbling      - Get scrobbling status
PUT    /lastfm/scrobbling      - Enable/disable scrobbling
GET    /lastfm/queue           - View pending scrobbles
POST   /lastfm/queue/flush     - Force flush scrobble queue
```

#### Statistics
```
GET    /lastfm/stats           - Scrobbling statistics
GET    /lastfm/filtered        - Tracks filtered in last 24h
```

### 4. Configuration Schema

```typescript
interface LastFmConfig {
  enabled: boolean;
  accounts: LastFmAccount[];
  filters: ScrobbleFilter[];
  settings: {
    minScrobblePercent: number;      // Default: 50
    minScrobbleSeconds: number;      // Default: 240 (4 minutes)
    maxRetries: number;              // Default: 3
    queueSize: number;               // Default: 100
    flushInterval: number;           // Default: 60000 (1 minute)
  };
}

interface LastFmAccount {
  id: string;
  username: string;
  sessionKey?: string;
  apiKey: string;
  apiSecret: string;
  rooms?: string[];                  // Optional room-specific scrobbling
  enabled: boolean;
}

interface ScrobbleFilter {
  id: string;
  type: 'track' | 'artist' | 'album' | 'genre' | 'schedule' | 'preset' | 'duration' | 'room';
  pattern?: string;                  // For pattern matching
  values?: string[];                 // For exact matches
  operator?: '>' | '<' | '=' | '!='; // For numeric comparisons
  seconds?: number;                  // For duration filters
  start?: string;                    // For schedule filters (HH:MM)
  end?: string;                      // For schedule filters (HH:MM)
  rooms?: string[];                  // For room-specific filters
  presets?: string[];               // For preset filters
  description?: string;
  enabled: boolean;
}
```

### 5. Event Flow

1. **Track Change Detection**
   ```
   UPnP Event → AVTransport → Track Change → Scrobble Manager
   ```

2. **Filter Pipeline**
   ```
   Track Info → Time Filter → Pattern Filter → Duration Filter → Genre Filter → Scrobble Decision
   ```

3. **Scrobbling Process**
   ```
   Now Playing Update → Track Timer → 50% or 4min → Scrobble Queue → Last.fm API
   ```

### 6. Example Usage

#### Setting Up Last.fm
```bash
# Configure Last.fm account
curl -X PUT http://localhost:5005/lastfm/config \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "accounts": [{
      "username": "myusername",
      "apiKey": "xxx",
      "apiSecret": "yyy"
    }]
  }'

# Authenticate
curl -X POST http://localhost:5005/lastfm/auth \
  -d '{"username": "myusername", "password": "mypassword"}'
```

#### Creating Filters
```bash
# Filter out cricket sounds
curl -X POST http://localhost:5005/lastfm/filters \
  -H "Content-Type: application/json" \
  -d '{
    "type": "track",
    "pattern": "*cricket*",
    "description": "Sleep sounds",
    "enabled": true
  }'

# Don't scrobble during sleep hours
curl -X POST http://localhost:5005/lastfm/filters \
  -H "Content-Type: application/json" \
  -d '{
    "type": "schedule",
    "start": "22:00",
    "end": "07:00",
    "description": "Sleep time",
    "enabled": true
  }'

# Filter by preset
curl -X POST http://localhost:5005/lastfm/filters \
  -H "Content-Type: application/json" \
  -d '{
    "type": "preset",
    "presets": ["thunder storm", "ocean waves"],
    "description": "Ambient sleep presets",
    "enabled": true
  }'
```

## Security Considerations

- Store Last.fm credentials encrypted
- Use session keys rather than passwords after initial auth
- Rate limit API calls to respect Last.fm limits
- Implement request signing for API calls
- Support API key rotation

## Performance Considerations

- Queue scrobbles to batch API calls
- Implement exponential backoff for failures
- Cache filter evaluations
- Debounce rapid track changes
- Persist queue to disk for reliability

## Future Enhancements

1. **Smart Filtering**
   - ML-based ambient music detection
   - Automatic sleep music identification
   - Community filter sharing

2. **Advanced Features**
   - Multi-user support with room assignment
   - Playlist generation from Last.fm data
   - Integration with Last.fm recommendations
   - Scrobble history UI

3. **Analytics**
   - Local listening statistics
   - Trend analysis
   - Listening patterns visualization

## Dependencies

- No new runtime dependencies (use native Node.js HTTP)
- Last.fm API documentation: https://www.last.fm/api

## Testing Strategy

1. **Unit Tests**
   - Filter evaluation logic
   - Scrobble timing calculations
   - Queue management

2. **Integration Tests**
   - Last.fm API mock
   - End-to-end scrobbling flow
   - Filter pipeline testing

3. **Manual Testing**
   - Real Last.fm account validation
   - Various filter combinations
   - Edge cases (rapid skips, network failures)

## Success Metrics

- Accurate scrobbling of intentional music listening
- Zero ambient/sleep tracks in Last.fm history
- Reliable scrobbling with network issues
- Minimal performance impact
- User satisfaction with filtering flexibility