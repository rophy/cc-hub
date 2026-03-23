import { createServer, type Server } from "node:http";
import { HookEventSchema, type HookEvent } from "@cc-hub/shared";

export interface HttpServerEvents {
  onHookEvent(event: HookEvent): void;
}

export interface HttpServerHandle {
  close(): void;
}

export function createHttpServer(
  port: number,
  events: HttpServerEvents,
): HttpServerHandle {
  const server: Server = createServer((req, res) => {
    // CORS headers for potential web clients
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/hooks/activity") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          const result = HookEventSchema.safeParse(parsed);
          if (result.success) {
            events.onHookEvent(result.data);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
          } else {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"invalid hook event"}');
          }
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"invalid json"}');
        }
      });
      return;
    }

    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });

  server.listen(port);

  return {
    close() {
      server.close();
    },
  };
}
