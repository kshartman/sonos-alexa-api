# Sonos API Test Suite

This test suite provides comprehensive unit and integration tests for the Sonos Alexa API. The test coverage has been significantly expanded to cover 94% of all API endpoints.

## Test Coverage

- **Unit Tests**: Cover all core functionality with mocks (CI/CD safe)
- **Integration Tests**: Event-driven tests with real Sonos devices
- **Coverage**: 94% of all API endpoints tested (exceeds 90% threshold)

## Running Tests

### Quick Start

```bash
# Run all tests (unit + integration in non-destructive mode)
npm test

# Run only unit tests (no Sonos required)
npm run test:unit

# Run only integration tests
npm run test:integration

# Check test coverage
npm run test:coverage

# Check test coverage with all test cases listed
npm run test:coverage -- --detailed

# Run tests with debug logging enabled (use LOG_LEVEL env var)
LOG_LEVEL=debug npm test

# List available test files
npm run test:list

# List all test cases (detailed)
npm run test:list:detailed
```

### Specific Test Suites

```bash
# Run specific test categories
npm run test:playback    # Playback control tests
npm run test:volume      # Volume control tests  
npm run test:groups      # Group management tests
```

### Test Modes

- **Non-destructive mode** (default): Saves and restores device state, safe to run anytime
- **Full mode**: Complete API coverage but may interrupt current playback
- **Mock-only mode**: Runs only unit tests, no Sonos system required

### Command Line Options

- `--mock-only`: Run only unit tests (no Sonos required)
- `--grep <pattern>` or `--match <pattern>`: Filter tests by name/suite pattern
- `--no-server`: Don't auto-start the API server
- `--detailed`: Show all test case names in coverage report

## How It Works

### Adaptive Testing

The integration tests:
1. Discover your Sonos system topology
2. Identify available rooms, groups, and services
3. Generate and run appropriate tests
4. Skip tests for unavailable features
5. Provide a coverage report

### What Gets Tested

**Unit Tests (CI/CD Safe):**
- Event manager and state tracking
- Group management operations
- Line-in playback routing
- Playback controls (play, pause, stop, next, previous, clearqueue)
- Volume controls (set, adjust, mute, group volume)
- SOAP request/response handling

**Integration Tests (Event-Driven):**
- System discovery and health checks
- Advanced playback features with UPnP event verification
- Group management (join, leave, add, isolate) 
- Music library search and indexing
- Preset loading and execution
- Music services:
  - Apple Music: Full search (song, album, artist, station)
  - Pandora: Comprehensive testing with 4 suites:
    - Suite 1: Favorite station play and thumbs down
    - Suite 2: API station sequence (3 API + 1 favorite)
    - Suite 3: Music search with fuzzy matching
    - Suite 4: Error handling and stop command
  - Spotify: Direct playback and OAuth
  - Library: Local content search
- Global commands (pauseall, resumeall)
- Text-to-Speech with state restoration
- Playback modes (repeat, shuffle, crossfade)
- Sleep timer and line-in playback

### Test Structure

```
test/
├── unit/                    # Unit tests (no Sonos required)
│   ├── event-manager-tests.ts  # Event manager logic
│   ├── group-tests.ts       # Group management logic
│   ├── linein-tests.ts      # Line-in playback
│   ├── playback-tests.ts    # Playback controls
│   ├── soap-tests.ts        # SOAP utilities
│   └── volume-tests.ts      # Volume controls
├── integration/             # Integration tests (requires Sonos)
│   ├── 01-infrastructure-tests.ts  # Device discovery & infrastructure
│   ├── 02-playback-tests.ts        # Basic playback control
│   ├── 03-volume-tests.ts          # Volume control
│   ├── 04-content-*.ts             # Content services:
│   │   ├── apple-tests.ts          # Apple Music search
│   │   ├── defaults-tests.ts       # Default room/service
│   │   ├── generic-tests.ts        # Generic music search
│   │   ├── generic-tts-tests.ts    # Additional TTS scenarios
│   │   ├── library-tests.ts        # Music library search
│   │   ├── pandora-tests.ts        # Pandora (5 tests in 4 suites)
│   │   └── spotify-tests.ts        # Spotify direct play
│   ├── 05-group-tests-quick.ts     # Quick group tests
│   ├── 06-playback-modes-tests.ts  # Playback modes (shuffle, repeat, etc.)
│   ├── 07-advanced-tests.ts        # Advanced features
│   ├── 08-tts-tests.ts             # Text-to-speech tests
│   ├── 09-group-tests.ts           # Comprehensive group tests
│   └── 10-discovery-tests.ts       # System discovery endpoint tests
├── helpers/                 # Test utilities
│   ├── discovery.ts         # System discovery
│   ├── state-manager.ts     # State save/restore
│   ├── test-config.ts       # Configuration and timeouts
│   ├── mock-factory.ts      # Mock object creation
│   ├── content-loader.ts    # Dynamic content discovery
│   ├── global-test-setup.ts # Event-driven test infrastructure
│   ├── pandora-test-helpers.ts # Pandora availability checks
│   └── server-manager.ts    # Test server lifecycle
├── run-tests.ts            # Test runner
└── check-coverage.ts       # Coverage analyzer
```

