# Release Notes - v1.8.2

**Release Date**: 2026-08-16

## Overview

Fixes a regression introduced by the 1.8.1 security update: the music services cache
failed to parse on every device and came back empty, which broke Spotify account
resolution. No API changes, no configuration changes, no change to the container's
runtime user. If you run 1.8.1, upgrade.

## The Regression

1.8.1 updated `fast-xml-parser` to 4.5.7, whose security patches cap XML entity
expansions at 1000 per parsed document. The release raised that ceiling through shared
`processEntities` limits wired into each XML parser by hand — and missed exactly one of
the eleven construction sites: the services cache parser.

That parser therefore kept the library default of 1000, and the Sonos service
descriptor list needs about 3256 expansions. Every device failed identically:

```
Entity expansion limit exceeded: 3256 > 1000
```

The failure was invisible at default log level. The per-device error was caught and
logged at `debug`, and the only visible output was:

```
warn:  No services found from any device
info:  Services cache refreshed successfully with 0 services
```

— a warning that reads like the documented S2 empty-accounts behaviour, followed by a
success message. `/services` returned `{}` and `data/services-cache.json` went from 108
services to none.

**Impact**: Spotify account resolution throws `Spotify service not found in Sonos
system. Please add Spotify in the Sonos app.` — a misleading message; nothing was wrong
with the Sonos configuration. Apple Music (hardcoded account), Pandora (own station
manager), the music library, presets, and playback were unaffected.

## The Fix

Two parts, because the second is what let the first ship.

### Parser factory

Instead of re-adding the limits to the missed site, parser construction is centralized:
`createXmlParser()` in `src/utils/xml-entity-limits.ts` is now the only way to build an
XML parser. The shared `processEntities` limits are no longer exported, and the
factory's option type excludes them, so a construction site cannot forget or override
the limits — the compiler rejects the attempt. All eleven sites were migrated with
their site-specific options preserved.

Verified against a live system: the shipped 1.8.1 code fails on a real 53 KB service
descriptor response; the factory-built parser returns all 108 services from the same
bytes.

### Honest failure logging

A services refresh that exhausts every device now logs at `error` with the per-device
causes attached, instead of a bare `warn`. And the refresh no longer logs "refreshed
successfully" when the cache is empty. A single device failing remains `debug` — that
is the fallback loop doing its job.

## Also In This Release

Seven dev-dependency advisories cleared via `npm audit fix` (`brace-expansion`,
`js-yaml`, `picomatch`, `minimatch`, `flatted`, `ajv`, `@eslint/plugin-kit`) — all
transitive through lint and test tooling, none in the production tree, no breaking
changes.

The full `npm audit` across both trees now reports a single moderate advisory: the
XMLBuilder comment/CDATA injection deferred in 1.8.1, which requires a major version
bump and remains tracked in `docs/TODO.md`.

## Testing

- Build and lint clean; 67/67 unit tests passing.
- Live-device verification of both the old and new parser configurations: the old
  config reproduces the production failure byte-for-byte, the new config parses 108
  services.
- The exhausted-all-devices error path exercised against unroutable addresses:
  error-level log with per-device causes confirmed.

## Upgrade

```bash
docker compose pull
docker compose up -d
```

After startup, `curl http://localhost:5005/services` should return a populated object
rather than `{}`, and the log should show `Found N services from <room>`.
