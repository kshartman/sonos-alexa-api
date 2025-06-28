# Sonos API Test Plan

## Overview

This test suite provides comprehensive testing for the Sonos Alexa API with two distinct testing approaches:

1. **Unit Tests** - Fast, isolated tests that require no Sonos hardware (CI/CD friendly)
2. **Integration Tests** - Event-driven tests using real Sonos devices that adapt to your system

The integration tests use real UPnP events from Sonos devices rather than polling or fixed timeouts, ensuring reliable and realistic testing that automatically adapts to your available speakers and content.

## Current Test Coverage: 96%

## Test Types

### Unit Tests
**Location**: `test/unit/`  
**Requirements**: None (no Sonos system needed)  
**Purpose**: Fast feedback for CI/CD pipelines  
**Scope**: Core logic, utilities, and API validation

Unit tests mock Sonos device interactions and focus on:
- API endpoint routing and parameter validation
- Business logic and data transformation
- Error handling and edge cases
- Configuration parsing and validation
- Utility functions and helpers
- SOAP request/response handling
- Event management and SSE

**Perfect for**:
- ✅ Continuous Integration (CI/CD)
- ✅ Pre-commit hooks
- ✅ Rapid development feedback
- ✅ Code coverage analysis

### Integration Tests
**Location**: `test/integration/`  
**Requirements**: Active Sonos system on network  
**Purpose**: End-to-end validation with real hardware  
**Scope**: Full API functionality with actual devices

Integration tests dynamically adapt to your Sonos system:
- **Auto-discovery**: Finds available speakers automatically
- **Content adaptation**: Uses your existing favorites, playlists, and presets
- **Safe room selection**: Chooses appropriate test devices
- **Event-driven**: Uses real UPnP events, no polling or timeouts

**Perfect for**:
- ✅ Final validation before deployment
- ✅ Hardware compatibility testing
- ✅ Real-world scenario verification
- ✅ UPnP event system validation

## Test Suite Structure

### Unit Tests (5 test files, 64 test cases)

1. **Group Management** (`unit/group-tests.ts`) - 18 tests
   - Join/leave group operations
   - Group volume and playback control
   - Error handling and edge cases

2. **Line-In** (`unit/linein-tests.ts`) - 5 tests
   - Line-in playback from same/different rooms
   - Coordinator routing for grouped devices

3. **Playback Control** (`unit/playback-tests.ts`) - 18 tests
   - Play/pause/stop commands
   - Track navigation
   - Playback modes (repeat, shuffle, crossfade)
   - Global commands (pauseall, resumeall)

4. **SOAP Utilities** (`unit/soap-tests.ts`) - 7 tests
   - SOAP envelope creation
   - Response parsing
   - XML character escaping

5. **Volume Control** (`unit/volume-tests.ts`) - 16 tests
   - Absolute and relative volume
   - Group volume control
   - Mute/unmute operations

### Integration Tests (8 test files, 87 test cases)

1. **Core Infrastructure** (`01-infrastructure-tests.ts`) - 15 tests
   - Health check and device discovery
   - Device information endpoints (/devices, /devices/id, /devices/room)
   - Event manager and SSE connections
   - State tracking and history
   - Concurrent request handling

2. **Basic Playback** (`02-playback-tests.ts`) - 10 tests
   - Play/pause/stop with event verification
   - TRANSITIONING state handling
   - PlayPause toggle functionality
   - Error handling for non-existent rooms

3. **Volume Control** (`03-volume-tests.ts`) - 9 tests
   - Volume setting with event verification
   - Relative volume changes
   - Mute/unmute/togglemute operations
   - Group volume control

4. **Playback Modes** (`06-playback-modes-tests.ts`) - 14 tests
   - Repeat mode control
   - Shuffle mode with repeat preservation
   - Crossfade toggle
   - Combined mode testing
   - Queue operations

5. **Advanced Features** (`07-advanced-tests.ts`) - 16 tests
   - Sleep timer functionality
   - Line-in playback
   - Settings management
   - System information
   - Preset management
   - Error recovery

6. **Text-to-Speech** (`08-tts-tests.ts`) - 7 tests
   - Single room announcements
   - Multi-room and global announcements
   - State restoration after TTS
   - Error handling

7. **Group Management** (`09-group-tests.ts`) - 10 tests
   - Group formation and dissolution
   - Group playback control
   - Group volume control
   - Error handling

8. **Adaptive Tests** (`adaptive-tests.ts`) - 6 tests
   - System discovery
   - Health check
   - TTS functionality

## Key Features

### Event-Driven Testing
- **No Fixed Timeouts**: Tests wait for actual UPnP events
- **State Verification**: Always verify stable state before operations
- **TRANSITIONING Handling**: Proper handling of device state transitions
- **Real Device Events**: Uses actual Sonos UPnP notifications

