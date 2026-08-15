# TODO

Open work for the Sonos Alexa API. Two tiers:

- **Active** — real work, scheduled or schedulable. Check items off as they land.
- **Deferred** — ideas with no owner, no schedule, and no commitment. Nothing here is
  promised. Moving an item up to Active is a deliberate act.

For what has already shipped, see `releases/`. Items with a dedicated design document
point at it rather than restating the detail.

---

# Active

## Security

From GitHub Dependabot as of 2026-08-15: 15 open alerts, 1 critical. Triaged by whether
the package ships at runtime.

### Runtime — do first

`fast-xml-parser` is one of the project's three production dependencies.
`package.json` pins `^4.3.2`, currently resolving to **4.5.3**. Six open alerts:

| severity | patched in | issue |
|---|---|---|
| **critical** | 4.5.4 | entity encoding bypass via regex injection in DOCTYPE entity names |
| high | 4.5.4 | DoS through entity expansion in DOCTYPE (no expansion limit) |
| high | 4.5.5 | numeric entity expansion bypasses all expansion limits |
| medium | 4.5.5 | entity expansion limits bypassed when set to zero (falsy check) |
| medium | 5.7.0 | XMLBuilder: XML comment and CDATA injection via unescaped delimiters |
| low | 4.5.4 | XMLBuilder stack overflow with `preserveOrder` |

- [ ] Bump to **4.5.7** (the `legacy` dist-tag). Inside the existing `^4` range, so
      `npm update fast-xml-parser` suffices — no code change expected. Clears five of six.
- [ ] Decide on the sixth (XMLBuilder comment/CDATA injection, needs 5.7.0+). `latest`
      is 5.10.1, a major bump. **XMLBuilder is in use** — `src/utils/soap.ts:1,7`
      constructs every outgoing SOAP body — so this is not a dead code path. Assess
      whether caller-controlled strings (room names, search queries, URIs) reach the
      builder unescaped before deciding how urgent the major bump is.
- [ ] Re-run the SOAP and topology integration tests after either change; this library
      parses every device response.
- [ ] Ship as v1.8.1.

### Dev-only — lower priority

`brace-expansion`, `js-yaml`, `picomatch`, `minimatch`, `flatted` are all absent from
the production tree (`npm ls <pkg> --omit=dev` finds nothing) and reach the repo only
through lint and test tooling. All are DoS/ReDoS or prototype-pollution classes that
need attacker-controlled input to matter.

- [ ] `npm audit fix` on the dev tree, then confirm `npm run lint` and `npm test` still pass
- [ ] Do not ship a runtime change to chase these

## Preset Validation Reporting

Not a playback bug — presets resolve fine at runtime — but the logs and `/debug/startup`
misreport it as failure. Investigated 2026-08-15 against the running 1.8.0 container.

Evidence: of the 68 presets reported as "Failed favorite resolution", **all 68** reference
favorites that exist live (62 exact, 6 after normalisation, 0 missing). The label means
"URI still starts with `favorite:`", which `preset-loader.ts:406-407` deliberately leaves
for runtime, and `sonos-device.ts:638-658` resolves in `playUri()`.

- [ ] Rename the log line and the `failedResolution` stat — "deferred to runtime" is what
      it means. `preset-loader.ts:246-249`.
- [ ] Stop re-validating on every discovery event. 504 full passes over 139 presets in an
      8-second window at startup, with the valid count oscillating 57↔82.
- [ ] Recompute or invalidate the stats after the favorites cache settles. `presetsValidated`
      (`preset-loader.ts:259`) latches on the first completed pass, so `/debug/startup`
      reports that snapshot permanently — this instance froze at 71 valid, 0.35s after a
      pass that had reached 82.

## Release Process

- [ ] Decide the fate of the post-release `-dev` version bump. `RELEASE_CHECKLIST_v1.6.0.md`
      called for it and no release has ever honoured it — either start doing it or drop
      the step.
- [ ] Run the full suite (`npm test`) and `npm run test:coverage` as part of a release.
      v1.8.0 shipped on build + lint + unit tests only.

## Housekeeping

- [ ] Delete the merged `ai/container-uid-config` branch.

---

# Deferred

No owner, no schedule. Listed so the ideas aren't lost, not because they are planned.

## Music Library

