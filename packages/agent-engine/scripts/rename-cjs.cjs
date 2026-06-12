const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const source = path.join(packageRoot, "dist-cjs", "index.js");
const target = path.join(packageRoot, "dist", "index.cjs");

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
fs.rmSync(path.join(packageRoot, "dist-cjs"), { recursive: true, force: true });
