# Settings Configuration

The Sonos Alexa API supports configuration through a `settings.json` file for compatibility with the legacy node-sonos-http-api.

## Configuration Options

### Basic Settings

- `port` (number, default: 5005): The port to run the API server on
- `host` (string, default: "localhost"): The hostname or IP address for generating URLs. Use your machine's actual hostname or IP for TTS to work properly
- `defaultRoom` (string): The default room to use when no room is specified in API calls
- `announceVolume` (number, default: 40): Default volume level for TTS announcements (0-100)

### Authentication

```json
"auth": {
  "username": "your-username",
  "password": "your-password",
  "rejectUnauthorized": true
}
```

- `username` & `password`: Basic authentication credentials
- `rejectUnauthorized` (boolean, default: true): 
  - When `true`: Authentication is enforced if credentials are set
  - When `false`: Authentication headers are ignored even if credentials are configured

### Text-to-Speech (TTS) Providers

#### VoiceRSS (Recommended)
```json
"voicerss": "your-api-key"
```
Free tier available at https://www.voicerss.org/

#### macOS Say (Mac only)
```json
"macSay": {
  "voice": "Alex",
  "rate": 175
}
```
Uses the built-in macOS text-to-speech engine.

#### Google TTS (Default)
Used automatically if no other TTS provider is configured. Free but unofficial.

### Music Services

#### Pandora
```json
"pandora": {
  "username": "your-pandora-username",
  "password": "your-pandora-password"
}
```

#### Spotify
```json
"spotify": {
  "clientId": "your-spotify-client-id",
  "clientSecret": "your-spotify-client-secret"
}
```

### Other Settings

```json
"library": {
  "randomQueueLimit": 50
}
```

## Example Configuration

Copy `settings.json.example` to `settings.json` and update with your values:

```bash
cp settings.json.example settings.json
```

Then edit `settings.json` with your configuration.

## Important Notes

1. **Host**: For TTS to work properly, set the `host` field to your machine's actual hostname or IP address (not localhost)
2. **Security**: Never commit `settings.json` to version control as it contains sensitive credentials
3. **Priority**: Settings from `settings.json` override defaults but are overridden by environment variables