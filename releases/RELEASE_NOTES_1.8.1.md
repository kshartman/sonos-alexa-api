# Release Notes - v1.8.1

**Release Date**: 2026-08-15

## Overview

A security patch. Updates `fast-xml-parser` to clear a critical advisory and four others,
raises the XML entity-expansion ceiling that update introduced (and makes it configurable),
and corrects a log message that reported healthy presets as failures. No API changes and no
change to the container's runtime user.

Upgrading from v1.8.0 requires nothing beyond pulling the image. One new environment
variable, `XML_MAX_ENTITY_EXPANSIONS`, is available but should not need setting.

## Security

### fast-xml-parser 4.5.3 → 4.5.7

`fast-xml-parser` is one of three production dependencies and parses every response from
every Sonos device. Five of six open advisories are cleared, all within the existing `^4`
range — no major version change:

| severity | patched in | issue |
|---|---|---|
| **critical** | 4.5.4 | entity encoding bypass via regex injection in DOCTYPE entity names |
| high | 4.5.4 | DoS through entity expansion in DOCTYPE (no expansion limit) |
| high | 4.5.5 | numeric entity expansion bypasses all expansion limits |
| medium | 4.5.5 | entity expansion limits bypassed when set to zero (falsy check) |
| low | 4.5.4 | XMLBuilder stack overflow with `preserveOrder` |

`package.json` now requires `^4.5.7` rather than `^4.3.2`, so a fresh resolve cannot land
on a vulnerable version.

Because the patches change entity handling, the updated build was run against a live
system before release: 12 devices discovered, 3 zones, topology parsed, health green.
Doing so caught a regression the update introduced — see below.

### XML entity-expansion ceiling (regression fixed before release)

The 4.5.4+ patches cap entity expansions at **1000 per parsed document**. That is far too
low for real Sonos data and it broke music library indexing outright:

```
Music library indexing failed: Entity expansion limit exceeded: 4002 > 1000
```

The failure was silent in the worst way — the server stayed healthy and reported ready,
but `musicLibrary.isComplete` was `false` and library search returned nothing.

Sonos returns DIDL-Lite entity-encoded inside the SOAP `<Result>` element, so an entire
nested XML document arrives as `&lt;...&gt;&quot;` text. Library browse requests 1000
tracks per call, which works out to roughly 8-10 expansions per track — several thousand
per response before any track with unusual punctuation.

The ceiling is now **160000** by default and configurable:

| variable | default | purpose |
|---|---|---|
| `XML_MAX_ENTITY_EXPANSIONS` | `160000` | maximum XML entity expansions per parsed document |

Only that ceiling moved. Entity size, expansion depth, expanded length and entity count
keep their hardened values — those are the controls that stop a billion-laughs attack, and
the limits are now stated explicitly at every parser rather than inherited, because passing
`processEntities` as an object makes fast-xml-parser silently drop the defaults it applies
to the boolean form (expansion depth would have gone from 10 to 10000).

Raise `XML_MAX_ENTITY_EXPANSIONS` if you have a very large library and see
"Entity expansion limit exceeded" with an incomplete index. Verified end to end: a
48,140-track library indexes completely in 19-21 seconds at the default.

### Still open

One moderate advisory remains — XMLBuilder XML comment and CDATA injection via unescaped
delimiters — which is only patched in **5.7.0**, a major version. It is deliberately not
included here:

- The reachable path is `XMLBuilder` building outgoing SOAP bodies (`src/utils/soap.ts`).
  Exploiting it requires an actor who can already call the API on your network, and the
  effect is a malformed SOAP request to your own speaker rather than anything crossing
  outward.
- A major-version change to the library that parses every device response does not belong
  in a patch release.

Tracked in `docs/TODO.md`.

## Fixes

### Preset validation log wording

The startup log reported lines like `Failed favorite resolution: 68`, which reads as 68
broken presets. It never meant that. A preset is counted there when its favorite could not
be resolved at load time — usually because no capable device had been discovered yet — in
which case the `favorite:` URI is deliberately kept and resolved on first use by
`SonosDevice.playUri()`. Those presets play normally.

Verified on a live system: of 68 presets reported as failures, all 68 referenced favorites
that existed at that moment (62 exact matches, 6 after normalisation, 0 missing).

The lines now read:

```
Preset validation complete:
  Resolved at load time: 71
  Deferred to runtime: 68 (favorite resolved on first use)
  Invalid rooms: 0
```

The `failedResolution` stat field in `/debug/startup` is **unchanged**, since
`scripts/analyze-home-content.ts` reads it. Only the human-facing wording changed.

## Known Issues

Preset validation can re-run many times over a session — 504 full passes across 65 minutes
were observed on one instance, at an accelerating rate. Each pass is a full reload
triggered by the preset directory watcher. It is wasteful and it makes the
`/debug/startup` preset counts a snapshot of whichever pass ran last, but it does not
affect playback. Root cause is not yet established, so no speculative fix is included
here. Tracked in `docs/TODO.md`.

Library search matches garbage queries. A search for a nonsense string can return an
unrelated track — `xyzzy12345nonexistent` returns "X" by Ja Rule — because the fuzzy
fallback matches when the *query* starts with a library entry, so any very short title
claims any query sharing its opening characters. Pre-existing, reproduced on 1.7.1, not
introduced here. Two integration tests fail on it. Tracked in `docs/TODO.md` with the
exact mechanism.

## Testing

Integration tests ran for this release, which required fixing the harness first: its
server-startup promise could never settle, so auto-started runs hung indefinitely with no
error. Both bugs are fixed in `test/helpers/server-manager.ts`.

Results: 212 assertions passing. Two failures remain, both from the pre-existing library
search defect above and both reproducible on 1.7.1. The volume suite was excluded by
request and room volumes were pinned low for the run.

## Upgrade

```bash
docker compose pull
docker compose up -d
```
