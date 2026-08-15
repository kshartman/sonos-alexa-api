# Release Preparation Checklist for v1.6.0

## 1. Version Number Updates
- [ ] Update version in `package.json` to 1.6.0
- [ ] Run `npm run version:save` to update src/version.ts
- [ ] Verify version shows correctly in API: `curl http://localhost:5005/debug/startup | jq .version`

## 2. Release Notes Preparation
- [ ] Finalize `releases/RELEASE_NOTES_1.6.0-draft.md`
  - [ ] Update release date from "TBD" to actual date
  - [ ] Review all sections for accuracy
  - [ ] Ensure all major changes since v1.5.0 are included
- [ ] Rename draft to `RELEASE_NOTES_1.6.0.md`
- [ ] Update CHANGELOG.md if it exists

## 3. Documentation Updates
- [ ] Update README.md
  - [ ] Verify feature list is current
  - [ ] Update version references
  - [ ] Check installation instructions reflect v1.6.0
- [ ] Review and update API.md for new endpoints
- [ ] Update any relevant documentation

## 4. Final Testing Checklist
- [ ] Run full test suite: `npm test`
- [ ] Verify test coverage: `npm run test:coverage`
- [ ] Test key features manually
- [ ] Test Docker build locally:
  ```bash
  ./docker-build.sh
  docker run -d --name sonos-test --network host kshartman/sonos-alexa-api:latest
  docker logs -f sonos-test
  # Test API endpoints
  docker stop sonos-test && docker rm sonos-test
  ```
- [ ] Verify health check endpoint: `curl http://localhost:5005/health`

## 5. Docker Image Building and Tagging
- [ ] Ensure working directory is clean: `git status`
- [ ] Build Docker image: `./docker-build.sh`
- [ ] Tag with version number:
  ```bash
  docker tag sonos-alexa-api:latest sonos-alexa-api:v1.6.0
  docker tag sonos-alexa-api:latest kshartman/sonos-alexa-api:v1.6.0
  docker tag sonos-alexa-api:latest kshartman/sonos-alexa-api:latest
  ```
- [ ] Test the tagged image locally

## 6. Git Tagging and Pushing
- [ ] Commit all changes: `git add . && git commit -m "Release v1.6.0"`
- [ ] Create git tag: `git tag -a v1.6.0 -m "Release v1.6.0 - [Main Feature]"`
- [ ] Push commits: `git push origin main`
- [ ] Push tag: `git push origin v1.6.0`

## 7. GitHub Release Creation
- [ ] Go to https://github.com/kshartman/sonos-alexa-api/releases
- [ ] Click "Draft a new release"
- [ ] Select tag: v1.6.0
- [ ] Release title: "v1.6.0 - [Title TBD]"
- [ ] Copy release notes from `releases/RELEASE_NOTES_1.6.0.md`
- [ ] Publish release

## 8. Docker Hub Publishing
- [ ] Login to Docker Hub: `docker login`
- [ ] Push version tag: `docker push kshartman/sonos-alexa-api:v1.6.0`
- [ ] Push latest tag: `docker push kshartman/sonos-alexa-api:latest`
- [ ] Verify on Docker Hub: https://hub.docker.com/r/kshartman/sonos-alexa-api/tags

## 9. Post-Release Tasks
- [ ] Update `package.json` version to 1.7.0-dev on main branch
- [ ] Monitor for immediate issues/feedback
- [ ] Start draft for next release notes: `releases/RELEASE_NOTES_1.7.0-draft.md`

## Notes
- Remember to update release date in release notes before publishing
- Ensure all tests pass before creating release
- Keep the draft release notes for v1.7.0 ready for future changes