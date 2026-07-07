import http from "node:http";
import url from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import WebSocket, { WebSocketServer } from "ws";

import { createRateLimiter, isRateLimited } from "./rate-limiter.js";
import { reduceMessage, ValidationError } from "./state.js";
import { StateStore, StoreValidationError } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const DEFAULT_DB_PATH = process.env.METRONOME_DB_PATH ?? path.join(process.cwd(), "data", "metronome.sqlite");
const WS_MAX_PAYLOAD_BYTES = 4096;
const SSE_KEEPALIVE_MS = 15000;
const SOUND_IDS = ["classic", "wood", "digital", "cowbell", "tick", "snare", "kick", "rim", "shaker", "hihat"];

export function createAppServer({ dbPath = DEFAULT_DB_PATH, apiToken = process.env.METRONOME_API_TOKEN ?? null } = {}) {
  const app = express();
  const store = new StateStore(dbPath);
  let state = store.load();
  const server = http.createServer(app);
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: WS_MAX_PAYLOAD_BYTES,
    verifyClient: apiToken
      ? ({ req }, done) => {
          const parsed = url.parse(req.url, true);
          if (parsed.query.token === apiToken) {
            done(true);
          } else {
            done(false, 401, "Unauthorized");
          }
        }
      : undefined,
  });
  const sseClients = new Set();
  let closePromise;

  app.use(express.json({ limit: "16kb" }));

  // CORS for the public read endpoints + control API so StreamDeck / OBS / scripts
  // running on the same LAN can talk to the server without a same-origin browser.
  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
    next();
  });

  app.get("/healthz", (_request, response) => {
    try {
      response.json({ ok: true, store: store.health() });
    } catch {
      response.status(503).json({ ok: false, store: { ok: false }, error: "Store unavailable" });
    }
  });

  app.get("/api/info", (_request, response) => {
    response.json({
      app: "metronome",
      version: "1.5.0",
      sounds: SOUND_IDS,
      meters: ["4/4", "3/4", "6/8"],
      bpm_range: [30, 300],
      auth_required: Boolean(apiToken),
      endpoints: {
        state: "GET /api/state",
        settings: "GET /api/settings",
        presets: "GET /api/presets",
        control: "POST /api/control",
        events_sse: "GET /api/events",
        websocket: "/ws",
      },
    });
  });

  app.get("/api/settings", (_request, response) => {
    response.json(store.getSettings());
  });

  app.get("/api/state", (_request, response) => {
    response.json(state);
  });

  app.put("/api/settings", requireAuth(apiToken), (request, response) => {
    try {
      const settings = store.updateSettings(request.body ?? {});
      response.json(settings);
      broadcastJson(wss, { type: "settings:update", settings });
      sendSseEvent(sseClients, "settings", settings);
    } catch (error) {
      sendHttpError(response, error);
    }
  });

  app.get("/api/presets", (_request, response) => {
    response.json(store.listPresets());
  });

  app.post("/api/presets", requireAuth(apiToken), (request, response) => {
    try {
      const preset = store.createPreset(request.body ?? {});
      response.status(201).json(preset);
      broadcastJson(wss, { type: "presets:update", presets: store.listPresets() });
      sendSseEvent(sseClients, "presets", store.listPresets());
    } catch (error) {
      sendHttpError(response, error);
    }
  });

  app.patch("/api/presets/:id", requireAuth(apiToken), (request, response) => {
    try {
      const preset = store.updatePreset(request.params.id, request.body ?? {});
      if (!preset) {
        response.status(404).json({ error: "Preset not found" });
        return;
      }
      response.json(preset);
      broadcastJson(wss, { type: "presets:update", presets: store.listPresets() });
      sendSseEvent(sseClients, "presets", store.listPresets());
    } catch (error) {
      sendHttpError(response, error);
    }
  });

  app.delete("/api/presets/:id", requireAuth(apiToken), (request, response) => {
    const deleted = store.deletePreset(request.params.id);
    if (!deleted) {
      response.status(404).json({ error: "Preset not found" });
      return;
    }
    response.status(204).end();
    broadcastJson(wss, { type: "presets:update", presets: store.listPresets() });
    sendSseEvent(sseClients, "presets", store.listPresets());
  });

  app.post("/api/presets/reorder", requireAuth(apiToken), (request, response) => {
    try {
      const presets = store.reorderPresets(request.body?.ids);
      response.json(presets);
      broadcastJson(wss, { type: "presets:update", presets });
      sendSseEvent(sseClients, "presets", presets);
    } catch (error) {
      sendHttpError(response, error);
    }
  });

  // Control endpoint: lets HTTP clients (StreamDeck, OBS plugin scripts, shell
  // scripts) drive playback without speaking WebSocket. Accepts the same
  // `reduceMessage` payloads the WebSocket uses.
  app.post("/api/control", requireAuth(apiToken), (request, response) => {
    try {
      const message = request.body ?? {};
      state = store.save(reduceMessage(state, message));
      response.json(state);
      broadcastState(wss, state);
      sendSseEvent(sseClients, "state", state);
    } catch (error) {
      sendHttpError(response, error);
    }
  });

  // Server-sent events stream — emits the current state on connect, then
  // pushes state + settings + presets updates plus a `beat` heartbeat
  // whenever the room state advances. Easy to consume from
  // `EventSource("/api/events")` in OBS browser sources or StreamDeck.
  app.get("/api/events", (request, response) => {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();
    writeSseEvent(response, "state", state);
    writeSseEvent(response, "settings", store.getSettings());
    writeSseEvent(response, "presets", store.listPresets());
    const keepalive = setInterval(() => {
      response.write(": keepalive\n\n");
    }, SSE_KEEPALIVE_MS);
    const client = { response, keepalive };
    sseClients.add(client);
    request.on("close", () => {
      clearInterval(keepalive);
      sseClients.delete(client);
    });
  });

  app.get(["/settings", "/settings.html"], (_request, response) => {
    response.redirect(301, "/");
  });

  app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

  wss.on("connection", (socket) => {
    const limiter = createRateLimiter();
    sendState(socket, state);
    socket.on("message", (data) => {
      try {
        if (isRateLimited(limiter)) {
          socket.send(JSON.stringify({ type: "error", message: "Rate limit exceeded. Try again shortly." }));
          return;
        }
        const message = JSON.parse(data.toString());
        state = store.save(reduceMessage(state, message));
        broadcastState(wss, state);
        sendSseEvent(sseClients, "state", state);
      } catch (error) {
        socket.send(JSON.stringify(formatError(error)));
      }
    });
    socket.on("error", () => {});
  });

  return {
    app,
    get baseUrl() {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Server is not listening");
      }
      return `http://127.0.0.1:${address.port}`;
    },
    get wsUrl() {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Server is not listening");
      }
      return `ws://127.0.0.1:${address.port}/ws`;
    },
    listen(port = Number(process.env.PORT ?? 3000), host = process.env.HOST ?? "0.0.0.0") {
      return new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off("error", onError);
          wss.off("error", onError);
          reject(error);
        };
        server.once("error", onError);
        wss.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          wss.off("error", onError);
          resolve();
        });
      });
    },
    close() {
      if (closePromise) {
        return closePromise;
      }

      closePromise = new Promise((resolve, reject) => {
        for (const client of wss.clients) {
          client.terminate();
        }
        for (const client of sseClients) {
          clearInterval(client.keepalive);
          try {
            client.response.end();
          } catch {
            // ignore
          }
        }
        sseClients.clear();

        const finish = (error) => {
          let closeError = error;
          try {
            store.close();
          } catch (storeError) {
            closeError ??= storeError;
          }

          if (closeError) {
            reject(closeError);
            return;
          }
          resolve();
        };

        wss.close(() => {
          if (!server.listening) {
            finish();
            return;
          }
          server.close((error) => {
            finish(error);
          });
        });
      });
      return closePromise;
    },
  };
}

