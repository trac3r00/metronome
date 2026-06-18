# Church Broadcast Metronome

A single-room synchronized metronome for church broadcast teams. The server is the source of truth for BPM, meter, playback state, and preset slots, and every browser stays in sync over WebSockets.

## Screenshot

Screenshot placeholder: add `artifacts/screenshot.png` after capturing the deployed tablet view.

## Features

- Large broadcast-friendly BPM stage with beat pulse visualization.
- Meter controls for `4/4`, `3/4`, and `6/8`.
- BPM slider, numeric BPM entry, tap tempo, and selectable metronome sounds.
- Ten preset slots that store BPM plus meter.
- One-tap Share modal with QR code, copy link, and native Share / AirDrop (iOS, Android).
- Settings live in an in-page modal — the metronome keeps playing while you change presets, sounds, or theme.
- Optional preview-on-change for sounds and volume, toggleable in settings (default on).
- Optional background playback that keeps the click going when the tab is hidden or the browser is minimized (default on).
- WebSocket sync across phones, tablets, and booth computers.
- Automatic WebSocket reconnect with exponential backoff.
- Offline fallback for local-only operation from the service worker cache.
- AudioContext resume/suspend handling for mobile Safari and background tabs.
- Server-side message validation, payload limits, burst rate limiting, SQLite persistence, and `/healthz`.

## Environment Variables

| Name | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP and WebSocket port. |
| `HOST` | `0.0.0.0` | Bind address for the Node server. |
| `METRONOME_DB_PATH` | `./data/metronome.sqlite` | SQLite file used for room state and presets. |

## Run with Docker

```bash
docker compose build
docker compose up -d
curl -fsS http://localhost:3000/healthz
```

Open `http://localhost:3000`. Docker probes `http://127.0.0.1:3000/healthz` and should show the container as healthy after startup.

The compose file stores SQLite data in the `metronome-data` volume so preset slots survive container restarts.

## NAS Deployment Notes

- Use the provided `docker-compose.yml` on Synology, Unraid, TrueNAS Scale, or another NAS with Docker Compose support.
- Keep port `3000` mapped only to the trusted church LAN unless the app is placed behind an authenticated reverse proxy.
- Back up the `metronome-data` volume if preset slots matter operationally.
- For reverse proxies, forward WebSocket upgrade headers to `/ws` and regular HTTP traffic to `/`.
- The health check endpoint returns JSON with both app and store status, so NAS dashboards can alert on database issues.

## Local Development

```bash
npm install
npm test
npm start
```

The local app also runs at `http://localhost:3000` by default.

## Usage

- Use the slider or number field to set BPM from 30 to 300.
- Use `Start` and `Stop` to control playback for every connected client.
- Choose `4/4`, `3/4`, or `6/8` with the meter buttons.
- Use `Tap Tempo` to estimate BPM from repeated taps.
- Choose a click sound and volume from Settings before rehearsal starts.
- If the booth network drops, the cached app can keep a local tempo until the room reconnects.

## Presets

Slots 1-10 store BPM plus meter. Press `Save` on a slot to overwrite it with the current BPM and meter. Press `Load` to recall that slot and broadcast it to all connected clients. Empty slots cannot be loaded until saved.

## Architecture

- Node.js 20-compatible Express server for static files.
- `ws` WebSocket server at `/ws` for state sync.
- `better-sqlite3` persistence for room state and preset slots.

## TODO

- Preset UX simplification: easier add, edit, and reorder controls on the main page belong in a separate PR.
- Static vanilla JS PWA client with a Web Audio scheduler based on `AudioContext.currentTime`.
