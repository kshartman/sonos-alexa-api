# Release Notes - v1.8.0

**Release Date**: August 15, 2026

## Overview

Version 1.8.0 makes the container's runtime user configurable at build time, adds a preset validation script, and removes a configuration knob that never did anything. There are no API changes.

## ⚠️ Container User Change - Action May Be Required

The runtime user of the published image has changed.

| | Before (≤ v1.7.1) | v1.8.0 |
|---|---|---|
| uid | 1001 | 2128 |
| gid | 65533 (`nogroup`) | 2128 |

The old gid was a bug: the image created a group at 1001 but `adduser` was called without `-G`, so the account landed in `nogroup` and the image's `chown -R` group bits never applied to the running process.

**If you bind-mount a data directory**, its ownership must match, or the container cannot write tokens, TTS cache, or the library index. Two options:

```bash
# Option 1: chown the host directory
sudo chown -R 2128:2128 /path/to/your/data
```

```yaml
# Option 2: override the runtime user in compose, no rebuild needed
services:
  sonos-api:
    image: kshartman/sonos-alexa-api:latest
    user: "1001:1001"    # or whatever your data directory already uses
```

Check what an image uses with `docker inspect --format '{{.Config.User}}' <image>`.

## New Features

### 🐳 Configurable Container User

- [x] **`APP_UID` / `APP_GID` build args** - set the runtime uid/gid at build time (default `1000:1000`)
- [x] **Reuses existing accounts** - if the ids already exist in the base image (uid 1000 is `node` in `node:22-alpine`), the build reuses that account instead of failing
- [x] **Numeric ids throughout** - `USER` and every `COPY --chown` / `chown -R` site use the ids directly, so a runtime `user:` override behaves predictably
- [x] **Build scripts honor the environment** - `docker-build.sh` and `docker-build-local.sh` read `APP_UID`/`APP_GID`, defaulting to `2128:2128`, and echo the runtime user in the build banner
- [x] **Correct group membership** - the account is now created in its own group rather than `nogroup`

Build for a different user without editing anything:

```bash
APP_UID=1000 APP_GID=1000 ./docker-build.sh
```

### ✅ Preset Validation Script

- [x] **`scripts/validate-presets.sh`** - validates presets between the Docker mount and the private preset repo
- [x] Checks that symlinks resolve to existing files in both locations
- [x] Checks that presets reference valid Sonos favorite URIs
- [x] Reports content mismatches and files present in only one location
- [x] Detects the instance from the short hostname

## Improvements

- [x] **`push-to-github.sh` dry run is genuinely the default** - previously the documented default and the actual behavior disagreed
- [x] **Internal documentation refreshed** - architecture overview replacing a stale file tree, git remote workflow, and the preset sync procedure
- [x] **`docs/WISHLIST.md`** - replaces `releases/RELEASE_NOTES_1.7.0-draft.md`, which listed unbuilt features in a format that read like shipped ones

## Documentation Corrections

- [x] **Architecture support was overstated** - `DOCKER.md` and the Docker Hub overview advertised amd64, arm64, and arm/v7. The published image has only ever been a single `linux/amd64` manifest; there is no manifest list, and the build scripts do a plain `docker build` with no `buildx`. The docs now say amd64 only, and note that arm64 builds fine from source but is not published by choice. First claimed in v1.2.0.
- [x] **Cache location** - docs said caches live inside the container. Everything written goes under `/app/data`, which is the bind mount if you have one.

## Removed

- [x] **`CACHE_DIR` environment variable** - it was parsed into `config.cacheDir` and never read by anything. No functional change; it simply stops appearing in the startup env-override list. Remove it from your `.env` if set.
- [x] **`/app/tts-cache` and `/app/music-library-cache`** - unused directories created in the image. Both caches have always resolved under `/app/data` (the bind mount) at runtime, and are still created there automatically.

## Breaking Changes

- Runtime uid/gid of the published image (see above). Host data directory ownership may need updating.
- `CACHE_DIR` is no longer recognized. Since it was never consumed, no behavior changes.

## Upgrade

```bash
docker compose pull
docker compose up -d
```

Then verify the container can write its data directory:

```bash
docker exec sonos-alexa-api touch /app/data/.write-test && \
  docker exec sonos-alexa-api rm /app/data/.write-test && echo "writable"
```
