# Release and Merge Policy

This document defines when a pull request may be merged, when a release should be created, and how hotfixes and rollbacks should be handled. A green test run is required where applicable, but it is not sufficient by itself.

## Merge gates

A pull request may be merged only when all applicable conditions are satisfied:

1. Required checks pass on the latest commit, not an earlier revision.
2. The pull-request description includes the motivation, related issue, scope, and verification evidence.
3. Verification uses the smallest relevant command. User-interface or route changes also include manual verification.
4. The pull request contains one logical change. Unrelated features and refactors must be separated.
5. Security failures are resolved rather than waived.

This repository does not currently define a workflow under `.github/workflows/`. Until CI is added, the required project check is a local `npm test` run after `npm ci`, with its output summarized in the pull request.

## Protected main branch

Changes must reach `main` through a pull request. Direct pushes are not allowed. The only exception is an emergency repair of a broken `main`, followed by a retrospective issue within 24 hours.

## Versioning

The project follows Semantic Versioning:

- Patch: backward-compatible bug fixes
- Minor: backward-compatible user-facing functionality
- Major: incompatible public API or behavior changes

Before tagging, align the version in `package.json`, `package-lock.json`, and the `/api/info` response. The tag must use the same version with a `v` prefix. At the time of this document update, the latest tag is `v1.5.1` while the source reports `1.5.0`; resolve that drift before creating another release.

Avoid unnecessary minor-version increments. A change is minor only when it adds backward-compatible user-facing functionality.

## Release readiness

Create a release only when all applicable conditions are satisfied:

- The target commit passes `npm test` after a locked dependency installation.
- Package, runtime API, and tag versions agree.
- User-facing changes have concise release notes.
- Deployment, migration, and rollback notes are included when relevant.
- The Docker image can be built for changes that affect deployment.
- No required security check is failing.

Use a release train for routine changes: merge reviewed pull requests, then create a release at a meaningful user-facing milestone or after a reasonable accumulation of fixes. Documentation-only and internal process changes do not require a release.

## Tagging

Tags identify known source revisions and must not be moved.

```bash
npm ci
npm test
git status --short
git tag -a vX.Y.Z -m "vX.Y.Z"
```

Only tag the exact reviewed commit. Publishing the tag and creating a GitHub release are external actions and should be performed by the repository owner or authorized release automation.

## Hotfix flow

1. Create `hotfix/<slug>` from `main`.
2. Open a focused pull request with incident context and verification evidence.
3. Merge it independently after required checks pass.
4. Create a patch release if users need the fix immediately.
5. If deployment fails, restore the last known-good revision first and diagnose afterward.

## Rollback

Prefer a pull request containing `git revert` so history is preserved and normal checks run again. Use the most recent verified release tag as the known-good reference. Record any data or configuration rollback steps in the pull request and release notes.
