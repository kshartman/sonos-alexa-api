# Release Notes - v1.8.1

**Release Date**: 2026-08-15

## Overview

A security patch. Updates `fast-xml-parser` to clear a critical advisory and four others,
and corrects a log message that reported healthy presets as failures. No API changes, no
configuration changes, and no change to the container's runtime user.

Upgrading from v1.8.0 requires nothing beyond pulling the image.

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

## Upgrade

```bash
docker compose pull
docker compose up -d
```
