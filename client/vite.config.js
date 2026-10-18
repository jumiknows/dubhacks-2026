import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Forward /api requests to the Express server
    proxy: {
      "/api": "http://localhost:3001",
      "/ws-live": { target: "ws://localhost:8000", ws: true },
    },
  },
});
