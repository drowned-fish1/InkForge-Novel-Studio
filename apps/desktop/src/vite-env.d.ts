/// <reference types="vite/client" />

import type { InkforgeApi } from "../electron/preload";

declare global {
  interface Window {
    inkforge?: InkforgeApi;
  }
}
