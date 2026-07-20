# Metronome

> A self-hosted progressive web app for keeping multiple metronome clients synchronized.

![Node.js 20+](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)

## Overview

Metronome provides a shared tempo, meter, playback state, presets, and audio settings to browsers connected to the same server. The Node.js server persists room state in SQLite and distributes updates over WebSockets; each browser generates its own click track with the Web Audio API.

The application was designed for production and broadcast teams that need several devices to follow the same metronome state on a trusted network. It also exposes REST and server-sent event (SSE) interfaces for external controllers and displays.

## Features

- Synchronized BPM, meter, and playback state across connected browsers
- BPM range from 30 to 300, tap tempo, and `4/4`, `3/4`, or `6/8` meters
- Slider, dial, wheel, and tap tempo control styles
- Ten synthesized click sounds with volume and preview controls
- Persistent presets with create, edit, reorder, and delete operations
- Auto, light, and dark themes
- Optional background playback while the page is hidden
- Share links through the system share sheet, clipboard, or an on-demand QR code
- Installable PWA shell with service-worker caching and local controls when offline
- REST control API, SSE updates, and a health endpoint
- Optional Bearer authentication for mutating HTTP routes and WebSocket upgrades
- Per-connection WebSocket and per-IP mutating HTTP rate limits

## Architecture

```text
External controllers  ---- REST requests ----+
    and displays      <----- SSE events ------|
                                             |
Browser PWA  <------- WebSocket state ------>+--- Node.js server
    |                                             Express + ws
    +-- Web Audio click scheduler                    |
    +-- Service worker cache                         +--- SQLite database
```

The server is the source of truth for shared state. Browsers send control messages such as `set_bpm` or `set_playing`; the server validates, persists, and broadcasts the resulting state. Audio is not streamed by the server. Each browser schedules its own sounds against `AudioContext.currentTime`, using a Web Worker when available.

## Requirements

- Node.js 20 or later
- npm
- Docker with Docker Compose, if running the containerized deployment

## Installation

### Local installation

```bash
git clone https://github.com/trac3r00/metronome.git
cd metronome
npm ci
npm start
```

Open <http://localhost:3000>. The server creates `data/metronome.sqlite` on first start.

### Docker Compose

```bash
git clone https://github.com/trac3r00/metronome.git
cd metronome
docker compose up --build -d
curl -fsS http://localhost:3000/healthz
```

The Compose deployment publishes port `3000` and stores the SQLite database in the `metronome-data` volume. To publish a different host port:

```bash
METRONOME_PORT=8080 docker compose up --build -d
```

## Usage

On the main stage:

- Use the step buttons or the selected tempo control to set BPM.
- Select `4/4`, `3/4`, or `6/8` to change the meter.
- Select **TAP** repeatedly to derive a tempo.
- Select **START** or **STOP** to change playback for all connected clients.
- Select a preset to apply its BPM and meter.
- Open **Settings** to manage presets, controls, sound, volume, background audio, and theme.
- Open **Share** to copy the room URL, use the system share sheet, or display a QR code.

Browsers may require a pointer or keyboard interaction before allowing audio playback. Offline changes remain local to that browser and are not persisted or replayed when the connection returns.

### Keyboard shortcuts

Shortcuts are enabled on viewports at least 1440 pixels wide and are ignored while an input, select, or text area has focus.

| Key | Action |
| --- | --- |
| `Space` | Start or stop playback |
| `Up` / `Down` | Change BPM by 1 |
| `Shift` + `Up` / `Down` | Change BPM by 5 |
| `T` | Tap tempo |
| `1`, `2`, `3` | Select `4/4`, `3/4`, or `6/8` |

### HTTP API

