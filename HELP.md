# Sonos HTTP API - Help & Usage Guide

This guide covers common usage patterns and important behaviors of the Sonos HTTP API.

## Table of Contents
- [Presets](#presets)
- [Default Room](#default-room)
- [Music Search](#music-search)
- [Group Management](#group-management)
- [Favorites](#favorites)
- [Tips & Tricks](#tips--tricks)
- [Common Issues](#common-issues)
- [Debug Mode](#debug-mode)
- [Content Analysis Tool](#content-analysis-tool)
- [API Documentation](#api-documentation)

## Presets

Presets are JSON files that define complex playback scenarios. They can control single or multiple rooms, set volumes, and configure playback modes.

### Single Room Preset
```json
{
  "roomName": "Kitchen",
  "volume": 30,
  "favorite": "Jazz Radio",
  "repeat": "all",
  "shuffle": true
}
```

### Multi-Room Preset
```json
{
  "players": [
    { "roomName": "LivingRoom", "volume": 40 },
    { "roomName": "Kitchen", "volume": 25 },
    { "roomName": "Bedroom", "volume": 20 }
  ],
  "favorite": "Dinner Music",
  "pauseOthers": true
}
```

### Important Multi-Room Behaviors

When a preset contains multiple players, the behavior is:

1. **The first player becomes the group coordinator** (e.g., LivingRoom)
2. **The default room is set to this coordinator**
3. All other players join the coordinator's group
4. **ALL commands now affect the entire group**

#### Example Scenario
After playing a preset with `[LivingRoom, Bedroom, Kitchen]`:
- LivingRoom is the coordinator
- Default room is set to LivingRoom
- All three rooms are grouped together

Now these commands ALL control the entire group:
- `/LivingRoom/pause` - pauses the group (it's the coordinator)
- `/Bedroom/pause` - pauses the group (Bedroom is in the group)
- `/Kitchen/pause` - pauses the group (Kitchen is in the group)
- `/pause` - pauses the group (uses default room = LivingRoom)
- `/volume/30` - sets group volume to 30
- `/next` - skips to next track for the group

**Key Point**: After a multi-room preset, roomless commands conveniently control the entire group!

### Preset Execution Order

1. **pauseOthers** (if true): Pause all rooms not in the preset
2. **Group Formation**: First player becomes coordinator, others join
3. **Volume Setting**: Individual volumes set for each room
4. **Playback**: Start playing the favorite/URI on the group

### Preset Options

- **pauseOthers**: When `true`, pauses all rooms not included in the preset BEFORE grouping
- **sleep**: Sleep timer in seconds (e.g., 3600 = 1 hour)
- **playMode**: Object with `repeat` ("none", "all", "one") and `shuffle` (true/false)
- **crossfade**: Enable/disable crossfade between tracks
- **uri**: Direct URI to play instead of favorite
- **members**: Legacy format - use `players` instead

### Dynamic Preset Loading

The `presets/` folder is **automatically watched for changes**:
- Add, modify, or delete preset files without restarting
- Changes are detected and loaded immediately
- Invalid presets are logged but don't affect others
- **Perfect for Docker**: Mount the presets folder as a volume and edit externally

Docker example:
```yaml
volumes:
  - ./my-presets:/app/presets
```

Now you can edit presets on your host system and they're instantly available in the container!

## Default Room

The API tracks a "default room" used by roomless endpoints. This is particularly powerful with multi-room presets.

### Setting Default Room
```
GET /default/room/Kitchen
```

### Using Default Room
```
GET /play              # Plays in default room
GET /volume/30         # Sets volume in default room
GET /favorite/Jazz     # Plays favorite in default room
```

### Default Room with Groups
When you play a multi-room preset:
- Default room becomes the group coordinator
- Roomless commands control the entire group
- Very convenient for controlling multi-room audio!

### Default Music Service
```
GET /default/service/apple
GET /song/Yesterday    # Searches default service in default room
```

## Music Search

Search and play music from configured services:

### Room-Specific Search
```
GET /{room}/musicsearch/{service}/song/{query}
GET /{room}/musicsearch/{service}/album/{query}
GET /{room}/musicsearch/{service}/station/{query}
```

### Default Room Search
```
GET /song/{query}      # Uses default room and service
GET /album/{query}     # Uses default room and service
GET /station/{query}   # Uses default room and service
```

### Library Search
```
GET /{room}/musicsearch/library/song/{query}
GET /{room}/musicsearch/library/artist/{query}
GET /{room}/musicsearch/library/album/{query}
```

## Group Management

### Creating Groups
```
GET /{room}/join/{targetRoom}    # Join target's group
GET /{room}/add/{otherRoom}      # Add other to this room's group
```

### Breaking Groups
```
GET /{room}/leave                # Leave current group
GET /{room}/ungroup              # Ungroup all speakers
GET /{room}/isolate              # Ungroup and stop all others
```

### Group Volume
```
GET /{room}/groupVolume/50       # Set entire group's volume
```

### Group Behavior
- Commands to ANY room in a group affect the ENTIRE group
- The coordinator manages playback for all members
- Individual room volumes are preserved within the group
- Breaking a group returns rooms to independent control

## Favorites

Favorites are saved Sonos items (radio stations, playlists, albums).

### List Favorites
```
GET /{room}/favorites            # Full objects
GET /{room}/favorites?simple     # Just names
```

### Play Favorite
```
GET /{room}/favorite/Jazz Radio
```

Case-insensitive matching is supported - "Jazz Radio" matches "jazz radio".

## Tips & Tricks

1. **Preset Coordinator**: Always list your preferred coordinator first in multi-room presets

2. **Convenient Group Control**: After a multi-room preset, use roomless commands to control the whole group

3. **Case Sensitivity**: Room names are case-sensitive, but favorites are matched case-insensitively

4. **Queue-Based URIs**: Some content (playlists, containers) uses queue-based playback

5. **Trusted Networks**: Configure `auth.trustedNetworks` to bypass authentication for specific IPs

6. **Environment Variables**: 
   - `LOGGER=pino` for production JSON logging
   - `DEBUG_CATEGORIES=all` to enable all debug output
   - `NODE_ENV=production` for production mode

## Common Issues

### "Not Found" Errors
- Check that the room name matches exactly (case-sensitive)
- Verify the favorite exists with `/{room}/favorites`
- Ensure the device is powered on and connected

### Playback Won't Start
- Some content requires clearing the queue first
- Check if the room is grouped with another coordinator
- Verify the music service is configured

### Multi-Room Confusion
- Remember: ANY command to a grouped room affects the whole group
- Use `/zones` to see current grouping
- Default room is set to the coordinator after multi-room presets
- Use `/{room}/leave` to remove a room from a group

### Preset Issues
- First player in the list becomes coordinator - order matters!
- Invalid room names cause the preset to be skipped
- Use `/presets?detailed=true` to see full preset configuration

## Debug Mode

Enable debug logging for troubleshooting:

### Check Status
```
GET /debug                       # Current debug settings
GET /debug/startup               # Startup information
```

### Enable Debugging
```
GET /debug/enable-all            # Enable all categories
GET /debug/level/debug           # Set to debug level
GET /debug/category/soap/true    # Enable specific category
```

### Debug Categories
- **api**: HTTP request/response logging
- **discovery**: Device discovery events
- **soap**: SOAP requests/responses
- **topology**: Zone topology changes
- **favorites**: Favorite resolution
- **presets**: Preset loading
- **upnp**: UPnP events
- **sse**: Server-sent events

### Log Levels
- **error**: Only errors
- **warn**: Errors and warnings  
- **info**: Normal operation (default)
- **debug**: Detailed debugging
- **wall**: Everything including XML (very verbose)

## Content Analysis Tool

A powerful analysis tool is included to help validate and debug your Sonos content:

```bash
./analyze-content.sh {home-name} {api-url} {room-name}
```

Example:
```bash
./analyze-content.sh home http://localhost:5005 LivingRoom
./analyze-content.sh remote http://remote.home:5005 Kitchen
```

The tool generates two reports in `homes/{home-name}/`:

1. **`content-analysis.md`** - Detailed breakdown showing:
   - All favorites grouped by type (radio, playlists, music services)
   - URI patterns and service mappings
   - Favorites referenced by presets vs unused favorites
   - Multi-room preset detection

2. **`preset-validation-results.md`** - Validation report showing:
   - Valid presets that will work
   - Failed presets with missing favorites
   - Invalid room warnings
   - Specific fixes needed for each failed preset

### Why Use Content Analysis?

- **Before deploying presets** to a new home - verify they'll work
- **Debug playback failures** - identify missing favorites
- **Cross-home compatibility** - see what's different between homes
- **Preset cleanup** - find unused favorites and broken presets
- **Works over VPN** - analyze remote homes without local access

The tool is especially useful when:
- Sharing presets between different homes
- Migrating to a new Sonos system
- Troubleshooting why certain presets fail
- Documenting your Sonos configuration

## API Documentation

### Complete API Reference
For a complete list of all API endpoints with examples, see **[API.md](API.md)**.

### OpenAPI/Swagger Documentation
The API is fully documented using OpenAPI 3.0 specification:
- Main spec: `apidoc/openapi.yaml`
- Component definitions: `apidoc/components/`
- Endpoint definitions: `apidoc/paths/`

#### Viewing with Swagger UI
You can use Swagger UI to explore the API interactively:

1. **Online Swagger Editor**:
   - Go to https://editor.swagger.io/
   - Copy the contents of `apidoc/openapi.yaml`
   - Paste into the editor
   - View the interactive documentation on the right

2. **Local Swagger UI** (if you have Docker):
   ```bash
   docker run -p 8080:8080 -e SWAGGER_JSON=/api/openapi.yaml \
     -v $(pwd)/apidoc:/api swaggerapi/swagger-ui
   ```
   Then open http://localhost:8080

3. **VS Code Extension**:
   - Install "OpenAPI (Swagger) Editor" extension
   - Open `apidoc/openapi.yaml`
   - Preview renders automatically

The OpenAPI documentation includes:
- All endpoints with parameters
- Request/response schemas
- Example responses
- Authentication details
- Error codes