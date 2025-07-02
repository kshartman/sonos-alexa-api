# SOAP Architecture Refactoring Plan

## Overview
This document outlines a plan to refactor the Sonos API codebase to properly separate concerns and confine all SOAP/device communication to the SonosDevice class.

## Current Problems

### 1. Services Making Direct Device Calls
- **SpotifyService**: Stores device reference, makes `browse()` calls
- **AccountService**: Makes `browse()` and `soap()` calls directly
- **MusicLibraryService**: Bypasses SonosDevice entirely with raw HTTP
- **PandoraBrowse**: Makes direct device calls
- **PandoraService**: Controls playback directly

### 2. Tight Coupling
- Services depend on device implementation details
- Difficult to unit test services in isolation
- Changes to SOAP interface ripple through services

### 3. Mixed Responsibilities
- Services handle both business logic AND device communication
- API router has to manage device references for services

## Refactoring Goals

1. **Single Responsibility**: Each layer has one clear purpose
2. **Dependency Inversion**: Services depend on abstractions, not implementations
3. **Testability**: Services can be tested without device mocks
4. **Maintainability**: SOAP changes only affect SonosDevice

## Phase 1: Extend SonosDevice API

Add missing methods to SonosDevice to encapsulate all SOAP operations:

```typescript
class SonosDevice {
  // Existing methods...
  
  // New browsing methods
  async browseFavorites(): Promise<BrowseItem[]> {
    return this.browse('FV:2');
  }
  
  async browseQueue(limit?: number, offset?: number): Promise<BrowseItem[]> {
    return this.browse(`Q:0/${limit || 500}/${offset || 0}`);
  }
  
  async browseMusicLibrary(id: string): Promise<BrowseItem[]> {
    return this.browse(id);
  }
  
  // Service discovery
  async getAvailableServices(): Promise<ServiceInfo[]> {
    const response = await this.soap('MusicServices', 'ListAvailableServices', {});
    return this.parseServices(response);
  }
  
  // Music library specific
  async getMusicLibraryInfo(): Promise<MusicLibraryInfo> {
    // Encapsulate the HTTP call currently in MusicLibraryService
    const response = await this.httpGet('/status/tracks_summary');
    return this.parseMusicLibraryInfo(response);
  }
}
```

## Phase 2: Refactor Services to be Stateless

### SpotifyService Refactoring

```typescript
// Before: Stateful service with device dependency
class SpotifyService {
  private device?: SonosDevice;
  private account?: ServiceAccount;
  
  setDevice(device: SonosDevice): void {
    this.device = device;
  }
  
  async browseForPrefix(type: string): Promise<string | null> {
    const browseResult = await this.device.browse('FV:2');
    // ... process results
  }
}

// After: Stateless service processing data
class SpotifyService {
  // Remove device and account storage
  
  extractPrefixFromFavorites(
    favorites: BrowseItem[], 
    type: 'album' | 'playlist'
  ): string | null {
    // Pure data processing - no device calls
    const searchPattern = type === 'album' ? 'spotify%3Aalbum' : 'spotify%3Aplaylist';
    
    for (const item of favorites) {
      if (item.uri?.includes('x-rincon-cpcontainer:') && item.uri.includes(searchPattern)) {
        const match = item.uri.match(/x-rincon-cpcontainer:([0-9a-f]+)spotify/);
        if (match?.[1]) return match[1];
      }
    }
    return null;
  }
  
  generateURI(
    type: 'track' | 'album' | 'playlist' | 'artist',
    id: string,
    account: ServiceAccount,
    extractedInfo?: SpotifyExtractedValues
  ): string {
    // Pure URI generation - no device dependency
    if (type === 'track') {
      return `x-sonos-spotify:spotify%3Atrack%3A${id}?sid=${account.sid}&flags=8224&sn=${account.sn}`;
    }
    // ... handle other types
  }
  
  generateMetadata(
    type: string,
    result: any,
    account: ServiceAccount,
    extractedInfo?: SpotifyExtractedValues
  ): string {
    // Pure metadata generation
    // ... build DIDL-Lite XML
  }
}
```

### AccountService Refactoring

```typescript
// After: Service processes data, doesn't fetch it
class AccountService {
  extractSpotifyInfoFromFavorites(
    favorites: BrowseItem[]
  ): Record<string, SpotifyExtractedValues> {
    const accounts: Record<string, SpotifyExtractedValues> = {};
    
    for (const item of favorites) {
      if (this.isSpotifyFavorite(item)) {
        const extracted = this.extractFromMetadata(item);
        if (extracted) {
          accounts[extracted.accountId] = extracted;
        }
      }
    }
    
    return accounts;
  }
  
  findServiceInList(
    services: ServiceInfo[],
    serviceName: string
  ): ServiceInfo | null {
    // Pure service lookup
    return services.find(s => 
      s.name.toLowerCase().includes(serviceName.toLowerCase())
    ) || null;
  }
}
```

