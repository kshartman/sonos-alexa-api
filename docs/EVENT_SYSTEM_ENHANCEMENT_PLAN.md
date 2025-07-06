# Event System Enhancement Plan: Logical Room-Based Events

## Overview

This document outlines a plan to evolve the Sonos API event system from physical device-based events to logical room-based events that can gracefully handle topology changes, stereo pairs, and groups.

## Current Problems

### 1. Physical Device ID Dependencies
- Events are currently tied to physical device UUIDs (e.g., `uuid:RINCON_5CAAFDFF735A01400`)
- In stereo pairs, events may come from non-coordinator devices
- Tests and consumers must know about physical topology to handle events correctly
- Device IDs change when groups are formed/dissolved

### 2. Stereo Pair Complexity
- Stereo pairs have multiple physical devices but represent one logical room
- Events can come from either the left or right speaker
- Only the coordinator emits AVTransport events
- RenderingControl events may come from any member

### 3. Group Topology Changes
- When devices join/leave groups, event sources change
- Coordinator role can shift between devices
- Consumers must track topology changes and update subscriptions

### 4. Event Reliability Issues
- Short sequences (like TTS) may cause batched or missed events
- Tight event sequences can overwhelm subscribers
- Some APIs don't consistently emit expected events

## Proposed Architecture

### 1. Logical Room Abstraction

Instead of subscribing to device IDs, consumers subscribe to logical room names:

```typescript
// Current (Physical)
eventManager.waitForState('uuid:RINCON_347E5CA0D27C01400', 'PLAYING');

// Proposed (Logical)
eventManager.waitForState('OfficeSpeakers', 'PLAYING');
```

### 2. Room Event Aggregator

Create a new layer that:
- Maps room names to all physical devices in that room
- Subscribes to all relevant physical devices
- Aggregates events and emits them with room context
- Handles topology changes transparently

```typescript
interface RoomEvent {
  roomName: string;
  eventType: string;
  data: any;
  sourceDeviceId?: string; // Optional, for debugging
  timestamp: number;
}
```

### 3. Topology-Aware Subscriptions

The system should:
- Automatically track stereo pair relationships
- Monitor group membership changes
- Update internal subscriptions when topology changes
- Maintain event continuity across topology changes

## Implementation Plan

### Phase 1: Foundation (Current - Completed)
- ✅ Add group member tracking to EventManager
- ✅ Make waitFor* methods group-aware
- ✅ Track all device IDs in stereo pairs/groups

### Phase 2: Room Abstraction Layer
1. Create `RoomEventManager` class
   - Extends EventEmitter
   - Maintains room → devices mapping
   - Handles subscription management

2. Room registration system
   ```typescript
   class RoomEventManager {
     registerRoom(roomName: string, deviceIds: string[]): void;
     updateRoomTopology(roomName: string, deviceIds: string[]): void;
     unregisterRoom(roomName: string): void;
   }
   ```

3. Event translation layer
   - Convert device events to room events
   - Handle duplicate events from multiple devices
   - Ensure exactly-once delivery per room

### Phase 3: Topology Integration
1. Automatic room discovery
   - Use ZoneGroupTopology to identify rooms
   - Track stereo pair relationships via ChannelMapSet
   - Monitor group membership

2. Dynamic subscription management
   - Subscribe to new devices when they join a room
   - Unsubscribe when devices leave
   - Handle coordinator changes

3. State reconciliation
   - Maintain room state across topology changes
   - Handle split-brain scenarios
   - Recover from missed events

### Phase 4: Enhanced Reliability
1. Event deduplication
   - Track recent events to avoid duplicates
   - Handle batched events from quick sequences

2. State polling fallback
   - Periodic state verification
   - Gap detection and recovery
   - Configurable polling intervals

3. Event metadata enrichment
   - Add topology context to events
   - Include coordinator information
   - Track event source for debugging

## API Design

### Room Event Subscriptions
```typescript
// Subscribe to room events
roomEventManager.on('OfficeSpeakers:state-change', (event) => {
  console.log(`${event.roomName} changed to ${event.data.state}`);
});

// Wait for room state
await roomEventManager.waitForRoomState('OfficeSpeakers', 'PLAYING');

// Get current room state
const state = roomEventManager.getRoomState('OfficeSpeakers');
```

### Topology Change Handling
```typescript
// Automatically handled internally
roomEventManager.on('topology-change', (event) => {
  // Update internal mappings
  // Resubscribe as needed
  // Maintain event continuity
});
```

## Benefits

1. **Simplified Consumer API**: No need to understand physical topology
2. **Topology Resilience**: Events continue working across group changes
3. **Better Testing**: Tests can use room names without device ID knowledge
4. **Improved Reliability**: Aggregation reduces missed events
5. **Future Proof**: New device types can be added transparently

## Migration Strategy

1. Implement new system alongside existing
2. Add compatibility layer for existing consumers
3. Gradually migrate internal code to new API
4. Deprecate device-based event methods
5. Remove legacy code after migration

## Considerations

### Performance
- Minimal overhead from event aggregation
- Efficient deduplication using sliding windows
- Lazy subscription management

### Backwards Compatibility
- Maintain device-based events during transition
- Provide migration guides
- Support both APIs temporarily

### Edge Cases
- Rooms with same name (handle via unique IDs)
- Devices moving between rooms
- Network partitions
- Subscription failures

## Success Metrics

1. **Event Reliability**: 99.9% of state changes captured
2. **Latency**: < 50ms added latency from aggregation
3. **Test Stability**: Eliminate topology-related test failures
4. **API Simplicity**: Reduce event handling code by 50%

## Timeline

- Phase 1: ✅ Completed (group-aware waitFor methods)
- Phase 2: 2-3 weeks (room abstraction)
- Phase 3: 2-3 weeks (topology integration)
- Phase 4: 1-2 weeks (reliability enhancements)
- Migration: 2-4 weeks (depending on codebase size)

## Future Enhancements

1. **Event Replay**: Store recent events for debugging
2. **Event Filtering**: Subscribe to specific event types per room
3. **Bulk Operations**: Handle multi-room commands efficiently
4. **WebSocket Support**: Real-time event streaming to clients
5. **Event Analytics**: Track event patterns and anomalies