# Wishlist / Deferred

**Status**: Unscheduled. Nothing here is implemented, committed to, or assigned a release.

These items were originally drafted as release notes for v1.7.0, which made
unbuilt features look like shipped ones. The content was moved here in v1.8.0
and reframed as a wishlist. For what actually shipped, see `releases/`.

Items with a dedicated design document link to it rather than restating the detail.

## Music Library

- **In-memory search indexing** — see [LIBRARY_INDEX_PLAN.md](LIBRARY_INDEX_PLAN.md)
  for the measured problem (~57s for a 49,322 track library) and the proposed
  inverted-index/trie design. Aspirational target: <100ms for any library size,
  <10% memory increase, no significant cold-start impact.
- **Fuzzy matching** — typo-tolerant search
- **Configurable result limits and ranking**
- **New search endpoints** — optimized search API with performance metrics

## Music Services

- **Amazon Music** — blocked: no public API available
- **Enhanced Spotify search** — better result ranking and relevance
- **Spotify podcast support** — episodes, shows, episode playback (ref: jishi/node-sonos-http-api#893)
- **Pandora station discovery** — richer station browsing and recommendations
- **Additional services** — Deezer, SiriusXM completion, YouTube Music
- **Last.fm scrobbling** — see [LASTFM_PLAN.md](LASTFM_PLAN.md)

## Real-Time / Events

- **WebSocket support** — optional WebSocket server for state changes, event-driven,
  backward compatible with existing polling clients. Aspirational target: <50ms
  event latency. Related but distinct: [EVENT_SYSTEM_ENHANCEMENT_PLAN.md](EVENT_SYSTEM_ENHANCEMENT_PLAN.md)
  covers moving from device-based to room-based events.
- **Home automation integrations** — enhanced webhooks, MQTT, native Home Assistant

## Performance

- **Connection pooling** — reduce SOAP request overhead
- **Batch operations** — multiple device updates in parallel
- **Smart caching** — better strategies for frequently accessed data
- **Performance monitoring** — built-in metrics and tracking

## Presets & Playlists

- **Playlist management** — creation, deletion, export/import
- **Preset validation status in API responses** — note that a standalone validation
  script shipped in v1.8.0 (`scripts/validate-presets.sh`); this item is about
  surfacing validation state through the API
- **Advanced preset features** — templates and sharing

## Developer Experience

- **Enhanced debug tools** — additional diagnostic capabilities
- **Better error messages** — more descriptive error reporting
- **Enhanced error recovery** — improved resilience for network and device failures
- **Extended status information** — additional system health and performance data
- **Rate limiting improvements** — more flexible configuration

## Speculative

- **Machine learning features** — smart recommendations, usage analytics, predictive grouping

## Deferred From Archived Plans

Recorded in documents under [`../archive/`](../archive/), which is not published to
the public repository. Those documents are unmaintained; status below has not been
re-verified against the current codebase except where noted.

### SOAP Architecture

Source: [`../archive/REFACTORING_PLAN.md`](../archive/REFACTORING_PLAN.md) — phases 1-2
completed June-July 2025, the rest never started.

- **Phase 3: Update API Router** (§ *Phase 3: Update API Router 📅 DEFERRED*, ~line 418)
  — dependency injection for the router
- **Phase 4: Special Cases** (§ *Phase 4: Special Cases 📅 DEFERRED*, ~line 430)
  — refactoring of the special-case services

### Type Safety

Source: [`../archive/TYPE_REFACTORING_PLAN.md`](../archive/TYPE_REFACTORING_PLAN.md),
§ *Remaining Type Safety Tasks from Original Plan* (~line 290).

- ~~**Strict compiler options**~~ — **already done**: `tsconfig.json` sets `strict: true`,
  which implies `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`,
  `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, and
  `alwaysStrict`. The archived doc lists them individually as outstanding; they are not.
- **SOAP response validation** (high) — runtime type guards for SOAP responses
- **UPnP event types** (medium) — interfaces for every event type, type-safe parsing,
  proper handler signatures
- **Configuration validation** (medium) — runtime validation of `settings.json`,
  type guards on config loading, environment variable coercion
- **XML type safety** (low) — validated parsing and type-safe building

The same document's § *Ranked Type Refactoring Tasks* (~line 10) holds seven ranked
proposals (API response shapes, SonosTrack usage, MediaItem interface, service status,
device information, scheduler tasks, service configuration). Some appear partially
implemented — `ApiResponse<T>` exists in `src/types/sonos.ts` — so treat that list as
a starting point, not a backlog.
