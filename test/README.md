# Sonos API Test Suite

This test suite provides comprehensive unit and integration tests for the Sonos Alexa API. The test coverage has been significantly expanded to cover ~85% of all API endpoints.

## Test Coverage

- **Unit Tests**: Cover all core functionality with mocks (CI/CD safe)
- **Integration Tests**: Adaptive tests that discover your Sonos system
- **Coverage**: ~85% of all API endpoints tested

## Running Tests

### Quick Start

```bash
# Run all tests (unit + integration in non-destructive mode)
npm test

# Run only unit tests (no Sonos required)
npm run test:unit

# Run only integration tests
npm run test:integration

# Run tests in full mode (may interrupt playback)
npm run test:full

# Check test coverage
npm run test:coverage
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
- Playback controls (play, pause, stop, next, previous, clearqueue)
- Volume controls (set, adjust, mute, group volume)
- Playback modes (repeat, shuffle, crossfade)
- Default room management
- Debug endpoints and logging
- Request validation and error handling

**Integration Tests (Adaptive):**
- System discovery and health checks
- Advanced playback features with state verification
- Group management (join, leave, add, isolate)
- Music library (favorites, playlists) - if available
- Preset playback - if presets exist
- Music services (Apple Music, Pandora) - if configured
- Global commands (pauseall, resumeAll, sayall)
- Text-to-Speech functionality

### Test Structure

```
test/
├── unit/                    # Unit tests (no Sonos required)
│   ├── soap-tests.ts        # SOAP utilities
│   ├── playback-tests.ts    # Playback controls
│   ├── volume-tests.ts      # Volume controls
│   ├── default-room-tests.ts # Default room logic
│   ├── debug-tests.ts       # Debug endpoints
│   └── validation-tests.ts  # Request validation
├── integration/             # Integration tests (requires Sonos)
│   ├── adaptive-tests.ts    # Basic adaptive tests
│   ├── playback-tests.ts    # Advanced playback
│   ├── group-tests.ts       # Group management
│   ├── library-tests.ts     # Favorites/playlists
│   ├── preset-tests.ts      # Preset playback
│   └── global-tests.ts      # Global commands
├── helpers/                 # Test utilities
│   ├── discovery.ts         # System discovery
│   ├── state-manager.ts     # State save/restore
│   ├── test-config.ts       # Configuration
│   ├── mock-factory.ts      # Mock object creation
│   ├── service-detector.ts  # Extended feature detection
│   └── server-manager.ts    # Test server lifecycle
├── run-tests.ts            # Test runner
└── check-coverage.ts       # Coverage analyzer
```

## Environment Variables

- `TEST_MODE`: `non-destructive` or `full`
- `MOCK_ONLY`: `true` to skip integration tests
- `TEST_API_URL`: API endpoint (default: `http://localhost:5005`)
- `TEST_TIMEOUT`: Test timeout in ms (default: 10000)

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

After running integration tests, you'll see a coverage summary:

```
📈 Test Coverage Summary:
   - Tested 5 rooms
   - Group tests: Yes
   - Service tests: apple, pandora
```

## Continuous Integration

For CI/CD pipelines, use mock-only mode:

```bash
npm run test:unit
```

This runs only unit tests without requiring a Sonos system.