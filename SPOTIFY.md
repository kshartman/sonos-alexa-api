# Spotify Integration Guide

This document explains the Spotify integration capabilities, requirements, and limitations in the Sonos Alexa API.

## Overview

The Spotify integration allows you to play Spotify content through your Sonos system using various methods. While full search functionality requires OAuth authentication, the system provides several ways to play Spotify content without it.

## Current Capabilities

### 1. Direct ID Playback
Play any Spotify content if you know the ID:
```bash
# Play a track
curl "http://localhost:5005/OfficeSpeakers/spotify/play/spotify:track:1i6N76fftMZhijOzFQ5ZtL"

# Play an album  
curl "http://localhost:5005/OfficeSpeakers/spotify/play/spotify:album:6dVIqQ8qmQ5GBnJ9shOYGE"

# Play a playlist
curl "http://localhost:5005/OfficeSpeakers/spotify/play/spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"

# Play an artist (radio)
curl "http://localhost:5005/OfficeSpeakers/spotify/play/spotify:artist:2x9SpqnPi8rlE9pjHBwmSC"
```

### 2. Spotify Favorites
Play any Spotify content saved as a Sonos favorite:
```bash
curl "http://localhost:5005/OfficeSpeakers/favorite/My%20Spotify%20Playlist"
```

### 3. Presets with Spotify URLs
Use Spotify share links directly in preset files:
```json
{
  "players": [{ "roomName": "Office", "volume": 30 }],
  "spotifyUrl": "https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp"
}
```

### 4. Music Search (OAuth Required)
Full search functionality is now available with OAuth authentication:
```bash
# Search and play songs
curl "http://localhost:5005/OfficeSpeakers/musicsearch/spotify/song/Yesterday"

# Search and play albums
curl "http://localhost:5005/OfficeSpeakers/musicsearch/spotify/album/Abbey%20Road"

# Search and play artists (plays artist radio)
curl "http://localhost:5005/OfficeSpeakers/musicsearch/spotify/artist/The%20Beatles"

# Search and play stations (same as artist)
curl "http://localhost:5005/OfficeSpeakers/musicsearch/spotify/station/Beatles"
```

## Requirements

### System Requirements
- **Sonos S2 system** - S1 systems are not supported
- **Spotify Premium account** - Free accounts cannot be controlled via API
- **Spotify linked in Sonos app** - Must be configured in your Sonos system

### Required Favorites for Account Discovery
Since S2 systems don't expose account details via API, you MUST add at least one of each to Sonos favorites:
- A Spotify track
- A Spotify album  
- A Spotify playlist

These favorites are used to extract authentication tokens and service configuration.

### Basic Playback (No OAuth)
- Known Spotify IDs or share URLs
- Spotify content saved as Sonos favorites

### Full Search Functionality (OAuth)
OAuth authentication is now fully implemented. There are two ways to configure it:

#### Option 1: Pre-configured Refresh Token (Production)
If you already have a refresh token from a previous OAuth flow:
```bash
# Add to .env file
SPOTIFY_CLIENT_ID=your-client-id
SPOTIFY_CLIENT_SECRET=your-client-secret
SPOTIFY_REFRESH_TOKEN=your-refresh-token
```

#### Option 2: OAuth Flow Setup
1. **Create Spotify App**:
   - Go to https://developer.spotify.com/dashboard
   - Create new app (takes 2 minutes)
   - Add redirect URI to app settings:
     - Local: `http://localhost:5005/spotify/callback`
     - Production: `https://your-domain.com/spotify/callback`

2. **Add Credentials**:
   ```bash
   # Add to .env file
   SPOTIFY_CLIENT_ID=your-client-id
   SPOTIFY_CLIENT_SECRET=your-client-secret
   SPOTIFY_REDIRECT_URI=http://localhost:5005/spotify/callback
   ```

3. **Authenticate**:
   - **Browser**: Visit `http://localhost:5005/spotify/auth`
   - **Headless**: Use the setup script:
     ```bash
     ./scripts/spotify-auth-setup.sh
     ```

## Technical Details

### Account Extraction (S2 Systems)
Since S2 systems don't support `/status/accounts` or `Status:ListAccounts`, the system extracts Spotify account information from your favorites:
- **Account ID**: Extracted from favorite metadata tokens (e.g., `85a80dc4`)
- **Service ID (SID)**: Extracted from metadata token, NOT the URI (e.g., `3079`)
- **Serial Number (SN)**: Extracted from favorite URIs (e.g., `24`)
- **Prefixes**: Extracted from favorite URIs with defaults:
  - Albums: `1004006c` 
  - Playlists: `1006286c`
  - Artists: `1003206c` (estimated)

### URI Format
Spotify content uses special Sonos URI formats:

#### Tracks
```
x-sonos-spotify:spotify%3Atrack%3A{trackId}?sid={sid}&flags=8224&sn={sn}
```

#### Albums/Playlists
```
x-rincon-cpcontainer:{prefix}spotify%3A{type}%3A{id}?sid={sid}&flags=108&sn={sn}
```

