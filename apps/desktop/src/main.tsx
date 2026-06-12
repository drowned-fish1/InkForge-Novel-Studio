import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import { initializeTheme } from "@/lib/theme";
import "@/styles.css";

initializeTheme();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
