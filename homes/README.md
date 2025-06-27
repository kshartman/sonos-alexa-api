# Sonos Home Content Analysis

This directory contains content analysis reports for different Sonos home environments.

## What's in each home directory?

Each subdirectory represents a different Sonos home/environment and contains:

- **content-analysis.md** - Detailed breakdown of:
  - All favorites organized by URI type
  - Music service breakdown (Pandora, TuneIn, Apple Music, etc.)
  - Special characteristics (multi-room presets, nature sounds, etc.)
  - Detailed listing of each favorite with metadata

- **preset-validation-results.md** - Validation status showing:
  - Total presets and their validation status
  - List of valid presets that loaded successfully
  - Failed presets that couldn't resolve favorites
  - Favorites that don't have corresponding presets
  - Recommendations for fixing issues

## How to generate reports

Use the analyze-content.sh script from the parent directory:

```bash
# Analyze local environment (uses hostname as home name)
./analyze-content.sh

# Analyze a specific home
./analyze-content.sh home-name http://api-url:port room-name

# Examples:
./analyze-content.sh production http://192.168.1.100:5005 LivingRoom
./analyze-content.sh talon http://talon.bogometer.com:35005 ShanesOfficeSpeakers
```

## Directory structure

```
homes/
├── README.md          # This file
├── local/            # Local development environment
├── development/      # Development test environment
├── talon/           # Production home (talon.bogometer.com)
└── [other-homes]/   # Additional environments as needed
```

## Notes

- This directory is gitignored to keep environment-specific data private
- The /debug/startup endpoint provides accurate preset validation data
- Reports are regenerated each time the script runs