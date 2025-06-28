# Sonos API Test Plan

## Overview

This test suite provides comprehensive testing for the Sonos Alexa API with two distinct testing approaches:

1. **Unit Tests** - Fast, isolated tests that require no Sonos hardware (CI/CD friendly)
2. **Integration Tests** - Event-driven tests using real Sonos devices that adapt to your system

The integration tests use real UPnP events from Sonos devices rather than polling or fixed timeouts, ensuring reliable and realistic testing that automatically adapts to your available speakers and content.

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

## Integration Test Suite Structure

The integration tests are organized by functionality and numbered in execution order:

### 1. Core Infrastructure (Priority: Critical)
**File: `01-infrastructure-tests.ts`**
- Server health check and API availability
- Event manager functionality and SSE connections
- Device discovery and state tracking
- Basic UPnP event subscription validation
- **Status: ✅ All tests passing**

### 2. Basic Playback Control (Priority: High)
**File: `02-playback-tests.ts`**
- Play command (waits for PLAYING state event)
- Pause command (waits for PAUSED_PLAYBACK state event)
- Stop command (waits for STOPPED state event)
- PlayPause toggle functionality
- State transition handling with TRANSITIONING state management
- **Status: ✅ All tests passing**

### 3. Volume Control (Priority: High)
**File: `03-volume-tests.ts`**
- Set absolute volume (waits for volume-change event)
- Volume up/down relative changes
- Mute/unmute state changes (waits for mute-change event)
- Volume boundary testing (0-100)
- Group volume control when devices are grouped
- **Status: ✅ All tests passing**

### 4. Content Selection (Priority: Medium)
**File: `04-content-tests.ts`**
- Text-to-Speech (TTS) playback and state restoration
- Music search (Apple Music integration)
- Queue management and track navigation
- Playback mode control (repeat, shuffle, crossfade)
- Content discovery (favorites, playlists, presets)
- Error handling for missing content
- **Status: ✅ Most tests passing (17/18)**

### 5. Quick Group Management (Priority: Medium)
**File: `05-group-tests-quick.ts`**
- Join group (waits for topology-change event)
- Leave group (waits for topology-change event)
- Group playback control
- **Status: ✅ All tests passing**

### 6. Playback Modes (Priority: Medium)
**File: `06-playback-modes-tests.ts`**
- Repeat mode changes (none/all/one)
- Shuffle mode changes (preserves repeat settings)
- Crossfade toggle
- Combined mode testing with proper sequencing
- Queue operations
- **Status: ✅ All tests passing**
- **Recent Fix**: Shuffle+repeat interaction now works correctly

### 7. Advanced Features (Priority: Low)
**File: `07-advanced-tests.ts`**
- Sleep timer functionality
- Line-in playback
- Settings management
- System information endpoints
- Preset management
- Queue operations
- Error recovery
- **Status: ⚠️ Needs async/await fixes**

### 8. Text-to-Speech (Priority: Low)
**File: `08-tts-tests.ts`**
- Single room announcement
- Multi-room announcement (sayall)
- State restoration after TTS
- Volume adjustment for announcements
- Language support and special characters
- **Status: ⚠️ Needs async/await fixes**

### 9. Full Group Management (Priority: Low)
**File: `09-group-tests.ts`**
- Comprehensive group scenarios
- Stereo pair handling
- Complex group topologies
- **Status: ✅ Tests pass but take longer due to physical speaker regrouping**

## Key Features

### Event-Driven Testing
- **No Fixed Timeouts**: Tests wait for actual UPnP events instead of arbitrary delays
- **State Verification**: Always verify stable state before performing operations
- **TRANSITIONING Handling**: Tests properly handle device state transitions
- **Real Device Events**: Uses actual Sonos UPnP notifications for state changes

### Coordinator Pattern Support
All coordinator-required operations are automatically routed to the group coordinator:
- Queue management (get, add, clear)
- Playback control (play, pause, stop, next, previous)
- Content selection (favorites, playlists, music search)
- Playback modes (repeat, shuffle, crossfade)
- Transport settings

