import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import WebSocket from "ws";

import { createAppServer } from "../src/server.js";
import { StateStore } from "../src/store.js";

const servers = [];
const tempDirs = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("server websocket sync", () => {
  it("sends current state on connect and broadcasts client BPM changes", async () => {
    // Given: a running metronome server with two connected clients.
    const { baseUrl, wsUrl } = await startTestServer();
    assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:/);
    const { socket: first, initial } = await openClientWithInitial(wsUrl);
    const { socket: second } = await openClientWithInitial(wsUrl);

    // When: one client changes BPM.
    second.send(JSON.stringify({ type: "set_bpm", bpm: 132 }));
    const broadcast = await readJson(first);

    // Then: both the initial sync and broadcast expose server truth.
    assert.equal(initial.type, "state");
    assert.equal(initial.state.bpm, 120);
    assert.equal(broadcast.type, "state");
    assert.equal(broadcast.state.bpm, 132);
    first.close();
    second.close();
  });

  it("persists overwritten presets across server reopen", async () => {
    // Given: a server using a real SQLite database file.
    const dir = await mkdtemp(path.join(tmpdir(), "metronome-db-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "state.sqlite");
    const firstServer = await startTestServer(dbPath);
    const { socket: firstClient } = await openClientWithInitial(firstServer.wsUrl);

    // When: a preset is overwritten and the server is reopened.
    firstClient.send(JSON.stringify({ type: "set_bpm", bpm: 88 }));
    await readJson(firstClient);
    firstClient.send(JSON.stringify({ type: "set_meter", beats_per_bar: 6, beat_unit: 8 }));
    await readJson(firstClient);
    firstClient.send(JSON.stringify({ type: "overwrite_preset", slot: 3 }));
    await readJson(firstClient);
    firstClient.close();
    await firstServer.close();
    const secondServer = await startTestServer(dbPath);
    const { socket: secondClient, initial: reopened } = await openClientWithInitial(secondServer.wsUrl);

    // Then: the saved slot is still present.
    assert.deepEqual(reopened.state.presets[2], {
      slot: 3,
      bpm: 88,
      beats_per_bar: 6,
      beat_unit: 8,
    });
    secondClient.close();
  });

  it("closes promptly while websocket clients are still connected", async () => {
    // Given: a running metronome server with an active websocket client.
    const appServer = await startTestServer();
    const { socket: client } = await openClientWithInitial(appServer.wsUrl);

    // When: the server is closed before the client initiates its close.
    servers.splice(servers.indexOf(appServer), 1);
    await assert.doesNotReject(withTimeout(appServer.close(), 250, "server close timed out"));

    // Then: shutdown completes without waiting forever on the client socket.
    await assert.doesNotReject(withTimeout(waitForSocketClose(client), 1000, "client close timed out"));
  });

  it("returns an error for invalid websocket JSON", async () => {
    // Given: a connected websocket client.
    const appServer = await startTestServer();
    const { socket: client } = await openClientWithInitial(appServer.wsUrl);

    // When: the client sends invalid JSON.
    client.send("{");
    const error = await readJson(client);

    // Then: the socket stays open and receives a structured error.
    assert.equal(error.type, "error");
    assert.match(error.message, /Expected property name|JSON/);
    client.close();
  });

  it("rejects unsupported websocket messages without changing state", async () => {
    // Given: a connected websocket client.
    const appServer = await startTestServer();
    const { socket: client } = await openClientWithInitial(appServer.wsUrl);

    // When: the client sends an unsupported message type.
    client.send(JSON.stringify({ type: "delete_everything" }));
    const error = await readJson(client);

    // Then: the server returns a validation error.
    assert.deepEqual(error, { type: "error", message: "Unsupported message type" });
    client.close();
  });

  it("rate limits a client that floods messages inside one window", async () => {
    // Given: a connected websocket client.
    const appServer = await startTestServer();
    const { socket: client } = await openClientWithInitial(appServer.wsUrl);

    // When: the client sends far more than a realistic one-second tempo drag.
    for (let index = 0; index < 200; index += 1) {
      client.send(JSON.stringify({ type: "set_bpm", bpm: 100 + index }));
    }
    const messages = await readJsonMessages(client, 200);

    // Then: the burst is rejected with a rate-limit error.
    assert.ok(messages.some((message) => message.type === "error" && /Rate limit exceeded/.test(message.message)));
    client.close();
  });

  it("allows fifty tempo updates inside one second without rate limiting", async () => {
    // Given: a connected websocket client.
    const appServer = await startTestServer();
    const { socket: client } = await openClientWithInitial(appServer.wsUrl);

    // When: a realistic drag emits fifty BPM updates in one burst.
    for (let index = 0; index < 50; index += 1) {
      client.send(JSON.stringify({ type: "set_bpm", bpm: 100 + index }));
    }
    const messages = await readJsonMessages(client, 50);

    // Then: every response is a state update, not a rate-limit error.
    assert.equal(messages.some((message) => message.type === "error"), false);
    assert.equal(messages.at(-1).state.bpm, 149);
    client.close();
  });

  it("broadcasts meter changes to every websocket client", async () => {
    // Given: two connected websocket clients.
    const appServer = await startTestServer();
    const { socket: first } = await openClientWithInitial(appServer.wsUrl);
    const { socket: second } = await openClientWithInitial(appServer.wsUrl);

    // When: one client changes meter.
    second.send(JSON.stringify({ type: "set_meter", beats_per_bar: 6, beat_unit: 8 }));
    const broadcast = await readJson(first);

    // Then: the other client receives the new meter.
    assert.equal(broadcast.type, "state");
    assert.equal(broadcast.state.beats_per_bar, 6);
    assert.equal(broadcast.state.beat_unit, 8);
    first.close();
    second.close();
  });

  it("broadcasts settings preset taps as one bpm and meter update", async () => {
    // Given: two connected websocket clients.
    const appServer = await startTestServer();
    const { socket: first } = await openClientWithInitial(appServer.wsUrl);
    const { socket: second } = await openClientWithInitial(appServer.wsUrl);

    // When: one client taps a settings preset on the stage.
    second.send(JSON.stringify({ type: "apply_preset", bpm: 140, meter: "6/8" }));
    const broadcast = await readJson(first);

    // Then: the other client receives BPM and meter together.
    assert.equal(broadcast.type, "state");
    assert.equal(broadcast.state.bpm, 140);
    assert.equal(broadcast.state.beats_per_bar, 6);
    assert.equal(broadcast.state.beat_unit, 8);
    first.close();
    second.close();
  });

  it("closes websocket clients that exceed the payload cap", async () => {
    // Given: a connected websocket client.
    const appServer = await startTestServer();
    const { socket: client } = await openClientWithInitial(appServer.wsUrl);

    // When: the client sends a payload larger than 4KB.
    client.send("x".repeat(4097));
    const close = await waitForSocketClose(client);

    // Then: ws closes the connection with the message-too-large code.
    assert.equal(close.code, 1009);
  });
});

describe("server settings and preset sync", () => {
  it("returns default settings and seeded presets on a fresh database", async () => {
    // Given: a fresh server database.
    const { baseUrl } = await startTestServer();

    // When: the settings endpoint is requested.
    const settings = await fetchJson(`${baseUrl}/api/settings`);

    // Then: server defaults include slider control, auto theme, and five ordered presets.
    assert.equal(settings.control_style, "slider");
    assert.equal(settings.theme, "auto");
    assert.equal(settings.sound_id, "classic");
    assert.equal(settings.volume, 80);
    assert.equal(settings.preview_sound_on_change, true);
    assert.equal(settings.background_audio, true);
    assert.equal(Object.hasOwn(settings, "fullscreen_only"), false);
    assert.deepEqual(
      settings.presets.map(({ bpm, meter, name, position }) => ({ bpm, meter, name, position })),
      [
        { bpm: 60, meter: "4/4", name: null, position: 0 },
        { bpm: 80, meter: "4/4", name: null, position: 1 },
        { bpm: 100, meter: "4/4", name: null, position: 2 },
        { bpm: 120, meter: "4/4", name: null, position: 3 },
        { bpm: 140, meter: "4/4", name: null, position: 4 },
      ],
    );
  });

  it("updates settings and broadcasts the new settings to websocket clients", async () => {
    // Given: a connected websocket client.
    const { baseUrl, wsUrl } = await startTestServer();
    const { socket: client } = await openClientWithInitial(wsUrl);

    // When: settings are updated through the REST API.
    const response = await fetchJson(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        control_style: "wheel",
        theme: "dark",
        sound_id: "wood",
        volume: 35,
        fullscreen_only: true,
        preview_sound_on_change: false,
        background_audio: false,
      }),
    });
    const broadcast = await readJson(client);

    // Then: the response and websocket broadcast expose the persisted settings.
    assert.equal(response.control_style, "wheel");
    assert.equal(response.theme, "dark");
    assert.equal(response.sound_id, "wood");
    assert.equal(response.volume, 35);
    assert.equal(response.preview_sound_on_change, false);
    assert.equal(response.background_audio, false);
    assert.equal(Object.hasOwn(response, "fullscreen_only"), false);
    assert.equal(broadcast.type, "settings:update");
    assert.deepEqual(broadcast.settings, response);
    client.close();
  });

  it("migrates existing dial settings to slider once", async () => {
    // Given: an existing install with a pre-v2 dial preference.
    const dir = await mkdtemp(path.join(tmpdir(), "metronome-db-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "state.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        control_style TEXT NOT NULL DEFAULT 'slider',
        theme TEXT NOT NULL DEFAULT 'auto',
        fullscreen_only INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO settings (id, control_style, theme, fullscreen_only, updated_at)
      VALUES (1, 'dial', 'auto', 0, 123);
    `);
    db.close();

    // When: the store boots twice against the same database.
    const first = new StateStore(dbPath);
    const firstSettings = first.getSettings();
    first.close();
    const second = new StateStore(dbPath);
    const secondSettings = second.getSettings();
    const version = second.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();

    // Then: the one-shot migration changes dial to slider and records v2 idempotently.
    assert.equal(firstSettings.control_style, "slider");
    assert.equal(secondSettings.control_style, "slider");
    assert.equal(version.value, "2");
    second.close();
  });

  it("creates, lists, updates, reorders, and deletes presets", async () => {
    // Given: a running server with seeded presets.
    const { baseUrl, wsUrl } = await startTestServer();
    const { socket: client } = await openClientWithInitial(wsUrl);

    // When: a preset is created and then updated.
    const created = await fetchJson(`${baseUrl}/api/presets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bpm: 72, meter: "3/4", name: "Prayer" }),
    });
    const createBroadcast = await readJson(client);
    const updated = await fetchJson(`${baseUrl}/api/presets/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bpm: 76, meter: "6/8", name: "Benediction" }),
    });
    const updateBroadcast = await readJson(client);

    // Then: list ordering, update values, broadcasts, reorder, and delete are all consistent.
    assert.equal(created.position, 5);
    assert.equal(createBroadcast.type, "presets:update");
    assert.equal(createBroadcast.presets.at(-1).name, "Prayer");
    assert.deepEqual(
      { bpm: updated.bpm, meter: updated.meter, name: updated.name },
      { bpm: 76, meter: "6/8", name: "Benediction" },
    );
    assert.equal(updateBroadcast.type, "presets:update");

    const listed = await fetchJson(`${baseUrl}/api/presets`);
    const reorderedIds = [created.id, ...listed.filter((preset) => preset.id !== created.id).map((preset) => preset.id)];
    const reordered = await fetchJson(`${baseUrl}/api/presets/reorder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: reorderedIds }),
    });
    await readJson(client);
    assert.equal(reordered[0].id, created.id);
    assert.deepEqual(
      reordered.map((preset) => preset.position),
      reordered.map((_, index) => index),
    );

    const deleteResponse = await fetch(`${baseUrl}/api/presets/${created.id}`, { method: "DELETE" });
    assert.equal(deleteResponse.status, 204);
    const deleteBroadcast = await readJson(client);
    assert.equal(deleteBroadcast.type, "presets:update");
    assert.equal(deleteBroadcast.presets.some((preset) => preset.id === created.id), false);
    client.close();
  });

  it("seeds default presets only when the presets table is empty", async () => {
    // Given: a persistent database after one preset has been deleted.
    const dir = await mkdtemp(path.join(tmpdir(), "metronome-db-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "state.sqlite");
    const firstServer = await startTestServer(dbPath);
    const presets = await fetchJson(`${firstServer.baseUrl}/api/presets`);
    const deleteResponse = await fetch(`${firstServer.baseUrl}/api/presets/${presets[0].id}`, { method: "DELETE" });
    assert.equal(deleteResponse.status, 204);
    await firstServer.close();

    // When: the server is reopened against the same non-empty presets table.
    const secondServer = await startTestServer(dbPath);
    const reopenedPresets = await fetchJson(`${secondServer.baseUrl}/api/presets`);

    // Then: the deleted row is not re-seeded.
    assert.equal(reopenedPresets.length, 4);
    assert.deepEqual(
      reopenedPresets.map((preset) => preset.bpm),
      [80, 100, 120, 140],
    );
  });
});

