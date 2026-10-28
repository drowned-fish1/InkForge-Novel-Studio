import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const desktopDir = path.resolve(import.meta.dirname, "..");
const outfile = path.join(desktopDir, "dist-electron", "preload.cjs");

await build({
  entryPoints: [path.join(desktopDir, "electron", "preload.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  sourcesContent: false,
  legalComments: "none",
  treeShaking: true
});

const bundled = await readFile(outfile, "utf8");
const requiredModules = new Set([...bundled.matchAll(/\brequire\((['"])([^'"]+)\1\)/gu)].map((match) => match[2]));
const unexpectedModules = [...requiredModules].filter((moduleName) => moduleName !== "electron");

if (!requiredModules.has("electron") || unexpectedModules.length > 0) {
  throw new Error(`Sandboxed preload must require only Electron; found: ${[...requiredModules].join(", ") || "none"}.`);
}