Read endpoints are public. Mutating endpoints require a valid `Authorization` header only when `METRONOME_API_TOKEN` is configured.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/healthz` | Report application and SQLite store health |
| `GET` | `/api/info` | Report version, supported values, endpoint map, and auth status |
| `GET` | `/api/state` | Return the current shared room state |
| `GET` | `/api/settings` | Return settings and persistent presets |
| `GET` | `/api/presets` | Return persistent presets |
| `GET` | `/api/events` | Stream initial and subsequent `state`, `settings`, and `presets` SSE events |
| `POST` | `/api/control` | Apply a supported state message |
| `PUT` | `/api/settings` | Update supported settings fields |
| `POST` | `/api/presets` | Create a preset |
| `PATCH` | `/api/presets/:id` | Update a preset |
| `DELETE` | `/api/presets/:id` | Delete a preset |
| `POST` | `/api/presets/reorder` | Reorder all presets using an `ids` array |

Start playback through the control API:

```bash
curl --request POST http://localhost:3000/api/control \
  --header 'Content-Type: application/json' \
  --data '{"type":"set_playing","playing":true}'
```

Set the tempo and subscribe to state changes:

```bash
curl --request POST http://localhost:3000/api/control \
  --header 'Content-Type: application/json' \
  --data '{"type":"set_bpm","bpm":140}'

curl --no-buffer http://localhost:3000/api/events
```

`POST /api/control` accepts the message types implemented in `src/state.js`: `set_bpm`, `set_meter`, `set_playing`, `toggle_playing`, `apply_preset`, `load_preset`, and `overwrite_preset`. Values are validated against the supported BPM, meter, and preset-slot ranges.

## Configuration

The server reads configuration from environment variables at startup.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP and WebSocket listening port |
| `HOST` | `0.0.0.0` | Server bind address |
| `METRONOME_DB_PATH` | `./data/metronome.sqlite` | SQLite database path, resolved from the current working directory by default |
| `METRONOME_API_TOKEN` | Unset | Token required by mutating HTTP routes and the `/ws` upgrade |

`docker-compose.yml` additionally reads `METRONOME_PORT`, which controls the published host port and defaults to `3000`. Inside the container, the server always listens on port `3000` and stores data at `/app/data/metronome.sqlite`.

### Authentication

When `METRONOME_API_TOKEN` is set, send it as a Bearer token:

```bash
curl --request POST http://localhost:3000/api/control \
  --header 'Authorization: Bearer replace-with-your-token' \
  --header 'Content-Type: application/json' \
  --data '{"type":"set_bpm","bpm":140}'
```

The same header is required during the WebSocket upgrade. Node.js clients using the `ws` package can provide it:

```js
import WebSocket from "ws";

const socket = new WebSocket("ws://localhost:3000/ws", {
  headers: { Authorization: "Bearer replace-with-your-token" },
});
```

Browser `WebSocket` does not support custom `Authorization` headers, and the bundled browser client does not attach the API token to HTTP writes. Consequently, enabling `METRONOME_API_TOKEN` prevents the bundled UI from establishing its normal authenticated control channel unless a reverse proxy injects the matching backend header. For the bundled UI, either keep the application on a trusted network without this token or enforce client authentication at a reverse proxy and configure that proxy to satisfy the backend authentication requirement.

Tokens in a WebSocket query string are not accepted. All read endpoints, including the SSE stream, remain public when the token is enabled. The server also sends `Access-Control-Allow-Origin: *`, so deployments exposed beyond a trusted network should apply appropriate reverse-proxy access controls.

## Development

Install the locked dependencies and run the Node.js test suite:

```bash
npm ci
npm test
```

There is no separate build, lint, or type-check script. The server runs the source files directly:

```bash
npm start
```

Tests use the built-in `node:test` runner and cover server routes, WebSocket synchronization and authentication, persistence, validation, rate limiting, client helpers, and audio scheduling.

## Project structure

```text
src/                 Express/WebSocket server, state validation, rate limiting, and SQLite storage
public/              Browser PWA, audio scheduler, service worker, styles, and static assets
test/                Node.js test suite
docs/                Project health, release policy, ADR template, and handoff records
Dockerfile           Production container image
docker-compose.yml   Local or NAS-oriented container deployment
```

For a reverse-proxy deployment, forward WebSocket upgrades for `/ws`, keep the SQLite volume backed up, and use `/healthz` for health monitoring.

## License

This repository does not currently include a license file or declare a project license in `package.json`.
