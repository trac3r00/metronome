import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { createAppServer } from "../src/server.js";

const servers = [];
const tempDirs = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("HTTP control API + SSE + info", () => {
  it("publishes /api/info with sounds, meters, range, and endpoint map", async () => {
    const { baseUrl } = await startTestServer();
    const info = await fetchJson(`${baseUrl}/api/info`);
    assert.equal(info.app, "metronome");
    assert.match(info.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(info.meters, ["4/4", "3/4", "6/8"]);
    assert.deepEqual(info.bpm_range, [30, 300]);
    assert.equal(info.sounds.length, 14);
    assert.ok(info.sounds.includes("studio"));
    assert.ok(info.sounds.includes("closed_hihat"));
    assert.ok(info.sounds.includes("agogo"));
    assert.equal(info.auth_required, false);
    assert.equal(info.endpoints.control, "POST /api/control");
    assert.equal(info.endpoints.events_sse, "GET /api/events");
  });

  it("accepts set_bpm via POST /api/control and persists it", async () => {
    const { baseUrl } = await startTestServer();
    const response = await fetch(`${baseUrl}/api/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "set_bpm", bpm: 140 }),
    });
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.bpm, 140);
    const refetched = await fetchJson(`${baseUrl}/api/state`);
    assert.equal(refetched.bpm, 140);
  });

  it("rejects bad control payloads with a 400", async () => {
    const { baseUrl } = await startTestServer();
    const response = await fetch(`${baseUrl}/api/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "set_bpm", bpm: 9999 }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /BPM/);
  });

  it("requires a bearer token when METRONOME_API_TOKEN is set", async () => {
    const { baseUrl } = await startTestServer(undefined, { apiToken: "s3cret" });

    // Read endpoints stay open
    const info = await fetchJson(`${baseUrl}/api/info`);
    assert.equal(info.auth_required, true);

    // Write without token → 401
    const noToken = await fetch(`${baseUrl}/api/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "set_bpm", bpm: 100 }),
    });
    assert.equal(noToken.status, 401);

    // Write with wrong token → 401
    const wrong = await fetch(`${baseUrl}/api/control`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer nope" },
      body: JSON.stringify({ type: "set_bpm", bpm: 100 }),
    });
    assert.equal(wrong.status, 401);

    // Write with right token → 200
    const ok = await fetch(`${baseUrl}/api/control`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer s3cret" },
      body: JSON.stringify({ type: "set_bpm", bpm: 100 }),
    });
    assert.equal(ok.status, 200);
    const state = await ok.json();
    assert.equal(state.bpm, 100);
  });

  it("remaps legacy v1.5 sound ids (snare/kick/tick/hihat) to v1.6 voices via /api/settings", async () => {
    const { baseUrl } = await startTestServer();
    const response = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sound_id: "snare" }),
    });
    assert.equal(response.status, 200);
    const settings = await response.json();
    // snare → studio per LEGACY_SOUND_MAP. Round-trip persists the remapped id
    // so clients on the new app don't see "snare" any more.
    assert.equal(settings.sound_id, "studio");
  });

  it("accepts a brand-new v1.6 sound id (closed_hihat) through /api/settings", async () => {
    const { baseUrl } = await startTestServer();
    const response = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sound_id: "closed_hihat" }),
    });
    assert.equal(response.status, 200);
    const settings = await response.json();
    assert.equal(settings.sound_id, "closed_hihat");
  });

  it("streams an initial state event over /api/events", async () => {
    const { baseUrl } = await startTestServer();
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let stateEvent = null;
    while (!stateEvent) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(/event: state\ndata: (.+)\n\n/);
      if (match) {
        stateEvent = JSON.parse(match[1]);
      }
    }
    controller.abort();
    assert.ok(stateEvent);
    assert.equal(stateEvent.bpm, 120);
  });
});

async function startTestServer(dbPath, extra = {}) {
  const dir = dbPath ? null : await mkdtemp(path.join(tmpdir(), "metronome-api-"));
  if (dir) {
    tempDirs.push(dir);
  }
  const appServer = createAppServer({
    dbPath: dbPath ?? path.join(dir, "state.sqlite"),
    ...extra,
  });
  await appServer.listen(0, "127.0.0.1");
  servers.push(appServer);
  return appServer;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  assert.ok([200, 201].includes(response.status), `Expected 200/201, got ${response.status}`);
  return response.json();
}