### Coordinator Pattern Support
All coordinator-required operations are automatically routed:
- Queue management (get, add, clear)
- Playback control (play, pause, stop, next, previous)
- Content selection (favorites, playlists, music search)
- Playback modes (repeat, shuffle, crossfade)
- Transport settings

### Music Service Integration
- **Apple Music**: Full search and playback support
- **Pandora**: Authentication-based integration with stations and thumbs
- **Music Library**: Local content search and playback
- **SiriusXM**: Endpoints exist (returns 501 - not implemented)
- **Spotify**: Not implemented (requires OAuth2)

## Running Tests

### Quick Start

```bash
# Install dependencies
npm install

# Run all tests with coverage
npm test

# Run unit tests only (no Sonos required)
npm run test:unit

# Run integration tests (requires Sonos system)
npm run test:integration
```

### Unit Tests
```bash
# Run specific unit test files
npm test -- test/unit/api-router.test.ts
npm test -- test/unit/sonos-device.test.ts

# Run with coverage report
npm run test:coverage
```

### Integration Tests
```bash
# Run specific test categories
npm test -- test/integration/playback.test.ts
npm test -- test/integration/volume.test.ts
npm test -- test/integration/tts.test.ts

# Run with pattern matching
npm test -- --grep "shuffle"
npm test -- --grep "TTS"
```

### Test Configuration

#### Environment Variables
```bash
# API Configuration
TEST_API_URL=http://localhost:5005  # API server URL
TEST_ROOM=Kitchen                    # Specific room to test (optional)
TEST_TIMEOUT=60000                   # Test timeout in ms

# Logging
LOG_LEVEL=info                       # Log verbosity
DEBUG_CATEGORIES=api,upnp,topology   # Debug categories
```

#### test/.env File
```bash
# Test room configuration
TEST_ROOM=Living Room

# Service credentials (for Pandora tests)
PANDORA_USERNAME=your-email@example.com
PANDORA_PASSWORD=your-password
```

## Docker Testing

### Running Tests in Docker
```bash
# Build and run tests in Docker
docker-compose -f docker-compose.test.yml up --build

# Run specific test suites
docker-compose -f docker-compose.test.yml run test npm run test:unit
docker-compose -f docker-compose.test.yml run test npm run test:integration
```

### Remote API Testing
```bash
# Test against remote API server
TEST_API_URL=http://192.168.1.100:5005 npm test

# Use the test-remote.sh script
./test-remote.sh 192.168.1.100:5005
./test-remote.sh talon.local:5005 volume
```

## Test Maintenance

### Adding New Tests
1. Choose appropriate test type (unit vs integration)
2. Follow existing patterns for event handling
3. Use helper functions for common operations
4. Ensure proper cleanup in afterEach hooks

### Common Test Helpers
- `waitForEvent()` - Wait for specific UPnP events
- `waitForStableState()` - Wait for device to stabilize
- `getSafeTestRoom()` - Get appropriate test device
- `loadTestContent()` - Find available test content
- `verifyCoordinatorRouting()` - Verify coordinator operations

## Troubleshooting

### Common Issues

1. **SSE Connection Failed**
   - Ensure API server is running
   - Check firewall rules
   - Verify TEST_API_URL is correct

2. **No Devices Found**
   - Check network connectivity
   - Ensure Sonos devices are powered on
   - Verify UPnP multicast is working

3. **Content Not Found**
   - Add favorites in Sonos app
   - Ensure music services are configured
   - Check content permissions

4. **Timeout Errors**
   - Device may be busy (controlled by another app)
   - Network latency issues
   - Increase TEST_TIMEOUT if needed

### Debug Mode
```bash
# Enable all debug output
DEBUG_CATEGORIES=all npm test

# Monitor server logs
tail -f logs/server.log

# Check UPnP events
curl http://localhost:5005/events
```

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Test Suite
on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test:unit
      - run: npm run test:coverage
      
  integration-tests:
    runs-on: self-hosted  # Requires Sonos network access
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run test:integration
```

## Test Results Summary

Current test suite status (v1.2.0):

| Test Type | Files | Test Cases | Status |
|-----------|-------|------------|--------|
| **Unit Tests** | 5 | 64 | ✅ All passing |
| **Integration Tests** | 8 | 87 | ✅ All passing |
| **Total** | **13** | **151** | ✅ **100% passing** |

### Test Distribution by Category

| Category | Unit Tests | Integration Tests | Total |
|----------|------------|-------------------|-------|
| Playback Control | 18 | 10 | 28 |
| Volume Control | 16 | 9 | 25 |
| Group Management | 18 | 10 | 28 |
| Advanced Features | - | 16 | 16 |
| Infrastructure | - | 15 | 15 |
| Playback Modes | - | 14 | 14 |
| TTS | - | 7 | 7 |
| SOAP/Utilities | 7 | - | 7 |
| Line-In | 5 | - | 5 |
| Adaptive/Discovery | - | 6 | 6 |

**Overall Coverage**: 96% (statements)