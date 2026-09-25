import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * The Ecom Node API is the only data source for both frontends, and it is
 * process-local on `127.0.0.1:4312` by default. The dev server proxies `/api`
 * there, so every fetch in `@/lib/api` stays a same-origin relative path and no
 * component needs to know where the API runs. Start it first with `npm run web`
 * from the repository root.
 */
const API_ORIGIN = process.env.ATLAS_ECOM_API_ORIGIN ?? "http://127.0.0.1:4312";

const proxy = { "/api": { target: API_ORIGIN, changeOrigin: false } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: { proxy },
  preview: { proxy },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
