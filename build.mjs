/*
 * Build: type-check with TypeScript, then bundle all sources into one file, scripts/pack-and-ledger.js.
 *
 * One file instead of one per source: when the browser cannot load a single file of an ES module graph, the whole
 * module fails – and ad blockers block files by name (e.g. "log-view.js"). A single file with a neutral name avoids
 * that, and loads faster. The source map lets errors point at the TypeScript sources.
 *
 *   npm run build          type-check and bundle
 *   npm run watch          bundle again on every change (no type-check)
 */
import { build, context } from "esbuild";
import { rmSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const watch = process.argv.includes("--watch");
const options = {
  entryPoints: ["src/main.ts"],
  outfile: "scripts/pack-and-ledger.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: true,
  legalComments: "none",
  logLevel: "info"
};

// Keep the last working bundle if type-checking fails.
if ( !watch ) execSync("npx tsc --noEmit", { stdio: "inherit" });

// Older builds wrote one file per source into scripts/; start from an empty folder.
rmSync("scripts", { recursive: true, force: true });
mkdirSync("scripts");

if ( watch ) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
