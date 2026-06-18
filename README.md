# Metronome

A synchronized PWA metronome. The server holds the source of truth for BPM, meter, playback, presets, and audio settings, and every connected browser stays in sync over WebSockets.

Originally built for church broadcast teams, it works just as well for any room where multiple devices need to click together.

## Highlights

- 🎚️ **Live BPM stage** with beat pulse visualization, choice of dial / slider / wheel / tap controls.
- 🥁 **Meter switching** between `4/4`, `3/4`, and `6/8`.
- 👆 **Tap Tempo** estimates BPM from your taps.
- 🔊 **Five click sounds** (classic, wood, digital, cowbell, soft tick) with a volume slider and per-sound preview.
- 🗂️ **Preset library** with add / edit / drag-reorder / delete — tap a preset chip on the stage to apply.
- 📤 **Share modal**: QR code + copy link + native **Share / AirDrop** button (iOS, Android).
- ⚙️ **Settings in an in-page modal** — the metronome **keeps playing** while you change anything.
- 🔇 **Preview-on-change toggle** (default on): turn off the sample click when switching sounds or moving the volume.
- 📱 **Background playback toggle** (default on): the click keeps going when the tab is hidden or the browser is minimized.
- 🔌 **WebSocket sync** with exponential-backoff reconnect, and an offline fallback served from the service worker cache.
- 🛡️ **Hardened server**: validation, payload caps, burst rate limiting, SQLite persistence, `/healthz` for orchestrators.

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

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/healthz` | Health check (app + store). |
| `GET` | `/api/state` | Current room state snapshot. |
| `GET` | `/api/settings` | Settings + presets. |
| `PUT` | `/api/settings` | Update settings (control style, theme, sound, volume, preview, background audio). |
| `GET` | `/api/presets` | List presets. |
| `POST` | `/api/presets` | Create a preset (`bpm`, `meter`, `name`). |
| `PATCH` | `/api/presets/:id` | Update a preset. |
| `DELETE` | `/api/presets/:id` | Delete a preset. |
| `POST` | `/api/presets/reorder` | Reorder presets by id list. |

WebSocket messages are documented in `src/state.js` (`reduceMessage`).

## License

Add a license file if you intend to distribute publicly.
