import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and doesn't want Vite to open a browser tab
export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: ["code.spinop.com"],
    // Tell Vite to watch everything except the Rust source
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
