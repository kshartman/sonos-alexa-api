# Music Library Search Optimization Plan

## Problem Statement

Current music library search implementation has severe performance issues:
- **Search time**: ~57 seconds for a 49,322 track library
- **Algorithm**: Linear scan through all tracks with complex string matching
- **User impact**: Tests timeout, poor user experience

## Root Cause Analysis

The current implementation in `MusicLibraryCache.search()`:
1. Iterates through **all** tracks in memory (`for (const track of this.tracks.values())`)
2. Performs multiple string operations per track
3. No search indexing - pure brute force
4. Continues searching even after finding enough results

## Proposed Solution: In-Memory Search Indexing

Maintain the project's philosophy of minimal dependencies while dramatically improving performance.

### Option 1: Better In-Memory Indexing (Recommended)

Keep it simple but make it fast:

```typescript
// Add these to MusicLibraryCache class
private titleIndex: Map<string, Set<string>> = new Map(); // word -> track IDs
private searchTrie: Trie = new Trie(); // For prefix matching

// During indexing, tokenize and index each track
private indexTrack(track: CachedTrack) {
  // Tokenize title into words
  const words = track.titleLower.split(/\s+/);
  for (const word of words) {
    if (!this.titleIndex.has(word)) {
      this.titleIndex.set(word, new Set());
    }
    this.titleIndex.get(word)!.add(track.id);
    
    // Also add to trie for prefix search
    this.searchTrie.insert(word, track.id);
  }
}

// Search becomes much faster
async search(query: string): Promise<MusicSearchResult[]> {
  const words = query.toLowerCase().split(/\s+/);
  const matchingSets = words.map(word => 
    this.titleIndex.get(word) || new Set()
  );
  
  // Find intersection of all sets
  const matches = intersection(...matchingSets);
  // Convert IDs back to tracks
  return Array.from(matches).map(id => this.tracks.get(id)!);
}
```

**Pros:**
- No new dependencies
- Fits the project philosophy
- Fast searches (milliseconds instead of minutes)
- Memory overhead is reasonable (~2x current usage)

### Option 2: SQLite (Embedded)

If you want SQL capabilities without a server:

```typescript
import Database from 'better-sqlite3';

class MusicLibraryCache {
  private db: Database.Database;
  
  constructor() {
    this.db = new Database('./cache/music-library.db');
    this.setupSchema();
    this.createIndexes();
  }
  
  private setupSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        title TEXT,
        artist TEXT,
        album TEXT,
        uri TEXT,
        title_lower TEXT,
        artist_lower TEXT,
        album_lower TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_title ON tracks(title_lower);
      CREATE INDEX IF NOT EXISTS idx_artist ON tracks(artist_lower);
      CREATE INDEX IF NOT EXISTS idx_album ON tracks(album_lower);
    `);
  }
  
  async search(query: string): Promise<MusicSearchResult[]> {
    const searchTerm = `%${query.toLowerCase()}%`;
    const stmt = this.db.prepare(`
      SELECT * FROM tracks 
      WHERE title_lower LIKE ? 
      LIMIT 50
    `);
    return stmt.all(searchTerm);
  }
}
```

**Pros:**
- Very fast with proper indexes
- Built-in full-text search with FTS5
- Can persist between restarts
- Single file database

**Cons:**
- Adds a dependency (better-sqlite3)
- Slightly against the minimal dependency philosophy

### Option 3: MiniSearch (Specialized Library)

A lightweight full-text search library:

```typescript
import MiniSearch from 'minisearch';

class MusicLibraryCache {
  private searchIndex: MiniSearch;
  
  constructor() {
    this.searchIndex = new MiniSearch({
      fields: ['title', 'artist', 'album'],
      storeFields: ['id', 'title', 'artist', 'album', 'uri']
    });
  }
  
  async search(query: string): Promise<MusicSearchResult[]> {
    return this.searchIndex.search(query, {
      fuzzy: 0.2,
      prefix: true
    });
  }
}
```

**Pros:**
- Purpose-built for search
- Tiny dependency (50KB)
- Fuzzy search, stemming, etc.
- Very fast

## Recommendation

Given the project's philosophy of minimal dependencies and the fact that the data is already in memory, **Option 1** (better in-memory indexing) is recommended:

1. **No new dependencies** - Aligns with project goals
2. **Fast enough** - Would reduce search from 57s to <100ms
3. **Simple to implement** - Just needs better data structures
4. **Fits the use case** - Music libraries don't change often, so building indexes once is fine

## Implementation Plan

### Phase 1: Basic Word Index
1. Add `titleIndex`, `artistIndex`, `albumIndex` maps (word -> Set<trackId>)
2. Tokenize and index during cache building
3. Update search to use index intersection
4. Test performance improvement

### Phase 2: Trie for Prefix Search
1. Implement simple Trie class (no external dependency)
2. Add prefix matching capability
3. Support "starts with" queries efficiently

### Phase 3: Optimization
1. Add configurable index build strategies
2. Implement early termination when enough results found
3. Add memory usage monitoring
4. Consider n-gram indexes for substring matching

## Expected Results

- **Search time**: From ~57,000ms to <100ms
- **Memory usage**: ~2x current (acceptable for the performance gain)
- **User experience**: Instant search results
- **Test reliability**: No more timeouts

## Alternative Considerations

If memory becomes a concern, we could:
1. Use a hybrid approach - index only most common words
2. Implement an LRU cache for search results
3. Build indexes on-demand and cache them
4. Consider compression techniques for the index

## Migration Strategy

1. Implement new indexing alongside current search
2. Add feature flag to switch between implementations
3. Test thoroughly with various library sizes
4. Gradually roll out to users
5. Remove old implementation after validation