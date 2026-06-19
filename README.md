# Metronome

A synchronized PWA metronome. The server holds the source of truth for BPM, meter, playback, presets, and audio settings, and every connected browser stays in sync over WebSockets.

Originally built for church broadcast teams, it works just as well for any room where multiple devices need to click together.

## Highlights

- 🎚️ **Live BPM stage** with beat pulse visualization, choice of dial / slider / wheel / tap controls.
- 🥁 **Meter switching** between `4/4`, `3/4`, and `6/8`.
- 👆 **Tap Tempo** estimates BPM from your taps.
- 🔊 **14 band-grade click sounds** including studio click, pulse trainer, wood block, stick, rim shot, sidestick, cowbell, agogô, tuned bell, classic sine, soft tick, shaker, closed hi-hat, digital beep. Each is synthesized with transient + body envelopes so they sound like real metronome cues — not bare oscillators.
- 🗂️ **Preset library** with add / edit / drag-reorder / delete — tap a preset chip on the stage to apply.
- 📤 **Share modal**: quick-share buttons (native Share / AirDrop + Copy link) first, QR code on demand.
- ⚙️ **Settings in an in-page modal** — the metronome **keeps playing** while you change anything, and sound changes apply instantly (no server-round-trip delay).
- 🎤 **Performance mode** — minimal one-tap UI for live use: giant BPM, giant START/STOP, oversized preset chips. Toggle with the icon in the top bar or press `P`.
- 🔇 **Preview-on-change toggle** (default on): turn off the sample click when switching sounds or moving the volume.
- 📱 **Background playback toggle** (default on): the click keeps going when the tab is hidden or the browser is minimized.
- ⏱️ **Web Worker scheduler** keeps timing tight even when the host tab is throttled — no more drifting clicks.
- 📺 **vMix / OBS friendly**: works inside Chromium Embedded Framework browser sources. Network-first service worker means a redeploy can't leave ghost UI behind in a long-running broadcast machine.
- 🔌 **HTTP control API + SSE event stream** for StreamDeck, OBS browser sources, shell scripts, etc.
- 🔐 Optional `METRONOME_API_TOKEN` Bearer auth for the control endpoints.
- 🌐 **WebSocket sync** with exponential-backoff reconnect, and an offline fallback served from the service worker cache.
- 🛡️ **Hardened server**: validation, payload caps, burst rate limiting, SQLite persistence, `/healthz` for orchestrators.
- 💾 **Settings survive redeploys**: SQLite lives in a named Docker volume (`metronome-data`). `docker compose pull && up -d` does not wipe your presets, sound choices, theme, or BPM.

## Quick Start

### Local

```bash
npm install
npm test     # 51 tests
npm start    # http://localhost:3000
```

### Docker

```bash
docker compose build
docker compose up -d
curl -fsS http://localhost:3000/healthz
```

The compose file stores SQLite data in the `metronome-data` volume so preset slots and settings survive container restarts.

## Environment Variables

| Name | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP and WebSocket port. |
| `HOST` | `0.0.0.0` | Bind address for the Node server. |
| `METRONOME_DB_PATH` | `./data/metronome.sqlite` | SQLite file used for room state, presets, and settings. |
| `METRONOME_API_TOKEN` | _(unset)_ | When set, all write endpoints (`POST/PUT/PATCH/DELETE /api/...` and `POST /api/control`) require `Authorization: Bearer <token>`. Read endpoints stay open. |

## Using It

### Stage (main screen)

- **+ / − buttons or slider** to set BPM (30–300).
- **START / STOP** to toggle playback for every connected client.
- **Meter buttons** (`4/4` / `3/4` / `6/8`).
- **TAP** to derive BPM from your taps.
- **Preset chips** apply BPM + meter in one tap.
- **⤴ Share** opens the QR / link / AirDrop modal.
- **⚙ Settings** opens the in-page settings modal — playback never stops.

### Settings modal

