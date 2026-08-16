# Release Checklist for v1.8.2

**Status**: In progress 2026-08-16. Local build and deploy are done; the publish steps
(origin push, tag, GitHub, Docker Hub) are pending user authorization. This is a record
of what was actually run, not a plan. Checked boxes were verified; unchecked ones are
genuinely outstanding.

Not published to GitHub (`.github-exclude` matches `*CHECKLIST*.md`).

Context: emergency patch. 1.8.1's entity-limit work missed the services-cache parser,
every device failed to parse the service list, and Spotify account resolution broke.
The deployed 1.8.1 container was live with the bug, so local deploy came before the
publish steps rather than after.

## 1. Version Number Updates
- [x] Bump version: `./set-version.sh --patch +1` (1.8.1 → 1.8.2)
  - Updates `package.json` and runs `npm run version:save` → `src/version.ts`
- [x] Patch rather than minor: regression fix, no API or contract change.
- [x] Verify in the running API: `curl http://localhost:${PORT}/debug/startup` →
      `"version":"1.8.2"` confirmed on the deployed container

## 2. Release Notes
- [x] `releases/RELEASE_NOTES_1.8.2.md` — covers the regression (cause, invisibility,
      impact), the factory fix, the logging fix, and the dev-tree audit sweep
- [x] Concrete release date, not "TBD"
- [x] No draft file, per the v1.8.0 lesson

## 3. Documentation
- [x] `README.md` — version banner, What's New in v1.8.2 (1.8.1 demoted to history),
      docker run pin, status JSON sample
- [x] `DOCKER.md` — tag list example
- [x] `docker-compose.example.yml` — image pin
- [x] `apidoc/openapi.yaml` — version example
- [x] Sweep for stale version strings: remaining `1.8.1` mentions are all deliberate
      (historical references in What's New and release notes)
- [x] `DOCKERHUB_README.md` — checked, version-agnostic by design, no change needed
- [x] `CLAUDE.md` — no change needed (no build-arg or process changes this release)

## 4. Testing
- [x] `npm run build` — clean (exit 0)
- [x] `npm run lint` — clean (exit 0)
- [x] `npm run test:unit` — 67 pass, 0 fail
- [ ] `npm test` (full suite incl. integration against hardware) — **not run**;
      release executed late at night with speaker traffic explicitly off-limits.
      The docs/TODO.md release-process question ("should releases require the full
      suite?") remains open and this release does not settle it.
- [ ] `npm run test:coverage` — **not run**
- [x] Beyond the suite: live-device verification specific to this fix — the 1.8.1
      parser config fails on a real 53,691-byte service descriptor response
      (`3256 > 1000`), the factory config parses 108 services from the same bytes.
      Error path exercised against unroutable TEST-NET addresses: error-level log
      with per-device causes confirmed.

## 5. Docker Image
- [x] Working tree clean before building (three commits: fix+factory, audit sweep,
      release)
- [x] Rollback available: `kshartman/sonos-alexa-api:1.8.1` remains tagged locally
      (pulled explicitly by digest-verified tag earlier in the day). No separate
      `pre-1.8.2-rollback` tag created.
- [x] `./docker-build.sh` — tags all four names:
      `sonos-alexa-api:{latest,1.8.2}`, `kshartman/sonos-alexa-api:{latest,1.8.2}`
- [x] Image inspected: `User=2128:2128`, `version=1.8.2`, `revision=e7e3d5b`
- [x] Deploy by recreation (`docker compose up -d`, not `docker start`) — container
      recreated on the new image, health green
- [x] Post-deploy smoke test: `Found 108 services from GreatRoomSpeakers` on the first
      device tried, `/services` returns 44,815 bytes (was `{}`), and
      `data/services-cache.json` is back to its pre-regression 58,188 bytes with
      `serviceCount: 108`, owned 2128:2128. Health green, 14 devices, version 1.8.2.

## 6. Git Tagging and Pushing — PENDING AUTHORIZATION
- [x] Commit everything; `git status` clean
- [ ] `git push origin main`
- [ ] `./tag-version.sh` — annotated tag from `package.json`, pushed to origin

## 7. GitHub Release — PENDING AUTHORIZATION
- [ ] `./push-to-github.sh` (dry run) — inspect the filtered tree
- [ ] `./push-to-github.sh --action:execute`
- [ ] `gh release create v1.8.2 --repo kshartman/sonos-alexa-api --title "..."
      --notes-file releases/RELEASE_NOTES_1.8.2.md` — after push-to-github.sh
- Note: `releases/RELEASE_NOTES_1.8.2.md` names the private-repo path `docs/TODO.md`,
  which is public, so the notes are safe to publish as-is.

## 8. Docker Hub — PENDING AUTHORIZATION
- [ ] Update the Hub overview **before** moving `:latest` (v1.8.0 lesson) — though
      `DOCKERHUB_README.md` is unchanged this release, so likely a no-op
- [ ] `docker push kshartman/sonos-alexa-api:1.8.2`
- [ ] `docker push kshartman/sonos-alexa-api:latest`
- [ ] Verify the published digest matches the local image Id

## 9. Control Plane
- [x] No changes to `.claude/settings.json` or `.git/config` this release; no re-sign
      needed.

## 10. Post-Release
- [ ] Confirm the deployed container healthy on the new image after soak
- [ ] Confirm Spotify account resolution works (the user-visible casualty of the
      regression) — requires speaker traffic, deferred to daytime
- [ ] Keep the 1.8.1 image tag until the release has soaked
- [ ] The `-dev` version bump question: still unresolved, still tracked in docs/TODO.md

## Lessons for the next release
- A shared constant is not a shared behaviour. 1.8.1 exported the entity limits and
  trusted eleven call sites to remember them; the one that forgot shipped a silent
  production failure. The factory (`createXmlParser`) makes the compiler enforce what
  review was supposed to catch. When a fix must be applied at N sites, centralize it
  instead.
- A catch that logs at `debug` plus a summary at `warn` turned a total subsystem
  failure into a line indistinguishable from documented benign behaviour. Exhausting
  a fallback loop is an error; log it as one, with causes.
- Verify the release on the machine that runs it: the stale local `node_modules`
  (4.5.3 vs lockfile 4.5.7) meant local builds could not even type-check the shipped
  code until `npm ci`. Run `npm ci` before diagnosing anything.
