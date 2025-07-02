# Presets Configuration

Presets allow you to save and quickly restore complex Sonos configurations including room grouping, volume levels, and playback content.

## Preset File Format

Presets are JSON files stored in the `presets/` directory. Each preset can specify:
- Which rooms to include
- Volume levels for each room  
- What content to play (via Favorite, URI, or Spotify URL)
- Playback settings (shuffle, repeat, crossfade)
- Whether to pause other rooms

## Basic Preset Structure

```json
{
  "players": [
    { 
      "roomName": "Living Room", 
      "volume": 30 
    },
    { 
      "roomName": "Kitchen", 
      "volume": 25 
    }
  ],
  "pauseOthers": true,
  "playMode": {
    "shuffle": true,
    "repeat": "all",
    "crossfade": false
  }
}
```

## Content Sources (Mutually Exclusive)

Each preset must use **only one** of these content sources:

### 1. Favorite
Reference a Sonos favorite by name:
```json
{
  "players": [{ "roomName": "Office", "volume": 40 }],
  "favorite": "My Favorite Station"
}
```

### 2. URI
Use a direct Sonos URI:
```json
{
  "players": [{ "roomName": "Office", "volume": 40 }],
  "uri": "x-sonosapi-stream:s123456?sid=254&flags=8224&sn=0"
}
```

### 3. Spotify URL (NEW)
Use a Spotify share link directly:
```json
{
  "players": [{ "roomName": "Office", "volume": 40 }],
  "spotifyUrl": "https://open.spotify.com/track/1i6N76fftMZhijOzFQ5ZtL?si=51b5597641a84518"
}
```

## Spotify URL Support

The SpotifyUrl feature allows you to use Spotify share links directly in presets. Simply:

1. Find content in Spotify app
2. Click Share → Copy Link
3. Paste the URL as the `spotifyUrl` value

Supported Spotify content types:
- **Tracks**: `https://open.spotify.com/track/{id}`
- **Albums**: `https://open.spotify.com/album/{id}`
- **Playlists**: `https://open.spotify.com/playlist/{id}`
- **Artists**: `https://open.spotify.com/artist/{id}`

### Examples

#### Spotify Track Preset
```json
{
  "players": [
    { "roomName": "Living Room", "volume": 30 }
  ],
  "spotifyUrl": "https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp",
  "pauseOthers": true
}
```

#### Spotify Album Preset
```json
{
  "players": [
    { "roomName": "Office", "volume": 25 },
    { "roomName": "Kitchen", "volume": 20 }
  ],
  "spotifyUrl": "https://open.spotify.com/album/6dVIqQ8qmQ5GBnJ9shOYGE",
  "playMode": {
    "shuffle": false,
    "repeat": "all"
  }
}
```

#### Spotify Playlist Preset
```json
{
  "players": [
    { "roomName": "Whole House", "volume": 35 }
  ],
  "spotifyUrl": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
  "playMode": {
    "shuffle": true
  }
}
```

## Advanced Features

### Multi-Room Grouping
The first player in the list becomes the group coordinator:
```json
{
  "players": [
    { "roomName": "Living Room", "volume": 30 },  // Coordinator
    { "roomName": "Kitchen", "volume": 25 },       // Joins Living Room
    { "roomName": "Patio", "volume": 40 }         // Joins Living Room
  ],
  "spotifyUrl": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
}
```

### Pause Others
Pause all rooms not included in the preset before starting:
```json
{
  "players": [{ "roomName": "Bedroom", "volume": 20 }],
  "pauseOthers": true,
  "spotifyUrl": "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"
}
```

### Sleep Timer
Set a sleep timer (in seconds):
```json
{
  "players": [{ "roomName": "Bedroom", "volume": 15 }],
  "spotifyUrl": "https://open.spotify.com/playlist/37i9dQZF1DWZd79rJ6a7lp",
  "sleep": 3600  // 1 hour
}
```

## Using Presets

### List Available Presets
```bash
curl http://localhost:5005/presets
curl http://localhost:5005/presets/detailed
```

### Play a Preset
```bash
# In specific room
curl http://localhost:5005/Living%20Room/preset/party

# In default room
curl http://localhost:5005/preset/bedtime
```

## Troubleshooting

### Invalid Spotify URL
- Ensure the URL is from open.spotify.com
- Check that the URL contains a valid type (track/album/playlist/artist)
- Verify the ID portion is intact

### Preset Not Playing
- Check that room names match exactly (case-sensitive)
- Verify only one content source is specified (favorite, uri, OR spotifyUrl)
- Ensure Spotify is configured in your Sonos system

### Missing Content
- Spotify content requires Spotify to be added to your Sonos system
- Some content may be region-restricted
- Premium Spotify account required for full functionality