import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const appDir = path.resolve(import.meta.dirname, "..");
const targetArgs = process.argv.includes("--dir") ? ["--dir", "--x64"] : ["--win", "nsis", "--x64"];
const outputDir = path.join(appDir, "release");
const temporaryElectron = path.join(outputDir, "win-unpacked.tmp");
const builderCli = path.resolve(appDir, "..", "..", "node_modules", "electron-builder", "out", "cli", "cli.js");

const runBuilder = (extraArgs = []) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [builderCli, ...targetArgs, ...extraArgs], {
      cwd: appDir,
      stdio: "inherit",
      windowsHide: true
    });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });

let exitCode = await runBuilder();
if (exitCode !== 0) {
  const hasExtractedElectron = await access(temporaryElectron)
    .then(() => true)
    .catch(() => false);
  if (hasExtractedElectron) {
    console.warn("Electron extraction was temporarily locked; retrying with the completed local extraction.");
    exitCode = await runBuilder([`--config.electronDist=${temporaryElectron}`]);
  }
}

process.exitCode = exitCode;
