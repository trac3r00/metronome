import http from "node:http";
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

export function createAppServer({ dbPath = DEFAULT_DB_PATH } = {}) {
  const app = express();
  const store = new StateStore(dbPath);
  let state = store.load();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: WS_MAX_PAYLOAD_BYTES });
  let closePromise;

  app.use(express.json({ limit: "16kb" }));

  app.get("/healthz", (_request, response) => {
    try {
      response.json({ ok: true, store: store.health() });
    } catch (error) {
      response.status(503).json({ ok: false, store: { ok: false }, error: "Store unavailable" });
    }
  });

  app.get("/api/settings", (_request, response) => {
    response.json(store.getSettings());
  });

  app.get("/api/state", (_request, response) => {
    response.json(state);
  });

  app.put("/api/settings", (request, response) => {
    try {
      const settings = store.updateSettings(request.body ?? {});
      response.json(settings);
      broadcastJson(wss, { type: "settings:update", settings });
    } catch (error) {
      sendHttpError(response, error);
    }
  });

  app.get("/api/presets", (_request, response) => {
    response.json(store.listPresets());
  });

  app.post("/api/presets", (request, response) => {
    try {
      const preset = store.createPreset(request.body ?? {});
      response.status(201).json(preset);
      broadcastJson(wss, { type: "presets:update", presets: store.listPresets() });
    } catch (error) {
      sendHttpError(response, error);
    }
  });

  app.patch("/api/presets/:id", (request, response) => {
    try {
      const preset = store.updatePreset(request.params.id, request.body ?? {});
      if (!preset) {
        response.status(404).json({ error: "Preset not found" });
        return;
      }
      response.json(preset);
      broadcastJson(wss, { type: "presets:update", presets: store.listPresets() });
    } catch (error) {
      sendHttpError(response, error);
    }
  });

  app.delete("/api/presets/:id", (request, response) => {
    const deleted = store.deletePreset(request.params.id);
    if (!deleted) {
      response.status(404).json({ error: "Preset not found" });
      return;
    }
    response.status(204).end();
    broadcastJson(wss, { type: "presets:update", presets: store.listPresets() });
  });

  app.post("/api/presets/reorder", (request, response) => {
    try {
      const presets = store.reorderPresets(request.body?.ids);
      response.json(presets);
      broadcastJson(wss, { type: "presets:update", presets });
    } catch (error) {
      sendHttpError(response, error);
    }
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

function formatError(error) {
  if (error instanceof ValidationError || error instanceof StoreValidationError || error instanceof SyntaxError) {
    return { type: "error", message: error.message };
  }
  return { type: "error", message: "Internal server error" };
}

function sendHttpError(response, error) {
  if (error instanceof StoreValidationError || error instanceof SyntaxError) {
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
