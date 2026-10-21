import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [{ name: "isolated-minorista-data", enforce: "pre", resolveId(source) {
    if (source === "./supabase") return path.resolve("tests/minorista/supabase-fixture.ts");
  } }, react()],
  server: { host: "127.0.0.1", port: 4174, strictPort: true },
});