- **Presets** — add, edit, reorder (drag or ▲ / ▼), delete.
- **Tempo control style** — dial / slider / wheel / tap.
- **Sound** — pick a click sound, set volume, toggle preview-on-change.
- **Playback** — toggle background playback (keep playing when hidden / minimized).
- **Theme** — auto / light / dark.
- **Sync** — last-synced timestamp and a force-resync button.

### Sharing

- **QR code** — scan from any device on the same Wi-Fi to join the room.
- **Copy link** — paste anywhere.
- **Share / AirDrop** — on iPhone / iPad / Mac the system share sheet exposes AirDrop and every messaging app. On Android the system share sheet exposes every messenger and nearby-share. On desktops without `navigator.share` the button hides and a tip points to Copy link.

### Keyboard shortcuts (≥ 1440 px screens)

- `Space` — start / stop
- `↑ / ↓` — BPM ± 1 (`Shift` ± 5)
- `T` — tap tempo
- `1 / 2 / 3` — switch meter to 4/4 / 3/4 / 6/8

## NAS Deployment Notes

- Use the provided `docker-compose.yml` on Synology, Unraid, TrueNAS Scale, or anything that speaks Docker Compose.
- Keep port `3000` mapped only to the trusted LAN unless you front the app with an authenticated reverse proxy.
- Back up the `metronome-data` volume if preset slots and settings matter operationally.
- Reverse proxies must forward WebSocket upgrade headers to `/ws`.
- `/healthz` returns JSON with app and store status, so NAS dashboards can alert on database issues.

## Architecture

- **Server** — Node.js 20+ Express server for static files + REST API, `ws` WebSocket server at `/ws` for state sync, `better-sqlite3` persistence for room state, presets, and settings.
- **Client** — Vanilla JS PWA with a Web Audio scheduler driven by `AudioContext.currentTime`. Service worker (cache `church-metronome-v4`) serves the shell offline.
- **State model** — server is the single source of truth; clients send intent messages (`set_bpm`, `set_meter`, `set_playing`, `apply_preset`, …), server validates and broadcasts the resulting state to every connected socket.

## REST API

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/healthz` | – | Health check (app + store). |
| `GET` | `/api/info` | – | App version, supported sounds / meters / BPM range, endpoint map, `auth_required`. |
| `GET` | `/api/state` | – | Current room state snapshot. |
| `GET` | `/api/settings` | – | Settings + presets. |
| `GET` | `/api/presets` | – | List presets. |
| `GET` | `/api/events` | – | Server-sent events stream (`state`, `settings`, `presets` events). |
| `POST` | `/api/control` | token | Drive playback. Payload is the same `reduceMessage` shape as the WebSocket (`{type:"set_bpm",bpm:140}`, `{type:"set_meter",beats_per_bar:6,beat_unit:8}`, `{type:"set_playing",playing:true}`, `{type:"toggle_playing"}`, `{type:"apply_preset",bpm:120,meter:"4/4"}`, `{type:"load_preset",slot:1}`, `{type:"overwrite_preset",slot:1}`). |
| `PUT` | `/api/settings` | token | Update settings (control style, theme, sound, volume, preview, background audio). |
| `POST` | `/api/presets` | token | Create a preset (`bpm`, `meter`, `name`). |
| `PATCH` | `/api/presets/:id` | token | Update a preset. |
| `DELETE` | `/api/presets/:id` | token | Delete a preset. |
| `POST` | `/api/presets/reorder` | token | Reorder presets by id list. |

`token` columns require the `Authorization: Bearer …` header **only** when `METRONOME_API_TOKEN` is set; otherwise the endpoint is open.

### Examples (StreamDeck / OBS / shell)

```bash
# Start the click
curl -X POST http://metronome.local:3000/api/control \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"type":"set_playing","playing":true}'

# Set BPM 140
curl -X POST http://metronome.local:3000/api/control \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"type":"set_bpm","bpm":140}'

# Subscribe to state changes (OBS browser source / EventSource)
curl -N http://metronome.local:3000/api/events
```

WebSocket messages are documented in `src/state.js` (`reduceMessage`).

## License

Add a license file if you intend to distribute publicly.
