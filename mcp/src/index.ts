import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(
  process.env.ASSET_PROJECT_ROOT || path.resolve(HERE, "../.."),
);

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
  ".java",
  ".kt",
  ".kts",
  ".xml",
  ".gradle",
  ".properties",
  ".md",
  ".json",
  ".ts",
  ".js",
  ".mjs",
  ".cjs",
  ".yml",
  ".yaml",
  ".txt",
  ".toml",
  ".pro",
]);

const AssetTypeSchema = z.enum(["3d", "2.5d", "3d_animated"]);
type AssetType = z.infer<typeof AssetTypeSchema>;

type Asset = {
  type: AssetType;
  title: string;
  creator: string;
  license: string;
  category: string;
  description: string;
  sourceUrl: string;
  preview: string;
};

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function isBlocked(relativePath: string): boolean {
  const normalized = toPosix(relativePath).replace(/^\.\//, "");
  return BLOCKED_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

function safeResolve(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error("Le chemin doit être relatif au dépôt.");
  }

  const normalized = toPosix(relativePath).replace(/^\.\//, "");
  if (normalized.split("/").includes("..")) {
    throw new Error("Les chemins contenant '..' sont interdits.");
  }
  if (isBlocked(normalized)) {
    throw new Error(`Chemin protégé : ${normalized}`);
  }

  const resolved = path.resolve(PROJECT_ROOT, normalized);
  const rootWithSeparator = `${PROJECT_ROOT}${path.sep}`;
  if (resolved !== PROJECT_ROOT && !resolved.startsWith(rootWithSeparator)) {
    throw new Error("Le chemin sort du dépôt.");
  }
  return resolved;
}

function ensureTextPath(relativePath: string): void {
  const base = path.basename(relativePath);
  const extension = path.extname(relativePath).toLowerCase();
  if (base === ".gitignore" || base === "gradlew" || base === "gradlew.bat") {
    return;
  }
  if (!TEXT_EXTENSIONS.has(extension)) {
    throw new Error(`Type de fichier non autorisé pour cette opération : ${relativePath}`);
  }
}

function javaUnescape(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function categoryToType(category: string): AssetType {
  if (category === "Asset 2.5D") return "2.5d";
  if (category === "3D animé") return "3d_animated";
  return "3d";
}

async function parseAssets(): Promise<Asset[]> {
  const source = await fs.readFile(safeResolve(MAIN_ACTIVITY), "utf8");
  const regex = /items\.add\(new AssetItem\(\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*,\s*R\.drawable\.([A-Za-z0-9_]+)\s*\)\);/gs;

  const assets: Asset[] = [];
  for (const match of source.matchAll(regex)) {
    const category = javaUnescape(match[4]);
    assets.push({
      type: categoryToType(category),
      title: javaUnescape(match[1]),
      creator: javaUnescape(match[2]),
      license: javaUnescape(match[3]),
      category,
      description: javaUnescape(match[5]),
      sourceUrl: javaUnescape(match[6]),
      preview: match[7],
    });
  }
  return assets;
}

function result(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
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

async function drawableNames(): Promise<Set<string>> {
  const directory = safeResolve("app/src/main/res/drawable");
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return new Set(
      entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.parse(entry.name).name),
    );
  } catch {
    return new Set();
  }
}

async function validateCatalog() {
  const assets = await parseAssets();
  const drawables = await drawableNames();
  const issues: Array<{ level: "error" | "warning"; asset?: string; message: string }> = [];
  const titles = new Map<string, number>();

  for (const asset of assets) {
    const key = asset.title.trim().toLowerCase();
    titles.set(key, (titles.get(key) || 0) + 1);

    if (!asset.title.trim()) {
      issues.push({ level: "error", message: "Un asset possède un titre vide." });
    }
    if (!asset.creator.trim()) {
      issues.push({ level: "warning", asset: asset.title, message: "Créateur manquant." });
    }
    if (!asset.license.trim()) {
      issues.push({ level: "error", asset: asset.title, message: "Licence manquante." });
    }
    if (!/^https:\/\//i.test(asset.sourceUrl)) {
      issues.push({ level: "error", asset: asset.title, message: "URL source HTTPS invalide." });
    }
    if (!drawables.has(asset.preview)) {
      issues.push({
        level: "error",
        asset: asset.title,
        message: `Drawable introuvable : R.drawable.${asset.preview}`,
      });
    }
  }

  for (const [title, count] of titles) {
    if (count > 1) {
      issues.push({ level: "warning", message: `Titre dupliqué (${count}x) : ${title}` });
    }
  }

  return {
    valid: !issues.some((issue) => issue.level === "error"),
    assetCount: assets.length,
    issues,
  };
}

function countOccurrences(text: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(search, index)) !== -1) {
    count += 1;
    index += search.length;
  }
  return count;
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs: number) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Commande interrompue après ${timeoutMs / 1000} secondes.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function buildServer(): McpServer {
  const server = new McpServer({
    name: "asset-3d-25d-project",
    version: "1.0.0",
  });

  server.registerTool(
    "project_summary",
    {
      description: "Résume le projet Android et compte les assets par catégorie.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const assets = await parseAssets();
        const counts = {
          "3d": assets.filter((asset) => asset.type === "3d").length,
          "2.5d": assets.filter((asset) => asset.type === "2.5d").length,
          "3d_animated": assets.filter((asset) => asset.type === "3d_animated").length,
        };
        return result({
          project: "Asset 3D / Asset 2.5D / 3D animé",
          androidSource: MAIN_ACTIVITY,
          assetCount: assets.length,
          counts,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_project_files",
    {
      description: "Liste les fichiers du dépôt en ignorant les dossiers de build et dépendances.",
      inputSchema: z.object({
        directory: z.string().default("."),
        maxDepth: z.number().int().min(0).max(8).default(4),
      }),
    },
    async ({ directory, maxDepth }) => {
      try {
        const files = await listFiles(directory, maxDepth);
        return result({ directory, count: files.length, files });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "read_project_file",
    {
      description: "Lit un fichier texte du dépôt.",
      inputSchema: z.object({
        path: z.string().min(1),
      }),
    },
    async ({ path: relativePath }) => {
      try {
        ensureTextPath(relativePath);
        const content = await fs.readFile(safeResolve(relativePath), "utf8");
        return result({ path: relativePath, content });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "write_project_file",
    {
      description: "Crée ou remplace un fichier texte du dépôt. Les dossiers sensibles sont bloqués.",
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string(),
        createDirectories: z.boolean().default(true),
      }),
    },
    async ({ path: relativePath, content, createDirectories }) => {
      try {
        ensureTextPath(relativePath);
        const absolute = safeResolve(relativePath);
        if (createDirectories) {
          await fs.mkdir(path.dirname(absolute), { recursive: true });
        }
        await fs.writeFile(absolute, content, "utf8");
        return result({ path: relativePath, written: true, bytes: Buffer.byteLength(content, "utf8") });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "replace_in_project_file",
    {
      description: "Remplace exactement un texte dans un fichier avec contrôle du nombre d'occurrences.",
      inputSchema: z.object({
        path: z.string().min(1),
        search: z.string().min(1),
        replacement: z.string(),
        expectedOccurrences: z.number().int().min(1).max(100).default(1),
      }),
    },
    async ({ path: relativePath, search, replacement, expectedOccurrences }) => {
      try {
        ensureTextPath(relativePath);
        const absolute = safeResolve(relativePath);
        const original = await fs.readFile(absolute, "utf8");
        const occurrences = countOccurrences(original, search);
        if (occurrences !== expectedOccurrences) {
          throw new Error(
            `Remplacement refusé : ${occurrences} occurrence(s) trouvée(s), ${expectedOccurrences} attendue(s).`,
          );
        }
        const updated = original.split(search).join(replacement);
        await fs.writeFile(absolute, updated, "utf8");
        return result({ path: relativePath, replaced: occurrences });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_assets",
    {
      description: "Liste les assets actuellement codés dans l'application, avec filtre facultatif.",
      inputSchema: z.object({
        type: AssetTypeSchema.optional(),
      }),
    },
    async ({ type }) => {
      try {
        const assets = await parseAssets();
        const filtered = type ? assets.filter((asset) => asset.type === type) : assets;
        return result({ count: filtered.length, assets: filtered });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "search_assets",
    {
      description: "Recherche dans les titres, créateurs, licences, catégories et descriptions des assets.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
    },
    async ({ query }) => {
      try {
        const needle = query.toLocaleLowerCase("fr");
        const assets = (await parseAssets()).filter((asset) =>
          [
            asset.title,
            asset.creator,
            asset.license,
            asset.category,
            asset.description,
            asset.sourceUrl,
          ].some((value) => value.toLocaleLowerCase("fr").includes(needle)),
        );
        return result({ query, count: assets.length, assets });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "validate_catalog",
    {
      description: "Vérifie les assets : doublons, licences, URL HTTPS et drawables référencés.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return result(await validateCatalog());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "run_gradle_task",
    {
      description: "Exécute une tâche Gradle Android autorisée et retourne la sortie complète.",
      inputSchema: z.object({
        task: z.enum(["assembleDebug", "lintDebug", "testDebugUnitTest", "clean"]),
      }),
    },
    async ({ task }) => {
      try {
        const executable = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
        const execution = await runCommand(executable, [task, "--no-daemon"], PROJECT_ROOT, 300_000);
        return result({ task, ...execution });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}

await serveStdio(() => buildServer());
