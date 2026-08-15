# Release Preparation Checklist for v1.5.0

## 1. Version Number Updates
- [x] Update version in `package.json` to 1.5.0
- [x] Run `npm run version:save` to update src/version.ts
- [x] Verify version shows correctly in API: `curl http://localhost:5005/debug/startup | jq .version`

## 2. Release Notes Preparation
- [x] Finalize `releases/RELEASE_NOTES_1.5.0-draft.md`
  - [x] Update release date from "TBD" to actual date (July 9, 2025)
  - [x] Review all sections for accuracy
  - [x] Ensure all major changes since v1.4.0 are included:
    - [x] Complete TypeScript type safety (eliminated 87 warnings)
    - [x] Pandora architecture overhaul with PandoraStationManager
    - [x] Library index checking for tests
    - [x] HOST_DATA_PATH Docker volume support
    - [x] Enhanced test reliability for remote testing
    - [x] Logger type detection improvements
    - [x] Spotify integration (OAuth2, URL presets, search)
    - [x] Centralized scheduler system
    - [x] Various bug fixes
- [x] Remove draft file (final version already exists as `RELEASE_NOTES_1.5.0.md`)
- [N/A] Update CHANGELOG.md (no CHANGELOG.md exists)

## 3. Documentation Updates
- [x] Update README.md
  - [x] Verify feature list is current
  - [x] Update version badge if applicable
  - [x] Check installation instructions reflect v1.5.0
- [ ] Review and update API.md for new endpoints
- [ ] Verify SPOTIFY.md is complete and accurate
- [ ] Verify PRESETS.md is complete with examples
- [ ] Update IMPLEMENTATION_SUMMARY.md if needed
- [ ] Update ALEXA_COMPATIBILITY.md if needed

## 4. Final Testing Checklist
- [x] Run full test suite: `npm test` (58/60 pass - 2 timing failures on remote, pass locally)
- [x] Verify test coverage: `npm run test:coverage` (94% coverage, above 90% threshold)
- [ ] Test key features manually:
  - [ ] Basic playback controls (play, pause, stop, volume)
  - [ ] Music search (Apple Music, Spotify, Library)
  - [ ] TTS announcements with volume parameter
  - [ ] Preset loading and execution
  - [ ] Pandora station playback and switching
  - [ ] Spotify URL presets
  - [ ] Spotify OAuth flow (if configured)
  - [ ] Group operations
  - [ ] Default room/service functionality
- [ ] Test Docker build locally:
  ```bash
  ./docker-build.sh
  docker run -d --name sonos-test --network host kshartman/sonos-alexa-api:latest
  docker logs -f sonos-test
  # Test API endpoints
  docker stop sonos-test && docker rm sonos-test
  ```
- [ ] Verify health check endpoint: `curl http://localhost:5005/health`
- [ ] Test with different log levels and debug categories
- [ ] Verify all environment variables work correctly

## 5. Docker Image Building and Tagging
- [ ] Ensure working directory is clean: `git status`
- [ ] Build Docker image: `./docker-build.sh`
- [ ] Tag with version number:
  ```bash
  docker tag sonos-alexa-api:latest sonos-alexa-api:v1.5.0
  docker tag sonos-alexa-api:latest kshartman/sonos-alexa-api:v1.5.0
  docker tag sonos-alexa-api:latest kshartman/sonos-alexa-api:latest
  ```
- [ ] Test the tagged image locally:
  ```bash
  docker run -d --name sonos-v150-test --network host kshartman/sonos-alexa-api:v1.5.0
  docker logs -f sonos-v150-test
  # Run basic API tests
  docker stop sonos-v150-test && docker rm sonos-v150-test
  ```

## 6. Git Tagging and Pushing
- [ ] Commit all changes: `git add . && git commit -m "Release v1.5.0"`
- [ ] Create git tag: `git tag -a v1.5.0 -m "Release v1.5.0"`
- [ ] Push commits: `git push origin main`
- [ ] Push tag: `git push origin v1.5.0`

## 7. GitHub Release Creation
- [ ] Go to https://github.com/kshartman/sonos-alexa-api/releases
- [ ] Click "Draft a new release"
- [ ] Select tag: v1.5.0
- [ ] Release title: "v1.5.0 - Spotify Integration & Type Safety Improvements"
- [ ] Copy release notes from `releases/RELEASE_NOTES_1.5.0.md`
- [ ] Attach any relevant assets (if applicable)
- [ ] Publish release

## 8. Docker Hub Publishing Steps
- [ ] Login to Docker Hub: `docker login`
- [ ] Push version tag: `docker push kshartman/sonos-alexa-api:v1.5.0`
- [ ] Push latest tag: `docker push kshartman/sonos-alexa-api:latest`
- [ ] Verify on Docker Hub: https://hub.docker.com/r/kshartman/sonos-alexa-api/tags
- [ ] Update Docker Hub repository description if needed

## 9. Post-Release Tasks
- [ ] Create maintenance branch if needed: `git checkout -b release_1.5.0`
- [ ] Update `package.json` version to 1.5.1-dev on main branch
- [ ] Announce release (if applicable):
  - [ ] GitHub discussions/issues
  - [ ] Reddit/forums if relevant
  - [ ] Update any documentation sites
- [ ] Monitor for immediate issues/feedback
- [ ] Start draft for next release notes: `releases/RELEASE_NOTES_1.5.1-draft.md`

## 10. Verification Steps
- [ ] Pull and test Docker image from Docker Hub:
  ```bash
  docker pull kshartman/sonos-alexa-api:v1.5.0
  docker run -d --name sonos-prod-test --network host kshartman/sonos-alexa-api:v1.5.0
  docker logs -f sonos-prod-test
  # Verify version in logs
  # Test basic functionality
  docker stop sonos-prod-test && docker rm sonos-prod-test
  ```
- [ ] Verify GitHub release page looks correct
- [ ] Check that all documentation links work
- [ ] Confirm upgrade instructions work from v1.4.0

## Notes
- Remember to update release date in release notes before publishing
- Ensure all tests pass before creating release
- Consider creating a release branch for hotfixes if needed
- Keep the draft release notes for v1.5.1 ready for future changes