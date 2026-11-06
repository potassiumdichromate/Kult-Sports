import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Builds Polymarket (data, the deposit wallet, CLOB trading, bridge, withdrawals)
// into the game's static folder: public/polymarket/kult-polymarket.js (+ chunks).
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  define: { "process.env.NODE_ENV": JSON.stringify("production"), global: "globalThis" },
  build: {
    outDir: fileURLToPath(new URL("../public/polymarket", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    lib: { entry: fileURLToPath(new URL("./main.ts", import.meta.url)), formats: ["es"], fileName: () => "kult-polymarket.js" },
    rollupOptions: { output: { chunkFileNames: "chunks/[name]-[hash].js" } }
  }
});
