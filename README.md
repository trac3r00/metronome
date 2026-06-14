# Church Broadcast Metronome

A single-room synchronized metronome for church broadcast teams. The server is the source of truth for BPM, meter, playback state, and preset slots, and every browser stays in sync over WebSockets.

## Run with Docker

```bash
docker-compose up -d
```

Open `http://localhost:3000`. Docker probes `http://127.0.0.1:3000/healthz` and should show the container as healthy after startup.

The compose file stores SQLite data in the `metronome-data` volume so preset slots survive container restarts.

## Local development

```bash
npm install
npm test
npm start
```

The local app also runs at `http://localhost:3000` by default. Set `PORT` or `METRONOME_DB_PATH` to override the port or SQLite file.

## Usage

- Use the slider or number field to set BPM from 30 to 300.
- Use `Start` and `Stop` to control playback for every connected client.
- Choose `4/4`, `3/4`, or `6/8` with the meter buttons.
- Use `Tap Tempo` to estimate BPM from repeated taps.
- Use the fullscreen button on mobile or tablet broadcast stations for a focused stage view.

## Presets

Slots 1-10 store BPM plus meter. Press `Save` on a slot to overwrite it with the current BPM and meter. Press `Load` to recall that slot and broadcast it to all connected clients. Empty slots cannot be loaded until saved.

## Architecture

- Node.js 20-compatible Express server for static files.
- `ws` WebSocket server at `/ws` for state sync.
- `better-sqlite3` persistence for room state and preset slots.
- Static vanilla JS PWA client with a Web Audio scheduler based on `AudioContext.currentTime`.
