/**
 * vercel-build.mjs
 *
 * Runs after `vite build` and assembles the Vercel Build Output API v3 structure:
 *
 *   .vercel/output/
 *   ├── config.json                  ← route config
 *   ├── static/                      ← client assets (served by Vercel CDN)
 *   └── functions/
 *       └── index.func/
 *           ├── .vc-config.json      ← edge function config
 *           └── index.js             ← server bundle entry
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const root   = process.cwd();
const dist   = path.join(root, "dist");
const out    = path.join(root, ".vercel", "output");
const fnDir  = path.join(out, "functions", "index.func");
const static_ = path.join(out, "static");

console.log("🔨 Building with vite...");
execSync("npx vite build", { stdio: "inherit" });

console.log("📦 Assembling .vercel/output...");

// Clean + create output dirs
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(fnDir, { recursive: true });
fs.mkdirSync(static_, { recursive: true });

// 1. Copy client assets → .vercel/output/static
copyDir(path.join(dist, "client"), static_);

// 2. Copy server bundle → .vercel/output/functions/index.func
copyDir(path.join(dist, "server"), fnDir);

// 3. Write edge function config
fs.writeFileSync(
  path.join(fnDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "edge",
      entrypoint: "server.js",
    },
    null,
    2,
  ),
);

// 4. Write Vercel output config — catch-all to the edge function,
//    static assets served from CDN, _immutable assets get long cache headers
fs.writeFileSync(
  path.join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        // Immutable hashed assets — 1 year cache
        {
          src: "^/assets/(.+)$",
          headers: { "cache-control": "public, max-age=31536000, immutable" },
          continue: true,
        },
        // Static files first
        { handle: "filesystem" },
        // Everything else → SSR edge function
        { src: "/(.*)", dest: "/index" },
      ],
    },
    null,
    2,
  ),
);

console.log("✅ .vercel/output assembled successfully.");

// ── helpers ───────────────────────────────────────────────────────────────────
function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`⚠️  Source not found, skipping: ${src}`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
