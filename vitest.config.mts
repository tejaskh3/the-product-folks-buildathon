import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Database tests run against local Supabase (`npx supabase start`); see test/db/setup.ts.
    setupFiles: ["test/setup.ts"],
  },
});
