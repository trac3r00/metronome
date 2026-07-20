# Project Health Report: Metronome

Last updated: 2026-07-19

## Executive summary

The repository is a compact Node.js application with clear runtime boundaries, persistent SQLite state, and a substantial automated test suite. The main operational gaps are the absence of CI, release metadata drift, and the absence of a declared project license. No rebuild is indicated; targeted maintenance is appropriate.

## Project map

| Area | Current implementation |
| --- | --- |
| Runtime | Node.js 20 or later, ES modules |
| Server | Express HTTP server and `ws` WebSocket server in `src/server.js` |
| Client | Vanilla JavaScript PWA in `public/` |
| Persistence | `better-sqlite3`; default path `data/metronome.sqlite` |
| Package manager | npm with `package-lock.json` |
| Start command | `npm start` |
| Test command | `npm test` |
| Container deployment | `docker compose up --build -d` |
| Health check | `GET /healthz` |

## Strengths

- Shared state validation is centralized in `src/state.js`.
- SQLite writes and schema migration logic are isolated in `src/store.js`.
- HTTP, WebSocket, persistence, client helper, audio scheduler, and rate-limit behavior have automated coverage under `test/`.
- Mutating HTTP routes and WebSocket messages are rate-limited.
- Optional token authentication covers mutating HTTP routes and WebSocket upgrades.
- The container defines a health check and persists its database through a named volume.
- The PWA caches its application shell and supports reconnecting WebSocket clients.

## Gaps and risks

| Area | Risk | Evidence | Recommended action |
| --- | --- | --- | --- |
| Continuous integration | Tests are not automatically enforced in this repository. | No files exist under `.github/workflows/`. | Add a Node.js test workflow before treating pull-request checks as a merge gate. |
| Release metadata | The latest Git tag is `v1.5.1`, while `package.json`, `package-lock.json`, and `/api/info` report `1.5.0`. | Tag and source inspection at `e45f169`. | Choose one release version and update all version sources together before the next tag. |
| Licensing | Reuse terms are undefined. | No license file and no project `license` field in `package.json`. | Add an owner-approved license before public redistribution is encouraged. |
| Browser authentication | Enabling `METRONOME_API_TOKEN` prevents the bundled browser client from authenticating its WebSocket and write requests by itself. | `public/app.js` uses browser `WebSocket` and unauthenticated `fetch`; `src/server.js` requires the header. | Keep tokenless deployments on a trusted network or use a reverse proxy that authenticates clients and injects the backend header. |
| Public read surface | Read APIs and SSE are unauthenticated, and CORS allows every origin. | Global CORS middleware and public `GET` routes in `src/server.js`. | Restrict access at the network or reverse-proxy layer when state must not be public. |
| Quality automation | No lint, formatting, build, or type-check command is defined. | `package.json` contains only `start` and `test`. | Add tooling only if the maintenance benefit justifies the additional project surface. |
| Rate-limit lifecycle | Per-IP HTTP limiter entries are retained for the server process lifetime. | `createHttpRateLimiter` stores limiters in an unpruned `Map`. | Add expiry or bounded storage if the service will receive traffic from many distinct addresses. |

## Recommended plan

1. Align package, API, and Git tag version metadata before the next release.
2. Add CI that runs `npm ci` and `npm test` on supported Node.js versions.
3. Select and add a project license.
4. Document and test the intended reverse-proxy authentication topology if deployments will leave a trusted LAN.
5. Reassess rate-limiter storage if the expected network scope expands.

## Rebuild assessment

Decision: no rebuild.

The application has a small, understandable module graph and isolated server, validation, persistence, and browser responsibilities. The identified risks can be handled incrementally without replacing the architecture.

## Evidence

Repository state inspected at commit `e45f169c816bfb60e763f308572fc0b931a57551`.

```text
node --version          # v26.5.0 (satisfies the declared >=20 requirement)
npm --version           # 11.17.0
npm ci                  # blocked: registry.npmjs.org could not be resolved in the audit environment
npm test                # full suite unavailable because dependencies could not be installed
node --test test/audio.test.js test/client.test.js test/rate-limiter.test.js test/state.test.js
                        # dependency-free subset: 38 passed, 0 failed
git tag --sort=-version:refname
git ls-files
```
