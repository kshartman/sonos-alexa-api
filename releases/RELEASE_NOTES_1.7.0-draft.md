# Release Notes - v1.7.0 (DRAFT)

**Release Date**: TBD

## Overview

Version 1.7.0 focuses on performance optimization and enhanced functionality for the Sonos Alexa API. This release introduces significant improvements to music library search performance and additional feature enhancements.

## New Features

### 🚀 Music Library Search Optimization

- [ ] **In-Memory Search Indexing** - Reduces search time from ~60 seconds to <100ms for large libraries (40k+ tracks)
- [ ] **Inverted Word Indexes** - Efficient title, artist, and album search capabilities
- [ ] **Multi-Word Query Support** - Set intersections for complex search queries
- [ ] **Prefix Matching** - Trie data structure for fast auto-complete style searches
- [ ] **Zero-Dependency Implementation** - Maintains project philosophy with better algorithms

### 🎵 Music Service Enhancements

- [ ] **Amazon Music Integration** - Direct playback and search capabilities (pending API availability)
- [ ] **Enhanced Spotify Search** - Improved search result ranking and relevance
- [ ] **Pandora Station Discovery** - Better station browsing and recommendation features

### 🔧 System Improvements

- [ ] **WebSocket Support** - Real-time state updates and push notifications
- [ ] **Enhanced Error Recovery** - Improved resilience for network and device failures
- [ ] **Performance Monitoring** - Built-in metrics and performance tracking

## Improvements

### Performance Optimizations
- [ ] **Connection Pooling** - Reduced SOAP request overhead
- [ ] **Batch Operations** - Multiple device updates in parallel
- [ ] **Smart Caching** - Improved cache strategies for frequently accessed data

### Developer Experience
- [ ] **Enhanced Debug Tools** - Additional diagnostic capabilities
- [ ] **Improved Preset Management** - Validation status in UI/API responses
- [ ] **Better Error Messages** - More descriptive error reporting

### API Enhancements
- [ ] **New Search Endpoints** - Optimized search API with performance metrics
- [ ] **Extended Status Information** - Additional system health and performance data
- [ ] **Rate Limiting Improvements** - More flexible rate limiting configuration

## Bug Fixes

- [ ] TBD - Issues to be identified and resolved during development

## Breaking Changes

None planned. All changes should be backward compatible.

## Dependencies

- [ ] Potential new dependencies for search optimization (evaluation in progress)
- [ ] All new dependencies must align with minimal dependency philosophy

## Migration Guide

No migration required from v1.6.0. All changes are planned to be backward compatible.

### For Performance-Sensitive Deployments

New search optimization features will be automatically enabled. Large music libraries (>10k tracks) will see the most significant performance improvements.

## Technical Details

### Music Library Search Implementation
- In-memory indexing with periodic refresh (configurable interval)
- Separate indexes for titles, artists, albums, and combined search
- Fuzzy matching capabilities for typo-tolerant search
- Configurable search result limits and ranking algorithms

### WebSocket Implementation
- Optional WebSocket server for real-time updates
- Event-driven architecture for state changes
- Backward compatibility with existing polling-based clients

## Performance Targets

- **Library Search**: <100ms for any library size
- **Real-time Updates**: <50ms latency for WebSocket events
- **Memory Usage**: <10% increase for search indexing
- **Startup Time**: No significant impact on cold start performance

## Known Issues

- TBD - Issues to be documented during development

## What's Next

Planning for future releases includes:
- **Playlist Management**: Creation, deletion, export/import of playlists
- **Last.fm Scrobbling**: Automatic track scrobbling with configurable filters (exclude ambient/sleep tracks, specific artists, genres) and API endpoints for filter management
- **Spotify Podcast Support**: Podcast episodes, shows, and episode playback (ref: jishi/node-sonos-http-api#893)
- **Advanced Preset Features**: Enhanced preset validation, templates, and sharing
- **Home Automation Integrations**: Enhanced webhooks, MQTT support, Home Assistant native integration
- **Additional Music Services**: Deezer, SiriusXM completion, YouTube Music
- **Machine Learning Features**: Smart recommendations, usage analytics, predictive grouping

---

**Note**: This is a draft document. Features and changes are subject to modification before the final release.

## Development Progress

### Phase 1: Library Search Optimization
- [ ] Design in-memory indexing architecture
- [ ] Implement core search algorithms
- [ ] Add performance benchmarking
- [ ] Integrate with existing API endpoints

### Phase 2: Music Service Enhancements
- [ ] Amazon Music API integration
- [ ] Enhanced Spotify features
- [ ] Pandora improvements

### Phase 3: System Improvements
- [ ] WebSocket implementation
- [ ] Performance monitoring
- [ ] Error recovery enhancements

### Phase 4: Testing & Optimization
- [ ] Comprehensive performance testing
- [ ] Memory usage optimization
- [ ] Documentation updates