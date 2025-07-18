import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
   base: '/',
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    "process.env.API_BASE": JSON.stringify(process.env.API_BASE || ""),
    "process.env.BUILD_DATE": JSON.stringify(new Date().toLocaleString()),
  },
  server: {
    https: false,
    host: true,
    port: 5173,
  },
  publicDir: "public", // ✅ Makes sure _redirects is included
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"), // ✅ Fixes missing entry
      },
    },
  },
});
