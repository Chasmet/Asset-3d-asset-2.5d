import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

interface DeviceState {
  deviceId: string;
  online: boolean;
  lastSeen: number;
  lastScreenAt?: number;
  awake?: boolean;
  packageName?: string | null;
  screenText?: string;
  nodes?: unknown[];
  activeTask?: unknown;
  lastResult?: unknown;
}

interface Command {
  id: string;
  deviceId: string;
  type: string;
  payload: Record<string, unknown>;
  status: "queued" | "delivered" | "running" | "completed" | "failed";
  createdAt: number;
  deliveredAt?: number;
  attempts?: number;
  completedAt?: number;
  result?: unknown;
}

const devices = new Map<string, DeviceState>();
const queues = new Map<string, Command[]>();
const commands = new Map<string, Command>();
const LEASE_MS = 30_000;

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,mcp-protocol-version",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  let raw = "";
  for await (const chunk of req) {
    raw += String(chunk);
    if (raw.length > 2_000_000) throw new Error("request_too_large");
  }
  return raw ? JSON.parse(raw) : {};
}

function device(id = "superbot-phone"): DeviceState {
  if (!devices.has(id)) {
    devices.set(id, {
      deviceId: id,
      online: false,
      lastSeen: 0,
      lastScreenAt: 0,
      packageName: null,
      screenText: "",
      nodes: [],
      activeTask: null,
      lastResult: null,
    });
  }
  return devices.get(id)!;
}

function queue(id = "superbot-phone"): Command[] {
  if (!queues.has(id)) queues.set(id, []);
  return queues.get(id)!;
}

function enqueue(deviceId: string, type: string, payload: Record<string, unknown> = {}): Command {
  const command: Command = {
    id: randomUUID(),
    deviceId,
    type,
    payload,
    status: "queued",
    createdAt: Date.now(),
  };
  commands.set(command.id, command);
  queue(deviceId).push(command);
  return command;
}

function deliver(deviceId: string): Command[] {
  const now = Date.now();
  const pending = queue(deviceId);
  const command = pending.find((c) => c.type === "cancel" && c.status === "queued")
    || pending.find((c) => c.status === "queued" ||
      (c.status === "delivered" && now - (c.deliveredAt || 0) >= LEASE_MS));
  if (!command) return [];
  command.status = "delivered";
  command.deliveredAt = now;
  command.attempts = (command.attempts || 0) + 1;
  return [command];
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
  };
}