describe("static PWA surface", () => {
  it("serves a health endpoint for Docker health checks", async () => {
    // Given: a running server.
    const { baseUrl } = await startTestServer();

    // When: Docker or an operator probes health.
    const health = await fetchJson(`${baseUrl}/healthz`);

    // Then: the server reports healthy without touching browser assets.
    assert.equal(health.ok, true);
    assert.deepEqual(health.store, {
      ok: true,
      room_state: true,
      presets_saved: 0,
    });
  });

  it("serves the current room state through the compatibility REST endpoint", async () => {
    const { baseUrl } = await startTestServer();

    const state = await fetchJson(`${baseUrl}/api/state`);

    assert.equal(state.bpm, 120);
    assert.equal(state.beats_per_bar, 4);
    assert.equal(state.beat_unit, 4);
    assert.equal(state.playing, false);
  });

  it("serves the static client, manifest, and service worker", async () => {
    // Given: a running server.
    const { baseUrl } = await startTestServer();

    // When: the browser requests the installable app assets.
    const [index, appScript, qrScript, tempoScript, settingsRedirect, manifest, worker] =
      await Promise.all([
      fetchText(`${baseUrl}/`),
      fetchText(`${baseUrl}/app.js`),
      fetchText(`${baseUrl}/qr-share.js`),
      fetchText(`${baseUrl}/tempo-controls.js`),
      fetch(`${baseUrl}/settings`, { redirect: "manual" }),
      fetchJson(`${baseUrl}/manifest.webmanifest`),
      fetchText(`${baseUrl}/sw.js`),
    ]);

    // Then: the app shell and PWA files are present.
    assert.match(index, /<title>Metronome<\/title>/);
    assert.doesNotMatch(index, /fullscreen/i);
    assert.match(index, /id="settings-modal"/);
    assert.match(index, /id="share-modal"/);
    assert.match(index, /preview-toggle/);
    assert.match(index, /background-audio-toggle/);
    assert.match(appScript, /tempo-control/);
    assert.match(appScript, /background_audio/);
    assert.match(appScript, /preview_sound_on_change/);
    assert.doesNotMatch(appScript, /bindFullscreenToggle|fullscreen_only/);
    assert.match(qrScript, /qrcode.min.js/);
    assert.match(qrScript, /AirDrop/);
    assert.match(tempoScript, /renderTempoControl/);
    assert.equal(settingsRedirect.status, 301);
    assert.equal(settingsRedirect.headers.get("location"), "/");
    assert.equal(manifest.name, "Metronome");
    assert.equal(manifest.display, "standalone");
    assert.match(worker, /install/);
    assert.match(worker, /\.keys\(\)/);
    assert.match(worker, /caches\.delete/);
    assert.match(worker, /church-metronome-/);
    assert.doesNotMatch(worker, /fullscreen\.js/);
    assert.doesNotMatch(worker, /settings\.js/);
  });

  it("has no Korean user-facing strings in public HTML or JavaScript", async () => {
    const files = await listPublicTextFiles(path.join(process.cwd(), "public"));
    const contents = await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")]));

    const matches = contents.filter(([, text]) => /[가-힣]/u.test(text));

    assert.deepEqual(matches.map(([file]) => path.relative(process.cwd(), file)), []);
  });
});

