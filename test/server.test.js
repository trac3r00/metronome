import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import WebSocket from "ws";

import { createAppServer } from "../src/server.js";

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

    // When: the client sends more than ten messages immediately.
    for (let index = 0; index < 11; index += 1) {
      client.send(JSON.stringify({ type: "set_bpm", bpm: 100 + index }));
    }
    const messages = await readJsonMessages(client, 11);

    // Then: the burst is rejected with a rate-limit error.
    assert.equal(messages.at(-1).type, "error");
    assert.match(messages.at(-1).message, /Rate limit exceeded/);
    client.close();
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

  it("serves the static client, manifest, and service worker", async () => {
    // Given: a running server.
    const { baseUrl } = await startTestServer();

    // When: the browser requests the installable app assets.
    const [index, manifest, worker] = await Promise.all([
      fetchText(`${baseUrl}/`),
      fetchJson(`${baseUrl}/manifest.webmanifest`),
      fetchText(`${baseUrl}/sw.js`),
    ]);

    // Then: the app shell and PWA files are present.
    assert.match(index, /Church Broadcast Metronome/);
    assert.equal(manifest.name, "Church Broadcast Metronome");
    assert.match(worker, /install/);
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

async function fetchJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
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
