# Release Checklist for v1.8.0

**Status**: Completed 2026-08-15, except where marked. This is a record of what was
actually run, not a plan — it doubles as the template for v1.9.0. Checked boxes were
verified; unchecked ones were genuinely skipped.

Not published to GitHub (`.github-exclude` matches `*CHECKLIST*.md`).

## 1. Version Number Updates
- [x] Bump version: `./set-version.sh --minor +1 --patch 0` (1.7.1 → 1.8.0)
  - Updates `package.json` and runs `npm run version:save` → `src/version.ts`
- [x] Verify in the running API: `curl http://localhost:${PORT}/debug/startup` → `"version":"1.8.0"`
- Minor rather than patch: the published image's runtime uid/gid changed, which is
  visible to anyone who bind-mounts a data directory.

## 2. Release Notes
- [x] Write `releases/RELEASE_NOTES_1.8.0.md` covering every commit since the previous tag
  - `git log --oneline v1.7.1..HEAD` — seven commits were unreleased
- [x] Concrete release date, not "TBD"
- [x] Lead with the breaking change (container uid/gid) and give the user two remedies
- [x] Record documentation corrections, with the release that first made the wrong claim
- No draft file. The v1.7.0 "draft" was a wishlist of unbuilt features in release-notes
  format; it became `docs/TODO.md`. Do not start a `-draft.md` for the next release.

## 3. Documentation
- [x] `README.md` — version banner, What's New, install pin, status JSON sample
- [x] `DOCKER.md` — build args, Container User section, Architecture section, tag list
- [x] `DOCKERHUB_README.md` — runtime uid, `/app/data`, architecture
- [x] `docker-compose.example.yml` — image pin, commented `user:` line
- [x] `apidoc/openapi.yaml` — version example
- [x] `CLAUDE.md` — build args in the release process
- [x] Sweep for stale version strings across `*.md`, `*.yml`, `*.yaml`, `*.json`
  - README had been advertising 1.6.0 for two releases; check every file type, not just `.md`
- [x] Verify all relative markdown links resolve, and that none point at paths
  `.github-exclude` strips (`archive/` links 404 on the public mirror)

## 4. Testing
- [x] `npm run build` — clean
- [x] `npm run lint` — clean
- [x] `npm run test:unit` — 14 pass, 0 fail
- [ ] `npm test` (full suite incl. integration against hardware) — **not run**
- [ ] `npm run test:coverage` — **not run**
- [x] Docker build verified at both `APP_UID=2128` and the `1000` default, checking
      `id` and `/app/data` ownership inside each image

## 5. Docker Image
- [x] Working tree clean before building
- [x] Tag the outgoing image for rollback first:
      `docker tag <current-id> sonos-alexa-api:pre-1.8.0-rollback`
- [x] `./docker-build.sh` — tags all four names in one build:
      `sonos-alexa-api:{latest,1.8.0}` and `kshartman/sonos-alexa-api:{latest,1.8.0}`
  - Manual `docker tag` steps from the v1.6.0 checklist are obsolete
  - Note the tags are `1.8.0`, **not** `v1.8.0` — the git tag carries the `v`, the image does not
- [x] Deploy and smoke-test: `docker compose up -d`, then verify health, `id`
      (`uid=2128(sonos) gid=2128(sonos)`), and a real write into `/app/data`
  - `docker start` is **not** sufficient — an existing container stays bound to its old
    image and baked `USER`; the container must be recreated

## 6. Git Tagging and Pushing
- [x] Commit everything; confirm `git status` is clean
- [x] `git push origin main`
- [x] `./tag-version.sh` — creates the annotated tag from `package.json` and pushes it
      (refuses to run with uncommitted changes)

## 7. GitHub Release
- [x] `./push-to-github.sh` (dry run) — inspect the filtered tree first
  - Confirm `archive/`, `private/`, `.claude/`, `CLAUDE.md` are stripped
  - Confirm any *new* doc is meant to be public — `docs/TODO.md` is
- [x] `./push-to-github.sh --action:execute` — force-pushes the filtered mirror and tags
- [x] `gh release create v1.8.0 --repo kshartman/sonos-alexa-api --title "..." --notes-file releases/RELEASE_NOTES_1.8.0.md`
  - The web UI steps in the v1.6.0 checklist are unnecessary; `gh` is authenticated
  - Must run **after** `push-to-github.sh`, since that is what puts the tag on GitHub

## 8. Docker Hub
- [x] `docker push kshartman/sonos-alexa-api:1.8.0`
- [x] `docker push kshartman/sonos-alexa-api:latest`
- [x] Verify the published digest matches the local image:
      `docker manifest inspect …:1.8.0` config digest == `docker image inspect …:1.8.0` Id
- [x] Paste `DOCKERHUB_README.md` into the Hub overview at
      https://hub.docker.com/repository/docker/kshartman/sonos-alexa-api/general
  - Verified live by fetching `/v2/repositories/kshartman/sonos-alexa-api/` and checking
    `full_description` for the uid and architecture lines
  - Do this *before* moving `:latest` next time. The overview is the only place a puller
    sees the uid change, and it was stale while the new image was already live.
  - Manual step: `docker push` cannot set it and `gh` is the wrong service. Automating it
    needs a Docker Hub PAT and a `PATCH /v2/repositories/{ns}/{repo}/` call.

## 9. Control Plane (new this release)
- [x] Re-sign the repo after any change to `.claude/settings.json` or `.git/config`:
      `~/.claude/hooks/safe-pipeline manifest .` then the `ssh-keygen -Y sign` command
- [x] `~/.claude/hooks/safe-pipeline verify-trust .` → `signed`
- Batch control-plane edits: every change costs a passphrase prompt. A `git checkout`
  that swaps those files revokes trust until you switch back.

## 10. Post-Release
- [ ] Bump `package.json` to a `-dev` version — **not done**, and not done in prior
      releases either. Drop this step or start honouring it.
- [x] Confirm the deployed container is healthy on the new image
- [x] Keep the rollback tag until the release has soaked

## Lessons for v1.9.0
- Check `.gitignore` patterns are anchored. An unanchored `settings.json` was matching
  `.claude/settings.json`; `/archive/` was ignoring a directory whose files were all tracked.
- Verify negative claims with a positive control before writing them into docs. The
  multi-architecture claim survived six releases because nobody checked the manifest.
- A version bump invalidates the Docker dependency layer, so the first build after
  `set-version.sh` is slow. Budget for it rather than assuming a hang.