#### Artist Radio
```
x-sonosapi-radio:spotify%3AartistRadio%3A{artistId}?sid={sid}&flags=8200&sn={sn}
```

Note: The actual SID and SN values come from your favorites metadata, not from the services list.

### Multiple Account Support
The system supports multiple Spotify accounts:
- Each account's data extracted separately
- Accounts identified by unique account ID
- First account used by default if none specified

## OAuth API Endpoints

### Authentication Endpoints
```bash
# Start OAuth flow (opens browser)
GET /spotify/auth

# OAuth callback (handled automatically)
GET /spotify/callback?code={code}&state={state}

# Submit callback URL manually (for headless auth)
POST /spotify/callback-url
Body: { "callbackUrl": "http://localhost:8888/callback?code=..." }

# Check authentication status
GET /spotify/status
Response: { "authenticated": true/false, "expiresIn": seconds }
```

## Limitations

### Without OAuth
1. **No Search**: Cannot search for content by name
2. **No Browse**: Cannot browse Spotify catalog
3. **No Metadata**: Track/album details not available from API
4. **ID Required**: Must know Spotify IDs or have favorites

### With OAuth (Implemented)
The following features are now available:
- Search by track/album/artist name
- Automatic token refresh
- Market availability filtering (defaults to US)
- Multi-instance support with separate token storage

### General Limitations
1. **Premium Required**: Spotify Premium required for API playback control
2. **Region Restrictions**: Some content may be region-locked
3. **Session Management**: Spotify sessions may timeout
4. **Rate Limits**: Spotify API has rate limiting

## Working with Spotify URLs

### Extracting IDs from URLs
Spotify share URLs follow this pattern:
```
https://open.spotify.com/{type}/{id}?si={shareId}
```

Examples:
- Track: `https://open.spotify.com/track/1i6N76fftMZhijOzFQ5ZtL`
- Album: `https://open.spotify.com/album/6dVIqQ8qmQ5GBnJ9shOYGE`
- Playlist: `https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M`
- Artist: `https://open.spotify.com/artist/2x9SpqnPi8rlE9pjHBwmSC`

### Using in Presets
Simply copy the share link and use as `spotifyUrl`:
```json
{
  "players": [{ "roomName": "Living Room", "volume": 25 }],
  "spotifyUrl": "https://open.spotify.com/album/2guirTSEqLizK7j9i1MTTZ"
}
```

## Troubleshooting

### "No Spotify service found"
- Ensure Spotify is added in Sonos app
- Try refreshing services: `curl http://localhost:5005/services/refresh`

### Playback Fails
- Verify Spotify Premium subscription
- Check if content is available in your region
- Ensure Spotify account is properly linked in Sonos

### Search Returns No Results
- Check authentication status: `curl http://localhost:5005/spotify/status`
- Verify credentials in .env file
- Tokens auto-refresh, but check if refresh token is valid
- Ensure search terms are properly URL-encoded
- Re-authenticate if needed: `curl http://localhost:5005/spotify/auth`

## OAuth Implementation Details

### Token Management
- Automatic token refresh before expiration
- Tokens stored in `data/spotify-tokens-{instance-id}.json`
- Support for multiple instances with unique instance IDs
- Secure token storage with file system persistence

### Authentication Flow
1. User initiates OAuth: `/spotify/auth`
2. Redirected to Spotify authorization
3. Callback handled at `/spotify/callback`
4. Tokens stored and auto-refreshed
5. For headless: Manual callback URL submission via `/spotify/callback-url`

### Multi-Instance Support
```bash
# Set unique instance ID for each deployment
INSTANCE_ID=talon  # or worf, home-1, etc.
```

## Future Enhancements

### Potential Features
- Browse capabilities (playlists, categories)
- Artist top tracks
- Related artists
- New releases
- User playlists (requires user authorization scope)
- Recently played (requires user authorization scope)

## Examples

### Play Specific Track
```bash
# Using ID
curl "http://localhost:5005/Office/spotify/play/spotify:track:3n3Ppam7vgaVa1iaRUc9Lp"

# Using preset with URL
echo '{
  "players": [{ "roomName": "Office", "volume": 30 }],
  "spotifyUrl": "https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp"
}' > presets/morning-music.json

curl "http://localhost:5005/preset/morning-music"
```

### Group Playback
```json
{
  "players": [
    { "roomName": "Living Room", "volume": 30 },
    { "roomName": "Kitchen", "volume": 25 },
    { "roomName": "Patio", "volume": 40 }
  ],
  "spotifyUrl": "https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO",
  "playMode": {
    "shuffle": true,
    "repeat": "all"
  },
  "pauseOthers": true
}
```

## Summary

While full Spotify search requires OAuth configuration, the current implementation provides flexible ways to play Spotify content:
- Direct playback with known IDs
- Preset support with Spotify URLs
- Favorite-based playback
- Multi-room grouping

The system is designed to be enhanced with OAuth support when credentials are provided, enabling full search and browse capabilities.