# Type Refactoring Plan

## Overview
This document outlines the type refactoring priorities based on analysis of duplicated and shared type patterns in the codebase.

## Ranking Criteria
- **Importance**: Type safety improvement, frequency of use, error prevention potential
- **Difficulty**: Refactoring effort, risk of breaking changes, complexity

## Ranked Type Refactoring Tasks

### 1. API Response Shapes ⭐⭐⭐ (HIGH Priority, LOW Difficulty)
**Why Important**: 
- Used in every API endpoint (~50+ locations)
- Inconsistent error handling leads to runtime issues
- Easy win for type safety

**Current State**:
```typescript
// Repeated pattern:
{ status: number, body: { error: string, message: string } }
{ status: number, body: { status: string } }
```

**Proposed Solution**:
```typescript
// src/types/api-responses.ts
interface ApiErrorResponse {
  status: number;
  body: {
    error: string;
    message: string;
    details?: unknown;
  };
}

interface ApiSuccessResponse<T = { status: 'success' }> {
  status: number;
  body: T;
}

type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;
```

**Effort**: 2-3 hours
**Risk**: Low - additive change

### 2. Consistent SonosTrack Usage ⭐⭐⭐ (HIGH Priority, LOW Difficulty)
**Why Important**:
- Track data is core to the API
- Interface already exists but not used consistently
- Prevents property typos and missing fields

**Current State**:
- `SonosTrack` interface defined in types/sonos.ts
- Many places use inline `{ title, artist, album, uri }` objects

**Proposed Solution**:
- Audit all track-returning methods
- Replace inline objects with SonosTrack
- Add SonosTrack[] for track lists

**Effort**: 1-2 hours
**Risk**: Low - type narrowing only

### 3. MediaItem Interface for Browse Results ⭐⭐⭐ (HIGH Priority, MEDIUM Difficulty)
**Why Important**:
- Every music service returns browse items
- Current implementations are inconsistent
- Critical for music service abstraction

**Current State**:
```typescript
// Different shapes in each service:
- Apple Music: { id, title, artist, album, uri, type }
- Spotify: { id, name, artists[], album, uri }
- Pandora: { stationId, stationName, uri }
- Library: { title, artist, album, uri, metadata }
```

**Proposed Solution**:
```typescript
// src/types/media-types.ts
interface BaseMediaItem {
  id: string;
  title: string;
  uri: string;
  metadata?: string;
  type: 'track' | 'album' | 'artist' | 'playlist' | 'station' | 'container';
}

interface TrackItem extends BaseMediaItem {
  type: 'track';
  artist: string;
  album: string;
  duration?: number;
  albumArtUri?: string;
}

interface StationItem extends BaseMediaItem {
  type: 'station';
  description?: string;
}

type MediaItem = TrackItem | StationItem | BaseMediaItem;
```

**Effort**: 4-5 hours (need to update all services)
**Risk**: Medium - requires careful service-by-service migration

### 4. Service Status Interface ⭐⭐ (MEDIUM Priority, LOW Difficulty)
**Why Important**:
- Standardizes service health reporting
- Useful for monitoring and debugging
- Currently inconsistent across services

**Current State**:
- Each service has its own status shape
- No standard way to check service health

**Proposed Solution**:
```typescript
// src/types/service-types.ts
interface ServiceStatus {
  serviceName: string;
  isInitialized: boolean;
  isHealthy: boolean;
  lastRefresh: Date | null;
  itemCount?: number;
  error?: string | null;
  metadata?: Record<string, unknown>;
}
```

**Effort**: 2 hours
**Risk**: Low - mostly additive

### 5. Device Information Types ⭐⭐ (MEDIUM Priority, MEDIUM Difficulty)
**Why Important**:
- Device management is core functionality
- Inconsistent device representations cause confusion
- Important for multi-room features

**Current State**:
- Discovery uses one shape
- API returns another
- SonosDevice has internal representation

**Proposed Solution**:
```typescript
// src/types/device-types.ts
interface DeviceInfo {
  id: string;
  roomName: string;
  ip: string;
  port: number;
  model: string;
  modelNumber?: string;
  softwareVersion?: string;
}

interface DeviceState extends DeviceInfo {
  isCoordinator: boolean;
  groupId: string;
  role?: 'coordinator' | 'member' | 'standalone';
  volume?: number;
  muted?: boolean;
}
```

**Effort**: 3-4 hours
**Risk**: Medium - touches core discovery logic

### 6. Scheduler Task Types ⭐ (LOW Priority, LOW Difficulty)
**Why Important**:
- Internal consistency
- Prevents scheduler bugs
- Limited scope

**Proposed Solution**:
```typescript
interface ScheduledTask {
  taskId: string;
  interval: number;
  lastRun: Date | null;
  nextRun: Date;
  callback: () => Promise<void> | void;
  isRunning: boolean;
  errorCount: number;
}
```

**Effort**: 1 hour
**Risk**: Low - internal only

### 7. Service Configuration Objects ⭐ (LOW Priority, HIGH Difficulty)
**Why Important**:
- Limited benefit - each service is unique
- Risk of over-abstraction
- Better left service-specific

**Recommendation**: Skip for now - not worth the complexity

## Implementation Plan

### Phase 1 (Immediate - High Value, Low Risk)
1. Create `/src/types/api-responses.ts` with common response types
2. Update all endpoints to use consistent `ApiResponse<T>` types
3. Ensure all track-returning methods use `SonosTrack`

### Phase 2 (Next Sprint - Medium Complexity)
4. Create `/src/types/media-types.ts` with MediaItem hierarchy
5. Migrate music services one by one to use MediaItem
6. Create `/src/types/service-types.ts` for service status

### Phase 3 (Future - Lower Priority)
7. Standardize device information types
8. Add scheduler task types
9. Consider service-specific type packages

## Success Metrics
- Zero inline object type definitions in API responses
- All track data uses SonosTrack interface
- All browse operations return MediaItem types
- Type coverage report shows 100% typed parameters
- Reduced TypeScript strict mode warnings

## Notes
- The codebase already has good type coverage with proper interfaces in `/src/types/`
- Most `any` types are documented and legitimate (with "ANY IS CORRECT" comments)
- Focus should be on consistency rather than creating new types
- Gradual migration is preferred over big-bang refactoring