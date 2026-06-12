import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import { authHeaders, completionsUrl, type ChatCompletionRequest, type ProviderAuthMode } from "@inkforge/ai-provider";

export default defineConfig({
  root: __dirname,
  plugins: [react(), inkforgeAiDevProxy()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@inkforge/schemas": path.resolve(__dirname, "../../packages/schemas/src/index.ts"),
      "@inkforge/prompt-engine": path.resolve(__dirname, "../../packages/prompt-engine/src/index.ts"),
      "@inkforge/ai-provider": path.resolve(__dirname, "../../packages/ai-provider/src/index.ts"),
      "@inkforge/agent-engine": path.resolve(__dirname, "../../packages/agent-engine/src/index.ts")
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (!normalized.includes("/node_modules/")) {
            return undefined;
          }
          if (normalized.includes("/node_modules/docx/")) {
            return "vendor-docx";
          }
          if (
            normalized.includes("/node_modules/jszip/") ||
            normalized.includes("/node_modules/pako/") ||
            normalized.includes("/node_modules/readable-stream/") ||
            normalized.includes("/node_modules/safe-buffer/") ||
            normalized.includes("/node_modules/core-util-is/") ||
            normalized.includes("/node_modules/inherits/") ||
            normalized.includes("/node_modules/immediate/")
          ) {
            return "vendor-docx-zip";
          }
          if (normalized.includes("/node_modules/xml/") || normalized.includes("/node_modules/xml-js/")) {
            return "vendor-docx-xml";
          }
          if (normalized.includes("/node_modules/marked/")) {
            return "vendor-markdown";
          }
          if (normalized.includes("/node_modules/lucide-react/")) {
            return "vendor-icons";
          }
          if (
            normalized.includes("/node_modules/react/") ||
            normalized.includes("/node_modules/react-dom/") ||
            normalized.includes("/node_modules/scheduler/") ||
            normalized.includes("/node_modules/zustand/")
          ) {
            return "vendor-react";
          }
          return undefined;
        }
      }
    }
  }
});

interface ProxyRequestBody {
  baseUrl?: string;
  authMode?: ProviderAuthMode;
  apiKey?: string;
  payload?: ChatCompletionRequest;
}

function inkforgeAiDevProxy(): Plugin {
  return {
    name: "inkforge-ai-dev-proxy",
    configureServer(server) {
      server.middlewares.use("/__inkforge_ai/chat-completions", async (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: { message: "Method not allowed" } }));
          return;
        }

        try {
          const body = JSON.parse(await readRequestBody(request)) as ProxyRequestBody;
          const baseUrl = normalizeBaseUrl(body.baseUrl);
          const upstream = await fetch(completionsUrl(baseUrl), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...authHeaders(body.authMode ?? "bearer", body.apiKey)
            },
            body: JSON.stringify(body.payload ?? {})
          });
          const text = await upstream.text();
          response.statusCode = upstream.status;
          response.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
          response.end(text);
        } catch (error) {
          response.statusCode = 502;
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              error: {
                message: error instanceof Error ? error.message : "AI proxy request failed"
              }
            })
          );
        }
      });
    }
  };
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("AI proxy request body is too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function normalizeBaseUrl(baseUrl?: string): string {
  if (!baseUrl?.trim()) {
    throw new Error("Missing provider baseURL.");
  }
  const url = new URL(baseUrl.trim());
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Provider baseURL must start with http:// or https://.");
  }
  return url.toString().replace(/\/+$/, "");
}