## Environment Variables

### Test Configuration
- `TEST_API_URL`: API endpoint (default: `http://localhost:5005`)
- `TEST_TIMEOUT`: Test timeout in ms (default: 60000)
- `TEST_NO_TIMEOUT`: Set to disable timeouts completely
- `TEST_INTERACTIVE`: Enable interactive mode with pauses
- `LOG_LEVEL`: Set log verbosity (error, warn, info, debug, trace)
- `MOCK_ONLY`: `true` to skip integration tests

### Content Selection
- `TEST_ROOM`: Specific room to use for tests
- `TEST_SERVICE`: Default music service (apple, spotify, pandora, library)
- `TEST_FAVORITE`: Specific favorite to use
- `TEST_PLAYLIST`: Specific playlist to use
- `TEST_PANDORA_STATIONS`: Semicolon-separated list of Pandora stations
- `TEST_MUSICSEARCH_STATION`: Station name for music search test
- `TEST_VOLUME_DEFAULT`: Initial volume level (0-100)

### Test Data
- `TEST_SONG_QUERIES`: JSON array of song search queries
- `TEST_ALBUM_QUERIES`: JSON array of album search queries

All environment variables can be set in `test/.env` file.

## Key Test Features

### Pandora Test Improvements
- **Retry Mechanism**: Waits for PandoraStationManager initialization on server startup
- **Dynamic Station Selection**: Uses TEST_PANDORA_STATIONS from environment
- **Flexible Fallbacks**: Prefers favorites but uses API stations when needed
- **Music Search Testing**: Configurable search term via TEST_MUSICSEARCH_STATION
- **Source Tracking**: Verifies stations are categorized as 'api', 'favorite', or 'both'
- **No API Calls**: Validates that playback uses pre-loaded cache only

### Event-Driven Architecture
- Tests wait for actual UPnP events instead of using fixed timeouts
- Proper handling of TRANSITIONING states
- Group-aware event handling for stereo pairs
- Real-time state verification

## Writing New Tests

### Adding Unit Tests

Create new test files in `test/unit/` that test individual functions without external dependencies:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('My Unit Tests', () => {
  it('should test something', () => {
    assert.strictEqual(1 + 1, 2);
  });
});
```

### Adding Integration Tests

Integration tests should be adaptive and check for feature availability:

```typescript
// Check if a feature exists before testing
if (topology.hasGroups) {
  describe('Group Features', () => {
    it('should test groups', async () => {
      // Test group functionality
    });
  });
}

// Use state preservation
it('should test with state preservation', async () => {
  await withSavedState(room, async () => {
    // Your test that modifies state
  });
});
```

## Coverage Report

Generate and view detailed coverage reports:

```bash
# Run coverage analysis
npm run test:coverage

# View detailed coverage with all test names
npm run test:coverage -- --detailed
```

Current coverage: **94%** (210 total tests)
- Unit tests: 69 tests across 6 files
- Integration tests: 141 tests across 16 files

See `test/COVERAGE_REPORT.md` for detailed breakdown.

## Continuous Integration

For CI/CD pipelines, use mock-only mode:

```bash
npm run test:unit
```

This runs only unit tests without requiring a Sonos system.