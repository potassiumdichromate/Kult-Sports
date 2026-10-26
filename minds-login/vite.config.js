import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Builds the Minds sign-in island into the game's static folder:
//   public/minds/kult-minds.js
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  define: { "process.env.NODE_ENV": JSON.stringify("production"), global: "globalThis" },
  build: {
    outDir: fileURLToPath(new URL("../public/minds", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    lib: { entry: fileURLToPath(new URL("./main.js", import.meta.url)), formats: ["es"], fileName: () => "kult-minds.js" },
    rollupOptions: { output: { chunkFileNames: "chunks/[name]-[hash].js" } }
  }
});