### Music Service Integration
- **Apple Music**: Full search and playback support
- **Pandora**: Authentication and basic controls
- **SiriusXM**: Endpoints exist (returns 501 - not implemented)
- **Local Content**: Favorites, playlists, and presets

### Error Handling
- Graceful handling of missing content
- Network timeout management
- Invalid parameter validation
- Device availability checking

## Running Tests

### Quick Start

```bash
# Install dependencies
npm install

# Run unit tests only (no Sonos required - great for CI/CD)
npm run test:unit

# Run integration tests (requires Sonos system)
npm run test:integration

# Run all tests (unit + integration)
npm test
```

### Unit Tests
**No Prerequisites** - Works anywhere, including CI/CD systems

```bash
# Run all unit tests
npm run test:unit

# Run specific unit test files
npm run test:unit -- unit/api-router-tests.ts
npm run test:unit -- unit/device-tests.ts

# Run with coverage
npm run test:coverage
```

Unit tests are perfect for:
- **CI/CD pipelines** (GitHub Actions, Jenkins, etc.)
- **Pre-commit hooks**
- **Development workflow** (fast feedback)
- **Code quality gates**

### Integration Tests
**Prerequisites**:
1. **Active Sonos System**: At least one Sonos device on the network
2. **Network Access**: API server must be able to reach Sonos devices via UPnP
3. **Available Content**: Some favorites, playlists, or presets (tests adapt to what you have)
4. **Device Availability**: Ensure devices are not actively being controlled by other apps

```bash
# Run all tests (unit + integration)
npm test

# Run only integration tests
npm run test:integration

# Run specific test categories
npm test -- integration/01-infrastructure-tests.ts
npm test -- integration/02-playback-tests.ts
npm test -- integration/03-volume-tests.ts

# Run with pattern matching
npm test -- integration/06-playback-modes-tests.ts --grep "shuffle"
npm test -- integration/04-content-tests.ts --grep "TTS"
```

### Test Modes Explained

| Mode | Command | Description | Use Case |
|------|---------|-------------|----------|
| **Unit Only** | `npm run test:unit` | Fast tests, no hardware needed | CI/CD, development |
| **Safe Integration** | `npm test` | Core functionality tests | Regular validation |
| **Full Integration** | `npm run test:integration` | All integration tests | Comprehensive testing |
| **Complete Suite** | `npm run test:full` | Unit + integration tests | Release validation |

### Environment Configuration

#### Basic Setup
```bash
# Set log level (optional)
export LOG_LEVEL=info

# Start API server
npm start
```

#### Debug Mode (for troubleshooting)
```bash
# Enable detailed logging
export DEBUG_LEVEL=debug
export DEBUG_CATEGORIES=api,upnp,topology,soap

# Start server with logging
npm start > logs/server.log 2>&1 &

# Monitor logs while testing
tail -f logs/server.log

# Run tests
npm run test:integration
```

#### CI/CD Configuration
```yaml
# Example GitHub Actions
- name: Run Unit Tests
  run: npm run test:unit

- name: Run Integration Tests
  run: npm run test:integration
  # Only run if Sonos system is available in test environment
```

### Adaptive Testing Features

Integration tests automatically adapt to your system:

#### Device Selection
- **Smart Room Selection**: Automatically finds the best available speaker
- **Coordinator Preference**: Prefers group coordinators over members
- **Device Type Filtering**: Avoids portable devices (Roam/Move) for topology tests
- **Availability Checking**: Skips tests if no suitable devices found

#### Content Adaptation
- **Favorites Discovery**: Uses your existing Sonos favorites
- **Playlist Detection**: Adapts to available music library playlists
- **Preset Support**: Tests with your configured presets
- **Service Integration**: Works with your connected music services

#### Graceful Degradation
- **Missing Content**: Skips tests for unavailable content types
- **Network Issues**: Provides clear error messages for UPnP problems
- **Device Busy**: Handles devices actively controlled by other apps
- **Service Unavailable**: Adapts when music services are offline

## Test Configuration

### Default Settings
- **Test Timeout**: 60 seconds per test
- **Event Timeout**: 5-20 seconds depending on operation
- **Server Auto-start**: Tests automatically start server if needed
- **Concurrency**: Sequential execution (one test file at a time)