## Phase 3: Update API Router

The API router becomes the orchestrator, fetching data from devices and passing it to services:

```typescript
class ApiRouter {
  private async spotifyPlay({ room, id }: RouteParams) {
    const device = this.getDevice(room);
    const coordinator = this.discovery.getCoordinator(device.id) || device;
    
    // 1. Get available services from device
    const services = await coordinator.getAvailableServices();
    const spotifyService = this.accountService.findServiceInList(services, 'spotify');
    if (!spotifyService) {
      throw { status: 503, message: 'Spotify not configured' };
    }
    
    // 2. Get favorites for extraction if needed
    const favorites = await coordinator.browseFavorites();
    const extractedInfo = this.accountService.extractSpotifyInfoFromFavorites(favorites);
    
    // 3. Generate URI and metadata (pure functions)
    const uri = this.spotifyService.generateURI(
      parsed.type,
      parsed.id,
      spotifyService,
      Object.values(extractedInfo)[0]
    );
    
    const metadata = this.spotifyService.generateMetadata(
      parsed.type,
      { id: parsed.id, title: `Spotify ${parsed.type}` },
      spotifyService,
      Object.values(extractedInfo)[0]
    );
    
    // 4. Play using device
    await coordinator.setAVTransportURI(uri, metadata);
    await coordinator.play();
  }
}
```

## Phase 4: Special Cases

### MusicLibraryService
Currently makes raw HTTP calls. Should be refactored to:
1. Use SonosDevice methods for all device communication
2. Return data for caching layer to store

### PandoraService
Should return station info instead of controlling playback:
```typescript
// Instead of controlling playback
async playStation(device: SonosDevice, stationName: string) {
  // Bad: Service controls device
  await device.setAVTransportURI(uri, metadata);
  await device.play();
}

// Return data for caller to use
async findStation(stations: BrowseItem[], stationName: string): StationInfo | null {
  // Good: Service returns data
  return {
    uri: station.uri,
    metadata: this.generateMetadata(station)
  };
}
```

## Migration Strategy

### Phase 1: Non-Breaking Additions (Week 1)
1. Add new methods to SonosDevice
2. Create pure utility functions alongside existing methods
3. Add deprecation comments to old methods

### Phase 2: Parallel Implementation (Week 2)
1. Implement new patterns in parallel with old
2. Add feature flags to switch between implementations
3. Test thoroughly with both paths

### Phase 3: Gradual Migration (Week 3)
1. Update API router to use new patterns
2. Migrate one service at a time
3. Maintain backward compatibility

### Phase 4: Cleanup (Week 4)
1. Remove deprecated methods
2. Remove device storage from services
3. Update tests to use new patterns

## Testing Strategy

### Unit Tests
Services become easily testable with pure functions:
```typescript
describe('SpotifyService', () => {
  it('extracts album prefix from favorites', () => {
    const favorites = [
      { uri: 'x-rincon-cpcontainer:1006006cspotify%3Aalbum%3A123', title: 'Test' }
    ];
    const prefix = service.extractPrefixFromFavorites(favorites, 'album');
    expect(prefix).toBe('1006006c');
  });
});
```

### Integration Tests
Test the full flow through API router with mocked SonosDevice.

## Benefits

1. **Testability**: Services can be unit tested without device mocks
2. **Maintainability**: SOAP protocol changes isolated to SonosDevice
3. **Reusability**: Services can work with data from any source
4. **Type Safety**: Clear interfaces between layers
5. **Performance**: Opportunity to cache device responses

## Risks and Mitigations

### Risk: Breaking Changes
**Mitigation**: Use feature flags and gradual migration

### Risk: Performance Impact
**Mitigation**: Add caching layer for frequently accessed data

### Risk: Increased Complexity
**Mitigation**: Clear documentation and examples

## Timeline

- **Week 1**: Extend SonosDevice API, create utility functions
- **Week 2**: Refactor SpotifyService and AccountService
- **Week 3**: Refactor remaining services
- **Week 4**: Update API router, remove old code
- **Week 5**: Update tests and documentation

## Success Metrics

1. All SOAP calls confined to SonosDevice class
2. Services have no device dependencies
3. 100% unit test coverage for service layer
4. No increase in API response times
5. Clear separation between layers