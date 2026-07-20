# Handoff: WebSocket Authentication Migration Documentation

## Task

Document the migration from query-string WebSocket tokens to `Authorization: Bearer` header authentication, including the security rationale and client compatibility constraints.

## Agent and date

- Role: documentation
- Date: 2026-07-16

## Outcome

The documentation was updated to explain that:

- `METRONOME_API_TOKEN` protects mutating HTTP routes and the `/ws` upgrade.
- WebSocket query-string tokens are not accepted.
- Node.js clients using `ws` can set the required upgrade header.
- Browser `WebSocket` cannot set a custom `Authorization` header.
- No compatibility setting restores query-string token authentication.

The corresponding server implementation was later merged in commit `e45f169c816bfb60e763f308572fc0b931a57551`. The migration is complete in the current source.

## Files documented

```text
README.md
src/server.js
test/server.test.js
```

## Verification status

- The current server authenticates `/ws` from the `Authorization` request header.
- Missing or incorrect credentials receive HTTP 401 during the upgrade.
- Tests cover valid credentials, invalid credentials, and rejected query-string tokens.

## Remaining constraint

The bundled browser client cannot provide the backend token itself. A token-enabled deployment that serves the bundled UI requires a reverse proxy that both authenticates clients and satisfies the backend header requirement, or it must keep `METRONOME_API_TOKEN` unset on a trusted network.

## Release impact

- Documentation change: none
- Underlying authentication change: potentially breaking for custom WebSocket clients that used query-string tokens
- Migration: move the token to the WebSocket upgrade `Authorization` header
