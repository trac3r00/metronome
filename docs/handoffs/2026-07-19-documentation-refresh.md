# Handoff: Official Documentation Refresh

## Task

Rewrite the repository README and correct stale documentation so installation, operation, configuration, API, architecture, development, and release guidance match the current source.

## Agent and date

- Agent: Codex
- Role: implementer
- Date: 2026-07-19

## Branch and worktree

- Branch: `docs/professional-refresh`
- Worktree: repository root
- Base commit: `e45f169c816bfb60e763f308572fc0b931a57551`
- Current commit: `e45f169c816bfb60e763f308572fc0b931a57551` (documentation changes are uncommitted)

## Changes

- Replaced the README with a concise, source-backed project guide.
- Added verified overview, features, architecture, installation, usage, API, configuration, authentication, development, structure, deployment, and license sections.
- Added only the Node.js requirement badge; no CI or license badge was added because neither is present in the repository.
- Replaced the placeholder health report with a dated assessment based on current code and repository metadata.
- Translated and corrected the release policy, including the absence of CI and the current version drift.
- Replaced a stale WebSocket migration handoff with a resolved historical record and removed obsolete local-worktree details.

## Files changed

```text
README.md
docs/HEALTH_REPORT.md
docs/RELEASING.md
docs/handoffs/2026-07-16-t_cb8d169d-ws-auth-docs.md
docs/handoffs/2026-07-19-documentation-refresh.md
```

## Commands run

```bash
git status --short --branch
codegraph explore "repository architecture, entry points, installation, usage commands, configuration variables, tests, and documentation-relevant public features"
rg --files
git log -5 --oneline --decorate
git remote -v
git tag --sort=-version:refname
node --version
npm --version
npm test
npm ci
node --test test/audio.test.js test/client.test.js test/rate-limiter.test.js test/state.test.js
git diff --check
```

Additional source checks compared every README endpoint and environment variable with `src/server.js` and `docker-compose.yml`, checked Markdown fence balance, searched for stale phrases and non-English Korean text, and confirmed that every modified path is within the allowed documentation scope.

## Results

- Documentation source checks: passed.
- `git diff --check`: passed.
- Dependency-free tests: 38 passed, 0 failed.
- Full `npm test`: not completed because dependencies were absent.
- `npm ci`: blocked because the environment could not resolve `registry.npmjs.org`.
- Build, lint, and type-check: not applicable; no corresponding package scripts exist.
- Live server QA: not available because Express and `better-sqlite3` could not be installed in the network-restricted environment.

## Known issues

- The latest Git tag is `v1.5.1`, but `package.json`, `package-lock.json`, and `/api/info` report `1.5.0`.
- No workflow exists under `.github/workflows/`.
- No project license is declared.
- The bundled browser client cannot authenticate its own requests when `METRONOME_API_TOKEN` is enabled; the README now documents the required deployment topology.

## Open questions

1. Which license, if any, does the repository owner want to apply?
2. Should the next implementation change align all version sources to `1.5.1` or advance them to a new release version?

## Do not touch

- No source code, tests, workflows, package metadata, dependencies, container configuration, or other runtime files were changed for this task.

## Recommended next step

In a network-enabled environment, run `npm ci && npm test`, start the server with `npm start`, and manually confirm the stage, settings, `/healthz`, one REST write, and one WebSocket synchronization flow before merging the documentation pull request.

## Release impact

- Version impact: none
- Breaking change: no
- Migration required: no
- Changelog: not required for this documentation-only change
- Rollback: revert the documentation pull request
