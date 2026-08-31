import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev proxies /api to a running slate server. Production is `npm run build`
// → src/agentslate/static, served by the server from inside the package.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "../src/agentslate/static",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: "editor", test: /node_modules[\\/](@codemirror|@lezer)[\\/]/ }],
        },
      },
    },
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:8750" },
  },
});