const tools = [
  {
    name: "superbot_get_device_status",
    description: "Retourne l'état de connexion du téléphone Super Bot et la dernière activité connue.",
    inputSchema: { type: "object", properties: { deviceId: { type: "string", default: "superbot-phone" } } },
  },
  {
    name: "superbot_get_screen_state",
    description: "Lit l'écran courant transmis par Super Bot Android: application, texte, nœuds et tâche active.",
    inputSchema: { type: "object", properties: { deviceId: { type: "string", default: "superbot-phone" } } },
  },
  {
    name: "superbot_click_text",
    description: "Demande au téléphone de cliquer sur un texte visible dans le flux social Super Bot.",
    inputSchema: { type: "object", required: ["text"], properties: { deviceId: { type: "string", default: "superbot-phone" }, text: { type: "string" } } },
  },
  {
    name: "superbot_click_point",
    description: "Demande un clic à une position écran précise x/y dans le flux social Super Bot.",
    inputSchema: { type: "object", required: ["x", "y"], properties: { deviceId: { type: "string", default: "superbot-phone" }, x: { type: "number" }, y: { type: "number" } } },
  },
  {
    name: "superbot_swipe",
    description: "Demande un glissement tactile entre deux points sur le téléphone.",
    inputSchema: { type: "object", required: ["x1", "y1", "x2", "y2"], properties: { deviceId: { type: "string", default: "superbot-phone" }, x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" }, durationMs: { type: "integer", default: 350 } } },
  },
  {
    name: "superbot_back",
    description: "Demande au téléphone d'effectuer Retour Android dans le flux social actif.",
    inputSchema: { type: "object", properties: { deviceId: { type: "string", default: "superbot-phone" } } },
  },
  {
    name: "superbot_submit_publication",
    description: "Envoie une mission de publication sociale à Super Bot Android. Une mission reste running tant que le réseau social n'a pas confirmé la publication ou la programmation.",
    inputSchema: {
      type: "object",
      required: ["platform", "scheduledAt"],
      properties: {
        deviceId: { type: "string", default: "superbot-phone" },
        platform: { type: "string" },
        mediaUri: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        hashtags: { type: "string" },
        scheduledAt: { type: "integer" },
      },
    },
  },
  {
    name: "superbot_get_task_status",
    description: "Retourne l'état réel d'une mission. completed signifie confirmation finale du réseau social, jamais simple mise en file ou ouverture Android.",
    inputSchema: { type: "object", required: ["commandId"], properties: { commandId: { type: "string" } } },
  },
  {
    name: "superbot_cancel_task",
    description: "Demande l'annulation d'une mission Super Bot en cours.",
    inputSchema: { type: "object", properties: { deviceId: { type: "string", default: "superbot-phone" }, commandId: { type: "string" } } },
  },
];

function callTool(name: string, args: Record<string, any> = {}) {
  const deviceId = String(args.deviceId || "superbot-phone");
  const current = device(deviceId);
  if (name === "superbot_get_device_status") {
    return textResult({
      deviceId,
      online: Date.now() - current.lastSeen < 15_000,
      controlReady: Date.now() - (current.lastScreenAt || 0) < 15_000 && current.awake === true,
      lastScreenAt: current.lastScreenAt || 0,
      lastSeen: current.lastSeen,
      packageName: current.packageName,
      activeTask: current.activeTask,
      lastResult: current.lastResult,
    });
  }
  if (name === "superbot_get_screen_state") {
    return textResult({
      deviceId,
      online: Date.now() - current.lastSeen < 15_000,
      packageName: current.packageName,
      screenText: current.screenText,
      nodes: current.nodes,
      activeTask: current.activeTask,
    });
  }
  if (name === "superbot_get_task_status") return textResult(commands.get(String(args.commandId)) || { error: "command_not_found" });
  if (name === "superbot_cancel_task") {
    const target = commands.get(String(args.commandId || ""));
    if (target && target.deviceId !== deviceId) return textResult({ error: "wrong_device" });
    if (target && target.status === "queued") {
      target.status = "failed";
      target.result = { ok: false, phase: "failed", message: "cancelled_before_delivery" };
      target.completedAt = Date.now();
      const waiting = queue(deviceId);
      const index = waiting.indexOf(target);
      if (index >= 0) waiting.splice(index, 1);
      return textResult({ cancelled: true, commandId: target.id });
    }
    const c = enqueue(deviceId, "cancel", { commandId: args.commandId || null });
    return textResult({ queued: true, commandId: c.id, deviceId });
  }
  const mapping: Record<string, string> = {
    superbot_click_text: "click_text",
    superbot_click_point: "click_point",
    superbot_swipe: "swipe",
    superbot_back: "back",
    superbot_submit_publication: "submit_publication",
  };
  const type = mapping[name];
  if (!type) return { isError: true, content: [{ type: "text", text: `Outil inconnu: ${name}` }] };
  const c = enqueue(deviceId, type, args);
  return textResult({ queued: true, commandId: c.id, deviceId,
    controlReady: Date.now() - (current.lastScreenAt || 0) < 15_000 && current.awake === true });
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const msg = await readJson(req);
  const id = msg.id ?? null;
  if (msg.method === "initialize") {
    writeJson(res, 200, rpcResult(id, {
      protocolVersion: msg.params?.protocolVersion || "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "super-bot-mcp", version: "1.1.0" },
    }));
    return;
  }
  if (msg.method === "notifications/initialized") {
    writeJson(res, 200, {});
    return;
  }
  if (msg.method === "tools/list") {
    writeJson(res, 200, rpcResult(id, { tools }));
    return;
  }
  if (msg.method === "tools/call") {
    try {
      writeJson(res, 200, rpcResult(id, callTool(String(msg.params?.name || ""), msg.params?.arguments || {})));
    } catch (error) {
      writeJson(res, 200, rpcResult(id, { isError: true, content: [{ type: "text", text: String(error instanceof Error ? error.message : error) }] }));
    }
    return;
  }
  writeJson(res, 200, rpcError(id, -32601, "Method not found"));
}

export async function handleSuperBotRoute(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): Promise<boolean> {
  if (!pathname.startsWith("/superbot/")) return false;
  if (req.method === "OPTIONS") {
    writeJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === "GET" && pathname === "/superbot/health") {
    writeJson(res, 200, { ok: true, service: "super-bot-mcp", mcpPath: "/superbot/mcp", now: Date.now() });
    return true;
  }
  if (req.method === "POST" && pathname === "/superbot/mcp") {
    await handleMcp(req, res);
    return true;
  }
  if (req.method === "POST" && pathname === "/superbot/device/register") {
    const b = await readJson(req);
    const d = device(String(b.deviceId || "superbot-phone"));
    Object.assign(d, b, { online: true, lastSeen: Date.now() });
    writeJson(res, 200, { ok: true, deviceId: d.deviceId });
    return true;
  }
  if (req.method === "POST" && pathname === "/superbot/device/state") {
    const b = await readJson(req);
    const d = device(String(b.deviceId || "superbot-phone"));
    Object.assign(d, b, { online: true, lastSeen: Date.now(), lastScreenAt: Date.now() });
    writeJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === "GET" && pathname === "/superbot/device/commands") {
    const deviceId = url.searchParams.get("deviceId") || "superbot-phone";
    const out = deliver(deviceId);
    const d = device(deviceId);
    d.lastSeen = Date.now();
    d.online = true;
    writeJson(res, 200, { commands: out });
    return true;
  }
  const match = pathname.match(/^\/superbot\/device\/commands\/([^/]+)\/result$/);
  if (match && req.method === "POST") {
    const c = commands.get(match[1]);
    if (!c) {
      writeJson(res, 404, { error: "command_not_found" });
      return true;
    }
    if (c.status === "completed" || c.status === "failed") {
      writeJson(res, 200, { ok: true, status: c.status });
      return true;
    }
    const b = await readJson(req);
    const phase = String(b.phase || "").toLowerCase();
    const message = String(b.message || "").toLowerCase();
    const terminalFailure = b.ok === false || phase === "failed";
    const terminalSuccess = phase === "completed"
      || message.startsWith("scheduled_confirmed")
      || message.startsWith("publication_completed")
      || message.startsWith("published_confirmed");

    if (terminalFailure) {
      c.status = "failed";
      c.completedAt = Date.now();
    } else if (terminalSuccess) {
      c.status = "completed";
      c.completedAt = Date.now();
    } else if (c.type === "submit_publication") {
      c.status = "running";
      delete c.completedAt;
    } else {
      c.status = "completed";
      c.completedAt = Date.now();
    }

    c.result = b;
    if (c.status === "completed" || c.status === "failed") {
      const pending = queue(c.deviceId);
      const index = pending.indexOf(c);
      if (index >= 0) pending.splice(index, 1);
    }
    const d = device(c.deviceId);
    d.lastSeen = Date.now();
    d.online = true;
    d.lastResult = { commandId: c.id, status: c.status, ...b };
    writeJson(res, 200, { ok: true, status: c.status });
    return true;
  }
  writeJson(res, 404, { error: "not_found" });
  return true;
}