function requireAuth(token) {
  return (request, response, next) => {
    if (!token) {
      next();
      return;
    }
    const header = request.headers.authorization ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : header;
    if (presented === token) {
      next();
      return;
    }
    response.status(401).json({ error: "Unauthorized" });
  };
}

function broadcastState(wss, state) {
  for (const client of wss.clients) {
    sendState(client, state);
  }
}

function broadcastJson(wss, message) {
  const serialized = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(serialized);
    }
  }
}

function sendState(socket, state) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "state", state }));
  }
}

function writeSseEvent(response, event, payload) {
  try {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    // ignore broken pipe
  }
}

function sendSseEvent(clients, event, payload) {
  for (const client of clients) {
    writeSseEvent(client.response, event, payload);
  }
}

function formatError(error) {
  if (error instanceof ValidationError || error instanceof StoreValidationError || error instanceof SyntaxError) {
    return { type: "error", message: error.message };
  }
  return { type: "error", message: "Internal server error" };
}

function sendHttpError(response, error) {
  if (error instanceof ValidationError || error instanceof StoreValidationError || error instanceof SyntaxError) {
    response.status(400).json({ error: error.message });
    return;
  }
  response.status(500).json({ error: "Internal server error" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const appServer = createAppServer();
  await appServer.listen();
  console.log(`Metronome listening at ${appServer.baseUrl}`);
  const shutdown = async () => {
    try {
      await appServer.close();
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
