# t_67dcb639 verification log

## npm test

> church-broadcast-metronome@1.0.0 test
> node --test

▶ server websocket sync
  ✔ sends current state on connect and broadcasts client BPM changes (83.620515ms)
  ✔ persists overwritten presets across server reopen (37.184153ms)
  ✔ closes promptly while websocket clients are still connected (21.393302ms)
✔ server websocket sync (144.689962ms)
▶ static PWA surface
  ✔ serves a health endpoint for Docker health checks (2680.952413ms)
  ✔ serves the static client, manifest, and service worker (3981.111952ms)
✔ static PWA surface (6663.225839ms)
▶ state validation
  ✔ updates bpm when value is inside the broadcast range (1.707244ms)
  ✔ rejects bpm outside the supported range (0.868907ms)
  ✔ accepts only the supported church meter options (0.384792ms)
  ✔ rejects unsupported meter combinations (1.568058ms)
  ✔ overwrites and loads preset slots 1 through 10 (1.558681ms)
✔ state validation (8.340243ms)
ℹ tests 10
ℹ suites 3
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7134.464099

## docker inspect health
/t_67dcb639-metronome-1 running healthy

## persisted state after docker compose restart
{"type":"state","bpm":90,"meter":"4/4","preset1":{"slot":1,"bpm":90,"beats_per_bar":4,"beat_unit":4},"playing":false}

## mobile viewport CDP check
{"innerWidth":390,"innerHeight":844,"scrollWidth":390,"bodyScrollWidth":390,"noHorizontalOverflow":true,"title":"Church Broadcast Metronome","presets":10}

## browser sync checks
BPM sync: page DOM 140 and second WebSocket received bpm=140
Preset slot 1: save 80 BPM 3/4, load from second WebSocket -> DOM 80/3/4, overwrite -> 90 BPM 4/4
Start: button changed to Stop and flash beat advanced, confirming Web Audio scheduler/visual flash path triggered after user gesture
