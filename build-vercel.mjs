#!/usr/bin/env node
/**
 * build-vercel.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;

const distClient = path.join(root, "dist", "client");
const distServer = path.join(root, "dist", "server");
const outDir     = path.join(root, ".vercel", "output");

// ── Clean & create output dirs ────────────────────────────────────────────────
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "static"),                       { recursive: true });
fs.mkdirSync(path.join(outDir, "functions", "index.func"),      { recursive: true });

// ── 1. config.json ─────────────────────────────────────────────────────────────
fs.writeFileSync(
  path.join(outDir, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        {
          src: "^/assets/(.+)$",
          headers: { "cache-control": "public, max-age=31536000, immutable" },
          continue: true,
        },
        { handle: "filesystem" },
        { src: "/(.*)", dest: "/index" },
      ],
    },
    null,
    2,
  ),
);

// ── 2. Static assets ──────────────────────────────────────────────────────────
copyDir(distClient, path.join(outDir, "static"));

// ── 3. Server function ────────────────────────────────────────────────────────
const funcDir = path.join(outDir, "functions", "index.func");

copyDir(distServer, funcDir);

// package.json — tells Node.js to treat .js files as ESM inside the function
fs.writeFileSync(
  path.join(funcDir, "package.json"),
  JSON.stringify({ type: "module" }, null, 2),
);

// index.mjs — adapts Node.js req/res → Web Request/Response for the fetch handler
fs.writeFileSync(
  path.join(funcDir, "index.mjs"),
  `import handler from "./server.js";

export default async function (req, res) {
  const url = new URL(req.url, \`https://\${req.headers.host}\`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        value.forEach((v) => headers.append(key, v));
      } else {
        headers.set(key, value);
      }
    }
  }

  const init = { method: req.method, headers };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await readBody(req);
    init.duplex = "half";
  }

  const webRequest = new Request(url.toString(), init);
  const webResponse = await handler.fetch(webRequest);

  res.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => res.setHeader(key, value));

  const buffer = await webResponse.arrayBuffer();
  res.end(Buffer.from(buffer));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
`,
);

// .vc-config.json — nodejs20.x serverless (NOT edge; edge lacks process.env + Node APIs)
fs.writeFileSync(
  path.join(funcDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs20.x",
      handler: "index.mjs",
      launchWorker: false,
    },
    null,
    2,
  ),
);

// ── Done ──────────────────────────────────────────────────────────────────────
console.log("✓ .vercel/output assembled successfully");
console.log(`  static/    — ${countFiles(path.join(outDir, "static"))} files`);
console.log(`  index.func — serverless SSR function (nodejs20.x, ESM)`);

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`⚠️  Source not found, skipping: ${src}`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name));
    else count++;
  }
  return count;
}
