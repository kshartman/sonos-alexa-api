# Archive

Documents and scripts kept for the record, not as current guidance. Nothing here
is maintained, and statements about the codebase may no longer hold. Do not treat
these as a description of how the system works today — read the source, or the
active documents in `docs/`.

This directory is listed in `.github-exclude`, so its contents are not published
to the public GitHub repository.

## Contents

| Item | What it is |
|---|---|
| `ALEXA_COMPATIBILITY.md` | Analysis of compatibility with the legacy echo-sonos Alexa skill. |
| `FEATURE_SPOTIFY.md` | Analysis of the legacy system's Spotify implementation, written to guide the integration that has since shipped. |
| `PANDORA_PLAN.md` | Plan for fixing SOAP 501 errors on Pandora station switching. The resulting algorithm is documented in `CLAUDE.md`. |
| `fix-presets.js` | One-off preset repair script. |
| `REFACTORING_PLAN.md` | SOAP architecture refactoring. Phases 1-2 completed (June-July 2025); phases 3-4 were deferred and never started. |
| `TYPE_REFACTORING_PLAN.md` | Type safety analysis. Contains both a record of completed improvements and ranked proposals that were never fully worked through. |
| `RELEASE_CHECKLIST_v1.5.0.md` | Process checklist for the v1.5.0 release. |
| `RELEASE_CHECKLIST_v1.6.0.md` | Process checklist for the v1.6.0 release. Its unchecked boxes reflect an abandoned process, not outstanding work. |

The last four were moved here in v1.8.0.

## Still active

- `docs/TEST_PLAN.md` — describes the current test suite
- `docs/LASTFM_PLAN.md`, `docs/LIBRARY_INDEX_PLAN.md`, `docs/EVENT_SYSTEM_ENHANCEMENT_PLAN.md` — designs for work not yet built
- `docs/TODO.md` — open work: Active (real) and Deferred (unscheduled ideas)
- `releases/` — release notes for shipped versions
