import { config } from "@remotion/eslint-config-flat";
import globals from "globals";

export default [
  ...config,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
];
