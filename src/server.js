import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import WebSocket, { WebSocketServer } from "ws";

import { reduceMessage, ValidationError } from "./state.js";
import { StateStore } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const DEFAULT_DB_PATH = process.env.METRONOME_DB_PATH ?? path.join(process.cwd(), "data", "metronome.sqlite");

export function createAppServer({ dbPath = DEFAULT_DB_PATH } = {}) {
  const app = express();
  const store = new StateStore(dbPath);
  let state = store.load();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  let closePromise;

  app.get("/healthz", (_request, response) => {
    response.json({ ok: true });
  });

  app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

  wss.on("connection", (socket) => {
    sendState(socket, state);
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        state = store.save(reduceMessage(state, message));
        broadcastState(wss, state);
      } catch (error) {
        socket.send(JSON.stringify(formatError(error)));
      }
    });
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

function sendState(socket, state) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "state", state }));
  }
}

function formatError(error) {
  if (error instanceof ValidationError || error instanceof SyntaxError) {
    return { type: "error", message: error.message };
  }
  return { type: "error", message: "Internal server error" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const appServer = createAppServer();
  await appServer.listen();
  console.log(`Metronome listening at ${appServer.baseUrl}`);
}
