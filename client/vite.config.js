import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const gestureEntry = fileURLToPath(new URL("../gesture_pipeline/src/gestures/index.ts", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "conjure-gestures": gestureEntry },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: { exclude: ["conjure-gestures"] },
  server: {
    port: 5173,
    // Forward /api requests to the Express server
    proxy: {
      "/api": "http://localhost:3001",
      "/ws-live": { target: "ws://localhost:8000", ws: true },
    },
  },
});
