import { register } from "node:module";

register(new URL("./mock-electron-loader.mjs", import.meta.url), import.meta.url);
