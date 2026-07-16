# Handoff: t_cb8d169d WebSocket auth migration docs

## Task

Document the WebSocket auth migration from query-string tokens (`?token=`) to
`Authorization: Bearer` header auth, and explain the security rationale and
client migration steps, so a maintainer or client developer can read the docs
and know how to connect, whether a compatibility flag exists, and that
query-string token auth is deprecated/disabled by default. This is the
documentation follow-up to root task t_411bf130 (implementation tracked in
t_48bf6bc1 / t_8e383ccf, tests in t_6ae99933).

## Agent / Date

- Agent: bob-coder
- Role: documentation
- Date: 2026-07-16

## Branch / Worktree

- Branch: `docs-ws-migration`
- Worktree: `/Users/bob/src/metronome`
- Base commit: `7d67445` (main)

## What I Changed

- `README.md`:
  - Updated the highlights bullet to say `METRONOME_API_TOKEN` covers control
    endpoints *and* WebSocket upgrades (previously only mentioned control
    endpoints).
  - Updated the `METRONOME_API_TOKEN` env var row to state it also gates the
    `/ws` WebSocket upgrade.
  - Replaced the one-line "WebSocket messages are documented in `src/state.js`"
    note with a new **WebSocket Authentication** section covering:
    - Default behavior when `METRONOME_API_TOKEN` is unset vs set.
    - That the WS upgrade now requires the same `Authorization: Bearer` header
      as REST, and returns `401` on missing/wrong token.
    - A **Client migration** subsection with before/after code samples showing
      the deprecated `?token=` query-string pattern vs the new header-based
      Node `ws` client pattern.
    - A callout that browser `WebSocket` cannot set custom `Authorization`
      headers, so browser clients should stay on a trusted LAN (no token) or
      terminate auth at a reverse proxy in front of `/ws`.
    - An explicit statement that **no compatibility flag** re-enables
      `?token=` WebSocket auth in the default server path (matches the
      accepted implementation in t_48bf6bc1 — no off-by-default compat flag
      was introduced; the query-token path was removed outright).
- Added this handoff doc.

Doc content mirrors the (currently uncommitted, worktree-local) README diff
already produced by t_48bf6bc1's `metronome-codex` worktree
(`/Users/bob/.hermes/kanban/workspaces/t_48bf6bc1/metronome-codex`), so once
the t_48bf6bc1/t_8e383ccf code changes and this doc change land together on
`main`, the README will already match the shipped behavior.

## Files Changed

```
README.md
docs/handoffs/2026-07-16-t_cb8d169d-ws-auth-docs.md
```

## Commands Run

```
(read-only inspection of the t_48bf6bc1/t_8e383ccf worktrees and diffs to confirm
the actual shipped behavior before documenting it; no test run needed for a
docs-only change)
```

## Results

- lint: n/a (Markdown, no linter configured)
- tests: not run (no code changed)
- typecheck/build: n/a

## Known Issues

- `src/server.js` on `main` still authenticates `/ws` via `?token=` — the
  code change lives uncommitted in the `t_48bf6bc1` worktree
  (`fix/ws-header-auth` branch) and has not been merged yet. This doc change
  documents the *target* behavior (matching what t_48bf6bc1/t_8e383ccf already
  implemented) so docs and code land together; merge order should be
  code-first (or same PR) so the README never describes unreleased behavior
  as current.

## Open Questions

1. Should this doc PR be merged standalone, or bundled with the
   t_48bf6bc1/t_8e383ccf code PRs so `main` never has code/doc drift? Given
   `RELEASING.md`'s "PR = one logical change" rule, recommend bundling into
   whichever PR ships the header-auth code change, or merging this
   immediately after that PR merges.

## Do Not Touch

- `src/server.js`, `test/server.test.js`, `public/app.js`,
  `public/client-utils.js` — owned by t_48bf6bc1 / t_8e383ccf, not touched by
  this doc-only task.

## Recommended Next Step

Merge the t_48bf6bc1 header-auth implementation (and t_8e383ccf client
change) to `main` first, then fast-forward/merge this README update so the
docs match shipped behavior. If code merges first, rebase this branch and
open a PR; otherwise hold this PR until code lands.

## Release Impact

- Version impact: none (docs-only)
- Breaking change: no
- Migration required: no (this *documents* a migration that ships with the
  t_48bf6bc1/t_8e383ccf code change)
