import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(process.env.ASSET_PROJECT_ROOT || path.resolve(HERE, "../.."));
const PORT = Number(process.env.PORT || 3000);
const PATH_TOKEN = process.env.MCP_PATH_TOKEN || "";
const MCP_PATH = PATH_TOKEN ? `/mcp/${PATH_TOKEN}` : "/mcp";
const MAIN_ACTIVITY = "app/src/main/java/com/example/assetcatalog/MainActivity.java";

const BLOCKED_PREFIXES = [
  ".git",
  ".gradle",
  ".idea",
  "build",
  "app/build",
  "node_modules",
  "mcp/node_modules",
  "mcp/dist",
];

const TEXT_EXTENSIONS = new Set([
  ".java", ".kt", ".kts", ".xml", ".gradle", ".properties", ".md", ".json",
  ".ts", ".js", ".mjs", ".cjs", ".yml", ".yaml", ".txt", ".toml", ".pro",
]);

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function isBlocked(relativePath: string): boolean {
  const normalized = toPosix(relativePath).replace(/^\.\//, "");
  return BLOCKED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function safeResolve(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error("Le chemin doit être relatif au dépôt.");
  const normalized = toPosix(relativePath).replace(/^\.\//, "");
  if (normalized.split("/").includes("..")) throw new Error("Les chemins contenant '..' sont interdits.");
  if (isBlocked(normalized)) throw new Error(`Chemin protégé : ${normalized}`);
  const resolved = path.resolve(PROJECT_ROOT, normalized);
  const prefix = `${PROJECT_ROOT}${path.sep}`;
  if (resolved !== PROJECT_ROOT && !resolved.startsWith(prefix)) throw new Error("Le chemin sort du dépôt.");
  return resolved;
}

function ensureTextPath(relativePath: string): void {
  const base = path.basename(relativePath);
  const ext = path.extname(relativePath).toLowerCase();
  if (base === ".gitignore" || base === "gradlew" || base === "gradlew.bat") return;
  if (!TEXT_EXTENSIONS.has(ext)) throw new Error(`Type de fichier non autorisé : ${relativePath}`);
}

function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

async function listFiles(relativeDirectory: string, maxDepth: number): Promise<string[]> {
  const start = safeResolve(relativeDirectory);
  const output: string[] = [];
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = toPosix(path.relative(PROJECT_ROOT, absolute));
      if (isBlocked(relative)) continue;
      if (entry.isDirectory()) {
        output.push(`${relative}/`);
        await walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        output.push(relative);
      }
    }
  }
  await walk(start, 0);
  return output;
}

function runCommand(command: string, args: string[], timeoutMs = 300_000) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: PROJECT_ROOT, shell: process.platform === "win32", env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Commande interrompue après ${timeoutMs / 1000} secondes.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (exitCode) => { clearTimeout(timer); resolve({ exitCode, stdout, stderr }); });
  });
}

function countOccurrences(text: string, search: string): number {
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(search, index)) !== -1) {
    count += 1;
    index += search.length;
  }
  return count;
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "asset-chk", version: "1.1.0" });

  server.registerTool("project_summary", {
    description: "Use this when you need a quick summary of the Asset CHK Android repository.",
    inputSchema: z.object({}),
  }, async () => {
    try {
      const source = await fs.readFile(safeResolve(MAIN_ACTIVITY), "utf8");
      const counts = {
        asset3d: (source.match(/"Asset 3D"/g) || []).length,
        asset25d: (source.match(/"Asset 2\.5D"/g) || []).length,
        animated3d: (source.match(/"3D animé"/g) || []).length,
      };
      return textResult({ project: "Asset CHK", repository: "Chasmet/Asset-3d-asset-2.5d", counts });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("list_project_files", {
    description: "Use this when you need to inspect the repository structure.",
    inputSchema: z.object({ directory: z.string().default("."), maxDepth: z.number().int().min(0).max(8).default(4) }),
  }, async ({ directory, maxDepth }) => {
    try { return textResult({ directory, files: await listFiles(directory, maxDepth) }); }
    catch (error) { return errorResult(error); }
  });

  server.registerTool("read_project_file", {
    description: "Use this when you need the exact contents of a text source file in Asset CHK.",
    inputSchema: z.object({ path: z.string().min(1) }),
  }, async ({ path: relativePath }) => {
    try {
      ensureTextPath(relativePath);
      return textResult({ path: relativePath, content: await fs.readFile(safeResolve(relativePath), "utf8") });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("write_project_file", {
    description: "Use this when you need to create or replace a text file in the deployed Asset CHK workspace. The operation is restricted to the repository tree.",
    inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
  }, async ({ path: relativePath, content }) => {
    try {
      ensureTextPath(relativePath);
      const absolute = safeResolve(relativePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content, "utf8");
      return textResult({ path: relativePath, written: true, bytes: Buffer.byteLength(content, "utf8"), persistence: "runtime-workspace" });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("replace_in_project_file", {
    description: "Use this when you need a precise guarded text replacement in a project file.",
    inputSchema: z.object({
      path: z.string().min(1), search: z.string().min(1), replacement: z.string(),
      expectedOccurrences: z.number().int().min(1).max(100).default(1),
    }),
  }, async ({ path: relativePath, search, replacement, expectedOccurrences }) => {
    try {
      ensureTextPath(relativePath);
      const absolute = safeResolve(relativePath);
      const original = await fs.readFile(absolute, "utf8");
      const occurrences = countOccurrences(original, search);
      if (occurrences !== expectedOccurrences) throw new Error(`${occurrences} occurrence(s) trouvée(s), ${expectedOccurrences} attendue(s).`);
      await fs.writeFile(absolute, original.split(search).join(replacement), "utf8");
      return textResult({ path: relativePath, replaced: occurrences, persistence: "runtime-workspace" });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("git_diff", {
    description: "Use this after local edits to inspect the exact Git diff before syncing changes back to GitHub.",
    inputSchema: z.object({}),
  }, async () => {
    try { return textResult(await runCommand("git", ["diff", "--", "."], 60_000)); }
    catch (error) { return errorResult(error); }
  });

  server.registerTool("run_gradle_task", {
    description: "Use this to validate or build Asset CHK with an allowed Android Gradle task.",
    inputSchema: z.object({ task: z.enum(["assembleDebug", "lintDebug", "testDebugUnitTest", "clean"]) }),
  }, async ({ task }) => {
    try {
      const executable = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
      return textResult({ task, ...(await runCommand(executable, [task, "--no-daemon"])) });
    } catch (error) { return errorResult(error); }
  });

  return server;
}

const mcpHandler = createMcpHandler(() => buildServer());
const nodeHandler = toNodeHandler(mcpHandler);

const httpServer = createServer(async (req, res) => {
  const pathname = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
  if (pathname === "/health") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, service: "asset-chk-mcp", mcpPath: MCP_PATH }));
    return;
  }
  if (pathname !== MCP_PATH) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  await nodeHandler(req, res);
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Asset CHK MCP listening on 0.0.0.0:${PORT}${MCP_PATH}`);
});