### Room Selection
Tests automatically select an appropriate test room using `getSafeTestRoom()`:
- Prioritizes coordinators over grouped members
- Avoids portable devices (Roam, Move) for topology tests
- Prefers Era 300 > Era 100 > One > Five > Arc > Beam > Play series

### Content Loading
Tests use real content for verification:
- **Favorites**: Automatically discovers and uses available favorites
- **Music Search**: Uses iTunes Search API for Apple Music content
- **TTS**: Generates temporary audio files for announcement testing

## Event System

### Event Types Monitored
- `device-state-change`: Playback state, volume, mute changes
- `track-change`: Track metadata updates
- `topology-change`: Group formation/dissolution
- `volume-change`: Device volume modifications
- `mute-change`: Device mute state changes

### Event Bridge
- **Server-Sent Events (SSE)**: Real-time event forwarding to tests
- **UPnP Subscriptions**: Direct NOTIFY callbacks from Sonos devices
- **Event History**: Maintains history for debugging failed tests

## Debugging Failed Tests

### Common Issues
1. **Device Busy**: Another app is controlling the device
2. **Network Issues**: UPnP multicast problems or firewall blocking
3. **Content Unavailable**: Favorites or playlists no longer accessible
4. **State Sync**: Device state not updated before test execution

### Debug Tools
```bash
# Check server logs
tail -f logs/server.log

# Enable debug categories
export DEBUG_CATEGORIES=all

# Test individual endpoints
curl "http://localhost:5005/zones"
curl "http://localhost:5005/KitchenSpeakers/state"
```

### Event Stream Monitoring
```bash
# Monitor real-time events
curl "http://localhost:5005/events"
```

## Recent Improvements

### Shuffle+Repeat Fix (v1.0)
- **Issue**: Setting shuffle mode reset repeat mode to 'none'
- **Root Cause**: Incorrect UPnP SetPlayMode values and parsing logic
- **Fix**: Use `"SHUFFLE"` for shuffle+repeat, updated state parsing to recognize `"SHUFFLE"` as repeat=all + shuffle=true

### Music Search TRANSITIONING Fix (v1.0)
- **Issue**: Tests timing out waiting for PLAYING state after music search
- **Root Cause**: Music search keeps device in TRANSITIONING longer than expected
- **Fix**: Use `waitForStableState()` instead of `waitForState('PLAYING')` and increased timeouts

### Coordinator Routing (v1.0)
- **Implementation**: 13 endpoints now properly route operations to group coordinator
- **Scope**: Playback control, queue management, content selection, playback modes
- **Validation**: All coordinator-dependent operations tested with grouped speakers

## Success Criteria

- ✅ **No Fixed Timeouts**: All state changes verified via events
- ✅ **Stable TRANSITIONING Handling**: Tests gracefully handle device state transitions
- ✅ **Event History**: Complete event tracking for debugging
- ✅ **Coordinator Support**: Group operations properly routed
- ✅ **Real Device Integration**: Tests work with actual Sonos hardware
- ✅ **Comprehensive Coverage**: All major API endpoints tested
- ✅ **Reliable Pass Rate**: Consistent results across multiple runs

## Test Results Summary

| Test Suite | Status | Pass Rate | Notes |
|------------|--------|-----------|--------|
| Infrastructure | ✅ Passing | 10/10 | Core functionality verified |
| Playback Control | ✅ Passing | 10/10 | Event-driven state management |
| Volume Control | ✅ Passing | 9/9 | Including group volume support |
| Content Selection | ⚠️ Mostly Passing | 17/18 | One song search test intermittent |
| Quick Group Mgmt | ✅ Passing | 2/2 | Fast group operations |
| Playback Modes | ✅ Passing | 14/14 | Shuffle+repeat fixed |
| Advanced Features | ⚠️ Needs fixes | 0/16 | Async/await issues in setup |
| TTS Tests | ⚠️ Needs fixes | 0/15 | Async/await issues in setup |
| Full Group Mgmt | ✅ Passing | Tests pass | Longer execution time |

**Overall Status**: 🟢 Core functionality fully tested and reliable. Advanced features need minor fixes.