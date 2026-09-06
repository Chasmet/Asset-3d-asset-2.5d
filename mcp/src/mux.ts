import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { handleSuperBotRoute } from "./superbot.js";

const PORT = Number(process.env.PORT || 3000);
const ASSET_PORT = PORT + 1;
const HERE = path.dirname(fileURLToPath(import.meta.url));

const child = spawn(process.execPath, [path.join(HERE, "http.js")], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(ASSET_PORT) },
  stdio: ["ignore", "inherit", "inherit"],
});

child.on("exit", (code, signal) => {
  console.error(`Asset MCP child exited code=${code} signal=${signal}`);
  process.exit(code ?? 1);
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (await handleSuperBotRoute(req, res, url.pathname, url)) return;
  } catch (error) {
    const body = JSON.stringify({ error: String(error instanceof Error ? error.message : error) });
    res.writeHead(500, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }

  const proxy = httpRequest({
    hostname: "127.0.0.1",
    port: ASSET_PORT,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: `127.0.0.1:${ASSET_PORT}` },
  }, (upstream) => {
    res.writeHead(upstream.statusCode || 502, upstream.headers);
    upstream.pipe(res);
  });

  proxy.on("error", (error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    const body = JSON.stringify({ error: "asset_mcp_unavailable", detail: error.message });
    res.writeHead(502, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
    res.end(body);
  });

  req.pipe(proxy);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Asset + Super Bot MCP mux listening on 0.0.0.0:${PORT}`);
  console.log(`Super Bot MCP path: /superbot/mcp`);
});

function shutdown(signal: NodeJS.Signals) {
  console.log(`Shutting down on ${signal}`);
  child.kill("SIGTERM");
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