- [ ] **In-memory search indexing** — see [LIBRARY_INDEX_PLAN.md](LIBRARY_INDEX_PLAN.md)
      for the measured problem (~57s for a 49,322 track library) and the proposed
      inverted-index/trie design. Aspirational target: <100ms for any library size,
      <10% memory increase, no significant cold-start impact.
- [ ] **Fuzzy matching** — typo-tolerant search
- [ ] **Configurable result limits and ranking**
- [ ] **New search endpoints** — optimized search API with performance metrics

## Music Services

- [ ] **Amazon Music** — blocked: no public API available
- [ ] **Enhanced Spotify search** — better result ranking and relevance
- [ ] **Spotify podcast support** — episodes, shows, episode playback (ref: jishi/node-sonos-http-api#893)
- [ ] **Pandora station discovery** — richer station browsing and recommendations
- [ ] **Additional services** — Deezer, SiriusXM completion, YouTube Music
- [ ] **Last.fm scrobbling** — see [LASTFM_PLAN.md](LASTFM_PLAN.md)

## Real-Time / Events

- [ ] **WebSocket support** — optional WebSocket server for state changes, event-driven,
      backward compatible with existing polling clients. Aspirational target: <50ms
      event latency. Related but distinct: [EVENT_SYSTEM_ENHANCEMENT_PLAN.md](EVENT_SYSTEM_ENHANCEMENT_PLAN.md)
      covers moving from device-based to room-based events.
- [ ] **Home automation integrations** — enhanced webhooks, MQTT, native Home Assistant

## Performance

- [ ] **Connection pooling** — reduce SOAP request overhead
- [ ] **Batch operations** — multiple device updates in parallel
- [ ] **Smart caching** — better strategies for frequently accessed data
- [ ] **Performance monitoring** — built-in metrics and tracking

## Presets & Playlists

- [ ] **Playlist management** — creation, deletion, export/import
- [ ] **Preset validation status in API responses** — a standalone validation script
      shipped in v1.8.0 (`scripts/validate-presets.sh`); this item is about surfacing
      validation state through the API
- [ ] **Advanced preset features** — templates and sharing

## Developer Experience

- [ ] **Enhanced debug tools** — additional diagnostic capabilities
- [ ] **Better error messages** — more descriptive error reporting
- [ ] **Enhanced error recovery** — improved resilience for network and device failures
- [ ] **Extended status information** — additional system health and performance data
- [ ] **Rate limiting improvements** — more flexible configuration

## Speculative

- [ ] **Machine learning features** — smart recommendations, usage analytics, predictive grouping

## From Archived Plans

Recorded in documents under `archive/`, which is intentionally **not** part of the
public repository — those paths exist only in the private GitLab origin, so they are
deliberately unlinked here. The documents are unmaintained; status below has not been
re-verified against the current codebase except where noted.

### SOAP Architecture

Source: `archive/REFACTORING_PLAN.md` — phases 1-2 completed June-July 2025, the rest
never started.

- [ ] **Phase 3: Update API Router** (§ *Phase 3: Update API Router 📅 DEFERRED*, ~line 418)
      — dependency injection for the router
- [ ] **Phase 4: Special Cases** (§ *Phase 4: Special Cases 📅 DEFERRED*, ~line 430)
      — refactoring of the special-case services

### Type Safety

Source: `archive/TYPE_REFACTORING_PLAN.md`,
§ *Remaining Type Safety Tasks from Original Plan* (~line 290).

- [x] ~~**Strict compiler options**~~ — **already done**: `tsconfig.json` sets `strict: true`,
      which implies `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`,
      `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, and
      `alwaysStrict`. The archived doc lists them individually as outstanding; they are not.
- [ ] **SOAP response validation** (high) — runtime type guards for SOAP responses
- [ ] **UPnP event types** (medium) — interfaces for every event type, type-safe parsing,
      proper handler signatures
- [ ] **Configuration validation** (medium) — runtime validation of `settings.json`,
      type guards on config loading, environment variable coercion
- [ ] **XML type safety** (low) — validated parsing and type-safe building

The same document's § *Ranked Type Refactoring Tasks* (~line 10) holds seven ranked
proposals (API response shapes, SonosTrack usage, MediaItem interface, service status,
device information, scheduler tasks, service configuration). Some appear partially
implemented — `ApiResponse<T>` exists in `src/types/sonos.ts` — so treat that list as
a starting point, not a backlog.
