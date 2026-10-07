#!/usr/bin/env -S bun run
/**
 * Bundles the Radiooooo Last.fm Scrobbler Chrome extension using Bun.
 *
 * Usage:
 *   bun run build
 *   bun run build --out=/path/to/dist
 *   bun run build --watch
 *
 * Output:
 *   dist/background.js        (ESM — service worker)
 *   dist/content-*.js         (IIFE — content scripts)
 *   dist/ui/popup*.js         (IIFE)
 *   dist/*.html, *.css, manifest.json, BUILD.txt
 */

import { rm, mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Bun as BunImport } from "bun";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");

const outArg = process.argv.find((a) => a.startsWith("--out="));
const outDir = outArg
  ? path.resolve(outArg.slice("--out=".length))
  : path.join(root, "dist");
const watch = process.argv.includes("--watch");

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

const bundles = [
  { in: "background/service-worker.ts", out: "background" },
  { in: "content/bridge.ts", out: "content-bridge" },
  { in: "content/detector.ts", out: "content-detector" },
  { in: "content/token-sniffer.ts", out: "content-token" },
  { in: "ui/popup.ts", out: "popup" },
  { in: "ui/options.ts", out: "options" },
];

const staticFiles = [
  { from: "manifest.json", to: "manifest.json" },
  { from: "ui/popup.html", to: "popup.html" },
  { from: "ui/options.html", to: "options.html" },
  { from: "ui/styles.css", to: "styles.css" },
];

async function copyStatic(outDir: string): Promise<void> {
  for (const f of staticFiles) {
    const from = path.join(srcDir, f.from);
    if (!existsSync(from)) throw new Error(`missing static file: ${f.from}`);
    await cp(from, path.join(outDir, f.to));
  }
}

/** `chrome` is referenced as a global (`chrome.runtime...`), not imported, so
 * there is nothing to externalize. */
const common: Partial<BunImport.BuildConfig> = {
  bundle: true,
  platform: "browser",
  logLevel: "info",
  banner: `/* radiooooo-scrobbler ${pkg.version} */`,
};

function optionsFor(out: string): BunImport.BuildConfig {
  const isWorker = out === "background";
  return {
    ...common,
    entryPoints: [path.join(srcDir, bundles.find((b) => b.out === out)!.in)],
    format: isWorker ? "esm" : "iife",
    outdir: outDir,
    naming: `${out}.[ext]`,
    target: "browser",
  };
}

function ensureSuccess(result: Awaited<ReturnType<typeof Bun.build>>, out: string): void {
  if (!result.success) {
    const detail = (result.logs ?? []).map((l) => l.message).join("\n");
    throw new Error(`build failed for ${out}:\n${detail}`);
  }
}

async function buildOnce(): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const b of bundles) {
    ensureSuccess(await Bun.build(optionsFor(b.out)), b.out);
  }

  await copyStatic(outDir);
  await writeFile(
    path.join(outDir, "BUILD.txt"),
    `radiooooo-scrobbler ${pkg.version}\nbuilt: ${new Date().toISOString()}\n`,
    "utf8",
  );
  console.log(`built -> ${outDir}`);
}

if (watch) {
  for (const b of bundles) {
    await mkdir(outDir, { recursive: true });
    await copyStatic(outDir);
    await Bun.build({
      ...optionsFor(b.out),
      watch: true,
      onEnd: (result) => {
        if (!result.success) {
          for (const error of result.logs ?? []) {
            console.error(`[watch] ${error.message}`);
          }
        }
      },
    });
  }
  console.log(`watching -> ${outDir}`);
  // Keep the process alive; Bun keeps it running while watchers are active.
  await new Promise<never>(() => {});
} else {
  await buildOnce();
}
