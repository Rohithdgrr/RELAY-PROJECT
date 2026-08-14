import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // Tauri expects a fixed port; fail if it is taken.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Ignore Rust build outputs (noisy churn); keep watching the preload
      // scripts so dev-time edits to relay-bridge.js are served fresh.
      ignored: ["**/src-tauri/target/**", "**/src-tauri/gen/**"],
    },
  },

  // Env variables starting with the item of `envPrefix` will be exposed to
  // your tauri-generated source code. See https://v2.tauri.app/reference/environment-variables/
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