async function startTestServer(dbPath) {
  const dir = dbPath ? null : await mkdtemp(path.join(tmpdir(), "metronome-db-"));
  if (dir) {
    tempDirs.push(dir);
  }
  const appServer = createAppServer({
    dbPath: dbPath ?? path.join(dir, "state.sqlite"),
  });
  await appServer.listen(0, "127.0.0.1");
  servers.push(appServer);
  return appServer;
}

function openClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function openClientWithInitial(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const initial = readJson(socket);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { socket, initial: await initial };
}

function readJson(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for message")), 1000);
    socket.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
    socket.once("error", reject);
  });
}

function readJsonMessages(socket, count) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for messages"));
    }, 1000);
    const onMessage = (data) => {
      messages.push(JSON.parse(data.toString()));
      if (messages.length === count) {
        cleanup();
        resolve(messages);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

async function fetchText(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.text();
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  assert.ok([200, 201].includes(response.status), `Expected 200 or 201, received ${response.status}`);
  return response.json();
}

async function listPublicTextFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listPublicTextFiles(fullPath);
    }
    return /\.(?:html|js)$/u.test(entry.name) ? [fullPath] : [];
  }));
  return files.flat();
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => {
      clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function waitForSocketClose(socket) {
  if ([WebSocket.CLOSING, WebSocket.CLOSED].includes(socket.readyState)) {
    return Promise.resolve({ code: socket.closeCode });
  }
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}
